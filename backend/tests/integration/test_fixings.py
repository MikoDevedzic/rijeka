"""Fixings on a real database: the feed's shared rows are inserted once and never overwritten, an account's own
entry supersedes its previous one and is nobody else's, the route serves both, and a booked BTC forward and option
are valued through the API on the stored spot (provisional) before the fixing of the source they name is stored and
on that fixing after, never on another source's price. The venue is not called: its answer is made up here.

Every fixing written here is removed at the end (the pinned book reads the same database). The trades are
cancelled instead: a booked trade's events are append-only, as for every other trade these modules book, and the
book is emptied when the next session starts."""
from __future__ import annotations

import math
import time
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import text

from tests.integration import bodies as B
from tests.integration.conftest import USER_A, USER_B

pytestmark = pytest.mark.integration
BRR, DELIVERY = "CME CF BRR", "Deribit BTC delivery price"
K = 100_000.0                       # against the stack's BTC spot of 108,250


def _feed(asset: str, *days_values) -> list[dict]:
    from market_data import deribit
    return [{"pair": f"{asset}USD", "fixing_date": d, "fixing_time": "08:00 UTC", "source": deribit.delivery_source(asset), "value": v} for d, v in days_values]


def _book(client, auth, ids, pairs, ref: str, fixing: date, settle: date) -> str:
    body = B.crypto_forward(ids, ref, pairs["BTCUSD"], {"forward": K, "settlement_date": settle.isoformat()})
    body["terms"]["valuation_date"] = fixing.isoformat()
    r = client.post("/api/book/trade", json=body, headers=auth)
    assert r.status_code == 201, r.text[:400]
    return r.json()["trade"]["id"]


def _book_option(client, auth, ids, pairs, ref: str, expiry: date, settle: date) -> str:
    quote = {"strike": K, "spot": pairs["BTCUSD"]["spot"], "expiry_date": expiry.isoformat(), "settlement_date": settle.isoformat(), "npv": 1.0,
             "valuation_date": expiry.isoformat(), "vol_pct": 55.0, "vol_tier": "SURFACE"}
    r = client.post("/api/book/trade", json=B.crypto_option(ids, ref, pairs["BTCUSD"], quote, "EUROPEAN"), headers=auth)
    assert r.status_code == 201, r.text[:400]
    return r.json()["trade"]["id"]


def _price(client, auth, trade_id: str, on: date):
    return client.post("/price", json={"trade_id": trade_id, "valuation_date": on.isoformat(), "curves": [{"curve_id": "USD_SOFR"}]}, headers=auth)


