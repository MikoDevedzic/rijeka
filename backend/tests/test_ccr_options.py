"""Options on the exposure paths: caplets and swaptions obey parity against the swap they embed or deliver,
a swaption past expiry is the swap on the in-the-money paths and nothing elsewhere, vols come from the market."""
from datetime import date
from types import SimpleNamespace

import numpy as np
import pytest

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
    sold = {**pay, "sign": -1.0, "_exercised": {}}
    assert np.allclose(O.value_swaption(sold, p, 0, fx, swap_at), -vp)             # written: the holder's value, from our side
    assert np.allclose(O.value_swaption(sold, p, i_exp + 3, fx, swap_at), -after)  # exercised against us where the holder was in the money


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
    assert s["sign"] == 1.0 and s2["sign"] == 1.0                                   # long unless the terms say otherwise
    t3 = SimpleNamespace(terms={"expiry_date": "2027-11-01", "strike": 0.04, "is_payer": False, "side": "SELL"}, trade_date=None)
    s3 = O.swaption_terms(t3, legs, ASOF)
    assert s3 == {"expiry": date(2027, 11, 1), "K": 0.04, "is_payer": False, "sign": -1.0}


def test_the_vol_a_swaption_reads_says_where_it_came_from():
    """0.57.0: one lookup for the ticket's default, the booked option's revaluation and the exposure run's reported
    vol. On a grid point it is QUOTED; off it, the NEAREST point in log expiry plus log tenor, named; with no
    surface for the currency, the desk DEFAULT. The grid's edges are flat: a three-month expiry reads the one-year
    row and a ten-year expiry the last one."""
    from datetime import date

    class M:
        def quotes(self, cid):
            return [{"tenor": "1Yx5Y", "rate": 80.0}, {"tenor": "5Yx5Y", "rate": 95.0}, {"tenor": "7Yx9Y", "rate": 70.0}] if cid == "USD_SWVOL_ATM" else None

        def snapshot_date(self, cid):
            return date(2026, 11, 18)
    on = O.swaption_vol_point(M(), "USD", 1.0, 5.0)
    assert on == {"vol_bp": 80.0, "tier": "QUOTED", "point": "1Yx5Y", "asof": "2026-11-18", "source": "USD_SWVOL_ATM nearest point"}
    # a year by the calendar is the one-year point whatever the trade date: 365 days, 366 across a 29 February, 367 or
    # 368 after a weekend's roll; five years is 1,826 or 1,827 days; a swap of five years is 1,826 / 365.25 as the P&L asks
    for days in (364, 365, 366, 367, 368):
        assert O.swaption_vol_point(M(), "USD", days / 365, 5.0)["tier"] == "QUOTED", days
    assert O.swaption_vol_point(M(), "USD", 1826 / 365, 1826 / 365.25)["tier"] == "QUOTED"
    assert O.swaption_vol_point(M(), "USD", 11 / 12, 5.0)["tier"] == "NEAREST"                     # a month short is not on it
    near = O.swaption_vol_point(M(), "USD", 92 / 365, 5.0)                                         # three months: below the grid
    assert (near["vol_bp"], near["tier"], near["point"]) == (80.0, "NEAREST", "1Yx5Y")
    far = O.swaption_vol_point(M(), "USD", 10.0, 10.0)                                             # beyond it
    assert (far["vol_bp"], far["tier"], far["point"]) == (70.0, "NEAREST", "7Yx9Y")
    none = O.swaption_vol_point(M(), "EUR", 1.0, 5.0)
    assert none == {"vol_bp": O.DEFAULT_VOL_BP, "tier": "DEFAULT", "point": None, "asof": None, "source": "desk default (no ATM swaption surface)"}
    assert O.swaption_vol_point(None, "USD", 1.0, 5.0)["tier"] == "DEFAULT"
    # the pair the engines already read is the same answer
    assert O.swaption_vol_bp(M(), "USD", 2.0, 5.0) == (80.0, "USD_SWVOL_ATM nearest point")



# ── a cap, a floor and a collar on the paths (0.60.0) ────────────────────────────────────────────────────────────

