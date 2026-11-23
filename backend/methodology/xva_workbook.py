"""The XVA replication for a swap: the trade's own schedule on Hull-White paths, the CSA, the waterfall and the
calibration, cell by cell. It is the run of a rates ticket's XVA tab (api/routes/xva._trade_paths): the trade's legs
valued on every path at every date by the credit engine's valuation, and the charges on the exposure discounted on
its own path. (Until 0.58.0 this book simulated a generic swap whose two legs settled every month, on today's
discounting: what the ticket ran before 0.52.0.)

    Model        the parameters and the grid: monthly dates from the valuation date, their times, P(0,t), the
                 step's decay and standard deviation, φ(t)
    Trade        the schedule as the production generator made it (dates are values), and the dates a bond is priced to
    Calibration  the swaption basket, the model's closed-form normal vol at the fitted (a, σ), the errors and the
                 RMSE, and an RMSE grid around the fit so the minimum is visible
    Bonds        B(t_k, T) and ln A(t_k, T) for the next grid date and for every date of the trade
    Normals      the engine's own standard normals, and the margin-period bridge draws, as values
    Paths        Z (ENGINE: the values above; LIVE: NORMSINV(RAND())), x, the bond over each step, the account, the
                 bonds to the trade's dates, each floating period's growth, V (ccr.valuation.value_swap, branch by
                 branch), what has been paid, and each path's discounting over the curve's
    Exposure     the CSA (a preset, or the terms you set), the value a margin period back drawn on the value with
                 its payments still in it, the collateral, the residual, EE / ENE / PFE / IM per step, plain and
                 discounted on each path
    Waterfall    survival, CVA, DVA, FCA, FBA on the path-discounted exposure, SA-CCR EAD, KVA, MVA, ColVA, step by
                 step, and the totals
    Convergence  the running mean of EE at one date against path count, with ±2 standard errors
    Engine       what the engine computed on the same draws, per CSA preset, and figures on single paths (for the Checks)

ENGINE mode reproduces the engine to rounding (the Checks sheet says so; backend/scripts/check_workbook.py evaluates
every check outside Excel). LIVE mode re-rolls the simulation on every recalculation and the Convergence sheet shows
the Monte Carlo error. A two-year swap on a monthly grid at 200 paths is about 76,000 formula cells."""
from __future__ import annotations

import math
from datetime import date, timedelta
from types import SimpleNamespace

import numpy as np
from openpyxl import Workbook
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter as L

from methodology import workbook as W
from pricing.calibration import calibrate_hw1f, hw1f_swaption_vol_normal, tenor_to_years
from pricing.csa import CSA, BUSINESS_DAYS_PER_YEAR, MPOR_FLOOR_BILATERAL_BD, MPOR_FLOOR_CLEARED_BD
from pricing.curve import discount_fn_from_curve
from pricing.xva_engine import ALPHA, CAP_R, IM_CONFIDENCE, SF_IR, WaterfallParams, run_waterfall

N_PATHS, TENOR_YEARS, NOTIONAL, FIXED_RATE, DIRECTION, SEED = 200, 2, 10_000_000.0, 0.03643, "PAY", 42
PRESETS = ("UNCOLLATERALISED", "BILATERAL", "ON_CHAIN")
DEFAULT_PRESET = "BILATERAL"
BASKET_DEF = [("1Y", "5Y", 1.0), ("2Y", "5Y", 1.0), ("3Y", "5Y", 1.0), ("5Y", "5Y", 1.0), ("7Y", "5Y", 0.8), ("10Y", "5Y", 0.6),
              ("1Y", "1Y", 0.8), ("1Y", "2Y", 0.8), ("1Y", "3Y", 0.8), ("1Y", "7Y", 0.8), ("1Y", "9Y", 0.8), ("3Y", "7Y", 0.8), ("7Y", "3Y", 0.8), ("5Y", "9Y", 0.7)]
MAX_PAY = 9
GRID_R0 = 24            # Model: the grid's row for k = 0
CAP_LIKE = ("cap", "floor", "collar")      # the products valued period by period on the paths (ccr/options.value_caplets)
COLLAR_HALF_WIDTH = 0.005                  # the collar's strikes: FIXED_RATE plus (the cap, bought) and minus (the floor, sold) 50bp
OPTION_WORD = {"cap": "cap", "floor": "floor", "collar": "collar"}
SWAPTION_EXPIRY_MONTHS, SWAPTION_TENOR_YEARS = 12, 2      # the swaption book: a one-year option on a two-year swap


def swaption_dates(val: date) -> tuple:
    """(expiry, start, end) of the swaption book's trade, as the swaption ticket takes them: the expiry a tenor in
    calendar months from the valuation date, off a weekend; the swap delivered starts as many calendar days after the
    spot-starting swap as the expiry is after the valuation date, and ends its tenor later by the calendar."""
    from ccr.simulate import add_months
    expiry = add_months(val, SWAPTION_EXPIRY_MONTHS)
    while expiry.weekday() >= 5:
        expiry += timedelta(days=1)
    start = spot_date(val) + timedelta(days=(expiry - val).days)
    return expiry, start, add_months(start, 12 * SWAPTION_TENOR_YEARS)


def strikes_of(product: str) -> dict:
    """{type: strike} of the book's option: a cap and a floor at FIXED_RATE; a collar's cap above it and its floor below."""
    return {"cap": {"CAP": FIXED_RATE}, "floor": {"FLOOR": FIXED_RATE},
            "collar": {"CAP": FIXED_RATE + COLLAR_HALF_WIDTH, "FLOOR": FIXED_RATE - COLLAR_HALF_WIDTH}}[product]



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


def spot_date(val: date) -> date:
    d, n = val, 0
    while n < 2:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return d


def trade_body(val: date, product: str = "swap") -> dict:
    """The workbook's trade as the ticket's booking body. A swap: from spot, the tenor by the calendar, a fixed and a
    floating leg with nothing but their sides and the coupon; the conventions are the currency's
    (api/routes/_leg_defaults). A cap (product "cap", 0.60.0): a bought cap struck at FIXED_RATE over the same two years,
    quarterly, as the cap ticket books it: one floating leg with no participation in the rate and the cap on it."""
    from ccr.simulate import add_months
    eff = spot_date(val); mat = add_months(eff, 12 * TENOR_YEARS)
    if product in CAP_LIKE:
        # a floor (0.62.0): the floor bought, as the floor ticket books it. A collar: the cap bought and the floor sold,
        # so the book carries a written option on the paths as well as a held one
        ks = strikes_of(product)
        return {"instrument_type": f"IR_{product.upper()}", "asset_class": "RATES", "structure": None, "notional": NOTIONAL, "notional_ccy": "USD",
                "trade_date": val.isoformat(), "effective_date": eff.isoformat(), "maturity_date": mat.isoformat(),
                "terms": {"option": product.upper(), "side": "BUY", "cap_rate": ks.get("CAP"), "floor_rate": ks.get("FLOOR")},
                "legs": [{"leg_ref": "OPT-1", "leg_seq": 1, "leg_type": "FLOAT", "direction": "RECEIVE", "currency": "USD", "notional": NOTIONAL,
                          "payment_frequency": "QUARTERLY", "day_count": "ACT/360", "bdc": "MOD_FOLLOWING", "payment_lag": 2, "leverage": 0, "spread": 0,
                          "embedded_options": [{"type": t, "direction": "SELL" if (product == "collar" and t == "FLOOR") else "BUY", "default_strike": k, "strike_schedule": []}
                                               for t, k in ks.items()]}]}
    pay, rec = ("PAY", "RECEIVE") if DIRECTION == "PAY" else ("RECEIVE", "PAY")
    if product == "swaption":
        # a bought payer swaption (0.62.0), as the swaption ticket books it: the option's terms beside the swap it delivers
        expiry, start, end = swaption_dates(val)
        dated = {"effective_date": start.isoformat(), "maturity_date": end.isoformat()}
        return {"instrument_type": "IR_SWAPTION", "asset_class": "RATES", "structure": "EUROPEAN", "notional": NOTIONAL, "notional_ccy": "USD",
                "trade_date": val.isoformat(), "effective_date": eff.isoformat(), "maturity_date": add_months(eff, 12 * SWAPTION_TENOR_YEARS).isoformat(),
                "terms": {"direction": "PAY", "float_direction": "RECEIVE", "fixed_rate": FIXED_RATE, "option": "SWAPTION", "side": "BUY", "is_payer": True,
                          "expiry_date": expiry.isoformat(), "exercise_type": "EUROPEAN", "strike": FIXED_RATE},
                "legs": [{"leg_ref": "FIXED-1", "leg_seq": 1, "leg_type": "FIXED", "direction": "PAY", "currency": "USD", "notional": NOTIONAL, "fixed_rate": FIXED_RATE, **dated},
                         {"leg_ref": "FLOAT-1", "leg_seq": 2, "leg_type": "FLOAT", "direction": "RECEIVE", "currency": "USD", "notional": NOTIONAL, **dated}]}
    return {"instrument_type": "IR_SWAP", "asset_class": "RATES", "structure": "VANILLA", "notional": NOTIONAL, "notional_ccy": "USD",
            "trade_date": val.isoformat(), "effective_date": eff.isoformat(), "maturity_date": mat.isoformat(),
            "legs": [{"leg_ref": "FIXED-1", "leg_seq": 1, "leg_type": "FIXED", "direction": pay, "currency": "USD", "notional": NOTIONAL, "fixed_rate": FIXED_RATE},
                     {"leg_ref": "FLOAT-1", "leg_seq": 2, "leg_type": "FLOAT", "direction": rec, "currency": "USD", "notional": NOTIONAL}]}


def the_trade(val: date, product: str = "swap"):
    """(item, months): the trade as the credit engine takes it from a ticket (api/routes/xva.hypothetical_trade, then
    ccr.valuation.NettingSet: the production schedule generator on the completed legs), and the grid's length. No
    database is read: a ticket's trade is not a stored row."""
    from api.routes.xva import hypothetical_trade
    from ccr.valuation import NettingSet
    body = trade_body(val, product)
    who = "00000000-0000-4000-8000-000000000000"
    ns = NettingSet(None, {"sub": who}, [hypothetical_trade(body, None, who)], val, mkt=None)
    want = "SWAPTION" if product == "swaption" else "SWAP"
    if len(ns.items) != 1 or ns.items[0]["kind"] != want:
        raise ValueError(f"the workbook's trade was not taken as a {want.lower()}: {ns.skipped}")
    if product in CAP_LIKE and [c["type"] for c in ns.items[0].get("caplets") or []] != list(strikes_of(product)):
        raise ValueError(f"the workbook's {product} was not taken as its strips of caplets and floorlets")
    item = dict(ns.items[0])
    item["effective"] = item["start"] if product == "swaption" else date.fromisoformat(body["effective_date"])      # a swaption: the swap delivered starts here
    return item, ns.months


def waterfall_for(eng: dict, csa_request: dict, **inputs):
    """(csa, result): the engine's waterfall on the book's paths under any CSA and any of the waterfall's inputs
    (capital_model, wwr_multiplier, cp_cds_bp, ...), called as the ticket's route calls it. The three presets on the
    Engine sheet are three of these; scripts/check_workbook.py calls it with typed terms to check the cells a reader
    can type into."""
    from dataclasses import replace
    csa = CSA.from_request(csa_request)
    params = replace(eng["params"], **inputs) if inputs else eng["params"]
    return csa, run_waterfall(eng["V"][:, 1:], eng["v0"], eng["p0_grid"], params, csa,
                              settled=eng["paid"] if csa.collateralised else None, deflator=eng["w"])


def engine_runs(mkt, fit: dict, n_paths: int = N_PATHS, product: str = "swap") -> dict:
    """The ticket's own run (api/routes/xva._trade_paths) on the workbook's trade, and the waterfall under each preset."""
    from ccr import calibration as C
    from ccr.simulate import account, deflator, simulate
    from ccr.valuation import flows_per_step, value_swap, years
    val = mkt.valuation_date
    item, months = the_trade(val, product)
    key = f"RATES:{C.CURVE_OF.get('USD', 'USD_OIS')}"
    a, sig = max(float(fit["a"]), 1e-4), max(float(fit["sigma_bp"]) / 1e4, 1e-6)
    cal = C.Calibration("RISK_NEUTRAL", {key: C.Factor(key, "RATES", a=a, sigma=sig)}, np.array([[1.0]]), [key], drift_mode="forward")
    p = simulate(cal, {key: mkt.curve}, {}, {}, val, months, n_paths, seed=SEED)
    T = len(p.t) - 1
    own = {"USD": 1.0}
    from ccr import options as O
    # as ccr.valuation.netted_paths values the item: its legs, and the caps and floors on them
    swap_at = lambda it, pp, j: value_swap(it, pp, j, own)
    if item["kind"] == "SWAPTION":
        # ccr.valuation.netted_paths: an option until its expiry (Bachelier at the vol the paths' own model implies), the swap after on the paths that exercised
        V = np.stack([O.value_swaption(item, p, i, own, swap_at) for i in range(T + 1)], axis=1)
    else:
        V = np.stack([value_swap(item, p, i, own) + (O.value_caplets(item, p, i, own) if item.get("caplets") else 0.0) for i in range(T + 1)], axis=1)
    fl = flows_per_step(SimpleNamespace(items=[item]), p, own)
    # the waterfall's `settled`: the cash that has left or come into the set by each date, the payments' jumps in V with
    # the sign turned, exactly as the ticket's route passes it (api/routes/xva.py, simulate)
    paid = -np.cumsum(np.broadcast_to(fl, (n_paths, T + 1)), axis=1)[:, 1:]
    dt = float(p.t[-1]) / T
    p0 = p.p0[key]
    p0_grid = [float(p0(float(x))) for x in p.t] + [float(p0(float(p.t[-1]) + dt))]
    w = deflator(p, key)
    # the draws as the engine's step used them: (x_i − x_{i−1}·e^(−aΔ)) / std, to the last digit
    x = p.x[key]; dts = np.diff(p.t)
    z = np.zeros((n_paths, T))
    for i in range(1, T + 1):
        d = float(dts[i - 1]); std = sig * math.sqrt((1 - math.exp(-2 * a * d)) / (2 * a))
        z[:, i - 1] = (x[:, i] - x[:, i - 1] * math.exp(-a * d)) / std
    v0 = float(V[:, 0].mean())
    maturity_y = max(years(val, item["maturity"]), dt)
    params = WaterfallParams(notional=NOTIONAL, maturity_y=maturity_y, dt=dt, theta=fit["theta"])
    eng = {"V": V, "v0": v0, "p0_grid": p0_grid, "paid": paid, "w": w, "params": params}
    runs = {preset: waterfall_for(eng, {"preset": preset}) for preset in PRESETS}
    opt = {}
    if item["kind"] == "SWAPTION":
        from ccr.simulate import _inside, ou_bridge, rate_between
        t_exp = years(val, item["expiry"])
        i_exp = min(j for j in range(T + 1) if float(p.t[j]) >= t_exp - 1e-9)
        future = [(pay, tau) for (_, _, pay, tau) in item["fixed_sched"] if years(val, pay) > t_exp - 1e-9]
        hw = O.hw_price(item, p)
        opt = {"t_exp": t_exp, "i_exp": i_exp, "future": future, "hw": hw, "sig_n": float(O.hw_implied_vol(item, p)), "is_payer": bool(item["is_payer"]),
               "sign": float(item.get("sign", 1.0)), "swap": np.stack([swap_at(item, p, i) for i in range(T + 1)], axis=1),
               "took": O.exercised(item, p, swap_at), "flows": O.swaption_flows(item, val), "inside": None}
        where = _inside(p, t_exp)
        if where[0] == "step":
            # the expiry is not a grid date: the factor's state there, between the two grid states either side
            _, i_s, d, D = where
            k = ou_bridge(a, sig, d, D)
            x_e = rate_between(p, key, t_exp)
            mean = x[:, i_s - 1] * k["decay_d"] + k["c_d"] * (x[:, i_s] - x[:, i_s - 1] * k["decay_D"])
            opt["inside"] = {**k, "step": i_s, "x_e": x_e, "xi": (x_e - mean) / math.sqrt(k["var"])}
    return {"option": opt, "product": product, "params": params, "n": n_paths, "item": item, "p": p, "key": key, "a": a, "sig": sig, "T": T, "dt": dt, "V": V, "v0": v0, "flows": fl, "paid": paid, "w": w,
            "z": z, "x": x, "A": account(p, key), "p0_grid": p0_grid, "maturity_y": maturity_y, "runs": runs, "sim": SimpleNamespace(z=z)}



