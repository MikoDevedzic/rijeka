"""A cap on how much one request may send.

Every route reads its body into memory before it looks at it, and sign-up is open: without a cap one account could
post hundreds of megabytes to any route and take the single small instance down for everyone (the security
reviewer, 17 November 2026). This sits in front of every route. A request that declares a length over the cap is
answered 413 before a byte of it is read. Every other body is read here, counted, and refused the moment it passes
the cap; under it, it is handed on to the app as it arrived. The count does not rest on what the request says about
itself: a length declared beside "chunked" (which a server may frame by the chunks) is counted like any other (the
security reviewer on the first version, 18 November 2026). A body that stops arriving is given up after READ_SECONDS.

The cap is 256 kB, RIJEKA_MAX_BODY_KB to change it (a self-hosted desk loading its own book). A ticket's request is
a few kB and the largest the app sends in a journey is well under it. A route that is sent a whole history in one
body has a cap of its own, named in LARGER, for a caller that shows the scheduler's secret: nobody else is read
4 MB of before being refused.

The answer says what happened in the desk's words (_limits.demo_line): on the hosted demo, that it is a demo sized
for trying the desk and where to write for more."""
from __future__ import annotations

import asyncio
import json
import os

DEFAULT_KB = 256
FLOOR_KB = 16
READ_SECONDS = 30.0        # how long one piece of a body may take to arrive
# exact path → kB: the routes that are sent more than a screen's worth by design, for the scheduler alone
LARGER = {
    "/api/risk/history/ingest": 4096,          # years of daily spots in one body
}


def base_kb() -> int:
    raw = (os.getenv("RIJEKA_MAX_BODY_KB", "") or "").strip()
    return max(int(raw), FLOOR_KB) if raw.isdigit() else DEFAULT_KB


def _scheduler(headers) -> bool:
    """The caller shows RIJEKA_CRON_SECRET (the guard of the routes in LARGER, read here because a route's own
    check runs after its body has been parsed)."""
    try:
        from api.routes.risk import _secret_ok
    except Exception:              # noqa: BLE001
        return False
    given = next((v.decode("latin-1") for k, v in headers if k == b"x-rijeka-cron"), None)
    return _secret_ok(given)


def cap_kb(path: str, headers=()) -> int:
    base = base_kb()
    kb = LARGER.get(path.rstrip("/") or path)
    return max(kb, base) if kb is not None and _scheduler(headers) else base


def too_large(sent_bytes: int | None, kb: int) -> str:
    from api.routes._limits import demo_line
    size = f"about {max(1, round(sent_bytes / 1024)):,} kB" if sent_bytes else f"more than {kb:,} kB"
    return f"This request is {size}; one request to this desk may carry {kb:,} kB.{demo_line()}"


class BodyLimit:
    """Pure ASGI: it reads the body's messages itself, up to the cap, and replays them to the app."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") in ("GET", "HEAD", "OPTIONS"):
            return await self.app(scope, receive, send)
        headers = scope.get("headers") or []
        kb = cap_kb(scope.get("path") or "", headers)
        cap = kb * 1024
        chunked = any(k == b"transfer-encoding" for k, _ in headers)
        for k, v in headers:
            if k == b"content-length":
                if not v.strip().isdigit():
                    return await _refuse(send, "This request's Content-Length is not a number.", status=400)
                if not chunked and int(v) > cap:
                    return await _refuse(send, too_large(int(v), kb))      # by its own word, before a byte is read

        held, seen = [], 0
        while True:
            try:
                message = await asyncio.wait_for(receive(), timeout=READ_SECONDS)
            except TimeoutError:                     # asyncio's, the same class since Python 3.11 (the API's)
                return await _refuse(send, "This request's body stopped arriving; it was given up.", status=408)
            held.append(message)
            if message["type"] != "http.request":
                break                                    # the sender went away: the app is told so
            seen += len(message.get("body") or b"")
            if seen > cap:
                held.clear()
                return await _refuse(send, too_large(seen if not message.get("more_body") else None, kb))
            if not message.get("more_body"):
                break

        async def replay():
            return held.pop(0) if held else await receive()

        await self.app(scope, replay, send)


async def _refuse(send, detail: str, status: int = 413) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"connection", b"close")]})
    await send({"type": "http.response.body", "body": body})
