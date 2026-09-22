from __future__ import annotations

import importlib.util
import io
import unittest
from contextlib import redirect_stderr
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "hermes-skills"
    / "record-wellness"
    / "scripts"
    / "record_event.py"
)
SPEC = importlib.util.spec_from_file_location("rise_record_event", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load Hermes skill script at {SCRIPT_PATH}")
RECORD_EVENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECORD_EVENT)

REMINDER_SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "hermes-skills"
    / "record-wellness"
    / "scripts"
    / "send_care_reminders.py"
)
REMINDER_SPEC = importlib.util.spec_from_file_location(
    "rise_send_care_reminders", REMINDER_SCRIPT_PATH
)
if not REMINDER_SPEC or not REMINDER_SPEC.loader:
    raise RuntimeError(f"Could not load {REMINDER_SCRIPT_PATH}")
CARE_REMINDERS = importlib.util.module_from_spec(REMINDER_SPEC)
REMINDER_SPEC.loader.exec_module(CARE_REMINDERS)


class HermesSkillTests(unittest.TestCase):
    def parse_blood_pressure(self, key: str, observed_at: str):
        return RECORD_EVENT.build_parser().parse_args(
            [
                "blood-pressure",
                "--day",
                "2026-08-18",
                "--at",
                observed_at,
                "--systolic",
                "120",
                "--diastolic",
                "80",
                "--idempotency-key",
                key,
                "--source-text",
                "BP 120/80",
            ]
        )

    def test_blood_pressure_requires_transport_idempotency_key(self):
        parser = RECORD_EVENT.build_parser()
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
            parser.parse_args(
                [
                    "blood-pressure",
                    "--day",
                    "2026-08-18",
                    "--systolic",
                    "120",
                    "--diastolic",
                    "80",
                    "--source-text",
                    "BP 120/80",
                ]
            )
        self.assertEqual(raised.exception.code, 2)

    def test_identical_same_day_readings_keep_distinct_message_identity(self):
        first_path, first = RECORD_EVENT.payload_for(
            self.parse_blood_pressure("telegram-123:bp-1", "2026-08-18T08:00:00+04:00")
        )
        second_path, second = RECORD_EVENT.payload_for(
            self.parse_blood_pressure("telegram-124:bp-1", "2026-08-18T20:00:00+04:00")
        )

        self.assertEqual(first_path, "/api/hermes/tracker-entries")
        self.assertEqual(second_path, first_path)
        self.assertEqual(first["value"], second["value"])
        self.assertNotEqual(first["observed_at"], second["observed_at"])
        self.assertNotEqual(first["idempotency_key"], second["idempotency_key"])

    def test_retry_payload_is_stable(self):
        args = self.parse_blood_pressure(
            "telegram-123:bp-1", "2026-08-18T08:00:00+04:00"
        )
        self.assertEqual(RECORD_EVENT.payload_for(args), RECORD_EVENT.payload_for(args))

    def test_medication_payload_keeps_schedule_and_transport_identity(self):
        args = RECORD_EVENT.build_parser().parse_args(
            [
                "medication",
                "--name",
                "Metformin",
                "--strength",
                "500 mg",
                "--schedule-kind",
                "daily",
                "--time",
                "08:00",
                "--time",
                "20:00",
                "--start-date",
                "2026-08-18",
                "--idempotency-key",
                "telegram-200:medication-1",
                "--source-text",
                "Add Metformin twice daily",
            ]
        )
        path, payload = RECORD_EVENT.payload_for(args)
        self.assertEqual(path, "/api/hermes/medications")
        self.assertEqual(payload["schedule_times"], ["08:00", "20:00"])
        self.assertEqual(payload["idempotency_key"], "telegram-200:medication-1")
        self.assertEqual(payload["source_text"], "Add Metformin twice daily")

    def test_appointment_and_reminder_status_use_resource_patch_paths(self):
        appointment = RECORD_EVENT.build_parser().parse_args(
            [
                "appointment-status",
                "--appointment-id",
                "appointment-1",
                "--status",
                "completed",
                "--idempotency-key",
                "telegram-201:appointment-status-1",
                "--source-text",
                "Appointment completed",
            ]
        )
        reminder = RECORD_EVENT.build_parser().parse_args(
            [
                "reminder-status",
                "--reminder-id",
                "reminder-1",
                "--status",
                "done",
                "--idempotency-key",
                "telegram-202:reminder-status-1",
                "--source-text",
                "Booked it",
            ]
        )
        self.assertEqual(
            RECORD_EVENT.payload_for(appointment)[0],
            "/api/hermes/appointments/appointment-1",
        )
        self.assertEqual(
            RECORD_EVENT.payload_for(reminder)[0],
            "/api/hermes/reminders/reminder-1",
        )

    def test_care_reminders_include_due_and_upcoming_but_not_medications(self):
        now = CARE_REMINDERS.timestamp("2026-08-18T09:00:00+04:00")
        care = {
            "medications": [{"id": "med-1", "name": "Metformin"}],
            "reminders": [
                {
                    "id": "reminder-1",
                    "title": "Book follow-up",
                    "due_at": "2026-08-18T08:00:00+04:00",
                    "status": "pending",
                    "updated_at": "2026-08-18T07:00:00+00:00",
                },
                {
                    "id": "reminder-2",
                    "title": "Already done",
                    "due_at": "2026-08-18T08:00:00+04:00",
                    "status": "done",
                    "updated_at": "2026-08-18T07:00:00+00:00",
                },
            ],
            "appointments": [
                {
                    "id": "appointment-1",
                    "title": "Rheumatology",
                    "starts_at": "2026-08-19T08:00:00+04:00",
                    "status": "scheduled",
                }
            ],
        }
        candidates = CARE_REMINDERS.notification_candidates(care, now, 24)
        self.assertEqual(
            [(item["kind"], item["title"]) for item in candidates],
            [("reminder", "Book follow-up"), ("appointment", "Rheumatology")],
        )


if __name__ == "__main__":
    unittest.main()
