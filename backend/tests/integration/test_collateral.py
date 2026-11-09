"""Collateral on the local stack: the instrument list (seed plus a firm row, yields resolved), a schedule per
counterparty that the capital run then uses as its first column, tenancy, and the record's class fields kept in step."""
from __future__ import annotations

from tests.integration import bodies as B


def test_instruments_seed_and_a_firm_row(client, auth_a, auth_b):
    j = client.get("/api/collateral/instruments", headers=auth_a).json()
    codes = {i["code"] for i in j["instruments"]}
    assert {"USD_CASH", "UST_BILL", "USDC", "USDT", "TOKENISED_MMF", "TOKENISED_TBILL", "BTC", "ETH"} <= codes
    assert j["writable"] is True and j["classes"] and j["rails"] == ["bilateral", "on_chain"]
    cash = next(i for i in j["instruments"] if i["code"] == "USD_CASH")
    assert cash["yield_kind"] == "CURVE" and cash["yield_ref"] == "USD_SOFR" and cash["yield_today_bp"] is not None and cash["yield_today_bp"] > 0
    assert next(i for i in j["instruments"] if i["code"] == "USDC")["yield_today_bp"] == 0.0

    r = client.post("/api/collateral/instruments", json={"code": "my mmf", "name": "The firm's tokenised fund", "cls": "FUND_SHARES_TOKENISED", "yield_kind": "FIXED",
                                                         "yield_bp": 415, "rail": "on_chain", "chain_id": 1, "csa_haircut_pct": 2.0}, headers=auth_a)
    assert r.status_code == 200, r.text[:300]
    mine = next(i for i in r.json()["instruments"] if i["code"] == "MY_MMF")
    assert mine["firm"] and mine["yield_today_bp"] == 415.0 and mine["csa_haircut_pct"] == 2.0 and mine["im_eligible"] == "YES"
    # instruments are the firm's: the stack's two users sit in one firm, so user B sees the same list
    assert "MY_MMF" in {i["code"] for i in client.get("/api/collateral/instruments", headers=auth_b).json()["instruments"]}
    # validation
    assert client.post("/api/collateral/instruments", json={"code": "X", "cls": "NOPE"}, headers=auth_a).status_code == 422
    assert client.post("/api/collateral/instruments", json={"code": "X", "cls": "CASH", "yield_kind": "GUESS"}, headers=auth_a).status_code == 422
    # a seed entry can be overridden (deactivated) but not removed
    assert client.delete("/api/collateral/instruments/USDT", headers=auth_a).status_code == 404
    r = client.post("/api/collateral/instruments", json={"code": "USDT", "name": "Tether USD", "cls": "STABLECOIN", "rail": "on_chain", "active": False}, headers=auth_a)
    assert next(i for i in r.json()["instruments"] if i["code"] == "USDT")["active"] is False
    assert client.delete("/api/collateral/instruments/USDT", headers=auth_a).status_code == 200
    assert next(i for i in client.get("/api/collateral/instruments", headers=auth_a).json()["instruments"] if i["code"] == "USDT")["active"] is True


