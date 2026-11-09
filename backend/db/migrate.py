"""The migration runner: the deployed API applies the approved migrations itself when it starts.

Why. Local development shares the hosted database, so nothing run from a developer's shell may write its
schema. The owner approves each migration in his own words; the approval is one line of
`db/migrations_approved.txt` (file name, sha256 of the file's bytes, flags, who approved and when) plus a
byte-identical copy of `docs/migrations/<name>` at `db/approved/<name>`; the API process on Render reads that
manifest at start-up and applies what the ledger table does not have yet.

Where the SQL comes from. Only from `db/approved/`, never from `docs/`: the deployed service's root directory
is `backend/` and nothing outside it exists there at build time or at run time. `docs/migrations` stays the
place a migration is written and reviewed; `--stage` makes the copy at approval, and `--check` (and the unit
tests, in a full checkout) fail when a copy differs from its original, has no original or has no manifest line.

What is the control and what is not. The control is review plus the owner's approval of exact bytes: a file is
applied only when its bytes hash to the sha256 on its manifest line, and an applied migration is immutable (the
ledger keeps the hash it was applied with; a correction is a new file). The content guard below is defence in
depth on top of that.

First a read, in a transaction of its own: SET LOCAL lock_timeout = '2s', SET LOCAL statement_timeout = '10s',
then the ledger (`public.schema_migrations`, if it is there). Nothing more happens when it has every entry.

One migration, one transaction, on one driver-level connection (no SQLAlchemy statement parsing: the files
carry `$$` function bodies and `%`):
    pg_try_advisory_xact_lock(ADVISORY_LOCK_KEY)  two starting processes never both apply; transaction-scoped
                                                  because the API connects through a transaction pooler. It is
                                                  never waited for, and it is taken before any statement that
                                                  could wait on the ledger: when another instance holds it this
                                                  run applies nothing, reports `busy` and returns
    SET LOCAL lock_timeout = '5s'                 a statement never queues behind a long reader for more than this
    SET LOCAL statement_timeout = '60s'           per statement of the file
    SET LOCAL standard_conforming_strings = on    the guard reads plain '...' literals without backslash escapes
    SET LOCAL search_path = public, extensions    an unqualified CREATE TABLE lands in public, where the
                                                  presence checks look
    public.schema_migrations                      created, with row-level security, only when to_regclass says
                                                  it is not there: DDL on a ledger that exists would lock it
    the ledger is read again                      another process may have applied it since the first read
    the file's text, as one call
    INSERT INTO public.schema_migrations
    COMMIT
Anything that raises rolls the whole transaction back: no ledger row and no partial objects. A file must
therefore be transaction-safe (CREATE INDEX CONCURRENTLY and VACUUM fail here, and are reported).

Busy. A process that finds the lock taken, or the ledger locked for longer than the read's two seconds, leaves
every migration it has not seen applied as pending and says `busy` under `problems.run`; it does not look
again until its next start. The instance that held the lock
applies them, and this process sees the new tables through the presence checks like any other.

Stop at the first entry that cannot be applied. Entries are taken in file-name order (the date prefix). When
one is missing, does not hash to its approval, is refused or fails, every later entry that is not applied yet
is left alone and reported `blocked`: a later file may depend on an earlier one. `changed` (applied earlier
with other bytes) does not block: its objects are there.

Not from a developer's shell. `enabled()` is off there; and with RIJEKA_MIGRATE=1 set by hand, outside Render
(`RENDER` unset) a database whose address is a hosted one (supabase.co, pooler.supabase) is refused before any
connection: `refused: hosted database outside the deployed API`. A self-hosted deployment with its own
PostgreSQL and RIJEKA_MIGRATE=1 runs.

`run` never raises. The API starts with a migration pending; every feature reads its tables through a presence
check that tolerates their absence (the project's "deploy ahead of migration" rule).

What `status()` carries: file names from the manifest (a fixed shape, validated) and
reason words written here (`missing`, `mismatch`, `changed`, `refused: <rule>`, `failed: <exception class>
<SQLSTATE>`, `blocked: ...`, `busy: ...`). Never SQL, never a database message, never a connection string; the log lines
carry the same words and nothing more. `public_summary()` is the same as counts only: no name, no reason.

The content guard (`guard`) is a tripwire for the obvious mistake; the control is the review of each entry and
the owner's approval. Before a file is applied its text is read with comments removed, string literals
emptied and dollar-quoted bodies emptied, except the body of a DO statement, which runs at once and is read as
code; inside it a literal may be run as well (EXECUTE 'DROP TABLE x'), so its text is read the same way, with
its comments removed (the message of a RAISE apart).

Refused unless the manifest line carries the `destructive` flag: DROP TABLE, DROP SCHEMA, DROP DATABASE, DROP
OWNED, TRUNCATE, DELETE FROM, ALTER TABLE ... DROP [COLUMN], ALTER ROLE, CREATE ROLE, ALTER DATABASE, ALTER
PUBLICATION, a GRANT to anon, authenticated or PUBLIC, CREATE/ALTER POLICY ... TO anon or PUBLIC, DISABLE ROW
LEVEL SECURITY, a CREATE [MATERIALIZED] VIEW that reads the auth schema, COPY, a call of pg_sleep, and a
CREATE TABLE (not temporary) with no ALTER TABLE <that table> ENABLE ROW LEVEL SECURITY in the same file.

Refused whatever the flags, because they break the runner's own guarantees:
  * transaction control as a statement (BEGIN, COMMIT, ROLLBACK, SAVEPOINT ...): a COMMIT inside the file
    would end the transaction, the lock and the timeouts half-way;
  * a session-level setting (SET without LOCAL, RESET, DISCARD, set_config, also inside a DO body) and other
    state that outlives the transaction on a pooled connection other requests then use: a temporary table
    without ON COMMIT DROP (or any other temporary object), PREPARE, LISTEN, a cursor WITH HOLD, a call of
    pg_advisory_lock or pg_try_advisory_lock (the session-level ones; pg_advisory_xact_lock is fine);
  * SET LOCAL of statement_timeout, lock_timeout, standard_conforming_strings or search_path: they undo what
    the runner set for this transaction;
  * text the reader cannot follow (`unparseable`): an unterminated string or comment, a dollar quote glued to
    an identifier, a unicode-escaped identifier (U&"..."), a DO body written as an escaped or continued
    string, and inside a DO body any E'...', U&'...' or continued literal.

What the guard does NOT catch, plainly:
  * anything inside a function or procedure body, SECURITY DEFINER or not (it is stored, not run): a file can
    define a function and call it in the next statement, or CALL a procedure, and none of the body is read;
  * anything built at run time: EXECUTE of a concatenated string or of format(), query_to_xml, dblink,
    cron.schedule and every other function that runs a string as SQL;
  * statements outside its lists: UPDATE (with or without WHERE), INSERT ... ON CONFLICT DO UPDATE, MERGE,
    DROP FUNCTION / POLICY / INDEX / VIEW / TRIGGER / TYPE, ALTER TABLE ... TYPE or RENAME, ALTER TABLE ...
    OWNER TO, DROP ROLE, CREATE/ALTER USER, ALTER DEFAULT PRIVILEGES, a GRANT to any other role and a
    role-membership GRANT (GRANT anon TO x), REVOKE, NO FORCE ROW LEVEL SECURITY, CREATE EXTENSION, CREATE
    FUNCTION ... SECURITY DEFINER, a trigger on a table of another schema;
  * access that is too wide without one of its words: a policy with no TO clause (it is for PUBLIC) or with
    USING (true), a view over a public table (a view reads with its owner's rights unless security_invoker),
    row-level security enabled on a table that then has no policy for those who should read it;
  * the row-level-security rule goes by table name within one file: a table made by CREATE TABLE AS or in a
    function, or enabled in a later file, is judged by the name alone;
  * session state set in ways it has no word for (a function that sets it, LOAD, a sequence's cached values,
    SET SCHEMA and SET NAMES, an UPDATE of pg_settings);
  * text shaped to defeat its reading (the confirmation review of 9 November 2026 found each of these passing):
    nested comments inside an EXECUTE'd literal (DROP/*/**/*/TABLE), a domain or type named like a keyword
    (EXECUTE raise '...'), a quoted mixed-case table name against its row-level-security statement, a column
    named "enable row level security", SELECT ... INTO making a table;
  * cost: a statement that rewrites or locks a large table for up to the 60 s timeout;
  * and it raises false alarms on its own words where they are not statements (GRANT TRUNCATE ..., a
    SQL-standard BEGIN ATOMIC function body, an EXECUTE'd message that starts with "copy"): those need the
    flag or a rewrite, never a silent pass.
The reviewers and the owner read the file.

Tooling (no database is contacted by any of it; this module never imports db.session):
    python -m db.migrate --hash 2026-11-10_fixings.sql     the manifest line for a file under docs/migrations
    python -m db.migrate --stage 2026-11-10_fixings.sql    copy it to db/approved/ (never over a copy with other
                                                           bytes) and print the line; a person adds the line and
                                                           the approval words to the manifest
    python -m db.migrate --check                           the manifest, the copies and, where docs/migrations
                                                           exists, the originals; exit 1 on a problem
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple, Optional

log = logging.getLogger("rijeka.migrate")

BACKEND = Path(__file__).resolve().parent.parent
MANIFEST = BACKEND / "db" / "migrations_approved.txt"
APPROVED_DIR = BACKEND / "db" / "approved"                   # the only place the runner reads SQL from
ORIGINALS_DIR = BACKEND.parent / "docs" / "migrations"       # where a migration is written; tooling only, absent in production

ADVISORY_LOCK_KEY = 0x52494A4B4D494752                       # "RIJKMIGR" as a bigint; nothing else takes this key
LOCK_TIMEOUT = "5s"                                          # inside a migration's transaction, per lock wait
STATEMENT_TIMEOUT = "60s"                                    # inside a migration's transaction, per statement
READ_LOCK_TIMEOUT = "2s"                                     # the first read of the ledger: longer than this is `busy`
READ_STATEMENT_TIMEOUT = "10s"
SEARCH_PATH = "public, extensions"                           # pinned for every migration: unqualified names land in public
HOSTED_MARKERS = ("supabase.co", "pooler.supabase")          # the same test as tests/integration/conftest.py
MAX_BYTES = 1_000_000                                        # a migration is a few kilobytes; a megabyte is a mistake
FLAGS = frozenset({"destructive"})

NAME_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}_[a-z0-9_]+\.sql$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
_REASON_RE = re.compile(r"^[A-Za-z0-9 :,.()_/-]{1,120}$")
_ON = ("1", "true", "yes", "on")

LOCK_TRY = f"SELECT pg_try_advisory_xact_lock({int(ADVISORY_LOCK_KEY)})"      # never waits
LEDGER_CREATE = """CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name        text PRIMARY KEY,
    sha256      text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    statements  integer,
    runner      text
)"""
LEDGER_RLS = "ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY"
LEDGER_EXISTS = "SELECT to_regclass('public.schema_migrations')"
LEDGER_ALL = "SELECT name, sha256 FROM public.schema_migrations"
LEDGER_ONE = "SELECT sha256 FROM public.schema_migrations WHERE name = %s"
LEDGER_INSERT = "INSERT INTO public.schema_migrations (name, sha256, statements, runner) VALUES (%s, %s, %s, %s)"

BLOCKED = "blocked: an earlier migration did not apply"
BUSY = "busy: another instance is applying"
HOSTED = "refused: hosted database outside the deployed API"
_GENERAL = ("manifest", "database", "runner", "run")         # problem keys that are not a file name


# ── may this process write the schema? ───────────────────────────────────────────────────────────

def enabled(env: Optional[dict] = None) -> bool:
    """True only when the environment says so: RIJEKA_MIGRATE in (1, true, yes, on), or RIJEKA_MIGRATE unset
    or `auto` (as RIJEKA_SCHEDULER reads it) and RENDER set. Any other value of RIJEKA_MIGRATE (0, an empty
    string, a typo) is off, everywhere. A developer's shell has neither variable and never applies anything:
    its .env names the hosted database."""
    env = os.environ if env is None else env
    v = env.get("RIJEKA_MIGRATE")
    if v is not None and v.strip().lower() != "auto":
        return v.strip().lower() in _ON
    return bool((env.get("RENDER") or "").strip())


# ── the manifest ─────────────────────────────────────────────────────────────────────────────────

class Entry(NamedTuple):
    name: str
    sha256: str
    flags: frozenset
    approval: str


class ManifestError(ValueError):
    """The message is written here (a line number and a fixed phrase), never a copy of the line."""


def manifest(path: Optional[Path] = None) -> list[Entry]:
    """The approved migrations in file-name order. Strict: one line that does not parse rejects the whole
    file, so a damaged approval record applies nothing."""
    path = Path(path) if path is not None else MANIFEST
    try:
        text_ = path.read_bytes().decode("utf-8")
    except FileNotFoundError:
        raise ManifestError("the manifest file is not there") from None
    except UnicodeDecodeError:
        raise ManifestError("the manifest is not UTF-8") from None
    out: dict[str, Entry] = {}
    for n, raw in enumerate(text_.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        fields, hash_, approval = line.partition("#")
        parts = fields.split()
        if len(parts) != 3:
            raise ManifestError(f"line {n}: expected a file name, a sha256 and flags (or -), then the approval")
        name, sha, flags = parts
        if not NAME_RE.match(name):
            raise ManifestError(f"line {n}: the file name is not YYYY-MM-DD_name.sql in lower case")
        if not SHA_RE.match(sha):
            raise ManifestError(f"line {n}: the sha256 is not 64 lower-case hex characters")
        fl = frozenset() if flags == "-" else frozenset(flags.split(","))
        if flags != "-" and (not fl <= FLAGS or "" in fl):
            raise ManifestError(f"line {n}: unknown flag")
        if not hash_ or not approval.strip():
            raise ManifestError(f"line {n}: no approval recorded (who, when, their words)")
        if name in out:
            raise ManifestError(f"line {n}: the file is listed twice")
        out[name] = Entry(name, sha, fl, approval.strip())
    return [out[k] for k in sorted(out)]


def _read(name: str, directory: Optional[Path]) -> Optional[bytes]:
    """The file's bytes, None when it is not on disk. The name must have the manifest's shape (no path)."""
    if not NAME_RE.match(name):
        raise ValueError("not a migration file name")
    p = (Path(directory) if directory is not None else APPROVED_DIR) / name
    try:
        return p.read_bytes() if p.is_file() else None
    except OSError:
        return None


# ── the content guard ────────────────────────────────────────────────────────────────────────────

class Unparseable(ValueError):
    pass


class Opaque(Unparseable):
    """Text inside a DO body that would have to be decoded before it could be read (E'...', U&'...', a
    continued literal, nesting without end). Refused as it is, never taken for prose."""


_NEWLINE = re.compile(r"[\n\r]")
_IDENT_CHAR = re.compile(r"[A-Za-z0-9_$\u0080-\U0010ffff]")
_DOLLAR_TAG = re.compile(r"\$(?:[A-Za-z_\u0080-\U0010ffff][A-Za-z0-9_\u0080-\U0010ffff]*)?\$")

_NAME = r'((?:"[^"]+"|[\w$]+)(?:\s*\.\s*(?:"[^"]+"|[\w$]+))?)'
_BLOCK = r"(?:^|\b(?:BEGIN|THEN|ELSE|LOOP)\s)\s*"             # where a statement starts inside a PL/pgSQL body

# refused unless the manifest line carries `destructive`; matched on one statement at a time
_KEYWORDS = (
    ("DROP TABLE", re.compile(r"\bDROP\s+TABLE\b")),
    ("DROP SCHEMA", re.compile(r"\bDROP\s+SCHEMA\b")),
    ("DROP DATABASE", re.compile(r"\bDROP\s+DATABASE\b")),
    ("DROP OWNED", re.compile(r"\bDROP\s+OWNED\b")),
    ("TRUNCATE", re.compile(r"\bTRUNCATE\b")),
    ("DELETE FROM", re.compile(r"\bDELETE\s+FROM\b")),
    ("DROP COLUMN", re.compile(r"\bALTER\s+(?:FOREIGN\s+)?TABLE\b[^;]*\bDROP\s+(?!(?:CONSTRAINT|DEFAULT|NOT|EXPRESSION|IDENTITY)\b)")),
    ("ALTER ROLE", re.compile(r"\bALTER\s+ROLE\b")),
    ("CREATE ROLE", re.compile(r"\bCREATE\s+ROLE\b")),
    ("ALTER DATABASE", re.compile(r"\bALTER\s+DATABASE\b")),
    ("ALTER PUBLICATION", re.compile(r"\bALTER\s+PUBLICATION\b")),
    ("GRANT to anon, authenticated or PUBLIC", re.compile(r"\bGRANT\b.*\bTO\b.*\b(?:ANON|AUTHENTICATED|PUBLIC)\b", re.S)),
    ("policy for anon or PUBLIC", re.compile(r'\b(?:CREATE|ALTER)\s+POLICY\b[^;]*\bTO\s+(?:"?[\w$]+"?\s*,\s*)*"?(?:ANON|PUBLIC)"?(?![\w$.])')),
    ("DISABLE ROW LEVEL SECURITY", re.compile(r"\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b")),
    ("view over the auth schema", re.compile(r'\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:\w+\s+){0,2}VIEW\b[^;]*\bAUTH"?\s*\.')),
    ("COPY", re.compile(r"\bCOPY\b")),
    ("pg_sleep", re.compile(r'\bPG_SLEEP(?:_FOR|_UNTIL)?"?\s*\(')),
)
RLS_RULE = "CREATE TABLE without ENABLE ROW LEVEL SECURITY"     # the last of the flag-overridable rules
_CREATE_TABLE = re.compile(r"\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?" + _NAME)
_ENABLE_RLS = re.compile(r"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?" + _NAME + r"[^;]*?\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b")

# refused whatever the flags: they break the one-transaction guarantee, undo the runner's own settings, or
# leave state on a pooled connection that other requests then use
_TXN_START = re.compile(r"^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b")
_SESSION_START = re.compile(r"^(?:SET(?!\s+(?:LOCAL|CONSTRAINTS)\b)|RESET|DISCARD)\b")
# the same inside a DO body, where a statement is not always at the start of what is read and a literal may be
# prose: SET <name> = / TO, SET SESSION, SET ROLE, SET TIME ZONE, RESET <name>, DISCARD <what>
_SESSION_NESTED = re.compile(_BLOCK + r'(?:SET\s+(?!LOCAL\b|CONSTRAINTS\b)(?:SESSION\b|ROLE\b|TIME\s+ZONE\b|[\w.$"]+\s*(?:=|TO\b))|(?:RESET|DISCARD)\s+[\w.$"]+\s*$)')
_ALWAYS = (
    ("session setting", re.compile(r'\bSET_CONFIG"?\s*\(')),
    ("runner setting", re.compile(r'\bSET\s+LOCAL\s+"?(?:STATEMENT_TIMEOUT|LOCK_TIMEOUT|STANDARD_CONFORMING_STRINGS|SEARCH_PATH)"?(?![\w$])')),
    ("session advisory lock", re.compile(r'\bPG_(?:TRY_)?ADVISORY_LOCK(?:_SHARED)?"?\s*\(')),
    ("PREPARE", re.compile(_BLOCK + r"PREPARE\b")),
    ("LISTEN", re.compile(_BLOCK + r"LISTEN\b")),
    ("cursor WITH HOLD", re.compile(r"\bWITH\s+HOLD\b")),
)
TEMP_RULE = "temporary object without ON COMMIT DROP"
_CREATE_TEMP = re.compile(r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP|TEMPORARY)\b")
_CREATE_TEMP_TABLE = re.compile(r"\bCREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP|TEMPORARY)\s+(?:UNLOGGED\s+)?TABLE\b")
_ON_COMMIT_DROP = re.compile(r"\bON\s+COMMIT\s+DROP\b")
_TEMP_OTHER = re.compile(r'\bINTO\s+(?:TEMP|TEMPORARY)\b|\bPG_TEMP"?\s*\.')
_AFTER_RAISE = re.compile(r"\bRAISE(?:\s+(?:DEBUG|LOG|INFO|NOTICE|WARNING|EXCEPTION))?\s+(?:E|U&)?$", re.I)
_COMMENTS = re.compile(r"/\*.*?\*/|--[^\n\r]*", re.S)


def _norm(text_: str) -> str:
    return re.sub(r"\s+", " ", text_).strip().upper()


def scan(sql: str, _depth: int = 0) -> list[tuple[str, bool]]:
    """[(statement, top_level)]: the statements PostgreSQL would run, upper-cased, with comments removed,
    string literals emptied and dollar-quoted bodies emptied. Quoted identifiers keep their text (a role named
    "anon" is still anon). The body of a DO statement is code that runs now: its statements follow the DO
    statement with top_level False. Inside it every literal may be run too (EXECUTE 'DROP TABLE x', a DO
    inside the DO), so its text is read the same way, comments and all, and its statements follow; text that
    is not SQL (a message with an apostrophe) is kept whole, once as written and once without anything that
    looks like a comment. The message of a RAISE is not read. An E'...', U&'...' or continued literal inside a
    DO body is refused (Opaque). Raises Unparseable where the text cannot be followed; the module docstring
    says what this reading cannot see."""
    if _depth > 12:
        raise Opaque("nested too deep")
    out: list[tuple[str, bool]] = []
    nested: list[tuple[str, bool]] = []
    buf: list[str] = []
    i, n = 0, len(sql)
    # PostgreSQL's lexer (scan.l): a newline is \n or \r, a -- comment ends at either, and a literal continues
    # the one before it, in the same escape mode, when only whitespace and -- comments with at least one newline
    # lie between them. cont is that mode while a continuation is still possible, cont_nl once a newline is seen.
    cont: Optional[bool] = None
    cont_nl = False

    def flush() -> None:
        stmt = _norm("".join(buf))
        if stmt:
            out.append((stmt, _depth == 0))
        out.extend(nested)
        buf.clear(); nested.clear()

    def in_do() -> bool:
        """The statement being read starts with the word DO (leading whitespace and comments are not kept)."""
        return (_depth == 0 and len(buf) >= 2 and buf[0] in ("d", "D") and buf[1] in ("o", "O")
                and (len(buf) == 2 or not _IDENT_CHAR.match(buf[2][:1])))

    def code(body: str, coded: bool = False) -> None:
        """A literal's text: the code of a DO statement, or inside one a string that may be run."""
        if in_do():
            if coded:
                raise Unparseable("the body of a DO statement written as an escaped or continued string")
            nested.extend((s, False) for s, _ in scan(body, 1))
        elif _depth:
            if _AFTER_RAISE.search("".join(buf[-48:])):
                return                            # a message, not a statement
            if coded:
                raise Opaque("an escaped or continued literal inside a DO body")
            try:
                nested.extend((s, False) for s, _ in scan(body, _depth + 1))
            except Opaque:
                raise
            except Unparseable:                   # not SQL: keep the words, with and without what may be a comment
                nested.extend((t, False) for t in dict.fromkeys((_norm(body), _norm(_COMMENTS.sub(" ", body)))) if t)

    def space() -> None:
        if buf:                                   # a statement never starts with a space: see in_do
            buf.append(" ")

    while i < n:
        c = sql[i]
        if c in " \t\r\n\f\v":
            if c in "\n\r" and cont is not None:
                cont_nl = True
            space(); i += 1
            continue
        if sql.startswith("--", i):
            m = _NEWLINE.search(sql, i)
            i = m.start() if m else n             # the newline itself is whitespace, handled above
            space()
            continue
        if c == "'":
            prev, before = (sql[i - 1] if i else ""), (sql[i - 2] if i > 1 else "")
            escape = prev in ("e", "E") and not _IDENT_CHAR.match(before or " ")      # E'...': backslash escapes
            coded = escape or (prev == "&" and before in ("u", "U"))                  # U&'...': unicode escapes
            continued = cont is not None and cont_nl
            if continued:
                escape = cont
            start = i = i + 1
            while True:
                if i >= n:
                    raise Unparseable("unterminated string")
                ch = sql[i]
                if escape and ch == "\\":
                    i += 2
                elif ch == "'":
                    if sql.startswith("'", i + 1):
                        i += 2
                    else:
                        i += 1
                        break
                else:
                    i += 1
            code(sql[start:i - 1].replace("''", "'"), coded or continued or escape)
            buf.append("''")
            cont, cont_nl = escape, False
            continue
        cont, cont_nl = None, False               # any other token ends a continuation
        if sql.startswith("/*", i):
            depth, i = 1, i + 2
            while depth:
                if i >= n:
                    raise Unparseable("unterminated comment")
                if sql.startswith("/*", i):
                    depth += 1; i += 2
                elif sql.startswith("*/", i):
                    depth -= 1; i += 2
                else:
                    i += 1
            space()
            continue
        if c == '"':
            if i > 1 and sql[i - 1] == "&" and sql[i - 2] in ("u", "U"):
                raise Unparseable("a unicode-escaped identifier")                     # U&"\0061non" is anon
            j = i + 1
            while True:
                if j >= n:
                    raise Unparseable("unterminated quoted identifier")
                if sql[j] == '"':
                    if sql.startswith('"', j + 1):
                        j += 2
                        continue
                    break
                j += 1
            buf.append(sql[i:j + 1].replace(";", " "))
            i = j + 1
            continue
        if c == "$":
            m = _DOLLAR_TAG.match(sql, i)
            if m:
                if i > 0 and _IDENT_CHAR.match(sql[i - 1]):
                    # abc$$ is an identifier and 1$$ opens a body: not worth guessing which, refuse
                    raise Unparseable("a dollar quote glued to the word before it")
                tag = m.group(0)
                end = sql.find(tag, m.end())
                if end < 0:
                    raise Unparseable("unterminated dollar quote")
                code(sql[m.end():end])
                buf.append(" $$ ")
                i = end + len(tag)
                continue
        if c == ";":
            flush(); i += 1
            continue
        buf.append(c); i += 1
    flush()
    return out


