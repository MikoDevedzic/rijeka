"""Amendments in the P&L: the market steps run on the terms that stood at the previous close, and one
AMEND step closes the gap to today's mark on today's market."""
from datetime import date
from types import SimpleNamespace

import pytest

from pnl import explain as E


class FakeMarket:
    """Enough of pnl.market.Market for explain_trade: one curve, overrides, a signature."""
    def __init__(self, as_of, curves):
        self.as_of, self.curves = as_of, curves
    def quotes(self, cid): return self.curves.get(cid)
    def single(self, cid, tenor):
        for q in self.quotes(cid) or []:
            if q["tenor"] == tenor: return float(q["rate"])
        return None
    def spot(self, pair): return self.single(f"{pair}_SPOT", "SPOT")
    def override(self, cid, quotes): return FakeMarket(self.as_of, {**self.curves, cid: quotes})
    def with_single(self, cid, tenor, rate): return self.override(cid, [{"tenor": tenor, "rate": rate}])
    def signature(self): return f"{self.as_of}|" + "|".join(f"{k}={v}" for k, v in sorted(self.curves.items()))


D0, D1 = date(2026, 10, 29), date(2026, 10, 30)
Q0 = [{"tenor": "ON", "rate": 4.0}, {"tenor": "2Y", "rate": 4.2}, {"tenor": "10Y", "rate": 4.5}]
Q1 = [{"tenor": "ON", "rate": 4.0}, {"tenor": "2Y", "rate": 4.3}, {"tenor": "10Y", "rate": 4.5}]      # the 1-5Y bucket moves
M0, M1 = FakeMarket(D0, {"USD_SOFR": Q0}), FakeMarket(D1, {"USD_SOFR": Q1})


def fake_value(db, user, trade, d, mkt):
    """A toy swap: receive fixed on notional, against the 2Y par rate, with a day of carry. Exact and deterministic."""
    legs = getattr(trade, "_legs", None) or getattr(trade, "legs")
    fixed = next(l for l in legs if l["leg_type"] == "FIXED")
    r2y = mkt.single("USD_SOFR", "2Y") / 100.0
    years = 2.0 - (d - D0).days / 365.0
    npv = float(fixed["notional"]) * (float(fixed["fixed_rate"]) - r2y) * years * 1e2
    return {"npv": npv, "ccy": "USD", "ir01": -float(fixed["notional"]) * 1e-4 * years, "ir01_disc": 0.0, "spot01": None, "theta": -1.0, "fallback": []}


def _trade(notional, rate):
    legs = [{"id": "L1", "leg_type": "FIXED", "notional": notional, "fixed_rate": rate, "currency": "USD"},
            {"id": "L2", "leg_type": "FLOAT", "notional": notional, "fixed_rate": 0.0, "currency": "USD"}]
    return SimpleNamespace(id="T1", trade_ref="TRD-1", instrument_type="IR_SWAP", structure="VANILLA", asset_class="RATES", status="CONFIRMED",
                           notional=notional, notional_ccy="USD", discount_curve_id="USD_SOFR", forecast_curve_id=None, terms={},
                           trade_date=date(2026, 1, 5), effective_date=date(2026, 1, 7), maturity_date=date(2028, 1, 7), counterparty_id=None,
                           user_id="u", desk="RATES", book="G10", legs=legs)


@pytest.fixture(autouse=True)
def _pure(monkeypatch):
    monkeypatch.setattr(E, "value", fake_value)
    monkeypatch.setattr(E, "cash_settled", lambda db, trade, d0, d1: {})


def test_order_and_group_carry_the_amend_bucket():
    assert E.ORDER == ["CARRY", "CASH", "RATES", "FX", "RESIDUAL", "AMEND", "NEW", "UNWIND"]
    assert E.GROUP["AMEND"] == "TRADING"


def test_amend_step_is_new_minus_old_on_todays_market_and_market_steps_use_old_terms():
    new = _trade(10_000_000, 0.045)                     # today's row: notional and rate amended
    old_state = {"trade": {"notional": 5_000_000}, "legs": [{"id": "L1", "leg_type": "FIXED", "notional": 5_000_000, "fixed_rate": 0.040, "currency": "USD"},
                                                             {"id": "L2", "leg_type": "FLOAT", "notional": 5_000_000, "fixed_rate": 0.0, "currency": "USD"}], "event_seq": 3}
    old = E.shadow_trade(new, old_state)
    assert old.id == "T1#pre" and old._cash_id == "T1" and old.notional == 5_000_000 and old.instrument_type == "IR_SWAP"

    r = E.amended_trade(None, {"sub": "u"}, new, old_state, D0, D1, M0, M1)
    rows = {x["bucket"]: x["pnl"] for x in r["rows"]}
    npv = lambda t, d, m: fake_value(None, None, t, d, m)["npv"]
    # the market part is the old trade's explain: carry on yesterday's market, the 1-5Y bucket move, no residual
    assert rows["CARRY"] == pytest.approx(npv(old, D1, M0) - npv(old, D0, M0))
    assert rows["RATES"] == pytest.approx(npv(old, D1, M1) - npv(old, D1, M0))
    assert "RESIDUAL" not in rows
    # the amendment is exactly new terms less old terms, both on today's market
    assert rows["AMEND"] == pytest.approx(npv(new, D1, M1) - npv(old, D1, M1))
    # bookkeeping: yesterday's mark is the old trade's, today's the new one's, the rows sum to the change
    assert r["mark_prev"] == pytest.approx(npv(old, D0, M0)) and r["mark"] == pytest.approx(npv(new, D1, M1))
    assert sum(x["pnl"] for x in r["rows"]) == pytest.approx(r["mark"] - r["mark_prev"])
    assert r["kind"] == "AMENDED" and r["trade_id"] == "T1" and r["amended_from_seq"] == 3
    assert r["total_by_ccy"]["USD"] == pytest.approx(r["mark"] - r["mark_prev"])


