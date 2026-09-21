"""
Rijeka — Credit Support Annex (collateral terms) for XVA.

A CSA turns a raw MtM path V(t) into a residual exposure

    E+(t) = max( V(t) − C(t) − IM_recv(t), 0 )
    E−(t) = min( V(t) − C(t) + IM_post(t), 0 )

where C(t) is variation margin held, lagged by the margin period of risk
(MPoR), and IM is initial margin exchanged under the uncleared margin
rules. Everything downstream — CVA, DVA, FVA, FBA, SA-CCR EAD for KVA, and
the SIMM IM that drives MVA — is a function of these residuals and of the
MPoR, so the CSA is the single object that distinguishes an uncollateralised
bilateral trade, a CSA'd bilateral trade and a continuously-margined
on-chain trade.

Variation margin
----------------
    C(t) = max(V(t−δ) − TH_cp, 0) − max(−V(t−δ) − TH_own, 0)
with the call zeroed when |C| < MTA. δ is the MPoR in years
(mpor_days / 250). Thresholds and MTA are in trade currency.

Initial margin
--------------
ISDA SIMM IR delta: IM = RW(tenor) × |IR01|. The published risk weights are
calibrated to a 10-business-day MPoR; for a different MPoR the weights scale
by sqrt(mpor / 10) (BCBS-IOSCO, ISDA SIMM methodology §B). IM is assumed
exchanged symmetrically (both parties post), amortising with residual
maturity. IM received reduces our exposure; IM posted is funded and drives
MVA.

SA-CCR
------
Margined netting sets use the margined maturity factor
    MF = 1.5 × sqrt(max(mpor_days, floor) / 250)
and RC = max(V − C, TH + MTA − NICA, 0), with NICA = IM received.
Unmargined sets keep MF = sqrt(min(M, 1)) and RC = max(V, 0).

Presets
-------
    UNCOLLATERALISED  no VM, no IM. MPoR irrelevant.
    BILATERAL         daily VM, 10bd MPoR (BCBS floor for non-cleared),
                      SIMM IM exchanged. Thresholds / MTA from the request.
    ON_CHAIN          atomic settlement: VM continuous, zero threshold and
                      MTA, 5bd MPoR (the cleared floor — the regulatory
                      recognition the blockchain-derivatives paper argues
                      for), SIMM IM exchanged with the sqrt(5/10) scaling.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from typing import Optional

BUSINESS_DAYS_PER_YEAR = 250

MPOR_FLOOR_BILATERAL_BD = 10.0   # BCBS-IOSCO non-cleared
MPOR_FLOOR_CLEARED_BD   = 5.0    # cleared / on-chain recognition
SIMM_REFERENCE_MPOR_BD  = 10.0   # SIMM risk weights are calibrated here


@dataclass
class CSA:
    preset:            str   = "UNCOLLATERALISED"   # label only; fields below govern
    collateralised:    bool  = False                # variation margin exchanged
    threshold_cp:      float = 0.0                  # $ — counterparty's threshold (our exposure uncollateralised up to it)
    threshold_own:     float = 0.0                  # $ — our threshold
    mta:               float = 0.0                  # $ minimum transfer amount
    mpor_days:         float = MPOR_FLOOR_BILATERAL_BD
    im_exchanged:      bool  = False                # SIMM IM posted both ways
    im_yield_pickup_bp: float = 0.0                 # bp of ftp recovered on posted IM (tokenised collateral earning yield)
    settlement:        str   = "bilateral"          # "bilateral" | "on_chain"

    # ── Derived ──────────────────────────────────────────────────────────────

    @property
    def mpor_years(self) -> float:
        return self.mpor_days / BUSINESS_DAYS_PER_YEAR

    @property
    def simm_mpor_scale(self) -> float:
        """sqrt(MPoR / 10bd): factor applied to SIMM risk weights."""
        return math.sqrt(self.mpor_days / SIMM_REFERENCE_MPOR_BD)

    @property
    def sa_ccr_margined(self) -> bool:
        return self.collateralised

    def sa_ccr_maturity_factor(self, residual_maturity_y: float) -> float:
        """
        Margined: 1.5 × sqrt(MPoR / 250), MPoR floored per settlement type.
        Unmargined: sqrt(min(M, 1)).
        """
        if self.collateralised:
            floor = (MPOR_FLOOR_CLEARED_BD if self.settlement == "on_chain"
                     else MPOR_FLOOR_BILATERAL_BD)
            mpor = max(self.mpor_days, floor)
            return 1.5 * math.sqrt(mpor / BUSINESS_DAYS_PER_YEAR)
        return math.sqrt(min(max(residual_maturity_y, 0.0), 1.0))

    def to_dict(self) -> dict:
        d = asdict(self)
        d["mpor_years"]      = self.mpor_years
        d["simm_mpor_scale"] = self.simm_mpor_scale
        return d

    # ── Presets ──────────────────────────────────────────────────────────────

    @classmethod
    def uncollateralised(cls) -> "CSA":
        return cls(preset="UNCOLLATERALISED")

    @classmethod
    def bilateral(cls, threshold_cp: float = 0.0, threshold_own: float = 0.0,
                  mta: float = 0.0, mpor_days: float = MPOR_FLOOR_BILATERAL_BD,
                  im_exchanged: bool = True) -> "CSA":
        return cls(preset="BILATERAL", collateralised=True,
                   threshold_cp=threshold_cp, threshold_own=threshold_own,
                   mta=mta, mpor_days=max(mpor_days, MPOR_FLOOR_BILATERAL_BD),
                   im_exchanged=im_exchanged, settlement="bilateral")

    @classmethod
    def on_chain(cls, mpor_days: float = MPOR_FLOOR_CLEARED_BD,
                 im_exchanged: bool = True, im_yield_pickup_bp: float = 0.0) -> "CSA":
        return cls(preset="ON_CHAIN", collateralised=True,
                   threshold_cp=0.0, threshold_own=0.0, mta=0.0,
                   mpor_days=max(mpor_days, MPOR_FLOOR_CLEARED_BD),
                   im_exchanged=im_exchanged,
                   im_yield_pickup_bp=im_yield_pickup_bp,
                   settlement="on_chain")

    @classmethod
    def from_request(cls, d: Optional[dict]) -> "CSA":
        """Build from a request dict: {preset, ...overrides}. None → uncollateralised."""
        if not d:
            return cls.uncollateralised()
        preset = str(d.get("preset", "UNCOLLATERALISED")).upper()
        if preset == "BILATERAL":
            base = cls.bilateral()
        elif preset == "ON_CHAIN":
            base = cls.on_chain()
        else:
            base = cls.uncollateralised()
        for k in ("collateralised", "threshold_cp", "threshold_own", "mta",
                  "mpor_days", "im_exchanged", "im_yield_pickup_bp", "settlement"):
            if d.get(k) is not None:
                setattr(base, k, d[k])
        if base.mpor_days <= 0:
            raise ValueError("mpor_days must be positive")
        return base
