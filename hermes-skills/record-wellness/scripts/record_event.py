#!/usr/bin/env python3
"""Send explicit wellness events from Hermes to Rise."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def timestamp(value: str) -> str:
    if value.lower() == "now":
        return datetime.now().astimezone().isoformat(timespec="seconds")
    candidate = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("use an ISO 8601 timestamp with timezone, or 'now'") from exc
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("timestamp must include a timezone offset")
    return parsed.isoformat(timespec="seconds")


def positive_number(value: str) -> float:
    try:
        number = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a number") from exc
    if number <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return number


def calendar_day(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise argparse.ArgumentTypeError("use YYYY-MM-DD") from exc


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--source-text", required=True, help="the user's exact original message")
    parser.add_argument("--note", help="optional context explicitly supplied by the user")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Record an explicit wellness event in Rise")
    parser.add_argument(
        "--api-url",
        default=os.environ.get("RISE_API_URL", "http://127.0.0.1:8787"),
        help="Rise base URL (default: RISE_API_URL or local service)",
    )
    parser.add_argument("--token", default=os.environ.get("RISE_HERMES_TOKEN"))
    subparsers = parser.add_subparsers(dest="command", required=True)

    fast_start = subparsers.add_parser("fast-start", help="start a fasting period")
    fast_start.add_argument("--at", required=True, type=timestamp)
    add_common(fast_start)

    fast_end = subparsers.add_parser("fast-end", help="end the latest open fasting period")
    fast_end.add_argument("--at", required=True, type=timestamp)
    add_common(fast_end)

    sleep = subparsers.add_parser("sleep", help="record a completed sleep period")
    sleep.add_argument("--start", required=True, type=timestamp)
    sleep.add_argument("--end", required=True, type=timestamp)
    sleep.add_argument("--label")
    add_common(sleep)

    exercise = subparsers.add_parser("exercise", help="record completed exercise")
    exercise.add_argument("--start", required=True, type=timestamp)
    end_group = exercise.add_mutually_exclusive_group(required=True)
    end_group.add_argument("--end", type=timestamp)
    end_group.add_argument("--minutes", type=positive_number)
    exercise.add_argument("--label")
    add_common(exercise)

    alcohol = subparsers.add_parser("alcohol", help="record alcohol consumption")
    alcohol.add_argument("--at", required=True, type=timestamp)
    alcohol.add_argument("--drinks", required=True, type=positive_number)
    alcohol.add_argument("--label")
    add_common(alcohol)

    weight = subparsers.add_parser("weight", help="record a weight measurement")
    weight.add_argument("--day", required=True, type=calendar_day)
    weight.add_argument("--kg", required=True, type=positive_number)
    add_common(weight)

    blood_pressure = subparsers.add_parser(
        "blood-pressure", help="record a blood pressure measurement"
    )
    blood_pressure.add_argument("--day", required=True, type=calendar_day)
    blood_pressure.add_argument("--systolic", required=True, type=positive_number)
    blood_pressure.add_argument("--diastolic", required=True, type=positive_number)
    blood_pressure.add_argument("--pulse", type=positive_number)
    blood_pressure.add_argument("--at", type=timestamp, help="reading time; defaults to now")
    blood_pressure.add_argument(
        "--idempotency-key",
        required=True,
        help="stable transport message/update ID; reuse for retries, change for a new reading",
    )
    add_common(blood_pressure)

    subparsers.add_parser("list-trackers", help="list configurable Rise trackers")

    list_care = subparsers.add_parser(
        "list-care", help="list medications, doses, appointments, and follow-up reminders"
    )
    list_care.add_argument("--day", required=True, type=calendar_day)

    medication = subparsers.add_parser("medication", help="add a medication")
    medication.add_argument("--name", required=True)
    medication.add_argument("--strength")
    medication.add_argument("--instructions")
    medication.add_argument(
        "--schedule-kind",
        required=True,
        choices=["daily", "specific_days", "as_needed"],
    )
    medication.add_argument("--time", action="append", default=[])
    medication.add_argument(
        "--weekday", action="append", type=int, choices=range(7), default=[]
    )
    medication.add_argument("--start-date", required=True, type=calendar_day)
    medication.add_argument("--end-date", type=calendar_day)
    medication.add_argument("--idempotency-key", required=True)
    add_common(medication)

    dose = subparsers.add_parser("dose", help="record a medication dose")
    dose.add_argument("--medication-id", required=True)
    dose.add_argument("--day", required=True, type=calendar_day)
    dose.add_argument("--scheduled-time")
    dose.add_argument("--at", required=True, type=timestamp)
    dose.add_argument("--status", required=True, choices=["taken", "skipped"])
    dose.add_argument("--dose-text")
    dose.add_argument("--idempotency-key", required=True)
    add_common(dose)

    appointment = subparsers.add_parser("appointment", help="add an appointment")
    appointment.add_argument("--title")
    appointment.add_argument("--provider")
    appointment.add_argument("--location")
    appointment.add_argument("--starts-at", required=True, type=timestamp)
    appointment.add_argument("--idempotency-key", required=True)
    add_common(appointment)

    appointment_status = subparsers.add_parser(
        "appointment-status", help="update an existing appointment status"
    )
    appointment_status.add_argument("--appointment-id", required=True)
    appointment_status.add_argument(
        "--status", required=True, choices=["scheduled", "completed", "cancelled"]
    )
    appointment_status.add_argument("--idempotency-key", required=True)
    add_common(appointment_status)

    reminder = subparsers.add_parser("reminder", help="add a follow-up reminder")
    reminder.add_argument("--title", required=True)
    reminder.add_argument("--due-at", required=True, type=timestamp)
    reminder.add_argument("--appointment-id")
    reminder.add_argument("--idempotency-key", required=True)
    add_common(reminder)

    reminder_status = subparsers.add_parser(
        "reminder-status", help="update an existing follow-up reminder status"
    )
    reminder_status.add_argument("--reminder-id", required=True)
    reminder_status.add_argument(
        "--status", required=True, choices=["pending", "done", "dismissed"]
    )
    reminder_status.add_argument("--idempotency-key", required=True)
    add_common(reminder_status)

    tracker = subparsers.add_parser("tracker", help="record a configurable tracker value")
    tracker.add_argument("--key", required=True, help="tracker key from list-trackers")
    tracker.add_argument("--day", required=True, type=calendar_day)
    tracker.add_argument("--value", required=True, help="exact numeric, choice, yes/no, or time value")
    tracker.add_argument("--at", type=timestamp, help="reading time for multiple-per-day trackers")
    tracker.add_argument("--context", help="explicit context such as before breakfast")
    tracker.add_argument(
        "--idempotency-key",
        required=True,
        help="stable transport message/update ID; reuse for retries, change for a new reading",
    )
    add_common(tracker)

    sleep_checkin = subparsers.add_parser("sleep-checkin", help="record daily sleep and rested feeling")
    sleep_checkin.add_argument("--day", required=True, type=calendar_day)
    sleep_checkin.add_argument("--hours", required=True, type=positive_number)
    sleep_checkin.add_argument("--rested", required=True, choices=["yes", "somewhat", "no"])
    sleep_checkin.add_argument("--bedtime", type=timestamp)
    sleep_checkin.add_argument("--wake-time", type=timestamp)
    add_common(sleep_checkin)

    activity = subparsers.add_parser("activity", help="record daily activity actual or skip")
    activity.add_argument("--day", required=True, type=calendar_day)
    activity_group = activity.add_mutually_exclusive_group(required=True)
    activity_group.add_argument("--minutes", type=positive_number)
    activity_group.add_argument("--skipped", action="store_true")
    add_common(activity)

    fasting_day = subparsers.add_parser("fasting-day", help="record daily fasting actual or skip")
    fasting_day.add_argument("--day", required=True, type=calendar_day)
    fasting_group = fasting_day.add_mutually_exclusive_group(required=True)
    fasting_group.add_argument("--hours", type=positive_number)
    fasting_group.add_argument("--skipped", action="store_true")
    add_common(fasting_day)

    return parser


def payload_for(args: argparse.Namespace) -> tuple[str, dict[str, object]]:
    if args.command == "list-trackers":
        return "/api/hermes/trackers", {}
    if args.command == "list-care":
        return f"/api/hermes/care?day={args.day}", {}
    common = {"source_text": args.source_text, "note": args.note}

    if args.command == "medication":
        return "/api/hermes/medications", {
            "name": args.name,
            "strength": args.strength,
            "instructions": args.instructions,
            "schedule_kind": args.schedule_kind,
            "schedule_times": args.time,
            "schedule_days": args.weekday,
            "start_date": args.start_date,
            "end_date": args.end_date,
            "active": True,
            "idempotency_key": args.idempotency_key,
            **common,
        }
    if args.command == "dose":
        return "/api/hermes/medication-doses", {
            "medication_id": args.medication_id,
            "day": args.day,
            "scheduled_time": args.scheduled_time,
            "observed_at": args.at,
            "status": args.status,
            "dose_text": args.dose_text,
            "idempotency_key": args.idempotency_key,
            **common,
        }
    if args.command == "appointment":
        return "/api/hermes/appointments", {
            "title": args.title,
            "provider": args.provider,
            "location": args.location,
            "starts_at": args.starts_at,
            "status": "scheduled",
            "idempotency_key": args.idempotency_key,
            **common,
        }
    if args.command == "appointment-status":
        return f"/api/hermes/appointments/{args.appointment_id}", {
            "status": args.status,
            "idempotency_key": args.idempotency_key,
            **common,
        }
    if args.command == "reminder":
        return "/api/hermes/reminders", {
            "title": args.title,
            "due_at": args.due_at,
            "appointment_id": args.appointment_id,
            "status": "pending",
            "idempotency_key": args.idempotency_key,
            **common,
        }
    if args.command == "reminder-status":
        return f"/api/hermes/reminders/{args.reminder_id}", {
            "status": args.status,
            "idempotency_key": args.idempotency_key,
            **common,
        }
    if args.command == "fast-start":
        return "/api/hermes/events", {
            "operation": "record",
            "kind": "fasting",
            "started_at": args.at,
            "title": "Intermittent fast",
            **common,
        }
    if args.command == "fast-end":
        return "/api/hermes/events", {
            "operation": "close_period",
            "kind": "fasting",
            "ended_at": args.at,
            "source_text": args.source_text,
        }
    if args.command == "sleep":
        return "/api/hermes/events", {
            "operation": "record",
            "kind": "sleep",
            "started_at": args.start,
            "ended_at": args.end,
            "title": args.label or "Sleep",
            **common,
        }
    if args.command == "exercise":
        start = datetime.fromisoformat(args.start)
        end = args.end
        if args.minutes is not None:
            end = (start + timedelta(minutes=args.minutes)).isoformat(timespec="seconds")
        return "/api/hermes/events", {
            "operation": "record",
            "kind": "exercise",
            "started_at": args.start,
            "ended_at": end,
            "title": args.label or "Exercise",
            **common,
        }
    if args.command == "alcohol":
        return "/api/hermes/events", {
            "operation": "record",
            "kind": "alcohol",
            "started_at": args.at,
            "title": args.label or "Alcohol",
            "quantity": args.drinks,
            "unit": "drinks",
            **common,
        }
    if args.command == "weight":
        return "/api/hermes/checkins", {
            "day": args.day,
            "weight_kg": args.kg,
            **common,
        }
    if args.command == "blood-pressure":
        payload = {
            "tracker_key": "blood_pressure",
            "day": args.day,
            "observed_at": args.at or timestamp("now"),
            "value": {
                "systolic": round(args.systolic),
                "diastolic": round(args.diastolic),
                **({"pulse": round(args.pulse)} if args.pulse is not None else {}),
            },
            **common,
        }
        payload["idempotency_key"] = args.idempotency_key
        return "/api/hermes/tracker-entries", payload
    if args.command == "tracker":
        payload = {
            "tracker_key": args.key,
            "day": args.day,
            "observed_at": args.at,
            "value": args.value,
            "context": args.context,
            **common,
        }
        payload["idempotency_key"] = args.idempotency_key
        return "/api/hermes/tracker-entries", payload
    if args.command == "sleep-checkin":
        return "/api/hermes/checkins", {
            "day": args.day,
            "sleep_minutes": round(args.hours * 60),
            "rested": args.rested,
            "bedtime": args.bedtime,
            "wake_time": args.wake_time,
            **common,
        }
    if args.command == "activity":
        return "/api/hermes/checkins", {
            "day": args.day,
            "activity_minutes": 0 if args.skipped else round(args.minutes),
            **({"activity_status": "skipped"} if args.skipped else {}),
            **common,
        }
    if args.command == "fasting-day":
        return "/api/hermes/checkins", {
            "day": args.day,
            "fasting_minutes": 0 if args.skipped else round(args.hours * 60),
            **({"fasting_status": "skipped"} if args.skipped else {}),
            **common,
        }
    raise RuntimeError("unsupported command")


def send(args: argparse.Namespace, endpoint_path: str, payload: dict[str, object]) -> dict[str, object]:
    if not args.token:
        raise RuntimeError("RISE_HERMES_TOKEN is not set")
    endpoint = args.api_url.rstrip("/") + endpoint_path
    if args.command in {"list-trackers", "list-care"}:
        method = "GET"
    elif args.command in {"appointment-status", "reminder-status"}:
        method = "PATCH"
    else:
        method = "POST"
    request = Request(
        endpoint,
        data=None if method == "GET" else json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {args.token}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read())
    except HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        try:
            detail = json.loads(detail).get("error", detail)
        except json.JSONDecodeError:
            pass
        raise RuntimeError(f"Rise rejected the event ({exc.code}): {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"could not reach Rise at {endpoint}: {exc.reason}") from exc


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        endpoint_path, payload = payload_for(args)
        response = send(args, endpoint_path, payload)
    except RuntimeError as exc:
        print(f"Not recorded: {exc}", file=sys.stderr)
        return 1
    if "event" in response:
        event = response.get("event", {})
        print(f"Recorded {event.get('kind', 'wellness')} event {event.get('id', '')}".strip())
    elif "checkin" in response:
        checkin = response.get("checkin", {})
        print(f"Recorded Rise check-in for {checkin.get('day', '')}".strip())
    elif "entry" in response:
        entry = response.get("entry", {})
        replayed = " (already recorded)" if response.get("replayed") else ""
        print(
            f"Recorded {entry.get('tracker_name', 'tracker')} · "
            f"{entry.get('value_text', '')}{replayed}"
        )
    elif isinstance(response.get("trackers"), list):
        print(
            json.dumps(
                [
                    {
                        "key": tracker.get("key"),
                        "name": tracker.get("name"),
                        "type": tracker.get("value_type"),
                        "unit": tracker.get("unit"),
                        "frequency": tracker.get("frequency"),
                        "choices": tracker.get("choices", []),
                    }
                    for tracker in response["trackers"]
                ],
                ensure_ascii=False,
            )
        )
    elif args.command == "list-care":
        print(json.dumps(response, indent=2, sort_keys=True))
    elif "medication" in response:
        item = response["medication"]
        print(f"Recorded medication {item.get('name', '')}".strip())
    elif "dose" in response:
        item = response["dose"]
        print(
            f"Recorded {item.get('medication_name', 'medication')} dose as "
            f"{item.get('status', '')}".strip()
        )
    elif "appointment" in response:
        item = response["appointment"]
        print(f"Recorded appointment {item.get('title') or item.get('provider') or item.get('id', '')}".strip())
    elif "reminder" in response:
        item = response["reminder"]
        print(f"Recorded reminder {item.get('title', '')}".strip())
    else:
        raise RuntimeError("Rise returned an unexpected response")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
