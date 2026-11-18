"""A cap on how much one request may send.

Every route reads its body into memory before it looks at it, and sign-up is open: without a cap one account could
post hundreds of megabytes to any route and take the single small instance down for everyone (the security
reviewer, 17 November 2026). This sits in front of every route: a request whose body is over the cap is answered
413 before a byte of it is read when it says its length; one that does not (a chunked body) is read here up to the
cap and refused the moment it passes it.

The cap is 256 kB, RIJEKA_MAX_BODY_KB to change it (a self-hosted desk loading its own book). A ticket's request is
a few kB and the largest the app sends in a journey is well under it. A route that is sent a whole history in one
body has a cap of its own, named in LARGER.

The answer says what happened in the desk's words (limits_copy): on the hosted demo, that it is a demo sized for
trying the desk and where to write for more."""
from __future__ import annotations

import json
import os

DEFAULT_KB = 256
# path prefix → kB: the routes that are sent more than a screen's worth by design
LARGER = {
    "/api/risk/history/ingest": 4096,          # years of daily spots in one body, from the backfill workflow
}


def cap_kb(path: str) -> int:
    try:
        base = int(os.getenv("RIJEKA_MAX_BODY_KB", "") or DEFAULT_KB)
    except ValueError:
        base = DEFAULT_KB
    base = max(base, 16)
    for prefix, kb in LARGER.items():
        if path.startswith(prefix):
            return max(kb, base)
    return base


def too_large(sent_bytes: int | None, kb: int) -> str:
    from api.routes._limits import demo_line
    size = f"about {max(1, round(sent_bytes / 1024)):,} kB" if sent_bytes else f"more than {kb:,} kB"
    return f"This request is {size}; one request to this desk may carry {kb:,} kB.{demo_line()}"


class BodyLimit:
    """Pure ASGI. A body that says its length is judged on that (the server holds a sender to the length it gave)
    and passes through untouched. A body that does not (chunked) is read here up to the cap, which is all the memory
    it can take, and then either refused or handed on to the app as it arrived."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") in ("GET", "HEAD", "OPTIONS"):
            return await self.app(scope, receive, send)
        kb = cap_kb(scope.get("path") or "")
        cap = kb * 1024
        declared = None
        for k, v in scope.get("headers") or []:
            if k == b"content-length":
                try:
                    declared = int(v)
                except ValueError:
                    return await _refuse(send, "This request's Content-Length is not a number.", status=400)
        if declared is not None:
            if declared > cap:
                return await _refuse(send, too_large(declared, kb))
            return await self.app(scope, receive, send)

        held, seen = [], 0
        while True:
            message = await receive()
            held.append(message)
            if message["type"] != "http.request":
                break                                    # the sender went away: the app is told so
            seen += len(message.get("body") or b"")
            if seen > cap:
                return await _refuse(send, too_large(None, kb))
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
