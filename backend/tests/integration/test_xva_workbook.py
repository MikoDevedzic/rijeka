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


@pytest.mark.parametrize("product,case_name", [("xva_fx", "XVA_FX_CASE"), ("xva_crypto", "XVA_CRYPTO_CASE")])
def test_the_currency_forward_xva_workbooks_run_what_the_tickets_route_runs(client, auth_a, product, case_name):
    """0.63.0. The XVA book of a currency forward and of a digital-asset forward takes its trade from the ticket's own
    reading of the account's market (the pair's stored spot, curves and points, the spot date, the surface's ATM term
    structure) and runs eighteen months, where the ticket's own grid is monthly: its engine side (which its cells
    reproduce: tests/test_methodology.py) against POST /api/xva/currency for the same forward, paths and seed, under
    each CSA preset: to the cent. Until then the books priced a six-month forward from fixed illustrative inputs, held
    one vol flat and ran monthly steps where a six-month ticket runs weekly ones: they held the engine's arithmetic,
    not a ticket's run."""
    from api.routes.methodology import market_for
    from db.session import SessionLocal
    from methodology import fx_xva_workbook as F
    case = getattr(F, case_name)
    db = SessionLocal()
    try:
        mkt = market_for(db, USER_A)
    finally:
        db.close()
    assert case["pair"] in mkt.fx_tickets, "the stack's account prices this pair: the book takes the ticket's forward"
    fi = F.forward_inputs(mkt, case)
    assert fi["ticket"] is True and fi["inp"].t_years > 1.02
    eng = F.engine_runs(fi)
    body = {"pair": case["pair"], "base_notional": case["notional"], "direction": F.DIRECTION, "settlement_date": fi["settle"].isoformat(),
            "valuation_date": mkt.valuation_date.isoformat(), "paths": F.N_PATHS, "seed": 42}
    for preset in F.PRESETS:
        r = client.post("/api/xva/currency", json={**body, "csa": {"preset": preset}}, headers=auth_a)
        assert r.status_code == 200, (preset, r.text[:300])
        out = r.json()
        assert out["steps"] == eng["T"] and out["dt"] == pytest.approx(eng["dt"]), "the ticket's own grid is the book's: monthly steps"
        wf = eng["runs"][preset][1]
        for k in ("cva", "dva", "fca", "fba", "kva", "mva", "colva", "xva_total"):
            assert out["xva"][k] == pytest.approx(getattr(wf, k), abs=0.0051), (preset, k)
        assert out["ee"] == pytest.approx([round(v, 2) for v in wf.ee], abs=0.0051), preset
        assert out["ene"] == pytest.approx([round(v, 2) for v in wf.ene], abs=0.0051), preset
    # the book builds from that market, and says its forward is the ticket's
    data, total = rep_build(product, mkt)
    assert total == pytest.approx(eng["runs"][F.DEFAULT_PRESET][1].xva_total)
    from openpyxl import load_workbook
    import io
    assert "the ticket's" in load_workbook(io.BytesIO(data))["Model"]["A13"].value


def rep_build(product, mkt):
    import methodology.replicate as rep
    return rep.build(product, mkt)


@pytest.mark.parametrize("product", ["xva_fx", "xva_crypto"])
def test_the_currency_forward_xva_workbooks_cells_reproduce_the_engine_on_the_accounts_market(product):
    """The same two books, built from the account's market (the ticket's forward, the stored surface's step vols, a
    digital asset's vol regimes): every row of the Checks sheet evaluated outside Excel under the three presets.
    Skipped where pycel is not installed."""
    pytest.importorskip("pycel")
    import io
    from openpyxl import load_workbook
    from api.routes.methodology import market_for
    from db.session import SessionLocal
    from methodology.fx_xva_workbook import PRESETS
    from scripts.check_workbook import run_checks
    db = SessionLocal()
    try:
        mkt = market_for(db, USER_A)
    finally:
        db.close()
    data, _ = rep_build(product, mkt)
    for preset in PRESETS:
        res = run_checks(load_workbook(io.BytesIO(data)), "Exposure!B4", preset)
        assert len(res) > 90 and any(x["label"].startswith("the vol of step") for x in res), "the surface's step vols are in the book"
        bad = [(x["label"], x["rel"]) for x in res if not x["ok"]]
        assert not bad, (preset, bad[:5])


