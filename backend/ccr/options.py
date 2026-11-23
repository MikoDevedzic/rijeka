"""Options on the exposure paths: caplets and floorlets embedded in a swap leg, and
European swaptions, valued on every path at every grid point.

Model, stated plainly. The paths carry a Hull-White state per currency, so at grid point
t_i every bond P(t_i, T) is known on every path and so are the forward rates and forward
swap rates. An option that has not fixed yet is valued with Bachelier (normal) on the
path's own forward, with today's ATM normal vol held flat for its remaining life: the
vol does not move along the path, which is the usual simplification in exposure engines
and is said on the page. A caplet that has fixed pays max(f_fix − K, 0)·τ·N on its payment
date, f_fix read from the path at its fixing; a swaption past expiry is the underlying
swap on the paths where it was in the money at expiry (physical settlement) and nothing
elsewhere. Sign: we are long an option we bought (a cap on a leg we pay), short one we
sold. Vols: caplets use the cap vol table's ATM flat vol by cap tenor (85bp desk default when
there is none), and the item says which. A swaption before expiry is valued at the normal vol
the paths' own Hull-White model implies for it (hw_implied_vol), so the value before expiry and
the exercise at expiry are one model; the market {CCY}_SWVOL_ATM quote is reported beside it."""
from __future__ import annotations

import logging
import math
from datetime import date
from typing import Any, Optional

import numpy as np

from ccr.calibration import CURVE_OF
from ccr.simulate import Paths, bond, growth

log = logging.getLogger("rijeka.ccr")
DEFAULT_VOL_BP = 85.0
ON_POINT = 0.02            # swaption_vol_point: how near a grid point, in |ln expiry| + |ln tenor|, is "on" it
SWAPTIONS = ("IR_SWAPTION", "SWAPTION")
# a cap, a floor and a collar: one floating leg with no participation in the rate and the options on it (valued as
# that leg is: its caplets and floorlets, value_caplets)
CAPS = ("IR_CAP", "IR_FLOOR", "IR_COLLAR", "INTEREST_RATE_CAP", "INTEREST_RATE_FLOOR", "INTEREST_RATE_COLLAR")


def _years(asof: date, d: date) -> float:
    return (d - asof).days / 365.25


def bachelier(F: np.ndarray, K: float, T: float, sigma: float, call: bool) -> np.ndarray:
    """Normal option value per unit of annuity, vectorised over paths. T years, sigma decimal/yr."""
    F = np.asarray(F, dtype=float)
    if T <= 0 or sigma * math.sqrt(max(T, 0.0)) < 1e-12:
        return np.maximum(F - K, 0.0) if call else np.maximum(K - F, 0.0)
    sT = sigma * math.sqrt(T)
    d = (F - K) / sT
    from scipy.stats import norm
    c = sT * (d * norm.cdf(d) + norm.pdf(d))
    return c if call else c - (F - K)


# ── vols from the desk's market ──────────────────────────────────────────────
def _parse_axb(t: str) -> Optional[tuple[float, float]]:
    try:
        a, b = str(t).upper().replace(" ", "").split("X")
        return float(a.rstrip("Y")), float(b.rstrip("Y"))
    except Exception:              # noqa: BLE001
        return None


