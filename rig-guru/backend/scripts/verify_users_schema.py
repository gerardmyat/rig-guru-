"""Print Users table columns (checks googleSub). Same DATABASE_URL as the API."""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine, text  # noqa: E402

from rig_guru.database import DATABASE_URL  # noqa: E402
from rig_guru.env import load_backend_dotenv  # noqa: E402


def main() -> None:
    load_backend_dotenv()
    tail = DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else DATABASE_URL
    print(f"DATABASE_URL host/db: @{tail}")
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
    q = text(
        """
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('Users', 'users')
        ORDER BY table_name, ordinal_position;
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(q).fetchall()
    if not rows:
        print("No public.Users / public.users table found.")
        sys.exit(1)
    for r in rows:
        print(f"  {r[0]}.{r[1]}  ({r[2]})")
    names = {r[1] for r in rows}
    if "googleSub" in names:
        print("\nOK: googleSub is present. Restart API if you still see errors.")
    else:
        print("\nMISSING: googleSub — run:  python scripts/run_migration_auth.py")
        sys.exit(2)


if __name__ == "__main__":
    main()
