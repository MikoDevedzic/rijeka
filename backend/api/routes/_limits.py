"""A per-user limit for the routes that burn a CPU: a sliding minute, in process. Not a
defence against a determined flood (that is the edge's job), a guard against one account
holding the single Render CPU with repeated live revaluations or Monte Carlo runs."""
from __future__ import annotations

import time
from collections import deque

from fastapi import HTTPException

_buckets: dict[str, deque] = {}


def _off() -> bool:
    """The browser journeys click faster than a person: RIJEKA_RATE_LIMITS=0 switches the limits off, and only on
    the local stack (SUPABASE_URL is the stack's placeholder), so a hosted process can never run without them."""
    import os
    return os.getenv("RIJEKA_RATE_LIMITS", "1").strip() == "0" and os.getenv("SUPABASE_URL", "") == "http://stack.local"


CONTACT = "miko@rijeka.app"


def demo_line() -> str:
    """What a refusal for size or for frequency adds on the hosted demo (a leading space, or nothing on a desk a
    firm runs for itself): why the limit is there and where to write. One place for the words."""
    try:
        from api.routes.demo import enabled
        on = enabled()
    except Exception:              # noqa: BLE001
        on = False
    if not on:
        return ""
    return (" This is the demo desk: one small server shared by everyone trying it, not sized for heavy use."
            f" For commercial use write to {CONTACT}.")


def heavy(user: dict, key: str, per_minute: int) -> None:
    if _off():
        return
    sub = str((user or {}).get("sub") or "anon")
    now = time.time()
    q = _buckets.setdefault(f"{key}:{sub}", deque())
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= per_minute:
        # when the oldest of the minute's runs leaves the window: the wait that is true for this account
        wait = max(1, int(60 - (now - q[0])) + 1)
        raise HTTPException(status_code=429, headers={"Retry-After": str(wait)},
                            detail=(f"Too many {key} requests; wait a minute. The stored result is still available."
                                    f" This account has run {per_minute} in the last minute; the next is taken in {wait} s.{demo_line()}"))
    q.append(now)
    if len(_buckets) > 10000:
        for k in [k for k, v in _buckets.items() if not v or now - v[-1] > 60]:
            _buckets.pop(k, None)
