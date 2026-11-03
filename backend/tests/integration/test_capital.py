"""The capital route end to end on the local stack: the catalogue, the trade's capital under every regime and
counterparty type for a swap and an FX forward, the identities between the sets, and the counterparty record's
capital attributes once the migration is applied."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from tests.integration import bodies as B

METRICS = {"im", "ead", "rwa", "k_ccr", "k_cva", "kva", "mva", "cva", "fva", "leverage", "hqla_im"}
PRESETS = ["CASH_GOVT", "PLUS_STABLECOIN", "PLUS_TOKENISED_FUND", "PLUS_TOKENISED_SOVEREIGN"]


def _settle() -> str:
    return (date.today() + timedelta(days=182)).isoformat()


def test_collateral_catalogue(client, auth_a):
    r = client.get("/api/capital/collateral", headers=auth_a)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    codes = {c["code"] for c in j["classes"]}
    assert {"CASH", "GOVT", "GOVT_TOKENISED", "FUND_SHARES_TOKENISED", "STABLECOIN", "CRYPTO_2A", "CRYPTO_2B"} <= codes
    assert [p["name"] for p in j["presets"]] == PRESETS
    assert j["capital"]["risk_weights"]["BANK"]["A"] == 0.30 and j["sa_ccr"]["supervisory"]["FX"]["sf"] == 0.04
    assert all(c["sources"] for c in j["classes"])


def _capital(client, auth_a, ids, trade: dict) -> dict:
    r = client.post("/api/capital/trade", json={"counterparty_id": ids["a"]["counterparty_id"], "trade": trade, "n_paths": 300}, headers=auth_a)
    assert r.status_code == 200, r.text[:600]
    j = r.json()
    assert j["mode"] == "INCREMENTAL" and j["seed"] == 7 and j["n_paths"] == 300
    names = [x["name"] for x in j["regimes"]]
    assert names == ["COUNTERPARTY", *PRESETS]
    keys = [t["key"] for t in j["types"]]
    assert "CORPORATE·UNRATED" in keys and "BANK·A" in keys
    for rg in names:
        for tk in keys:
            c = j["cells"][rg][tk]
            assert c["with"] and set(c["with"]) >= METRICS, (rg, tk)
            assert c["standalone"] and c["incremental"]
            w0 = c["without"] or {k: 0.0 for k in METRICS}
            for k in METRICS:
                assert c["incremental"][k] == pytest.approx(c["with"][k] - w0[k], abs=1e-6), (rg, tk, k)
        assert j["saccr"][rg]["with"]["ead"] >= 0 and j["saccr"][rg]["with"]["trades"]
    # the rules' ordering on the trade alone: unrecognised collateral never gives a smaller EAD than recognised
    alone = lambda rg: j["cells"][rg]["BANK·A"]["standalone"]
    assert alone("PLUS_STABLECOIN")["ead"] >= alone("CASH_GOVT")["ead"] * 0.999
    assert alone("PLUS_STABLECOIN")["im"] == 0.0
    assert alone("CASH_GOVT")["rwa"] == pytest.approx(alone("CASH_GOVT")["ead"] * 0.30)
    assert j["quote"]["COUNTERPARTY"]["BANK·A"]["cost_vs_first"] == 0.0        # the first column is the record's own regime
    assert j["notes"] and j["seconds"] >= 0
    return j


def test_capital_for_a_swap(client, auth_a, ids, booked):
    j = _capital(client, auth_a, ids, B.swap(ids["a"], "IT-CAP-SWAP"))
    assert j["other_trades"] >= 1
    rows = j["saccr"]["CASH_GOVT"]["with"]["trades"]
    assert any(r["asset_class"] == "IR" and r["hedging_set"] == "USD" for r in rows)


def test_capital_for_an_fx_forward(client, auth_a, ids, pairs):
    q = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "FORWARD", "base_notional": 10_000_000, "direction": "BUY",
                                                          "settlement_date": _settle()}, headers=auth_a).json()
    j = _capital(client, auth_a, ids, B.fx_forward(ids["a"], "IT-CAP-FXF", pairs["EURUSD"], q, "FX_FORWARD"))
    rows = j["saccr"]["CASH_GOVT"]["standalone"]["trades"]
    assert rows and rows[0]["asset_class"] == "FX" and rows[0]["hedging_set"] == "EURUSD" and rows[0]["delta"] == 1.0
    by_class = j["saccr"]["CASH_GOVT"]["standalone"]["by_class"]
    assert "FX" in by_class and by_class["FX"]["addon"] > 0


def test_capital_needs_a_trade_and_a_known_regime(client, auth_a, ids):
    r = client.post("/api/capital/trade", json={"counterparty_id": ids["a"]["counterparty_id"]}, headers=auth_a)
    assert r.status_code == 422
    r = client.post("/api/capital/trade", json={"counterparty_id": ids["a"]["counterparty_id"], "trade": B.swap(ids["a"], "X"), "regimes": ["NOPE"]}, headers=auth_a)
    assert r.status_code == 422


def test_counterparty_capital_attributes_round_trip(client, auth_a, ids):
    cp = ids["a"]["counterparty_id"]
    r = client.put(f"/api/counterparties/{cp}", json={"counterparty_type": "bank", "rating_bucket": "A", "eligible_collateral": ["CASH", "GOVT", "STABLECOIN"],
                                                       "posted_composition": {"GOVT": 1.0}, "netting_enforceable": True}, headers=auth_a)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    assert j["counterparty_type"] == "BANK" and j["rating_bucket"] == "A" and j["eligible_collateral"] == ["CASH", "GOVT", "STABLECOIN"]
    lst = client.get("/api/counterparties/", headers=auth_a).json()
    assert next(c for c in lst if c["id"] == cp)["posted_composition"] == {"GOVT": 1.0}
    r = client.put(f"/api/counterparties/{cp}", json={"rating_bucket": "AAA"}, headers=auth_a)
    assert r.status_code == 422
    r = client.put(f"/api/counterparties/{cp}", json={"eligible_collateral": ["GOLD"]}, headers=auth_a)
    assert r.status_code == 422
    # the record's type now leads the capital run
    jc = client.post("/api/capital/trade", json={"counterparty_id": cp, "trade": B.swap(ids["a"], "IT-CAP-REC"), "n_paths": 200}, headers=auth_a).json()
    assert jc["types"][0]["key"] == "COUNTERPARTY" and jc["types"][0]["type"] == "BANK"
    client.put(f"/api/counterparties/{cp}", json={"counterparty_type": "CORPORATE", "rating_bucket": "UNRATED", "eligible_collateral": ["CASH", "GOVT"]}, headers=auth_a)