# ── the sheets ───────────────────────────────────────────────────────────────


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


def _model_sheet(wb, mkt, fit, eng):
    T, p = eng["T"], eng["p"]
    ws = wb.create_sheet("Model")
    ws["A1"] = "HULL-WHITE ONE FACTOR ON THE TRADE'S OWN GRID"; ws["A1"].font = W.F_TITLE
    ws["A2"] = ("x(t) is a zero-mean Ornstein-Uhlenbeck process stepped exactly on monthly dates from the valuation date; every bond on a path is "
                "P(t,T) = P(0,T)/P(0,t)·exp(−B·(x + φ) − σ²/4a·B²·(1 − e^(−2at))), which reprices today's curve."); ws["A2"].font = W.F_SUB
    rows = [("Mean reversion a", eng["a"], "0.000000", True), ("σ (short-rate vol, decimal)", eng["sig"], "0.000000", True),
            ("Δ: the mean step in years (the waterfall's one step length)", f"=C{GRID_R0 + T}/Nsteps", "0.00000000", False),
            ("Steps T (monthly dates to the first on or after the maturity)", T, "0", False), ("Notional", NOTIONAL, "#,##0", True),
            ({"cap": "Cap strike K", "floor": "Floor strike K", "collar": "Cap strike K (the collar's cap, bought)",
              "swaption": "Strike K (the fixed rate of the swap delivered)"}.get(eng.get("product"), "Fixed rate K"),
             next(iter(strikes_of(eng["product"]).values())) if eng.get("product") in CAP_LIKE else FIXED_RATE, "0.0000%", True),
            ("Paths", eng["n"], "0", False),
            ("Mode (ENGINE: the engine's draws; LIVE: Excel re-rolls)", "ENGINE", "@", True),
            ("σ²/(2a²)", "=HW_sig^2/(2*HW_a^2)", "0.00000000", False), ("σ²/(4a)", "=HW_sig^2/(4*HW_a)", "0.00000000", False),
            ("Maturity in years: (maturity date − valuation date)/365.25", "=(Trade!B5-ValDate)/365.25", "0.000000", False)]
    for i, (label, v, fmt, inp) in enumerate(rows, 4):
        ws.cell(row=i, column=1, value=label)
        c = ws.cell(row=i, column=2, value=v); c.number_format = fmt
        if inp:
            c.fill = W.FILL_IN
        if label.startswith(("Mean reversion", "σ (short")):
            c.fill = W.FILL_RJ
    W.dropdown(ws, "B11", ["ENGINE", "LIVE"])
    if eng.get("product") == "swaption":
        ws["A15"] = "Expiry date"
        c = ws["B15"]; c.value = eng["item"]["expiry"]; c.number_format = "yyyy-mm-dd"; c.fill = W.FILL_RJ
        ws["A16"] = "T_e = (expiry − valuation date)/365.25"
        ws["B16"] = "=(B15-ValDate)/365.25"; ws["B16"].number_format = "0.000000"
        _names(wb, {"Texp": "Model!B16"})
    if eng.get("product") == "collar":
        ws["A15"] = "Floor strike (the collar's floor, sold)"
        c = ws["B15"]; c.value = strikes_of("collar")["FLOOR"]; c.number_format = "0.0000%"; c.fill = W.FILL_IN
        _names(wb, {"Kfloor": "Model!B15"})
    _names(wb, {"HW_a": "Model!B4", "HW_sig": "Model!B5", "Dt": "Model!B6", "Nsteps": "Model!B7", "Notl": "Model!B8", "Kfix": "Model!B9",
                "Npaths": "Model!B10", "Mode": "Model!B11", "SigA2": "Model!B12", "SigA4": "Model!B13", "Mat": "Model!B14"})
    ws.cell(row=GRID_R0 - 2, column=1, value="THE GRID").font = W.F_SECTION
    W.header(ws, GRID_R0 - 1, ["k", "date: valuation date + k months (a value)", "t = days/365.25", "Δ_k = t_k − t_(k−1)", "P(0,t) from the curve", "e^(−aΔ_k)",
                               "σ·√((1 − e^(−2aΔ_k))/2a)", "φ(t) = σ²/2a²·(1 − e^(−at))²", "1 − e^(−2at)"])
    for k in range(T + 1):
        r = GRID_R0 + k
        ws.cell(row=r, column=1, value=k)
        c = ws.cell(row=r, column=2, value=p.grid[k]); c.number_format = "yyyy-mm-dd"; c.fill = W.FILL_RJ
        ws.cell(row=r, column=3, value=f"=(B{r}-ValDate)/365.25").number_format = "0.000000"
        ws.cell(row=r, column=5, value=(1 if k == 0 else f"={_DF(f'B{r}')}")).number_format = "0.00000000"
        if k >= 1:
            ws.cell(row=r, column=4, value=f"=C{r}-C{r - 1}").number_format = "0.000000"
            ws.cell(row=r, column=6, value=f"=EXP(-HW_a*D{r})").number_format = "0.00000000"
            ws.cell(row=r, column=7, value=f"=HW_sig*SQRT((1-EXP(-2*HW_a*D{r}))/(2*HW_a))").number_format = "0.0000000000"
        ws.cell(row=r, column=8, value=f"=SigA2*(1-EXP(-HW_a*C{r}))^2").number_format = "0.0000000000"
        ws.cell(row=r, column=9, value=f"=1-EXP(-2*HW_a*C{r})").number_format = "0.00000000"
    W.widths(ws, [60, 36, 14, 16, 20, 14, 24, 28, 14])
    ws.freeze_panes = f"A{GRID_R0}"


def _trade_sheet(wb, eng):
    """The schedule as the engine generated it, and the dates a bond is priced to. Returns the periods and the date index."""
    from ccr.valuation import years
    item, val = eng["item"], eng["p"].grid[0]
    ws = wb.create_sheet("Trade")
    ws["A1"] = "THE TRADE AS A TICKET WOULD BOOK IT"; ws["A1"].font = W.F_TITLE
    ws["D4"] = "The book is of this trade, pay or receive as column B below says: the Engine sheet's figures are this trade's, so the side is not an input."; ws["D4"].font = W.F_SUB
    ws["A2"] = ("From spot, both legs yearly, ACT/360, modified following; the floating leg pays the overnight rate compounded over each period. The dates are the "
                "production schedule generator's (values); every amount below them is a formula."); ws["A2"].font = W.F_SUB
    ws["A4"] = "Effective date"; c = ws["B4"]; c.value = item["effective"]; c.number_format = "yyyy-mm-dd"; c.fill = W.FILL_RJ
    ws["A5"] = "Maturity date"; c = ws["B5"]; c.value = item["maturity"]; c.number_format = "yyyy-mm-dd"; c.fill = W.FILL_RJ
    W.header(ws, 8, ["leg", "our side of it (+1 receive, −1 pay)", "period start", "period end", "payment date", "τ (ACT/360, the generator's)", "τ = (end − start)/360",
                     "t_s", "t_e", "t_p", "paid in step"])
    periods = []
    r = 9
    t = [float(x) for x in eng["p"].t]
    product = eng.get("product")
    cap = product in CAP_LIKE
    if cap:
        what = {"cap": "A bought cap", "floor": "A bought floor", "collar": "A collar, the cap bought and the floor sold,"}[product]
        pays = {"cap": "A period pays N·max(G − X, 0)", "floor": "A period pays N·max(X − G, 0)",
                "collar": "A period of the cap pays N·max(G − X, 0) and a period of the floor N·max(X − G, 0)"}[product]
        ws["A2"] = (f"{what} from spot, quarterly, ACT/360, modified following, each period paid two business days after it ends: one floating leg with no participation "
                    f"in the rate and the option{'s' if product == 'collar' else ''} on it, as the {product} ticket books it. {pays}, G what one unit grows to over the period and X = 1 + τ·K. "
                    "The dates are the production schedule generator's (values); every amount below them is a formula.")
        ws["D4"] = (f"The book is of this {product}" + (", the cap held (column B: +1) and the floor written (−1)" if product == "collar" else ", bought (column B: +1, held)")
                    + ": the Engine sheet's figures are this trade's, so the side is not an input.")
        ws.cell(row=8, column=12, value="X = 1 + τ·K").font = W.F_SUB
    if product == "swaption":
        o = eng["option"]
        ws["A1"] = "THE SWAP THE OPTION DELIVERS, AS THE SWAPTION TICKET BOOKS IT"
        ws["A2"] = (f"A bought {'payer' if o['is_payer'] else 'receiver'} swaption: the right, on the expiry date (Model sheet), to enter this swap {'paying' if o['is_payer'] else 'receiving'} the strike. "
                    "The swap starts as many days after a spot-starting swap as the expiry is after the valuation date; both legs yearly, ACT/360, modified following. Until the "
                    "expiry the trade is the option (Option and Paths sheets); from the expiry it is this swap on the paths where it was worth exercising, and nothing on the others. "
                    "The dates are the production schedule generator's (values); every amount below them is a formula.")
        ws["D4"] = "The book is of this swaption, bought: column B is the holder's side of each leg of the swap delivered. The Engine sheet's figures are this trade's, so the side is not an input."
    # a swap: every period of each leg. A cap, a floor, a collar: the periods of each strip (the leg itself pays nothing)
    legs = [({"leg_type": c["type"], "direction": "RECEIVE" if c["sign"] > 0 else "PAY"}, c["periods"]) for c in item["caplets"]] if cap else item["legs"]
    for lg, sched in legs:
        kind = str(lg["leg_type"]).upper(); sign = -1 if str(lg["direction"]).upper().startswith("PAY") else 1
        for (ps, pe, pay, tau) in sched:
            tp = years(val, pay)
            step = next((i for i in range(1, len(t)) if t[i - 1] < tp <= t[i] + 1e-9), None)
            ws.cell(row=r, column=1, value=kind); ws.cell(row=r, column=2, value=sign)
            for col, d in ((3, ps), (4, pe), (5, pay)):
                c = ws.cell(row=r, column=col, value=d); c.number_format = "yyyy-mm-dd"; c.fill = W.FILL_RJ
            c = ws.cell(row=r, column=6, value=float(tau)); c.number_format = "0.00000000"; c.fill = W.FILL_RJ
            ws.cell(row=r, column=7, value=f"=(D{r}-C{r})/360").number_format = "0.00000000"
            for col, src in ((8, "C"), (9, "D"), (10, "E")):
                ws.cell(row=r, column=col, value=f"=({src}{r}-ValDate)/365.25").number_format = "0.000000"
            ws.cell(row=r, column=11, value=step)
            if cap:
                strike = "Kfloor" if (product == "collar" and kind == "FLOOR") else "Kfix"
                ws.cell(row=r, column=12, value=f"=1+F{r}*{strike}").number_format = "0.0000000000"
            periods.append({"row": r, "kind": kind, "sign": sign, "call": kind != "FLOOR", "ps": ps, "pe": pe, "pay": pay, "tau": float(tau),
                            "ts": years(val, ps), "te": years(val, pe), "tp": tp, "step": step})
            r += 1
    dates = sorted({d for q in periods for d in (q["ps"], q["pe"], q["pay"]) if years(val, d) > 1e-12})
    r += 2
    ws.cell(row=r, column=1, value="THE DATES A BOND IS PRICED TO").font = W.F_SECTION; r += 1
    W.header(ws, r, ["m", "date", "T = days/365.25", "P(0,T) from the curve"]); r += 1
    dr0 = r
    idx = {}
    for m, d in enumerate(dates):
        rr = dr0 + m
        ws.cell(row=rr, column=1, value=m + 1)
        c = ws.cell(row=rr, column=2, value=d); c.number_format = "yyyy-mm-dd"; c.fill = W.FILL_RJ
        ws.cell(row=rr, column=3, value=f"=(B{rr}-ValDate)/365.25").number_format = "0.000000"
        ws.cell(row=rr, column=4, value=f"={_DF(f'B{rr}')}").number_format = "0.00000000"
        idx[d] = m
    W.widths(ws, [16, 30, 14, 14, 14, 26, 22, 12, 12, 12, 12])
    return periods, dates, idx, dr0


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