def test_fixings_are_stored_served_superseded_and_settle_what_names_them(client, auth_a, auth_b, ids, pairs):
    from api.routes import demo_market_data as r
    from db.session import SessionLocal
    from market_data import deribit
    from pnl.market import Market
    from pnl.valuation import value
    from settlement import store
    from stack.seed import SPOTS
    today, tag = date.today(), str(int(time.time()))[-6:]
    yesterday, spot = today - timedelta(days=1), SPOTS["BTCUSD"]
    db = SessionLocal()
    started = db.execute(text("SELECT now()")).scalar()
    db.rollback()
    booked: list[str] = []

    def get(auth, pair="BTCUSD", days=30):
        j = client.get(f"/api/currency/fixings/{pair}?days={days}", headers=auth)
        assert j.status_code == 200, j.text
        return j.json()

    def live(where: str, **params):
        return db.execute(text("SELECT user_id, fixing_date, source, value, origin, superseded_at FROM fixings WHERE observed_at >= :t AND " + where + " ORDER BY observed_at, fixing_date"),
                          {"t": started, **params}).all()
    try:
        assert store.tables_present(db)
        # the pairs: both sources with their times; here the feed is switched off (the integration environment), so the default is the benchmark
        btc = {p["pair"]: p for p in client.get("/api/currency/pairs", headers=auth_a).json()["pairs"]}["BTCUSD"]
        assert btc["fixing_default"] == BRR and btc["fixing_default_time"] == "16:00 London"
        assert btc["fixing_sources"] == [{"source": BRR, "time": "16:00 London", "auto": False}, {"source": DELIVERY, "time": "08:00 UTC", "auto": True}]
        empty = get(auth_a)
        assert empty["pair"] == "BTCUSD" and empty["stored"] is True and empty["sources"] == btc["fixing_sources"]
        assert not [f for f in empty["fixings"] if f["date"] >= yesterday.isoformat()]

        # the trades: a forward fixed today and paid in two days, the ticket's forward (fixed and paid today), an option expiring today
        later = today + timedelta(days=2)
        fwd = _book(client, auth_a, ids["a"], pairs, f"IT-FIX-A-{tag}", today, later)
        same = _book(client, auth_a, ids["a"], pairs, f"IT-FIX-B-{tag}", today, today)
        opt = _book_option(client, auth_a, ids["a"], pairs, f"IT-FIX-C-{tag}", today, today + timedelta(days=1))
        booked += [fwd, same, opt]

        # the day before the fixing date: the forward's price as it always was, with nothing about a fixing in it
        quote = lambda on: client.post("/api/currency/forward/price", json={"pair": "BTCUSD", "shape": "NDF", "base_notional": 10, "direction": "BUY", "forward_rate": K,
                                                                             "settlement_date": later.isoformat(), "valuation_date": on.isoformat()}, headers=auth_a).json()
        before = _price(client, auth_a, fwd, yesterday)
        assert before.status_code == 200, before.text
        assert before.json()["npv"] == quote(yesterday)["npv"] and not {"fixing", "provisional", "settled", "settlement_amount"} & set(before.json())

        # the feed: shared rows, written once
        got = {"ok": {"BTC": _feed("BTC", (yesterday, 107_000.0), (today, 109_000.0))}, "failed": {"ETH": "HTTP 503", "SOL": "RuntimeError"}}
        with patch.object(deribit, "collect_delivery", return_value=got):
            out = r.refresh_fixings(db, count=2)
            dry = r.refresh_fixings(db, count=2, dry_run=True)
        assert out["written"] == 2 and out["known"] == 0 and out["assets"]["BTC"] == {"read": 2, "latest": today.isoformat(), "written": 2, "differs": 0}
        assert out["failed"] == {"ETH": "HTTP 503", "SOL": "RuntimeError"} and dry["dry_run"] is True and "written" not in dry
        again = {"ok": {"BTC": _feed("BTC", (yesterday, 107_000.0), (today, 1.0))}, "failed": {}}                # a re-read that disagrees
        with patch.object(deribit, "collect_delivery", return_value=again):
            second = r.refresh_fixings(db, count=2)
        assert second["written"] == 0 and second["known"] == 2 and second["differs"] == 1
        shared = live("user_id IS NULL")
        assert [(x.fixing_date, x.source, x.value, x.origin, x.superseded_at) for x in shared] == [(yesterday, DELIVERY, 107_000.0, "FEED", None), (today, DELIVERY, 109_000.0, "FEED", None)]
        for auth in (auth_a, auth_b):                                                                             # shared: every account reads them
            rows = [f for f in get(auth)["fixings"] if f["date"] >= yesterday.isoformat()]
            assert rows == [{"date": yesterday.isoformat(), "source": DELIVERY, "time": "08:00 UTC", "value": 107_000.0, "origin": "FEED", "own": False},
                            {"date": today.isoformat(), "source": DELIVERY, "time": "08:00 UTC", "value": 109_000.0, "origin": "FEED", "own": False}]
        assert store.get(db, "BTCUSD", today, DELIVERY, USER_A)["value"] == 109_000.0 and store.get(db, "BTCUSD", today, BRR, USER_A) is None
        # the scheduler's question and the health check: one asset of three is not current
        now = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=9)
        assert not r.fixings_current(db, now) and r.last_fixing_at(db) is None
        with patch.object(deribit, "collect_delivery", return_value={"ok": {"ETH": _feed("ETH", (today, 3_800.0)), "SOL": _feed("SOL", (today, 180.0))}, "failed": {}}):
            r.refresh_fixings(db)
        assert r.fixings_current(db, now) and not r.fixings_current(db, now + timedelta(days=1))
        assert r.last_fixing_at(db) == datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=8)

        # the fixing date is reached and the trades name CME CF BRR: the venue's price for the day is stored, and it is not theirs
        p = _price(client, auth_a, fwd, today)
        assert p.status_code == 200, p.text
        p = p.json()
        assert p["provisional"] is True and p["fixing"] is None and p["settled"] is False and p["fixing_source"] == BRR and p["fixing_date"] == today.isoformat()
        assert p["npv"] == quote(today)["npv"] and p["settlement_amount"] == pytest.approx(10 * (spot - K))       # today's value, flagged; an estimate on the stored spot
        s = _price(client, auth_a, same, today)
        assert s.status_code == 200, s.text                                                                       # 422 before the rule: "settlement_date must be after the valuation date"
        s = s.json()
        assert s["npv"] == 0.0 and s["settled"] is True and s["provisional"] is True and s["fixing"] is None and s["settlement_amount"] == pytest.approx(10 * (spot - K))
        o = _price(client, auth_a, opt, today)
        assert o.status_code == 200, o.text
        o = o.json()
        assert o["provisional"] is True and o["fixing"] is None and o["settled"] is False and o["shape"] == "OPTION" and 0 < o["npv"] <= 10 * (spot - K)
        assert o["settlement_amount"] == pytest.approx(10 * (spot - K))

        # a desk's own entry; a second one supersedes the first, which is kept
        post = lambda auth, **body: client.post("/api/currency/fixings", json={"pair": "BTCUSD", "fixing_date": today.isoformat(), "source": BRR, "value": 108_000.0, **body}, headers=auth)
        first = post(auth_a)
        assert first.status_code == 200, first.text
        mine = [f for f in first.json()["fixings"] if f["own"]]
        assert mine == [{"date": today.isoformat(), "source": BRR, "time": "16:00 London", "value": 108_000.0, "origin": "MANUAL", "own": True}]
        assert post(auth_a, value=110_000.0).status_code == 200
        assert [f["value"] for f in get(auth_a)["fixings"] if f["own"]] == [110_000.0]
        kept = live("user_id = :u", u=USER_A)
        assert [(x.value, x.superseded_at is None) for x in kept] == [(108_000.0, False), (110_000.0, True)]
        assert not [f for f in get(auth_b)["fixings"] if f["own"]]                                                # nobody else's
        assert post(auth_b, value=55_555.0).status_code == 200                                                    # and theirs is not ours
        assert [f["value"] for f in get(auth_a)["fixings"] if f["own"]] == [110_000.0]
        assert post(auth_a, source=DELIVERY).status_code == 422 and post(auth_a, fixing_date=(today + timedelta(days=3)).isoformat()).status_code == 422
        assert post(auth_a, pair="EURUSD").status_code == 422 and post(auth_a, value=-1).status_code == 422
        assert [(x.value, x.superseded_at) for x in live("user_id IS NULL AND pair = 'BTCUSD'")] == [(107_000.0, None), (109_000.0, None)]      # the shared rows untouched
        assert store.get(db, "BTCUSD", today, BRR, USER_A)["value"] == 110_000.0 and store.get(db, "BTCUSD", today, BRR, USER_B)["value"] == 55_555.0
        assert store.get(db, "BTCUSD", today, BRR, None) is None

        # the same trades on the stored fixing
        amount = 10 * (110_000.0 - K)
        f = _price(client, auth_a, fwd, today).json()
        assert f["fixing"] == {"source": BRR, "date": today.isoformat(), "time": "16:00 London", "value": 110_000.0, "origin": "MANUAL"} and f["provisional"] is False
        assert f["settled"] is False and f["settlement_amount"] == pytest.approx(amount) and f["npv"] == pytest.approx(amount * f["df_quote"], rel=1e-12)
        assert 0.999 < f["df_quote"] < 1.0 and f["spot01"] == 0.0 and f["fund01"] == 0.0 and f["trade_id"] == fwd
        trade = _trade_row(db, fwd)
        v = value(db, {"sub": USER_A}, trade, today, Market(db, USER_A, today))                                    # the valuation P&L runs: the same rule, the same number
        assert v["npv"] == pytest.approx(f["npv"], rel=1e-9) and v["fixing"] == f["fixing"] and v["settled"] is False
        paid = _price(client, auth_a, fwd, later).json()                                                           # the settlement date: the mark is zero, the amount reported
        assert paid["npv"] == 0.0 and paid["settled"] is True and paid["settlement_amount"] == pytest.approx(amount) and paid["fixing"]["value"] == 110_000.0
        s = _price(client, auth_a, same, today).json()
        assert s["npv"] == 0.0 and s["settled"] is True and s["provisional"] is False and s["settlement_amount"] == pytest.approx(amount) and s["fixing"]["origin"] == "MANUAL"
        o2 = _price(client, auth_a, opt, today).json()
        assert o2["fixing"]["value"] == 110_000.0 and o2["provisional"] is False and o2["settlement_amount"] == pytest.approx(amount)
        assert o2["npv"] == pytest.approx(o["npv"] * amount / (10 * (spot - K)), rel=1e-9)                         # the same discounting, the fixing in place of the spot
        assert math.isfinite(o2["npv"]) and _price(client, auth_a, opt, today + timedelta(days=1)).json()["settled"] is True
        # yesterday is still before the fixing date, whatever is stored now
        assert _price(client, auth_a, fwd, yesterday).json() == before.json()
        # and the other tenant cannot price any of it
        assert _price(client, auth_b, fwd, today).status_code == 404
    finally:
        db.rollback()
        db.execute(text("DELETE FROM fixings WHERE observed_at >= :t"), {"t": started})
        db.commit()
        left = db.execute(text("SELECT count(*) FROM fixings WHERE observed_at >= :t"), {"t": started}).scalar()
        db.close()
        for tid in booked:
            client.post(f"/api/trade-events/cancel/{tid}", headers=auth_a)
    assert left == 0
    assert not [f for f in get(auth_a)["fixings"] if f["date"] >= yesterday.isoformat()]


def _trade_row(db, trade_id: str):
    """The booked trade as the valuation reads it."""
    from db.models import Trade
    return db.query(Trade).filter(Trade.id == trade_id).first()
