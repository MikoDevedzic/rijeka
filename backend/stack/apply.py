#!/usr/bin/env python3
"""
apply.py — build the Rijeka schema on a plain PostgreSQL (16), without Supabase.

Order: stack/auth_stub.sql, docs/schema.sql, docs/migrations/*.sql in filename (date) order.
Every file is split into statements (dollar quotes, strings and comments respected) and each
statement runs on its own with autocommit, so a failure names the file and the line and the
rest of the file still runs. A table `stack_migrations` records every file applied (name and
sha256); a file already recorded is skipped, which makes a second run a no-op. --reset drops
and recreates the public schema (and the stub's auth schema) first.

Supabase-only statements that are deliberately no-ops here (each is printed when skipped):
  * SET transaction_timeout      a PostgreSQL 17 setting in the pg_dump header; 16 has no such GUC
  * CREATE EXTENSION pgcrypto / "uuid-ossp"   tolerated when the server has no contrib package;
                                 gen_random_uuid() is built in and nothing else uses them
Everything else that fails is an error, listed at the end, and the exit code is 1.

Usage:
  python stack/apply.py [--database-url URL] [--reset] [--auth stub|gotrue]
    --database-url   default $RIJEKA_STACK_DATABASE_URL, then $DATABASE_URL, then postgresql:///rijeka_test
    --auth gotrue    docker-compose: GoTrue owns auth.users; the stub's CREATE TABLE IF NOT EXISTS is
                     then a no-op, and only the helpers, roles and publication are added (same file)
"""
from __future__ import annotations

import os
import sys

# Run as `python stack/<name>.py`, the script directory is sys.path[0] and stack/token.py would shadow the
# standard library's `token` (tokenize imports it). Put backend/ there instead; `python -m stack.<name>` is the
# documented form and needs nothing.
_HERE = os.path.dirname(os.path.abspath(__file__))
if sys.path and os.path.abspath(sys.path[0] or os.getcwd()) == _HERE:
    sys.path[0] = os.path.dirname(_HERE)

import argparse
import hashlib
import re
from pathlib import Path

import psycopg2

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
REPO = BACKEND.parent
DEFAULT_URL = "postgresql:///rijeka_test"

# statements that are allowed to fail, with the reason printed instead of an error
_TOLERATED = [
    (re.compile(r"^\s*SET\s+transaction_timeout\b", re.I), "PostgreSQL 17 setting in the pg_dump header; no such GUC on 16"),
    (re.compile(r"^\s*CREATE\s+EXTENSION\b", re.I), "extension not available on this server; gen_random_uuid() is built in"),
]


def hosted(url: str) -> bool:
    """A Supabase host: the same test as tests/integration/conftest.py."""
    u = url.lower()
    return "supabase.co" in u or "pooler.supabase" in u


def shown(url: str) -> str:
    """The database address without its password, for printing: a URL's (with or without a user name, or as a
    ?password= parameter) and a keyword string's."""
    out = re.sub(r"(://[^:/@]*):[^@]*@", r"\1:***@", url)
    return re.sub(r"(?i)(password\s*=\s*)('[^']*'|[^\s&]+)", r"\1***", out)


def database_url(cli: str | None, *, destructive: bool = False) -> str:
    """The database to work on: --database-url, else RIJEKA_STACK_DATABASE_URL, else DATABASE_URL, else the local
    test database. A hosted database is accepted only when it is named on the command line, and never for a
    destructive run (--reset, the seed): a developer's shell exports the hosted DATABASE_URL, and this script
    must not follow it there by default."""
    url = cli or os.environ.get("RIJEKA_STACK_DATABASE_URL") or os.environ.get("DATABASE_URL") or DEFAULT_URL
    if hosted(url):
        if destructive:
            raise SystemExit("refused: this would reset or seed a hosted database. It runs only on a local or disposable one.")
        if not cli:
            raise SystemExit("refused: the environment names a hosted database. Pass --database-url to apply the schema "
                             "to a project of your own; the local stack is RIJEKA_STACK_DATABASE_URL or the default.")
    return url


