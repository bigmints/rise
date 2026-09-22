"""Configurable, typed trackers for Rise.

Tracker definitions live in the database, so adding a new daily measurement does
not require a code or deployment change. Entries are append-only for `anytime`
trackers and correction-aware upserts for `daily` trackers; every mutation is
recorded in the tracker audit log.
"""

from __future__ import annotations

import json
import hashlib
import math
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from typing import Any


VALUE_TYPES = {"number", "duration", "choice", "yes_no", "time", "blood_pressure"}
FREQUENCIES = {"daily", "anytime"}
CHECKIN_MANAGED_TRACKER_KEYS = {"weight"}
KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,63}$")
TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
DUBAI = timezone(timedelta(hours=4))


class TrackerError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def initialize_trackers(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS tracker_schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """
    )
    applied = {
        row[0]
        for row in connection.execute("SELECT version FROM tracker_schema_migrations")
    }
    if 1 not in applied:
        connection.executescript(
            """
            CREATE TABLE tracker_definitions (
                id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                value_type TEXT NOT NULL
                    CHECK (value_type IN ('number', 'duration', 'choice', 'yes_no', 'time', 'blood_pressure')),
                unit TEXT NOT NULL DEFAULT '',
                frequency TEXT NOT NULL DEFAULT 'daily'
                    CHECK (frequency IN ('daily', 'anytime')),
                input_min REAL,
                input_max REAL,
                input_step REAL,
                choices_json TEXT NOT NULL DEFAULT '[]',
                goal_json TEXT NOT NULL DEFAULT '{}',
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                display_order INTEGER NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                CHECK (input_min IS NULL OR input_max IS NULL OR input_min <= input_max),
                CHECK (input_step IS NULL OR input_step > 0)
            );

            CREATE TABLE tracker_entries (
                id TEXT PRIMARY KEY,
                tracker_id TEXT NOT NULL REFERENCES tracker_definitions(id) ON DELETE RESTRICT,
                day TEXT NOT NULL,
                observed_at TEXT,
                occurrence_key TEXT NOT NULL,
                numeric_value REAL,
                text_value TEXT,
                value_text TEXT NOT NULL,
                unit TEXT NOT NULL DEFAULT '',
                context TEXT,
                note TEXT,
                source TEXT NOT NULL,
                source_text TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (tracker_id, day, occurrence_key),
                CHECK (
                    (numeric_value IS NOT NULL AND text_value IS NULL)
                    OR (numeric_value IS NULL AND text_value IS NOT NULL)
                )
            );

            CREATE INDEX tracker_entries_history_idx
                ON tracker_entries(tracker_id, day DESC, observed_at DESC, id DESC);
            CREATE INDEX tracker_entries_day_idx ON tracker_entries(day DESC);

            CREATE TABLE tracker_entry_components (
                entry_id TEXT NOT NULL REFERENCES tracker_entries(id) ON DELETE CASCADE,
                component_key TEXT NOT NULL,
                numeric_value REAL,
                text_value TEXT,
                unit TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (entry_id, component_key),
                CHECK (
                    (numeric_value IS NOT NULL AND text_value IS NULL)
                    OR (numeric_value IS NULL AND text_value IS NOT NULL)
                )
            );

            CREATE TABLE tracker_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                action TEXT NOT NULL,
                before_json TEXT,
                after_json TEXT,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX tracker_audit_entity_idx
                ON tracker_audit_log(entity_type, entity_id, id DESC);

            CREATE TABLE tracker_idempotency (
                idempotency_key TEXT PRIMARY KEY,
                operation TEXT NOT NULL,
                response_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        connection.execute(
            "INSERT INTO tracker_schema_migrations(version, applied_at) VALUES (?, ?)",
            (1, utc_now()),
        )
    if 2 not in applied:
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(tracker_idempotency)")
        }
        if "request_hash" not in columns:
            connection.execute(
                "ALTER TABLE tracker_idempotency ADD COLUMN request_hash TEXT"
            )
        connection.execute(
            "INSERT INTO tracker_schema_migrations(version, applied_at) VALUES (?, ?)",
            (2, utc_now()),
        )
    _ensure_blood_pressure_tracker(connection)


def _ensure_blood_pressure_tracker(connection: sqlite3.Connection) -> None:
    """Install the built-in multi-reading BP tracker and import legacy daily readings."""
    tracker_id = "builtin-blood-pressure"
    now = utc_now()
    connection.execute(
        """
        INSERT OR IGNORE INTO tracker_definitions(
            id, key, name, category, value_type, unit, frequency,
            input_min, input_max, input_step, choices_json, goal_json,
            active, display_order, created_by, created_at, updated_at
        ) VALUES (?, 'blood_pressure', 'Blood pressure', 'Vitals',
            'blood_pressure', 'mmHg', 'anytime', NULL, NULL, NULL,
            '[]', '{}', 1, 10, 'system', ?, ?)
        """,
        (tracker_id, now, now),
    )
    table_exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'daily_checkins'"
    ).fetchone()
    if not table_exists:
        return
    for row in connection.execute(
        """
        SELECT day, bp_systolic, bp_diastolic, pulse_bpm, source, source_text,
               created_at, updated_at
        FROM daily_checkins
        WHERE bp_systolic IS NOT NULL AND bp_diastolic IS NOT NULL
        """
    ).fetchall():
        entry_id = f"legacy-bp-{row['day']}"
        inserted = connection.execute(
            """
            INSERT OR IGNORE INTO tracker_entries(
                id, tracker_id, day, observed_at, occurrence_key, numeric_value,
                text_value, value_text, unit, context, note, source, source_text,
                created_at, updated_at
            ) VALUES (?, ?, ?, NULL, 'legacy_daily', NULL, ?, ?, 'mmHg',
                NULL, NULL, ?, ?, ?, ?)
            """,
            (
                entry_id,
                tracker_id,
                row["day"],
                f"{row['bp_systolic']}/{row['bp_diastolic']}",
                f"{row['bp_systolic']}/{row['bp_diastolic']}",
                row["source"] or "legacy",
                row["source_text"],
                row["created_at"],
                row["updated_at"],
            ),
        ).rowcount
        if not inserted:
            continue
        components = [
            (entry_id, "systolic", row["bp_systolic"], None, "mmHg"),
            (entry_id, "diastolic", row["bp_diastolic"], None, "mmHg"),
        ]
        if row["pulse_bpm"] is not None:
            components.append((entry_id, "pulse", row["pulse_bpm"], None, "bpm"))
        connection.executemany(
            """
            INSERT OR IGNORE INTO tracker_entry_components(
                entry_id, component_key, numeric_value, text_value, unit
            ) VALUES (?, ?, ?, ?, ?)
            """,
            components,
        )


