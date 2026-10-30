"""Relayer spend: every anchoring attempt is charged before the chain is called.

The hosted demo pays Sepolia gas from one relayer. Three rolling 24-hour caps protect it,
all counted in ATTEMPTS (an attempt row is written before the transaction is sent, so a
reverted or timed-out transaction that still burned gas counts), and all applied to the
person who actually pressed the button, the signer on a countersign included:

    RIJEKA_CHAIN_DAILY_LIMIT         per user   (0 / unset = no per-user cap: local dev, self-hosted)
    RIJEKA_CHAIN_FIRM_DAILY_LIMIT    per firm   (default 3 × the user cap; 0 = off)
    RIJEKA_CHAIN_GLOBAL_DAILY_LIMIT  everyone   (default 200; 0 = off)

Concurrent requests serialise on a Postgres advisory lock for the few milliseconds of the
check-and-insert, so N parallel clicks cannot all slip under a cap; the lock is released
with the charge's own commit before the chain call starts. Attempts live in chain_attempts
(docs/migrations/2026-10-31_chain_attempts.sql); without the table they are kept in process
memory and the per-user count still has the stored events as a floor, as before."""
from __future__ import annotations

import logging
import os
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import text

log = logging.getLogger("rijeka.chain")
WINDOW = timedelta(hours=24)
DEFAULT_GLOBAL = 200
_memory: deque = deque(maxlen=20000)          # (at, user_id, firm_id, kind) when chain_attempts is absent
_memlock = threading.Lock()
_table: dict[str, Any] = {"at": 0.0, "present": None}


def _int_env(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def limits() -> dict[str, int]:
    user = _int_env("RIJEKA_CHAIN_DAILY_LIMIT", 0)
    # The firm and global defaults follow the per-user cap: with RIJEKA_CHAIN_DAILY_LIMIT unset or 0 and
    # nothing else set, the budget is off altogether (local dev, self-hosted) and nothing is counted.
    return {"user": user,
            "firm": _int_env("RIJEKA_CHAIN_FIRM_DAILY_LIMIT", 3 * user),
            "global": _int_env("RIJEKA_CHAIN_GLOBAL_DAILY_LIMIT", DEFAULT_GLOBAL if user else 0)}


def firm_of(db, user_id) -> Optional[str]:
    try:
        f = db.execute(text("SELECT firm_id FROM firm_members WHERE user_id = :u"), {"u": str(user_id)}).scalar()
        return str(f) if f else None
    except Exception:                        # noqa: BLE001
        try:
            db.rollback()
        except Exception:
            pass
        return None


def table_present(db) -> bool:
    if _table["present"] is not None and time.time() - _table["at"] < 300:
        return _table["present"]
    try:
        ok = bool(db.execute(text("SELECT to_regclass('public.chain_attempts')")).scalar())
    except Exception:                        # noqa: BLE001
        try:
            db.rollback()
        except Exception:
            pass
        ok = False
    _table.update(at=time.time(), present=ok)
    return ok


def _events_count(db, user_id, since: datetime) -> int:
    """Stored anchoring events for the user: the floor for the per-user count when attempts are not persisted."""
    try:
        return int(db.execute(text("SELECT count(*) FROM trade_events WHERE user_id = :u AND event_type IN ('CONFIRMED','AMENDED','TERMINATED') "
                                   "AND created_at > :s"), {"u": str(user_id), "s": since}).scalar() or 0)
    except Exception:                        # noqa: BLE001
        try:
            db.rollback()
        except Exception:
            pass
        return 0


def counts(db, user_id, firm_id: Optional[str], now: Optional[datetime] = None) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    since = now - WINDOW
    if table_present(db):
        row = db.execute(text("SELECT count(*) FILTER (WHERE user_id = :u) AS u, count(*) FILTER (WHERE firm_id = :f) AS f, count(*) AS g "
                              "FROM chain_attempts WHERE at > :s"), {"u": str(user_id), "f": firm_id or "", "s": since}).first()
        return {"user": int(row.u or 0), "firm": int(row.f or 0) if firm_id else 0, "global": int(row.g or 0)}
    with _memlock:
        rows = [r for r in _memory if r[0] > since]
    u = sum(1 for r in rows if r[1] == str(user_id))
    f = sum(1 for r in rows if firm_id and r[2] == firm_id)
    return {"user": max(u, _events_count(db, user_id, since)), "firm": f, "global": len(rows)}


def charge(db, user_id, firm_id: Optional[str] = None, kind: str = "confirm", now: Optional[datetime] = None) -> dict[str, Any]:
    """Check the three caps for the caller and record the attempt; raises 429 when any cap is reached.
    Commits its own small transaction so the advisory lock is held for the check only, never
    for the chain call that follows. Call it before any uncommitted work of the request."""
    lim = limits()
    if not any(lim.values()):                # every cap off (local dev, self-hosted): nothing to count, no database touched
        return {"user": 0, "firm": 0, "global": 0, "limits": lim, "stored": "none"}
    now = now or datetime.now(timezone.utc)
    if firm_id is None:
        firm_id = firm_of(db, user_id)
    try:
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": "rijeka:chain-budget"})
    except Exception:                        # noqa: BLE001 — not Postgres (tests), or no DB: proceed unserialised
        try:
            db.rollback()
        except Exception:
            pass
    c = counts(db, user_id, firm_id, now)
    for scope, label in (("user", "this account"), ("firm", "your firm"), ("global", "the demo")):
        cap = lim[scope]
        if cap and c[scope] >= cap:
            try:
                db.rollback()
            except Exception:
                pass
            raise HTTPException(status_code=429, detail=(
                f"{label.capitalize()} has started {c[scope]} anchoring actions in the last 24 hours, the limit of {cap}. "
                f"Try again tomorrow, or run Rijeka with your own relayer."))
    stored = "memory"
    if table_present(db):
        try:
            db.execute(text("INSERT INTO chain_attempts (at, user_id, firm_id, kind) VALUES (:at, :u, :f, :k)"),
                       {"at": now, "u": str(user_id), "f": firm_id, "k": kind})
            db.commit()
            stored = "db"
        except Exception as e:               # noqa: BLE001
            log.warning("chain budget: attempt row failed (%s); counting in memory", type(e).__name__)
            try:
                db.rollback()
            except Exception:
                pass
    if stored == "memory":
        with _memlock:
            _memory.append((now, str(user_id), firm_id, kind))
        try:
            db.commit()                      # releases the advisory lock
        except Exception:
            pass
    return {"user": c["user"] + 1, "firm": c["firm"] + 1, "global": c["global"] + 1, "limits": lim, "stored": stored}