def _table(name: str) -> str:
    n = re.sub(r"\s+", "", name).replace('"', "")
    return n[len("PUBLIC."):] if n.startswith("PUBLIC.") else n


def _temp_leak(stmt: str) -> bool:
    if _TEMP_OTHER.search(stmt):
        return True
    return bool(_CREATE_TEMP.search(stmt)) and not (_CREATE_TEMP_TABLE.search(stmt) and _ON_COMMIT_DROP.search(stmt))


def guard(sql: str, flags: frozenset = frozenset()) -> Optional[str]:
    """None when the file may be applied, otherwise the rule it trips (words written here, never the SQL)."""
    try:
        statements = scan(sql)
    except Unparseable:
        return "unparseable"
    if not any(top for _, top in statements):
        return "no statements"
    for stmt, top in statements:                  # whatever the flags
        if top and _TXN_START.match(stmt):
            return "transaction control"
        if (_SESSION_START if top else _SESSION_NESTED).search(stmt):
            return "session setting"
        for label, rx in _ALWAYS:
            if rx.search(stmt):
                return label
        if _temp_leak(stmt):
            return TEMP_RULE
    if "destructive" in flags:
        return None
    for stmt, _ in statements:
        for label, rx in _KEYWORDS:
            if rx.search(stmt):
                return label
    created = {_table(m.group(1)) for stmt, _ in statements for m in _CREATE_TABLE.finditer(stmt)}
    enabled = {_table(m.group(1)) for stmt, _ in statements for m in _ENABLE_RLS.finditer(stmt)}
    if created - enabled:
        return RLS_RULE
    return None


