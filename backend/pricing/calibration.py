"""
calibration.py — Sprint 6A (fixed)
HW1F calibration engine for Rijeka XVA module.

CORRECT FORMULA (Andersen & Piterbarg, Vol 1, Section 4.4):

    σ_n(T_e, T_tenor) = σ * w * sqrt(V(T_e)) / sqrt(T_e)

where:
    w = Σ_i [α_i * P(0,T_i) * B*(T_e,T_i)] / A(0)     (duration-weighted B sum)
    B*(T_e, T_i) = (1 - exp(-a*(T_i-T_e))) / a          (bond duration from T_e to T_i)
    V(T_e) = (1 - exp(-2a*T_e)) / (2a)                  (variance of r(T_e))
    P(0, T) = exp(-theta * T)                            (flat curve approx)
    A(0) = Σ_i α_i * P(0, T_i)                          (annuity)

CALIBRATION STRATEGY:
  HW1F with constant (a, sigma) cannot fit the full vol surface.
  It CAN fit a single-tenor column well.
  Standard XVA practice: calibrate to the 5Y-tenor column:
    1Y×5Y, 2Y×5Y, 3Y×5Y, 5Y×5Y
  Expected calibrated params: sigma ~30-40bp, a ~0.02-0.08.

Reference:
  Andersen & Piterbarg (2010) — Interest Rate Modeling, Vol 1
  Brigo & Mercurio (2006) — Interest Rate Models, Ch. 3
"""

import math
import json
from datetime import date
from typing import Optional

import numpy as np
from scipy.optimize import minimize


def hw1f_swaption_vol_normal(
    a: float,
    sigma: float,
    theta: float,
    expiry_y: float,
    tenor_y: float,
    dt: float = 1.0,
) -> float:
    """
    ATM normal vol (bp) for a payer swaption under constant-parameter HW1F.

    Formula:
        σ_n^2 * T_e = σ^2 * [Σ_i w_i * B*(T_e, T_i)]^2 * V(T_e)

    where:
        w_i     = α_i * P(0,T_i) / A(0)              duration weight (Σ w_i = 1)
        B*(a,t,T) = (1-exp(-a*(T-t)))/a              HW bond duration
        V(T_e)  = (1-exp(-2a*T_e))/(2a)             variance of short rate at T_e
        P(0,T)  = exp(-theta*T)                      flat rate discount (approx)
        A(0)    = Σ α_i * P(0,T_i)                  annuity value at t=0
        σ_n (annualised) = σ * |Σ w_i*B_i| * sqrt(V/T_e)

    Parameters
    ----------
    a       : mean reversion speed (e.g. 0.03)
    sigma   : short-rate vol (decimal, e.g. 0.0035 for 35bp)
    theta   : long-run rate (decimal, e.g. 0.0365)
    expiry_y: option expiry in years
    tenor_y : underlying swap tenor in years
    dt      : coupon payment frequency in years (1.0 = annual)

    Returns
    -------
    ATM normal vol in basis points (e.g. 86.5)
    """
    if a < 1e-7:
        a = 1e-7
    if expiry_y <= 0:
        return 0.0

    Te = expiry_y

    # Variance of short rate at T_e (NOT variance of integral!)
    V_Te = (1.0 - math.exp(-2.0 * a * Te)) / (2.0 * a)
    if V_Te <= 0:
        return 0.0

    # Payment dates: T_e + dt, T_e + 2*dt, ..., T_e + tenor_y
    payment_dates = []
    t = Te + dt
    Tm = Te + tenor_y
    while t <= Tm + 1e-9:
        payment_dates.append(t)
        t += dt

    if not payment_dates:
        return 0.0

    # P(0, T_i) = exp(-theta * T_i) — flat rate approximation
    P_vals = [math.exp(-theta * Ti) for Ti in payment_dates]

    # B*(T_e, T_i) = (1-exp(-a*(T_i-T_e)))/a — bond duration from T_e
    B_vals = [(1.0 - math.exp(-a * (Ti - Te))) / a for Ti in payment_dates]

    # Annuity A(0) = Σ dt * P(0, T_i)
    A0 = sum(dt * p for p in P_vals)
    if A0 < 1e-12:
        return 0.0

    # Duration-weighted B: w = [Σ dt * P(0,T_i) * B*(T_e,T_i)] / A(0)
    # This is the sensitivity of the swap rate to the short rate at T_e
    w = sum(dt * P_vals[i] * B_vals[i] for i in range(len(payment_dates))) / A0

    # std(S(T_e)) = sigma * |w| * sqrt(V(T_e))
    # σ_n annualised = std(S(T_e)) / sqrt(T_e)
    sigma_n = sigma * abs(w) * math.sqrt(V_Te / Te)

    return sigma_n * 10000.0  # convert decimal to bp


