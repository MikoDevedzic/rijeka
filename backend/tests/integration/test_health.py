"""Problems and alerts against the stack: a browser's report is kept with the account that sent it (and without one
when its sign-in does not verify), a request the API fails is kept with the route as declared, the admin reads who
was hit, and the operator is told once: in the admins' support rooms, never twice for the same fault, never for a
stranger's report alone and never silenced by one, only when the message reaches somebody, and once a day in
summary."""
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
    assert client.get("/api/chat/rooms", headers=auth_a).status_code == 200                      # user A has a support room
    set_role(USER_A, "admin")
    try:
        j = client.get("/api/ops/problems", headers=auth_a).json()
    finally:
        set_role(USER_A, "trader")
    assert j["recording"] is True and j["unread"] is False and j["truncated"] is False and j["occurrences"] == 4 and j["hours"] == 24
    assert j["mail"] is False and j["rooms"] == 1                                                # who would be told: one admin's room, no mail
    assert j["problems"][0]["kind"] == "api" and j["problems"][0]["rings"] is True               # what the API saw for itself first
    page = [p for p in j["problems"] if p["kind"] == "browser" and p["message"].startswith("Cannot read")][0]
    assert page["count"] == 2 and page["accounts"] == 1 and page["anonymous"] == 1 and len(page["emails"]) == 1 and "@" in page["emails"][0]
    assert page["line"] == "On /risk: Cannot read properties of undefined reading 'npv' · 1 account and visitors not signed in, twice"
    leaked = [p for p in j["problems"] if p["message"].startswith("[token]")][0]
    assert leaked["rings"] is False and leaked["accounts"] == 0                                  # nobody signed it: kept, shown, never rings


def _step(now):
    from db.session import SessionLocal
    from health import alerts
    db = SessionLocal()
    try:
        return alerts.step(db, now=now)
    finally:
        db.close()


def test_the_operator_is_told_once_only_when_it_reaches_somebody_and_never_silenced_by_a_stranger(client, auth_a, auth_b, monkeypatch):
    from health import alerts, store
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    assert client.get("/api/chat/rooms", headers=auth_a).status_code == 200                      # both have a support room
    assert client.get("/api/chat/rooms", headers=auth_b).status_code == 200
    now = datetime.now(timezone.utc).replace(hour=9, minute=0)                                   # before the day's summary
    try:
        # nobody holds the admin role: there is something to tell and nobody to tell it to. Said, not swallowed,
        # and nothing is marked told, so the next pass tries again.
        with pytest.raises(alerts.Undelivered):
            _step(now)
        assert _sql("SELECT count(*) FROM health_events WHERE rang")[0][0] == 0
        assert _sql("SELECT count(*) FROM health_events WHERE alerted_at IS NULL")[0][0] == 3     # the two faults that ring, still waiting
        assert _health_messages(USER_A) == []

        set_role(USER_A, "admin")
        out = _step(now + timedelta(minutes=1))
        assert out["new"] == 3 and out["told"] == 2 and out["rooms"] == 1 and out["mailed"] is False
        told = _health_messages(USER_A)
        assert len(told) == 1 and told[0].startswith("**2 problems on the desk**") and told[0].endswith(alerts.WHERE)
        lines = told[0].split("\n")
        assert lines[1].startswith("- GET /api/ops/client-errors answered 500")                  # what the API saw, first
        assert lines[2].startswith("- On /risk: Cannot read properties of undefined reading 'npv'")
        assert "token" not in told[0] and "@" not in told[0]                                     # a stranger's report does not ring; nobody is named
        assert _health_messages(USER_B) == []                                                    # a trader is told nothing

        # the same fault again: kept, not told again
        report = {"message": "Cannot read properties of undefined (reading 'npv')", "route": "/risk", "source": "boundary"}
        client.post("/api/ops/client-error", json=report, headers=auth_a); store.flush()
        again = _step(now + timedelta(minutes=2))
        assert again["new"] == 1 and again["told"] == 0 and len(_health_messages(USER_A)) == 1
        assert _step(now + timedelta(minutes=3)) == {"new": 0, "told": 0}

        # a stranger sends a report first, in the very words of a fault the app can report; then a signed-in account
        # really hits it. The stranger's is looked at and silences nothing: the real one rings.
        fault = {"message": "The blotter could not be drawn", "route": "/blotter", "source": "boundary"}
        client.post("/api/ops/client-error", json=fault); store.flush()
        assert _step(now + timedelta(minutes=4)) == {"new": 1, "told": 0}
        client.post("/api/ops/client-error", json=fault, headers=auth_b); store.flush()
        rang = _step(now + timedelta(minutes=5))
        assert rang["told"] == 1 and "On /blotter: The blotter could not be drawn" in _health_messages(USER_A)[-1]

        # what is not a fault of the desk's does not ring: an answer that says "not supported" or "not configured",
        # and a browser that could not reach the API (one person's connection)
        store.add("api", source="POST", route="/api/price/swaption", status=501, message="POST /api/price/swaption answered 501", user_id=USER_B)
        store.add("api", source="POST", route="/api/analyse", status=503, message="POST /api/analyse answered 503", user_id=USER_B)
        store.add("browser", source="net-chat-send", route="/blotter", message="chat: a message was not sent (not reached)", user_id=USER_B)
        store.flush()
        assert _step(now + timedelta(minutes=6)) == {"new": 3, "told": 0}

        # at most so many messages an hour: one over waits, unmarked, and rings when the hour has room
        monkeypatch.setattr(alerts, "PER_HOUR", 2)
        store.add("api", source="POST", route="/api/book/trade", status=500, message="POST /api/book/trade answered 500", user_id=USER_B); store.flush()
        held = _step(now + timedelta(minutes=7))
        assert held["told"] == 0 and held["held"] == 1 and len(_health_messages(USER_A)) == 2
        later = _step(now + timedelta(minutes=70))                                               # the two messages are more than an hour old
        assert later["told"] == 1 and "POST /api/book/trade answered 500" in _health_messages(USER_A)[-1]

        # once a day, after the hour, the summary: once, and only when it reached somebody
        day = now.replace(hour=alerts.DIGEST_HOUR_UTC, minute=5)
        set_role(USER_A, "trader")
        with pytest.raises(alerts.Undelivered):
            _step(day)
        assert _sql("SELECT count(*) FROM health_events WHERE kind = 'digest'")[0][0] == 0        # the day is not marked done
        set_role(USER_A, "admin")
        assert _step(day + timedelta(minutes=1))["digest"]["rooms"] == 1
        assert "digest" not in _step(day + timedelta(minutes=2))
        last = _health_messages(USER_A)[-1]
        assert last.startswith("**The last 24 hours, to ") and "problems, " in last and last.endswith(alerts.WHERE)
        assert len(_health_messages(USER_A)) == 4
    finally:
        set_role(USER_A, "trader")
        _sql("DELETE FROM chat_messages WHERE sender_name = 'Rijeka health'")
        _sql("DELETE FROM health_events")
