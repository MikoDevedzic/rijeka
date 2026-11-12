"""The XVA replication for an FX or digital-asset forward: the lognormal forward Monte Carlo, the CSA, the
waterfall and the vol calibration, cell by cell. The sibling of xva_workbook.py (the swap).

    Model        the trade, the forward from parity, DF_q(T) and the quote zero, the monthly grid, V(0)
    Calibration  the pair's surface as quoted (tenor, ATM, RR25, BF25), the interpolation to the forward's
                 tenor and the smile fixed point at K = F, exactly as pricing/fx_vol.vol_at does it; or the
                 engine's default when the account has no surface for the pair
    Normals      the engine's own standard normals, and the margin-period bridge draws, as values
    Paths        Z (ENGINE: the values above; LIVE: NORMSINV(RAND())), ΣZ, W, F_t, V
    Exposure     the CSA (a preset, or the terms you set), V lagged by the margin period, the collateral, the
                 residual, EE / ENE / PFE / IM per step; the IM from the spot sensitivity and the pair's weight
    Waterfall    survival, CVA, DVA, FVA, FBA, SA-CCR EAD, KVA, MVA, ColVA, step by step, and the totals
    Convergence  the running mean of EE at one date against path count, with ±2 standard errors
    Engine       what the engine computed on the same draws, per CSA preset (for the Checks)

ENGINE mode reproduces pricing/fx_xva.forward_xva to rounding (the Checks sheet says so); LIVE mode re-rolls
the simulation on every recalculation. A 6-month forward on a monthly grid at 200 paths is a small book."""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter as L

from methodology import workbook as W
from pricing.csa import CSA, BUSINESS_DAYS_PER_YEAR, MPOR_FLOOR_BILATERAL_BD, MPOR_FLOOR_CLEARED_BD
from pricing.currency_forward import price_currency_forward
from pricing.fx_vol import TENOR_YEARS, parse_surface, vol_at
from pricing.fx_xva import ForwardXvaInput, default_vol_pct, forward_xva, is_crypto, monthly_grid
from pricing.sa_ccr import SUPERVISORY
from pricing.xva_engine import IM_CONFIDENCE
from pricing.xva_engine import ALPHA, CAP_R, SF_IR

N_PATHS, MONTHS, DIRECTION = 200, 6, "BUY"
PRESETS = ("UNCOLLATERALISED", "BILATERAL", "ON_CHAIN")
DEFAULT_PRESET = "BILATERAL"
SMILE_ITERATIONS = 8          # pricing/fx_vol.vol_at's fixed point

# The two cases: the currency pair (EUR discounted flat at its policy rate, as the forward book does) and the digital
# asset (its funding rate as the base rate). Same formulas, different labels and weights.
XVA_FX_CASE = dict(pair="EURUSD", base="EUR", quote="USD", spot=1.1133, base_rate=0.025, notional=10_000_000.0, spot_fmt="0.00000", mtm_fmt="#,##0",
                   base_rate_label="EUR rate (cont., p.a., flat)", delta="FX01", sf_basis="SA-CCR, foreign exchange class (CRE52.72)",
                   rate_note="EUR is discounted flat at the yellow rate because the hosted demo carries no EUR OIS curve; on a desk DF_EUR comes from the €STR curve.",
                   title="XVA on an FX forward: lognormal forward, surface vol, CSA, waterfall")
XVA_CRYPTO_CASE = dict(pair="BTCUSD", base="BTC", quote="USD", spot=65_000.0, base_rate=0.03, notional=10.0, spot_fmt="#,##0.00", mtm_fmt="#,##0",
                       base_rate_label="BTC funding rate (cont., p.a.)", delta="CRY01", sf_basis="SA-CCR, the cryptoasset class of a Group 2a asset (SCO60.98)",
                       rate_note="The funding (lending or staking) rate is the digital asset's base rate: F = S·e^(−r_c·T)/DF_USD, the cash-and-carry forward.",
                       title="XVA on a crypto NDF: lognormal forward, surface vol, CSA, waterfall")


# ── the engine's own numbers ──────────────────────────────────────────────────

