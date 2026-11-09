"""The fixings table: one row per pair, date and source.

A row without a user is shared, every account's. The feed writes it once, after the caller has checked it against
an independent spot, and never overwrites it; when a later read of the same date differs, nothing of that read is
stored and the row is marked disputed until a re-read agrees or an administrator corrects it. A correction
supersedes the live shared row (kept) with a row of origin CORRECTION that carries its author and reason. A row
with a user is that account's own entry; a second entry for the same key supersedes the first, which is kept.

Every function tolerates the table being absent (a deploy ahead of docs/migrations/2026-11-10_fixings.sql): reads
return nothing, writes raise RuntimeError. A negative presence answer is never cached.

feed_enabled() and feed_delivering() are the two questions the rest of the code asks about the feed: is it
switched on, and is it actually storing this pair's fixing."""
from __future__ import annotations

import logging
import math
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text

log = logging.getLogger("rijeka.settlement")

_tables: dict[str, Any] = {}
MIGRATION = "docs/migrations/2026-11-10_fixings.sql"
REL_TOLERANCE = 1e-6          # a re-read of a published fixing within this of the stored value is the same number
MAX_ROWS = 2000               # one read of recent rows
DELIVERING_DAYS = 3           # the feed is delivering a pair when its latest shared fixing is at most this old
OWN_ROWS_MAX = 5000           # live own rows per account
OWN_TOTAL_MAX = 20000         # an account's rows in all, the superseded ones included: every replacement keeps a row
OWN_SOURCES_MAX = 20          # distinct sources per account and pair


def _rollback(db) -> None:
    try:
        db.rollback()
    except Exception:          # noqa: BLE001
        pass


def tables_present(db) -> bool:
    """The table in its current shape (the dispute column is the last one the migration adds)."""
    if "present" not in _tables:
        if db is None:
            return False
        try:
            found = db.execute(text("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' "
                                    "AND table_name = 'fixings' AND column_name = 'disputed_at')")).scalar()
            if found is not True:             # re-checked until the migration lands (and a stand-in session is not a yes)
                return False
            _tables["present"] = True
        except Exception:          # noqa: BLE001
            _rollback(db)
            return False
    return _tables["present"]


def _need(db) -> None:
    if not tables_present(db):
        raise RuntimeError(f"Fixings need {MIGRATION} applied first")


# ── the feed: on, and delivering ─────────────────────────────────────────────

def feed_enabled() -> bool:
    """Whether this instance runs the venue's feed at all: both of its switches are on."""
    from api.routes import demo_market_data
    from market_data import deribit
    return deribit.enabled() and demo_market_data.enabled()


def feed_delivering(db, pair: str, today: Optional[date] = None) -> bool:
    """Whether the feed is actually storing this pair's fixing: it is switched on, the table is there, and a shared
    fixing of the pair's feed source is dated within the last DELIVERING_DAYS days. A deploy ahead of the migration,
    an instance whose scheduler does not run, and a venue that stopped answering are all 'not delivering'."""
    from settlement.sources import feed_source
    source = feed_source(pair)
    if source is None or not feed_enabled() or not tables_present(db):
        return False
    today = today or datetime.now(timezone.utc).date()
    try:
        last = latest_shared(db, [(pair, source)]).get((pair, source))
    except Exception:          # noqa: BLE001 — a store that cannot be read is not delivering
        _rollback(db)
        return False
    return isinstance(last, date) and last >= today - timedelta(days=DELIVERING_DAYS)


# ── reads ────────────────────────────────────────────────────────────────────

def _row(r) -> dict:
    return {"date": r.fixing_date.isoformat(), "source": r.source, "time": r.fixing_time, "value": float(r.value),
            "origin": r.origin, "own": r.user_id is not None, "disputed": getattr(r, "disputed_at", None) is not None}


def get(db, pair: str, fixing_date: date, source: str, user_id) -> Optional[dict]:
    """The fixing for exactly this pair, date and source: the account's own row first, then the shared one.
    None when there is none, and before the migration."""
    if not source or not tables_present(db):
        return None
    r = db.execute(text(
        "SELECT fixing_date, fixing_time, source, value, origin, user_id, disputed_at FROM fixings "
        "WHERE pair = :p AND fixing_date = :d AND source = :s AND superseded_at IS NULL "
        "AND (user_id IS NULL OR user_id = CAST(:u AS uuid)) ORDER BY (user_id IS NULL) LIMIT 1"),
        {"p": pair, "d": fixing_date, "s": source, "u": str(user_id) if user_id else None}).first()
    return _row(r) if r is not None else None