def _bonds_sheet(wb, eng, dates, dr0):
    """B(t_k, T) and ln A(t_k, T) for the next grid date and for every date of the trade: P(t_k, T) on a path is exp(ln A − B·x)."""
    from ccr.valuation import years
    T, p = eng["T"], eng["p"]; val = p.grid[0]; t = [float(x) for x in p.t]
    ws = wb.create_sheet("Bonds")
    ws["A1"] = "THE BOND TABLES"; ws["A1"].font = W.F_TITLE
    ws["A2"] = ("B = (1 − e^(−a(T−t)))/a and ln A = ln(P(0,T)/P(0,t)) − B·φ(t) − σ²/4a·B²·(1 − e^(−2at)), for the next grid date and for each of the trade's dates; "
                "a cell is empty where the date is not after the grid date."); ws["A2"].font = W.F_SUB
    hdr = ["k", "next grid date"] + [d.isoformat() for d in dates]
    rB = 5
    ws.cell(row=rB - 1, column=1, value="B(t_k, T)").font = W.F_SECTION
    W.header(ws, rB, hdr)
    rA = rB + T + 5
    ws.cell(row=rA - 1, column=1, value="ln A(t_k, T)").font = W.F_SECTION
    W.header(ws, rA, hdr)
    for k in range(T + 1):
        g = GRID_R0 + k
        for base in (rB, rA):
            ws.cell(row=base + 1 + k, column=1, value=k)
        if k < T:
            ws.cell(row=rB + 1 + k, column=2, value=f"=(1-EXP(-HW_a*Model!D{g + 1}))/HW_a").number_format = "0.00000000"
            ws.cell(row=rA + 1 + k, column=2, value=f"=LN(Model!E{g + 1}/Model!E{g})-B{rB + 1 + k}*Model!H{g}-SigA4*B{rB + 1 + k}^2*Model!I{g}").number_format = "0.0000000000"
        for m, d in enumerate(dates):
            if years(val, d) - t[k] <= 1e-12:
                continue
            col = L(3 + m)
            ws.cell(row=rB + 1 + k, column=3 + m, value=f"=(1-EXP(-HW_a*(Trade!C{dr0 + m}-Model!C{g})))/HW_a").number_format = "0.00000000"
            ws.cell(row=rA + 1 + k, column=3 + m, value=f"=LN(Trade!D{dr0 + m}/Model!E{g})-{col}{rB + 1 + k}*Model!H{g}-SigA4*{col}{rB + 1 + k}^2*Model!I{g}").number_format = "0.0000000000"
    W.widths(ws, [6, 16] + [14] * len(dates))
    ws.freeze_panes = "B6"
    return rB + 1, rA + 1          # the rows of k = 0


def _option_sheet(wb, eng, periods, idx, dr0):
    """The normal vol the paths' own model implies for the swaption (ccr/options.hw_implied_vol), in cells. The model
    prices a European swaption exactly: at the expiry every bond is exp(ln A − B·x), so the swap delivered, written as
    its cash flows (ccr/options.swaption_flows: its own start, each period's end, each payment date), is a sum of terms
    α·exp(−β·x) that rises with x through one level x*; x at the expiry is normal, so each term has a closed form.
    The vol is the one at which Bachelier's formula on today's forward swap rate gives that price: with it the option's
    value before the expiry and its exercise on the paths at the expiry are one model. The level x* and the vol are the
    engine's roots (values); the sheet shows that each is a root. Returns the cells Paths reads."""
    from ccr.valuation import years
    o = eng["option"]; p = eng["p"]; hw = o["hw"]
    te = o["t_exp"]
    val = p.grid[0]
    ws = wb.create_sheet("Option")
    ws["A1"] = "THE SWAPTION IN THE PATHS' OWN MODEL: ITS EXACT PRICE AND THE NORMAL VOL THAT GIVES IT"; ws["A1"].font = W.F_TITLE
    ws["A2"] = ("At the expiry every bond is P(T_e, T) = exp(ln A − B·x), falling in x. The swap delivered is its cash flows: each fixed coupon −K·τ·P(T_e, pay), each floating "
                "period P(T_e, start)·P(T_e, pay)/P(T_e, end) − P(T_e, pay) (the period's growth, paid on its payment date). Each is a term α·exp(−β·x); the payer swap's value "
                "is their sum and rises with x through one level x*. Under the measure of the bond to T_e, x is normal with mean −φ(T_e) and the variance below, so a payer "
                "swaption is P(0,T_e)·Σ α·exp(β·φ + ½β²s²)·Φ((−φ − β·s² − x*)/s) (a receiver: the same sum on the other side of x*). σ_n is the vol at which Bachelier's "
                "formula on today's forward swap rate gives that price per unit of annuity: the Paths sheet values the option at it until the expiry, so the value today is "
                "the model's own price and not the ticket's."); ws["A2"].font = W.F_SUB
    rows = [("T_e", "=Texp", "0.000000"), ("P(0, T_e) from the curve", f"={_DF('Model!$B$15')}", "0.00000000"),
            ("φ(T_e) = σ²/2a²·(1 − e^(−a·T_e))²", "=SigA2*(1-EXP(-HW_a*Texp))^2", "0.0000000000"),
            ("s²: the factor's variance at T_e, σ²/2a·(1 − e^(−2a·T_e))", "=HW_sig^2/(2*HW_a)*(1-EXP(-2*HW_a*Texp))", "0.000000000000")]
    for i, (lab, f, fmt) in enumerate(rows, 4):
        ws.cell(row=i, column=1, value=lab); ws.cell(row=i, column=2, value=f).number_format = fmt
    ws["A8"] = "x*: the factor level at the expiry where the swap delivered is worth nothing (the engine's root)"
    c = ws["B8"]; c.value = float(hw["x_star"]); c.fill = W.FILL_RJ; c.number_format = "0.000000000000"
    _names(wb, {"Xstar": "Option!B8"})

    # the bonds the cash flows are made of
    r = 10
    W.header(ws, r, ["m", "T (a date of the swap delivered)", "P(0, T)", "B = (1 − e^(−a(T − T_e)))/a", "ln A"]); r += 1
    drow = {}
    late = [d for d in sorted(idx, key=lambda d: idx[d]) if years(val, d) > te + 1e-12]
    for d in late:
        ws.cell(row=r, column=1, value=idx[d] + 1)
        ws.cell(row=r, column=2, value=f"=Trade!$C${dr0 + idx[d]}").number_format = "0.000000"
        ws.cell(row=r, column=3, value=f"=Trade!$D${dr0 + idx[d]}").number_format = "0.00000000"
        ws.cell(row=r, column=4, value=f"=(1-EXP(-HW_a*(B{r}-Texp)))/HW_a").number_format = "0.0000000000"
        ws.cell(row=r, column=5, value=f"=LN(C{r}/$B$5)-D{r}*$B$6-SigA4*D{r}^2*(1-EXP(-2*HW_a*Texp))").number_format = "0.0000000000"
        drow[round(years(val, d), 9)] = r
        r += 1

    # the cash flows, term by term, in the engine's order: the fixed coupons, then the floating periods
    r += 1
    W.header(ws, r, ["m", "the term", "w", "β = Σ ±B", "ln|α| = ln|w| + Σ ±ln A", "at x*: ±exp(ln|α| − β·x*)", "forward at T_e: ±exp(ln|α| + β·φ + ½β²s²)",
                     "d = (−φ − β·s² − x*)/s", "its part of the price", "its part (engine)", "today: w·Π P(0,·)^±"])
    r += 1
    t0 = r
    tau_row = {round(q["tp"], 9): q["row"] for q in periods if q["kind"] == "FIXED"}
    cells = []
    for m, term in enumerate(hw["terms"]):
        w, bonds = term["w"], term["bonds"]
        refs = [(drow.get(round(T, 9)), sgn) for T, sgn in bonds]                 # a date at the expiry itself is a bond worth one: no row
        fixed = m < hw["n_fixed"]
        ws.cell(row=r, column=1, value=m + 1)
        if fixed:
            what = "a fixed coupon: −K·τ·P(pay)"
            wf = f"=-Kfix*Trade!$F${tau_row[round(bonds[0][0], 9)]}"
        elif len(bonds) == 3:
            what = "a floating period: P(start)·P(pay)/P(end)"; wf = float(w)
        elif w > 0:
            what = "a floating period: P(start)"; wf = float(w)
        else:
            what = "a floating period: −P(end)" if abs(w) >= 1 - 1e-12 else "a spread"; wf = float(w)
        ws.cell(row=r, column=2, value=what)
        c = ws.cell(row=r, column=3, value=wf); c.number_format = "0.0000000000"
        if not fixed:
            c.fill = W.FILL_RJ
        ws.cell(row=r, column=4, value="=" + ("".join(f"{'+' if sgn > 0 else '-'}D{rr}" for rr, sgn in refs if rr) or "0")).number_format = "0.0000000000"
        ws.cell(row=r, column=5, value=f"=LN(ABS(C{r}))" + "".join(f"{'+' if sgn > 0 else '-'}E{rr}" for rr, sgn in refs if rr)).number_format = "0.0000000000"
        ws.cell(row=r, column=6, value=f"=SIGN(C{r})*EXP(E{r}-D{r}*Xstar)").number_format = "0.000000000000"
        ws.cell(row=r, column=7, value=f"=SIGN(C{r})*EXP(E{r}+D{r}*$B$6+D{r}^2*$B$7/2)").number_format = "0.000000000000"
        ws.cell(row=r, column=8, value=f"=(-$B$6-D{r}*$B$7-Xstar)/SQRT($B$7)").number_format = "0.00000000"
        ws.cell(row=r, column=9, value=(f"=$B$5*G{r}*NORMSDIST(H{r})" if o["is_payer"] else f"=-$B$5*G{r}*NORMSDIST(-H{r})")).number_format = "0.000000000000"
        c = ws.cell(row=r, column=10, value=float(term["part"])); c.fill = W.FILL_RJ; c.number_format = "0.000000000000"
        ws.cell(row=r, column=11, value=f"=C{r}" + "".join(f"{'*' if sgn > 0 else '/'}C{rr}" for rr, sgn in refs if rr)).number_format = "0.000000000000"
        W.check(wb, "Option", f"term {m + 1}'s part of the price ({what.split(':')[0]})", f"I{r}", f"J{r}", 1e-9)
        cells.append((1.0 if w > 0 else -1.0, f"Option!$E${r}", f"Option!$D${r}"))
        r += 1
    t1 = r - 1
    nf = hw["n_fixed"]
    r += 1
    out = {}
    sT = "(SigN*SQRT(Texp))"
    lines = [("zero", "Σ of the terms at x*: nothing, so the swap delivered is worth nothing there", f"=SUM(F{t0}:F{t1})", 0.0, "0.000000000000", 1e-9),
             ("price", "the model's price per unit of notional: Σ of the terms' parts", f"=SUM(I{t0}:I{t1})", float(hw["npv"]), "0.000000000000", 1e-9),
             ("A0", "A₀ = Σ τ·P(0, pay) over the fixed coupons: the annuity today", f"=-SUM(K{t0}:K{t0 + nf - 1})/Kfix", float(hw["A0"]), "0.0000000000", 1e-9),
             ("F0", "F₀ = the floating leg today / A₀: the forward rate of the swap delivered", f"=SUM(K{t0 + nf}:K{t1})/B{{A0}}", float(hw["F0"]), "0.0000000000", 1e-9),
             ("target", "the price per unit of annuity", "=B{price}/B{A0}", float(hw["npv"] / hw["A0"]), "0.000000000000", 1e-7),
             ("sig", "σ_n: the normal vol at which Bachelier's formula gives that price (the engine's root)", None, float(o["sig_n"]), "0.0000000000", None),
             ("bach", "Bachelier per unit of annuity at σ_n: σ_n√T_e·[d·Φ(d) + φ(d)], d = (F₀ − K)/(σ_n√T_e)" + ("" if o["is_payer"] else ", less (F₀ − K) for a receiver"), None,
              float(hw["npv"] / hw["A0"]), "0.000000000000", 1e-6)]
    W.header(ws, r, ["", "in cells", "the engine's"]); r += 1
    for name, lab, f, engine, fmt, tol in lines:
        out[name] = r
        ws.cell(row=r, column=1, value=lab)
        if name == "bach":
            d = f"((B{out['F0']}-Kfix)/{sT})"
            f = f"={sT}*({d}*NORMSDIST({d})+EXP(-{d}^2/2)/SQRT(2*PI()))" + ("" if o["is_payer"] else f"-(B{out['F0']}-Kfix)")
        elif f:
            f = f.replace("{A0}", str(out.get("A0", ""))).replace("{price}", str(out.get("price", "")))
        if name == "sig":
            c = ws.cell(row=r, column=2, value=engine); c.fill = W.FILL_RJ; c.number_format = fmt
        else:
            ws.cell(row=r, column=2, value=f).number_format = fmt
            c = ws.cell(row=r, column=3, value=engine); c.fill = W.FILL_RJ; c.number_format = fmt
            W.check(wb, "Option", lab.split(":")[0], f"B{r}", f"C{r}", tol)
        r += 1
    _names(wb, {"SigN": f"Option!B{out['sig']}"})
    ws.cell(row=r + 1, column=1, value=("The last row is the vol's own check: Bachelier at σ_n against the model's price. They agree to the tolerance the engine's root-finder stops at. "
                                        "The model's vol is not the market's quote for this swaption; the ticket prices at the quote, so the run starts from the model's price.")).font = W.F_SUB
    r += 3
    res = {"A0": f"Option!$B${out['A0']}", "F0": f"Option!$B${out['F0']}", "bach": f"Option!$B${out['bach']}", "sig": f"Option!$B${out['sig']}", "terms": cells, "inside": None}
    ins = o.get("inside")
    if ins:
        # the expiry is inside a step: the factor's state there, given the two grid states either side (ccr/simulate.rate_between)
        ws.cell(row=r, column=1, value=f"THE EXPIRY IS NOT A GRID DATE: THE FACTOR'S STATE THERE, INSIDE STEP {ins['step']}").font = W.F_SECTION; r += 1
        ws.cell(row=r, column=1, value=("x at the expiry, given x at the grid dates either side, is normal about lo·e^(−a·d·h) + c·(hi − lo·e^(−a·D·h)) with the variance below "
                                        "(h one day, d the expiry's day of the step's D days). The holder decides on the swap's value at that state: Σ ±exp(ln|α| − β·x), the terms above.")).font = W.F_SUB; r += 1
        W.header(ws, r, ["", "in cells", "the engine's"]); r += 1
        g = {}
        rows2 = [("d", "d: the expiry's day of the step", None, float(ins["d"]), "0"), ("D", "D: the step's days", None, float(ins["D"]), "0"),
                 ("dd", "e^(−a·d·h), h = 1/365.25", "=EXP(-HW_a*B{d}/365.25)", ins["decay_d"], "0.000000000000"),
                 ("dD", "e^(−a·D·h)", "=EXP(-HW_a*B{D}/365.25)", ins["decay_D"], "0.000000000000"),
                 ("vd", "v(d) = σ²/2a·(1 − e^(−2a·d·h))", "=HW_sig^2/(2*HW_a)*(1-EXP(-2*HW_a*B{d}/365.25))", ins["v_d"], "0.000000000000000"),
                 ("vD", "v(D)", "=HW_sig^2/(2*HW_a)*(1-EXP(-2*HW_a*B{D}/365.25))", ins["v_D"], "0.000000000000000"),
                 ("c", "c = e^(−a·(D − d)·h)·v(d)/v(D)", "=EXP(-HW_a*(B{D}-B{d})/365.25)*B{vd}/B{vD}", ins["c_d"], "0.000000000000"),
                 ("var", "the variance left: v(d) − c²·v(D)", "=B{vd}-B{c}^2*B{vD}", ins["var"], "0.000000000000000")]
        for name, lab, f, engine, fmt in rows2:
            g[name] = r
            ws.cell(row=r, column=1, value=lab)
            if f is None:
                c = ws.cell(row=r, column=2, value=engine); c.fill = W.FILL_RJ; c.number_format = fmt
            else:
                for k_, v_ in g.items():
                    f = f.replace("{" + k_ + "}", str(v_))
                ws.cell(row=r, column=2, value=f).number_format = fmt
                c = ws.cell(row=r, column=3, value=float(engine)); c.fill = W.FILL_RJ; c.number_format = fmt
                W.check(wb, "Option", lab.split(":")[0], f"B{r}", f"C{r}", 1e-9)
            r += 1
        res["inside"] = {k_: f"Option!$B${v_}" for k_, v_ in g.items()}
    W.widths(ws, [84, 30, 18, 26, 24, 26, 34, 24, 22, 20, 22])
    return res