def split_statements(sql: str) -> list[tuple[int, str]]:
    """[(line, statement)] split on ';' outside strings, identifiers, comments and dollar quotes."""
    out: list[tuple[int, str]] = []
    buf: list[str] = []
    i, n, line = 0, len(sql), 1
    start_line = 1
    state = None          # None | "'" | '"' | "--" | "/*" | ("$", tag)
    while i < n:
        c = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if state is None:
            if c == "-" and nxt == "-":
                state = "--"; buf.append(c); i += 1
            elif c == "/" and nxt == "*":
                state = "/*"; buf.append(c); i += 1
            elif c == "'":
                state = "'"; buf.append(c); i += 1
            elif c == '"':
                state = '"'; buf.append(c); i += 1
            elif c == "$":
                m = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", sql[i:])
                if m:
                    tag = m.group(0); state = ("$", tag); buf.append(tag); line += tag.count("\n"); i += len(tag)
                else:
                    buf.append(c); i += 1
            elif c == ";":
                stmt = "".join(buf).strip()
                if stmt and not _only_comments(stmt):
                    out.append((start_line, stmt))
                buf = []; i += 1
                start_line = line
            else:
                if not buf and not c.isspace():
                    start_line = line
                buf.append(c); i += 1
        elif state == "--":
            buf.append(c); i += 1
            if c == "\n":
                state = None
        elif state == "/*":
            buf.append(c); i += 1
            if c == "*" and nxt == "/":
                buf.append(nxt); i += 1; state = None
        elif state == "'":
            buf.append(c); i += 1
            if c == "'":
                if nxt == "'":
                    buf.append(nxt); i += 1
                else:
                    state = None
        elif state == '"':
            buf.append(c); i += 1
            if c == '"':
                state = None
        else:                                   # dollar quote
            tag = state[1]
            if sql.startswith(tag, i):
                buf.append(tag); i += len(tag); state = None
                continue
            buf.append(c); i += 1
        if c == "\n":
            line += 1
    tail = "".join(buf).strip()
    if tail and not _only_comments(tail):
        out.append((start_line, tail))
    return out


def _only_comments(stmt: str) -> bool:
    return all(not l.strip() or l.strip().startswith("--") for l in stmt.splitlines())


def _summary(stmt: str) -> str:
    s = re.sub(r"\s+", " ", re.sub(r"--[^\n]*", "", stmt)).strip()
    return s[:90] + ("…" if len(s) > 90 else "")


def connect(url: str):
    conn = psycopg2.connect(url)
    conn.autocommit = True
    return conn


