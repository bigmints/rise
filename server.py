#!/usr/bin/env python3
"""Rise wellness dashboard and JSON API, implemented with the Python stdlib."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import sqlite3
import sys
import traceback
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from care import (
    CareError,
    create_appointment as care_create_appointment,
    create_medication as care_create_medication,
    create_reminder as care_create_reminder,
    delete_medication_dose as care_delete_medication_dose,
    idempotent_response as care_idempotent_response,
    initialize_care,
    list_care as care_list,
    remember_idempotent_response as care_remember_response,
    request_fingerprint as care_request_fingerprint,
    save_medication_dose as care_save_medication_dose,
    update_appointment as care_update_appointment,
    update_medication as care_update_medication,
    update_reminder as care_update_reminder,
)
from health_records import initialize_health_records, list_health_records
from trackers import (
    TrackerError,
    create_tracker as tracker_create,
    delete_tracker_entry as tracker_entry_delete,
    idempotent_response as tracker_idempotent_response,
    initialize_trackers,
    list_tracker_data,
    remember_idempotent_response as tracker_remember_response,
    request_fingerprint as tracker_request_fingerprint,
    save_tracker_entry as tracker_entry_save,
    update_tracker_entry as tracker_entry_update,
    update_tracker as tracker_update,
)


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
EVENT_KINDS = {"sleep", "fasting", "exercise", "alcohol"}
RESTED_VALUES = {"yes", "somewhat", "no"}
STATUS_VALUES = {
    "fasting_status": {"met", "short", "skipped"},
    "activity_status": {"met", "partial", "skipped"},
}
CHECKIN_FIELDS = {
    "fasting_minutes",
    "fasting_status",
    "activity_minutes",
    "activity_status",
    "weight_kg",
    "bp_systolic",
    "bp_diastolic",
    "pulse_bpm",
    "sleep_minutes",
    "bedtime",
    "wake_time",
    "rested",
    "source",
    "note",
    "source_text",
}
TODAY_ITEM_KEYS = {
    "sleep",
    "rested",
    "bedtime",
    "fasting",
    "activity",
    "weight",
    "blood_pressure",
    "pulse",
}
EDITABLE_FIELDS = {
    "kind",
    "started_at",
    "ended_at",
    "title",
    "quantity",
    "unit",
    "note",
}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class ClosingConnection(sqlite3.Connection):
    """Commit or roll back a context block, then release its file handle."""

    def __exit__(self, exc_type, exc_value, traceback_value):
        try:
            return super().__exit__(exc_type, exc_value, traceback_value)
        finally:
            self.close()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def minutes_between_iso(start: str, end: str) -> int:
    return max(0, round((datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds() / 60))


def quick_choice_integer(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ApiError(HTTPStatus.BAD_REQUEST, "invalid check-in choice") from exc


def parse_timestamp(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} is required")
    candidate = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise ApiError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"{field} must be an ISO 8601 timestamp",
        ) from exc
    if parsed.tzinfo is None:
        raise ApiError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"{field} must include a timezone offset",
        )
    return parsed.isoformat(timespec="seconds")


def optional_text(value: Any, field: str, max_length: int = 2000) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be text")
    result = value.strip()
    if len(result) > max_length:
        raise ApiError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"{field} must be at most {max_length} characters",
        )
    return result or None


def optional_number(value: Any, field: str) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be a number")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be a number") from exc
    if result < 0:
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} cannot be negative")
    return result


def validate_kind(value: Any) -> str:
    if value not in EVENT_KINDS:
        allowed = ", ".join(sorted(EVENT_KINDS))
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, f"kind must be one of: {allowed}")
    return str(value)


def validate_event(payload: dict[str, Any], *, partial: bool = False) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}

    if not partial or "kind" in payload:
        cleaned["kind"] = validate_kind(payload.get("kind"))
    if not partial or "started_at" in payload:
        cleaned["started_at"] = parse_timestamp(payload.get("started_at"), "started_at")

    if "ended_at" in payload:
        cleaned["ended_at"] = (
            parse_timestamp(payload["ended_at"], "ended_at")
            if payload["ended_at"] not in (None, "")
            else None
        )
    elif not partial:
        cleaned["ended_at"] = None

    for field in ("title", "unit", "note", "source", "source_text"):
        if field in payload:
            cleaned[field] = optional_text(payload[field], field)
        elif not partial:
            cleaned[field] = None

    if "quantity" in payload:
        cleaned["quantity"] = optional_number(payload["quantity"], "quantity")
    elif not partial:
        cleaned["quantity"] = None

    start = cleaned.get("started_at")
    end = cleaned.get("ended_at")
    if start and end and datetime.fromisoformat(end) < datetime.fromisoformat(start):
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, "ended_at cannot be before started_at")

    return cleaned


def validate_day(value: Any) -> str:
    if not isinstance(value, str):
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, "day must be YYYY-MM-DD")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, "day must be YYYY-MM-DD") from exc
    return parsed.date().isoformat()


def bounded_number(value: Any, field: str, minimum: float, maximum: float) -> float | None:
    number = optional_number(value, field)
    if number is not None and not minimum <= number <= maximum:
        raise ApiError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"{field} must be between {minimum:g} and {maximum:g}",
        )
    return number


def validate_checkin(payload: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    if "sleep_minutes" in payload:
        value = bounded_number(payload["sleep_minutes"], "sleep_minutes", 0, 1440)
        cleaned["sleep_minutes"] = round(value) if value is not None else None
    if "fasting_minutes" in payload:
        value = bounded_number(payload["fasting_minutes"], "fasting_minutes", 0, 1440)
        cleaned["fasting_minutes"] = round(value) if value is not None else None
    if "activity_minutes" in payload:
        value = bounded_number(payload["activity_minutes"], "activity_minutes", 0, 600)
        cleaned["activity_minutes"] = round(value) if value is not None else None
    if "weight_kg" in payload:
        cleaned["weight_kg"] = bounded_number(payload["weight_kg"], "weight_kg", 20, 500)
    if ("bp_systolic" in payload) != ("bp_diastolic" in payload):
        raise ApiError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "bp_systolic and bp_diastolic must be supplied together",
        )
    if "bp_systolic" in payload:
        systolic = bounded_number(payload["bp_systolic"], "bp_systolic", 40, 300)
        diastolic = bounded_number(payload["bp_diastolic"], "bp_diastolic", 20, 200)
        cleaned["bp_systolic"] = round(systolic) if systolic is not None else None
        cleaned["bp_diastolic"] = round(diastolic) if diastolic is not None else None
    if "pulse_bpm" in payload:
        pulse = bounded_number(payload["pulse_bpm"], "pulse_bpm", 20, 250)
        cleaned["pulse_bpm"] = round(pulse) if pulse is not None else None
    for field in ("bedtime", "wake_time"):
        if field in payload:
            cleaned[field] = (
                parse_timestamp(payload[field], field) if payload[field] not in (None, "") else None
            )
    if "rested" in payload:
        rested = payload["rested"]
        if rested not in RESTED_VALUES and rested is not None:
            raise ApiError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "rested must be yes, somewhat, or no",
            )
        cleaned["rested"] = rested
    for field in ("fasting_status", "activity_status"):
        if field in payload:
            status = payload[field]
            if status not in STATUS_VALUES[field] and status is not None:
                raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, f"invalid {field}")
            cleaned[field] = status
    if "source" in payload:
        cleaned["source"] = optional_text(payload["source"], "source", 40)
    for field in ("note", "source_text"):
        if field in payload:
            cleaned[field] = optional_text(payload[field], field)

    if "fasting_minutes" in cleaned and cleaned.get("fasting_status") is None:
        minutes = cleaned["fasting_minutes"]
        cleaned["fasting_status"] = None if minutes is None else ("met" if minutes >= 1200 else "short")
    if "activity_minutes" in cleaned and cleaned.get("activity_status") is None:
        minutes = cleaned["activity_minutes"]
        cleaned["activity_status"] = None if minutes is None else ("met" if minutes >= 60 else "partial")

    if cleaned.get("fasting_status") == "skipped":
        cleaned["fasting_minutes"] = 0
    if cleaned.get("activity_status") == "skipped":
        cleaned["activity_minutes"] = 0

    if not cleaned:
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, "no check-in fields supplied")
    return cleaned


@dataclass
class Store:
    path: Path

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL CHECK (kind IN ('sleep', 'fasting', 'exercise', 'alcohol')),
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    title TEXT,
                    quantity REAL,
                    unit TEXT,
                    note TEXT,
                    source TEXT,
                    source_text TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS events_started_at_idx ON events(started_at DESC)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS daily_checkins (
                    day TEXT PRIMARY KEY,
                    fasting_minutes INTEGER,
                    fasting_status TEXT,
                    activity_minutes INTEGER,
                activity_status TEXT,
                weight_kg REAL,
                bp_systolic INTEGER,
                bp_diastolic INTEGER,
                pulse_bpm INTEGER,
                sleep_minutes INTEGER,
                    bedtime TEXT,
                    wake_time TEXT,
                    rested TEXT,
                    source TEXT,
                    note TEXT,
                    source_text TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS daily_checkins_day_idx ON daily_checkins(day DESC)"
            )
            existing_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(daily_checkins)")
            }
            for column, column_type in (
                ("bp_systolic", "INTEGER"),
                ("bp_diastolic", "INTEGER"),
                ("pulse_bpm", "INTEGER"),
            ):
                if column not in existing_columns:
                    connection.execute(
                        f"ALTER TABLE daily_checkins ADD COLUMN {column} {column_type}"
                    )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS today_items (
                    key TEXT PRIMARY KEY,
                    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                    updated_at TEXT NOT NULL
                )
                """
            )
            now = utc_now()
            connection.executemany(
                "INSERT OR IGNORE INTO today_items (key, active, updated_at) VALUES (?, 1, ?)",
                [(key, now) for key in sorted(TODAY_ITEM_KEYS)],
            )
            initialize_health_records(connection)
            initialize_trackers(connection)
            initialize_care(connection)

    @staticmethod
    def as_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {key: row[key] for key in row.keys()}

    def list_events(self, *, since: str | None = None, limit: int = 1000) -> list[dict[str, Any]]:
        sql = "SELECT * FROM events"
        params: list[Any] = []
        if since:
            sql += " WHERE started_at >= ?"
            params.append(since)
        sql += " ORDER BY started_at DESC LIMIT ?"
        params.append(limit)
        with self.connect() as connection:
            rows = connection.execute(sql, params).fetchall()
        return [self.as_dict(row) for row in rows]

    def get_event(self, event_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        return self.as_dict(row) if row else None

    def list_checkins(self, *, since_day: str, limit: int = 366) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM daily_checkins WHERE day >= ? ORDER BY day DESC LIMIT ?",
                (since_day, limit),
            ).fetchall()
        return [self.as_dict(row) for row in rows]

    def get_checkin(self, day: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM daily_checkins WHERE day = ?", (validate_day(day),)
            ).fetchone()
            return self.as_dict(row) if row else None

    def list_today_items(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT key, active FROM today_items ORDER BY key"
            ).fetchall()
        return [
            {"key": row["key"], "active": bool(row["active"])} for row in rows
        ]

    def update_today_item(self, key: str, payload: dict[str, Any]) -> dict[str, Any]:
        if key not in TODAY_ITEM_KEYS:
            raise ApiError(HTTPStatus.NOT_FOUND, "Today item not found")
        if set(payload) != {"active"} or not isinstance(payload.get("active"), bool):
            raise ApiError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "active must be true or false",
            )
        with self.connect() as connection:
            connection.execute(
                "UPDATE today_items SET active = ?, updated_at = ? WHERE key = ?",
                (int(payload["active"]), utc_now(), key),
            )
        return {"key": key, "active": payload["active"]}

    def list_health_records(self) -> dict[str, Any]:
        with self.connect() as connection:
            return list_health_records(connection)

    def list_trackers(self, *, days: int, include_inactive: bool = False) -> dict[str, Any]:
        with self.connect() as connection:
            return list_tracker_data(
                connection,
                days=days,
                include_inactive=include_inactive,
            )

    def create_tracker(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.connect() as connection:
            return tracker_create(connection, payload, source="dashboard")

    def update_tracker(self, tracker_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.connect() as connection:
            return tracker_update(connection, tracker_id, payload, source="dashboard")

    def save_tracker_entry(
        self,
        payload: dict[str, Any],
        *,
        source: str,
        idempotency_key: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        operation = "tracker_entry"
        request_hash = tracker_request_fingerprint(payload)
        with self.connect() as connection:
            if idempotency_key:
                existing = tracker_idempotent_response(
                    connection,
                    idempotency_key,
                    operation=operation,
                    request_hash=request_hash,
                )
                if existing is not None:
                    return existing, True
            entry = tracker_entry_save(connection, payload, source=source)
            response = {"entry": entry}
            if idempotency_key:
                tracker_remember_response(
                    connection,
                    idempotency_key,
                    operation,
                    request_hash,
                    response,
                )
            return response, False

    def delete_tracker_entry(self, entry_id: str) -> bool:
        with self.connect() as connection:
            return tracker_entry_delete(connection, entry_id, source="dashboard")

    def update_tracker_entry(
        self, entry_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        with self.connect() as connection:
            return tracker_entry_update(
                connection, entry_id, payload, source="dashboard"
            )

    def list_care(
        self,
        *,
        day: str,
        upcoming_days: int = 90,
        include_inactive: bool = False,
    ) -> dict[str, Any]:
        with self.connect() as connection:
            return care_list(
                connection,
                day=day,
                upcoming_days=upcoming_days,
                include_inactive=include_inactive,
            )

    def create_medication(
        self,
        payload: dict[str, Any],
        *,
        source: str,
        idempotency_key: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        return self._idempotent_care_write(
            "medication",
            payload,
            source=source,
            idempotency_key=idempotency_key,
            response_key="medication",
            writer=care_create_medication,
        )

    def update_medication(
        self,
        medication_id: str,
        payload: dict[str, Any],
        *,
        source: str,
    ) -> dict[str, Any]:
        with self.connect() as connection:
            return care_update_medication(connection, medication_id, payload, source=source)

    def _idempotent_care_write(
        self,
        operation: str,
        payload: dict[str, Any],
        *,
        source: str,
        idempotency_key: str | None,
        response_key: str,
        writer: Any,
    ) -> tuple[dict[str, Any], bool]:
        request_hash = care_request_fingerprint(payload)
        with self.connect() as connection:
            if idempotency_key:
                existing = care_idempotent_response(
                    connection,
                    idempotency_key,
                    operation,
                    request_hash,
                )
                if existing is not None:
                    return existing, True
            item = writer(connection, payload, source=source)
            response = {response_key: item}
            if idempotency_key:
                care_remember_response(
                    connection,
                    idempotency_key,
                    operation,
                    request_hash,
                    response,
                )
            return response, False

    def save_medication_dose(
        self,
        payload: dict[str, Any],
        *,
        source: str,
        idempotency_key: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        return self._idempotent_care_write(
            "medication_dose",
            payload,
            source=source,
            idempotency_key=idempotency_key,
            response_key="dose",
            writer=care_save_medication_dose,
        )

    def delete_medication_dose(self, dose_id: str) -> bool:
        with self.connect() as connection:
            return care_delete_medication_dose(connection, dose_id, source="dashboard")

    def create_appointment(
        self,
        payload: dict[str, Any],
        *,
        source: str,
        idempotency_key: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        return self._idempotent_care_write(
            "appointment",
            payload,
            source=source,
            idempotency_key=idempotency_key,
            response_key="appointment",
            writer=care_create_appointment,
        )

    def update_appointment(
        self,
        appointment_id: str,
        payload: dict[str, Any],
        *,
        source: str,
    ) -> dict[str, Any]:
        with self.connect() as connection:
            return care_update_appointment(connection, appointment_id, payload, source=source)

    def update_appointment_idempotent(
        self,
        appointment_id: str,
        payload: dict[str, Any],
        *,
        source: str,
        idempotency_key: str,
    ) -> tuple[dict[str, Any], bool]:
        return self._idempotent_care_write(
            f"appointment_update:{appointment_id}",
            payload,
            source=source,
            idempotency_key=idempotency_key,
            response_key="appointment",
            writer=lambda connection, body, *, source: care_update_appointment(
                connection, appointment_id, body, source=source
            ),
        )

    def create_reminder(
        self,
        payload: dict[str, Any],
        *,
        source: str,
        idempotency_key: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        return self._idempotent_care_write(
            "reminder",
            payload,
            source=source,
            idempotency_key=idempotency_key,
            response_key="reminder",
            writer=care_create_reminder,
        )

    def update_reminder(
        self,
        reminder_id: str,
        payload: dict[str, Any],
        *,
        source: str,
    ) -> dict[str, Any]:
        with self.connect() as connection:
            return care_update_reminder(connection, reminder_id, payload, source=source)

    def update_reminder_idempotent(
        self,
        reminder_id: str,
        payload: dict[str, Any],
        *,
        source: str,
        idempotency_key: str,
    ) -> tuple[dict[str, Any], bool]:
        return self._idempotent_care_write(
            f"reminder_update:{reminder_id}",
            payload,
            source=source,
            idempotency_key=idempotency_key,
            response_key="reminder",
            writer=lambda connection, body, *, source: care_update_reminder(
                connection, reminder_id, body, source=source
            ),
        )

    def _upsert_checkin(
        self,
        connection: sqlite3.Connection,
        day: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_day = validate_day(day)
        fields = validate_checkin(
            {key: value for key, value in payload.items() if key in CHECKIN_FIELDS}
        )
        now = utc_now()
        columns = ["day", *fields.keys(), "created_at", "updated_at"]
        values = [normalized_day, *fields.values(), now, now]
        updates = ", ".join(f"{field} = excluded.{field}" for field in fields)
        connection.execute(
            f"""
            INSERT INTO daily_checkins ({', '.join(columns)})
            VALUES ({', '.join('?' for _ in columns)})
            ON CONFLICT(day) DO UPDATE SET {updates}, updated_at = excluded.updated_at
            """,
            values,
        )
        row = connection.execute(
            "SELECT * FROM daily_checkins WHERE day = ?", (normalized_day,)
        ).fetchone()
        return self.as_dict(row)

    def upsert_checkin(self, day: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.connect() as connection:
            return self._upsert_checkin(connection, day, payload)

    def upsert_hermes_checkin(
        self,
        day: str,
        payload: dict[str, Any],
        *,
        idempotency_key: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any] | None, bool]:
        """Keep the legacy daily view while preserving each BP observation."""
        systolic = payload.get("bp_systolic")
        diastolic = payload.get("bp_diastolic")
        with self.connect() as connection:
            if systolic is None or diastolic is None:
                return self._upsert_checkin(connection, day, payload), None, False
            tracker_payload = {
                "tracker_key": "blood_pressure",
                "day": validate_day(day),
                "observed_at": payload.get("observed_at"),
                "value": {
                    "systolic": systolic,
                    "diastolic": diastolic,
                    "pulse": payload.get("pulse_bpm"),
                },
                "note": payload.get("note"),
                "source_text": payload.get("source_text"),
            }
            operation = "tracker_entry"
            request_hash = tracker_request_fingerprint(tracker_payload)
            replayed = False
            response = None
            compatibility_key = (
                f"legacy-checkin:{idempotency_key}" if idempotency_key else None
            )
            if compatibility_key:
                response = tracker_idempotent_response(
                    connection,
                    compatibility_key,
                    operation=operation,
                    request_hash=request_hash,
                )
                replayed = response is not None
            if response is None:
                response = {
                    "entry": tracker_entry_save(
                        connection, tracker_payload, source="hermes"
                    )
                }
                if compatibility_key:
                    tracker_remember_response(
                        connection,
                        compatibility_key,
                        operation,
                        request_hash,
                        response,
                    )
            checkin = self._upsert_checkin(connection, day, payload)
            return checkin, response["entry"], replayed

    def _sync_completed_event(self, event: dict[str, Any]) -> None:
        if not event.get("ended_at") or event.get("kind") not in {"sleep", "fasting", "exercise"}:
            return
        minutes = minutes_between_iso(event["started_at"], event["ended_at"])
        day = datetime.fromisoformat(event["ended_at"]).date().isoformat()
        if event["kind"] == "sleep":
            self.upsert_checkin(
                day,
                {
                    "sleep_minutes": minutes,
                    "bedtime": event["started_at"],
                    "wake_time": event["ended_at"],
                    "source": event.get("source") or "event",
                },
            )
        elif event["kind"] == "fasting":
            self.upsert_checkin(
                day,
                {"fasting_minutes": minutes, "source": event.get("source") or "event"},
            )
        elif event["kind"] == "exercise":
            start_day = datetime.fromisoformat(event["started_at"]).date().isoformat()
            with self.connect() as connection:
                rows = connection.execute(
                    """
                    SELECT started_at, ended_at FROM events
                    WHERE kind = 'exercise' AND ended_at IS NOT NULL
                      AND substr(started_at, 1, 10) = ?
                    """,
                    (start_day,),
                ).fetchall()
            total = sum(minutes_between_iso(row["started_at"], row["ended_at"]) for row in rows)
            self.upsert_checkin(
                start_day,
                {"activity_minutes": total, "source": event.get("source") or "event"},
            )

    def create_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        event = validate_event(payload)
        event_id = str(uuid.uuid4())
        now = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO events (
                    id, kind, started_at, ended_at, title, quantity, unit, note,
                    source, source_text, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    event["kind"],
                    event["started_at"],
                    event["ended_at"],
                    event["title"],
                    event["quantity"],
                    event["unit"],
                    event["note"],
                    event["source"],
                    event["source_text"],
                    now,
                    now,
                ),
            )
        created = self.get_event(event_id) or {}
        self._sync_completed_event(created)
        return created

    def update_event(self, event_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        current = self.get_event(event_id)
        if not current:
            raise ApiError(HTTPStatus.NOT_FOUND, "event not found")
        requested = {key: value for key, value in payload.items() if key in EDITABLE_FIELDS}
        if not requested:
            raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, "no editable fields supplied")
        cleaned = validate_event(requested, partial=True)
        merged = {**current, **cleaned}
        validate_event(merged)
        assignments = ", ".join(f"{key} = ?" for key in cleaned)
        values = list(cleaned.values()) + [utc_now(), event_id]
        with self.connect() as connection:
            connection.execute(
                f"UPDATE events SET {assignments}, updated_at = ? WHERE id = ?", values
            )
        updated = self.get_event(event_id) or {}
        self._sync_completed_event(updated)
        return updated

    def close_latest_period(self, kind: str, ended_at: str, source_text: str | None) -> dict[str, Any]:
        if kind not in {"fasting", "sleep"}:
            raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, "only fasting or sleep periods can be closed")
        end = parse_timestamp(ended_at, "ended_at")
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM events
                WHERE kind = ? AND ended_at IS NULL
                ORDER BY started_at DESC LIMIT 1
                """,
                (kind,),
            ).fetchone()
            if not row:
                raise ApiError(HTTPStatus.CONFLICT, f"no open {kind} period was found")
            if datetime.fromisoformat(end) < datetime.fromisoformat(row["started_at"]):
                raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, "period end cannot be before its start")
            combined_source = row["source_text"]
            if source_text:
                combined_source = f"{combined_source}\n{source_text}" if combined_source else source_text
            connection.execute(
                "UPDATE events SET ended_at = ?, source_text = ?, updated_at = ? WHERE id = ?",
                (end, combined_source, utc_now(), row["id"]),
            )
            event_id = row["id"]
        closed = self.get_event(event_id) or {}
        self._sync_completed_event(closed)
        return closed

    def delete_event(self, event_id: str) -> bool:
        with self.connect() as connection:
            cursor = connection.execute("DELETE FROM events WHERE id = ?", (event_id,))
        return cursor.rowcount > 0


class RiseApp:
    def __init__(
        self,
        db_path: Path,
        *,
        hermes_token: str | None = None,
        dashboard_password: str | None = None,
        secure_cookie: bool = False,
        checkin_secret: str | None = None,
    ) -> None:
        self.store = Store(db_path)
        self.store.initialize()
        self.hermes_token = hermes_token
        self.dashboard_password = dashboard_password
        self.secure_cookie = secure_cookie
        self.checkin_secret = checkin_secret

    def session_value(self, expires: int) -> str:
        signature = hmac.new(
            (self.dashboard_password or "").encode(),
            str(expires).encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"{expires}.{signature}"

    def valid_session(self, value: str | None) -> bool:
        if not self.dashboard_password or not value:
            return False
        try:
            expires_text, signature = value.split(".", 1)
            expires = int(expires_text)
        except (ValueError, TypeError):
            return False
        if expires < int(datetime.now(timezone.utc).timestamp()):
            return False
        return hmac.compare_digest(self.session_value(expires), value)

    def apply_quick_checkin(self, query: dict[str, list[str]]) -> tuple[dict[str, Any], str]:
        if not self.checkin_secret:
            raise ApiError(HTTPStatus.SERVICE_UNAVAILABLE, "quick check-ins are not configured")
        required = {key: query.get(key, [""])[0] for key in ("day", "field", "value", "expires", "sig")}
        try:
            expires = int(required["expires"])
        except ValueError as exc:
            raise ApiError(HTTPStatus.BAD_REQUEST, "invalid check-in link") from exc
        now = int(datetime.now(timezone.utc).timestamp())
        if expires < now or expires > now + 172800:
            raise ApiError(HTTPStatus.GONE, "this check-in link has expired")
        message = "|".join(required[key] for key in ("day", "field", "value", "expires"))
        expected = hmac.new(self.checkin_secret.encode(), message.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, required["sig"]):
            raise ApiError(HTTPStatus.UNAUTHORIZED, "invalid check-in link")

        field = required["field"]
        value = required["value"]
        payload: dict[str, Any] = {"source": "telegram"}
        label = "Check-in"
        if field == "rested" and value in RESTED_VALUES:
            payload["rested"] = value
            label = {"yes": "Rested", "somewhat": "Somewhat rested", "no": "Tired"}[value]
        elif field == "sleep_minutes":
            minutes = quick_choice_integer(value)
            payload[field] = minutes
            label = f"Sleep · {minutes / 60:g} hours"
        elif field == "activity":
            if value == "skipped":
                payload.update({"activity_status": "skipped", "activity_minutes": 0})
                label = "Activity · skipped"
            else:
                payload["activity_minutes"] = quick_choice_integer(value)
                label = f"Activity · {value} minutes"
        elif field == "fasting":
            if value == "skipped":
                payload.update({"fasting_status": "skipped", "fasting_minutes": 0})
                label = "Fasting · skipped"
            else:
                minutes = quick_choice_integer(value)
                payload["fasting_minutes"] = minutes
                label = f"Fasting · {minutes / 60:g} hours"
        else:
            raise ApiError(HTTPStatus.BAD_REQUEST, "unsupported check-in choice")
        return self.store.upsert_checkin(required["day"], payload), label

    def handler_class(self) -> type[BaseHTTPRequestHandler]:
        app = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "Rise/1.0"

            def log_message(self, fmt: str, *args: Any) -> None:
                sys.stderr.write(f"{self.log_date_time_string()} {fmt % args}\n")

            def json_response(self, status: int, payload: Any) -> None:
                body = json.dumps(payload, separators=(",", ":")).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(body)

            def quick_response(self, label: str, day: str) -> None:
                body = f"""<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Recorded — Rise</title><style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#101713;color:#edf3ec;font-family:system-ui}}main{{width:min(84vw,420px);padding:32px;border:1px solid #344038;border-radius:24px;background:#1a231e;text-align:center}}b{{display:block;color:#cbe86b;font-size:13px;letter-spacing:.12em;text-transform:uppercase}}h1{{font-family:Georgia,serif;font-weight:400;font-size:34px;margin:14px 0 8px}}p{{color:#92a098;margin:0 0 24px}}a{{display:inline-block;padding:12px 18px;border-radius:12px;background:#cbe86b;color:#172015;text-decoration:none;font-weight:700}}</style></head><body><main><b>Recorded</b><h1>{label}</h1><p>{day}</p><a href=\"/\">Open Rise</a></main></body></html>""".encode()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
                self.end_headers()
                self.wfile.write(body)

            def has_dashboard_auth(self) -> bool:
                if not app.dashboard_password:
                    return True
                expected = "Basic " + base64.b64encode(
                    f"rise:{app.dashboard_password}".encode()
                ).decode()
                if self.headers.get("Authorization") == expected:
                    return True
                cookie = SimpleCookie(self.headers.get("Cookie", ""))
                session = cookie.get("rise_session")
                return app.valid_session(session.value if session else None)

            def require_dashboard_auth(self, *, api: bool = True) -> bool:
                if self.has_dashboard_auth():
                    return True
                if api:
                    self.json_response(HTTPStatus.UNAUTHORIZED, {"error": "sign in required"})
                else:
                    self.send_response(HTTPStatus.SEE_OTHER)
                    self.send_header("Location", "/login")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                return False

            def require_hermes_auth(self) -> bool:
                if not app.hermes_token:
                    self.json_response(
                        HTTPStatus.SERVICE_UNAVAILABLE,
                        {"error": "RISE_HERMES_TOKEN is not configured"},
                    )
                    return False
                if self.headers.get("Authorization") == f"Bearer {app.hermes_token}":
                    return True
                self.json_response(HTTPStatus.UNAUTHORIZED, {"error": "invalid Hermes token"})
                return False

            def read_json(self) -> dict[str, Any]:
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError as exc:
                    raise ApiError(HTTPStatus.BAD_REQUEST, "invalid Content-Length") from exc
                if length <= 0 or length > 100_000:
                    raise ApiError(HTTPStatus.BAD_REQUEST, "request body is missing or too large")
                try:
                    payload = json.loads(self.rfile.read(length))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise ApiError(HTTPStatus.BAD_REQUEST, "request body must be valid JSON") from exc
                if not isinstance(payload, dict):
                    raise ApiError(HTTPStatus.BAD_REQUEST, "request body must be a JSON object")
                return payload

            def route(self) -> tuple[str, dict[str, list[str]]]:
                parsed = urlparse(self.path)
                return parsed.path, parse_qs(parsed.query)

            def do_GET(self) -> None:
                try:
                    path, query = self.route()
                    if path == "/api/health":
                        self.json_response(HTTPStatus.OK, {"status": "ok"})
                        return
                    if path == "/quick-checkin":
                        checkin, label = app.apply_quick_checkin(query)
                        self.quick_response(label, checkin["day"])
                        return
                    if path == "/api/hermes/trackers":
                        if not self.require_hermes_auth():
                            return
                        tracker_data = app.store.list_trackers(days=1)
                        definitions = [
                            {
                                key: value
                                for key, value in tracker.items()
                                if key != "entries"
                            }
                            for tracker in tracker_data["trackers"]
                        ]
                        self.json_response(HTTPStatus.OK, {"trackers": definitions})
                        return
                    if path == "/api/hermes/care":
                        if not self.require_hermes_auth():
                            return
                        day = query.get(
                            "day", [datetime.now().astimezone().date().isoformat()]
                        )[0]
                        self.json_response(
                            HTTPStatus.OK,
                            app.store.list_care(
                                day=day,
                                upcoming_days=365,
                                include_inactive=False,
                            ),
                        )
                        return
                    if path.startswith("/api/"):
                        if not self.require_dashboard_auth():
                            return
                        if path == "/api/events":
                            days_raw = query.get("days", ["30"])[0]
                            try:
                                days = max(1, min(3650, int(days_raw)))
                            except ValueError as exc:
                                raise ApiError(
                                    HTTPStatus.BAD_REQUEST, "days must be a number"
                                ) from exc
                            since = (
                                datetime.now(timezone.utc) - timedelta(days=days + 1)
                            ).isoformat(timespec="seconds")
                            events = app.store.list_events(since=since)
                            self.json_response(
                                HTTPStatus.OK, {"events": events, "days": days}
                            )
                            return
                        if path == "/api/checkins":
                            days_raw = query.get("days", ["30"])[0]
                            try:
                                days = max(1, min(3650, int(days_raw)))
                            except ValueError as exc:
                                raise ApiError(
                                    HTTPStatus.BAD_REQUEST, "days must be a number"
                                ) from exc
                            since_day = (
                                datetime.now(timezone.utc) - timedelta(days=days + 1)
                            ).date().isoformat()
                            self.json_response(
                                HTTPStatus.OK,
                                {
                                    "checkins": app.store.list_checkins(
                                        since_day=since_day
                                    ),
                                    "days": days,
                                },
                            )
                            return
                        if path == "/api/today-items":
                            self.json_response(
                                HTTPStatus.OK,
                                {"items": app.store.list_today_items()},
                            )
                            return
                        if path == "/api/health-records":
                            self.json_response(
                                HTTPStatus.OK, app.store.list_health_records()
                            )
                            return
                        if path == "/api/care":
                            day = query.get(
                                "day", [datetime.now().astimezone().date().isoformat()]
                            )[0]
                            upcoming_raw = query.get("upcoming_days", ["90"])[0]
                            try:
                                upcoming_days = max(1, min(3650, int(upcoming_raw)))
                            except ValueError as exc:
                                raise ApiError(
                                    HTTPStatus.BAD_REQUEST,
                                    "upcoming_days must be a number",
                                ) from exc
                            include_inactive = (
                                query.get("include_inactive", ["0"])[0] == "1"
                            )
                            self.json_response(
                                HTTPStatus.OK,
                                app.store.list_care(
                                    day=day,
                                    upcoming_days=upcoming_days,
                                    include_inactive=include_inactive,
                                ),
                            )
                            return
                        if path == "/api/trackers":
                            days_raw = query.get("days", ["90"])[0]
                            try:
                                days = max(1, min(3650, int(days_raw)))
                            except ValueError as exc:
                                raise ApiError(
                                    HTTPStatus.BAD_REQUEST, "days must be a number"
                                ) from exc
                            include_inactive = (
                                query.get("include_inactive", ["0"])[0] == "1"
                            )
                            self.json_response(
                                HTTPStatus.OK,
                                app.store.list_trackers(
                                    days=days, include_inactive=include_inactive
                                ),
                            )
                            return
                        raise ApiError(HTTPStatus.NOT_FOUND, "not found")
                    if path == "/login":
                        if self.has_dashboard_auth():
                            self.send_response(HTTPStatus.SEE_OTHER)
                            self.send_header("Location", "/")
                            self.send_header("Content-Length", "0")
                            self.end_headers()
                        else:
                            self.serve_static("/login.html")
                        return
                    if path.startswith("/assets/") or path in {
                        "/styles.css",
                        "/app.js",
                        "/login.js",
                        "/pwa.js",
                        "/service-worker.js",
                        "/manifest.webmanifest",
                        "/icon-192.png",
                        "/icon-512.png",
                    }:
                        self.serve_static(path)
                        return
                    if not self.require_dashboard_auth(api=False):
                        return
                    self.serve_static(path)
                except (ApiError, TrackerError, CareError) as exc:
                    self.json_response(exc.status, {"error": exc.message})
                except Exception:
                    traceback.print_exc()
                    self.json_response(
                        HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal error"}
                    )

            def do_POST(self) -> None:
                try:
                    path, _ = self.route()
                    if path == "/api/session":
                        if not app.dashboard_password:
                            self.json_response(HTTPStatus.OK, {"status": "not_required"})
                            return
                        payload = self.read_json()
                        supplied = payload.get("password")
                        if not isinstance(supplied, str) or not hmac.compare_digest(
                            supplied, app.dashboard_password
                        ):
                            self.json_response(HTTPStatus.UNAUTHORIZED, {"error": "incorrect password"})
                            return
                        expires = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
                        attributes = [
                            f"rise_session={app.session_value(expires)}",
                            "Path=/",
                            "HttpOnly",
                            "SameSite=Strict",
                            "Max-Age=2592000",
                        ]
                        if app.secure_cookie:
                            attributes.append("Secure")
                        self.send_response(HTTPStatus.NO_CONTENT)
                        self.send_header("Set-Cookie", "; ".join(attributes))
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                    if path == "/api/hermes/events":
                        if not self.require_hermes_auth():
                            return
                        payload = self.read_json()
                        operation = payload.pop("operation", "record")
                        if operation == "record":
                            payload["source"] = "hermes"
                            event = app.store.create_event(payload)
                        elif operation == "close_period":
                            event = app.store.close_latest_period(
                                validate_kind(payload.get("kind")),
                                payload.get("ended_at"),
                                optional_text(payload.get("source_text"), "source_text"),
                            )
                        else:
                            raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, "unknown operation")
                        self.json_response(HTTPStatus.CREATED, {"event": event})
                        return
                    if path == "/api/hermes/checkins":
                        if not self.require_hermes_auth():
                            return
                        payload = self.read_json()
                        day = payload.pop("day", None)
                        payload["source"] = "hermes"
                        idempotency_key = payload.pop(
                            "idempotency_key", None
                        ) or self.headers.get("Idempotency-Key")
                        checkin, tracker_entry, replayed = app.store.upsert_hermes_checkin(
                            day,
                            payload,
                            idempotency_key=idempotency_key,
                        )
                        self.json_response(
                            HTTPStatus.OK if replayed else HTTPStatus.CREATED,
                            {
                                "checkin": checkin,
                                "tracker_entry": tracker_entry,
                                "replayed": replayed,
                            },
                        )
                        return
                    if path == "/api/hermes/tracker-entries":
                        if not self.require_hermes_auth():
                            return
                        payload = self.read_json()
                        idempotency_key = payload.pop("idempotency_key", None) or self.headers.get(
                            "Idempotency-Key"
                        )
                        response, replayed = app.store.save_tracker_entry(
                            payload,
                            source="hermes",
                            idempotency_key=idempotency_key,
                        )
                        self.json_response(
                            HTTPStatus.OK if replayed else HTTPStatus.CREATED,
                            {**response, "replayed": replayed},
                        )
                        return
                    if path in {
                        "/api/hermes/medications",
                        "/api/hermes/medication-doses",
                        "/api/hermes/appointments",
                        "/api/hermes/reminders",
                    }:
                        if not self.require_hermes_auth():
                            return
                        payload = self.read_json()
                        idempotency_key = payload.pop(
                            "idempotency_key", None
                        ) or self.headers.get("Idempotency-Key")
                        if not idempotency_key:
                            raise CareError(
                                HTTPStatus.UNPROCESSABLE_ENTITY,
                                "idempotency_key is required",
                            )
                        if path == "/api/hermes/medications":
                            response, replayed = app.store.create_medication(
                                payload,
                                source="hermes",
                                idempotency_key=idempotency_key,
                            )
                        elif path == "/api/hermes/medication-doses":
                            response, replayed = app.store.save_medication_dose(
                                payload,
                                source="hermes",
                                idempotency_key=idempotency_key,
                            )
                        elif path == "/api/hermes/appointments":
                            response, replayed = app.store.create_appointment(
                                payload,
                                source="hermes",
                                idempotency_key=idempotency_key,
                            )
                        else:
                            response, replayed = app.store.create_reminder(
                                payload,
                                source="hermes",
                                idempotency_key=idempotency_key,
                            )
                        self.json_response(
                            HTTPStatus.OK if replayed else HTTPStatus.CREATED,
                            {**response, "replayed": replayed},
                        )
                        return
                    if path == "/api/events":
                        if not self.require_dashboard_auth():
                            return
                        event = app.store.create_event(self.read_json())
                        self.json_response(HTTPStatus.CREATED, {"event": event})
                        return
                    if path == "/api/trackers":
                        if not self.require_dashboard_auth():
                            return
                        tracker = app.store.create_tracker(self.read_json())
                        self.json_response(HTTPStatus.CREATED, {"tracker": tracker})
                        return
                    if path == "/api/tracker-entries":
                        if not self.require_dashboard_auth():
                            return
                        response, _ = app.store.save_tracker_entry(
                            self.read_json(),
                            source="dashboard",
                        )
                        self.json_response(HTTPStatus.CREATED, response)
                        return
                    if path == "/api/medications":
                        if not self.require_dashboard_auth():
                            return
                        response, _ = app.store.create_medication(
                            self.read_json(), source="dashboard"
                        )
                        self.json_response(HTTPStatus.CREATED, response)
                        return
                    if path == "/api/medication-doses":
                        if not self.require_dashboard_auth():
                            return
                        response, _ = app.store.save_medication_dose(
                            self.read_json(), source="dashboard"
                        )
                        self.json_response(HTTPStatus.CREATED, response)
                        return
                    if path == "/api/appointments":
                        if not self.require_dashboard_auth():
                            return
                        response, _ = app.store.create_appointment(
                            self.read_json(), source="dashboard"
                        )
                        self.json_response(HTTPStatus.CREATED, response)
                        return
                    if path == "/api/reminders":
                        if not self.require_dashboard_auth():
                            return
                        response, _ = app.store.create_reminder(
                            self.read_json(), source="dashboard"
                        )
                        self.json_response(HTTPStatus.CREATED, response)
                        return
                    raise ApiError(HTTPStatus.NOT_FOUND, "not found")
                except (ApiError, TrackerError, CareError) as exc:
                    self.json_response(exc.status, {"error": exc.message})

            def do_PATCH(self) -> None:
                try:
                    path, _ = self.route()
                    hermes_appointment_prefix = "/api/hermes/appointments/"
                    hermes_reminder_prefix = "/api/hermes/reminders/"
                    if path.startswith(hermes_appointment_prefix) or path.startswith(
                        hermes_reminder_prefix
                    ):
                        if not self.require_hermes_auth():
                            return
                        payload = self.read_json()
                        idempotency_key = payload.pop("idempotency_key", None) or self.headers.get(
                            "Idempotency-Key"
                        )
                        if not idempotency_key:
                            raise CareError(
                                HTTPStatus.UNPROCESSABLE_ENTITY,
                                "idempotency_key is required",
                            )
                        if path.startswith(hermes_appointment_prefix):
                            response, replayed = app.store.update_appointment_idempotent(
                                path[len(hermes_appointment_prefix) :],
                                payload,
                                source="hermes",
                                idempotency_key=idempotency_key,
                            )
                        else:
                            response, replayed = app.store.update_reminder_idempotent(
                                path[len(hermes_reminder_prefix) :],
                                payload,
                                source="hermes",
                                idempotency_key=idempotency_key,
                            )
                        self.json_response(
                            HTTPStatus.OK,
                            {**response, "replayed": replayed},
                        )
                        return
                    if not self.require_dashboard_auth():
                        return
                    event_prefix = "/api/events/"
                    tracker_entry_prefix = "/api/tracker-entries/"
                    tracker_prefix = "/api/trackers/"
                    today_item_prefix = "/api/today-items/"
                    medication_prefix = "/api/medications/"
                    appointment_prefix = "/api/appointments/"
                    reminder_prefix = "/api/reminders/"
                    if path.startswith(event_prefix):
                        event_id = path[len(event_prefix) :]
                        event = app.store.update_event(event_id, self.read_json())
                        self.json_response(HTTPStatus.OK, {"event": event})
                        return
                    if path.startswith(tracker_entry_prefix):
                        entry = app.store.update_tracker_entry(
                            path[len(tracker_entry_prefix) :], self.read_json()
                        )
                        self.json_response(HTTPStatus.OK, {"entry": entry})
                        return
                    if path.startswith(tracker_prefix):
                        tracker = app.store.update_tracker(
                            path[len(tracker_prefix) :], self.read_json()
                        )
                        self.json_response(HTTPStatus.OK, {"tracker": tracker})
                        return
                    if path.startswith(today_item_prefix):
                        key = path.removeprefix(today_item_prefix)
                        item = app.store.update_today_item(key, self.read_json())
                        self.json_response(HTTPStatus.OK, {"item": item})
                        return
                    if path.startswith(medication_prefix):
                        medication = app.store.update_medication(
                            path[len(medication_prefix) :],
                            self.read_json(),
                            source="dashboard",
                        )
                        self.json_response(HTTPStatus.OK, {"medication": medication})
                        return
                    if path.startswith(appointment_prefix):
                        appointment = app.store.update_appointment(
                            path[len(appointment_prefix) :],
                            self.read_json(),
                            source="dashboard",
                        )
                        self.json_response(HTTPStatus.OK, {"appointment": appointment})
                        return
                    if path.startswith(reminder_prefix):
                        reminder = app.store.update_reminder(
                            path[len(reminder_prefix) :],
                            self.read_json(),
                            source="dashboard",
                        )
                        self.json_response(HTTPStatus.OK, {"reminder": reminder})
                        return
                    raise ApiError(HTTPStatus.NOT_FOUND, "not found")
                except (ApiError, TrackerError, CareError) as exc:
                    self.json_response(exc.status, {"error": exc.message})

            def do_PUT(self) -> None:
                try:
                    path, _ = self.route()
                    if not self.require_dashboard_auth():
                        return
                    prefix = "/api/checkins/"
                    if not path.startswith(prefix):
                        raise ApiError(HTTPStatus.NOT_FOUND, "not found")
                    payload = self.read_json()
                    payload["source"] = payload.get("source") or "dashboard"
                    checkin = app.store.upsert_checkin(path[len(prefix) :], payload)
                    self.json_response(HTTPStatus.OK, {"checkin": checkin})
                except (ApiError, TrackerError, CareError) as exc:
                    self.json_response(exc.status, {"error": exc.message})

            def do_DELETE(self) -> None:
                try:
                    path, _ = self.route()
                    if not self.require_dashboard_auth():
                        return
                    event_prefix = "/api/events/"
                    tracker_entry_prefix = "/api/tracker-entries/"
                    medication_dose_prefix = "/api/medication-doses/"
                    if path.startswith(event_prefix):
                        if not app.store.delete_event(path[len(event_prefix) :]):
                            raise ApiError(HTTPStatus.NOT_FOUND, "event not found")
                    elif path.startswith(tracker_entry_prefix):
                        if not app.store.delete_tracker_entry(path[len(tracker_entry_prefix) :]):
                            raise ApiError(HTTPStatus.NOT_FOUND, "tracker entry not found")
                    elif path.startswith(medication_dose_prefix):
                        if not app.store.delete_medication_dose(
                            path[len(medication_dose_prefix) :]
                        ):
                            raise ApiError(HTTPStatus.NOT_FOUND, "medication dose not found")
                    else:
                        raise ApiError(HTTPStatus.NOT_FOUND, "not found")
                    self.send_response(HTTPStatus.NO_CONTENT)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                except (ApiError, TrackerError, CareError) as exc:
                    self.json_response(exc.status, {"error": exc.message})

            def serve_static(self, request_path: str) -> None:
                relative = "index.html" if request_path in {"", "/"} else request_path.lstrip("/")
                candidate = (STATIC_DIR / relative).resolve()
                if STATIC_DIR.resolve() not in candidate.parents and candidate != STATIC_DIR.resolve():
                    raise ApiError(HTTPStatus.NOT_FOUND, "not found")
                if not candidate.is_file():
                    candidate = STATIC_DIR / "index.html"
                body = candidate.read_bytes()
                mime, _ = mimetypes.guess_type(candidate.name)
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", f"{mime or 'application/octet-stream'}; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Referrer-Policy", "no-referrer")
                if candidate.suffix == ".html" or candidate.name == "service-worker.js":
                    self.send_header(
                        "Cache-Control", "no-cache, no-store, must-revalidate"
                    )
                elif relative.startswith("assets/"):
                    self.send_header(
                        "Cache-Control", "public, max-age=31536000, immutable"
                    )
                else:
                    self.send_header("Cache-Control", "no-cache")
                self.send_header(
                    "Content-Security-Policy",
                    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
                )
                self.end_headers()
                self.wfile.write(body)

        return Handler


def build_app() -> RiseApp:
    db_path = Path(os.environ.get("RISE_DB_PATH", str(ROOT / "data" / "rise.db")))
    return RiseApp(
        db_path,
        hermes_token=os.environ.get("RISE_HERMES_TOKEN"),
        dashboard_password=os.environ.get("RISE_DASHBOARD_PASSWORD"),
        secure_cookie=os.environ.get("RISE_SECURE_COOKIE", "0") == "1",
        checkin_secret=os.environ.get("RISE_CHECKIN_SECRET"),
    )


def main() -> None:
    host = os.environ.get("RISE_HOST", "0.0.0.0")
    port = int(os.environ.get("RISE_PORT", "8787"))
    app = build_app()
    server = ThreadingHTTPServer((host, port), app.handler_class())
    print(f"Rise is listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
