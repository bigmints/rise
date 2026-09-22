#!/usr/bin/env python3
"""Send idempotent Rise check-ins through Hermes's configured Telegram bot."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


DUBAI = ZoneInfo("Asia/Dubai")


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not configured")
    return value


def target_parts(raw: str) -> tuple[str, int | None]:
    value = raw.removeprefix("telegram:")
    parts = value.split(":")
    try:
        chat_id = parts[0]
        thread_id = int(parts[1]) if len(parts) > 1 and parts[1] else None
    except ValueError as exc:
        raise RuntimeError("TELEGRAM_HOME_CHANNEL has an invalid thread id") from exc
    if not chat_id:
        raise RuntimeError("TELEGRAM_HOME_CHANNEL has no chat id")
    return chat_id, thread_id


def signed_url(public_url: str, secret: str, day: str, field: str, value: str) -> str:
    expires = int((datetime.now(timezone.utc) + timedelta(hours=36)).timestamp())
    message = f"{day}|{field}|{value}|{expires}"
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    query = urlencode(
        {"day": day, "field": field, "value": value, "expires": expires, "sig": signature}
    )
    return f"{public_url.rstrip('/')}/quick-checkin?{query}"


def button(text: str, url: str) -> dict[str, str]:
    return {"text": text, "url": url}


def message_for(mode: str, public_url: str, secret: str, day: str, *, test: bool) -> tuple[str, dict]:
    quick = lambda field, value: signed_url(public_url, secret, day, field, value)
    prefix = "🧪 <b>Rise setup test</b>\n\n" if test else ""
    if mode == "morning":
        text = (
            prefix
            + "☀️ <b>Morning check-in</b>\n\n"
            + "How rested do you feel? Then tap your sleep hours. "
            + "Open Rise to add weight or exact times."
        )
        keyboard = {
            "inline_keyboard": [
                [
                    button("Rested", quick("rested", "yes")),
                    button("Okay", quick("rested", "somewhat")),
                    button("Tired", quick("rested", "no")),
                ],
                [
                    button("6h", quick("sleep_minutes", "360")),
                    button("7h", quick("sleep_minutes", "420")),
                    button("8h", quick("sleep_minutes", "480")),
                    button("9h", quick("sleep_minutes", "540")),
                ],
                [button("Open Rise · weight, BP + details", public_url.rstrip("/") + "/#checkin")],
            ]
        }
    else:
        text = (
            prefix
            + "🌙 <b>Evening check-in</b>\n\n"
            + "Tap one activity choice and one fasting choice. "
            + "Rise tracks actuals and explicit skips—not assumptions."
        )
        keyboard = {
            "inline_keyboard": [
                [
                    button("Move 60m", quick("activity", "60")),
                    button("45m", quick("activity", "45")),
                    button("30m", quick("activity", "30")),
                    button("Skipped", quick("activity", "skipped")),
                ],
                [
                    button("Fast 20h", quick("fasting", "1200")),
                    button("18h", quick("fasting", "1080")),
                    button("16h", quick("fasting", "960")),
                    button("Skipped", quick("fasting", "skipped")),
                ],
                [button("Open Rise · exact values", public_url.rstrip("/") + "/#checkin")],
            ]
        }
    return text, keyboard


def load_state(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, separators=(",", ":")))
    temporary.replace(path)
    path.chmod(0o600)


def send_telegram(token: str, chat_id: str, thread_id: int | None, text: str, keyboard: dict) -> int:
    payload: dict[str, object] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "reply_markup": keyboard,
        "disable_web_page_preview": True,
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
        raise RuntimeError(f"Telegram rejected check-in ({exc.code})") from exc
    except URLError as exc:
        raise RuntimeError(f"Telegram check-in delivery failed: {exc.reason}") from exc
    if not result.get("ok"):
        raise RuntimeError("Telegram did not acknowledge check-in delivery")
    return int(result["result"]["message_id"])


def choose_mode(now: datetime, forced: str | None) -> str | None:
    if forced:
        return forced
    if 8 <= now.hour <= 10:
        return "morning"
    if 21 <= now.hour <= 23:
        return "evening"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Send a Rise Telegram check-in")
    parser.add_argument("--force", choices=["morning", "evening"])
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    now = datetime.now(DUBAI)
    mode = choose_mode(now, args.force)
    if mode is None:
        return 0
    day = now.date().isoformat()
    state_path = Path(os.environ.get("RISE_CHECKIN_STATE", "/root/.hermes/state/rise-checkins.json"))
    state = load_state(state_path)
    state_key = f"{day}:{mode}"
    if not args.force and state_key in state:
        return 0

    public_url = required_env("RISE_PUBLIC_URL")
    secret = required_env("RISE_CHECKIN_SECRET")
    text, keyboard = message_for(mode, public_url, secret, day, test=args.test)
    if args.dry_run:
        print(json.dumps({"mode": mode, "day": day, "rows": [[item["text"] for item in row] for row in keyboard["inline_keyboard"]]}))
        return 0

    token = required_env("TELEGRAM_BOT_TOKEN")
    chat_id, thread_id = target_parts(required_env("TELEGRAM_HOME_CHANNEL"))
    message_id = send_telegram(token, chat_id, thread_id, text, keyboard)
    state[state_key] = {"message_id": message_id, "sent_at": now.isoformat(timespec="seconds")}
    save_state(state_path, state)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"Rise check-in not sent: {exc}", file=sys.stderr)
        raise SystemExit(1)