def swaption_vol_point(mkt, ccy: str, expiry_y: float, tenor_y: float) -> dict:
    """The ATM normal vol the desk's market gives a swaption of this expiry and tenor, and where it came from:
    {vol_bp, tier, point, source, asof}. The rule is the nearest point of the {CCY}_SWVOL_ATM grid, nearest in the
    log of the expiry plus the log of the tenor (a 3M expiry reads the 1Y row, a 10Y the 7Y: the grid's edges, flat).
    `tier`: QUOTED when the option sits on a grid point, NEAREST when it does not, DEFAULT when the currency has no
    surface and the desk's default stands in (85 bp). "On a point" is within ON_POINT of it in that distance, two
    per cent: a year by the calendar is 365 to 368 days over 365, and five years 1,826 or 1,827 over 1,825, so
    an exact comparison called a one-year option QUOTED on some trade dates and NEAREST on others for the same
    vol (the model validator's sweep, 18 November 2026). The vol is the point's either way; only the word differs. One rule for the ticket's default, the booked option's
    revaluation (pnl/valuation.py) and the reported market vol of the exposure run (ccr/valuation.py)."""
    cid = f"{ccy}_SWVOL_ATM"
    q = mkt.quotes(cid) if mkt is not None else None
    best, bd, at = None, None, None
    for x in q or []:
        p = _parse_axb(x.get("tenor")); r = x.get("rate")
        if p is None or r is None:
            continue
        d = abs(math.log(max(p[0], 1 / 12) / max(expiry_y, 1 / 12))) + abs(math.log(max(p[1], 0.25) / max(tenor_y, 0.25)))
        if bd is None or d < bd:
            best, bd, at = float(r), d, p
    if best is None:
        return {"vol_bp": DEFAULT_VOL_BP, "tier": "DEFAULT", "point": None, "asof": None,
                "source": "desk default (no ATM swaption surface)"}
    asof = None
    try:
        asof = mkt.snapshot_date(cid)
    except Exception:              # noqa: BLE001
        asof = None
    g = lambda v: f"{v:g}"         # noqa: E731
    return {"vol_bp": best, "tier": "QUOTED" if bd < ON_POINT else "NEAREST", "point": f"{g(at[0])}Yx{g(at[1])}Y",
            "asof": asof.isoformat() if asof is not None else None, "source": f"{ccy}_SWVOL_ATM nearest point"}


def swaption_vol_bp(mkt, ccy: str, expiry_y: float, tenor_y: float) -> tuple[float, str]:
    """Nearest ATM normal vol on the (expiry, tenor) grid of {CCY}_SWVOL_ATM, in bp (swaption_vol_point's)."""
    p = swaption_vol_point(mkt, ccy, expiry_y, tenor_y)
    return p["vol_bp"], p["source"]