def ensure_ledger(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.stack_migrations (
                name        text PRIMARY KEY,
                sha256      text NOT NULL,
                applied_at  timestamptz NOT NULL DEFAULT now(),
                statements  integer NOT NULL,
                skipped     integer NOT NULL DEFAULT 0
            )""")


def applied(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute("SELECT name, sha256 FROM public.stack_migrations")
        return dict(cur.fetchall())


def run_file(url: str, path: Path, label: str, auth_mode: str, errors: list[str]) -> tuple[int, int]:
    """Run one file on a fresh connection (the pg_dump header sets search_path = '' for its session;
    the migrations rely on the default). Returns (statements run, statements skipped)."""
    sql = path.read_text(encoding="utf-8")
    stmts = split_statements(sql)
    if auth_mode == "gotrue" and path.name == "auth_stub.sql":
        stmts = [(ln, s) for ln, s in stmts if not re.match(r"^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+auth\.users\b", s, re.I)]
        print(f"  {label}: --auth gotrue, auth.users left to GoTrue's own migrations")
    ran = skipped = 0
    conn = connect(url)
    try:
        with conn.cursor() as cur:
            for ln, stmt in stmts:
                try:
                    cur.execute(stmt)
                    ran += 1
                except psycopg2.Error as e:
                    msg = (e.pgerror or str(e)).strip().splitlines()[0]
                    reason = next((why for rx, why in _TOLERATED if rx.match(stmt)), None)
                    if reason:
                        skipped += 1
                        print(f"  skip {label}:{ln}  {_summary(stmt)}  — {reason}")
                    else:
                        errors.append(f"{label}:{ln}  {_summary(stmt)}\n      {msg}")
                        print(f"  FAIL {label}:{ln}  {_summary(stmt)}\n      {msg}")
    finally:
        conn.close()
    return ran, skipped


def record(conn, name: str, sha: str, ran: int, skipped: int) -> None:
    with conn.cursor() as cur:
        cur.execute("""INSERT INTO public.stack_migrations (name, sha256, statements, skipped) VALUES (%s, %s, %s, %s)
                       ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = now(),
                       statements = EXCLUDED.statements, skipped = EXCLUDED.skipped""", (name, sha, ran, skipped))


def reset(url: str) -> None:
    conn = connect(url)
    try:
        with conn.cursor() as cur:
            cur.execute("DROP SCHEMA IF EXISTS public CASCADE")
            cur.execute("DROP SCHEMA IF EXISTS auth CASCADE")
            cur.execute("CREATE SCHEMA public")
            cur.execute("DROP PUBLICATION IF EXISTS supabase_realtime")
        print("reset: public and auth schemas dropped and public recreated")
    finally:
        conn.close()


def check_role(conn) -> None:
    """The schema FORCEs row-level security on the trade tables and every policy reads auth.uid(), which
    is NULL here: a role that is neither superuser nor BYPASSRLS would see no rows. Say so up front."""
    with conn.cursor() as cur:
        cur.execute("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
        name, sup, byp = cur.fetchone()
        cur.execute("SHOW server_version")
        ver = cur.fetchone()[0]
    print(f"connected as {name} (superuser={sup}, bypassrls={byp}), PostgreSQL {ver}")
    if not (sup or byp):
        print("WARNING: this role is subject to the schema's FORCE ROW LEVEL SECURITY and will read no rows; "
              "connect the API as a superuser or a role with BYPASSRLS")


def files() -> list[tuple[str, Path]]:
    out = [("stack/auth_stub.sql", HERE / "auth_stub.sql"), ("docs/schema.sql", REPO / "docs" / "schema.sql")]
    out += [(f"docs/migrations/{p.name}", p) for p in sorted((REPO / "docs" / "migrations").glob("*.sql"))]
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--database-url", default=None)
    ap.add_argument("--reset", action="store_true", help="drop and recreate the public (and stub auth) schema first")
    ap.add_argument("--auth", choices=("stub", "gotrue"), default="stub")
    args = ap.parse_args(argv)
    url = database_url(args.database_url, destructive=args.reset)
    print(f"apply: {shown(url)}")
    if args.reset:
        reset(url)
    conn = connect(url)
    try:
        check_role(conn)
        ensure_ledger(conn)
        done = applied(conn)
        errors: list[str] = []
        total = 0
        for label, path in files():
            if not path.exists():
                errors.append(f"{label}: file not found")
                continue
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            if label in done:
                note = "" if done[label] == sha else "  (file changed since; use --reset to re-apply)"
                print(f"  already applied {label}{note}")
                continue
            print(f"applying {label}")
            before = len(errors)
            ran, skipped = run_file(url, path, label, args.auth, errors)
            total += ran
            if len(errors) == before:
                record(conn, label, sha, ran, skipped)
            else:
                print(f"  {label}: {len(errors) - before} statement(s) failed; not recorded as applied")
        print(f"done: {total} statements run")
        if errors:
            print("\nERRORS")
            for e in errors:
                print("  " + e)
            return 1
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
