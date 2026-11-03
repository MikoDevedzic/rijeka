"""Collateral classes and regimes: the catalogue's invariants and the two CSAs a regime derives."""
import pytest

from pricing.collateral import CATALOGUE, HAIRCUTS, PRESET_NAMES, Regime, from_request, preset, regime_from_counterparty
from pricing.csa import CSA


def test_catalogue_invariants():
    for c in CATALOGUE.values():
        assert c.sources, c.code
        row = HAIRCUTS[c.haircut_row]
        assert all(row[i] <= row[i + 1] for i in range(len(row) - 1)), "haircuts rise with residual maturity"
        assert c.crm in ("RECOGNISED", "LOOK_THROUGH", "NOT_RECOGNISED")
    assert CATALOGUE["CASH"].haircut_pct(0.5) == 0.0
    assert CATALOGUE["GOVT"].haircut_pct(0.5) == 0.5 and CATALOGUE["GOVT"].haircut_pct(4.0) == 2.0 and CATALOGUE["GOVT"].haircut_pct(12.0) == 4.0
    assert CATALOGUE["STABLECOIN"].crm == "NOT_RECOGNISED" and CATALOGUE["STABLECOIN"].im_eligible == "NO"
    assert CATALOGUE["CRYPTO_2B"].sco60_group == "2b"


def test_all_recognised_regime_reproduces_the_bilateral_csa():
    base = CSA.bilateral(threshold_cp=1e6, mta=1e5, im_exchanged=True)
    r = preset("CASH_GOVT", base)
    r.posted = r.received = {"CASH": 1.0}
    reg, eco = r.regulatory_csa(), r.economic_csa()
    for k in ("collateralised", "threshold_cp", "threshold_own", "mta", "mpor_days", "im_exchanged", "settlement"):
        assert getattr(reg, k) == getattr(base, k) == getattr(eco, k), k
    assert reg.crm_recognised and reg.collateral_haircut == 0.0 and reg.sa_ccr_margined
    assert r.recognised_fraction() == 1.0 and r.im_eligible_fraction() == 1.0


def test_government_securities_carry_their_haircut_into_the_regulatory_csa_only():
    r = preset("CASH_GOVT", collateral_maturity_y=4.0)       # GOVT posted and received, 3–5y bucket: 2 %
    assert r.recognised_fraction() == pytest.approx(0.98)
    assert r.regulatory_csa().collateral_haircut == pytest.approx(0.02)
    assert r.economic_csa().collateral_haircut == 0.0


def test_stablecoin_regime_is_unmargined_for_capital_and_gross_when_unenforceable():
    r = preset("PLUS_STABLECOIN")
    assert not r.netting_enforceable
    reg, eco = r.regulatory_csa(), r.economic_csa()
    assert not reg.crm_recognised and not reg.sa_ccr_margined and not reg.im_exchanged
    assert not eco.collateralised and "UNENFORCEABLE" in eco.preset
    assert r.im_eligible_fraction() == 0.0 and r.im_pickup_bp() == 0.0
    # the literal alternative reading: enforceable but unrecognised → economically collateralised, capital unmargined
    r2 = preset("PLUS_STABLECOIN", netting_enforceable=True)
    assert r2.economic_csa().collateralised and not r2.regulatory_csa().sa_ccr_margined


def test_tokenised_sovereign_states():
    r = preset("PLUS_TOKENISED_SOVEREIGN")
    assert r.mpor_state == "ON_CHAIN"
    reg = r.regulatory_csa()
    assert reg.settlement == "on_chain" and reg.mpor_days == 5.0 and reg.crm_recognised and reg.im_exchanged
    assert r.hqla_level("GOVT_TOKENISED") == "L2A"
    r.hqla_state = "CEILING"
    assert r.hqla_level("GOVT_TOKENISED") == "L1"
    assert r.hqla_value(100.0)["total"] == pytest.approx(100.0)
    r.hqla_state = "FLOOR"
    assert r.hqla_value(100.0)["total"] == pytest.approx(85.0)
    r.im_eligibility_state = "PRE"
    assert r.im_eligible_fraction() == 0.0 and not r.regulatory_csa().im_exchanged
    r.mpor_state = "FLOOR"
    assert r.regulatory_csa().mpor_days == 10.0


def test_tokenised_fund_looks_through_at_the_worst_holding_haircut():
    r = preset("PLUS_TOKENISED_FUND", collateral_maturity_y=0.5)
    assert r.recognised_fraction() == pytest.approx(0.99)
    assert r.regulatory_csa().sa_ccr_margined


def test_mixed_composition_and_yield_pickup():
    r = Regime("MIX", CSA.bilateral(im_exchanged=True), ["CASH", "GOVT", "STABLECOIN"], posted={"GOVT": 0.5, "STABLECOIN": 0.5},
               received={"CASH": 0.5, "STABLECOIN": 0.5}, yield_override_bp={"GOVT": 400.0})
    assert r.recognised_fraction() == pytest.approx(0.5)
    assert r.regulatory_csa().collateral_haircut == pytest.approx(0.5)
    assert r.im_eligible_fraction() == pytest.approx(0.5) and r.im_pickup_bp() == pytest.approx(200.0)
    steps = {e["step"] for e in r.explain()}
    assert {"recognition", "enforceability", "initial margin", "margin period of risk"} <= steps


def test_requests_and_errors():
    for n in PRESET_NAMES:
        assert from_request(n).name == n
    r = from_request({"preset": "CASH_GOVT", "collateral_maturity_y": 7.0, "name": "MINE"})
    assert r.name == "MINE" and r.collateral_maturity_y == 7.0
    r = from_request({"name": "X", "eligible": ["CASH", "GOVT"], "posted": {"CASH": 1}, "received": {"GOVT": 1}, "csa": {"preset": "BILATERAL", "mpor_days": 12}})
    assert r.csa.mpor_days == 12 and r.regulatory_csa().sa_ccr_margined
    with pytest.raises(ValueError):
        preset("NOPE")
    with pytest.raises(ValueError):
        Regime("B", CSA.bilateral(), ["CASH"], posted={"STABLECOIN": 1.0}).im_eligible_fraction()


def test_regime_from_counterparty_defaults_and_fields():
    class CP:
        eligible_collateral = None; posted_composition = None; received_composition = None; netting_enforceable = None
    r = regime_from_counterparty(CP(), CSA.bilateral(im_exchanged=True))
    assert r.eligible == ["CASH", "GOVT"] and r.posted == {"CASH": 1.0} and r.netting_enforceable
    class CP2:
        eligible_collateral = ["CASH", "STABLECOIN"]; posted_composition = {"STABLECOIN": 1.0}; received_composition = {"STABLECOIN": 1.0}; netting_enforceable = False
    r2 = regime_from_counterparty(CP2(), CSA.bilateral())
    assert not r2.regulatory_csa().sa_ccr_margined and not r2.economic_csa().collateralised