def statement_count(sql: str) -> int:
    return sum(1 for _, top in scan(sql) if top)


def preflight(entry: Entry, directory: Optional[Path] = None) -> tuple[Optional[str], Optional[str], int]:
    """(problem, sql, statements) for one manifest entry from its approved copy alone (db/approved unless a
    directory is given): `missing`, `mismatch`, `refused: <rule>`, or (None, the text to run, how many
    statements it holds)."""
    data = _read(entry.name, directory)
    if data is None:
        return "missing", None, 0
    if hashlib.sha256(data).hexdigest() != entry.sha256:
        return "mismatch", None, 0
    if len(data) > MAX_BYTES:
        return "refused: too large", None, 0
    try:
        sql = data.decode("utf-8")
    except UnicodeDecodeError:
        return "refused: not UTF-8", None, 0
    rule = guard(sql, entry.flags)
    if rule:
        return f"refused: {rule}", None, 0
    return None, sql, statement_count(sql)


# ── the run ──────────────────────────────────────────────────────────────────────────────────────

_run_lock = threading.Lock()
_last: dict = {"at": None, "applied": [], "problems": {}}


def _failure(e: BaseException) -> str:
    """The exception class and, when the server gave one, the five-character SQLSTATE. Never the message:
    a driver's message can carry the statement or the host it tried to reach."""
    code = getattr(e, "pgcode", None)
    return f"failed: {type(e).__name__}" + (f" {code}" if isinstance(code, str) and re.fullmatch(r"[0-9A-Z]{5}", code) else "")


