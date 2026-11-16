"""Problems and alerts against the stack: a browser's report is kept with the account that sent it (and without one
when its sign-in does not verify), a request the API fails is kept with the route as declared, the admin reads who
was hit, and the operator is told once: in the admins' support rooms, never twice for the same fault, never for a
stranger's report alone, and once a day in summary."""
import os
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from tests.integration.conftest import USER_A, USER_B, set_role

pytestmark = pytest.mark.integration


def _sql(statement: str, **params):
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    try:
        with eng.begin() as c:
            r = c.execute(sa.text(statement), params)
            return r.all() if r.returns_rows else None
    finally:
        eng.dispose()


def _fresh():
    from health import store
    store.flush(); store._reset_for_tests()
    _sql("DELETE FROM health_events")
    _sql("DELETE FROM chat_messages WHERE sender_name = 'Rijeka health'")


def _health_messages(uid: str) -> list[str]:
    return [r[0] for r in _sql("SELECT m.body FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id JOIN chat_room_members mm ON mm.room_id = r.id "
                               "WHERE r.kind = 'SUPPORT' AND mm.user_id = :u AND m.sender_name = 'Rijeka health' ORDER BY m.created_at", u=uid)]


def test_a_report_is_kept_with_its_account_and_a_failed_request_with_its_route(client, auth_a, monkeypatch):
    from api.routes import ops
    from health import store
    _fresh()
    report = {"message": "Cannot read properties of undefined (reading 'npv')", "stack": "at RiskPage (RiskPage-abc.js:1:1)", "route": "/risk",
              "source": "boundary", "release": "abc1234", "user_agent": "test"}
    assert client.post("/api/ops/client-error", json=report, headers=auth_a).json() == {"accepted": True}
    assert client.post("/api/ops/client-error", json=report).json() == {"accepted": True}                       # not signed in
    assert client.post("/api/ops/client-error", json={**report, "message": "Bearer eyJhbGciOiJFUzI1NiJ9.x.y leaked"},
                       headers={"Authorization": "Bearer nonsense"}).json() == {"accepted": True}               # a bad sign-in never costs the report
    # a request the API fails: the route as declared, the account, the status
    monkeypatch.setattr(ops, "client_error_summary", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    assert client.get("/api/ops/client-errors", headers=auth_a).status_code == 500
    monkeypatch.undo()                                                                                          # the fault is mended: nothing else fails
    store.flush()
    rows = _sql("SELECT kind, source, route, status, user_id::text, message FROM health_events ORDER BY at, kind")
    by = {(r[0], r[4], r[5][:12]) for r in rows}
    assert ("browser", USER_A, "Cannot read ") in by and ("browser", None, "Cannot read ") in by
    assert ("browser", None, "[token] leak") in by                                                              # scrubbed before it is kept
    assert ("api", USER_A, "GET /api/ops") in by
    api = [r for r in rows if r[0] == "api"][0]
    assert api[1:4] == ("GET", "/api/ops/client-errors", 500)
    # the public health body says how many, and nothing else
    assert client.get("/api/ops/health").json()["problems"] == {"last_24h": 4, "recording": True}
    assert client.get("/api/ops/health").json()["schema"]["health"]["applied"] is True


def test_the_admin_reads_who_was_hit_and_nobody_else_does(client, auth_a, auth_b):
    assert client.get("/api/ops/problems", headers=auth_b).status_code == 403
    set_role(USER_A, "admin")
    try:
        j = client.get("/api/ops/problems", headers=auth_a).json()
    finally:
        set_role(USER_A, "trader")
    assert j["recording"] is True and j["unread"] is False and j["occurrences"] == 4 and j["hours"] == 24 and j["mail"] is False
    page = [p for p in j["problems"] if p["kind"] == "browser" and p["message"].startswith("Cannot read")][0]
    assert page["count"] == 2 and page["accounts"] == 1 and page["anonymous"] == 1 and len(page["emails"]) == 1 and "@" in page["emails"][0]
    assert page["line"] == "On /risk: Cannot read properties of undefined reading 'npv' · 1 account and visitors not signed in, twice"
    assert set(page) >= {"fingerprint", "kind", "source", "route", "status", "message", "count", "accounts", "emails", "anonymous", "first", "last", "line", "release"}


def test_the_operator_is_told_once_in_the_admins_support_room(client, auth_a, auth_b, monkeypatch):
    from db.session import SessionLocal
    from health import alerts, store
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    assert client.get("/api/chat/rooms", headers=auth_a).status_code == 200                      # user A has a support room
    assert client.get("/api/chat/rooms", headers=auth_b).status_code == 200
    set_role(USER_A, "admin")
    now = datetime.now(timezone.utc).replace(hour=9, minute=0)                                   # before the day's summary
    try:
        db = SessionLocal()
        try:
            out = alerts.step(db, now=now)
        finally:
            db.close()
        assert out["new"] == 4 and out["told"] == 2 and out["rooms"] == 1 and out["mailed"] is False
        told = _health_messages(USER_A)
        assert len(told) == 1 and told[0].startswith("**2 problems on the desk**") and told[0].endswith(alerts.WHERE)
        assert "On /risk: Cannot read properties of undefined reading 'npv'" in told[0] and "GET /api/ops/client-errors answered 500" in told[0]
        assert "token" not in told[0]                              # the stranger's report alone does not ring
        assert "@" not in told[0]                                  # and nobody is named
        assert _health_messages(USER_B) == []                      # a trader is told nothing
        # the same faults again: kept, not told again
        client.post("/api/ops/client-error", json={"message": "Cannot read properties of undefined (reading 'npv')", "route": "/risk", "source": "boundary"}, headers=auth_a)
        store.flush()
        db = SessionLocal()
        try:
            again = alerts.step(db, now=now + timedelta(minutes=1))
            assert again["new"] == 1 and again["told"] == 0 and len(_health_messages(USER_A)) == 1
            assert alerts.step(db, now=now + timedelta(minutes=2)) == {"new": 0, "told": 0}
            # once a day, after the hour, the summary: sent once
            day = alerts.step(db, now=now.replace(hour=alerts.DIGEST_HOUR_UTC, minute=5))
            assert day["digest"]["rooms"] == 1
            assert "digest" not in alerts.step(db, now=now.replace(hour=alerts.DIGEST_HOUR_UTC, minute=6))
        finally:
            db.close()
        told = _health_messages(USER_A)
        assert len(told) == 2 and told[1].startswith("**The last 24 hours, to ") and "3 problems, 5 occurrences" in told[1]
    finally:
        set_role(USER_A, "trader")
        _sql("DELETE FROM chat_messages WHERE sender_name = 'Rijeka health'")
        _sql("DELETE FROM health_events")