def test_schedule_drives_the_capital_run(client, auth_a, auth_b, ids):
    cp = ids["a"]["counterparty_id"]
    client.put(f"/api/counterparties/{cp}", json={"csa_type": "VM_IM", "csa_threshold_m": 0, "csa_mta_k": 500, "eligible_collateral": ["CASH", "GOVT"],
                                                  "posted_composition": {"CASH": 1.0}, "received_composition": {"CASH": 1.0}}, headers=auth_a)
    j = client.get(f"/api/collateral/schedule/{cp}", headers=auth_a).json()
    # rerunnable: a fresh database has no schedule yet, a reused one holds the cash schedule this test ends on
    assert j["regime"]["name"] == "COUNTERPARTY" and j["regime"]["posted"] == {"CASH": 1.0} and j["writable"]
    assert j["schedule"] is None or j["schedule"]["posted"] == {"USD_CASH": 1.0}
    versions_before = len(j["history"])

    body = {"eligible": [{"instrument": "USD_CASH"}, {"instrument": "UST_BILL", "csa_haircut_pct": 1.0}, {"instrument": "USDC", "im": False}],
            "posted": {"UST_BILL": 60, "USDC": 40}, "received": {"USD_CASH": 100}, "rail": "on_chain", "note": "the annex as signed"}
    r = client.put(f"/api/collateral/schedule/{cp}", json=body, headers=auth_a)
    assert r.status_code == 200, r.text[:400]
    j = r.json()
    assert j["schedule"]["rail"] == "on_chain" and j["schedule"]["posted"]["UST_BILL"] == 0.6
    versions = len(j["history"])
    assert versions in (versions_before, versions_before + 1) and versions >= 1      # today's version: new, or replacing today's
    rg = j["regime"]
    assert rg["eligible"] == ["CASH", "GOVT", "STABLECOIN"] and rg["posted"]["GOVT"] == 0.6 and rg["mpor_state"] == "ON_CHAIN"
    assert rg["regulatory_csa"]["mpor_days"] == 5.0 and rg["posted_instruments"] == {"UST_BILL": 0.6, "USDC": 0.4}
    assert rg["instrument_yields_bp"]["UST_BILL"] > 0 and rg["instrument_yields_bp"]["USDC"] == 0.0
    assert any(e["step"] == "initial margin" for e in j["explain"])
    # the record's class fields follow the schedule
    rec = next(c for c in client.get("/api/counterparties/", headers=auth_a).json() if c["id"] == cp)
    assert rec["eligible_collateral"] == ["CASH", "GOVT", "STABLECOIN"] and rec["posted_composition"]["STABLECOIN"] == 0.4
    # tenancy: user B cannot read or write A's schedule
    assert client.get(f"/api/collateral/schedule/{cp}", headers=auth_b).status_code == 404
    assert client.put(f"/api/collateral/schedule/{cp}", json=body, headers=auth_b).status_code == 404
    # validation
    assert client.put(f"/api/collateral/schedule/{cp}", json={**body, "posted": {"BTC": 1}}, headers=auth_a).status_code == 422
    # the capital run's first column is the schedule's regime
    jc = client.post("/api/capital/trade", json={"counterparty_id": cp, "trade": B.swap(ids["a"], "IT-COL-SWAP"), "n_paths": 200}, headers=auth_a)
    assert jc.status_code == 200, jc.text[:400]
    first = jc.json()["regimes"][0]
    assert first["name"] == "COUNTERPARTY" and first["mpor_state"] == "ON_CHAIN" and first["posted_instruments"] == {"UST_BILL": 0.6, "USDC": 0.4}
    # back to cash on a bilateral rail so the other modules see the record they expect
    r = client.put(f"/api/collateral/schedule/{cp}", json={"eligible": [{"instrument": "USD_CASH"}, {"instrument": "UST_NOTE"}], "posted": {"USD_CASH": 1},
                                                            "received": {"USD_CASH": 1}, "rail": "bilateral"}, headers=auth_a)
    assert r.status_code == 200 and r.json()["regime"]["mpor_state"] == "FLOOR" and len(r.json()["history"]) == versions    # same effective date: replaced, not added
    client.put(f"/api/counterparties/{cp}", json={"csa_type": "VM_IM", "csa_threshold_m": 0, "csa_mta_k": 500, "eligible_collateral": ["CASH", "GOVT"],
                                                  "posted_composition": {"CASH": 1.0}, "received_composition": {"CASH": 1.0}}, headers=auth_a)


def test_collateral_book(client, auth_a, ids):
    r = client.get("/api/collateral/book", headers=auth_a)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    assert j["writable"] and j["counterparties"] and j["instruments"]["USD_CASH"]["carry_bp"] == 0.0
    cp = next(c for c in j["counterparties"] if c["counterparty_id"] == ids["a"]["counterparty_id"])
    assert cp["rail"] in ("bilateral", "on_chain") and "vm_held_usd" in cp and "carry_per_year_usd" in cp
    t = j["totals"]
    assert t["counterparties"] == len(j["counterparties"]) and t["requirement_usd"] >= 0
    if cp["has_run"]:
        assert all(l["value_usd"] <= l["face_usd"] + 1e-9 for l in cp["posted"] + cp["held"])
    assert j["notes"]