def cap_vol_bp(db, uid: str, tenor_y: float) -> tuple[float, str]:
    """ATM flat vol for the nearest cap tenor from the cap vol table, in bp."""
    try:
        from sqlalchemy import text
        rows = db.execute(text("SELECT cap_tenor_y, flat_vol_bp FROM cap_vol_surface WHERE user_id = :u AND is_atm "
                               "AND valuation_date = (SELECT max(valuation_date) FROM cap_vol_surface WHERE user_id = :u AND is_atm)"), {"u": str(uid)}).all()
    except Exception as e:            # noqa: BLE001
        log.debug("cap vol lookup failed: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
        rows = []
    if not rows:
        return DEFAULT_VOL_BP, "desk default (no cap vol surface)"
    r = min(rows, key=lambda r: abs(float(r.cap_tenor_y) - tenor_y))
    return float(r.flat_vol_bp), f"cap vol surface {float(r.cap_tenor_y):g}Y ATM"


# ── embedded caps and floors on a swap leg ──────────────────────────────────
def caplets_of(leg: dict, sched: list, trade_direction_sign: float, vol_bp: float, vol_source: str) -> list[dict]:
    """The caplets/floorlets a float leg carries, from embedded_options (or the legacy cap_rate /
    floor_rate columns). Each: {type, K, sign, N, periods: [(start, end, pay, τ)]}."""
    out = []
    N = float(leg.get("notional") or 0.0)
    pays = str(leg.get("direction", "")).upper().startswith("PAY")
    entries = list(leg.get("embedded_options") or [])
    if not entries:
        if leg.get("cap_rate") is not None:
            entries.append({"type": "CAP", "default_strike": leg["cap_rate"]})
        if leg.get("floor_rate") is not None:
            entries.append({"type": "FLOOR", "default_strike": leg["floor_rate"]})
    for e in entries:
        kind = str(e.get("type", "")).upper()
        if kind not in ("CAP", "FLOOR"):
            continue
        K = e.get("default_strike")
        if K is None and e.get("strike_schedule"):
            K = (e["strike_schedule"][0] or {}).get("strike")
        if K is None:
            continue
        K = float(K)
        if K > 1.0:                      # percent on the wire
            K /= 100.0
        d = str(e.get("direction", "")).upper()
        # a cap on a leg we pay protects us (long); on a leg we receive it caps what we get (short)
        sign = 1.0 if d == "BUY" else -1.0 if d == "SELL" else (1.0 if pays else -1.0)
        out.append({"type": kind, "K": K, "sign": sign, "N": N, "periods": list(sched), "vol": vol_bp / 1e4, "vol_source": vol_source})
    return out


# A caplet on a compounded overnight rate pays N·max(G − 1 − τK, 0) after its period, G being what one unit placed at
# the period's start has grown to by its end. On the paths that growth is a product of the grid's own bonds
# (ccr.simulate.growth), each an exponential of the factor at its grid date, so the logarithm of G is a sum of the
# factor's values at grid dates and, seen from an earlier grid date, is normal. Its mean under the measure of the
# period's end is fixed by the bonds on the path; its variance is known in closed form. The caplet is therefore the
# Black formula on the growth factor, exact in the paths' own model: the value before a period, during it and at its
# end are one calculation, the value discounted along the path is a martingale, and expected exposure does not step
# when a period fixes. (Until 0.60.0 a caplet was Bachelier on the path's forward at the market's at-the-money cap vol
# until the period's START, and from then the payoff of that forward: a rate fixed in advance, where the product
# fixes in arrears, and a vol that was not the paths' own, so the value stepped at each fixing by the ratio of the two
# vols. A cap, a floor and a collar were not valued on the paths at all.)

def _growth_weights(paths: Paths, key: str, a_t: float, b_t: float) -> dict[int, float]:
    """ln G(a, b) = constant + Σ_k w_k·x_k over grid dates k: the weights, as ccr.simulate.growth builds the growth
    (from a to the next grid date and from the last grid date to b at the bond seen on the grid date before; whole
    steps on the account)."""
    f = paths.calib.factors[key]
    a = max(f.a, 1e-4)
    B = lambda tau: (1.0 - math.exp(-a * max(tau, 0.0))) / a
    t = paths.t
    last = len(t) - 1
    ja = min(int(np.searchsorted(t, a_t + 1e-12, side="right") - 1), last)
    jb = min(int(np.searchsorted(t, b_t + 1e-12, side="right") - 1), last)
    if ja == jb:
        return {ja: B(b_t - float(t[ja])) - B(a_t - float(t[ja]))}
    w = {ja: B(float(t[ja + 1]) - float(t[ja])) - B(a_t - float(t[ja]))}
    for k in range(ja + 1, jb):
        w[k] = B(float(t[k + 1]) - float(t[k]))
    if b_t > float(t[jb]) + 1e-12:
        w[jb] = w.get(jb, 0.0) + B(b_t - float(t[jb]))
    return w


def growth_variance(paths: Paths, key: str, i: int, a_t: float, b_t: float) -> float:
    """The variance of ln G(a, b), seen from grid date i (a ≥ t_i): Σ_j Σ_k w_j·w_k·Cov(x_j, x_k | x_i) over the grid
    dates after i, with Cov(x_j, x_k | x_i) = σ²/(2a)·e^(−a(t_k − t_j))·(1 − e^(−2a(t_j − t_i))) for i < j ≤ k: the factor
    is stepped exactly (ccr.simulate), so this is the model's own figure, not an approximation of it."""
    f = paths.calib.factors[key]
    a, sig = max(f.a, 1e-4), max(f.sigma, 1e-6)
    t = paths.t
    t_i = float(t[i])
    w = {k: v for k, v in _growth_weights(paths, key, a_t, b_t).items() if k > i}
    ks = sorted(w)
    var = 0.0
    for j in ks:
        vj = sig * sig / (2.0 * a) * (1.0 - math.exp(-2.0 * a * (float(t[j]) - t_i)))
        tail = sum(w[k] * math.exp(-a * (float(t[k]) - float(t[j]))) for k in ks if k > j)
        var += vj * w[j] * (w[j] + 2.0 * tail)
    return max(var, 0.0)


def black_on_growth(M: np.ndarray, X: float, v: float, call: bool) -> np.ndarray:
    """E[max(G − X, 0)] (a call) or E[max(X − G, 0)] for a lognormal G of mean M and log-variance v², per unit, on
    every path. With no variance left it is the payoff of M."""
    M = np.maximum(np.asarray(M, dtype=float), 1e-12)
    if v < 1e-10:
        return np.maximum(M - X, 0.0) if call else np.maximum(X - M, 0.0)
    from scipy.stats import norm
    d1 = (np.log(M / X) + 0.5 * v * v) / v
    d2 = d1 - v
    return M * norm.cdf(d1) - X * norm.cdf(d2) if call else X * norm.cdf(-d2) - M * norm.cdf(-d1)


def period_growth(paths: Paths, key: str, Ts: float, Te: float) -> np.ndarray:
    """What a unit grows to over a whole period, on every path: asked at every date after the period's end and again
    for what it pays, so it is worked out once for a path set and kept on it."""
    kept = paths.__dict__.setdefault("_period_growth", {})
    k = (key, round(Ts, 9), round(Te, 9))
    if k not in kept:
        kept[k] = growth(paths, key, Ts, Te)
    return kept[k]


def _caplet_periods(item: dict, paths: Paths, i: int):
    """Each period of each caplet strip still to be paid at grid date i: (strip, start, end, pay in years, τ, state),
    state 'ENDED' (its amount is known on the path, waiting for its payment date) or 'OPEN'."""
    asof = paths.grid[0]; t_i = float(paths.t[i])
    for c in item.get("caplets") or []:
        for (ps, pe, pay, tau) in c["periods"]:
            Tp = _years(asof, pay)
            if Tp <= t_i + 1e-9 or tau <= 0:
                continue
            Ts, Te = _years(asof, ps), _years(asof, pe)
            yield c, Ts, Te, Tp, tau, ("ENDED" if Te <= t_i + 1e-9 else "OPEN")


def value_caplets(item: dict, paths: Paths, i: int, fx_to_usd: dict[str, float]) -> np.ndarray:
    """The item's caps and floors at grid date i, from our side, in USD: every period not yet paid.
      ended, waiting for its payment date   N·max(G(s, e) − X, 0)·P(t, p), the growth the path has realised
      running                               N·P(t, p)·Black(G(s, t)/P(t, e), X, v), v² the variance of ln G(t, e)
      not begun                             N·P(t, p)·Black(P(t, s)/P(t, e), X, v), v² the variance of ln G(s, e)
    with X = 1 + τK, and a floor the put. A payment after the period's end is discounted to its date as a swap's
    floating coupon is (value_swap): the two days' convexity is not in it."""
    key = f"RATES:{CURVE_OF.get(item['ccy'], item['ccy'] + '_OIS')}"
    t_i = float(paths.t[i])
    v = np.zeros(paths.n_paths)
    # kept on the path set itself, which owns the model's parameters and the grid: it goes when the paths go (kept
    # on the item under the paths' id, another path set given that id later would have read this one's figure)
    seen = paths.__dict__.setdefault("_growth_var", {})
    for c, Ts, Te, Tp, tau, state in _caplet_periods(item, paths, i):
        call = c["type"] == "CAP"
        X = 1.0 + tau * c["K"]
        dfp = bond(paths, key, i, Tp)
        if state == "ENDED":
            G = period_growth(paths, key, Ts, Te)
            unit = np.maximum(G - X, 0.0) if call else np.maximum(X - G, 0.0)
        else:
            begun = Ts <= t_i + 1e-9
            M = (growth(paths, key, Ts, t_i) if begun else bond(paths, key, i, Ts)) / bond(paths, key, i, Te)
            k = (key, i, round(Ts, 9), round(Te, 9))
            if k not in seen:
                seen[k] = math.sqrt(growth_variance(paths, key, i, max(Ts, t_i), Te))
            unit = black_on_growth(M, X, seen[k], call)
        v = v + c["sign"] * c["N"] * dfp * unit
    return v * fx_to_usd.get(item["ccy"], 1.0)


def caplet_flows(item: dict, paths: Paths, fx_to_usd: dict[str, float]) -> np.ndarray:
    """What the item's caps and floors pay us in (t_{i−1}, t_i] on each path, shape (paths, T+1), with the sign
    ccr.valuation.flows_per_step keeps: the jump the payment makes in our value, so a caplet we hold that pays us
    is negative. The amount is the path's own, N·max(G − X, 0). Until 0.60.0 a caplet's payment was in no flow, and a
    margined run read it as a market move."""
    asof = paths.grid[0]
    key = f"RATES:{CURVE_OF.get(item['ccy'], item['ccy'] + '_OIS')}"
    out = np.zeros((paths.n_paths, len(paths.grid)))
    k = fx_to_usd.get(item["ccy"], 1.0)
    for c in item.get("caplets") or []:
        call = c["type"] == "CAP"
        for (ps, pe, pay, tau) in c["periods"]:
            tp = _years(asof, pay)
            if tp <= 0 or tau <= 0:
                continue
            step = next((i for i in range(1, len(paths.t)) if float(paths.t[i - 1]) < tp <= float(paths.t[i]) + 1e-9), None)
            if step is None:
                continue
            G = period_growth(paths, key, _years(asof, ps), _years(asof, pe))
            X = 1.0 + tau * c["K"]
            out[:, step] -= c["sign"] * c["N"] * (np.maximum(G - X, 0.0) if call else np.maximum(X - G, 0.0)) * k
    return out


def model_cap_vol_bp(c: dict, paths: Paths, ccy: str) -> Optional[float]:
    """The one normal vol, in bp, at which the ticket's pricer (Bachelier on each period's forward, time to the middle
    of the period on ACT/365, discounted from the payment date: pricing/cap_floor.py) gives the value the paths' own
    model gives this strip today. It is what the market's quote is set beside: the strip is valued on the paths at
    the model's variance, not at this number. None when it cannot be found (a strip with no time value)."""
    from scipy.optimize import brentq
    asof = paths.grid[0]
    key = f"RATES:{CURVE_OF.get(ccy, ccy + '_OIS')}"
    p0 = paths.p0[key]
    call = c["type"] == "CAP"
    rows, model = [], 0.0
    for (ps, pe, pay, tau) in c["periods"]:
        Ts, Te, Tp = _years(asof, ps), _years(asof, pe), _years(asof, pay)
        if Ts < -1e-9 or tau <= 0 or Tp <= 0:
            continue                                             # a period under way has no forward on today's curve alone
        F = (p0(Ts) / p0(Te) - 1.0) / tau
        T_mid = max((ps - asof).days + 0.5 * (pe - ps).days, 0.0) / 365.0
        rows.append((F, tau, p0(Tp), T_mid))
        v = math.sqrt(growth_variance(paths, key, 0, Ts, Te))
        model += float(black_on_growth(np.array([p0(Ts) / p0(Te)]), 1.0 + tau * c["K"], v, call)[0]) * p0(Tp)
    if not rows:
        return None
    strip = lambda s: sum(tau * df * float(bachelier(np.array([F]), c["K"], T, s, call)[0]) for (F, tau, df, T) in rows)
    try:
        if model <= strip(1e-7) + 1e-14:
            return None
        return float(brentq(lambda s: strip(s) - model, 1e-7, 0.10, xtol=1e-10)) * 1e4
    except Exception as e:              # noqa: BLE001
        log.debug("ccr: model cap vol: %s", e)
        return None


def cap_market_vol_bp(db, uid: str, asof: date, c: dict, p0, tenor_y: float) -> tuple[float, str]:
    """The vol the cap ticket prices this strip at: the cap surface at the strike's distance from the strip's own
    at-the-money forward and at its remaining life (pricing.cap_floor.lookup_cap_vol, as POST /api/price/cap reads
    it). Reported beside the model's; the paths do not use it."""
    from pricing.cap_floor import lookup_cap_vol
    try:
        # the read itself, not the cached one that swallows a failure: a statement that fails leaves the session's
        # transaction aborted, and the run goes on to use that session, so it is rolled back here as cap_vol_bp does
        from api.routes.pricer import _read_cap_surface
        rows = [dict(r) for r in _read_cap_surface(db, asof.isoformat(), str(uid))]
    except Exception as e:              # noqa: BLE001
        log.debug("cap surface: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
        rows = []
    num = den = 0.0
    for (ps, pe, pay, tau) in c["periods"]:
        Ts, Te, Tp = _years(asof, ps), _years(asof, pe), _years(asof, pay)
        if Tp <= 0 or tau <= 0 or Ts < 0:
            continue
        F = (p0(Ts) / p0(Te) - 1.0) / tau
        num += F * tau * p0(Tp); den += tau * p0(Tp)
    atm = num / den if den > 1e-12 else c["K"]
    vol, tier = lookup_cap_vol(strike_rate=c["K"], atm_forward=atm, cap_tenor_y=tenor_y, surface_rows=rows, is_floor=c["type"] == "FLOOR")
    words = {"QUOTED": "cap surface, at a quote", "INTERP": "cap surface, read off its quotes", "FALLBACK": "desk default (no cap vol surface)"}
    return float(vol), words.get(tier, f"cap surface ({tier})")


# ── European swaptions ───────────────────────────────────────────────────────
def swaption_terms(trade, legs: list[dict], asof: date) -> dict[str, Any]:
    """expiry (date), strike (decimal), is_payer, from trade.terms with the legs as fallback."""
    t = dict(getattr(trade, "terms", None) or {})
    fixed = next((l for l in legs if str(l.get("leg_type", "")).upper() == "FIXED"), None)
    expiry = None
    for k in ("expiry_date", "option_expiry", "exercise_date"):
        if t.get(k):
            expiry = date.fromisoformat(str(t[k])[:10]); break
    if expiry is None and t.get("expiry_y") is not None:
        base = getattr(trade, "trade_date", None) or asof
        expiry = date.fromordinal(base.toordinal() + int(round(float(t["expiry_y"]) * 365.25)))
    if expiry is None and fixed and fixed.get("effective_date"):
        expiry = date.fromisoformat(str(fixed["effective_date"])[:10])          # forward start is the expiry
    K = t.get("strike")
    if K is None and fixed is not None:
        K = fixed.get("fixed_rate")
    K = float(K or 0.0)
    if K > 1.0:
        K /= 100.0
    if "is_payer" in t:
        is_payer = bool(t["is_payer"])
    elif t.get("direction"):
        is_payer = str(t["direction"]).upper().startswith("PAY")
    else:
        is_payer = bool(fixed and str(fixed.get("direction", "")).upper().startswith("PAY"))
    # bought (we hold the right) or sold; the ticket books terms.side since 2026-11, earlier bookings are long
    sign = -1.0 if str(t.get("side", "BUY")).upper() in ("SELL", "SHORT", "WRITE") else 1.0
    return {"expiry": expiry, "K": K, "is_payer": is_payer, "sign": sign}


def value_swaption(item: dict, paths: Paths, i: int, fx_to_usd: dict[str, float], swap_value) -> np.ndarray:
    """swap_value(item, paths, j) values the underlying swap (struck at K) on the paths at grid j; the result
    is from our side: negative when we sold the option and the holder exercises against us."""
    return float(item.get("sign", 1.0)) * _value_swaption_long(item, paths, i, fx_to_usd, swap_value)


def hw_implied_vol(item: dict, paths: Paths) -> float:
    """The normal vol (decimal) at which Bachelier on today's forward swap rate equals the exact Hull-White
    price of the swaption on the paths' own model (Jamshidian with the factor's a, sigma and the curve the
    paths reproduce). Valuing with it before expiry is consistent with exercising on the paths at expiry;
    with today's market vol instead, expected exposure stepped at expiry by the ratio of the two vols
    (13–25 % in the reference test) until 2026-11. Cached on the item per path set."""
    cache = item.setdefault("_hw_vol", {})
    if id(paths) in cache:
        return cache[id(paths)]
    from scipy.optimize import brentq
    from pricing.bermudan_swaption import price_european_swaption_hw1f_jamshidian
    asof = paths.grid[0]
    key = f"RATES:{CURVE_OF.get(item['ccy'], item['ccy'] + '_OIS')}"
    f = paths.calib.factors[key]
    a, sig = max(f.a, 1e-4), max(f.sigma, 1e-6)
    T_exp = _years(asof, item["expiry"])
    future = [(pay, tau) for (_, _, pay, tau) in item["fixed_sched"] if _years(asof, pay) > T_exp - 1e-9]
    vol = item["vol"]
    if future and T_exp > 1e-6:
        p0 = paths.p0[key]
        pay_y = [_years(asof, pay) for pay, _ in future]
        taus = [tau for _, tau in future]
        A0 = sum(tau * p0(ty) for ty, tau in zip(pay_y, taus))
        F0 = (p0(_years(asof, item["start"])) - p0(pay_y[-1])) / max(A0, 1e-12)
        try:
            jam = price_european_swaption_hw1f_jamshidian(1.0, item["K"], item["is_payer"], T_exp, pay_y, taus, a, sig, discount_fn=p0)
            target = float(jam["npv"]) / max(A0, 1e-12)                    # per unit of annuity
            intrinsic = max(F0 - item["K"], 0.0) if item["is_payer"] else max(item["K"] - F0, 0.0)
            if target > intrinsic + 1e-12:
                vol = brentq(lambda s: float(bachelier(np.array([F0]), item["K"], T_exp, s, item["is_payer"])[0]) - target, 1e-6, 0.05, xtol=1e-9)
        except Exception as e:              # noqa: BLE001 — keep the market vol and say nothing new
            log.debug("ccr: HW implied vol for %s: %s", item.get("trade", ""), e)
    item["hw_vol_bp"] = vol * 1e4
    cache[id(paths)] = vol
    return vol


def _value_swaption_long(item: dict, paths: Paths, i: int, fx_to_usd: dict[str, float], swap_value) -> np.ndarray:
    asof = paths.grid[0]; t_i = float(paths.t[i])
    T_exp = _years(asof, item["expiry"])
    key = f"RATES:{CURVE_OF.get(item['ccy'], item['ccy'] + '_OIS')}"
    k = fx_to_usd.get(item["ccy"], 1.0)
    if t_i < T_exp - 1e-9:
        fixed = item["fixed_sched"]
        future = [(pay, tau) for (_, _, pay, tau) in fixed if _years(asof, pay) > T_exp - 1e-9]
        if not future:
            return np.zeros(paths.n_paths)
        A = sum(tau * bond(paths, key, i, _years(asof, pay)) for pay, tau in future)
        T0 = _years(asof, item["start"]); Tn = _years(asof, future[-1][0])
        F = (bond(paths, key, i, T0) - bond(paths, key, i, Tn)) / np.maximum(A, 1e-12)
        return item["N"] * A * bachelier(F, item["K"], T_exp - t_i, hw_implied_vol(item, paths), item["is_payer"]) * k
    # at or after expiry: physical settlement on the paths that were in the money at expiry
    i_exp = min(j for j in range(len(paths.t)) if float(paths.t[j]) >= T_exp - 1e-9)
    cache = item.setdefault("_exercised", {})
    mask = cache.get(id(paths))
    if mask is None:
        mask = swap_value(item, paths, i_exp) > 0.0
        cache[id(paths)] = mask
    return np.where(mask, swap_value(item, paths, i), 0.0)


# ── FX options ───────────────────────────────────────────────────────────────
def value_fx_option(item: dict, paths: Paths, i: int, fx_to_usd: dict[str, float], flat_base: dict[str, float]) -> np.ndarray:
    """An FX option on the paths, any style (pricing/fx_exotic.py's model). Before expiry: the style's closed form
    on the path's spot with the continuous rates the path's bonds imply to settlement, at the vol the option was
    valued with today, held flat; barriers and touches carry which paths have already knocked, monitored at the
    grid points seen so far (discrete, where the pricer is continuous: a stated simplification); an American
    option is valued as its European on the paths (early exercise is not simulated: a lower bound). At and after
    expiry: the payoff fixed on the level at the expiry and discounted to settlement until paid. An expiry is
    seldom a grid date (a trade booked today expires a day or more before the grid date its tenor lands on): the
    level at the expiry is then the one the path passed through inside that step (ccr.simulate.spot_between), and
    a barrier is watched at the grid dates before the expiry and at the expiry, no further. The payoff is on the
    rate for delivery at settlement as it stands at the expiry (the spot then, carried over the days to settlement
    on today's curves), which is the rate the price is of; a barrier is a level of the spot and is watched on it.
    An option already expired and not yet settled reads today's level, carried from today. (Until 0.65.0 the
    payoff was fixed, and a barrier last watched, on the spot at the grid date at or after the
    expiry: the level had diffused for the days between, which the price does not count, and the carry to
    settlement was left out.) Sign: from our side (sold options negative)."""
    from ccr.simulate import spot_between
    from pricing.fx_exotic import ExoticSpec, knocked_so_far, value_on_paths
    asof = paths.grid[0]; t_i = float(paths.t[i])
    T_e, T_s = _years(asof, item["expiry"]), _years(asof, item["settle"])
    if T_s <= t_i + 1e-9:
        return np.zeros(paths.n_paths)
    qkey = f"RATES:{CURVE_OF.get(item['quote'], item['quote'] + '_OIS')}"
    dfq = bond(paths, qkey, i, T_s)
    skey = f"SPOT:{item['pair']}"
    S = paths.s[skey]
    spec = item.get("spec") or ExoticSpec("EUROPEAN", item["option_type"], strike=item["K"])
    k = fx_to_usd.get(item["quote"], 1.0) * float(item.get("sign", 1.0))
    N = item["N"]
    scale = N if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER") else 1.0
    i_exp = min(j for j in range(len(paths.t)) if float(paths.t[j]) >= T_e - 1e-9)
    before = t_i < T_e - 1e-9
    on_grid = abs(float(paths.t[i_exp]) - T_e) <= 1e-9
    if before or on_grid:
        watched = S[:, :min(i, i_exp) + 1]
    else:                                        # the grid dates before the expiry, then the expiry itself
        S_T = spot_between(paths, skey, T_e)
        watched = np.concatenate([S[:, :i_exp], S_T[:, None]], axis=1)
    knocked = knocked_so_far(spec, watched) if spec.style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH") else np.zeros(paths.n_paths, dtype=bool)
    if before:
        bkey = f"RATES:{CURVE_OF.get(item['base'])}" if item["base"] in CURVE_OF else None
        dfb = bond(paths, bkey, i, T_s) if bkey and bkey in paths.x else np.full(paths.n_paths, math.exp(-flat_base.get(item["pair"], 0.0) * (T_s - t_i)))
        tau = T_e - t_i
        # as the pricer: the forward and discount factor to settlement, spread over the time to expiry; the style
        # formulas take scalar rates, the path mean of the implied continuous rates (rates are a small effect on an
        # option next to spot and vol; the forward itself is per path through the spot)
        r_q = -np.log(np.maximum(dfq, 1e-12)) / tau
        r_b = -np.log(np.maximum(dfb, 1e-12)) / tau
        rq, rb = float(np.mean(r_q)), float(np.mean(r_b))
        if item.get("pillars"):
            # the surface's forward vol for the remaining life, the smile at each path's moneyness (sticky-delta);
            # until 2 November 2026 today's vol at the strike was held along the whole path
            from pricing.fx_exotic import value_on_paths_vols
            from pricing.fx_vol import path_vols
            f_exp = S[:, i] * np.exp((rq - rb) * tau)
            sig = path_vols(item["pillars"], t_i, T_e, f_exp, spec.strike if spec.style != "TOUCH" else None)
            v = value_on_paths_vols(spec, S[:, i], rq, rb, sig, tau, knocked, 1.0)
        else:
            v = value_on_paths(spec, S[:, i], rq, rb, item["vol"], tau, knocked, 1.0)
        return k * scale * v
    # at or after expiry: the payoff fixed on the level at the expiry, with the knock status then
    from pricing.fx_exotic import _expired
    if on_grid:
        S_T = S[:, i_exp]
    bkey = f"RATES:{CURVE_OF.get(item['base'])}" if item["base"] in CURVE_OF else None
    pq = paths.p0[qkey]
    carry_q = pq(T_s) / max(pq(T_e), 1e-12)
    carry_b = (paths.p0[bkey](T_s) / max(paths.p0[bkey](T_e), 1e-12)) if bkey and bkey in paths.p0 else math.exp(-flat_base.get(item["pair"], 0.0) * (T_s - T_e))
    S_T = S_T * carry_b / carry_q                 # the rate for delivery at settlement, as the expiry leaves it
    v = np.zeros(paths.n_paths)
    if spec.style in ("EUROPEAN", "AMERICAN", "DIGITAL"):
        v = np.array([_expired(spec, float(s), 1.0) for s in S_T])
    elif spec.style in ("BARRIER", "DOUBLE_BARRIER"):
        van = np.array([_expired(ExoticSpec("EUROPEAN", spec.option_type, strike=spec.strike), float(s), 1.0) for s in S_T])
        alive_pays = spec.barrier_type.endswith("OUT")
        v = np.where(knocked != alive_pays, van, spec.rebate if spec.style == "BARRIER" else 0.0)
    else:                                       # TOUCH
        hit_pays = spec.touch_type in ("ONE_TOUCH", "DOUBLE_ONE_TOUCH")
        v = np.where(knocked == hit_pays, spec.payout, 0.0)
        if spec.pay_at_hit:
            v = np.where(knocked, 0.0, v)        # paid at the hit, already settled
    return k * scale * v * dfq
