"""Medication, appointment, and follow-up reminder persistence for Rise."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from typing import Any


MEDICATION_SCHEDULES = {"daily", "specific_days", "as_needed"}
DOSE_STATUSES = {"taken", "skipped"}
APPOINTMENT_STATUSES = {"scheduled", "completed", "cancelled"}
REMINDER_STATUSES = {"pending", "done", "dismissed"}


class CareError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _text(value: Any, field: str, *, required: bool = False, maximum: int = 2000) -> str | None:
    if value is None:
        if required:
            raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} is required")
        return None
    if not isinstance(value, str):
        raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be text")
    result = value.strip()
    if required and not result:
        raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} is required")
    if len(result) > maximum:
        raise CareError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"{field} must be at most {maximum} characters",
        )
    return result or None


def _day(value: Any, field: str = "day") -> str:
    if not isinstance(value, str):
        raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be YYYY-MM-DD")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be YYYY-MM-DD") from exc


def _timestamp(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} is required")
    candidate = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise CareError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"{field} must be an ISO 8601 timestamp",
        ) from exc
    if parsed.tzinfo is None:
        raise CareError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"{field} must include a timezone offset",
        )
    return parsed.isoformat(timespec="seconds")


def _time(value: Any, field: str = "time") -> str:
    if not isinstance(value, str):
        raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be HH:MM")
    try:
        parsed = datetime.strptime(value.strip(), "%H:%M")
    except ValueError as exc:
        raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be HH:MM") from exc
    return parsed.strftime("%H:%M")


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def _json_list(value: Any, field: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{field} must be a list")
    return value


def initialize_care(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS care_schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS medications (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            strength TEXT,
            instructions TEXT,
            schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('daily', 'specific_days', 'as_needed')),
            schedule_times_json TEXT NOT NULL DEFAULT '[]',
            schedule_days_json TEXT NOT NULL DEFAULT '[]',
            start_date TEXT NOT NULL,
            end_date TEXT,
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            note TEXT,
            source TEXT,
            source_text TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS medications_active_idx
            ON medications(active, start_date, name);

        CREATE TABLE IF NOT EXISTS medication_doses (
            id TEXT PRIMARY KEY,
            medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE RESTRICT,
            day TEXT NOT NULL,
            scheduled_time TEXT,
            slot_key TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('taken', 'skipped')),
            dose_text TEXT,
            note TEXT,
            source TEXT,
            source_text TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (medication_id, day, slot_key)
        );
        CREATE INDEX IF NOT EXISTS medication_doses_day_idx
            ON medication_doses(day DESC, observed_at DESC);

        CREATE TABLE IF NOT EXISTS appointments (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            provider TEXT,
            location TEXT,
            starts_at TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled')),
            note TEXT,
            source TEXT,
            source_text TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS appointments_starts_idx
            ON appointments(status, starts_at);

        CREATE TABLE IF NOT EXISTS follow_up_reminders (
            id TEXT PRIMARY KEY,
            appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
            title TEXT NOT NULL,
            due_at TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'dismissed')),
            note TEXT,
            source TEXT,
            source_text TEXT,
            completed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS follow_up_reminders_due_idx
            ON follow_up_reminders(status, due_at);

        CREATE TABLE IF NOT EXISTS care_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            action TEXT NOT NULL,
            before_json TEXT,
            after_json TEXT,
            source TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS care_audit_entity_idx
            ON care_audit_log(entity_type, entity_id, id DESC);

        CREATE TABLE IF NOT EXISTS care_idempotency (
            key TEXT PRIMARY KEY,
            operation TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            response_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    connection.execute(
        "INSERT OR IGNORE INTO care_schema_migrations(version, applied_at) VALUES (1, ?)",
        (utc_now(),),
    )


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
        INSERT INTO care_audit_log(
            entity_type, entity_id, action, before_json, after_json, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            entity_type,
            entity_id,
            action,
            json.dumps(before, sort_keys=True) if before is not None else None,
            json.dumps(after, sort_keys=True) if after is not None else None,
            source,
            utc_now(),
        ),
    )


def request_fingerprint(payload: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def idempotent_response(
    connection: sqlite3.Connection,
    key: str,
    operation: str,
    request_hash: str,
) -> dict[str, Any] | None:
    row = connection.execute(
        "SELECT operation, request_hash, response_json FROM care_idempotency WHERE key = ?",
        (key,),
    ).fetchone()
    if row is None:
        return None
    if row["operation"] != operation or row["request_hash"] != request_hash:
        raise CareError(
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
    connection.execute(
        """
        INSERT INTO care_idempotency(key, operation, request_hash, response_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (key, operation, request_hash, json.dumps(response, sort_keys=True), utc_now()),
    )


