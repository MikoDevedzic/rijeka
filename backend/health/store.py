"""The problems people hit: where they come from, how they are kept, how they are read.

Three kinds, each from the one place that sees it:
    browser   the app's own report (lib/errors.js → POST /api/ops/client-error): an uncaught error, a page whose
              file did not arrive, a chat message that was not sent. Text from outside: cut to a length and scrubbed
              of anything shaped like a token before it comes here.
    api       a request the API answered with a 5xx (activity/recorder.py, which wraps every route)
    slow      a request that was answered but took SLOW_S seconds or more
An API problem carries the route as it is declared (`/api/chain/confirm/{trade_id}`), never the address asked for,
so no id is kept; and the account the token check verified, when there was one.

`add()` never waits and never raises: a problem goes into a small buffer and `flush()` writes it off the request
path, at once when the recorder next has a moment, and when the API stops. Without the table nothing is kept here.
Anyone may post a browser's report, so browsers together are kept to so many in ten minutes and in a day, signed-in
and unsigned each in an allowance of their own (a flood of strangers' reports never leaves a signed-in account's
without room), and a report nobody signed keeps only the start of its stack; beyond the limits a report is counted as dropped. Only the
hosted API records (activity/store.py: enabled): a developer's own server reads the same database as production,
and its errors are not the desk's.
Rows older than KEEP_DAYS are deleted, once a day, by the alert step.

`fingerprint()` is what makes two problems the same problem: the kind, the place and the message with its numbers
and ids taken out, so that one fault hit by forty people is one line and one alert.
"""
from __future__ import annotations

import hashlib
import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy import text

from activity.store import enabled

log = logging.getLogger("rijeka.health")

KINDS = ("browser", "api", "slow")
SLOW_S = 30.0
KEEP_DAYS = 30
BUFFER_MAX = 500
FLUSH_GAP_S = 5.0
BROWSER_PER_10_MIN = 120              # reports kept from signed-in browsers together: the route's own limit is per address
BROWSER_PER_DAY = 5000
UNSIGNED_PER_10_MIN = 60              # and from browsers nobody signed, in an allowance of their own: a flood of
UNSIGNED_PER_DAY = 2000               # strangers' reports must never leave a signed-in account's report without room
ANONYMOUS_STACK = 500                 # of a report nobody signed: enough to tell faults apart, not a place to keep text
READ_MAX = 2000
FIELD = {"source": 40, "route": 200, "message": 500, "stack": 4000, "release": 60, "user_agent": 200}
_lock = threading.Lock()
_buffer: list[dict] = []
_state: dict[str, Any] = {"flushed_at": 0.0, "present_at": 0.0, "present": False, "dropped": 0}
_browser: dict[bool, list[float]] = {True: [], False: []}      # when the last reports were taken: signed, unsigned

INSERT = text("""
    INSERT INTO health_events (at, kind, source, route, status, ms, message, stack, release, user_agent, user_id, fingerprint)
    VALUES (:at, :kind, :source, :route, :status, :ms, :message, :stack, :release, :user_agent, CAST(:user_id AS uuid), :fingerprint)""")

_VARIES = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|0x[0-9a-fA-F]+|-[A-Za-z0-9_-]{8}\.(?:js|css)|\d+")


def fingerprint(kind: str, route: str, message: str, status: Optional[int] = None) -> str:
    """The same fault is the same fingerprint whoever hit it and whatever id or build it named."""
    shape = _VARIES.sub("#", (message or "")[:200]).strip().lower()
    return hashlib.sha256(f"{kind}|{route or ''}|{status or ''}|{shape}".encode()).hexdigest()[:16]


def _cut(v: Any, n: int) -> str:
    return str(v or "").replace("\x00", "")[:n]          # the database takes no NUL in text


