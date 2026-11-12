"""Fixings on a real database. The feed stores a delivery price once, only when the template's stored spot of that
date agrees with it, and never overwrites it; a re-read that differs disputes the date and holds the batch; an
administrator corrects a shared row or fills a missing date; an account's own entry supersedes its previous one
and is nobody else's. Booked BTC forwards and an option are valued through the API in each state: LIVE before the
fixing date, FIXED from it (provisional on the stored spot until the fixing of the source they name is stored, then
on that fixing, never on another source's price), SETTLED from the settlement date. The venue is not called: its
answers are made up here.

Every fixing and every spot written here is removed at the end, and at the start as well, so a run that was killed
does not fail the next one (the pinned book reads the same database). The trades are cancelled instead: a booked
trade's events are append-only, as for every other trade these modules book, and the book is emptied when the next
session starts."""
from __future__ import annotations

import json
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
MARK = "test_fixings"               # in the quotes of every spot this module writes, so it can find its own
QUOTE_ONLY = ("forward", "df_quote", "df_base", "t", "t_settle", "t_expiry", "vol_pct", "spot01", "vega")
STATE_KEYS = {"state", "shape", "pair", "direction", "base_notional", "settlement_date", "fixing_date", "fixing", "settlement_amount", "settlement_price",
              "provisional", "provisional_reason", "provisional_basis", "quote_currency", "npv"}


def _feed(asset: str, *days_values) -> list[dict]:
    from market_data import deribit
    return [{"pair": f"{asset}USD", "fixing_date": d, "fixing_time": "08:00 UTC", "source": deribit.delivery_source(asset), "value": v} for d, v in sorted(days_values)]


def _struck(body: dict, days_ago: int = 3) -> dict:
    """The body with a trade date in the past: a forward's fixing date must be after its trade date."""
    traded = (date.today() - timedelta(days=days_ago)).isoformat()
    body.update(trade_date=traded, effective_date=traded)
    return body


def _forward_body(ids, pairs, ref: str, fixing: date, settle: date, **terms) -> dict:
    body = B.crypto_forward(ids, ref, pairs["BTCUSD"], {"forward": K, "settlement_date": settle.isoformat()})
    body["terms"].update(valuation_date=fixing.isoformat(), **terms)
    return _struck(body)


def _book(client, auth, body: dict) -> str:
    r = client.post("/api/book/trade", json=body, headers=auth)
    assert r.status_code == 201, r.text[:400]
    return r.json()["trade"]["id"]


def _option_body(ids, pairs, ref: str, expiry: date, settle: date, style: str = "EUROPEAN") -> dict:
    quote = {"strike": K, "spot": pairs["BTCUSD"]["spot"], "expiry_date": expiry.isoformat(), "settlement_date": settle.isoformat(), "npv": 1.0,
             "valuation_date": expiry.isoformat(), "vol_pct": 55.0, "vol_tier": "SURFACE"}
    return _struck(B.crypto_option(ids, ref, pairs["BTCUSD"], quote, style))


def _price(client, auth, trade_id: str, on: date, states: bool | None = True):
    """POST /price as the trade window sends it; `states` as the web app from 0.14.0 does, None as every older one."""
    body = {"trade_id": trade_id, "valuation_date": on.isoformat(), "curves": [{"curve_id": "USD_SOFR"}]}
    return client.post("/price", json=body if states is None else {**body, "states": states}, headers=auth)


def _clean(db) -> None:
    """Every fixing (the stack's table holds nothing but what tests wrote) and every spot this module wrote."""
    db.rollback()
    db.execute(text("DELETE FROM fixings"))
    db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :a AND right(curve_id, 5) = '_SPOT' AND quotes::text LIKE :m"), {"a": USER_A, "m": f"%{MARK}%"})
    db.commit()


