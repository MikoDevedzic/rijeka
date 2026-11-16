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


def test_what_a_firm_types_is_a_finite_number_in_range_and_a_text_with_an_end():
    """An instrument is shared by the whole firm and feeds every yield, carry and regime computed from it. JSON admits
    NaN and a numeric column stores it, so one such value would spoil the firm's figures: it is refused at the door,
    and a stored row that fails is skipped by its reader (collateral/store.firm_rows catches ValueError)."""
    ok = {"code": "X", "cls": "CASH", "yield_kind": "FIXED"}
    for bad in (float("nan"), float("inf"), float("-inf"), 10_001, -10_001, "abc", "1e400", 10 ** 400, [1], {"a": 1}):
        with pytest.raises(ValueError, match="yield_bp"):
            COL.instrument_from_row({**ok, "yield_bp": bad})
    assert COL.instrument_from_row({**ok, "yield_bp": -25.5}).yield_bp == -25.5 and COL.instrument_from_row({**ok, "yield_bp": ""}).yield_bp == 0.0
    for bad in (float("nan"), -0.01, 100.01, "x"):
        with pytest.raises(ValueError, match="csa_haircut_pct"):
            COL.instrument_from_row({**ok, "csa_haircut_pct": bad})
    assert COL.instrument_from_row({**ok, "csa_haircut_pct": 0}).csa_haircut_pct == 0.0 and COL.instrument_from_row({**ok, "csa_haircut_pct": ""}).csa_haircut_pct is None
    for bad in (0, -1, 2 ** 31, 1.5, float("nan"), "one", 10 ** 400):       # a whole number too long to be a float is refused, not a server error
        with pytest.raises(ValueError, match="chain_id"):
            COL.instrument_from_row({**ok, "chain_id": bad})
    assert COL.instrument_from_row({**ok, "chain_id": "11155111"}).chain_id == 11155111 and COL.instrument_from_row({**ok, "chain_id": ""}).chain_id is None
    for field, limit in (("name", COL.NAME_MAX), ("issuer", COL.NAME_MAX), ("note", COL.NOTE_MAX), ("yield_ref", COL.REF_MAX)):
        assert COL.instrument_from_row({**ok, field: "a" * limit})
        with pytest.raises(ValueError, match=field):
            COL.instrument_from_row({**ok, field: "a" * (limit + 1)})
    for bad in ("0x12 34", "a" * 101, "line\nbreak"):
        with pytest.raises(ValueError, match="token_address"):
            COL.instrument_from_row({**ok, "token_address": bad})
    assert COL.instrument_from_row({**ok, "token_address": " 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 "}).token_address == "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    for bad in ("U", "US DOLLAR", "usd$", "A" * 11, "US\nD"):
        with pytest.raises(ValueError, match="currency"):
            COL.instrument_from_row({**ok, "currency": bad})
    assert COL.instrument_from_row({**ok, "currency": " usd\n"}).currency == "USD"            # the space around it is not kept
    # every seed entry passes its own rule
    for inst in COL.SEED.values():
        assert COL.instrument_from_row({"code": inst.code, "name": inst.name, "cls": inst.cls, "currency": inst.currency, "issuer": inst.issuer, "rail": inst.rail,
                                        "yield_kind": inst.yield_kind, "yield_ref": inst.yield_ref, "yield_bp": inst.yield_bp, "chain_id": inst.chain_id,
                                        "token_address": inst.token_address, "csa_haircut_pct": inst.csa_haircut_pct, "note": inst.note}, firm=False).code == inst.code


def test_a_schedules_numbers_are_finite_and_in_range():
    for bad in (float("nan"), -1, 101, "x", 10 ** 400):
        with pytest.raises(ValueError, match="csa_haircut_pct"):
            _sched(eligible=[{"instrument": "USD_CASH", "csa_haircut_pct": bad}], posted={}, received={})
        with pytest.raises(ValueError, match="limit_pct"):
            _sched(eligible=[{"instrument": "USD_CASH", "limit_pct": bad}], posted={}, received={})
    for bad in (float("nan"), float("inf"), 1e13, "x", 10 ** 400):
        with pytest.raises(ValueError, match="weight"):
            _sched(posted={"USDC": bad})
    with pytest.raises(ValueError, match="note"):
        _sched(note="a" * (COL.NOTE_MAX + 1))
    assert _sched(note="a" * COL.NOTE_MAX).note


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
    assert r.instrument_yields_bp == {"UST_BILL": 400.0, "USDC": 0.0, "USD_CASH": 400.0}          # absolute, for display
    assert r.instrument_carry_bp == {"UST_BILL": 0.0, "USDC": -400.0, "USD_CASH": 0.0}            # over OIS, what the engines use
    assert r.yield_override_bp == {"GOVT": 0.0, "STABLECOIN": -400.0}
    # the IM pickup counts only the eligible part: the bill (at OIS: zero pickup), not the stablecoin
    assert r.im_pickup_bp() == pytest.approx(0.0)
    assert r.im_eligible_fraction() == pytest.approx(0.6)
    # the VM carries on the derived CSAs: posted 60 % bill at OIS and 40 % stablecoin at nothing; received cash at OIS
    eco = r.economic_csa()
    assert eco.vm_post_carry_bp == pytest.approx(-160.0) and eco.vm_recv_carry_bp == 0.0
    assert eco.collateral["posted"] == {"UST_BILL": pytest.approx(0.6), "USDC": pytest.approx(0.4)} and eco.collateral["rail"] == "on_chain"
    assert r.regulatory_csa().vm_post_carry_bp == pytest.approx(-160.0)
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
    strip = lambda d: {k: v for k, v in d.items() if k != "collateral"}       # the record of the instruments is the one addition
    assert strip(r.regulatory_csa().to_dict()) == strip(legacy.regulatory_csa().to_dict())
    assert strip(r.economic_csa().to_dict()) == strip(legacy.economic_csa().to_dict())
    assert r.economic_csa().vm_post_carry_bp == 0.0 and r.economic_csa().vm_recv_carry_bp == 0.0


def test_carry_over_ois():
    rate = lambda cid: {"USD_SOFR": 430.0, "EUR_ESTR": 200.0}.get(cid)
    assert COL.SEED["USD_CASH"].carry_bp(rate) == 0.0 and COL.SEED["UST_BILL"].carry_bp(rate) == 0.0
    assert COL.SEED["TOKENISED_MMF"].carry_bp(rate) == -10.0
    assert COL.SEED["USDC"].carry_bp(rate) == -430.0 and COL.SEED["ETH"].carry_bp(rate) == -430.0
    assert COL.SEED["BUND"].carry_bp(rate) == 0.0
    fixed = COL.instrument_from_row({"code": "F", "cls": "FUND_SHARES_TOKENISED", "yield_kind": "FIXED", "yield_bp": 445})
    assert fixed.carry_bp(rate) == pytest.approx(15.0)
    other = COL.instrument_from_row({"code": "O", "cls": "GOVT", "currency": "USD", "yield_kind": "CURVE", "yield_ref": "EUR_ESTR", "yield_bp": 5})
    assert other.carry_bp(rate) == pytest.approx(200.0 - 430.0 + 5.0)
    # no market: a spread stands, a fixed rate and nothing count zero carry rather than a guess
    assert COL.SEED["TOKENISED_MMF"].carry_bp(None) == -10.0 and fixed.carry_bp(None) == 0.0 and COL.SEED["USDC"].carry_bp(None) == 0.0
