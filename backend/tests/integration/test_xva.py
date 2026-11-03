"""The XVA routes return the documented shape on the seed's market data, for rates, FX forwards and every option style."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from tests.integration import bodies as B

pytestmark = pytest.mark.integration

SIX = ("cva", "dva", "fva", "fba", "kva", "mva")
PROFILE = ("sample_paths", "ee", "ene", "pfe", "xva", "capital", "seed", "engine_ms")


def _shape(j: dict, n_paths_requested: int | None = None):
    for k in PROFILE:
        assert k in j, k
    assert len(j["ee"]) == len(j["ene"]) == len(j["pfe"]) > 1
    assert all(isinstance(j["xva"][k], (int, float)) for k in SIX)
    assert j["xva"]["xva_total"] == pytest.approx(sum(j["xva"][k] for k in SIX), abs=0.05)
    assert j["sample_paths"] and len(j["sample_paths"][0]) == len(j["ee"]) or len(j["sample_paths"][0]) >= len(j["ee"]) - 1
    assert isinstance(j["seed"], int) and j["engine_ms"] >= 0


def _settle(days=91) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


# ── rates ──────────────────────────────────────────────────────────────────────────────────────

def test_rates_simulate_returns_the_profile_the_waterfall_and_the_capital_block(client, auth_a):
    r = client.post("/api/xva/simulate", json={"notional": 10_000_000, "maturity_y": 5, "fixed_rate": 0.0375, "paths": 500, "npv": 0.0, "ir01": 4500.0},
                    headers=auth_a)
    assert r.status_code == 200, r.text[:400]
    j = r.json()
    _shape(j)
    assert j["params"]["curve_source"] and j["params"]["a"] and j["params"]["sigma_bp"]
    assert j["capital"]["model"] == "sa_ccr" and "ead_0" in j["capital"] and "im_0" in j["capital"]
    assert j["xva"]["npv"] == 0.0 and j["xva"]["all_in"] is not None


def test_rates_simulate_seed_42_repeats_and_a_fresh_seed_differs(client, auth_a):
    body = {"notional": 10_000_000, "maturity_y": 3, "paths": 400, "npv": 0.0}
    a = client.post("/api/xva/simulate", json={**body, "seed": 42}, headers=auth_a).json()
    b = client.post("/api/xva/simulate", json={**body, "seed": 42}, headers=auth_a).json()
    c = client.post("/api/xva/simulate", json={**body, "seed": 4242}, headers=auth_a).json()
    assert a["ee"] == b["ee"] and a["xva"] == b["xva"] and a["seed"] == 42
    assert c["seed"] == 4242 and (c["ee"] != a["ee"] or c["xva"]["cva"] != a["xva"]["cva"])


# ── FX and digital-asset forwards ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("pair,notional", [("EURUSD", 10_000_000), ("BTCUSD", 10)])
@pytest.mark.parametrize("vol_mode", ["SURFACE", "FLAT"])
def test_currency_forward_xva_in_both_vol_modes(client, auth_a, pair, notional, vol_mode):
    r = client.post("/api/xva/currency", json={"pair": pair, "base_notional": notional, "settlement_date": _settle(), "paths": 500,
                                                "vol_mode": vol_mode}, headers=auth_a)
    assert r.status_code == 200, r.text[:400]
    j = r.json()
    _shape(j)
    mode = j["params"]["vol_mode"].upper()
    assert j["pair"] == pair
    # the engine names the mode descriptively: FLAT holds one vol; SURFACE reads the term structure (and the smile)
    assert mode.startswith("FLAT") if vol_mode == "FLAT" else not mode.startswith("FLAT"), mode
    assert j["params"]["vol_pct"] and "surface" in (j["params"]["vol_source"] or "").lower()


def test_currency_forward_xva_seed_behaviour(client, auth_a):
    body = {"pair": "EURUSD", "base_notional": 10_000_000, "settlement_date": _settle(), "paths": 500}
    a = client.post("/api/xva/currency", json={**body, "seed": 42}, headers=auth_a).json()
    b = client.post("/api/xva/currency", json={**body, "seed": 42}, headers=auth_a).json()
    c = client.post("/api/xva/currency", json={**body, "seed": 7}, headers=auth_a).json()
    assert a["ee"] == b["ee"] and a["xva"] == b["xva"]
    assert c["ee"] != a["ee"]


# ── options, every style ───────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("style", B.STYLES)
@pytest.mark.parametrize("vol_mode", ["SURFACE", "FLAT"])
def test_fx_option_xva_every_style(client, auth_a, ids, pairs, style, vol_mode):
    eur = pairs["EURUSD"]
    q = client.post("/api/currency/option/price", json=B.option_price_request("EURUSD", style, eur["spot"], _settle(), False, 10_000_000), headers=auth_a)
    assert q.status_code == 200, (style, q.text[:300])
    trade = B.fx_option(ids["a"], f"XVA-{style}", eur, q.json(), style)
    r = client.post("/api/xva/currency-option", json={"trade": trade, "paths": 400, "vol_mode": vol_mode}, headers=auth_a)
    assert r.status_code == 200, (style, vol_mode, r.text[:400])
    j = r.json()
    _shape(j)
    mode = j["params"]["vol_mode"].upper()
    # the engine names the mode descriptively: FLAT holds one vol; SURFACE reads the term structure (and the smile)
    assert mode.startswith("FLAT") if vol_mode == "FLAT" else not mode.startswith("FLAT"), mode


@pytest.mark.parametrize("style", ("EUROPEAN", "DIGITAL", "BARRIER"))
def test_crypto_option_xva(client, auth_a, ids, pairs, style):
    btc = pairs["BTCUSD"]
    q = client.post("/api/currency/option/price", json=B.option_price_request("BTCUSD", style, btc["spot"], _settle(), True, 10), headers=auth_a)
    assert q.status_code == 200, (style, q.text[:300])
    trade = B.crypto_option(ids["a"], f"XVA-C-{style}", btc, q.json(), style)
    r = client.post("/api/xva/currency-option", json={"trade": trade, "paths": 400}, headers=auth_a)
    assert r.status_code == 200, (style, r.text[:400])
    _shape(r.json())


def test_option_xva_seed_42_repeats(client, auth_a, ids, pairs):
    eur = pairs["EURUSD"]
    q = client.post("/api/currency/option/price", json=B.option_price_request("EURUSD", "EUROPEAN", eur["spot"], _settle(), False, 10_000_000), headers=auth_a).json()
    trade = B.fx_option(ids["a"], "XVA-SEED", eur, q, "EUROPEAN")
    a = client.post("/api/xva/currency-option", json={"trade": trade, "paths": 400, "seed": 42}, headers=auth_a).json()
    b = client.post("/api/xva/currency-option", json={"trade": trade, "paths": 400, "seed": 42}, headers=auth_a).json()
    c = client.post("/api/xva/currency-option", json={"trade": trade, "paths": 400, "seed": 99}, headers=auth_a).json()
    assert a["ee"] == b["ee"] and a["xva"] == b["xva"] and c["ee"] != a["ee"]


# ── incremental: the counterparty's netting set with and without the trade ──────────────────────

def _incremental(client, auth_a, ids, trade: dict) -> dict:
    r = client.post("/api/xva/incremental", json={"counterparty_id": ids["a"]["counterparty_id"], "trade": trade, "n_paths": 300}, headers=auth_a)
    assert r.status_code == 200, r.text[:500]
    j = r.json()
    assert j["mode"] == "INCREMENTAL" and j["counterparty_id"] == ids["a"]["counterparty_id"]
    for block in ("without", "with", "incremental"):
        assert set(j[block]) >= set(SIX) | {"total"}, block
    assert j["ee"]["grid"] and len(j["ee"]["with"]) == len(j["ee"]["grid"])
    assert j["other_trades"] >= 0 and j["n_paths"]
    return j


def test_incremental_xva_for_a_swap(client, auth_a, ids, booked):
    j = _incremental(client, auth_a, ids, B.swap(ids["a"], "IT-INC-SWAP"))
    assert j["other_trades"] >= 1          # the booked trades sit in the same netting set


def test_incremental_xva_for_an_fx_forward(client, auth_a, ids, pairs):
    q = client.post("/api/currency/forward/price", json={"pair": "EURUSD", "shape": "FORWARD", "base_notional": 10_000_000, "direction": "BUY",
                                                          "settlement_date": _settle()}, headers=auth_a).json()
    _incremental(client, auth_a, ids, B.fx_forward(ids["a"], "IT-INC-FXF", pairs["EURUSD"], q, "FX_FORWARD"))


def test_incremental_xva_for_an_fx_option(client, auth_a, ids, pairs):
    eur = pairs["EURUSD"]
    q = client.post("/api/currency/option/price", json=B.option_price_request("EURUSD", "EUROPEAN", eur["spot"], _settle(), False, 10_000_000), headers=auth_a).json()
    _incremental(client, auth_a, ids, B.fx_option(ids["a"], "IT-INC-FXO", eur, q, "EUROPEAN"))