def _medication_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    item = _row(row)
    if item is None:
        return None
    item["active"] = bool(item["active"])
    item["schedule_times"] = json.loads(item.pop("schedule_times_json"))
    item["schedule_days"] = json.loads(item.pop("schedule_days_json"))
    return item


def get_medication(connection: sqlite3.Connection, medication_id: str) -> dict[str, Any] | None:
    return _medication_dict(
        connection.execute("SELECT * FROM medications WHERE id = ?", (medication_id,)).fetchone()
    )


def _validate_medication(payload: dict[str, Any]) -> dict[str, Any]:
    name = _text(payload.get("name"), "name", required=True, maximum=120)
    schedule_kind = payload.get("schedule_kind")
    if schedule_kind not in MEDICATION_SCHEDULES:
        raise CareError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "schedule_kind must be daily, specific_days, or as_needed",
        )
    raw_times = _json_list(payload.get("schedule_times"), "schedule_times")
    schedule_times = sorted({_time(value, "schedule_times") for value in raw_times})
    raw_days = _json_list(payload.get("schedule_days"), "schedule_days")
    if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 6 for value in raw_days):
        raise CareError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "schedule_days must contain weekday numbers from 0 to 6",
        )
    schedule_days = sorted(set(raw_days))
    if schedule_kind != "as_needed" and not schedule_times:
        raise CareError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "at least one schedule time is required",
        )
    if schedule_kind == "specific_days" and not schedule_days:
        raise CareError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "at least one schedule day is required",
        )
    if schedule_kind != "specific_days":
        schedule_days = []
    if schedule_kind == "as_needed":
        schedule_times = []
    start_date = _day(payload.get("start_date"), "start_date")
    end_date = _day(payload["end_date"], "end_date") if payload.get("end_date") else None
    if end_date and end_date < start_date:
        raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, "end_date cannot be before start_date")
    active = payload.get("active", True)
    if not isinstance(active, bool):
        raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, "active must be true or false")
    return {
        "name": name,
        "strength": _text(payload.get("strength"), "strength", maximum=80),
        "instructions": _text(payload.get("instructions"), "instructions", maximum=500),
        "schedule_kind": schedule_kind,
        "schedule_times_json": json.dumps(schedule_times, separators=(",", ":")),
        "schedule_days_json": json.dumps(schedule_days, separators=(",", ":")),
        "start_date": start_date,
        "end_date": end_date,
        "active": 1 if active else 0,
        "note": _text(payload.get("note"), "note"),
        "source": _text(payload.get("source"), "source", maximum=40),
        "source_text": _text(payload.get("source_text"), "source_text"),
    }


def create_medication(
    connection: sqlite3.Connection,
    payload: dict[str, Any],
    *,
    source: str,
) -> dict[str, Any]:
    cleaned = _validate_medication({**payload, "source": payload.get("source") or source})
    medication_id = str(uuid.uuid4())
    now = utc_now()
    columns = ["id", *cleaned.keys(), "created_at", "updated_at"]
    connection.execute(
        f"INSERT INTO medications({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
        [medication_id, *cleaned.values(), now, now],
    )
    created = get_medication(connection, medication_id) or {}
    _audit(connection, "medication", medication_id, "created", before=None, after=created, source=source)
    return created


