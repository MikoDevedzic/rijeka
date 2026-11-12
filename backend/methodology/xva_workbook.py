"""The XVA replication for a swap: the Hull-White Monte Carlo, the CSA, the waterfall and the
calibration, cell by cell.

    Model        the parameters, the grid, P(0,t), f(0,t), α(t): the exact-fit Hull-White step
    Calibration  the swaption basket, the model's closed-form normal vol at the fitted (a, σ), the
                 errors and the RMSE, and an RMSE grid around the fit so the minimum is visible
    Bonds        B(t,T) and ln A(t,T) for every (step, future step): the reconstitution tables
    Normals      the engine's own standard normals, and the margin-period bridge draws, as values
    Paths        Z (ENGINE: the values above; LIVE: NORMSINV(RAND())), x, r, annuity, P(t,T_M), V
    Exposure     the CSA (a preset, or the terms you set), V lagged by the margin period, the
                 collateral, the residual, EE / ENE / PFE / IM per step
    Waterfall    survival, CVA, DVA, FVA, FBA, SA-CCR EAD, KVA, MVA, ColVA, step by step, and the totals
    Convergence  the running mean of EE at one date against path count, with ±2 standard errors
    Engine       what the engine computed on the same draws, per CSA preset (for the Checks)

ENGINE mode reproduces the engine to rounding (the Checks sheet says so); LIVE mode re-rolls the
simulation on every recalculation and the Convergence sheet shows the Monte Carlo error. A 2-year
swap on a monthly grid at 200 paths keeps the book near 60,000 formula cells."""
from __future__ import annotations

import math
from datetime import timedelta

import numpy as np
from openpyxl import Workbook
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter as L

from methodology import workbook as W
from pricing.calibration import calibrate_hw1f, hw1f_swaption_vol_normal, tenor_to_years
from pricing.csa import CSA, BUSINESS_DAYS_PER_YEAR, MPOR_FLOOR_BILATERAL_BD, MPOR_FLOOR_CLEARED_BD
from pricing.curve import discount_fn_from_curve
from pricing.hw1f_mc import grids, simulate_swap_paths
from pricing.xva_engine import ALPHA, CAP_R, IM_CONFIDENCE, SF_IR, WaterfallParams, run_waterfall

N_PATHS, MATURITY_Y, NOTIONAL, FIXED_RATE, DIRECTION = 200, 2.0, 10_000_000.0, 0.03643, "PAY"
DT = 1.0 / 12.0
PRESETS = ("UNCOLLATERALISED", "BILATERAL", "ON_CHAIN")
DEFAULT_PRESET = "BILATERAL"
BASKET_DEF = [("1Y", "5Y", 1.0), ("2Y", "5Y", 1.0), ("3Y", "5Y", 1.0), ("5Y", "5Y", 1.0), ("7Y", "5Y", 0.8), ("10Y", "5Y", 0.6),
              ("1Y", "1Y", 0.8), ("1Y", "2Y", 0.8), ("1Y", "3Y", 0.8), ("1Y", "7Y", 0.8), ("1Y", "9Y", 0.8), ("3Y", "7Y", 0.8), ("7Y", "3Y", 0.8), ("5Y", "9Y", 0.7)]
MAX_PAY = 9


# ── the engine's own numbers ──────────────────────────────────────────────────

def _basket(mkt) -> list[dict]:
    vols = {}
    for q in mkt.vol_quotes or []:
        t = str(q.get("tenor") or "").upper()
        if "X" in t and q.get("rate") is not None:
            e, s = t.split("X", 1)
            vols[(e, s)] = float(q["rate"])
    out = []
    for e, s, w in BASKET_DEF:
        if (e, s) in vols:
            out.append({"expiry": e, "tenor": s, "expiry_y": tenor_to_years(e), "tenor_y": tenor_to_years(s), "vol_bp": vols[(e, s)], "weight": w})
    return out


def hw1f_fit(mkt) -> dict:
    """The stored calibration when the account has one, else a calibration run now on the same basket and curve."""
    basket = _basket(mkt)
    disc = discount_fn_from_curve(mkt.curve)
    theta = next((float(q["rate"]) / 100.0 for q in (mkt.quotes or []) if str(q.get("tenor")).upper() == "5Y" and q.get("rate") is not None), 0.0365)
    stored = getattr(mkt, "hw1f", None)
    if stored and stored.get("a") and stored.get("sigma_bp"):
        a, sigma_bp, theta = float(stored["a"]), float(stored["sigma_bp"]), float(stored.get("theta") or theta)
        src = f"the account's stored calibration of {stored.get('valuation_date')}"
    elif basket:
        res = calibrate_hw1f(basket, theta=theta, discount_fn=disc)
        a, sigma_bp = res["a"], res["sigma_bp"]
        src = "calibrated at export on the same basket and curve"
    else:
        a, sigma_bp, src = 0.03, 35.0, "desk defaults (no swaption surface saved)"
    for b in basket:
        b["mdl_vol_bp"] = hw1f_swaption_vol_normal(a, sigma_bp / 1e4, theta, b["expiry_y"], b["tenor_y"], discount_fn=disc)
    rmse = math.sqrt(sum((b["mdl_vol_bp"] - b["vol_bp"]) ** 2 for b in basket) / len(basket)) if basket else None
    return {"a": a, "sigma_bp": sigma_bp, "theta": theta, "basket": basket, "rmse": rmse, "source": src}


def engine_runs(mkt, fit: dict) -> dict:
    """The simulation on the workbook's trade, and the waterfall under each CSA preset."""
    val = mkt.valuation_date
    p0 = lambda t: 1.0 if t <= 0 else mkt.curve.df(val + timedelta(days=int(round(t * 365.0))))
    T = int(MATURITY_Y * 12)
    p0_grid, f0_grid = grids(p0, T, DT, fit["theta"])
    sim = simulate_swap_paths(fit["a"], fit["sigma_bp"] / 1e4, p0_grid, f0_grid, T, DT, NOTIONAL, FIXED_RATE, N_PATHS, direction=DIRECTION)
    v0 = float(np.mean(sim.paths[:, 0]))
    params = WaterfallParams(notional=NOTIONAL, maturity_y=MATURITY_Y, dt=DT, theta=fit["theta"])
    runs = {}
    for preset in PRESETS:
        csa = CSA.from_request({"preset": preset})
        runs[preset] = (csa, run_waterfall(sim.paths, v0, p0_grid, params, csa))
    return {"sim": sim, "v0": v0, "T": T, "p0_grid": p0_grid, "f0_grid": f0_grid, "runs": runs}


# ── the sheets ───────────────────────────────────────────────────────────────

def _names(wb, mapping: dict[str, str]):
    from openpyxl.workbook.defined_name import DefinedName
    for name, ref in mapping.items():
        sheet, addr = ref.split("!")
        col = "".join(ch for ch in addr if ch.isalpha()); row = "".join(ch for ch in addr if ch.isdigit())
        wb.defined_names[name] = DefinedName(name, attr_text=f"'{sheet}'!${col}${row}")


