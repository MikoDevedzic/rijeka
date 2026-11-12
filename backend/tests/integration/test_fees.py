"""Fees over the API: valued on the currency's curve, carried into an XVA run, stored with a booked trade, and a
fee that is not one refused wherever it is sent."""
from datetime import date, timedelta

import pytest

from tests.integration import bodies as B

pytestmark = pytest.mark.integration

ASOF = "2026-11-02"                    # the stack's market (backend/stack/seed.py)


def _fee(**kw):
    return {"type": "PREMIUM", "direction": "PAY", "amount": 12500, "currency": "USD", "date": "2026-11-04", **kw}


def test_fees_are_valued_on_the_currencys_curve(client, auth_a):
    r = client.post("/api/price/fees", json={"currency": "usd", "valuation_date": ASOF, "fees": [
        _fee(date="2026-10-30"), _fee(date=ASOF), _fee(direction="RECEIVE", amount=4000, date="2027-11-02", type="UPFRONT")]}, headers=auth_a)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    paid, today, later = j["fees"]
    assert j["currency"] == "USD" and j["curve_id"] == "USD_SOFR" and j["valuation_date"] == ASOF
    assert paid["paid"] and paid["pv"] == 0 and today["df"] == 1 and today["pv"] == -12500
    assert 0.94 < later["df"] < 0.98 and later["pv"] == pytest.approx(4000 * later["df"])
    assert j["pv"] == pytest.approx(-12500 + later["pv"]) and j["pay"] == -12500 and j["receive"] == pytest.approx(later["pv"])
    assert client.post("/api/price/fees", json={"currency": "USD", "fees": []}, headers=auth_a).json()["pv"] == 0


def test_a_fee_that_is_not_one_is_refused_wherever_it_is_sent(client, auth_a):
    bad = _fee(amount=-1)
    for path, body in (("/api/price/fees", {"currency": "USD", "fees": [bad]}),
                       ("/api/price/fees", {"currency": "USD", "fees": [_fee(currency="EUR")]}),
                       ("/api/price/fees", {"currency": "XAU", "fees": [_fee(currency="XAU")]}),
                       ("/api/xva/currency", {"pair": "EURUSD", "base_notional": 1_000_000, "settlement_date": "2027-05-04", "direction": "BUY", "paths": 200,
                                              "valuation_date": ASOF, "csa": {"preset": "UNCOLLATERALISED"}, "fees": [bad]})):
        r = client.post(path, json=body, headers=auth_a)
        assert r.status_code == 422, (path, r.status_code, r.text[:200])
    assert client.post("/api/price/fees", json={"currency": "USD", "fees": [_fee()]}).status_code in (401, 403), "not without a sign-in"


def test_an_xva_run_carries_the_trades_fees(client, auth_a):
    body = {"pair": "EURUSD", "base_notional": 10_000_000, "settlement_date": "2027-05-04", "direction": "BUY", "paths": 500, "seed": 42,
            "valuation_date": ASOF, "csa": {"preset": "UNCOLLATERALISED"}}
    plain = client.post("/api/xva/currency", json=body, headers=auth_a).json()
    owed = client.post("/api/xva/currency", json={**body, "fees": [_fee(direction="RECEIVE", amount=80_000, date="2027-02-02", type="UPFRONT")]}, headers=auth_a).json()
    assert plain["params"]["fees"] is None
    assert owed["params"]["fees"]["count"] == 1 and 78_000 < owed["params"]["fees"]["pv"] < 80_000
    # a fee we are owed is exposure until it is paid: it lifts the value on every path, and the expected exposure by
    # less than its amount (the paths where the forward is against us owe us less than the fee)
    assert plain["ee"][0] + 30_000 < owed["ee"][0] < plain["ee"][0] + 80_000
    assert owed["ee"][-1] == pytest.approx(plain["ee"][-1], abs=0.01), "and nothing after"
    assert abs(owed["xva"]["cva"]) > abs(plain["xva"]["cva"])
    rates = client.post("/api/xva/simulate", json={"notional": 10_000_000, "maturity_y": 2.0, "paths": 300,
                                                   "fees": [_fee(direction="RECEIVE", amount=50_000, date=(date.today() + timedelta(days=200)).isoformat(), type="UPFRONT")]}, headers=auth_a)
    assert rates.status_code == 200, rates.text[:300]
    assert rates.json()["fees"]["count"] == 1 and 48_000 < rates.json()["fees"]["pv"] < 50_000
    # the rates run measures a fee from its own valuation date, as its curve is: a fee three months after a valuation
    # date in the past is still to come on that date (it used to be read from the server's today and dropped as paid)
    old = client.post("/api/xva/simulate", json={"notional": 10_000_000, "maturity_y": 2.0, "paths": 300, "valuation_date": ASOF,
                                                 "fees": [_fee(direction="RECEIVE", amount=50_000, date="2027-02-02", type="UPFRONT")]}, headers=auth_a)
    assert old.status_code == 200, old.text[:300]
    assert old.json()["fees"]["count"] == 1 and 49_000 < old.json()["fees"]["pv"] < 50_000
    # a fee dated on the valuation date is paid that day: in the ticket's value, not in a run
    today = client.post("/api/xva/currency", json={**body, "fees": [_fee(date=ASOF)]}, headers=auth_a).json()
    assert today["params"]["fees"] is None and today["xva"]["cva"] == plain["xva"]["cva"]


