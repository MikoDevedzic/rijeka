"""What each account does, by day (activity/): what is recorded and from where, the buffer and its flush, the figures
of the Adoption view, and the recorder that sits outside every route."""
import asyncio
import json
import os
import re
from datetime import date, datetime, timedelta, timezone

import pytest

from activity import store
from activity.adoption import monday, summarise
from activity.events import ASSETS, KINDS, PAGES, classify, page, rules, told
from activity.recorder import ActivityRecorder

U1, U2, U3 = "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a2", "00000000-0000-0000-0000-0000000000a3"
ID = "8f0c1d3e-0000-4000-8000-000000000001"


@pytest.fixture(autouse=True)
def _clean():
    store._reset_for_tests()
    yield
    store._reset_for_tests()


# ── what the API records from a route alone ──────────────────────────────────
@pytest.mark.parametrize("method, path, want", [
    ("POST", "/api/xva/simulate", ("xva", "rates")),
    ("POST", "/api/xva/currency-option", ("xva", "fx or crypto")),
    ("POST", "/api/xva/incremental", ("xva", "incremental")),
    ("POST", "/api/book/trade", ("booked", "")),
    ("POST", f"/api/chain/confirm/{ID}", ("confirmed", "")),
    ("POST", "/api/chain/confirm-package", ("confirmed", "")),
    ("POST", f"/api/trade-events/confirm/{ID}", ("confirmed", "off-chain")),
    ("POST", f"/api/chat/rooms/{ID}/messages", ("chat", "message")),
    ("POST", "/api/market-data/snapshots", ("saved", "market data")),
    ("POST", "/api/collateral/instruments", ("saved", "collateral")),
    ("POST", "/api/ipv/signoff", ("ipv", "")),
    ("POST", "/api/pnl/eod", ("pnl", "run or sign-off")),
])
def test_a_deliberate_act_is_plain_from_its_route(method, path, want):
    assert classify(method, path) == want


@pytest.mark.parametrize("method, path", [
    # what the app asks for by itself is not an act: the home page reads these, a tab left open polls these
    ("GET", "/api/risk/report"), ("GET", "/api/pnl/summary"), ("GET", "/api/trades/"), ("GET", "/api/collateral/instruments"),
    ("GET", f"/api/chat/rooms/{ID}/messages"), ("POST", f"/api/chain/reconcile/{ID}"), ("GET", "/api/me/booking-defaults"),
    # a keystroke is not a price: PRICE is told by the browser, never read from these
    ("POST", "/price"), ("POST", "/price/preview"), ("POST", "/api/price/fees"), ("POST", "/api/price/par-rate"),
    ("POST", "/api/currency/forward/price"), ("POST", "/api/currency/option/price"),
    # the scenario tab asks the engine by itself when it is opened: opening a tab is not running a scenario
    ("POST", "/api/currency/option/scenario"), ("POST", "/api/currency/option/ladder"),
    # a scheduler's own call, the operator's and the public routes
    ("POST", "/api/pnl/eod/tick"), ("POST", "/api/market-data/demo/tick"), ("POST", "/api/news/tick"),
    ("GET", "/api/ops/health"), ("POST", "/api/public/hit"), ("POST", "/api/me/activity"),
])
def test_what_the_app_asks_for_by_itself_is_nobodys_act(method, path):
    assert classify(method, path) is None


def test_every_line_of_the_list_names_a_route_the_api_has_and_stores_only_its_own_words():
    """A route renamed or removed must not leave a line that silently matches nothing."""
    import main
    paths = main.app.openapi()["paths"]
    served = {(m.upper(), re.sub(r"\{[^}]+\}", ID, p)) for p, methods in paths.items() for m in methods}
    for methods, pattern, event, detail in rules():
        assert any(m in methods and re.search(pattern, p) for m, p in served), f"no route for {pattern} ({event} {detail})"
        assert event == "" or event in KINDS
        assert re.fullmatch(r"[a-z& -]{0,40}", detail), detail                # a literal word of the list, never a part of the path
    assert ("POST", "/api/me/activity") in served and ("GET", "/api/ops/adoption") in served