def _variance_sheet(wb, eng, periods):
    """The model's variance of the logarithm of what a unit grows to over each period of the cap, seen from each grid
    date: ccr/options.growth_variance in cells. ln G is a sum of the factor at grid dates, each with a weight; the
    variance from date i is Σ over the dates after i of Var(x_k | x_i)·g_k, with g_k = w_k·(w_k + 2·S_k) and S_k the
    weights after k decayed back to k. Returns, per period, {grid date j: the cell of √variance} and today's cells."""
    from ccr import options as O
    T, p, key = eng["T"], eng["p"], eng["key"]
    ws = wb.create_sheet("Variance")
    ws["A1"] = "THE VARIANCE OF EACH PERIOD'S GROWTH, IN THE PATHS' OWN MODEL"; ws["A1"].font = W.F_TITLE
    ws["A2"] = ("ln G over a period is a constant plus Σ w_k·x(t_k) over grid dates k: w_k is B over the step that starts at k (less B to the period's start at the first, B to "
                "the period's end at the last), B(τ) = (1 − e^(−aτ))/a. Seen from grid date i the factor at a later date k has variance σ²/2a·(1 − e^(−2a(t_k − t_i))) and the dates "
                "after it follow it decayed, so the variance of the sum is Σ_(k>i) that variance × g_k, g_k = w_k·(w_k + 2·S_k), S_k = e^(−aΔ)·(w_(k+1) + S_(k+1)). The caplet "
                "is Black's formula on G with this variance: exact on these paths."); ws["A2"].font = W.F_SUB
    out = []
    r = 5
    g = lambda k: GRID_R0 + k
    for f, q in enumerate(periods):
        w = O._growth_weights(p, key, q["ts"], q["te"])
        ks = sorted(w)
        ja, jb = ks[0], ks[-1]
        ws.cell(row=r, column=1, value=f"PERIOD {f + 1}: {q['ps'].isoformat()} to {q['pe'].isoformat()}").font = W.F_SECTION
        W.header(ws, r + 1, ["grid date k"] + [str(k) for k in ks] + ["√variance of ln G"])
        rt, rw, rS, rg = r + 2, r + 3, r + 4, r + 5
        for lab, rr in (("t_k", rt), ("w_k", rw), ("S_k", rS), ("g_k = w_k·(w_k + 2·S_k)", rg)):
            ws.cell(row=rr, column=1, value=lab)
        B = lambda x: f"(1-EXP(-HW_a*({x})))/HW_a"
        for n_, k in enumerate(ks):
            c = L(2 + n_)
            ws.cell(row=rt, column=2 + n_, value=f"=Model!$C${g(k)}").number_format = "0.000000"
            ts, te = f"Trade!$H${q['row']}", f"Trade!$I${q['row']}"
            if ja == jb:
                wf = f"={B(f'{te}-{c}{rt}')}-{B(f'{ts}-{c}{rt}')}"
            elif k == ja:
                wf = f"={B(f'Model!$C${g(k + 1)}-{c}{rt}')}-{B(f'{ts}-{c}{rt}')}"
            elif k == jb:
                wf = f"={B(f'{te}-{c}{rt}')}"                       # the last weight is there only where the period ends after its last grid date
            else:
                wf = f"={B(f'Model!$C${g(k + 1)}-{c}{rt}')}"
            ws.cell(row=rw, column=2 + n_, value=wf).number_format = "0.0000000000"
            nxt = L(3 + n_)
            ws.cell(row=rS, column=2 + n_, value=(0 if k == jb else f"=EXP(-HW_a*({nxt}{rt}-{c}{rt}))*({nxt}{rw}+{nxt}{rS})")).number_format = "0.0000000000"
            ws.cell(row=rg, column=2 + n_, value=f"={c}{rw}*({c}{rw}+2*{c}{rS})").number_format = "0.000000000000"
        cv = 2 + len(ks)
        cells = {}
        rr = rg + 1
        for i in range(0, T + 1):
            if not q["te"] > float(p.t[i]) + 1e-9:
                break                                             # the period has ended: its growth is known
            ws.cell(row=rr, column=1, value=f"seen from grid date {i}")
            for n_ in range(len(ks)):
                c = L(2 + n_)
                ws.cell(row=rr, column=2 + n_, value=f"=IF({c}${rt}>Model!$C${g(i)}+1E-12,{c}${rg}*HW_sig^2/(2*HW_a)*(1-EXP(-2*HW_a*({c}${rt}-Model!$C${g(i)}))),0)").number_format = "0.000000000000"
            ws.cell(row=rr, column=cv, value=f"=SQRT(MAX(SUM({L(2)}{rr}:{L(1 + len(ks))}{rr}),0))").number_format = "0.0000000000"
            cells[i] = f"Variance!${L(cv)}${rr}"
            rr += 1
        out.append(cells)
        r = rr + 2
    W.widths(ws, [26] + [16] * 8)
    return out


def _normals_sheet(wb, eng, wf_noise):
    T, n = eng["T"], eng["n"]
    ws = wb.create_sheet("Normals")
    ws["A1"] = "THE ENGINE'S RANDOM DRAWS"; ws["A1"].font = W.F_TITLE
    ws["A2"] = f"Standard normals, path by path and step by step, as the engine's steps used them (seed {SEED} for the paths, 43 for the margin-period bridge). ENGINE mode uses these; LIVE mode ignores them."; ws["A2"].font = W.F_SUB
    z0, z1 = _block(ws, 4, n, T, lambda p, j, r, c: float(eng["z"][p, j - 1]), "0.000000", "Z: the Hull-White step's normal")
    n0, n1 = _block(ws, z1 + 3, n, T, lambda p, j, r, c: float(wf_noise[p, j - 1]), "0.000000", "N: the margin-period bridge's normal")
    last = n1
    ins = (eng.get("option") or {}).get("inside")
    if ins:
        e0, last = _block(ws, n1 + 3, n, 1, lambda p, j, r, c: float(ins["xi"][p]), "0.000000",
                          "E: the normal of the factor's state at the expiry, between the two grid states either side (the engine's, standardised)")
        ins["rows"] = (e0, last)
    for row in ws.iter_rows(min_row=z0, max_row=last, min_col=2, max_col=1 + T):
        for c in row:
            if isinstance(c.value, float):
                c.fill = W.FILL_RJ
    W.widths(ws, [10] + [11] * T)
    ws.freeze_panes = "B6"
    return (z0, z1), (n0, n1)