def _text(value: Any, field: str, *, required: bool = False, maximum: int = 120) -> str:
    if value is None:
        if required:
            raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} is required")
        return ""
    if not isinstance(value, str):
        raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be text")
    result = value.strip()
    if required and not result:
        raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} is required")
    if len(result) > maximum:
        raise TrackerError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"{field} must be at most {maximum} characters",
        )
    return result


def _optional_number(value: Any, field: str) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be a number")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be a number") from exc
    if not math.isfinite(result):
        raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be finite")
    return result


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    if not slug or not slug[0].isalpha():
        slug = f"tracker_{slug}".strip("_")
    return slug[:64]


def _day(value: Any) -> str:
    text = _text(value, "day", required=True, maximum=10)
    try:
        return datetime.strptime(text, "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, "day must be YYYY-MM-DD") from exc


def _timestamp(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = _text(value, "observed_at", required=True, maximum=40).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise TrackerError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "observed_at must be an ISO 8601 timestamp",
        ) from exc
    if parsed.tzinfo is None:
        raise TrackerError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "observed_at must include a timezone offset",
        )
    return parsed.isoformat(timespec="seconds")


def _choices(value: Any, value_type: str) -> list[str]:
    if value_type == "yes_no":
        return ["yes", "no"]
    if value_type != "choice":
        return []
    if not isinstance(value, list):
        raise TrackerError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "choices must be a list for a choice tracker",
        )
    choices: list[str] = []
    for item in value:
        choice = _text(item, "choice", required=True, maximum=60)
        if choice.casefold() not in {existing.casefold() for existing in choices}:
            choices.append(choice)
    if len(choices) < 2 or len(choices) > 20:
        raise TrackerError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "choice trackers need between 2 and 20 unique choices",
        )
    return choices