def recent(db, pair: str, days: int, user_id, today: Optional[date] = None) -> list[dict]:
    """The account's own and the shared rows of the last `days`, not superseded, ascending by date."""
    if not tables_present(db):
        return []
    since = (today or date.today()) - timedelta(days=max(int(days), 0))
    rows = db.execute(text(
        "SELECT fixing_date, fixing_time, source, value, origin, user_id, disputed_at FROM fixings "
        "WHERE pair = :p AND fixing_date >= :d AND superseded_at IS NULL AND (user_id IS NULL OR user_id = CAST(:u AS uuid)) "
        "ORDER BY fixing_date, source, (user_id IS NULL) DESC LIMIT :n"),
        {"p": pair, "d": since, "u": str(user_id) if user_id else None, "n": MAX_ROWS}).all()
    return [_row(r) for r in rows]


def latest_shared(db, keys: list[tuple[str, str]]) -> dict[tuple[str, str], date]:
    """{(pair, source): the latest shared fixing date} for the keys that have one."""
    if not keys or not tables_present(db):
        return {}
    rows = db.execute(text("SELECT pair, source, max(fixing_date) AS d FROM fixings WHERE user_id IS NULL AND superseded_at IS NULL "
                           "AND pair = ANY(:p) AND source = ANY(:s) GROUP BY pair, source"),
                      {"p": sorted({k[0] for k in keys}), "s": sorted({k[1] for k in keys})}).all()
    return {(r.pair, r.source): r.d for r in rows if (r.pair, r.source) in set(keys)}


def shared_dates(db, keys: list[tuple[str, str]], since: date) -> dict[tuple[str, str], set[date]]:
    """{(pair, source): the dates from `since` on that have a live shared row}, every key present."""
    out: dict[tuple[str, str], set[date]] = {k: set() for k in keys}
    if not keys or not tables_present(db):
        return out
    rows = db.execute(text("SELECT pair, source, fixing_date FROM fixings WHERE user_id IS NULL AND superseded_at IS NULL "
                           "AND fixing_date >= :d AND pair = ANY(:p) AND source = ANY(:s)"),
                      {"d": since, "p": sorted({k[0] for k in keys}), "s": sorted({k[1] for k in keys})}).all()
    for r in rows:
        if (r.pair, r.source) in out:
            out[(r.pair, r.source)].add(r.fixing_date)
    return out


def disputed(db, keys: list[tuple[str, str]]) -> int:
    """How many live shared rows of these keys the feed has re-read differently and nobody has corrected."""
    if not keys or not tables_present(db):
        return 0
    n = db.execute(text("SELECT count(*) FROM fixings WHERE user_id IS NULL AND superseded_at IS NULL AND disputed_at IS NOT NULL "
                        "AND pair = ANY(:p) AND source = ANY(:s)"),
                   {"p": sorted({k[0] for k in keys}), "s": sorted({k[1] for k in keys})}).scalar()
    return int(n or 0)


def own_usage(db, user_id, pair: str, fixing_date: date, source: str) -> dict:
    """{rows, total, sources, replaces, source_known} for an account about to store an own fixing: its live rows,
    its rows in all (the superseded ones too: a replacement keeps the row it replaces), the distinct sources it
    uses on the pair, whether this key already has a live row and this source is in use."""
    _need(db)
    u = {"u": str(user_id)}
    c = db.execute(text("SELECT count(*) FILTER (WHERE superseded_at IS NULL) AS live, count(*) AS total FROM fixings WHERE user_id = CAST(:u AS uuid)"), u).first()
    used = [r[0] for r in db.execute(text("SELECT DISTINCT source FROM fixings WHERE user_id = CAST(:u AS uuid) AND pair = :p AND superseded_at IS NULL"),
                                     {**u, "p": pair}).all()]
    had = db.execute(text("SELECT 1 FROM fixings WHERE user_id = CAST(:u AS uuid) AND pair = :p AND fixing_date = :d AND source = :s "
                          "AND superseded_at IS NULL"), {**u, "p": pair, "d": fixing_date, "s": source}).first()
    return {"rows": int(c.live or 0), "total": int(c.total or 0), "sources": len(used), "replaces": had is not None, "source_known": source in used}


# ── writes ───────────────────────────────────────────────────────────────────

def _positive(v) -> float:
    f = float(v)
    if not (math.isfinite(f) and f > 0):
        raise ValueError("a fixing is a positive, finite number")
    return f


