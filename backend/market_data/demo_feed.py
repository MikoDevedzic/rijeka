"""
Demo market data: no terminal data and no publisher's rates anywhere.

The hosted demo cannot show or redistribute a vendor's data, and it holds no licence for any interest-rate
benchmark, so the template user's curves and vol surfaces are made, with every assumption written down and
stamped into `source`:

  USD_SOFR, EUR_ESTR, GBP_SONIA, CHF_SARON, JPY_TONAR
               SYNTHETIC: one stated generator (market_data/synthetic_rates.py): a parametric curve per
               currency with hand-set levels, moved each business day by three seeded factors. The curve ids
               keep the names of the conventions they are bootstrapped with (day count, calendar, lag); no
               fixing and no yield of any publisher is read. Since 0.55.0; until then the curves were built from
               published overnight fixings and government yields.
  USD_SWVOL_ATM, swaption skew, cap vols
               SYNTHETIC: a smooth parametric normal-vol surface. Not market.

Everything here is indicative. It exists so the demo prices on numbers of today's date with a documented
provenance, not so anyone trades on it. A self-hosted desk connects its own market data.

Pure functions only: the builders turn a date into snapshot rows. Writing to the database lives in
api/routes/demo_market_data.py.
"""
from __future__ import annotations

import logging
import math
import re
from datetime import date
from typing import Callable, Optional

import httpx

from market_data import synthetic_rates

log = logging.getLogger("rijeka.demo_feed")

UA = {"User-Agent": "rijeka-demo-feed/1 (+https://rijeka.app)"}
TIMEOUT = 25.0

# ── What the demo prices on ───────────────────────────────────────────────────────
RATE_CURVES = tuple(synthetic_rates.PARAMS)

SOURCES = [{"curve": c, "provider": "synthetic rates market (a stated generator)", "kind": "synthetic", "url": None} for c in RATE_CURVES] + [
    {"curve": "USD_SWVOL_ATM", "provider": "synthetic parametric surface", "kind": "synthetic", "url": None},
    {"curve": "USD_CAPVOL",    "provider": "synthetic parametric surface", "kind": "synthetic", "url": None},
]

# The template user's OIS pillar list; the bootstrap and the curves page expect
# exactly this shape (quote_type strings as stored by the manual editor).
OIS_TENORS = ["ON", "1W", "2W", "3W", "1M", "2M", "3M", "4M", "5M", "6M", "7M", "8M", "9M", "10M", "11M",
              "1Y", "18M", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y", "12Y", "15Y", "20Y",
              "25Y", "30Y", "40Y", "50Y"]

SWVOL_EXPIRIES = [1, 2, 3, 5, 7]
SWVOL_TENORS   = [1, 2, 3, 5, 7, 9]
SKEW_TENORS    = [1, 2, 5]
SKEW_OFFSETS   = [-200, -100, -50, -25, 25, 50, 100, 200]
CAP_TENORS     = [1.0, 2.0, 3.0, 5.0, 7.0, 10.0]
CAP_SPREADS    = [-200, -150, -100, -50, 0, 50, 100, 150, 200]

# ── Helpers ────────────────────────────────────────────────────────────────────

def tenor_years(t: str) -> float:
    if t == "ON":
        return 1 / 365
    m = re.fullmatch(r"(\d+)([DWMY])", t)
    if not m:
        raise ValueError(f"bad tenor {t!r}")
    n, u = int(m.group(1)), m.group(2)
    return {"D": n / 365, "W": n * 7 / 365, "M": n / 12, "Y": float(n)}[u]


def interp(knots: list[tuple[float, float]], x: float) -> float:
    """Linear interpolation on (x, y) knots, flat outside the range."""
    pts = sorted(knots)
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def _get(url: str) -> str:
    r = httpx.get(url, headers=UA, timeout=TIMEOUT, follow_redirects=True)
    r.raise_for_status()
    return r.text


# ── Fetchers: each returns (as_of_date, data) and raises on failure ────────────

def _q(tenor: str, rate: float, quote_type: str) -> dict:
    return {"tenor": tenor, "quote_type": quote_type, "rate": round(rate, 4), "enabled": True}


def build_rates_curve(curve_id: str, valuation_date: date, tenors: list[str] = OIS_TENORS) -> list[dict]:
    """The synthetic curve's pillars on a date, in the shape the bootstrap and the curves page expect: the overnight
    point as an OIS deposit, every other tenor as an OIS par rate (market_data/synthetic_rates.py)."""
    years = [1.0 / 365.0 if t == "ON" else tenor_years(t) for t in tenors]
    rates = synthetic_rates.curve_rates(curve_id, valuation_date, years)
    return [_q(t, r, "OISDeposit" if t == "ON" else "OIS") for t, r in zip(tenors, rates)]


# Synthetic normal-vol surface. Level falls with expiry (short-dated rate vol
# is highest in a cutting/hiking cycle), drifts down gently with tenor, and the
# smile is a near-symmetric parabola in strike offset. Numbers are in bp/yr.
def atm_normal_vol_bp(expiry_y: float, tenor_y: float) -> float:
    level = 100.0 - 11.0 * math.log1p(expiry_y)
    shape = 1.09 - 0.035 * math.log1p(tenor_y)
    return round(level * shape, 1)


def skew_spread_bp(offset_bp: int) -> float:
    k = offset_bp
    return round(0.00056 * k * k + 0.008 * k, 2)


