"""Options on the exposure paths: caplets and swaptions obey parity against the swap they embed or deliver,
a swaption past expiry is the swap on the in-the-money paths and nothing elsewhere, vols come from the market."""
from datetime import date
from types import SimpleNamespace

import numpy as np

from ccr import calibration as C
from ccr import options as O
from ccr.simulate import bond, simulate
from ccr.valuation import leg_schedule, value_swap
from pricing.curve import Curve

ASOF = date(2026, 10, 29)


def _paths(months=60, n=1500, seed=5):
    f = {"RATES:USD_SOFR": C.Factor("RATES:USD_SOFR", "RATES", a=0.05, sigma=0.008)}
    calib = C.Calibration("REAL_WORLD", f, np.eye(1), list(f), drift_mode="zero")
    return simulate(calib, {"RATES:USD_SOFR": Curve(valuation_date=ASOF, flat_rate=0.04)}, {}, {}, ASOF, months, n_paths=n, seed=seed)


def _float_leg(notional=10e6, years_=3, **extra):
    eff, mat = ASOF, ASOF.replace(year=ASOF.year + years_)
    lg = {"leg_type": "FLOAT", "direction": "PAY", "notional": notional, "payment_frequency": "QUARTERLY", "day_count": "ACT/360",
          "effective_date": str(eff), "maturity_date": str(mat), "currency": "USD", **extra}
    return lg, leg_schedule(lg, ASOF)


def test_cap_minus_floor_is_the_forward_swaplet_strip_today():
    p = _paths()
    lg, sched = _float_leg(embedded_options=[{"type": "CAP", "direction": "BUY", "default_strike": 0.04}, {"type": "FLOOR", "direction": "SELL", "default_strike": 0.04}])
    item = {"kind": "SWAP", "ccy": "USD", "legs": [(lg, sched)], "maturity": sched[-1][1], "caplets": O.caplets_of(lg, sched, 1.0, 80.0, "test")}
    v = O.value_caplets(item, p, 0, {"USD": 1.0})
    # long cap − short floor at the same strike = Σ N·τ·P(0,pay)·(f − K): the paths agree with today's curve at i = 0
    key = "RATES:USD_SOFR"
    exp = 0.0
    for (ps, pe, pay, tau) in sched:
        Ts, Te, Tp = (ps - ASOF).days / 365.25, (pe - ASOF).days / 365.25, (pay - ASOF).days / 365.25
        f = (bond(p, key, 0, Ts) / bond(p, key, 0, Te) - 1.0) / tau
        exp += 10e6 * tau * float(bond(p, key, 0, Tp)[0]) * (float(f[0]) - 0.04)
    assert abs(float(v.mean()) - exp) < 1e-6 * 10e6
    assert len(item["caplets"]) == 2 and item["caplets"][0]["sign"] == 1.0 and item["caplets"][1]["sign"] == -1.0


def test_caplet_value_is_positive_before_fixing_and_settles_after():
    p = _paths()
    lg, sched = _float_leg(cap_rate=0.045)                       # legacy column, on a leg we pay: long the cap
    item = {"kind": "SWAP", "ccy": "USD", "legs": [(lg, sched)], "maturity": sched[-1][1], "caplets": O.caplets_of(lg, sched, 1.0, 80.0, "test")}
    v0 = O.value_caplets(item, p, 0, {"USD": 1.0})
    assert float(v0.mean()) > 0 and float(v0.min()) >= 0           # a bought cap is worth something and never negative
    last = O.value_caplets(item, p, len(p.grid) - 1, {"USD": 1.0})
    assert np.all(last == 0.0)                                      # everything has paid by the final grid point