def _paths_sheet(wb, eng, periods, dates, idx, dr0, rB, rA, zrows, vcells=None):
    """Z → x → the bonds a step and a cash flow need → the account → the trade's value, what it has paid, and each
    path's discounting. The formulas follow ccr/simulate.py and ccr/valuation.value_swap branch by branch."""
    from ccr.valuation import years
    T, n, p = eng["T"], eng["n"], eng["p"]
    val = p.grid[0]; t = [float(x) for x in p.t]; z0 = zrows[0]
    ws = wb.create_sheet("Paths")
    ws["A1"] = "THE PATHS"; ws["A1"].font = W.F_TITLE
    ws["A2"] = ("Z → x (the OU step) → P(t,T) = exp(ln A − B·x) for the next grid date and each of the trade's dates → the account A (cash rolled at each step's own bond) → "
                "V, the trade's value on its own schedule → what it has paid → each path's discounting over the curve's. Every cell is a formula."); ws["A2"].font = W.F_SUB
    B = {}
    top = 4
    B["Z"] = _block(ws, top, n, T, lambda q, j, r, c: f"=IF(Mode=\"ENGINE\",Normals!{L(c)}{z0 + q},NORMSINV(RAND()))", "0.000000", "Z (ENGINE: the engine's draw; LIVE: NORMSINV(RAND()))")
    top = B["Z"][1] + 3
    zb = B["Z"]
    B["X"] = _block(ws, top, n, T, lambda q, j, r, c: (f"=Model!$G${GRID_R0 + j}*{L(c)}{zb[0] + q}" if j == 1 else f"={L(c - 1)}{r}*Model!$F${GRID_R0 + j}+Model!$G${GRID_R0 + j}*{L(c)}{zb[0] + q}"),
                    "0.0000000000", "x: x(t_k) = x(t_(k−1))·e^(−aΔ_k) + σ√((1−e^(−2aΔ_k))/2a)·Z")
    xb = B["X"]; top = xb[1] + 3

    def x(q, j):                       # x on path q at grid j (zero today)
        return "0" if j == 0 else f"{L(1 + j)}{xb[0] + q}"

    B["ONE"] = _block(ws, top, n, T, lambda q, j, r, c: f"=EXP(Bonds!$B${rA + j - 1}-Bonds!$B${rB + j - 1}*{x(q, j - 1)})", "0.00000000",
                      "P(t_(k−1), t_k): the bond over each step, seen at its start")
    ob = B["ONE"]; top = ob[1] + 3
    B["ACC"] = _block(ws, top, n, T, lambda q, j, r, c: (f"=1/{L(c)}{ob[0] + q}" if j == 1 else f"={L(c - 1)}{r}/{L(c)}{ob[0] + q}"), "0.00000000",
                      "A: one unit of cash rolled along the path, A(t_k) = A(t_(k−1)) / P(t_(k−1), t_k)")
    ab = B["ACC"]; top = ab[1] + 3
    pd = {}
    for m, d in enumerate(dates):
        Tm = years(val, d)
        col = L(3 + m)
        pd[m] = _block(ws, top, n, T, lambda q, j, r, c, col=col, Tm=Tm: (f"=EXP(Bonds!${col}${rA + j}-Bonds!${col}${rB + j}*{x(q, j)})" if Tm - t[j] > 1e-12 else None), "0.00000000",
                       f"P(t_k, {d.isoformat()}): empty once the date has passed")
        top = pd[m][1] + 3
    B["PD"] = pd

    def acc(q, j):
        return "1" if j == 0 else f"{L(1 + j)}{ab[0] + q}"

    def bond(q, j, d):
        """P(t_j, d) on path q: 1 at or after d (as the engine has it), today's curve at j = 0."""
        if years(val, d) - t[j] <= 1e-12:
            return "1"
        return f"Trade!$D${dr0 + idx[d]}" if j == 0 else f"{L(1 + j)}{pd[idx[d]][0] + q}"

    def at_or_before(a):
        return min(int(np.searchsorted(p.t, a + 1e-12, side="right") - 1), T)

    def growth(q, da, j=None, db=None):
        """ccr.simulate.growth from date `da` to grid date j or to date `db`, as an expression on path q."""
        a = years(val, da); b = t[j] if j is not None else years(val, db)
        if b <= a + 1e-12:
            return "1"
        ja, jb = at_or_before(a), (j if j is not None else at_or_before(b))
        end = "1" if j is not None else bond(q, jb, db)
        if ja == jb:
            return f"({bond(q, ja, da)}/{end})"
        out = f"{bond(q, ja, da)}/{L(1 + ja + 1)}{ob[0] + q}*{acc(q, jb)}/{acc(q, ja + 1)}"
        if j is None and b > t[jb] + 1e-12:
            out += f"/{end}"
        return f"({out})"

    cap = eng.get("product") in CAP_LIKE
    floats = [qd for qd in periods if (qd["kind"] in ("CAP", "FLOOR") if cap else qd["kind"] == "FLOAT")]
    # each floating period's whole growth: what it pays is N·(G − 1); a cap's period pays N·max(G − X, 0), a floor's N·max(X − G, 0)
    gb = _block(ws, top, n, len(floats), lambda q, j, r, c: "=" + growth(q, floats[j - 1]["ps"], db=floats[j - 1]["pe"]), "0.0000000000",
                "G: growth of one unit over each period (column = period, in the Trade sheet's order): "
                + ("a cap's period pays N·max(G − X, 0), a floor's N·max(X − G, 0)" if cap else "the period pays N·(G − 1)"))
    B["GROW"] = gb; top = gb[1] + 3

    if cap:
        # A cap (ccr/options.value_caplets): per period, M, the growth the path expects (what has accrued over the bond
        # to the period's end, or the two bonds' ratio before it begins), and U, the caplet per unit: Black on M with
        # the Variance sheet's figure while the period is open, the payoff of G once it has ended.
        X = lambda f: f"Trade!$L${floats[f]['row']}"
        # what a period is worth per unit at its end, and before it: a cap the call on the growth, a floor the put
        payoff = lambda f, g: f"MAX({g}-{X(f)},0)" if floats[f]["call"] else f"MAX({X(f)}-{g},0)"
        black = lambda f, m, d1, v: (f"{m}*NORMSDIST({d1})-{X(f)}*NORMSDIST({d1}-{v})" if floats[f]["call"]
                                     else f"{X(f)}*NORMSDIST({v}-{d1})-{m}*NORMSDIST(-({d1}))")
        let = lambda f: "caplet" if floats[f]["call"] else "floorlet"
        mb, ub = [], []
        for f, qd in enumerate(floats):
            def m_cell(q, j, r, c, qd=qd):
                if not qd["te"] > t[j] + 1e-9:
                    return None
                grown = growth(q, qd["ps"], j=j) if qd["ts"] <= t[j] + 1e-9 else bond(q, j, qd["ps"])
                return f"={grown}/{bond(q, j, qd['pe'])}"
            blk = _block(ws, top, n, T, m_cell, "0.0000000000", f"M, period {f + 1}: the growth the path expects over {qd['ps'].isoformat()} to {qd['pe'].isoformat()}; empty once it has ended")
            mb.append(blk); top = blk[1] + 3
        for f, qd in enumerate(floats):
            def u_cell(q, j, r, c, f=f, qd=qd):
                if not qd["tp"] > t[j] + 1e-9:
                    return None                                   # paid
                if not qd["te"] > t[j] + 1e-9:
                    return "=" + payoff(f, f"{L(2 + f)}{gb[0] + q}")
                m, v = f"{L(c)}{mb[f][0] + q}", vcells[f][j]
                d1 = f"(LN({m}/{X(f)})+{v}^2/2)/MAX({v},1E-12)"            # the IF below takes the payoff where no variance is left; the guard keeps the other branch a number
                return f"=IF({v}<1E-10,{payoff(f, m)},{black(f, m, d1, v)})"
            blk = _block(ws, top, n, T, u_cell, "0.0000000000", f"U, period {f + 1}: the {let(f)} per unit of notional before discounting: Black on M while the period is open, "
                         + ("max(G − X, 0)" if qd["call"] else "max(X − G, 0)") + " once it has ended; empty once paid")
            ub.append(blk); top = blk[1] + 3
        B["M"], B["U"] = mb, ub

        def value(q, j):
            terms = [f"{'+' if qd['sign'] > 0 else '-'}Notl*{bond(q, j, qd['pay'])}*{L(1 + j)}{ub[f][0] + q}" for f, qd in enumerate(floats) if qd["tp"] > t[j] + 1e-9]
            return "=" + ("".join(terms) if terms else "0")

        def flow(q, j):
            return "".join(f"{'+' if qd['sign'] > 0 else '-'}Notl*{payoff(f, f'{L(2 + f)}{gb[0] + q}')}" for f, qd in enumerate(floats) if qd["step"] == j)

        # today: the same formula with the curve's own bonds
        def today():
            terms = []
            for f, qd in enumerate(floats):
                m = f"({bond(0, 0, qd['ps'])}/{bond(0, 0, qd['pe'])})"
                v = vcells[f][0]
                d1 = f"(LN({m}/{X(f)})+{v}^2/2)/MAX({v},1E-12)"
                terms.append(f"{'+' if qd['sign'] > 0 else '-'}Notl*{bond(0, 0, qd['pay'])}*({black(f, m, d1, v)})")
            return "=" + "".join(terms)
        B["V"] = _block(ws, top, n, T, lambda q, j, r, c: value(q, j), "#,##0.00", "V: each period not yet paid, N·P(t, pay)·U")
        vb = B["V"]; top = vb[1] + 3
        B["PAID"] = _block(ws, top, n, T, lambda q, j, r, c: "=" + ("0" if j == 1 else f"{L(c - 1)}{r}") + flow(q, j), "#,##0.00",
                           "PAID: what the option has paid us by each date (and what we have paid on one we wrote), each period's payoff as it is paid: V + PAID is the value with its payments still in it, which has no jump at a payment")
        top = B["PAID"][1] + 3
        B["W"] = _block(ws, top, n, T, lambda q, j, r, c: f"=(1/{L(c)}{ab[0] + q})/(SUMPRODUCT(1/{L(c)}${ab[0]}:{L(c)}${ab[1]})/Npaths)", "0.00000000",
                        "w: the path's discount factor over the paths' mean one, (1/A) / mean(1/A): what each path's discounting is over the curve's")
        B["value0"] = today()
        W.widths(ws, [10] + [13] * max(T, len(floats)))
        ws.freeze_panes = "B6"
        return B

    def value(q, j):
        """ccr.valuation.value_swap at grid j on path q."""
        terms = []
        for qd in periods:
            if not qd["tp"] > t[j] + 1e-9:
                continue                                         # paid
            s = "+" if qd["sign"] > 0 else "-"
            if qd["kind"] == "FIXED":
                terms.append(f"{s}Notl*Kfix*Trade!$F${qd['row']}*{bond(q, j, qd['pay'])}")
                continue
            fi = floats.index(qd)
            if qd["te"] <= t[j] + 1e-9:                          # ended, waiting for its payment date
                terms.append(f"{s}Notl*({L(2 + fi)}{gb[0] + q}-1)*{bond(q, j, qd['pay'])}")
                continue
            grown = growth(q, qd["ps"], j=j) if qd["ts"] <= t[j] + 1e-9 else bond(q, j, qd["ps"])
            if qd["tp"] == qd["te"]:
                terms.append(f"{s}Notl*({grown}-{bond(q, j, qd['pe'])})")
            else:
                terms.append(f"{s}Notl*({grown}/{bond(q, j, qd['pe'])}-1)*{bond(q, j, qd['pay'])}")
        return "=" + ("".join(terms) if terms else "0")

    swaption = eng.get("product") == "swaption"
    if swaption:
        # ccr/options._value_swaption_long: before the expiry N·A·Bachelier(F, K, T_e − t, σ_n) on the path's own annuity and
        # forward swap rate; from the first grid date at or after the expiry, the swap delivered on the paths where it was
        # worth having at that date, and nothing on the others. The option's sign for the side that wrote it.
        o = eng["option"]; ie = o["i_exp"]; sg = "-" if o["sign"] < 0 else ""
        fut = [qd for qd in periods if qd["kind"] == "FIXED" and qd["tp"] > o["t_exp"] - 1e-9]
        B["VS"] = _block(ws, top, n, T, lambda q, j, r, c: value(q, j), "#,##0.00",
                         "VS: the swap delivered, on its own schedule (before the expiry the forward swap: the option's forward rate is read from it)")
        sb = B["VS"]; top = sb[1] + 3
        B["ANN"] = _block(ws, top, n, T, lambda q, j, r, c: ("=" + "+".join(f"Trade!$F${qd['row']}*{bond(q, j, qd['pay'])}" for qd in fut) if j < ie else None), "0.0000000000",
                          "A: the annuity on the path, Σ τ·P(t, payment) over the fixed leg; empty from the expiry")
        nb = B["ANN"]; top = nb[1] + 3
        side = "+" if o["is_payer"] else "-"
        B["FWD"] = _block(ws, top, n, T, lambda q, j, r, c: (f"=Kfix{side}{L(c)}{sb[0] + q}/(Notl*{L(c)}{nb[0] + q})" if j < ie else None), "0.0000000000",
                          "F: the forward rate of the swap delivered on the path, its floating leg over A, which is K + the payer swap's value/(N·A); empty from the expiry")
        fb = B["FWD"]; top = fb[1] + 3
        ins, oc = o.get("inside"), (vcells or {}).get("inside")
        if ins:
            # the expiry inside step i: the factor's state there, and the swap's value at it (ccr/options.exercised)
            i_s = ins["step"]; e0 = ins["rows"][0]
            B["XE"] = _block(ws, top, n, 1, lambda q, j, r, c: (f"={x(q, i_s - 1)}*{oc['dd']}+{oc['c']}*({x(q, i_s)}-{x(q, i_s - 1)}*{oc['dD']})"
                                                               f"+IF(Mode=\"ENGINE\",Normals!B{e0 + q},NORMSINV(RAND()))*SQRT({oc['var']})"), "0.000000000000",
                             f"x at the expiry, inside step {i_s}: between the two grid states either side (Option sheet), plus its own normal")
            eb = B["XE"]; top = eb[1] + 3
            B["FE"] = _block(ws, top, n, 1, lambda q, j, r, c: "=" + "".join(f"{'+' if sg_ > 0 else '-'}EXP({la}-{be}*B{eb[0] + q})" for sg_, la, be in vcells["terms"]), "0.000000000000",
                             "the payer swap delivered, per unit, at the expiry: Σ ±exp(ln|α| − β·x) over the Option sheet's terms. Its sign is the exercise")
            xb2 = B["FE"]; top = xb2[1] + 3

        def opt(q, j, r, c):
            if j >= ie:
                if ins:
                    return f"={sg}IF(B{xb2[0] + q}{'>' if o['is_payer'] else '<'}0,{L(c)}{sb[0] + q},0)"
                return f"={sg}IF({L(1 + ie)}{sb[0] + q}>0,{L(c)}{sb[0] + q},0)"
            sT = f"(SigN*SQRT(Texp-Model!$C${GRID_R0 + j}))"
            d = f"(({L(c)}{fb[0] + q}-Kfix)/{sT})"
            unit = f"{sT}*({d}*NORMSDIST({d})+EXP(-{d}^2/2)/SQRT(2*PI()))" + ("" if o["is_payer"] else f"-({L(c)}{fb[0] + q}-Kfix)")
            return f"={sg}Notl*{L(c)}{nb[0] + q}*({unit})"
        B["V"] = _block(ws, top, n, T, opt, "#,##0.00",
                        f"V: until the expiry N·A·Bachelier(F, K, T_e − t, σ_n), σ_n the model's own (Option sheet); from step {ie} the swap delivered where it was worth having at the expiry ("
                        + ("the sign of the block above" if o.get("inside") else f"VS at step {ie}, the expiry's own date") + "), nothing where it was not")
    else:
        B["V"] = _block(ws, top, n, T, lambda q, j, r, c: value(q, j), "#,##0.00",
                        "V: fixed coupons still to pay at their bonds; each floating period ended (its amount known), running (accrued so far over the bond to its end) or not begun")
    vb = B["V"]; top = vb[1] + 3

    def flow(q, j):
        out = []
        for qd in periods:
            if qd["step"] != j:
                continue
            s = "-" if qd["sign"] < 0 else "+"                   # a coupon we pay has left the set, one we receive has come into it
            out.append(f"{s}Notl*Kfix*Trade!$F${qd['row']}" if qd["kind"] == "FIXED" else f"{s}Notl*({L(2 + floats.index(qd))}{gb[0] + q}-1)")
        return "".join(out)

    if swaption:
        # the swap's coupons, on the paths that exercised, from the option's side (ccr.valuation.flows_per_step)
        took = (lambda q: f"B{xb2[0] + q}{'>' if o['is_payer'] else '<'}0") if ins else (lambda q: f"{L(1 + ie)}{sb[0] + q}>0")   # the exercise V reads
        B["PAID"] = _block(ws, top, n, T, lambda q, j, r, c: "=" + ("0" if j == 1 else f"{L(c - 1)}{r}")
                           + (f"+{sg}IF({took(q)},1,0)*(0{flow(q, j)})" if flow(q, j) else ""), "#,##0.00",
                           "PAID: the net cash the swap delivered has paid us by each date, on the paths that exercised: V + PAID is the value with its payments still in it")
    else:
        B["PAID"] = _block(ws, top, n, T, lambda q, j, r, c: "=" + ("0" if j == 1 else f"{L(c - 1)}{r}") + flow(q, j), "#,##0.00",
                           "PAID: the net cash the trade has paid us by each date (a coupon we paid is negative): V + PAID is the value with its payments still in it, which has no jump at a payment")
    top = B["PAID"][1] + 3
    B["W"] = _block(ws, top, n, T, lambda q, j, r, c: f"=(1/{L(c)}{ab[0] + q})/(SUMPRODUCT(1/{L(c)}${ab[0]}:{L(c)}${ab[1]})/Npaths)", "0.00000000",
                    "w: the path's discount factor over the paths' mean one, (1/A) / mean(1/A): what each path's discounting is over the curve's")
    B["value0"] = (f"={sg}Notl*{vcells['A0']}*{vcells['bach']}" if swaption else value(0, 0))     # a swaption today: N·A₀·Bachelier at σ_n, the model's price
    W.widths(ws, [10] + [13] * max(T, len(floats)))
    ws.freeze_panes = "B6"
    return B


