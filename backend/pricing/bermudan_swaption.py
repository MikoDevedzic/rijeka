"""
Rijeka — HW1F Bermudan Swaption Pricer (Sprint 13)

Hull-White 1-factor short-rate model with deterministic shift α(t) fit to the
initial discount curve, priced via the standard trinomial tree of
Hull & White (1994) / Brigo & Mercurio (2006) §24.2.

Architecture
------------
1. Affine bond machinery — closed-form A(t,T), B(t,T) per Brigo-Mercurio Eq 24.21.
2. HW1F trinomial tree with α(t) calibrated to fit P^M(0,t) at every grid time
   via the standard Arrow-Debreu forward induction.
3. Backward induction with optional early-exercise check at exercise dates.

Validation gate
---------------
HW1F-tree-European MUST match Bachelier-European (price_swaption from swaption.py)
within 0.5% relative for ATM, 1% relative for ±100bp wings, on a calibrated set
of (expiry × tenor) grid points. If the gate fails the tree pricer is unsafe;
Bermudan numbers from it are not trusted.

Methodology gate (per CHARTER §2 / TAXONOMY §1.11.1)
----------------------------------------------------
- Multi-curve (forecast ≠ discount) → NotImplementedError. HW1F is single-rate.
- Bermudan on capped/floored underlying → NotImplementedError. Joint cap-vol
  calibration not in scope; deferred to a future sprint with HW1F+SABR coupling.
- Bermudan on BASIS underlying → NotImplementedError. Two-rate model needed.
- Bermudan into-tenor far from 5Y → flagged (not blocked). HW1F is calibrated
  to the 5Y-tenor column per Sprint 6A/6B; into-2Y or into-10Y carry mismatch
  inherent to single-tenor HW1F. Result includes a `tenor_calibration_warning`.

Single-curve setup
------------------
Forecast = discount = OIS curve. Floating leg PV via the standard telescoping
identity: PV_float(t) = Σ_k N_k·[P(t, T_{k-1}) - P(t, T_k)]. Holds for amortizing
notional with no principal exchange (the Phase-1 amortizing convention).

References
----------
- Hull, J. & White, A. (1994). Numerical procedures for implementing term
  structure models I. Journal of Derivatives, 2(1), 7-16.
- Brigo, D. & Mercurio, F. (2006). Interest Rate Models — Theory and Practice
  (2nd ed.). Springer. Chapter 3 (HW1F bond pricing) and §24.2 (trinomial tree).
- Andersen, L. & Piterbarg, V. (2010). Interest Rate Modeling, Vol I-III.
  Atlantic Financial Press. Vol 1 §10 for trinomial discretization details.
"""

import math
from datetime import date, timedelta
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Protocol, Sequence

import numpy as np


# ─────────────────────────────────────────────────────────────────────────────
# Curve interface
# ─────────────────────────────────────────────────────────────────────────────
#
# The tree uses year-fractions internally for sub-day precision. Production
# callers wrap their date-based Curve via `discount_fn_from_curve(curve)`.
# Tests pass `lambda t: exp(-r*t)` directly for continuous-time exactness.

DiscountFn = "Callable[[float], float]"  # discount(year_fraction) -> P(0, t)


class CurveLike(Protocol):
    """Minimal date-based Curve interface (matches pricing.curve.Curve)."""
    valuation_date: date
    def df(self, d: date) -> float: ...


# discount_fn_from_curve lives in pricing.curve; re-exported here for callers
# that imported it from this module.
from pricing.curve import discount_fn_from_curve  # noqa: E402,F401


# ─────────────────────────────────────────────────────────────────────────────
# Affine bond machinery (HW1F)
# ─────────────────────────────────────────────────────────────────────────────

def hw1f_B(a: float, tau: float) -> float:
    """B(t,T) = (1 - exp(-a·τ)) / a, where τ = T - t (years)."""
    if tau <= 0:
        return 0.0
    if a < 1e-9:
        # Limit a → 0: B → τ
        return tau
    return (1.0 - math.exp(-a * tau)) / a


def market_inst_forward(discount_fn, t_years: float,
                        delta_y: float = 1.0 / 365.25) -> float:
    """
    Market instantaneous forward rate f^M(0, t) via numerical derivative.
    f(0, t) = -d ln P(0, t) / dt.

    `delta_y` defaults to 1/365.25 ≈ 1 day year-fraction. Sprint 13B hotfix
    raised this from 1/(365.25·24) ≈ 1 hour. The 1-hour default sat below
    the calendar-day rounding granularity of `discount_fn_from_curve` —
    asking for `df(t ± 1 hour)` returned identical DFs on both sides, the
    derivative collapsed to zero, and downstream `hw1f_A` blew up by ~30x.
    1-day is the coarsest the production curve can answer; on clean
    year-fraction discount fns (e.g., the test fixtures) it still gives
    sharp derivatives because the underlying function is continuous.
    """
    t_minus = max(0.0, t_years - delta_y)
    t_plus  = t_years + delta_y
    p_minus = discount_fn(t_minus)
    p_plus  = discount_fn(t_plus)
    if p_minus <= 0 or p_plus <= 0:
        return 0.0
    # Silent-zero guard — if both sides round to identical DFs while the
    # underlying P(0,t) is meaningfully different from 1, we have a
    # calendar-rounding collapse. Caller should pass a coarser delta_y or
    # use the year-fraction discount_fn route directly.
    if (abs(p_plus - p_minus) < 1e-14
            and abs(discount_fn(t_years) - 1.0) > 1e-3):
        import warnings
        warnings.warn(
            f"market_inst_forward: numerical derivative collapsed at "
            f"t={t_years:.4f}y with delta_y={delta_y:.6f}. Discount fn "
            f"likely has calendar-day rounding finer than the probe step. "
            f"Returning 0.0 — downstream HW1F prices will be biased.",
            RuntimeWarning, stacklevel=2,
        )
        return 0.0
    return -(math.log(p_plus) - math.log(p_minus)) / (t_plus - t_minus)