def _rn_paths(months=40, n=20000, seed=3):
    f = {"RATES:USD_SOFR": C.Factor("RATES:USD_SOFR", "RATES", a=0.03, sigma=0.008)}
    calib = C.Calibration("RISK_NEUTRAL", f, np.eye(1), list(f), drift_mode="forward")
    return simulate(calib, {"RATES:USD_SOFR": Curve(valuation_date=ASOF, flat_rate=0.0375)}, {}, {}, ASOF, months, n_paths=n, seed=seed)


def _cap_trade(kind="IR_CAP", options=None, ref="CAP-1"):
    from types import SimpleNamespace
    eff = date(2026, 11, 2)
    leg = {"leg_ref": "OPT-1", "leg_type": "FLOAT", "direction": "RECEIVE", "currency": "USD", "notional": 10e6, "effective_date": str(eff),
           "maturity_date": str(eff.replace(year=eff.year + 3)), "payment_frequency": "QUARTERLY", "day_count": "ACT/360", "bdc": "MOD_FOLLOWING",
           "payment_lag": 2, "leverage": 0.0, "spread": 0.0, "embedded_options": options or [{"type": "CAP", "direction": "BUY", "default_strike": 0.04}]}
    return SimpleNamespace(instrument_type=kind, trade_ref=ref, notional=10e6, notional_ccy="USD", effective_date=eff,
                           maturity_date=eff.replace(year=eff.year + 3), terms={}, _legs=[leg])


class _NoDb:
    def execute(self, *a, **k):
        raise RuntimeError("no database in a unit test")

    def rollback(self):
        pass


def _set(*trades):
    from ccr.valuation import NettingSet
    return NettingSet(_NoDb(), {"sub": "u"}, list(trades), ASOF, mkt=None)


def test_the_variance_of_a_periods_growth_is_the_one_the_paths_show():
    """The closed form the caplet is valued with, against the paths themselves: the sample variance of the logarithm
    of what a unit grows to over a period, seen from today and from a grid date on the way."""
    from ccr.simulate import growth
    p = _rn_paths()
    key = "RATES:USD_SOFR"
    for (a_t, b_t) in ((1.0, 1.25), (0.52, 0.77), (2.5, 2.75), (0.3, 0.3 + 1 / 12)):
        sample = float(np.log(growth(p, key, a_t, b_t)).var())
        assert O.growth_variance(p, key, 0, a_t, b_t) == pytest.approx(sample, rel=0.04), (a_t, b_t)
    # seen from a later date the part already known is gone: less variance, and none once the period's last grid date has come
    assert O.growth_variance(p, key, 6, 1.0, 1.25) < O.growth_variance(p, key, 0, 1.0, 1.25)
    last = int(np.searchsorted(p.t, 1.25 - 1e-9))
    assert O.growth_variance(p, key, last, max(1.0, float(p.t[last])), 1.25) == 0.0


def test_a_cap_is_taken_by_the_credit_engine_and_its_discounted_value_is_a_martingale():
    from ccr.simulate import account, growth
    from ccr.valuation import flows_per_step, netted_paths
    ns = _set(_cap_trade())
    assert len(ns.items) == 1 and not ns.skipped and ns.items[0]["kind"] == "SWAP" and len(ns.items[0]["caplets"]) == 1
    assert [(o["kind"], o["side"], o["strike"]) for o in ns.options] == [("CAP", "LONG", 0.04)]
    p = _rn_paths()
    fx = {"USD": 1.0}
    V, today = netted_paths(ns, p, fx, {})
    v0 = float(V[:, 0].mean())
    assert v0 > 0 and float(V.min()) >= -1e-6                         # a bought cap is never a liability
    # what has been paid by a date, discounted on the path, plus the discounted value then, averages to today's value
    key = "RATES:USD_SOFR"
    A = account(p, key)
    it = ns.items[0]
    yrs = lambda d: (d - ASOF).days / 365.25
    for i in (6, 15, 24, 33, 39):
        paid = np.zeros(p.n_paths)
        for (ps, pe, pay, tau) in it["caplets"][0]["periods"]:
            if yrs(pay) <= float(p.t[i]) + 1e-9:
                paid += 10e6 * np.maximum(growth(p, key, yrs(ps), yrs(pe)) - 1.0 - tau * 0.04, 0.0) / growth(p, key, 0.0, yrs(pay))
        x = V[:, i] / A[:, i] + paid
        assert abs(x.mean() - v0) < 4.0 * x.std() / np.sqrt(len(x)), (i, x.mean(), v0)
    assert np.all(V[:, -1] == 0.0)                                    # everything has paid by the last grid date
    # its payments are in the flows a margined run reads: paid to us, so negative, and in total what the paths paid
    fl = flows_per_step(ns, p, fx)
    assert float(fl.max()) <= 0.0 and float(fl.sum()) < 0.0
    total = sum(10e6 * np.maximum(growth(p, key, yrs(ps), yrs(pe)) - 1.0 - tau * 0.04, 0.0) for (ps, pe, pay, tau) in it["caplets"][0]["periods"])
    assert -fl.sum(axis=1) == pytest.approx(total, rel=1e-12, abs=1e-6)