def _goal(value: Any) -> dict[str, Any]:
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, "goal must be an object")
    result: dict[str, Any] = {}
    label = _text(value.get("label"), "goal label", maximum=120)
    if label:
        result["label"] = label
    minimum = _optional_number(value.get("minimum"), "goal minimum")
    maximum = _optional_number(value.get("maximum"), "goal maximum")
    if minimum is not None:
        result["minimum"] = minimum
    if maximum is not None:
        result["maximum"] = maximum
    if minimum is not None and maximum is not None and minimum > maximum:
        raise TrackerError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "goal minimum cannot exceed goal maximum",
        )
    return result


def _definition_payload(payload: dict[str, Any], current: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = {**(current or {}), **payload}
    name = _text(merged.get("name"), "name", required=True, maximum=100)
    key = _text(merged.get("key") or _slug(name), "key", required=True, maximum=64)
    if not KEY_PATTERN.fullmatch(key):
        raise TrackerError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "key must start with a letter and contain only lowercase letters, numbers, or underscores",
        )
    value_type = _text(merged.get("value_type"), "value_type", required=True, maximum=20)
    if value_type not in VALUE_TYPES:
        raise TrackerError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"value_type must be one of: {', '.join(sorted(VALUE_TYPES))}",
        )
    frequency = _text(merged.get("frequency") or "daily", "frequency", maximum=20)
    if frequency not in FREQUENCIES:
        raise TrackerError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"frequency must be one of: {', '.join(sorted(FREQUENCIES))}",
        )
    minimum = _optional_number(merged.get("input_min"), "input_min")
    maximum = _optional_number(merged.get("input_max"), "input_max")
    step = _optional_number(merged.get("input_step"), "input_step")
    if minimum is not None and maximum is not None and minimum > maximum:
        raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, "input_min cannot exceed input_max")
    if step is not None and step <= 0:
        raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, "input_step must be greater than zero")
    return {
        "key": key,
        "name": name,
        "category": _text(merged.get("category") or "Personal", "category", maximum=60),
        "value_type": value_type,
        "unit": _text(merged.get("unit"), "unit", maximum=30),
        "frequency": frequency,
        "input_min": minimum,
        "input_max": maximum,
        "input_step": step,
        "choices": _choices(merged.get("choices", []), value_type),
        "goal": _goal(merged.get("goal")),
        "active": 1 if merged.get("active", True) else 0,
    }


def _row_dict(row: sqlite3.Row) -> dict[str, Any]:
    result = {key: row[key] for key in row.keys()}
    if "choices_json" in result:
        result["choices"] = json.loads(result.pop("choices_json"))
    if "goal_json" in result:
        result["goal"] = json.loads(result.pop("goal_json"))
    if "active" in result:
        result["active"] = bool(result["active"])
    return result


def _entry_components(
    connection: sqlite3.Connection, entry_id: str
) -> dict[str, dict[str, Any]]:
    return {
        row["component_key"]: {
            "numeric_value": row["numeric_value"],
            "text_value": row["text_value"],
            "unit": row["unit"],
        }
        for row in connection.execute(
            "SELECT * FROM tracker_entry_components WHERE entry_id = ?",
            (entry_id,),
        ).fetchall()
    }


