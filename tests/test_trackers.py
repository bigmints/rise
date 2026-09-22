import json
import sqlite3
import tempfile
import unittest
from http import HTTPStatus
from pathlib import Path

from server import Store
from trackers import TrackerError


class ConfigurableTrackerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.directory.name) / "rise.db")
        self.store.initialize()

    def tearDown(self) -> None:
        self.directory.cleanup()

    def create_tracker(self, **overrides):
        payload = {
            "name": "Blood sugar",
            "category": "Vitals",
            "value_type": "number",
            "unit": "mg/dL",
            "frequency": "daily",
            "input_min": 20,
            "input_max": 600,
            "input_step": 1,
            "goal": {"label": "Personal reference", "minimum": 70, "maximum": 110},
            **overrides,
        }
        return self.store.create_tracker(payload)

    def test_weight_tracker_cannot_duplicate_daily_checkin_weight(self) -> None:
        with self.assertRaises(TrackerError) as raised:
            self.create_tracker(
                key="weight",
                name="Weight",
                category="Body",
                unit="kg",
                input_min=20,
                input_max=350,
                input_step=0.1,
            )

        self.assertEqual(raised.exception.status, HTTPStatus.CONFLICT)
        self.assertEqual(
            raised.exception.message,
            "Weight is already managed by daily check-ins",
        )

    def test_daily_tracker_is_created_without_code_and_corrected_with_audit(self) -> None:
        tracker = self.create_tracker()
        first, replayed = self.store.save_tracker_entry(
            {
                "tracker_id": tracker["id"],
                "day": "2026-08-18",
                "value": 104,
                "context": "Before breakfast",
            },
            source="dashboard",
        )
        self.assertFalse(replayed)
        corrected, _ = self.store.save_tracker_entry(
            {
                "tracker_id": tracker["id"],
                "day": "2026-08-18",
                "value": 101,
                "context": "Before breakfast",
            },
            source="dashboard",
        )
        self.assertEqual(first["entry"]["id"], corrected["entry"]["id"])
        data = self.store.list_trackers(days=3650)
        saved = next(item for item in data["trackers"] if item["id"] == tracker["id"])
        self.assertEqual(len(saved["entries"]), 1)
        self.assertEqual(saved["entries"][0]["numeric_value"], 101)
        with self.store.connect() as connection:
            actions = [
                row["action"]
                for row in connection.execute(
                    "SELECT action FROM tracker_audit_log WHERE entity_id = ? ORDER BY id",
                    (first["entry"]["id"],),
                )
            ]
        self.assertEqual(actions, ["created", "corrected"])

    def test_every_ui_preset_maps_to_a_valid_tracker_definition(self) -> None:
        catalog_path = (
            Path(__file__).parents[1]
            / "frontend"
            / "src"
            / "data"
            / "tracker-presets.json"
        )
        catalog = json.loads(catalog_path.read_text())
        self.assertEqual(catalog["version"], 1)
        keys = [preset["key"] for preset in catalog["presets"]]
        self.assertEqual(len(keys), len(set(keys)))
        for preset in catalog["presets"]:
            payload = {key: value for key, value in preset.items() if key != "description"}
            created = self.store.create_tracker(payload)
            self.assertEqual(created["key"], preset["key"])
            self.assertEqual(created["unit"], preset["unit"])
            self.assertEqual(created["frequency"], preset["frequency"])
        profile_keys = [profile["key"] for profile in catalog["other_profiles"]]
        self.assertEqual(len(profile_keys), len(set(profile_keys)))
        for profile in catalog["other_profiles"]:
            created = self.store.create_tracker(
                {
                    **profile,
                    "name": f"Other {profile['key']}",
                    "category": "Other",
                    "frequency": "daily",
                    "goal": {},
                }
            )
            self.assertEqual(created["unit"], profile["unit"])
            self.assertEqual(created["value_type"], profile["value_type"])

    def test_anytime_tracker_keeps_multiple_same_day_readings(self) -> None:
        tracker = self.create_tracker(name="Peak flow", unit="L/min", frequency="anytime")
        for observed_at, value in (
            ("2026-08-18T08:00:00+04:00", 420),
            ("2026-08-18T20:00:00+04:00", 450),
        ):
            self.store.save_tracker_entry(
                {
                    "tracker_id": tracker["id"],
                    "day": "2026-08-18",
                    "observed_at": observed_at,
                    "value": value,
                },
                source="dashboard",
            )
        saved = next(
            item
            for item in self.store.list_trackers(days=3650)["trackers"]
            if item["id"] == tracker["id"]
        )
        self.assertEqual([entry["numeric_value"] for entry in saved["entries"]], [450, 420])
        self.assertEqual(len({entry["id"] for entry in saved["entries"]}), 2)

    def test_anytime_tracker_reading_can_be_edited_without_creating_a_duplicate(self) -> None:
        tracker = self.create_tracker(name="Peak flow", unit="L/min", frequency="anytime")
        created, _ = self.store.save_tracker_entry(
            {
                "tracker_id": tracker["id"],
                "day": "2026-08-18",
                "observed_at": "2026-08-18T08:00:00+04:00",
                "value": 420,
                "note": "Before inhaler",
            },
            source="dashboard",
        )
        updated = self.store.update_tracker_entry(
            created["entry"]["id"],
            {
                "day": "2026-08-18",
                "observed_at": "2026-08-18T08:10:00+04:00",
                "value": 435,
                "note": "Retested",
            },
        )
        self.assertEqual(updated["id"], created["entry"]["id"])
        self.assertEqual(updated["numeric_value"], 435)
        self.assertEqual(updated["note"], "Retested")
        saved = next(
            item for item in self.store.list_trackers(days=3650)["trackers"]
            if item["id"] == tracker["id"]
        )
        self.assertEqual(len(saved["entries"]), 1)
        self.assertEqual(saved["entries"][0]["numeric_value"], 435)

    def test_blood_pressure_keeps_components_for_every_reading(self) -> None:
        readings = (
            ("2026-08-18T08:00:00+04:00", 121, 79, 67),
            ("2026-08-18T20:00:00+04:00", 118, 77, 64),
        )
        responses = []
        for observed_at, systolic, diastolic, pulse in readings:
            response, _ = self.store.save_tracker_entry(
                {
                    "tracker_key": "blood_pressure",
                    "day": "2026-08-18",
                    "observed_at": observed_at,
                    "value": {
                        "systolic": systolic,
                        "diastolic": diastolic,
                        "pulse": pulse,
                    },
                },
                source="dashboard",
            )
            responses.append(response)
        self.assertEqual(responses[0]["entry"]["components"]["systolic"]["numeric_value"], 121)
        bp = next(
            item
            for item in self.store.list_trackers(days=3650)["trackers"]
            if item["key"] == "blood_pressure"
        )
        self.assertEqual(len(bp["entries"]), 2)
        self.assertEqual(bp["entries"][0]["components"]["diastolic"]["numeric_value"], 77)

    def test_hermes_idempotency_replays_exact_request_and_rejects_key_reuse(self) -> None:
        payload = {
            "tracker_key": "blood_pressure",
            "day": "2026-08-18",
            "observed_at": "2026-08-18T08:00:00+04:00",
            "value": {"systolic": 120, "diastolic": 80},
        }
        first, replayed = self.store.save_tracker_entry(
            payload, source="hermes", idempotency_key="telegram-100"
        )
        second, replayed_second = self.store.save_tracker_entry(
            payload, source="hermes", idempotency_key="telegram-100"
        )
        self.assertFalse(replayed)
        self.assertTrue(replayed_second)
        self.assertEqual(first["entry"]["id"], second["entry"]["id"])
        changed = {**payload, "value": {"systolic": 121, "diastolic": 80}}
        with self.assertRaises(TrackerError) as error:
            self.store.save_tracker_entry(
                changed, source="hermes", idempotency_key="telegram-100"
            )
        self.assertEqual(error.exception.status, HTTPStatus.CONFLICT)

    def test_legacy_hermes_bp_checkin_is_atomic_and_preserves_each_observation(self) -> None:
        payload = {
            "bp_systolic": 120,
            "bp_diastolic": 80,
            "pulse_bpm": 68,
            "source": "hermes",
            "source_text": "BP 120 over 80",
        }
        checkin, first, replayed = self.store.upsert_hermes_checkin(
            "2026-08-18", payload, idempotency_key="legacy-1"
        )
        self.assertEqual(checkin["bp_systolic"], 120)
        self.assertFalse(replayed)
        _, replay, replayed = self.store.upsert_hermes_checkin(
            "2026-08-18", payload, idempotency_key="legacy-1"
        )
        self.assertTrue(replayed)
        self.assertEqual(first["id"], replay["id"])
        second_payload = {**payload, "bp_systolic": 118, "bp_diastolic": 78}
        self.store.upsert_hermes_checkin(
            "2026-08-18", second_payload, idempotency_key="legacy-2"
        )
        bp = next(
            item
            for item in self.store.list_trackers(days=3650)["trackers"]
            if item["key"] == "blood_pressure"
        )
        self.assertEqual(len(bp["entries"]), 2)
        self.assertEqual(self.store.get_checkin("2026-08-18")["bp_systolic"], 118)

    def test_validation_immutability_and_paused_tracker_management(self) -> None:
        tracker = self.create_tracker()
        with self.assertRaises(TrackerError):
            self.store.save_tracker_entry(
                {"tracker_id": tracker["id"], "day": "2026-08-18", "value": 900},
                source="dashboard",
            )
        self.store.save_tracker_entry(
            {"tracker_id": tracker["id"], "day": "2026-08-18", "value": 100},
            source="dashboard",
        )
        with self.assertRaises(TrackerError) as error:
            self.store.update_tracker(tracker["id"], {"unit": "mmol/L"})
        self.assertEqual(error.exception.status, HTTPStatus.CONFLICT)
        paused = self.store.update_tracker(tracker["id"], {"active": False})
        self.assertFalse(paused["active"])
        visible = self.store.list_trackers(days=30, include_inactive=True)["trackers"]
        self.assertIn(tracker["id"], {item["id"] for item in visible})
        active = self.store.list_trackers(days=3650)["trackers"]
        self.assertNotIn(tracker["id"], {item["id"] for item in active})

    def test_legacy_daily_blood_pressure_is_backfilled_once(self) -> None:
        self.store.upsert_checkin(
            "2026-08-17",
            {
                "bp_systolic": 122,
                "bp_diastolic": 81,
                "pulse_bpm": 69,
                "source": "legacy",
            },
        )
        self.store.initialize()
        self.store.initialize()
        with self.store.connect() as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM tracker_entries WHERE id = 'legacy-bp-2026-08-17'"
            ).fetchone()[0]
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
