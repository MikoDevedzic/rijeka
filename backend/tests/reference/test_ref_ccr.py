"""Counterparty exposure simulation against closed forms and QuantLib's Hull-White.

The exposure engine (ccr/simulate.py) runs Hull-White one-factor paths fitted to today's curve and
values trades on them with ccr/valuation.py and ccr/options.py. In the risk-neutral run three things
must hold, each checked here on 40,000 paths against Monte Carlo standard errors:

1. Martingale: E[D(t)·P(t,T)] = P(0,T) for bonds priced on the paths. D(t) is the bank account,
   integrated from the simulated short rate by the trapezoid rule on the monthly grid (that
   discretisation alone is worth −1 to −3bp of a discount factor and is netted out using E[D(t)]).
   Before 2026-11 the path bond formula used the driftless deviation instead of r − f(0,t): bonds came
   out high by exp(B·φ(t)), +20bp of price at (5y, 10y), and this check failed by 4.5 standard errors.
2. A European swaption, valued at expiry by the production path functions (physical settlement into
   the underlying swap where it is in the money), discounted and averaged, equals QuantLib's
   JamshidianSwaptionEngine price for the same (a, σ).
3. A caplet, fixed on the path at its fixing date and paid at the period end, equals QuantLib's
   HullWhite.discountBondOption price of the equivalent zero-bond put.

And one consistency fact is reported, not asserted: before expiry the engine values a swaption with
Bachelier at today's market vol on each path's forward, at expiry it exercises on the Hull-White paths,
whose own implied vol comes from (a, σ). Where those vols differ, expected exposure jumps at expiry."""
from __future__ import annotations

import math
from datetime import date
from types import SimpleNamespace

import numpy as np
import QuantLib as ql

from ccr import calibration as C
from ccr.options import value_caplets, value_swaption
from ccr.simulate import add_months, bond, simulate
from ccr.valuation import leg_schedule, value_swap
from tests.reference.refmarket import VAL, Row, assert_rows, null_index, qd, replica_handle, rijeka_curve, set_eval

KEY = "RATES:USD_SOFR"
A, SIGMA = 0.03, 0.0085
N = 10_000_000.0
FX = {"USD": 1.0}
PATHS = 40_000


def _paths(months=72, seed=11):
    set_eval(VAL)
    f = {KEY: C.Factor(KEY, "RATES", a=A, sigma=SIGMA)}
    cal = C.Calibration("RISK_NEUTRAL", f, np.eye(1), [KEY], drift_mode="forward")
    return simulate(cal, {KEY: rijeka_curve()}, {}, {}, VAL, months, n_paths=PATHS, seed=seed)


def _bank(p) -> np.ndarray:
    r = p.r[KEY]
    dts = np.diff(p.t)
    integ = np.concatenate([np.zeros((r.shape[0], 1)), np.cumsum(0.5 * (r[:, 1:] + r[:, :-1]) * dts[None, :], axis=1)], axis=1)
    return np.exp(-integ)


def martingale_rows(p=None) -> list[Row]:
    p = p or _paths()
    D = _bank(p)
    rows = []
    for i, Ts in ((12, (2.0, 6.0, 10.0)), (36, (4.0, 8.0, 10.0)), (60, (6.0, 10.0)), (72, (7.0, 11.0))):
        t = float(p.t[i])
        bias_d = D[:, i].mean() / p.p0[KEY](t) - 1.0          # the trapezoid's own discretisation, relative
        for T in Ts:
            x = D[:, i] * bond(p, KEY, i, T)
            se = x.std() / math.sqrt(len(x))
            target = p.p0[KEY](T) * (1.0 + bias_d)
            rows.append(Row("CCR paths", f"E[D(t)P(t,T)] t={t:.2f} T={T:g}", "martingale (bp of price)", x.mean() * 1e4,
                            target * 1e4, "standard errors", 4.0, scale=1.0 / (se * 1e4)))
    return rows


def _underlying(expiry: date, years: int, K: float, payer: bool) -> tuple[dict, list[dict]]:
    mat = date(expiry.year + years, expiry.month, expiry.day)
    common = {"effective_date": str(expiry), "maturity_date": str(mat), "currency": "USD", "notional": N, "bdc": "UNADJUSTED",
              "payment_lag": 0, "day_count": "ACT/360", "payment_frequency": "ANNUAL"}
    legs = [{**common, "leg_type": "FIXED", "direction": "PAY" if payer else "RECEIVE", "fixed_rate": K},
            {**common, "leg_type": "FLOAT", "direction": "RECEIVE" if payer else "PAY"}]
    item = {"kind": "SWAP", "ccy": "USD", "legs": [(lg, leg_schedule(lg, VAL)) for lg in legs], "maturity": mat,
            "trade": SimpleNamespace(trade_ref="REF")}
    return item, legs


