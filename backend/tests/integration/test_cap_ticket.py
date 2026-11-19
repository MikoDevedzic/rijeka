"""The cap, floor and collar tickets price the trade they book (0.59.0).

The ticket's price (POST /api/price/cap, /floor, /collar with the leg the ticket books) against the value of the
booked trade read back from the database (POST /price): one figure. Until 0.59.0 the routes priced a schedule of
their own (from two calendar days after the valuation date, ACT/360 whatever the ticket said, the ticket's dates
unread), so the two were a fraction of a percent apart on the ticket's defaults and several percent with the day
count changed. Also here: the side signs every figure, a strike left out is struck at the money, the periods are the
leg's own, and a booked cap whose remaining life is between two quoted maturities is read off the surface between
them, where it fell to the desk default."""
from __future__ import annotations

import pytest

from tests.integration.test_golden_book import ASOF

pytestmark = pytest.mark.integration

ROUTE = {"IR_CAP": ("/api/price/cap", "npv"), "IR_FLOOR": ("/api/price/floor", "npv"), "IR_COLLAR": ("/api/price/collar", "net_npv")}


def _post(client, auth, url, body):
    r = client.post(url, json=body, headers=auth)
    assert r.status_code == 200, f"{url}: {r.status_code} {r.text[:300]}"
    return r.json()


def _ticket(b: dict, **more) -> dict:
    """The request the ticket sends for a booking body: its leg without the strikes, the strikes and the side."""
    leg = {k: v for k, v in b["body"]["legs"][0].items() if k not in ("embedded_options", "terms")}
    t = b["body"]["terms"]
    return {"notional": b["body"]["notional"], "tenor_y": 5, "side": t["side"], "curve_id": "USD_SOFR", "valuation_date": ASOF, "leg": leg,
            **{k: t[k] for k in ("cap_rate", "floor_rate") if t.get(k) is not None}, **more}


@pytest.mark.parametrize("key", ["IR_CAP", "IR_FLOOR", "IR_COLLAR"])
def test_the_ticket_prices_the_trade_it_books(client, auth_a, booked, key):
    url, npv = ROUTE[key]
    stored = _post(client, auth_a, "/price", {"trade_id": booked[key]["id"], "valuation_date": ASOF, "curves": [{"curve_id": "USD_SOFR"}]})
    ticket = _post(client, auth_a, url, _ticket(booked[key]))
    assert ticket[npv] == pytest.approx(stored["npv"], abs=0.006), key          # the route rounds to the cent
    assert ticket["effective_date"] == booked[key]["body"]["legs"][0]["effective_date"]
    assert ticket["maturity_date"] == booked[key]["body"]["legs"][0]["maturity_date"]
    # the vega the ticket shows is the one the stored trade reports for its options
    vega = ticket["vega"] if key != "IR_COLLAR" else ticket["net_vega"]
    assert vega == pytest.approx(stored["vega"], abs=0.011), key
    # the other side is the same trade with its sign turned: value, vega and rate risk
    side = booked[key]["body"]["terms"]["side"]
    other = _post(client, auth_a, url, _ticket(booked[key], side="SELL" if side == "BUY" else "BUY"))
    for f in ((npv, "vega", "ir01") if key != "IR_COLLAR" else (npv, "net_vega", "net_ir01")):
        assert other[f] == pytest.approx(-ticket[f], abs=0.011), (key, f)
    assert other["side"] != ticket["side"]