def update_medication(
    connection: sqlite3.Connection,
    medication_id: str,
    payload: dict[str, Any],
    *,
    source: str,
) -> dict[str, Any]:
    current = get_medication(connection, medication_id)
    if not current:
        raise CareError(HTTPStatus.NOT_FOUND, "medication not found")
    merged = {
        key: current.get(key)
        for key in (
            "name", "strength", "instructions", "schedule_kind", "schedule_times",
            "schedule_days", "start_date", "end_date", "active", "note", "source", "source_text",
        )
    }
    merged.update(payload)
    cleaned = _validate_medication(merged)
    assignments = ", ".join(f"{key} = ?" for key in cleaned)
    connection.execute(
        f"UPDATE medications SET {assignments}, updated_at = ? WHERE id = ?",
        [*cleaned.values(), utc_now(), medication_id],
    )
    updated = get_medication(connection, medication_id) or {}
    _audit(connection, "medication", medication_id, "updated", before=current, after=updated, source=source)
    return updated


def _dose_dict(connection: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    medication = connection.execute(
        "SELECT name, strength FROM medications WHERE id = ?",
        (item["medication_id"],),
    ).fetchone()
    item["medication_name"] = medication["name"] if medication else "Medication"
    item["medication_strength"] = medication["strength"] if medication else None
    return item


def save_medication_dose(
    connection: sqlite3.Connection,
    payload: dict[str, Any],
    *,
    source: str,
) -> dict[str, Any]:
    medication_id = _text(payload.get("medication_id"), "medication_id", required=True, maximum=80)
    medication = get_medication(connection, medication_id or "")
    if not medication:
        raise CareError(HTTPStatus.NOT_FOUND, "medication not found")
    day = _day(payload.get("day"))
    scheduled_time = _time(payload["scheduled_time"], "scheduled_time") if payload.get("scheduled_time") else None
    status = payload.get("status")
    if status not in DOSE_STATUSES:
        raise CareError(HTTPStatus.UNPROCESSABLE_ENTITY, "status must be taken or skipped")
    observed_at = _timestamp(payload.get("observed_at"), "observed_at")
    slot_key = scheduled_time or str(uuid.uuid4())
    existing = connection.execute(
        """
        SELECT * FROM medication_doses
        WHERE medication_id = ? AND day = ? AND slot_key = ?
        """,
        (medication_id, day, slot_key),
    ).fetchone()
    now = utc_now()
    values = {
        "observed_at": observed_at,
        "status": status,
        "dose_text": _text(payload.get("dose_text"), "dose_text", maximum=120),
        "note": _text(payload.get("note"), "note"),
        "source": _text(payload.get("source"), "source", maximum=40) or source,
        "source_text": _text(payload.get("source_text"), "source_text"),
    }
    if existing:
        before = _dose_dict(connection, existing)
        connection.execute(
            """
            UPDATE medication_doses
            SET observed_at = ?, status = ?, dose_text = ?, note = ?, source = ?,
                source_text = ?, updated_at = ?
            WHERE id = ?
            """,
            [*values.values(), now, existing["id"]],
        )
        dose_id = existing["id"]
        action = "corrected"
    else:
        before = None
        dose_id = str(uuid.uuid4())
        connection.execute(
            """
            INSERT INTO medication_doses(
                id, medication_id, day, scheduled_time, slot_key, observed_at, status,
                dose_text, note, source, source_text, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dose_id,
                medication_id,
                day,
                scheduled_time,
                slot_key,
                observed_at,
                status,
                values["dose_text"],
                values["note"],
                values["source"],
                values["source_text"],
                now,
                now,
            ),
        )
        action = "recorded"
    saved_row = connection.execute("SELECT * FROM medication_doses WHERE id = ?", (dose_id,)).fetchone()
    saved = _dose_dict(connection, saved_row)
    _audit(connection, "medication_dose", dose_id, action, before=before, after=saved, source=source)
    return saved


def delete_medication_dose(connection: sqlite3.Connection, dose_id: str, *, source: str) -> bool:
    row = connection.execute("SELECT * FROM medication_doses WHERE id = ?", (dose_id,)).fetchone()
    if not row:
        return False
    before = _dose_dict(connection, row)
    connection.execute("DELETE FROM medication_doses WHERE id = ?", (dose_id,))
    _audit(connection, "medication_dose", dose_id, "deleted", before=before, after=None, source=source)
    return True


def _validate_appointment(payload: dict[str, Any]) -> dict[str, Any]:
    status = payload.get("status", "scheduled")
    if status not in APPOINTMENT_STATUSES:
        raise CareError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "status must be scheduled, completed, or cancelled",
        )
    return {
        "title": _text(payload.get("title"), "title", required=True, maximum=160),
        "provider": _text(payload.get("provider"), "provider", maximum=160),
        "location": _text(payload.get("location"), "location", maximum=300),
        "starts_at": _timestamp(payload.get("starts_at"), "starts_at"),
        "status": status,
        "note": _text(payload.get("note"), "note"),
        "source": _text(payload.get("source"), "source", maximum=40),
        "source_text": _text(payload.get("source_text"), "source_text"),
    }


def _get_appointment(connection: sqlite3.Connection, appointment_id: str) -> dict[str, Any] | None:
    return _row(connection.execute("SELECT * FROM appointments WHERE id = ?", (appointment_id,)).fetchone())


def create_appointment(connection: sqlite3.Connection, payload: dict[str, Any], *, source: str) -> dict[str, Any]:
    cleaned = _validate_appointment({**payload, "source": payload.get("source") or source})
    appointment_id = str(uuid.uuid4())
    now = utc_now()
    columns = ["id", *cleaned.keys(), "created_at", "updated_at"]
    connection.execute(
        f"INSERT INTO appointments({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
        [appointment_id, *cleaned.values(), now, now],
    )
    created = _get_appointment(connection, appointment_id) or {}
    _audit(connection, "appointment", appointment_id, "created", before=None, after=created, source=source)
    return created


def update_appointment(
    connection: sqlite3.Connection,
    appointment_id: str,
    payload: dict[str, Any],
    *,
    source: str,
) -> dict[str, Any]:
    current = _get_appointment(connection, appointment_id)
    if not current:
        raise CareError(HTTPStatus.NOT_FOUND, "appointment not found")
    merged = {key: current.get(key) for key in (
        "title", "provider", "location", "starts_at", "status", "note", "source", "source_text"
    )}
    merged.update(payload)
    cleaned = _validate_appointment(merged)
    connection.execute(
        f"UPDATE appointments SET {', '.join(f'{key} = ?' for key in cleaned)}, updated_at = ? WHERE id = ?",
        [*cleaned.values(), utc_now(), appointment_id],
    )
    updated = _get_appointment(connection, appointment_id) or {}
    _audit(connection, "appointment", appointment_id, "updated", before=current, after=updated, source=source)
    return updated


def _validate_reminder(payload: dict[str, Any]) -> dict[str, Any]:
    status = payload.get("status", "pending")
    if status not in REMINDER_STATUSES:
        raise CareError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "status must be pending, done, or dismissed",
        )
    appointment_id = _text(payload.get("appointment_id"), "appointment_id", maximum=80)
    completed_at = payload.get("completed_at")
    if status == "done" and not completed_at:
        completed_at = utc_now()
    if status != "done":
        completed_at = None
    return {
        "appointment_id": appointment_id,
        "title": _text(payload.get("title"), "title", required=True, maximum=180),
        "due_at": _timestamp(payload.get("due_at"), "due_at"),
        "status": status,
        "note": _text(payload.get("note"), "note"),
        "source": _text(payload.get("source"), "source", maximum=40),
        "source_text": _text(payload.get("source_text"), "source_text"),
        "completed_at": _timestamp(completed_at, "completed_at") if completed_at else None,
    }


def _get_reminder(connection: sqlite3.Connection, reminder_id: str) -> dict[str, Any] | None:
    return _row(
        connection.execute("SELECT * FROM follow_up_reminders WHERE id = ?", (reminder_id,)).fetchone()
    )


def create_reminder(connection: sqlite3.Connection, payload: dict[str, Any], *, source: str) -> dict[str, Any]:
    cleaned = _validate_reminder({**payload, "source": payload.get("source") or source})
    if cleaned["appointment_id"] and not _get_appointment(connection, cleaned["appointment_id"]):
        raise CareError(HTTPStatus.NOT_FOUND, "linked appointment not found")
    reminder_id = str(uuid.uuid4())
    now = utc_now()
    columns = ["id", *cleaned.keys(), "created_at", "updated_at"]
    connection.execute(
        f"INSERT INTO follow_up_reminders({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
        [reminder_id, *cleaned.values(), now, now],
    )
    created = _get_reminder(connection, reminder_id) or {}
    _audit(connection, "reminder", reminder_id, "created", before=None, after=created, source=source)
    return created


def update_reminder(
    connection: sqlite3.Connection,
    reminder_id: str,
    payload: dict[str, Any],
    *,
    source: str,
) -> dict[str, Any]:
    current = _get_reminder(connection, reminder_id)
    if not current:
        raise CareError(HTTPStatus.NOT_FOUND, "reminder not found")
    merged = {key: current.get(key) for key in (
        "appointment_id", "title", "due_at", "status", "note", "source", "source_text", "completed_at"
    )}
    merged.update(payload)
    cleaned = _validate_reminder(merged)
    if cleaned["appointment_id"] and not _get_appointment(connection, cleaned["appointment_id"]):
        raise CareError(HTTPStatus.NOT_FOUND, "linked appointment not found")
    connection.execute(
        f"UPDATE follow_up_reminders SET {', '.join(f'{key} = ?' for key in cleaned)}, updated_at = ? WHERE id = ?",
        [*cleaned.values(), utc_now(), reminder_id],
    )
    updated = _get_reminder(connection, reminder_id) or {}
    _audit(connection, "reminder", reminder_id, "updated", before=current, after=updated, source=source)
    return updated


def _medication_scheduled_on(medication: dict[str, Any], selected: date) -> bool:
    if not medication["active"]:
        return False
    day = selected.isoformat()
    if day < medication["start_date"] or (medication["end_date"] and day > medication["end_date"]):
        return False
    if medication["schedule_kind"] == "specific_days":
        return selected.weekday() in medication["schedule_days"]
    return True


def list_care(
    connection: sqlite3.Connection,
    *,
    day: str,
    upcoming_days: int = 90,
    include_inactive: bool = False,
) -> dict[str, Any]:
    selected = date.fromisoformat(_day(day))
    medication_rows = connection.execute(
        "SELECT * FROM medications ORDER BY active DESC, name COLLATE NOCASE"
    ).fetchall()
    medications = []
    for medication_row in medication_rows:
        medication = _medication_dict(medication_row) or {}
        if not include_inactive and not medication["active"]:
            continue
        medication["scheduled_on_day"] = _medication_scheduled_on(medication, selected)
        dose_rows = connection.execute(
            """
            SELECT * FROM medication_doses
            WHERE medication_id = ? AND day = ?
            ORDER BY COALESCE(scheduled_time, substr(observed_at, 12, 5)), observed_at, id
            """,
            (medication["id"], selected.isoformat()),
        ).fetchall()
        medication["doses"] = [_dose_dict(connection, row) for row in dose_rows]
        medications.append(medication)

    window_start = datetime.combine(selected - timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    window_end = window_start + timedelta(days=max(1, min(upcoming_days, 3650)) + 2)
    appointments = [
        dict(row)
        for row in connection.execute(
            """
            SELECT * FROM appointments
            WHERE starts_at >= ? AND starts_at < ?
            ORDER BY starts_at, created_at
            """,
            (window_start.isoformat(), window_end.isoformat()),
        ).fetchall()
    ]
    reminders = [
        dict(row)
        for row in connection.execute(
            """
            SELECT * FROM follow_up_reminders
            WHERE status = 'pending' OR substr(due_at, 1, 10) = ?
            ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, due_at, created_at
            """,
            (selected.isoformat(),),
        ).fetchall()
    ]
    now = datetime.now(timezone.utc)
    for reminder in reminders:
        reminder["overdue"] = reminder["status"] == "pending" and datetime.fromisoformat(reminder["due_at"]).astimezone(timezone.utc) < now

    due_slots = 0
    recorded_slots = 0
    for medication in medications:
        if not medication["scheduled_on_day"] or medication["schedule_kind"] == "as_needed":
            continue
        due_slots += len(medication["schedule_times"])
        recorded_slots += len({dose["scheduled_time"] for dose in medication["doses"] if dose["scheduled_time"]})

    return {
        "day": selected.isoformat(),
        "medications": medications,
        "appointments": appointments,
        "reminders": reminders,
        "summary": {
            "scheduled_doses": due_slots,
            "recorded_doses": recorded_slots,
            "pending_reminders": sum(reminder["status"] == "pending" for reminder in reminders),
            "overdue_reminders": sum(bool(reminder["overdue"]) for reminder in reminders),
        },
    }
