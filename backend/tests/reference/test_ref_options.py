"""European swaptions, caps and floors against QuantLib.

Swaptions (pricing/swaption.py, Bachelier on the OIS annuity) against ql.Swaption on an
OvernightIndexedSwap with ql.BachelierSwaptionEngine: same curve, same annual ACT/360 fixed leg, option
time ACT/365F to the exercise date. NPV and vega must agree exactly, for payers and receivers, in and
out of the money, with a negative strike.

Swaption delta two ways: Rijeka's IR01 is the analytic forward delta, A·N(d)·1bp with the annuity held;
a parallel +1bp bump of the curve also moves the annuity and the forward differently from 1bp. The two
are different definitions, both reported; the risk ladder uses bump-and-reprice.

Caps and floors (pricing/cap_floor.py): Rijeka prices each SOFR caplet with Bachelier on the period's
compounded forward, option time to the middle of the accrual period on ACT/365F (option_time). The
replica rebuilds the same caplets with QuantLib's bachelierBlackFormula on the replica curve, so the
schedule, forwards, discounting and the formula are checked. The convention row prices the same caplets
with QuantLib's BlackCompoundingOvernightIndexedCouponPricer on CappedFlooredOvernightIndexedCoupon,
which models the backward-looking accrual itself (for these caps its implied option time is about
start + 0.40 of the period, against Rijeka's start + 0.50). Rijeka's caps come out 0.6% to 2.0% of
premium higher and the floor 2.5% lower, so the difference is not the option time alone."""
from __future__ import annotations

import math
from datetime import date, timedelta

import QuantLib as ql

from pricing.cap_floor import caplet_schedule, option_time, price_cap, price_floor
from pricing.swaption import price_swaption
from tests.reference.refmarket import (FED, VAL, Row, assert_rows, null_index, qd, replica_handle, rijeka_curve, set_eval)

N = 10_000_000.0
A365 = ql.Actual365Fixed()


def _bump(h, bp=1.0):
    return ql.YieldTermStructureHandle(ql.ZeroSpreadedTermStructure(h, ql.QuoteHandle(ql.SimpleQuote(bp * 1e-4)), ql.Continuous,
                                                                     ql.NoFrequency, A365))


def _ql_swaption(h, exercise, start, mat, K, payer, vol):
    idx = null_index(h)
    sch = ql.Schedule(qd(start), qd(mat), ql.Period(1, ql.Years), ql.NullCalendar(), ql.Unadjusted, ql.Unadjusted,
                      ql.DateGeneration.Backward, False)
    ois = ql.OvernightIndexedSwap(ql.Swap.Payer if payer else ql.Swap.Receiver, N, sch, K, ql.Actual360(), idx)
    sw = ql.Swaption(ois, ql.EuropeanExercise(qd(exercise)))
    sw.setPricingEngine(ql.BachelierSwaptionEngine(h, ql.QuoteHandle(ql.SimpleQuote(vol)), A365))
    return sw, ois


# expiry label, exercise date, tenor years, normal vol bp
GRID = [("3M", date(2027, 1, 29), 2, 96.0), ("1Y", date(2027, 10, 29), 5, 90.0), ("5Y", date(2031, 10, 30), 10, 78.0)]


def swaption_rows() -> list[Row]:
    set_eval(VAL)
    c = rijeka_curve()
    h = replica_handle(c)
    rows = []
    for label, ex, ten, vol_bp in GRID:
        start = FED.advance(qd(ex), 2, ql.Days)
        start = date(start.year(), start.month(), start.dayOfMonth())
        mat = date(start.year + ten, start.month, start.day)
        T = (ex - VAL).days / 365.0
        _, ois = _ql_swaption(h, ex, start, mat, 0.03, True, vol_bp / 1e4)
        ois.setPricingEngine(ql.DiscountingSwapEngine(h))
        F = ois.fairRate()
        for k_name, K in (("ATM", F), ("ATM+100", F + 0.01), ("ATM-100", F - 0.01), ("K=-0.25%", -0.0025)):
            for payer in (True, False):
                if k_name == "K=-0.25%" and payer is False:
                    continue
                case = f"{label}x{ten}Y {'payer' if payer else 'receiver'} {k_name}"
                r = price_swaption(N, T, float(ten), K, vol_bp, payer, c, 1.0, VAL, swap_effective_date=start, swap_maturity_date=mat)
                assert r.error is None, r.error
                sw, _ = _ql_swaption(h, ex, start, mat, K, payer, vol_bp / 1e4)
                rows.append(Row("Swaption", case, "NPV", r.npv, sw.NPV(), "bp of notional", 1e-6, scale=1e4 / N))
                if k_name == "ATM":
                    rows.append(Row("Swaption", case, "vega (1bp vol)", r.vega, sw.vega() * 1e-4, "% of vega", 1e-6,
                                    scale=100 / (sw.vega() * 1e-4)))
                    up = _ql_swaption(_bump(h), ex, start, mat, K, payer, vol_bp / 1e4)[0].NPV() - sw.NPV()
                    rows.append(Row("Swaption", case, "delta: analytic forward delta vs +1bp curve bump", r.ir01, up,
                                    "% of delta", 15.0, kind="convention", scale=100 / abs(up),
                                    cause="definition: Rijeka's swaption IR01 is A·N(d)·1bp with the annuity held; the curve bump "
                                          "also discounts the annuity and moves the forward by less than 1bp"))
    return rows


