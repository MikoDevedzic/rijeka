"""
Rijeka — Crypto non-deliverable forward (CRYPTO_FORWARD)

Cash-settled in USD against a settlement price source on the valuation
date. Priced as a non-deliverable FX forward with the digital asset as the
"foreign" currency: covered interest parity between holding the asset
(which earns or costs the asset funding rate) and holding USD (SOFR).

    T          = ACT/365 year fraction from the valuation date to settlement
    DF_USD(T)  = discount factor from the USD OIS curve
    DF_A(T)    = exp(-r_A * T),   r_A = asset funding rate (continuous, p.a.)
    F          = S * DF_A(T) / DF_USD(T)      (cash-and-carry: F = S * exp((r_USD - r_A) * T))
    NPV (USD)  = dir * N * (F - K) * DF_USD(T),   dir = +1 BUY / -1 SELL

The same formulas as the methodology workbook (methodology/replicate.py,
crypto_ndf_workbook), so a validator can rebuild every cell.

Greeks here are the ones a desk quotes on a forward: delta (USD change per
+1% spot), the equivalent spot position in asset units, and rho on USD
rates (USD change per +1bp parallel shift of the USD curve, from the
discounting of (F - K) and the forward itself).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Optional

from pricing.curve import Curve

DIRECTIONS = ("BUY", "SELL")


@dataclass
class CryptoForwardResult:
    digital_asset: str
    direction: str
    notional_amount: float          # units of the asset
    spot: float
    forward: float                  # fair forward today, USD per unit
    forward_price: float            # the contract's forward price K
    npv: float                      # USD, from the booker's side
    df_usd: float
    df_asset: float
    t: float                        # ACT/365
    asset_rate: float               # continuous p.a., as used
    usd_zero: float                 # continuous USD zero to settlement implied by DF_USD
    implied_basis: float            # annualised (F/S - 1)/T, what the market calls the basis
    delta_usd_per_pct: float        # dNPV for +1% spot
    delta_asset_units: float        # equivalent spot position in asset units
    rho_usd_per_bp: float           # dNPV for +1bp USD rates (parallel, continuous)
    error: Optional[str] = None


def year_fraction(valuation_date: date, settlement_date: date) -> float:
    return (settlement_date - valuation_date).days / 365.0


def fair_forward(spot: float, df_usd: float, asset_rate: float, t: float) -> float:
    return spot * math.exp(-asset_rate * t) / df_usd


def price_crypto_forward(
    *,
    digital_asset: str,
    notional_amount: float,
    forward_price: Optional[float],
    spot: float,
    valuation_date: date,
    settlement_date: date,
    usd_curve: Curve,
    asset_rate: float = 0.0,
    direction: str = "BUY",
) -> CryptoForwardResult:
    d = str(direction or "BUY").upper()
    if d not in DIRECTIONS:
        raise ValueError("direction must be BUY or SELL")
    if notional_amount <= 0:
        raise ValueError("notional_amount must be positive")
    if spot <= 0:
        raise ValueError("spot must be positive")
    if settlement_date <= valuation_date:
        raise ValueError("settlement_date must be after the valuation date")

    # The digital asset is the base currency of a BASE/USD pair; everything
    # else is the currency forward (pricing/currency_forward.py).
    from pricing.currency_forward import price_currency_forward
    r = price_currency_forward(base_currency=digital_asset, quote_currency="USD", base_notional=notional_amount,
                               forward_rate=forward_price, spot=spot, valuation_date=valuation_date,
                               settlement_date=settlement_date, quote_curve=usd_curve, base_rate=asset_rate,
                               direction=d, pip=1.0)
    t, df_usd, df_asset, F, K, npv = r.t, r.df_quote, r.df_base, r.forward, r.forward_rate, r.npv
    usd_zero, implied_basis = r.quote_rate, r.implied_carry
    delta_usd_per_pct, delta_asset_units, rho = r.delta_quote_per_pct, r.delta_base_units, r.rho_quote_per_bp

    return CryptoForwardResult(
        digital_asset=str(digital_asset).upper(), direction=d, notional_amount=float(notional_amount),
        spot=float(spot), forward=F, forward_price=K, npv=npv, df_usd=df_usd, df_asset=df_asset, t=t,
        asset_rate=float(asset_rate), usd_zero=usd_zero, implied_basis=implied_basis,
        delta_usd_per_pct=delta_usd_per_pct, delta_asset_units=delta_asset_units, rho_usd_per_bp=rho,
    )