def test_unamended_trade_is_unchanged_by_the_new_path():
    t = _trade(10_000_000, 0.045)
    plain = E.explain_trade(None, {"sub": "u"}, t, D0, D1, M0, M1)
    assert {x["bucket"] for x in plain["rows"]} <= {"CARRY", "RATES", "RESIDUAL"}
    assert sum(x["pnl"] for x in plain["rows"]) == pytest.approx(plain["mark"] - plain["mark_prev"])


class _DB:
    def __init__(self, rows): self.rows = rows
    def execute(self, sql, params=None):
        rows = self.rows
        class R:
            def all(_self): return rows
        return R()
    def rollback(self): pass


def _ev(seq, et, when, pre=None, payload=None):
    return SimpleNamespace(event_seq=seq, event_type=et, event_date=when, tx_time=None, payload=payload or {}, pre_state=pre or {})


def test_amendment_state_uses_the_first_amendment_in_the_window():
    booked = {"trade": {"id": "T1", "notional": 5_000_000, "status": "PENDING"}, "legs": [{"id": "L1", "leg_type": "FIXED", "notional": 5_000_000, "fixed_rate": 0.04}]}
    rows = [_ev(1, "BOOKED", date(2026, 1, 5), payload=booked), _ev(2, "CONFIRMED", date(2026, 1, 5)),
            _ev(3, "AMENDED", date(2026, 10, 30), pre={"trade": {"notional": 5_000_000}, "legs": booked["legs"]}, payload={"changes": {"legs": [{"id": "L1", "fixed_rate": 0.045}]}}),
            _ev(4, "AMENDED", date(2026, 10, 30), pre={"trade": {"notional": 5_000_000}, "legs": [{"id": "L1", "leg_type": "FIXED", "notional": 5_000_000, "fixed_rate": 0.045}]})]
    t = _trade(10_000_000, 0.05)
    st = E.amendment_state_at(_DB(rows), t, D0, D1)
    assert st["event_seq"] == 3 and st["legs"][0]["fixed_rate"] == 0.04          # the terms at d0, not the intermediate ones
    assert E.amendment_state_at(_DB(rows), t, date(2026, 10, 30), date(2026, 10, 31)) is None   # amended on d0 itself: already in yesterday's mark
    assert E.amendment_state_at(_DB(rows[:2]), t, D0, D1) is None


def test_amendment_state_falls_back_to_the_projection_when_pre_state_is_empty():
    booked = {"trade": {"id": "T1", "notional": 5_000_000, "status": "PENDING", "trade_ref": "TRD-1"}, "legs": [{"id": "L1", "leg_type": "FIXED", "notional": 5_000_000, "fixed_rate": 0.04}]}
    rows = [_ev(1, "BOOKED", date(2026, 1, 5), payload=booked),
            _ev(2, "AMENDED", date(2026, 10, 30), pre={}, payload={"changes": {"legs": [{"id": "L1", "fixed_rate": 0.045}]}})]
    st = E.amendment_state_at(_DB(rows), _trade(5_000_000, 0.045), D0, D1)
    assert st and st["legs"][0]["fixed_rate"] == 0.04 and st["trade"]["notional"] == 5_000_000


def test_legs_for_pricer_completes_old_legs_from_the_trade():
    from pnl.valuation import legs_for_pricer
    t = _trade(5_000_000, 0.04)
    old = E.shadow_trade(t, {"trade": {}, "legs": [{"id": "L1", "leg_ref": "FIXED-1", "leg_seq": 1, "leg_type": "FIXED", "direction": "PAY", "currency": "USD", "notional": 5_000_000, "fixed_rate": 0.04},
                                                   {"id": "L2", "leg_ref": "FLOAT-1", "leg_seq": 2, "leg_type": "FLOAT", "direction": "RECEIVE", "currency": "USD", "notional": 5_000_000}]})
    legs = legs_for_pricer(old)
    assert legs[0]["effective_date"] == "2026-01-07" and legs[0]["maturity_date"] == "2028-01-07" and legs[0]["discount_curve_id"] == "USD_SOFR"
    assert legs[1]["forecast_curve_id"] == "USD_SOFR" and legs[0]["payment_frequency"] in ("ANNUAL", "QUARTERLY") and legs[0]["notional"] == 5_000_000.0