def _runner_name() -> str:
    raw = f"{os.environ.get('RENDER_SERVICE_NAME') or 'api'}@{(os.environ.get('RENDER_GIT_COMMIT') or os.environ.get('GIT_COMMIT') or 'unknown')[:12]}"
    return re.sub(r"[^A-Za-z0-9._@:-]", "_", raw)[:80]


def _hosted_outside_render(engine) -> bool:
    """A hosted database named by an engine that is not the deployed API's: `RIJEKA_MIGRATE=1 uvicorn main:app`
    in a developer's shell, whose .env names the hosted database. Only the URL's text is looked at, and it is
    never kept, logged or published. A self-hosted deployment with its own PostgreSQL is not this."""
    if (os.environ.get("RENDER") or "").strip():
        return False
    url = getattr(engine, "url", None)
    text_ = f"{getattr(url, 'host', '') or ''} {url if url is not None else ''}".lower()      # str(URL) masks the password
    return any(marker in text_ for marker in HOSTED_MARKERS)


def _read_ledger(raw) -> dict[str, str]:
    """{name: sha256} from the ledger; {} when the table is not there yet. Read-only, and it never queues for
    long: an exclusive lock on the ledger held elsewhere ends it after READ_LOCK_TIMEOUT (SQLSTATE 55P03)."""
    cur = raw.cursor()
    try:
        cur.execute(f"SET LOCAL lock_timeout = '{READ_LOCK_TIMEOUT}'")
        cur.execute(f"SET LOCAL statement_timeout = '{READ_STATEMENT_TIMEOUT}'")
        cur.execute(LEDGER_EXISTS)
        row = cur.fetchone()
        if not row or row[0] is None:
            return {}
        cur.execute(LEDGER_ALL)
        return {str(name): str(sha) for name, sha in cur.fetchall()}
    finally:
        try:
            cur.close()
        finally:
            raw.rollback()


