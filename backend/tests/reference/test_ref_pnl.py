"""P&L attribution with the production pricer, against QuantLib marks.

pnl/explain.py attributes a day's P&L by sequential full revaluation. Run here on the real swap pricer
(bootstrap + price_swap from the day's quotes) for a seasoned quarterly SOFR swap, over a curve move,
a coupon payment and an amendment:

1. The marks the explain starts and ends on are the pricer's, and QuantLib's replica (Rijeka's curves,
   SOFR fixed every day so far, flows on the valuation date kept in the value as Rijeka keeps them)
   gives the same numbers.
2. The rows close: they sum to mark − previous mark + cash, and with only the curve moving the residual
   is zero.
3. A coupon is P&L once. The pricer keeps a flow in the mark on its payment date, so the cash step
   counts flows paid in [d0, d1). Over three closes around a payment date, the daily totals sum to the
   QuantLib two-day revaluation plus the coupon, and no single day carries the coupon twice (before
   2026-11 the window was (d0, d1] and the payment day's P&L was overstated by the coupon, reversed
   the next day).
4. The amendment step is NPV(new terms, today's market) − NPV(old terms, today's market), equal to the
   QuantLib difference."""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest
import QuantLib as ql

from pnl import explain as E
from pricing.bootstrap import DEPOSIT, OIS_SWAP, PillarQuote, bootstrap_curve
from pricing.ir_swap import price_swap
from tests.reference import test_ref_swaps as S
from tests.reference.refmarket import USD_SOFR, null_index, qd, replica_handle, set_eval

D0, D1, D2 = date(2026, 10, 29), date(2026, 10, 30), date(2026, 11, 2)      # Thu, Fri (coupon date), Mon
SOFR_FIX = 0.0395                                                         # realised SOFR, every day so far
EFF, MAT = date(2026, 7, 30), date(2029, 7, 30)
N = 10_000_000.0


class FakeMarket:
    def __init__(self, as_of, quotes):
        self.as_of, self.curves = as_of, {"USD_SOFR": quotes}
    def quotes(self, cid): return self.curves.get(cid)
    def single(self, cid, tenor): return None
    def spot(self, pair): return None
    def override(self, cid, quotes):
        m = FakeMarket(self.as_of, self.curves["USD_SOFR"]); m.curves = {**self.curves, cid: quotes}; return m
    def with_single(self, cid, tenor, rate): return self
    def signature(self): return f"{self.as_of}|" + repr(sorted(self.curves.items()))


def _quotes(shift: dict[str, float] | None = None) -> list[dict]:
    shift = shift or {}
    return [{"tenor": t, "rate": r + shift.get(t, 0.0)} for t, r in USD_SOFR]


M0 = FakeMarket(D0, _quotes())
M1 = FakeMarket(D1, _quotes({"2Y": 0.03, "3Y": 0.04, "4Y": 0.03, "5Y": 0.02, "7Y": -0.01, "10Y": -0.02}))
M2 = FakeMarket(D2, _quotes({"2Y": 0.05, "3Y": 0.05, "4Y": 0.04, "5Y": 0.03, "7Y": -0.01, "10Y": -0.02}))


def _curve(d, mkt):
    return bootstrap_curve(d, [PillarQuote(q["tenor"], DEPOSIT if q["tenor"] == "ON" else OIS_SWAP, q["rate"] / 100) for q in mkt.quotes("USD_SOFR")])


PERIOD_STARTS = (date(2026, 7, 30), date(2026, 10, 30))


def _realised(d: date, start: date, end: date) -> float:
    """Simple rate realised from start to min(d, end), SOFR_FIX compounded daily (calendar days)."""
    n = (min(d, end) - start).days
    return ((1 + SOFR_FIX / 360) ** n - 1) * 360 / n


def _legs_at(trade, d):
    legs = [dict(lg) for lg in (getattr(trade, "_legs", None) or trade.legs)]
    for lg in legs:
        if lg["leg_type"] == "FLOAT":
            lg["fixings"] = {str(s): _realised(d, s, e) for s, e in zip(PERIOD_STARTS, PERIOD_STARTS[1:] + (date(2027, 1, 30),)) if s < d}
    return legs


def real_value(db, user, trade, d, mkt):
    r = price_swap("pnl", _legs_at(trade, d), {"USD_SOFR": _curve(d, mkt)}, d)
    return {"npv": r.npv, "ccy": "USD", "ir01": None, "ir01_disc": None, "spot01": None, "theta": None, "fallback": []}


def _trade(rate: float):
    legs = S._legs(EFF, MAT, rate, fixed_freq="QUARTERLY", float_freq="QUARTERLY")
    for i, lg in enumerate(legs):
        lg["id"] = f"L{i + 1}"
    return SimpleNamespace(id="T1", trade_ref="TRD-REF", instrument_type="IR_SWAP", status="CONFIRMED", notional=N, notional_ccy="USD",
                           discount_curve_id="USD_SOFR", forecast_curve_id="USD_SOFR", terms={}, trade_date=EFF, effective_date=EFF,
                           maturity_date=MAT, counterparty_id=None, user_id="u", desk="RATES", book="G10", legs=legs, structure="VANILLA",
                           asset_class="RATES")


