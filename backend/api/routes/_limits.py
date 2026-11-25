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

# Sliding windows by name, for what is not counted per account: a guest (middleware/guest.py) is counted by address
# and against a ceiling for all guests together. One store and one sweep, so that there is one counter of this
# kind and not one per caller. A key is the caller's to name and is cut to a length: an address is a few dozen
# characters, and a header a stranger wrote is not allowed to be a kilobyte of this process's memory.
_windows: dict[str, tuple[float, deque]] = {}
_swept = 0.0
KEY_MAX = 96


def take_all(counts: list[tuple[str, float, int, str]]) -> None:
    """Each of `counts` is (name, seconds, most, what it is called in the refusal). All are looked at first and
    recorded only if none is full: a caller at its own limit does not use up the one it shares with others.
    429 with Retry-After from the first that is full. Off where the journeys switch the limits off (`_off`)."""
    if _off():
        return
    global _swept
    now = time.time()
    qs = []
    for name, window, most, what in counts:
        name = name[:KEY_MAX]
        held = _windows.get(name)
        q = held[1] if held else deque()
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= most:
            wait = max(1, int(window - (now - q[0])) + 1)
            raise HTTPException(status_code=429, headers={"Retry-After": str(wait)},
                                detail=f"Too many {what}; the next is taken in {wait} s. An account has a limit of its own.{demo_line()}")
        qs.append((name, window, q))
    for name, window, q in qs:
        q.append(now)
        _windows[name] = (window, q)
    if now - _swept > 60 and len(_windows) > 2000:          # at most once a minute, and only when there is something to sweep
        _swept = now
        for k in [k for k, (w, q) in _windows.items() if not q or now - q[-1] > w]:
            _windows.pop(k, None)


def _guest(user: dict, key: str, per_minute: int) -> None:
    """A guest has no account to count against: every guest is the one guest desk. So a guest is counted by address
    (half an account's allowance, never under two a minute) and all guests together against a ceiling, because the
    one CPU they share is also the one the accounts use. The ceiling is the guarantee: the address is what the
    host's proxy passed on (middleware/guest.py `address`)."""
    own = max(2, per_minute // 2)
    take_all([(f"heavy:{key}:guest:{user.get('guest_address') or 'unknown'}", 60.0, own, f"{key} requests from this address"),
              (f"heavy:{key}:guests", 60.0, per_minute * GUEST_SHARE, f"{key} requests by guests")])


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
