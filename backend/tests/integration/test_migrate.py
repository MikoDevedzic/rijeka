"""The migration runner on a real PostgreSQL (the local stack): a file with a `$$` body and a `%` is applied in
one transaction with its ledger row, a second run does nothing, an edited file is `changed` and never applied
again, a failing file leaves no ledger row and no object behind and stops the entries after it, the timeouts
do not outlive the transaction, the search path is pinned to public for the file and only for it, and a process
that starts beside one in the middle of a migration applies nothing, says `busy` and does not wait for it. The runner is pointed at a temporary directory of approved copies and a temporary manifest;
the real manifest and db/approved are never used here. Everything
the test writes (the probe tables, the functions, its ledger rows) is removed at the end."""
from __future__ import annotations

import hashlib
import threading
import time

import pytest
from sqlalchemy import create_engine, text

from tests.integration.conftest import STACK_URL

pytestmark = pytest.mark.integration

PROBE = "2099-01-01_zz_migrate_probe.sql"
BAD = "2099-01-02_zz_migrate_probe_bad.sql"
LATER = "2099-01-03_zz_migrate_probe_later.sql"
NAMES = (PROBE, BAD, LATER)
APPROVAL = '# the integration test, 2099-01-01, "apply it to the local stack"'

GOOD_SQL = """-- a harmless migration: a table, a function with a $$ body (a % and a ; inside it), row-level security
CREATE TABLE IF NOT EXISTS zz_migrate_probe (
  id    integer PRIMARY KEY,
  note  text NOT NULL DEFAULT 'it''s 100% fine; really'     -- DROP TABLE in a comment is not a statement
);
CREATE OR REPLACE FUNCTION zz_migrate_probe_fn(n integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF n % 2 = 0 THEN
    RETURN 'even; ' || n;
  END IF;
  RETURN format('odd %s', n);
END $$;
INSERT INTO zz_migrate_probe (id) VALUES (1);
ALTER TABLE zz_migrate_probe ENABLE ROW LEVEL SECURITY;
"""
# fails at run time, after its table and its function exist inside the transaction
BAD_SQL = """CREATE TABLE zz_migrate_probe_bad (id integer PRIMARY KEY);
ALTER TABLE zz_migrate_probe_bad ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION zz_migrate_probe_bad_fn() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
INSERT INTO zz_migrate_probe (id) VALUES (2);
INSERT INTO zz_migrate_probe_bad (id) VALUES (1), (1);
"""
LATER_SQL = "CREATE TABLE zz_migrate_probe_later (id integer PRIMARY KEY);\nALTER TABLE zz_migrate_probe_later ENABLE ROW LEVEL SECURITY;\n"

CLEAN = (
    "DROP TABLE IF EXISTS public.zz_migrate_probe",
    "DROP TABLE IF EXISTS public.zz_migrate_probe_bad",
    "DROP TABLE IF EXISTS public.zz_migrate_probe_later",
    "DROP FUNCTION IF EXISTS public.zz_migrate_probe_fn(integer)",
    "DROP FUNCTION IF EXISTS public.zz_migrate_probe_bad_fn()",
)


def sha(sql: str) -> str:
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()


def _clean(engine) -> None:
    with engine.begin() as c:
        for stmt in CLEAN:
            c.execute(text(stmt))
        if c.execute(text("SELECT to_regclass('public.schema_migrations')")).scalar() is not None:
            c.execute(text("DELETE FROM public.schema_migrations WHERE name = ANY(:n)"), {"n": list(NAMES)})


