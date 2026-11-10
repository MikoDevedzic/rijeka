"""IPV end to end on the stack: the run derives the inputs from the seeded book and ladders them per pillar; an
independent upload produces REVIEW beyond tolerance; an override carries its first-order impact; APPLY gives the
second order; the gate blocks and then clears; the sign-off writes the official P&L the trading report shows."""
from __future__ import annotations

import os

import pytest
import sqlalchemy as sa

from tests.integration.conftest import USER_A, set_role


def _set_role(role: str) -> None:
    set_role(USER_A, role)               # the row and the API's cached copy of it, together


def _reset_ipv() -> None:
    """The stack keeps the IPV tables between runs; the flow starts from nothing."""
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    with eng.begin() as c:
        for t in ("ipv_runs", "ipv_overrides", "ipv_independent_marks"):
            c.execute(sa.text(f"DELETE FROM {t} WHERE user_id = :u"), {"u": USER_A})
        c.execute(sa.text("DELETE FROM pnl_signoffs WHERE user_id = :u AND role = 'IPV'"), {"u": USER_A})
    eng.dispose()


def test_ipv_flow(client, auth_a, auth_b, booked):
    _reset_ipv()
    # the run on the live book
    r = client.get("/api/ipv/run?live=1", headers=auth_a)
    assert r.status_code == 200, r.text[:600]
    j = r.json()
    assert j["scope_key"] == "GLOBAL" and j["trades"] >= 1 and j["inputs"], j
    by = {i["curve_id"]: i for i in j["inputs"]}
    assert "USD_SOFR" in by, list(by)
    sofr = by["USD_SOFR"]
    assert sofr["kind"] == "RATES" and sofr["unit"] == "bp" and sofr["pillars"] and sofr["trades"] >= 1
    assert any(abs(p["sensitivity"]) > 0 for p in sofr["pillars"]), "the pillar ladder must move for a swap book"
    assert all(p["independent"] is None and p["status"] == "UNVERIFIED" for p in sofr["pillars"])
    assert sofr["state"] in ("PENDING", "WAIVED")
    assert isinstance(j["flash_usd"], float) and j["first_order_usd"] == 0.0 and j["official_usd"] == pytest.approx(j["flash_usd"] + (j["xva_usd"] or 0.0))
    # the stored run reads back
    r = client.get("/api/ipv/run", headers=auth_a)
    assert r.status_code == 200 and r.json()["inputs"] and r.json()["status"] == "OPEN"
    # a plain trader (user B, a firm member) may not override, decide or sign; user A is the firm's admin
    pillar = max(sofr["pillars"], key=lambda p: abs(p["sensitivity"]))
    r = client.put("/api/ipv/override", json={"curve_id": "USD_SOFR", "pillar": pillar["key"], "value": pillar["desk"] + 0.02, "reason": "test"}, headers=auth_b)
    assert r.status_code == 403
    _set_role("controller")
    try:
        # an independent mark 3 bp above the desk on that pillar → REVIEW beyond the 1 bp default
        quotes = [{"tenor": p["tenor"], "rate": p["desk"] + (0.03 if p["key"] == pillar["key"] else 0.0), "quote_type": p["quote_type"]} for p in sofr["pillars"]]
        r = client.post("/api/ipv/independent", json={"curve_id": "USD_SOFR", "date": j["date"], "quotes": quotes, "source": "TEST"}, headers=auth_a)
        assert r.status_code == 201
        j2 = client.get("/api/ipv/run?live=1", headers=auth_a).json()
        s2 = {i["curve_id"]: i for i in j2["inputs"]}["USD_SOFR"]
        p2 = {p["key"]: p for p in s2["pillars"]}
        assert p2[pillar["key"]]["gap"] == pytest.approx(3.0, abs=1e-6) and p2[pillar["key"]]["status"] == "REVIEW"
        assert all(p["status"] == "OK" for k, p in p2.items() if k != pillar["key"]) and s2["has_independent"] and s2["state"] == "PENDING"
        # the override: +2 bp on that pillar, first order = sensitivity × 2
        r = client.put("/api/ipv/override", json={"curve_id": "USD_SOFR", "pillar": pillar["key"], "value": pillar["desk"] + 0.02, "reason": "aligned to the independent mark"}, headers=auth_a)
        assert r.status_code == 200, r.text[:400]
        j3 = r.json()
        s3 = {i["curve_id"]: i for i in j3["inputs"]}["USD_SOFR"]
        p3 = {p["key"]: p for p in s3["pillars"]}[pillar["key"]]
        assert p3["status"] == "OVERRIDDEN" and p3["shift"] == pytest.approx(2.0, abs=1e-6) and p3["impact"] == pytest.approx(p3["sensitivity"] * 2.0, rel=1e-9)
        assert s3["state"] == "OVERRIDDEN" and j3["first_order_usd"] == pytest.approx(sum(i["first_order"] for i in j3["inputs"]))
        assert j3["overrides"] and j3["overrides"][0]["reason"] == "aligned to the independent mark"
        # the sign-off is blocked while another input is pending
        pending = [i for i in j3["inputs"] if i["state"] == "PENDING"]
        r = client.post("/api/ipv/signoff", json={"comment": "x"}, headers=auth_a)
        if pending:
            assert r.status_code == 409 and "gate" in r.json()["detail"].lower()
            for i in pending:
                rr = client.post("/api/ipv/inputs/approve", json={"curve_id": i["curve_id"], "reason": "as marked"}, headers=auth_a)
                assert rr.status_code == 200, rr.text[:300]
        # apply: the full revaluation on the override; the second order is small against the first
        r = client.post("/api/ipv/apply", json={}, headers=auth_a)
        assert r.status_code == 200, r.text[:400]
        j4 = r.json()
        assert j4["applied_at"] and j4["second_order_usd"] is not None
        assert abs(j4["second_order_usd"]) <= max(abs(j4["first_order_usd"]) * 0.5, 50.0)
        assert j4["official_usd"] == pytest.approx(j4["flash_usd"] + j4["first_order_usd"] + j4["second_order_usd"] + (j4["xva_usd"] or 0.0))
        # the sign-off
        r = client.post("/api/ipv/signoff", json={"comment": "official"}, headers=auth_a)
        assert r.status_code == 201, r.text[:400]
        j5 = r.json()
        assert j5["status"] == "SIGNED" and not j5["gate"]
        rep = client.get("/api/pnl/report", headers=auth_a).json()
        assert rep["official"] and rep["official"]["status"] == "SIGNED" and rep["official"]["official_usd"] == pytest.approx(j5["official_usd"])
        assert any(s["role"] == "IPV" for s in rep["signoffs"])
        # withdrawing the override rebuilds the run
        r = client.delete(f"/api/ipv/override/{j3['overrides'][0]['id']}", headers=auth_a)
        assert r.status_code == 200 and r.json()["first_order_usd"] == 0.0
    finally:
        _set_role("trader")


