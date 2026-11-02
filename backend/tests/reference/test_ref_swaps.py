"""Interest rate swaps against QuantLib.

Replica: every trade is rebuilt in QuantLib on Rijeka's discount factors with the conventions
Rijeka states (pricing/schedule.py: unadjusted accrual dates rolled from the anchor, payment on
the modified-following New York date, SOFR projected as DF(s)/DF(e) − 1, which an overnight index
fixing every calendar day reproduces exactly). The schedule itself is generated independently by
QuantLib's Schedule (Backward rule for front stubs, Forward for back stubs), so a date bug shows
up as an NPV difference. NPV must agree to a hundred-millionth of notional; par rate and DV01 too.

Convention: the same trade on QuantLib's market bootstrap with the market SOFR index (fixing
calendar with Good Friday, accrual dates modified following, payment lag 2). The difference is
reported in bp of notional and bounded; its causes are named.

DV01 is Rijeka's IR01 (+1bp on every pillar's continuously compounded ACT/365F zero rate,
pricing/curve.py shifted) against QuantLib's ZeroSpreadedTermStructure with the same 1bp
continuous spread: the same bump, so the numbers must agree."""
from __future__ import annotations

from datetime import date, timedelta

import QuantLib as ql

from pricing.ir_swap import price_swap
from tests.reference.refmarket import (FED, SOFR_CAL, VAL, Row, assert_rows, market_curve, null_index, qd, replica_handle,
                                       rijeka_curve, set_eval)

N = 10_000_000.0
FREQ = {"ANNUAL": ql.Period(1, ql.Years), "SEMI_ANNUAL": ql.Period(6, ql.Months), "QUARTERLY": ql.Period(3, ql.Months)}
DC = {"ACT/360": ql.Actual360(), "30/360": ql.Thirty360(ql.Thirty360.BondBasis), "ACT/365F": ql.Actual365Fixed()}


def _legs(eff: date, mat: date, rate: float, *, fixed_freq="ANNUAL", fixed_dc="ACT/360", float_freq="ANNUAL",
          stub="SHORT_FRONT", rate_schedule=None, notional_schedule=None, spread=0.0, fixings=None, lag=0) -> list[dict]:
    common = {"effective_date": str(eff), "maturity_date": str(mat), "currency": "USD", "notional": N, "bdc": "MOD_FOLLOWING",
              "payment_lag": lag, "stub_type": stub, "discount_curve_id": "USD_SOFR", "forecast_curve_id": "USD_SOFR"}
    fixed = {**common, "leg_type": "FIXED", "direction": "PAY", "fixed_rate": rate, "payment_frequency": fixed_freq, "day_count": fixed_dc}
    flt = {**common, "leg_type": "FLOAT", "direction": "RECEIVE", "payment_frequency": float_freq, "day_count": "ACT/360", "spread": spread}
    if rate_schedule:
        fixed["fixed_rate_schedule"] = [{"date": str(d), "rate": r} for d, r in rate_schedule]
    if notional_schedule:
        for lg in (fixed, flt):
            lg["notional_schedule"] = [{"date": str(d), "notional": n} for d, n in notional_schedule]
    if fixings:
        flt["fixings"] = fixings
    return [fixed, flt]


