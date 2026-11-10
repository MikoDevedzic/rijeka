"""
Rijeka — currency forwards: FX and digital assets, one model.

A forward on a pair BASE/QUOTE (EURUSD: USD per EUR; USDJPY: JPY per USD;
BTCUSD: USD per BTC) is covered interest parity. Borrow QUOTE, buy BASE
today, lend BASE; the forward must repay the QUOTE interest:

    T          = ACT/365 year fraction from the valuation date to settlement
    T_s        = the same to the spot date: a quoted FX spot rate is the price for
                 delivery on the spot date (T+2 for most pairs), not today
    DF_q(T)    = discount factor in the quote currency (its OIS curve)
    DF_b(T)    = discount factor in the base currency: its OIS curve, or for
                 a digital asset exp(-r_b T) with r_b the funding / staking rate
    F          = S * [DF_b(T)/DF_b(T_s)] / [DF_q(T)/DF_q(T_s)]   (carry from spot to settlement)
    NPV_quote  = dir * N_base * (F - K) * DF_q(T),   dir = +1 BUY base / -1 SELL base

With no spot date (a digital asset, whose quoted spot settles at once) T_s = 0 and
F = S * DF_b(T) / DF_q(T). Treating an FX spot as today's rate drops the carry over the
spot lag: four calendar days from a Friday, about 5.6 pips on a 6-month USDJPY.

Deliverable or non-deliverable makes no difference to the value: an NDF
pays the same (F - K) * N_base in the settlement currency against a fixing.
Spot is a forward with T a few days out.

Greeks a currency desk quotes: delta (NPV change for +1 % spot) and the
equivalent spot position in base units; rho on each leg's curve (NPV change
for +1 bp, continuous, parallel). pricing/crypto_forward.py is this module
with base = the digital asset.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

from pricing.curve import Curve

DIRECTIONS = ("BUY", "SELL")


@dataclass
class CurrencyForwardResult:
    base_currency: str
    quote_currency: str
    direction: str                  # of the base currency
    base_notional: float
    quote_notional: float           # base_notional * K: what the quote leg settles
    spot: float
    forward: float                  # fair forward today, quote per base
    forward_rate: float             # contract rate K
    forward_points: float           # (F - S) * 10_000 for FX pairs; (F - S) for assets quoted in whole units
    npv: float                      # in the quote currency, from the booker's side
    df_base: float
    df_quote: float
    t: float
    base_rate: float                # continuous zero to T implied by DF_b
    quote_rate: float               # continuous zero to T implied by DF_q
    implied_carry: float            # annualised (F/S - 1)/T
    delta_quote_per_pct: float      # dNPV (quote ccy) for +1 % spot
    delta_base_units: float         # equivalent spot position in base units
    rho_base_per_bp: float          # dNPV for +1 bp on the base curve
    rho_quote_per_bp: float         # dNPV for +1 bp on the quote curve
    error: Optional[str] = None
    # One risk taxonomy across products (the swap carries NPV, IR01, IR01_DISC, THETA):
    ir01: float = 0.0               # +1 bp on every rate curve = ir01_disc + ir01_base
    ir01_disc: float = 0.0          # +1 bp on the discount (quote / settlement) curve only
    ir01_base: float = 0.0          # +1 bp on the base-currency curve (crypto: the funding rate, FUND01)
    spot01: float = 0.0             # dNPV for +1 % spot: FX01 for a pair, CRY01 for a digital asset (SIMM delta convention)
    theta: float = 0.0              # one day's carry: NPV one day later, same spot and curves
    t_spot: float = 0.0             # T_s: valuation date to the spot date the forward is carried from; 0 when spot settles at once


def year_fraction(valuation_date: date, settlement_date: date) -> float:
    return (settlement_date - valuation_date).days / 365.0


def _zero(df: float, t: float) -> float:
    return -math.log(df) / t if df > 0 and t > 0 else 0.0


def implied_base_rate(forward: float, spot: float, df_q: float, df_q_spot: float, t: float, t_spot: float) -> float:
    """The continuous base rate that makes the parity forward equal `forward` (market points mode)."""
    tau = t - t_spot
    if tau <= 0 or forward <= 0:
        return 0.0
    return -math.log(forward * (df_q / df_q_spot) / spot) / tau


def price_currency_forward(
    *,
    base_currency: str,
    quote_currency: str,
    base_notional: float,
    forward_rate: Optional[float],
    spot: float,
    valuation_date: date,
    settlement_date: date,
    quote_curve: Curve,
    base_curve: Optional[Curve] = None,
    base_rate: Optional[float] = None,
    direction: str = "BUY",
    pip: float = 1e-4,
    spot_date: Optional[date] = None,
) -> CurrencyForwardResult:
    """Exactly one of base_curve / base_rate gives the base-currency discounting. spot_date: the date the
    quoted spot settles (FX pairs); None for an asset whose quoted spot settles at once."""
    d = str(direction or "BUY").upper()
    if d not in DIRECTIONS:
        raise ValueError("direction must be BUY or SELL (of the base currency)")
    if base_notional <= 0:
        raise ValueError("base_notional must be positive")
    if spot <= 0:
        raise ValueError("spot must be positive")
    if settlement_date <= valuation_date:
        raise ValueError("settlement_date must be after the valuation date")
    if (base_curve is None) == (base_rate is None):
        raise ValueError("give base_curve or base_rate, not both")

    sign = 1.0 if d == "BUY" else -1.0
    t = year_fraction(valuation_date, settlement_date)
    sd = spot_date if (spot_date is not None and spot_date > valuation_date) else valuation_date
    t_s = year_fraction(valuation_date, sd)

    def dfs(on: date, from_: date):
        """(DF_q, DF_b) from `from_` to the settlement date, the curves as of `on`."""
        if from_ >= settlement_date:
            return 1.0, 1.0
        q = float(quote_curve.df(settlement_date)) / max(float(quote_curve.df(from_)), 1e-12)
        if base_curve is not None:
            b = float(base_curve.df(settlement_date)) / max(float(base_curve.df(from_)), 1e-12)
        else:
            b = math.exp(-float(base_rate) * year_fraction(from_, settlement_date))
        return q, b

    df_q = float(quote_curve.df(settlement_date))
    df_b = float(base_curve.df(settlement_date)) if base_curve is not None else math.exp(-float(base_rate) * t)
    if df_q <= 0 or df_b <= 0:
        raise ValueError("discount factors must be positive")
    fq, fb = dfs(valuation_date, sd)            # spot to settlement
    F = spot * fb / fq
    K = float(forward_rate) if forward_rate is not None else F
    npv = sign * base_notional * (F - K) * df_q

    tau = max(t - t_s, 0.0)
    npv_b = sign * base_notional * (F * math.exp(-1e-4 * tau) - K) * df_q                          # base curve +1bp
    npv_q = sign * base_notional * (F * math.exp(1e-4 * tau) - K) * df_q * math.exp(-1e-4 * t)      # quote curve +1bp

    # One day later, same spot and the same curves: discount factors unwind by one day, and so does the spot date.
    d1 = valuation_date + timedelta(days=1)
    if settlement_date > d1:
        df_q1 = df_q / max(float(quote_curve.df(d1)), 1e-12)
        sd1 = sd + timedelta(days=1) if spot_date is not None and sd > valuation_date else d1
        fq1, fb1 = dfs(d1, sd1)
        theta = sign * base_notional * (spot * fb1 / fq1 - K) * df_q1 - npv
    else:
        theta = -npv

    return CurrencyForwardResult(
        ir01=(npv_b - npv) + (npv_q - npv), ir01_disc=npv_q - npv, ir01_base=npv_b - npv,
        spot01=sign * base_notional * df_q * F * 0.01, theta=theta,
        base_currency=str(base_currency).upper(), quote_currency=str(quote_currency).upper(), direction=d,
        base_notional=float(base_notional), quote_notional=float(base_notional) * K,
        spot=float(spot), forward=F, forward_rate=K, forward_points=(F - spot) / pip if pip else F - spot,
        npv=npv, df_base=df_b, df_quote=df_q, t=t,
        base_rate=_zero(df_b, t), quote_rate=_zero(df_q, t), implied_carry=(F / spot - 1.0) / t,
        delta_quote_per_pct=sign * base_notional * df_q * F * 0.01,
        delta_base_units=sign * base_notional * df_q * F / spot,
        rho_base_per_bp=npv_b - npv, rho_quote_per_bp=npv_q - npv, t_spot=t_s,
    )
