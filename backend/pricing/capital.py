"""
Rijeka — counterparty capital: risk weights, BA-CVA, KVA legs, leverage exposure, quote advantage.

    RWA   = RW · EAD;  K_CCR = 8 % · RWA                                       (CRE20, CRE52)
    SCVA  = (1/α) · RW_c · M · EAD · DF(M),  DF = (1 − e^{−0.05 M}) / (0.05 M)  (MAR50.15)
    K_CVA = 0.65 · sqrt((0.5 Σ SCVA)² + 0.75 Σ SCVA²)                           (MAR50.14, ρ = 50 %)
    KVA   = hurdle · Σ (K_CCR(t) + K_CVA(t)) Δt P(0,t)                          (the waterfall)
    leverage exposure = α · (RC_cash + AddOn), only cash VM reduces RC        (LEV30)

Every table carries the paragraph it comes from; the route exposes them.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

ALPHA = 1.4
CAPITAL_RATIO = 0.08
DS_BA_CVA = 0.65          # MAR50.14 discount scalar
RHO_BA_CVA = 0.50         # MAR50.14(2)

COUNTERPARTY_TYPES = ("BANK", "BROKER_DEALER", "CORPORATE", "FUND", "SOVEREIGN", "CRYPTO_NATIVE")
RATING_BUCKETS = ("AAA_AA", "A", "BBB", "BB_B", "BELOW_B", "UNRATED")

# CRE20.7 Table 1 (sovereigns), CRE20.18 Table 6 (banks, ECRA base), CRE20.42–20.43 Table 10 (corporates)
RISK_WEIGHTS = {
    "SOVEREIGN": {"AAA_AA": 0.00, "A": 0.20, "BBB": 0.50, "BB_B": 1.00, "BELOW_B": 1.50, "UNRATED": 1.00},
    "BANK":      {"AAA_AA": 0.20, "A": 0.30, "BBB": 0.50, "BB_B": 1.00, "BELOW_B": 1.50, "UNRATED": 1.00},
    "CORPORATE": {"AAA_AA": 0.20, "A": 0.50, "BBB": 0.75, "BB_B": 1.00, "BELOW_B": 1.50, "UNRATED": 1.00},
}
RISK_WEIGHT_SOURCES = {"SOVEREIGN": "CRE20.7 Table 1", "BANK": "CRE20.18 Table 6 (base)", "CORPORATE": "CRE20.42–20.43 Table 10",
                       "BROKER_DEALER": "CRE20.40: as a bank when prudentially supervised, else as a corporate",
                       "FUND": "CRE20.40 / CRE60: treated as a corporate here (look-through is outside this version)",
                       "CRYPTO_NATIVE": "CRE20.40: a financial institution not under bank-equivalent supervision is a corporate",
                       "BANK_UNRATED": "CRE20.18: unrated banks follow the SCRA grades; 100 % is the conservative grade B here"}
_TABLE_OF = {"SOVEREIGN": "SOVEREIGN", "BANK": "BANK", "BROKER_DEALER": "BANK", "CORPORATE": "CORPORATE", "FUND": "CORPORATE", "CRYPTO_NATIVE": "CORPORATE"}

# MAR50.16 Table 1 — BA-CVA supervisory risk weights by sector, IG and HY/NR
CVA_WEIGHTS = {
    "SOVEREIGN":        {"IG": 0.005, "HY": 0.020},
    "LOCAL_GOVERNMENT": {"IG": 0.010, "HY": 0.040},
    "FINANCIAL":        {"IG": 0.050, "HY": 0.120},
    "BASIC_MATERIALS":  {"IG": 0.030, "HY": 0.070},
    "CONSUMER":         {"IG": 0.030, "HY": 0.085},
    "TECHNOLOGY":       {"IG": 0.020, "HY": 0.055},
    "HEALTH_UTILITIES": {"IG": 0.015, "HY": 0.050},
    "OTHER":            {"IG": 0.050, "HY": 0.120},
}
CVA_SECTOR_OF_TYPE = {"BANK": "FINANCIAL", "BROKER_DEALER": "FINANCIAL", "FUND": "FINANCIAL", "CRYPTO_NATIVE": "OTHER",
                      "CORPORATE": "OTHER", "SOVEREIGN": "SOVEREIGN"}
IG_BUCKETS = ("AAA_AA", "A", "BBB")


def risk_weight(counterparty_type: str, rating_bucket: str = "UNRATED", override: Optional[float] = None,
                prudentially_supervised: bool = True) -> tuple[float, str]:
    """The standardised risk weight and its source. BROKER_DEALER follows the bank table only when supervised
    as one (CRE20.40); an explicit override wins and is labelled as such."""
    if override is not None:
        return float(override), "firm override"
    ct = str(counterparty_type or "CORPORATE").upper()
    rb = str(rating_bucket or "UNRATED").upper()
    if ct not in _TABLE_OF:
        raise ValueError(f"unknown counterparty type {ct}")
    if rb not in RATING_BUCKETS:
        raise ValueError(f"unknown rating bucket {rb}")
    table = _TABLE_OF[ct]
    if ct == "BROKER_DEALER" and not prudentially_supervised:
        table = "CORPORATE"
    src = RISK_WEIGHT_SOURCES[table] if ct in ("SOVEREIGN", "BANK", "CORPORATE") else RISK_WEIGHT_SOURCES[ct]
    if table == "BANK" and rb == "UNRATED":
        src = RISK_WEIGHT_SOURCES["BANK_UNRATED"]
    return RISK_WEIGHTS[table][rb], src


def cva_weight(sector: Optional[str], rating_bucket: str = "UNRATED", counterparty_type: Optional[str] = None) -> tuple[float, str]:
    """MAR50.16 Table 1: the sector's IG weight for AAA to BBB, else the HY / NR weight."""
    sec = str(sector or CVA_SECTOR_OF_TYPE.get(str(counterparty_type or "").upper(), "OTHER")).upper()
    if sec not in CVA_WEIGHTS:
        raise ValueError(f"unknown CVA sector {sec}")
    grade = "IG" if str(rating_bucket or "UNRATED").upper() in IG_BUCKETS else "HY"
    return CVA_WEIGHTS[sec][grade], f"MAR50.16 Table 1 ({sec}, {grade})"