def test_the_tickets_dates_and_day_count_are_the_ones_priced(client, auth_a, booked):
    base = _ticket(booked["IR_CAP"])
    as_booked = _post(client, auth_a, "/api/price/cap", base)
    # the day count on the ticket changes the accruals and the forwards: the price moves, as the booked trade's does
    thirty = _post(client, auth_a, "/api/price/cap", {**base, "leg": {**base["leg"], "day_count": "30/360"}})
    assert thirty["day_count"] == "30/360" and abs(thirty["npv"] / as_booked["npv"] - 1) > 0.01
    preview = _post(client, auth_a, "/price/preview", {"valuation_date": ASOF, "curves": [{"curve_id": "USD_SOFR", "quotes": []}],
                    "legs": [{**booked["IR_CAP"]["body"]["legs"][0], "day_count": "30/360"}]})
    assert thirty["npv"] == pytest.approx(preview["npv"], abs=0.006)
    # a cap that starts three months on has one period fewer; at one vol it is worth less by that period (off the
    # surface its own at-the-money forward is another, so its strike sits elsewhere on the smile)
    at_85 = _post(client, auth_a, "/api/price/cap", {**base, "vol_override_bp": 85})
    later = _post(client, auth_a, "/api/price/cap", {**base, "vol_override_bp": 85, "leg": {**base["leg"], "effective_date": "2027-02-04"}})
    assert later["n_caplets"] == at_85["n_caplets"] - 1 and later["caplets"][0]["start_date"] == "2027-02-04"
    assert later["npv"] == pytest.approx(at_85["npv"] - at_85["caplets"][0]["pv"], abs=0.02)
    assert at_85["vol_tier"] == "OVERRIDE" and at_85["vol_bp"] == 85
    # with no leg the route makes the ticket's own: the currency's spot date and the tenor in calendar months
    plain = _post(client, auth_a, "/api/price/cap", {k: v for k, v in base.items() if k != "leg"})
    assert (plain["effective_date"], plain["maturity_date"]) == ("2026-11-04", "2031-11-04")
    assert plain["npv"] == as_booked["npv"]


def test_a_strike_left_out_is_struck_at_the_money_and_says_so(client, auth_a, booked):
    base = {k: v for k, v in _ticket(booked["IR_CAP"]).items() if k != "cap_rate"}
    cap = _post(client, auth_a, "/api/price/cap", base)
    assert cap["strike_from"] == "ATM" and cap["cap_rate"] == pytest.approx(cap["atm_forward"], abs=1e-12)
    typed = _post(client, auth_a, "/api/price/cap", {**base, "cap_rate": cap["cap_rate"]})
    assert typed["strike_from"] == "TYPED" and typed["npv"] == cap["npv"]
    # at one strike a cap less a floor is the swap at that strike, and at the money that swap is worth nothing
    floor = _post(client, auth_a, "/api/price/floor", base)
    assert floor["floor_rate"] == cap["cap_rate"]
    assert cap["npv"] - floor["npv"] == pytest.approx(0.0, abs=1.0)
    # a scenario does not strike the option again: the strike stays where the saved curve put it
    moved = _post(client, auth_a, "/api/price/cap", {**base, "curve_flat_bp": 25})
    assert moved["cap_rate"] == cap["cap_rate"] and moved["npv"] > cap["npv"]
    # a collar has no strike to take from the market
    r = client.post("/api/price/collar", json={**base, "cap_rate": 0.045}, headers=auth_a)
    assert r.status_code == 422 and "floor_rate" in r.text


@pytest.mark.parametrize("body,said", [({"side": "HOLD"}, "side"), ({"cap_rate": 4.5}, "cap_rate"), ({"vol_override_bp": 0}, "vol_override_bp"),
                                        ({"vol_override_bp": 6000}, "vol_override_bp")])
def test_terms_that_are_not_terms_are_refused(client, auth_a, booked, body, said):
    r = client.post("/api/price/cap", json={**_ticket(booked["IR_CAP"]), **body}, headers=auth_a)
    assert r.status_code == 422 and said in r.text, (r.status_code, r.text[:200])


def test_a_leg_that_is_not_a_caps_is_refused(client, auth_a, booked):
    base = _ticket(booked["IR_CAP"])
    for leg, said in (({**base["leg"], "leg_type": "FIXED"}, "FLOAT"), ({**base["leg"], "maturity_date": base["leg"]["effective_date"]}, "not after"),
                      ({**base["leg"], "effective_date": "soon"}, "YYYY-MM-DD"), ({**base["leg"], "notional": 0}, "notional"),
                      ({**base["leg"], "effective_date": "2020-01-04", "maturity_date": "2021-01-04"}, "nothing to price")):
        r = client.post("/api/price/cap", json={**base, "leg": leg}, headers=auth_a)
        assert r.status_code == 422 and said in r.text, (said, r.status_code, r.text[:200])