@pytest.fixture
def engine(monkeypatch):
    """One pooled connection to the stack's database (so a setting that leaked from a migration would be seen
    by the next statement), this process allowed to migrate, and the module's memory put back afterwards."""
    from db import migrate
    assert "supabase" not in STACK_URL
    e = create_engine(STACK_URL, pool_size=1, max_overflow=0)
    with e.connect() as c:
        assert c.execute(text("SELECT current_database()")).scalar() == "rijeka_test", "these tests write a schema: the local stack only"
    monkeypatch.setenv("RIJEKA_MIGRATE", "1")
    saved = dict(migrate._last)
    migrate._last.update(at=None, applied=[], problems={})
    _clean(e)
    try:
        yield e
    finally:
        migrate._last.update(saved)
        _clean(e)
        e.dispose()


def book(tmp_path, files: dict) -> tuple:
    d = tmp_path / "migrations"
    d.mkdir(exist_ok=True)
    lines = []
    for name, sql in files.items():
        (d / name).write_bytes(sql.encode("utf-8"))
        lines.append(f"{name}  {sha(sql)}  -  {APPROVAL}")
    m = tmp_path / "approved.txt"
    m.write_text("# the test's manifest\n\n" + "\n".join(lines) + "\n", encoding="utf-8")
    return m, d


def one(engine, sql: str, **params):
    with engine.connect() as c:
        return c.execute(text(sql), params).first()


def _all(engine, sql: str, **params) -> list:
    with engine.connect() as c:
        return c.execute(text(sql), params).all()


def exists(engine, relation: str) -> bool:
    return one(engine, "SELECT to_regclass(:r)", r=f"public.{relation}")[0] is not None


def test_apply_once_then_changed_then_a_failure_rolls_back_completely(engine, tmp_path):
    from db import migrate
    m, d = book(tmp_path, {PROBE: GOOD_SQL})

    # 1. applied: the objects, the ledger row, row-level security on both tables
    out = migrate.run(engine, m, d)
    assert out == {"enabled": True, "applied": [PROBE], "pending": [], "problems": {}, "last_run": out["last_run"]}
    assert one(engine, "SELECT id, note FROM zz_migrate_probe") == (1, "it's 100% fine; really")
    assert one(engine, "SELECT zz_migrate_probe_fn(4), zz_migrate_probe_fn(3)") == ("even; 4", "odd 3")
    row = one(engine, "SELECT name, sha256, statements, runner, applied_at FROM public.schema_migrations WHERE name = :n", n=PROBE)
    assert row[:3] == (PROBE, sha(GOOD_SQL), 4) and row.runner.startswith("api@") and row.applied_at is not None
    assert one(engine, "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.schema_migrations'::regclass")[0] is True
    assert one(engine, "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.zz_migrate_probe'::regclass")[0] is True
    # the timeouts and the string setting were local to the migration's transaction (one pooled connection)
    assert one(engine, "SELECT current_setting('lock_timeout'), current_setting('statement_timeout')") == ("0", "0")

    # 2. a second run is a no-op: same row, same time, the INSERT did not run again
    again = migrate.run(engine, m, d)
    assert again["applied"] == [PROBE] and again["problems"] == {}
    assert one(engine, "SELECT applied_at FROM public.schema_migrations WHERE name = :n", n=PROBE)[0] == row.applied_at
    assert one(engine, "SELECT count(*) FROM zz_migrate_probe")[0] == 1
    assert one(engine, "SELECT count(*) FROM public.schema_migrations WHERE name = :n", n=PROBE)[0] == 1

    # 3. the file is edited and approved again: an applied migration is immutable, nothing is done
    edited = GOOD_SQL + "INSERT INTO zz_migrate_probe (id) VALUES (99);\n"
    m, d = book(tmp_path, {PROBE: edited})
    out = migrate.run(engine, m, d)
    assert out["problems"] == {PROBE: "changed"} and out["applied"] == [] and out["pending"] == []
    assert one(engine, "SELECT sha256 FROM public.schema_migrations WHERE name = :n", n=PROBE)[0] == sha(GOOD_SQL)
    assert one(engine, "SELECT count(*) FROM zz_migrate_probe")[0] == 1

    # 4. a file that fails at run time: no ledger row, no table, no function, no row in the table it wrote to
    #    before failing, and the entry after it is not attempted
    m, d = book(tmp_path, {PROBE: GOOD_SQL, BAD: BAD_SQL, LATER: LATER_SQL})
    out = migrate.run(engine, m, d)                                           # does not raise
    assert out["applied"] == [PROBE] and out["pending"] == [BAD, LATER]
    assert out["problems"] == {BAD: "failed: UniqueViolation 23505", LATER: migrate.BLOCKED}
    assert not exists(engine, "zz_migrate_probe_bad") and not exists(engine, "zz_migrate_probe_later")
    assert one(engine, "SELECT to_regprocedure('public.zz_migrate_probe_bad_fn()')")[0] is None
    assert one(engine, "SELECT count(*) FROM zz_migrate_probe")[0] == 1       # the INSERT of id 2 went with the rollback
    assert one(engine, "SELECT count(*) FROM public.schema_migrations WHERE name = ANY(:n)", n=[BAD, LATER])[0] == 0
    assert one(engine, "SELECT current_setting('lock_timeout'), current_setting('statement_timeout')") == ("0", "0")
    assert "zz_migrate" not in str(out["problems"].values()) and "INSERT" not in str(out)

    # 5. a file the server cannot parse fails as a whole, the same way
    m, d = book(tmp_path, {PROBE: GOOD_SQL, BAD: "CREATE TABLE zz_migrate_probe_bad (id integer PRIMARY KEY);\n"
                                                    "ALTER TABLE zz_migrate_probe_bad ENABLE ROW LEVEL SECURITY;\nCREATE TABEL oops (id int);\n"})
    out = migrate.run(engine, m, d)
    assert out["problems"] == {BAD: "failed: SyntaxError 42601"} and not exists(engine, "zz_migrate_probe_bad")

    # 6. once the failing file is gone from the manifest the later one applies, in its own transaction
    m, d = book(tmp_path, {PROBE: GOOD_SQL, LATER: LATER_SQL})
    out = migrate.run(engine, m, d)
    assert out["applied"] == [PROBE, LATER] and out["problems"] == {} and exists(engine, "zz_migrate_probe_later")


