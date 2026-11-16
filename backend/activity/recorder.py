"""The one place a request becomes activity: after it was answered, for the account the token check verified.

Outside every route, so no route has to remember it and none can forget: the token check (middleware/auth.py) leaves
the verified account's id on the request; when the response has gone out below 400 this adds one to the day's
counters (activity/store.py: memory only, no wait), and when a flush is due it is run on a worker thread, after the
response. A request without a verified account (a public route, a failed sign-in) is nobody's activity. Nothing here
can fail a request: every error is swallowed and logged.
"""
from __future__ import annotations

import asyncio
import logging

from activity import store

log = logging.getLogger("rijeka.activity")


class ActivityRecorder:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        status = {"code": 0}

        async def watched(message):
            if message["type"] == "http.response.start":
                status["code"] = int(message.get("status") or 0)
            await send(message)

        try:
            await self.app(scope, receive, watched)
        finally:
            try:
                account = (scope.get("state") or {}).get("rijeka_account")
                if account and 0 < status["code"] < 400:
                    store.note(account, scope.get("method", ""), scope.get("path", ""))
                if store.due():
                    asyncio.get_running_loop().run_in_executor(None, store.flush)
            except Exception as e:                      # noqa: BLE001 — the record never costs a request
                log.debug("activity not noted: %s", type(e).__name__)
