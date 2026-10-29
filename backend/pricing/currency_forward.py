"""
Rijeka — currency forwards: FX and digital assets, one model.

A forward on a pair BASE/QUOTE (EURUSD: USD per EUR; USDJPY: JPY per USD;
BTCUSD: USD per BTC) is covered interest parity. Borrow QUOTE, buy BASE
today, lend BASE; the forward must repay the QUOTE interest:

    T          = ACT/365 year fraction from the valuation date to settlement
    DF_q(T)    = discount factor in the quote currency (its OIS curve)
    DF_b(T)    = discount factor in the base currency: its OIS curve, or for
                 a digital asset exp(-r_b T) with r_b the funding / staking rate
    F          = S * DF_b(T) / DF_q(T)
    NPV_quote  = dir * N_base * (F - K) * DF_q(T),   dir = +1 BUY base / -1 SELL base

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
    spot01: float = 0.0             # dNPV for +1 % spot: FX01 for a pair, BTC01 etc. for an asset (SIMM delta convention)
    theta: float = 0.0              # one day's carry: NPV one day later, same spot and curves


def year_fraction(valuation_date: date, settlement_date: date) -> float:
    return (settlement_date - valuation_date).days / 365.0


def _zero(df: float, t: float) -> float:
    return -math.log(df) / t if df > 0 and t > 0 else 0.0


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
) -> CurrencyForwardResult:
    """Exactly one of base_curve / base_rate gives the base-currency discounting."""
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
    df_q = float(quote_curve.df(settlement_date))
    df_b = float(base_curve.df(settlement_date)) if base_curve is not None else math.exp(-float(base_rate) * t)
    if df_q <= 0 or df_b <= 0:
        raise ValueError("discount factors must be positive")

    F = spot * df_b / df_q
    K = float(forward_rate) if forward_rate is not None else F
    npv = sign * base_notional * (F - K) * df_q

    bump = math.exp(-1e-4 * t)              # +1 bp continuous on one curve
    npv_b = sign * base_notional * (F * bump - K) * df_q          # base curve up: DF_b down, F down
    npv_q = sign * base_notional * (F / bump - K) * df_q * bump   # quote curve up: DF_q down, F up

    # One day later, same spot and the same curves: discount factors unwind by one day.
    d1 = valuation_date + timedelta(days=1)
    if settlement_date > d1:
        t1 = year_fraction(d1, settlement_date)
        df_q1 = df_q / max(float(quote_curve.df(d1)), 1e-12)
        df_b1 = (df_b / max(float(base_curve.df(d1)), 1e-12)) if base_curve is not None else math.exp(-float(base_rate) * t1)
        theta = sign * base_notional * (spot * df_b1 / df_q1 - K) * df_q1 - npv
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
        rho_base_per_bp=npv_b - npv, rho_quote_per_bp=npv_q - npv,
    )
