from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from server import RiseApp
from http.server import ThreadingHTTPServer


class RiseApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.app = RiseApp(
            Path(self.tempdir.name) / "rise.db",
            hermes_token="hermes-secret",
            dashboard_password="dashboard-secret",
            checkin_secret="checkin-secret",
        )
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self.app.handler_class())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        credentials = base64.b64encode(b"rise:dashboard-secret").decode()
        self.dashboard_headers = {"Authorization": f"Basic {credentials}"}

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.tempdir.cleanup()

    def request(self, path: str, *, method: str = "GET", payload=None, headers=None):
        body = json.dumps(payload).encode() if payload is not None else None
        request = Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        with urlopen(request, timeout=2) as response:
            if response.status == 204:
                return response.status, None
            return response.status, json.loads(response.read())

    def test_health_is_public_but_events_are_private(self) -> None:
        status, body = self.request("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"status": "ok"})
        with self.assertRaises(HTTPError) as error:
            self.request("/api/events")
        self.assertEqual(error.exception.code, 401)
        error.exception.close()
        with self.assertRaises(HTTPError) as error:
            self.request(
                "/api/hermes/events",
                method="POST",
                headers={"Authorization": "Bearer hermes-secret"},
                payload={"kind": "sleep", "started_at": "2026-08-17T23:00:00"},
            )
        self.assertEqual(error.exception.code, 422)
        error.exception.close()

    def test_today_items_can_be_hidden_and_restored_without_deleting_data(self) -> None:
        status, body = self.request(
            "/api/today-items", headers=self.dashboard_headers
        )
        self.assertEqual(status, 200)
        self.assertTrue(next(item for item in body["items"] if item["key"] == "sleep")["active"])

        status, body = self.request(
            "/api/today-items/sleep",
            method="PATCH",
            headers=self.dashboard_headers,
            payload={"active": False},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["item"], {"key": "sleep", "active": False})

        _, body = self.request("/api/today-items", headers=self.dashboard_headers)
        self.assertFalse(next(item for item in body["items"] if item["key"] == "sleep")["active"])

        _, body = self.request(
            "/api/today-items/sleep",
            method="PATCH",
            headers=self.dashboard_headers,
            payload={"active": True},
        )
        self.assertTrue(body["item"]["active"])

    def test_password_sign_in_creates_a_dashboard_session(self) -> None:
        request = Request(
            self.base_url + "/api/session",
            data=json.dumps({"password": "dashboard-secret"}).encode(),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 204)
            cookie = response.headers["Set-Cookie"].split(";", 1)[0]
        status, body = self.request("/api/events", headers={"Cookie": cookie})
        self.assertEqual(status, 200)
        self.assertEqual(body["events"], [])

    def test_pwa_manifest_and_service_worker_are_public(self) -> None:
        status, manifest = self.request("/manifest.webmanifest")
        self.assertEqual(status, 200)
        self.assertEqual(manifest["display"], "standalone")
        self.assertEqual({icon["sizes"] for icon in manifest["icons"]}, {"192x192", "512x512"})

        index_request = Request(
            self.base_url + "/",
            headers=self.dashboard_headers,
        )
        with urlopen(index_request, timeout=2) as response:
            index = response.read().decode()
            self.assertEqual(
                response.headers["Cache-Control"],
                "no-cache, no-store, must-revalidate",
            )
        self.assertRegex(index, r'/assets/index-[A-Za-z0-9_-]+\.js')
        self.assertNotIn('/assets/index.js', index)
        with urlopen(self.base_url + "/service-worker.js", timeout=2) as response:
            worker = response.read().decode()
            self.assertEqual(
                response.headers["Cache-Control"],
                "no-cache, no-store, must-revalidate",
            )
        self.assertIn("rise-static-v49", worker)
        self.assertIn("await cache.put(event.request", worker)
        self.assertNotIn('"/api/', worker)

    def test_hermes_can_record_and_close_a_fast(self) -> None:
        headers = {"Authorization": "Bearer hermes-secret"}
        status, body = self.request(
            "/api/hermes/events",
            method="POST",
            headers=headers,
            payload={
                "operation": "record",
                "kind": "fasting",
                "started_at": "2026-08-17T20:00:00+04:00",
                "source_text": "Starting my fast now",
            },
        )
        self.assertEqual(status, 201)
        self.assertIsNone(body["event"]["ended_at"])

        _, closed = self.request(
            "/api/hermes/events",
            method="POST",
            headers=headers,
            payload={
                "operation": "close_period",
                "kind": "fasting",
                "ended_at": "2026-08-18T12:15:00+04:00",
                "source_text": "Breaking my fast",
            },
        )
        self.assertEqual(closed["event"]["ended_at"], "2026-08-18T12:15:00+04:00")
        self.assertIn("Breaking my fast", closed["event"]["source_text"])

    def test_dashboard_can_correct_and_delete_an_event(self) -> None:
        status, created = self.request(
            "/api/events",
            method="POST",
            headers=self.dashboard_headers,
            payload={
                "kind": "alcohol",
                "started_at": "2026-08-17T21:00:00+04:00",
                "quantity": 2,
                "unit": "drinks",
                "source": "manual",
            },
        )
        self.assertEqual(status, 201)
        event_id = created["event"]["id"]

        _, updated = self.request(
            f"/api/events/{event_id}",
            method="PATCH",
            headers=self.dashboard_headers,
            payload={"quantity": 1},
        )
        self.assertEqual(updated["event"]["quantity"], 1)

        status, _ = self.request(
            f"/api/events/{event_id}", method="DELETE", headers=self.dashboard_headers
        )
        self.assertEqual(status, 204)

    def test_rejects_naive_timestamps_and_bad_token(self) -> None:
        with self.assertRaises(HTTPError) as error:
            self.request(
                "/api/hermes/events",
                method="POST",
                headers={"Authorization": "Bearer wrong"},
                payload={"kind": "sleep", "started_at": "2026-08-17T23:00:00"},
            )
        self.assertEqual(error.exception.code, 401)
        error.exception.close()

    def test_daily_checkin_tracks_actuals_and_explicit_skips(self) -> None:
        status, body = self.request(
            "/api/checkins/2026-08-17",
            method="PUT",
            headers=self.dashboard_headers,
            payload={
                "fasting_minutes": 1200,
                "activity_status": "skipped",
                "sleep_minutes": 450,
                "weight_kg": 72.4,
                "bp_systolic": 121,
                "bp_diastolic": 79,
                "pulse_bpm": 67,
                "rested": "somewhat",
                "bedtime": "2026-08-16T23:30:00+04:00",
            },
        )
        self.assertEqual(status, 200)
        checkin = body["checkin"]
        self.assertEqual(checkin["fasting_status"], "met")
        self.assertEqual(checkin["activity_status"], "skipped")
        self.assertEqual(checkin["activity_minutes"], 0)
        self.assertEqual(checkin["sleep_minutes"], 450)
        self.assertEqual(checkin["weight_kg"], 72.4)
        self.assertEqual(checkin["bp_systolic"], 121)
        self.assertEqual(checkin["bp_diastolic"], 79)
        self.assertEqual(checkin["pulse_bpm"], 67)
        self.assertEqual(checkin["rested"], "somewhat")

        status, body = self.request("/api/checkins?days=3650", headers=self.dashboard_headers)
        self.assertEqual(status, 200)
        self.assertEqual(body["checkins"][0]["day"], "2026-08-17")

    def test_hermes_checkin_derives_status_and_rejects_crossed_status(self) -> None:
        headers = {"Authorization": "Bearer hermes-secret"}
        status, body = self.request(
            "/api/hermes/checkins",
            method="POST",
            headers=headers,
            payload={"day": "2026-08-17", "activity_minutes": 45},
        )
        self.assertEqual(status, 201)
        self.assertEqual(body["checkin"]["activity_status"], "partial")
        self.assertIsNone(body["checkin"]["fasting_status"])

        with self.assertRaises(HTTPError) as error:
            self.request(
                "/api/hermes/checkins",
                method="POST",
                headers=headers,
                payload={"day": "2026-08-17", "fasting_status": "partial"},
            )
        self.assertEqual(error.exception.code, 422)
        error.exception.close()

        with self.assertRaises(HTTPError) as error:
            self.request(
                "/api/hermes/checkins",
                method="POST",
                headers=headers,
                payload={"day": "2026-08-17", "bp_systolic": 120},
            )
        self.assertEqual(error.exception.code, 422)
        error.exception.close()

    def test_configurable_tracker_api_and_hermes_discovery_are_end_to_end(self) -> None:
        status, created = self.request(
            "/api/trackers",
            method="POST",
            headers=self.dashboard_headers,
            payload={
                "name": "Blood sugar",
                "category": "Vitals",
                "value_type": "number",
                "unit": "mg/dL",
                "frequency": "daily",
                "input_min": 20,
                "input_max": 600,
                "input_step": 1,
                "choices": [],
                "goal": {},
            },
        )
        self.assertEqual(status, 201)
        tracker = created["tracker"]

        hermes_headers = {"Authorization": "Bearer hermes-secret"}
        status, discovered = self.request(
            "/api/hermes/trackers", headers=hermes_headers
        )
        self.assertEqual(status, 200)
        self.assertIn("blood_sugar", {item["key"] for item in discovered["trackers"]})

        payload = {
            "tracker_key": tracker["key"],
            "day": "2026-08-18",
            "value": "104",
            "context": "Before breakfast",
            "idempotency_key": "telegram-blood-sugar-1",
        }
        status, first = self.request(
            "/api/hermes/tracker-entries",
            method="POST",
            headers=hermes_headers,
            payload=payload,
        )
        self.assertEqual(status, 201)
        self.assertFalse(first["replayed"])
        status, replay = self.request(
            "/api/hermes/tracker-entries",
            method="POST",
            headers=hermes_headers,
            payload=payload,
        )
        self.assertEqual(status, 200)
        self.assertTrue(replay["replayed"])
        self.assertEqual(first["entry"]["id"], replay["entry"]["id"])

        status, corrected = self.request(
            f"/api/tracker-entries/{first['entry']['id']}",
            method="PATCH",
            headers=self.dashboard_headers,
            payload={
                "tracker_id": tracker["id"],
                "day": "2026-08-18",
                "value": "101",
                "context": "Before breakfast",
                "note": "Corrected in Track",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(corrected["entry"]["id"], first["entry"]["id"])
        self.assertEqual(corrected["entry"]["numeric_value"], 101)
        _, tracker_data = self.request(
            "/api/trackers?days=3650", headers=self.dashboard_headers
        )
        saved = next(
            item for item in tracker_data["trackers"] if item["id"] == tracker["id"]
        )
        self.assertEqual(len(saved["entries"]), 1)
        self.assertEqual(saved["entries"][0]["numeric_value"], 101)

    def test_legacy_hermes_bp_api_preserves_multiple_same_day_readings(self) -> None:
        headers = {"Authorization": "Bearer hermes-secret"}
        for key, systolic, diastolic in (
            ("telegram-bp-1", 121, 79),
            ("telegram-bp-2", 118, 77),
        ):
            status, body = self.request(
                "/api/hermes/checkins",
                method="POST",
                headers=headers,
                payload={
                    "day": "2026-08-18",
                    "bp_systolic": systolic,
                    "bp_diastolic": diastolic,
                    "pulse_bpm": 67,
                    "idempotency_key": key,
                },
            )
            self.assertEqual(status, 201)
            self.assertEqual(body["tracker_entry"]["value_text"], f"{systolic}/{diastolic}")
        _, trackers = self.request(
            "/api/trackers?days=3650", headers=self.dashboard_headers
        )
        blood_pressure = next(
            item for item in trackers["trackers"] if item["key"] == "blood_pressure"
        )
        self.assertEqual(len(blood_pressure["entries"]), 2)
        self.assertEqual(blood_pressure["entries"][0]["value_text"], "118/77")

    def test_health_records_start_empty_and_remain_private(self) -> None:
        with self.assertRaises(HTTPError) as error:
            self.request("/api/health-records")
        self.assertEqual(error.exception.code, 401)
        error.exception.close()

        status, body = self.request(
            "/api/health-records", headers=self.dashboard_headers
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["report_count"], 0)
        self.assertEqual(body["result_count"], 0)
        self.assertEqual(body["reports"], [])
        self.assertEqual(body["histories"], {})

        self.app.store.initialize()
        with self.app.store.connect() as connection:
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM health_reports").fetchone()[0],
                0,
            )
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM health_results").fetchone()[0],
                0,
            )

    def signed_checkin_path(self, day: str, field: str, value: str, expires: int) -> str:
        message = f"{day}|{field}|{value}|{expires}"
        signature = hmac.new(b"checkin-secret", message.encode(), hashlib.sha256).hexdigest()
        return "/quick-checkin?" + urlencode(
            {"day": day, "field": field, "value": value, "expires": expires, "sig": signature}
        )

    def test_signed_quick_checkin_persists_and_bad_numeric_is_clean_400(self) -> None:
        expires = int(time.time()) + 3600
        path = self.signed_checkin_path("2026-08-17", "fasting", "1080", expires)
        with urlopen(self.base_url + path, timeout=2) as response:
            self.assertEqual(response.status, 200)
            self.assertIn(b"Fasting", response.read())

        _, body = self.request("/api/checkins?days=3650", headers=self.dashboard_headers)
        self.assertEqual(body["checkins"][0]["fasting_minutes"], 1080)
        self.assertEqual(body["checkins"][0]["fasting_status"], "short")

        bad_path = self.signed_checkin_path("2026-08-17", "sleep_minutes", "not-a-number", expires)
        with self.assertRaises(HTTPError) as error:
            urlopen(self.base_url + bad_path, timeout=2)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()

    def test_completed_sleep_event_syncs_to_daily_checkin(self) -> None:
        status, _ = self.request(
            "/api/events",
            method="POST",
            headers=self.dashboard_headers,
            payload={
                "kind": "sleep",
                "started_at": "2026-08-16T23:30:00+04:00",
                "ended_at": "2026-08-17T07:00:00+04:00",
                "source": "manual",
            },
        )
        self.assertEqual(status, 201)
        _, body = self.request("/api/checkins?days=3650", headers=self.dashboard_headers)
        self.assertEqual(body["checkins"][0]["sleep_minutes"], 450)
        self.assertEqual(body["checkins"][0]["bedtime"], "2026-08-16T23:30:00+04:00")

    def test_dashboard_care_endpoints_persist_medication_appointment_and_reminder(self) -> None:
        _, medication_body = self.request(
            "/api/medications",
            method="POST",
            headers=self.dashboard_headers,
            payload={
                "name": "Metformin",
                "strength": "500 mg",
                "instructions": "With food",
                "schedule_kind": "daily",
                "schedule_times": ["08:00", "20:00"],
                "schedule_days": [],
                "start_date": "2026-08-18",
                "active": True,
            },
        )
        medication = medication_body["medication"]
        _, dose_body = self.request(
            "/api/medication-doses",
            method="POST",
            headers=self.dashboard_headers,
            payload={
                "medication_id": medication["id"],
                "day": "2026-08-18",
                "scheduled_time": "08:00",
                "observed_at": "2026-08-18T08:05:00+04:00",
                "status": "taken",
            },
        )
        _, appointment_body = self.request(
            "/api/appointments",
            method="POST",
            headers=self.dashboard_headers,
            payload={
                "title": "Rheumatology review",
                "starts_at": "2026-08-25T10:00:00+04:00",
                "status": "scheduled",
            },
        )
        _, reminder_body = self.request(
            "/api/reminders",
            method="POST",
            headers=self.dashboard_headers,
            payload={
                "appointment_id": appointment_body["appointment"]["id"],
                "title": "Book blood tests",
                "due_at": "2026-08-20T09:00:00+04:00",
                "status": "pending",
            },
        )
        status, care = self.request(
            "/api/care?day=2026-08-18", headers=self.dashboard_headers
        )
        self.assertEqual(status, 200)
        self.assertEqual(care["summary"]["scheduled_doses"], 2)
        self.assertEqual(care["summary"]["recorded_doses"], 1)
        self.assertEqual(care["medications"][0]["doses"][0]["id"], dose_body["dose"]["id"])
        self.assertEqual(care["appointments"][0]["id"], appointment_body["appointment"]["id"])
        self.assertEqual(care["reminders"][0]["id"], reminder_body["reminder"]["id"])

    def test_hermes_care_discovery_and_dose_idempotency(self) -> None:
        headers = {"Authorization": "Bearer hermes-secret"}
        _, medication_body = self.request(
            "/api/hermes/medications",
            method="POST",
            headers=headers,
            payload={
                "name": "Vitamin D",
                "strength": "1000 IU",
                "schedule_kind": "daily",
                "schedule_times": ["09:00"],
                "schedule_days": [],
                "start_date": "2026-08-18",
                "active": True,
                "source_text": "I take vitamin D every morning",
                "idempotency_key": "telegram-20:medication-1",
            },
        )
        medication = medication_body["medication"]
        _, discovered = self.request(
            "/api/hermes/care?day=2026-08-18", headers=headers
        )
        self.assertIn(medication["id"], {item["id"] for item in discovered["medications"]})

        dose = {
            "medication_id": medication["id"],
            "day": "2026-08-18",
            "scheduled_time": "09:00",
            "observed_at": "2026-08-18T09:03:00+04:00",
            "status": "taken",
            "source_text": "Took my vitamin D",
            "idempotency_key": "telegram-21:dose-1",
        }
        first_status, first = self.request(
            "/api/hermes/medication-doses", method="POST", headers=headers, payload=dose
        )
        replay_status, replay = self.request(
            "/api/hermes/medication-doses", method="POST", headers=headers, payload=dose
        )
        self.assertEqual(first_status, 201)
        self.assertEqual(replay_status, 200)
        self.assertFalse(first["replayed"])
        self.assertTrue(replay["replayed"])
        self.assertEqual(first["dose"]["id"], replay["dose"]["id"])

        _, appointment_body = self.request(
            "/api/hermes/appointments",
            method="POST",
            headers=headers,
            payload={
                "title": "Rheumatology follow-up",
                "starts_at": "2026-08-25T10:00:00+04:00",
                "status": "scheduled",
                "source_text": "Follow-up on August 25",
                "idempotency_key": "telegram-22:appointment-1",
            },
        )
        appointment_id = appointment_body["appointment"]["id"]
        status_code, status_body = self.request(
            f"/api/hermes/appointments/{appointment_id}",
            method="PATCH",
            headers=headers,
            payload={
                "status": "completed",
                "source_text": "Appointment completed",
                "idempotency_key": "telegram-23:appointment-status-1",
            },
        )
        replay_code, replay_body = self.request(
            f"/api/hermes/appointments/{appointment_id}",
            method="PATCH",
            headers=headers,
            payload={
                "status": "completed",
                "source_text": "Appointment completed",
                "idempotency_key": "telegram-23:appointment-status-1",
            },
        )
        self.assertEqual(status_code, 200)
        self.assertEqual(replay_code, 200)
        self.assertFalse(status_body["replayed"])
        self.assertTrue(replay_body["replayed"])
        self.assertEqual(status_body["appointment"]["status"], "completed")

    def test_existing_checkin_table_gains_blood_pressure_columns(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.db"
            with sqlite3.connect(path) as connection:
                connection.execute(
                    """
                    CREATE TABLE daily_checkins (
                        day TEXT PRIMARY KEY,
                        fasting_minutes INTEGER,
                        fasting_status TEXT,
                        activity_minutes INTEGER,
                        activity_status TEXT,
                        weight_kg REAL,
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
            RiseApp(path)
            with sqlite3.connect(path) as connection:
                columns = {row[1] for row in connection.execute("PRAGMA table_info(daily_checkins)")}
            self.assertTrue({"bp_systolic", "bp_diastolic", "pulse_bpm"}.issubset(columns))


if __name__ == "__main__":
    unittest.main()
