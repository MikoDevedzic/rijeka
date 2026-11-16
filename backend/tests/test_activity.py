"""What each account does, by day (activity/): which requests count as what, the buffer and its flush, the figures of
the Adoption view, and the recorder that sits outside every route."""
import asyncio
import re
from datetime import date, datetime, timedelta, timezone

import pytest

from activity import store
from activity.adoption import monday, summarise
from activity.events import KINDS, classify, counts, rules
from activity.recorder import ActivityRecorder

U1, U2, U3 = "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a2", "00000000-0000-0000-0000-0000000000a3"


@pytest.fixture(autouse=True)
def _clean():
    store._reset_for_tests()
    yield
    store._reset_for_tests()


# ── which request is which activity ──────────────────────────────────────────
@pytest.mark.parametrize("method, path, want", [
    ("POST", "/price", ("priced", "rates")),
    ("POST", "/api/price/swaption", ("priced", "rates")),
    ("POST", "/api/currency/option/price", ("priced", "currency")),
    ("POST", "/api/crypto/forward/price", ("priced", "crypto")),
    ("POST", "/api/currency/option/scenario", ("scenario", "option")),
    ("POST", "/api/xva/simulate", ("xva", "rates")),
    ("POST", "/api/xva/currency-option", ("xva", "currency")),
    ("POST", "/api/xva/incremental", ("xva", "incremental")),
    ("POST", "/api/book/trade", ("booked", "")),
    ("POST", "/api/chain/confirm/8f0c1d3e-0000-4000-8000-000000000001", ("confirmed", "")),
    ("POST", "/api/chain/confirm-package", ("confirmed", "")),
    ("POST", "/api/trade-events/confirm/8f0c1d3e-0000-4000-8000-000000000001", ("confirmed", "off-chain")),
    ("GET", "/api/risk/report", ("risk", "market")),
    ("GET", "/api/pnl/explain", ("pnl", "")),
    ("POST", "/api/chat/rooms/8f0c1d3e-0000-4000-8000-000000000001/messages", ("chat", "message")),
    ("POST", "/api/market-data/snapshots", ("market_data", "")),
    ("GET", "/api/market-data/snapshots", None),                 # reading the market is on no line: seen, nothing more
    ("GET", "/api/trades/", None),
    ("GET", "/api/me/booking-defaults", None),
])
def test_a_request_is_one_kind_of_activity_or_only_seen(method, path, want):
    assert classify(method, path) == want
    assert counts(method, path) is True


@pytest.mark.parametrize("method, path", [("GET", "/api/ops/health"), ("POST", "/api/public/hit"), ("POST", "/api/ops/client-error"),
                                          ("POST", "/api/pnl/eod/tick"), ("POST", "/api/market-data/demo/tick"), ("POST", "/api/news/tick")])
def test_the_operators_the_public_and_the_schedulers_requests_are_nobodys_activity(method, path):
    assert classify(method, path) is None and counts(method, path) is False


def test_every_line_of_the_list_names_a_route_the_api_has():
    """A route renamed or removed must not leave a line that silently matches nothing."""
    import main
    paths = main.app.openapi()["paths"]
    example = lambda p: re.sub(r"\{[^}]+\}", "8f0c1d3e-0000-4000-8000-000000000001", p)        # noqa: E731
    served = {(m.upper(), example(p)) for p, methods in paths.items() for m in methods}
    for methods, pattern, event, detail in rules():
        assert any(m in methods and re.search(pattern, p) for m, p in served), f"no route for {pattern} ({event} {detail})"
        assert event == "" or event in KINDS
        assert len(detail) <= 40
    # and nothing of a path's own text reaches the record: the detail is a word from the list, never a part of the path
    assert all("(" not in d and "/" not in d for _, _, _, d in rules())


# ── the buffer ───────────────────────────────────────────────────────────────
class _Db:
    def __init__(self, present=True, fail=False):
        self.present, self.fail, self.calls, self.committed, self.closed = present, fail, [], 0, False

    def execute(self, stmt, params=None):
        sql = str(stmt)
        if "to_regclass" in sql:
            return type("R", (), {"scalar": lambda s: "activity_daily" if self.present else None})()
        if self.fail:
            raise RuntimeError("the database is away")
        self.calls.append((sql, params))
        return None

    def commit(self): self.committed += 1
    def rollback(self): pass
    def close(self): self.closed = True