def _exposure_sheet(wb, eng, B, nrows):
    T, n = eng["T"], eng["n"]; vb, pb, wb_ = B["V"], B["PAID"], B["W"]; n0 = nrows[0]
    ws = wb.create_sheet("Exposure")
    ws["A1"] = "THE CSA AND THE EXPOSURE"; ws["A1"].font = W.F_TITLE
    ws["A2"] = ("The value a margin period back (a Brownian bridge between grid dates, drawn on the value with its payments still in it and the payments then taken out: a coupon is "
                "not a market move), the collateral it calls, the residual, and EE / ENE / PFE per step, plain and discounted on each path. Choose a preset or set the terms."); ws["A2"].font = W.F_SUB
    rows = [("Preset", DEFAULT_PRESET, "@"), ("Collateralised (1/0)", '=IF(Preset="UNCOLLATERALISED",0,1)', "0"),
            ("Threshold, counterparty", 0.0, "#,##0"), ("Threshold, own", 0.0, "#,##0"), ("Minimum transfer amount", 0.0, "#,##0"),
            ("MPoR (business days)", f'=IF(Preset="ON_CHAIN",{MPOR_FLOOR_CLEARED_BD},{MPOR_FLOOR_BILATERAL_BD})', "0"),
            ("IM exchanged (1/0)", '=IF(Preset="UNCOLLATERALISED",0,1)', "0"), ("IM yield pickup (bp)", 0.0, "0.0"),
            ("δ = MPoR/250 (years)", f"=B9/{BUSINESS_DAYS_PER_YEAR}", "0.0000"), ("Steps back = δ/Δ (< 1 here)", "=B12/Dt", "0.0000"), ("w = 1 − δ/Δ", "=1-B13", "0.0000"),
            ("V(0): the trade's value today, on today's curve (the Paths sheet's formula at t = 0)", B["value0"], "#,##0.00"),
            ("IM confidence, one-tailed, each way (the engine's own estimate from these paths; not an industry margin model)", IM_CONFIDENCE / 100.0, "0.00"),
            ("IM₀ we call: the margin at the first date", "=K25", "#,##0.00"),
            ("A desk with its own figure types it on the ticket: that amount is then held for the life", "", "@"),
            ("IM₀ we post: the margin at the first date (the profile MVA funds)", "=N25", "#,##0.00"),
            ("VM carry, posted (bp over OIS: what the margin we post earns above cash)", 0.0, "0.0"), ("VM carry, received (bp over OIS: what the margin we hold earns above the rebate)", 0.0, "0.0")]
    for i, (label, v, fmt) in enumerate(rows, 4):
        ws.cell(row=i, column=1, value=label)
        c = ws.cell(row=i, column=2, value=v); c.number_format = fmt
        if i in (4, 6, 7, 8, 11, 20, 21):
            c.fill = W.FILL_IN
    W.dropdown(ws, "B4", list(PRESETS))
    _names(wb, {"Preset": "Exposure!B4", "Coll": "Exposure!B5", "THcp": "Exposure!B6", "THown": "Exposure!B7", "MTA": "Exposure!B8", "MPoR": "Exposure!B9",
                "IMx": "Exposure!B10", "Pickup": "Exposure!B11", "Wlag": "Exposure!B14", "V0": "Exposure!B15", "IMq": "Exposure!B16", "IM0": "Exposure!B19", "CarryPost": "Exposure!B20", "CarryRecv": "Exposure!B21"})
    rs = 24
    ws.cell(row=rs - 1, column=1, value="PER STEP").font = W.F_SECTION
    W.header(ws, rs, ["step", "t (grid date)", "s² = VARP(Δ whole)", "EE", "ENE", "PFE 95%", "EE gross", "ENE gross", "mean collateral", "mean residual", "IM we call (t)", "mean received", "mean posted",
                      "IM we post (t)", "EE on its path's discounting", "ENE on its path's discounting", "received, on its path's discounting", "posted, on its path's discounting"])
    V = lambda q, c: f"Paths!{L(c)}{vb[0] + q}"          # noqa: E731
    PAID = lambda q, c: f"Paths!{L(c)}{pb[0] + q}"       # noqa: E731
    whole = lambda q, c: f"({V(q, c)}+{PAID(q, c)})"     # noqa: E731
    top = rs + T + 3
    dvb = _block(ws, top, n, T, lambda q, j, r, c: (f"={whole(q, c)}-V0" if j == 1 else f"={whole(q, c)}-{whole(q, c - 1)}"), "#,##0",
                 "Δ whole: the step's change in the value with its payments still in it, (V + PAID)(t_k) − (V + PAID)(t_(k−1))")
    top = dvb[1] + 3
    lagb = _block(ws, top, n, T, lambda q, j, r, c: (f"=IF(Coll=1,{'V0' if j == 1 else whole(q, c - 1)}+Wlag*{L(c)}{dvb[0] + q}+IF(Mode=\"ENGINE\",Normals!{L(c)}{n0 + q},NORMSINV(RAND()))*SQRT(Wlag*(1-Wlag)*$C${rs + j})-{PAID(q, c)},{V(q, c)})"),
                  "#,##0", "V(t − δ): lo + w·Δ + N·√(w(1−w)·s²) on the whole value (the Brownian bridge; LIVE mode re-rolls N too), less the cash paid by t")
    top = lagb[1] + 3
    mvb = _block(ws, top, n, T, lambda q, j, r, c: f"={V(q, c)}-{L(c)}{lagb[0] + q}", "#,##0",
                 "Move over the margin period: V(t) − V(t − δ). Initial margin is its 99th percentile rise (what we call) and fall (what we post), about its mean")
    top = mvb[1] + 3
    cb = _block(ws, top, n, T, lambda q, j, r, c: f"=IF(Coll=1,IF(ABS(MAX({L(c)}{lagb[0] + q}-THcp,0)-MAX(-{L(c)}{lagb[0] + q}-THown,0))<MTA,0,MAX({L(c)}{lagb[0] + q}-THcp,0)-MAX(-{L(c)}{lagb[0] + q}-THown,0)),0)",
                "#,##0", "C: collateral held against the lagged value, our side (+ = we hold theirs)")
    top = cb[1] + 3
    resb = _block(ws, top, n, T, lambda q, j, r, c: f"={V(q, c)}-{L(c)}{cb[0] + q}", "#,##0", "Residual: V − C")
    for j in range(1, T + 1):
        r = rs + j; col = L(1 + j)
        ws.cell(row=r, column=1, value=j)
        ws.cell(row=r, column=2, value=f"=Model!C{GRID_R0 + j}").number_format = "0.0000"
        ws.cell(row=r, column=3, value=f"=VARP({col}{dvb[0]}:{col}{dvb[1]})").number_format = "#,##0"
        res = f"{col}{resb[0]}:{col}{resb[1]}"; vcol = f"Paths!{col}{vb[0]}:{col}{vb[1]}"; ccol = f"{col}{cb[0]}:{col}{cb[1]}"; wcol = f"Paths!{col}{wb_[0]}:{col}{wb_[1]}"
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
        # the same exposures, each path's weighted by its own discounting over the curve's: E[D(t)·V⁺] / P(0,t)
        ws.cell(row=r, column=15, value=f"=SUMPRODUCT(({res}-K{r}>0)*({res}-K{r})*{wcol})/Npaths").number_format = "#,##0.00"
        ws.cell(row=r, column=16, value=f"=SUMPRODUCT(({res}+N{r}<0)*({res}+N{r})*{wcol})/Npaths").number_format = "#,##0.00"
        ws.cell(row=r, column=17, value=f"=SUMPRODUCT(({ccol}>0)*{ccol}*{wcol})/Npaths").number_format = "#,##0.00"
        ws.cell(row=r, column=18, value=f"=-SUMPRODUCT(({ccol}<0)*{ccol}*{wcol})/Npaths").number_format = "#,##0.00"
    W.widths(ws, [40, 12, 16, 14, 14, 14, 14, 14, 16, 16, 14, 14, 14, 14, 22, 22, 24, 24] + [12] * max(T - 17, 0))
    ws.freeze_panes = "B5"
    return rs, {"DV": dvb, "LAG": lagb, "MV": mvb, "C": cb, "RES": resb}


