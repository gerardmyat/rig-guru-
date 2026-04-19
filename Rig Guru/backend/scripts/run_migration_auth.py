"""
Apply backend/scripts/migration_auth.sql using DATABASE_URL from backend/.env.

Usage (from repo):
    cd backend
    python scripts/run_migration_auth.py
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine, text  # noqa: E402

from rig_guru.database import DATABASE_URL  # noqa: E402
from rig_guru.env import load_backend_dotenv  # noqa: E402


def _strip_line_comments(sql: str) -> str:
    lines: list[str] = []
    for line in sql.splitlines():
        c = line.find("--")
        if c >= 0:
            line = line[:c]
        lines.append(line)
    return "\n".join(lines)


def _split_sql(sql: str) -> list[str]:
    """
    Split into executable statements. PostgreSQL DO $tag$ ... $tag$ blocks must stay intact
    (naive ';' splitting breaks them).
    """
    text = _strip_line_comments(sql)
    text = text.strip()
    if not text:
        return []

    marker = "DO $migration$"
    if marker in text:
        start = text.index(marker)
        end_kw = "END $migration$;"
        end = text.index(end_kw, start) + len(end_kw)
        first = text[start:end].strip()
        rest = text[end:].strip()
        out: list[str] = [first]
        for chunk in rest.split(";"):
            s = chunk.strip()
            if s:
                out.append(s + ";")
        return out

    # Fallback: single-statement files or no DO block
    parts: list[str] = []
    blob = " ".join(line.strip() for line in text.splitlines() if line.strip())
    for chunk in blob.split(";"):
        s = chunk.strip()
        if s:
            parts.append(s + ";")
    return parts


def main() -> None:
    load_backend_dotenv()
    sql_path = Path(__file__).parent / "migration_auth.sql"
    if not sql_path.is_file():
        print(f"Missing {sql_path}", file=sys.stderr)
        sys.exit(1)

    raw = sql_path.read_text(encoding="utf-8")
    statements = _split_sql(raw)
    if not statements:
        print("No SQL statements found.", file=sys.stderr)
        sys.exit(1)

    tail = DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else DATABASE_URL
    print(f"Database: {tail}")
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
    with engine.begin() as conn:
        for i, stmt in enumerate(statements, 1):
            preview = stmt.replace("\n", " ")[:100]
            print(f"[{i}/{len(statements)}] {preview}...")
            conn.execute(text(stmt))
    print("Migration finished OK.")
    print("Restart the API, then try Register again.")


if __name__ == "__main__":
    main()