def _audit(
    connection: sqlite3.Connection,
    entity_type: str,
    entity_id: str,
    action: str,
    *,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    source: str,
) -> None:
    connection.execute(
        """
        INSERT INTO tracker_audit_log(
            entity_type, entity_id, action, before_json, after_json, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            entity_type,
            entity_id,
            action,
            json.dumps(before, ensure_ascii=False, sort_keys=True) if before else None,
            json.dumps(after, ensure_ascii=False, sort_keys=True) if after else None,
            source,
            utc_now(),
        ),
    )


def create_tracker(
    connection: sqlite3.Connection,
    payload: dict[str, Any],
    *,
    source: str = "dashboard",
) -> dict[str, Any]:
    fields = _definition_payload(payload)
    if fields["key"] in CHECKIN_MANAGED_TRACKER_KEYS:
        raise TrackerError(
            HTTPStatus.CONFLICT,
            f"{fields['name']} is already managed by daily check-ins",
        )
    tracker_id = str(uuid.uuid4())
    now = utc_now()
    order = connection.execute(
        "SELECT COALESCE(MAX(display_order), 0) + 10 FROM tracker_definitions"
    ).fetchone()[0]
    try:
        connection.execute(
            """
            INSERT INTO tracker_definitions(
                id, key, name, category, value_type, unit, frequency,
                input_min, input_max, input_step, choices_json, goal_json,
                active, display_order, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tracker_id,
                fields["key"],
                fields["name"],
                fields["category"],
                fields["value_type"],
                fields["unit"],
                fields["frequency"],
                fields["input_min"],
                fields["input_max"],
                fields["input_step"],
                json.dumps(fields["choices"], ensure_ascii=False),
                json.dumps(fields["goal"], ensure_ascii=False, sort_keys=True),
                fields["active"],
                order,
                source,
                now,
                now,
            ),
        )
    except sqlite3.IntegrityError as exc:
        if "key" in str(exc).lower() or "unique" in str(exc).lower():
            raise TrackerError(HTTPStatus.CONFLICT, "a tracker with this key already exists") from exc
        raise
    tracker = get_tracker(connection, tracker_id=tracker_id)
    assert tracker is not None
    _audit(connection, "tracker", tracker_id, "created", before=None, after=tracker, source=source)
    return tracker


def get_tracker(
    connection: sqlite3.Connection,
    *,
    tracker_id: str | None = None,
    key: str | None = None,
) -> dict[str, Any] | None:
    if tracker_id:
        row = connection.execute(
            "SELECT * FROM tracker_definitions WHERE id = ?", (tracker_id,)
        ).fetchone()
    else:
        row = connection.execute(
            "SELECT * FROM tracker_definitions WHERE key = ?", (key,)
        ).fetchone()
    return _row_dict(row) if row else None


