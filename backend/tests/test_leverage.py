"""A float leg's participation in the rate (leverage): booked by the ticket, honoured by the pricer and the
exposure engine since 2026-11. leverage 0 is how a cap, floor or collar is booked: a float leg whose only
value is its embedded caplets."""
from datetime import date

import numpy as np
import pytest

from pricing.curve import Curve
from pricing.ir_swap import price_leg, price_swap

VAL = date(2026, 10, 30)


def _flt(**kw):
    return {"leg_type": "FLOAT", "direction": "RECEIVE", "currency": "USD", "notional": 1e7, "effective_date": "2026-11-03",
            "maturity_date": "2029-11-03", "payment_frequency": "QUARTERLY", "day_count": "ACT/360", "bdc": "MOD_FOLLOWING", **kw}


def test_leverage_scales_the_floating_coupons_and_zero_leaves_only_the_spread():
    c = Curve(VAL, flat_rate=0.04)
    plain = price_leg(_flt(), c, c, VAL)
    double = price_leg(_flt(leverage=2.0), c, c, VAL)
    zero = price_leg(_flt(leverage=0.0), c, c, VAL)
    assert double.pv == pytest.approx(2 * plain.pv, rel=1e-12) and zero.pv == 0.0
    with_spread = price_leg(_flt(leverage=0.0, spread=0.001), c, c, VAL)
    assert with_spread.pv == pytest.approx(sum(cf.df * 1e7 * 0.001 * cf.dcf for cf in with_spread.cashflows), rel=1e-12)
    assert price_leg(_flt(leverage=None), c, c, VAL).pv == pytest.approx(plain.pv)          # absent means 1


def test_a_cap_booked_as_a_zero_participation_leg_is_worth_its_caplets_only():
    c = Curve(VAL, flat_rate=0.04)
    leg = _flt(leverage=0.0, embedded_options=[{"type": "CAP", "direction": "BUY", "default_strike": 0.04}])
    r = price_leg(leg, c, c, VAL)
    assert r.pv > 0 and all(cf.cashflow_type == "CAPLET" or cf.amount == 0.0 for cf in r.cashflows)
    assert r.pv == pytest.approx(sum(cf.pv for cf in r.cashflows if cf.cashflow_type == "CAPLET"), rel=1e-12)
    sold = price_leg({**leg, "embedded_options": [{"type": "CAP", "direction": "SELL", "default_strike": 0.04}]}, c, c, VAL)
    assert sold.pv == pytest.approx(-r.pv, rel=1e-12)


def test_exposure_paths_honour_leverage():
    from types import SimpleNamespace
    from ccr import calibration as C
    from ccr.simulate import simulate
    from ccr.valuation import leg_schedule, value_swap
    key = "RATES:USD_SOFR"
    cal = C.Calibration("RISK_NEUTRAL", {key: C.Factor(key, "RATES", a=0.03, sigma=0.008)}, np.eye(1), [key], drift_mode="forward")
    p = simulate(cal, {key: Curve(VAL, flat_rate=0.04)}, {}, {}, VAL, 24, n_paths=200, seed=3)
    def item(lev):
        lg = _flt(leverage=lev)
        return {"kind": "SWAP", "ccy": "USD", "legs": [(lg, leg_schedule(lg, VAL))], "maturity": date(2029, 11, 3), "trade": SimpleNamespace(trade_ref="L")}
    one, two, zero = (value_swap(item(l), p, 6, {"USD": 1.0}) for l in (1.0, 2.0, 0.0))
    assert np.allclose(two, 2 * one) and np.all(zero == 0.0) and float(np.abs(one).mean()) > 0