def _run_beside(engine, m, d, limit: float) -> tuple[dict, float]:
    """migrate.run in a thread, so a runner that waits fails the test instead of hanging it."""
    from db import migrate
    result: dict = {}
    t0 = time.monotonic()
    t = threading.Thread(target=lambda: result.update(migrate.run(engine, m, d)), daemon=True)
    t.start()
    t.join(limit)
    assert not t.is_alive(), f"the runner was still waiting on the other instance after {limit} s"
    return result, time.monotonic() - t0


def test_a_start_beside_an_instance_that_is_mid_migration_is_busy_and_does_not_wait(engine, tmp_path):
    """Two API processes start together. The other one is in the middle of a migration exactly as this module
    runs one: the advisory lock, the settings, its own DDL, its ledger row, not yet committed. This one tries
    the lock once, applies nothing, says `busy` and returns at once. Once the other is done the next run applies."""
    from db import migrate
    m, d = book(tmp_path, {PROBE: GOOD_SQL, LATER: LATER_SQL})
    other = create_engine(STACK_URL)                                          # the instance that got there first
    try:
        with other.begin() as c:                                              # a ledger from an earlier deploy
            c.execute(text(migrate.LEDGER_CREATE))
            c.execute(text(migrate.LEDGER_RLS))
        with other.connect() as holder:
            tx = holder.begin()
            assert holder.execute(text(migrate.LOCK_TRY)).scalar() is True
            holder.execute(text(f"SET LOCAL lock_timeout = '{migrate.LOCK_TIMEOUT}'"))
            holder.execute(text(f"SET LOCAL search_path = {migrate.SEARCH_PATH}"))
            assert holder.execute(text(migrate.LEDGER_EXISTS)).scalar() is not None      # so no DDL on the ledger
            holder.execute(text("SELECT sha256 FROM public.schema_migrations WHERE name = :n"), {"n": PROBE})
            holder.execute(text(LATER_SQL.split(";")[0]))                     # the migration's own DDL, mid-way
            holder.execute(text("INSERT INTO public.schema_migrations (name, sha256, statements, runner) VALUES (:n, :s, 2, 'the other instance')"),
                           {"n": LATER, "s": sha(LATER_SQL)})
            result, took = _run_beside(engine, m, d, 10)
            assert took < 1.5, f"{took:.1f} s: the runner waited on the other instance"
            assert result["applied"] == [] and result["pending"] == [PROBE, LATER]
            assert result["problems"] == {"run": "busy: another instance is applying"}
            assert not exists(engine, "zz_migrate_probe")
            assert one(engine, "SELECT count(*) FROM public.schema_migrations WHERE name = ANY(:n)", n=list(NAMES))[0] == 0
            # the lock is still the holder's: the runner's try took nothing and left nothing behind
            assert one(engine, migrate.LOCK_TRY)[0] is False
            tx.rollback()                                                     # the other instance is done (here: gave up)
        out = migrate.run(engine, m, d)
        assert out["applied"] == [PROBE, LATER] and out["pending"] == [] and out["problems"] == {}
        assert exists(engine, "zz_migrate_probe") and exists(engine, "zz_migrate_probe_later")
        assert one(engine, "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.schema_migrations'::regclass")[0] is True
    finally:
        other.dispose()