def add(kind: str, *, source: str = "", route: str = "", status: Optional[int] = None, ms: Optional[float] = None,
        message: str = "", stack: str = "", release: str = "", user_agent: str = "", user_id: Optional[str] = None,
        now: Optional[datetime] = None) -> bool:
    """One problem. False when it was not taken (an unknown kind, or the buffer is full)."""
    try:
        if kind not in KINDS or not enabled():
            return False
        row = {"at": now or datetime.now(timezone.utc), "kind": kind, "source": _cut(source, FIELD["source"]), "route": _cut(route, FIELD["route"]),
               "status": int(status) if status else None, "ms": int(ms) if ms is not None else None,
               "message": _cut(message, FIELD["message"]),
               "stack": _cut(stack, FIELD["stack"] if user_id or kind != "browser" else ANONYMOUS_STACK) or None,
               "release": _cut(release, FIELD["release"]) or None, "user_agent": _cut(user_agent, FIELD["user_agent"]) or None,
               "user_id": str(user_id) if user_id else None}
        row["fingerprint"] = fingerprint(kind, row["route"], row["message"], row["status"])
        with _lock:
            if kind == "browser":             # anyone may post a report: together they may fill no table
                at, signed = time.time(), bool(user_id)
                taken = _browser[signed] = [t for t in _browser[signed] if at - t < 86400]
                per_day, per_10 = (BROWSER_PER_DAY, BROWSER_PER_10_MIN) if signed else (UNSIGNED_PER_DAY, UNSIGNED_PER_10_MIN)
                if len(taken) >= per_day or sum(1 for t in taken if at - t < 600) >= per_10:
                    _state["dropped"] += 1
                    return False
                taken.append(at)
            if len(_buffer) >= BUFFER_MAX:
                _state["dropped"] += 1
                return False
            _buffer.append(row)
        return True
    except Exception:                                   # noqa: BLE001 — recording a problem must never be one
        return False


def due(now: Optional[float] = None) -> bool:
    return bool(_buffer) and (now or time.time()) - _state["flushed_at"] >= FLUSH_GAP_S


def table_present(db) -> bool:
    if _state["present"] and time.time() - _state["present_at"] < 300:
        return True
    try:
        ok = bool(db.execute(text("SELECT to_regclass('public.health_events')")).scalar())
    except Exception:                                   # noqa: BLE001 — asked again next time
        _quiet(db.rollback); ok = False
    _state.update(present=ok, present_at=time.time() if ok else 0.0)       # a no is never remembered
    return ok


def _quiet(fn: Callable[[], Any]) -> None:
    try:
        fn()
    except Exception:                                   # noqa: BLE001
        pass


def flush(session_factory: Optional[Callable[[], Any]] = None) -> dict:
    """Write what is buffered, each row on its own (they are few, and one bad row must not cost the others).
    Never raises."""
    taken: list = []
    try:
        with _lock:
            taken = list(_buffer)
            _buffer.clear()
            _state["flushed_at"] = time.time()
        if not taken:
            return {"written": 0, "kept": False}
        if session_factory is None:
            from db.session import SessionLocal as session_factory      # noqa: N813
        db = session_factory()
    except Exception as e:                              # noqa: BLE001
        log.warning("problems not written: %s", type(e).__name__)
        _state["dropped"] += len(taken)
        return {"written": 0, "kept": False}
    try:
        if not table_present(db):
            return {"written": 0, "kept": False}        # no table: nothing is kept here
        written = 0
        for row in taken:
            try:
                db.execute(INSERT, row)
                db.commit()
                written += 1
            except Exception:                           # noqa: BLE001 — an account that is gone: kept without it
                _quiet(db.rollback)
                try:
                    db.execute(INSERT, {**row, "user_id": None})
                    db.commit()
                    written += 1
                except Exception:                       # noqa: BLE001
                    _quiet(db.rollback)
        if written < len(taken):
            _state["dropped"] += len(taken) - written
            _state["present"] = False
        return {"written": written, "kept": written > 0}
    except Exception as e:                              # noqa: BLE001
        log.warning("problems not written: %s", type(e).__name__)
        _state["dropped"] += len(taken)
        return {"written": 0, "kept": False}
    finally:
        _quiet(db.close)


