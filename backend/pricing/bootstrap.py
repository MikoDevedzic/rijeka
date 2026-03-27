"""
Rijeka Curve Bootstrap Engine — Sprint 4E
Bootstraps discount curves from deposit, OIS swap, IRS par rate, FRA, and futures quotes.

Bootstrap order (ARCHITECTURE §15):
  Pass 1: OIS     → independent, bootstrapped first (SOFR, SONIA, ESTR etc)
  Pass 2: BASIS   → depends on OIS                          [Sprint 5]
  Pass 3: XCCY    → depends on domestic OIS + USD_SOFR + FX [Sprint 5]
  Pass 4: FUNDING → additive spread, no iterative bootstrap  [Sprint 5]

Sprint 4: OIS and IRS single-curve bootstrap.
Sprint 5: Multi-curve basis spreads and XCCY.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

from dateutil.relativedelta import relativedelta

from .curve import Curve
from .day_count import dcf as _dcf_fn


# ─────────────────────────────────────────────────────────────────────────────
# Quote type constants
# ─────────────────────────────────────────────────────────────────────────────

DEPOSIT  = "DEPOSIT"    # Cash deposit / OIS deposit — direct simple-interest DF
OIS_SWAP = "OIS_SWAP"   # OIS swap par rate (SOFR OIS, SONIA OIS, ESTR OIS ...)
IRS      = "IRS"        # IBOR / term-rate IR swap par rate
FRA      = "FRA"        # Forward Rate Agreement (start tenor + end tenor)
FUTURES  = "FUTURES"    # Short-rate futures (no convexity adj Sprint 4; HW adj Sprint 5)

VALID_QUOTE_TYPES = {DEPOSIT, OIS_SWAP, IRS, FRA, FUTURES}

_DEPO_DC = "ACT/360"    # Money-market / deposit convention
_SWAP_DC = "ACT/365F"   # Swap annuity convention (ACT/365F used for zero-rate conversion too)


# ─────────────────────────────────────────────────────────────────────────────
# Data model
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class PillarQuote:
    """
    Single market instrument quote for curve bootstrap.

    tenor           — maturity tenor: "ON", "1W", "1M", "3M", "6M", "1Y", "2Y", ...
                      For FRA/FUTURES: this is the END tenor.
    quote_type      — DEPOSIT | OIS_SWAP | IRS | FRA | FUTURES
    rate            — decimal rate, e.g. 0.0525 = 5.25%
    fra_start_tenor — required for FRA/FUTURES: start tenor (e.g. "3M" for 3×6 FRA)
    day_count       — optional override of default convention
    """
    tenor: str
    quote_type: str
    rate: float
    fra_start_tenor: Optional[str] = None
    day_count: Optional[str] = None

    def __post_init__(self) -> None:
        if self.quote_type not in VALID_QUOTE_TYPES:
            raise ValueError(
                f"Unknown quote_type={self.quote_type!r}. "
                f"Valid: {sorted(VALID_QUOTE_TYPES)}"
            )
        if not (-0.15 < self.rate < 0.50):
            raise ValueError(
                f"Rate {self.rate!r} looks out of range — pass as decimal "
                f"(0.0525 = 5.25%). Got {self.rate:.6f}."
            )
        if self.quote_type in (FRA, FUTURES) and not self.fra_start_tenor:
            raise ValueError(
                f"quote_type={self.quote_type!r} requires fra_start_tenor "
                f"(e.g. '3M' for a 3×6 FRA with tenor='6M')"
            )


# ─────────────────────────────────────────────────────────────────────────────
# Tenor → date conversion
# ─────────────────────────────────────────────────────────────────────────────

_SPOT_LAG = 2   # T+2 settlement (deposits, swaps)


def parse_tenor(valuation_date: date, tenor: str, spot_lag: int = _SPOT_LAG) -> date:
    """
    Convert a tenor string to an end date.

    Special cases (no spot lag):
      ON / O/N        → T+1 (overnight)
      TN / T/N        → T+2 (tom-next)
      SN / S/N        → T+3 (spot-next)

    Standard tenors (measured from spot = T + spot_lag):
      1D, 7D          → days
      1W, 2W          → weeks
      1M, 3M, 6M, …   → calendar months (relativedelta handles month-end)
      1Y, 2Y, …       → years
    """
    t = tenor.upper().strip()

    if t in ("ON", "O/N", "OVERNIGHT"):
        return valuation_date + timedelta(days=1)
    if t in ("TN", "T/N", "TOM/NEXT", "TOM_NEXT"):
        return valuation_date + timedelta(days=2)
    if t in ("SN", "S/N", "SPOT/NEXT", "SPOT_NEXT"):
        return valuation_date + timedelta(days=3)

    spot = valuation_date + timedelta(days=spot_lag)

    if t.endswith("D"):
        return spot + timedelta(days=int(t[:-1]))
    if t.endswith("W"):
        return spot + timedelta(weeks=int(t[:-1]))
    if t.endswith("M"):
        return spot + relativedelta(months=int(t[:-1]))
    if t.endswith("Y"):
        return spot + relativedelta(years=int(t[:-1]))

    raise ValueError(f"Cannot parse tenor string: {tenor!r}")


def _mat(valuation_date: date, q: PillarQuote) -> date:
    """Convenience: maturity date for a PillarQuote."""
    return parse_tenor(valuation_date, q.tenor)


# ─────────────────────────────────────────────────────────────────────────────
# Discount factor helpers
# ─────────────────────────────────────────────────────────────────────────────

def _df_deposit(val_date: date, maturity: date, rate: float, dc: str) -> float:
    """
    Discount factor from simple-interest deposit rate.
      df = 1 / (1 + r × τ)
    """
    tau = float(_dcf_fn(dc, val_date, maturity))
    if tau <= 0.0:
        return 1.0
    return 1.0 / (1.0 + rate * tau)


def _df_fra(
    fra_start: date, fra_end: date,
    fra_rate: float, df_start: float, dc: str,
) -> float:
    """
    Terminal DF from FRA rate and known DF at start date.
      df(T₂) = df(T₁) / (1 + r × τ(T₁, T₂))
    """
    tau = float(_dcf_fn(dc, fra_start, fra_end))
    if tau <= 0.0:
        return df_start
    return df_start / (1.0 + fra_rate * tau)


# ─────────────────────────────────────────────────────────────────────────────
# Log-linear DF interpolation
# ─────────────────────────────────────────────────────────────────────────────

def _interp_df(d: date, pillars: List[Tuple[date, float]]) -> float:
    """
    Log-linear interpolation of discount factor from sorted (date, df) list.
    Flat extrapolation beyond last pillar via constant zero rate.
    """
    if not pillars:
        raise ValueError("No DF pillars available for interpolation")
    if d <= pillars[0][0]:
        return pillars[0][1]

    if d >= pillars[-1][0]:
        d0, df0 = pillars[-1]
        origin = pillars[0][0]
        t0 = max((d0 - origin).days, 1) / 365.25
        t1 = (d - origin).days / 365.25
        r = -math.log(df0) / t0 if df0 > 0 and t0 > 0 else 0.0
        return math.exp(-r * t1)

    # Binary search
    lo, hi = 0, len(pillars) - 1
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        if pillars[mid][0] <= d:
            lo = mid
        else:
            hi = mid

    d0, df0 = pillars[lo]
    d1, df1 = pillars[hi]
    t = (d - d0).days / max((d1 - d0).days, 1)
    return math.exp((1.0 - t) * math.log(df0) + t * math.log(df1))


# ─────────────────────────────────────────────────────────────────────────────
# OIS / IRS iterative par-rate bootstrap
# ─────────────────────────────────────────────────────────────────────────────

def _annual_periods(
    val_date: date, maturity: date, dc: str
) -> List[Tuple[date, date, float]]:
    """
    Generate annual coupon periods backward from maturity to val_date.
    Returns [(period_start, period_end, dcf), …] sorted ascending.
    ISDA 2006 backward roll from maturity.
    """
    periods: List[Tuple[date, date, float]] = []
    end = maturity
    while True:
        start = end - relativedelta(years=1)
        if start <= val_date:
            start = val_date
            tau = float(_dcf_fn(dc, start, end))
            periods.append((start, end, tau))
            break
        tau = float(_dcf_fn(dc, start, end))
        periods.append((start, end, tau))
        end = start
    periods.reverse()
    return periods


def _bootstrap_par_swap(
    val_date: date,
    maturity: date,
    par_rate: float,
    df_pillars: List[Tuple[date, float]],
    dc: str,
) -> float:
    """
    Iterative par-rate bootstrap for OIS and IRS.

    Standard formula (annual frequency, single-curve):
      par = (1 − df_n) / annuity,   annuity = Σ τᵢ × df(Tᵢ)
      → df_n = (1 − par × Σᵢ₍ᵢ₌₁₎ⁿ⁻¹ τᵢ × df(Tᵢ)) / (1 + par × τ_n)

    Intermediate DFs are log-linearly interpolated from df_pillars.
    Raises ValueError if bootstrap is numerically unstable.
    """
    periods = _annual_periods(val_date, maturity, dc)

    annuity = 0.0
    for _, pe, tau in periods[:-1]:
        annuity += tau * _interp_df(pe, df_pillars)

    _, last_end, last_tau = periods[-1]
    df_n = (1.0 - par_rate * annuity) / (1.0 + par_rate * last_tau)

    if df_n <= 1e-8:
        raise ValueError(
            f"Bootstrap unstable: maturity={maturity}, par_rate={par_rate:.4%}, "
            f"df_n={df_n:.8f}. Check quote sequence is monotone and internally consistent."
        )
    return df_n


# ─────────────────────────────────────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────────────────────────────────────

def _df_to_cc_zero(val_date: date, maturity: date, df: float) -> float:
    """
    Continuously-compounded zero rate from discount factor.
      r = −ln(df) / T,   T = ACT/365F
    """
    t = float(_dcf_fn(_SWAP_DC, val_date, maturity))
    if t <= 0.0 or df <= 0.0:
        return 0.0
    return -math.log(df) / t


def _sorted_dedup(pils: List[Tuple[date, float]]) -> List[Tuple[date, float]]:
    """Sort by date; last value wins on duplicate dates."""
    d: Dict[date, float] = {}
    for dt, v in pils:
        d[dt] = v
    return sorted(d.items())


# ─────────────────────────────────────────────────────────────────────────────
# Main bootstrap entry point
# ─────────────────────────────────────────────────────────────────────────────

def bootstrap_curve(
    valuation_date: date,
    quotes: List[PillarQuote],
) -> Curve:
    """
    Bootstrap a discount curve from a list of market quotes.

    Processing order (within each pass, shortest maturity first):
      Pass 1: DEPOSIT        → direct DF via simple interest
      Pass 2: FRA / FUTURES  → DF via forward rate formula
      Pass 3: OIS_SWAP / IRS → iterative annual par-rate bootstrap

    Returns a Curve object with log-linear DF interpolation.
    Internally: cc zero rates as (date, rate) pillars.

    Raises:
      ValueError — insufficient quotes, unstable bootstrap, or bad rates.
    """
    if not quotes:
        raise ValueError("bootstrap_curve: no quotes supplied")

    # Working list: (date, discount_factor)
    # Anchor: df(val_date) = 1.0
    df_pillars: List[Tuple[date, float]] = [(valuation_date, 1.0)]

    # ── Pass 1: Deposits ──────────────────────────────────────────────────────
    dep_quotes = sorted(
        [q for q in quotes if q.quote_type == DEPOSIT],
        key=lambda q: _mat(valuation_date, q),
    )
    for q in dep_quotes:
        mat = _mat(valuation_date, q)
        dc = q.day_count or _DEPO_DC
        df = _df_deposit(valuation_date, mat, q.rate, dc)
        if df > 0:
            df_pillars.append((mat, df))

    # ── Pass 2: FRAs and Futures ──────────────────────────────────────────────
    fra_quotes = sorted(
        [q for q in quotes if q.quote_type in (FRA, FUTURES)],
        key=lambda q: _mat(valuation_date, q),
    )
    for q in fra_quotes:
        fra_start = parse_tenor(valuation_date, q.fra_start_tenor)   # type: ignore[arg-type]
        fra_end   = _mat(valuation_date, q)
        dc = q.day_count or _DEPO_DC
        sorted_pil = _sorted_dedup(df_pillars)
        df_start = _interp_df(fra_start, sorted_pil)
        df_end   = _df_fra(fra_start, fra_end, q.rate, df_start, dc)
        if df_end > 0:
            df_pillars.append((fra_end, df_end))

    # ── Pass 3: OIS swaps and IRS ─────────────────────────────────────────────
    swap_quotes = sorted(
        [q for q in quotes if q.quote_type in (OIS_SWAP, IRS)],
        key=lambda q: _mat(valuation_date, q),
    )
    for q in swap_quotes:
        mat = _mat(valuation_date, q)
        dc  = q.day_count or _SWAP_DC
        sorted_pil = _sorted_dedup(df_pillars)
        df_n = _bootstrap_par_swap(valuation_date, mat, q.rate, sorted_pil, dc)
        df_pillars.append((mat, df_n))

    # ── Convert to cc zero rates for Curve constructor ────────────────────────
    sorted_pil = _sorted_dedup(df_pillars)
    zero_pillars = []
    for d, df in sorted_pil:
        if d == valuation_date:
            continue  # T=0 anchor — zero rate undefined
        r = _df_to_cc_zero(valuation_date, d, df)
        zero_pillars.append((d, r))

    if len(zero_pillars) < 2:
        raise ValueError(
            f"Bootstrap produced only {len(zero_pillars)} pillar(s). "
            f"Provide at least 2 quotes spanning different maturities."
        )

    return Curve(valuation_date=valuation_date, pillars=zero_pillars)


# ─────────────────────────────────────────────────────────────────────────────
# API-friendly constructor
# ─────────────────────────────────────────────────────────────────────────────

def bootstrap_from_dicts(valuation_date: date, quote_dicts: List[dict]) -> Curve:
    """
    Bootstrap a Curve from raw dicts as received from the JSON API.

    Each dict must contain: tenor, quote_type, rate (decimal)
    Optional: fra_start_tenor, day_count

    Example:
      bootstrap_from_dicts(date.today(), [
        {"tenor": "ON",  "quote_type": "DEPOSIT",  "rate": 0.053},
        {"tenor": "1M",  "quote_type": "DEPOSIT",  "rate": 0.0525},
        {"tenor": "1Y",  "quote_type": "OIS_SWAP", "rate": 0.050},
        {"tenor": "5Y",  "quote_type": "OIS_SWAP", "rate": 0.046},
        {"tenor": "10Y", "quote_type": "OIS_SWAP", "rate": 0.045},
      ])
    """
    quotes = [
        PillarQuote(
            tenor=d["tenor"],
            quote_type=d["quote_type"],
            rate=float(d["rate"]),
            fra_start_tenor=d.get("fra_start_tenor"),
            day_count=d.get("day_count"),
        )
        for d in quote_dicts
    ]
    return bootstrap_curve(valuation_date, quotes)
