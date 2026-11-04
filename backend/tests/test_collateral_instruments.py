"""Instruments and schedules: the public seed's invariants, a firm's row, a schedule validated against the list, and
the regime a schedule derives (classes, rail, yields) against the class-level regime it replaces."""
import pytest

from pricing import collateral as COL
from pricing.csa import CSA
from collateral.regimes import class_fields


def test_seed_invariants():
    assert {"USD_CASH", "UST_BILL", "USDC", "USDT", "TOKENISED_MMF", "TOKENISED_TBILL", "BTC", "ETH"} <= set(COL.SEED)
    for inst in COL.SEED.values():
        assert inst.cls in COL.CATALOGUE and inst.rail in COL.RAILS and inst.yield_kind in COL.YIELD_KINDS and not inst.firm
        assert inst.yield_kind != "CURVE" or inst.yield_ref, inst.code
    assert COL.SEED["USDC"].klass.crm == "NOT_RECOGNISED" and COL.SEED["USDC"].rail == "on_chain" and COL.SEED["USDC"].token_address
    assert COL.SEED["USD_CASH"].to_dict()["im_eligible"] == "YES"


def test_yield_resolution():
    rate = lambda cid: {"USD_SOFR": 430.0}.get(cid)
    assert COL.SEED["USD_CASH"].resolve_yield_bp(rate) == 430.0
    assert COL.SEED["TOKENISED_MMF"].resolve_yield_bp(rate) == 420.0          # the curve less 10 bp
    assert COL.SEED["TOKENISED_MMF"].resolve_yield_bp(None) == -10.0           # no market: the spread alone
    assert COL.SEED["USDC"].resolve_yield_bp(rate) == 0.0
    fixed = COL.instrument_from_row({"code": "my fund", "cls": "FUND_SHARES_TOKENISED", "yield_kind": "FIXED", "yield_bp": 415})
    assert fixed.code == "MY_FUND" and fixed.resolve_yield_bp(rate) == 415.0 and fixed.firm and fixed.rail == "on_chain"


def test_instrument_validation():
    with pytest.raises(ValueError):
        COL.instrument_from_row({"code": "X", "cls": "NOPE"})
    with pytest.raises(ValueError):
        COL.instrument_from_row({"code": "X", "cls": "CASH", "rail": "carrier pigeon"})
    with pytest.raises(ValueError):
        COL.instrument_from_row({"code": "X", "cls": "CASH", "yield_kind": "GUESS"})
    with pytest.raises(ValueError):
        COL.instrument_from_row({"code": "", "cls": "CASH"})
    with pytest.raises(ValueError):
        COL.instrument_from_row({"code": "X", "cls": "GOVT", "csa_haircut_pct": 120})


def _sched(**kw):
    body = {"eligible": [{"instrument": "USD_CASH"}, {"instrument": "UST_BILL", "csa_haircut_pct": 1.0}, {"instrument": "USDC", "im": False}],
            "posted": {"UST_BILL": 60, "USDC": 40}, "received": {"USD_CASH": 1}, "rail": "on_chain"}
    body.update(kw)
    return COL.schedule_from_request(body, COL.SEED)


def test_schedule_validation_and_normalisation():
    s = _sched()
    assert [e["instrument"] for e in s.eligible] == ["USD_CASH", "UST_BILL", "USDC"]
    assert s.eligible[1]["csa_haircut_pct"] == 1.0 and s.eligible[2]["im"] is False and s.eligible[2]["vm"] is True
    assert s.posted == {"UST_BILL": pytest.approx(0.6), "USDC": pytest.approx(0.4)} and s.received == {"USD_CASH": 1.0}
    assert s.rail == "on_chain"
    with pytest.raises(ValueError):
        _sched(posted={"BTC": 1})                      # not on the eligible list
    with pytest.raises(ValueError):
        _sched(eligible=[])
    with pytest.raises(ValueError):
        _sched(posted={"USDC": -1})
    with pytest.raises(ValueError):
        _sched(rail="airmail")
    assert _sched(posted={}).posted == {"USD_CASH": 1.0}       # blank: the first eligible instrument


def test_regime_from_schedule_aggregates_by_class_and_resolves_yields():
    rate = lambda cid: {"USD_SOFR": 400.0}.get(cid)
    csa = CSA.bilateral(threshold_cp=1e6, mta=1e5, im_exchanged=True)
    r = COL.regime_from_schedule(_sched(), csa, COL.SEED, curve_rate_bp=rate)
    assert r.name == "COUNTERPARTY" and r.eligible == ["CASH", "GOVT", "STABLECOIN"]
    assert r.posted == {"GOVT": pytest.approx(0.6), "STABLECOIN": pytest.approx(0.4)} and r.received == {"CASH": 1.0}
    assert r.mpor_state == "ON_CHAIN" and r.regulatory_csa().mpor_days == 5.0 and r.regulatory_csa().settlement == "on_chain"
    assert r.instrument_yields_bp == {"UST_BILL": 400.0, "USDC": 0.0, "USD_CASH": 400.0}
    assert r.yield_override_bp == {"GOVT": 400.0, "STABLECOIN": 0.0}
    # the IM pickup counts only the eligible part: the bill, not the stablecoin
    assert r.im_pickup_bp() == pytest.approx(0.6 * 400.0)
    assert r.im_eligible_fraction() == pytest.approx(0.6)
    assert r.recognised_fraction("received") == 1.0                       # cash received, fully recognised
    assert r.to_dict()["posted_instruments"] == {"UST_BILL": pytest.approx(0.6), "USDC": pytest.approx(0.4)}
    # the class-level fields the record keeps in step
    assert class_fields(_sched(), COL.SEED) == {"eligible_collateral": ["CASH", "GOVT", "STABLECOIN"],
                                                "posted_composition": {"GOVT": pytest.approx(0.6), "STABLECOIN": pytest.approx(0.4)},
                                                "received_composition": {"CASH": 1.0}}


def test_cash_schedule_equals_the_class_level_regime():
    """A cash-only schedule on a bilateral rail is the pre-schedule regime field for field (today's numbers)."""
    csa = CSA.bilateral(threshold_cp=5e5, mta=1e5, im_exchanged=True)
    s = COL.schedule_from_request({"eligible": [{"instrument": "USD_CASH"}, {"instrument": "UST_NOTE"}], "posted": {"USD_CASH": 1}, "received": {"USD_CASH": 1}}, COL.SEED)
    r = COL.regime_from_schedule(s, csa, COL.SEED)

    class CP:
        eligible_collateral = ["CASH", "GOVT"]; posted_composition = {"CASH": 1.0}; received_composition = {"CASH": 1.0}; netting_enforceable = None
    legacy = COL.regime_from_counterparty(CP(), csa)
    for k in ("eligible", "posted", "received", "netting_enforceable", "mpor_state"):
        assert getattr(r, k) == getattr(legacy, k), k
    assert r.regulatory_csa().to_dict() == legacy.regulatory_csa().to_dict()
    assert r.economic_csa().to_dict() == legacy.economic_csa().to_dict()
