#!/usr/bin/env python3
"""Send due Rise follow-ups and upcoming appointments to Telegram once."""

from __future__ import annotations

import argparse
import html
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


LOCAL_ZONE = ZoneInfo("Asia/Dubai")


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set")
    return value


def timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("use a timezone-aware ISO 8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("timestamp must include a timezone offset")
    return parsed


def target_parts(value: str) -> tuple[int, int | None]:
    raw = value.removeprefix("telegram:")
    parts = raw.split(":", 1)
    try:
        chat_id = int(parts[0])
        thread_id = int(parts[1]) if len(parts) == 2 and parts[1] else None
    except ValueError as exc:
        raise RuntimeError("TELEGRAM_HOME_CHANNEL must contain numeric chat and thread IDs") from exc
    return chat_id, thread_id


def load_state(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"notifications": {}}
    if not isinstance(value, dict) or not isinstance(value.get("notifications"), dict):
        return {"notifications": {}}
    return value


def save_state(path: Path, state: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def fetch_care(api_url: str, token: str, day: str) -> dict[str, object]:
    query = urlencode({"day": day})
    endpoint = f"{api_url.rstrip('/')}/api/hermes/care?{query}"
    request = Request(
        endpoint,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=15) as response:
            value = json.loads(response.read())
    except HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Rise rejected care reminder check ({exc.code}): {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"could not reach Rise at {endpoint}: {exc.reason}") from exc
    if not isinstance(value, dict):
        raise RuntimeError("Rise returned an invalid care response")
    return value


def notification_candidates(
    care: dict[str, object], now: datetime, appointment_hours: int
) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    for item in care.get("reminders", []):
        if not isinstance(item, dict) or item.get("status") != "pending":
            continue
        due_at = timestamp(str(item.get("due_at")))
        if due_at > now:
            continue
        candidates.append(
            {
                "key": f"reminder:{item.get('id')}:{item.get('updated_at')}",
                "kind": "reminder",
                "title": str(item.get("title") or "Follow-up"),
                "when": due_at.astimezone(LOCAL_ZONE).strftime("%a %d %b, %I:%M %p"),
            }
        )

    cutoff = now + timedelta(hours=appointment_hours)
    for item in care.get("appointments", []):
        if not isinstance(item, dict) or item.get("status") != "scheduled":
            continue
        starts_at = timestamp(str(item.get("starts_at")))
        if starts_at < now or starts_at > cutoff:
            continue
        title = item.get("title") or item.get("provider") or "Appointment"
        candidates.append(
            {
                "key": f"appointment:{item.get('id')}:{item.get('starts_at')}",
                "kind": "appointment",
                "title": str(title),
                "when": starts_at.astimezone(LOCAL_ZONE).strftime("%a %d %b, %I:%M %p"),
            }
        )
    return candidates


def message_for(items: list[dict[str, str]]) -> str:
    lines = ["<b>Rise care reminder</b>", ""]
    for item in items:
        label = "Follow-up due" if item["kind"] == "reminder" else "Upcoming appointment"
        lines.append(f"• <b>{label}</b>: {html.escape(item['title'])}")
        lines.append(f"  {html.escape(item['when'])}")
    lines.extend(["", "Open Rise to review or mark it done."])
    return "\n".join(lines)


def send_telegram(
    token: str,
    chat_id: int,
    thread_id: int | None,
    text: str,
    public_url: str,
) -> int:
    payload: dict[str, object] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
        "reply_markup": {
            "inline_keyboard": [[{"text": "Open Rise", "url": public_url.rstrip("/") + "/#care"}]]
        },
    }
    if thread_id is not None:
        payload["message_thread_id"] = thread_id
    request = Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read())
    except HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Telegram rejected care reminder ({exc.code}): {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Telegram care reminder delivery failed: {exc.reason}") from exc
    if not result.get("ok"):
        raise RuntimeError("Telegram did not acknowledge care reminder delivery")
    return int(result["result"]["message_id"])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Send due Rise follow-ups and upcoming appointments once"
    )
    parser.add_argument("--now", type=timestamp, help="override current time for deterministic tests")
    parser.add_argument("--appointment-hours", type=int, default=24)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="ignore prior delivery state")
    args = parser.parse_args()
    if args.appointment_hours < 1 or args.appointment_hours > 168:
        parser.error("--appointment-hours must be between 1 and 168")

    now = args.now or datetime.now(LOCAL_ZONE)
    api_url = os.environ.get("RISE_API_URL", "http://127.0.0.1:8787")
    care = fetch_care(api_url, required_env("RISE_HERMES_TOKEN"), now.date().isoformat())
    state_path = Path(
        os.environ.get("RISE_CARE_REMINDER_STATE", "/root/.hermes/state/rise-care-reminders.json")
    )
    state = load_state(state_path)
    delivered = state["notifications"]
    assert isinstance(delivered, dict)
    candidates = notification_candidates(care, now, args.appointment_hours)
    pending = candidates if args.force else [item for item in candidates if item["key"] not in delivered]

    if args.dry_run:
        print(json.dumps({"now": now.isoformat(), "notifications": pending}, indent=2))
        return 0
    if not pending:
        return 0

    public_url = required_env("RISE_PUBLIC_URL")
    chat_id, thread_id = target_parts(required_env("TELEGRAM_HOME_CHANNEL"))
    message_id = send_telegram(
        required_env("TELEGRAM_BOT_TOKEN"),
        chat_id,
        thread_id,
        message_for(pending),
        public_url,
    )
    sent_at = datetime.now(LOCAL_ZONE).isoformat(timespec="seconds")
    for item in pending:
        delivered[item["key"]] = {"sent_at": sent_at, "message_id": message_id}
    save_state(state_path, state)
    print(f"Sent {len(pending)} Rise care reminder(s) in Telegram message {message_id}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"Care reminders not sent: {exc}", file=sys.stderr)
        raise SystemExit(1)
