"""Excel replications: workbooks build, carry the formulas and the engine reference, products list is sane."""
import io
from datetime import date

import pytest
from openpyxl import load_workbook

from pricing.curve import Curve
from methodology import replicate as rep


def _mkt(flat=0.04):
    val = date(2026, 8, 3)
    # pillars every year to 30y on a flat 4% continuously compounded curve
    import math
    pil = [(val, 1.0)] + [(date(val.year + k, val.month, val.day), math.exp(-flat * k)) for k in range(1, 31)]
    pil.insert(1, (date(2026, 11, 3), math.exp(-flat * 0.25)))
    curve = Curve(val, df_pillars=pil)
    vol = [{"tenor": "1Yx5Y", "rate": 90.0, "enabled": True}]
    return rep.Market(valuation_date=val, curve_id="USD_SOFR", snapshot_date=val, source="TEST",
                      quotes=[{"tenor": "5Y", "quote_type": "OIS", "rate": 4.0, "enabled": True}],
                      curve=curve, vol_quotes=vol, vol_date=val)


@pytest.mark.parametrize("product", list(rep.BUILDERS))
def test_workbook_builds_with_formulas_and_reference(product):
    data, ref = rep.build(product, _mkt())
    wb = load_workbook(io.BytesIO(data))
    assert wb.sheetnames[0] == "Cover" and "Curve" in wb.sheetnames and "Checks" in wb.sheetnames
    assert "PillarDates" in wb.defined_names and "PillarDF" in wb.defined_names and "ValDate" in wb.defined_names
    formulas = [c.value for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("=")]
    assert len(formulas) > 10
    assert any("PillarDF" in f for f in formulas), "DF interpolation must reference the curve pillars"
    if product in ("swaption", "cap", "crypto_ndo", "fx_option", "fx_option_styles", "crypto_option_styles"):
        assert any("NORMSDIST(" in f for f in formulas)
    assert not any("NORM.S.DIST" in f or "_xlfn" in f for f in formulas), "only legacy spreadsheet functions: no compatibility prompt in Excel"
    assert isinstance(ref, float)


def test_df_formula_matches_curve_interpolation():
    """The Excel DF formula is log-linear between bracketing pillar dates, like pricing/curve.py."""
    f = rep.DF("A9")
    assert "MATCH(A9,PillarDates,1)" in f and "LN(" in f and "EXP(" in f and "ROWS(PillarDates)-1" in f


def test_irs_reference_is_the_engine_value():
    """The green reference numbers are Rijeka's engine output, not re-derived in the sheet."""
    mkt = _mkt()
    data, npv = rep.build("irs", mkt)
    wb = load_workbook(io.BytesIO(data))
    assert wb["Summary"]["B2"].value == pytest.approx(npv)
    # pay 4% on a flat 4% (cont.) curve: par is a bit above 4% simple, so the payer swap has positive value
    assert 0 < npv < 300_000


def test_products_list_covers_crypto_and_post_trade():
    ids = {p["id"] for p in rep.PRODUCTS}
    assert {"irs", "ois", "swaption", "cap", "fx_forward", "fx_option", "fx_option_styles", "crypto_ndf", "crypto_ndo", "crypto_option_styles", "xva", "confirm"} <= ids
    for p in rep.PRODUCTS:
        assert p["replication"] in ("xlsx", "doc", "xlsx-static", "verifier")
        if p["replication"] == "xlsx":
            assert p["id"] in rep.BUILDERS
    # Rijeka does not compute ISDA SIMM (it is licensed): there is no SIMM replication to list
    assert "simm" not in ids


def test_route_rejects_unknown_product(monkeypatch):
    from fastapi.testclient import TestClient
    from unittest.mock import MagicMock
    from main import app
    from db.session import get_db
    from middleware.auth import verify_token
    app.dependency_overrides[get_db] = lambda: MagicMock()
    app.dependency_overrides[verify_token] = lambda: {"sub": "00000000-0000-0000-0000-000000000000"}
    try:
        c = TestClient(app)
        assert c.get("/api/methodology/nope/replication.xlsx").status_code == 404
        r = c.get("/api/methodology/products"); assert r.status_code == 200 and len(r.json()) >= 9
    finally:
        app.dependency_overrides.pop(get_db, None); app.dependency_overrides.pop(verify_token, None)