def test_a_booked_trade_keeps_its_fees_in_one_shape(client, auth_a, ids, pairs):
    eur = pairs["EURUSD"]
    q = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "FORWARD", "base_notional": 1_000_000, "direction": "BUY",
                                                         "settlement_date": "2027-05-04"}, headers=auth_a).json()
    trade = B.fx_forward(ids["a"], "FEES-1", eur, q)
    trade["terms"]["fees"] = [{"type": "brokerage", "direction": "pay", "amount": "250.5", "currency": "usd", "date": "2026-11-04", "note": "desk"}]
    r = client.post("/api/trades/", json=trade, headers=auth_a)
    assert r.status_code == 200, r.text[:400]
    assert r.json()["terms"]["fees"] == [{"type": "BROKERAGE", "direction": "PAY", "amount": 250.5, "currency": "USD", "date": "2026-11-04", "note": "desk"}]
    bad = B.fx_forward(ids["a"], "FEES-2", eur, q)
    bad["terms"]["fees"] = [{"type": "BROKERAGE", "direction": "PAY", "amount": 0, "currency": "USD", "date": "2026-11-04"}]
    r = client.post("/api/trades/", json=bad, headers=auth_a)
    assert r.status_code == 422 and "above zero" in r.text
    # and through the atomic booking route, on a rates trade
    swap = B.swap(ids["a"], "FEES-3")
    swap["terms"] = {**(swap.get("terms") or {}), "fees": [{"type": "UPFRONT", "direction": "RECEIVE", "amount": 10000, "currency": "USD", "date": "2026-12-04"}]}
    r = client.post("/api/book/trade", json=swap, headers=auth_a)
    assert r.status_code == 201, r.text[:400]
    assert r.json()["trade"]["terms"]["fees"][0] == {"type": "UPFRONT", "direction": "RECEIVE", "amount": 10000.0, "currency": "USD", "date": "2026-12-04"}
    # an update of a booked trade's terms is checked as the booking was
    tid = r.json()["trade"]["id"]
    assert client.put(f"/api/trades/{tid}", json={"terms": {**swap["terms"], "fees": [{"type": "UPFRONT", "direction": "PAY", "amount": 1, "currency": "USD", "date": "not a date"}]}}, headers=auth_a).status_code == 422
    assert client.put(f"/api/trades/{tid}", json={"terms": {**swap["terms"], "fees": [{"type": "UPFRONT"}] * 30}}, headers=auth_a).status_code == 422
    swap2 = B.swap(ids["a"], "FEES-4")
    swap2["terms"] = {**(swap2.get("terms") or {}), "fees": [{"type": "TIP", "direction": "PAY", "amount": 1, "currency": "USD", "date": "2026-12-04"}]}
    assert client.post("/api/book/trade", json=swap2, headers=auth_a).status_code == 422