def test_a_request_adds_to_the_days_counters_and_a_flush_writes_them_once():
    at = datetime(2026, 11, 16, 15, 0, tzinfo=timezone.utc)
    assert store.note(U1, "POST", "/price", at) == 2                       # seen, and priced
    assert store.note(U1, "POST", "/price", at + timedelta(minutes=5)) == 2
    assert store.note(U1, "GET", "/api/trades/", at) == 1                   # seen only
    assert store.note(U2, "POST", "/api/ops/client-error", at) == 0         # nobody's
    assert store.note("", "POST", "/price", at) == 0                        # no verified account
    db = _Db()
    out = store.flush(lambda: db)
    assert out == {"written": 2, "kept": True} and db.committed == 1 and db.closed
    rows = {(r["u"], r["event"], r["detail"]): r for r in db.calls[0][1]}
    assert rows[(U1, "seen", "")]["n"] == 3 and rows[(U1, "priced", "rates")]["n"] == 2
    assert rows[(U1, "priced", "rates")]["first_at"] == at and rows[(U1, "priced", "rates")]["last_at"] == at + timedelta(minutes=5)
    assert rows[(U1, "seen", "")]["day"] == date(2026, 11, 16)
    assert "ON CONFLICT (user_id, day, event, detail) DO UPDATE" in db.calls[0][0] and "activity_daily.n + EXCLUDED.n" in db.calls[0][0]
    assert store.flush(lambda: db) == {"written": 0, "kept": False}         # nothing is written twice


def test_without_the_table_nothing_is_kept_and_a_no_is_asked_again():
    store.note(U1, "POST", "/price")
    db = _Db(present=False)
    assert store.flush(lambda: db) == {"written": 0, "kept": False} and db.calls == []
    assert store.status(db)["recording"] is False and store.status(db)["buffered"] == 0       # dropped, not held for later
    db.present = True                                                        # applied while the API runs
    store.note(U1, "POST", "/price")
    assert store.flush(lambda: db)["kept"] is True


def test_a_write_that_fails_is_dropped_and_never_raises():
    store.note(U1, "POST", "/price")
    assert store.flush(lambda: _Db(fail=True)) == {"written": 0, "kept": False}
    assert store.flush(lambda: (_ for _ in ()).throw(RuntimeError("no session"))) == {"written": 0, "kept": False}


def test_the_buffer_has_a_ceiling(monkeypatch):
    monkeypatch.setattr(store, "BUFFER_MAX", 2)
    store.note(U1, "POST", "/price"); store.note(U2, "POST", "/price")
    assert store.status(_Db())["buffered"] == 2 and store.status(_Db())["dropped"] == 2


def test_a_flush_is_due_only_with_something_to_write_and_half_a_minute_after_the_last():
    assert store.due() is False
    store.note(U1, "POST", "/price")
    assert store.due() is True
    store.flush(lambda: _Db())
    store.note(U1, "POST", "/price")
    assert store.due() is False and store.due(now=store._state["flushed_at"] + store.FLUSH_S + 1) is True