# ── what the browser may say ─────────────────────────────────────────────────
def test_a_page_is_reduced_to_its_family_and_an_address_that_is_no_page_is_dropped():
    assert page("/risk") == "market risk" and page("/risk/ccr") == "counterparty risk" and page("/pnl/ipv") == "ipv"
    assert page("/configurations/market-data/crypto") == "market data" and page("/configurations/users") == "configurations"
    assert page("/methodology/12?x=1#top") == "methodology" and page("blotter") == "blotter"
    assert page("/riskier") is None and page("/login") is None and page("") is None and page("/api/trades") is None
    assert told("view", route="/blotter") == ("view", "blotter")
    assert told("view", route="/trades/secret-of-mine") is None              # never the address itself
    assert told("priced", "CRYPTO") == ("priced", "crypto") and told("priced", "fx") == ("priced", "fx")
    assert told("priced", "10m EURUSD at 1.17") is None and told("priced", "") is None
    assert told("booked") is None and told("anything else", "x", "/blotter") is None      # only what the browser alone knows
    families = {f for _, f in PAGES}
    assert all(re.fullmatch(r"[a-z& ]{1,40}", f) for f in families | set(ASSETS))


def test_the_browsers_route_is_signed_in_only_and_never_an_error(monkeypatch):
    import main
    from fastapi.testclient import TestClient
    from api.routes import usage
    monkeypatch.setattr(store, "due", lambda now=None: False)                # the test writes the counters itself, below
    c = TestClient(main.app)
    assert c.post("/api/me/activity", json={"event": "view", "route": "/blotter"}).status_code in (401, 403)
    main.app.dependency_overrides[usage.verify_token] = lambda: {"sub": U1}
    try:
        assert c.post("/api/me/activity", json={"event": "view", "route": "/blotter"}).json() == {"accepted": True}
        assert c.post("/api/me/activity", json={"event": "priced", "detail": "rates"}).json() == {"accepted": True}
        assert c.post("/api/me/activity", json={"event": "view", "route": "/somewhere/else"}).json() == {"accepted": False}
        assert c.post("/api/me/activity", json={"event": "priced", "detail": "pay 5y at 3.85"}).json() == {"accepted": False}
        assert c.post("/api/me/activity", json=["view"]).json() == {"accepted": False}
        assert c.post("/api/me/activity", content=b"not json", headers={"Content-Type": "application/json"}).json() == {"accepted": False}
        assert c.post("/api/me/activity", json={"event": "view", "route": "/blotter", "pad": "x" * 2000}).json() == {"accepted": False}
    finally:
        main.app.dependency_overrides.clear()
    db = _Db(); store.flush(lambda: db)
    assert {(r["u"], r["event"], r["detail"]): r["n"] for r in db.calls[0][1]} == {(U1, "view", "blotter"): 1, (U1, "priced", "rates"): 1}


# ── the buffer ───────────────────────────────────────────────────────────────
class _Db:
    def __init__(self, present=True, fail=None):
        self.present, self.fail, self.calls, self.committed, self.closed = present, fail, [], 0, False

    def execute(self, stmt, params=None):
        sql = str(stmt)
        if "to_regclass" in sql:
            return type("R", (), {"scalar": lambda s: "activity_daily" if self.present else None})()
        if self.fail and self.fail(params):
            raise RuntimeError("refused")
        self.calls.append((sql, params))
        return None

    def commit(self): self.committed += 1
    def rollback(self): pass
    def close(self): self.closed = True