def test_a_sold_cap_mirrors_a_bought_one_and_a_collar_is_its_cap_less_its_floor_on_every_path():
    from ccr.valuation import flows_per_step, netted_paths
    p = _rn_paths(n=3000)
    fx = {"USD": 1.0}
    cap = [{"type": "CAP", "direction": "BUY", "default_strike": 0.045}]
    floor = [{"type": "FLOOR", "direction": "BUY", "default_strike": 0.03}]
    V = lambda t: netted_paths(_set(t), p, fx, {})[0]
    F = lambda t: flows_per_step(_set(t), p, fx)
    bought, held_floor = _cap_trade("IR_CAP", cap), _cap_trade("IR_FLOOR", floor)
    sold = _cap_trade("IR_CAP", [{**cap[0], "direction": "SELL"}])
    collar = _cap_trade("IR_COLLAR", [cap[0], {**floor[0], "direction": "SELL"}])
    assert V(sold) == pytest.approx(-V(bought), abs=1e-9) and F(sold) == pytest.approx(-F(bought), abs=1e-9)
    assert V(collar) == pytest.approx(V(bought) - V(held_floor), abs=1e-6) and F(collar) == pytest.approx(F(bought) - F(held_floor), abs=1e-6)
    assert float(V(held_floor)[:, 0].mean()) > 0
    # at one strike a cap less a floor is the swap's floating coupons less the strike's, on every path and date
    k = [{"type": "CAP", "direction": "BUY", "default_strike": 0.0375}, {"type": "FLOOR", "direction": "SELL", "default_strike": 0.0375}]
    parity = V(_cap_trade("IR_COLLAR", k))
    from types import SimpleNamespace
    leg = _cap_trade()._legs[0]
    swap = SimpleNamespace(instrument_type="IR_SWAP", trade_ref="S", notional=10e6, notional_ccy="USD", effective_date=None, maturity_date=None, terms={},
                           _legs=[{**leg, "leverage": 1.0, "embedded_options": []},
                                  {**leg, "leg_type": "FIXED", "direction": "PAY", "fixed_rate": 0.0375, "embedded_options": []}])
    assert parity == pytest.approx(V(swap), abs=10e6 * 1e-9)


def test_the_models_vol_for_a_cap_is_one_number_the_tickets_pricer_would_take():
    p = _rn_paths(n=10)
    ns = _set(_cap_trade())
    c = ns.items[0]["caplets"][0]
    vol = O.model_cap_vol_bp(c, p, "USD")
    assert 60.0 < vol < 85.0                                            # a short rate of 80bp a year, mean-reverting at 3 %
    # that vol through the ticket's formula is the model's value today
    from ccr.valuation import netted_paths
    v0 = float(netted_paths(ns, p, {"USD": 1.0}, {})[0][:, 0].mean())
    p0 = p.p0["RATES:USD_SOFR"]
    yrs = lambda d: (d - ASOF).days / 365.25
    strip = 0.0
    for (ps, pe, pay, tau) in c["periods"]:
        F = (p0(yrs(ps)) / p0(yrs(pe)) - 1.0) / tau
        T = ((ps - ASOF).days + 0.5 * (pe - ps).days) / 365.0
        strip += 10e6 * tau * p0(yrs(pay)) * float(O.bachelier(np.array([F]), 0.04, T, vol / 1e4, True)[0])
    assert strip == pytest.approx(v0, rel=1e-6)
