"""The pairs answer's dates on a real database (GET /api/currency/pairs): each pair's calendar with its holidays,
spot date and lag, the ticket's tenors as forward and option dates by market convention, every field the answer
had before still there; a priced forward and option carry settlement_business_day, date_notes and, on a digital
asset, crybasis01 = −fund01. bodies.py is unchanged: a record books as before."""
from __future__ import annotations

from datetime import date

import pytest

from pricing import tenor_dates as TD
from pricing.calendars import is_business_day

pytestmark = pytest.mark.integration
BEFORE = ("pair", "base", "quote", "crypto", "spot", "spot_as_of", "quote_curve", "pip", "fixing_default", "forward_curve", "forward_points", "vol_surface")


def test_pairs_carry_calendar_spot_and_tenor_dates(client, auth_a):
    r = client.get("/api/currency/pairs", headers=auth_a)
    assert r.status_code == 200, r.text
    j = r.json()
    today = date.fromisoformat(j["today"])
    assert today == date.today() and j["ticket_tenors"] == list(TD.TENORS) and "forward_tenors" in j and "tenor_days" in j
    by = {p["pair"]: p for p in j["pairs"]}
    for pair, p in by.items():
        for k in BEFORE:
            assert k in p, f"{pair}: {k} missing from the pairs answer"
        cal = p["calendar"]
        assert cal["name"] == TD.pair_calendar(pair) and cal["weekend"] == ["SAT", "SUN"]
        assert cal["holidays"] == sorted(cal["holidays"]) and all(today <= date.fromisoformat(h) <= TD.add_months(today, 36) for h in cal["holidays"])
        assert all(not is_business_day(date.fromisoformat(h), cal["name"]) for h in cal["holidays"])
        assert p["spot_date"] == TD.spot(pair, today).isoformat()
        assert p["spot_lag_business_days"] == (0 if p["crypto"] else 1 if pair == "USDCAD" else 2)
        f, o = p["tenor_dates"]["forward"], p["tenor_dates"]["option"]
        assert list(f) == list(TD.TENORS) and list(o) == list(TD.TENORS)
        for t in TD.TENORS:
            assert f[t] == TD.forward_date(pair, today, t).isoformat()
            assert o[t] == {k: (v.isoformat() if isinstance(v, date) else v) for k, v in TD.option_date(pair, today, t).items()}
            assert o[t]["expiry_rule"] in (("business day before settlement",) if p["crypto"] else ("spot", "fallback"))
            assert is_business_day(date.fromisoformat(f[t]), cal["name"])             # every settlement is a business day of the cash calendar
            assert is_business_day(date.fromisoformat(o[t]["settlement"]), cal["name"])
            if not p["crypto"]:
                assert o[t]["settlement"] == f[t]                                    # an FX option delivers on the forward date of its tenor
                assert is_business_day(date.fromisoformat(o[t]["expiry"]), cal["name"])
                if o[t]["expiry_rule"] == "spot":
                    assert TD.spot(pair, date.fromisoformat(o[t]["expiry"])).isoformat() == o[t]["settlement"]
            else:
                assert o[t]["settlement"] == f[t]                                    # a digital asset's option settles on the forward date too
                assert o[t]["settlement"] > o[t]["expiry"] and is_business_day(date.fromisoformat(o[t]["expiry"]), "NEW_YORK")
    eur, btc = by["EURUSD"], by["BTCUSD"]
    assert eur["calendar"]["name"] == "NEW_YORK+TARGET" and btc["calendar"]["name"] == "NEW_YORK"
    if today <= date(2027, 3, 26):
        assert "2027-03-26" in eur["calendar"]["holidays"] and "2027-03-29" in eur["calendar"]["holidays"]      # Good Friday, Easter Monday: TARGET
        assert "2027-03-26" not in btc["calendar"]["holidays"]
    assert date.fromisoformat(eur["spot_date"]) > today and btc["spot_date"] == today.isoformat()          # a digital asset's spot settles at once
    # the FX forward's dates count from the spot date (a week, rolled at most a few days either way), the digital asset's from today
    assert 5 <= (date.fromisoformat(eur["tenor_dates"]["forward"]["1W"]) - date.fromisoformat(eur["spot_date"])).days <= 10
    assert 7 <= (date.fromisoformat(btc["tenor_dates"]["forward"]["1W"]) - today).days <= 10


def test_priced_forward_and_option_carry_the_date_check_and_crybasis01(client, auth_a, pairs):
    sunday = date(2027, 5, 9)
    q = client.post("/api/currency/forward/price", json={"pair": "BTCUSD", "shape": "NDF", "base_notional": 10, "direction": "BUY",
                                                          "settlement_date": sunday.isoformat()}, headers=auth_a)
    assert q.status_code == 200, q.text
    j = q.json()
    assert j["settlement_business_day"] is False and j["date_notes"] == ["settlement Sun 9 May 2027 is a Sunday; the market would settle on Mon 10 May 2027"]
    assert j["fund01"] < 0 < j["crybasis01"] and j["crybasis01"] == pytest.approx(-j["fund01"])
    ok = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "FORWARD", "base_notional": 1_000_000, "direction": "SELL",
                                                           "settlement_date": pairs["EURUSD"]["tenor_dates"]["forward"]["3M"]}, headers=auth_a)
    assert ok.status_code == 200, ok.text
    assert ok.json()["settlement_business_day"] is True and ok.json()["date_notes"] == [] and ok.json()["crybasis01"] is None and ok.json()["fund01"] is None
    o3 = pairs["BTCUSD"]["tenor_dates"]["option"]["3M"]
    opt = client.post("/api/currency/option/price", json={"pair": "BTCUSD", "option_type": "PUT", "base_notional": 10, "direction": "SELL",
                                                           "expiry_date": o3["expiry"], "settlement_date": o3["settlement"]}, headers=auth_a)
    assert opt.status_code == 200, opt.text
    k = opt.json()
    assert k["settlement_business_day"] is True and k["date_notes"] == [] and k["crybasis01"] == pytest.approx(-k["fund01"])
    e3 = pairs["EURUSD"]["tenor_dates"]["option"]["3M"]
    fxo = client.post("/api/currency/option/price", json={"pair": "EURUSD", "option_type": "CALL", "base_notional": 1_000_000, "direction": "BUY",
                                                           "expiry_date": e3["expiry"]}, headers=auth_a)
    assert fxo.status_code == 200, fxo.text
    assert fxo.json()["settlement_date"] == e3["settlement"]              # the default delivery (expiry + 2 business days) is the tenor's forward date
    assert fxo.json()["settlement_business_day"] is True and fxo.json()["date_notes"] == []


def test_booked_digital_asset_forward_values_with_crybasis01(client, auth_a, booked):
    r = client.post("/price", json={"trade_id": booked["CRYPTO_FORWARD"]["id"], "curves": [{"curve_id": "USD_SOFR"}]}, headers=auth_a)
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["crybasis01"] == pytest.approx(-v["fund01"]) and v["crybasis01"] > 0