def _model_sheet(wb, mkt, fit, eng):
    T = eng["T"]
    ws = wb.create_sheet("Model")
    ws["A1"] = "HULL-WHITE ONE FACTOR, EXACT-FIT FORM"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "r(t) = x(t) + α(t): x a zero-mean Ornstein–Uhlenbeck process stepped exactly, α(t) the shift that makes the model reprice today's curve."; ws["A2"].font = W.F_SUB
    rows = [("Mean reversion a", fit["a"], "0.000000", True), ("σ (short-rate vol, decimal)", fit["sigma_bp"] / 1e4, "0.000000", True),
            ("θ (long-run rate, the fallback level)", fit["theta"], "0.0000%", False), ("Δ (years per step)", DT, "0.000000", False),
            ("Steps T", T, "0", False), ("Notional", NOTIONAL, "#,##0", True), ("Fixed rate K", FIXED_RATE, "0.0000%", True),
            ("Side (PAY = −1, RECEIVE = +1)", -1 if DIRECTION == "PAY" else 1, "0", True), ("Paths", N_PATHS, "0", False),
            ("Mode (ENGINE: the engine's draws; LIVE: Excel re-rolls)", "ENGINE", "@", True),
            ("e^(−aΔ)", "=EXP(-HW_a*Dt)", "0.00000000", False), ("σ·√((1 − e^(−2aΔ))/2a)", "=HW_sig*SQRT((1-EXP(-2*HW_a*Dt))/(2*HW_a))", "0.00000000", False),
            ("σ²/(2a²)", "=HW_sig^2/(2*HW_a^2)", "0.00000000", False), ("σ²/(4a)", "=HW_sig^2/(4*HW_a)", "0.00000000", False)]
    for i, (label, v, fmt, inp) in enumerate(rows, 4):
        ws.cell(row=i, column=1, value=label)
        c = ws.cell(row=i, column=2, value=v); c.number_format = fmt
        if inp:
            c.fill = W.FILL_IN
        if label.startswith(("Mean reversion", "σ (short")):
            c.fill = W.FILL_RJ
    W.dropdown(ws, "B13", ["ENGINE", "LIVE"])
    _names(wb, {"HW_a": "Model!B4", "HW_sig": "Model!B5", "Theta": "Model!B6", "Dt": "Model!B7", "Nsteps": "Model!B8", "Notl": "Model!B9", "Kfix": "Model!B10",
                "Sgn": "Model!B11", "Npaths": "Model!B12", "Mode": "Model!B13", "EADT": "Model!B14", "STDDT": "Model!B15", "SigA2": "Model!B16", "SigA4": "Model!B17"})
    ws["A19"] = "THE GRID"; ws["A19"].font = W.F_SECTION
    W.header(ws, 20, ["k", "t = k·Δ", "date (valuation + round(t·365), as the engine counts; a value)", "P(0,t) from the curve", "f(0,t) = −ln(P(0,t+Δ)/P(0,t))/Δ", "α(t) = f(0,t) + σ²/2a²·(1 − e^(−at))²", "1 − e^(−2at)"])
    r0 = 21
    for k in range(T + 2):
        r = r0 + k
        ws.cell(row=r, column=1, value=k)
        ws.cell(row=r, column=2, value=f"=A{r}*Dt").number_format = "0.0000"
        c = ws.cell(row=r, column=3, value=mkt.valuation_date + timedelta(days=int(round(k * DT * 365.0)))); c.number_format = "yyyy-mm-dd"; c.fill = W.FILL_RJ
        ws.cell(row=r, column=4, value=f"=IF(A{r}=0,1,{_DF(f'C{r}')})").number_format = "0.00000000"
        if k <= T:
            ws.cell(row=r, column=5, value=f"=-LN(D{r + 1}/D{r})/Dt").number_format = "0.0000%"
        if 1 <= k <= T:
            ws.cell(row=r, column=6, value=f"=E{r}+SigA2*(1-EXP(-HW_a*B{r}))^2").number_format = "0.0000%"
            ws.cell(row=r, column=7, value=f"=1-EXP(-2*HW_a*B{r})").number_format = "0.00000000"
    W.widths(ws, [54, 18, 12, 20, 30, 34, 14])
    ws.freeze_panes = "A21"
    return r0


def _DF(date_ref: str) -> str:
    from methodology.replicate import DF
    return DF(date_ref)


def _days(x: str) -> str:
    """Round a day count the way Python's round() does (half to even): Excel's ROUND rounds half away from zero,
    and a grid point landing exactly on a half day (t = 0.5y → 182.5 days) would otherwise move a day."""
    return f"IF(ABS(({x})-INT({x}))=0.5,2*ROUND(({x})/2,0),ROUND({x},0))"


