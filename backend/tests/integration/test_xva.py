"""The XVA routes return the documented shape on the seed's market data, for rates, FX forwards and every option style."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from tests.integration import bodies as B

pytestmark = pytest.mark.integration

SIX = ("cva", "dva", "fva", "fba", "kva", "mva")
SEVEN = SIX + ("colva",)
PROFILE = ("sample_paths", "ee", "ene", "pfe", "xva", "capital", "seed", "engine_ms")


def _shape(j: dict, n_paths_requested: int | None = None):
    for k in PROFILE:
        assert k in j, k
    assert len(j["ee"]) == len(j["ene"]) == len(j["pfe"]) > 1
    assert all(isinstance(j["xva"][k], (int, float)) for k in SEVEN)
    assert j["xva"]["xva_total"] == pytest.approx(sum(j["xva"][k] for k in SEVEN), abs=0.05)
    assert j["xva"]["annuity"] is None or j["xva"]["annuity"] > 0
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


# ── a package of legs on one pair, as one netting set ───────────────────────────────────────────

def _fwd_quote(client, auth_a, pair, notional, days):
    r = client.post("/api/currency/forward/price", json={"pair": pair, "shape": "FORWARD", "base_notional": notional, "direction": "BUY",
                                                          "settlement_date": _settle(days)}, headers=auth_a)
    assert r.status_code == 200, r.text[:300]
    return r.json()


@pytest.mark.parametrize("vol_mode", ["SURFACE", "FLAT"])
def test_a_package_of_one_forward_answers_as_the_forward_route(client, auth_a, ids, pairs, vol_mode):
    eur = pairs["EURUSD"]
    q = _fwd_quote(client, auth_a, "EURUSD", 10_000_000, 91)
    one = client.post("/api/xva/currency", json={"pair": "EURUSD", "base_notional": 10_000_000, "settlement_date": q["settlement_date"], "forward_rate": q["forward"],
                                                  "direction": "BUY", "paths": 400, "vol_mode": vol_mode, "csa": {"preset": "BILATERAL"}}, headers=auth_a)
    pkg = client.post("/api/xva/currency-package", json={"trades": [B.fx_forward(ids["a"], "PKG-ONE", eur, q)], "paths": 400, "vol_mode": vol_mode,
                                                          "csa": {"preset": "BILATERAL"}}, headers=auth_a)
    assert one.status_code == 200 and pkg.status_code == 200, (one.text[:300], pkg.text[:300])
    a, b = one.json(), pkg.json()
    _shape(b)
    assert b["package"] is True and len(b["legs"]) == 1
    assert b["xva"] == a["xva"] and b["ee"] == a["ee"] and b["pfe"] == a["pfe"], "one leg: the forward's own run"


def test_a_strip_with_an_option_runs_as_one_set_and_nets(client, auth_a, ids, pairs):
    btc = pairs["BTCUSD"]
    legs = []
    for n, days in enumerate((31, 62, 93), start=1):
        legs.append(B.crypto_forward(ids["a"], f"PKG-S-{n}", btc, _fwd_quote(client, auth_a, "BTCUSD", 10, days)))
    oq = client.post("/api/currency/option/price", json=B.option_price_request("BTCUSD", "BARRIER", btc["spot"], _settle(93), True, 10), headers=auth_a)
    assert oq.status_code == 200, oq.text[:300]
    legs.append(B.crypto_option(ids["a"], "PKG-S-O", btc, oq.json(), "BARRIER"))
    r = client.post("/api/xva/currency-package", json={"trades": legs, "paths": 400}, headers=auth_a)
    assert r.status_code == 200, r.text[:500]
    j = r.json()
    _shape(j)
    assert j["pair"] == "BTCUSD" and [x["leg"] for x in j["legs"]] == [1, 2, 3, 4]
    assert j["xva"]["npv"] == pytest.approx(sum(x["npv"] for x in j["legs"]), abs=0.05)
    assert "4 legs" in j["params"]["model"] and "net spot sensitivity" in j["capital"]["im_basis"]
    # the set's peak expected exposure is at most the sum of the legs' peaks
    assert max(j["ee_gross"]) <= sum(x["ee_gross_peak"] for x in j["legs"]) + 1.0
    again = client.post("/api/xva/currency-package", json={"trades": legs, "paths": 400}, headers=auth_a).json()
    assert again["xva"] == j["xva"] and again["ee"] == j["ee"], "seed 42 repeats"


def test_a_package_on_two_pairs_or_with_a_swap_is_refused(client, auth_a, ids, pairs):
    a = B.fx_forward(ids["a"], "PKG-X-1", pairs["EURUSD"], _fwd_quote(client, auth_a, "EURUSD", 10_000_000, 91))
    b = B.crypto_forward(ids["a"], "PKG-X-2", pairs["BTCUSD"], _fwd_quote(client, auth_a, "BTCUSD", 10, 91))
    r = client.post("/api/xva/currency-package", json={"trades": [a, b], "paths": 300}, headers=auth_a)
    assert r.status_code == 422 and "leg 2" in r.text and "same pair" in r.text
    r = client.post("/api/xva/currency-package", json={"trades": [B.swap(ids["a"], "PKG-X-3")], "paths": 300}, headers=auth_a)
    assert r.status_code == 422 and "leg 1" in r.text
    assert client.post("/api/xva/currency-package", json={"trades": [], "paths": 300}, headers=auth_a).status_code == 422
    assert client.post("/api/xva/currency-package", json={"trades": [a] * 25, "paths": 300}, headers=auth_a).status_code == 422, "24 legs at most"


def test_a_package_run_is_bounded_by_what_one_run_may_cost(client, auth_a, ids, pairs):
    """Found by review: 24 long legs at 10,000 paths kept a matrix per leg and could exhaust the instance."""
    far = B.fx_forward(ids["a"], "PKG-BIG", pairs["EURUSD"], _fwd_quote(client, auth_a, "EURUSD", 10_000_000, 730))
    r = client.post("/api/xva/currency-package", json={"trades": [far] * 24, "paths": 10000}, headers=auth_a)
    assert r.status_code == 422 and "paths fit" in r.text, r.text[:300]
    ok = client.post("/api/xva/currency-package", json={"trades": [far] * 24, "paths": 500}, headers=auth_a)
    assert ok.status_code == 200, ok.text[:300]


# ── wrong-way risk: a party's default intensity tied to the asset ─────────────────────────────────

def test_wrong_way_risk_on_the_three_currency_routes(client, auth_a, ids, pairs):
    btc = pairs["BTCUSD"]
    q = _fwd_quote(client, auth_a, "BTCUSD", 10, 182)
    sold = {"pair": "BTCUSD", "base_notional": 10, "settlement_date": q["settlement_date"], "forward_rate": q["forward"], "direction": "SELL", "paths": 1000}
    plain = client.post("/api/xva/currency", json=sold, headers=auth_a).json()
    linked = client.post("/api/xva/currency", json={**sold, "cp_hazard_if_halves": 3.0}, headers=auth_a).json()
    assert plain["wwr"] is None and linked["wwr"]["cp_hazard_if_halves"] == 3.0
    # sold the coin to a counterparty whose credit worsens as it falls: owed when it has fallen, the wrong way
    assert linked["xva"]["cva"] < plain["xva"]["cva"] < 0
    assert linked["wwr"]["cva_independent"] == plain["xva"]["cva"], "the figure with independence is the run without the link"
    for k in ("fva", "fba", "kva", "mva", "colva", "dva"):
        assert linked["xva"][k] == plain["xva"][k], k
    assert linked["xva"]["xva_total"] == pytest.approx(sum(linked["xva"][k] for k in SEVEN), abs=0.05)
    # an option, and a package
    oq = client.post("/api/currency/option/price", json=B.option_price_request("BTCUSD", "EUROPEAN", btc["spot"], _settle(93), True, 10), headers=auth_a).json()
    opt = B.crypto_option(ids["a"], "WWR-O", btc, oq, "EUROPEAN")
    r = client.post("/api/xva/currency-option", json={"trade": opt, "paths": 400, "cp_hazard_if_halves": 2.0, "own_hazard_if_halves": 2.0}, headers=auth_a)
    assert r.status_code == 200 and r.json()["wwr"]["own_hazard_if_halves"] == 2.0, r.text[:300]
    leg = B.crypto_forward(ids["a"], "WWR-P", btc, q)
    r = client.post("/api/xva/currency-package", json={"trades": [leg, opt], "paths": 400, "cp_hazard_if_halves": 2.0}, headers=auth_a)
    assert r.status_code == 200 and r.json()["wwr"]["cva_independent"] <= 0, r.text[:300]
    for bad in (0, -1, 50):
        assert client.post("/api/xva/currency", json={**sold, "cp_hazard_if_halves": bad}, headers=auth_a).status_code == 422


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


def test_incremental_xva_for_a_package_charges_every_leg(client, auth_a, ids, pairs):
    btc = pairs["BTCUSD"]
    legs = [B.crypto_forward(ids["a"], f"IT-INC-PKG-{n}", btc, _fwd_quote(client, auth_a, "BTCUSD", 10, days)) for n, days in ((1, 31), (2, 62))]
    r = client.post("/api/xva/incremental", json={"counterparty_id": ids["a"]["counterparty_id"], "trades": legs, "n_paths": 300}, headers=auth_a)
    assert r.status_code == 200, r.text[:500]
    j = r.json()
    assert j["mode"] == "INCREMENTAL" and j["legs"] == 2
    one = _incremental(client, auth_a, ids, legs[0])
    assert one["legs"] == 1 and j["incremental"]["total"] != one["incremental"]["total"], "two legs are not charged as the first alone"
    assert client.post("/api/xva/incremental", json={"counterparty_id": ids["a"]["counterparty_id"]}, headers=auth_a).status_code == 422


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


# ── the collateral the margin is held in ─────────────────────────────────────────────────────────

def _rates_body(**kw) -> dict:
    return {"notional": 10_000_000, "maturity_y": 5.0, "fixed_rate": 0.036, "paths": 400, "seed": 42, "npv": 0.0, "ir01": 4500.0,
            "csa": {"preset": "BILATERAL", "threshold_cp": 0, "mta": 0, "im_exchanged": True}, **kw}


def test_rates_xva_with_collateral_held_in_a_stablecoin(client, auth_a):
    cash = client.post("/api/xva/simulate", json=_rates_body(), headers=auth_a)
    assert cash.status_code == 200, cash.text[:300]
    j0 = cash.json()
    assert j0["xva"]["colva"] == 0.0 and j0["csa"]["vm_post_carry_bp"] == 0.0
    # cash named explicitly is the same number: cash in the CSA currency earns the OIS the discounting assumes
    jc = client.post("/api/xva/simulate", json=_rates_body(collateral={"posted": {"USD_CASH": 1}, "received": {"USD_CASH": 1}}), headers=auth_a).json()
    assert jc["xva"]["xva_total"] == pytest.approx(j0["xva"]["xva_total"], abs=0.05) and jc["csa"]["collateral"]["posted"] == {"USD_CASH": 1.0}
    # a payment stablecoin on both sides: what we post earns nothing (we fund it, cash would have earned OIS), what we hold
    # earns nothing while OIS is rebated: a cost on both sides, every other adjustment unchanged
    js = client.post("/api/xva/simulate", json=_rates_body(collateral={"posted": {"USDC": 1}, "received": {"USDC": 1}}), headers=auth_a).json()
    assert js["xva"]["colva"] < 0 and js["csa"]["vm_post_carry_bp"] < -100 and js["csa"]["vm_recv_carry_bp"] < -100
    for k in ("cva", "dva", "fva", "fba", "kva"):
        assert js["xva"][k] == pytest.approx(j0["xva"][k], abs=0.05), k
    assert js["xva"]["mva"] <= j0["xva"]["mva"]                    # the stablecoin is not eligible IM: no pickup, the IM funded in full
    assert js["xva"]["xva_total"] == pytest.approx(j0["xva"]["xva_total"] + js["xva"]["colva"] + (js["xva"]["mva"] - j0["xva"]["mva"]), abs=0.1)
    assert js["csa"]["collateral"]["instruments"]["USDC"]["cls"] == "STABLECOIN" and js["csa"]["collateral"]["ois_known"] is True
    # unknown instrument
    assert client.post("/api/xva/simulate", json=_rates_body(collateral={"posted": {"NOPE": 1}}), headers=auth_a).status_code == 422


def test_currency_xva_with_collateral(client, auth_a):
    body = {"pair": "EURUSD", "base_notional": 10_000_000, "settlement_date": _settle(182), "direction": "BUY", "paths": 400, "seed": 42,
            "csa": {"preset": "BILATERAL", "threshold_cp": 0, "mta": 0, "im_exchanged": True}}
    j0 = client.post("/api/xva/currency", json=body, headers=auth_a).json()
    js = client.post("/api/xva/currency", json={**body, "collateral": {"posted": {"USDC": 1}, "received": {"USD_CASH": 1}}}, headers=auth_a)
    assert js.status_code == 200, js.text[:300]
    js = js.json()
    assert js["xva"]["colva"] < 0 and js["xva"]["cva"] == pytest.approx(j0["xva"]["cva"], abs=0.05)
    assert js["xva"]["annuity"] and js["xva"]["annuity"] > 0 and js["csa"]["vm_recv_carry_bp"] == 0.0