def test_an_act_adds_to_the_days_counters_and_a_flush_writes_them_once_in_one_order():
    at = datetime(2026, 11, 16, 15, 0, tzinfo=timezone.utc)
    assert store.note(U2, "POST", "/api/xva/simulate", at) is True
    assert store.note(U1, "POST", "/api/xva/simulate", at) is True
    assert store.note(U1, "POST", "/api/xva/simulate", at + timedelta(minutes=5)) is True
    assert store.add(U1, "view", "blotter", at) is True
    assert store.note(U1, "GET", "/api/trades/", at) is False                # the app's own request
    assert store.note("", "POST", "/api/xva/simulate", at) is False          # no verified account
    db = _Db()
    assert store.flush(lambda: db) == {"written": 3, "kept": True} and db.committed == 1 and db.closed
    sql, rows = db.calls[0]
    assert [(r["u"], r["event"], r["detail"]) for r in rows] == [(U1, "view", "blotter"), (U1, "xva", "rates"), (U2, "xva", "rates")]    # key order
    xva = rows[1]
    assert xva["n"] == 2 and xva["first_at"] == at and xva["last_at"] == at + timedelta(minutes=5) and xva["day"] == date(2026, 11, 16)
    assert "ON CONFLICT (user_id, day, event, detail) DO UPDATE" in sql and "activity_daily.n + EXCLUDED.n" in sql
    assert store.flush(lambda: db) == {"written": 0, "kept": False}          # nothing is written twice


def test_without_the_table_nothing_is_kept_and_a_no_is_asked_again():
    store.add(U1, "view", "blotter")
    db = _Db(present=False)
    assert store.flush(lambda: db) == {"written": 0, "kept": False} and db.calls == []
    assert store.status(db) == {"recording": False, "buffered": 0, "dropped": 0, "flush_seconds": store.FLUSH_S}     # dropped on purpose: not a loss
    db.present = True                                                        # applied while the API runs
    store.add(U1, "view", "blotter")
    assert store.flush(lambda: db)["kept"] is True


def test_one_row_that_cannot_be_written_costs_that_row_not_the_batch():
    """An account deleted while its token lived is refused by the table's foreign key: the others are still written."""
    store.add(U1, "view", "blotter"); store.add(U2, "view", "blotter"); store.add(U3, "view", "blotter")
    bad = lambda params: isinstance(params, list) or params["u"] == U2      # the batch as one statement, and U2's own row    # noqa: E731
    db = _Db(fail=bad)
    assert store.flush(lambda: db) == {"written": 2, "kept": True}
    assert [p["u"] for _, p in db.calls] == [U1, U3] and db.committed == 2 and db.closed
    assert store.status(_Db())["dropped"] == 1                               # and the operator can see that one was lost


def test_a_flush_never_raises_whatever_the_database_does():
    class Gone(_Db):
        def rollback(self): raise RuntimeError("the connection is gone")
        def close(self): raise RuntimeError("the connection is gone")
    store.add(U1, "view", "blotter")
    assert store.flush(lambda: Gone(fail=lambda p: True)) == {"written": 0, "kept": False}
    store.add(U1, "view", "blotter")
    assert store.flush(lambda: (_ for _ in ()).throw(RuntimeError("no session"))) == {"written": 0, "kept": False}
    assert store.status(_Db())["dropped"] == 2


def test_the_buffer_has_a_ceiling(monkeypatch):
    monkeypatch.setattr(store, "BUFFER_MAX", 2)
    assert store.add(U1, "view", "blotter") and store.add(U2, "view", "blotter")
    assert store.add(U3, "view", "blotter") is False
    assert store.add(U1, "view", "blotter") is True                          # a key already held still counts
    assert store.status(_Db())["buffered"] == 2 and store.status(_Db())["dropped"] == 1


def test_a_flush_is_due_only_with_something_to_write_and_half_a_minute_after_the_last():
    assert store.due() is False
    store.add(U1, "view", "blotter")
    assert store.due() is True
    store.flush(lambda: _Db())
    store.add(U1, "view", "blotter")
    assert store.due() is False and store.due(now=store._state["flushed_at"] + store.FLUSH_S + 1) is True