# ── reads ────────────────────────────────────────────────────────────────────
def count_since(db, hours: float = 24.0) -> Optional[int]:
    """How many problems in the window; None when the table is not there or cannot be read."""
    if not table_present(db):
        return None
    try:
        return int(db.execute(text("SELECT count(*) FROM health_events WHERE kind <> 'digest' AND at >= :s"),
                              {"s": datetime.now(timezone.utc) - timedelta(hours=hours)}).scalar() or 0)
    except Exception:                                   # noqa: BLE001
        _quiet(db.rollback)
        return None


def rows_since(db, since: datetime, strict: bool = False) -> Optional[list[dict]]:
    """The problems since a moment, with the account's e-mail where there is one. For the admin's page and the day's
    summary. [] without the table; None when it could not be read, or with `strict` the error itself, the session
    left as it was (the alert step must not have its transaction rolled back under it, nor take "unread" for "none")."""
    if not table_present(db):
        return []
    if strict:
        return _rows(db, since)
    try:
        return _rows(db, since)
    except Exception as e:                              # noqa: BLE001
        _quiet(db.rollback); log.warning("problems not read: %s", type(e).__name__)
        return None


def _rows(db, since: datetime) -> list[dict]:
    got = db.execute(text(
        "SELECT h.id, h.at, h.kind, h.source, h.route, h.status, h.ms, h.message, h.release, h.user_id, u.email, h.fingerprint, h.alerted_at "
        "FROM health_events h LEFT JOIN auth.users u ON u.id = h.user_id WHERE h.kind <> 'digest' AND h.at >= :s "
        "ORDER BY (h.kind = 'browser'), h.at DESC LIMIT :n"),          # what the API saw first: a flood of reports must not push it out
        {"s": since, "n": READ_MAX}).all()
    keys = ("id", "at", "kind", "source", "route", "status", "ms", "message", "release", "user_id", "email", "fingerprint", "alerted_at")
    return [dict(zip(keys, r)) for r in got]


def group(rows: list[dict]) -> list[dict]:
    """The same problem as one line: how often, how many accounts, who, first and last."""
    out: dict[str, dict] = {}
    for r in rows:
        g = out.setdefault(r["fingerprint"], {"fingerprint": r["fingerprint"], "kind": r["kind"], "source": r["source"], "route": r["route"],
                                              "status": r["status"], "message": r["message"], "count": 0, "accounts": set(), "emails": set(),
                                              "signed_sources": set(),
                                              "anonymous": 0, "first": r["at"], "last": r["at"], "slowest_ms": None, "release": r.get("release")})
        g["count"] += 1
        if r.get("user_id"):
            g["accounts"].add(str(r["user_id"]))
            g["signed_sources"].add(r.get("source") or "")      # where the signed-in reports say they came from: a stranger's label is not asked
            if r.get("email"):
                g["emails"].add(r["email"])
        else:
            g["anonymous"] += 1
        g["first"] = min(g["first"], r["at"]); g["last"] = max(g["last"], r["at"])
        if r.get("ms") is not None:
            g["slowest_ms"] = max(g["slowest_ms"] or 0, int(r["ms"]))
    done = []
    for g in out.values():
        done.append({**g, "accounts": len(g["accounts"]), "emails": sorted(g["emails"]), "signed_sources": sorted(g["signed_sources"]),
                     "first": g["first"].isoformat() if hasattr(g["first"], "isoformat") else g["first"],
                     "last": g["last"].isoformat() if hasattr(g["last"], "isoformat") else g["last"]})
    # what the API saw for itself first (nobody can forge it), then by how many accounts, then by how often
    done.sort(key=lambda g: ({"api": 0, "slow": 1}.get(g["kind"], 2), -g["accounts"], -g["count"], g["last"]))
    return done


def status(db) -> dict:
    return {"recording": enabled() and table_present(db), "buffered": len(_buffer), "dropped": _state["dropped"], "keep_days": KEEP_DAYS, "slow_seconds": SLOW_S}


def _reset_for_tests() -> None:
    with _lock:
        _buffer.clear(); _browser[True] = []; _browser[False] = []
    _state.update(flushed_at=0.0, present_at=0.0, present=False, dropped=0)
