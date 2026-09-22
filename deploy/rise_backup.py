#!/usr/bin/env python3
"""Create a consistent SQLite backup and retain the latest 30 copies."""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


SOURCE = Path(os.environ.get("RISE_DB_PATH", "/opt/rise/data/rise.db"))
BACKUP_DIR = Path("/opt/rise/backups")
KEEP = 30


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Rise database does not exist: {SOURCE}")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    destination = BACKUP_DIR / f"rise-{stamp}.db"
    with sqlite3.connect(SOURCE) as source, sqlite3.connect(destination) as backup:
        source.backup(backup)
    backups = sorted(BACKUP_DIR.glob("rise-*.db"), reverse=True)
    for old_backup in backups[KEEP:]:
        old_backup.unlink()
    print(destination)


if __name__ == "__main__":
    main()
