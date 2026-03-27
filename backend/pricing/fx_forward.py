"""
Rijeka — FX Forward Pricer
Sprint 3D: FX_FORWARD, FX_SWAP, NDF

FX Forward pricing:
  Forward FX rate = Spot * (df_domestic(maturity) / df_foreign(maturity))
  NPV (base ccy) = (Forward_FX - Strike) * Notional_foreign * df_domestic(maturity)
  NDF settles in base currency: same formula.

FX Swap = near leg (FX_FORWARD short) + far leg (FX_FORWARD long)
"""

from datetime import date
from dataclasses import dataclass
from typing import Optional, Dict
from pricing.curve import Curve


@dataclass
class FxForwardResult:
    trade_id:       str
    npv:            float           # in domestic (base) currency
    forward_rate:   float           # computed forward FX rate
    spot_rate:      float
    maturity:       date
    error:          Optional[str] = None


def price_fx_forward(
    trade_id:         str,
    notional_foreign: float,
    strike:           float,        # agreed forward rate (foreign/domestic)
    spot:             float,        # current spot rate
    maturity:         date,
    domestic_curve:   Curve,
    foreign_curve:    Curve,
    valuation_date:   date,
    direction:        str = "BUY",  # BUY (receive foreign, pay domestic) | SELL
) -> FxForwardResult:
    """
    Price an FX forward / NDF.

    NPV = (F - K) * N_foreign * df_domestic(mat)
    where F = spot * df_domestic(mat) / df_foreign(mat) (Interest Rate Parity)
    """
    df_d = domestic_curve.df(maturity)
    df_f = foreign_curve.df(maturity)

    if df_f == 0:
        return FxForwardResult(trade_id=trade_id, npv=0.0,
                               forward_rate=0.0, spot_rate=spot,
                               maturity=maturity,
                               error="Foreign curve df is zero at maturity.")

    forward_rate = spot * df_d / df_f
    npv = (forward_rate - strike) * notional_foreign * df_d

    if direction.upper() == "SELL":
        npv = -npv

    return FxForwardResult(
        trade_id=trade_id,
        npv=npv,
        forward_rate=forward_rate,
        spot_rate=spot,
        maturity=maturity,
    )
