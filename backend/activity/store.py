"""The buffer and the table behind the activity record.

A request never waits for this. `add()` adds one to a counter in memory, keyed by account, day (UTC), event and
detail; `flush()` writes the counters to `activity_daily` and is run off the request path, at most every FLUSH_S
seconds, and when the API stops. A process that dies loses at most that much.

Nothing is kept without the table (docs/migrations/2026-11-16_activity.sql): `flush()` drops what it holds when the
table is not there, and the buffer never grows past BUFFER_MAX keys. The presence check remembers a yes for five
minutes and never a no, so a table applied while the API runs is used at the next flush.

Two API processes may flush the same keys at once. Rows are written in key order, so both take their locks in the
same order and neither is chosen as a deadlock's victim. A batch that fails as one statement (an account deleted
while its token still lived is refused by the table's foreign key) is written again row by row, each on its own,
so one row that cannot be written costs that row and not the half minute of every account. What is lost is
counted (`dropped`) and shown to the operator.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timezone
from typing import Any, Callable, Optional

from sqlalchemy import text

from activity.events import classify

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


def add(user_id: str, event: str, detail: str = "", now: Optional[datetime] = None) -> bool:
    """One more of a kind of activity for an account today. False when it was not counted."""
    if not user_id or not event:
        return False
    now = now or datetime.now(timezone.utc)
    key = (str(user_id), now.date(), event, detail or "")
    with _lock:
        row = _buffer.get(key)
        if row is None:
            if len(_buffer) >= BUFFER_MAX:
                _state["dropped"] += 1
                return False
            _buffer[key] = [1, now, now]
        else:
            row[0] += 1
            row[2] = now
    return True


def note(user_id: str, method: str, path: str, now: Optional[datetime] = None) -> bool:
    """An answered request of a verified account: counted when its route alone says it was deliberate."""
    kind = classify(method, path)
    return add(user_id, kind[0], kind[1], now) if kind else False


def due(now: Optional[float] = None) -> bool:
    return bool(_buffer) and (now or time.time()) - _state["flushed_at"] >= FLUSH_S


def table_present(db) -> bool:
    if _state["present"] and time.time() - _state["present_at"] < 300:
        return True
    try:
        ok = bool(db.execute(text("SELECT to_regclass('public.activity_daily')")).scalar())
    except Exception:                                   # noqa: BLE001 — asked again next time
        _quiet(db.rollback); ok = False
    _state.update(present=ok, present_at=time.time() if ok else 0.0)       # a no is never remembered
    return ok


def _quiet(fn: Callable[[], Any]) -> None:
    try:
        fn()
    except Exception:                                   # noqa: BLE001 — a connection that is gone cannot be rolled back or closed
        pass


def _take() -> list[tuple[tuple[str, date, str, str], list]]:
    with _lock:
        taken = sorted(_buffer.items())                 # one order in every process: no two flushes lock rows crosswise
        _buffer.clear()
        _state["flushed_at"] = time.time()
    return taken


def _lost(n: int) -> None:
    with _lock:
        _state["dropped"] += n


def flush(session_factory: Optional[Callable[[], Any]] = None) -> dict:
    """Write the counters. Never raises, whatever the database does."""
    taken: list = []
    try:
        taken = _take()
        if not taken:
            return {"written": 0, "kept": False}
        if session_factory is None:
            from db.session import SessionLocal as session_factory      # noqa: N813
        db = session_factory()
    except Exception as e:                              # noqa: BLE001
        log.warning("activity not written: %s", type(e).__name__)
        _lost(len(taken))
        return {"written": 0, "kept": False}
    try:
        if not table_present(db):
            return {"written": 0, "kept": False}        # no table: nothing is recorded, and nothing was lost
        rows = [{"u": u, "day": day, "event": event, "detail": detail, "n": n, "first_at": first, "last_at": last}
                for (u, day, event, detail), (n, first, last) in taken]
        try:
            db.execute(UPSERT, rows)
            db.commit()
            return {"written": len(rows), "kept": True}
        except Exception as e:                          # noqa: BLE001 — one row may be the cause: write the others
            _quiet(db.rollback)
            log.warning("activity batch refused (%s): writing its %d rows one by one", type(e).__name__, len(rows))
        written = 0
        for row in rows:
            try:
                db.execute(UPSERT, row)
                db.commit()
                written += 1
            except Exception:                           # noqa: BLE001
                _quiet(db.rollback)
        if written < len(rows):
            _lost(len(rows) - written)
            _state["present"] = False                   # ask again: the table may have gone
        return {"written": written, "kept": written > 0}
    except Exception as e:                              # noqa: BLE001
        log.warning("activity not written: %s", type(e).__name__)
        _lost(len(taken))
        return {"written": 0, "kept": False}
    finally:
        _quiet(db.close)


def status(db) -> dict:
    return {"recording": table_present(db), "buffered": len(_buffer), "dropped": _state["dropped"], "flush_seconds": FLUSH_S}


def rows_since(db, since: date) -> Optional[list[dict]]:
    """Every counter on or after a day; [] when the table is not there; None when it could not be read."""
    if not table_present(db):
        return []
    try:
        got = db.execute(text("SELECT user_id, day, event, detail, n, first_at, last_at FROM activity_daily WHERE day >= :s"), {"s": since}).all()
    except Exception as e:                              # noqa: BLE001
        _quiet(db.rollback); log.warning("activity not read: %s", type(e).__name__)
        return None
    return [{"user_id": str(r[0]), "day": r[1], "event": r[2], "detail": r[3] or "", "n": int(r[4]), "first_at": r[5], "last_at": r[6]} for r in got]


def ever(db) -> Optional[list[dict]]:
    """Each account's whole record by kind: the days it happened on, the first and the last time. For the figures that
    say "ever", which a window of days must not cut. [] without the table; None when it could not be read."""
    if not table_present(db):
        return []
    try:
        got = db.execute(text("SELECT user_id, event, detail, count(*), min(first_at), max(last_at) FROM activity_daily GROUP BY 1, 2, 3")).all()
    except Exception as e:                              # noqa: BLE001
        _quiet(db.rollback); log.warning("activity not read: %s", type(e).__name__)
        return None
    return [{"user_id": str(r[0]), "event": r[1], "detail": r[2] or "", "days": int(r[3]), "first_at": r[4], "last_at": r[5]} for r in got]


def first_day(db) -> Optional[date]:
    if not table_present(db):
        return None
    try:
        return db.execute(text("SELECT min(day) FROM activity_daily")).scalar()
    except Exception:                                   # noqa: BLE001
        _quiet(db.rollback)
        return None


def _reset_for_tests() -> None:
    with _lock:
        _buffer.clear()
    _state.update(flushed_at=0.0, present_at=0.0, present=False, dropped=0)