def update_tracker(
    connection: sqlite3.Connection,
    tracker_id: str,
    payload: dict[str, Any],
    *,
    source: str = "dashboard",
) -> dict[str, Any]:
    current = get_tracker(connection, tracker_id=tracker_id)
    if not current:
        raise TrackerError(HTTPStatus.NOT_FOUND, "tracker not found")
    if "key" in payload and payload["key"] != current["key"]:
        raise TrackerError(HTTPStatus.CONFLICT, "tracker keys are immutable")
    entry_count = connection.execute(
        "SELECT COUNT(*) FROM tracker_entries WHERE tracker_id = ?", (tracker_id,)
    ).fetchone()[0]
    if entry_count and any(
        field in payload and payload[field] != current[field]
        for field in ("value_type", "frequency", "unit")
    ):
        raise TrackerError(
            HTTPStatus.CONFLICT,
            "value type, frequency, and unit cannot change after entries exist",
        )
    merged = {
        **current,
        "choices": current["choices"],
        "goal": current["goal"],
        **payload,
    }
    fields = _definition_payload(merged, current)
    connection.execute(
        """
        UPDATE tracker_definitions SET
            name = ?, category = ?, value_type = ?, unit = ?, frequency = ?,
            input_min = ?, input_max = ?, input_step = ?, choices_json = ?,
            goal_json = ?, active = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            fields["name"],
            fields["category"],
            fields["value_type"],
            fields["unit"],
            fields["frequency"],
            fields["input_min"],
            fields["input_max"],
            fields["input_step"],
            json.dumps(fields["choices"], ensure_ascii=False),
            json.dumps(fields["goal"], ensure_ascii=False, sort_keys=True),
            fields["active"],
            utc_now(),
            tracker_id,
        ),
    )
    updated = get_tracker(connection, tracker_id=tracker_id)
    assert updated is not None
    _audit(connection, "tracker", tracker_id, "updated", before=current, after=updated, source=source)
    return updated


def _validated_entry_value(tracker: dict[str, Any], value: Any) -> dict[str, Any]:
    value_type = tracker["value_type"]
    if value_type == "blood_pressure":
        if not isinstance(value, dict):
            raise TrackerError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "blood pressure value must include systolic and diastolic",
            )
        systolic = _optional_number(value.get("systolic"), "systolic")
        diastolic = _optional_number(value.get("diastolic"), "diastolic")
        pulse = _optional_number(value.get("pulse"), "pulse")
        if systolic is None or not 40 <= systolic <= 300:
            raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, "systolic must be between 40 and 300")
        if diastolic is None or not 20 <= diastolic <= 200:
            raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, "diastolic must be between 20 and 200")
        if pulse is not None and not 20 <= pulse <= 250:
            raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, "pulse must be between 20 and 250")
        components = [
            {"key": "systolic", "numeric_value": systolic, "text_value": None, "unit": "mmHg"},
            {"key": "diastolic", "numeric_value": diastolic, "text_value": None, "unit": "mmHg"},
        ]
        if pulse is not None:
            components.append(
                {"key": "pulse", "numeric_value": pulse, "text_value": None, "unit": "bpm"}
            )
        return {
            "numeric_value": None,
            "text_value": f"{systolic:g}/{diastolic:g}",
            "value_text": f"{systolic:g}/{diastolic:g}",
            "components": components,
        }
    if value_type in {"number", "duration"}:
        number = _optional_number(value, "value")
        if number is None:
            raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, "value is required")
        minimum = tracker["input_min"]
        maximum = tracker["input_max"]
        if minimum is not None and number < minimum:
            raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, f"value must be at least {minimum:g}")
        if maximum is not None and number > maximum:
            raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, f"value must be at most {maximum:g}")
        value_text = str(value).strip() if isinstance(value, str) else f"{number:g}"
        return {"numeric_value": number, "text_value": None, "value_text": value_text}
    text = _text(value, "value", required=True, maximum=120)
    if value_type in {"choice", "yes_no"}:
        match = next(
            (choice for choice in tracker["choices"] if choice.casefold() == text.casefold()),
            None,
        )
        if match is None:
            raise TrackerError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                f"value must be one of: {', '.join(tracker['choices'])}",
            )
        text = match
    elif value_type == "time" and not TIME_PATTERN.fullmatch(text):
        raise TrackerError(HTTPStatus.UNPROCESSABLE_ENTITY, "value must be HH:MM")
    return {"numeric_value": None, "text_value": text, "value_text": text}


def save_tracker_entry(
    connection: sqlite3.Connection,
    payload: dict[str, Any],
    *,
    source: str,
) -> dict[str, Any]:
    tracker = get_tracker(
        connection,
        tracker_id=payload.get("tracker_id"),
        key=payload.get("tracker_key"),
    )
    if not tracker or not tracker["active"]:
        raise TrackerError(HTTPStatus.NOT_FOUND, "active tracker not found")
    day = _day(payload.get("day"))
    observed_at = _timestamp(payload.get("observed_at"))
    value = _validated_entry_value(tracker, payload.get("value"))
    context = _text(payload.get("context"), "context", maximum=80) or None
    note = _text(payload.get("note"), "note", maximum=2000) or None
    source_text = _text(payload.get("source_text"), "source_text", maximum=2000) or None
    now = utc_now()
    if tracker["frequency"] == "daily":
        occurrence_key = "daily"
        existing_row = connection.execute(
            "SELECT * FROM tracker_entries WHERE tracker_id = ? AND day = ? AND occurrence_key = 'daily'",
            (tracker["id"], day),
        ).fetchone()
    else:
        occurrence_key = str(uuid.uuid4())
        existing_row = None
    before = _row_dict(existing_row) if existing_row else None
    entry_id = before["id"] if before else str(uuid.uuid4())
    if before:
        connection.execute("DELETE FROM tracker_entry_components WHERE entry_id = ?", (entry_id,))
        connection.execute(
            """
            UPDATE tracker_entries SET
                observed_at = ?, numeric_value = ?, text_value = ?, value_text = ?,
                unit = ?, context = ?, note = ?, source = ?, source_text = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                observed_at,
                value["numeric_value"],
                value["text_value"],
                value["value_text"],
                tracker["unit"],
                context,
                note,
                source,
                source_text,
                now,
                entry_id,
            ),
        )
        action = "corrected"
    else:
        connection.execute(
            """
            INSERT INTO tracker_entries(
                id, tracker_id, day, observed_at, occurrence_key, numeric_value,
                text_value, value_text, unit, context, note, source, source_text,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry_id,
                tracker["id"],
                day,
                observed_at,
                occurrence_key,
                value["numeric_value"],
                value["text_value"],
                value["value_text"],
                tracker["unit"],
                context,
                note,
                source,
                source_text,
                now,
                now,
            ),
        )
        action = "created"
    if value.get("components"):
        connection.executemany(
            """
            INSERT INTO tracker_entry_components(
                entry_id, component_key, numeric_value, text_value, unit
            ) VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    entry_id,
                    component["key"],
                    component["numeric_value"],
                    component["text_value"],
                    component["unit"],
                )
                for component in value["components"]
            ],
        )
    row = connection.execute(
        "SELECT * FROM tracker_entries WHERE id = ?", (entry_id,)
    ).fetchone()
    entry = _row_dict(row)
    entry["components"] = _entry_components(connection, entry_id)
    _audit(connection, "entry", entry_id, action, before=before, after=entry, source=source)
    return {**entry, "tracker_key": tracker["key"], "tracker_name": tracker["name"]}


