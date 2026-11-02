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
    assert "README" in wb.sheetnames and "Curve" in wb.sheetnames
    assert "PillarDates" in wb.defined_names and "PillarDF" in wb.defined_names and "ValDate" in wb.defined_names
    formulas = [c.value for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith("=")]
    assert len(formulas) > 10
    assert any("PillarDF" in f for f in formulas), "DF interpolation must reference the curve pillars"
    if product in ("swaption", "cap", "crypto_ndo", "fx_option", "fx_option_styles"):
        assert any("NORM.S.DIST" in f for f in formulas)
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
    assert {"irs", "ois", "swaption", "cap", "fx_forward", "fx_option", "fx_option_styles", "crypto_ndf", "crypto_ndo", "xva", "simm", "confirm"} <= ids
    for p in rep.PRODUCTS:
        assert p["replication"] in ("xlsx", "doc", "xlsx-static", "verifier")
        if p["replication"] == "xlsx":
            assert p["id"] in rep.BUILDERS


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
