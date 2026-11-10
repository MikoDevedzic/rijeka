"""The book's capital under regimes: the channel steps change one thing each, the attribution sums to the columns, the
parity and invariance statements hold, all on synthetic netted paths (no database)."""
import pytest

from ccr.capital_report import COLUMNS, METRICS, STEPS, channel_regimes, counterparty_capital, run_set, baseline_regime
from ccr.exposure import csa_from_counterparty, mpor_from_terms
from pricing import capital as CAP
from tests.test_capital_route import _set


class CP:
    id = "cp-1"; name = "DEMO BANK"; csa_type = "VM_IM"; csa_threshold_m = 1.0; csa_mta_k = 500; counterparty_type = "BANK"; rating_bucket = "A"
    cva_sector = None; risk_weight_override = None; eligible_collateral = None; posted_composition = None; received_composition = None
    netting_enforceable = None; margin_frequency_days = 5; mpor_disputed = True


def test_mpor_from_the_record_s_terms():
    assert mpor_from_terms(None, False) == 10.0 and mpor_from_terms(1, False) == 10.0
    assert mpor_from_terms(5, False) == 14.0 and mpor_from_terms(5, True) == 28.0 and mpor_from_terms(11, False) == 20.0
    csa = csa_from_counterparty(CP())
    assert csa.collateralised and csa.im_exchanged and csa.threshold_cp == 1e6 and csa.mta == 5e5 and csa.mpor_days == 28.0


def test_channel_steps_change_one_thing_each():
    base = baseline_regime(CP(), csa_from_counterparty(CP()))
    steps = channel_regimes(base, yield_bp=400.0, disputed=True)
    assert [s["key"] for s in steps] == ["BASELINE", *[k for k, *_ in STEPS]]
    r = {s["key"]: s["regime"] for s in steps}
    assert r["THRESHOLD_MTA"].csa.threshold_cp == 0 and r["THRESHOLD_MTA"].csa.mta == 0 and r["THRESHOLD_MTA"].csa.mpor_days == 28.0
    assert r["MARGIN_FREQUENCY"].csa.mpor_days == 20.0 and r["DISPUTES"].csa.mpor_days == 10.0
    assert r["COLLATERAL"].received == {"CASH": 1.0} and r["COLLATERAL"].netting_enforceable
    assert r["IM_ELIGIBILITY"].posted == {"CASH": 1.0}
    assert r["MPOR_RELIEF"].regulatory_csa().mpor_days == 5.0 and r["MPOR_RELIEF"].mpor_state == "ON_CHAIN"
    assert r["TOKENISED_IM"].posted == {"GOVT_TOKENISED": 1.0} and r["TOKENISED_IM"].im_pickup_bp() == 400.0
    assert r["HQLA_L1"].hqla_state == "CEILING" and r["HQLA_L1"].hqla_level("GOVT_TOKENISED") == "L1"
    # an uncollateralised record: the first step turns variation margin on
    class NoCsa(CP):
        csa_type = "NO_CSA"; margin_frequency_days = None; mpor_disputed = None
    s2 = channel_regimes(baseline_regime(NoCsa(), csa_from_counterparty(NoCsa())))
    assert not s2[0]["regime"].csa.collateralised and s2[1]["regime"].csa.collateralised