def hw1f_A(a: float, sigma: float, t_years: float, T_years: float,
           discount_fn) -> float:
    """
    HW1F bond-price A factor:
      A(t,T) = (P^M(0,T) / P^M(0,t)) ·
               exp[ B(t,T)·f^M(0,t) - (σ²/(4a))·(1-exp(-2at))·B(t,T)² ]
    Brigo-Mercurio Eq 24.21.
    """
    if T_years <= t_years:
        return 1.0
    P_T = discount_fn(T_years)
    P_t = discount_fn(t_years)
    if P_T <= 0 or P_t <= 0:
        return 0.0
    f0t = market_inst_forward(discount_fn, t_years)
    B   = hw1f_B(a, T_years - t_years)

    if a < 1e-9:
        var_term = 0.5 * sigma * sigma * t_years * B * B
    else:
        var_term = (sigma * sigma / (4.0 * a)) * (1.0 - math.exp(-2.0 * a * t_years)) * B * B

    return (P_T / P_t) * math.exp(B * f0t - var_term)


def hw1f_bond_price(a: float, sigma: float, t_years: float, T_years: float,
                    r: float, discount_fn) -> float:
    """P(t, T | r(t) = r) = A(t,T) · exp(-B(t,T)·r)."""
    if T_years <= t_years:
        return 1.0
    A = hw1f_A(a, sigma, t_years, T_years, discount_fn)
    B = hw1f_B(a, T_years - t_years)
    return A * math.exp(-B * r)


# ─────────────────────────────────────────────────────────────────────────────
# Jamshidian closed-form European swaption (validation reference)
# ─────────────────────────────────────────────────────────────────────────────
#
# HW1F admits an exact closed-form European swaption price via Jamshidian's
# decomposition (Brigo-Mercurio §3.11): a payer (resp. receiver) swaption is a
# put (resp. call) on a coupon-bond, which under HW1F decomposes into a sum of
# puts (resp. calls) on zero-coupon bonds — each of which has a closed-form
# Black-style price under the T_e-forward measure.
#
# This function is the gold standard against which the trinomial tree is
# benchmarked. It replaces the (incorrect) Bachelier-with-analytic-vol
# reference used in earlier iterations of the validation gate. The
# Andersen-Piterbarg analytic vol formula in calibration.py has a ~3x error
# in the duration-weight term — see SPRINT_13 spec for details — so it must
# NOT be used as a tree validation reference.

def _hw1f_zbo_price(a: float, sigma: float, T_e: float, T_k: float,
                    K_strike: float, discount_fn,
                    is_call: bool) -> float:
    """
    Closed-form HW1F price of a European option (call or put) struck at
    `K_strike` on a zero-coupon bond P(T_e, T_k), evaluated at t=0.

    Formula (Brigo-Mercurio Eq 3.40-3.42):
        σ_p   = σ · sqrt[(1 - exp(-2a·T_e))/(2a)] · B(T_e, T_k)
        h     = (1/σ_p) · ln[ P(0,T_k) / (P(0,T_e) · K_strike) ] + σ_p / 2
        ZBC   = P(0,T_k) · N(h)        − K · P(0,T_e) · N(h - σ_p)
        ZBP   = K · P(0,T_e) · N(σ_p - h) − P(0,T_k) · N(-h)
    """
    if T_k <= T_e:
        # Bond matures at or before option expiry: pays 1 - K_strike at T_e.
        # Call: max(1 - K, 0) · P(0,T_e); Put: max(K - 1, 0) · P(0,T_e).
        intrinsic = max(1.0 - K_strike, 0.0) if is_call else max(K_strike - 1.0, 0.0)
        return intrinsic * discount_fn(T_e)

    P_Te = discount_fn(T_e)
    P_Tk = discount_fn(T_k)
    if P_Te <= 0 or P_Tk <= 0 or K_strike <= 0:
        return 0.0

    if a < 1e-9:
        # a → 0 limit:  σ_p² ≈ σ² · T_e · (T_k - T_e)²  (just for completeness)
        sigma_p = sigma * math.sqrt(T_e) * (T_k - T_e)
    else:
        var_factor = (1.0 - math.exp(-2.0 * a * T_e)) / (2.0 * a)
        B_TeTk    = (1.0 - math.exp(-a * (T_k - T_e))) / a
        sigma_p   = sigma * math.sqrt(var_factor) * B_TeTk

    if sigma_p < 1e-14:
        # Degenerate: exercise at deterministic forward bond price = P(0,T_k)/P(0,T_e)
        fwd = P_Tk / P_Te
        if is_call:
            return P_Te * max(fwd - K_strike, 0.0)
        else:
            return P_Te * max(K_strike - fwd, 0.0)

    h = math.log(P_Tk / (P_Te * K_strike)) / sigma_p + 0.5 * sigma_p

    def _N(x):
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    if is_call:
        return P_Tk * _N(h) - K_strike * P_Te * _N(h - sigma_p)
    else:
        return K_strike * P_Te * _N(sigma_p - h) - P_Tk * _N(-h)


