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
            f" To run Rijeka for your own desk, write to {CONTACT}.")


GUEST_SHARE = 2          # all guests together may run this many times what one account may, each minute


def _guest(user: dict, key: str, per_minute: int) -> None:
    """A guest has no account to count against: every guest is the one guest desk. So a guest is counted by address
    (half an account's allowance, never under two a minute), and all guests together against a ceiling, because the
    one CPU they share is also the one the accounts use."""
    now = time.time()
    own = max(2, per_minute // 2)
    for bucket, most, whose in ((f"{key}:guest:{user.get('guest_address') or 'unknown'}", own, "This address"),
                                (f"{key}:guests", per_minute * GUEST_SHARE, "Guests together")):
        q = _buckets.setdefault(bucket, deque())
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= most:
            wait = max(1, int(60 - (now - q[0])) + 1)
            raise HTTPException(status_code=429, headers={"Retry-After": str(wait)},
                                detail=(f"Too many {key} requests; wait a minute. {whose} ran {most} in the last minute; the next is "
                                        f"taken in {wait} s. An account has a limit of its own.{demo_line()}"))
    for bucket in (f"{key}:guest:{user.get('guest_address') or 'unknown'}", f"{key}:guests"):
        _buckets[bucket].append(now)


def heavy(user: dict, key: str, per_minute: int) -> None:
    if _off():
        return
    if (user or {}).get("is_guest"):
        return _guest(user, key, per_minute)
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