def supervisory_df(m_years: float) -> float:
    """MAR50.15: DF = (1 − e^{−0.05 M}) / (0.05 M); 1 as M → 0."""
    m = max(float(m_years), 0.0)
    return 1.0 if m < 1e-9 else (1.0 - math.exp(-0.05 * m)) / (0.05 * m)


def scva(ead: float, m_years: float, rw_c: float) -> float:
    """MAR50.15: the stand-alone CVA capital of one counterparty, (1/α) RW_c M EAD DF."""
    return (1.0 / ALPHA) * rw_c * max(m_years, 0.0) * max(ead, 0.0) * supervisory_df(m_years)


def k_cva_reduced(scvas: list[float]) -> float:
    """MAR50.14: K = DS · sqrt((ρ Σ SCVA)² + (1 − ρ²) Σ SCVA²)."""
    s = sum(scvas)
    q = sum(x * x for x in scvas)
    return DS_BA_CVA * math.sqrt(max((RHO_BA_CVA * s) ** 2 + (1.0 - RHO_BA_CVA ** 2) * q, 0.0))


def rwa(ead: float, rw: float) -> float:
    return max(ead, 0.0) * rw


def k_ccr(ead: float, rw: float) -> float:
    return CAPITAL_RATIO * rwa(ead, rw)


def leverage_exposure(V: float, cash_vm_received: float, addon: float) -> float:
    """LEV30 (derivative exposures): α (RC + PFE add-on) with the multiplier at 1 and only eligible cash variation
    margin reducing the replacement cost; no other collateral and no IM reduce it."""
    return ALPHA * (max(V - cash_vm_received, 0.0) + max(addon, 0.0))


def effective_maturity(trades: list[dict]) -> float:
    """The notional-weighted remaining maturity of the set (MAR50.15(2) without the five-year cap)."""
    w = sum(abs(float(t.get("notional") or 0.0)) for t in trades)
    if w <= 0:
        return max((float(t.get("maturity_y") or 0.0) for t in trades), default=0.0)
    return sum(abs(float(t.get("notional") or 0.0)) * float(t.get("maturity_y") or 0.0) for t in trades) / w


def annuity(rate: float, m_years: float) -> float:
    return (1.0 - math.exp(-rate * m_years)) / rate if rate > 1e-12 else m_years


def quote_advantage(delta_cost: float, notional: float, m_years: float, rate: float, convention: str = "RUNNING") -> dict:
    """A cost difference as a spread: running bp over the annuity, or upfront bp of notional."""
    if notional <= 0:
        return {"running_bp": 0.0, "upfront_bp": 0.0, "convention": convention}
    up = delta_cost / notional * 1e4
    run = delta_cost / (notional * annuity(rate, m_years)) * 1e4 if m_years > 0 else up
    return {"running_bp": run, "upfront_bp": up, "convention": convention}


@dataclass
class CapitalInputs:
    """What the waterfall needs for the two capital legs."""
    rw: float = 1.0                  # counterparty risk weight (CRE20)
    s_c: float = 0.0                 # BA-CVA supervisory weight (MAR50.16); 0 keeps today's KVA (CCR leg only)
    hurdle: float = 0.12
    counterparty_type: str = "CORPORATE"
    rating_bucket: str = "UNRATED"
    sector: str = "OTHER"
    rw_source: str = ""
    s_c_source: str = ""

    @classmethod
    def for_counterparty(cls, counterparty_type: str, rating_bucket: str = "UNRATED", sector: Optional[str] = None,
                         hurdle: float = 0.12, rw_override: Optional[float] = None, prudentially_supervised: bool = True) -> CapitalInputs:
        rw, rws = risk_weight(counterparty_type, rating_bucket, rw_override, prudentially_supervised)
        sc, scs = cva_weight(sector, rating_bucket, counterparty_type)
        return cls(rw=rw, s_c=sc, hurdle=hurdle, counterparty_type=str(counterparty_type).upper(), rating_bucket=str(rating_bucket).upper(),
                   sector=str(sector or CVA_SECTOR_OF_TYPE.get(str(counterparty_type).upper(), "OTHER")).upper(), rw_source=rws, s_c_source=scs)

    def to_dict(self) -> dict:
        return {"rw": self.rw, "s_c": self.s_c, "hurdle": self.hurdle, "counterparty_type": self.counterparty_type,
                "rating_bucket": self.rating_bucket, "sector": self.sector, "rw_source": self.rw_source, "s_c_source": self.s_c_source}


def tables() -> dict:
    return {"risk_weights": RISK_WEIGHTS, "risk_weight_sources": RISK_WEIGHT_SOURCES, "cva_weights": CVA_WEIGHTS,
            "cva_source": "MAR50.16 Table 1", "ba_cva": {"ds": DS_BA_CVA, "rho": RHO_BA_CVA, "alpha": ALPHA, "source": "MAR50.14–50.15"},
            "capital_ratio": CAPITAL_RATIO, "counterparty_types": COUNTERPARTY_TYPES, "rating_buckets": RATING_BUCKETS}