# Synthetic FX volatility surfaces, ATM / 25-delta risk reversal / 25-delta butterfly in vol
# points by tenor, levels and skews typical of late 2026: USD calls bid against JPY and the
# commodity currencies (negative RR for a BASE/USD pair means puts on the base are dearer), a
# gently rising term structure, butterflies of 20–35bp of vol. No free public source quotes FX
# vols; the methodology says so and every response names the tier.
FX_VOL_TENORS = ["1W", "1M", "2M", "3M", "6M", "9M", "1Y", "2Y"]
FX_VOL_LEVELS = {   # pair: (ATM 1W, ATM 2Y, RR25, BF25)
    "EURUSD": (6.9, 7.6, -0.35, 0.22), "GBPUSD": (7.9, 8.5, -0.70, 0.28), "AUDUSD": (9.6, 9.9, -1.00, 0.32),
    "USDJPY": (10.4, 9.6, -1.30, 0.35), "USDCHF": (7.6, 7.4, -0.60, 0.25), "USDCAD": (6.3, 6.8, 0.30, 0.20),
}


# Digital assets: the same shape at crypto levels (ATM 55–90 %, calls bid in a bull market so the
# risk reversal is positive, fat wings), scaled day by day by realised vol like the FX surfaces
# (risk/vols.py). This is the fallback: when Deribit's public marks answer (market_data/deribit.py)
# the venue's surface is stored instead and these levels are never read for that day.
CRYPTO_VOL_LEVELS = {"BTCUSD": (52.0, 60.0, 2.0, 3.0), "ETHUSD": (62.0, 70.0, 3.0, 3.5), "SOLUSD": (82.0, 90.0, 4.0, 4.5)}
VOL_LEVELS = {**FX_VOL_LEVELS, **CRYPTO_VOL_LEVELS}


def build_fx_vols(pair: str) -> list[dict]:
    lo, hi, rr, bf = VOL_LEVELS[pair]
    out = []
    for t in FX_VOL_TENORS:
        y = tenor_years(t)
        w = min(max(math.log1p(y * 12) / math.log1p(24), 0.0), 1.0)          # 0 at 1W, 1 at 2Y, concave
        atm = round(lo + (hi - lo) * w, 2)
        out += [{"tenor": t, "quote_type": "ATM", "rate": atm, "enabled": True},
                {"tenor": t, "quote_type": "RR25", "rate": round(rr * (0.6 + 0.4 * w), 2), "enabled": True},
                {"tenor": t, "quote_type": "BF25", "rate": round(bf * (0.8 + 0.2 * w), 2), "enabled": True}]
    return out


def build_swvol_atm() -> list[dict]:
    return [{"tenor": f"{e}Yx{t}Y", "quote_type": "SWVOL", "rate": atm_normal_vol_bp(e, t), "enabled": True}
            for e in SWVOL_EXPIRIES for t in SWVOL_TENORS]


def build_skew_cells(source: str) -> list[dict]:
    cells = []
    for e in SWVOL_EXPIRIES:
        for t in SKEW_TENORS:
            cell = {"expiry_label": f"{e}Y", "tenor_label": f"{t}Y", "expiry_y": float(e), "tenor_y": float(t),
                    "atm_vol_bp": atm_normal_vol_bp(e, t), "source": source}
            for off in SKEW_OFFSETS:
                cell[f"spread_{'m' if off < 0 else 'p'}{abs(off)}"] = skew_spread_bp(off)
            cells.append(cell)
    return cells


def cap_flat_vol_bp(cap_tenor_y: float, spread_bp: int) -> float:
    atm = 96.0 - 11.0 * math.log(cap_tenor_y) if cap_tenor_y > 1 else 96.0
    return round(atm + 0.0005 * spread_bp * spread_bp, 1)


def build_cap_rows(valuation_date: date, atm_fwd_pct: Callable[[float], float], source: str) -> list[dict]:
    rows = []
    for T in CAP_TENORS:
        f = atm_fwd_pct(T)
        for s in CAP_SPREADS:
            rows.append({"valuation_date": valuation_date, "cap_tenor_y": T, "strike_spread_bp": s,
                         "is_atm": s == 0, "flat_vol_bp": cap_flat_vol_bp(T, s),
                         "strike_pct": round(f + s / 100, 6), "ticker": None, "source": source})
    return rows


def par_rate_lookup(quotes: list[dict]) -> Callable[[float], float]:
    pts = [(tenor_years(q["tenor"]), q["rate"]) for q in quotes if q["quote_type"] == "OIS"]
    return lambda yrs: interp(pts, yrs)


# ── Orchestration (network) ────────────────────────────────────────────────────

def collect(today: Optional[date] = None) -> dict:
    """Nothing is fetched for rates since 0.55.0 (the curves are made, not read): kept so the callers' shape stands."""
    return {"ok": {}, "failed": {}}


def assemble(collected: dict, valuation_date: date) -> dict:
    """The snapshot rows of a date: the synthetic rates curves and the synthetic vol surfaces."""
    curves: dict[str, dict] = {}

    for curve_id in RATE_CURVES:
        curves[curve_id] = {"quotes": build_rates_curve(curve_id, valuation_date), "source": synthetic_rates.SOURCE}

    synthetic = "DEMO · synthetic surface"
    curves["USD_SWVOL_ATM"] = {"quotes": build_swvol_atm(), "source": synthetic}
    for pair in VOL_LEVELS:
        curves[f"{pair}_VOL"] = {"quotes": build_fx_vols(pair), "source": synthetic}
    skew = build_skew_cells(synthetic)
    fwd = par_rate_lookup(curves["USD_SOFR"]["quotes"]) if "USD_SOFR" in curves else (lambda _y: 4.0)
    caps = build_cap_rows(valuation_date, fwd, synthetic)
    return {"valuation_date": valuation_date, "curves": curves, "skew": skew, "caps": caps,
            "failed": collected["failed"]}
