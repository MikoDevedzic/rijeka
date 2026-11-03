"""
Rijeka — SA-CCR, the standardised approach to counterparty credit risk (Basel CRE52).

One implementation for every asset class, used in two places: the regulatory snapshot of a
netting set at the valuation date (the ticket's CAPITAL tab) and the add-on along the exposure
grid that feeds KVA in the XVA waterfall. Each function names the paragraph it applies.

    EAD = α · (RC + multiplier · AddOn_aggregate),  α = 1.4                 (CRE52.1)
    RC  = max(V − C, 0)                              unmargined               (CRE52.10)
    RC  = max(V − C, TH + MTA − NICA, 0)             margined                 (CRE52.18–52.19)
    multiplier = min(1, 0.05 + 0.95 · exp((V − C) / (1.9 · AddOn)))           (CRE52.23)
    d_i = N_i · SD_i,  SD = (e^{−0.05 S} − e^{−0.05 E}) / 0.05   rates, credit (CRE52.34)
    MF unmargined = sqrt(min(M, 1y) / 1y), M floored at 10 business days      (CRE52.48)
    MF margined   = 1.5 · sqrt(MPoR / 250)                                    (CRE52.52)
    δ options: ±Φ(±(ln((P+λ)/(K+λ)) + ½σ²T) / (σ√T))                           (CRE52.40)

The Committee's worked examples (March 2014, Annex 4a, examples 1–5) are the reference suite in
tests/test_sa_ccr.py; every intermediate there is reproduced unrounded.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from pricing.csa import CSA, BUSINESS_DAYS_PER_YEAR

ALPHA = 1.4                       # CRE52.1
FLOOR_MULTIPLIER = 0.05           # CRE52.23
TEN_BUSINESS_DAYS_Y = 10.0 / BUSINESS_DAYS_PER_YEAR

# CRE52.72 Table 2 — supervisory factor, correlation, supervisory option volatility
SUPERVISORY = {
    "IR":        {"sf": 0.005, "rho": None, "vol": 0.50},
    "FX":        {"sf": 0.04,  "rho": None, "vol": 0.15},
    "CRYPTO":    {"sf": 0.32,  "rho": None, "vol": 1.20},          # SCO60.98: the cryptoasset class, FX structure
    "CREDIT": {
        "AAA": {"sf": 0.0038, "rho": 0.5, "vol": 1.00}, "AA": {"sf": 0.0038, "rho": 0.5, "vol": 1.00},
        "A":   {"sf": 0.0042, "rho": 0.5, "vol": 1.00}, "BBB": {"sf": 0.0054, "rho": 0.5, "vol": 1.00},
        "BB":  {"sf": 0.0106, "rho": 0.5, "vol": 1.00}, "B":   {"sf": 0.016,  "rho": 0.5, "vol": 1.00},
        "CCC": {"sf": 0.06,   "rho": 0.5, "vol": 1.00},
        "INDEX_IG": {"sf": 0.0038, "rho": 0.8, "vol": 0.80}, "INDEX_SG": {"sf": 0.0106, "rho": 0.8, "vol": 0.80},
    },
    "EQUITY": {"SINGLE": {"sf": 0.32, "rho": 0.5, "vol": 1.20}, "INDEX": {"sf": 0.20, "rho": 0.8, "vol": 0.75}},
    "COMMODITY": {"ELECTRICITY": {"sf": 0.40, "rho": 0.4, "vol": 1.50}, "OIL_GAS": {"sf": 0.18, "rho": 0.4, "vol": 0.70},
                  "METALS": {"sf": 0.18, "rho": 0.4, "vol": 0.70}, "AGRICULTURAL": {"sf": 0.18, "rho": 0.4, "vol": 0.70},
                  "OTHER": {"sf": 0.18, "rho": 0.4, "vol": 0.70}},
}
SOURCES = {"table": "CRE52.72 Table 2", "crypto": "SCO60.98", "ead": "CRE52.1", "rc_unmargined": "CRE52.10",
           "rc_margined": "CRE52.18–52.19", "multiplier": "CRE52.23", "duration": "CRE52.34", "mf": "CRE52.48, 52.50–52.52",
           "delta": "CRE52.39–52.40", "ir_buckets": "CRE52.57", "fx": "CRE52.59", "cap": "CRE52.2"}


@dataclass
class SaccrTrade:
    asset_class: str            # IR | FX | CRYPTO | CREDIT | EQUITY | COMMODITY
    hedging_set: str            # IR: currency; FX/CRYPTO: pair; CREDIT/EQUITY: the entity; COMMODITY: ENERGY|METALS|AGRICULTURAL|OTHER
    notional: float             # in the domestic currency
    start_y: float              # S_i: years to the start of the period the trade references (0 once started)
    end_y: float                # E_i: years to its end
    maturity_y: float           # M_i: remaining maturity of the contract (an option: to expiry)
    delta: float = 1.0          # ±1 linear, else supervisory_delta()
    sub_type: str = ""          # CREDIT: rating or INDEX_IG/INDEX_SG; EQUITY: SINGLE/INDEX; COMMODITY: the type
    trade_ref: str = ""

    def supervisory_factor(self) -> float:
        p = SUPERVISORY[self.asset_class]
        return (p[self.sub_type] if self.asset_class in ("CREDIT", "EQUITY", "COMMODITY") else p)["sf"]

    def correlation(self) -> Optional[float]:
        p = SUPERVISORY[self.asset_class]
        return (p[self.sub_type] if self.asset_class in ("CREDIT", "EQUITY", "COMMODITY") else p)["rho"]


def supervisory_duration(start_y: float, end_y: float) -> float:
    """CRE52.34: SD = (e^{−0.05 S} − e^{−0.05 E}) / 0.05, floored at ten business days."""
    s, e = max(start_y, 0.0), max(end_y, 0.0)
    sd = (math.exp(-0.05 * s) - math.exp(-0.05 * e)) / 0.05
    return max(sd, TEN_BUSINESS_DAYS_Y)


def adjusted_notional(t: SaccrTrade) -> float:
    """CRE52.34 (rates, credit: notional × SD); CRE52.35 (FX: the notional); SCO60.98 (crypto: the notional in fiat);
    equity and commodity: price × quantity, carried as the notional (CRE52.36)."""
    if t.asset_class in ("IR", "CREDIT"):
        return t.notional * supervisory_duration(t.start_y, t.end_y)
    return t.notional


def supervisory_delta(option_type: str, bought: bool, P: float, K: float, T: float, sigma: float, shift: float = 0.0) -> float:
    """CRE52.40: the Black delta with the supervisory volatility; λ (shift) for interest-rate options so P + λ > 0.
    option_type CALL (long the risk factor) or PUT (short it); sold positions flip the sign."""
    Pp, Kp = P + shift, K + shift
    if Pp <= 0 or Kp <= 0 or T <= 0 or sigma <= 0:
        raise ValueError("supervisory delta needs P + λ > 0, K + λ > 0, T > 0, σ > 0")
    d = (math.log(Pp / Kp) + 0.5 * sigma * sigma * T) / (sigma * math.sqrt(T))
    Phi = lambda x: 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))
    call = str(option_type).upper().startswith("C")
    delta = Phi(d) if call else -Phi(-d)
    return delta if bought else -delta


def maturity_factor(csa: CSA, maturity_y: float) -> float:
    """CRE52.48 (unmargined: sqrt(min(M, 1)), M floored at ten business days) and CRE52.52 (margined:
    1.5 sqrt(MPoR / 250), MPoR floored per CRE52.50–52.51 through the CSA)."""
    if csa.sa_ccr_margined:
        return csa.sa_ccr_maturity_factor(maturity_y)
    m = max(maturity_y, TEN_BUSINESS_DAYS_Y)
    return math.sqrt(min(m, 1.0))


def _bucket(end_y: float) -> int:
    """CRE52.57: the maturity bucket by the end date: <1y, 1–5y, >5y."""
    return 1 if end_y < 1.0 else 2 if end_y <= 5.0 else 3


def _effective(t: SaccrTrade, csa: CSA) -> float:
    return t.delta * adjusted_notional(t) * maturity_factor(csa, t.maturity_y)


def addon_ir(trades: list[SaccrTrade], csa: CSA) -> tuple[float, dict]:
    """CRE52.57: per currency, D_k the effective notional of bucket k; EN = sqrt(D₁² + D₂² + D₃² + 1.4 D₁D₂ + 1.4 D₂D₃ + 0.6 D₁D₃);
    add-on = 0.5 % × EN; the asset class sums its hedging sets."""
    sets: dict[str, list[float]] = {}
    for t in trades:
        sets.setdefault(t.hedging_set, [0.0, 0.0, 0.0])[_bucket(t.end_y) - 1] += _effective(t, csa)
    detail, total = {}, 0.0
    for hs, (d1, d2, d3) in sets.items():
        en = math.sqrt(max(d1 * d1 + d2 * d2 + d3 * d3 + 1.4 * d1 * d2 + 1.4 * d2 * d3 + 0.6 * d1 * d3, 0.0))
        a = SUPERVISORY["IR"]["sf"] * en
        detail[hs] = {"buckets": [d1, d2, d3], "effective_notional": en, "addon": a}
        total += a
    return total, detail


def addon_fx_like(trades: list[SaccrTrade], csa: CSA, asset_class: str) -> tuple[float, dict]:
    """CRE52.59 (FX, 4 %) and SCO60.98 (crypto, 32 %): per pair |Σ δ d MF| × SF, hedging sets summed."""
    sets: dict[str, float] = {}
    for t in trades:
        sets[t.hedging_set] = sets.get(t.hedging_set, 0.0) + _effective(t, csa)
    sf = SUPERVISORY[asset_class]["sf"]
    detail = {hs: {"effective_notional": en, "addon": sf * abs(en)} for hs, en in sets.items()}
    return sum(d["addon"] for d in detail.values()), detail


def _single_factor(entity_addons: list[tuple[float, float]]) -> float:
    """CRE52.62 / 52.65 / 52.69: sqrt((Σ ρ_k A_k)² + Σ (1 − ρ_k²) A_k²)."""
    sys_ = sum(rho * a for a, rho in entity_addons)
    idio = sum((1.0 - rho * rho) * a * a for a, rho in entity_addons)
    return math.sqrt(max(sys_ * sys_ + idio, 0.0))


def addon_credit_or_equity(trades: list[SaccrTrade], csa: CSA) -> tuple[float, dict]:
    """CRE52.60–52.66: one hedging set; entity-level add-on = SF × Σ δ d MF; aggregated with the single-factor formula."""
    ents: dict[str, dict] = {}
    for t in trades:
        e = ents.setdefault(t.hedging_set, {"effective_notional": 0.0, "sf": t.supervisory_factor(), "rho": t.correlation()})
        e["effective_notional"] += _effective(t, csa)
    for e in ents.values():
        e["addon"] = e["sf"] * e["effective_notional"]
    total = _single_factor([(e["addon"], e["rho"]) for e in ents.values()])
    return total, ents


def addon_commodity(trades: list[SaccrTrade], csa: CSA) -> tuple[float, dict]:
    """CRE52.67–52.69: hedging sets energy, metals, agricultural, other; within each, commodity types aggregated
    with ρ = 0.4; the asset class sums its hedging sets."""
    sets: dict[str, dict[str, dict]] = {}
    for t in trades:
        ty = sets.setdefault(t.hedging_set, {}).setdefault(t.sub_type, {"effective_notional": 0.0, "sf": t.supervisory_factor(), "rho": t.correlation()})
        ty["effective_notional"] += _effective(t, csa)
    detail, total = {}, 0.0
    for hs, types in sets.items():
        for ty in types.values():
            ty["addon"] = ty["sf"] * ty["effective_notional"]
        a = _single_factor([(ty["addon"], ty["rho"]) for ty in types.values()])
        detail[hs] = {"types": types, "addon": a}
        total += a
    return total, detail


def aggregate_addon(trades: list[SaccrTrade], csa: CSA) -> tuple[float, dict]:
    """CRE52.25: the sum over asset classes, no diversification across them."""
    by_class, detail = {}, {}
    for t in trades:
        by_class.setdefault(t.asset_class, []).append(t)
    for ac, ts in by_class.items():
        if ac == "IR":
            a, d = addon_ir(ts, csa)
        elif ac in ("FX", "CRYPTO"):
            a, d = addon_fx_like(ts, csa, ac)
        elif ac in ("CREDIT", "EQUITY"):
            a, d = addon_credit_or_equity(ts, csa)
        elif ac == "COMMODITY":
            a, d = addon_commodity(ts, csa)
        else:
            raise ValueError(f"unknown asset class {ac}")
        detail[ac] = {"addon": a, "hedging_sets": d}
    return sum(v["addon"] for v in detail.values()), detail


def multiplier(V: float, C: float, addon: float) -> float:
    """CRE52.23: min(1, Floor + (1 − Floor) exp((V − C) / (2 (1 − Floor) AddOn))), Floor 5 %."""
    if addon <= 0:
        return 1.0
    x = (V - C) / (2.0 * (1.0 - FLOOR_MULTIPLIER) * addon)
    return min(1.0, FLOOR_MULTIPLIER + (1.0 - FLOOR_MULTIPLIER) * math.exp(min(x, 50.0)))


def replacement_cost(V: float, C: float, csa: CSA, nica: float = 0.0) -> float:
    """CRE52.10 unmargined: max(V − C, 0); CRE52.18–52.19 margined: max(V − C, TH + MTA − NICA, 0)."""
    if csa.sa_ccr_margined:
        return max(V - C, csa.threshold_cp + csa.mta - nica, 0.0)
    return max(V - C, 0.0)


@dataclass
class SaccrResult:
    ead: float
    rc: float
    pfe: float
    multiplier: float
    addon: float
    by_class: dict
    margined: bool
    mf_note: str
    capped: bool = False
    ead_unmargined: Optional[float] = None
    trades: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"ead": self.ead, "rc": self.rc, "pfe": self.pfe, "multiplier": self.multiplier, "addon": self.addon,
                "by_class": self.by_class, "margined": self.margined, "mf": self.mf_note, "capped": self.capped,
                "ead_unmargined": self.ead_unmargined, "trades": self.trades, "sources": SOURCES}


def _trade_rows(trades: list[SaccrTrade], csa: CSA) -> list[dict]:
    return [{"trade_ref": t.trade_ref, "asset_class": t.asset_class, "hedging_set": t.hedging_set, "sub_type": t.sub_type,
             "notional": t.notional, "S": t.start_y, "E": t.end_y, "M": t.maturity_y,
             "SD": supervisory_duration(t.start_y, t.end_y) if t.asset_class in ("IR", "CREDIT") else None,
             "adjusted_notional": adjusted_notional(t), "delta": t.delta, "MF": maturity_factor(csa, t.maturity_y),
             "bucket": _bucket(t.end_y) if t.asset_class == "IR" else None, "effective": _effective(t, csa)} for t in trades]


def ead(trades: list[SaccrTrade], csa: CSA, V: float, C: float = 0.0, nica: float = 0.0, apply_cap: bool = True) -> SaccrResult:
    """The netting set's exposure at default. V the net mark, C the haircut value of net collateral held, NICA the
    net independent collateral amount (IM received net of unsegregated IM posted). CRE52.2 caps a margined set at
    the same set unmargined."""
    addon, by_class = aggregate_addon(trades, csa)
    mult = multiplier(V, C, addon)
    rc = replacement_cost(V, C, csa, nica)
    pfe = mult * addon
    e = ALPHA * (rc + pfe)
    res = SaccrResult(ead=e, rc=rc, pfe=pfe, multiplier=mult, addon=addon, by_class=by_class, margined=csa.sa_ccr_margined,
                      mf_note=("margined: 1.5·sqrt(MPoR/250)" if csa.sa_ccr_margined else "unmargined: sqrt(min(M, 1y))"),
                      trades=_trade_rows(trades, csa))
    if csa.sa_ccr_margined and apply_cap:
        un = CSA.uncollateralised()
        res.ead_unmargined = ead(trades, un, V, C, 0.0, apply_cap=False).ead
        if res.ead_unmargined < res.ead:
            res.ead, res.capped = res.ead_unmargined, True
    return res


def shifted(trades: list[SaccrTrade], t_y: float) -> list[SaccrTrade]:
    """The same trades seen t_y years later: S and E move back, trades past their end drop out, deltas held."""
    out = []
    for t in trades:
        e = t.end_y - t_y
        if e <= 0 or t.maturity_y - t_y <= 0:
            continue
        out.append(SaccrTrade(t.asset_class, t.hedging_set, t.notional, max(t.start_y - t_y, 0.0), e, t.maturity_y - t_y,
                              t.delta, t.sub_type, t.trade_ref))
    return out


def addon_profile(trades: list[SaccrTrade], csa: CSA, t_grid: list[float]) -> list[float]:
    """The aggregate add-on at each grid time (the KVA leg's input along the exposure path)."""
    return [aggregate_addon(shifted(trades, t), csa)[0] if shifted(trades, t) else 0.0 for t in t_grid]