def test_sheet_arithmetic_reproduces_engine_legs():
    """
    No spreadsheet engine here, so evaluate the leg formulas' arithmetic in
    Python with the same inputs the sheet gets (schedule dates as values, DFs
    by the curve's own interpolation, ACT/360 and 30/360 day counts) and
    compare with Rijeka's leg PVs. This is the parity the green cells claim.
    """
    from datetime import date
    from pricing.day_count import thirty360, act360
    from pricing.schedule import generate_schedule
    from pricing.ir_swap import price_swap
    from decimal import Decimal
    mkt = _mkt(); val = mkt.valuation_date; spot = rep._spot(val); mat = date(spot.year + 5, spot.month, spot.day)
    N, r = 10_000_000, 0.04
    legs = [
        {"id": "f", "leg_ref": "FIXED", "leg_type": "FIXED", "direction": "PAY", "currency": "USD", "notional": N, "day_count": "30/360",
         "payment_frequency": "SEMI_ANNUAL", "bdc": "MOD_FOLLOWING", "fixed_rate": r, "effective_date": spot.isoformat(), "maturity_date": mat.isoformat(),
         "discount_curve_id": "USD_SOFR", "forecast_curve_id": "USD_SOFR"},
        {"id": "l", "leg_ref": "FLOAT", "leg_type": "FLOAT", "direction": "RECEIVE", "currency": "USD", "notional": N, "day_count": "ACT/360",
         "payment_frequency": "QUARTERLY", "bdc": "MOD_FOLLOWING", "spread": 0.0, "effective_date": spot.isoformat(), "maturity_date": mat.isoformat(),
         "discount_curve_id": "USD_SOFR", "forecast_curve_id": "USD_SOFR"},
    ]
    res = price_swap("t", legs, {"USD_SOFR": mkt.curve}, val)
    eng = {l.leg_ref: abs(l.pv) for l in res.legs}
    def leg(freq, dc, is_float, df_at):
        tot = 0.0
        for p in generate_schedule(spot, mat, freq, dc, Decimal(N), "MOD_FOLLOWING", is_float=is_float):
            tau = float((act360 if dc == "ACT/360" else thirty360)(p.period_start, p.period_end))
            rate = (mkt.curve.df(p.period_start) / mkt.curve.df(p.period_end) - 1) / tau if is_float else r
            tot += N * rate * tau * mkt.curve.df(getattr(p, df_at))
        return tot
    # Engine and sheet both discount at the business-day-adjusted payment date
    # (the date the cash moves). Same arithmetic, machine precision:
    assert leg("SEMI_ANNUAL", "30/360", False, "payment_date") == pytest.approx(eng["FIXED"], rel=1e-9)
    assert leg("QUARTERLY", "ACT/360", True, "payment_date") == pytest.approx(eng["FLOAT"], rel=1e-9)
    # Discounting at the unadjusted period end (the pre-v0.5 behaviour) differs
    # only where a date rolled over a weekend: a day or two, a few $ per million.
    assert leg("SEMI_ANNUAL", "30/360", False, "period_end") == pytest.approx(eng["FIXED"], rel=2e-4)
    assert leg("SEMI_ANNUAL", "30/360", False, "period_end") != pytest.approx(eng["FIXED"], rel=1e-9)


def _ref_cells(ws, rows, fcol, rcol):
    """(label, Rijeka value) for the reference rows of a sheet; every formula cell must reference the Inputs names."""
    out = []
    for r in rows:
        f = ws.cell(row=r, column=fcol).value
        assert isinstance(f, str) and f.startswith("=")
        out.append((ws.cell(row=r, column=1).value, ws.cell(row=r, column=rcol).value))
    return out


