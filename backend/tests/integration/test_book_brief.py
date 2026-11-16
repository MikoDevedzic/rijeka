"""The book brief's valuation figures are the stored risk report's: one book, one set of numbers on every screen.
Until 0.44.5 the brief priced each trade itself today and summed, so its totals could differ from the Risk page's."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


def test_the_brief_reads_the_stored_risk_report(client, auth_a, booked):
    rep = client.get("/api/risk/report?live=1", headers=auth_a)                 # the report is made and stored, as the Risk page does
    assert rep.status_code == 200, rep.text[:300]
    rep = rep.json()
    r = client.get("/api/prometheus/brief?refresh=1", headers=auth_a)
    assert r.status_code == 200, r.text[:300]
    b = r.json()
    assert b["source"] == "risk_report" and b["report_date"] == rep["date"][:10] and b["valuation_date"] == rep["date"][:10]
    facts = {f["id"]: f for f in b["facts"]}
    ccy = rep.get("reporting_ccy") or "USD"
    # the book's figures are the report's own, to the unit
    assert facts[f"N_{ccy}"]["value"] == pytest.approx(round(rep["ladder"]["npv_usd"]), abs=0.5)
    assert facts["IR01"]["value"] == pytest.approx(round(rep["ladder"]["ir01_usd"]), abs=0.5)
    for asset, v in rep["ladder"]["spot01"].items():
        if abs(v) >= 0.5:
            assert facts[f"S_{asset}"]["value"] == pytest.approx(round(v), abs=0.5)
    assert "risk report of " + rep["date"][:10] in facts["R1"]["text"] and "not a pricing of today" in facts["R1"]["text"]
    # each trade's figure is its row in the report, not a price of today
    rows = {row["trade_ref"]: row for row in rep["ladder_rows"]}
    trades = [f for f in b["facts"] if f["kind"] == "trade"]
    valued = [f for f in trades if f["value"] is not None]
    assert valued and b["priced"] == len(valued)
    for f in valued:
        ref = f["label"].split(" ")[0]
        assert f["value"] == pytest.approx(round(rows[ref]["npv"]), abs=0.5) and f["unit"] == rows[ref]["ccy"]
    for f in trades:
        if f["value"] is None:
            assert "risk report" in f["text"]                                    # a trade the report did not value says so, with no figure of its own
    # what the home shows where it reads the sheet: the same sums
    assert b["totals"]["npv"] == {ccy: pytest.approx(round(rep["ladder"]["npv_usd"]), abs=0.5)}
    assert b["totals"]["ir01"] == pytest.approx(round(rep["ladder"]["ir01_usd"]), abs=0.5)
    # the brief kept is the brief of this report: asked again, it is the same answer
    again = client.get("/api/prometheus/brief", headers=auth_a).json()
    assert again["generated_at"] == b["generated_at"] and again["report_date"] == b["report_date"]