def _ql_caplets(c, h, sched, K, vol, call: bool) -> tuple[float, float]:
    """Replica: QuantLib's Bachelier formula on the replica curve's forwards and discount factors, Rijeka's
    caplet dates and option times. Returns (pv, pv with vol + 1bp)."""
    pv = pv_v = 0.0
    for cp in sched:
        s, e = cp["start_date"], cp["end_date"]
        tau = (e - s).days / 360.0
        F = (h.discount(qd(s)) / h.discount(qd(e)) - 1) / tau
        T = option_time(VAL, s, e)
        typ = ql.Option.Call if call else ql.Option.Put
        df = h.discount(qd(e))
        pv += N * tau * ql.bachelierBlackFormula(typ, K, F, vol * math.sqrt(T), df)
        pv_v += N * tau * ql.bachelierBlackFormula(typ, K, F, (vol + 1e-4) * math.sqrt(T), df)
    return pv, pv_v


def _ql_compounded(h, sched, K, vol, call: bool) -> float:
    idx = null_index(h)
    ovs = ql.ConstantOptionletVolatility(0, ql.NullCalendar(), ql.Unadjusted, vol, A365, ql.Normal)
    pricer = ql.BlackCompoundingOvernightIndexedCouponPricer(ql.OptionletVolatilityStructureHandle(ovs))
    pv = 0.0
    for cp in sched:
        s, e = qd(cp["start_date"]), qd(cp["end_date"])
        base = ql.OvernightIndexedCoupon(e, N, s, e, idx, 1.0, 0.0, ql.Date(), ql.Date(), ql.Actual360())
        cf = ql.CappedFlooredOvernightIndexedCoupon(base, K if call else ql.nullDouble(), ql.nullDouble() if call else K, False, True)
        cf.setPricer(pricer)
        pv += abs(base.amount() - cf.amount()) * h.discount(e)
    return pv


def cap_rows() -> list[Row]:
    set_eval(VAL)
    c = rijeka_curve()
    h = replica_handle(c)
    rows = []
    for tenor, K, vol_bp, call in ((2.0, 0.036, 85.0, True), (5.0, 0.040, 85.0, True), (5.0, 0.030, 80.0, False), (10.0, 0.045, 75.0, True)):
        sched = caplet_schedule(VAL + timedelta(days=2), tenor, 4)
        fn = price_cap if call else price_floor
        r = fn(N, K, tenor, c, VAL, surface_rows=[], vol_override_bp=vol_bp)
        kind = "cap" if call else "floor"
        case = f"{tenor:g}Y SOFR {kind} K={K:.2%} {vol_bp:g}bp"
        pv, pv_v = _ql_caplets(c, h, sched, K, vol_bp / 1e4, call)
        rows.append(Row("Cap/floor", case, "NPV, replica", r.npv, pv, "% of premium", 0.001, scale=100 / pv))      # Rijeka rounds to cents
        rows.append(Row("Cap/floor", case, "vega (1bp vol), replica", r.vega, pv_v - pv, "% of vega", 0.05, scale=100 / (pv_v - pv)))
        comp = _ql_compounded(h, sched, K, vol_bp / 1e4, call)
        rows.append(Row("Cap/floor", case, "NPV vs QuantLib compounded-SOFR caplet pricer", r.npv, comp, "% of premium", 3.0,
                        kind="convention", scale=100 / comp,
                        cause="convention: Bachelier on the period forward with option time to mid-period (Rijeka, documented as "
                              "Bloomberg's) vs QuantLib's model of the backward-looking accrual; caps +0.6 to +2.0%, the floor −2.5%"))
    return rows


def all_rows() -> list[Row]:
    return swaption_rows() + cap_rows()


def test_european_swaptions_against_quantlib():
    assert_rows(swaption_rows())


def test_caps_and_floors_against_quantlib():
    assert_rows(cap_rows())