def test_a_ledger_locked_by_the_other_instance_is_busy_within_the_read_timeout(engine, tmp_path):
    """The case Edgar found: the instance mid-migration holds an exclusive lock on the ledger itself (an
    earlier version of this module altered it at every apply) as well as the advisory lock. The first read
    gives up after READ_LOCK_TIMEOUT and the run is `busy`; nothing waits for the other transaction to end."""
    from db import migrate
    assert migrate.READ_LOCK_TIMEOUT == "2s" and migrate.LOCK_TIMEOUT == "5s" and migrate.STATEMENT_TIMEOUT == "60s"
    m, d = book(tmp_path, {PROBE: GOOD_SQL})
    other = create_engine(STACK_URL)
    try:
        with other.begin() as c:
            c.execute(text(migrate.LEDGER_CREATE))
        with other.connect() as holder:
            tx = holder.begin()
            holder.execute(text(f"SELECT pg_advisory_xact_lock({migrate.ADVISORY_LOCK_KEY})"))
            holder.execute(text(migrate.LEDGER_RLS))                          # ACCESS EXCLUSIVE on the ledger until this transaction ends
            result, took = _run_beside(engine, m, d, 10)
            assert 1.5 < took < 4.5, f"{took:.1f} s: the read should give up after about 2 s"
            assert result["applied"] == [] and result["pending"] == [PROBE]
            assert result["problems"] == {"run": "busy: another instance is applying"}
            assert not exists(engine, "zz_migrate_probe")
            tx.rollback()
        # the lock timeout of the read did not stay on the pooled connection
        assert one(engine, "SELECT current_setting('lock_timeout'), current_setting('statement_timeout')") == ("0", "0")
        assert migrate.run(engine, m, d)["applied"] == [PROBE]
    finally:
        other.dispose()