def _calibration_sheet(wb, mkt, fit):
    ws = wb.create_sheet("Calibration")
    ws["A1"] = "CALIBRATION TO THE SWAPTION SURFACE"; ws["A1"].font = W.F_TITLE
    ws["A2"] = ("The model's ATM normal vol in closed form at the fitted (a, σ) against the market's, per basket point; the objective the optimiser "
                "minimised (weighted RMSE) and the RMSE reported; then an RMSE grid around the fit. Press Solver on the objective cell to repeat the fit.")
    ws["A2"].font = W.F_SUB
    ws["A4"] = "Fitted a"; ws["B4"] = "=HW_a"; ws["B4"].number_format = "0.000000"
    ws["A5"] = "Fitted σ (bp)"; ws["B5"] = "=HW_sig*10000"; ws["B5"].number_format = "0.000"
    ws["A6"] = "Source"; ws["B6"] = fit["source"]
    ws["A7"] = "Engine RMSE (bp)"; c = ws["B7"]; c.value = fit["rmse"]; c.fill = W.FILL_RJ; c.number_format = "0.0000"
    basket = fit["basket"]
    n = len(basket)
    hdr = ["Expiry", "Tenor", "T_e", "n pay", "Market vol (bp)", "Weight"] + [f"T_{i}" for i in range(1, MAX_PAY + 1)] + [f"P(0,T_{i})" for i in range(1, MAX_PAY + 1)] \
        + [f"B_{i}" for i in range(1, MAX_PAY + 1)] + ["A(0)", "w_dur", "P(0,T_e)", "S_fwd", "dS/dr", "V(T_e)", "Model vol (bp)", "Error (bp)", "w·err²", "Engine model vol (bp)", "T_e date"] \
        + [f"date T_{i}" for i in range(1, MAX_PAY + 1)]
    W.header(ws, 9, hdr)
    r0 = 10
    cT, cP, cB = 7, 7 + MAX_PAY, 7 + 2 * MAX_PAY
    cA0, cW, cPs, cS, cD, cV, cM, cE, cQ, cEng, cDe = (7 + 3 * MAX_PAY + i for i in range(11))
    cD0 = cDe + 1          # the payment dates as values (valuation + round(T·365.25), the engine's convention)
    for k, b in enumerate(basket):
        r = r0 + k
        ws.cell(row=r, column=1, value=b["expiry"]); ws.cell(row=r, column=2, value=b["tenor"])
        ws.cell(row=r, column=3, value=b["expiry_y"]); ws.cell(row=r, column=4, value=int(round(b["tenor_y"])))
        c = ws.cell(row=r, column=5, value=b["vol_bp"]); c.fill = W.FILL_RJ; ws.cell(row=r, column=6, value=b["weight"])
        n_pay = int(round(b["tenor_y"]))
        for i in range(1, MAX_PAY + 1):
            tcell = f"{L(cT + i - 1)}{r}"
            if i <= n_pay:
                ws.cell(row=r, column=cT + i - 1, value=b["expiry_y"] + i)
                d = mkt.valuation_date + timedelta(days=int(round((b["expiry_y"] + i) * 365.25)))       # the engine's date (365.25, round half to even)
                ws.cell(row=r, column=cD0 + i - 1, value=d).number_format = "yyyy-mm-dd"
                ws.cell(row=r, column=cP + i - 1, value=f"={_DF(f'{L(cD0 + i - 1)}{r}')}").number_format = "0.000000"
                ws.cell(row=r, column=cB + i - 1, value=f"=(1-EXP(-HW_a*({tcell}-$C{r})))/HW_a").number_format = "0.0000"
            else:
                ws.cell(row=r, column=cT + i - 1, value="")
                ws.cell(row=r, column=cP + i - 1, value=0); ws.cell(row=r, column=cB + i - 1, value=0)
        Prow = f"{L(cP)}{r}:{L(cP + MAX_PAY - 1)}{r}"; Brow = f"{L(cB)}{r}:{L(cB + MAX_PAY - 1)}{r}"
        ws.cell(row=r, column=cA0, value=f"=SUM({Prow})").number_format = "0.000000"
        ws.cell(row=r, column=cW, value=f"=SUMPRODUCT({Prow},{Brow})/{L(cA0)}{r}").number_format = "0.0000"
        ws.cell(row=r, column=cDe, value=mkt.valuation_date + timedelta(days=int(round(b["expiry_y"] * 365.25)))).number_format = "yyyy-mm-dd"
        ws.cell(row=r, column=cPs, value=f"={_DF(f'{L(cDe)}{r}')}").number_format = "0.000000"
        ws.cell(row=r, column=cS, value=f"=({L(cPs)}{r}-INDEX({Prow},$D{r}))/{L(cA0)}{r}").number_format = "0.0000%"
        ws.cell(row=r, column=cD, value=f"=INDEX({Brow},$D{r})*INDEX({Prow},$D{r})/{L(cA0)}{r}+{L(cS)}{r}*{L(cW)}{r}").number_format = "0.0000"
        ws.cell(row=r, column=cV, value=f"=(1-EXP(-2*HW_a*$C{r}))/(2*HW_a)").number_format = "0.000000"
        ws.cell(row=r, column=cM, value=f"=HW_sig*ABS({L(cD)}{r})*SQRT({L(cV)}{r}/$C{r})*10000").number_format = "0.00"
        ws.cell(row=r, column=cE, value=f"={L(cM)}{r}-E{r}").number_format = "0.00"
        ws.cell(row=r, column=cQ, value=f"=(F{r}*{L(cE)}{r})^2").number_format = "0.0000"
        c = ws.cell(row=r, column=cEng, value=b["mdl_vol_bp"]); c.fill = W.FILL_RJ; c.number_format = "0.00"
        W.check(wb, "Calibration", f"model vol {b['expiry']}x{b['tenor']} (closed form)", f"{L(cM)}{r}", f"{L(cEng)}{r}", 2e-4)
    r1 = r0 + max(n, 1) - 1
    rs = r1 + 2
    ws.cell(row=rs, column=1, value="Objective (weighted RMSE, bp)").font = Font(bold=True)
    ws.cell(row=rs, column=2, value=f"=SQRT(SUM({L(cQ)}{r0}:{L(cQ)}{r1})/COUNT({L(cQ)}{r0}:{L(cQ)}{r1}))").number_format = "0.0000"
    ws.cell(row=rs + 1, column=1, value="RMSE (unweighted, bp)").font = Font(bold=True)
    ws.cell(row=rs + 1, column=2, value=f"=SQRT(SUMSQ({L(cE)}{r0}:{L(cE)}{r1})/COUNT({L(cE)}{r0}:{L(cE)}{r1}))").number_format = "0.0000"
    ws.cell(row=rs + 1, column=3, value="=B7"); ws.cell(row=rs + 1, column=3).fill = W.FILL_RJ; ws.cell(row=rs + 1, column=3).number_format = "0.0000"
    if fit["rmse"] is not None:
        W.check(wb, "Calibration", "RMSE of the fit (bp)", f"B{rs + 1}", f"C{rs + 1}", 1e-2)      # the stored RMSE was computed before a and σ were rounded
    # the RMSE surface around the fit: the model vol scales with σ, so only a needs the chain again
    rg = rs + 4
    ws.cell(row=rg, column=1, value="RMSE (bp) AROUND THE FIT · rows: a as a multiple of the fit · columns: σ as a multiple of the fit").font = W.F_SECTION
    a_mults, s_mults = (0.5, 0.75, 1.0, 1.5, 2.0), (0.8, 0.9, 1.0, 1.1, 1.2)
    ws.cell(row=rg + 1, column=1, value="a \\ σ")
    for j, sm in enumerate(s_mults):
        ws.cell(row=rg + 1, column=2 + j, value=sm).number_format = "0.00×"
    # per a-multiple, the model vol per instrument at the fitted σ, in a helper block to the right
    hb = 2 + len(s_mults) + 2
    ws.cell(row=rg + 1, column=hb, value="helper: model vol (bp) per instrument at the fitted σ, for each a multiple →").font = Font(color=W.MUTED)
    for i, am in enumerate(a_mults):
        r = rg + 2 + i
        ws.cell(row=r, column=1, value=am).number_format = "0.00×"
        for k in range(n):
            rr = r0 + k
            Trow = f"{L(cT)}{rr}:{L(cT + MAX_PAY - 1)}{rr}"; Prow = f"{L(cP)}{rr}:{L(cP + MAX_PAY - 1)}{rr}"
            a_ = f"(HW_a*$A{r})"
            wdur = f"SUMPRODUCT({Prow},(1-EXP(-{a_}*(IF({Trow}=\"\",$C{rr},{Trow})-$C{rr})))/{a_})/{L(cA0)}{rr}"
            blast = f"(1-EXP(-{a_}*(INDEX({Trow},$D{rr})-$C{rr})))/{a_}"
            dsdr = f"({blast}*INDEX({Prow},$D{rr})/{L(cA0)}{rr}+{L(cS)}{rr}*{wdur})"
            vte = f"((1-EXP(-2*{a_}*$C{rr}))/(2*{a_}))"
            ws.cell(row=r, column=hb + k, value=f"=HW_sig*ABS({dsdr})*SQRT({vte}/$C{rr})*10000").number_format = "0.00"
        helper = f"{L(hb)}{r}:{L(hb + max(n, 1) - 1)}{r}"
        mkt_rng = f"E{r0}:E{r1}"
        for j in range(len(s_mults)):
            sm = f"{L(2 + j)}${rg + 1}"
            ws.cell(row=r, column=2 + j, value=f"=SQRT(SUMPRODUCT(({sm}*{helper}-TRANSPOSE({mkt_rng}))^2)/{max(n, 1)})").number_format = "0.00"
    grid = f"B{rg + 2}:{L(1 + len(s_mults))}{rg + 1 + len(a_mults)}"
    ws.conditional_formatting.add(grid, ColorScaleRule(start_type="min", start_color="D6F5EC", mid_type="percentile", mid_value=50, mid_color="FFF4D6", end_type="max", end_color="FBD9D3"))
    ws.cell(row=rg + 2 + len(a_mults) + 1, column=1, value="The centre cell (1.00×, 1.00×) is the fit; every neighbour is worse. Solver: minimise the objective cell over Model!B4:B5 to repeat the engine's fit.").font = Font(color=W.MUTED)
    W.widths(ws, [8, 8, 7, 7, 14, 8] + [7] * (3 * MAX_PAY) + [10, 9, 10, 9, 9, 10, 14, 10, 9, 18, 11] + [11] * MAX_PAY)
    ws.freeze_panes = "G10"
    return {"r0": r0, "r1": r1, "rs": rs, "cM": cM}


