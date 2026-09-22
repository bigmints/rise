"""Historical health-record storage and deterministic seed import for Rise."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


SEED_PATH = Path(__file__).resolve().parent / "seed" / "health_records.json"


def initialize_health_records(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS health_reports (
            id TEXT PRIMARY KEY,
            report_date TEXT NOT NULL,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            provider TEXT,
            lab_number TEXT,
            source_filenames TEXT NOT NULL,
            source_hash TEXT NOT NULL,
            detail TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS health_reports_date_idx "
        "ON health_reports(report_date DESC, id)"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS health_results (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES health_reports(id) ON DELETE CASCADE,
            section TEXT NOT NULL,
            name TEXT NOT NULL,
            canonical_key TEXT NOT NULL,
            value_text TEXT NOT NULL,
            numeric_value REAL,
            flag TEXT NOT NULL DEFAULT '',
            unit TEXT NOT NULL DEFAULT '',
            reference_range TEXT NOT NULL DEFAULT '',
            method TEXT,
            detail TEXT,
            sort_order INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS health_results_report_idx "
        "ON health_results(report_id, sort_order)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS health_results_history_idx "
        "ON health_results(canonical_key, unit)"
    )
    _import_seed(connection)


def _import_seed(connection: sqlite3.Connection) -> None:
    if not SEED_PATH.is_file():
        return
    payload = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    for report in payload.get("reports", []):
        connection.execute(
            """
            INSERT INTO health_reports (
                id, report_date, title, category, provider, lab_number,
                source_filenames, source_hash, detail, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                report_date = excluded.report_date,
                title = excluded.title,
                category = excluded.category,
                provider = excluded.provider,
                lab_number = excluded.lab_number,
                source_filenames = excluded.source_filenames,
                source_hash = excluded.source_hash,
                detail = excluded.detail
            """,
            (
                report["id"],
                report["report_date"],
                report["title"],
                report["category"],
                report.get("provider"),
                report.get("lab_number"),
                json.dumps(report.get("source_filenames", []), ensure_ascii=False),
                report["source_hash"],
                report.get("detail"),
                payload.get("generated_at", "2026-08-17T00:00:00+04:00"),
            ),
        )
        expected_ids: list[str] = []
        for position, result in enumerate(report.get("results", []), start=1):
            result_id = f"{report['id']}:{position:03d}"
            expected_ids.append(result_id)
            connection.execute(
                """
                INSERT INTO health_results (
                    id, report_id, section, name, canonical_key, value_text,
                    numeric_value, flag, unit, reference_range, method, detail,
                    sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    report_id = excluded.report_id,
                    section = excluded.section,
                    name = excluded.name,
                    canonical_key = excluded.canonical_key,
                    value_text = excluded.value_text,
                    numeric_value = excluded.numeric_value,
                    flag = excluded.flag,
                    unit = excluded.unit,
                    reference_range = excluded.reference_range,
                    method = excluded.method,
                    detail = excluded.detail,
                    sort_order = excluded.sort_order
                """,
                (
                    result_id,
                    report["id"],
                    result.get("section", "Results"),
                    result["name"],
                    result["key"],
                    str(result["value"]),
                    result.get("numeric"),
                    result.get("flag", ""),
                    result.get("unit", ""),
                    result.get("range", ""),
                    result.get("method"),
                    result.get("detail"),
                    position,
                ),
            )
        if expected_ids:
            placeholders = ",".join("?" for _ in expected_ids)
            connection.execute(
                f"DELETE FROM health_results WHERE report_id = ? AND id NOT IN ({placeholders})",
                [report["id"], *expected_ids],
            )


def list_health_records(connection: sqlite3.Connection) -> dict[str, Any]:
    report_rows = connection.execute(
        "SELECT * FROM health_reports ORDER BY report_date DESC, id DESC"
    ).fetchall()
    result_rows = connection.execute(
        """
        SELECT hr.*, hp.report_date
        FROM health_results hr
        JOIN health_reports hp ON hp.id = hr.report_id
        ORDER BY hp.report_date DESC, hr.report_id DESC, hr.sort_order
        """
    ).fetchall()

    reports: list[dict[str, Any]] = []
    reports_by_id: dict[str, dict[str, Any]] = {}
    for row in report_rows:
        report = {key: row[key] for key in row.keys()}
        report["source_filenames"] = json.loads(report["source_filenames"])
        report["results"] = []
        reports.append(report)
        reports_by_id[report["id"]] = report

    histories: dict[str, list[dict[str, Any]]] = {}
    for row in result_rows:
        result = {key: row[key] for key in row.keys() if key != "report_date"}
        reports_by_id[result["report_id"]]["results"].append(result)
        history_key = f"{result['canonical_key']}\u001f{result['unit']}"
        histories.setdefault(history_key, []).append(
            {
                "report_date": row["report_date"],
                "report_id": result["report_id"],
                "value_text": result["value_text"],
                "numeric_value": result["numeric_value"],
                "flag": result["flag"],
                "unit": result["unit"],
                "reference_range": result["reference_range"],
            }
        )

    return {
        "reports": reports,
        "histories": histories,
        "report_count": len(reports),
        "result_count": len(result_rows),
    }