def test_fx_option_workbooks_carry_the_engine_and_the_closed_forms():
    """
    The styles sheets are closed forms (Reiner–Rubinstein, the two-barrier image series) while the engine integrates
    numerically; the green cells must be the engine's values and the closed forms, evaluated here in Python with the
    sheet's own inputs, must agree with them. (The sheet formulas themselves were evaluated with a spreadsheet engine
    against these same numbers when the workbook was written: all within 1e-6 relative.)
    """
    import math
    from pricing.fx_exotic import ExoticSpec, price_exotic
    mkt = _mkt()
    data, _ = rep.build("fx_option_styles", mkt)
    wb = load_workbook(io.BytesIO(data))
    inp = wb["Inputs"]
    S, N, exp, settle, r_eur, vol = inp["B1"].value, inp["B2"].value, inp["B3"].value.date(), inp["B4"].value.date(), inp["B8"].value, inp["B11"].value
    val = mkt.valuation_date
    T_e, T_s = (exp - val).days / 365, (settle - val).days / 365
    df = mkt.curve.df(settle); F = S * math.exp(-r_eur * T_s) / df
    r = -math.log(df) / T_e; b = math.log(F / S) / T_e
    Nn = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
    sT = vol * math.sqrt(T_e); dfT = math.exp(-r * T_e); dfb = math.exp((b - r) * T_e)
    kw = dict(base_notional=N, spot=S, forward=F, df_quote=df, t_expiry=T_e, vol=vol)
    # digital, cash and asset
    K = F; d1 = (math.log(S / K) + (b + 0.5 * vol ** 2) * T_e) / sT; d2 = d1 - sT; Q = wb["Digital"]["B2"].value
    want = [Q * dfT * Nn(d2), Q * dfT * Nn(-d2), Q * S * dfb * Nn(d1), Q * S * dfb * Nn(-d1)]
    for (label, green), w, spec in zip(_ref_cells(wb["Digital"], range(7, 11), 2, 3), want,
                                       [dict(option_type="CALL"), dict(option_type="PUT"), dict(option_type="CALL", payout_currency="BASE"), dict(option_type="PUT", payout_currency="BASE")]):
        assert green == pytest.approx(price_exotic(ExoticSpec(style="DIGITAL", strike=K, payout=Q, **spec), **kw).npv)
        assert w == pytest.approx(green, rel=1e-9), label
    # single barriers: Reiner–Rubinstein against the engine's survival-density integral
    bs = wb["Barrier"]; Hup, Hdn, R = bs["B2"].value, bs["B3"].value, bs["B4"].value
    mu = (b - 0.5 * vol ** 2) / vol ** 2; lam = math.sqrt(mu * mu + 2 * r / vol ** 2)
    def rr(bt, call, H):
        phi, eta = (1 if call else -1), (1 if bt.startswith("DOWN") else -1)
        x1 = math.log(S / K) / sT + (1 + mu) * sT; x2 = math.log(S / H) / sT + (1 + mu) * sT
        y1 = math.log(H * H / (S * K)) / sT + (1 + mu) * sT; y2 = math.log(H / S) / sT + (1 + mu) * sT; z = math.log(H / S) / sT + lam * sT
        A = phi * S * dfb * Nn(phi * x1) - phi * K * dfT * Nn(phi * x1 - phi * sT)
        B = phi * S * dfb * Nn(phi * x2) - phi * K * dfT * Nn(phi * x2 - phi * sT)
        C = phi * S * dfb * (H / S) ** (2 * (mu + 1)) * Nn(eta * y1) - phi * K * dfT * (H / S) ** (2 * mu) * Nn(eta * y1 - eta * sT)
        D = phi * S * dfb * (H / S) ** (2 * (mu + 1)) * Nn(eta * y2) - phi * K * dfT * (H / S) ** (2 * mu) * Nn(eta * y2 - eta * sT)
        E = R * dfT * (Nn(eta * x2 - eta * sT) - (H / S) ** (2 * mu) * Nn(eta * y2 - eta * sT))
        Fv = R * ((H / S) ** (mu + lam) * Nn(eta * z) + (H / S) ** (mu - lam) * Nn(eta * z - 2 * eta * lam * sT))
        table = {("DOWN_IN", True): ("C+E", "A-B+D+E"), ("UP_IN", True): ("A+E", "B-C+D+E"), ("DOWN_IN", False): ("B-C+D+E", "A+E"), ("UP_IN", False): ("A-B+D+E", "C+E"),
                 ("DOWN_OUT", True): ("A-C+F", "B-D+F"), ("UP_OUT", True): ("F", "A-B+C-D+F"), ("DOWN_OUT", False): ("A-B+C-D+F", "F"), ("UP_OUT", False): ("B-D+F", "A-C+F")}
        expr = table[(bt, call)][0 if K > H else 1]
        return eval(expr, {"A": A, "B": B, "C": C, "D": D, "E": E, "F": Fv}) * N
    for k, (bt, ot) in enumerate([("UP_IN", "CALL"), ("UP_IN", "PUT"), ("UP_OUT", "CALL"), ("UP_OUT", "PUT"), ("DOWN_IN", "CALL"), ("DOWN_IN", "PUT"), ("DOWN_OUT", "CALL"), ("DOWN_OUT", "PUT")]):
        H = Hup if bt.startswith("UP") else Hdn
        green = bs.cell(row=9 + k, column=18).value
        assert green == pytest.approx(price_exotic(ExoticSpec(style="BARRIER", option_type=ot, strike=K, barrier_type=bt, barrier=H, rebate=R), **kw).npv)
        assert rr(bt, ot == "CALL", H) == pytest.approx(green, rel=2e-6), (bt, ot)
    # touches
    ts = wb["Touch"]; Qt = ts["B1"].value
    def p_no(H):
        eta = 1 if H < S else -1
        x2 = math.log(S / H) / sT + (1 + mu) * sT; y2 = math.log(H / S) / sT + (1 + mu) * sT
        return Nn(eta * x2 - eta * sT) - (H / S) ** (2 * mu) * Nn(eta * y2 - eta * sT)
    def fpv(H):
        eta = 1 if H < S else -1; z = math.log(H / S) / sT + lam * sT
        return (H / S) ** (mu + lam) * Nn(eta * z) + (H / S) ** (mu - lam) * Nn(eta * z - 2 * eta * lam * sT)
    want = [Qt * fpv(Hup), Qt * dfT * (1 - p_no(Hup)), Qt * dfT * p_no(Hup), Qt * fpv(Hdn), Qt * dfT * (1 - p_no(Hdn)), Qt * dfT * p_no(Hdn)]
    for (label, green), w in zip(_ref_cells(ts, range(12, 18), 2, 3), want):
        assert w == pytest.approx(green, rel=1e-6), label
    # double barriers: the image series summed in closed form
    ds = wb["DoubleBarrier"]; Lo, Up, Qd = ds["B2"].value, ds["B3"].value, ds["B4"].value
    assert Qd == pytest.approx(1_000_000.0)
    l, u = math.log(Lo / S), math.log(Up / S); W = u - l; k_ = math.log(K / S); m = (b - 0.5 * vol ** 2) * T_e; v = vol ** 2 * T_e; sd = math.sqrt(v)
    G = lambda x, c: Nn((x - c - m) / sd); G1 = lambda x, c: Nn((x - c - m - v) / sd)
    def series(term):
        return sum(term(2 * n * W) - term(2 * l - 2 * n * W) for n in range(-12, 13))
    a = max(l, k_); bb = min(u, k_)
    call_t = lambda c: math.exp(m * c / v) * (S * math.exp(c + m + v / 2) * (G1(u, c) - G1(a, c)) - K * (G(u, c) - G(a, c))) if a < u else 0.0
    put_t = lambda c: math.exp(m * c / v) * (K * (G(bb, c) - G(l, c)) - S * math.exp(c + m + v / 2) * (G1(bb, c) - G1(l, c))) if bb > l else 0.0
    surv_t = lambda c: math.exp(m * c / v) * (G(u, c) - G(l, c))
    greens = [ds.cell(row=rw, column=13).value for rw in range(5, 11)]
    ko_c, ko_p, dnt = dfT * series(call_t) * N, dfT * series(put_t) * N, Qd * dfT * series(surv_t)
    van_c = df * (F * Nn((math.log(F / K) + 0.5 * vol ** 2 * T_e) / sT) - K * Nn((math.log(F / K) - 0.5 * vol ** 2 * T_e) / sT)) * N
    van_p = van_c - df * (F - K) * N
    for w, green, label in zip([ko_c, van_c - ko_c, ko_p, van_p - ko_p, dnt, Qd * dfT - dnt], greens, ["DKO call", "DKI call", "DKO put", "DKI put", "DNT", "DOT"]):
        assert green == pytest.approx(w, rel=2e-6), label
    assert greens[4] == pytest.approx(price_exotic(ExoticSpec(style="TOUCH", touch_type="DOUBLE_NO_TOUCH", payout=Qd, lower=Lo, upper=Up), **kw).npv)