def _bonds_sheet(wb, eng, grid_r0):
    T = eng["T"]
    ws = wb.create_sheet("Bonds")
    ws["A1"] = "BOND RECONSTITUTION TABLES"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "Row i = the step the swap is valued at (t_i); column j = the step a bond matures at (t_{j+1}), j from i to T−1 (the last bond matures with the swap). B = (1 − e^(−a·τ))/a; ln A = ln(P(0,t_{j+1})/P(0,t_i)) + B·f(0,t_i) − σ²/4a·(1 − e^(−2a t_i))·B². Outside that range: masked (ln A = −1E9 → e^{−1E9} = 0)."; ws["A2"].font = W.F_SUB
    # B table at rows 5.., ln A table below it
    ws["A4"] = "B(t_i, t_{j+1})"; ws["A4"].font = W.F_SECTION
    rB = 5
    W.header(ws, rB, ["i \\ j"] + [str(j) for j in range(1, T + 1)])
    rA = rB + T + 3
    ws.cell(row=rA - 1, column=1, value="ln A(t_i, t_{j+1})").font = W.F_SECTION
    W.header(ws, rA, ["i \\ j"] + [str(j) for j in range(1, T + 1)])
    for i in range(1, T + 1):
        ws.cell(row=rB + i, column=1, value=i); ws.cell(row=rA + i, column=1, value=i)
        gi = grid_r0 + i          # Model row of grid point k = i
        for j in range(1, T + 1):
            col = 1 + j
            gj = grid_r0 + j      # Model row of k = j, bond matures at t_{j+1} = Model row gj + 1
            if i <= j <= T - 1:           # bonds maturing at t_{j+1} ≤ T·Δ: the engine's j runs to T−1
                ws.cell(row=rB + i, column=col, value=f"=(1-EXP(-HW_a*(Model!$B${gj + 1}-Model!$B${gi})))/HW_a").number_format = "0.0000"
                ws.cell(row=rA + i, column=col, value=f"=LN(Model!$D${gj + 1}/Model!$D${gi})+{L(col)}{rB + i}*Model!$E${gi}-SigA4*Model!$G${gi}*{L(col)}{rB + i}^2").number_format = "0.000000"
            else:
                ws.cell(row=rB + i, column=col, value=0)
                ws.cell(row=rA + i, column=col, value=-1e9)
    W.widths(ws, [8] + [10] * T)
    ws.freeze_panes = "B6"
    return rB, rA


def _block(ws, top, n_rows, T, fn, fmt="#,##0.00", label=""):
    """A paths × steps block: header row at `top`, path rows beneath; fn(path_index, step, row, col) -> formula/value."""
    ws.cell(row=top, column=1, value=label).font = W.F_SECTION
    W.header(ws, top + 1, ["path \\ step"] + [str(j) for j in range(1, T + 1)])
    for p in range(n_rows):
        r = top + 2 + p
        ws.cell(row=r, column=1, value=p + 1)
        for j in range(1, T + 1):
            c = ws.cell(row=r, column=1 + j, value=fn(p, j, r, 1 + j)); c.number_format = fmt
    return top + 2, top + 1 + n_rows        # first and last path row


def _normals_sheet(wb, eng, wf_noise):
    sim = eng["sim"]; T = eng["T"]
    ws = wb.create_sheet("Normals")
    ws["A1"] = "THE ENGINE'S RANDOM DRAWS"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "Standard normals, path by path and step by step, exactly as numpy drew them (seed 42 for the paths, 43 for the margin-period bridge). ENGINE mode uses these; LIVE mode ignores them."; ws["A2"].font = W.F_SUB
    z0, z1 = _block(ws, 4, N_PATHS, T, lambda p, j, r, c: float(sim.z[p, j - 1]), "0.000000", "Z: the Hull-White step's normal")
    n0, n1 = _block(ws, z1 + 3, N_PATHS, T, lambda p, j, r, c: float(wf_noise[p, j - 1]), "0.000000", "N: the margin-period bridge's normal")
    for row in ws.iter_rows(min_row=z0, max_row=n1, min_col=2, max_col=1 + T):
        for c in row:
            if isinstance(c.value, float):
                c.fill = W.FILL_RJ
    W.widths(ws, [10] + [11] * T)
    ws.freeze_panes = "B6"
    return (z0, z1), (n0, n1)


def _paths_sheet(wb, eng, grid_r0, rB, rA, zrows):
    T = eng["T"]; z0, z1 = zrows
    ws = wb.create_sheet("Paths")
    ws["A1"] = "THE PATHS"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "Z → x (the OU step) → r = x + α → the annuity and the bond to maturity by reconstitution → V, the swap's value from our side. Every cell is a formula."; ws["A2"].font = W.F_SUB
    blocks = {}
    top = 4
    zb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"=IF(Mode=\"ENGINE\",Normals!{L(c)}{z0 + p},NORMSINV(RAND()))", "0.000000", "Z (ENGINE: the engine's draw; LIVE: NORMSINV(RAND()))")
    blocks["Z"] = zb; top = zb[1] + 3
    xb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: (f"=STDDT*{L(c)}{zb[0] + p}" if j == 1 else f"={L(c - 1)}{r}*EADT+STDDT*{L(c)}{zb[0] + p}"), "0.00000000", "x: x(t+Δ) = x(t)·e^(−aΔ) + σ√((1−e^(−2aΔ))/2a)·Z")
    blocks["X"] = xb; top = xb[1] + 3
    rb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"={L(c)}{xb[0] + p}+Model!$F${grid_r0 + j}", "0.0000%", "r = x + α(t)")
    blocks["R"] = rb; top = rb[1] + 3
    ab = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"=Dt*SUMPRODUCT(EXP(Bonds!$B${rA + j}:${L(1 + T)}${rA + j}-Bonds!$B${rB + j}:${L(1 + T)}${rB + j}*{L(c)}{rb[0] + p}))", "0.000000",
                "Annuity: Δ·Σ_j A(t_i,t_{j+1})·e^(−B·r) over the remaining steps")
    blocks["ANN"] = ab; top = ab[1] + 3
    db = _block(ws, top, N_PATHS, T, lambda p, j, r, c: (f"=EXP(Bonds!${L(T)}${rA + j}-Bonds!${L(T)}${rB + j}*{L(c)}{rb[0] + p})" if j < T else "=1"), "0.000000",
                "P(t_i, T_M): the bond to maturity (column j = T−1 of the tables; 1 at maturity itself)")
    blocks["DFM"] = db; top = db[1] + 3
    vb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"=Sgn*(Kfix*{L(c)}{ab[0] + p}-(1-{L(c)}{db[0] + p}))*Notl", "#,##0", "V: (K·annuity − (1 − P(t,T_M)))·N, times the side")
    blocks["V"] = vb
    W.widths(ws, [10] + [12] * T)
    ws.freeze_panes = "B6"
    return blocks