def _apply(raw, entry: Entry, sql: str, statements: int) -> str:
    """One migration in one transaction. Returns `applied`, `changed` (another process recorded other bytes
    since the ledger was first read), `busy` (another instance holds the lock: nothing was done and nothing
    was waited for) or raises; the caller rolls back."""
    raw.rollback()                                           # start from a clean transaction: the lock comes first
    cur = raw.cursor()
    try:
        cur.execute(LOCK_TRY)
        got = cur.fetchone()
        if not got or got[0] is not True:
            raw.rollback()
            return "busy"
        cur.execute(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'")
        cur.execute(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'")
        cur.execute("SET LOCAL standard_conforming_strings = on")
        cur.execute(f"SET LOCAL search_path = {SEARCH_PATH}")
        cur.execute(LEDGER_EXISTS)
        there = cur.fetchone()
        if not there or there[0] is None:                    # only then: DDL on a ledger that exists would lock it
            cur.execute(LEDGER_CREATE)
            cur.execute(LEDGER_RLS)
        cur.execute(LEDGER_ONE, (entry.name,))
        row = cur.fetchone()
        if row is not None:
            raw.rollback()
            return "applied" if row[0] == entry.sha256 else "changed"
        cur.execute(sql)                                     # the file's text, one driver call, no parameters
        cur.execute(LEDGER_INSERT, (entry.name, entry.sha256, statements, _runner_name()))
        raw.commit()
        return "applied"
    finally:
        try:
            cur.close()
        except Exception:                                    # noqa: BLE001
            pass


def _run(engine, manifest_path: Optional[Path], approved_dir: Optional[Path]) -> tuple[list[str], dict[str, str]]:
    applied: list[str] = []
    problems: dict[str, str] = {}
    if _hosted_outside_render(engine):
        log.warning("migrations: refused, this is a hosted database and this process is not the deployed API")
        return applied, {"database": HOSTED}
    try:
        entries = manifest(manifest_path)
    except ManifestError as e:
        return applied, {"manifest": str(e)}
    if not entries:
        return applied, problems                             # nothing approved: the database is not contacted
    try:
        raw = engine.raw_connection()
    except Exception as e:                                   # noqa: BLE001
        return applied, {"database": _failure(e)}
    try:
        if getattr(raw, "autocommit", False) is True:
            return applied, {"database": "failed: the connection is in autocommit"}
        try:
            ledger = _read_ledger(raw)
        except Exception as e:                               # noqa: BLE001
            _rollback(raw)
            if getattr(e, "pgcode", None) == "55P03":        # lock_not_available: the ledger is locked by a writer
                log.info("migrations: the ledger is locked by another instance; this one applies nothing")
                return applied, {"run": BUSY}
            return applied, {"database": _failure(e)}
        stopped = busy = False
        for entry in entries:
            have = ledger.get(entry.name)
            if have == entry.sha256:
                applied.append(entry.name)
                continue
            if have is not None:
                problems[entry.name] = "changed"             # applied with other bytes: immutable, nothing is done
                continue
            if busy:
                continue                                     # left pending: the instance that holds the lock applies it
            if stopped:
                problems[entry.name] = BLOCKED
                continue
            problem, sql, statements = preflight(entry, approved_dir)
            if problem is None:
                try:
                    outcome = _apply(raw, entry, sql, statements)
                except Exception as e:                       # noqa: BLE001
                    _rollback(raw)
                    problem = _failure(e)
                else:
                    if outcome == "applied":
                        applied.append(entry.name)
                        log.info("migrations: applied %s (%d statements)", entry.name, statements)
                        continue
                    if outcome == "busy":
                        busy = True
                        problems["run"] = BUSY
                        log.info("migrations: another instance is applying; this one applies nothing and does not wait")
                        continue
                    problems[entry.name] = outcome           # changed, seen under the lock
                    continue
            problems[entry.name] = problem
            stopped = True
            log.warning("migrations: %s not applied (%s); later entries are left alone", entry.name, problem)
    finally:
        try:
            raw.close()
        except Exception:                                    # noqa: BLE001
            pass
    return applied, problems


def _rollback(raw) -> None:
    try:
        raw.rollback()
    except Exception:                                        # noqa: BLE001
        pass


def run(engine, manifest_path: Optional[Path] = None, approved_dir: Optional[Path] = None) -> dict:
    """Apply what the manifest approves and the ledger lacks. Does nothing unless `enabled()`. Never raises and
    never waits for another process; returns `status()`. The paths are arguments for the tests; the deployed
    process uses the module's own (db/migrations_approved.txt, db/approved)."""
    if not enabled():
        return status(manifest_path)
    with _run_lock:
        try:
            applied, problems = _run(engine, manifest_path, approved_dir)
        except Exception as e:                               # noqa: BLE001 — the API must start
            applied, problems = [], {"runner": _failure(e)}
            log.error("migrations: the runner failed (%s)", type(e).__name__)
        _last.update(at=datetime.now(timezone.utc).isoformat(), applied=list(applied), problems=dict(problems))
    return status(manifest_path)


def status(manifest_path: Optional[Path] = None) -> dict:
    """{enabled, applied, pending, problems, last_run} from the last run in this process and the manifest.
    Safe to publish: validated file names and the reason words written in this module. `applied` is what the
    last run saw in the ledger or put there, so it is empty in a process that never ran (a developer's shell,
    the worker); `pending` is every manifest entry that is neither applied nor `changed`. A run that found the
    lock taken says `busy` under `problems.run` and its pending entries stay listed until this process starts
    again, though the other instance has applied them by then. Never raises."""
    try:
        try:
            names = [e.name for e in manifest(manifest_path)]
        except ManifestError as e:
            names = []
            _last_problems = {"manifest": str(e)}
        else:
            _last_problems = {k: v for k, v in dict(_last["problems"]).items() if k in names or k in _GENERAL}
        problems = {k: (v if _REASON_RE.match(str(v)) else "failed") for k, v in _last_problems.items()}
        applied = [n for n in _last["applied"] if n in names]
        pending = [n for n in names if n not in applied and problems.get(n) != "changed"]
        return {"enabled": enabled(), "applied": applied, "pending": pending, "problems": problems, "last_run": _last["at"]}
    except Exception as e:                                   # noqa: BLE001
        return {"enabled": False, "applied": [], "pending": [], "problems": {"status": f"failed: {type(e).__name__}"}, "last_run": None}


def public_summary(manifest_path: Optional[Path] = None) -> dict:
    """Counts only, for a public page: no file name and no reason. `approved` is the number of manifest
    entries, `applied` and `pending` the lengths of `status()`'s lists, `problems` how many problems it names.
    Never raises."""
    st = status(manifest_path)
    try:
        approved = len(manifest(manifest_path))
    except ManifestError:
        approved = 0
    return {"enabled": bool(st["enabled"]), "approved": approved, "applied": len(st["applied"]), "pending": len(st["pending"]),
            "problems": len(st["problems"]), "last_run": st["last_run"]}


# ── tooling for the coordinator: files only, no database ─────────────────────────────────────────

def check(manifest_path: Optional[Path] = None, approved_dir: Optional[Path] = None, originals_dir: Optional[Path] = None) -> dict[str, str]:
    """{name: problem} for the manifest, the approved copies and their originals; {} when all is in order.
    Every manifest entry has its copy in db/approved, the copy hashes to the approval and passes the guard with
    its flags; every file in db/approved (README.md apart) has a manifest line; and, where docs/migrations
    exists (a developer's checkout, CI; not the deployed service), every copy has an original there with the
    same bytes."""
    approved_dir = Path(approved_dir) if approved_dir is not None else APPROVED_DIR
    originals_dir = Path(originals_dir) if originals_dir is not None else ORIGINALS_DIR
    try:
        entries = manifest(manifest_path)
    except ManifestError as e:
        return {"manifest": str(e)}
    out: dict[str, list[str]] = {}
    listed = {e.name for e in entries}
    for entry in entries:
        problem, _, _ = preflight(entry, approved_dir)
        if problem:
            out.setdefault(entry.name, []).append(problem)
    on_disk = sorted(p.name for p in approved_dir.iterdir() if p.name != "README.md") if approved_dir.is_dir() else []
    for name in on_disk:
        if not NAME_RE.match(name) or not (approved_dir / name).is_file():
            out.setdefault(name, []).append("not a migration file")
            continue
        if name not in listed:
            out.setdefault(name, []).append("no manifest line")
        if originals_dir.is_dir():
            original = _read(name, originals_dir)
            if original is None:
                out.setdefault(name, []).append("no original in docs/migrations")
            elif original != _read(name, approved_dir):
                out.setdefault(name, []).append("differs from docs/migrations")
    return {k: "; ".join(v) for k, v in out.items()}


def stage(name: str, approved_dir: Optional[Path] = None, originals_dir: Optional[Path] = None) -> str:
    """Copy docs/migrations/<name> to db/approved/<name> and return the manifest line (name, sha256, -) to add
    by hand. A copy already there with the same bytes is left as it is; one with other bytes is never
    overwritten (ValueError): an approved migration is not edited, a correction is a new file. The manifest is
    not written here: the approval words are a person's."""
    approved_dir = Path(approved_dir) if approved_dir is not None else APPROVED_DIR
    originals_dir = Path(originals_dir) if originals_dir is not None else ORIGINALS_DIR
    if not NAME_RE.match(name):
        raise ValueError("not a migration file name (YYYY-MM-DD_name.sql, lower case, no path)")
    data = _read(name, originals_dir)
    if data is None:
        raise ValueError(f"docs/migrations/{name} is not there")
    have = _read(name, approved_dir)
    if have is not None and have != data:
        raise ValueError(f"db/approved/{name} is there with other bytes; an approved migration is never edited, write a new file")
    if have is None:
        approved_dir.mkdir(parents=True, exist_ok=True)
        with open(approved_dir / name, "xb") as f:           # exclusive: never over a file that appeared meanwhile
            f.write(data)
    return f"{name}  {hashlib.sha256(data).hexdigest()}  -"


def _guard_note(data: bytes) -> Optional[str]:
    try:
        return guard(data.decode("utf-8"))
    except UnicodeDecodeError:
        return "not UTF-8"


def main(argv: Optional[list[str]] = None) -> int:
    import argparse
    import sys
    ap = argparse.ArgumentParser(prog="python -m db.migrate", description="Manifest tooling for the migration runner. Connects to no database.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--hash", metavar="FILE", help="print the manifest line (name, sha256, -) for a file under docs/migrations")
    g.add_argument("--stage", metavar="FILE", help="copy docs/migrations/FILE to db/approved/ (never over other bytes) and print its manifest line")
    g.add_argument("--check", action="store_true", help="validate the manifest, the approved copies and their originals; exit 1 on a problem")
    args = ap.parse_args(argv)
    name = args.hash or args.stage
    if name:
        if not NAME_RE.match(name):
            print("not a migration file name (YYYY-MM-DD_name.sql, lower case, no path)", file=sys.stderr)
            return 1
        data = _read(name, ORIGINALS_DIR)
        if data is None:
            print(f"docs/migrations/{name} is not there", file=sys.stderr)
            return 1
        if args.stage:
            try:
                line = stage(name)
            except (ValueError, OSError) as e:
                print(str(e) if isinstance(e, ValueError) else f"could not write db/approved/{name} ({type(e).__name__})", file=sys.stderr)
                return 1
            print(line)
            print(f"staged db/approved/{name}; add the line above to db/migrations_approved.txt with  # who approved, the date, their words", file=sys.stderr)
        else:
            print(f"{name}  {hashlib.sha256(data).hexdigest()}  -")
        rule = _guard_note(data)
        if rule:
            print(f"note: the content guard refuses this file ({rule}); see db/migrate.py for what that takes", file=sys.stderr)
        return 0
    problems = check()
    try:
        n = len(manifest())
    except ManifestError:
        n = 0
    for name, problem in problems.items():
        print(f"{name}: {problem}")
    print(f"{n} approved, {len(problems)} with a problem")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