def settlement_date(val: date, months: int = MONTHS) -> date:
    return date(val.year + (val.month + months - 1) // 12, (val.month + months - 1) % 12 + 1, min(val.day, 28))


def surface_for(mkt, pair: str) -> list:
    return list((mkt.fx_vol_quotes if pair == "EURUSD" else (mkt.vol_quotes_by_pair or {}).get(pair)) or [])


def forward_inputs(mkt, case: dict) -> dict:
    """The forward priced by the engine (pricing/currency_forward.py) at the fair forward, the pair's surface read as the
    XVA route reads it (the smile vol at K = F at the forward's tenor), and the ForwardXvaInput the engine simulates."""
    val = mkt.valuation_date
    T = settlement_date(val)
    r = price_currency_forward(base_currency=case["base"], quote_currency=case["quote"], base_notional=case["notional"], forward_rate=None,
                               spot=case["spot"], valuation_date=val, settlement_date=T, quote_curve=mkt.curve, base_rate=case["base_rate"], direction=DIRECTION)
    pillars = parse_surface(surface_for(mkt, case["pair"]))
    if pillars:
        vol_pct = vol_at(pillars, r.t, r.forward, r.forward) * 100.0
        src = f"the account's {case['pair']}_VOL surface, the smile vol at K = F for {r.t:.3f}y ({'ATM/RR25/BF25' if any(p.smile for p in pillars) else 'ATM only'} at {len(pillars)} tenors)"
    else:
        vol_pct, src = None, f"the engine's default {default_vol_pct(case['pair']):g}% flat (no {case['pair']}_VOL surface saved; pricing/fx_xva.DEFAULT_VOL_PCT)"
    inp = ForwardXvaInput(pair=case["pair"], base_notional=case["notional"], forward=r.forward, strike=r.forward_rate, t_years=r.t, df_quote_t=r.df_quote,
                          quote_zero=r.quote_rate, direction=DIRECTION, vol_pct=vol_pct, spot01=r.spot01, vol_source=src, spot=case["spot"])
    return {"fwd": r, "inp": inp, "pillars": pillars, "settle": T, "vol_source": src}


def engine_runs(fi: dict) -> dict:
    """The simulation on the workbook's trade (seed 42), and the waterfall under each CSA preset (bridge seed 43)."""
    noise: dict = {}
    runs = {}
    for preset in PRESETS:
        csa = CSA.from_request({"preset": preset})
        wf, meta = forward_xva(fi["inp"], csa, n_paths=N_PATHS, seed=42, noise_out=noise, waterfall_rng=np.random.default_rng(43))
        runs[preset] = (csa, wf, meta)
    steps, dt = monthly_grid(fi["inp"].t_years)
    # a digital asset's vol regimes (pricing/vol_regimes): the variance each step accumulated on each path, as a
    # multiple of σ²Δ, and the share of it that came before the date a margin period earlier, for each preset's period
    ck, u, omega = noise.get("clock"), None, {}
    if ck is not None:
        from pricing.vol_regimes import share_before, step_variance
        u = step_variance(ck)
        for preset in ("BILATERAL", "ON_CHAIN"):
            if runs[preset][0].mpor_years >= dt:
                raise ValueError("the workbook's bridge is written for a margin period shorter than a grid step")
            w = 1.0 - runs[preset][0].mpor_years / dt
            omega[preset] = np.stack([share_before(ck, k, w) for k in range(steps)], axis=1)
    return {"noise": noise, "runs": runs, "T": steps, "dt": dt, "sigma": float(noise["sigma"]), "v0": float(runs[DEFAULT_PRESET][2]["v0"]),
            "u": u, "omega": omega, "regimes": runs[DEFAULT_PRESET][2].get("vol_regimes"),
            "sf": SUPERVISORY["CRYPTO" if is_crypto(fi["inp"].pair) else "FX"]["sf"], "im_basis": runs[DEFAULT_PRESET][2]["im_basis"]}


# ── helpers ──────────────────────────────────────────────────────────────────

def _names(wb, mapping: dict[str, str]):
    from openpyxl.workbook.defined_name import DefinedName
    for name, ref in mapping.items():
        sheet, addr = ref.split("!")
        col = "".join(ch for ch in addr if ch.isalpha()); row = "".join(ch for ch in addr if ch.isdigit())
        wb.defined_names[name] = DefinedName(name, attr_text=f"'{sheet}'!${col}${row}")


def _DF(date_ref: str) -> str:
    from methodology.replicate import DF
    return DF(date_ref)


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


def _lin(T: str, xs: str, ys: str) -> str:
    """pricing/fx_vol._lin in one cell: linear in time between the sorted points, flat beyond them."""
    i = f"MATCH({T},{xs},1)"
    return (f"IF({T}<=INDEX({xs},1),INDEX({ys},1),IF({T}>=INDEX({xs},ROWS({xs})),INDEX({ys},ROWS({xs})),"
            f"INDEX({ys},{i})+({T}-INDEX({xs},{i}))/(INDEX({xs},{i}+1)-INDEX({xs},{i}))*(INDEX({ys},{i}+1)-INDEX({ys},{i}))))")


# ── the sheets ───────────────────────────────────────────────────────────────

def _model_sheet(wb, mkt, case, fi, eng):
    inp, fwd, T = fi["inp"], fi["fwd"], eng["T"]
    base, quote = case["base"], case["quote"]
    ws = wb.create_sheet("Model")
    ws["A1"] = "THE LOGNORMAL FORWARD UNDER THE T-FORWARD MEASURE"; ws["A1"].font = W.F_TITLE
    ws["A2"] = ("F_t = F₀·exp(−σ²t/2 + σ·W_t), driftless under the settlement-date forward measure, stepped on the monthly grid; "
                "V(t) = side·N·(F_t − K)·DF_q(t,T) with DF_q(t,T) = DF_q(0,T)/DF_q(0,t) and DF_q(0,t) = e^(−r_q·t) on the flat quote zero to T (the engine's own proxy for the curve between today and settlement)."); ws["A2"].font = W.F_SUB
    rows = [("Pair", case["pair"], "@", False, None),
            (f"Spot S ({quote} per {base})", case["spot"], case["spot_fmt"], True, None),
            (f"Notional N ({base})", case["notional"], "#,##0.####", True, None),
            (f"Side (BUY {base} = +1, SELL = −1)", 1 if DIRECTION == "BUY" else -1, "0", True, None),
            ("Settlement date", fi["settle"], "yyyy-mm-dd", True, None),
            ("T to settlement (ACT/365)", "=(B8-ValDate)/365", "0.000000", False, fwd.t),
            (f"DF_q(0,T): {quote} from the SOFR curve, log-linear", f"={_DF('B8')}", "0.00000000", False, fwd.df_quote),
            (case["base_rate_label"], case["base_rate"], "0.00%", True, None),
            (f"DF_{base}(T) = exp(−r_{base}·T)", "=EXP(-B11*B9)", "0.00000000", False, fwd.df_base),
            (f"Forward F₀ = S·DF_{base}/DF_q", "=B5*B12/B10", case["spot_fmt"], False, fwd.forward),
            (f"Strike K ({quote} per {base}; the fair forward by default)", "=B13", case["spot_fmt"], True, None),
            ("r_q = −ln DF_q(0,T)/T (the engine's quote zero)", "=-LN(B10)/B9", "0.000000%", False, fwd.quote_rate),
            ("σ (decimal; from the Calibration sheet)", "=Calibration!B5", "0.0000%", False, eng["sigma"]),
            ("Steps = max(2, ceiling(12·T)) (a value: it sizes the sheets)", T, "0", False, None),
            ("Δ = T/steps (years per step)", "=B9/B17", "0.00000000", False, eng["dt"]),
            ("Paths", N_PATHS, "0", False, None),
            ("Mode (ENGINE: the engine's draws; LIVE: Excel re-rolls)", "ENGINE", "@", True, None),
            (f"Quote notional N·F₀ ({quote}; the SA-CCR notional)", "=B6*B13", "#,##0.00", False, abs(inp.base_notional * inp.forward)),
            (f"{case['delta']} = side·N·DF_q·F₀·1 % (PV for +1 % spot)", "=B7*B6*B10*B13*0.01", "#,##0.00", False, fwd.spot01),
            ("V(0) = side·N·(F₀ − K)·DF_q(0,T)", "=B7*B6*(B13-B14)*B10", "#,##0.00", False, eng["v0"]),
            ("Steps the engine would take: MAX(2, ROUNDUP(12·T, 0))", "=MAX(2,ROUNDUP(12*B9,0))", "0", False, float(T))]
    for i, (label, v, fmt, inp_, engv) in enumerate(rows, 4):
        ws.cell(row=i, column=1, value=label)
        c = ws.cell(row=i, column=2, value=v); c.number_format = fmt
        if inp_:
            c.fill = W.FILL_IN
        if engv is not None:
            e = ws.cell(row=i, column=3, value=float(engv)); e.fill = W.FILL_RJ; e.number_format = fmt
            W.check(wb, "Model", label.split(" (")[0].split(":")[0], f"B{i}", f"C{i}", 1e-9 if i not in (16, 23) else 1e-8)
    ws["C3"] = "engine"; ws["C3"].font = Font(color=W.MUTED)
    W.dropdown(ws, "B20", ["ENGINE", "LIVE"])
    _names(wb, {"Spot": "Model!B5", "Nbase": "Model!B6", "Sgn": "Model!B7", "Settle": "Model!B8", "Tyrs": "Model!B9", "DFqT": "Model!B10", "Rb": "Model!B11", "DFb": "Model!B12",
                "F0": "Model!B13", "Kfx": "Model!B14", "Rq": "Model!B15", "Sigma": "Model!B16", "Nsteps": "Model!B17", "Dt": "Model!B18", "Npaths": "Model!B19",
                "Mode": "Model!B20", "NotlQ": "Model!B21", "Spot01": "Model!B22", "V0": "Model!B23"})
    ws["A26"] = "THE GRID"; ws["A26"].font = W.F_SECTION
    W.header(ws, 27, ["k", "t = k·Δ", "date (valuation + round(t·365), as the engine counts; a value)", "DF_q(0,t) = e^(−r_q·t)", "DF_q(t,T) = DF_q(0,T)/DF_q(0,t)", "−σ²t/2"])
    r0 = 28
    for k in range(T + 1):
        r = r0 + k
        ws.cell(row=r, column=1, value=k)
        ws.cell(row=r, column=2, value=f"=A{r}*Dt").number_format = "0.000000"
        c = ws.cell(row=r, column=3, value=mkt.valuation_date + timedelta(days=int(round(k * eng["dt"] * 365.0)))); c.number_format = "yyyy-mm-dd"; c.fill = W.FILL_RJ
        ws.cell(row=r, column=4, value=f"=EXP(-Rq*B{r})").number_format = "0.00000000"
        ws.cell(row=r, column=5, value=f"=DFqT/D{r}").number_format = "0.00000000"
        ws.cell(row=r, column=6, value=f"=-0.5*Sigma^2*B{r}").number_format = "0.00000000"
    ws.cell(row=r0 + T + 2, column=1, value=("The grid dates are information only: the engine discounts between today and settlement on the flat quote zero, not on the curve, "
                                             "so DF_q(0,t) here is e^(−r_q·t) by construction. " + case["rate_note"])).font = Font(color=W.MUTED)
    W.widths(ws, [60, 18, 14, 22, 28, 14])
    ws.freeze_panes = "A28"
    return r0


def _calibration_sheet(wb, mkt, case, fi, eng):
    pair, pillars, inp = case["pair"], fi["pillars"], fi["inp"]
    ws = wb.create_sheet("Calibration")
    ws["A1"] = "THE VOL FROM THE PAIR'S SURFACE"; ws["A1"].font = W.F_TITLE
    ws["A2"] = ("pricing/fx_vol.vol_at at the forward's tenor and K = F: ATM, RR25 and BF25 each linear in time between the quoted tenors and flat beyond them (RR and BF "
                "over the tenors that quote a smile), then the Malz smile σ(Δ) = ATM − 2·RR·(Δ − ½) + 16·BF·(Δ − ½)² at the call's forward delta Δ = N(d₁), d₁ = ½σ√T at the forward, "
                "by fixed point from the ATM. This σ drives every path."); ws["A2"].font = W.F_SUB
    ws["A4"] = "Source"; ws["B4"] = fi["vol_source"]
    ws["A5"] = "σ (decimal): the sheet's result"; ws["B5"].number_format = "0.0000%"
    ws["A6"] = "σ: the engine's (pricing/fx_xva, what the paths were simulated at)"; c = ws["C6"]; c.value = eng["sigma"]; c.fill = W.FILL_RJ; c.number_format = "0.0000%"
    ws["B6"] = "=B5"; ws["B6"].number_format = "0.0000%"
    W.check(wb, "Calibration", "σ at the forward's tenor and strike", "B6", "C6", 1e-8)
    if not pillars:
        ws["B5"] = (inp.vol_pct if inp.vol_pct is not None else default_vol_pct(pair)) / 100.0; ws["B5"].fill = W.FILL_IN
        ws["A8"] = (f"No {pair}_VOL surface is saved for this account, so the engine used its default of {default_vol_pct(pair):g}% flat (pricing/fx_xva.DEFAULT_VOL_PCT) and said so on the ticket. "
                    "Save a surface under Market data and this sheet shows the interpolation instead; or change the yellow cell to see the XVA at another vol.")
        ws["A8"].font = Font(color=W.MUTED)
        W.widths(ws, [64, 16, 16])
        return 5
    r0 = 9
    ws["A8"] = f"{pair}_VOL AS QUOTED (vol points, % p.a.; yellow cells are yours to change)"; ws["A8"].font = W.F_SECTION
    W.header(ws, r0, ["Tenor", "t (years)", "ATM", "RR25", "BF25", "smile quoted (1/0)"])
    inv = {v: k for k, v in TENOR_YEARS.items()}
    for i, p in enumerate(pillars):
        r = r0 + 1 + i
        ws.cell(row=r, column=1, value=inv.get(p.t, f"{p.t:g}y")); ws.cell(row=r, column=2, value=p.t).number_format = "0.0000"
        for col, v in ((3, p.atm), (4, p.rr), (5, p.bf)):
            c = ws.cell(row=r, column=col, value=round(v * 100.0, 10)); c.fill = W.FILL_IN; c.number_format = "0.00"
        ws.cell(row=r, column=6, value=1 if p.smile else 0)
    r1 = r0 + len(pillars)
    smiled = [i for i, p in enumerate(pillars) if p.smile]
    # the tenors that quote a smile, as links into the table above (an ATM-only tenor says nothing about RR/BF, so it is skipped, not read as zero)
    rs0 = r1 + 3
    ws.cell(row=rs0 - 1, column=1, value="THE TENORS THAT QUOTE A SMILE (RR and BF interpolate over these only)").font = W.F_SECTION
    W.header(ws, rs0, ["Tenor", "t (years)", "RR25", "BF25"])
    for k, i in enumerate(smiled):
        r = rs0 + 1 + k; src = r0 + 1 + i
        ws.cell(row=r, column=1, value=f"=A{src}"); ws.cell(row=r, column=2, value=f"=B{src}").number_format = "0.0000"
        ws.cell(row=r, column=3, value=f"=D{src}").number_format = "0.00"; ws.cell(row=r, column=4, value=f"=E{src}").number_format = "0.00"
    if not smiled:
        ws.cell(row=rs0 + 1, column=1, value="none: every tenor quotes an ATM alone, so RR = BF = 0 and σ is the interpolated ATM").font = Font(color=W.MUTED)
    rs1 = rs0 + max(len(smiled), 1)
    # the interpolation at the forward's tenor
    ri = rs1 + 3
    ws.cell(row=ri - 1, column=1, value="AT THE FORWARD'S TENOR").font = W.F_SECTION
    xs, atm_ys = f"$B${r0 + 1}:$B${r1}", f"$C${r0 + 1}:$C${r1}"
    sx, rr_ys, bf_ys = f"$B${rs0 + 1}:$B${rs1}", f"$C${rs0 + 1}:$C${rs1}", f"$D${rs0 + 1}:$D${rs1}"
    ws.cell(row=ri, column=1, value="T (years to settlement, the forward's tenor)"); ws.cell(row=ri, column=2, value="=Tyrs").number_format = "0.000000"
    ws.cell(row=ri + 1, column=1, value="ATM at T (%, linear in time over every tenor, flat beyond)"); ws.cell(row=ri + 1, column=2, value=f"={_lin(f'$B${ri}', xs, atm_ys)}").number_format = "0.0000"
    ws.cell(row=ri + 2, column=1, value="RR25 at T (%, over the smiled tenors)"); ws.cell(row=ri + 2, column=2, value=(f"={_lin(f'$B${ri}', sx, rr_ys)}" if smiled else 0)).number_format = "0.0000"
    ws.cell(row=ri + 3, column=1, value="BF25 at T (%, over the smiled tenors)"); ws.cell(row=ri + 3, column=2, value=(f"={_lin(f'$B${ri}', sx, bf_ys)}" if smiled else 0)).number_format = "0.0000"
    ws.cell(row=ri + 4, column=1, value="√T"); ws.cell(row=ri + 4, column=2, value=f"=SQRT(B{ri})").number_format = "0.000000"
    # the fixed point σ = smile(Δ_call(σ)) at K = F
    rf = ri + 7
    ws.cell(row=rf - 1, column=1, value=f"THE SMILE FIXED POINT AT K = F ({SMILE_ITERATIONS} iterations from the ATM, as the engine; it converges in two or three)").font = W.F_SECTION
    W.header(ws, rf, ["iteration", "σ in (decimal)", "d₁ = ½σ√T", "Δ = N(d₁)", "x = Δ − ½", "σ out = max(ATM − 2·RR·x + 16·BF·x², 1e-4)", "|σ out − σ in|"])
    for it in range(SMILE_ITERATIONS):
        r = rf + 1 + it
        ws.cell(row=r, column=1, value=it)
        ws.cell(row=r, column=2, value=(f"=B{ri + 1}/100" if it == 0 else f"=F{r - 1}")).number_format = "0.000000%"
        ws.cell(row=r, column=3, value=f"=0.5*B{r}*$B${ri + 4}").number_format = "0.00000000"
        ws.cell(row=r, column=4, value=f"=NORMSDIST(C{r})").number_format = "0.00000000"
        ws.cell(row=r, column=5, value=f"=D{r}-0.5").number_format = "0.00000000"
        ws.cell(row=r, column=6, value=f"=MAX(($B${ri + 1}-2*$B${ri + 2}*E{r}+16*$B${ri + 3}*E{r}^2)/100,0.0001)").number_format = "0.000000%"
        ws.cell(row=r, column=7, value=f"=ABS(F{r}-B{r})").number_format = "0.0E+00"
    rlast = rf + SMILE_ITERATIONS
    ws["B5"] = f"=F{rlast}"
    ws.cell(row=rlast + 2, column=1, value=("At the forward the delta is a shade above ½ (d₁ = ½σ√T > 0), so the smile vol at K = F differs from the ATM quote by a few thousandths of a point; "
                                            "the engine iterates until the step is below 1e-10, this sheet runs the full count, and the two agree to rounding (Checks). "
                                            "Premium-excluded forward delta, as the surface is quoted (methodology §13).")).font = Font(color=W.MUTED)
    W.widths(ws, [64, 16, 14, 14, 14, 40, 14])
    ws.freeze_panes = "A4"
    return rlast


def _normals_sheet(wb, eng, wf_noise):
    z = eng["noise"]["z"]; T = eng["T"]
    ws = wb.create_sheet("Normals")
    ws["A1"] = "THE ENGINE'S RANDOM DRAWS"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "Standard normals, path by path and step by step, exactly as numpy drew them (seed 42 for the forward, 43 for the margin-period bridge). ENGINE mode uses these; LIVE mode ignores them."; ws["A2"].font = W.F_SUB
    z0, z1 = _block(ws, 4, N_PATHS, T, lambda p, j, r, c: float(z[p, j - 1]), "0.000000", "Z: the forward step's normal")
    n0, n1 = _block(ws, z1 + 3, N_PATHS, T, lambda p, j, r, c: float(wf_noise[p, j - 1]), "0.000000", "N: the margin-period bridge's normal")
    last, clock_rows = n1, None
    if eng["u"] is not None:
        u0, u1 = _block(ws, n1 + 3, N_PATHS, T, lambda p, j, r, c: float(eng["u"][p, j - 1]), "0.000000",
                        "U: the variance the step accumulated on the path, as a multiple of σ²Δ (the asset's vol regimes, day by day; its mean over many paths is 1)")
        b0, b1 = _block(ws, u1 + 3, N_PATHS, T, lambda p, j, r, c: float(eng["omega"]["BILATERAL"][p, j - 1]), "0.000000",
                        "Ω, BILATERAL: of the step's variance, the share that came before the date a margin period (10 business days) earlier")
        c0, c1 = _block(ws, b1 + 3, N_PATHS, T, lambda p, j, r, c: float(eng["omega"]["ON_CHAIN"][p, j - 1]), "0.000000",
                        "Ω, ON_CHAIN: the same for its margin period (5 business days)")
        last, clock_rows = c1, {"U": (u0, u1), "BILATERAL": (b0, b1), "ON_CHAIN": (c0, c1)}
    eng["clock_rows"] = clock_rows
    for row in ws.iter_rows(min_row=z0, max_row=last, min_col=2, max_col=1 + T):
        for c in row:
            if isinstance(c.value, float):
                c.fill = W.FILL_RJ
    W.widths(ws, [10] + [11] * T)
    ws.freeze_panes = "B6"
    return (z0, z1), (n0, n1)


def _paths_sheet(wb, case, eng, grid_r0, zrows):
    T = eng["T"]; z0, z1 = zrows
    ws = wb.create_sheet("Paths")
    ws["A1"] = "THE PATHS"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "Z → ΣZ (the running sum) → W = ΣZ·√Δ (Brownian motion on the grid) → F_t = F₀·exp(−σ²t/2 + σ·W) → V = side·N·(F_t − K)·DF_q(t,T). Every cell is a formula."; ws["A2"].font = W.F_SUB
    blocks = {}
    top = 4
    zb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"=IF(Mode=\"ENGINE\",Normals!{L(c)}{z0 + p},NORMSINV(RAND()))", "0.000000", "Z (ENGINE: the engine's draw; LIVE: NORMSINV(RAND()))")
    blocks["Z"] = zb; top = zb[1] + 3
    if eng.get("clock_rows"):
        # a digital asset: each step's variance is the path's own (U·σ²Δ), so the forward is built step by step
        u0 = eng["clock_rows"]["U"][0]
        ws["A2"] = "Z and U (the step's variance on the path, the asset's vol regimes) → F_t = F_prev·exp(−½σ²Δ·U + σ·√(Δ·U)·Z) → V = side·N·(F_t − K)·DF_q(t,T). Every cell is a formula."
        fb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: (f"={'F0' if j == 1 else f'{L(c - 1)}{r}'}*EXP(-0.5*Sigma^2*Dt*Normals!{L(c)}{u0 + p}"
                                                             f"+Sigma*SQRT(Dt*Normals!{L(c)}{u0 + p})*{L(c)}{zb[0] + p})"),
                    case["spot_fmt"], "F_t = F_prev·exp(−½σ²Δ·U + σ·√(Δ·U)·Z): the forward on the path, lognormal over the step given the variance the step accumulated")
        blocks["F"] = fb; top = fb[1] + 3
        vb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"=Sgn*Nbase*({L(c)}{fb[0] + p}-Kfx)*Model!$E${grid_r0 + j}", case["mtm_fmt"], "V = side·N·(F_t − K)·DF_q(t,T): the forward's value from our side")
        blocks["V"] = vb
        W.widths(ws, [10] + [13] * T)
        ws.freeze_panes = "B6"
        return blocks
    sb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: (f"={L(c)}{zb[0] + p}" if j == 1 else f"={L(c - 1)}{r}+{L(c)}{zb[0] + p}"), "0.000000", "ΣZ: the running sum of the draws (numpy's cumsum, in the same order)")
    blocks["S"] = sb; top = sb[1] + 3
    wbk = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"={L(c)}{sb[0] + p}*SQRT(Dt)", "0.000000", "W = ΣZ·√Δ")
    blocks["W"] = wbk; top = wbk[1] + 3
    fb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"=F0*EXP(Model!$F${grid_r0 + j}+Sigma*{L(c)}{wbk[0] + p})", case["spot_fmt"], "F_t = F₀·exp(−σ²t/2 + σ·W): the forward on the path")
    blocks["F"] = fb; top = fb[1] + 3
    vb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"=Sgn*Nbase*({L(c)}{fb[0] + p}-Kfx)*Model!$E${grid_r0 + j}", case["mtm_fmt"], "V = side·N·(F_t − K)·DF_q(t,T): the forward's value from our side")
    blocks["V"] = vb
    W.widths(ws, [10] + [13] * T)
    ws.freeze_panes = "B6"
    return blocks