def _exposure_sheet(wb, eng, blocks, nrows, grid_r0):
    T = eng["T"]; vb = blocks["V"]; n0, n1 = nrows
    ws = wb.create_sheet("Exposure")
    ws["A1"] = "THE CSA AND THE EXPOSURE"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "V lagged by the margin period (a Brownian bridge between grid points), the collateral it calls, the residual, and EE / ENE / PFE per step. Choose a preset or set the terms."; ws["A2"].font = W.F_SUB
    rows = [("Preset", DEFAULT_PRESET, "@"), ("Collateralised (1/0)", '=IF(Preset="UNCOLLATERALISED",0,1)', "0"),
            ("Threshold, counterparty", 0.0, "#,##0"), ("Threshold, own", 0.0, "#,##0"), ("Minimum transfer amount", 0.0, "#,##0"),
            ("MPoR (business days)", f'=IF(Preset="ON_CHAIN",{MPOR_FLOOR_CLEARED_BD},{MPOR_FLOOR_BILATERAL_BD})', "0"),
            ("IM exchanged (1/0)", '=IF(Preset="UNCOLLATERALISED",0,1)', "0"), ("IM yield pickup (bp)", 0.0, "0.0"),
            ("δ = MPoR/250 (years)", f"=B9/{BUSINESS_DAYS_PER_YEAR}", "0.0000"), ("Steps back = δ/Δ (< 1 here)", "=B12/Dt", "0.0000"), ("w = 1 − δ/Δ", "=1-B13", "0.0000"),
            ("V(0): the model's own t = 0 value", eng["v0"], "#,##0.00"),
            ("IM confidence, one-tailed, each way (the engine's own estimate from these paths; not ISDA SIMM, which is licensed)", IM_CONFIDENCE / 100.0, "0.00"),
            ("IM₀ we call: the margin at the first date", "=K25", "#,##0.00"),
            ("A desk with its own figure (its SIMM, under its licence) types it on the ticket: that amount is then held for the life", "", "@"),
            ("IM₀ we post: the margin at the first date (the profile MVA funds)", "=N25", "#,##0.00"),
            ("VM carry, posted (bp over OIS: what the margin we post earns above cash)", 0.0, "0.0"), ("VM carry, received (bp over OIS: what the margin we hold earns above the rebate)", 0.0, "0.0")]
    for i, (label, v, fmt) in enumerate(rows, 4):
        ws.cell(row=i, column=1, value=label)
        c = ws.cell(row=i, column=2, value=v); c.number_format = fmt
        if i in (4, 6, 7, 8, 11, 20, 21):
            c.fill = W.FILL_IN
        if i == 15:
            c.fill = W.FILL_RJ
    W.dropdown(ws, "B4", list(PRESETS))
    _names(wb, {"Preset": "Exposure!B4", "Coll": "Exposure!B5", "THcp": "Exposure!B6", "THown": "Exposure!B7", "MTA": "Exposure!B8", "MPoR": "Exposure!B9",
                "IMx": "Exposure!B10", "Pickup": "Exposure!B11", "Wlag": "Exposure!B14", "V0": "Exposure!B15", "IMq": "Exposure!B16", "IM0": "Exposure!B19", "CarryPost": "Exposure!B20", "CarryRecv": "Exposure!B21"})
    # per-step summary
    rs = 24
    ws.cell(row=rs - 1, column=1, value="PER STEP").font = W.F_SECTION
    W.header(ws, rs, ["step", "t", "s² = VARP(ΔV)", "EE", "ENE", "PFE 95%", "EE gross", "ENE gross", "mean collateral", "mean residual", "IM we call (t)", "mean received", "mean posted", "IM we post (t)"])
    # blocks below: ΔV, V lagged, the move over the margin period, C, residual
    top = rs + T + 3
    dvb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: (f"=Paths!{L(c)}{vb[0] + p}-V0" if j == 1 else f"=Paths!{L(c)}{vb[0] + p}-Paths!{L(c - 1)}{vb[0] + p}"), "#,##0", "ΔV = V(t_i) − V(t_{i−1})")
    top = dvb[1] + 3
    lagb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: (f"=IF(Coll=1,{'V0' if j == 1 else f'Paths!{L(c - 1)}{vb[0] + p}'}+Wlag*{L(c)}{dvb[0] + p}+Normals!{L(c)}{n0 + p}*SQRT(Wlag*(1-Wlag)*$C${rs + j}),Paths!{L(c)}{vb[0] + p})"),
                  "#,##0", "V(t − δ): lo + w·ΔV + N·√(w(1−w)·s²) (the Brownian bridge; LIVE mode re-rolls N too)")
    top = lagb[1] + 3
    mvb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"=Paths!{L(c)}{vb[0] + p}-{L(c)}{lagb[0] + p}", "#,##0",
                 "Move over the margin period: V(t) − V(t − δ). Initial margin is its 99th percentile rise (what we call) and fall (what we post), about its mean")
    top = mvb[1] + 3
    cb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"=IF(Coll=1,IF(ABS(MAX({L(c)}{lagb[0] + p}-THcp,0)-MAX(-{L(c)}{lagb[0] + p}-THown,0))<MTA,0,MAX({L(c)}{lagb[0] + p}-THcp,0)-MAX(-{L(c)}{lagb[0] + p}-THown,0)),0)",
                "#,##0", "C: collateral held against the lagged value, our side (+ = we hold theirs)")
    top = cb[1] + 3
    resb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"=Paths!{L(c)}{vb[0] + p}-{L(c)}{cb[0] + p}", "#,##0", "Residual: V − C")
    for j in range(1, T + 1):
        r = rs + j; col = L(1 + j)
        ws.cell(row=r, column=1, value=j)
        ws.cell(row=r, column=2, value=f"=Model!B{grid_r0 + j}").number_format = "0.0000"
        ws.cell(row=r, column=3, value=f"=VARP({col}{dvb[0]}:{col}{dvb[1]})").number_format = "#,##0"
        res = f"{col}{resb[0]}:{col}{resb[1]}"; vcol = f"Paths!{col}{vb[0]}:{col}{vb[1]}"; ccol = f"{col}{cb[0]}:{col}{cb[1]}"
        ws.cell(row=r, column=4, value=f"=SUMPRODUCT(({res}-K{r}>0)*({res}-K{r}))/Npaths").number_format = "#,##0.00"
        ws.cell(row=r, column=5, value=f"=SUMPRODUCT(({res}+N{r}<0)*({res}+N{r}))/Npaths").number_format = "#,##0.00"
        ws.cell(row=r, column=6, value=f"=PERCENTILE({res},0.95)").number_format = "#,##0.00"
        ws.cell(row=r, column=7, value=f"=SUMPRODUCT(({vcol}>0)*{vcol})/Npaths").number_format = "#,##0.00"
        ws.cell(row=r, column=8, value=f"=SUMPRODUCT(({vcol}<0)*{vcol})/Npaths").number_format = "#,##0.00"
        ws.cell(row=r, column=9, value=f"=AVERAGE({ccol})").number_format = "#,##0.00"
        ws.cell(row=r, column=10, value=f"=AVERAGE({res})").number_format = "#,##0.00"
        ws.cell(row=r, column=12, value=f"=SUMPRODUCT(({ccol}>0)*{ccol})/Npaths").number_format = "#,##0.00"
        ws.cell(row=r, column=13, value=f"=-SUMPRODUCT(({ccol}<0)*{ccol})/Npaths").number_format = "#,##0.00"
        mv = f"{col}{mvb[0]}:{col}{mvb[1]}"
        ws.cell(row=r, column=11, value=f"=IF(IMx=1,MAX(PERCENTILE({mv},IMq)-AVERAGE({mv}),0),0)").number_format = "#,##0.00"
        ws.cell(row=r, column=14, value=f"=IF(IMx=1,MAX(AVERAGE({mv})-PERCENTILE({mv},1-IMq),0),0)").number_format = "#,##0.00"
    W.widths(ws, [40, 10, 14, 14, 14, 14, 14, 14, 16, 16, 14] + [12] * (T - 10))
    ws.freeze_panes = "B5"
    return rs, {"DV": dvb, "LAG": lagb, "MV": mvb, "C": cb, "RES": resb}