@pytest.mark.parametrize("product,case_name,crypto", [("xva_fx_option", "XVA_FX_OPTION_CASE", False), ("xva_crypto_option", "XVA_CRYPTO_OPTION_CASE", True)])
def test_the_currency_option_xva_workbooks_run_what_the_tickets_route_runs(client, auth_a, ids, pairs, product, case_name, crypto):
    """0.63.0. The XVA book of a European option on a currency pair and on a digital asset takes its trade from the
    ticket's own reading of the account's market and runs the ticket's FLAT vol mode: the option is priced by the
    ticket's route, booked in the ticket's body, and POST /api/xva/currency-option with vol_mode FLAT answers, for the
    same paths and seed and under each CSA preset, what the book's engine side holds (which its cells reproduce): to
    the cent."""
    from api.routes.methodology import market_for
    from db.session import SessionLocal
    from methodology import fx_xva_workbook as F
    from tests.integration import bodies as B
    case = getattr(F, case_name)
    pair = case["pair"]
    db = SessionLocal()
    try:
        mkt = market_for(db, USER_A)
    finally:
        db.close()
    assert pair in mkt.fx_option_tickets, "the stack's account prices this pair: the book takes the ticket's option"
    db = SessionLocal()
    try:
        own = market_for(db, USER_A, product)        # a download prices its own book's trade and no other
    finally:
        db.close()
    assert set(own.fx_option_tickets) == {pair} and own.fx_tickets == {}
    assert own.fx_option_tickets[pair]["inp"] == mkt.fx_option_tickets[pair]["inp"]
    fi = F.option_inputs(mkt, case)
    assert fi["ticket"] is True and fi["inp"].t_settle > 1.02 and fi["inp"].pillars is None
    eng = F.engine_runs(fi)
    val = mkt.valuation_date.isoformat()
    q = client.post("/api/currency/option/price", json={"pair": pair, "option_type": F.OPTION_TYPE, "base_notional": case["notional"], "expiry_date": fi["expiry"].isoformat(),
                                                        "direction": F.DIRECTION, "settlement_type": "NON_DELIVERABLE" if crypto else "DELIVERABLE", "valuation_date": val}, headers=auth_a)
    assert q.status_code == 200, q.text[:300]
    quote = q.json()
    assert quote["settlement_date"] == fi["settle"].isoformat() and quote["strike"] == pytest.approx(fi["inp"].spec.strike, rel=1e-12)
    assert quote["npv"] == pytest.approx(fi["npv"], rel=1e-9), "the ticket's price is the NPV the book shows beside the run's value today"
    trade = (B.crypto_option if crypto else B.fx_option)(ids["a"], f"XVA-BOOK-{pair}", pairs[pair], quote, "EUROPEAN")
    for preset in F.PRESETS:
        r = client.post("/api/xva/currency-option", json={"trade": trade, "paths": F.N_PATHS, "seed": 42, "vol_mode": "FLAT", "valuation_date": val, "csa": {"preset": preset}}, headers=auth_a)
        assert r.status_code == 200, (preset, r.text[:300])
        out = r.json()
        assert out["steps"] == eng["T"] and out["dt"] == pytest.approx(eng["dt"]) and out["params"]["vol_mode"].upper().startswith("FLAT")
        wf = eng["runs"][preset][1]
        for k in ("cva", "dva", "fca", "fba", "kva", "mva", "colva", "xva_total"):
            assert out["xva"][k] == pytest.approx(getattr(wf, k), abs=0.0051), (preset, k)
        assert out["ee"] == pytest.approx([round(v, 2) for v in wf.ee], abs=0.0051), preset
        assert out["ene"] == pytest.approx([round(v, 2) for v in wf.ene], abs=0.0051), preset
        assert out["xva"]["npv"] == pytest.approx(fi["npv"], abs=0.0051)
    data, total = rep_build(product, mkt)
    assert total == pytest.approx(eng["runs"][F.DEFAULT_PRESET][1].xva_total)
    from openpyxl import load_workbook
    import io
    assert "the ticket's" in load_workbook(io.BytesIO(data))["Model"]["A13"].value


@pytest.mark.parametrize("product", ["xva_fx_option", "xva_crypto_option"])
def test_the_currency_option_xva_workbooks_cells_reproduce_the_engine_on_the_accounts_market(product):
    """The same two books, built from the account's market (the ticket's option, the stored surface's vol at its expiry
    and strike, a digital asset's vol regimes): every row of the Checks sheet evaluated outside Excel under the three
    presets. Skipped where pycel is not installed."""
    pytest.importorskip("pycel")
    import io
    from openpyxl import load_workbook
    from api.routes.methodology import market_for
    from db.session import SessionLocal
    from methodology.fx_xva_workbook import PRESETS
    from scripts.check_workbook import run_checks
    db = SessionLocal()
    try:
        mkt = market_for(db, USER_A)
    finally:
        db.close()
    data, _ = rep_build(product, mkt)
    for preset in PRESETS:
        res = run_checks(load_workbook(io.BytesIO(data)), "Exposure!B4", preset)
        assert len(res) >= 85 and sum(x["label"].startswith("V on path") for x in res) >= 6, "the option's value on a few paths is among the checks"
        bad = [(x["label"], x["rel"]) for x in res if not x["ok"]]
        assert not bad, (preset, bad[:5])

