"""CRYBASIS01 (owner, 9 Nov 2026): the digital-asset forward's third sensitivity beside CRY01 and IR01, the change in
value for +1 bp a year on the forward basis (forward over spot, annualised) with spot and the USD curve unchanged; a
long forward is positive. +1 bp of basis is −1 bp of the funding rate at a fixed USD rate, so it is −FUND01, which
stays beside it everywhere: the ticket's forward and option, the booked valuation, the P&L valuation, the ladder.
The dates a quote carries beside its figures: settlement_business_day and date_notes."""
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from pricing.curve import Curve
from tests.test_crypto_option import EXP, SET, _client, _market, _mock_db, _trade
from tests.test_fx_option import VAL

SETTLE = date(2027, 5, 10)              # a Monday
SUNDAY = date(2027, 5, 9)


def _priced(c, currencies, body, route="/api/currency/forward/price"):
    with patch.object(currencies, "_curve", side_effect=lambda db, uid, cid, vd: Curve(VAL, flat_rate=0.04)):
        r = c.post(route, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_forward_crybasis01_is_minus_fund01_positive_long_negative_short():
    import main
    c, currencies = _client(_mock_db())
    fwd = {"pair": "BTCUSD", "shape": "NDF", "base_notional": 10, "settlement_date": SETTLE.isoformat(), "valuation_date": VAL.isoformat()}
    try:
        long, short = _priced(c, currencies, {**fwd, "direction": "BUY"}), _priced(c, currencies, {**fwd, "direction": "SELL"})
        # +1 bp of basis at a fixed USD rate is the funding rate 1 bp lower: the bump-and-reprice agrees to its convexity
        base = _priced(c, currencies, {**fwd, "direction": "BUY", "base_rate_pct": 3.0, "forward_rate": 66000.0})
        down = _priced(c, currencies, {**fwd, "direction": "BUY", "base_rate_pct": 3.0 - 0.01, "forward_rate": 66000.0})
    finally:
        main.app.dependency_overrides.clear()
    assert long["fund01"] < 0 < long["crybasis01"] and long["crybasis01"] == pytest.approx(-long["fund01"])
    assert short["crybasis01"] < 0 and short["crybasis01"] == pytest.approx(-short["fund01"]) == pytest.approx(-long["crybasis01"])
    assert long["ir01"] == pytest.approx(long["ir01_disc"])                      # IR01 stays the discounting sensitivity alone
    assert down["npv"] - base["npv"] == pytest.approx(base["crybasis01"], rel=2e-4)   # second order: (1 bp · T)² of N·F·DF
    assert abs(base["crybasis01"]) > 1.0
    assert long["settlement_business_day"] is True and long["date_notes"] == []


def test_fx_pair_has_no_crybasis01_and_a_closed_settlement_day_is_noted():
    import main
    rows = _mock_db()
    c, currencies = _client(rows)
    try:
        with patch.object(currencies, "pair_state", side_effect=lambda db, uid, pair, settlement=True: {
                "pair": pair, "base": "EUR", "quote": "USD", "crypto": False, "spot": 1.08, "spot_as_of": VAL.isoformat(), "quote_curve": "USD_SOFR",
                "pip": 1e-4, "base_curve": "EUR_ESTR", "base_curve_available": False, "base_flat_pct": 2.0, "forward_points": None, "forward_curve": None}):
            ok = _priced(c, currencies, {"pair": "EURUSD", "shape": "FORWARD", "base_notional": 1e6, "direction": "BUY",
                                         "settlement_date": date(2027, 2, 12).isoformat(), "valuation_date": VAL.isoformat()})
            xmas = _priced(c, currencies, {"pair": "EURUSD", "shape": "FORWARD", "base_notional": 1e6, "direction": "BUY",
                                           "settlement_date": date(2026, 12, 25).isoformat(), "valuation_date": VAL.isoformat()})
        sun = _priced(c, currencies, {"pair": "BTCUSD", "shape": "NDF", "base_notional": 10, "direction": "BUY",
                                      "settlement_date": SUNDAY.isoformat(), "valuation_date": VAL.isoformat()})
    finally:
        main.app.dependency_overrides.clear()
    assert ok["fund01"] is None and ok["crybasis01"] is None and ok["settlement_business_day"] is True and ok["date_notes"] == []
    assert xmas["settlement_business_day"] is False
    assert xmas["date_notes"] == ["settlement Fri 25 Dec 2026 is a New York and TARGET holiday (Christmas Day); the market would settle on Mon 28 Dec 2026"]
    assert sun["settlement_business_day"] is False and sun["date_notes"] == ["settlement Sun 9 May 2027 is a Sunday; the market would settle on Mon 10 May 2027"]
    assert sun["npv"] is not None and sun["crybasis01"] == pytest.approx(-sun["fund01"])      # a note, not a refusal


def test_option_crybasis01_is_minus_fund01_and_its_dates_are_noted():
    import main
    c, currencies = _client(_mock_db())
    opt = {"pair": "BTCUSD", "option_type": "CALL", "base_notional": 10, "expiry_date": EXP.isoformat(), "valuation_date": VAL.isoformat()}
    try:
        buy = _priced(c, currencies, {**opt, "direction": "BUY"}, "/api/currency/option/price")
        sell = _priced(c, currencies, {**opt, "direction": "SELL"}, "/api/currency/option/price")
        sat = _priced(c, currencies, {**opt, "direction": "BUY", "settlement_date": SET.isoformat()}, "/api/currency/option/price")
    finally:
        main.app.dependency_overrides.clear()
    for b in (buy, sell):
        assert b["crybasis01"] == pytest.approx(-b["fund01"]) and b["fund01"] == pytest.approx(b["ir01_base"])
    assert buy["crybasis01"] > 0 > sell["crybasis01"]                      # a bought call gains when the forward rises
    # the default settlement is the first New York business day after the Friday expiry, Monday 1 Feb 2027; a typed
    # Saturday is said, not refused
    assert buy["settlement_date"] == "2027-02-01" and buy["settlement_business_day"] is True and buy["date_notes"] == []
    assert sat["settlement_date"] == SET.isoformat() and sat["settlement_business_day"] is False
    assert sat["date_notes"] == ["settlement Sat 30 Jan 2027 is a Saturday; the market would settle on Mon 1 Feb 2027"]


def test_pnl_valuation_and_ladder_carry_crybasis01_beside_fund01():
    from pnl.explain import Valuer
    from pnl.valuation import value
    from risk.sensitivities import trade_ladder
    fwd = SimpleNamespace(id="CRF1", trade_ref="TRD-CRF", instrument_type="CRYPTO_FORWARD", status="CONFIRMED", notional=10, notional_ccy="BTC",
                          discount_curve_id="USD_SOFR", forecast_curve_id=None, trade_date=VAL, effective_date=VAL, maturity_date=SET, counterparty_id=None,
                          user_id="u", desk="DIGITAL", book="CRYPTO", asset_class="CRYPTO", structure=None, uti="Y" * 52,
                          terms={"digital_asset": "BTC", "notional_amount": 10, "forward_price": 65000.0, "settlement_date": SET.isoformat(), "direction": "BUY"})
    with patch("api.routes.pricer._build_curve", side_effect=lambda ci, vd, db, uid: Curve(VAL, flat_rate=0.04)):
        v = value(None, {"sub": "u"}, fwd, VAL, _market())
        o = value(None, {"sub": "u"}, _trade(), VAL, _market())
        row = trade_ladder(None, {"sub": "u"}, fwd, VAL, _market(), Valuer(None, {"sub": "u"}))
    assert v["fund01"] < 0 < v["crybasis01"] and v["crybasis01"] == pytest.approx(-v["fund01"])
    assert o["crybasis01"] == pytest.approx(-o["fund01"])
    assert row["fund01"]["BTC_FUNDING"]["FLAT"] < 0 and row["crybasis01"]["BTC_FUNDING"]["FLAT"] == pytest.approx(-row["fund01"]["BTC_FUNDING"]["FLAT"])
    assert row["crybasis01_total"] == pytest.approx(-row["fund01_total"]) and row["crybasis01_total"] > 0
    assert row["fund01"] == {"BTC_FUNDING": {"FLAT": row["fund01"]["BTC_FUNDING"]["FLAT"]}}          # the FUND01 rows themselves are unchanged


def test_fixed_view_carries_crybasis01():
    """From the fixing date the booked view is one cash amount: FUND01 and CRYBASIS01 are both zero, and both present."""
    from api.routes import currencies
    from pnl.market import Market
    fwd = SimpleNamespace(id="CRF2", trade_ref="TRD-CRF2", instrument_type="CRYPTO_FORWARD", status="CONFIRMED", notional=10, notional_ccy="BTC",
                          discount_curve_id="USD_SOFR", forecast_curve_id=None, trade_date=VAL, effective_date=VAL, maturity_date=SET, counterparty_id=None,
                          user_id="u", desk="DIGITAL", book="CRYPTO", asset_class="CRYPTO", structure=None, uti="Z" * 52,
                          terms={"digital_asset": "BTC", "notional_amount": 10, "forward_price": 65000.0, "settlement_date": SET.isoformat(), "direction": "BUY",
                                 "valuation_date": EXP.isoformat(), "settlement_price_source": "CME CF BRR"})
    fix = {"fixing_date": EXP, "source": "CME CF BRR", "fixing": {"value": 70000.0}, "settlement_amount": 50000.0, "settlement_price": 70000.0,
           "provisional": False, "provisional_reason": None, "provisional_basis": None}
    mkt = _market(as_of=EXP)
    with patch("api.routes.pricer._build_curve", side_effect=lambda ci, vd, db, uid: Curve(EXP, flat_rate=0.04)), \
         patch("settlement.rule.settlement", return_value=fix), patch.object(Market, "__init__", lambda self, *a, **k: None):
        out = currencies._booked_fixed(fwd, None, {"sub": "u"}, EXP, mkt, fix)
    assert out["state"] == "FIXED" and "fund01" in out and "crybasis01" in out
    assert out["crybasis01"] == pytest.approx(-out["fund01"]) and str(out["crybasis01"]) != "-0.0"


def test_a_digital_asset_forward_without_a_date_settles_on_the_next_new_york_business_day_and_says_so():
    """A digital asset's spot settles at once (T+0), so a forward quote without a settlement date (an outside caller's
    script; the ticket always sends one) is still priced: on the first New York business day strictly after today,
    and date_notes says the date was defaulted. VAL is Friday 30 Oct 2026: the Monday; a Monday defaults to its Tuesday."""
    import main
    c, currencies = _client(_mock_db())
    try:
        q = _priced(c, currencies, {"pair": "BTCUSD", "shape": "FORWARD", "base_notional": 1, "direction": "BUY",
                                    "settlement_date": (SUNDAY + timedelta(days=1)).isoformat(), "valuation_date": VAL.isoformat()})
        none = _priced(c, currencies, {"pair": "BTCUSD", "shape": "FORWARD", "base_notional": 1, "direction": "BUY", "valuation_date": VAL.isoformat()})
        spot = _priced(c, currencies, {"pair": "BTCUSD", "shape": "SPOT", "base_notional": 1, "direction": "BUY", "valuation_date": VAL.isoformat()})
        mon = _priced(c, currencies, {"pair": "BTCUSD", "shape": "NDF", "base_notional": 1, "direction": "BUY", "valuation_date": date(2026, 11, 2).isoformat()})
    finally:
        main.app.dependency_overrides.clear()
    assert q["settlement_business_day"] is True and q["date_notes"] == []
    assert none["settlement_date"] == "2026-11-02" and none["date_notes"] == ["settlement date defaulted to 2026-11-02"] and none["settlement_business_day"] is True
    assert spot["settlement_date"] == "2026-11-02" and none["npv"] is not None and none["crybasis01"] == pytest.approx(-none["fund01"])
    assert mon["settlement_date"] == "2026-11-03" and mon["date_notes"] == ["settlement date defaulted to 2026-11-03"]


def test_strike_dp_books_the_rounded_fair_forward_in_one_request():
    """The ticket books a strike rounded to the pair's decimals: with strike_dp the API rounds the fair forward
    itself and prices that strike, so one request gives the premium of the strike booked. `forward` stays unrounded."""
    import main
    c, currencies = _client(_mock_db())
    fwd = {"pair": "BTCUSD", "shape": "NDF", "base_notional": 10, "direction": "BUY", "settlement_date": SETTLE.isoformat(), "valuation_date": VAL.isoformat()}
    try:
        fair = _priced(c, currencies, fwd)
        dp2 = _priced(c, currencies, {**fwd, "strike_dp": 2})
        given = _priced(c, currencies, {**fwd, "strike_dp": 2, "forward_rate": 70000.0})
        with patch.object(currencies, "pair_state", side_effect=lambda db, uid, pair, settlement=True: {
                "pair": pair, "base": "EUR", "quote": "USD", "crypto": False, "spot": 1.08123456, "spot_as_of": VAL.isoformat(), "quote_curve": "USD_SOFR",
                "pip": 1e-4, "base_curve": "EUR_ESTR", "base_curve_available": False, "base_flat_pct": 2.0, "forward_points": None, "forward_curve": None}):
            body = {"pair": "EURUSD", "option_type": "CALL", "base_notional": 1e6, "direction": "BUY", "expiry_date": date(2027, 2, 10).isoformat(),
                    "valuation_date": VAL.isoformat(), "vol_pct": 8.0}
            atm = _priced(c, currencies, body, "/api/currency/option/price")
            dp5 = _priced(c, currencies, {**body, "strike_dp": 5}, "/api/currency/option/price")
        bad = c.post("/api/currency/forward/price", json={**fwd, "strike_dp": 9})
    finally:
        main.app.dependency_overrides.clear()
    assert fair["forward_rate"] == fair["forward"] and fair["npv"] == pytest.approx(0.0, abs=1e-9)
    assert dp2["forward"] == fair["forward"] and dp2["forward_rate"] == round(fair["forward"], 2) != fair["forward"]
    assert 0 < abs(dp2["npv"]) < 0.1 and dp2["npv"] == pytest.approx(10 * (dp2["forward"] - dp2["forward_rate"]) * dp2["df_quote"], rel=1e-9)
    assert given["forward_rate"] == 70000.0                                                 # a given rate is never rounded
    assert atm["strike"] == atm["forward"] and dp5["forward"] == atm["forward"] and dp5["strike"] == round(atm["forward"], 5) != atm["forward"]
    assert dp5["quote_notional"] == pytest.approx(1e6 * dp5["strike"]) and dp5["npv"] != atm["npv"] and abs(dp5["npv"] - atm["npv"]) < abs(atm["npv"]) * 1e-3
    assert bad.status_code == 422


def test_the_quote_carries_the_pillars_of_the_curves_it_was_priced_on():
    """The scenario tab draws the discounting curve and shocks it point by point: a forward's and an option's answer
    carry the curve's own pillars (date, years, zero rate, discount factor), consistent with one another."""
    import math
    import main
    c, currencies = _client(_mock_db())
    fwd = {"pair": "BTCUSD", "shape": "NDF", "base_notional": 10, "settlement_date": SETTLE.isoformat(), "valuation_date": VAL.isoformat(), "direction": "BUY"}
    try:
        q = _priced(c, currencies, fwd)
    finally:
        main.app.dependency_overrides.clear()
    quote = q["curves"]["quote"]
    assert quote["id"] == q["quote_curve"] and len(quote["pillars"]) >= 1
    assert q["curves"]["base"] is None                       # a digital asset carries at a rate, not on a curve
    for p in quote["pillars"]:
        assert p["t"] > 0 and 0 < p["df"] < 1
        assert math.exp(-p["zero_pct"] / 100 * p["t"]) == pytest.approx(p["df"], rel=1e-6)
        assert p["zero_pct"] == pytest.approx(4.0, abs=0.05)  # the fixture's flat 4 %
    assert [p["t"] for p in quote["pillars"]] == sorted(p["t"] for p in quote["pillars"])