def test_tolerance_rules(client, auth_a, auth_b):
    r = client.get("/api/ipv/tolerances", headers=auth_a)
    assert r.status_code == 200 and r.json()["tables"] and r.json()["defaults"]["RATES"] == 1.0
    r = client.post("/api/ipv/tolerances", json={"input_pattern": "USD_SOFR", "pillar_pattern": "10Y", "tol": 2.0, "unit": "bp", "materiality_usd": 500}, headers=auth_b)
    assert r.status_code == 403            # a plain trader does not set tolerances
    _set_role("risk")
    try:
        r = client.post("/api/ipv/tolerances", json={"input_pattern": "usd_sofr", "pillar_pattern": "10y", "tol": 2.0, "unit": "bp", "materiality_usd": 500, "note": "long end"}, headers=auth_a)
        assert r.status_code == 201 and r.json()["rules"][-1]["input_pattern"] == "USD_SOFR" and r.json()["rules"][-1]["pillar_pattern"] == "10Y"
        tid = r.json()["id"]
        r = client.post("/api/ipv/tolerances", json={"input_pattern": "X", "tol": 1, "unit": "furlongs"}, headers=auth_a)
        assert r.status_code == 422
        r = client.delete(f"/api/ipv/tolerances/{tid}", headers=auth_a)
        assert r.status_code == 200 and all(x["id"] != tid for x in r.json()["rules"])
    finally:
        _set_role("trader")
