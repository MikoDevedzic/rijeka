"""The rates XVA workbook replicates the ticket's own run: the figures the book's engine side computes (and its cells
reproduce: tests/test_methodology.py) are the figures POST /api/xva/simulate answers for the same trade, parameters,
paths and seed, under each CSA preset. Without this the book could agree with itself and not with the ticket."""
from __future__ import annotations

import pytest

from tests.integration.conftest import USER_A

pytestmark = pytest.mark.integration


def test_the_rates_xva_workbook_runs_what_the_tickets_route_runs(client, auth_a):
    from api.routes.methodology import market_for
    from db.session import SessionLocal
    from methodology.xva_workbook import PRESETS, engine_runs, hw1f_fit, trade_body
    db = SessionLocal()
    try:
        mkt = market_for(db, USER_A)
    finally:
        db.close()
    fit = hw1f_fit(mkt)
    n = 300
    eng = engine_runs(mkt, fit, n)
    body = {"paths": n, "seed": 42, "valuation_date": mkt.valuation_date.isoformat(), "curve_id": "USD_SOFR",
            "a": fit["a"], "sigma_bp": fit["sigma_bp"], "theta": fit["theta"], "trade": trade_body(mkt.valuation_date)}
    for preset in PRESETS:
        r = client.post("/api/xva/simulate", json={**body, "csa": {"preset": preset}}, headers=auth_a)
        assert r.status_code == 200, (preset, r.text[:300])
        out = r.json()
        assert out["basis"]["kind"] != "GENERIC_SWAP" and out["basis"]["exposure_discounting"] == "ON_PATH", out["basis"]
        wf = eng["runs"][preset][1]
        for k in ("cva", "dva", "fca", "fba", "kva", "mva", "colva", "xva_total"):
            assert out["xva"][k] == pytest.approx(getattr(wf, k), abs=0.0051), (preset, k)          # the route rounds to the cent
        # and the profiles, date by date
        assert out["ee"] == pytest.approx([round(v, 2) for v in wf.ee], abs=0.0051), preset
        assert out["ene"] == pytest.approx([round(v, 2) for v in wf.ene], abs=0.0051), preset
