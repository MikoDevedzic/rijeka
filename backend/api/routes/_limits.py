"""A per-user limit for the routes that burn a CPU: a sliding minute, in process. Not a
defence against a determined flood (that is the edge's job), a guard against one account
holding the single Render CPU with repeated live revaluations or Monte Carlo runs."""
from __future__ import annotations

import time
from collections import deque

from fastapi import HTTPException

_buckets: dict[str, deque] = {}


def heavy(user: dict, key: str, per_minute: int) -> None:
    sub = str((user or {}).get("sub") or "anon")
    now = time.time()
    q = _buckets.setdefault(f"{key}:{sub}", deque())
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= per_minute:
        raise HTTPException(status_code=429, detail=f"Too many {key} requests; wait a minute. The stored result is still available.")
    q.append(now)
    if len(_buckets) > 10000:
        for k in [k for k, v in _buckets.items() if not v or now - v[-1] > 60]:
            _buckets.pop(k, None)