def test_attribution_sums_to_the_columns_and_orders_as_the_rules_do():
    S = _set(notional=1e7, im_10d=280_000.0, mtm=50_000.0)
    base = baseline_regime(CP(), csa_from_counterparty(CP()))
    ci = CAP.CapitalInputs.for_counterparty("BANK", "A")
    prev, rows = None, []
    for sdef in channel_regimes(base, 400.0, disputed=True):
        m, _ = run_set(S, sdef["regime"], ci, 85.0, 0.4, 0.12)
        rows.append((sdef["key"], m, {k: (m[k] - prev[k]) if prev else 0.0 for k in METRICS}))
        prev = m
    by = {k: (m, d) for k, m, d in rows}
    for k in ("ead", "rwa", "kva", "cva", "mva", "cost"):
        assert by["BASELINE"][0][k] + sum(d[k] for key, _, d in rows[1:6]) == pytest.approx(by["IM_ELIGIBILITY"][0][k])
        assert by["BASELINE"][0][k] + sum(d[k] for key, _, d in rows[1:]) == pytest.approx(by["HQLA_L1"][0][k])
    assert by["THRESHOLD_MTA"][1]["ead"] <= 1e-6                 # the floor TH + MTA − NICA gone
    assert by["MARGIN_FREQUENCY"][1]["ead"] < 0 and by["DISPUTES"][1]["ead"] < 0 and by["MPOR_RELIEF"][1]["ead"] < 0
    assert by["COLLATERAL"][1]["ead"] == pytest.approx(0.0, abs=1e-6)     # cash and government securities already recognised: parity
    assert by["IM_ELIGIBILITY"][1]["mva"] == pytest.approx(0.0, abs=1e-6)
    assert by["TOKENISED_IM"][1]["mva"] > 0                        # the posted asset's yield reduces the funding cost
    assert by["HQLA_L1"][1]["hqla_im"] > 0 and by["HQLA_L1"][1]["ead"] == 0.0
    # the margin is the engine's estimate from the paths: it moves with the margin period, never with the collateral
    assert by["COLLATERAL"][1]["im"] == 0.0 and by["TOKENISED_IM"][1]["im"] == 0.0
    # half the period: lower by about sqrt(1/2), to the sampling of a 99th percentile on 800 paths
    assert by["MPOR_RELIEF"][0]["im"] == pytest.approx(by["DISPUTES"][0]["im"] * (5 / 10) ** 0.5, rel=0.1)


def test_a_stablecoin_baseline_recovers_through_the_collateral_channel():
    class Stable(CP):
        eligible_collateral = ["CASH", "GOVT", "STABLECOIN"]; posted_composition = {"STABLECOIN": 1.0}; received_composition = {"STABLECOIN": 1.0}
        netting_enforceable = False; margin_frequency_days = 1; mpor_disputed = False
    S = _set(notional=1e7, im_10d=280_000.0, mtm=0.0)
    base = baseline_regime(Stable(), csa_from_counterparty(Stable()))
    ci = CAP.CapitalInputs.for_counterparty("BANK", "A")
    out = {}
    prev = None
    for sdef in channel_regimes(base):
        m, _ = run_set(S, sdef["regime"], ci, 85.0, 0.4, 0.12)
        out[sdef["key"]] = (m, {k: (m[k] - prev[k]) if prev else 0.0 for k in METRICS})
        prev = m
    assert out["BASELINE"][0]["im"] == 0.0                         # nothing posted counts
    assert out["COLLATERAL"][1]["ead"] < 0 and out["COLLATERAL"][1]["cva"] > 0      # recognition and enforceability: the big move
    assert out["IM_ELIGIBILITY"][0]["im"] > 0                      # eligible IM once cash is posted
    assert out["MARGIN_FREQUENCY"][1]["ead"] == pytest.approx(0.0, abs=1e-6) and out["DISPUTES"][1]["ead"] == pytest.approx(0.0, abs=1e-6)


def test_counterparty_capital_shape_with_stubbed_paths(monkeypatch):
    import ccr.capital_report as CR
    S = _set(notional=1e7, im_10d=280_000.0, mtm=10_000.0)
    class NS:
        items = [1]; skipped = []
    S.update(n_paths=300, months=60, ns=NS(), today=[{"mtm_usd": 10_000.0}], csa=csa_from_counterparty(CP()))
    monkeypatch.setattr(CR, "prepare_set", lambda *a, **k: S)
    c = counterparty_capital(None, {"sub": "u"}, CP(), [object()], None, None, {"cp_cds_bp": 85, "lgd": 0.4}, None, 0.12, 400.0)
    assert not c["empty"] and set(c["columns"]) == set(COLUMNS) and len(c["steps"]) == 9
    assert c["record"]["mpor_days"] == 28.0 and c["inputs"]["rw"] == 0.30
    assert c["quote"]["BASELINE"]["running_bp"] == 0.0 and c["quote"]["ON_CHAIN_FORWARD"]["running_bp"] >= c["quote"]["ON_CHAIN_CURRENT"]["running_bp"] - 1e-9
    assert set(c["saccr"]) == {"BASELINE", "IM_ELIGIBILITY", "HQLA_L1"}
