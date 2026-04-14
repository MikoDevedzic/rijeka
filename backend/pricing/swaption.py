"""
Rijeka — European Swaption Pricer (Sprint 7)
Black/Bachelier (Normal Vol) analytical pricer + HW1F cross-check.

Settlement: Physical (into underlying IRS). Annuity computed from OIS curve.

Primary formula — Bachelier (normal vol) payer swaption:
    V = N × A × [(F - K) × N(d) + σ√T × n(d)]
    d = (F - K) / (σ√T)

Receiver swaption:
    V = N × A × [(K - F) × N(-d) + σ√T × n(d)]

Put-call parity (check): Payer - Receiver = N × A × (F - K)

where:
    N = notional
    A = annuity = Σ δᵢ × P(0, T_exp + i×δ)  [physical settlement]
    F = forward swap rate = (P(0,T_start) - P(0,T_end)) / A
    K = strike rate (decimal)
    σ = normal vol (decimal, from bp/10000)
    T = option expiry in years

Greeks:
    Vega  = N × A × √T × n(d)       [$ per 1bp vol move]
    Delta = N × A × N(±d)            [$ per 1bp rate move = IR01]
    Theta = -N × A × σ × n(d) / (2√T × 365)  [$ per day]

HW1F cross-check:
    Uses hw1f_swaption_vol_normal() from calibration.py
    Reports model vol and model price alongside market-vol price.
    Validation: |HW1F_vol - market_vol| should be < 2bp ATM for calibrated params.

References:
    Bachelier (1900); Andersen & Piterbarg Vol 1 Ch 4; Brigo & Mercurio Ch 3.
"""

import math
from datetime import date, timedelta
from dataclasses import dataclass
from typing import Optional, Dict

from pricing.curve import Curve


# ── Normal distribution helpers ───────────────────────────────────────────────

