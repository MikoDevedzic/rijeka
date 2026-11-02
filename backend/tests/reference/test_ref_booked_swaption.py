"""A booked swaption in P&L, VaR, stress and the ladder is the option, not its underlying swap.

The legacy ticket books an IR_SWAPTION as the underlying swap's two legs with the swap's terms; the
shared valuation (pnl/valuation.value, which P&L, full-revaluation VaR, stress and the key-rate ladder
all call) used to send it to the swap pricer, so an at-the-money payer showed close to zero value, a
full swap delta and no vega. It now prices the option: expiry at the fixed leg's forward start, strike
its rate, payer if we pay fixed (ccr/options.swaption_terms, as the exposure engine reads it), vol the
nearest point of the day's {CCY}_SWVOL_ATM grid. Checked against QuantLib's Bachelier engine."""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest
import QuantLib as ql

from pnl.valuation import value
from tests.reference.refmarket import USD_SOFR, VAL, null_index, qd, replica_handle, rijeka_curve, set_eval

N = 10_000_000.0
EXPIRY, START, MAT = date(2027, 11, 3), date(2027, 11, 3), date(2032, 11, 3)


class Mkt:
    as_of = VAL
    def __init__(self, vols): self.vols = vols
    def quotes(self, cid):
        if cid == "USD_SOFR":
            return [{"tenor": t, "rate": r, "quote_type": "OISDeposit" if t == "ON" else "OIS"} for t, r in USD_SOFR]
        if cid == "USD_SWVOL_ATM":
            return self.vols
        return None
    def snapshot_date(self, cid): return VAL


def _trade(K: float, pay_fixed: bool):
    legs = [{"id": "L1", "leg_seq": 1, "leg_type": "FIXED", "direction": "PAY" if pay_fixed else "RECEIVE", "currency": "USD", "notional": N,
             "effective_date": str(START), "maturity_date": str(MAT), "day_count": "ACT/360", "payment_frequency": "ANNUAL",
             "bdc": "UNADJUSTED", "payment_lag": 0, "fixed_rate": K, "discount_curve_id": "USD_SOFR"},
            {"id": "L2", "leg_seq": 2, "leg_type": "FLOAT", "direction": "RECEIVE" if pay_fixed else "PAY", "currency": "USD", "notional": N,
             "effective_date": str(START), "maturity_date": str(MAT), "day_count": "ACT/360", "payment_frequency": "ANNUAL",
             "bdc": "UNADJUSTED", "payment_lag": 0, "discount_curve_id": "USD_SOFR", "forecast_curve_id": "USD_SOFR"}]
    return SimpleNamespace(id="S1", trade_ref="TRD-SWPN", instrument_type="IR_SWAPTION", status="CONFIRMED", notional=N, notional_ccy="USD",
                           discount_curve_id="USD_SOFR", forecast_curve_id="USD_SOFR", terms={"direction": "PAY" if pay_fixed else "RECEIVE"},
                           trade_date=VAL, effective_date=START, maturity_date=MAT, user_id="u", _legs=legs)


def _ql_price(K, payer, vol_bp):
    set_eval(VAL)
    h = replica_handle(rijeka_curve())
    sch = ql.Schedule(qd(START), qd(MAT), ql.Period(1, ql.Years), ql.NullCalendar(), ql.Unadjusted, ql.Unadjusted, ql.DateGeneration.Backward, False)
    ois = ql.OvernightIndexedSwap(ql.Swap.Payer if payer else ql.Swap.Receiver, N, sch, K, ql.Actual360(), null_index(h))
    sw = ql.Swaption(ois, ql.EuropeanExercise(qd(EXPIRY)))
    sw.setPricingEngine(ql.BachelierSwaptionEngine(h, ql.QuoteHandle(ql.SimpleQuote(vol_bp / 1e4)), ql.Actual365Fixed()))
    ois.setPricingEngine(ql.DiscountingSwapEngine(h))
    return sw.NPV(), ois.NPV(), ois.fairRate()


def test_booked_swaption_is_valued_as_the_option():
    vols = [{"tenor": "1Yx5Y", "rate": 91.5}, {"tenor": "2Yx5Y", "rate": 88.0}, {"tenor": "1Yx10Y", "rate": 86.0}]
    _, _, F = _ql_price(0.035, True, 91.5)
    for K, payer in ((F, True), (F, False), (F + 0.005, True)):
        v = value(None, {"sub": "u"}, _trade(K, payer), VAL, Mkt(vols))
        opt, swap, _ = _ql_price(K, payer, 91.5)
        assert abs(v["npv"] - opt) < 1e-6 * N, (K, payer, v["npv"], opt)
        assert abs(v["npv"] - swap) > 0.5 * opt                     # not the underlying swap any more
        assert v["vega"] > 0 and "Bachelier 91.5bp" in v["model"]
        assert (v["ir01"] > 0) == payer                              # a payer gains when rates rise


def test_sold_swaption_and_booked_terms():
    vols = [{"tenor": "1Yx5Y", "rate": 91.5}]
    _, _, F = _ql_price(0.035, True, 91.5)
    bought = _trade(F, True)
    sold = _trade(F, True)
    sold.terms = {**sold.terms, "side": "SELL", "option": "SWAPTION", "expiry_date": str(EXPIRY), "strike": F, "is_payer": True, "vol_bp": 90.0}
    vb = value(None, {"sub": "u"}, bought, VAL, Mkt(vols))
    vs = value(None, {"sub": "u"}, sold, VAL, Mkt(vols))
    assert vs["npv"] == pytest.approx(-vb["npv"]) and vs["vega"] == pytest.approx(-vb["vega"]) and vs["ir01"] == pytest.approx(-vb["ir01"])
    assert "sold" in vs["model"] and "bought" in vb["model"]
    # a booked strike overrides the leg's rate, and the day's grid vol is used for marking, not the booked vol
    struck = _trade(F, True)
    struck.terms = {**struck.terms, "strike": F + 0.005, "expiry_date": str(EXPIRY)}
    assert value(None, {"sub": "u"}, struck, VAL, Mkt(vols))["npv"] == pytest.approx(_ql_price(F + 0.005, True, 91.5)[0], abs=1e-6 * N)


def test_desk_default_vol_when_the_grid_is_missing_and_it_says_so():
    v = value(None, {"sub": "u"}, _trade(0.035, True), VAL, Mkt(None))
    assert "desk default" in v["model"]
    assert abs(v["npv"] - _ql_price(0.035, True, 85.0)[0]) < 1e-6 * N
