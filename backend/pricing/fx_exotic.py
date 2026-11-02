"""Rijeka — FX option styles beyond the European vanilla: American, digital, barrier, double barrier,
touch. One lognormal model (the Garman–Kohlhagen dynamics of pricing/fx_option.py) and one risk
taxonomy; every style is benchmarked against QuantLib's engine for it (tests/reference/test_ref_fxo.py).

Dynamics. Spot follows dS/S = (r_q − r_b) dt + σ dW under the quote-currency measure, with r_q and
r_b the continuous rates implied over the option's life by the quote discount factor to expiry and
the forward to expiry (so quoted forward points, when the account prices off them, flow through),
and σ the smile vol at the strike (barrier and touch options use that single vol: a stated
limitation, vanna–volga being the next step; QuantLib's analytic barrier engines are flat-vol too).

Payoffs at expiry are paid on the settlement date. As in the vanilla pricer, the lognormal variable is
the forward to settlement and discounting is to settlement: the continuous rates r_q = −ln DF_q(T_s)/T_e
and b = ln(F_s/S)/T_e spread the carry to settlement over the time to expiry, so the European style here
reproduces pricing/fx_option.py exactly. Payments at a barrier hit (a knock-out rebate, a one-touch
paid at hit) are discounted to the hit time at r_q.

Methods, per style:
  AMERICAN        Leisen–Reimer binomial tree (TREE_STEPS + 1 steps), early exercise at every node.
  DIGITAL         cash-or-nothing (a fixed quote-currency amount) or a fixed base-currency amount
                  (asset-or-nothing scaled): closed forms, Reiner–Rubinstein (1991).
  BARRIER         knock-out by numerical integration of the survival density of log-spot with one
                  absorbing barrier (method of images, with drift by Girsanov); knock-in = vanilla −
                  knock-out. Rebates: knock-out paid at hit (Reiner–Rubinstein first-passage form),
                  knock-in paid at expiry if never hit. Continuous monitoring.
  DOUBLE_BARRIER  the same density with two absorbing barriers (the image series, Ikeda–Kunitomo
                  1992 in closed form); knock-in = vanilla − knock-out.
  TOUCH           one-touch paid at expiry = payout × DF × P(hit); paid at hit = the first-passage
                  form; no-touch = payout × DF × P(no hit); double no-touch from the two-barrier
                  density; double one-touch = payout × DF − double no-touch.
The survival-density integrals use a composite Simpson rule on INTEGRATION_POINTS points; the image
series is summed to IMAGE_TERMS on each side, far more than the few terms that matter.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from pricing.fx_option import _N, gk_value

STYLES = ("EUROPEAN", "AMERICAN", "DIGITAL", "BARRIER", "DOUBLE_BARRIER", "TOUCH")
BARRIER_TYPES = ("UP_IN", "UP_OUT", "DOWN_IN", "DOWN_OUT")
DOUBLE_TYPES = ("KNOCK_IN", "KNOCK_OUT")
TOUCH_TYPES = ("ONE_TOUCH", "NO_TOUCH", "DOUBLE_ONE_TOUCH", "DOUBLE_NO_TOUCH")
TREE_STEPS = 800
INTEGRATION_POINTS = 4001
IMAGE_TERMS = 12


@dataclass
class ExoticSpec:
    style: str                                   # STYLES
    option_type: str = "CALL"                    # CALL | PUT on the base (vanilla-type payoffs)
    strike: Optional[float] = None
    payout: Optional[float] = None               # digital / touch amount
    payout_currency: str = "QUOTE"               # QUOTE (cash-or-nothing) | BASE (a fixed base amount)
    barrier_type: Optional[str] = None           # BARRIER_TYPES, or DOUBLE_TYPES for a double barrier
    barrier: Optional[float] = None              # single barrier level
    lower: Optional[float] = None                # double barrier
    upper: Optional[float] = None
    rebate: float = 0.0                          # quote-currency amount per unit base notional (barriers)
    touch_type: Optional[str] = None             # TOUCH_TYPES
    pay_at_hit: bool = False                     # one-touch paid when hit (else at expiry)
    extra: dict = field(default_factory=dict)

    def validate(self, spot: float) -> None:
        if self.style not in STYLES:
            raise ValueError(f"style must be one of {STYLES}")
        if self.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER") and (self.strike is None or self.strike <= 0):
            raise ValueError("strike must be positive")
        if self.style in ("DIGITAL", "TOUCH") and (self.payout is None or self.payout <= 0):
            raise ValueError("payout must be positive")
        if self.style == "DIGITAL" and (self.strike is None or self.strike <= 0):
            raise ValueError("strike must be positive")
        if self.option_type not in ("CALL", "PUT"):
            raise ValueError("option_type must be CALL or PUT")
        if self.style == "BARRIER":
            if self.barrier_type not in BARRIER_TYPES or not self.barrier or self.barrier <= 0:
                raise ValueError("a barrier option needs barrier_type (UP_IN, UP_OUT, DOWN_IN, DOWN_OUT) and a positive barrier")
            if self.barrier_type.startswith("UP") and self.barrier <= spot:
                raise ValueError("an up barrier must be above spot")
            if self.barrier_type.startswith("DOWN") and self.barrier >= spot:
                raise ValueError("a down barrier must be below spot")
        if self.style == "DOUBLE_BARRIER":
            if self.barrier_type not in DOUBLE_TYPES or not self.lower or not self.upper or not (self.lower < spot < self.upper):
                raise ValueError("a double barrier needs barrier_type (KNOCK_IN, KNOCK_OUT) and lower < spot < upper")
        if self.style == "TOUCH":
            if self.touch_type not in TOUCH_TYPES:
                raise ValueError(f"touch_type must be one of {TOUCH_TYPES}")
            if self.touch_type in ("ONE_TOUCH", "NO_TOUCH") and (not self.barrier or self.barrier <= 0 or self.barrier == spot):
                raise ValueError("a touch option needs a barrier away from spot")
            if self.touch_type.startswith("DOUBLE") and not (self.lower and self.upper and self.lower < spot < self.upper):
                raise ValueError("a double touch needs lower < spot < upper")


# ── building blocks ──────────────────────────────────────────────────────────
def _phi(z: np.ndarray, v: float) -> np.ndarray:
    return np.exp(-0.5 * z * z / v) / math.sqrt(2.0 * math.pi * v)


def survival_density(y: np.ndarray, m: float, v: float, lower: Optional[float], upper: Optional[float]) -> np.ndarray:
    """Density of Y_T = ln(S_T/S) at y with Y never having left (lower, upper) in [0, T], for a Brownian
    motion with total drift m and variance v over [0, T]. Method of images for the driftless motion
    (one or two absorbing barriers), the drift restored by Girsanov: × exp(m·y/v − m²/(2v))."""
    y = np.asarray(y, dtype=float)
    if lower is None and upper is None:
        base = _phi(y - m, v)
        return base
    if lower is None or upper is None:
        b = upper if lower is None else lower
        base = _phi(y, v) - _phi(y - 2.0 * b, v)
    else:
        width = upper - lower
        base = np.zeros_like(y)
        for n in range(-IMAGE_TERMS, IMAGE_TERMS + 1):
            base += _phi(y - 2.0 * n * width, v) - _phi(y - 2.0 * lower + 2.0 * n * width, v)
    out = np.exp(m * y / v - m * m / (2.0 * v)) * base
    out[out < 0] = 0.0
    return out


def _expect_surviving(payoff, S: float, b: float, sigma: float, T: float, lower: Optional[float], upper: Optional[float]) -> float:
    """E[payoff(S_T)·1{no exit}] under the drift b = r_q − r_b, by Simpson on the survival density."""
    m, v = (b - 0.5 * sigma * sigma) * T, sigma * sigma * T
    sd = math.sqrt(v)
    lo = lower if lower is not None else m - 10.0 * sd
    hi = upper if upper is not None else m + 10.0 * sd
    if hi <= lo:
        return 0.0
    n = INTEGRATION_POINTS if INTEGRATION_POINTS % 2 == 1 else INTEGRATION_POINTS + 1
    y = np.linspace(lo, hi, n)
    f = payoff(S * np.exp(y)) * survival_density(y, m, v, lower, upper)
    h = (hi - lo) / (n - 1)
    w = np.ones(n); w[1:-1:2] = 4.0; w[2:-1:2] = 2.0
    return float(h / 3.0 * np.dot(w, f))


def first_passage_value(S: float, H: float, r: float, b: float, sigma: float, T: float) -> float:
    """E[e^{−rτ}·1{τ ≤ T}] for the first hit τ of the barrier H (Reiner–Rubinstein): the value of one unit
    of quote currency paid at the hit."""
    eta = 1.0 if H < S else -1.0
    mu = (b - 0.5 * sigma * sigma) / (sigma * sigma)
    lam = math.sqrt(mu * mu + 2.0 * r / (sigma * sigma))
    sT = sigma * math.sqrt(T)
    z = math.log(H / S) / sT + lam * sT
    return (H / S) ** (mu + lam) * _N(eta * z) + (H / S) ** (mu - lam) * _N(eta * z - 2.0 * eta * lam * sT)


def vanilla(S: float, K: float, r: float, b: float, sigma: float, T: float, call: bool) -> float:
    """Garman–Kohlhagen per unit base, discounted to T at r."""
    F = S * math.exp(b * T)
    return gk_value(F, K, T, sigma, call, math.exp(-r * T))


def american_tree(S: float, K: float, r: float, b: float, sigma: float, T: float, call: bool, steps: int = TREE_STEPS) -> float:
    """Leisen–Reimer binomial tree (Peizer–Pratt inversion, odd step count) with early exercise at every
    node. It converges smoothly where Cox–Ross–Rubinstein oscillates: at 801 steps the European limit
    is reproduced to a few parts in 10^7, so the early-exercise premium it reports is the tree's own.
    The foreign rate enters through the cost of carry b = r_q − r_b."""
    if T <= 0:
        return max(S - K, 0.0) if call else max(K - S, 0.0)
    n = steps if steps % 2 == 1 else steps + 1
    dt = T / n
    sT = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (b + 0.5 * sigma * sigma) * T) / sT
    d2 = d1 - sT

    def h(z: float) -> float:               # Peizer–Pratt method 2 inversion
        a = z / (n + 1.0 / 3.0 + 0.1 / (n + 1.0))
        return 0.5 + math.copysign(0.5, z) * math.sqrt(1.0 - math.exp(-a * a * (n + 1.0 / 6.0)))
    p = h(d2); pp = h(d1)
    g = math.exp(b * dt)
    u = g * pp / p
    d = (g - p * u) / (1.0 - p)
    disc = math.exp(-r * dt)
    j = np.arange(n + 1)
    ST = S * u ** (n - j) * d ** j
    V = np.maximum(ST - K, 0.0) if call else np.maximum(K - ST, 0.0)
    for i in range(n - 1, -1, -1):
        V = disc * (p * V[:-1] + (1.0 - p) * V[1:])
        jj = np.arange(i + 1)
        ST = S * u ** (i - jj) * d ** jj
        ex = np.maximum(ST - K, 0.0) if call else np.maximum(K - ST, 0.0)
        V = np.maximum(V, ex)
    return float(V[0])


# ── the styles, per unit of base notional (payouts: absolute amounts) ───────
def value(spec: ExoticSpec, S: float, r: float, rb: float, sigma: float, T: float, df_settle_extra: float = 1.0) -> float:
    """PV in the quote currency, from the holder's side: per unit of base notional for vanilla-type payoffs
    (EUROPEAN, AMERICAN, BARRIER, DOUBLE_BARRIER), in absolute terms for DIGITAL and TOUCH payouts.
    df_settle_extra discounts a payment made at settlement rather than at expiry (DF to settlement over
    DF to expiry); payments at a hit are not scaled by it."""
    b = r - rb
    dfT = math.exp(-r * T)
    call = spec.option_type == "CALL"
    K = spec.strike
    if T <= 0:
        return _expired(spec, S, df_settle_extra)
    if spec.style == "EUROPEAN":
        return vanilla(S, K, r, b, sigma, T, call) * df_settle_extra
    if spec.style == "AMERICAN":
        return american_tree(S, K, r, b, sigma, T, call)
    if spec.style == "DIGITAL":
        sT = sigma * math.sqrt(T)
        d1 = (math.log(S / K) + (b + 0.5 * sigma * sigma) * T) / sT
        d2 = d1 - sT
        if spec.payout_currency.upper() == "BASE":
            # a fixed amount of base paid if in the money: payout × S_T × 1{...}, i.e. asset-or-nothing
            unit = S * math.exp((b - r) * T) * (_N(d1) if call else _N(-d1))
        else:
            unit = dfT * (_N(d2) if call else _N(-d2))
        return spec.payout * unit * df_settle_extra
    if spec.style == "BARRIER":
        H = spec.barrier
        up = spec.barrier_type.startswith("UP")
        lower, upper = (None, math.log(H / S)) if up else (math.log(H / S), None)
        payoff = (lambda x: np.maximum(x - K, 0.0)) if call else (lambda x: np.maximum(K - x, 0.0))
        ko = dfT * _expect_surviving(payoff, S, b, sigma, T, lower, upper) * df_settle_extra
        if spec.barrier_type.endswith("OUT"):
            reb = spec.rebate * first_passage_value(S, H, r, b, sigma, T) if spec.rebate else 0.0
            return ko + reb
        van = vanilla(S, K, r, b, sigma, T, call) * df_settle_extra
        reb = spec.rebate * dfT * _expect_surviving(lambda x: np.ones_like(x), S, b, sigma, T, lower, upper) * df_settle_extra if spec.rebate else 0.0
        return van - ko + reb
    if spec.style == "DOUBLE_BARRIER":
        lower, upper = math.log(spec.lower / S), math.log(spec.upper / S)
        payoff = (lambda x: np.maximum(x - K, 0.0)) if call else (lambda x: np.maximum(K - x, 0.0))
        ko = dfT * _expect_surviving(payoff, S, b, sigma, T, lower, upper) * df_settle_extra
        if spec.barrier_type == "KNOCK_OUT":
            return ko
        return vanilla(S, K, r, b, sigma, T, call) * df_settle_extra - ko
    if spec.style == "TOUCH":
        Q = spec.payout
        one = lambda x: np.ones_like(x)
        if spec.touch_type in ("ONE_TOUCH", "NO_TOUCH"):
            H = spec.barrier
            lower, upper = (None, math.log(H / S)) if H > S else (math.log(H / S), None)
            p_no = _expect_surviving(one, S, b, sigma, T, lower, upper)          # P(no hit) under the pricing measure
            if spec.touch_type == "NO_TOUCH":
                return Q * dfT * p_no * df_settle_extra
            if spec.pay_at_hit:
                return Q * first_passage_value(S, H, r, b, sigma, T)
            return Q * dfT * (1.0 - p_no) * df_settle_extra
        lower, upper = math.log(spec.lower / S), math.log(spec.upper / S)
        p_no = _expect_surviving(one, S, b, sigma, T, lower, upper)
        dnt = Q * dfT * p_no * df_settle_extra
        return dnt if spec.touch_type == "DOUBLE_NO_TOUCH" else Q * dfT * df_settle_extra - dnt
    raise ValueError(spec.style)


def _expired(spec: ExoticSpec, S: float, df_settle_extra: float) -> float:
    call = spec.option_type == "CALL"
    if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER"):
        return (max(S - spec.strike, 0.0) if call else max(spec.strike - S, 0.0)) * df_settle_extra
    if spec.style == "DIGITAL":
        itm = S > spec.strike if call else S < spec.strike
        return (spec.payout * (S if spec.payout_currency.upper() == "BASE" else 1.0) if itm else 0.0) * df_settle_extra
    return 0.0


@dataclass
class ExoticResult:
    style: str
    npv: float                      # quote currency, from our side
    unit: float                     # holder's value per unit base (vanilla-type) or absolute (payouts)
    spot01: float
    gamma_1pct: float
    vega: float
    ir01: float
    ir01_disc: float
    ir01_base: float
    theta: float
    delta_base_units: float
    r_quote: float
    r_base: float
    vol: float
    t_expiry: float
    method: str


METHOD = {"EUROPEAN": "Garman–Kohlhagen", "AMERICAN": f"Leisen–Reimer binomial tree, {TREE_STEPS + 1} steps", "DIGITAL": "Reiner–Rubinstein closed form",
          "BARRIER": "survival-density integral (method of images), continuous monitoring",
          "DOUBLE_BARRIER": "two-barrier image series (Ikeda–Kunitomo), continuous monitoring",
          "TOUCH": "first-passage and survival probabilities, continuous monitoring"}


def price_exotic(spec: ExoticSpec, *, base_notional: float, spot: float, forward: float, df_quote: float, t_expiry: float, vol: float,
                 direction: str = "BUY") -> ExoticResult:
    """The desk's risk taxonomy for any style, by repricing: spot ±1 % (the forward moves with spot), vol +1
    point, +1 bp on each curve, one calendar day. forward and df_quote are to the settlement date (the vanilla
    pricer's inputs); r_q and b are implied from them over the time to expiry."""
    spec.validate(spot)
    if t_expiry <= 0:
        raise ValueError("expiry must be after the valuation date")
    if vol <= 0 or spot <= 0 or forward <= 0 or df_quote <= 0:
        raise ValueError("spot, forward, discount factor and vol must be positive")
    sign = 1.0 if str(direction).upper() == "BUY" else -1.0
    r = -math.log(df_quote) / t_expiry
    b = math.log(forward / spot) / t_expiry
    rb = r - b
    extra = 1.0
    scale = base_notional if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER") else 1.0

    def V(S=spot, rq=r, rbase=rb, s=vol, T=t_expiry):
        return scale * value(spec, S, rq, rbase, s, T, extra)

    base = V()
    up, dn = V(S=spot * 1.01), V(S=spot * 0.99)
    one = 1.0 / 365.0
    theta = (V(T=t_expiry - one) if t_expiry > one else scale * _expired(spec, spot, extra)) - base
    # a +1bp move of a curve is a +1bp move of its continuous rate over the life; the settlement discount
    # moves with the quote curve too (extra factor): carried by the same bump on r
    q_up = V(rq=r + 1e-4) * math.exp(-1e-4 * 0.0)
    b_up = V(rbase=rb + 1e-4)
    if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER"):
        delta_units = (up - dn) / (2 * 0.01 * spot) * 1.0          # dV/dS in quote per unit spot = base units
    else:
        delta_units = (up - dn) / (2 * 0.01 * spot)
    return ExoticResult(style=spec.style, npv=sign * base, unit=base / scale if scale else base, spot01=sign * (up - base),
                        gamma_1pct=sign * (up - 2 * base + dn), vega=sign * (V(s=vol + 0.01) - base),
                        ir01=sign * ((q_up - base) + (b_up - base)), ir01_disc=sign * (q_up - base), ir01_base=sign * (b_up - base),
                        theta=sign * theta, delta_base_units=sign * delta_units, r_quote=r, r_base=rb, vol=vol, t_expiry=t_expiry,
                        method=METHOD[spec.style])


# ── on simulated paths (counterparty exposure) ───────────────────────────────
PATH_POINTS = 401


def _survival_matrix(S: np.ndarray, b: float, sigma: float, T: float, lower_abs: Optional[float], upper_abs: Optional[float]):
    """For a vector of spots, the survival density on one absolute log-price grid x in [lower_abs, upper_abs]
    (log levels of the barriers, or ±10 sd when absent): rows are paths, columns grid points. Returns (x, h, w, dens)."""
    m, v = (b - 0.5 * sigma * sigma) * T, sigma * sigma * T
    sd = math.sqrt(v)
    lnS = np.log(S)
    lo = lower_abs if lower_abs is not None else float(lnS.min() + m - 10.0 * sd)
    hi = upper_abs if upper_abs is not None else float(lnS.max() + m + 10.0 * sd)
    n = PATH_POINTS if PATH_POINTS % 2 == 1 else PATH_POINTS + 1
    x = np.linspace(lo, hi, n)
    y = x[None, :] - lnS[:, None]                                        # log return per path
    lb = None if lower_abs is None else lower_abs - lnS                  # barrier in log-return terms, per path
    ub = None if upper_abs is None else upper_abs - lnS
    if lb is None and ub is None:
        base = _phi(y - m, v) * np.exp(-(m * y / v - m * m / (2.0 * v)))   # so the Girsanov factor below restores a plain normal
    elif lb is None or ub is None:
        bb = (ub if lb is None else lb)[:, None]
        base = _phi(y, v) - _phi(y - 2.0 * bb, v)
    else:
        width = (ub - lb)[:, None]
        base = np.zeros_like(y)
        for k in range(-IMAGE_TERMS, IMAGE_TERMS + 1):
            base += _phi(y - 2.0 * k * width, v) - _phi(y - 2.0 * lb[:, None] + 2.0 * k * width, v)
    dens = np.exp(m * y / v - m * m / (2.0 * v)) * base
    dens[dens < 0] = 0.0
    h = (hi - lo) / (n - 1)
    w = np.ones(n); w[1:-1:2] = 4.0; w[2:-1:2] = 2.0
    return x, h, w, dens


def _expect_surviving_paths(payoff, S: np.ndarray, b: float, sigma: float, T: float, lower_abs: Optional[float], upper_abs: Optional[float]) -> np.ndarray:
    x, h, w, dens = _survival_matrix(S, b, sigma, T, lower_abs, upper_abs)
    f = payoff(np.exp(x))[None, :] * dens
    return h / 3.0 * (f * w[None, :]).sum(axis=1)


def knocked_so_far(spec: ExoticSpec, S_hist: np.ndarray) -> np.ndarray:
    """Which paths have touched the barrier(s) at the grid points seen so far (S_hist: paths × points).
    Monitoring is discrete on the exposure grid; a stated simplification (the pricer monitors continuously)."""
    if spec.style == "BARRIER":
        return S_hist.max(axis=1) >= spec.barrier if spec.barrier_type.startswith("UP") else S_hist.min(axis=1) <= spec.barrier
    if spec.style == "DOUBLE_BARRIER" or (spec.style == "TOUCH" and spec.touch_type.startswith("DOUBLE")):
        return (S_hist.max(axis=1) >= spec.upper) | (S_hist.min(axis=1) <= spec.lower)
    if spec.style == "TOUCH":
        return S_hist.max(axis=1) >= spec.barrier if spec.barrier > S_hist[:, 0].mean() else S_hist.min(axis=1) <= spec.barrier
    return np.zeros(S_hist.shape[0], dtype=bool)


def value_on_paths(spec: ExoticSpec, S: np.ndarray, r: float, rb: float, sigma: float, T: float, knocked: np.ndarray,
                   df_settle_extra: float = 1.0) -> np.ndarray:
    """Holder's value per path with T years left, given which paths have already knocked. Vanilla-type styles
    per unit base; payouts absolute. AMERICAN is valued as its European (the early-exercise premium is not
    simulated: a stated lower bound). Same model as value(); vectorised on an absolute log grid."""
    S = np.asarray(S, dtype=float)
    b = r - rb
    dfT = math.exp(-r * T)
    call = spec.option_type == "CALL"
    K = spec.strike
    out = np.zeros_like(S)
    if T <= 0:
        return np.array([_expired(spec, float(s), df_settle_extra) for s in S])
    sT = sigma * math.sqrt(T)
    if spec.style in ("EUROPEAN", "AMERICAN"):
        F = S * math.exp(b * T)
        d1 = (np.log(F / K) + 0.5 * sT * sT) / sT; d2 = d1 - sT
        from scipy.stats import norm
        unit = (F * norm.cdf(d1) - K * norm.cdf(d2)) if call else (K * norm.cdf(-d2) - F * norm.cdf(-d1))
        return dfT * unit * df_settle_extra
    if spec.style == "DIGITAL":
        from scipy.stats import norm
        d1 = (np.log(S / K) + (b + 0.5 * sigma * sigma) * T) / sT; d2 = d1 - sT
        if spec.payout_currency.upper() == "BASE":
            unit = S * math.exp((b - r) * T) * (norm.cdf(d1) if call else norm.cdf(-d1))
        else:
            unit = dfT * (norm.cdf(d2) if call else norm.cdf(-d2))
        return spec.payout * unit * df_settle_extra
    alive = ~knocked
    if spec.style == "BARRIER":
        H = spec.barrier
        up = spec.barrier_type.startswith("UP")
        lo, hi = (None, math.log(H)) if up else (math.log(H), None)
        payoff = (lambda x: np.maximum(x - K, 0.0)) if call else (lambda x: np.maximum(K - x, 0.0))
        van = value_on_paths(ExoticSpec("EUROPEAN", spec.option_type, strike=K), S, r, rb, sigma, T, knocked, df_settle_extra)
        ko = np.zeros_like(S)
        if alive.any():
            ko[alive] = dfT * _expect_surviving_paths(payoff, S[alive], b, sigma, T, lo, hi) * df_settle_extra
        if spec.barrier_type.endswith("OUT"):
            out = ko
            if spec.rebate:
                fp = np.array([first_passage_value(float(s), H, r, b, sigma, T) for s in S[alive]]) if alive.any() else np.array([])
                out = out.copy(); out[alive] += spec.rebate * fp
            return out
        res = van.copy()                                    # knocked in: the vanilla
        res[alive] = van[alive] - ko[alive]
        if spec.rebate and alive.any():
            res[alive] += spec.rebate * dfT * _expect_surviving_paths(lambda x: np.ones_like(x), S[alive], b, sigma, T, lo, hi) * df_settle_extra
        return res
    if spec.style == "DOUBLE_BARRIER":
        lo, hi = math.log(spec.lower), math.log(spec.upper)
        payoff = (lambda x: np.maximum(x - K, 0.0)) if call else (lambda x: np.maximum(K - x, 0.0))
        van = value_on_paths(ExoticSpec("EUROPEAN", spec.option_type, strike=K), S, r, rb, sigma, T, knocked, df_settle_extra)
        ko = np.zeros_like(S)
        if alive.any():
            ko[alive] = dfT * _expect_surviving_paths(payoff, S[alive], b, sigma, T, lo, hi) * df_settle_extra
        if spec.barrier_type == "KNOCK_OUT":
            return ko
        res = van.copy(); res[alive] = van[alive] - ko[alive]
        return res
    if spec.style == "TOUCH":
        Q = spec.payout
        one = lambda x: np.ones_like(x)
        if spec.touch_type in ("ONE_TOUCH", "NO_TOUCH"):
            H = spec.barrier
            up = H > float(np.median(S))
            lo, hi = (None, math.log(H)) if up else (math.log(H), None)
            p_no = np.zeros_like(S)
            if alive.any():
                p_no[alive] = _expect_surviving_paths(one, S[alive], b, sigma, T, lo, hi)
            if spec.touch_type == "NO_TOUCH":
                return Q * dfT * p_no * df_settle_extra * alive
            if spec.pay_at_hit:
                v = np.zeros_like(S)
                if alive.any():
                    v[alive] = np.array([Q * first_passage_value(float(s), H, r, b, sigma, T) for s in S[alive]])
                v[~alive] = 0.0                                   # paid at the hit, already settled
                return v
            v = Q * dfT * (1.0 - p_no) * df_settle_extra
            v[~alive] = Q * dfT * df_settle_extra                 # hit: the payout is certain, paid at expiry
            return v
        lo, hi = math.log(spec.lower), math.log(spec.upper)
        p_no = np.zeros_like(S)
        if alive.any():
            p_no[alive] = _expect_surviving_paths(one, S[alive], b, sigma, T, lo, hi)
        dnt = Q * dfT * p_no * df_settle_extra
        return dnt if spec.touch_type == "DOUBLE_NO_TOUCH" else Q * dfT * df_settle_extra - dnt
    raise ValueError(spec.style)