def test_every_workbook_has_the_open_box_sheets_and_live_links():
    """Cover with the verdict, Ticket and Derivation that link into the sheets, Checks with a PASS/FAIL per comparison."""
    import re
    for product in rep.BUILDERS:
        data, _ = rep.build(product, _mkt())
        wb = load_workbook(io.BytesIO(data))
        assert wb.sheetnames[:3] == ["Cover", "Ticket", "Derivation"] and wb.sheetnames[-1] == "Checks", product
        cover = wb["Cover"]
        assert any(isinstance(c.value, str) and "COUNTIF(Checks" in c.value for row in cover.iter_rows() for c in row), product
        checks = wb["Checks"]
        rows = [r for r in checks.iter_rows(min_row=5) if r[0].value]
        assert rows, product
        for r in rows:
            sheet = r[0].value
            assert sheet in wb.sheetnames
            assert str(r[2].value).startswith(f"='{sheet}'!") and str(r[7].value).startswith("=IF(") and '"PASS"' in str(r[7].value)
            assert r[1].hyperlink is not None
        # every ticket and derivation reference points at a cell that holds something
        for name in ("Ticket", "Derivation"):
            ws = wb[name]
            for row in ws.iter_rows(min_row=5):
                for c in row:
                    if c.hyperlink and c.hyperlink.target and c.hyperlink.target.startswith("#"):
                        m = re.fullmatch(r"#'([^']+)'!([A-Z]+[0-9]+)", c.hyperlink.target)
                        assert m and m.group(1) in wb.sheetnames and wb[m.group(1)][m.group(2)].value is not None, (product, name, c.hyperlink.target)


