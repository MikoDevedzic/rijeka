"""
Content Security Policy reports from the browser.

POST /api/ops/csp-report     the report-uri of the policy netlify.toml sends (report-only for
                             now). Public, body ≤ 8 KB, 60 a minute per address. Accepts the
                             legacy `application/csp-report` body ({"csp-report": {...}}) and the
                             Reporting API's `application/reports+json` (a list of reports).
GET  /api/ops/csp-reports    signed-in: the last 200 reports, newest first, with the count.
Reports live in memory only: the point is a week with an empty list before the header is
switched from report-only to enforcing (SECURITY.md).
"""
from __future__ import annotations

import json
import logging
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request, Response

from middleware.auth import verify_token

log = logging.getLogger("rijeka.csp")
router = APIRouter(tags=["csp"])

MAX_BODY = 8 * 1024
PER_MINUTE = 60
KEEP = 200
FIELDS = ("document-uri", "violated-directive", "effective-directive", "blocked-uri", "source-file",
          "line-number", "column-number", "disposition", "original-policy", "referrer", "script-sample")
_rate: dict[str, deque] = {}
_reports: deque = deque(maxlen=KEEP)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _allow(ip: str, now: float) -> bool:
    q = _rate.setdefault(ip, deque())
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= PER_MINUTE:
        return False
    q.append(now)
    if len(_rate) > 5000:
        for k in [k for k, v in _rate.items() if not v or now - v[-1] > 60]:
            _rate.pop(k, None)
    return True


def _clip(v: Any) -> Any:
    return v[:500] if isinstance(v, str) else v if isinstance(v, (int, float, bool)) or v is None else str(v)[:500]


def _normalise(body: Any) -> list[dict[str, Any]]:
    """Both report shapes to one: a list of flat dicts with the CSP field names."""
    out: list[dict[str, Any]] = []
    if isinstance(body, dict) and isinstance(body.get("csp-report"), dict):
        out.append({k: _clip(v) for k, v in body["csp-report"].items() if k in FIELDS})
    elif isinstance(body, list):
        for item in body:
            if not isinstance(item, dict) or item.get("type") != "csp-violation":
                continue
            b = item.get("body") if isinstance(item.get("body"), dict) else {}
            r = {
                "document-uri": b.get("documentURL"), "violated-directive": b.get("effectiveDirective"),
                "effective-directive": b.get("effectiveDirective"), "blocked-uri": b.get("blockedURL"),
                "source-file": b.get("sourceFile"), "line-number": b.get("lineNumber"), "column-number": b.get("columnNumber"),
                "disposition": b.get("disposition"), "original-policy": b.get("originalPolicy"), "referrer": b.get("referrer"),
                "script-sample": b.get("sample"), "user-agent": item.get("user_agent"),
            }
            out.append({k: _clip(v) for k, v in r.items() if v is not None})
    return out


def record(reports: list[dict[str, Any]], user_agent: str, now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    for r in reports[:20]:
        _reports.appendleft({"at": now.isoformat(), "user_agent": user_agent[:200], **r})
    return min(len(reports), 20)


@router.post("/api/ops/csp-report", status_code=204)
async def csp_report(request: Request):
    raw = await request.body()
    if len(raw) > MAX_BODY or not _allow(_client_ip(request), time.time()):
        return Response(status_code=204)                      # the browser never looks at the answer
    ctype = request.headers.get("content-type", "")
    if not (ctype.startswith("application/csp-report") or ctype.startswith("application/reports+json") or ctype.startswith("application/json")):
        return Response(status_code=204)
    try:
        body = json.loads(raw.decode("utf-8", "replace") or "null")
    except ValueError:
        return Response(status_code=204)
    n = record(_normalise(body), request.headers.get("user-agent", ""))
    if n:
        log.info("csp: %d report(s) from %s", n, _client_ip(request))
    return Response(status_code=204)


@router.get("/api/ops/csp-reports")
def csp_reports(user: dict = Depends(verify_token)):
    return {"count": len(_reports), "kept": KEEP, "reports": list(_reports)}
