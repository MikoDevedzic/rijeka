"""One way to fail on an internal error: the exception goes to the log with its class and
text, the client gets a fixed sentence and a status. Database drivers put the statement and
its parameters in their messages, RPC clients put URLs in theirs, pricers put file paths in
theirs; none of that belongs in an HTTP response."""
from __future__ import annotations

import logging

from fastapi import HTTPException

log = logging.getLogger("rijeka.errors")


def internal(status: int, message: str, exc: BaseException) -> HTTPException:
    log.warning("%s: %s: %s", message, type(exc).__name__, str(exc)[:500])
    return HTTPException(status_code=status, detail=f"{message}. The detail is in the server log.")