def test_the_search_path_is_pinned_for_the_migration_and_only_for_it(engine, tmp_path):
    """A pooled connection may carry any search path; the file's unqualified CREATE TABLE lands in public, where
    the presence checks look, and the connection's own setting is as it was afterwards."""
    from db import migrate
    m, d = book(tmp_path, {PROBE: GOOD_SQL})
    with engine.begin() as c:
        c.execute(text("SET search_path = pg_catalog"))                       # session-level, on the one pooled connection
    try:
        assert one(engine, "SELECT current_setting('search_path')")[0] == "pg_catalog"
        out = migrate.run(engine, m, d)
        assert out["applied"] == [PROBE] and out["problems"] == {}
        assert one(engine, "SELECT current_setting('search_path')")[0] == "pg_catalog"
        assert one(engine, "SELECT schemaname FROM pg_catalog.pg_tables WHERE tablename = 'zz_migrate_probe'")[0] == "public"
        assert one(engine, "SELECT pronamespace::regnamespace::text FROM pg_catalog.pg_proc WHERE proname = 'zz_migrate_probe_fn'")[0] == "public"
        assert one(engine, "SELECT count(*) FROM public.schema_migrations WHERE name = :n", n=PROBE)[0] == 1
    finally:
        with engine.begin() as c:
            c.execute(text("RESET search_path"))


# (text, whether the server runs the final SELECT 42 as a statement). Each ends with SELECT 42 somewhere: live
# when the reader's last statement is SELECT 42, and then the server's last result is 42.
LEXER = [
    ("SELECT E'\\''; SELECT 42", True),
    ("SELECT '\\'; SELECT 42", True),                                         # no backslash escapes in a plain literal
    ("SELECT 'it''s'; SELECT 42", True),
    ("SELECT 'x' -- a comment ends at a carriage return too\r; SELECT 42", True),
    ("SELECT 'x' /* a /* nested */ comment */; SELECT 42", True),
    ("SELECT $a$ $$ ; $a$; SELECT 42", True),
    ("SELECT 'x' AS \"a\"\"b;\"; SELECT 42", True),
    ("SELECT 'x' -- ; SELECT 42", False),
    ("SELECT 'x' /* a /* nested */ ; SELECT 42 */", False),
    ("SELECT 'a'\n'; SELECT 42 --'", False),                                  # a literal continued on the next line
    ("SELECT E'a' -- a comment in between\n'\\'; SELECT 42 --'", False),       # ... in escape mode
    ("SELECT e'a'\r'\\'; SELECT 42 --'", False),
    ("SELECT U&'\\0027; SELECT 42 --'", False),
    ("SELECT $q$ ; SELECT 42 $q$", False),
    ("SELECT 'x' AS \"; SELECT 42 --\"", False),
]


@pytest.mark.parametrize("sql, live", LEXER)
def test_the_guard_and_the_server_agree_on_where_a_literal_or_a_comment_ends(engine, sql, live):
    """The guard is only as good as its reading of strings and comments: here the server reads the same text,
    under the setting the runner applies, and the two must agree on whether the last statement is live."""
    from db import migrate
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("SET LOCAL standard_conforming_strings = on")
        cur.execute(sql)                                                      # one call, the simple protocol: the last result is kept
        last = cur.fetchone()
        assert (last == (42,)) is live
        assert (migrate.scan(sql)[-1] == ("SELECT 42", True)) is live
    finally:
        raw.rollback()
        raw.close()


def test_a_refused_file_and_a_shell_that_may_not_migrate_change_nothing(engine, tmp_path, monkeypatch):
    from db import migrate
    m, d = book(tmp_path, {PROBE: GOOD_SQL + "TRUNCATE zz_migrate_probe;\n"})
    out = migrate.run(engine, m, d)
    assert out["problems"] == {PROBE: "refused: TRUNCATE"} and not exists(engine, "zz_migrate_probe")
    m, d = book(tmp_path, {PROBE: "BEGIN;\n" + GOOD_SQL + "COMMIT;\n"})
    assert migrate.run(engine, m, d)["problems"] == {PROBE: "refused: transaction control"} and not exists(engine, "zz_migrate_probe")
    m, d = book(tmp_path, {PROBE: GOOD_SQL})
    monkeypatch.delenv("RIJEKA_MIGRATE")
    monkeypatch.delenv("RENDER", raising=False)
    out = migrate.run(engine, m, d)                                           # a developer's shell
    assert out["enabled"] is False and out["applied"] == [] and not exists(engine, "zz_migrate_probe")


