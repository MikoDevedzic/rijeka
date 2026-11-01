"""Discount curve against QuantLib.

1. Replica: QuantLib prices every input quote on Rijeka's bootstrapped discount factors with
   Rijeka's quoting conventions (spot T+2 New York, annual ACT/360 periods rolled backward from
   maturity, unadjusted, no payment lag). Every quote must come back at par.
2. Convention: QuantLib's own bootstrap (OISRateHelper, market SOFR conventions). Zero rates agree
   at the quoted tenors; between quotes Rijeka fills every missing whole year with a linearly
   interpolated par rate (pricing/bootstrap.py, _interpolate_rate) where QuantLib interpolates
   log-linearly in discount factors, and the two curves part by up to half a basis point there.
3. Forwards between pillars: identical on the replica (same interpolation); against the market
   curve within the gap-fill difference.
4. A valuation date whose spot date is 29 February builds (it raised before)."""
from __future__ import annotations

from datetime import date

import QuantLib as ql

from pricing.bootstrap import bootstrap_curve, parse_tenor
from tests.reference.refmarket import (USD_SOFR, VAL, Row, assert_rows, market_curve, null_index, qd, replica_handle,
                                       rijeka_curve, rijeka_quotes, set_eval)

A365 = ql.Actual365Fixed()
GAP_CAUSE = ("convention: Rijeka adds a pillar at every missing whole year with a linearly interpolated par rate "
             "(bootstrap._interpolate_rate); QuantLib interpolates log-linearly in DF between quoted maturities")


def _ois_par(h, idx, start: date, mat: date) -> float:
    sch = ql.Schedule(qd(start), qd(mat), ql.Period(1, ql.Years), ql.NullCalendar(), ql.Unadjusted, ql.Unadjusted,
                      ql.DateGeneration.Backward, False)
    fixed = ql.FixedRateLeg(sch, ql.Actual360(), [1.0], [0.01], paymentAdjustment=ql.Unadjusted)
    flt = ql.OvernightLeg([1.0], sch, idx, ql.Actual360(), ql.Unadjusted)
    sw = ql.Swap(fixed, flt)
    sw.setPricingEngine(ql.DiscountingSwapEngine(h))
    return -sw.legNPV(1) / (sw.legBPS(0) / 1e-4)


def replica_rows(curve=None, quotes=USD_SOFR, val=VAL) -> list[Row]:
    curve = curve or rijeka_curve()
    h = replica_handle(curve)
    idx = null_index(h)
    spot = parse_tenor(val, "0D")
    rows = []
    for t, r in quotes:
        if t == "ON":
            df = h.discount(qd(parse_tenor(val, "ON")))
            rows.append(Row("Curve", f"{val} ON deposit", "implied rate", (1 / df - 1) * 360 * 100, r, "bp", 1e-6, scale=100))
            continue
        par = _ois_par(h, idx, spot, parse_tenor(val, t)) * 100
        rows.append(Row("Curve", f"{val} {t} OIS", "par rate on Rijeka DFs", par, r, "bp", 1e-6, scale=100))
    return rows


def convention_rows() -> list[Row]:
    h, m = replica_handle(rijeka_curve()), market_curve()
    rows = []
    quoted = [t for t, _ in USD_SOFR if t != "ON"]
    for t in quoted + ["11Y", "13Y", "14Y", "17Y", "22Y", "35Y", "45Y"]:
        d = qd(parse_tenor(VAL, t))
        zr = h.zeroRate(d, A365, ql.Continuous).rate() * 100
        zm = m.zeroRate(d, A365, ql.Continuous).rate() * 100
        in_gap = t not in quoted or t in ("15Y", "20Y", "25Y", "30Y", "40Y", "50Y")
        adjusted = t in ("5M", "8M")      # Saturday maturities: QuantLib rolls them to Monday, Rijeka keeps them unadjusted
        tol = 1.5 if in_gap else 0.2 if adjusted else 0.05
        cause = (GAP_CAUSE if in_gap else
                 "convention: Rijeka's swap maturities are unadjusted; QuantLib's helpers roll a weekend maturity (modified following)"
                 if adjusted else "payment lag 2 and modified following move zeros at quoted tenors by <0.02bp")
        rows.append(Row("Curve", f"zero to {t}", "zero rate (cc, ACT/365F)", zr, zm, "bp", tol, cause=cause, scale=100, kind="convention"))
    return rows


def forward_rows() -> list[Row]:
    c = rijeka_curve()
    h, m = replica_handle(c), market_curve()
    rows = []
    from dateutil.relativedelta import relativedelta
    for y in (0.25, 1, 2.5, 7, 11, 13.5, 28):
        d1 = parse_tenor(VAL, "0D") + relativedelta(months=int(round(y * 12)))
        d2 = d1 + relativedelta(months=3)
        fr = c.forward_rate(d1, d2) * 100
        fq = h.forwardRate(qd(d1), qd(d2), A365, ql.Simple).rate() * 100
        fm = m.forwardRate(qd(d1), qd(d2), A365, ql.Simple).rate() * 100
        rows.append(Row("Curve", f"3M forward from {d1}", "simple fwd ACT/365F, replica", fr, fq, "bp", 1e-6, scale=100))
        rows.append(Row("Curve", f"3M forward from {d1}", "simple fwd ACT/365F, market bootstrap", fr, fm, "bp", 6.0,
                        cause=GAP_CAUSE + "; a forward magnifies the zero difference by maturity / 0.25", scale=100, kind="convention"))
    return rows


def all_rows() -> list[Row]:
    return replica_rows() + convention_rows() + forward_rows()


def test_rijeka_curve_reprices_every_quote_in_quantlib():
    assert_rows(replica_rows())


def test_zero_rates_against_quantlib_market_bootstrap():
    assert_rows(convention_rows())


def test_forwards_between_pillars():
    assert_rows(forward_rows())


def test_spot_on_29_february_builds_and_reprices():
    # Friday 25 Feb 2028 + 2 New York business days = Tuesday 29 Feb 2028. The annual grid was built
    # with date(spot.year + y, spot.month, spot.day), which has no 29 February in 2029.
    val = date(2028, 2, 25)
    assert parse_tenor(val, "0D") == date(2028, 2, 29)
    c = bootstrap_curve(val, rijeka_quotes())
    set_eval(val)
    assert_rows(replica_rows(c, val=val))
    set_eval(VAL)