def test_option_workbooks_carry_a_scenario_chart_and_a_call_put_dropdown():
    for product in ("fx_option", "crypto_ndo"):
        data, _ = rep.build(product, _mkt())
        wb = load_workbook(io.BytesIO(data))
        assert "Scenario" in wb.sheetnames and len(wb["Scenario"]._charts) == 1
        assert any(dv.formula1 == '"1,-1"' for dv in wb["European"].data_validations.dataValidation)


def test_xva_rates_workbook_carries_the_engine_draws_and_a_live_mode():
    from methodology.xva_workbook import N_PATHS, engine_runs, hw1f_fit
    mkt = _mkt()
    fit = hw1f_fit(mkt)
    assert 0 < fit["a"] < 1 and 5 < fit["sigma_bp"] < 150 and fit["basket"]
    eng = engine_runs(mkt, fit)
    assert eng["sim"].z.shape == (N_PATHS, eng["T"]) and abs(eng["sim"].z.mean()) < 0.1
    assert set(eng["runs"]) == {"UNCOLLATERALISED", "BILATERAL", "ON_CHAIN"}
    assert eng["runs"]["ON_CHAIN"][1].cva > eng["runs"]["UNCOLLATERALISED"][1].cva            # margining cuts the cost (less negative)
    data, total = rep.build("xva_rates", mkt)
    wb = load_workbook(io.BytesIO(data))
    for s_ in ("Model", "Calibration", "Bonds", "Normals", "Paths", "Exposure", "Waterfall", "Engine", "Convergence", "Checks"):
        assert s_ in wb.sheetnames
    assert any(dv.formula1 == '"ENGINE,LIVE"' for dv in wb["Model"].data_validations.dataValidation)
    assert wb["Normals"]["B6"].value == pytest.approx(float(eng["sim"].z[0, 0]))                  # the engine's first draw, as a value
    z = wb["Paths"]["B6"].value
    assert z.startswith('=IF(Mode="ENGINE",Normals!B6,NORMSINV(RAND()))')
    assert any("LIVE" in str(c.value) for row in wb["Checks"].iter_rows(min_row=5, min_col=8, max_col=8) for c in row)
    assert len(wb["Convergence"]._charts) == 1 and total == pytest.approx(eng["runs"]["BILATERAL"][1].xva_total)