def _waterfall_sheet(wb, eng, rs):
    T = eng["T"]
    ws = wb.create_sheet("Waterfall")
    ws["A1"] = "THE WATERFALL"; ws["A1"].font = W.F_TITLE
    ws["A2"] = ("Per step: survival from the credit triangle, then CVA and DVA (a party's default in the step, counted while the other survives to the middle of it), FCA on the funding "
                "spread and FBA on the funding basis, all four on the exposure discounted on its own path (E[D(t)·V⁺], not P(0,t)·E[V⁺]); then capital (SA-CCR) and margin, which read "
                "expected amounts on today's curve. The waterfall counts time in equal steps of Δ, the grid's mean step."); ws["A2"].font = W.F_SUB
    params = [("Counterparty CDS (bp)", 85.0), ("Own CDS (bp)", 42.0), ("LGD", 0.40), ("Own LGD", 0.40), ("Funding spread ftp (bp)", 55.0), ("Funding basis (bp) = max(funding spread − own CDS, 0): the benefit is charged on this", "=MAX(FTP-CDSown,0)"),
              ("Hurdle rate", 0.12), ("Capital model (SA_CCR / CEM / IMM)", "SA_CCR"), ("Counterparty risk weight", 1.0), ("Wrong-way multiplier", 1.0),
              ("SA-CCR α", ALPHA), ("Supervisory factor, rates", SF_IR), ("Capital ratio", CAP_R)]
    for i, (label, v) in enumerate(params, 4):
        ws.cell(row=i, column=1, value=label); c = ws.cell(row=i, column=2, value=v); c.fill = W.FILL_IN
        c.number_format = "0.00%" if label in ("LGD", "Own LGD", "Hurdle rate", "Counterparty risk weight") else "0.00##"
    W.dropdown(ws, "B11", ["SA_CCR", "CEM", "IMM"])
    ws["B9"].fill = PatternFill(fill_type=None)
    _names(wb, {"CDScp": "Waterfall!B4", "CDSown": "Waterfall!B5", "LGDcp": "Waterfall!B6", "LGDown": "Waterfall!B7", "FTP": "Waterfall!B8", "FBasis": "Waterfall!B9",
                "Hurdle": "Waterfall!B10", "CapModel": "Waterfall!B11", "RWcp": "Waterfall!B12", "WWR": "Waterfall!B13", "AlphaSA": "Waterfall!B14", "SFir": "Waterfall!B15", "CapR": "Waterfall!B16"})
    r0 = 20
    hdr = ["step", "t = step·Δ", "P(0, grid date)", "Q_cp(t)", "ΔQ_cp", "Q_own(t)", "ΔQ_own", "EE on its path's discounting", "ENE on its path's discounting", "CVA_i", "DVA_i", "FCA_i", "FBA_i", "m = M − t + Δ/2", "SD(m)", "MF", "add-on", "NICA", "RC",
           "multiplier", "EAD", "K", "KVA_i", "IM we post (t)", "MVA_i", "MF unmargined", "add-on unmargined", "RC unmargined", "multiplier unmargined", "EAD unmargined", "ColVA_i", "EE (plain, for an IMM EAD)"]
    W.header(ws, r0 - 1, hdr)
    for j in range(1, T + 1):
        r = r0 + j - 1; e = rs + j
        ws.cell(row=r, column=1, value=j)
        ws.cell(row=r, column=2, value=f"=A{r}*Dt").number_format = "0.0000"
        ws.cell(row=r, column=3, value=f"=Model!E{GRID_R0 + j}").number_format = "0.000000"
        ws.cell(row=r, column=4, value=f"=EXP(-(CDScp/10000/LGDcp)*B{r})").number_format = "0.000000"
        ws.cell(row=r, column=5, value=(f"=1-D{r}" if j == 1 else f"=D{r - 1}-D{r}")).number_format = "0.000000"
        ws.cell(row=r, column=6, value=f"=EXP(-(CDSown/10000/LGDown)*B{r})").number_format = "0.000000"
        ws.cell(row=r, column=7, value=(f"=1-F{r}" if j == 1 else f"=F{r - 1}-F{r}")).number_format = "0.000000"
        ws.cell(row=r, column=8, value=f"=Exposure!O{e}").number_format = "#,##0.00"
        ws.cell(row=r, column=9, value=f"=Exposure!P{e}").number_format = "#,##0.00"
        ws.cell(row=r, column=10, value=f"=LGDcp*H{r}*E{r}*(F{r}+G{r}/2)*C{r}*WWR").number_format = "#,##0.00"
        ws.cell(row=r, column=11, value=f"=LGDown*ABS(I{r})*G{r}*(D{r}+E{r}/2)*C{r}").number_format = "#,##0.00"
        alive = f"(0.5*((D{r}+E{r})*(F{r}+G{r})+D{r}*F{r}))"
        ws.cell(row=r, column=12, value=f"=FTP/10000*H{r}*{alive}*Dt*C{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=13, value=f"=FBasis/10000*ABS(I{r})*{alive}*Dt*C{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=14, value=f"=MAX(Mat-B{r}+Dt/2,0)").number_format = "0.0000"
        ws.cell(row=r, column=15, value=f"=(1-EXP(-0.05*N{r}))/0.05").number_format = "0.0000"
        ws.cell(row=r, column=16, value=f"=IF(Coll=1,1.5*SQRT(MAX(MPoR,IF(Preset=\"ON_CHAIN\",{MPOR_FLOOR_CLEARED_BD},{MPOR_FLOOR_BILATERAL_BD}))/{BUSINESS_DAYS_PER_YEAR}),SQRT(MIN(MAX(N{r},1/25),1)))").number_format = "0.0000"
        ws.cell(row=r, column=17, value=f"=SFir*Notl*O{r}*P{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=18, value=f"=IF(Coll=1,Exposure!K{e},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=19, value=f"=IF(Coll=1,MAX(Exposure!J{e},THcp+MTA-R{r},0),MAX(Exposure!J{e},0))").number_format = "#,##0.00"
        ws.cell(row=r, column=20, value=f"=IF(Q{r}>0,MIN(1,0.05+0.95*EXP(MIN((Exposure!J{e}-R{r})/(1.9*Q{r}),50))),1)").number_format = "0.0000"
        ws.cell(row=r, column=21, value=f"=IF(CapModel=\"IMM\",AlphaSA*AF{r},IF(CapModel=\"CEM\",S{r}+SFir*Notl*P{r},IF(Coll=1,MIN(AlphaSA*(S{r}+T{r}*Q{r}),AD{r}),AlphaSA*(S{r}+T{r}*Q{r}))))").number_format = "#,##0.00"
        ws.cell(row=r, column=22, value=f"=CapR*RWcp*U{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=23, value=f"=IF(N{r}>0,Hurdle*V{r}*Dt*C{r},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=24, value=f"=Exposure!N{e}").number_format = "#,##0.00"
        ws.cell(row=r, column=25, value=f"=IF(N{r}>0,X{r}*MAX(FTP/10000-Pickup/10000,0)*Dt*C{r},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=26, value=f"=SQRT(MIN(MAX(N{r},0.04),1))").number_format = "0.0000"
        ws.cell(row=r, column=27, value=f"=SFir*Notl*O{r}*Z{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=28, value=f"=MAX(Exposure!J{e}-R{r},0)").number_format = "#,##0.00"
        ws.cell(row=r, column=29, value=f"=IF(AA{r}>0,MIN(1,0.05+0.95*EXP(MIN((Exposure!J{e}-R{r})/(1.9*AA{r}),50))),1)").number_format = "0.0000"
        ws.cell(row=r, column=30, value=f"=AlphaSA*(AB{r}+AC{r}*AA{r})").number_format = "#,##0.00"
        ws.cell(row=r, column=31, value=f"=(Exposure!R{e}*CarryPost/10000+Exposure!Q{e}*CarryRecv/10000)*Dt*C{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=32, value=f"=Exposure!D{e}").number_format = "#,##0.00"
    r1 = r0 + T - 1
    rt = r1 + 2
    totals = [("CVA", f"=-SUM(J{r0}:J{r1})"), ("DVA", f"=SUM(K{r0}:K{r1})"), ("FCA", f"=-SUM(L{r0}:L{r1})"), ("FBA", f"=SUM(M{r0}:M{r1})"),
              ("KVA", f"=-SUM(W{r0}:W{r1})"), ("MVA", f"=-SUM(Y{r0}:Y{r1})"), ("ColVA", f"=SUM(AE{r0}:AE{r1})"), ("XVA total", f"=SUM(B{rt}:B{rt + 6})"),
              ("EAD over the first step", f"=U{r0}"), ("Capital over the first step", f"=V{r0}"), ("IM₀", "=IM0"), ("Peak EE", f"=MAX(Exposure!D{rs + 1}:D{rs + T})"), ("Peak PFE", f"=MAX(Exposure!F{rs + 1}:F{rs + T})")]
    for i, (label, f) in enumerate(totals):
        ws.cell(row=rt + i, column=1, value=label).font = Font(bold=True)
        ws.cell(row=rt + i, column=2, value=f).number_format = "#,##0.00"
    W.widths(ws, [34, 11, 14, 10, 10, 10, 10, 24, 24, 11, 11, 11, 11, 14, 9, 8, 12, 12, 12, 10, 13, 12, 11, 12, 11, 14, 16, 14, 18, 16, 11, 24])
    ws.freeze_panes = "C20"
    return r0, r1, rt


def _engine_sheet(wb, eng, rs, rt, fit):
    T = eng["T"]
    ws = wb.create_sheet("Engine")
    ws["A1"] = "WHAT THE ENGINE COMPUTED ON THE SAME DRAWS"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "pricing/xva_engine.run_waterfall under each CSA preset, written at export. The 'selected' column follows the preset chosen on the Exposure sheet and feeds the Checks."; ws["A2"].font = W.F_SUB
    W.header(ws, 4, ["Metric"] + list(PRESETS) + ["selected"])
    metrics = [("CVA", "cva"), ("DVA", "dva"), ("FCA", "fca"), ("FBA", "fba"), ("KVA", "kva"), ("MVA", "mva"), ("ColVA", "colva"), ("XVA total", "xva_total"),
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


def _engine_paths(wb, eng, B):
    """The engine's own path figures beside the sheet's, so a difference is found where it starts and not at the charges."""
    ws = wb["Engine"]
    T = eng["T"]
    r = ws.max_row + 3
    ws.cell(row=r, column=1, value="ON THE PATHS: the engine's own figures (values) against the Paths sheet").font = W.F_SECTION; r += 1
    W.header(ws, r, ["Figure", "engine"]); r += 1
    last = L(1 + T); mid = max(1, T // 2); midc = L(1 + mid)
    rows = [("V(0), the value today", float(eng["v0"]), "Exposure!B15"),
            (f"x on path 1 at step {T}", float(eng["x"][0, T]), f"Paths!{last}{B['X'][0]}"),
            (f"the account on path 1 at step {T}", float(eng["A"][0, T]), f"Paths!{last}{B['ACC'][0]}"),
            (f"V on path 1 at step {mid}", float(eng["V"][0, mid]), f"Paths!{midc}{B['V'][0]}"),
            (f"V on path 2 at step {T - 1}", float(eng["V"][1, T - 1]), f"Paths!{L(T)}{B['V'][0] + 1}"),
            (f"mean V at step {mid}", float(eng["V"][:, mid].mean()), None),
            (f"the net cash path 1 has been paid by step {T}", float(eng["paid"][0, T - 1]), f"Paths!{last}{B['PAID'][0]}"),
            (f"the discounting weight on path 1 at step {T}", float(eng["w"][0, T - 1]), f"Paths!{last}{B['W'][0]}"),
            (f"the discounting weight on path 2 at step {mid}", float(eng["w"][1, mid - 1]), f"Paths!{midc}{B['W'][0] + 1}")]
    if eng.get("product") in CAP_LIKE:
        # the model's variance, where the option's value starts: the first period seen today, the last seen from half-way
        from ccr import options as O
        strip0 = eng["item"]["caplets"][0]
        caps = strip0["periods"]
        yrs = lambda d: (d - eng["p"].grid[0]).days / 365.25
        for f, i in ((0, 0), (len(caps) - 1, mid)):
            ps, pe = caps[f][0], caps[f][1]
            rows.append((f"√variance of ln G, period {f + 1}, seen from grid date {i}",
                         math.sqrt(O.growth_variance(eng["p"], eng["key"], i, max(yrs(ps), float(eng["p"].t[i])), yrs(pe))), B["VAR"][f][i]))
        # the last period of each strip on path 1, half-way: the caplet of a cap, the floorlet of a floor, both of a collar
        for n_, strip in enumerate(eng["item"]["caplets"]):
            last_ = strip["periods"][-1]
            rows.append((f"U (the {'caplet' if strip['type'] == 'CAP' else 'floorlet'} per unit) of the last period on path 1 at step {mid}", float(O.black_on_growth(
                (O.bond(eng["p"], eng["key"], mid, yrs(last_[0])) / O.bond(eng["p"], eng["key"], mid, yrs(last_[1])))[:1], 1.0 + last_[3] * strip["K"],
                math.sqrt(O.growth_variance(eng["p"], eng["key"], mid, yrs(last_[0]), yrs(last_[1]))), strip["type"] == "CAP")[0]),
                f"Paths!{midc}{B['U'][(n_ + 1) * len(caps) - 1][0]}"))
    if eng.get("product") == "swaption":
        # where the option's value comes from: the annuity and the forward swap rate on a path before the expiry, the
        # swap delivered at the expiry (its sign is the exercise) and after it, on a path that exercised and one that did not
        from ccr import options as O
        from ccr.valuation import years as _yrs
        o = eng["option"]; ie = o["i_exp"]; h = max(1, ie // 2); hc = L(1 + h); val_ = eng["p"].grid[0]
        bd = lambda i, d: O.bond(eng["p"], eng["key"], i, _yrs(val_, d))
        ann = sum(tau * bd(h, pay) for pay, tau in o["future"])
        Ph = lambda Ty: O.bond(eng["p"], eng["key"], h, Ty)
        fwd = O._sum_of_bond_products(o["flows"]["floating"], Ph) / ann
        took = o["took"]
        if o.get("inside"):
            rows += [(f"x at the expiry on path 1 (inside step {o['inside']['step']})", float(o["inside"]["x_e"][0]), f"Paths!B{B['XE'][0]}"),
                     ("x at the expiry on path 2", float(o["inside"]["x_e"][1]), f"Paths!B{B['XE'][0] + 1}")]
        rows += [(f"the annuity on path 1 at step {h}", float(ann[0]), f"Paths!{hc}{B['ANN'][0]}"),
                 (f"the forward swap rate on path 1 at step {h}", float(fwd[0]), f"Paths!{hc}{B['FWD'][0]}"),
                 (f"the option on path 2 at step {h}", float(eng["V"][1, h]), f"Paths!{hc}{B['V'][0] + 1}")]
        # a path that exercised and one that did not, where the run has each (a strike far from the curve has only one kind)
        for kind, mask in (("exercised", took), ("not exercised", ~took)):
            if not mask.any():
                continue
            q_ = int(np.argmax(mask))
            rows += [(f"the swap delivered on path {q_ + 1} at the expiry step {ie} ({kind})", float(o["swap"][q_, ie]), f"Paths!{L(1 + ie)}{B['VS'][0] + q_}"),
                     (f"V on path {q_ + 1} at step {T - 1} ({kind})", float(eng["V"][q_, T - 1]), f"Paths!{L(T)}{B['V'][0] + q_}")]
            if kind == "exercised":
                rows.append((f"the net cash path {q_ + 1} has been paid by step {T}", float(eng["paid"][q_, T - 1]), f"Paths!{last}{B['PAID'][0] + q_}"))
    for label, v, ref in rows:
        ws.cell(row=r, column=1, value=label)
        c = ws.cell(row=r, column=2, value=v); c.fill = W.FILL_RJ; c.number_format = "#,##0.00000000"
        if ref is None:
            ref = f"Engine!C{r}"
            ws.cell(row=r, column=3, value=f"=AVERAGE(Paths!{midc}{B['V'][0]}:{midc}{B['V'][1]})").number_format = "#,##0.00"
        W.check(wb, "Paths", label, ref, f"Engine!B{r}", 1e-8)
        r += 1


def _convergence_sheet(wb, eng, blocks_exp, rs):
    T, n = eng["T"], eng["n"]; step = max(1, T // 2); res = blocks_exp["RES"]
    ws = wb.create_sheet("Convergence")
    ws["A1"] = f"MONTE CARLO CONVERGENCE · EE AT STEP {step}"; ws["A1"].font = W.F_TITLE
    ws["A2"] = "The running mean of the residual exposure over the first k paths, its standard error, and the engine's figure. In LIVE mode this is the error you are reading."; ws["A2"].font = W.F_SUB
    ws["A4"] = "Step"; ws["B4"] = step
    ws["A5"] = "Engine EE at this step (selected preset)"; ws["B5"] = f"=Exposure!D{rs + step}"; ws["B5"].number_format = "#,##0.00"
    W.header(ws, 7, ["k (paths)", "E⁺ on path k", "running mean", "standard error", "mean − 2·SE", "mean + 2·SE", "engine (sheet, selected)"])
    col = L(1 + step)
    for q in range(n):
        r = 8 + q
        ws.cell(row=r, column=1, value=q + 1)
        ws.cell(row=r, column=2, value=f"=MAX(Exposure!{col}{res[0] + q}-Exposure!$K${rs + step},0)").number_format = "#,##0"
        ws.cell(row=r, column=3, value=f"=AVERAGE($B$8:B{r})").number_format = "#,##0"
        ws.cell(row=r, column=4, value=(f"=IF(A{r}>1,STDEV($B$8:B{r})/SQRT(A{r}),0)")).number_format = "#,##0"
        ws.cell(row=r, column=5, value=f"=C{r}-2*D{r}").number_format = "#,##0"
        ws.cell(row=r, column=6, value=f"=C{r}+2*D{r}").number_format = "#,##0"
        ws.cell(row=r, column=7, value="=$B$5").number_format = "#,##0"
    W.scenario(wb, "Convergence", (1, 8, 7 + n), [("running mean", (3, 8, 7 + n)), ("mean − 2·SE", (5, 8, 7 + n)), ("mean + 2·SE", (6, 8, 7 + n)), ("engine", (7, 8, 7 + n))],
               f"EE at step {step}: running mean against path count", "paths", "USD")
    W.widths(ws, [12, 16, 16, 16, 16, 16, 22])
    ws.freeze_panes = "A8"


def xva_cap_workbook(mkt, n_paths: int = N_PATHS):
    """The cap's book (0.60.0): the same sheets as the swap's, with the cap's periods valued on the paths."""
    return xva_rates_workbook(mkt, n_paths, product="cap")


def xva_swaption_workbook(mkt, n_paths: int = N_PATHS):
    """The swaption's book (0.62.0): an option until its expiry, the swap it delivers after, on the paths that exercised."""
    return xva_rates_workbook(mkt, n_paths, product="swaption")


def xva_floor_workbook(mkt, n_paths: int = N_PATHS):
    """The floor's book (0.62.0): the cap's, with each period the put on the growth."""
    return xva_rates_workbook(mkt, n_paths, product="floor")


def xva_collar_workbook(mkt, n_paths: int = N_PATHS):
    """The collar's book (0.62.0): the cap held and the floor written on the same periods, so a written option is on the paths."""
    return xva_rates_workbook(mkt, n_paths, product="collar")


def xva_rates_workbook(mkt, n_paths: int = N_PATHS, product: str = "swap"):
    from methodology.replicate import _curve_sheet, _readme
    cap = product in CAP_LIKE
    swn = product == "swaption"
    word = OPTION_WORD.get(product, "swap")
    ks = strikes_of(product) if cap else {}
    trade_words = {"cap": f"a bought cap struck at {FIXED_RATE:.3%}", "floor": f"a bought floor struck at {FIXED_RATE:.3%}",
                   "collar": f"a collar, the cap bought at {ks.get('CAP', 0):.3%} and the floor sold at {ks.get('FLOOR', 0):.3%},"}.get(product, "")
    fit = hw1f_fit(mkt)
    eng = engine_runs(mkt, fit, n_paths, product)
    T = eng["T"]
    wb = Workbook()
    _readme(wb, f"XVA on a {word}: each period valued on Hull-White paths, CSA, waterfall" if cap
            else "XVA on a swaption: an option until its expiry, the swap it delivers after, on Hull-White paths, CSA, waterfall" if swn
            else "XVA on a swap: the trade's own schedule on Hull-White paths, CSA, waterfall", [
        (f"Default trade: {trade_words} on USD {NOTIONAL:,.0f} for {TENOR_YEARS} years from spot, quarterly, as the {word} ticket books it; "
         if cap else
         f"Default trade: a bought payer swaption on USD {NOTIONAL:,.0f}, expiring in {SWAPTION_EXPIRY_MONTHS // 12} year into a {SWAPTION_TENOR_YEARS}-year swap paying {FIXED_RATE:.3%}, "
         "both legs yearly, as the swaption ticket books it; "
         if swn else
         f"Default trade: {'pay' if DIRECTION == 'PAY' else 'receive'} fixed {FIXED_RATE:.3%} on USD {NOTIONAL:,.0f} for {TENOR_YEARS} years from spot, both legs yearly, as a ticket books it; ") +
        f"a monthly grid from the valuation date, {n_paths} paths; the engine's own random draws on the Normals sheet.",
        (f"This is the run of a {word} ticket's XVA tab: each period valued on every path at every date by Black's formula on what one unit grows to over the period "
         "(a cap's period the call, a floor's the put), at the variance the paths' own model gives that growth (the Variance sheet), and CVA, DVA, FCA and FBA on the exposure "
         f"discounted on its own path. The {word} is valued at the model's variance, not at the vol the ticket prices it at: the value today on the Exposure sheet is the model's, "
         "and differs from the ticket's price by that."
         + (" The floor is written: its periods count against us, so the set's value can be negative and DVA and FBA are not nil as they are for a bought option." if product == "collar" else "")
         if cap else
         "This is the run of a swaption ticket's XVA tab. Until the expiry the trade is the option: on every path, the annuity and the forward swap rate the path's own bonds give, "
         "in Bachelier's formula at the normal vol the paths' own model implies for this swaption (the Option sheet rebuilds it from the model's exact price). At the first grid date "
         "on or after the expiry the swap is delivered on the paths where it is worth having and the trade is that swap from there, on its own schedule; on the other paths it is "
         "nothing. The option is valued at the model's vol, not at the market's quote the ticket prices it at: the value today on the Exposure sheet is the model's own price."
         if swn else
         "This is the run of a rates ticket's XVA tab: the trade's own legs valued on every path at every date (each fixed coupon at its bond, each floating period with its accrued "
         "interest), and CVA, DVA, FCA and FBA on the exposure discounted on its own path."),
        "Model: Hull-White one factor, a and σ calibrated to the swaption surface (Calibration sheet); every bond on a path reprices today's curve in expectation.",
        "ENGINE mode (Model sheet) reproduces the engine to rounding: the Checks sheet compares the value today, figures on single paths, every EE, ENE and PFE and every XVA. LIVE mode "
        "re-rolls the normals with NORMSINV(RAND()) on each recalculation; the Convergence sheet shows the Monte Carlo error and the Checks read LIVE instead of PASS. Switch Excel to "
        "manual calculation before going LIVE.",
        "CSA: a preset (UNCOLLATERALISED, BILATERAL with a 10-day margin period, ON_CHAIN with a 5-day one) or your own thresholds and MTA; the Engine sheet holds the engine's run under each preset.",
        "The ticket's own run takes the ticket's trade, credit spreads and funding spread; this book takes the trade above and the defaults on the Waterfall sheet, which you can type over. "
        "The margin period here is shorter than a grid step, as in both presets.",
    ], mkt, summary=[("Model", f"HW1F a = {fit['a']:.4f}, σ = {fit['sigma_bp']:.1f}bp ({fit['source']})"), ("Paths", f"{n_paths} on {T} monthly dates")])
    _curve_sheet(wb, mkt)
    _model_sheet(wb, mkt, fit, eng)
    periods, dates, idx, dr0 = _trade_sheet(wb, eng)
    cal = _calibration_sheet(wb, mkt, fit)
    rB, rA = _bonds_sheet(wb, eng, dates, dr0)
    wf_noise = eng["runs"]["BILATERAL"][1].bridge_noise
    zrows, nrows = _normals_sheet(wb, eng, wf_noise)
    vcells = _variance_sheet(wb, eng, periods) if cap else (_option_sheet(wb, eng, periods, idx, dr0) if swn else None)
    B = _paths_sheet(wb, eng, periods, dates, idx, dr0, rB, rA, zrows, vcells)
    B["VAR"] = vcells
    rs, blocks_exp = _exposure_sheet(wb, eng, B, nrows)
    r0, r1, rt = _waterfall_sheet(wb, eng, rs)
    _engine_sheet(wb, eng, rs, rt, fit)
    _engine_paths(wb, eng, B)
    _convergence_sheet(wb, eng, blocks_exp, rs)
    W.live(wb, "Mode")
    W.ticket(wb, f"XVA of the workbook's {word}, each period valued on the paths as a {word} ticket's XVA tab values it" if cap
             else "XVA of the workbook's swaption: an option until its expiry, the swap delivered after, as a swaption ticket's XVA tab values it" if swn else "XVA of the workbook's swap, valued on its own schedule as a ticket's XVA tab values it", [
        ("CVA", f"Waterfall!B{rt}", "#,##0.00", "cost"), ("DVA", f"Waterfall!B{rt + 1}", "#,##0.00", "benefit"), ("FCA", f"Waterfall!B{rt + 2}", "#,##0.00", "funding cost"),
        ("FBA", f"Waterfall!B{rt + 3}", "#,##0.00", ""), ("KVA", f"Waterfall!B{rt + 4}", "#,##0.00", ""), ("MVA", f"Waterfall!B{rt + 5}", "#,##0.00", ""),
        ("ColVA", f"Waterfall!B{rt + 6}", "#,##0.00", "carry of the variation margin; zero for cash"),
        ("XVA TOTAL", f"Waterfall!B{rt + 7}", "#,##0.00", "all-in = NPV + XVA on the ticket"),
        ("EAD₀ / CAPITAL₀", f"Waterfall!B{rt + 8}", "#,##0.00", "SA-CCR at t = 0; capital on the next row"),
        ("IM₀", f"Waterfall!B{rt + 10}", "#,##0.00", "the margin we post at the first date: the engine's own estimate, not an industry margin model"),
        ("PEAK EE", f"Waterfall!B{rt + 11}", "#,##0.00", ""), ("PEAK PFE 95%", f"Waterfall!B{rt + 12}", "#,##0.00", "")])
    W.ticket(wb, "MODEL AND CSA", [("a", "Model!B4", "0.0000", "mean reversion"), ("σ", "Model!B5", "0.0000%", "short-rate vol"), ("RMSE OF THE FIT", f"Calibration!B{cal['rs'] + 1}", "0.00", "bp"),
                                   ("CSA PRESET", "Exposure!B4", "@", ""), ("MPoR", "Exposure!B9", "0", "business days"), ("MODE", "Model!B11", "@", "ENGINE or LIVE")])
    xb, vb = B["X"], B["V"]
    for sym, notn, ref, note, fmt in [
        ("the grid", "valuation date + k months; t = days/365.25; Δ_k = t_k − t_(k−1)", f"Model!C{GRID_R0 + 1}", "the first date's time", "0.000000"),
        ("x step", "x(t_k) = x(t_(k−1))·e^(−aΔ_k) + σ√((1−e^(−2aΔ_k))/2a)·Z", f"Paths!B{xb[0]}", "path 1, step 1", "0.00000000"),
        ("φ(t)", "σ²/2a²·(1 − e^(−at))²: what the mean of the short rate sits above the forward by", f"Model!H{GRID_R0 + 1}", "", "0.0000000000"),
        ("B(t,T)", "(1 − e^(−a(T−t)))/a", f"Bonds!B{rB}", "today, to the first grid date", "0.00000000"),
        ("ln A(t,T)", "ln(P(0,T)/P(0,t)) − B·φ(t) − σ²/4a·B²·(1 − e^(−2at))", f"Bonds!B{rA}", "so that P(t,T) = exp(ln A − B·x)", "0.0000000000"),
        ("the account", "A(t_k) = A(t_(k−1)) / P(t_(k−1), t_k): cash rolled at each step's own bond", f"Paths!B{B['ACC'][0]}", "path 1, step 1", "0.00000000"),
        ("growth of a period" if cap else "growth of a floating period", "from its start to the next grid date at the bond seen on the grid date before, then along the account, then over the bond to its end", f"Paths!B{B['GROW'][0]}", "path 1, the first period", "0.0000000000"),
        *([("√variance of ln G", "√(Σ_(k>i) σ²/2a·(1 − e^(−2a(t_k − t_i)))·w_k·(w_k + 2·S_k)): the model's own, seen from grid date i", B["VAR"][0][0].replace("$", ""), "the first period, seen today", "0.0000000000"),
           ("M", "G(start, t)/P(t, end) while the period runs; P(t, start)/P(t, end) before it begins", f"Paths!B{B['M'][0][0]}", "path 1, step 1, the first period", "0.0000000000"),
           (("U", "X·Φ(v − d₁) − M·Φ(−d₁), d₁ = (ln(M/X) + v²/2)/v, X = 1 + τK; max(X − G, 0) once the period has ended", f"Paths!B{B['U'][0][0]}", "the floorlet per unit, before discounting", "0.0000000000")
            if product == "floor" else
            ("U", "M·Φ(d₁) − X·Φ(d₁ − v), d₁ = (ln(M/X) + v²/2)/v, X = 1 + τK; max(G − X, 0) once the period has ended"
                  + ("; a floor's period the put, X·Φ(v − d₁) − M·Φ(−d₁)" if product == "collar" else ""), f"Paths!B{B['U'][0][0]}", "the caplet per unit, before discounting", "0.0000000000")),
           ("V", "Σ over the periods not yet paid of ±N·P(t, pay)·U: plus for an option held, minus for one written", f"Paths!B{vb[0]}", f"the {word}'s value on path 1 at step 1", "#,##0.00")]
          if cap else
          [("x*", "the factor level at the expiry where the swap delivered, as its cash flows Σ α·exp(−β·x), is worth nothing", "Option!B8", "the engine's root", "0.0000000000"),
           ("the model's price", "P(0,T_e)·Σ α·exp(β·φ + ½β²s²)·Φ((−φ − β·s² − x*)/s) over the swap's cash flows", vcells["bach"].replace("$", "").replace("Option!B", "Option!C"), "per unit of annuity", "0.000000000000"),
           ("σ_n", "the normal vol at which Bachelier on F₀ gives the model's price", vcells["sig"].replace("$", ""), "the paths' own, not the market's quote", "0.0000000000"),
           ("A", "Σ τ·P(t, payment) over the fixed leg, on the path", f"Paths!B{B['ANN'][0]}", "path 1, step 1", "0.0000000000"),
           ("F", "the swap delivered's floating leg over A, on the path: K + its value/(N·A)", f"Paths!B{B['FWD'][0]}", "path 1, step 1", "0.0000000000"),
           ("V before the expiry", "N·A·σ_n√(T_e − t)·[d·Φ(d) + φ(d)], d = (F − K)/(σ_n√(T_e − t))", f"Paths!B{vb[0]}", "the option on path 1 at step 1", "#,##0.00"),
           ("V from the expiry", "the swap delivered where it was worth having at the expiry (its own state when the expiry is inside a step), nothing where it was not", f"Paths!{L(1 + eng['option']['i_exp'])}{vb[0]}", "path 1 at the expiry step", "#,##0.00")]
          if swn else
          [("V", "−N·K·Σ τ·P(t, pay) on the fixed leg; per floating period N·(G − P(t, end)), or N·(G/P(t,end) − 1)·P(t, pay) where it pays after its end", f"Paths!B{vb[0]}", "the trade's value on path 1 at step 1", "#,##0.00")]),
        ("V(0)", "the same formula today: every bond is the curve's", "Exposure!B15", "", "#,##0.00"),
        ("w", "(1/A) / mean over the paths of (1/A): the path's discount factor over the curve's, mean one at every date", f"Paths!B{B['W'][0]}", "path 1, step 1", "0.00000000"),
        ("V(t−δ)", "lo + w·Δ + N·√(w(1−w)·VARP(Δ)) on V + PAID, less PAID", f"Exposure!B{blocks_exp['LAG'][0]}", "the Brownian bridge over the margin period; a coupon is not a move", "#,##0"),
        ("C", "max(V_lag − TH_cp, 0) − max(−V_lag − TH_own, 0), zeroed under the MTA", f"Exposure!B{blocks_exp['C'][0]}", "", "#,##0"),
        ("EE, ENE, PFE", "mean(max(V−C−IM,0)), mean(min(V−C+IM,0)), 95th percentile of V−C", f"Exposure!D{rs + 1}", "step 1", "#,##0.00"),
        ("EE on its path's discounting", "mean(max(V−C−IM,0)·w): times P(0,t) it is E[D(t)·V⁺(t)]", f"Exposure!O{rs + 1}", "step 1: what CVA and FCA read", "#,##0.00"),
        ("Q(t)", "exp(−s/LGD·t), t in equal steps of Δ", f"Waterfall!D{r0}", "the credit triangle", "0.000000"),
        ("CVA", "−LGD·Σ EE_w·ΔQ·Q_own(mid)·P(0,t)·WWR", f"Waterfall!B{rt}", "", "#,##0.00"), ("DVA", "+LGD_own·Σ |ENE_w|·ΔQ_own·Q_cp(mid)·P(0,t)", f"Waterfall!B{rt + 1}", "", "#,##0.00"),
        ("FCA, FBA (FVA is their sum)", "−Σ ftp·EE_w·S·Δ·P, +Σ max(ftp − s_own, 0)·|ENE_w|·S·Δ·P; S = both parties alive", f"Waterfall!B{rt + 2}", "", "#,##0.00"),
        ("EAD", "α·[RC + multiplier·add-on], add-on = SF·N·SD(m)·MF; a margined set capped at the same set unmargined (CRE52.2)", f"Waterfall!U{r0}", "SA-CCR, step 1", "#,##0.00"),
        ("KVA", "−hurdle·Σ 8%·RW·EAD·Δ·P", f"Waterfall!B{rt + 4}", "", "#,##0.00"), ("MVA", "−Σ IM(t)·max(ftp − pickup, 0)·Δ·P", f"Waterfall!B{rt + 5}", "", "#,##0.00"),
        ("ColVA", "Σ (VM posted·s_post + VM received·s_recv)·Δ·P on the path-discounted balances, the carries over OIS of what the margin is held in", f"Waterfall!B{rt + 6}", "zero for cash", "#,##0.00"),
        ("σ_n (calibration)", "σ·|dS/dr|·√(V(T_e)/T_e), dS/dr = B_M·P_M/A + S·w_dur", f"Calibration!{L(cal['cM'])}{cal['r0']}", "the model's ATM normal swaption vol, closed form", "0.00"),
    ]:
        W.derive(wb, sym, notn, ref, note, fmt)
    return wb, eng["runs"][DEFAULT_PRESET][1].xva_total