def put_shared(db, rows: list[dict], verdicts: Optional[dict] = None, write: bool = True) -> dict:
    """One asset's rows from the feed ({pair, fixing_date, fixing_time, source, value}), as one batch.

    A date that already has a live shared row is compared, never written: when the venue's value now differs from
    a row the feed stored, the row is marked disputed and NOTHING of the batch is stored (a response that
    disagrees with what was published is not trusted for a new day either); when it agrees, an earlier dispute on
    it is cleared. A date an administrator corrected is the administrator's: a differing re-read is logged only.
    A new date is inserted when its verdict is "ok" (`verdicts` by date, from the caller's check against an
    independent spot; None means the caller vouches for every row) and counted under its verdict otherwise.

    Returns {written, known, differs, unchecked, refused, held}; `held` are new dates not stored because the
    batch disagreed. write=False reads and counts what would happen. The caller commits."""
    _need(db)
    out = {"written": 0, "known": 0, "differs": 0, "unchecked": 0, "refused": 0, "held": 0}
    checked = [(r, _positive(r["value"])) for r in rows]
    fresh: list[tuple[dict, float]] = []
    for r, v in checked:
        key = {"p": r["pair"], "d": r["fixing_date"], "s": r["source"]}
        had = db.execute(text("SELECT id, value, origin, disputed_at FROM fixings WHERE user_id IS NULL AND pair = :p AND fixing_date = :d "
                              "AND source = :s AND superseded_at IS NULL"), key).first()
        if had is None:
            fresh.append((r, v))
            continue
        out["known"] += 1
        same = abs(float(had.value) - v) <= REL_TOLERANCE * max(abs(float(had.value)), 1.0)
        if had.origin == "CORRECTION":
            if not same:
                log.info("fixing %s %s (%s): corrected to %r, the venue reads %r; the correction stands", r["pair"], r["fixing_date"], r["source"], float(had.value), v)
            continue
        if not same:
            out["differs"] += 1
            log.warning("fixing %s %s (%s): stored %r, re-read %r; the stored value stands and the date is disputed", r["pair"], r["fixing_date"], r["source"], float(had.value), v)
            if write:
                db.execute(text("UPDATE fixings SET disputed_at = COALESCE(disputed_at, now()) WHERE id = :id"), {"id": str(had.id)})
        elif had.disputed_at is not None and write:
            db.execute(text("UPDATE fixings SET disputed_at = NULL WHERE id = :id"), {"id": str(had.id)})
    if out["differs"]:
        out["held"] = len(fresh)
        return out
    for r, v in fresh:
        verdict = "ok" if verdicts is None else verdicts.get(r["fixing_date"], "unchecked")
        if verdict != "ok":
            out["refused" if verdict == "refused" else "unchecked"] += 1
            continue
        n = 1
        if write:
            n = db.execute(text(
                "INSERT INTO fixings (id, user_id, pair, fixing_date, fixing_time, source, value, origin) "
                "VALUES (:id, NULL, :p, :d, :t, :s, :v, 'FEED') ON CONFLICT DO NOTHING"),
                {"p": r["pair"], "d": r["fixing_date"], "s": r["source"], "id": str(uuid.uuid4()), "t": r.get("fixing_time"), "v": v}).rowcount
        out["written" if n else "known"] += 1
    return out


def put_correction(db, pair: str, fixing_date: date, source: str, value: float, fixing_time: Optional[str], admin_id, note: str) -> str:
    """An administrator's shared fixing for the key: the live shared row, if there is one, is marked superseded and
    kept (its dispute with it), and a row of origin CORRECTION takes its place with its author and reason. Also
    how a date the venue no longer serves is filled. Accounts' own rows are not touched. The caller has checked the
    value and commits. Returns the new row's id."""
    _need(db)
    if not admin_id or not str(note or "").strip():
        raise ValueError("a correction names its author and its reason")
    key = {"p": pair, "d": fixing_date, "s": source}
    db.execute(text("UPDATE fixings SET superseded_at = now() WHERE user_id IS NULL AND pair = :p AND fixing_date = :d AND source = :s "
                    "AND superseded_at IS NULL"), key)
    fid = str(uuid.uuid4())
    db.execute(text("INSERT INTO fixings (id, user_id, pair, fixing_date, fixing_time, source, value, origin, created_by, note) "
                    "VALUES (:id, NULL, :p, :d, :t, :s, :v, 'CORRECTION', CAST(:a AS uuid), :n)"),
               {**key, "id": fid, "t": fixing_time, "v": _positive(value), "a": str(admin_id), "n": str(note).strip()})
    return fid


def put_own(db, user_id, pair: str, fixing_date: date, source: str, value: float, fixing_time: Optional[str] = None) -> str:
    """An account's own fixing. Its previous live row for the same key is marked superseded and kept; shared rows
    and other accounts' rows are never touched. Returns the new row's id; the caller commits."""
    _need(db)
    if not user_id:
        raise ValueError("an own fixing needs its account")
    key = {"u": str(user_id), "p": pair, "d": fixing_date, "s": source}
    db.execute(text("UPDATE fixings SET superseded_at = now() WHERE user_id = CAST(:u AS uuid) AND pair = :p AND fixing_date = :d "
                    "AND source = :s AND superseded_at IS NULL"), key)
    fid = str(uuid.uuid4())
    db.execute(text("INSERT INTO fixings (id, user_id, pair, fixing_date, fixing_time, source, value, origin, created_by) "
                    "VALUES (:id, CAST(:u AS uuid), :p, :d, :t, :s, :v, 'MANUAL', CAST(:u AS uuid))"),
               {**key, "id": fid, "t": fixing_time, "v": _positive(value)})
    return fid
