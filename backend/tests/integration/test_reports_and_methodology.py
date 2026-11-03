"""Risk, P&L and counterparty-credit reports value the whole booked book; the methodology workbooks download."""
from __future__ import annotations

import io

import pytest

pytestmark = pytest.mark.integration

# Counterparty credit simulates swaps, swaptions, forwards and FX / digital-asset options (ccr/valuation.py SWAPS,
# SWAPTIONS, FORWARDS, FX_OPTIONS); caps, floors and collars as stand-alone trades are listed as "not simulated
# yet" (docs/ccr.md: "Anything else is listed as not simulated, never valued at zero").
CCR_NOT_SIMULATED = {"IR_CAP", "IR_FLOOR", "IR_COLLAR"}


def test_risk_report_values_every_booked_trade(client, auth_a, booked):
    r = client.get("/api/risk/report?live=1", headers=auth_a)
    assert r.status_code == 200, r.text[:400]
    j = r.json()
    assert j["date"] and j["ladder"]["npv_usd"] is not None and j["var"] is not None
    refs = {b["ref"] for b in booked.values()}
    valued = {row["trade_ref"] for row in j["ladder_rows"]}
    problems = {p["trade_ref"]: p["reason"] for p in j["ladder"]["problems"]}
    assert refs <= valued, {k: problems.get(k) for k in refs - valued}
    assert not (refs & set(problems)), problems


def test_pnl_report_values_every_booked_trade(client, auth_a, booked):
    r = client.get("/api/pnl/report?live=1", headers=auth_a)
    assert r.status_code == 200, r.text[:400]
    j = r.json()
    assert j["date"] and "totals" in j and j["rows"]
    refs = {b["ref"] for b in booked.values()}
    valued = {row["trade_ref"] for row in j["rows"]}
    problems = {p["trade_ref"]: p["reason"] for p in j["meta"]["problems"]}
    assert refs <= valued, {k: problems.get(k) for k in refs - valued}
    assert not (refs & set(problems)), problems


def test_ccr_report_simulates_every_booked_trade_it_documents(client, auth_a, booked):
    r = client.get("/api/ccr/report?live=1", headers=auth_a)
    assert r.status_code == 200, r.text[:400]
    j = r.json()
    assert j["date"] and j["counterparties"]
    cp = next(c for c in j["counterparties"] if c.get("trades"))
    assert not cp.get("empty"), cp.get("error") or cp.get("skipped")
    assert cp["exposure"]["peak_pfe95_usd"] >= 0 and "cva_usd" in cp["xva"]
    skipped = {s["trade_ref"]: s["reason"] for s in cp.get("skipped", [])}
    expected_skip = {b["ref"] for k, b in booked.items() if k in CCR_NOT_SIMULATED}
    unexpected = {k: v for k, v in skipped.items() if k not in expected_skip}
    assert not unexpected, unexpected
    assert all("not simulated" in skipped[ref] for ref in expected_skip if ref in skipped)
    assert cp["simulated"] >= len(booked) - len(expected_skip)


def test_methodology_lists_every_product_and_each_workbook_opens_with_its_checks_sheet(client, auth_a):
    from methodology import replicate as rep
    import openpyxl
    r = client.get("/api/methodology/products", headers=auth_a)
    assert r.status_code == 200
    products = r.json()
    ids = [p["id"] for p in products]
    with_xlsx = {p["id"] for p in products if p.get("replication") == "xlsx"}
    assert set(rep.BUILDERS) <= set(ids), set(rep.BUILDERS) - set(ids)
    assert with_xlsx == set(rep.BUILDERS), with_xlsx ^ set(rep.BUILDERS)     # every workbook is listed, and nothing listed lacks one
    from api.routes import _limits
    for pid in sorted(with_xlsx):
        _limits._buckets.clear()                  # 6 downloads a minute per account; this test fetches them all
        x = client.get(f"/api/methodology/{pid}/replication.xlsx", headers=auth_a)
        assert x.status_code == 200, (pid, x.text[:300])
        assert x.headers["content-type"].startswith("application/vnd.openxmlformats")
        wb = openpyxl.load_workbook(io.BytesIO(x.content), read_only=True)
        assert "Checks" in wb.sheetnames, (pid, wb.sheetnames)
        assert wb.sheetnames[0] == "Cover", pid


def test_methodology_unknown_product_is_404(client, auth_a):
    assert client.get("/api/methodology/no_such_product/replication.xlsx", headers=auth_a).status_code == 404