def _waterfall_sheet(wb, eng, rs, grid_r0):
    T = eng["T"]
    ws = wb.create_sheet("Waterfall")
    ws["A1"] = "THE WATERFALL"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "Per step: survival from the credit triangle, then CVA, DVA, FVA, FBA, the SA-CCR exposure at default and the capital it needs (KVA), the initial margin funded (MVA), the carry of the variation margin against cash (ColVA). Costs negative, benefits positive."; ws["A2"].font = W.F_SUB
    params = [("Counterparty CDS (bp)", 85.0), ("Own CDS (bp)", 42.0), ("LGD", 0.40), ("Own LGD", 0.40), ("Funding spread ftp (bp)", 55.0), ("FBA ratio", 0.55),
              ("Hurdle rate", 0.12), ("Capital model (SA_CCR / CEM / IMM)", "SA_CCR"), ("Counterparty risk weight", 1.0), ("Wrong-way multiplier", 1.0),
              ("SA-CCR α", ALPHA), ("Supervisory factor, rates", SF_IR), ("Capital ratio", CAP_R)]
    for i, (label, v) in enumerate(params, 4):
        ws.cell(row=i, column=1, value=label); c = ws.cell(row=i, column=2, value=v); c.fill = W.FILL_IN
        c.number_format = "0.00%" if label in ("LGD", "Own LGD", "Hurdle rate", "Counterparty risk weight") else "0.00##"
    W.dropdown(ws, "B11", ["SA_CCR", "CEM", "IMM"])
    _names(wb, {"CDScp": "Waterfall!B4", "CDSown": "Waterfall!B5", "LGDcp": "Waterfall!B6", "LGDown": "Waterfall!B7", "FTP": "Waterfall!B8", "FBAr": "Waterfall!B9",
                "Hurdle": "Waterfall!B10", "CapModel": "Waterfall!B11", "RWcp": "Waterfall!B12", "WWR": "Waterfall!B13", "AlphaSA": "Waterfall!B14", "SFir": "Waterfall!B15", "CapR": "Waterfall!B16"})
    r0 = 20
    hdr = ["step", "t", "P(0,t)", "Q_cp(t)", "ΔQ_cp", "Q_own(t)", "ΔQ_own", "EE", "ENE", "CVA_i", "DVA_i", "FVA_i", "FBA_i", "m = M − t", "SD(m)", "MF", "add-on", "NICA", "RC", "multiplier", "EAD", "K", "KVA_i", "IM we post (t)", "MVA_i", "MF unmargined", "add-on unmargined", "RC unmargined", "multiplier unmargined", "EAD unmargined (the CRE52.2 cap)", "ColVA_i"]
    W.header(ws, r0 - 1, hdr)
    for j in range(1, T + 1):
        r = r0 + j - 1; e = rs + j
        ws.cell(row=r, column=1, value=j)
        ws.cell(row=r, column=2, value=f"=Exposure!B{e}").number_format = "0.0000"
        ws.cell(row=r, column=3, value=f"=Model!D{grid_r0 + j}").number_format = "0.000000"
        ws.cell(row=r, column=4, value=f"=EXP(-(CDScp/10000/LGDcp)*B{r})").number_format = "0.000000"
        ws.cell(row=r, column=5, value=(f"=1-D{r}" if j == 1 else f"=D{r - 1}-D{r}")).number_format = "0.000000"
        ws.cell(row=r, column=6, value=f"=EXP(-(CDSown/10000/LGDown)*B{r})").number_format = "0.000000"
        ws.cell(row=r, column=7, value=(f"=1-F{r}" if j == 1 else f"=F{r - 1}-F{r}")).number_format = "0.000000"
        ws.cell(row=r, column=8, value=f"=Exposure!D{e}").number_format = "#,##0.00"
        ws.cell(row=r, column=9, value=f"=Exposure!E{e}").number_format = "#,##0.00"
        ws.cell(row=r, column=10, value=f"=LGDcp*H{r}*E{r}*C{r}*WWR").number_format = "#,##0.00"
        ws.cell(row=r, column=11, value=f"=LGDown*ABS(I{r})*G{r}*C{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=12, value=f"=FTP/10000*H{r}*Dt*C{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=13, value=f"=FTP/10000*FBAr*ABS(I{r})*Dt*C{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=14, value=f"=MAX(Nsteps*Dt-B{r}+Dt/2,0)").number_format = "0.0000"
        ws.cell(row=r, column=15, value=f"=(1-EXP(-0.05*N{r}))/0.05").number_format = "0.0000"
        ws.cell(row=r, column=16, value=f"=IF(Coll=1,1.5*SQRT(MAX(MPoR,IF(Preset=\"ON_CHAIN\",{MPOR_FLOOR_CLEARED_BD},{MPOR_FLOOR_BILATERAL_BD}))/{BUSINESS_DAYS_PER_YEAR}),SQRT(MIN(N{r},1)))").number_format = "0.0000"
        ws.cell(row=r, column=17, value=f"=SFir*Notl*O{r}*P{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=18, value=f"=IF(Coll=1,Exposure!K{e},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=19, value=f"=IF(Coll=1,MAX(Exposure!J{e},THcp+MTA-R{r},0),MAX(Exposure!J{e},0))").number_format = "#,##0.00"
        ws.cell(row=r, column=20, value=f"=IF(Q{r}>0,MIN(1,0.05+0.95*EXP(MIN((Exposure!J{e}-R{r})/(1.9*Q{r}),50))),1)").number_format = "0.0000"
        ws.cell(row=r, column=21, value=f"=IF(CapModel=\"IMM\",AlphaSA*H{r},IF(CapModel=\"CEM\",S{r}+SFir*Notl*P{r},IF(Coll=1,MIN(AlphaSA*(S{r}+T{r}*Q{r}),AD{r}),AlphaSA*(S{r}+T{r}*Q{r}))))").number_format = "#,##0.00"
        ws.cell(row=r, column=22, value=f"=CapR*RWcp*U{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=23, value=f"=IF(N{r}>0,Hurdle*V{r}*Dt*C{r},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=24, value=f"=Exposure!N{e}").number_format = "#,##0.00"
        ws.cell(row=r, column=25, value=f"=IF(N{r}>0,X{r}*MAX(FTP/10000-Pickup/10000,0)*Dt*C{r},0)").number_format = "#,##0.00"
        # CRE52.2: the same set unmargined (the collateral held, the unmargined maturity factor, RC = max(V − C, 0)); the EAD is capped at it
        ws.cell(row=r, column=26, value=f"=SQRT(MIN(MAX(N{r},0.04),1))").number_format = "0.0000"
        ws.cell(row=r, column=27, value=f"=SFir*Notl*O{r}*Z{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=28, value=f"=MAX(Exposure!J{e}-R{r},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=29, value=f"=IF(AA{r}>0,MIN(1,0.05+0.95*EXP(MIN((Exposure!J{e}-R{r})/(1.9*AA{r}),50))),1)").number_format = "0.0000"
        ws.cell(row=r, column=30, value=f"=AlphaSA*(AB{r}+AC{r}*AA{r})").number_format = "#,##0.00"
        # ColVA: the carry of the variation margin against cash at OIS; what we posted earns CarryPost, what we hold earns CarryRecv (both over OIS)
        ws.cell(row=r, column=31, value=f"=(Exposure!M{e}*CarryPost/10000+Exposure!L{e}*CarryRecv/10000)*Dt*C{r}").number_format = "#,##0.00"
    r1 = r0 + T - 1
    rt = r1 + 2
    totals = [("CVA", f"=-SUM(J{r0}:J{r1})"), ("DVA", f"=SUM(K{r0}:K{r1})"), ("FVA", f"=-SUM(L{r0}:L{r1})"), ("FBA", f"=SUM(M{r0}:M{r1})"),
              ("KVA", f"=-SUM(W{r0}:W{r1})"), ("MVA", f"=-SUM(Y{r0}:Y{r1})"), ("ColVA", f"=SUM(AE{r0}:AE{r1})"), ("XVA total", f"=SUM(B{rt}:B{rt + 6})"),
              ("EAD at t = 0", f"=U{r0}"), ("Capital at t = 0", f"=V{r0}"), ("IM₀", "=IM0"), ("Peak EE", f"=MAX(H{r0}:H{r1})"), ("Peak PFE", f"=MAX(Exposure!F{rs + 1}:F{rs + T})")]
    for i, (label, f) in enumerate(totals):
        ws.cell(row=rt + i, column=1, value=label).font = Font(bold=True)
        ws.cell(row=rt + i, column=2, value=f).number_format = "#,##0.00"
    W.widths(ws, [34, 9, 11, 10, 10, 10, 10, 13, 13, 11, 11, 11, 11, 9, 9, 8, 12, 12, 12, 10, 13, 12, 11, 12, 11, 10, 13, 13, 10, 16, 11])
    ws.freeze_panes = "C20"
    return r0, r1, rt


def _engine_sheet(wb, eng, rs, rt, fit):
    T = eng["T"]
    ws = wb.create_sheet("Engine")
    ws["A1"] = "WHAT THE ENGINE COMPUTED ON THE SAME DRAWS"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "pricing/xva_engine.run_waterfall under each CSA preset, written at export. The 'selected' column follows the preset chosen on the Exposure sheet and feeds the Checks."; ws["A2"].font = W.F_SUB
    W.header(ws, 4, ["Metric"] + list(PRESETS) + ["selected"])
    metrics = [("CVA", "cva"), ("DVA", "dva"), ("FVA", "fva"), ("FBA", "fba"), ("KVA", "kva"), ("MVA", "mva"), ("ColVA", "colva"), ("XVA total", "xva_total"),
               ("EAD at t = 0", "ead_0"), ("Capital at t = 0", "capital_0"), ("IM₀", "im_0"), ("Peak EE", None), ("Peak PFE", None)]
    r = 5
    for label, attr in metrics:
        ws.cell(row=r, column=1, value=label)
        for k, preset in enumerate(PRESETS):
            wf = eng["runs"][preset][1]
            v = getattr(wf, attr) if attr else (max(wf.ee) if label == "Peak EE" else max(wf.pfe))
            c = ws.cell(row=r, column=2 + k, value=float(v)); c.fill = W.FILL_RJ; c.number_format = "#,##0.00"
        ws.cell(row=r, column=5, value=f"=INDEX(B{r}:D{r},MATCH(Preset,$B$4:$D$4,0))").number_format = "#,##0.00"
        W.check(wb, "Waterfall", label, f"Waterfall!B{rt + metrics.index((label, attr))}", f"Engine!E{r}", 1e-6)
        r += 1
    # per-step profiles
    r += 1
    ws.cell(row=r, column=1, value="PER STEP: EE / ENE / PFE under each preset").font = W.F_SECTION; r += 1
    hdr = ["step"] + [f"{p} {m}" for p in PRESETS for m in ("EE", "ENE", "PFE")] + ["selected EE", "selected ENE", "selected PFE"]
    W.header(ws, r, hdr); hr = r; r += 1  # noqa: F841  launch audit: assigned, never used
    for j in range(1, T + 1):
        ws.cell(row=r, column=1, value=j)
        col = 2
        for p in PRESETS:
            wf = eng["runs"][p][1]
            for arr in (wf.ee, wf.ene, wf.pfe):
                c = ws.cell(row=r, column=col, value=float(arr[j - 1])); c.fill = W.FILL_RJ; c.number_format = "#,##0.00"; col += 1
        for m, mi in (("EE", 0), ("ENE", 1), ("PFE", 2)):
            ws.cell(row=r, column=col, value=f"=INDEX(B{r}:J{r},3*(MATCH(Preset,$B$4:$D$4,0)-1)+{mi + 1})").number_format = "#,##0.00"
            W.check(wb, "Exposure", f"{m} at step {j}", f"Exposure!{'DEF'[mi]}{rs + j}", f"Engine!{L(col)}{r}", 1e-6)
            col += 1
        r += 1
    ws.cell(row=r + 1, column=1, value="Calibration").font = W.F_SECTION
    ws.cell(row=r + 2, column=1, value="a"); c = ws.cell(row=r + 2, column=2, value=fit["a"]); c.fill = W.FILL_RJ
    ws.cell(row=r + 3, column=1, value="σ (bp)"); c = ws.cell(row=r + 3, column=2, value=fit["sigma_bp"]); c.fill = W.FILL_RJ
    W.widths(ws, [22] + [15] * 13)
    ws.freeze_panes = "B5"


def _convergence_sheet(wb, eng, blocks_exp, rs):
    T = eng["T"]; step = max(1, T // 2); res = blocks_exp["RES"]
    ws = wb.create_sheet("Convergence")
    ws["A1"] = f"MONTE CARLO CONVERGENCE · EE AT STEP {step}"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "The running mean of the residual exposure over the first k paths, its standard error, and the engine's figure. In LIVE mode this is the error you are reading."; ws["A2"].font = W.F_SUB
    ws["A4"] = "Step"; ws["B4"] = step
    ws["A5"] = "Engine EE at this step (selected preset)"; ws["B5"] = f"=Exposure!D{rs + step}"; ws["B5"].number_format = "#,##0.00"
    W.header(ws, 7, ["k (paths)", "E⁺ on path k", "running mean", "standard error", "mean − 2·SE", "mean + 2·SE", "engine (sheet, selected)"])
    col = L(1 + step)
    for p in range(N_PATHS):
        r = 8 + p
        ws.cell(row=r, column=1, value=p + 1)
        ws.cell(row=r, column=2, value=f"=MAX(Exposure!{col}{res[0] + p}-Exposure!$K${rs + step},0)").number_format = "#,##0"
        ws.cell(row=r, column=3, value=f"=AVERAGE($B$8:B{r})").number_format = "#,##0"
        ws.cell(row=r, column=4, value=(f"=IF(A{r}>1,STDEV($B$8:B{r})/SQRT(A{r}),0)")).number_format = "#,##0"
        ws.cell(row=r, column=5, value=f"=C{r}-2*D{r}").number_format = "#,##0"
        ws.cell(row=r, column=6, value=f"=C{r}+2*D{r}").number_format = "#,##0"
        ws.cell(row=r, column=7, value="=$B$5").number_format = "#,##0"
    W.scenario(wb, "Convergence", (1, 8, 7 + N_PATHS), [("running mean", (3, 8, 7 + N_PATHS)), ("mean − 2·SE", (5, 8, 7 + N_PATHS)), ("mean + 2·SE", (6, 8, 7 + N_PATHS)), ("engine", (7, 8, 7 + N_PATHS))],
               f"EE at step {step}: running mean against path count", "paths", "USD")
    W.widths(ws, [12, 16, 16, 16, 16, 16, 22])
    ws.freeze_panes = "A8"


def xva_rates_workbook(mkt):
    from methodology.replicate import _curve_sheet, _readme
    fit = hw1f_fit(mkt)
    eng = engine_runs(mkt, fit)
    T = eng["T"]
    wb = Workbook()
    _readme(wb, "XVA on a swap: Hull-White paths, CSA, waterfall", [
        f"Default trade: pay fixed {FIXED_RATE:.3%} on USD {NOTIONAL:,.0f} for {MATURITY_Y:g} years, monthly grid, {N_PATHS} paths; the engine's own random draws on the Normals sheet.",
        "Model: Hull-White one factor in exact-fit form, a and σ calibrated to the swaption surface (Calibration sheet), the drift fitted to the curve so today's discount factors are reproduced.",
        "ENGINE mode (Model sheet) reproduces the engine to rounding: the Checks sheet compares every EE, ENE and PFE and every XVA. LIVE mode re-rolls the normals with NORMSINV(RAND()) on each recalculation; "
        "the Convergence sheet shows the Monte Carlo error and the Checks read LIVE instead of PASS. Switch Excel to manual calculation before going LIVE.",
        "CSA: a preset (UNCOLLATERALISED, BILATERAL with a 10-day margin period, ON_CHAIN with a 5-day one) or your own thresholds and MTA; the Engine sheet holds the engine's run under each preset.",
        "The sheet values V(0) at the model's own t = 0 mean; the ticket anchors the profile to the pricer's NPV (docs/xva.md). The margin period here is shorter than a grid step, as in both presets.",
    ], mkt, summary=[("Model", f"HW1F a = {fit['a']:.4f}, σ = {fit['sigma_bp']:.1f}bp ({fit['source']})"), ("Paths", f"{N_PATHS} on {T} monthly steps")])
    _curve_sheet(wb, mkt)
    grid_r0 = _model_sheet(wb, mkt, fit, eng)
    cal = _calibration_sheet(wb, mkt, fit)
    rB, rA = _bonds_sheet(wb, eng, grid_r0)
    wf_noise = eng["runs"]["BILATERAL"][1].bridge_noise
    zrows, nrows = _normals_sheet(wb, eng, wf_noise)
    blocks = _paths_sheet(wb, eng, grid_r0, rB, rA, zrows)
    rs, blocks_exp = _exposure_sheet(wb, eng, blocks, nrows, grid_r0)
    r0, r1, rt = _waterfall_sheet(wb, eng, rs, grid_r0)
    _engine_sheet(wb, eng, rs, rt, fit)
    _convergence_sheet(wb, eng, blocks_exp, rs)
    W.live(wb, "Mode")
    W.ticket(wb, "XVA (the ticket's XVA tab)", [("CVA", f"Waterfall!B{rt}", "#,##0.00", "cost"), ("DVA", f"Waterfall!B{rt + 1}", "#,##0.00", "benefit"), ("FVA", f"Waterfall!B{rt + 2}", "#,##0.00", ""),
                                               ("FBA", f"Waterfall!B{rt + 3}", "#,##0.00", ""), ("KVA", f"Waterfall!B{rt + 4}", "#,##0.00", ""), ("MVA", f"Waterfall!B{rt + 5}", "#,##0.00", ""), ("ColVA", f"Waterfall!B{rt + 6}", "#,##0.00", "carry of the VM held, against cash at OIS"),
                                               ("XVA TOTAL", f"Waterfall!B{rt + 7}", "#,##0.00", "all-in = NPV + XVA on the ticket"),
                                               ("EAD₀ / CAPITAL₀", f"Waterfall!B{rt + 8}", "#,##0.00", "SA-CCR at t = 0; capital on the next row"), ("IM₀", f"Waterfall!B{rt + 10}", "#,##0.00", "the margin we post at the first date: the engine's estimate, not ISDA SIMM"),
                                               ("PEAK EE", f"Waterfall!B{rt + 11}", "#,##0.00", ""), ("PEAK PFE 95%", f"Waterfall!B{rt + 12}", "#,##0.00", "")])
    W.ticket(wb, "MODEL AND CSA", [("a", "Model!B4", "0.0000", "mean reversion"), ("σ", "Model!B5", "0.0000%", "short-rate vol"), ("RMSE OF THE FIT", f"Calibration!B{cal['rs'] + 1}", "0.00", "bp"),
                                   ("CSA PRESET", "Exposure!B4", "@", ""), ("MPoR", "Exposure!B9", "0", "business days"), ("MODE", "Model!B13", "@", "ENGINE or LIVE")])
    for sym, notn, ref, note, fmt in [
        ("P(0,t), f(0,t)", "the curve's DF on the grid; f = −ln(P(0,t+Δ)/P(0,t))/Δ", f"Model!E{grid_r0 + 1}", "ACT/365 grid dates", "0.0000%"),
        ("α(t)", "f(0,t) + σ²/2a²·(1 − e^(−at))²", f"Model!F{grid_r0 + 1}", "the exact-fit shift", "0.0000%"),
        ("x step", "x(t+Δ) = x(t)·e^(−aΔ) + σ√((1−e^(−2aΔ))/2a)·Z", f"Paths!B{blocks['X'][0]}", "path 1, step 1", "0.000000"),
        ("r", "x + α", f"Paths!B{blocks['R'][0]}", "", "0.0000%"),
        ("B(t,T)", "(1 − e^(−a(T−t)))/a", f"Bonds!B{rB + 1}", "", "0.0000"), ("ln A(t,T)", "ln(P(0,T)/P(0,t)) + B·f(0,t) − σ²/4a·(1−e^(−2at))·B²", f"Bonds!B{rA + 1}", "", "0.000000"),
        ("annuity", "Δ·Σ_j A·e^(−B·r) over the remaining steps", f"Paths!B{blocks['ANN'][0]}", "", "0.000000"),
        ("V", "(K·annuity − (1 − P(t,T_M)))·N · side", f"Paths!B{blocks['V'][0]}", "the swap's value on path 1 at step 1", "#,##0"),
        ("V(t−δ)", "lo + w·ΔV + N·√(w(1−w)·VARP(ΔV))", f"Exposure!B{blocks_exp['LAG'][0]}", "the Brownian bridge over the margin period", "#,##0"),
        ("C", "max(V_lag − TH_cp, 0) − max(−V_lag − TH_own, 0), zeroed under the MTA", f"Exposure!B{blocks_exp['C'][0]}", "", "#,##0"),
        ("EE, ENE, PFE", "mean(max(V−C−IM,0)), mean(min(V−C+IM,0)), 95th percentile of V−C", f"Exposure!D{rs + 1}", "step 1", "#,##0.00"),
        ("Q(t)", "exp(−s/LGD·t)", f"Waterfall!D{r0}", "the credit triangle", "0.000000"),
        ("CVA", "−LGD·Σ EE·ΔQ·P(0,t)·WWR", f"Waterfall!B{rt}", "", "#,##0.00"), ("DVA", "+LGD_own·Σ |ENE|·ΔQ_own·P(0,t)", f"Waterfall!B{rt + 1}", "", "#,##0.00"),
        ("FVA, FBA", "−Σ ftp·EE·Δ·P, +Σ ftp·ratio·|ENE|·Δ·P", f"Waterfall!B{rt + 2}", "", "#,##0.00"),
        ("EAD", "α·[RC + multiplier·add-on], add-on = SF·N·SD(m)·MF; a margined set capped at the same set unmargined (CRE52.2)", f"Waterfall!U{r0}", "SA-CCR, step 1", "#,##0.00"),
        ("KVA", "−hurdle·Σ 8%·RW·EAD·Δ·P", f"Waterfall!B{rt + 4}", "", "#,##0.00"), ("MVA", "−Σ IM(t)·max(ftp − pickup, 0)·Δ·P", f"Waterfall!B{rt + 5}", "", "#,##0.00"),
        ("ColVA", "Σ (VM posted·s_post + VM received·s_recv)·Δ·P, the carries over OIS of what the margin is held in", f"Waterfall!B{rt + 6}", "zero for cash", "#,##0.00"),
        ("σ_n (calibration)", "σ·|dS/dr|·√(V(T_e)/T_e), dS/dr = B_M·P_M/A + S·w_dur", f"Calibration!{L(cal['cM'])}{cal['r0']}", "the model's ATM normal swaption vol, closed form", "0.00"),
    ]:
        W.derive(wb, sym, notn, ref, note, fmt)
    return wb, eng["runs"][DEFAULT_PRESET][1].xva_total