def _swaption(is_payer=True, K=0.04, expiry_years=2, tenor=5, N=25e6, vol_bp=80.0):
    expiry = ASOF.replace(year=ASOF.year + expiry_years); mat = expiry.replace(year=expiry.year + tenor)
    fixed = {"leg_type": "FIXED", "direction": "PAY" if is_payer else "RECEIVE", "notional": N, "fixed_rate": K, "payment_frequency": "ANNUAL",
             "day_count": "ACT/360", "effective_date": str(expiry), "maturity_date": str(mat), "currency": "USD"}
    flt = {"leg_type": "FLOAT", "direction": "RECEIVE" if is_payer else "PAY", "notional": N, "payment_frequency": "QUARTERLY", "day_count": "ACT/360",
           "effective_date": str(expiry), "maturity_date": str(mat), "currency": "USD"}
    scheds = [(fixed, leg_schedule(fixed, ASOF)), (flt, leg_schedule(flt, ASOF))]
    return {"trade": SimpleNamespace(trade_ref="S"), "kind": "SWAPTION", "ccy": "USD", "legs": scheds, "fixed_sched": scheds[0][1], "start": expiry,
            "maturity": mat, "expiry": expiry, "K": K, "is_payer": is_payer, "N": N, "vol": vol_bp / 1e4}


def test_payer_minus_receiver_equals_the_forward_swap_and_exercise_follows_moneyness():
    p = _paths(months=96, n=1200, seed=7)
    fx = {"USD": 1.0}
    swap_at = lambda item, paths, j: value_swap(item, paths, j, fx)
    pay, rec = _swaption(True), _swaption(False)
    vp, vr = O.value_swaption(pay, p, 0, fx, swap_at), O.value_swaption(rec, p, 0, fx, swap_at)
    fwd = value_swap(pay, p, 0, fx)                                 # the underlying payer swap, forward starting, struck at K
    assert float(vp.mean()) > 0 and float(vr.mean()) > 0
    assert abs(float((vp - vr - fwd).mean())) < 2e-3 * 25e6          # put-call parity on the annuity (schedule rounding only)
    i_exp = min(j for j in range(len(p.t)) if float(p.t[j]) >= (pay["expiry"] - ASOF).days / 365.25 - 1e-9)
    after = O.value_swaption(pay, p, i_exp + 3, fx, swap_at)
    itm = swap_at(pay, p, i_exp) > 0
    assert np.all(after[~itm] == 0.0) and np.all(after[itm] == swap_at(pay, p, i_exp + 3)[itm])
    assert 0.2 < itm.mean() < 0.8                                   # struck near the money, roughly half the paths exercise


def test_vol_lookups_fall_back_and_read_the_grid():
    class M:
        def quotes(self, cid):
            return [{"tenor": "1Yx5Y", "rate": 80.0}, {"tenor": "5Yx5Y", "rate": 95.0}, {"tenor": "2Yx10Y", "rate": 70.0}] if cid == "USD_SWVOL_ATM" else None
    assert O.swaption_vol_bp(M(), "USD", 2.0, 5.0)[0] == 80.0        # nearest in log distance to 1Yx5Y / 5Yx5Y: 2Y is closer to 1Y
    assert O.swaption_vol_bp(M(), "USD", 2.0, 9.0)[0] == 70.0
    assert O.swaption_vol_bp(M(), "EUR", 2.0, 5.0) == (O.DEFAULT_VOL_BP, "desk default (no ATM swaption surface)")
    assert O.swaption_vol_bp(None, "USD", 1.0, 1.0)[0] == O.DEFAULT_VOL_BP


def test_swaption_terms_from_trade_and_legs():
    legs = [{"leg_type": "FIXED", "direction": "RECEIVE", "fixed_rate": 0.0375, "effective_date": "2027-10-29"}]
    t = SimpleNamespace(terms={"expiry_y": 1.0, "strike": 3.9, "is_payer": True}, trade_date=date(2026, 10, 29))
    s = O.swaption_terms(t, legs, ASOF)
    assert s["expiry"] == date(2027, 10, 29) and abs(s["K"] - 0.039) < 1e-12 and s["is_payer"] is True
    t2 = SimpleNamespace(terms={}, trade_date=None)
    s2 = O.swaption_terms(t2, legs, ASOF)
    assert s2["expiry"] == date(2027, 10, 29) and s2["K"] == 0.0375 and s2["is_payer"] is False