CASES: list[tuple[str, list[dict]]] = [
    ("2Y OIS spot, annual/annual", _legs(date(2026, 11, 3), date(2028, 11, 3), 0.0353)),
    ("5Y IRS spot, 30/360 semi vs SOFR quarterly", _legs(date(2026, 11, 3), date(2031, 11, 3), 0.04, fixed_freq="SEMI_ANNUAL",
                                                          fixed_dc="30/360", float_freq="QUARTERLY")),
    ("10Y OIS spot", _legs(date(2026, 11, 3), date(2036, 11, 3), 0.0368)),
    ("30Y OIS spot", _legs(date(2026, 11, 3), date(2056, 11, 3), 0.0386)),
    ("1Y x 5Y forward start", _legs(date(2027, 11, 3), date(2032, 11, 3), 0.035)),
    ("5Y amortising, quarterly, -2m a year", _legs(date(2026, 11, 3), date(2031, 11, 3), 0.035, fixed_freq="QUARTERLY", float_freq="QUARTERLY",
                                                    notional_schedule=[(date(2027, 11, 3), 8e6), (date(2028, 11, 3), 6e6),
                                                                       (date(2029, 11, 3), 4e6), (date(2030, 11, 3), 2e6)])),
    ("5Y step-up 3.00/3.50/4.00", _legs(date(2026, 11, 3), date(2031, 11, 3), 0.03,
                                        rate_schedule=[(date(2028, 11, 3), 0.035), (date(2030, 11, 3), 0.04)])),
    ("front stub 17 Nov 2026 - 3 Nov 2031, quarterly", _legs(date(2026, 11, 17), date(2031, 11, 3), 0.035, fixed_freq="QUARTERLY",
                                                              float_freq="QUARTERLY")),
    ("back stub 3 Nov 2026 - 17 Feb 2031, quarterly", _legs(date(2026, 11, 3), date(2031, 2, 17), 0.035, fixed_freq="QUARTERLY",
                                                             float_freq="QUARTERLY", stub="SHORT_BACK")),
    ("month-end roll 31 Aug 2027 - 31 Aug 2032, quarterly", _legs(date(2027, 8, 31), date(2032, 8, 31), 0.036, fixed_freq="QUARTERLY",
                                                                   float_freq="QUARTERLY")),
    ("float + 25bp spread, 3Y quarterly", _legs(date(2026, 11, 3), date(2029, 11, 3), 0.0375, fixed_freq="QUARTERLY",
                                                 float_freq="QUARTERLY", spread=0.0025)),
    ("2Y quarterly, payment lag 2 across Thanksgiving", _legs(date(2026, 11, 24), date(2028, 11, 24), 0.0355, fixed_freq="QUARTERLY",
                                                               float_freq="QUARTERLY", lag=2)),
]


# ── QuantLib replica of a Rijeka leg ─────────────────────────────────────────
def _ql_schedule(lg: dict, cal, conv) -> ql.Schedule:
    rule = ql.DateGeneration.Forward if lg.get("stub_type") in ("SHORT_BACK", "LONG_BACK") else ql.DateGeneration.Backward
    return ql.Schedule(qd(date.fromisoformat(lg["effective_date"])), qd(date.fromisoformat(lg["maturity_date"])),
                       FREQ[lg["payment_frequency"]], cal, conv, conv, rule, False)


def _by_start(entries, key, default, start: date):
    v = default
    for e in sorted(entries or [], key=lambda e: e["date"]):
        if date.fromisoformat(e["date"]) <= start:
            v = e[key]
    return v


def _ql_leg(lg: dict, index, *, market: bool):
    """Coupon by coupon from QuantLib's own schedule. Payment = modified following of the accrual end
    (+ lag) on the payment calendar. Rijeka accrues to the unadjusted end, so a month-end Saturday is
    paid on the Friday before the accrual ends; QuantLib's overnight coupon refuses that, so such a
    coupon's amount is computed by QuantLib on its accrual dates and paid as a cash flow on that Friday."""
    from tests.reference.refmarket import pd_
    cal = SOFR_CAL if market else FED
    conv = ql.ModifiedFollowing if market else ql.Unadjusted
    lag = 2 if market else int(lg.get("payment_lag") or 0)
    sch = list(_ql_schedule(lg, cal, conv))
    dc = DC[lg["day_count"]]
    leg = []
    for s, e in zip(sch[:-1], sch[1:]):
        n = float(_by_start(lg.get("notional_schedule"), "notional", lg["notional"], pd_(s)))
        pay = cal.advance(cal.adjust(e, ql.ModifiedFollowing), lag, ql.Days)
        if lg["leg_type"] == "FIXED":
            r = float(_by_start(lg.get("fixed_rate_schedule"), "rate", lg["fixed_rate"], pd_(s)))
            leg.append(ql.FixedRateCoupon(pay, n, r, dc, s, e))
        else:
            cpn = ql.OvernightIndexedCoupon(max(pay, e), n, s, e, index, 1.0, float(lg.get("spread") or 0.0), ql.Date(), ql.Date(), dc)
            leg.append(cpn if pay >= e else ql.SimpleCashFlow(cpn.amount(), pay))
    return leg