# ── the recorder ─────────────────────────────────────────────────────────────
def _through(status_code, account, path="/price", method="POST", raises=False):
    async def app(scope, receive, send):
        if account:
            scope.setdefault("state", {})["rijeka_account"] = account          # what the token check leaves
        if raises:
            raise RuntimeError("boom")
        await send({"type": "http.response.start", "status": status_code, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def run():
        sent = []
        async def send(m): sent.append(m)
        async def receive(): return {"type": "http.request"}
        try:
            await ActivityRecorder(app)({"type": "http", "method": method, "path": path}, receive, send)
        except RuntimeError:
            pass
        return sent
    return asyncio.run(run())


def test_only_an_answered_request_of_a_verified_account_is_activity(monkeypatch):
    monkeypatch.setattr(store, "due", lambda now=None: False)
    _through(200, U1); _through(202, U1)
    _through(422, U1); _through(500, U1); _through(200, None); _through(200, U1, raises=True)
    db = _Db(); store.flush(lambda: db)
    rows = {(r["u"], r["event"]): r["n"] for r in db.calls[0][1]}
    assert rows == {(U1, "seen"): 2, (U1, "priced"): 2}


# ── the figures ──────────────────────────────────────────────────────────────
def test_the_adoption_figures():
    today = date(2026, 11, 18)                                   # a Wednesday; this week began on the 16th
    assert monday(today) == date(2026, 11, 16)
    t = lambda y, m, d, h=12: datetime(y, m, d, h, tzinfo=timezone.utc)        # noqa: E731
    accounts = [{"id": U1, "email": "one@example.com", "created_at": t(2026, 11, 3), "firm": "ONE"},     # the week of the 2nd
                {"id": U2, "email": "two@example.com", "created_at": t(2026, 11, 10), "firm": "TWO"},    # the week of the 9th
                {"id": U3, "email": "three@example.com", "created_at": t(2026, 11, 17), "firm": None}]   # this week
    act = lambda u, d, e, detail="", n=1: {"user_id": u, "day": d, "event": e, "detail": detail, "n": n, "first_at": None}   # noqa: E731
    activity = [act(U1, date(2026, 11, 3), "seen", n=40), act(U1, date(2026, 11, 3), "priced", "rates", 6),
                act(U1, date(2026, 11, 11), "seen", n=10), act(U1, date(2026, 11, 11), "xva", "rates", 2),
                act(U1, date(2026, 11, 17), "seen", n=5),
                act(U2, date(2026, 11, 10), "seen", n=12), act(U2, date(2026, 11, 10), "priced", "crypto", 3),
                act(U3, date(2026, 11, 17), "seen", n=7),
                act(U1, date(2026, 11, 3), "booked", n=99),                                             # the counters' own bookings are never read
                act("00000000-0000-0000-0000-0000000000ff", date(2026, 11, 17), "seen", n=500)]          # an admin: not an account
    booked = [{"user_id": U1, "day": date(2026, 11, 3), "n": 2, "first_at": t(2026, 11, 3, 15)},
              {"user_id": U2, "day": date(2026, 11, 12), "n": 1, "first_at": t(2026, 11, 12, 12)}]
    confirmed = [{"user_id": U1, "day": date(2026, 11, 4), "n": 1, "first_at": t(2026, 11, 4)}]
    a = summarise(accounts, activity, booked, confirmed, today, tracking_since=date(2026, 11, 3), recording=True)
    assert a["accounts"] == 3 and a["recording"] is True and a["tracking_since"] == "2026-11-03"
    weeks = {w["week"]: w for w in a["weeks"]}
    assert len(a["weeks"]) == 8 and a["weeks"][-1]["week"] == "2026-11-16"
    assert weeks["2026-11-02"] == {"week": "2026-11-02", "created": 1, "active": 1, "returning": 0}
    assert weeks["2026-11-09"] == {"week": "2026-11-09", "created": 1, "active": 2, "returning": 1}      # U1 came back
    assert weeks["2026-11-16"] == {"week": "2026-11-16", "created": 1, "active": 2, "returning": 1}      # U1 again; U2 did not
    funnel = {f["step"]: f["accounts"] for f in a["funnel"]}
    assert funnel == {"created": 3, "returned": 2, "priced": 2, "booked": 2, "xva": 1, "confirmed": 1}
    assert a["funnel"][2]["share"] == pytest.approx(2 / 3)
    assert a["first_trade"] == {"accounts": 2, "median_hours": pytest.approx((3 + 48) / 2)}              # 3 h and 48 h
    cohorts = {c["week"]: c for c in a["cohorts"]}
    assert cohorts["2026-11-02"]["accounts"] == 1 and cohorts["2026-11-02"]["active_after"] == [1, 1, None]
    assert cohorts["2026-11-09"]["active_after"] == [0, None, None]                                      # U2 not seen this week
    assert cohorts["2026-11-16"]["active_after"] == [None, None, None]
    feats = {(f["event"], f["detail"]): (f["accounts"], f["times"]) for f in a["features"]}
    assert feats == {("booked", ""): (2, 3), ("priced", "rates"): (1, 6), ("priced", "crypto"): (1, 3), ("xva", "rates"): (1, 2), ("confirmed", ""): (1, 1)}
    assert a["features"][0]["event"] == "booked"                                                         # most accounts first
    rows = {r["email"]: r for r in a["rows"]}
    assert [r["email"] for r in a["rows"]][:2] == ["three@example.com", "one@example.com"] or [r["email"] for r in a["rows"]][:2] == ["one@example.com", "three@example.com"]
    assert rows["one@example.com"] == {"email": "one@example.com", "firm": "ONE", "created": "2026-11-03", "last_active": "2026-11-17",
                                      "days_active": 4, "priced": 6, "booked": 2, "xva": 2, "confirmed": 1}
    assert rows["two@example.com"]["last_active"] == "2026-11-12" and rows["two@example.com"]["days_active"] == 2
    assert a["rows_total"] == 3


def test_no_accounts_is_an_empty_view_not_an_error():
    a = summarise([], [], [], [], date(2026, 11, 18))
    assert a["accounts"] == 0 and a["funnel"][0] == {"step": "created", "accounts": 0, "share": None}
    assert a["first_trade"] == {"accounts": 0, "median_hours": None} and a["rows"] == [] and a["recording"] is False and a["tracking_since"] is None


def test_the_route_is_for_the_admin_role():
    import main
    from fastapi.testclient import TestClient
    c = TestClient(main.app)
    assert c.get("/api/ops/adoption").status_code in (401, 403)