def price_european_swaption_hw1f_jamshidian(
    notional         : float,
    fixed_rate       : float,
    is_payer         : bool,
    expiry_y         : float,
    payment_dates_y  : List[float],
    period_dcf       : List[float],
    a                : float,
    sigma            : float,
    discount_fn,
    notional_schedule: Optional[List[float]] = None,
    r_search_lo      : float = -0.50,
    r_search_hi      : float = +0.50,
) -> Dict[str, Any]:
    """
    Exact HW1F European swaption price via Jamshidian decomposition.

    Supports amortizing notionals. Forward-starting at T_e = expiry_y.

    Returns dict with `npv`, `r_star` (decomposition pivot), `coupon_strikes`
    (per-period ZCB strikes), and per-period ZBO contributions.

    Mathematics
    -----------
    Forward-start swap value at T_e:
        PV_payer(T_e) = N_1 - Σ_k c_k · P(T_e, T_k)
    where (with notional N_k and dcf α_k):
        c_k =  (N_k - N_{k+1}) + K · N_k · α_k     for k = 1..M-1
        c_M =   N_M             + K · N_M · α_M
    (For bullet N_k ≡ N: c_k = K·N·α_k for k<M; c_M = N + K·N·α_M.)

    Find r* ∈ R such that  Σ_k c_k · P(T_e, T_k | r(T_e) = r*) = N_1.
    Then the per-period ZCB strike is K_k = P(T_e, T_k | r*).

    Under HW1F (one-factor, monotonic in r) the put on the coupon bond
    decomposes into a sum of puts on the underlying ZCBs:
        Payer    = Σ c_k · ZBP(0, T_e, T_k, K_k)
        Receiver = Σ c_k · ZBC(0, T_e, T_k, K_k)
    """
    from scipy.optimize import brentq

    n_periods = len(payment_dates_y)
    if notional_schedule is None:
        N_per = [notional] * n_periods
    else:
        if len(notional_schedule) != n_periods:
            raise ValueError("notional_schedule length must match payment_dates_y")
        N_per = list(notional_schedule)

    K = fixed_rate

    # Coupon-bond cash flows c_k (positive when amortizing decreasing + K > 0)
    c = [0.0] * n_periods
    for k in range(n_periods - 1):
        c[k] = (N_per[k] - N_per[k + 1]) + K * N_per[k] * period_dcf[k]
    c[n_periods - 1] = N_per[n_periods - 1] + K * N_per[n_periods - 1] * period_dcf[n_periods - 1]

    # Strike of the put-on-coupon-bond (forward-start: PV_float(T_e) = N_1)
    coupon_strike = N_per[0]

    # Solve for r* such that bond-PV at T_e equals N_1.
    def _cb_value(r):
        s = 0.0
        for k in range(n_periods):
            T_k = payment_dates_y[k]
            P_TeTk = hw1f_bond_price(a, sigma, expiry_y, T_k, r, discount_fn)
            s += c[k] * P_TeTk
        return s - coupon_strike

    # Bracket — must straddle zero.
    f_lo = _cb_value(r_search_lo)
    f_hi = _cb_value(r_search_hi)
    if f_lo * f_hi > 0:
        # Try widening
        for w in [1.0, 2.0, 5.0]:
            f_lo = _cb_value(-w)
            f_hi = _cb_value(+w)
            if f_lo * f_hi <= 0:
                r_search_lo, r_search_hi = -w, +w
                break
        else:
            raise RuntimeError(
                f"Jamshidian: could not bracket r* in [{-w}, {+w}]. "
                f"f({-w})={f_lo:.4e}, f({+w})={f_hi:.4e}. "
                f"Coupon-bond likely non-monotone in r — check c_k ≥ 0."
            )

    r_star = brentq(_cb_value, r_search_lo, r_search_hi, xtol=1e-12, rtol=1e-12)

    # Per-period ZCB strikes
    K_per = [
        hw1f_bond_price(a, sigma, expiry_y, payment_dates_y[k], r_star, discount_fn)
        for k in range(n_periods)
    ]

    # Sum the ZBO contributions
    contribs = []
    npv = 0.0
    is_call_zbo = not is_payer  # payer = put on CB; receiver = call on CB
    for k in range(n_periods):
        zbo = _hw1f_zbo_price(
            a, sigma, expiry_y, payment_dates_y[k], K_per[k],
            discount_fn, is_call=is_call_zbo,
        )
        contribs.append({
            "k":      k,
            "T_k":    payment_dates_y[k],
            "c_k":    c[k],
            "K_k":    K_per[k],
            "ZBO_k":  zbo,
            "weighted": c[k] * zbo,
        })
        npv += c[k] * zbo

    return {
        "npv":            float(npv),
        "r_star":         float(r_star),
        "coupon_strike":  float(coupon_strike),
        "coupon_flows":   list(c),
        "zcb_strikes":    K_per,
        "contributions":  contribs,
        "is_payer":       is_payer,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Trinomial tree
# ─────────────────────────────────────────────────────────────────────────────

class HW1FTrinomialTree:
    """
    Hull-White 1F trinomial tree.

    Decomposition: r(t) = α(t) + x(t), where dx = -a·x·dt + σ·dW, x(0) = 0.
    Build:
      1. Time grid:  t_i = i·Δt, i = 0..N.
      2. Space grid: x_{i,j} = j·Δx, Δx = σ·sqrt(3·Δt).
      3. j_max = ceil(0.184 / (a·Δt)) — boundary truncation.
      4. Transition probabilities: standard branching for |j| < j_max,
         down-branching at +j_max, up-branching at -j_max.
      5. α(t_i) fit by forward induction so that the tree exactly reprices
         P^M(0, t_{i+1}) at every step.

    After construction, short rate at node (i, j): r_{i,j} = α(t_i) + j·Δx.
    """

    def __init__(self, a: float, sigma: float, T_max_years: float,
                 dt: float, discount_fn):
        if a <= 0:
            raise ValueError(f"a must be positive, got {a}")
        if sigma <= 0:
            raise ValueError(f"sigma must be positive, got {sigma}")
        if dt <= 0:
            raise ValueError(f"dt must be positive, got {dt}")
        if T_max_years <= 0:
            raise ValueError(f"T_max_years must be positive, got {T_max_years}")

        self.a            = a
        self.sigma        = sigma
        self.dt           = dt
        self.discount_fn  = discount_fn

        # Time grid
        self.N     = max(1, int(math.ceil(T_max_years / dt + 1e-9)))
        self.times = np.array([i * dt for i in range(self.N + 1)])

        # Space grid
        self.dx = sigma * math.sqrt(3.0 * dt)

        # j_max — boundary at which probabilities mutate to keep p ≥ 0
        # Hull-White (1994) §7.1: 0.184 / (a·Δt)
        if a * dt > 1e-12:
            self.j_max = max(3, int(math.ceil(0.184 / (a * dt))))
        else:
            self.j_max = 50

        self._build_probs()
        self._fit_alpha()

    # ── Probabilities ────────────────────────────────────────────────────────
    def _build_probs(self):
        """
        Probabilities p_up, p_mid, p_down indexed by k = j + j_max.
        Destinations depend on j:
          - |j| < j_max: standard branching to (j+1, j, j-1)
          - j = +j_max:  down-branching to (j_max, j_max-1, j_max-2)
          - j = -j_max:  up-branching to (-j_max+2, -j_max+1, -j_max)
        Slot (p_up, p_mid, p_down) holds the prob of the FIRST, SECOND, THIRD
        destinations in the branch tuple respectively.
        """
        a, dt, j_max = self.a, self.dt, self.j_max
        self.p_up   = np.zeros(2 * j_max + 1)
        self.p_mid  = np.zeros(2 * j_max + 1)
        self.p_down = np.zeros(2 * j_max + 1)

        for j in range(-j_max, j_max + 1):
            k          = j + j_max
            adt        = a * dt
            j2adt2     = (j * adt) ** 2
            jadt       = j * adt

            if j == j_max:
                # Down branching: dests = (j_max, j_max-1, j_max-2)
                # p_up → j_max, p_mid → j_max-1, p_down → j_max-2
                self.p_up[k]   = 7.0/6.0 + (j2adt2 - 3.0 * jadt) / 2.0
                self.p_mid[k]  = -1.0/3.0 - j2adt2 + 2.0 * jadt
                self.p_down[k] = 1.0/6.0 + (j2adt2 - jadt) / 2.0
            elif j == -j_max:
                # Up branching: dests = (-j_max+2, -j_max+1, -j_max)
                self.p_up[k]   = 1.0/6.0 + (j2adt2 + jadt) / 2.0
                self.p_mid[k]  = -1.0/3.0 - j2adt2 - 2.0 * jadt
                self.p_down[k] = 7.0/6.0 + (j2adt2 + 3.0 * jadt) / 2.0
            else:
                # Standard branching: dests = (j+1, j, j-1)
                self.p_up[k]   = 1.0/6.0 + (j2adt2 - jadt) / 2.0
                self.p_mid[k]  = 2.0/3.0 - j2adt2
                self.p_down[k] = 1.0/6.0 + (j2adt2 + jadt) / 2.0

        # Sanity: probabilities sum to 1 and stay in [0, 1]
        total = self.p_up + self.p_mid + self.p_down
        if not np.allclose(total, 1.0, atol=1e-10):
            raise ValueError(f"Tree probabilities don't sum to 1: max abs error = "
                             f"{np.max(np.abs(total - 1.0))}")
        # Allow tiny negative due to floating point
        for arr_name in ('p_up', 'p_mid', 'p_down'):
            arr = getattr(self, arr_name)
            if np.min(arr) < -1e-10:
                raise ValueError(f"Negative probability in {arr_name}: "
                                 f"{np.min(arr)} at j-index {np.argmin(arr) - j_max}")

    # ── α(t) fit via forward induction ───────────────────────────────────────
    def _fit_alpha(self):
        """
        Forward induction (BM §24.2.4 / Hull-White 1994):
          Q[0, j=0] = 1; Q[0, j≠0] = 0.
          α[i] solves P^M(0, t_{i+1}) = exp(-α[i]·Δt) · Σ_j Q[i,j]·exp(-j·Δx·Δt).
          Q[i+1, k] = Σ_j Q[i,j] · p(j→k) · exp(-(α[i] + j·Δx)·Δt).
        """
        N, j_max, dt, dx = self.N, self.j_max, self.dt, self.dx
        self.alpha = np.zeros(N + 1)
        Q = np.zeros((N + 1, 2 * j_max + 1))
        Q[0, j_max] = 1.0   # j = 0 maps to k = j_max

        for i in range(N + 1):
            j_lo = max(-j_max, -i)
            j_hi = min( j_max,  i)

            if i < N:
                t_next = self.times[i + 1]
                P_next = self.discount_fn(t_next)
                if P_next <= 0:
                    raise ValueError(f"discount_fn gave non-positive P(0, {t_next}y) = {P_next}")

                # S(i) = Σ_j Q[i,j] · exp(-j·Δx·Δt)
                S = 0.0
                for j in range(j_lo, j_hi + 1):
                    k = j + j_max
                    if Q[i, k] != 0.0:
                        S += Q[i, k] * math.exp(-j * dx * dt)
                if S <= 0:
                    raise ValueError(f"Forward induction sum non-positive at step {i}: S={S}")

                self.alpha[i] = -math.log(P_next / S) / dt

                # Roll Q forward: Q[i+1, dest] += Q[i, k] · p(j→dest) · exp(-r(i,j)·Δt)
                alpha_i = self.alpha[i]
                for j in range(j_lo, j_hi + 1):
                    k = j + j_max
                    q = Q[i, k]
                    if q == 0.0:
                        continue
                    r_ij     = alpha_i + j * dx
                    discount = math.exp(-r_ij * dt)

                    if j == j_max:
                        dests = (j_max, j_max - 1, j_max - 2)
                    elif j == -j_max:
                        dests = (-j_max + 2, -j_max + 1, -j_max)
                    else:
                        dests = (j + 1, j, j - 1)

                    Q[i+1, dests[0] + j_max] += q * self.p_up[k]   * discount
                    Q[i+1, dests[1] + j_max] += q * self.p_mid[k]  * discount
                    Q[i+1, dests[2] + j_max] += q * self.p_down[k] * discount

        self._Q = Q  # cached for diagnostics

    # ── Public access ────────────────────────────────────────────────────────
    def short_rate(self, i: int, j: int) -> float:
        return self.alpha[i] + j * self.dx

    def step_destinations(self, j: int):
        """Return the (top, mid, bot) j-destinations from node index j."""
        if j == self.j_max:
            return (self.j_max, self.j_max - 1, self.j_max - 2)
        if j == -self.j_max:
            return (-self.j_max + 2, -self.j_max + 1, -self.j_max)
        return (j + 1, j, j - 1)

    def discount_curve_check(self, max_rel_err: float = 1e-6) -> Dict[str, Any]:
        """Confirm the tree reprices P^M(0, t_i) at every grid time."""
        max_err = 0.0
        details = []
        for i in range(self.N + 1):
            t   = self.times[i]
            P_M = self.discount_fn(t)
            P_tree = float(np.sum(self._Q[i]))
            rel_err = abs(P_tree - P_M) / max(abs(P_M), 1e-12)
            max_err = max(max_err, rel_err)
            details.append({"step": i, "t": t, "P_M": P_M, "P_tree": P_tree, "rel_err": rel_err})
        return {"max_rel_err": max_err, "passed": max_err <= max_rel_err, "details": details}


# ─────────────────────────────────────────────────────────────────────────────
# Underlying swap PV at any tree node
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SwapTerms:
    """
    Underlying swap of a swaption.

    payment_dates_y : T_1, ..., T_N — fixed-leg payment times (years from val date)
    period_dcf      : α_1, ..., α_N — day-count fractions per period (ACT/360 etc)
    notional        : N_1, ..., N_N — notional in each period (length must equal payment_dates_y).
                      Bullet swap: all N_i identical.
                      Amortizing: N_i strictly decreasing.
    fixed_rate      : K — fixed coupon rate (decimal, e.g. 0.0365 = 3.65%)
    is_payer        : True = swaption holder pays fixed (long rate risk)
    effective_y     : T_0 — swap effective time (years from val date).
                      Floating leg accrues from T_0; first fixed payment at T_1.
    """
    payment_dates_y : List[float]
    period_dcf      : List[float]
    notional        : List[float]
    fixed_rate      : float
    is_payer        : bool
    effective_y     : float

    def __post_init__(self):
        n = len(self.payment_dates_y)
        if len(self.period_dcf) != n:
            raise ValueError("period_dcf length must equal payment_dates_y length")
        if len(self.notional) != n:
            raise ValueError("notional length must equal payment_dates_y length")
        if any(self.payment_dates_y[i] >= self.payment_dates_y[i+1] for i in range(n-1)):
            raise ValueError("payment_dates_y must be strictly increasing")
        if self.effective_y >= self.payment_dates_y[0]:
            raise ValueError("effective_y must precede first payment date")


def swap_pv_at_node(tree: HW1FTrinomialTree, i: int, j: int,
                    terms: SwapTerms) -> float:
    """
    PV of the underlying swap at node (i, j) — single-curve assumption.

      Payer PV   = Σ_k N_k · [P(t, T_{k-1}) - P(t, T_k)]   (float leg, telescoping)
                 - Σ_k N_k · K · α_k · P(t, T_k)            (fixed leg)
      Receiver PV = − Payer PV

    Convention: at exercise time t_i, the option holder steps into a forward-
    starting swap. We require effective_y ≥ t_i (validated by caller); periods
    that have already passed (T_k ≤ t_i) contribute zero.
    """
    a, sigma     = tree.a, tree.sigma
    t_i          = tree.times[i]
    r            = tree.short_rate(i, j)
    discount_fn  = tree.discount_fn

    pv_float = 0.0
    pv_fixed = 0.0

    for k in range(len(terms.payment_dates_y)):
        T_prev = terms.effective_y if k == 0 else terms.payment_dates_y[k - 1]
        T_curr = terms.payment_dates_y[k]
        N_k    = terms.notional[k]
        alpha_k = terms.period_dcf[k]

        if T_curr <= t_i:
            continue  # period already past

        P_curr = hw1f_bond_price(a, sigma, t_i, T_curr, r, discount_fn)

        if T_prev <= t_i:
            # Period in flight — for forward-starting Bermudan, the spec
            # requires effective_y to coincide with one of the exercise dates.
            # If we land here it means an exercise mid-period; treat the
            # period as starting from t_i (rare, sanity branch).
            P_prev = 1.0
        else:
            P_prev = hw1f_bond_price(a, sigma, t_i, T_prev, r, discount_fn)

        pv_float += N_k * (P_prev - P_curr)
        pv_fixed += N_k * terms.fixed_rate * alpha_k * P_curr

    payer_pv = pv_float - pv_fixed
    return payer_pv if terms.is_payer else -payer_pv


# ─────────────────────────────────────────────────────────────────────────────
# Backward induction pricer
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SwaptionTreeResult:
    npv                       : float
    european_npv              : float
    early_exercise_premium    : float
    n_exercise_dates          : int
    tree_steps                : int
    tree_j_max                : int
    discount_check_max_relerr : float
    tenor_calibration_warning : Optional[str] = None
    debug                     : Dict[str, Any] = field(default_factory=dict)


def price_swaption_via_tree(tree: HW1FTrinomialTree,
                            exercise_times_y : Sequence[float],
                            terms            : SwapTerms,
                            ) -> SwaptionTreeResult:
    """
    Price a swaption (European or Bermudan) on the supplied tree.

    European is a special case: pass exactly one exercise time.
    Bermudan: pass the full schedule of exercise times in ascending order.

    All exercise times must align with the tree's time grid (`dt`).
    Misaligned exercise times → ValueError.

    Computes the European value alongside (using only the last exercise time)
    so callers get the early-exercise premium for free.
    """
    # ── Validation ───────────────────────────────────────────────────────────
    if len(exercise_times_y) == 0:
        raise ValueError("Need at least one exercise time")
    sorted_ex = sorted(exercise_times_y)
    if any(sorted_ex[i] >= sorted_ex[i+1] for i in range(len(sorted_ex)-1)):
        raise ValueError("Exercise times must be strictly increasing")
    if sorted_ex[0] <= 0:
        raise ValueError("Exercise times must be positive")
    if sorted_ex[-1] > tree.times[-1] + 1e-9:
        raise ValueError(f"Last exercise time {sorted_ex[-1]} exceeds tree horizon {tree.times[-1]}")
    if terms.effective_y < sorted_ex[0] - 1e-9:
        raise ValueError(f"effective_y ({terms.effective_y}) precedes first exercise "
                         f"({sorted_ex[0]}). Forward-start expected on exercise.")

    # Snap to tree steps
    exercise_steps_set = set()
    for t_ex in sorted_ex:
        i_step = int(round(t_ex / tree.dt))
        snap_err = abs(i_step * tree.dt - t_ex)
        if snap_err > 1e-6:
            raise ValueError(f"Exercise time {t_ex}y misaligned with tree dt={tree.dt}: "
                             f"snap error {snap_err:.2e}")
        if i_step <= 0 or i_step > tree.N:
            raise ValueError(f"Exercise step {i_step} out of bounds [1, {tree.N}]")
        exercise_steps_set.add(i_step)

    european_step = max(exercise_steps_set)

    # ── Backward induction ──────────────────────────────────────────────────
    j_max = tree.j_max
    N     = tree.N
    dt    = tree.dt

    V_berm = np.zeros(2 * j_max + 1)   # Bermudan value
    V_eur  = np.zeros(2 * j_max + 1)   # European value (only last ex date allowed)

    # Terminal step: only contributes if N is itself an exercise step.
    # In our convention exercise_steps_set ⊆ [1..N], and european_step is
    # always at the last of those — so terminal is the European exercise.
    if N == european_step:
        for j in range(-min(N, j_max), min(N, j_max) + 1):
            k        = j + j_max
            swap_pv  = swap_pv_at_node(tree, N, j, terms)
            V_eur[k]  = max(swap_pv, 0.0)
            V_berm[k] = max(swap_pv, 0.0) if N in exercise_steps_set else 0.0

    # Roll back from N-1 to 0
    for i in range(N - 1, -1, -1):
        V_berm_new = np.zeros(2 * j_max + 1)
        V_eur_new  = np.zeros(2 * j_max + 1)

        j_lo = max(-j_max, -i)
        j_hi = min( j_max,  i)

        for j in range(j_lo, j_hi + 1):
            k        = j + j_max
            r_ij     = tree.short_rate(i, j)
            discount = math.exp(-r_ij * dt)

            if j == j_max:
                dests = (j_max, j_max - 1, j_max - 2)
            elif j == -j_max:
                dests = (-j_max + 2, -j_max + 1, -j_max)
            else:
                dests = (j + 1, j, j - 1)

            cont_berm = (
                tree.p_up[k]   * V_berm[dests[0] + j_max]
              + tree.p_mid[k]  * V_berm[dests[1] + j_max]
              + tree.p_down[k] * V_berm[dests[2] + j_max]
            ) * discount
            cont_eur  = (
                tree.p_up[k]   * V_eur[dests[0] + j_max]
              + tree.p_mid[k]  * V_eur[dests[1] + j_max]
              + tree.p_down[k] * V_eur[dests[2] + j_max]
            ) * discount

            if i in exercise_steps_set:
                swap_pv = swap_pv_at_node(tree, i, j, terms)
                immediate = max(swap_pv, 0.0)
                V_berm_new[k] = max(cont_berm, immediate)
                # European: only exercise at european_step
                if i == european_step:
                    V_eur_new[k] = max(cont_eur, immediate)
                else:
                    V_eur_new[k] = cont_eur
            else:
                V_berm_new[k] = cont_berm
                V_eur_new[k]  = cont_eur

        V_berm = V_berm_new
        V_eur  = V_eur_new

    # Root value at j = 0 → k = j_max
    npv_berm = float(V_berm[j_max])
    npv_eur  = float(V_eur[j_max])
    eep      = max(0.0, npv_berm - npv_eur)

    # Discount-curve fit diagnostic
    chk = tree.discount_curve_check()

    return SwaptionTreeResult(
        npv                       = npv_berm,
        european_npv              = npv_eur,
        early_exercise_premium    = eep,
        n_exercise_dates          = len(exercise_steps_set),
        tree_steps                = tree.N,
        tree_j_max                = tree.j_max,
        discount_check_max_relerr = chk["max_rel_err"],
        debug                     = {
            "alpha_t0":       float(tree.alpha[0]),
            "alpha_tN_minus": float(tree.alpha[-2]) if tree.N > 1 else 0.0,
            "dx":             tree.dx,
            "dt":             tree.dt,
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# Public API: end-to-end Bermudan swaption pricing
# ─────────────────────────────────────────────────────────────────────────────

def price_bermudan_swaption_hw1f(
    notional         : float,
    fixed_rate       : float,
    is_payer         : bool,
    effective_y      : float,
    payment_dates_y  : List[float],
    period_dcf       : List[float],
    exercise_times_y : List[float],
    a                : float,
    sigma            : float,
    discount_curve   : Optional[CurveLike]               = None,
    valuation_date   : Optional[date]                    = None,
    discount_fn      : Optional["Callable[[float], float]"] = None,
    notional_schedule: Optional[List[float]]             = None,
    forecast_curve   : Optional[CurveLike]               = None,
    embedded_options : Optional[List[Dict]]              = None,
    dt               : float = 1.0 / 12.0,
) -> SwaptionTreeResult:
    """
    Price a Bermudan (or European) swaption under HW1F.

    Parameters
    ----------
    notional         : trade notional ($). Used as a multiplier on per-unit
                       swap PV — overridden per-period if notional_schedule given.
    fixed_rate       : K, decimal (3.65% → 0.0365)
    is_payer         : True = pay fixed (rates-up profits)
    effective_y      : T_0 swap start, years from valuation_date
    payment_dates_y  : T_1..T_N fixed-leg payment dates, years
    period_dcf       : α_1..α_N day count fractions per period
    exercise_times_y : ascending list of exercise times (years).
                       European: pass single date.
                       Bermudan: pass full schedule. Must align with `dt` grid.
    a, sigma         : HW1F parameters from `xva_calibration`. σ in DECIMAL
                       (i.e. 0.0030 for 30bp, NOT 30.0).
    discount_curve   : OIS curve (date-based). Production path. Wrapped via
                       `discount_fn_from_curve` — inherits 1-day calendar
                       granularity and ~5e-4 α(t) wobble at sub-monthly Δt.
    valuation_date   : pricing date. Required when `discount_curve` is supplied.
                       Ignored when `discount_fn` is supplied.
    discount_fn      : Optional. Year-fraction → discount factor. Bypasses
                       `discount_curve` for sub-day precision. Used by tests
                       and validation against Jamshidian closed-form. Pass
                       exactly one of `discount_curve` or `discount_fn`.
    notional_schedule: per-period notionals (overrides scalar `notional`).
                       Length must match payment_dates_y.
    forecast_curve   : Phase 2. Pass anything not equal to discount_curve →
                       NotImplementedError per CHARTER §0.1 multi-curve gate.
    embedded_options : Per §1.11 leg-level optionality. Non-empty →
                       NotImplementedError per TAXONOMY §1.11.1 gate
                       (joint cap-vol calibration not yet shipped).
    dt               : tree time step (years). Default 1/12 (monthly).
                       Exercise times must be integer multiples of dt.

    Returns
    -------
    SwaptionTreeResult with `npv` (Bermudan), `european_npv` (lower bound),
    `early_exercise_premium`, and diagnostic fields.
    """
    # ── Methodology gates ────────────────────────────────────────────────────
    if forecast_curve is not None and forecast_curve is not discount_curve:
        raise NotImplementedError(
            "Bermudan swaption on multi-curve setup (forecast ≠ discount) is not "
            "supported in Phase 1. HW1F is single-rate by construction. See "
            "PRODUCT_TAXONOMY.md §1.11.1. Phase 2 work item."
        )
    if embedded_options:
        raise NotImplementedError(
            "Bermudan swaption on capped/floored/collared underlying is scoped "
            "for Phase 2. Joint HW1F + cap-vol calibration is not in scope. "
            "See PRODUCT_TAXONOMY.md §1.11.1."
        )

    # ── Resolve discount function (curve OR fn) ──────────────────────────────
    if discount_fn is None and discount_curve is None:
        raise ValueError(
            "Must supply either `discount_curve` (production path) or "
            "`discount_fn` (test/validation path)."
        )
    if discount_fn is not None and discount_curve is not None:
        raise ValueError(
            "Pass exactly one of `discount_curve` or `discount_fn`, not both."
        )
    if discount_fn is None:
        if valuation_date is None:
            raise ValueError("`valuation_date` is required when using `discount_curve`.")
        # Wrap the date-based curve. Inherits ~1-day calendar granularity.
        if hasattr(discount_curve, "valuation_date") and discount_curve.valuation_date != valuation_date:
            # Defensive: caller can override curve.valuation_date by passing a different date
            pass
        resolved_discount_fn = discount_fn_from_curve(discount_curve)
    else:
        resolved_discount_fn = discount_fn

    # ── Notional schedule resolution ─────────────────────────────────────────
    n_periods = len(payment_dates_y)
    if notional_schedule is None:
        notional_per_period = [notional] * n_periods
    else:
        if len(notional_schedule) != n_periods:
            raise ValueError(
                f"notional_schedule length ({len(notional_schedule)}) must "
                f"match payment_dates_y ({n_periods})"
            )
        notional_per_period = list(notional_schedule)

    # ── Build SwapTerms ──────────────────────────────────────────────────────
    terms = SwapTerms(
        payment_dates_y = list(payment_dates_y),
        period_dcf      = list(period_dcf),
        notional        = notional_per_period,
        fixed_rate      = fixed_rate,
        is_payer        = is_payer,
        effective_y     = effective_y,
    )

    # ── Build tree ───────────────────────────────────────────────────────────
    T_max = max(payment_dates_y[-1], max(exercise_times_y))
    tree = HW1FTrinomialTree(
        a           = a,
        sigma       = sigma,
        T_max_years = T_max,
        dt          = dt,
        discount_fn = resolved_discount_fn,
    )

    # ── Price ────────────────────────────────────────────────────────────────
    result = price_swaption_via_tree(tree, exercise_times_y, terms)

    # NPV is currently per-unit-of-notional × (the per-period notionals applied inside).
    # Since SwapTerms.notional already carries the correct notionals, the tree
    # output is already in $. No additional notional multiplication.

    # Tenor-far-from-5Y advisory (HW1F calibrated to 5Y column)
    tenor_y = payment_dates_y[-1] - effective_y
    if not (3.0 <= tenor_y <= 8.0):
        result.tenor_calibration_warning = (
            f"Underlying tenor {tenor_y:.2f}y is outside the 3-8y window where "
            f"the 5Y-tenor-calibrated HW1F is best-fit. Vol mismatch likely. "
            f"Treat NPV as indicative; see TAXONOMY §1.11.1."
        )

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Convenience: price European swaption via the same tree (used for validation
# gate against Bachelier closed-form)
# ─────────────────────────────────────────────────────────────────────────────

def price_european_swaption_hw1f_tree(
    notional        : float,
    fixed_rate      : float,
    is_payer        : bool,
    expiry_y        : float,
    tenor_y         : float,
    pay_freq_y      : float,
    a               : float,
    sigma           : float,
    discount_curve  : Optional[CurveLike]               = None,
    valuation_date  : Optional[date]                    = None,
    discount_fn     : Optional["Callable[[float], float]"] = None,
    period_dcf_const: float = 1.0,
    dt              : float = 1.0 / 12.0,
) -> SwaptionTreeResult:
    """
    Price an at-expiry-only swaption via the same HW1F tree machinery.
    Used for tree validation against Jamshidian closed-form; not part of
    production routing (production European stays on Bachelier).

    Pass exactly one of `discount_curve` or `discount_fn`.
    """
    # Build payment grid: T_0 = expiry_y, T_k = expiry_y + k·pay_freq_y, k=1..N
    n_periods       = int(round(tenor_y / pay_freq_y))
    payment_dates_y = [expiry_y + (k + 1) * pay_freq_y for k in range(n_periods)]
    period_dcf      = [pay_freq_y * period_dcf_const] * n_periods
    notional_sched  = [notional] * n_periods

    return price_bermudan_swaption_hw1f(
        notional          = notional,
        fixed_rate        = fixed_rate,
        is_payer          = is_payer,
        effective_y       = expiry_y,
        payment_dates_y   = payment_dates_y,
        period_dcf        = period_dcf,
        exercise_times_y  = [expiry_y],
        a                 = a,
        sigma             = sigma,
        discount_curve    = discount_curve,
        valuation_date    = valuation_date,
        discount_fn       = discount_fn,
        notional_schedule = notional_sched,
        dt                = dt,
    )
