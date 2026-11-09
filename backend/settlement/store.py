"""The fixings table: one row per pair, date and source. A row without a user is shared and written only by the
feed, insert-only (a published fixing is never overwritten); a row with a user is that account's own entry, and a
second entry for the same key supersedes the first, which is kept.

Every function tolerates the table being absent (a deploy ahead of docs/migrations/2026-11-10_fixings.sql): reads
return nothing, writes raise RuntimeError. A negative presence answer is never cached."""
from __future__ import annotations

import logging
import math
import uuid
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy import text

log = logging.getLogger("rijeka.settlement")

_tables: dict[str, Any] = {}
MIGRATION = "docs/migrations/2026-11-10_fixings.sql"
REL_TOLERANCE = 1e-9          # a re-read of a published fixing within this of the stored value is the same number
MAX_ROWS = 2000               # one read of recent rows


def _rollback(db) -> None:
    try:
        db.rollback()
    except Exception:          # noqa: BLE001
        pass


def tables_present(db) -> bool:
    if "present" not in _tables:
        if db is None:
            return False
        try:
            found = db.execute(text("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fixings')")).scalar()
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


def _row(r) -> dict:
    return {"date": r.fixing_date.isoformat(), "source": r.source, "time": r.fixing_time, "value": float(r.value),
            "origin": r.origin, "own": r.user_id is not None}


def get(db, pair: str, fixing_date: date, source: str, user_id) -> Optional[dict]:
    """The fixing for exactly this pair, date and source: the account's own row first, then the shared one.
    None when there is none, and before the migration."""
    if not source or not tables_present(db):
        return None
    r = db.execute(text(
        "SELECT fixing_date, fixing_time, source, value, origin, user_id FROM fixings "
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
        "SELECT fixing_date, fixing_time, source, value, origin, user_id FROM fixings "
        "WHERE pair = :p AND fixing_date >= :d AND superseded_at IS NULL AND (user_id IS NULL OR user_id = CAST(:u AS uuid)) "
        "ORDER BY fixing_date, source, (user_id IS NULL) DESC LIMIT :n"),
        {"p": pair, "d": since, "u": str(user_id) if user_id else None, "n": MAX_ROWS}).all()
    return [_row(r) for r in rows]


def put_shared(db, rows: list[dict]) -> dict:
    """The feed's rows {pair, fixing_date, fixing_time, source, value}: inserted where the key has no shared row,
    left alone where it has one. A re-read that differs from the stored value is logged and counted, not written.
    Returns {written, known, differs}; the caller commits."""
    _need(db)
    out = {"written": 0, "known": 0, "differs": 0}
    for r in rows:
        v = float(r["value"])
        if not (math.isfinite(v) and v > 0):
            raise ValueError("a fixing is a positive, finite number")
        key = {"p": r["pair"], "d": r["fixing_date"], "s": r["source"]}
        had = db.execute(text("SELECT value FROM fixings WHERE user_id IS NULL AND pair = :p AND fixing_date = :d AND source = :s "
                              "AND superseded_at IS NULL"), key).first()
        if had is not None:
            out["known"] += 1
            if abs(float(had.value) - v) > REL_TOLERANCE * max(abs(float(had.value)), 1.0):
                out["differs"] += 1
                log.warning("fixing %s %s (%s): stored %r, re-read %r; the stored value stands", r["pair"], r["fixing_date"], r["source"], float(had.value), v)
            continue
        n = db.execute(text(
            "INSERT INTO fixings (id, user_id, pair, fixing_date, fixing_time, source, value, origin) "
            "VALUES (:id, NULL, :p, :d, :t, :s, :v, 'FEED') ON CONFLICT DO NOTHING"),
            {**key, "id": str(uuid.uuid4()), "t": r.get("fixing_time"), "v": v}).rowcount
        out["written" if n else "known"] += 1
    return out


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
               {**key, "id": fid, "t": fixing_time, "v": float(value)})
    return fid


def latest_shared(db, keys: list[tuple[str, str]]) -> dict[tuple[str, str], date]:
    """{(pair, source): the latest shared fixing date} for the keys that have one."""
    if not keys or not tables_present(db):
        return {}
    rows = db.execute(text("SELECT pair, source, max(fixing_date) AS d FROM fixings WHERE user_id IS NULL AND superseded_at IS NULL "
                           "AND pair = ANY(:p) AND source = ANY(:s) GROUP BY pair, source"),
                      {"p": sorted({k[0] for k in keys}), "s": sorted({k[1] for k in keys})}).all()
    return {(r.pair, r.source): r.d for r in rows if (r.pair, r.source) in set(keys)}
