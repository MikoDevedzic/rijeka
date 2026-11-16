"""Where an answered request becomes activity, for the account the token check verified.

Outside every route, so no route has to remember it and none can forget: the token check (middleware/auth.py) leaves
the verified account's id on the request; when the response has gone out below 400 and the route alone says the
request was a deliberate act (activity/events.py), one is added to the day's counters (activity/store.py: memory
only, no wait). When a flush is due it is run on a worker thread, after the response. A request without a verified
account (a public route, a failed sign-in) is nobody's activity. Nothing here can fail a request: every error is
swallowed and logged, and the flush itself never raises.

Being the one place that sees every answer, it is also where a request that went wrong is noted (health/store.py):
one answered with a 5xx, or one that was answered but took health.SLOW_S seconds or more. Kept: the method, the
route as declared (never the address, so no id), the status, the time taken and the account when there was one.
"""
from __future__ import annotations

import asyncio
import logging
import time

from activity import store
from health import store as health

log = logging.getLogger("rijeka.activity")
_clock = time.monotonic                 # the recorder's own name for the clock, so a test can move it


def _declared(scope) -> str:
    """The route as it is declared (`/api/chain/confirm/{trade_id}`): what is kept of a failed request, so no id is."""
    route = scope.get("route")
    return str(getattr(route, "path", "") or "") or "(no route)"


class ActivityRecorder:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        status = {"code": 0}
        began = _clock()

        async def watched(message):
            if message["type"] == "http.response.start":
                status["code"] = int(message.get("status") or 0)
            await send(message)

        try:
            await self.app(scope, receive, watched)
        finally:
            try:
                account = (scope.get("state") or {}).get("rijeka_account")
                code, method, path = status["code"], scope.get("method", ""), scope.get("path", "")
                if account and 0 < code < 400:
                    store.note(account, method, path)
                # what went wrong for whoever asked (health/store.py): a 5xx, or an answer that took too long
                took = _clock() - began
                if code >= 500:
                    health.add("api", source=method, route=_declared(scope), status=code, ms=took * 1000, user_id=account,
                               message=f"{method} {_declared(scope)} answered {code}")
                elif 0 < code < 400 and took >= health.SLOW_S and not path.endswith("/tick"):
                    health.add("slow", source=method, route=_declared(scope), status=code, ms=took * 1000, user_id=account,
                               message=f"{method} {_declared(scope)} took {round(took)} s")
                loop = asyncio.get_running_loop()
                if store.due():
                    loop.run_in_executor(None, store.flush)
                if health.due():
                    loop.run_in_executor(None, health.flush)
            except Exception as e:                      # noqa: BLE001 — the record never costs a request
                log.debug("activity not noted: %s", type(e).__name__)