def test_the_real_approved_files_go_through_the_runner(engine):
    """The repository's own manifest and db/approved, through `run()` on the stack's database: the only time
    these exact bytes meet the runner (one transaction, one driver call, the pinned search path) before
    production. The stack built the same objects from docs/ statement by statement, so this is the files
    applied over a schema that has them, which is what an idempotent migration must survive. It iterates the
    manifest, so it covers every entry added later; the ledger rows are left in place afterwards."""
    from db import migrate
    entries = migrate.manifest()
    names = [e.name for e in entries]
    assert {"2026-11-09_signup_role.sql", "2026-11-10_fixings.sql"} <= set(names)
    assert migrate.check() == {}
    if exists(engine, "schema_migrations"):
        with engine.begin() as c:                                             # as on a database that has never seen the runner
            c.execute(text("DELETE FROM public.schema_migrations WHERE name = ANY(:n)"), {"n": names})
    fixings_before = one(engine, "SELECT count(*) FROM public.fixings")[0] if exists(engine, "fixings") else 0

    out = migrate.run(engine)                                                 # the module's own paths, as the deployed API calls it
    assert out["problems"] == {} and out["applied"] == names and out["pending"] == [], out
    rows = {r.name: r for r in _all(engine, "SELECT name, sha256, statements, applied_at FROM public.schema_migrations WHERE name = ANY(:n)", n=names)}
    assert set(rows) == set(names)
    for e in entries:
        assert rows[e.name].sha256 == e.sha256 == hashlib.sha256((migrate.APPROVED_DIR / e.name).read_bytes()).hexdigest()
        assert rows[e.name].statements >= 1

    again = migrate.run(engine)                                               # a second start: nothing to do
    assert again["problems"] == {} and again["applied"] == names and again["pending"] == []
    after = {r.name: r.applied_at for r in _all(engine, "SELECT name, applied_at FROM public.schema_migrations WHERE name = ANY(:n)", n=names)}
    assert after == {n: rows[n].applied_at for n in names}
    assert migrate.public_summary() == {"enabled": True, "approved": len(names), "applied": len(names), "pending": 0, "problems": 0,
                                        "last_run": again["last_run"]}

    # 2026-11-10_fixings.sql: the table is there, locked down, and its rows are as they were
    assert exists(engine, "fixings")
    assert one(engine, "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.fixings'::regclass")[0] is True
    assert one(engine, "SELECT count(*) FROM public.fixings")[0] == fixings_before
    # 2026-11-09_signup_role.sql: the sign-up function no longer reads the role a visitor asks for
    fn = one(engine, "SELECT prosecdef, prosrc FROM pg_proc WHERE oid = 'public.handle_new_user()'::regprocedure")
    assert fn.prosecdef is True and "raw_user_meta_data" not in fn.prosrc
    # nothing of the runner's settings stayed on the pooled connection
    assert one(engine, "SELECT current_setting('lock_timeout'), current_setting('statement_timeout')") == ("0", "0")


def test_the_api_starts_with_the_hook_and_reports_nothing_applied(client):
    """The app in this session was started with the start-up hook in place and neither RENDER nor
    RIJEKA_MIGRATE set: it applied nothing, and the public health body says so."""
    from api.routes import ops
    from db import migrate
    assert migrate.enabled() is False
    saved = dict(ops._cache), dict(ops._schema_cache)                         # the body is cached for a minute: leave no trace for the next test
    try:
        r = client.get("/api/ops/health")
    finally:
        ops._cache.update(saved[0]); ops._schema_cache.update(saved[1])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["migrations"]["enabled"] is False and body["migrations"]["applied"] == 0 and body["migrations"]["last_run"] is None
    assert set(body["migrations"]) == {"enabled", "approved", "applied", "pending", "problems", "last_run"}        # counts: names and reasons are admin-only
    assert {"schema", "scheduler", "worker"} <= set(body)