def ql_swap(legs: list[dict], handle, *, market: bool = False) -> ql.Swap:
    index = ql.Sofr(handle) if market else null_index(handle)
    q = [_ql_leg(lg, index, market=market) for lg in legs]
    payer = [lg["direction"] == "PAY" for lg in legs]
    sw = ql.Swap(q, payer)
    sw.setPricingEngine(ql.DiscountingSwapEngine(handle))
    return sw


def _rijeka(legs, curve=None, val: date = VAL):
    curve = curve or rijeka_curve()
    r = price_swap("ref", legs, {"USD_SOFR": curve}, val)
    assert r.error is None, r.error
    return r


def npv_rows() -> list[Row]:
    set_eval(VAL)
    h = replica_handle(rijeka_curve())
    m = market_curve()
    rows = []
    for name, legs in CASES:
        r = _rijeka(legs)
        sw = ql_swap(legs, h)
        rows.append(Row("IRS", name, "NPV, replica", r.npv, sw.NPV(), "bp of notional", 1e-6, scale=1e4 / N))
        dv01 = sum(l.ir01 for l in r.legs)
        bumped = ql.YieldTermStructureHandle(ql.ZeroSpreadedTermStructure(h, ql.QuoteHandle(ql.SimpleQuote(1e-4)), ql.Continuous,
                                                                          ql.NoFrequency, ql.Actual365Fixed()))
        dv01_ql = ql_swap(legs, bumped).NPV() - sw.NPV()
        rows.append(Row("IRS", name, "DV01 (+1bp zero), replica", dv01, dv01_ql, "% of DV01", 1e-4, scale=100 / max(abs(dv01_ql), 1e-9)))
        mk = ql_swap(legs, m, market=True)
        rows.append(Row("IRS", name, "NPV, QuantLib market conventions", r.npv, mk.NPV(), "bp of notional", 1.0, kind="convention",
                        cause="accrual dates modified following and payment lag 2 (market) vs unadjusted accrual and no lag "
                              "(Rijeka default legs); SOFR fixing calendar; curve gap fill beyond 10Y", scale=1e4 / N))
    return rows


def par_rows() -> list[Row]:
    """Par fixed rate of the plain spot swaps: Rijeka (NPV / fixed-leg BPV) against QuantLib fairRate."""
    set_eval(VAL)
    h = replica_handle(rijeka_curve())
    rows = []
    for name, legs in CASES[:4]:
        r = _rijeka(legs)
        fixed_pv = next(l.pv for l in r.legs if l.leg_type == "FIXED")
        float_pv = next(l.pv for l in r.legs if l.leg_type == "FLOAT")
        par = float_pv / -fixed_pv * legs[0]["fixed_rate"]
        sw = ql_swap(legs, h)
        par_ql = -sw.legNPV(1) / sw.legBPS(0) * 1e-4 * (-1 if sw.legBPS(0) < 0 else 1)
        par_ql = abs(sw.legNPV(1)) / abs(sw.legBPS(0)) * 1e-4
        rows.append(Row("IRS", name, "par rate, replica", par * 100, par_ql * 100, "bp", 1e-6, scale=100))
    return rows


