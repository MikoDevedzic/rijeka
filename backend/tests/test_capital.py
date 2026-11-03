"""Capital formulas and tables against the paragraphs they cite."""
import math

import pytest

from pricing.capital import (CapitalInputs, RISK_WEIGHTS, CVA_WEIGHTS, cva_weight, effective_maturity, k_ccr, k_cva_reduced,
                             leverage_exposure, quote_advantage, risk_weight, rwa, scva, supervisory_df, tables)


def test_risk_weight_tables_cell_by_cell():
    assert RISK_WEIGHTS["SOVEREIGN"] == {"AAA_AA": 0.0, "A": 0.2, "BBB": 0.5, "BB_B": 1.0, "BELOW_B": 1.5, "UNRATED": 1.0}       # CRE20.7
    assert RISK_WEIGHTS["BANK"] == {"AAA_AA": 0.2, "A": 0.3, "BBB": 0.5, "BB_B": 1.0, "BELOW_B": 1.5, "UNRATED": 1.0}            # CRE20.18
    assert RISK_WEIGHTS["CORPORATE"] == {"AAA_AA": 0.2, "A": 0.5, "BBB": 0.75, "BB_B": 1.0, "BELOW_B": 1.5, "UNRATED": 1.0}      # CRE20.42–43
    assert risk_weight("BANK", "A") == (0.30, "CRE20.18 Table 6 (base)")
    assert risk_weight("BROKER_DEALER", "A")[0] == 0.30 and risk_weight("BROKER_DEALER", "A", prudentially_supervised=False)[0] == 0.50
    assert risk_weight("FUND", "UNRATED")[0] == 1.0 and risk_weight("CRYPTO_NATIVE", "BBB")[0] == 0.75
    assert risk_weight("CORPORATE", "UNRATED", override=1.5) == (1.5, "firm override")
    with pytest.raises(ValueError):
        risk_weight("HEDGE_FUND")
    with pytest.raises(ValueError):
        risk_weight("BANK", "AAA")


def test_cva_weight_table():
    assert CVA_WEIGHTS["FINANCIAL"] == {"IG": 0.05, "HY": 0.12} and CVA_WEIGHTS["SOVEREIGN"] == {"IG": 0.005, "HY": 0.02}
    assert cva_weight("FINANCIAL", "BBB")[0] == 0.05 and cva_weight("FINANCIAL", "UNRATED")[0] == 0.12
    assert cva_weight(None, "A", "BANK")[0] == 0.05 and cva_weight(None, "BB_B", "CRYPTO_NATIVE")[0] == 0.12
    assert cva_weight("TECHNOLOGY", "AAA_AA") == (0.02, "MAR50.16 Table 1 (TECHNOLOGY, IG)")


def test_supervisory_df_and_scva():
    assert supervisory_df(0.0) == 1.0
    for m in (1.0, 2.5, 5.0):
        assert supervisory_df(m) == pytest.approx((1 - math.exp(-0.05 * m)) / (0.05 * m))
    # one counterparty, by hand: EAD 1,000,000, M 2.5, financial IG 5 %
    s = scva(1_000_000, 2.5, 0.05)
    assert s == pytest.approx((1 / 1.4) * 0.05 * 2.5 * 1_000_000 * supervisory_df(2.5))
    assert k_cva_reduced([s]) == pytest.approx(0.65 * s)                 # sqrt(0.25 s² + 0.75 s²) = s


def test_k_cva_aggregation_over_three_counterparties_by_hand():
    s = [100.0, 200.0, 300.0]
    expect = 0.65 * math.sqrt((0.5 * 600) ** 2 + 0.75 * (100 ** 2 + 200 ** 2 + 300 ** 2))
    assert k_cva_reduced(s) == pytest.approx(expect)
    assert k_cva_reduced(s) < 0.65 * sum(s)                           # diversification across counterparties
    assert k_cva_reduced([]) == 0.0


def test_ccr_capital_and_leverage():
    assert rwa(1000.0, 0.5) == 500.0 and k_ccr(1000.0, 0.5) == 40.0
    assert leverage_exposure(V=100.0, cash_vm_received=100.0, addon=50.0) == pytest.approx(1.4 * 50.0)
    assert leverage_exposure(V=100.0, cash_vm_received=0.0, addon=50.0) == pytest.approx(1.4 * 150.0)
    assert leverage_exposure(V=-100.0, cash_vm_received=0.0, addon=50.0) == pytest.approx(1.4 * 50.0)


def test_effective_maturity_and_quote_advantage():
    assert effective_maturity([{"notional": 100, "maturity_y": 2}, {"notional": 300, "maturity_y": 6}]) == pytest.approx(5.0)
    assert effective_maturity([]) == 0.0
    q = quote_advantage(delta_cost=10_000.0, notional=10_000_000.0, m_years=5.0, rate=0.04)
    assert q["upfront_bp"] == pytest.approx(10.0)
    assert q["running_bp"] == pytest.approx(10.0 / ((1 - math.exp(-0.2)) / 0.04))
    assert quote_advantage(1.0, 0.0, 5.0, 0.04)["running_bp"] == 0.0


def test_capital_inputs_for_counterparty():
    ci = CapitalInputs.for_counterparty("BANK", "A", hurdle=0.10)
    assert ci.rw == 0.30 and ci.s_c == 0.05 and ci.sector == "FINANCIAL" and ci.hurdle == 0.10
    assert "CRE20.18" in ci.rw_source and "MAR50.16" in ci.s_c_source
    d = ci.to_dict()
    assert d["counterparty_type"] == "BANK" and d["rating_bucket"] == "A"
    assert set(tables()) >= {"risk_weights", "cva_weights", "ba_cva", "counterparty_types"}