def update_tracker_entry(
    connection: sqlite3.Connection,
    entry_id: str,
    payload: dict[str, Any],
    *,
    source: str = "dashboard",
) -> dict[str, Any]:
    row = connection.execute(
        "SELECT * FROM tracker_entries WHERE id = ?", (entry_id,)
    ).fetchone()
    if not row:
        raise TrackerError(HTTPStatus.NOT_FOUND, "tracker entry not found")
    before = _row_dict(row)
    tracker = get_tracker(connection, tracker_id=before["tracker_id"])
    if not tracker:
        raise TrackerError(HTTPStatus.NOT_FOUND, "tracker not found")
    day = _day(payload.get("day", before["day"]))
    if tracker["frequency"] == "daily" and day != before["day"]:
        conflict = connection.execute(
            "SELECT id FROM tracker_entries WHERE tracker_id = ? AND day = ? AND occurrence_key = 'daily' AND id != ?",
            (tracker["id"], day, entry_id),
        ).fetchone()
        if conflict:
            raise TrackerError(HTTPStatus.CONFLICT, "a reading already exists for that day")
    observed_at = (
        _timestamp(payload.get("observed_at"))
        if "observed_at" in payload
        else before["observed_at"]
    )
    value = _validated_entry_value(tracker, payload.get("value"))
    context = _text(payload.get("context", before["context"]), "context", maximum=80) or None
    note = _text(payload.get("note", before["note"]), "note", maximum=2000) or None
    now = utc_now()
    connection.execute("DELETE FROM tracker_entry_components WHERE entry_id = ?", (entry_id,))
    connection.execute(
        """
        UPDATE tracker_entries SET
            day = ?, observed_at = ?, numeric_value = ?, text_value = ?, value_text = ?,
            unit = ?, context = ?, note = ?, source = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            day,
            observed_at,
            value["numeric_value"],
            value["text_value"],
            value["value_text"],
            tracker["unit"],
            context,
            note,
            source,
            now,
            entry_id,
        ),
    )
    if value.get("components"):
        connection.executemany(
            """
            INSERT INTO tracker_entry_components(
                entry_id, component_key, numeric_value, text_value, unit
            ) VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    entry_id,
                    component["key"],
                    component["numeric_value"],
                    component["text_value"],
                    component["unit"],
                )
                for component in value["components"]
            ],
        )
    updated = _row_dict(
        connection.execute("SELECT * FROM tracker_entries WHERE id = ?", (entry_id,)).fetchone()
    )
    updated["components"] = _entry_components(connection, entry_id)
    _audit(connection, "entry", entry_id, "corrected", before=before, after=updated, source=source)
    return {**updated, "tracker_key": tracker["key"], "tracker_name": tracker["name"]}


