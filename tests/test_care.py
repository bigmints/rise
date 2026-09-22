from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from care import CareError
from server import Store


class CareStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "rise.db"
        self.store = Store(self.path)
        self.store.initialize()

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def medication(self, **overrides):
        payload = {
            "name": "Metformin",
            "strength": "500 mg",
            "instructions": "With food",
            "schedule_kind": "daily",
            "schedule_times": ["08:00", "20:00"],
            "schedule_days": [],
            "start_date": "2026-08-18",
            "end_date": None,
            "active": True,
        }
        payload.update(overrides)
        response, _ = self.store.create_medication(payload, source="dashboard")
        return response["medication"]

    def test_daily_schedule_and_corrections_preserve_audit_history(self) -> None:
        medication = self.medication()
        care = self.store.list_care(day="2026-08-18")
        self.assertEqual(care["summary"]["scheduled_doses"], 2)
        self.assertEqual(care["summary"]["recorded_doses"], 0)

        payload = {
            "medication_id": medication["id"],
            "day": "2026-08-18",
            "scheduled_time": "08:00",
            "observed_at": "2026-08-18T08:05:00+04:00",
            "status": "taken",
        }
        first, _ = self.store.save_medication_dose(payload, source="dashboard")
        payload["status"] = "skipped"
        corrected, _ = self.store.save_medication_dose(payload, source="dashboard")

        self.assertEqual(first["dose"]["id"], corrected["dose"]["id"])
        self.assertEqual(corrected["dose"]["status"], "skipped")
        care = self.store.list_care(day="2026-08-18")
        self.assertEqual(care["summary"]["recorded_doses"], 1)
        with sqlite3.connect(self.path) as connection:
            actions = [
                row[0]
                for row in connection.execute(
                    "SELECT action FROM care_audit_log WHERE entity_id = ? ORDER BY id",
                    (corrected["dose"]["id"],),
                )
            ]
        self.assertEqual(actions, ["recorded", "corrected"])

    def test_as_needed_medication_keeps_multiple_same_day_doses(self) -> None:
        medication = self.medication(
            name="Pain relief",
            schedule_kind="as_needed",
            schedule_times=[],
        )
        for index, observed_at in enumerate(
            ("2026-08-18T09:00:00+04:00", "2026-08-18T21:00:00+04:00"),
            start=1,
        ):
            self.store.save_medication_dose(
                {
                    "medication_id": medication["id"],
                    "day": "2026-08-18",
                    "observed_at": observed_at,
                    "status": "taken",
                    "dose_text": f"Dose {index}",
                },
                source="dashboard",
            )
        care = self.store.list_care(day="2026-08-18")
        saved = next(item for item in care["medications"] if item["id"] == medication["id"])
        self.assertEqual(len(saved["doses"]), 2)

    def test_appointment_and_follow_up_reminder_have_independent_status(self) -> None:
        appointment_response, _ = self.store.create_appointment(
            {
                "title": "Rheumatology review",
                "provider": "Dr Example",
                "starts_at": "2026-08-25T10:00:00+04:00",
                "status": "scheduled",
            },
            source="dashboard",
        )
        appointment = appointment_response["appointment"]
        reminder_response, _ = self.store.create_reminder(
            {
                "appointment_id": appointment["id"],
                "title": "Book blood tests before review",
                "due_at": "2026-08-20T09:00:00+04:00",
                "status": "pending",
            },
            source="dashboard",
        )
        reminder = reminder_response["reminder"]

        completed = self.store.update_appointment(
            appointment["id"], {"status": "completed"}, source="dashboard"
        )
        care = self.store.list_care(day="2026-08-18")
        saved_reminder = next(item for item in care["reminders"] if item["id"] == reminder["id"])
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(saved_reminder["status"], "pending")

    def test_hermes_idempotency_is_request_bound(self) -> None:
        payload = {
            "title": "Book follow-up",
            "due_at": "2026-08-21T09:00:00+04:00",
            "status": "pending",
        }
        first, replayed = self.store.create_reminder(
            payload, source="hermes", idempotency_key="telegram-10:reminder-1"
        )
        second, replayed_second = self.store.create_reminder(
            payload, source="hermes", idempotency_key="telegram-10:reminder-1"
        )
        self.assertFalse(replayed)
        self.assertTrue(replayed_second)
        self.assertEqual(first, second)

        with self.assertRaises(CareError) as raised:
            self.store.create_reminder(
                {**payload, "title": "Different reminder"},
                source="hermes",
                idempotency_key="telegram-10:reminder-1",
            )
        self.assertEqual(raised.exception.status, 409)


if __name__ == "__main__":
    unittest.main()
