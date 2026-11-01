"""Bermudan and European swaptions under Hull-White one-factor against QuantLib.

Rijeka's trinomial tree (pricing/bermudan_swaption.py, HW1FTrinomialTree fitted to the curve by
forward induction) against QuantLib's HullWhite model on the same curve with the same (a, σ):
TreeSwaptionEngine for the Bermudan, JamshidianSwaptionEngine (exact) for the European. Rijeka's tree
needs every exercise time on its grid, so all dates sit on multiples of five days from the valuation
date (365-day periods, a 5-day step); QuantLib takes the same dates. The underlying is single-curve:
annual fixed leg ACT/360 against SOFR projected on the same curve, which is what the tree prices
(swap_pv_at_node telescopes the float leg).

Tolerances are tree convergence, stated in bp of notional: Rijeka's tree against Jamshidian's closed
form, and the two trees against each other."""
from __future__ import annotations

from datetime import timedelta

import QuantLib as ql

from pricing.bermudan_swaption import price_bermudan_swaption_hw1f, price_european_swaption_hw1f_jamshidian
from tests.reference.refmarket import VAL, Row, assert_rows, null_index, qd, replica_handle, rijeka_curve, set_eval

N = 10_000_000.0
A, SIGMA = 0.03, 0.0085            # mean reversion and normal vol (decimal), typical of the xva calibration
STEP_DAYS = 5


def _setup(first_y: int, years: int):
    set_eval(VAL)
    h = replica_handle(rijeka_curve())
    days = [365 * (first_y + k) for k in range(years + 1)]                   # T0 .. Tn, all multiples of 5 days
    dates = [VAL + timedelta(days=d) for d in days]
    sch = ql.Schedule([qd(d) for d in dates], ql.NullCalendar(), ql.Unadjusted)
    return h, days, dates, sch


def _ql(h, sch, K, payer, exercise_dates, engine: str):
    ois = ql.OvernightIndexedSwap(ql.Swap.Payer if payer else ql.Swap.Receiver, N, sch, K, ql.Actual360(), null_index(h))
    ex = ql.EuropeanExercise(exercise_dates[0]) if len(exercise_dates) == 1 else ql.BermudanExercise(exercise_dates)
    sw = ql.Swaption(ois, ex)
    model = ql.HullWhite(h, A, SIGMA)
    sw.setPricingEngine(ql.JamshidianSwaptionEngine(model, h) if engine == "jamshidian" else ql.TreeSwaptionEngine(model, 400))
    return sw, ois


def _rijeka(h, days, dates, K, payer, exercise_days):
    pay_y = [d / 365.0 for d in days[1:]]
    dcf = [(dates[i + 1] - dates[i]).days / 360.0 for i in range(len(dates) - 1)]
    return price_bermudan_swaption_hw1f(N, K, payer, days[0] / 365.0, pay_y, dcf, [d / 365.0 for d in exercise_days], A, SIGMA,
                                        discount_fn=lambda t: h.discount(t), dt=STEP_DAYS / 365.0)


def bermudan_rows() -> list[Row]:
    rows = []
    for first_y, years in ((1, 5), (2, 8)):
        h, days, dates, sch = _setup(first_y, years)
        _, ois = _ql(h, sch, 0.03, True, [qd(dates[0])], "jamshidian")
        ois.setPricingEngine(ql.DiscountingSwapEngine(h))
        F = ois.fairRate()
        for k_name, K in (("ATM", F), ("ATM+50", F + 0.005), ("ATM-50", F - 0.005)):
            for payer in (True, False):
                case = f"{first_y}Y into {years}Y annual, {'payer' if payer else 'receiver'} {k_name}"
                ex_days = days[:-1]                                           # exercise on every reset into the remaining swap
                r = _rijeka(h, days, dates, K, payer, ex_days)
                berm, _ = _ql(h, sch, K, payer, [qd(VAL + timedelta(days=d)) for d in ex_days], "tree")
                eur_j, _ = _ql(h, sch, K, payer, [qd(dates[0])], "jamshidian")
                eur_t = _rijeka(h, days, dates, K, payer, [days[0]])          # European: the first exercise date only
                rows.append(Row("Bermudan (HW1F)", case, "Bermudan NPV, tree vs QuantLib tree", r.npv, berm.NPV(), "bp of notional",
                                1.0, scale=1e4 / N, cause="two trinomial trees on different grids: convergence"))
                rows.append(Row("Bermudan (HW1F)", case, "European NPV, tree vs QuantLib Jamshidian", eur_t.npv, eur_j.NPV(),
                                "bp of notional", 1.0, scale=1e4 / N, cause="tree discretisation against the closed form"))
                pay_y = [d / 365.0 for d in days[1:]]
                dcf = [(dates[i + 1] - dates[i]).days / 360.0 for i in range(len(dates) - 1)]
                jam = price_european_swaption_hw1f_jamshidian(N, K, payer, days[0] / 365.0, pay_y, dcf, A, SIGMA,
                                                              discount_fn=lambda t: h.discount(t))
                rows.append(Row("European (HW1F)", case, "Jamshidian closed form, Rijeka vs QuantLib", float(jam["npv"]), eur_j.NPV(),
                                "bp of notional", 1e-3, scale=1e4 / N))
    return rows


def all_rows() -> list[Row]:
    return bermudan_rows()


def test_bermudan_and_european_hw1f_against_quantlib():
    assert_rows(bermudan_rows())
