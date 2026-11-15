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


def test_risk_report_lists_what_fixes_day_by_day_and_it_adds_up_to_the_swaps_own_floating_periods(client, auth_a, booked):
    """The fixings are read from the periods the valuation made, so they must agree with a pricing of the same swap:
    the fixing 01s of a floating period's days still to come add up to notional x accrual x discount factor x 1bp
    for the share of the period that is left."""
    from datetime import date, timedelta
    r = client.get("/api/risk/report?live=1", headers=auth_a)
    assert r.status_code == 200, r.text[:400]
    j = r.json(); fx = j["fixings"]
    assert fx["asof"] == j["date"] and fx["horizon_days"] == 92
    assert not fx["problems"], fx["problems"]
    rows = fx["resets"]
    assert rows, "a book with swaps on it has rate resets"
    asof, upto = date.fromisoformat(fx["asof"]), date.fromisoformat(fx["to"])
    for x in rows:
        d = date.fromisoformat(x["date"])
        assert asof <= d <= upto and d.weekday() < 5, x                    # a business day, from the report's date, inside the horizon
        assert abs(x["receive_usd"] + x["pay_usd"] - x["net_usd"]) < 1e-6 and x["receive_usd"] >= 0 >= x["pay_usd"] and x["trades"] >= 1 and 1 <= x["days"] <= 6
    assert all(b["index"] and b["days_listed"] >= 1 for b in fx["by_index"])
    assert {x["index"] for x in rows} == {b["index"] for b in fx["by_index"]}
    # the caps, floors, swaption and options of the book are said to be left out, not silently dropped
    assert fx["not_covered"].get("IR_CAP", 0) >= 1 and fx["not_covered"].get("IR_SWAPTION", 0) >= 1
    # the digital-asset forward fixes once, on a date to come, on its pair
    assert any(s["pair"] == "BTCUSD" and date.fromisoformat(s["date"]) >= asof and s["net_units"] != 0 for s in fx["settlements"]), fx["settlements"]

    # against a pricing of the booked swap on its own: every day still to fix of every floating period of the leg, as
    # the report reads them, adds up to more than notional x accrual x discount factor x 1bp for the part of each
    # period that is left, and to no more than that with the period's whole compounding on it (both worked here from
    # the pricer's own cashflows; the compounding itself is pinned by hand in tests/test_risk.py)
    from risk import fixings as F
    swap = booked["IR_SWAP"]
    ids = [c for c in dict.fromkeys([swap["trade"].get("discount_curve_id"), swap["trade"].get("forecast_curve_id")]) if c] or ["USD_SOFR"]
    p = client.post("/price", json={"trade_id": swap["id"], "valuation_date": fx["asof"], "curves": [{"curve_id": c} for c in ids]}, headers=auth_a)
    assert p.status_code == 200, p.text[:400]
    legs = [l for l in p.json()["legs"] if l["leg_type"] in ("FLOAT", "OIS")]
    assert legs, "the swap has a floating leg"
    want, most, periods = 0.0, 0.0, 0
    for leg in legs:
        sign = 1.0 if leg["direction"].startswith("REC") else -1.0
        for cf in leg["cashflows"]:
            if cf["cashflow_type"] != "COUPON":
                continue
            s, e = date.fromisoformat(cf["period_start"]), date.fromisoformat(cf["period_end"])
            lo = max(s, asof)
            if e <= lo:
                continue
            plain = sign * cf["notional"] * cf["dcf"] * (e - lo).days / (e - s).days * (cf["df"] or 1.0) * 1e-4
            want += plain; most += plain * (1.0 + (cf["rate"] or 0.0) * cf["dcf"])
            periods += 1
    got = sum(x["fixing01"] for x in F.trade_resets(legs, {}, ids[-1], asof, date(2100, 1, 1)))
    assert periods >= 2 and abs(want) > 1.0 and want * most > 0
    assert abs(want) < abs(got) <= abs(most) * (1 + 1e-9), (want, got, most)
    print(f"the swap's floating leg: {periods} periods; a basis point on every fixing still to come is {want:,.2f} without compounding, "
          f"{most:,.2f} with each period's whole; the fixing ladder adds up to {got:,.2f}")