def seasoned_rows() -> list[Row]:
    """A swap three months into a quarterly period, SOFR fixed at 4.30% every day so far.
    With the realised rate Rijeka compounds the elapsed and the remaining parts (ir_swap._project_float_rate)
    and must match QuantLib's daily compounding; until 2026-11 it added them, 0.045bp of notional low here.
    Without a fixing Rijeka assumes the elapsed part accrued at the remaining stub's forward: an open
    finding, because no production path supplies fixings yet (the row is bounded, not exact)."""
    set_eval(VAL)
    h = replica_handle(rijeka_curve())
    eff, mat = date(2026, 8, 3), date(2029, 8, 3)
    idx = null_index(h)
    d = ql.Date(3, 8, 2026)
    growth = 1.0
    while d < qd(VAL):
        idx.addFixing(d, 0.043, True)
        growth *= 1 + 0.043 / 360
        d = d + 1
    elapsed = (VAL - eff).days
    realised = (growth - 1) * 360 / elapsed
    rows = []
    # the production path: the realised rate rebuilt from daily ON snapshots (pricing/fixings.py), SOFR_FIX every day
    import json
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session
    from pricing import fixings as FX
    sdb = Session(create_engine("sqlite://"))
    sdb.execute(text("CREATE TABLE market_data_snapshots (curve_id TEXT, user_id TEXT, valuation_date DATE, quotes TEXT)"))
    dd = eff - timedelta(days=1)
    while dd < VAL:
        sdb.execute(text("INSERT INTO market_data_snapshots VALUES ('USD_SOFR', 'tpl', :d, :q)"),
                    {"d": dd, "q": json.dumps([{"tenor": "ON", "rate": 4.30}])})
        dd += timedelta(days=1)
    sdb.commit()
    FX._cache.clear()
    for label, fix in (("with the fixing", {str(eff): realised}), ("fixings from the daily ON snapshots", "lookup"), ("no fixing supplied", None)):
        legs = _legs(eff, mat, 0.036, fixed_freq="QUARTERLY", float_freq="QUARTERLY", fixings=None if fix == "lookup" else fix)
        if fix == "lookup":
            lookup, _ = FX.lookup_for(sdb, "tpl", legs, owner="tpl")
            r = price_swap("ref", legs, {"USD_SOFR": rijeka_curve()}, VAL, fixing_lookup=lookup)
        else:
            r = _rijeka(legs)
        sw = ql.Swap([_ql_leg(legs[0], idx, market=False), _ql_leg(legs[1], idx, market=False)], [True, False])
        sw.setPricingEngine(ql.DiscountingSwapEngine(h))
        if fix:
            rows.append(Row("IRS", f"seasoned 3Y quarterly, {label}", "NPV, replica", r.npv, sw.NPV(), "bp of notional", 1e-6,
                            scale=1e4 / N))
        else:
            rows.append(Row("IRS", f"seasoned 3Y quarterly, {label}", "NPV vs true accrual", r.npv, sw.NPV(), "bp of notional", 12.0,
                            kind="convention", scale=1e4 / N,
                            cause="open finding: no production path passes realised SOFR, so the elapsed days are assumed to have "
                                  "accrued at the remaining stub's forward (here 4.30% realised vs a 3.9% forward)"))
    idx.clearFixings()
    return rows


def zero_coupon_rows() -> list[Row]:
    """A 5Y zero-coupon fixed leg (amount N·((1+r)^T − 1), annual compounding on ACT/365F, paid on the adjusted
    maturity) against SOFR quarterly. QuantLib computes the amount with its own InterestRate."""
    set_eval(VAL)
    h = replica_handle(rijeka_curve())
    eff, mat = date(2026, 11, 3), date(2031, 11, 1)                     # a Saturday maturity: paid Monday 3 Nov 2031
    legs = _legs(eff, mat, 0.037, float_freq="QUARTERLY")
    legs[0].update(leg_type="ZERO_COUPON", payment_frequency="ZERO_COUPON")
    r = _rijeka(legs)
    ir = ql.InterestRate(0.037, ql.Actual365Fixed(), ql.Compounded, ql.Annual)
    amount = N * (ir.compoundFactor(qd(eff), qd(mat)) - 1)
    pay = FED.adjust(qd(mat), ql.ModifiedFollowing)
    fixed = [ql.SimpleCashFlow(amount, pay)]
    flt = _ql_leg(legs[1], null_index(h), market=False)
    sw = ql.Swap([fixed, flt], [True, False])
    sw.setPricingEngine(ql.DiscountingSwapEngine(h))
    return [Row("IRS", "5Y zero-coupon fixed vs SOFR quarterly", "NPV, replica", r.npv, sw.NPV(), "bp of notional", 1e-6, scale=1e4 / N)]


def all_rows() -> list[Row]:
    return npv_rows() + par_rows() + seasoned_rows() + zero_coupon_rows()


def test_zero_coupon_leg():
    assert_rows(zero_coupon_rows())


def test_swap_npv_and_dv01_replica_and_market():
    assert_rows(npv_rows())


def test_par_rates():
    assert_rows(par_rows())


def test_seasoned_swap_period_under_way():
    assert_rows(seasoned_rows())