def test_fixings_from_the_feed_to_the_settled_trade(client, auth_a, auth_b, ids, pairs, booked, monkeypatch):
    from api.routes import _limits, demo_market_data as r
    from db.models import Trade
    from db.session import SessionLocal
    from market_data import deribit
    from pnl.market import Market
    from pnl.valuation import value
    from settlement import store
    from stack.seed import SPOTS
    today, tag = date.today(), str(int(time.time()))[-6:]
    now = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=12)
    day = lambda n: today - timedelta(days=n)
    yesterday, spot = day(1), SPOTS["BTCUSD"]
    db = SessionLocal()
    made: list[str] = []
    _clean(db)                                               # what a killed run left behind

    def get(auth, pair="BTCUSD", days=30):
        j = client.get(f"/api/currency/fixings/{pair}?days={days}", headers=auth)
        assert j.status_code == 200, j.text
        return j.json()

    def rows(where: str, **params):
        return db.execute(text("SELECT user_id, pair, fixing_date, source, value, origin, superseded_at, disputed_at, note, created_by FROM fixings WHERE " + where
                               + " ORDER BY observed_at, fixing_date"), params).all()

    def tick(got, **kw):
        with patch.object(deribit, "collect_delivery", return_value=got) as collect:
            out = r.refresh_fixings(db, now=now, **kw)
        return out, collect

    def pairs_now(auth=auth_a):
        return client.get("/api/currency/pairs", headers=auth).json()
    try:
        assert store.tables_present(db)
        # ── the pairs answer: what an old client reads is unchanged; the new default follows the feed ──
        answer = pairs_now()
        btc = {p["pair"]: p for p in answer["pairs"]}["BTCUSD"]
        assert btc["fixing_default"] == BRR and "fixing_default_time" not in btc and answer["tenor_days"]["1M"] == 30
        assert btc["fixing_sources"] == [{"source": BRR, "time": "16:00 London", "auto": False}]              # the feed is not delivering here: the venue's source is not offered
        assert btc["settlement_default"] == {"source": BRR, "time": "16:00 London"}
        empty = get(auth_a)
        assert empty == {"pair": "BTCUSD", "stored": True, "sources": btc["fixing_sources"], "fixings": []}

        # the template's stored spots of the last days: what a delivery price is checked against (the seed's own level, so nothing reprices)
        for pair in ("BTCUSD", "ETHUSD", "SOLUSD"):
            for n in range(0, 11):
                db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, created_by, user_id) VALUES (:c, :d, cast(:q as jsonb), 'IMPORT', :u, :u) "
                                "ON CONFLICT (user_id, curve_id, valuation_date) DO NOTHING"),
                           {"c": f"{pair}_SPOT", "d": day(n), "u": USER_A, "q": json.dumps([{"tenor": "SPOT", "quote_type": "SPOT", "rate": SPOTS[pair], "enabled": True, "note": MARK}])})
        db.commit()

        # ── booking: the source and its time, and a forward's fixing date ──
        later, tomorrow = today + timedelta(days=2), today + timedelta(days=1)
        a = ids["a"]
        for wrong, why in ((dict(settlement_price_source="Deribit BTC delivery price."), "reads like it"), (dict(valuation_time="08:00 UTC"), "valuation_time must be 16:00 London"),
                           (dict(settlement_price_source=DELIVERY), "valuation_time must be 08:00 UTC"), (dict(settlement_price_source="Deribit ETH delivery price", valuation_time="08:00 UTC"), "reads like it")):
            refused = client.post("/api/book/trade", json=_forward_body(a, pairs, f"IT-FIX-X-{tag}", today, later, **wrong), headers=auth_a)
            assert refused.status_code == 422 and why in refused.text, (wrong, refused.text[:300])
        for fixing, settle, why in ((later + timedelta(days=1), later, "cannot be after the settlement date"), (day(3), later, "the fixing date must be after the trade date"),
                                    (day(4), later, "the fixing date must be after the trade date")):
            refused = client.post("/api/book/trade", json=_forward_body(a, pairs, f"IT-FIX-X-{tag}", fixing, settle), headers=auth_a)
            assert refused.status_code == 422 and why in refused.text, refused.text[:300]
        week = _book(client, auth_a, _forward_body(a, pairs, f"IT-FIX-W-{tag}", today, today + timedelta(days=7)))        # a week between fixing and payment
        made.append(_book(client, auth_a, _forward_body(a, pairs, f"IT-FIX-M-{tag}", tomorrow, today + timedelta(days=40))))   # and more than a month: no limit since 0.26.0
        made.append(week)
        fwd = _book(client, auth_a, _forward_body(a, pairs, f"IT-FIX-A-{tag}", today, later))                 # fixed today, paid in two days
        early = _book(client, auth_a, _forward_body(a, pairs, f"IT-FIX-E-{tag}", today, tomorrow))            # the ticket's fixing date: the day before it is paid
        same = _book(client, auth_a, _forward_body(a, pairs, f"IT-FIX-B-{tag}", today, today))                # fixed and paid today
        opt = _book(client, auth_a, _option_body(a, pairs, f"IT-FIX-C-{tag}", today, tomorrow))               # the old option ticket's pairing: the benchmark at 08:00 UTC
        ko = _book(client, auth_a, _option_body(a, pairs, f"IT-FIX-K-{tag}", today, tomorrow, "BARRIER"))     # an up-and-out barrier five per cent above the spot
        venue = _book(client, auth_a, _forward_body(a, pairs, f"IT-FIX-V-{tag}", today, tomorrow, settlement_price_source=DELIVERY, valuation_time="08:00 UTC"))
        made += [fwd, early, same, opt, ko, venue]

        # ── LIVE: before the fixing date the body is the live quote, with its state ──
        # both forwards here fix today: before that the booked trade is priced to its fixing date, as a ticket sending the fixing date is (0.26.0)
        quote = lambda on, settle=later: client.post("/api/currency/forward/price", json={"pair": "BTCUSD", "shape": "NDF", "base_notional": 10, "direction": "BUY", "forward_rate": K,
                                                                                         "settlement_date": settle.isoformat(), "valuation_date": on.isoformat(), "fixing_date": today.isoformat()}, headers=auth_a).json()
        before = _price(client, auth_a, fwd, yesterday)
        assert before.status_code == 200, before.text
        live = before.json()
        assert live["state"] == "LIVE" and live["npv"] == quote(yesterday)["npv"] and live["fixing_date"] == today.isoformat() and live["df_quote"] < 1 and live["spot01"] > 0 and live["forward"] > 0
        assert not {"fixing", "provisional", "settled", "settlement_amount"} & set(live)
        assert set(live) - {"state", "trade_id", "trade_ref", "instrument_type", "npv_ccy", "legs"} == set(quote(yesterday))        # the quote as it was, plus the state
        live_early = _price(client, auth_a, early, yesterday).json()                                          # the fixing date does not change how a live forward is priced
        assert live_early["state"] == "LIVE" and live_early["npv"] == quote(yesterday, tomorrow)["npv"]
        far = _price(client, auth_a, booked["CRYPTO_OPTION"]["id"], today).json()
        assert far["state"] == "LIVE" and far["vol_pct"] > 0 and far["vega"] > 0
        assert "state" not in _price(client, auth_a, booked["FX_FORWARD"]["id"], today).json() and "state" not in _price(client, auth_a, booked["FX_OPTION"]["id"], today).json()

        # ── the feed: an empty store is asked for the last ten days; a price is stored when the spot agrees ──
        ten = [(day(n), spot * (1 + 0.001 * n)) for n in range(0, 10)]
        got = {"ok": {"BTC": _feed("BTC", *ten), "ETH": _feed("ETH", *[(day(n), SPOTS["ETHUSD"] * (1.55 if n == 4 else 1.0)) for n in range(0, 10)])}, "failed": {"SOL": "HTTP 503"}}
        out, collect = tick(got)
        assert collect.call_args.kwargs["count"] == {"BTC": 11, "ETH": 11, "SOL": 11} and out["asked"] == ["BTC", "ETH", "SOL"]
        assert out["written"] == 19 and out["refused"] == 1 and out["unchecked"] == 0 and out["failed"] == {"SOL": "HTTP 503"}
        assert out["assets"]["ETH"]["refused"] == 1 and out["assets"]["BTC"]["written"] == 10
        shared = rows("user_id IS NULL AND pair = 'BTCUSD'")
        assert len(shared) == 10 and {(x.source, x.origin, x.superseded_at, x.disputed_at) for x in shared} == {(DELIVERY, "FEED", None, None)}
        assert not rows("pair = 'ETHUSD' AND fixing_date = :d", d=day(4)) and not rows("pair = 'SOLUSD'")
        for auth in (auth_a, auth_b):                                                                         # shared: every account reads them
            last = get(auth)["fixings"][-1]
            assert last == {"date": today.isoformat(), "source": DELIVERY, "time": "08:00 UTC", "value": spot, "origin": "FEED", "own": False, "disputed": False}
        # a price with no stored spot to check it against, on its date or the day either side, is not stored;
        # its neighbours are checked against the spot of the day beside them
        db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :a AND curve_id = 'SOLUSD_SPOT' AND valuation_date = ANY(:d) AND quotes::text LIKE :m"), {"a": USER_A, "d": [day(1), day(2), day(3)], "m": f"%{MARK}%"})
        db.commit()
        out, collect = tick({"ok": {"SOL": _feed("SOL", *[(day(n), SPOTS["SOLUSD"]) for n in range(0, 10)])}, "failed": {"ETH": "HTTP 503"}})
        assert set(collect.call_args.kwargs["count"]) == {"ETH", "SOL"} and collect.call_args.kwargs["count"]["ETH"] == 6             # BTC has every date: not asked; ETH to its hole
        assert out["assets"]["SOL"]["written"] == 9 and out["assets"]["SOL"]["unchecked"] == 1 and out["current"] is False
        # health: a hole in the last seven days is red, for either reason
        assert r.last_fixing_at(db, now) is None
        # ── the administrator: only the admin role, the feed's own checks, a reason; fills the dates the venue could not ──
        fill = lambda auth, **body: client.post("/api/currency/fixings/correct", json={"pair": "SOLUSD", "fixing_date": day(2).isoformat(), "source": "Deribit SOL delivery price",
                                                                                       "value": SPOTS["SOLUSD"], "reason": "the venue no longer serves this date", **body}, headers=auth)
        assert fill(auth_a).status_code == 403                                                                # a trader
        from api.routes import ops
        assert ops.signup_role_applied(db) is True                                                            # the stack has the sign-up role migration
        with patch("api.routes.me.db_role", return_value="admin"), patch("api.routes.ops.signup_role_applied", return_value=False):
            off = fill(auth_a)                                                                                # a database without it: the admin role is not a safe gate yet
            assert off.status_code == 409 and off.json()["detail"] == "corrections are off until the sign-up role migration is applied"
        with patch("api.routes.me.db_role", return_value="admin"):
            assert fill(auth_a).status_code == 422                                                            # no stored spot for that date: it cannot be checked
            assert fill(auth_a, pair="ETHUSD", source="Deribit ETH delivery price", fixing_date=day(4).isoformat(), value=SPOTS["ETHUSD"] * 1.55).status_code == 422       # outside the band
            assert fill(auth_a, reason="short").status_code == 422 and fill(auth_a, source=BRR).status_code == 422
            # the price the feed refused was the day's price after all (a move beyond the band): stored with the override, a fuller reason, and a note that says so
            moved = "the market rose fifty-five per cent on the day; the venue's notice confirms the price"
            assert fill(auth_a, pair="ETHUSD", source="Deribit ETH delivery price", fixing_date=day(4).isoformat(), value=SPOTS["ETHUSD"] * 1.55, override_band=True, reason="restated by the venue").status_code == 422   # a reason that short is not enough for it
            _limits._buckets.clear()
            done = fill(auth_a, pair="ETHUSD", source="Deribit ETH delivery price", fixing_date=day(4).isoformat(), value=SPOTS["ETHUSD"] * 1.55, override_band=True, reason=moved)
            assert done.status_code == 200, done.text
            assert [f for f in done.json()["fixings"] if f["date"] == day(4).isoformat()] == [
                {"date": day(4).isoformat(), "source": "Deribit ETH delivery price", "time": "08:00 UTC", "value": SPOTS["ETHUSD"] * 1.55, "origin": "CORRECTION", "own": False, "disputed": False}]
            db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, created_by, user_id) VALUES ('SOLUSD_SPOT', :d, cast(:q as jsonb), 'IMPORT', :u, :u)"),
                       {"d": day(2), "u": USER_A, "q": json.dumps([{"tenor": "SPOT", "quote_type": "SPOT", "rate": SPOTS["SOLUSD"], "enabled": True, "note": MARK}])})
            db.commit()
            assert fill(auth_a).status_code == 200
        filled = rows("pair = 'ETHUSD' AND fixing_date = :d", d=day(4))
        assert [(x.origin, x.user_id, str(x.created_by), x.note) for x in filled] == [("CORRECTION", None, USER_A, "[band overridden] " + moved)]
        assert [(x.origin, x.note) for x in rows("pair = 'SOLUSD' AND fixing_date = :d", d=day(2))] == [("CORRECTION", "the venue no longer serves this date")]
        assert r.last_fixing_at(db, now) == datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=8)
        assert r.fixings_missing(db, now) == {"BTC": [], "ETH": [], "SOL": []}
        out, collect = tick({"ok": {}, "failed": {}})
        assert out["current"] is True and out["asked"] == [] and not collect.called                           # every date stored: the venue is not asked
        # ── a re-read that differs: nothing of the batch is stored, the date is disputed, health is red until it is corrected ──
        again = {"ok": {"BTC": _feed("BTC", (yesterday, spot * 1.04), (today, spot))}, "failed": {}}
        out, _ = tick(again, force=True, count=2)
        assert out["differs"] == 1 and out["written"] == 0 and "disputed" in out["failed"]["BTC"]
        disputed = rows("user_id IS NULL AND pair = 'BTCUSD' AND fixing_date = :d", d=yesterday)
        assert [(x.value, x.origin, x.disputed_at is not None) for x in disputed] == [(spot * 1.001, "FEED", True)]      # the stored value stands
        assert store.disputed(db, r.FIXING_KEYS) == 1 and r.last_fixing_at(db, now) is None
        _limits._buckets.clear()                                                                              # six corrections a minute, and this is the seventh call
        with patch("api.routes.me.db_role", return_value="admin"):
            fixed = client.post("/api/currency/fixings/correct", json={"pair": "BTCUSD", "fixing_date": yesterday.isoformat(), "source": DELIVERY, "value": spot * 1.04,
                                                                       "reason": "the venue restated the day; checked against two other venues"}, headers=auth_a)
        assert fixed.status_code == 200, fixed.text
        history = rows("user_id IS NULL AND pair = 'BTCUSD' AND fixing_date = :d", d=yesterday)
        assert [(x.origin, x.superseded_at is None) for x in history] == [("FEED", False), ("CORRECTION", True)]          # the old row kept, the correction live
        assert store.get(db, "BTCUSD", yesterday, DELIVERY, USER_B) == {"date": yesterday.isoformat(), "source": DELIVERY, "time": "08:00 UTC", "value": spot * 1.04, "origin": "CORRECTION", "own": False, "disputed": False}
        assert store.disputed(db, r.FIXING_KEYS) == 0 and r.last_fixing_at(db, now) is not None
        out, _ = tick({"ok": {"BTC": _feed("BTC", (yesterday, spot * 1.001), (today, spot))}, "failed": {}}, force=True, count=2)      # the venue reading otherwise again
        assert out["differs"] == 0 and store.disputed(db, r.FIXING_KEYS) == 0 and store.get(db, "BTCUSD", yesterday, DELIVERY, None)["value"] == spot * 1.04
        # a later re-read that agrees clears a dispute by itself
        tick({"ok": {"ETH": _feed("ETH", (today, SPOTS["ETHUSD"] * 1.03))}, "failed": {}}, force=True, count=1)
        assert store.disputed(db, r.FIXING_KEYS) == 1
        tick({"ok": {"ETH": _feed("ETH", (today, SPOTS["ETHUSD"]))}, "failed": {}}, force=True, count=1)
        assert store.disputed(db, r.FIXING_KEYS) == 0
        # the new default follows the feed: switched on and delivering, a new ticket starts on the venue's price; the old field does not move
        monkeypatch.setenv("RIJEKA_DEMO_MARKET_DATA", "1")
        on = {p["pair"]: p for p in pairs_now()["pairs"]}
        assert on["BTCUSD"]["settlement_default"] == {"source": DELIVERY, "time": "08:00 UTC"} and on["BTCUSD"]["fixing_default"] == BRR and "settlement_default" not in on["EURUSD"]
        assert store.feed_delivering(db, "BTCUSD") and not store.feed_delivering(db, "BTCUSD", today + timedelta(days=4))
        monkeypatch.setenv("RIJEKA_DEMO_MARKET_DATA", "0")
        assert {p["pair"]: p for p in pairs_now()["pairs"]}["BTCUSD"]["settlement_default"]["source"] == BRR

        # ── FIXED, provisional: the fixing date is reached, the trades name CME CF BRR, and the venue's price for the day is not theirs ──
        estimate = 10 * (spot - K)
        p = _price(client, auth_a, fwd, today)
        assert p.status_code == 200, p.text
        p = p.json()
        assert p["state"] == "FIXED" and STATE_KEYS | set(QUOTE_ONLY) | {"forward_rate"} <= set(p) and all(p[k] is None for k in QUOTE_ONLY)
        assert p["provisional"] is True and p["provisional_reason"] == "no fixing stored" and p["provisional_basis"] == f"stored spot of {today.isoformat()}"
        assert p["fixing"] is None and p["fixing_source"] == BRR and p["settlement_amount"] == pytest.approx(estimate) and p["settlement_price"] == spot
        assert 0.9995 * estimate < p["npv"] < estimate and p["forward_rate"] == K and p["quote_notional"] == 10 * K          # the provisional amount, discounted two days: one cash flow, not a forward
        assert p["fund01"] == 0.0 and p["ir01"] == pytest.approx(-p["npv"] * 2 / 365 * 1e-4, rel=1e-3)
        # ── a client that does not ask for states (the web app before 0.14.0) is answered as it was before the rule ──
        old = _price(client, auth_a, fwd, today, states=None)                                                # between fixing and settlement: the live quote it always got, and no state it would misread
        assert old.status_code == 200 and "state" not in old.json() and "fixing" not in old.json() and old.json()["npv"] == quote(today)["npv"] and old.json()["forward"] > 0
        gone = _price(client, auth_a, same, today, states=None)
        assert gone.status_code == 422 and gone.json()["detail"] == "settlement_date must be after the valuation date"
        expired = _price(client, auth_a, opt, today, states=False)
        assert expired.status_code == 422 and expired.json()["detail"] == "expiry_date must be after the valuation date"
        assert _price(client, auth_a, fwd, yesterday, states=None).json() == live                            # and a live quote is the same answer either way
        s = _price(client, auth_a, same, today)
        assert s.status_code == 200, s.text                                                                  # 422 before the rule: "settlement_date must be after the valuation date"
        s = s.json()
        assert s["state"] == "SETTLED" and s["npv"] == 0.0 and s["provisional"] is True and s["settlement_amount"] == pytest.approx(estimate) and all(s[k] is None for k in QUOTE_ONLY)
        o = _price(client, auth_a, opt, today)
        assert o.status_code == 200, o.text
        o = o.json()
        assert o["state"] == "FIXED" and o["provisional"] is True and o["fixing"] is None and o["shape"] == "OPTION" and o["strike"] == K and "forward_rate" not in o
        assert 0 < o["npv"] <= estimate and o["settlement_amount"] == pytest.approx(estimate) and all(o[k] is None for k in QUOTE_ONLY)
        # the trade that names the venue's price is fixed on it already: the shared row, for every account
        v = _price(client, auth_a, venue, today).json()
        assert v["state"] == "FIXED" and v["provisional"] is False and v["fixing"] == {"source": DELIVERY, "date": today.isoformat(), "time": "08:00 UTC", "value": spot, "origin": "FEED", "disputed": False}
        assert v["settlement_amount"] == pytest.approx(estimate) and 0.999 * estimate < v["npv"] < estimate
        # a disputed fixing is still the fixing, and the answer says it is disputed until a re-read agrees or an administrator rules
        tick({"ok": {"BTC": _feed("BTC", (today, spot * 1.02))}, "failed": {}}, force=True, count=1)
        vd = _price(client, auth_a, venue, today).json()
        assert vd["fixing"] == {**v["fixing"], "disputed": True} and vd["npv"] == v["npv"] and get(auth_b)["fixings"][-1]["disputed"] is True
        tick({"ok": {"BTC": _feed("BTC", (today, spot))}, "failed": {}}, force=True, count=1)
        assert _price(client, auth_a, venue, today).json()["fixing"]["disputed"] is False

        # ── a desk's own entry; a second one supersedes the first, which is kept ──
        post = lambda auth, **body: client.post("/api/currency/fixings", json={"pair": "BTCUSD", "fixing_date": today.isoformat(), "source": BRR, "value": 108_000.0, **body}, headers=auth)
        first = post(auth_a)
        assert first.status_code == 200, first.text
        assert [f for f in first.json()["fixings"] if f["own"]] == [{"date": today.isoformat(), "source": BRR, "time": "16:00 London", "value": 108_000.0, "origin": "MANUAL", "own": True, "disputed": False}]
        assert post(auth_a, value=110_000.0).status_code == 200
        assert [f["value"] for f in get(auth_a)["fixings"] if f["own"]] == [110_000.0]
        assert [(x.value, x.superseded_at is None) for x in rows("user_id = :u", u=USER_A)] == [(108_000.0, False), (110_000.0, True)]
        assert store.own_usage(db, USER_A, "BTCUSD", today, BRR) == {"rows": 1, "total": 2, "sources": 1, "replaces": True, "source_known": True}       # the superseded row counts in the total
        assert store.own_usage(db, USER_A, "BTCUSD", yesterday, "Desk close") == {"rows": 1, "total": 2, "sources": 1, "replaces": False, "source_known": False}
        with patch.object(store, "OWN_TOTAL_MAX", 2):                                                             # an account at its total: no further entry, a replacement included
            assert post(auth_a, value=111_000.0).status_code == 409
        for typo in ("Derbit BTC", "Deribt 08:00", "Dcribit", "Deribil BTC delivery price"):
            assert post(auth_a, source=typo).status_code == 422, typo
        assert not [f for f in get(auth_b)["fixings"] if f["own"]]                                               # nobody else's
        assert post(auth_b, value=55_555.0).status_code == 200                                                   # and theirs is not ours
        assert [f["value"] for f in get(auth_a)["fixings"] if f["own"]] == [110_000.0]
        for refused in (dict(source=DELIVERY), dict(source="Deribit BTC delivery price."), dict(source="Deribit BTC deIivery price"), dict(fixing_date=(today + timedelta(days=3)).isoformat()),
                        dict(fixing_date="2014-12-31"), dict(pair="EURUSD"), dict(value=-1)):
            assert post(auth_a, **refused).status_code == 422, refused
        assert not rows("user_id IS NOT NULL AND source LIKE 'Deribit%'") and len(rows("user_id IS NULL AND pair = 'BTCUSD' AND superseded_at IS NULL")) == 10      # the shared rows untouched
        assert store.get(db, "BTCUSD", today, BRR, USER_A)["value"] == 110_000.0 and store.get(db, "BTCUSD", today, BRR, USER_B)["value"] == 55_555.0
        assert store.get(db, "BTCUSD", today, BRR, None) is None
        # the database refuses what the code never writes: a shared MANUAL row, an account's FEED row, a price that is not one
        for bad in ("(gen_random_uuid(), NULL, 'BTCUSD', :d, 'x', 1.0, 'MANUAL')", f"(gen_random_uuid(), '{USER_A}', 'BTCUSD', :d, 'x', 1.0, 'FEED')",
                    "(gen_random_uuid(), NULL, 'BTCUSD', :d, 'x', 0, 'FEED')", "(gen_random_uuid(), NULL, 'BTCUSD', :d, 'x', 'NaN', 'FEED')",
                    "(gen_random_uuid(), NULL, 'BTCUSD', :d, 'x', 'Infinity', 'FEED')", "(gen_random_uuid(), NULL, 'BTCUSD', :d, 'x', 1.0, 'OTHER')"):
            with pytest.raises(Exception, match="fixings_(owner|value|origin)_check"):
                db.execute(text("INSERT INTO fixings (id, user_id, pair, fixing_date, source, value, origin) VALUES " + bad), {"d": day(20)})
            db.rollback()

        # ── FIXED and SETTLED on the stored fixing ──
        amount = 10 * (110_000.0 - K)
        f = _price(client, auth_a, fwd, today).json()
        assert f["state"] == "FIXED" and f["fixing"] == {"source": BRR, "date": today.isoformat(), "time": "16:00 London", "value": 110_000.0, "origin": "MANUAL", "disputed": False}
        assert f["provisional"] is False and f["provisional_reason"] is None and f["provisional_basis"] is None and f["settlement_price"] == 110_000.0
        assert f["settlement_amount"] == pytest.approx(amount) and 0.9995 * amount < f["npv"] < amount and f["fund01"] == 0.0 and f["trade_id"] == fwd and set(f) == set(p)
        val = value(db, {"sub": USER_A}, db.query(Trade).filter(Trade.id == fwd).first(), today, Market(db, USER_A, today))      # the valuation P&L runs: the same rule, the same figures
        assert (f["npv"], f["ir01"], f["ir01_disc"], f["theta"]) == (val["npv"], val["ir01"], val["ir01_disc"], val["theta"]) and val["fixing"] == f["fixing"]
        assert f["ir01"] == pytest.approx(-f["npv"] * 2 / 365 * 1e-4, rel=1e-3) and 0 < f["theta"] < 0.0002 * amount          # two days of discounting left; one unwinds tomorrow
        paid = _price(client, auth_a, fwd, later).json()                                                           # the settlement date: the mark is zero, the amount reported
        assert paid["state"] == "SETTLED" and paid["npv"] == 0.0 and paid["settlement_amount"] == pytest.approx(amount) and paid["fixing"]["value"] == 110_000.0 and set(paid) == set(f)
        # the forward fixed the day before it is paid: discounted one day, FIXED today, SETTLED tomorrow
        e = _price(client, auth_a, early, today).json()
        assert e["state"] == "FIXED" and e["settlement_amount"] == pytest.approx(amount) and f["npv"] < e["npv"] < amount and e["theta"] == pytest.approx(-e["npv"], rel=1e-12)
        e2 = _price(client, auth_a, early, tomorrow).json()
        assert e2["state"] == "SETTLED" and e2["npv"] == 0.0 and e2["settlement_amount"] == pytest.approx(amount)
        s = _price(client, auth_a, same, today).json()
        assert s["state"] == "SETTLED" and s["npv"] == 0.0 and s["provisional"] is False and s["settlement_amount"] == pytest.approx(amount) and s["fixing"]["origin"] == "MANUAL"
        # the option's payoff, fixed, is the same cash flow as that forward's: the same value and the same sensitivities
        o2 = _price(client, auth_a, opt, today).json()
        assert o2["state"] == "FIXED" and o2["fixing"]["value"] == 110_000.0 and o2["provisional"] is False and o2["settlement_amount"] == pytest.approx(amount)
        assert (o2["npv"], o2["ir01"], o2["theta"]) == (e["npv"], e["ir01"], e["theta"]) and o2["ir01"] < 0 and set(o2) == set(o)
        assert _price(client, auth_a, opt, tomorrow).json()["state"] == "SETTLED"
        # the barrier five per cent above the stored spot: the fixing is short of it and nothing records its knock state, so the amount is provisional and says why
        k2 = _price(client, auth_a, ko, today).json()
        assert k2["state"] == "FIXED" and k2["fixing"]["value"] == 110_000.0 and k2["provisional"] is True and k2["provisional_reason"] == "knock state not recorded"
        assert k2["settlement_amount"] == pytest.approx(amount) and k2["provisional_basis"] == "the barrier taken as never touched" and "read from the fixing" not in (k2["model"] or "")
        assert k2["settlement_amount_if_touched"] == pytest.approx(10 * 0.001) and set(k2) == set(o2) | {"settlement_amount_if_touched"}      # both outcomes: the rebate if it was touched
        assert (k2["style"], k2["barrier_type"], k2["rebate"]) == ("BARRIER", "UP_OUT", 0.001) and k2["barrier"] > 110_000.0 and k2["quote_notional"] == 10 * K
        assert post(auth_a, value=115_000.0).status_code == 200                                                    # a fixing beyond the barrier settles it: knocked out, the rebate
        k3 = _price(client, auth_a, ko, today).json()
        assert k3["provisional"] is False and k3["provisional_reason"] is None and k3["settlement_amount"] == pytest.approx(10 * 0.001) and "settlement_amount_if_touched" not in k3
        assert post(auth_a, value=110_000.0).status_code == 200
        # ── an edit of a booked trade's terms goes through the booking rule when it changes what the settlement rule reads ──
        terms = db.query(Trade).filter(Trade.id == week).first().terms
        db.rollback()
        put = lambda **change: client.put(f"/api/trades/{week}", json={"terms": {**terms, **change}}, headers=auth_a)
        for change, why in ((dict(settlement_price_source="Deribit BTC delivery price."), "reads like it"), (dict(settlement_price_source="Derbit BTC"), "reads like it"),
                            (dict(valuation_time="08:00 UTC"), "valuation_time must be 16:00 London"), (dict(valuation_date=(today - timedelta(days=3)).isoformat()), "must be after the trade date"),
                            (dict(valuation_date=(today + timedelta(days=8)).isoformat()), "cannot be after the settlement date")):
            refused = put(**change)
            assert refused.status_code == 422 and why in refused.text, (change, refused.text[:200])
        assert put(calculation_agent="Rijeka").status_code == 200                                                  # nothing the rule reads has changed
        assert put(settlement_price_source=DELIVERY, valuation_time="08:00 UTC").status_code == 200                # a valid change of source, with its time
        db.expire_all()
        assert db.query(Trade).filter(Trade.id == week).first().terms["settlement_price_source"] == DELIVERY
        db.rollback()
        # yesterday is still before the fixing date, whatever is stored now
        assert _price(client, auth_a, fwd, yesterday).json() == live
        # and the other tenant cannot price any of it
        assert _price(client, auth_b, fwd, today).status_code == 404
    finally:
        _clean(db)
        left = db.execute(text("SELECT count(*) FROM fixings")).scalar()
        spots_left = db.execute(text("SELECT count(*) FROM market_data_snapshots WHERE quotes::text LIKE :m"), {"m": f"%{MARK}%"}).scalar()
        db.close()
        for tid in made:
            client.post(f"/api/trade-events/cancel/{tid}", headers=auth_a)
    assert left == 0 and spots_left == 0
    assert get(auth_a)["fixings"] == []