def _exposure_sheet(wb, case, eng, blocks, nrows, grid_r0):
    T = eng["T"]; vb = blocks["V"]; n0, n1 = nrows
    ws = wb.create_sheet("Exposure")
    ws["A1"] = "THE CSA AND THE EXPOSURE"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "V a margin period earlier (the forward bridged between grid dates where it is lognormal, the trade valued on it), the collateral it calls, the residual, and EE / ENE / PFE per step. Choose a preset or set the terms."; ws["A2"].font = W.F_SUB
    rows = [("Preset", DEFAULT_PRESET, "@"), ("Collateralised (1/0)", '=IF(Preset="UNCOLLATERALISED",0,1)', "0"),
            ("Threshold, counterparty", 0.0, "#,##0"), ("Threshold, own", 0.0, "#,##0"), ("Minimum transfer amount", 0.0, "#,##0"),
            ("MPoR (business days)", f'=IF(Preset="ON_CHAIN",{MPOR_FLOOR_CLEARED_BD},{MPOR_FLOOR_BILATERAL_BD})', "0"),
            ("IM exchanged (1/0)", '=IF(Preset="UNCOLLATERALISED",0,1)', "0"), ("IM yield pickup (bp)", 0.0, "0.0"),
            ("δ = MPoR/250 (years)", f"=B9/{BUSINESS_DAYS_PER_YEAR}", "0.0000"), ("Steps back = δ/Δ (< 1 here)", "=B12/Dt", "0.0000"), ("w = 1 − δ/Δ", "=1-B13", "0.0000"),
            ("V(0) (Model sheet)", "=V0", "#,##0.00"),
            ("IM confidence, one-tailed, each way (the engine's own estimate from these paths; not ISDA SIMM, which is licensed)", IM_CONFIDENCE / 100.0, "0.00"),
            ("IM₀ we call: the margin at the first date", "=K24", "#,##0.00"),
            ("IM₀ we post: the margin at the first date (the profile MVA funds)", "=N24", "#,##0.00"),
            ("VM carry, posted (bp over OIS: what the margin we post earns above cash)", 0.0, "0.0"), ("VM carry, received (bp over OIS: what the margin we hold earns above the rebate)", 0.0, "0.0")]
    for i, (label, v, fmt) in enumerate(rows, 4):
        ws.cell(row=i, column=1, value=label)
        c = ws.cell(row=i, column=2, value=v); c.number_format = fmt
        if i in (4, 6, 7, 8, 11, 16, 19, 20):
            c.fill = W.FILL_IN
    W.dropdown(ws, "B4", list(PRESETS))
    _names(wb, {"Preset": "Exposure!B4", "Coll": "Exposure!B5", "THcp": "Exposure!B6", "THown": "Exposure!B7", "MTA": "Exposure!B8", "MPoR": "Exposure!B9",
                "IMx": "Exposure!B10", "Pickup": "Exposure!B11", "Wlag": "Exposure!B14", "IMq": "Exposure!B16", "IM0": "Exposure!B18", "CarryPost": "Exposure!B19", "CarryRecv": "Exposure!B20"})
    rs = 23
    ws.cell(row=rs - 1, column=1, value="PER STEP").font = W.F_SECTION
    W.header(ws, rs, ["step", "t", "t − δ", "EE", "ENE", "PFE 95%", "EE gross", "ENE gross", "mean collateral", "mean residual", "IM we call (t)", "mean received", "mean posted", "IM we post (t)"])
    top = rs + T + 3
    fb = blocks["F"]
    # ln F between two grid dates is a Brownian bridge: its mean on the line between the two levels, its variance σ²·w(1−w)·Δ
    cr = eng.get("clock_rows")
    if cr:
        # on the clock of a digital asset's vol regimes it is the same bridge: the share of the step's variance before the
        # date (Ω) in place of the share of its time (w), and the step's own variance (U·σ²Δ)
        om = lambda p, c: f'IF(Preset="ON_CHAIN",Normals!{L(c)}{cr["ON_CHAIN"][0] + p},Normals!{L(c)}{cr["BILATERAL"][0] + p})'      # noqa: E731
        lo = lambda p, j, c: "F0" if j == 1 else f"Paths!{L(c - 1)}{fb[0] + p}"                                                    # noqa: E731
        dvb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: (f"=IF(Coll=1,EXP(LN({lo(p, j, c)})+{om(p, c)}*(LN(Paths!{L(c)}{fb[0] + p})-LN({lo(p, j, c)}))"
                                                              f"+Normals!{L(c)}{n0 + p}*Sigma*SQRT({om(p, c)}*(1-{om(p, c)})*Dt*Normals!{L(c)}{cr['U'][0] + p})),Paths!{L(c)}{fb[0] + p})"),
                     case["spot_fmt"], "F(t − δ): exp(ln F_lo + Ω·(ln F_hi − ln F_lo) + N·σ·√(Ω(1−Ω)·Δ·U)), the forward a margin period earlier: the bridge on the regimes' clock "
                                       "(Ω is the engine's for the preset's own margin period: a period typed by hand keeps the preset's Ω)")
    else:
        dvb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: (f"=IF(Coll=1,EXP(LN({'F0' if j == 1 else f'Paths!{L(c - 1)}{fb[0] + p}'})+Wlag*(LN(Paths!{L(c)}{fb[0] + p})-LN({'F0' if j == 1 else f'Paths!{L(c - 1)}{fb[0] + p}'}))"
                                                              f"+Normals!{L(c)}{n0 + p}*Sigma*SQRT(Wlag*(1-Wlag)*Dt)),Paths!{L(c)}{fb[0] + p})"),
                     case["spot_fmt"], "F(t − δ): exp(ln F_lo + w·(ln F_hi − ln F_lo) + N·σ·√(w(1−w)·Δ)), the forward a margin period earlier (LIVE mode re-rolls N too)")
    top = dvb[1] + 3
    lagb = _block(ws, top, N_PATHS, T, lambda p, j, r, c: f"=IF(Coll=1,Sgn*Nbase*({L(c)}{dvb[0] + p}-Kfx)*DFqT/EXP(-Rq*$C${rs + j}),Paths!{L(c)}{vb[0] + p})",
                  "#,##0", "V(t − δ) = side·N·(F(t − δ) − K)·DF_q(t − δ, T): the forward valued on that level")
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
        ws.cell(row=r, column=2, value=f"=Model!B{grid_r0 + j}").number_format = "0.000000"
        ws.cell(row=r, column=3, value=f"=B{r}-$B$12").number_format = "0.000000"
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
    W.widths(ws, [64, 10, 14, 14, 14, 14, 14, 14, 16, 16, 14] + [12] * max(T - 10, 0))
    ws.freeze_panes = "B5"
    return rs, {"DV": dvb, "LAG": lagb, "MV": mvb, "C": cb, "RES": resb}