def calibration_objective(
    params: np.ndarray,
    basket: list,
    theta: float,
) -> float:
    """
    Weighted RMSE between market ATM normal vols and HW1F model vols.
    """
    a     = float(params[0])
    sigma = float(params[1]) / 10000.0  # bp → decimal

    if a <= 0 or sigma <= 0:
        return 1e6

    total = 0.0
    count = 0
    for inst in basket:
        try:
            mdl = hw1f_swaption_vol_normal(
                a, sigma, theta,
                inst['expiry_y'],
                inst['tenor_y'],
            )
            err = (mdl - inst['vol_bp']) * inst.get('weight', 1.0)
            total += err * err
            count += 1
        except Exception:
            total += 1e6
            count += 1

    return math.sqrt(total / count) if count > 0 else 1e6


def calibrate_hw1f(
    basket: list,
    theta: float = 0.0365,
    a_init: float = 0.03,
    sigma_bp_init: float = 35.0,
    a_bounds: tuple = (0.001, 0.50),
    sigma_bounds: tuple = (5.0, 150.0),
) -> dict:
    """
    Calibrate HW1F (a, sigma) to ATM swaption basket.

    NOTE: constant-parameter HW1F fits one tenor column well.
    Default basket should use 5Y-tenor swaptions: 1Y×5Y, 2Y×5Y, 3Y×5Y, 5Y×5Y.
    Expected results: sigma ~30-40bp, a ~0.02-0.08, RMSE < 3bp.

    Parameters
    ----------
    basket : list of dicts with keys:
        expiry_y, tenor_y, vol_bp, ticker, role, weight (optional)
    theta  : long-run rate from 5Y SOFR swap rate (decimal)
    """
    if not basket:
        raise ValueError("Calibration basket is empty")

    x0     = np.array([a_init, sigma_bp_init])
    bounds = [a_bounds, sigma_bounds]

    result = minimize(
        calibration_objective,
        x0,
        args=(basket, theta),
        method='L-BFGS-B',
        bounds=bounds,
        options={'maxiter': 1000, 'ftol': 1e-14, 'gtol': 1e-10},
    )

    a_cal       = float(result.x[0])
    sigma_bp_cal = float(result.x[1])
    sigma_cal   = sigma_bp_cal / 10000.0

    # Per-instrument fit
    fit_details = []
    sq_errors   = []
    for inst in basket:
        try:
            mdl_vol = hw1f_swaption_vol_normal(
                a_cal, sigma_cal, theta,
                inst['expiry_y'], inst['tenor_y'],
            )
        except Exception:
            mdl_vol = None

        err_bp = (mdl_vol - inst['vol_bp']) if mdl_vol is not None else None
        if err_bp is not None:
            sq_errors.append(err_bp ** 2)

        fit_details.append({
            'ticker':     inst.get('ticker', ''),
            'expiry_y':   inst['expiry_y'],
            'tenor_y':    inst['tenor_y'],
            'role':       inst.get('role', ''),
            'mkt_vol_bp': round(inst['vol_bp'], 2),
            'mdl_vol_bp': round(mdl_vol, 2) if mdl_vol is not None else None,
            'error_bp':   round(err_bp, 3) if err_bp is not None else None,
        })

    rmse = math.sqrt(sum(sq_errors) / len(sq_errors)) if sq_errors else None

    return {
        'a':           round(a_cal, 6),
        'sigma_bp':    round(sigma_bp_cal, 3),
        'theta':       round(theta, 6),
        'fit_rmse_bp': round(rmse, 4) if rmse is not None else None,
        'basket_size': len(basket),
        'fit_details': fit_details,
        'converged':   bool(result.success),
        'iterations':  int(result.nit),
    }


# Internal alias
hw1f_swaptions_vol_normal = hw1f_swaption_vol_normal


def tenor_to_years(tenor: str) -> float:
    """Convert tenor string to years. '1Y' -> 1.0, '6M' -> 0.5 etc."""
    tenor = tenor.strip().upper()
    if   tenor.endswith('Y'): return float(tenor[:-1])
    elif tenor.endswith('M'): return float(tenor[:-1]) / 12.0
    elif tenor.endswith('W'): return float(tenor[:-1]) / 52.0
    else:                     return float(tenor)
