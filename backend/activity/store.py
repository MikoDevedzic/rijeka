"""The buffer and the table behind the activity record.

A request never waits for this. `note()` adds one to a counter in memory, keyed by account, day (UTC), event and
detail; `flush()` writes the counters to `activity_daily` in one transaction and is run off the request path, at
most every FLUSH_S seconds, and when the API stops. A process that dies loses at most that much.

Nothing is kept without the table (docs/migrations/2026-11-16_activity.sql): `flush()` drops what it holds when the
table is not there, and the buffer never grows past BUFFER_MAX keys. The presence check remembers a yes for five
minutes and never a no, so a table applied while the API runs is used at the next flush.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy import text

from activity.events import SEEN, classify, counts

log = logging.getLogger("rijeka.activity")

FLUSH_S = 30.0
BUFFER_MAX = 20_000
_lock = threading.Lock()
_buffer: dict[tuple[str, date, str, str], list] = {}       # key -> [n, first_at, last_at]
_state: dict[str, Any] = {"flushed_at": 0.0, "present_at": 0.0, "present": False, "dropped": 0}

UPSERT = text("""
    INSERT INTO activity_daily (user_id, day, event, detail, n, first_at, last_at)
    VALUES (CAST(:u AS uuid), :day, :event, :detail, :n, :first_at, :last_at)
    ON CONFLICT (user_id, day, event, detail) DO UPDATE
    SET n = activity_daily.n + EXCLUDED.n,
        first_at = LEAST(activity_daily.first_at, EXCLUDED.first_at),
        last_at = GREATEST(activity_daily.last_at, EXCLUDED.last_at)""")


def note(user_id: str, method: str, path: str, now: Optional[datetime] = None) -> int:
    """One answered request of a verified account. Returns how many counters it touched (0, 1 or 2)."""
    if not user_id or not counts(method, path):
        return 0
    now = now or datetime.now(timezone.utc)
    day = now.date()
    kinds = [(SEEN, "")]
    kind = classify(method, path)
    if kind:
        kinds.append(kind)
    with _lock:
        for event, detail in kinds:
            key = (str(user_id), day, event, detail)
            row = _buffer.get(key)
            if row is None:
                if len(_buffer) >= BUFFER_MAX:
                    _state["dropped"] += 1
                    continue
                _buffer[key] = [1, now, now]
            else:
                row[0] += 1
                row[2] = now
    return len(kinds)


def due(now: Optional[float] = None) -> bool:
    return bool(_buffer) and (now or time.time()) - _state["flushed_at"] >= FLUSH_S


def table_present(db) -> bool:
    if _state["present"] and time.time() - _state["present_at"] < 300:
        return True
    try:
        ok = bool(db.execute(text("SELECT to_regclass('public.activity_daily')")).scalar())
    except Exception:                                   # noqa: BLE001 — asked again next time
        db.rollback(); ok = False
    _state.update(present=ok, present_at=time.time() if ok else 0.0)       # a no is never remembered
    return ok


def _take() -> dict:
    with _lock:
        taken = dict(_buffer)
        _buffer.clear()
        _state["flushed_at"] = time.time()
    return taken


def flush(session_factory: Optional[Callable[[], Any]] = None) -> dict:
    """Write the counters. Never raises: a failed write is logged and its counters are dropped, not retried for ever."""
    taken = _take()
    if not taken:
        return {"written": 0, "kept": False}
    try:
        if session_factory is None:
            from db.session import SessionLocal as session_factory      # noqa: N813
        db = session_factory()
    except Exception as e:                              # noqa: BLE001
        log.warning("activity not written: %s", type(e).__name__)
        return {"written": 0, "kept": False}
    try:
        if not table_present(db):
            return {"written": 0, "kept": False}        # no table: nothing is recorded
        db.execute(UPSERT, [{"u": u, "day": day, "event": event, "detail": detail, "n": n, "first_at": first, "last_at": last}
                            for (u, day, event, detail), (n, first, last) in taken.items()])
        db.commit()
        return {"written": len(taken), "kept": True}
    except Exception as e:                              # noqa: BLE001
        db.rollback()
        _state["present"] = False                       # ask again: the table may have gone
        log.warning("activity not written: %s", type(e).__name__)
        return {"written": 0, "kept": False}
    finally:
        db.close()


def status(db) -> dict:
    return {"recording": table_present(db), "buffered": len(_buffer), "dropped": _state["dropped"],
            "flush_seconds": FLUSH_S}


def rows_since(db, since: date) -> list[dict]:
    """Every counter on or after a day; [] when the table is not there."""
    if not table_present(db):
        return []
    try:
        got = db.execute(text("SELECT user_id, day, event, detail, n, first_at, last_at FROM activity_daily WHERE day >= :s"), {"s": since}).all()
    except Exception as e:                              # noqa: BLE001
        db.rollback(); log.warning("activity not read: %s", type(e).__name__)
        return []
    return [{"user_id": str(r[0]), "day": r[1], "event": r[2], "detail": r[3] or "", "n": int(r[4]), "first_at": r[5], "last_at": r[6]} for r in got]


def first_day(db) -> Optional[date]:
    if not table_present(db):
        return None
    try:
        return db.execute(text("SELECT min(day) FROM activity_daily")).scalar()
    except Exception:                                   # noqa: BLE001
        db.rollback()
        return None


def window(today: date, days: int) -> date:
    return today - timedelta(days=days - 1)


def _reset_for_tests() -> None:
    with _lock:
        _buffer.clear()
    _state.update(flushed_at=0.0, present_at=0.0, present=False, dropped=0)