def _waterfall_sheet(wb, case, eng, rs, grid_r0):
    T = eng["T"]
    ws = wb.create_sheet("Waterfall")
    ws["A1"] = "THE WATERFALL"; ws["A1"].font = W.F_TITLE
    ws["A2"] = ("Per step: survival from the credit triangle, then CVA, DVA, FVA, FBA, the SA-CCR exposure at default and the capital it needs (KVA), the initial margin funded (MVA). "
                "Costs negative, benefits positive. Discounting on the engine's P(0,t) = e^(−r_q·t)."); ws["A2"].font = W.F_SUB
    params = [("Counterparty CDS (bp)", 85.0), ("Own CDS (bp)", 42.0), ("LGD", 0.40), ("Own LGD", 0.40), ("Funding spread ftp (bp)", 55.0), ("FBA ratio", 0.55),
              ("Hurdle rate", 0.12), ("Capital model (SA_CCR / CEM / IMM)", "SA_CCR"), ("Counterparty risk weight", 1.0), ("Wrong-way multiplier", 1.0),
              ("SA-CCR α", ALPHA), (f"Supervisory factor: {case['sf_basis']}", eng["sf"]), ("Capital ratio", CAP_R),
              ("CEM factor (the engine's older branch: 0.5 % of the quote notional × the maturity factor)", SF_IR)]
    for i, (label, v) in enumerate(params, 4):
        ws.cell(row=i, column=1, value=label); c = ws.cell(row=i, column=2, value=v); c.fill = W.FILL_IN
        c.number_format = "0.00%" if label in ("LGD", "Own LGD", "Hurdle rate", "Counterparty risk weight") else "0.00##"
    W.dropdown(ws, "B11", ["SA_CCR", "CEM", "IMM"])
    _names(wb, {"CDScp": "Waterfall!B4", "CDSown": "Waterfall!B5", "LGDcp": "Waterfall!B6", "LGDown": "Waterfall!B7", "FTP": "Waterfall!B8", "FBAr": "Waterfall!B9",
                "Hurdle": "Waterfall!B10", "CapModel": "Waterfall!B11", "RWcp": "Waterfall!B12", "WWR": "Waterfall!B13", "AlphaSA": "Waterfall!B14", "SFsa": "Waterfall!B15", "CapR": "Waterfall!B16", "SFcem": "Waterfall!B17"})
    r0 = 20
    hdr = ["step", "t", "P(0,t)", "Q_cp(t)", "ΔQ_cp", "Q_own(t)", "ΔQ_own", "EE", "ENE", "CVA_i", "DVA_i", "FVA_i", "FBA_i", "m = M − t", "SD(m)", "MF", "add-on", "NICA", "RC", "multiplier", "EAD", "K", "KVA_i", "IM we post (t)", "MVA_i", "MF unmargined", "add-on unmargined", "RC unmargined", "multiplier unmargined", "EAD unmargined (the CRE52.2 cap)", "ColVA_i"]
    W.header(ws, r0 - 1, hdr)
    for j in range(1, T + 1):
        r = r0 + j - 1; e = rs + j
        ws.cell(row=r, column=1, value=j)
        ws.cell(row=r, column=2, value=f"=Exposure!B{e}").number_format = "0.000000"
        ws.cell(row=r, column=3, value=f"=Model!D{grid_r0 + j}").number_format = "0.00000000"
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
        ws.cell(row=r, column=14, value=f"=MAX(Tyrs-B{r}+Dt/2,0)").number_format = "0.000000"
        ws.cell(row=r, column=15, value=f"=(1-EXP(-0.05*N{r}))/0.05").number_format = "0.000000"
        # CRE52.48 (unmargined: sqrt(min(M, 1)), M floored at ten business days) and CRE52.52 (margined)
        ws.cell(row=r, column=16, value=f"=IF(Coll=1,1.5*SQRT(MAX(MPoR,IF(Preset=\"ON_CHAIN\",{MPOR_FLOOR_CLEARED_BD},{MPOR_FLOOR_BILATERAL_BD}))/{BUSINESS_DAYS_PER_YEAR}),SQRT(MIN(MAX(N{r},1/25),1)))").number_format = "0.0000"
        # the class's add-on for one trade at δ = ±1: supervisory factor × the notional in the quote currency at spot × the maturity factor
        ws.cell(row=r, column=17, value=f"=IF(N{r}>0,SFsa*ABS(Nbase)*Spot*P{r},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=18, value=f"=IF(Coll=1,Exposure!K{e},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=19, value=f"=IF(Coll=1,MAX(Exposure!J{e},THcp+MTA-R{r},0),MAX(Exposure!J{e},0))").number_format = "#,##0.00"
        ws.cell(row=r, column=20, value=f"=IF(Q{r}>0,MIN(1,0.05+0.95*EXP(MIN((Exposure!J{e}-R{r})/(1.9*Q{r}),50))),1)").number_format = "0.0000"
        ws.cell(row=r, column=21, value=f"=IF(CapModel=\"IMM\",AlphaSA*H{r},IF(CapModel=\"CEM\",S{r}+SFcem*NotlQ*IF(Coll=1,P{r},SQRT(MIN(MAX(N{r},0),1))),IF(Coll=1,MIN(AlphaSA*(S{r}+T{r}*Q{r}),AD{r}),AlphaSA*(S{r}+T{r}*Q{r}))))").number_format = "#,##0.00"
        ws.cell(row=r, column=22, value=f"=CapR*RWcp*U{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=23, value=f"=IF(N{r}>0,Hurdle*V{r}*Dt*C{r},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=24, value=f"=Exposure!N{e}").number_format = "#,##0.00"
        ws.cell(row=r, column=25, value=f"=IF(N{r}>0,X{r}*MAX(FTP/10000-Pickup/10000,0)*Dt*C{r},0)").number_format = "#,##0.00"
        # CRE52.2: the same set unmargined (the collateral held, the unmargined maturity factor, RC = max(V − C, 0)); the EAD is capped at it
        ws.cell(row=r, column=26, value=f"=SQRT(MIN(MAX(MAX(N{r},0),1/25),1))").number_format = "0.0000"
        ws.cell(row=r, column=27, value=f"=IF(N{r}>0,SFsa*ABS(Nbase)*Spot*Z{r},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=28, value=f"=MAX(Exposure!J{e}-R{r},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=29, value=f"=IF(AA{r}>0,MIN(1,0.05+0.95*EXP(MIN((Exposure!J{e}-R{r})/(1.9*AA{r}),50))),1)").number_format = "0.0000"
        ws.cell(row=r, column=30, value=f"=AlphaSA*(AB{r}+AC{r}*AA{r})").number_format = "#,##0.00"
        # ColVA: the carry of the variation margin against cash at OIS; what we posted earns CarryPost, what we hold earns CarryRecv (both over OIS)
        ws.cell(row=r, column=31, value=f"=(Exposure!M{e}*CarryPost/10000+Exposure!L{e}*CarryRecv/10000)*Dt*C{r}").number_format = "#,##0.00"
    r1 = r0 + T - 1
    rt = r1 + 2
    totals = [("CVA", f"=-SUM(J{r0}:J{r1})"), ("DVA", f"=SUM(K{r0}:K{r1})"), ("FVA", f"=-SUM(L{r0}:L{r1})"), ("FBA", f"=SUM(M{r0}:M{r1})"),
              ("KVA", f"=-SUM(W{r0}:W{r1})"), ("MVA", f"=-SUM(Y{r0}:Y{r1})"), ("ColVA", f"=SUM(AE{r0}:AE{r1})"), ("XVA total", f"=SUM(B{rt}:B{rt + 6})"),
              ("EAD over the first step", f"=U{r0}"), ("Capital over the first step", f"=V{r0}"), ("IM₀", "=IM0"), ("Peak EE", f"=MAX(H{r0}:H{r1})"), ("Peak PFE", f"=MAX(Exposure!F{rs + 1}:F{rs + T})")]
    for i, (label, f) in enumerate(totals):
        ws.cell(row=rt + i, column=1, value=label).font = Font(bold=True)
        ws.cell(row=rt + i, column=2, value=f).number_format = "#,##0.00"
    ws.cell(row=rt + len(totals) + 1, column=1, value="Capital and initial margin are held through a step, so the remaining life m is read at the middle of it (t − Δ/2): the step that ends on settlement is charged like the others; the add-on is SA-CCR's for the pair's class: the supervisory factor × the notional in the quote currency at spot × the maturity factor (one trade, δ = ±1).").font = Font(color=W.MUTED)
    W.widths(ws, [44, 10, 12, 10, 10, 10, 10, 13, 13, 11, 11, 11, 11, 10, 10, 8, 12, 12, 12, 10, 13, 12, 11, 12, 11, 11])
    ws.freeze_panes = "C20"
    return r0, r1, rt


def _engine_sheet(wb, case, eng, blocks, rs, rt):
    T = eng["T"]; fb = blocks["F"]
    ws = wb.create_sheet("Engine")
    ws["A1"] = "WHAT THE ENGINE COMPUTED ON THE SAME DRAWS"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "pricing/fx_xva.forward_xva (simulate_paths, then pricing/xva_engine.run_waterfall) under each CSA preset, written at export. The 'selected' column follows the preset chosen on the Exposure sheet and feeds the Checks."; ws["A2"].font = W.F_SUB
    W.header(ws, 4, ["Metric"] + list(PRESETS) + ["selected"])
    metrics = [("CVA", "cva"), ("DVA", "dva"), ("FVA", "fva"), ("FBA", "fba"), ("KVA", "kva"), ("MVA", "mva"), ("ColVA", "colva"), ("XVA total", "xva_total"),
               ("EAD over the first step", "ead_0"), ("Capital over the first step", "capital_0"), ("IM₀", "im_0"), ("Peak EE", None), ("Peak PFE", None)]
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
    r += 1
    ws.cell(row=r, column=1, value="PER STEP: EE / ENE / PFE under each preset").font = W.F_SECTION; r += 1
    W.header(ws, r, ["step"] + [f"{p} {m}" for p in PRESETS for m in ("EE", "ENE", "PFE")] + ["selected EE", "selected ENE", "selected PFE"]); r += 1
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
    r += 1
    ws.cell(row=r, column=1, value="THE FORWARD ON A FEW PATHS (simulate_paths' f_t)").font = W.F_SECTION; r += 1
    W.header(ws, r, ["path", "step", "F_t (engine)", "F_t (Paths sheet)"]); r += 1
    f_t = eng["noise"]["f_t"]
    for p, j in sorted({(0, 1), (0, T), (N_PATHS // 2 - 1, max(1, T // 2)), (N_PATHS - 1, 1), (N_PATHS - 1, T)}):
        ws.cell(row=r, column=1, value=p + 1); ws.cell(row=r, column=2, value=j)
        c = ws.cell(row=r, column=3, value=float(f_t[p, j - 1])); c.fill = W.FILL_RJ; c.number_format = case["spot_fmt"]
        ws.cell(row=r, column=4, value=f"=Paths!{L(1 + j)}{fb[0] + p}").number_format = case["spot_fmt"]
        W.check(wb, "Paths", f"F_t on path {p + 1} at step {j}", f"Paths!{L(1 + j)}{fb[0] + p}", f"Engine!C{r}", 1e-9)
        r += 1
    r += 1
    ws.cell(row=r, column=1, value="Simulation").font = W.F_SECTION
    ws.cell(row=r + 1, column=1, value="σ (decimal)"); c = ws.cell(row=r + 1, column=2, value=eng["sigma"]); c.fill = W.FILL_RJ; c.number_format = "0.0000%"
    ws.cell(row=r + 2, column=1, value="V(0)"); c = ws.cell(row=r + 2, column=2, value=eng["v0"]); c.fill = W.FILL_RJ; c.number_format = "#,##0.00"
    ws.cell(row=r + 3, column=1, value="Supervisory factor"); c = ws.cell(row=r + 3, column=2, value=eng["sf"]); c.fill = W.FILL_RJ; c.number_format = "0.00%"
    ws.cell(row=r + 3, column=3, value=case["sf_basis"]).font = Font(color=W.MUTED)
    ws.cell(row=r + 4, column=1, value="Initial margin"); ws.cell(row=r + 4, column=3, value=eng["im_basis"]).font = Font(color=W.MUTED)
    W.widths(ws, [24] + [15] * 13)
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


# ── the book ─────────────────────────────────────────────────────────────────

def _xva_forward_workbook(mkt, case: dict):
    from methodology.replicate import _curve_sheet, _readme
    base, quote, crypto = case["base"], case["quote"], case["pair"] != "EURUSD"
    fi = forward_inputs(mkt, case)
    eng = engine_runs(fi)
    inp, T = fi["inp"], eng["T"]
    wb = Workbook()
    _readme(wb, case["title"], [
        f"Default trade: buy {base} {case['notional']:,.10g} {MONTHS} months forward against {quote} at the fair forward ({'cash-settled in USD against the settlement price source, a non-deliverable forward' if crypto else 'deliverable'}), "
        f"monthly grid, {N_PATHS} paths; the engine's own random draws on the Normals sheet.",
        "Model: the forward is lognormal and driftless under the settlement-date forward measure at the vol the pair's surface gives at K = F for this tenor (Calibration sheet); "
        "V(t) = side·N·(F_t − K)·DF_q(t,T) with DF_q between today and settlement on the flat quote zero, the engine's own proxy (pricing/fx_xva.py, docs/xva.md §1).",
        *([f"Vol regimes: a digital asset's vol is not one level. On each path a day's vol is σ × a fast state (calm or stressed, {eng['regimes']['fast']['stressed_spell_days']:g} days of stress at a time) × a slow state "
           f"(low or high, about {eng['regimes']['slow']['high_spell_days']:g} days at a time), scaled so the variance expected over any period is σ²: between {eng['regimes']['lowest_vol_pct']:g} % and "
           f"{eng['regimes']['highest_vol_pct']:g} % here. Given the variance a step accumulated (U on the Normals sheet, the engine's own) the forward is lognormal over the step, so today's value is unchanged and the "
           f"tails over a margin period are fatter. Fitted to {eng['regimes']['days']} public daily closes to {eng['regimes']['as_of']} (pricing/vol_regimes.py, backend/scripts/calibrate_vol_regimes.py). "
           "LIVE mode re-rolls the normals and keeps the engine's U and Ω."] if eng.get("regimes") else []),
        "ENGINE mode (Model sheet) reproduces the engine to rounding: the Checks sheet compares the vol, the forward on a few paths, V(0), every EE, ENE and PFE and every XVA. LIVE mode re-rolls the normals with NORMSINV(RAND()) on each recalculation; "
        "the Convergence sheet shows the Monte Carlo error and the Checks read LIVE instead of PASS. Switch Excel to manual calculation before going LIVE.",
        "CSA: a preset (UNCOLLATERALISED, BILATERAL with a 10-day margin period, ON_CHAIN with a 5-day one) or your own thresholds and MTA; the Engine sheet holds the engine's run under each preset. "
        "Initial margin is the engine's own estimate from these paths: at each date the 99th percentile rise (what we call) and fall (what we post) of V over the margin period, about its mean. "
        "It is not ISDA SIMM, which is ISDA's licensed methodology and is not computed here; a desk with its own figure types it on the ticket.",
        f"The capital add-on is {case['sf_basis']}: the supervisory factor on the notional in the quote currency at spot.",
        case["rate_note"],
    ], mkt, summary=[("Model", f"lognormal forward{' on the clock of its vol regimes' if eng.get('regimes') else ''}, σ = {eng['sigma']:.4%} from {fi['vol_source']}"), ("Paths", f"{N_PATHS} on {T} monthly steps (Δ = {eng['dt']:.5f}y)")])
    _curve_sheet(wb, mkt)
    grid_r0 = _model_sheet(wb, mkt, case, fi, eng)
    _calibration_sheet(wb, mkt, case, fi, eng)
    wf_noise = eng["runs"]["BILATERAL"][1].bridge_noise
    zrows, nrows = _normals_sheet(wb, eng, wf_noise)
    blocks = _paths_sheet(wb, case, eng, grid_r0, zrows)
    rs, blocks_exp = _exposure_sheet(wb, case, eng, blocks, nrows, grid_r0)
    r0, r1, rt = _waterfall_sheet(wb, case, eng, rs, grid_r0)
    _engine_sheet(wb, case, eng, blocks, rs, rt)
    _convergence_sheet(wb, eng, blocks_exp, rs)
    W.live(wb, "Mode")
    W.ticket(wb, "XVA (the ticket's XVA tab)", [("CVA", f"Waterfall!B{rt}", "#,##0.00", "cost"), ("DVA", f"Waterfall!B{rt + 1}", "#,##0.00", "benefit"), ("FVA", f"Waterfall!B{rt + 2}", "#,##0.00", ""),
                                               ("FBA", f"Waterfall!B{rt + 3}", "#,##0.00", ""), ("KVA", f"Waterfall!B{rt + 4}", "#,##0.00", ""), ("MVA", f"Waterfall!B{rt + 5}", "#,##0.00", ""), ("ColVA", f"Waterfall!B{rt + 6}", "#,##0.00", "carry of the VM held, against cash at OIS"),
                                               ("XVA TOTAL", f"Waterfall!B{rt + 7}", "#,##0.00", "all-in = NPV + XVA on the ticket"),
                                               ("EAD₀ / CAPITAL₀", f"Waterfall!B{rt + 8}", "#,##0.00", "SA-CCR at t = 0; capital on the next row"), ("IM₀", f"Waterfall!B{rt + 10}", "#,##0.00", "the margin we post at the first date: the engine's estimate, not ISDA SIMM"),
                                               ("PEAK EE", f"Waterfall!B{rt + 11}", "#,##0.00", ""), ("PEAK PFE 95%", f"Waterfall!B{rt + 12}", "#,##0.00", "")])
    W.ticket(wb, "THE FORWARD AND THE CSA", [("PAIR", "Model!B4", "@", ""), ("NOTIONAL", "Model!B6", "#,##0.####", base), ("DIRECTION", "Model!B7", '"BUY";"SELL";"FLAT"', f"+1 = buy {base}"),
                                             ("SETTLEMENT", "Model!B8", "yyyy-mm-dd", f"T = {inp.t_years:.4f}y"), ("FAIR FORWARD", "Model!B13", case["spot_fmt"], f"{quote} per {base}, from parity"),
                                             ("STRIKE K", "Model!B14", case["spot_fmt"], "the forward: NPV zero on day one"), ("NPV", "Model!B23", "#,##0.00", f"{quote}; V(0)"),
                                             ("VOL σ", "Model!B16", "0.0000%", fi["vol_source"]), (case["delta"], "Model!B22", "#,##0.00", "PV for +1 % spot; drives IM"),
                                             ("CSA PRESET", "Exposure!B4", "@", ""), ("MPoR", "Exposure!B9", "0", "business days"), ("MODE", "Model!B20", "@", "ENGINE or LIVE")])
    for sym, notn, ref, note, fmt in [
        ("F₀", f"S·DF_{base}(T)/DF_q(T)", "Model!B13", "covered interest parity; DF_q from the curve, log-linear", case["spot_fmt"]),
        ("r_q", "−ln DF_q(0,T)/T", "Model!B15", "the engine's flat quote zero between today and settlement", "0.000000%"),
        ("σ", "the smile vol at K = F for the forward's tenor: the fixed point of σ = ATM − 2·RR·x + 16·BF·x², x = N(½σ√T) − ½", "Calibration!B5", "ATM, RR25, BF25 linear in time between quoted tenors, flat beyond", "0.0000%"),
        ("Δ, steps", "steps = max(2, ⌈12T⌉), Δ = T/steps", "Model!B18", "the monthly grid", "0.00000000"),
        ("DF_q(t,T)", "DF_q(0,T)/e^(−r_q·t)", f"Model!E{grid_r0 + 1}", "step 1", "0.00000000"),
        *([("U", "the variance a step accumulated on the path, as a multiple of σ²Δ", f"Normals!B{eng['clock_rows']['U'][0]}", "path 1, step 1: the asset's vol regimes, day by day (pricing/vol_regimes.py)", "0.000000"),
           ("F_t", "F_prev·exp(−½σ²Δ·U + σ·√(Δ·U)·Z)", f"Paths!B{blocks['F'][0]}", "the forward on path 1 at step 1", case["spot_fmt"])] if eng.get("clock_rows") else
          [("W", "ΣZ·√Δ", f"Paths!B{blocks['W'][0]}", "path 1, step 1", "0.000000"),
           ("F_t", "F₀·exp(−σ²t/2 + σ·W)", f"Paths!B{blocks['F'][0]}", "the forward on path 1 at step 1", case["spot_fmt"])]),
        ("V", "side·N·(F_t − K)·DF_q(t,T)", f"Paths!B{blocks['V'][0]}", "the forward's value on path 1 at step 1", "#,##0"),
        ("F(t−δ)", "exp(ln F_lo + Ω·(ln F_hi − ln F_lo) + N·σ·√(Ω(1−Ω)·Δ·U)), Ω the share of the step's variance before the date" if eng.get("clock_rows") else "exp(ln F_lo + w·(ln F_hi − ln F_lo) + N·σ·√(w(1−w)·Δ))", f"Exposure!B{blocks_exp['DV'][0]}", "the forward a margin period earlier: ln F is a Brownian bridge between two grid dates", case["spot_fmt"]),
        ("V(t−δ)", "side·N·(F(t−δ) − K)·DF_q(t−δ, T)", f"Exposure!B{blocks_exp['LAG'][0]}", "the trade valued on that level", "#,##0"),
        ("C", "max(V_lag − TH_cp, 0) − max(−V_lag − TH_own, 0), zeroed under the MTA", f"Exposure!B{blocks_exp['C'][0]}", "", "#,##0"),
        ("IM₀", "99th percentile fall of V over the margin period, about its mean", "Exposure!B18", "the first date; not ISDA SIMM", "#,##0.00"),
        ("EE, ENE, PFE", "mean(max(V−C−IM,0)), mean(min(V−C+IM,0)), 95th percentile of V−C", f"Exposure!D{rs + 1}", "step 1", "#,##0.00"),
        ("Q(t)", "exp(−s/LGD·t)", f"Waterfall!D{r0}", "the credit triangle", "0.000000"),
        ("CVA", "−LGD·Σ EE·ΔQ·P(0,t)·WWR", f"Waterfall!B{rt}", "", "#,##0.00"), ("DVA", "+LGD_own·Σ |ENE|·ΔQ_own·P(0,t)", f"Waterfall!B{rt + 1}", "", "#,##0.00"),
        ("FVA, FBA", "−Σ ftp·EE·Δ·P, +Σ ftp·ratio·|ENE|·Δ·P", f"Waterfall!B{rt + 2}", "", "#,##0.00"),
        ("EAD", "α·[RC + multiplier·add-on], add-on = SF·N·F₀·SD(m)·MF", f"Waterfall!U{r0}", "SA-CCR, step 1", "#,##0.00"),
        ("KVA", "−hurdle·Σ 8%·RW·EAD·Δ·P", f"Waterfall!B{rt + 4}", "", "#,##0.00"), ("MVA", "−Σ IM(t)·max(ftp − pickup, 0)·Δ·P", f"Waterfall!B{rt + 5}", "", "#,##0.00"),
        ("ColVA", "Σ (VM posted·s_post + VM received·s_recv)·Δ·P, the carries over OIS of what the margin is held in", f"Waterfall!B{rt + 6}", "zero for cash", "#,##0.00"),
    ]:
        W.derive(wb, sym, notn, ref, note, fmt)
    return wb, eng["runs"][DEFAULT_PRESET][1].xva_total


def xva_fx_workbook(mkt):
    return _xva_forward_workbook(mkt, XVA_FX_CASE)


def xva_crypto_workbook(mkt):
    return _xva_forward_workbook(mkt, XVA_CRYPTO_CASE)