def test_xva_fx_workbooks_carry_the_engine_draws_and_a_live_mode():
    import numpy as np
    from methodology.fx_xva_workbook import N_PATHS, XVA_CRYPTO_CASE, XVA_FX_CASE, engine_runs, forward_inputs
    from pricing.csa import CSA
    from pricing.fx_vol import quotes_from_grid, vol_at
    from pricing.fx_xva import forward_xva
    mkt = _mkt()
    for product, case in (("xva_fx", XVA_FX_CASE), ("xva_crypto", XVA_CRYPTO_CASE)):
        fi = forward_inputs(mkt, case)
        eng = engine_runs(fi)
        assert eng["noise"]["z"].shape == (N_PATHS, eng["T"]) and eng["T"] >= 6 and abs(eng["noise"]["z"].mean()) < 0.1
        assert set(eng["runs"]) == {"UNCOLLATERALISED", "BILATERAL", "ON_CHAIN"}
        assert eng["runs"]["BILATERAL"][1].cva > eng["runs"]["UNCOLLATERALISED"][1].cva           # margining cuts the cost (less negative)
        assert fi["inp"].vol_pct is None and fi["pillars"] == []                                    # the test market has no surface: the engine's default, labelled
        data, total = rep.build(product, mkt)
        wb = load_workbook(io.BytesIO(data))
        for s_ in ("Model", "Calibration", "Normals", "Paths", "Exposure", "Waterfall", "Engine", "Convergence", "Checks"):
            assert s_ in wb.sheetnames
        assert any(dv.formula1 == '"ENGINE,LIVE"' for dv in wb["Model"].data_validations.dataValidation)
        assert any(dv.formula1 == '"UNCOLLATERALISED,BILATERAL,ON_CHAIN"' for dv in wb["Exposure"].data_validations.dataValidation)
        assert wb["Normals"]["B6"].value == pytest.approx(float(eng["noise"]["z"][0, 0]))          # the engine's first draw, as a value
        assert wb["Paths"]["B6"].value.startswith('=IF(Mode="ENGINE",Normals!B6,NORMSINV(RAND()))')
        assert "default" in wb["Calibration"]["B4"].value and wb["Calibration"]["B5"].value == pytest.approx(eng["sigma"])
        # the Engine sheet's BILATERAL column is forward_xva's own run on the same draws and bridge seed
        wf, _ = forward_xva(fi["inp"], CSA.from_request({"preset": "BILATERAL"}), n_paths=N_PATHS, waterfall_rng=np.random.default_rng(43))
        es = wb["Engine"]
        assert es["C4"].value == "BILATERAL"
        got = {es.cell(row=r, column=1).value: es.cell(row=r, column=3).value for r in range(5, 17)}
        for label, attr in (("CVA", "cva"), ("DVA", "dva"), ("FVA", "fva"), ("FBA", "fba"), ("KVA", "kva"), ("MVA", "mva"), ("XVA total", "xva_total"), ("IM₀", "im_0"), ("EAD over the first step", "ead_0")):
            assert got[label] == pytest.approx(getattr(wf, attr))
        # the margin is the engine's estimate (the first date's 99th percentile fall), and the workbook rebuilds it in cells
        assert total == pytest.approx(wf.xva_total) and wf.im_0 == wf.im_profile[0] > 0 and "not ISDA SIMM" in wf.im_basis
        assert "PERCENTILE(" in wb["Exposure"]["K24"].value and "IMq" in wb["Exposure"]["N24"].value and wb["Exposure"]["B16"].value == 0.99
        formulas = [c.value for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("=")]
        assert any("NORMSDIST(" in f or "NORMSINV(" in f for f in formulas) and not any("NORM.S.DIST" in f or "_xlfn" in f for f in formulas)
        assert any("LIVE" in str(c.value) for row in wb["Checks"].iter_rows(min_row=5, min_col=8, max_col=8) for c in row)
        assert len(wb["Convergence"]._charts) == 1
    # with a surface saved, the Calibration sheet carries the quotes and σ is the smile vol at K = F, as the XVA route reads it
    mkt.fx_vol_quotes = quotes_from_grid({"1M": {"ATM": 7.2, "RR25": -0.35, "BF25": 0.2}, "6M": {"ATM": 7.6, "RR25": -0.45, "BF25": 0.25}, "1Y": {"ATM": 7.9, "RR25": -0.5, "BF25": 0.28}})
    fi = forward_inputs(mkt, XVA_FX_CASE)
    assert len(fi["pillars"]) == 3 and fi["inp"].vol_pct == pytest.approx(100 * vol_at(fi["pillars"], fi["inp"].t_years, fi["inp"].forward, fi["inp"].forward))
    assert 7.5 < fi["inp"].vol_pct < 7.7 and fi["inp"].vol_pct != pytest.approx(7.6 + 0.3 * (fi["inp"].t_years - 0.5) / 0.5)   # the smile moves it off the interpolated ATM
    data, _ = rep.build("xva_fx", mkt)
    wb = load_workbook(io.BytesIO(data))
    cal = wb["Calibration"]
    assert cal["A10"].value == "1M" and cal["C10"].value == 7.2 and cal["D11"].value == -0.45 and str(cal["B5"].value).startswith("=F")
    assert any("NORMSDIST(" in str(c.value) for row in cal.iter_rows(min_col=4, max_col=4) for c in row)


def test_hw1f_mc_matches_the_route_loop():
    """The extracted simulation is the route's loop: same rng order, same reconstitution. Checked against a
    re-implementation here at a few points, and the par-swap anchor near zero on a flat curve."""
    import math
    import numpy as np
    from pricing.hw1f_mc import grids, simulate_swap_paths
    T, DT, a, sig = 12, 1 / 12, 0.05, 0.0080
    p0 = lambda t: math.exp(-0.04 * t)
    p0g, f0g = grids(p0, T, DT, 0.04)
    assert all(abs(f - 0.04) < 1e-9 for f in f0g)
    par = (1 - p0g[T]) / sum(DT * p0g[j + 1] for j in range(T))
    sim = simulate_swap_paths(a, sig, p0g, f0g, T, DT, 1e7, par, 4000, direction="RECEIVE", seed=1)
    assert abs(sim.paths[:, 0].mean()) < 1.5e4                                                   # a par swap is worth ~0 at the first step
    rng = np.random.default_rng(1); z0 = rng.standard_normal(4000)
    assert np.allclose(sim.z[:, 0], z0) and np.allclose(sim.x[:, 0], sig * math.sqrt((1 - math.exp(-2 * a * DT)) / (2 * a)) * z0)
