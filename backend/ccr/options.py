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
sold. Vols: {CCY}_SWVOL_ATM snapshot quotes 'AYxBY' for swaptions, the cap vol table's
ATM flat vol by cap tenor for caplets; a desk default of 85bp when neither exists, and the
item says which."""
from __future__ import annotations

import logging
import math
from datetime import date
from typing import Any, Optional

import numpy as np

from ccr.calibration import CURVE_OF
from ccr.simulate import Paths, bond

log = logging.getLogger("rijeka.ccr")
DEFAULT_VOL_BP = 85.0
SWAPTIONS = ("IR_SWAPTION", "SWAPTION")


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


def swaption_vol_bp(mkt, ccy: str, expiry_y: float, tenor_y: float) -> tuple[float, str]:
    """Nearest ATM normal vol on the (expiry, tenor) grid of {CCY}_SWVOL_ATM, in bp."""
    q = mkt.quotes(f"{ccy}_SWVOL_ATM") if mkt is not None else None
    best, bd = None, None
    for x in q or []:
        p = _parse_axb(x.get("tenor")); r = x.get("rate")
        if p is None or r is None:
            continue
        d = abs(math.log(max(p[0], 1 / 12) / max(expiry_y, 1 / 12))) + abs(math.log(max(p[1], 0.25) / max(tenor_y, 0.25)))
        if bd is None or d < bd:
            best, bd = float(r), d
    if best is None:
        return DEFAULT_VOL_BP, "desk default (no ATM swaption surface)"
    return best, f"{ccy}_SWVOL_ATM nearest point"


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


def value_caplets(item: dict, paths: Paths, i: int, fx_to_usd: dict[str, float]) -> np.ndarray:
    asof = paths.grid[0]; t_i = float(paths.t[i])
    key = f"RATES:{CURVE_OF.get(item['ccy'], item['ccy'] + '_OIS')}"
    v = np.zeros(paths.n_paths)
    for c in item.get("caplets") or []:
        call = c["type"] == "CAP"
        for (ps, pe, pay, tau) in c["periods"]:
            Tp = _years(asof, pay)
            if Tp <= t_i + 1e-9 or tau <= 0:
                continue
            Ts, Te = _years(asof, ps), _years(asof, pe)
            dfp = bond(paths, key, i, Tp)
            if Ts > t_i + 1e-9:
                # not fixed yet: Bachelier on the path's forward for the period
                f = (bond(paths, key, i, Ts) / bond(paths, key, i, Te) - 1.0) / tau
                v = v + c["sign"] * c["N"] * tau * dfp * bachelier(f, c["K"], Ts - t_i, c["vol"], call)
            else:
                # fixed: the rate the path showed at the last grid point on or before the fixing
                i_fix = max(j for j in range(len(paths.t)) if float(paths.t[j]) <= Ts + 1e-9)
                f = (bond(paths, key, i_fix, Ts) / bond(paths, key, i_fix, Te) - 1.0) / tau
                pay_off = np.maximum(f - c["K"], 0.0) if call else np.maximum(c["K"] - f, 0.0)
                v = v + c["sign"] * c["N"] * tau * dfp * pay_off
    return v * fx_to_usd.get(item["ccy"], 1.0)


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
    return {"expiry": expiry, "K": K, "is_payer": is_payer}


def value_swaption(item: dict, paths: Paths, i: int, fx_to_usd: dict[str, float], swap_value) -> np.ndarray:
    """swap_value(item, paths, j) values the underlying swap (struck at K) on the paths at grid j."""
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
        return item["N"] * A * bachelier(F, item["K"], T_exp - t_i, item["vol"], item["is_payer"]) * k
    # at or after expiry: physical settlement on the paths that were in the money at expiry
    i_exp = min(j for j in range(len(paths.t)) if float(paths.t[j]) >= T_exp - 1e-9)
    cache = item.setdefault("_exercised", {})
    mask = cache.get(id(paths))
    if mask is None:
        mask = swap_value(item, paths, i_exp) > 0.0
        cache[id(paths)] = mask
    return np.where(mask, swap_value(item, paths, i), 0.0)
