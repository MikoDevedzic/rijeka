"""Rijeka — FX options: European calls and puts on a currency pair, Garman–Kohlhagen.

An option on BASE/QUOTE (EURUSD: a EUR call is the right to buy EUR against USD at K) is priced on
the forward to the settlement date, the same forward the currency forward uses (covered interest
parity from the spot date, pricing/currency_forward.py), with a lognormal volatility over the time to
expiry and discounting in the quote currency to the settlement date:

    F        = forward to settlement (quote per base)
    T_e      = ACT/365 years from the valuation date to the expiry date (the cut)
    T_s      = ACT/365 years to the settlement date; DF_q(T_s) the quote-currency discount factor
    d1, d2   = [ln(F/K) ± σ²T_e/2] / (σ√T_e)
    call     = DF_q(T_s) · [F·Φ(d1) − K·Φ(d2)] per unit of base notional, in the quote currency
    put      = DF_q(T_s) · [K·Φ(−d2) − F·Φ(−d1)]
    NPV_q    = side · N_base · (call or put),   side = +1 bought, −1 sold

This is Black–Scholes with the base currency as the dividend-paying asset (Garman and Kohlhagen,
1983); a non-deliverable option, cash-settled in the quote currency against a fixing, has the same
value. The premium is a cash flow on its payment date and is not part of the value after it is paid.

Risk, in the desk's taxonomy (the same names the forward and the swaps carry):
  spot01       NPV change for +1 % spot (the forward moves with spot, the discounting does not)
  delta_base   equivalent spot position in base units, dNPV/dS, i.e. the forward delta × DF_q
  gamma_1pct   change in spot01 for a further +1 % spot
  vega         NPV change for +1 volatility point (0.01)
  ir01_disc    +1 bp on the quote-currency curve (forward up by the carry, discounting down)
  ir01_base    +1 bp on the base-currency curve (forward down)
  ir01         ir01_disc + ir01_base
  theta        NPV one calendar day later, same spot, curves and vol
Spot and curve sensitivities are by repricing, so they include the second-order terms a trader's
delta hedge actually sees; vega is analytic (σ√T_e the only dependence).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Optional

OPTION_TYPES = ("CALL", "PUT")
SIDES = ("BUY", "SELL")


def _N(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _n(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def gk_value(F: float, K: float, T: float, sigma: float, call: bool, df: float = 1.0) -> float:
    """Garman–Kohlhagen value per unit of base notional, in the quote currency, discounted by df."""
    if T <= 0 or sigma <= 0:
        return df * max(F - K, 0.0) if call else df * max(K - F, 0.0)
    sT = sigma * math.sqrt(T)
    d1 = (math.log(F / K) + 0.5 * sT * sT) / sT
    d2 = d1 - sT
    if call:
        return df * (F * _N(d1) - K * _N(d2))
    return df * (K * _N(-d2) - F * _N(-d1))


def forward_delta(F: float, K: float, T: float, sigma: float, call: bool) -> float:
    """Φ(d1) for a call, Φ(d1) − 1 for a put: the premium-excluded forward delta the market quotes smiles on."""
    if T <= 0 or sigma <= 0:
        itm = F > K if call else F < K
        return (1.0 if call else -1.0) if itm else 0.0
    sT = sigma * math.sqrt(T)
    d1 = (math.log(F / K) + 0.5 * sT * sT) / sT
    return _N(d1) if call else _N(d1) - 1.0


def year_fraction(d0: date, d1: date) -> float:
    return (d1 - d0).days / 365.0


@dataclass
class FxOptionResult:
    base_currency: str
    quote_currency: str
    option_type: str                 # CALL | PUT on the base currency
    direction: str                   # BUY | SELL of the option
    base_notional: float
    strike: float
    spot: float
    forward: float                   # to the settlement date
    vol: float                       # decimal, as used
    t_expiry: float
    t_settle: float
    df_quote: float                  # to settlement
    npv: float                       # quote currency, from our side
    premium_unit: float              # value per unit of base notional (unsigned)
    d1: float
    d2: float
    forward_delta: float             # Φ(d1) or Φ(d1) − 1, unsigned by side
    delta_base_units: float          # our spot position in base units
    spot01: float
    gamma_1pct: float
    vega: float                      # per +1 vol point
    ir01: float
    ir01_disc: float
    ir01_base: float
    theta: float
    intrinsic: float                 # quote ccy, undiscounted, on the forward
    time_value: float
    error: Optional[str] = None


def price_fx_option(
    *,
    base_currency: str,
    quote_currency: str,
    base_notional: float,
    option_type: str,
    strike: Optional[float],
    spot: float,
    forward: float,
    df_quote: float,
    valuation_date: date,
    expiry_date: date,
    settlement_date: date,
    vol: float,
    direction: str = "BUY",
    spot_date: Optional[date] = None,
) -> FxOptionResult:
    """forward and df_quote are to the settlement date, from the same engine as the currency forward
    (so quoted forward points, when the account prices off them, flow through). strike None = at the
    forward. spot_date: the quoted spot's settlement; carry runs from there, as in the forward."""
    typ = str(option_type or "").upper()
    if typ not in OPTION_TYPES:
        raise ValueError("option_type must be CALL or PUT")
    d = str(direction or "BUY").upper()
    if d not in SIDES:
        raise ValueError("direction must be BUY or SELL (of the option)")
    if base_notional <= 0 or spot <= 0 or forward <= 0 or df_quote <= 0:
        raise ValueError("base_notional, spot, forward and df_quote must be positive")
    if expiry_date <= valuation_date:
        raise ValueError("expiry_date must be after the valuation date")
    if settlement_date < expiry_date:
        raise ValueError("settlement_date must be on or after the expiry date")
    if vol <= 0:
        raise ValueError("vol must be positive")
    call = typ == "CALL"
    sign = 1.0 if d == "BUY" else -1.0
    K = float(strike) if strike is not None else float(forward)
    if K <= 0:
        raise ValueError("strike must be positive")
    T_e = year_fraction(valuation_date, expiry_date)
    T_s = year_fraction(valuation_date, settlement_date)
    sd = spot_date if (spot_date is not None and spot_date > valuation_date) else valuation_date
    tau = max(T_s - year_fraction(valuation_date, sd), 0.0)          # carry from the spot date to settlement
    N = float(base_notional)

    def value(F: float, df: float, T: float, s: float) -> float:
        return N * gk_value(F, K, T, s, call, df)

    unit = gk_value(forward, K, T_e, vol, call, df_quote)
    base = N * unit
    sT = vol * math.sqrt(T_e)
    d1 = (math.log(forward / K) + 0.5 * sT * sT) / sT
    d2 = d1 - sT
    fdelta = forward_delta(forward, K, T_e, vol, call)
    # spot: the forward moves one for one with spot (carry unchanged), discounting does not
    up = value(forward * 1.01, df_quote, T_e, vol)
    dn = value(forward * 0.99, df_quote, T_e, vol)
    spot01 = up - base
    gamma = (up - 2 * base + dn)
    # curves: +1 bp continuous on one curve, as the forward does
    bump = math.exp(-1e-4 * tau)
    npv_q = value(forward / bump, df_quote * math.exp(-1e-4 * T_s), T_e, vol)      # quote curve up: F up, DF_q down
    npv_b = value(forward * bump, df_quote, T_e, vol)                               # base curve up: F down
    vega = value(forward, df_quote, T_e, vol + 0.01) - base
    # one day later, same spot, curves and vol: one day less of expiry, and discounting unwinds a day;
    # the forward loses one day of carry (both legs' discount factors move together, F·bump_1d)
    one = 1.0 / 365.0
    if T_e > one:
        df_1 = df_quote / max(math.exp(-(-math.log(df_quote) / T_s) * one), 1e-12) if T_s > 0 else df_quote
        F_1 = forward * math.exp((math.log(forward / spot) / tau) * (-one)) if tau > one else forward
        theta = value(F_1, df_1, T_e - one, vol) - base
    else:
        theta = N * (max(forward - K, 0.0) if call else max(K - forward, 0.0)) * df_quote - base
    intrinsic = N * (max(forward - K, 0.0) if call else max(K - forward, 0.0))
    return FxOptionResult(
        base_currency=str(base_currency).upper(), quote_currency=str(quote_currency).upper(), option_type=typ, direction=d,
        base_notional=N, strike=K, spot=float(spot), forward=float(forward), vol=float(vol), t_expiry=T_e, t_settle=T_s,
        df_quote=float(df_quote), npv=sign * base, premium_unit=unit, d1=d1, d2=d2, forward_delta=fdelta,
        delta_base_units=sign * N * fdelta * df_quote * forward / spot,
        spot01=sign * spot01, gamma_1pct=sign * gamma, vega=sign * vega,
        ir01=sign * ((npv_q - base) + (npv_b - base)), ir01_disc=sign * (npv_q - base), ir01_base=sign * (npv_b - base),
        theta=sign * theta, intrinsic=intrinsic, time_value=base - intrinsic * df_quote,
    )
