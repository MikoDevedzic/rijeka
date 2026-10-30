"""Browser error reports: accepted, scrubbed of tokens, rate-limited per address, summarised in the health body."""
import json
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import ops


def _client():
    app = FastAPI()
    app.include_router(ops.router)
    app.dependency_overrides[ops.get_db] = lambda: None
    return TestClient(app)


def _reset():
    ops._errors.clear(); ops._rate.clear(); ops._cache.update(at=0.0, body=None)


def test_report_is_kept_and_summarised():
    _reset(); c = _client()
    r = c.post("/api/ops/client-error", json={"message": "TypeError: x is undefined", "stack": "at Foo (app.js:1)", "route": "/risk", "url": "https://app.rijeka.app/risk",
                                              "user_agent": "UA", "release": "abc123", "at": "2026-10-30T10:00:00Z", "source": "window"})
    assert r.status_code == 202 and r.json() == {"accepted": True}
    s = ops.client_error_summary()
    assert s["last_24h"] == 1 and s["distinct"] == 1
    assert s["top"][0]["message"] == "TypeError: x is undefined" and s["top"][0]["route"] == "/risk" and s["top"][0]["count"] == 1


def test_tokens_are_stripped():
    _reset(); c = _client()
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEFghiJKLmnoPQRstuVWXyz0123456789"
    c.post("/api/ops/client-error", json={"message": f"401 for Bearer {jwt}", "stack": f"Authorization: Bearer {jwt}\n token={jwt}", "route": "/pnl"})
    e = ops._errors[-1]
    assert "eyJ" not in e["message"] and "eyJ" not in e["stack"] and "Bearer " not in e["message"]
    assert e["message"] == "401 for [token]"


def test_per_address_limit_drops_silently_and_summary_counts_by_fingerprint():
    _reset()
    now = time.time()
    for i in range(70):
        ok = ops.record_client_error({"message": "boom", "route": "/blotter"}, "10.0.0.1", now + i * 0.1)
        assert ok is (i < ops.ERR_PER_MINUTE)
    assert ops.record_client_error({"message": "boom", "route": "/blotter"}, "10.0.0.2", now) is True   # another address is not affected
    s = ops.client_error_summary(now + 10)
    assert s["last_24h"] == 61 and s["distinct"] == 1 and s["top"][0]["count"] == 61
    assert ops.record_client_error({"message": "old", "route": "/"}, "10.0.0.3", now - 2 * 86400) is True
    assert ops.client_error_summary(now + 10)["last_24h"] == 61                                            # a two-day-old report is outside the window


def test_health_carries_the_summary_and_rejects_oversize_or_malformed():
    _reset(); c = _client()
    ops._cache.update(at=time.time(), body={"ok": True, "checked_at": "x", "checks": {}})       # no database in this test
    assert c.post("/api/ops/client-error", content=b"x" * 5000, headers={"Content-Type": "application/json"}).json()["accepted"] is False
    assert c.post("/api/ops/client-error", content=b"[1,2]", headers={"Content-Type": "application/json"}).json()["accepted"] is False
    c.post("/api/ops/client-error", json={"message": "ReferenceError: curveObj is not defined", "route": "/blotter"})
    h = c.get("/api/ops/health").json()
    assert h["ok"] is True and h["client_errors"] == {"last_24h": 1}                              # the public body carries a count only
    assert "commit" in h and json.dumps(h)                                                         # serialisable
    assert c.get("/api/ops/client-errors").status_code == 401                                      # the text needs a signed-in operator
    from middleware.auth import verify_token
    c.app.dependency_overrides[verify_token] = lambda: {"sub": "op", "user_metadata": {"role": "admin"}}
    e = c.get("/api/ops/client-errors").json()
    assert e["last_24h"] == 1 and e["top"][0]["message"].startswith("ReferenceError")