def _ql_npv(trade, d, mkt) -> float:
    """QuantLib replica: Rijeka's curve for the day, SOFR fixings at SOFR_FIX for every day before d, the flow paying
    on d kept in the value (includeReferenceDateEvents), as Rijeka's pricer keeps it."""
    set_eval(d)
    ql.Settings.instance().includeReferenceDateEvents = True
    try:
        h = replica_handle(_curve(d, mkt))
        idx = null_index(h)
        x = ql.Date(30, 7, 2026)
        while x < qd(d):
            idx.addFixing(x, SOFR_FIX, True)
            x = x + 1
        legs = trade.legs
        sw = ql.Swap([S._ql_leg(legs[0], idx, market=False), S._ql_leg(legs[1], idx, market=False)], [True, False])
        sw.setPricingEngine(ql.DiscountingSwapEngine(h))
        v = sw.NPV()
        idx.clearFixings()
        return v
    finally:
        ql.Settings.instance().includeReferenceDateEvents = False


def _coupons_paid(trade, d):
    """Net coupon paying on d, from Rijeka's own cashflows on the previous close (what /price writes to the table)."""
    r = price_swap("pnl", _legs_at(trade, d), {"USD_SOFR": _curve(d, M0)}, d)
    return sum(cf.pv for lg in r.legs for cf in lg.cashflows if cf.payment_date == d)


@pytest.fixture
def real_pricer(monkeypatch):
    monkeypatch.setattr(E, "value", real_value)
    return monkeypatch


def test_marks_are_the_pricers_and_quantlib_agrees(real_pricer):
    real_pricer.setattr(E, "cash_settled", lambda db, trade, d0, d1: {})
    t = _trade(0.036)
    r = E.explain_trade(None, {"sub": "u"}, t, D0, D1, M0, M1)
    assert r["mark_prev"] == pytest.approx(_ql_npv(t, D0, M0), abs=1e-4)
    assert r["mark"] == pytest.approx(_ql_npv(t, D1, M1), abs=1e-4)


def test_rows_close_and_the_residual_is_zero_when_only_the_curve_moves(real_pricer):
    real_pricer.setattr(E, "cash_settled", lambda db, trade, d0, d1: {})
    r = E.explain_trade(None, {"sub": "u"}, _trade(0.036), D0, D1, M0, M1)
    buckets = [x["bucket"] for x in r["rows"]]
    assert buckets[0] == "CARRY" and "RATES" in buckets and "RESIDUAL" not in buckets
    assert sum(x["pnl"] for x in r["rows"]) == pytest.approx(r["mark"] - r["mark_prev"], abs=1e-6)


def _sqlite_cash(coupon: float):
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session
    eng = create_engine("sqlite://")
    s = Session(eng)
    s.execute(text("CREATE TABLE trade_legs (id TEXT, direction TEXT)"))
    s.execute(text("CREATE TABLE cashflows (trade_id TEXT, leg_id TEXT, currency TEXT, amount REAL, amount_override REAL, payment_date DATE)"))
    s.execute(text("INSERT INTO trade_legs VALUES ('L2', 'RECEIVE')"))
    s.execute(text("INSERT INTO cashflows VALUES ('T1', 'L2', 'USD', :a, NULL, :d)"), {"a": coupon, "d": D1})
    return s


def test_a_coupon_paying_today_is_pnl_once(real_pricer):
    t = _trade(0.036)
    coupon = _coupons_paid(t, D1)
    assert coupon > 0
    db = _sqlite_cash(coupon)
    assert E.cash_settled(db, t, D0, D1) == {}                                   # still in the mark at the close of its payment day
    assert E.cash_settled(db, t, D1, D2) == {"USD": pytest.approx(coupon)}       # left the mark, cash the next day
    day1 = E.explain_trade(db, {"sub": "u"}, t, D0, D1, M0, M1)
    day2 = E.explain_trade(db, {"sub": "u"}, t, D1, D2, M1, M2)
    total = sum(x["pnl"] for x in day1["rows"]) + sum(x["pnl"] for x in day2["rows"])
    # QuantLib: value on D2 (coupon gone) less value on D0, plus the coupon received in between
    ql_total = _ql_npv(t, D2, M2) - _ql_npv(t, D0, M0) + coupon
    assert total == pytest.approx(ql_total, abs=1.0)
    assert all(x["bucket"] != "CASH" for x in day1["rows"])
    assert [x for x in day2["rows"] if x["bucket"] == "CASH"][0]["pnl"] == pytest.approx(coupon)


def test_amend_step_equals_quantlib_difference(real_pricer):
    real_pricer.setattr(E, "cash_settled", lambda db, trade, d0, d1: {})
    new = _trade(0.037)
    old_legs = _trade(0.035).legs
    r = E.amended_trade(None, {"sub": "u"}, new, {"trade": {}, "legs": old_legs, "event_seq": 2}, D0, D1, M0, M1)
    amend = [x for x in r["rows"] if x["bucket"] == "AMEND"][0]["pnl"]
    old = _trade(0.035)
    assert amend == pytest.approx(_ql_npv(new, D1, M1) - _ql_npv(old, D1, M1), abs=1e-4)
    assert sum(x["pnl"] for x in r["rows"]) == pytest.approx(r["mark"] - r["mark_prev"], abs=1e-6)
