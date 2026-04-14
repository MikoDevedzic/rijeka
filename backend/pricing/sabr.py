"""
Rijeka — β=0 Normal (Bachelier) SABR Model  — Sprint 8
========================================================
Industry-standard vol surface construction for USD SOFR swaptions.

β=0 Normal SABR (Hagan et al. 2002, normal variant):
    σ_N(K) = α × C(F,K) × { 1 + [(2-3ρ²)/24 × ν² + ρ×ν×α/4] × T }

where:
    C(F,K) = z / χ(z)          for F ≠ K
           = 1                  for F = K (ATM)
    z      = (ν/α) × (F - K)
    χ(z)   = log[(√(1-2ρz+z²) + z - ρ) / (1-ρ)]

Parameters:
    α  — ATM vol level (≈ ATM_vol_bp/10000)
    β  — backbone: fixed at 0 for post-LIBOR normal model
    ρ  — rate-vol correlation: drives skew  (-1 < ρ < 1)
         negative ρ → higher vol at lower strikes (receiver skew)
    ν  — vol-of-vol: drives wings / smile curvature

Calibration:
    Given market vols at standard strikes {-200,-100,-50,-25,ATM,+25,+50,+100,+200 bp},
    fit (α, ρ, ν) by minimizing weighted sum of squared vol errors.
    α is constrained to match ATM exactly: α = σ_N(ATM) at K=F.

References:
    Hagan et al. (2002) "Managing Smile Risk", Wilmott Magazine.
    Andersen & Piterbarg (2010) "Interest Rate Modeling", Vol 1 Ch 7.
    Le Floc'h & Kennedy (2014) "Explicit SABR calibration through simple expansions".
"""

import math
import logging
from typing import Optional, Tuple, List, Dict

log = logging.getLogger(__name__)

# Standard OTM strike offsets in bp (matching Bloomberg VCUB columns)
STRIKE_OFFSETS_BP = [-200, -100, -50, -25, 0, 25, 50, 100, 200]


# ── Core Normal SABR formula ──────────────────────────────────────────────────

def normal_sabr_vol(
    F:     float,   # forward rate (decimal)
    K:     float,   # strike (decimal)
    T:     float,   # expiry in years
    alpha: float,   # vol level (decimal)
    rho:   float,   # rate-vol correlation
    nu:    float,   # vol-of-vol
) -> float:
    """
    β=0 Normal SABR implied vol in decimal.
    Returns σ_N(K,F,T) — multiply by 10000 for bp.

    ATM (K=F): σ_N = α × {1 + [(2-3ρ²)/24 × ν² + ρ×ν×α/4] × T}
    OTM:       σ_N = α × z/χ(z) × {same correction}
    """
    if T <= 0 or alpha <= 0:
        return alpha

    # Correction term — same for ATM and OTM
    correction = 1.0 + ((2.0 - 3.0 * rho**2) / 24.0 * nu**2
                        + rho * nu * alpha / 4.0) * T

    if abs(F - K) < 1e-8:
        # ATM formula
        return alpha * correction

    # OTM formula
    z    = (nu / alpha) * (F - K)
    disc = math.sqrt(1.0 - 2.0 * rho * z + z**2)

    denom = (1.0 - rho)
    if abs(denom) < 1e-10:
        # ρ → 1 edge case: χ → z / (z - ρ + 1)
        chi = z / max(abs(z - rho + 1.0), 1e-10)
    else:
        arg = (disc + z - rho) / denom
        if arg <= 0:
            # Numerical issue: fall back to ATM vol
            return alpha * correction
        chi = math.log(arg)

    if abs(chi) < 1e-10:
        # z/χ → 1
        return alpha * correction

    return alpha * (z / chi) * correction


def normal_sabr_vol_bp(
    F_bp:     float,   # forward rate in bp
    K_bp:     float,   # strike in bp
    T:        float,
    alpha_bp: float,   # α in bp
    rho:      float,
    nu:       float,
) -> float:
    """Convenience wrapper — inputs and output in bp."""
    return normal_sabr_vol(
        F_bp / 10000.0, K_bp / 10000.0, T,
        alpha_bp / 10000.0, rho, nu
    ) * 10000.0


# ── SABR calibration ──────────────────────────────────────────────────────────