def swaption_rows(p=None) -> list[Row]:
    p = p or _paths()
    D = _bank(p)
    set_eval(VAL)
    h = replica_handle(rijeka_curve())
    rows = []
    for months, years in ((12, 5), (24, 5), (36, 10)):
        expiry = add_months(VAL, months)
        i_e = p.grid.index(expiry)
        sch = ql.Schedule(qd(expiry), qd(date(expiry.year + years, expiry.month, expiry.day)), ql.Period(1, ql.Years), ql.NullCalendar(),
                          ql.Unadjusted, ql.Unadjusted, ql.DateGeneration.Backward, False)
        probe = ql.OvernightIndexedSwap(ql.Swap.Payer, N, sch, 0.03, ql.Actual360(), null_index(h))
        probe.setPricingEngine(ql.DiscountingSwapEngine(h))
        F = probe.fairRate()
        for k_name, K in (("ATM", F), ("ATM+50", F + 0.005)):
            for payer in (True, False):
                und, legs = _underlying(expiry, years, K, payer)
                item = {"expiry": expiry, "fixed_sched": und["legs"][0][1], "start": expiry, "N": N, "K": K, "vol": 0.0090,
                        "is_payer": payer, "ccy": "USD"}
                v = value_swaption(item, p, i_e, FX, lambda it, pp, j: value_swap(und, pp, j, FX))
                x = D[:, i_e] * v
                se = x.std() / math.sqrt(len(x))
                ois = ql.OvernightIndexedSwap(ql.Swap.Payer if payer else ql.Swap.Receiver, N, sch, K, ql.Actual360(), null_index(h))
                sw = ql.Swaption(ois, ql.EuropeanExercise(qd(expiry)))
                sw.setPricingEngine(ql.JamshidianSwaptionEngine(ql.HullWhite(h, A, SIGMA), h))
                case = f"{months // 12}Yx{years}Y {'payer' if payer else 'receiver'} {k_name}"
                rows.append(Row("CCR paths", case, "E[D·V] at expiry vs QuantLib Jamshidian", x.mean(), sw.NPV(), "standard errors", 4.0,
                                scale=1.0 / se, extra={"se_bp_notional": se * 1e4 / N}))
                if k_name == "ATM" and payer:
                    v0 = float(value_swaption(item, p, 0, FX, None)[0])
                    rows.append(Row("CCR paths", case, "value today (Bachelier, 90bp) vs at expiry (Hull-White)", v0, sw.NPV(),
                                    "% of value", 40.0, kind="convention", scale=100 / sw.NPV(),
                                    cause="model consistency: before expiry the path value uses today's market normal vol; "
                                          "exercise happens on Hull-White paths whose implied vol comes from (a, σ). "
                                          "EE jumps at expiry by the ratio of the two vols"))
    return rows


def caplet_rows(p=None) -> list[Row]:
    p = p or _paths()
    D = _bank(p)
    set_eval(VAL)
    h = replica_handle(rijeka_curve())
    model = ql.HullWhite(h, A, SIGMA)
    rows = []
    for m_fix, K in ((12, 0.035), (12, 0.040), (36, 0.038)):
        ps, pe = add_months(VAL, m_fix), add_months(VAL, m_fix + 3)
        tau = (pe - ps).days / 360.0
        item = {"ccy": "USD", "caplets": [{"type": "CAP", "K": K, "sign": 1.0, "N": N, "periods": [(ps, pe, pe, tau)], "vol": 0.0085}]}
        i = p.grid.index(pe) - 1                       # after the fixing, before the payment
        x = D[:, i] * value_caplets(item, p, i, FX)
        se = x.std() / math.sqrt(len(x))
        t_fix, t_pay = (ps - VAL).days / 365.0, (pe - VAL).days / 365.0
        ql_pv = N * (1 + K * tau) * model.discountBondOption(ql.Option.Put, 1 / (1 + K * tau), t_fix, t_pay)
        rows.append(Row("CCR paths", f"caplet fixing {ps} K={K:.2%}", "E[D·payoff] vs QuantLib HW zero-bond put", x.mean(), ql_pv,
                        "standard errors", 4.0, scale=1.0 / se))
    return rows


def all_rows() -> list[Row]:
    p = _paths()
    return martingale_rows(p) + swaption_rows(p) + caplet_rows(p)


def test_paths_are_risk_neutral_martingales():
    assert_rows(martingale_rows())


def test_swaption_and_caplet_on_paths_match_quantlib_hull_white():
    p = _paths()
    assert_rows(swaption_rows(p) + caplet_rows(p))