def delete_tracker_entry(
    connection: sqlite3.Connection,
    entry_id: str,
    *,
    source: str = "dashboard",
) -> bool:
    row = connection.execute(
        "SELECT * FROM tracker_entries WHERE id = ?", (entry_id,)
    ).fetchone()
    if not row:
        return False
    before = _row_dict(row)
    connection.execute("DELETE FROM tracker_entries WHERE id = ?", (entry_id,))
    _audit(connection, "entry", entry_id, "deleted", before=before, after=None, source=source)
    return True


def list_tracker_data(
    connection: sqlite3.Connection,
    *,
    days: int = 90,
    include_inactive: bool = False,
) -> dict[str, Any]:
    since = (datetime.now(DUBAI).date() - timedelta(days=max(1, days) - 1)).isoformat()
    where = "" if include_inactive else "WHERE active = 1"
    tracker_rows = connection.execute(
        f"SELECT * FROM tracker_definitions {where} ORDER BY display_order, name"
    ).fetchall()
    trackers = [_row_dict(row) for row in tracker_rows]
    by_id = {tracker["id"]: tracker for tracker in trackers}
    for tracker in trackers:
        tracker["entries"] = []
    if by_id:
        placeholders = ",".join("?" for _ in by_id)
        rows = connection.execute(
            f"""
            SELECT * FROM tracker_entries
            WHERE tracker_id IN ({placeholders}) AND day >= ?
            ORDER BY day DESC, COALESCE(observed_at, updated_at) DESC, rowid DESC
            """,
            [*by_id.keys(), since],
        ).fetchall()
        for row in rows:
            entry = _row_dict(row)
            by_id[entry["tracker_id"]]["entries"].append(entry)
        entry_ids = [entry["id"] for tracker in trackers for entry in tracker["entries"]]
        if entry_ids:
            placeholders = ",".join("?" for _ in entry_ids)
            components_by_entry: dict[str, dict[str, dict[str, Any]]] = {}
            for row in connection.execute(
                f"SELECT * FROM tracker_entry_components WHERE entry_id IN ({placeholders})",
                entry_ids,
            ).fetchall():
                components_by_entry.setdefault(row["entry_id"], {})[row["component_key"]] = {
                    "numeric_value": row["numeric_value"],
                    "text_value": row["text_value"],
                    "unit": row["unit"],
                }
            for tracker in trackers:
                for entry in tracker["entries"]:
                    entry["components"] = components_by_entry.get(entry["id"], {})
    return {"trackers": trackers, "days": days, "since": since}


def request_fingerprint(payload: dict[str, Any]) -> str:
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def idempotent_response(
    connection: sqlite3.Connection,
    key: str,
    *,
    operation: str,
    request_hash: str,
) -> dict[str, Any] | None:
    clean_key = _text(key, "idempotency_key", required=True, maximum=120)
    row = connection.execute(
        """
        SELECT operation, request_hash, response_json
        FROM tracker_idempotency
        WHERE idempotency_key = ?
        """,
        (clean_key,),
    ).fetchone()
    if not row:
        return None
    if row["operation"] != operation or (
        row["request_hash"] is not None and row["request_hash"] != request_hash
    ):
        raise TrackerError(
            HTTPStatus.CONFLICT,
            "idempotency key was already used for a different request",
        )
    return json.loads(row["response_json"])


def remember_idempotent_response(
    connection: sqlite3.Connection,
    key: str,
    operation: str,
    request_hash: str,
    response: dict[str, Any],
) -> None:
    clean_key = _text(key, "idempotency_key", required=True, maximum=120)
    connection.execute(
        """
        INSERT OR IGNORE INTO tracker_idempotency(
            idempotency_key, operation, request_hash, response_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (
            clean_key,
            operation,
            request_hash,
            json.dumps(response, separators=(",", ":")),
            utc_now(),
        ),
    )