def test_a_booked_cap_between_two_quoted_maturities_is_read_off_the_surface(client, auth_a, booked):
    """Five months on, the cap has about 4.6 years left: no quoted maturity. It was marked at the desk default."""
    base = _ticket(booked["IR_CAP"])
    on_the_day = _post(client, auth_a, "/api/price/cap", base)
    assert on_the_day["vol_tier"] in ("QUOTED", "INTERP")
    surface = _post(client, auth_a, "/api/price/cap", {k: v for k, v in base.items() if k != "leg"})
    assert surface["vol_bp"] == on_the_day["vol_bp"]
    later = client.post("/price", json={"trade_id": booked["IR_CAP"]["id"], "valuation_date": "2027-04-02", "curves": [{"curve_id": "USD_SOFR"}]}, headers=auth_a)
    assert later.status_code == 200, later.text[:300]
    assert later.json()["option_vol_tier"] == "INTERP", later.json()["option_vol_tier"]


def test_the_cap_workbook_runs_what_the_tickets_route_runs(client, auth_a):
    """The cap workbook's engine figure (which its cells reproduce: tests/test_methodology.py) is what the route
    answers for the cap ticket as it opens, at the workbook's vol. Without this the book could agree with itself
    and not with the ticket."""
    from api.routes.methodology import market_for
    from db.session import SessionLocal
    from methodology.replicate import cap_ticket_leg, cap_ticket_price
    from tests.integration.conftest import USER_A
    db = SessionLocal()
    try:
        mkt = market_for(db, USER_A)
    finally:
        db.close()
    npv, strip, strike = cap_ticket_price(mkt)
    leg = {k: v for k, v in cap_ticket_leg(mkt.valuation_date, strike).items() if not k.startswith("_") and k != "embedded_options"}
    body = {"notional": 10_000_000, "side": "BUY", "curve_id": "USD_SOFR", "valuation_date": mkt.valuation_date.isoformat(), "vol_override_bp": 85.0}
    with_leg = _post(client, auth_a, "/api/price/cap", {**body, "leg": leg})
    assert with_leg["npv"] == pytest.approx(npv, abs=0.006) and with_leg["strike_from"] == "ATM"
    assert with_leg["cap_rate"] == pytest.approx(strike, abs=1e-12) and with_leg["n_caplets"] == strip.n_periods
    # and the route's own leg, made from the tenor, is that leg
    plain = _post(client, auth_a, "/api/price/cap", {**body, "tenor_y": 5, "freq_per_year": 4})
    assert plain["npv"] == with_leg["npv"] and plain["effective_date"] == leg["effective_date"] and plain["maturity_date"] == leg["maturity_date"]


def test_a_callers_leg_the_schedule_cannot_make_is_refused_as_terms(client, auth_a, booked):
    """A frequency, a day count or a roll that is none answered 500 from inside the pricer; a maturity centuries on
    made as many caplets as it had quarters."""
    base = _ticket(booked["IR_CAP"])
    for change, said in (({"payment_frequency": "FORTNIGHTLY"}, "payment_frequency"), ({"day_count": "ACT/364"}, "day_count"), ({"bdc": "NEAREST"}, "bdc"),
                         ({"payment_lag": 400}, "payment_lag"), ({"maturity_date": "2999-11-04"}, "more than 60 years")):
        r = client.post("/api/price/cap", json={**base, "leg": {**base["leg"], **change}}, headers=auth_a)
        assert r.status_code == 422 and said in r.text, (change, r.status_code, r.text[:200])
    # the spellings a leg already takes are still taken
    for change in ({"payment_frequency": "semi-annual"}, {"day_count": "act/365f"}, {"bdc": "following"}):
        r = client.post("/api/price/cap", json={**base, "leg": {**base["leg"], **change}}, headers=auth_a)
        assert r.status_code == 200, (change, r.status_code, r.text[:200])


def test_a_collars_answer_carries_each_options_periods(client, auth_a, booked):
    """The collar ticket's CASHFLOWS tab had a table with no rows: the answer carried no periods."""
    for side, sign in (("BUY", 1.0), ("SELL", -1.0)):
        c = _post(client, auth_a, "/api/price/collar", _ticket(booked["IR_COLLAR"], side=side))
        assert len(c["caplets"]) == len(c["floorlets"]) == c["n_caplets"] > 0
        cap, floor = sum(p["pv"] for p in c["caplets"]), sum(p["pv"] for p in c["floorlets"])
        assert cap == pytest.approx(sign * c["cap_npv"], abs=0.11) and floor == pytest.approx(-sign * c["floor_npv"], abs=0.11)     # each period is rounded to the cent
        assert cap + floor == pytest.approx(c["net_npv"], abs=0.21)
        assert c["caplets"][0]["start_date"] == c["effective_date"] and c["floorlets"][-1]["end_date"] == c["maturity_date"]