def _alpha_from_atm(atm_vol: float, T: float, rho: float, nu: float) -> float:
    """
    Solve α from ATM condition analytically.
    ATM: σ_N = α × {1 + [(2-3ρ²)/24 × ν² + ρ×ν×α/4] × T}
    This is a quadratic in α: a×α² + b×α + c = 0
    a = ρ×ν×T/4
    b = 1 + (2-3ρ²)/24 × ν² × T
    c = -σ_ATM
    """
    a = rho * nu * T / 4.0
    b = 1.0 + (2.0 - 3.0 * rho**2) / 24.0 * nu**2 * T
    c = -atm_vol

    if abs(a) < 1e-10:
        # Linear: α = σ_ATM / b
        return -c / b if abs(b) > 1e-10 else atm_vol

    disc = b**2 - 4.0 * a * c
    if disc < 0:
        return atm_vol  # fallback

    # Take positive root
    alpha1 = (-b + math.sqrt(disc)) / (2.0 * a)
    alpha2 = (-b - math.sqrt(disc)) / (2.0 * a)

    # Choose root closest to atm_vol and positive
    candidates = [x for x in [alpha1, alpha2] if x > 0]
    if not candidates:
        return atm_vol
    return min(candidates, key=lambda x: abs(x - atm_vol))


def calibrate_sabr(
    F:          float,            # forward rate (decimal)
    T:          float,            # expiry in years
    atm_vol:    float,            # ATM vol in decimal
    strike_vols: Dict[int, float],# {offset_bp: vol_bp} e.g. {-50: 82.5, 25: 84.1}
    beta:       float = 0.0,      # fixed at 0
    rho_init:   float = -0.3,     # initial guess — typical USD SOFR skew
    nu_init:    float = 0.25,
) -> Tuple[float, float, float, float]:
    """
    Calibrate β=0 Normal SABR parameters (α, ρ, ν) to market vols.

    α is solved analytically from ATM after each (ρ, ν) trial.
    Minimises weighted RMSE over all available strikes.

    Returns (alpha, rho, nu, rmse_bp)
    """
    from scipy.optimize import minimize

    # Filter to valid market points
    market_points = []
    for offset_bp, vol_bp in strike_vols.items():
        if vol_bp is None or math.isnan(vol_bp):
            continue
        K = F + offset_bp / 10000.0
        market_points.append((K, vol_bp / 10000.0, offset_bp))

    if not market_points:
        # No market data — return alpha from ATM, ρ=rho_init, ν=nu_init
        alpha = _alpha_from_atm(atm_vol, T, rho_init, nu_init)
        return alpha, rho_init, nu_init, 0.0

    # Weights: higher weight to liquid near-ATM points
    def weight(offset_bp: int) -> float:
        abs_off = abs(offset_bp)
        if abs_off <= 25:   return 4.0
        if abs_off <= 50:   return 2.0
        if abs_off <= 100:  return 1.0
        return 0.5  # wings — less reliable

    def objective(params) -> float:
        rho, nu = params
        rho = max(-0.98, min(0.98, rho))
        nu  = max(0.001, nu)

        alpha = _alpha_from_atm(atm_vol, T, rho, nu)
        if alpha <= 0:
            return 1e10

        total = 0.0
        for K, mkt_vol, offset in market_points:
            model_vol = normal_sabr_vol(F, K, T, alpha, rho, nu)
            w = weight(offset)
            total += w * (model_vol - mkt_vol) ** 2
        return total

    result = minimize(
        objective,
        x0=[rho_init, nu_init],
        method='L-BFGS-B',
        bounds=[(-0.98, 0.98), (0.001, 2.0)],
        options={'maxiter': 500, 'ftol': 1e-12, 'gtol': 1e-8},
    )

    rho_opt, nu_opt = result.x
    rho_opt = max(-0.98, min(0.98, rho_opt))
    nu_opt  = max(0.001, nu_opt)
    alpha_opt = _alpha_from_atm(atm_vol, T, rho_opt, nu_opt)

    # Compute RMSE in bp
    if market_points:
        sq_sum = 0.0
        for K, mkt_vol, _ in market_points:
            model_vol = normal_sabr_vol(F, K, T, alpha_opt, rho_opt, nu_opt)
            sq_sum += (model_vol - mkt_vol) ** 2
        rmse_bp = math.sqrt(sq_sum / len(market_points)) * 10000.0
    else:
        rmse_bp = 0.0

    log.info(
        f"SABR calibration: F={F*100:.4f}% T={T:.2f}Y "
        f"α={alpha_opt*10000:.2f}bp ρ={rho_opt:.4f} ν={nu_opt:.4f} "
        f"RMSE={rmse_bp:.3f}bp"
    )

    return alpha_opt, rho_opt, nu_opt, rmse_bp


# ── Bilinear interpolation of SABR parameters ────────────────────────────────