# ── the recorder ─────────────────────────────────────────────────────────────
def _through(status_code, account, path="/api/xva/simulate", method="POST", raises=False):
    async def app(scope, receive, send):
        if account:
            scope.setdefault("state", {})["rijeka_account"] = account          # what the token check leaves
        if raises:
            raise RuntimeError("boom")
        await send({"type": "http.response.start", "status": status_code, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def run():
        sent, raised = [], False
        async def send(m): sent.append(m)
        async def receive(): return {"type": "http.request"}
        try:
            await ActivityRecorder(app)({"type": "http", "method": method, "path": path}, receive, send)
        except RuntimeError:
            raised = True
        return sent, raised
    return asyncio.run(run())


def test_only_an_answered_act_of_a_verified_account_is_recorded_and_the_response_is_untouched(monkeypatch):
    monkeypatch.setattr(store, "due", lambda now=None: False)
    sent, raised = _through(200, U1)
    assert [m["type"] for m in sent] == ["http.response.start", "http.response.body"] and sent[0]["status"] == 200 and not raised
    _through(202, U1)
    _through(422, U1); _through(500, U1); _through(200, None)
    assert _through(200, U1, raises=True)[1] is True                           # the route's own exception still reaches the layer outside
    _through(200, U1, path="/api/trades/", method="GET")                       # answered, verified, and not an act
    db = _Db(); store.flush(lambda: db)
    assert {(r["u"], r["event"]): r["n"] for r in db.calls[0][1]} == {(U1, "xva"): 2}


# ── the figures ──────────────────────────────────────────────────────────────
T = lambda y, m, d, h=12, mi=0: datetime(y, m, d, h, mi, tzinfo=timezone.utc)        # noqa: E731


def _example():
    """Three accounts. U1 signed up on Tue 3 Nov, priced and booked that day, came back the next week and this week.
    U2 signed up on Tue 10 Nov, priced that day and booked two days later, and has not been seen this week.
    U3 signed up yesterday evening and worked across midnight UTC: one visit, not a return."""
    accounts = [{"id": U1, "email": "one@example.com", "created_at": T(2026, 11, 3, 9), "firm": "ONE"},
                {"id": U2, "email": "two@example.com", "created_at": T(2026, 11, 10, 9), "firm": "TWO"},
                {"id": U3, "email": "three@example.com", "created_at": T(2026, 11, 17, 23, 40), "firm": None}]
    row = lambda u, d, e, detail, first, last=None: {"user_id": u, "day": d, "event": e, "detail": detail, "n": 1, "first_at": first, "last_at": last or first}   # noqa: E731
    activity = [row(U1, date(2026, 11, 3), "view", "blotter", T(2026, 11, 3, 10)), row(U1, date(2026, 11, 3), "priced", "rates", T(2026, 11, 3, 11)),
                row(U1, date(2026, 11, 11), "view", "blotter", T(2026, 11, 11, 10)), row(U1, date(2026, 11, 11), "xva", "rates", T(2026, 11, 11, 11)),
                row(U1, date(2026, 11, 17), "view", "market risk", T(2026, 11, 17, 10)),
                row(U2, date(2026, 11, 10), "view", "blotter", T(2026, 11, 10, 10)), row(U2, date(2026, 11, 10), "priced", "crypto", T(2026, 11, 10, 11)),
                row(U3, date(2026, 11, 17), "view", "blotter", T(2026, 11, 17, 23, 50)), row(U3, date(2026, 11, 18), "view", "blotter", T(2026, 11, 18, 0, 10)),
                row(U1, date(2026, 11, 3), "booked", "", T(2026, 11, 3, 12)),                              # the counters' own bookings are never read
                row("00000000-0000-0000-0000-0000000000ff", date(2026, 11, 17), "view", "blotter", T(2026, 11, 17))]      # an admin: not an account
    ever: dict = {}
    for r in activity:
        e = ever.setdefault((r["user_id"], r["event"], r["detail"]), {"user_id": r["user_id"], "event": r["event"], "detail": r["detail"], "days": 0,
                                                                      "first_at": r["first_at"], "last_at": r["last_at"]})
        e["days"] += 1; e["first_at"] = min(e["first_at"], r["first_at"]); e["last_at"] = max(e["last_at"], r["last_at"])
    booked = [{"user_id": U1, "day": date(2026, 11, 3), "n": 2, "first_at": T(2026, 11, 3, 12), "last_at": T(2026, 11, 3, 13)},
              {"user_id": U2, "day": date(2026, 11, 12), "n": 1, "first_at": T(2026, 11, 12, 9), "last_at": T(2026, 11, 12, 9)}]
    confirmed = [{"user_id": U1, "day": date(2026, 11, 4), "n": 1, "first_at": T(2026, 11, 4), "last_at": T(2026, 11, 4)}]
    return accounts, activity, list(ever.values()), booked, confirmed


def test_the_adoption_figures():
    today = date(2026, 11, 18)                                   # a Wednesday; this week began on the 16th
    assert monday(today) == date(2026, 11, 16)
    a = summarise(*_example(), today, tracking_since=date(2026, 11, 3), recording=True)
    assert a["accounts"] == 3 and a["recording"] is True and a["tracking_since"] == "2026-11-03"
    funnel = {f["step"]: f["accounts"] for f in a["funnel"]}
    # U3 crossed midnight UTC twenty minutes after it began: it used the desk once, it did not come back
    assert funnel == {"created": 3, "used": 3, "returned": 2, "priced": 2, "booked": 2, "xva": 1, "confirmed": 1}
    assert [f["step"] for f in a["funnel"]] == ["created", "used", "returned", "priced", "booked", "xva", "confirmed"]
    assert a["funnel"][2]["share"] == pytest.approx(2 / 3) and a["funnel"][0]["share"] == 1.0
    assert a["first_trade"] == {"accounts": 2, "median_hours": pytest.approx((3 + 48) / 2)}              # 09:00 to 12:00, and two days
    weeks = {w["week"]: w for w in a["weeks"]}
    assert len(a["weeks"]) == 8 and a["weeks"][-1]["week"] == "2026-11-16"
    assert weeks["2026-11-02"] == {"week": "2026-11-02", "created": 1, "active": 1, "returning": 0}
    assert weeks["2026-11-09"] == {"week": "2026-11-09", "created": 1, "active": 2, "returning": 1}      # U1 again, U2 new
    assert weeks["2026-11-16"] == {"week": "2026-11-16", "created": 1, "active": 2, "returning": 1}      # U1 again, U3 new; U2 absent
    cohorts = {c["week"]: c for c in a["cohorts"]}
    assert cohorts["2026-11-02"] == {"week": "2026-11-02", "accounts": 1, "active_after": [1, 1, None]}
    assert cohorts["2026-11-09"]["active_after"] == [0, None, None] and cohorts["2026-11-16"]["active_after"] == [None, None, None]
    feats = {(f["event"], f["detail"]): (f["accounts"], f["days"]) for f in a["features"]}
    assert feats == {("view", "blotter"): (3, 5), ("booked", ""): (2, 2), ("priced", "rates"): (1, 1), ("priced", "crypto"): (1, 1),
                     ("xva", "rates"): (1, 1), ("view", "market risk"): (1, 1), ("confirmed", ""): (1, 1)}
    assert a["features"][0] == {"event": "view", "detail": "blotter", "accounts": 3, "days": 5}          # most accounts first
    rows = {r["email"]: r for r in a["rows"]}
    assert rows["one@example.com"] == {"email": "one@example.com", "firm": "ONE", "created": "2026-11-03", "first_active": "2026-11-03",
                                      "last_active": "2026-11-17", "days_active": 4, "priced_days": 1, "booked": 2, "xva_days": 1, "confirmed": 1}
    assert rows["two@example.com"]["last_active"] == "2026-11-12" and rows["two@example.com"]["days_active"] == 2
    assert rows["three@example.com"]["first_active"] == "2026-11-17" and rows["three@example.com"]["last_active"] == "2026-11-18"
    assert [r["email"] for r in a["rows"]] == ["three@example.com", "one@example.com", "two@example.com"] and a["rows_total"] == 3


def test_ever_is_read_from_the_whole_record_not_from_the_window_of_days():
    """An account that priced once, long before the window the weeks are drawn from, has still priced."""
    accounts = [{"id": U1, "email": "one@example.com", "created_at": T(2026, 1, 5), "firm": None}]
    ever = [{"user_id": U1, "event": "priced", "detail": "rates", "days": 3, "first_at": T(2026, 1, 5, 13), "last_at": T(2026, 1, 9, 13)},
            {"user_id": U1, "event": "view", "detail": "blotter", "days": 3, "first_at": T(2026, 1, 5, 12), "last_at": T(2026, 1, 9, 12)}]
    a = summarise(accounts, [], ever, [], [], date(2026, 11, 18), recording=True)
    funnel = {f["step"]: f["accounts"] for f in a["funnel"]}
    assert funnel["priced"] == 1 and funnel["used"] == 1 and funnel["returned"] == 1
    assert a["rows"][0]["priced_days"] == 3 and a["rows"][0]["first_active"] == "2026-01-05" and a["rows"][0]["last_active"] == "2026-01-09"
    assert a["rows"][0]["days_active"] == 0 and a["features"] == [] and all(w["active"] == 0 for w in a["weeks"])


def test_no_accounts_is_an_empty_view_not_an_error():
    a = summarise([], [], [], [], [], date(2026, 11, 18))
    assert a["accounts"] == 0 and a["funnel"][0] == {"step": "created", "accounts": 0, "share": None}
    assert a["first_trade"] == {"accounts": 0, "median_hours": None} and a["rows"] == [] and a["recording"] is False and a["tracking_since"] is None


def test_many_accounts_are_summarised_in_one_pass():
    """Each account's rows are read once: two thousand accounts and three months of days take well under a second."""
    import time
    n, days = 2000, 90
    ids = [f"00000000-0000-0000-0000-{i:012d}" for i in range(n)]
    accounts = [{"id": u, "email": f"{i}@example.com", "created_at": T(2026, 8, 1), "firm": None} for i, u in enumerate(ids)]
    start = date(2026, 8, 20)
    activity = [{"user_id": u, "day": start + timedelta(days=d), "event": "view", "detail": "blotter", "n": 1,
                 "first_at": T(2026, 8, 20), "last_at": T(2026, 8, 20)} for u in ids for d in range(0, days, 3)]
    t0 = time.perf_counter()
    a = summarise(accounts, activity, [], [], [], date(2026, 11, 18))
    assert a["accounts"] == n and time.perf_counter() - t0 < 5.0


def test_the_panels_canned_body_has_the_shape_the_api_gives():
    """The browser journey draws the panel from a fixed body (frontend/e2e/adoption-body.json): a field renamed here
    must fail here, since the journey would go on passing against its own copy."""
    path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "e2e", "adoption-body.json")
    if not os.path.exists(path):
        pytest.skip("not a full checkout")
    canned = json.load(open(path))
    real = summarise(*_example(), date(2026, 11, 18), tracking_since=date(2026, 11, 3), recording=True)
    real.update(unread=[], dropped=0, note="")                               # what the route adds (api/routes/usage.py: adoption)
    assert set(canned) == set(real)
    for key in ("funnel", "weeks", "cohorts", "features", "rows"):
        assert canned[key] and set(canned[key][0]) == set(real[key][0]), key
    assert set(canned["first_trade"]) == set(real["first_trade"])


def test_the_read_out_is_for_the_admin_role():
    import main
    from fastapi.testclient import TestClient
    assert TestClient(main.app).get("/api/ops/adoption").status_code in (401, 403)