def _N(x: float) -> float:
    """Standard normal CDF."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _n(x: float) -> float:
    """Standard normal PDF."""
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class SwaptionResult:
    npv:                float
    vega:               float          # $ per 1bp vol move
    ir01:               float          # $ per 1bp rate move (delta)
    theta:              float          # $ per calendar day
    volga:              float          # $ per (1bp)² vol convexity
    vanna:              float          # $ per 1bp rate × 1bp vol
    dollar_gamma:       float          # $ per (1bp)² rate convexity
    break_even_vol_bp:  float          # bp/day vol needed to cover theta
    delta_hedge_notl:   float          # IRS notional to delta-neutralize ($)
    vega_pct_premium:   float          # vega as % of NPV (normalized)
    forward_rate:       float          # decimal
    annuity:            float          # $ value (notional × swap annuity)
    d:                  float          # moneyness statistic
    vol_bp:             float          # input market vol (bp)
    is_payer:           bool
    hw1f_vol_bp:        Optional[float]
    hw1f_npv:           Optional[float]
    hw1f_error_bp:      Optional[float]
    error:              Optional[str]
    sabr_vol_bp:        Optional[float] = None  # SABR-implied vol if OTM + surface loaded
    is_sabr_vol:        bool            = False  # True = vol from SABR surface
    vol_tier:           str             = 'MANUAL'  # QUOTED | SABR | INTERPOLATED | MANUAL
    # Debug fields for model validation / Excel replication
    _debug:             Optional[dict]  = None


# ── Core: annuity + forward swap rate ────────────────────────────────────────

def _annuity_and_forward(
    expiry_y: float,
    tenor_y:  float,
    discount_curve: Curve,
    pay_freq_y: float = 1.0,
    valuation_date: Optional[date] = None,
    swap_effective_date: Optional[date] = None,
    swap_maturity_date:  Optional[date] = None,
) -> tuple:
    """
    Return (annuity_factor, forward_swap_rate, debug) from OIS curve.

    Uses swap_effective_date / swap_maturity_date when provided — these carry
    the correct T+2 spot lag and business day adjustment, matching Bloomberg.

    Falls back to int(t × 365.25) arithmetic when dates are not provided
    (backward-compatible behaviour for ATM resolution without trade context).

    annuity_factor = Σ δᵢ × P(0, Tᵢ)     (dimensionless, no notional)
    forward_rate   = (P(0,T_start) - P(0,T_end)) / annuity_factor
    """
    from dateutil.relativedelta import relativedelta as _rdelta

    vd = valuation_date or date.today()

    # ── Determine start / end dates ──────────────────────────────────────────
    if swap_effective_date and swap_maturity_date:
        # Use exact trade dates — T+2 spot lag already applied by the frontend
        start_date = swap_effective_date
        end_date   = swap_maturity_date
    else:
        # Fallback: approximate arithmetic (no spot lag)
        start_date = vd + timedelta(days=int(expiry_y * 365.25))
        end_date   = vd + timedelta(days=int((expiry_y + tenor_y) * 365.25))

    # ── Build annual payment schedule backward from end_date ─────────────────
    # Mirrors Bloomberg: coupons at start + 1Y, start + 2Y, ..., end
    pay_dates = []
    cursor = end_date
    while cursor > start_date:
        pay_dates.append(cursor)
        cursor = cursor - _rdelta(years=int(1 / pay_freq_y))
    pay_dates.reverse()

    # Ensure we don't have extra dates before start
    pay_dates = [d for d in pay_dates if d > start_date]

    if not pay_dates:
        raise ValueError(
            f"No payment dates: start={start_date} end={end_date} freq={pay_freq_y}Y"
        )

    # ── Annuity: A = Σ δ × P(0, Tᵢ) ─────────────────────────────────────────
    # δ = day count fraction for each period (ACT/360)
    annuity = 0.0
    coupon_dfs = []
    prev = start_date
    for pd in pay_dates:
        days = (pd - prev).days
        delta = days / 360.0   # ACT/360 matching Bloomberg money mkt basis
        df_i  = discount_curve.df(pd)
        annuity += delta * df_i
        coupon_dfs.append(df_i)
        prev = pd

    if annuity < 1e-12:
        raise ValueError("Annuity is effectively zero — check curve and tenor inputs")

    # ── Forward swap rate: F = (P(0,start) - P(0,end)) / A ───────────────────
    P_start = discount_curve.df(start_date)
    P_end   = discount_curve.df(end_date)
    forward_rate = (P_start - P_end) / annuity

    debug = {
        "start_date":    str(start_date),
        "end_date":      str(end_date),
        "P_start":       P_start,
        "P_end":         P_end,
        "annuity_factor":annuity,
        "forward_rate":  forward_rate,
        "payment_dates": [str(d) for d in pay_dates],
        "coupon_dfs":    coupon_dfs,
        "pay_freq_y":    pay_freq_y,
        "expiry_y":      expiry_y,
        "tenor_y":       tenor_y,
    }
    return annuity, forward_rate, debug


# ── Main pricer ───────────────────────────────────────────────────────────────

def price_swaption(
    notional:       float,
    expiry_y:       float,
    tenor_y:        float,
    strike:         float,
    vol_bp:         float,
    is_payer:       bool,
    discount_curve: Curve,
    pay_freq_y:     float = 1.0,
    valuation_date: Optional[date] = None,
    hw1f_params:    Optional[Dict] = None,
    swap_effective_date: Optional[date] = None,
    swap_maturity_date:  Optional[date] = None,
    db=None,   # SQLAlchemy session — if provided, enables SABR vol lookup for OTM strikes
) -> SwaptionResult:
    """
    Price a European swaption using Black/Bachelier (Normal Vol).

    Parameters
    ----------
    notional       : trade notional ($)
    expiry_y       : option expiry in years
    tenor_y        : underlying swap tenor in years
    strike         : strike rate (decimal)
    vol_bp         : ATM normal vol in basis points
    is_payer       : True = payer (long rate risk), False = receiver
    discount_curve : OIS curve for discounting and annuity
    pay_freq_y     : coupon frequency in years (1.0 = annual)
    valuation_date : pricing date (defaults to today)
    hw1f_params    : optional dict {a, sigma_bp, theta} for HW1F cross-check
    """
    # ── Step 1: annuity and forward rate ─────────────────────────────────────
    try:
        annuity_factor, F, _annuity_debug = _annuity_and_forward(
            expiry_y, tenor_y, discount_curve, pay_freq_y, valuation_date,
            swap_effective_date=swap_effective_date,
            swap_maturity_date=swap_maturity_date,
        )
    except Exception as exc:
        return SwaptionResult(
            npv=0, vega=0, ir01=0, theta=0,
            volga=0, vanna=0, dollar_gamma=0,
            break_even_vol_bp=0, delta_hedge_notl=0, vega_pct_premium=0,
            forward_rate=0, annuity=0, d=0, vol_bp=vol_bp,
            is_payer=is_payer, hw1f_vol_bp=None, hw1f_npv=None,
            hw1f_error_bp=None, error=str(exc)
        )

    K     = strike
    sigma = vol_bp / 10000.0   # bp → decimal
    T     = expiry_y
    A     = notional * annuity_factor   # $ annuity

    # ── SABR vol lookup for OTM strikes ──────────────────────────────────────
    # If a SABR surface is available and strike ≠ forward, use SABR σ(K).
    # Falls back to user-supplied vol_bp for ATM or if surface not loaded.
    effective_vol_bp = vol_bp
    sabr_vol_bp      = None
    is_sabr_vol      = False
    vol_tier         = 'MANUAL'

    if db is not None and abs(K - F) > 1e-6:
        try:
            from pricing.sabr import get_sabr_vol_bp
            sv = get_sabr_vol_bp(
                F=F, K=K, T=T,
                expiry_y=expiry_y,
                tenor_y=tenor_y,
                db=db,
                valuation_date=valuation_date,
            )
            if sv is not None and sv > 0:
                sabr_vol_bp      = sv
                effective_vol_bp = sv
                sigma            = sv / 10000.0
                is_sabr_vol      = True
                # Determine vol tier from SABR params source
                try:
                    src_row = db.execute(
                        __import__('sqlalchemy').text(
                            "SELECT source FROM sabr_params "
                            "WHERE valuation_date = (SELECT MAX(valuation_date) FROM sabr_params) "
                            "AND ABS(expiry_y - :ey) < 0.01 AND ABS(tenor_y - :ty) < 0.01 LIMIT 1"
                        ), {"ey": expiry_y, "ty": tenor_y}
                    ).fetchone()
                    vol_tier = src_row.source if src_row else 'SABR'
                except Exception:
                    vol_tier = 'SABR'
        except Exception:
            pass  # fall back to user vol_bp

    # ── Step 2: intrinsic value only if expired ───────────────────────────────
    if T <= 0 or sigma <= 1e-10:
        intrinsic = max(F - K, 0.0) if is_payer else max(K - F, 0.0)
        npv = A * intrinsic
        return SwaptionResult(
            npv=npv, vega=0, ir01=0, theta=0,
            volga=0, vanna=0, dollar_gamma=0,
            break_even_vol_bp=0, delta_hedge_notl=0, vega_pct_premium=0,
            forward_rate=F, annuity=A, d=(1e9 if intrinsic > 0 else -1e9),
            vol_bp=vol_bp, is_payer=is_payer,
            hw1f_vol_bp=None, hw1f_npv=None, hw1f_error_bp=None, error=None
        )

    # ── Step 3: Bachelier formula ─────────────────────────────────────────────
    sigma_sqrt_T = sigma * math.sqrt(T)
    d = (F - K) / sigma_sqrt_T

    N_d  = _N(d)
    N_md = _N(-d)
    n_d  = _n(d)

    if is_payer:
        option_value = (F - K) * N_d  + sigma_sqrt_T * n_d
    else:
        option_value = (K - F) * N_md + sigma_sqrt_T * n_d

    npv = A * option_value

    # ── Step 4: First-order Greeks ────────────────────────────────────────────
    # Vega: ∂V/∂σ = A × √T × n(d)   per unit vol → per 1bp:
    vega  = A * math.sqrt(T) * n_d * 0.0001

    # Delta / IR01: per 1bp rate move
    if is_payer:
        ir01 =  A * N_d  * 0.0001
    else:
        ir01 = -A * N_md * 0.0001

    # Theta: ∂V/∂t per day
    if T > 1e-6:
        theta = -A * sigma * n_d / (2.0 * math.sqrt(T)) / 365.0
    else:
        theta = 0.0

    # ── Step 5: Second-order Greeks ───────────────────────────────────────────

    # Dollar Gamma: ½ × ∂²V/∂F² × (1bp)²
    # ∂²V/∂F² = A × n(d) / (σ√T)
    if sigma_sqrt_T > 1e-10:
        dollar_gamma = 0.5 * A * n_d / sigma_sqrt_T * (0.0001 ** 2)
    else:
        dollar_gamma = 0.0

    # Volga (Vomma): ∂²V/∂σ² per (1bp)² vol move
    # ∂²V/∂σ² = A × √T × n(d) × d² / σ
    # Per (1bp)²: × (0.0001)²
    if sigma > 1e-10:
        volga = A * math.sqrt(T) * n_d * (d ** 2) / sigma * (0.0001 ** 2)
    else:
        volga = 0.0

    # Vanna: ∂²V/∂F∂σ — cross sensitivity (rate × vol)
    # ∂²V/∂F∂σ = -A × d × n(d) / σ
    # Per 1bp rate × 1bp vol: × (0.0001)²
    if sigma > 1e-10:
        vanna = -A * d * n_d / sigma * (0.0001 ** 2)
    else:
        vanna = 0.0

    # Break-even vol move (bp/day): how much vol must move daily to cover theta
    # |Theta_daily| = Vega_per_bp × break_even_bp_per_day
    # break_even = |theta| / vega_per_bp
    if abs(vega) > 1e-6:
        break_even_vol_bp = abs(theta) / abs(vega)
    else:
        break_even_vol_bp = 0.0

    # Delta hedge IRS notional: notional of opposite-direction IRS to go delta-neutral
    # IRS IR01 = notional × annuity_factor × 0.0001
    # Set equal to |swaption IR01|: hedge_notional × annuity_factor × 0.0001 = |ir01|
    # → hedge_notional = |ir01| / (annuity_factor × 0.0001)
    annuity_factor = A / notional  # dimensionless
    if annuity_factor > 1e-12:
        delta_hedge_notl = abs(ir01) / (annuity_factor * 0.0001)
    else:
        delta_hedge_notl = 0.0

    # Vega as % of premium (normalized sensitivity)
    vega_pct_premium = (abs(vega) / abs(npv) * 100.0) if abs(npv) > 1.0 else 0.0

    # ── Step 5: HW1F cross-check (optional) ───────────────────────────────────
    hw1f_vol_bp   = None
    hw1f_npv      = None
    hw1f_error_bp = None

    if hw1f_params and hw1f_params.get('a') and hw1f_params.get('sigma_bp'):
        try:
            from pricing.calibration import hw1f_swaption_vol_normal
            hw1f_vol_bp = hw1f_swaption_vol_normal(
                a=float(hw1f_params['a']),
                sigma=float(hw1f_params['sigma_bp']) / 10000.0,
                theta=float(hw1f_params.get('theta', 0.0365)),
                expiry_y=expiry_y,
                tenor_y=tenor_y,
            )
            hw1f_error_bp = round(hw1f_vol_bp - vol_bp, 3)

            # Price using HW1F vol
            hw1f_sigma    = hw1f_vol_bp / 10000.0
            hw1f_sst      = hw1f_sigma * math.sqrt(T)
            if hw1f_sst > 1e-10:
                hw1f_d = (F - K) / hw1f_sst
                if is_payer:
                    hw1f_opt = (F - K) * _N(hw1f_d)  + hw1f_sst * _n(hw1f_d)
                else:
                    hw1f_opt = (K - F) * _N(-hw1f_d) + hw1f_sst * _n(hw1f_d)
                hw1f_npv = round(A * hw1f_opt, 2)
        except Exception:
            pass

    # Build debug payload for model validation / Excel replication
    _debug_out = {
        **_annuity_debug,
        "T":              T,
        "K":              K,
        "sigma":          sigma,
        "sigma_sqrt_T":   sigma_sqrt_T,
        "d":              d,
        "N_d":            N_d,
        "N_md":           N_md,
        "n_d":            n_d,
        "dollar_annuity": A,
        "notional":       notional,
        "is_payer":       is_payer,
        "sabr_vol_bp":    sabr_vol_bp,
        "is_sabr_vol":    is_sabr_vol,
    }

    return SwaptionResult(
        npv=npv,
        vega=vega,
        ir01=ir01,
        theta=theta,
        volga=volga,
        vanna=vanna,
        dollar_gamma=dollar_gamma,
        break_even_vol_bp=break_even_vol_bp,
        delta_hedge_notl=delta_hedge_notl,
        vega_pct_premium=vega_pct_premium,
        forward_rate=F,
        annuity=A,
        d=d,
        vol_bp=effective_vol_bp,
        is_payer=is_payer,
        hw1f_vol_bp=hw1f_vol_bp,
        hw1f_npv=hw1f_npv,
        hw1f_error_bp=hw1f_error_bp,
        error=None,
        sabr_vol_bp=sabr_vol_bp,
        is_sabr_vol=is_sabr_vol,
        vol_tier=vol_tier if is_sabr_vol else 'MANUAL',
        _debug=_debug_out,
    )
