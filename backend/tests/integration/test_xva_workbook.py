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


def test_the_cap_xva_workbook_runs_what_the_cap_tickets_route_runs(client, auth_a):
    """0.60.0. The cap book's engine side (which its cells reproduce: tests/test_methodology.py) against POST
    /api/xva/simulate for the same cap, parameters, paths and seed, under each CSA preset: to the cent."""
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
    eng = engine_runs(mkt, fit, n, "cap")
    body = {"paths": n, "seed": 42, "valuation_date": mkt.valuation_date.isoformat(), "curve_id": "USD_SOFR",
            "a": fit["a"], "sigma_bp": fit["sigma_bp"], "theta": fit["theta"], "trade": trade_body(mkt.valuation_date, "cap")}
    for preset in PRESETS:
        r = client.post("/api/xva/simulate", json={**body, "csa": {"preset": preset}}, headers=auth_a)
        assert r.status_code == 200, (preset, r.text[:300])
        out = r.json()
        assert out["basis"]["instrument"] == "IR_CAP" and out["basis"]["exposure_discounting"] == "ON_PATH", out["basis"]
        wf = eng["runs"][preset][1]
        for k in ("cva", "dva", "fca", "fba", "kva", "mva", "colva", "xva_total"):
            assert out["xva"][k] == pytest.approx(getattr(wf, k), abs=0.0051), (preset, k)
        assert out["ee"] == pytest.approx([round(v, 2) for v in wf.ee], abs=0.0051), preset
        assert out["ene"] == pytest.approx([round(v, 2) for v in wf.ene], abs=0.0051), preset


@pytest.mark.parametrize("product,instrument", [("floor", "IR_FLOOR"), ("collar", "IR_COLLAR")])
def test_the_floor_and_collar_xva_workbooks_run_what_their_tickets_route_runs(client, auth_a, product, instrument):
    """0.62.0. A floor's and a collar's book, as the cap's: the engine side (which the cells reproduce:
    tests/test_methodology.py) against POST /api/xva/simulate for the same trade, parameters, paths and seed, under
    each CSA preset: to the cent. The collar holds a written floor, so its set's value takes both signs: DVA and FBA
    are charged where a bought option has none."""
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
    eng = engine_runs(mkt, fit, n, product)
    body = {"paths": n, "seed": 42, "valuation_date": mkt.valuation_date.isoformat(), "curve_id": "USD_SOFR",
            "a": fit["a"], "sigma_bp": fit["sigma_bp"], "theta": fit["theta"], "trade": trade_body(mkt.valuation_date, product)}
    for preset in PRESETS:
        r = client.post("/api/xva/simulate", json={**body, "csa": {"preset": preset}}, headers=auth_a)
        assert r.status_code == 200, (preset, r.text[:300])
        out = r.json()
        assert out["basis"]["instrument"] == instrument and out["basis"]["exposure_discounting"] == "ON_PATH", out["basis"]
        wf = eng["runs"][preset][1]
        for k in ("cva", "dva", "fca", "fba", "kva", "mva", "colva", "xva_total"):
            assert out["xva"][k] == pytest.approx(getattr(wf, k), abs=0.0051), (preset, k)
        assert out["ee"] == pytest.approx([round(v, 2) for v in wf.ee], abs=0.0051), preset
        assert out["ene"] == pytest.approx([round(v, 2) for v in wf.ene], abs=0.0051), preset
    unc = eng["runs"]["UNCOLLATERALISED"][1]
    if product == "collar":
        assert unc.dva > 0 and float(eng["V"].min()) < 0 < float(eng["V"].max()), "a written floor is on the paths: the value takes both signs"
    else:
        assert float(eng["V"].min()) >= -1e-6 and abs(unc.dva) < 0.005, "a bought floor is never a liability"


def test_the_swaption_xva_workbook_runs_what_the_swaption_tickets_route_runs(client, auth_a):
    """0.62.0. The swaption's book: the engine side (which the cells reproduce: tests/test_methodology.py) against
    POST /api/xva/simulate for the same swaption as the ticket books it, with the same parameters, paths and seed,
    under each CSA preset: to the cent. The run starts from the model's own price of the option, not the ticket's."""
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
    eng = engine_runs(mkt, fit, n, "swaption")
    o = eng["option"]
    body = {"paths": n, "seed": 42, "valuation_date": mkt.valuation_date.isoformat(), "curve_id": "USD_SOFR",
            "a": fit["a"], "sigma_bp": fit["sigma_bp"], "theta": fit["theta"], "trade": trade_body(mkt.valuation_date, "swaption")}
    for preset in PRESETS:
        r = client.post("/api/xva/simulate", json={**body, "csa": {"preset": preset}}, headers=auth_a)
        assert r.status_code == 200, (preset, r.text[:300])
        out = r.json()
        assert out["basis"]["instrument"] == "IR_SWAPTION" and out["basis"]["exposure_discounting"] == "ON_PATH", out["basis"]
        wf = eng["runs"][preset][1]
        for k in ("cva", "dva", "fca", "fba", "kva", "mva", "colva", "xva_total"):
            assert out["xva"][k] == pytest.approx(getattr(wf, k), abs=0.0051), (preset, k)
        assert out["ee"] == pytest.approx([round(v, 2) for v in wf.ee], abs=0.0051), preset
        assert out["ene"] == pytest.approx([round(v, 2) for v in wf.ene], abs=0.0051), preset
    # the value today is the model's exact price of the option, and some paths exercise and some do not
    assert eng["v0"] == pytest.approx(10_000_000.0 * o["jam"]["npv"], rel=1e-6)
    exercised = int((o["swap"][:, o["i_exp"]] > 0).sum())
    assert 0 < exercised < n
