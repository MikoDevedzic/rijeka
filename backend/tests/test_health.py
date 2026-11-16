"""What went wrong for the people using the desk (health/): what is a problem and what is kept of it, what makes two
problems the same, what the operator is told and when, and the mail that goes only where it was set up."""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

import pytest

from activity import store as activity
from activity.recorder import ActivityRecorder
from health import alerts, store

U1, U2 = "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a2"
NOW = datetime(2026, 11, 16, 15, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setenv("RIJEKA_RECORD", "1")
    store._reset_for_tests(); activity._reset_for_tests()
    yield
    store._reset_for_tests(); activity._reset_for_tests()


class _Db:
    def __init__(self, present=True, refuse=None):
        self.present, self.refuse, self.rows, self.committed, self.closed = present, refuse, [], 0, False

    def execute(self, stmt, params=None):
        if "to_regclass" in str(stmt):
            return type("R", (), {"scalar": lambda s: "health_events" if self.present else None})()
        if self.refuse and self.refuse(params):
            raise RuntimeError("refused")
        self.rows.append(params)

    def commit(self): self.committed += 1
    def rollback(self): pass
    def close(self): self.closed = True


# ── what is the same problem ─────────────────────────────────────────────────
def test_the_same_fault_is_one_fingerprint_whatever_id_or_build_it_names():
    a = store.fingerprint("browser", "/risk", "Failed to fetch dynamically imported module: https://app.rijeka.app/assets/RiskPage-DqcMWrxG.js")
    b = store.fingerprint("browser", "/risk", "Failed to fetch dynamically imported module: https://app.rijeka.app/assets/RiskPage-Zx91_kQa.js")
    assert a == b and len(a) == 16
    assert store.fingerprint("api", "/api/x/{id}", "POST /api/x/{id} answered 500", 500) == store.fingerprint("api", "/api/x/{id}", "POST /api/x/{id} answered 502", 500)
    one = store.fingerprint("browser", "/blotter", "trade 8f0c1d3e-0000-4000-8000-000000000001 has no leg 3")
    assert one == store.fingerprint("browser", "/blotter", "trade 11111111-2222-4333-8444-555555555555 has no leg 12")
    # another place, another kind or another message is another problem
    assert a != store.fingerprint("browser", "/pnl", "Failed to fetch dynamically imported module: https://app.rijeka.app/assets/RiskPage-DqcMWrxG.js")
    assert a != store.fingerprint("api", "/risk", "Failed to fetch dynamically imported module: x") and a != store.fingerprint("browser", "/risk", "Cannot read properties of undefined")


# ── the buffer and the write ─────────────────────────────────────────────────
def test_a_problem_is_cut_to_length_kept_once_and_written_row_by_row():
    assert store.add("browser", source="boundary", route="/risk", message="x" * 5000, stack="s" * 9000, user_id=U1, now=NOW) is True
    assert store.add("api", source="POST", route="/api/xva/simulate", status=500, ms=812.4, user_id=None, now=NOW) is True
    assert store.add("weather", message="rain") is False                                       # not a kind
    db = _Db()
    assert store.flush(lambda: db) == {"written": 2, "kept": True} and db.committed == 2 and db.closed
    first, second = db.rows
    assert len(first["message"]) == 500 and len(first["stack"]) == 4000 and first["user_id"] == U1 and first["at"] == NOW
    assert second["status"] == 500 and second["ms"] == 812 and second["user_id"] is None and second["stack"] is None
    assert first["fingerprint"] != second["fingerprint"]
    assert store.flush(lambda: db) == {"written": 0, "kept": False}                              # nothing twice


def test_a_problem_of_an_account_that_is_gone_is_kept_without_the_account():
    store.add("browser", route="/risk", message="boom", user_id=U1, now=NOW)
    db = _Db(refuse=lambda p: p.get("user_id") == U1)                                           # the foreign key refuses it
    assert store.flush(lambda: db) == {"written": 1, "kept": True}
    assert db.rows[0]["user_id"] is None and db.rows[0]["message"] == "boom"


def test_without_the_table_nothing_is_kept_and_nothing_ever_raises():
    store.add("browser", route="/risk", message="boom")
    assert store.flush(lambda: _Db(present=False)) == {"written": 0, "kept": False}
    store.add("browser", route="/risk", message="boom")
    assert store.flush(lambda: (_ for _ in ()).throw(RuntimeError("no session"))) == {"written": 0, "kept": False}
    assert store.add("browser", route=object(), message=None) is True                           # anything at all is taken as text
    assert store.count_since(_Db(present=False)) is None and store.rows_since(_Db(present=False), NOW) == []


def test_the_buffer_has_a_ceiling(monkeypatch):
    monkeypatch.setattr(store, "BUFFER_MAX", 2)
    assert store.add("browser", message="a") and store.add("browser", message="b") and store.add("browser", message="c") is False
    assert store.status(_Db())["dropped"] == 1 and store.status(_Db())["buffered"] == 2


# ── the recorder sees every answer ───────────────────────────────────────────
def _through(status_code, account=None, path="/api/xva/simulate", method="POST", declared="/api/xva/simulate", took=0.0, monkeypatch=None):
    class Route:
        path = declared

    async def app(scope, receive, send):
        scope["route"] = Route()
        if account:
            scope.setdefault("state", {})["rijeka_account"] = account
        await send({"type": "http.response.start", "status": status_code, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def run():
        async def send(m): pass
        async def receive(): return {"type": "http.request"}
        await ActivityRecorder(app)({"type": "http", "method": method, "path": path}, receive, send)
    if took and monkeypatch:
        import activity.recorder as R
        ticks = iter([100.0, 100.0 + took])
        monkeypatch.setattr(R, "_clock", lambda: next(ticks))
    asyncio.run(run())


def test_a_5xx_and_a_slow_answer_are_problems_with_the_route_as_declared_never_the_address(monkeypatch):
    monkeypatch.setattr(store, "due", lambda now=None: False); monkeypatch.setattr(activity, "due", lambda now=None: False)
    _through(500, U1, path="/api/chain/confirm/8f0c1d3e-0000-4000-8000-000000000001", declared="/api/chain/confirm/{trade_id}")
    _through(503, None, path="/api/ops/health", method="GET", declared="/api/ops/health")
    _through(200, U1); _through(404, U1); _through(422, U1)                                      # answered, and the caller's own to mend
    _through(200, U2, took=store.SLOW_S + 2, monkeypatch=monkeypatch)
    db = _Db(); store.flush(lambda: db)
    got = [(r["kind"], r["source"], r["route"], r["status"], r["user_id"]) for r in db.rows]
    assert got == [("api", "POST", "/api/chain/confirm/{trade_id}", 500, U1), ("api", "GET", "/api/ops/health", 503, None),
                   ("slow", "POST", "/api/xva/simulate", 200, U2)]
    assert all("8f0c1d3e" not in str(v) for r in db.rows for v in r.values())                   # no id of the request is kept
    assert db.rows[2]["ms"] == int((store.SLOW_S + 2) * 1000) and "took 32 s" in db.rows[2]["message"]


# ── the same problem as one line ─────────────────────────────────────────────
def _row(kind="browser", route="/risk", message="This page could not be loaded", user=None, email=None, at=NOW, status=None, ms=None, source="boundary-load", ident=1):
    return {"id": ident, "at": at, "kind": kind, "source": source, "route": route, "status": status, "ms": ms, "message": message, "release": "abc",
            "user_id": user, "email": email, "fingerprint": store.fingerprint(kind, route, message, status), "alerted_at": None}


def test_one_fault_hit_by_several_people_is_one_line_with_who():
    rows = [_row(user=U1, email="one@example.com"), _row(user=U1, email="one@example.com", at=NOW + timedelta(minutes=2)),
            _row(user=U2, email="two@example.com"), _row(),
            _row("api", "/api/xva/simulate", "POST /api/xva/simulate answered 500", U1, "one@example.com", status=500, source="POST"),
            _row("slow", "/api/ccr/run", "POST /api/ccr/run took 41 s", None, None, status=200, ms=41_000, source="POST")]
    g = store.group(rows)
    assert [x["kind"] for x in g] == ["api", "slow", "browser"]                                  # what the API saw for itself first
    page = g[2]
    assert page["count"] == 4 and page["accounts"] == 2 and page["anonymous"] == 1 and page["emails"] == ["one@example.com", "two@example.com"]
    assert page["first"] == NOW.isoformat() and page["last"] == (NOW + timedelta(minutes=2)).isoformat()
    assert g[1]["slowest_ms"] == 41_000 and g[1]["accounts"] == 0 and g[1]["anonymous"] == 1


# ── what the operator is told ────────────────────────────────────────────────
def test_the_message_says_what_and_how_many_and_names_nobody():
    g = store.group([_row(user=U1, email="one@example.com"), _row(user=U2, email="two@example.com"), _row(),
                     _row("api", "/api/xva/simulate", "POST /api/xva/simulate answered 500", U1, "one@example.com", status=500, source="POST"),
                     _row("slow", "/api/ccr/run", "x", None, None, status=200, ms=41_400, source="POST")])
    body = alerts.compose(g)
    assert body.split("\n") == [
        "**3 problems on the desk**",
        "- POST /api/xva/simulate answered 500 · 1 account, once",
        "- POST /api/ccr/run took 41 s · a visitor not signed in, once",
        "- On /risk: This page could not be loaded · 2 accounts and visitors not signed in, 3 times",
        "Who was affected, and the details: Configurations → SYSTEM."]
    assert "example.com" not in body and U1 not in body
    assert alerts.compose(g[:1]).startswith("**A problem on the desk**")
    assert alerts.describe({**g[0], "source": "pro*pfind](x)"}).startswith("PROPFINDX /api/xva/simulate answered 500")      # a method is letters only
    many = [{**g[0], "fingerprint": str(i)} for i in range(11)]
    assert alerts.compose(many).split("\n")[-2] == "- and 3 more" and len(alerts.compose(many).split("\n")) == 11
    assert alerts.plain(body).startswith("3 problems on the desk")


def test_a_strangers_words_cannot_become_a_link_or_formatting_in_the_operators_messenger():
    nasty = "**URGENT** [verify your account](https://evil.example/login) <img src=x onerror=1> `rm` mail bad@evil.example\nnext line www.evil.example/x javascript://x"
    line = alerts.said(nasty)
    assert line == "URGENT verify your account an address img src=x onerror=1 rm mail an address next line an address an address"
    # a mail reader makes a link of a bare name with a dot in it: none is left between two words
    assert alerts.said("sign in again at evil.example/login or rijeka.app.evil.example") == "sign in again at evil example/login or rijeka app evil example"
    assert alerts.said("go to evil .com or evil .co .uk now") == "go to evil com or evil co uk now"                # nor put back together by a space
    assert alerts.said("Cannot read properties of undefined (reading 'npv'). Value 1.25 kept.") == "Cannot read properties of undefined reading 'npv'. Value 1.25 kept."
    for mark in ("*", "[", "]", "<", ">", "`", "http", "evil", "\n"):
        assert mark not in line
    assert alerts.said("see https://app.rijeka.app/assets/RiskPage-DqcMWrxG.js") == "see an address"
    assert alerts.said("") == "an error" and alerts.said(None) == "an error" and alerts.said("x" * 300).endswith("…") and len(alerts.said("x" * 300)) == 141
    g = store.group([_row(message=nasty, route="/risk](https://evil.example)", user=U1)])
    body = alerts.compose(g)
    assert "evil" not in body and "](" not in body and body.count("**") == 2                     # only the heading's own marks


def test_what_rings_a_fault_of_the_apis_a_slow_answer_a_signed_in_accounts_report():
    one = lambda **k: store.group([_row(**k)])[0]                                                 # noqa: E731
    assert alerts.rings(store.group([_row(), _row()])[0]) is False                                # not signed in: anyone can post one, saying anything
    assert alerts.rings(one(user=U1)) is True
    for status, want in ((500, True), (502, True), (503, True), (504, True), (501, False)):       # "not supported" is an answer, not a fault
        assert alerts.rings(one(kind="api", route="/api/x", message=f"POST /api/x answered {status}", status=status, source="POST")) is want, status
    assert alerts.rings(one(kind="slow", route="/api/x", message="x", status=200, ms=40_000, source="POST")) is True


def test_one_persons_connection_does_not_ring_and_everybodys_does():
    lost = dict(source="net-chat-send", route="/blotter", message="chat: a message was not sent (not reached)")
    assert alerts.rings(store.group([_row(user=U1, **lost)])[0]) is False
    assert alerts.rings(store.group([_row(user=U1, **lost), _row(user=U2, **lost)])[0]) is False
    three = store.group([_row(user=u, **lost) for u in (U1, U2, "00000000-0000-0000-0000-0000000000a3")])[0]
    assert three["accounts"] == alerts.NET_ACCOUNTS and alerts.rings(three) is True               # nobody reaches the API: that is not their connections


def test_a_strangers_label_is_not_asked_a_fault_is_judged_by_its_signed_in_reports():
    """The fingerprint is the place and the words, not the label: a stranger who sends a real fault's words first,
    labelled as a connection fault, must not make the signed-in report that follows one; nor the other way about."""
    words = dict(route="/risk", message="The risk report could not be drawn")
    first_a_stranger = store.group([_row(source="net-x", **words), _row(user=U1, source="boundary", **words)])[0]
    assert first_a_stranger["source"] == "net-x" and first_a_stranger["signed_sources"] == ["boundary"] and alerts.rings(first_a_stranger) is True
    lost = dict(route="/blotter", message="chat: a message was not sent (not reached)")
    first_a_stranger = store.group([_row(source="boundary", **lost), _row(user=U1, source="net-chat-send", **lost)])[0]
    assert first_a_stranger["signed_sources"] == ["net-chat-send"] and alerts.rings(first_a_stranger) is False


def test_all_browsers_together_can_make_the_api_keep_only_so_much(monkeypatch):
    monkeypatch.setattr(store, "UNSIGNED_PER_10_MIN", 3)
    assert [store.add("browser", message=f"m{i}") for i in range(5)] == [True, True, True, False, False]
    assert store.add("api", source="GET", route="/api/x", status=500) is True                    # what the API saw is not theirs to crowd out
    assert store.add("browser", message="a signed-in account's", user_id=U1) is True             # nor a signed-in account's report: its own allowance
    assert store.status(_Db())["dropped"] == 2
    store._reset_for_tests(); monkeypatch.setattr(store, "UNSIGNED_PER_10_MIN", 100); monkeypatch.setattr(store, "UNSIGNED_PER_DAY", 2)
    assert [store.add("browser", message=f"m{i}") for i in range(3)] == [True, True, False]       # and in a day
    monkeypatch.setattr(store, "BROWSER_PER_10_MIN", 1)
    assert [store.add("browser", message=f"s{i}", user_id=U1) for i in range(2)] == [True, False]   # signed-in reports have a ceiling too


def test_a_report_nobody_signed_keeps_only_the_start_of_its_stack():
    store.add("browser", message="m", stack="s" * 9000); store.add("browser", message="m", stack="s" * 9000, user_id=U1)
    db = _Db(); store.flush(lambda: db)
    assert len(db.rows[0]["stack"]) == store.ANONYMOUS_STACK and len(db.rows[1]["stack"]) == 4000
    store.add("browser", message="a\x00b"); store.flush(lambda: db)
    assert db.rows[2]["message"] == "ab"                                                         # the database takes no NUL


def test_only_the_hosted_api_keeps_problems_a_developers_own_server_does_not(monkeypatch):
    monkeypatch.delenv("RIJEKA_RECORD", raising=False); monkeypatch.delenv("RENDER", raising=False)
    assert store.add("api", source="GET", route="/api/x", status=500) is False and store.status(_Db())["recording"] is False
    monkeypatch.setenv("RENDER", "true")
    assert store.add("api", source="GET", route="/api/x", status=500) is True


def test_the_days_summary_is_sent_when_there_was_nothing_too():
    assert alerts.digest([], "16 Nov 2026 13:00 UTC") == ("**The last 24 hours, to 16 Nov 2026 13:00 UTC**\nNo problem was reported by any browser, "
                                                          "and the API answered no request with an error or too slowly.")
    g = store.group([_row(user=U1), _row(user=U1), _row("api", "/api/x", "POST /api/x answered 500", U2, status=500, source="POST")])
    body = alerts.digest(g, "16 Nov 2026 13:00 UTC")
    assert body.startswith("**The last 24 hours, to 16 Nov 2026 13:00 UTC: 2 problems, 3 occurrences**") and body.endswith(alerts.WHERE)


# ── the mail goes only where it was set up ───────────────────────────────────
def test_no_mail_without_both_settings_and_never_an_error(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False); monkeypatch.delenv("RIJEKA_ALERT_EMAIL_TO", raising=False)
    calls = []
    assert alerts.send_mail("s", "b", post=lambda *a, **k: calls.append(1)) is False and calls == []
    monkeypatch.setenv("RESEND_API_KEY", "k")
    assert alerts.send_mail("s", "b", post=lambda *a, **k: calls.append(1)) is False and calls == []           # nobody to send it to
    monkeypatch.setenv("RIJEKA_ALERT_EMAIL_TO", "ops@example.com, second@example.com")
    sent = {}
    ok = alerts.send_mail("A problem on the desk", "**A problem on the desk**\n- x", post=lambda url, **k: sent.update(url=url, **k) or type("R", (), {"status_code": 200})())
    assert ok is True and sent["url"] == alerts.RESEND_URL and sent["headers"] == {"Authorization": "Bearer k"}
    assert sent["json"] == {"from": "Rijeka health <miko@rijeka.app>", "to": ["ops@example.com", "second@example.com"],
                            "subject": "A problem on the desk", "text": "A problem on the desk\n- x"}
    assert alerts.send_mail("s", "b", post=lambda *a, **k: type("R", (), {"status_code": 422})()) is False
    assert alerts.send_mail("s", "b", post=lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down"))) is False


# ── the step ─────────────────────────────────────────────────────────────────
def test_without_the_table_the_step_does_nothing_and_a_failed_pass_raises():
    assert alerts.step(_Db(present=False), now=NOW) == {"skipped": "the health table is not applied"}
    class Broken(_Db):
        def execute(self, stmt, params=None):
            if "to_regclass" in str(stmt):
                return super().execute(stmt, params)
            raise RuntimeError("away")
    with pytest.raises(RuntimeError):                                                             # a pass that failed is never recorded as one that worked
        alerts.step(Broken(), now=NOW)


def test_the_token_check_for_a_public_route_reads_no_database_and_asks_for_no_keys(monkeypatch):
    """The browser's report is public: its sign-in is read for the account only, a bad one is nobody, and a stranger
    cannot make the route call out for the key set or wait on the database."""
    from middleware import auth
    asked = []
    async def keys(force=False):
        asked.append(force)
        return {"keys": []}
    monkeypatch.setattr(auth, "_get_jwks", keys)
    monkeypatch.setattr(auth, "db_role_for", lambda sub: (_ for _ in ()).throw(AssertionError("the database was read")))
    unknown = "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6Im5vdC1hLWtleSIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4In0.c2ln"      # ES256, a key id nobody has
    assert asyncio.run(auth.account_of(unknown)) is None and asked == [False]                    # asked the cache once, never forced
    assert asyncio.run(auth.account_of("Bearer nonsense")) is None and asyncio.run(auth.account_of(None)) is None
    assert asyncio.run(auth.account_of("Basic abc")) is None


def test_the_routes_are_public_to_report_and_the_admins_to_read():
    import main
    from fastapi.testclient import TestClient
    c = TestClient(main.app)
    assert c.get("/api/ops/problems").status_code in (401, 403)
    r = c.post("/api/ops/client-error", json={"message": "boom", "route": "/risk", "source": "boundary"}, headers={"Authorization": "Bearer not-a-token"})
    assert r.status_code == 202 and r.json() == {"accepted": True}                               # a bad token never costs a report


def test_the_panels_canned_body_has_the_shape_the_api_gives():
    """The browser journey draws the panel from a fixed body (frontend/e2e/problems-body.json): a field renamed here
    must fail here, since the journey would go on passing against its own copy."""
    path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "e2e", "problems-body.json")
    if not os.path.exists(path):
        pytest.skip("not a full checkout")
    canned = json.load(open(path))
    g = store.group([_row(user=U1, email="one@example.com")])
    real = {"hours": 24, **store.status(_Db()), "unread": False, "occurrences": 1, "truncated": False,
            "problems": [{**x, "line": alerts.describe(x), "rings": alerts.rings(x)} for x in g], "mail": False, "rooms": 1}
    assert set(canned) == set(real)                                           # what api/routes/ops.py: ops_problems returns
    assert set(canned["problems"][0]) == set(real["problems"][0])
    for p in canned["problems"]:
        assert p["kind"] in store.KINDS