def interpolate_sabr_params(
    target_expiry_y: float,
    target_tenor_y:  float,
    param_buckets:   List[Dict],  # list of {expiry_y, tenor_y, alpha, rho, nu}
) -> Optional[Tuple[float, float, float]]:
    """
    Bilinear interpolation of SABR parameters in (log expiry, log tenor) space.

    Interpolating params then computing vol is more stable than interpolating
    vols directly — avoids arbitrage from mixing different SABR shapes.

    Returns (alpha, rho, nu) or None if insufficient data.
    """
    if not param_buckets:
        return None

    # Find unique expiry and tenor grids
    expiries = sorted(set(b['expiry_y'] for b in param_buckets))
    tenors   = sorted(set(b['tenor_y']  for b in param_buckets))

    if len(expiries) < 1 or len(tenors) < 1:
        return None

    # Index by (expiry, tenor)
    bucket_map = {(b['expiry_y'], b['tenor_y']): b for b in param_buckets}

    # Clamp to grid bounds
    te = max(expiries[0],  min(expiries[-1],  target_expiry_y))
    tt = max(tenors[0],    min(tenors[-1],    target_tenor_y))

    # Find bracketing expiries
    e_lo = expiries[0]
    e_hi = expiries[-1]
    for i in range(len(expiries) - 1):
        if expiries[i] <= te <= expiries[i+1]:
            e_lo, e_hi = expiries[i], expiries[i+1]
            break

    # Find bracketing tenors
    t_lo = tenors[0]
    t_hi = tenors[-1]
    for i in range(len(tenors) - 1):
        if tenors[i] <= tt <= tenors[i+1]:
            t_lo, t_hi = tenors[i], tenors[i+1]
            break

    def get(e, t, param):
        """Get param from bucket_map, falling back to nearest."""
        if (e, t) in bucket_map:
            return bucket_map[(e, t)][param]
        # Nearest available
        nearest = min(param_buckets, key=lambda b: (b['expiry_y']-e)**2 + (b['tenor_y']-t)**2)
        return nearest[param]

    # Bilinear weights in log space (more uniform weighting)
    log_e_lo = math.log(max(e_lo, 1e-6))
    log_e_hi = math.log(max(e_hi, 1e-6))
    log_t_lo = math.log(max(t_lo, 1e-6))
    log_t_hi = math.log(max(t_hi, 1e-6))
    log_te   = math.log(max(te,   1e-6))
    log_tt   = math.log(max(tt,   1e-6))

    # Fractional positions
    de = (log_e_hi - log_e_lo)
    dt = (log_t_hi - log_t_lo)
    we = (log_te - log_e_lo) / de if de > 1e-10 else 0.5
    wt = (log_tt - log_t_lo) / dt if dt > 1e-10 else 0.5
    we = max(0.0, min(1.0, we))
    wt = max(0.0, min(1.0, wt))

    def interp_param(param):
        p00 = get(e_lo, t_lo, param)
        p10 = get(e_hi, t_lo, param)
        p01 = get(e_lo, t_hi, param)
        p11 = get(e_hi, t_hi, param)
        return (p00 * (1-we) * (1-wt)
              + p10 * we     * (1-wt)
              + p01 * (1-we) * wt
              + p11 * we     * wt)

    alpha = interp_param('alpha')
    rho   = interp_param('rho')
    nu    = interp_param('nu')

    # Ensure valid ranges
    rho   = max(-0.98, min(0.98,  rho))
    nu    = max(0.001, nu)
    alpha = max(1e-6,  alpha)

    return alpha, rho, nu


# ── DB lookup and vol resolution ─────────────────────────────────────────────

def get_sabr_vol_bp(
    F:          float,    # forward rate (decimal)
    K:          float,    # strike (decimal)
    T:          float,    # expiry in years
    expiry_y:   float,
    tenor_y:    float,
    db,                   # SQLAlchemy session
    valuation_date = None,
) -> Optional[float]:
    """
    Load SABR params from DB and return σ_N(K) in bp.

    Returns None if no SABR surface is available — caller falls back to
    flat ATM vol.

    Lookup priority:
      1. Exact (valuation_date, expiry_y, tenor_y) bucket
      2. Latest available date with bilinear expiry/tenor interpolation
    """
    from sqlalchemy import text
    from datetime import date

    val_date = valuation_date or date.today()

    try:
        # Load all available params for latest date ≤ val_date
        result = db.execute(
            text("""
                SELECT expiry_y, tenor_y, alpha, rho, nu, atm_vol_bp
                FROM sabr_params
                WHERE valuation_date = (
                    SELECT MAX(valuation_date)
                    FROM sabr_params
                    WHERE valuation_date <= :val_date
                )
                ORDER BY expiry_y, tenor_y
            """),
            {"val_date": val_date}
        )
        rows = result.fetchall()

        if not rows:
            return None

        buckets = [
            {
                'expiry_y': row.expiry_y,
                'tenor_y':  row.tenor_y,
                'alpha':    row.alpha,
                'rho':      row.rho,
                'nu':       row.nu,
            }
            for row in rows
        ]

        # Interpolate params
        params = interpolate_sabr_params(expiry_y, tenor_y, buckets)
        if params is None:
            return None

        alpha, rho, nu = params
        vol = normal_sabr_vol(F, K, T, alpha, rho, nu)
        return round(vol * 10000.0, 4)  # return in bp

    except Exception as e:
        log.warning(f"SABR vol lookup failed: {e}")
        return None
