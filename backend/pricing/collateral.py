"""
Rijeka — collateral eligibility and regimes.

A CSA says whether collateral is exchanged; a regime says what it is and what each rulebook makes
of it. From one regime the engine derives two CSAs:

    regulatory CSA  — only collateral the credit-risk-mitigation rules recognise (CRE22, SCO60.94),
                      at its supervisory haircut (CRE22.49); the netting set is margined for SA-CCR
                      only when recognised variation margin is exchanged and close-out netting is
                      enforceable. Feeds SA-CCR, BA-CVA, the leverage exposure.
    economic CSA    — what is actually exchanged; gross when close-out netting is not enforceable.
                      Feeds CVA, DVA, FVA, FBA, MVA.

The catalogue holds asset *classes* with regulatory attributes. A specific instrument is a row a
firm adds with its own legal findings; nothing here names an issuer.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Optional

from pricing.csa import CSA, MPOR_FLOOR_CLEARED_BD

# CRE22.49 comprehensive-approach haircuts (%), 10-business-day holding period, by residual maturity
# (≤1y, >1–3y, >3–5y, >5–10y, >10y), for jurisdictions that allow ratings.
HAIRCUT_BUCKETS_Y = (1.0, 3.0, 5.0, 10.0)
HAIRCUTS = {
    "SOVEREIGN_AAA_AA": (0.5, 2.0, 2.0, 4.0, 4.0),
    "SOVEREIGN_A_BBB":  (1.0, 3.0, 3.0, 6.0, 6.0),
    "OTHER_AAA_AA":     (1.0, 3.0, 4.0, 6.0, 12.0),
    "OTHER_A_BBB":      (2.0, 4.0, 6.0, 12.0, 20.0),
    "CASH":             (0.0, 0.0, 0.0, 0.0, 0.0),
    "MAIN_INDEX_EQUITY_OR_GOLD": (20.0,) * 5,
    "OTHER_EQUITY":     (30.0,) * 5,
}
HQLA_HAIRCUT = {"L1": 0.0, "L2A": 15.0, "L2B": 50.0}          # LCR30: Level 1 0 %, Level 2A 15 %, Level 2B 25–50 % (the conservative cell)


@dataclass(frozen=True)
class CollateralClass:
    code: str
    label: str
    crm: str                      # RECOGNISED | LOOK_THROUGH | NOT_RECOGNISED
    haircut_row: str              # key into HAIRCUTS (LOOK_THROUGH: the highest haircut of what the fund may hold, CRE22.49 note)
    im_eligible: str              # YES | NO | CONDITIONAL
    vm_eligible: str              # YES | NO | CONDITIONAL
    hqla: tuple                   # the levels it can take, conservative first: ("L1",) | ("L2A", "L1") | ()
    sco60_group: Optional[str]    # 1a | 1b | 2a | 2b | None
    yield_bp: float               # carry on the posted asset: the MVA pickup (a default; the regime can override)
    settlement: str               # bilateral | on_chain
    sources: dict = field(default_factory=dict)

    def haircut_pct(self, residual_maturity_y: float) -> float:
        row = HAIRCUTS[self.haircut_row]
        for i, edge in enumerate(HAIRCUT_BUCKETS_Y):
            if residual_maturity_y <= edge:
                return row[i]
        return row[-1]

    def to_dict(self) -> dict:
        return {"code": self.code, "label": self.label, "crm": self.crm, "haircut_row": self.haircut_row,
                "haircuts_pct": dict(zip(("<=1y", "1-3y", "3-5y", "5-10y", ">10y"), HAIRCUTS[self.haircut_row])),
                "im_eligible": self.im_eligible, "vm_eligible": self.vm_eligible, "hqla": list(self.hqla),
                "sco60_group": self.sco60_group, "yield_bp": self.yield_bp, "settlement": self.settlement, "sources": self.sources}


CATALOGUE: dict[str, CollateralClass] = {c.code: c for c in (
    CollateralClass("CASH", "Cash in the CSA currency", "RECOGNISED", "CASH", "YES", "YES", ("L1",), None, 0.0, "bilateral",
                    {"crm": "CRE22.34(1)", "haircut": "CRE22.49 (cash, same currency: 0 %)", "im": "CFTC §23.156(a)(1)(i)", "hqla": "LCR30.41(1)"}),
    CollateralClass("GOVT", "Government securities, AAA to AA−", "RECOGNISED", "SOVEREIGN_AAA_AA", "YES", "YES", ("L1",), None, 0.0, "bilateral",
                    {"crm": "CRE22.34(3)(a)", "haircut": "CRE22.49 (sovereigns AAA–AA)", "im": "CFTC §23.156(a)(1)(ii)", "hqla": "LCR30.41(3)"}),
    CollateralClass("GOVT_TOKENISED", "Tokenised sovereign claim, perfected and safe-harboured", "RECOGNISED", "SOVEREIGN_AAA_AA", "CONDITIONAL", "CONDITIONAL",
                    ("L2A", "L1"), "1a", 0.0, "on_chain",
                    {"crm": "CRE22.34(3)(a) through SCO60.94 (tokenised Group 1a of an eligible asset); conditional on the legal findings",
                     "haircut": "CRE22.49 (the underlying sovereign's row)", "im": "CFTC §23.156: not enumerated; a state the firm elects",
                     "hqla": "BCBS 238 / LCR30: Level 2A floor, Level 1 ceiling by look-through; a state the firm elects"}),
    CollateralClass("FUND_SHARES_TOKENISED", "Tokenised money-market fund shares", "LOOK_THROUGH", "OTHER_AAA_AA", "YES", "YES", ("L2A",), "1a", 0.0, "on_chain",
                    {"crm": "CRE22.34(5) with the CRE22.49 note: the highest haircut of any security the fund may hold, or look-through",
                     "haircut": "CRE22.49 (other issuers AAA–AA as the fund's worst permitted holding)", "im": "CFTC §23.156(a)(1)(ix) as amended 13 July 2026 (fixed haircuts 0.5 / 2 / 4 % by portfolio maturity)",
                     "hqla": "LCR30: Level 2A at most, by the fund's holdings"}),
    CollateralClass("STABLECOIN", "Payment stablecoin, private issuer", "NOT_RECOGNISED", "OTHER_A_BBB", "NO", "NO", (), "1b", 0.0, "on_chain",
                    {"crm": "SCO60.94: not eligible financial collateral unless a tokenised Group 1a of an eligible asset", "im": "CFTC crypto-asset FAQ Q5 (24 September 2026): not on the §23.156 list",
                     "hqla": "not an HQLA asset under LCR30"}),
    CollateralClass("CRYPTO_2A", "Group 2a cryptoasset (BTC, ETH, XRP, SOL, DOGE as classified)", "NOT_RECOGNISED", "OTHER_A_BBB", "NO", "NO", (), "2a", 0.0, "on_chain",
                    {"crm": "SCO60.94", "capital": "SCO60.62: 100 % of the net position", "limit": "SCO60.117: 1 % of Tier 1, 2 % hard"}),
    CollateralClass("CRYPTO_2B", "Group 2b cryptoasset", "NOT_RECOGNISED", "OTHER_A_BBB", "NO", "NO", (), "2b", 0.0, "on_chain",
                    {"crm": "SCO60.94", "capital": "SCO60.84: 1250 % risk weight on the larger of gross long and gross short"}),
)}


@dataclass
class Regime:
    name: str
    csa: CSA
    eligible: list[str]                               # catalogue codes the CSA admits
    posted: dict[str, float] = field(default_factory=lambda: {"CASH": 1.0})      # what we post, weights summing to 1
    received: dict[str, float] = field(default_factory=lambda: {"CASH": 1.0})    # what we receive
    netting_enforceable: bool = True                  # perfection and safe harbour hold in close-out
    im_eligibility_state: str = "POST"                # PRE | POST: how a CONDITIONAL class is read for IM
    hqla_state: str = "FLOOR"                         # FLOOR | CEILING: which of a class's HQLA levels applies
    mpor_state: str = "FLOOR"                         # FLOOR (the CSA's own MPoR) | ON_CHAIN (the cleared floor, atomic settlement)
    collateral_maturity_y: float = 1.0                # residual maturity of the securities posted, for the haircut row
    yield_override_bp: dict[str, float] = field(default_factory=dict)

    # ── derived ──────────────────────────────────────────────────────────────

    def _classes(self, comp: dict[str, float]) -> list[tuple[CollateralClass, float]]:
        out = []
        for code, w in comp.items():
            if code not in CATALOGUE:
                raise ValueError(f"unknown collateral class {code}")
            if code not in self.eligible:
                raise ValueError(f"{code} is not eligible under regime {self.name}")
            out.append((CATALOGUE[code], float(w)))
        tot = sum(w for _, w in out)
        return [(c, w / tot) for c, w in out] if tot > 0 else []

    def _recognised(self, c: CollateralClass) -> bool:
        return c.crm in ("RECOGNISED", "LOOK_THROUGH")

    def _im_eligible(self, c: CollateralClass) -> bool:
        return c.im_eligible == "YES" or (c.im_eligible == "CONDITIONAL" and self.im_eligibility_state == "POST")

    def recognised_fraction(self, side: str = "received") -> float:
        """Share of the collateral's face value that counts after recognition and haircut (CRE22.34, 22.49)."""
        if not self.netting_enforceable:
            return 0.0
        comp = self.received if side == "received" else self.posted
        return sum(w * (1.0 - c.haircut_pct(self.collateral_maturity_y) / 100.0) for c, w in self._classes(comp) if self._recognised(c))

    def im_eligible_fraction(self) -> float:
        return sum(w for c, w in self._classes(self.posted) if self._im_eligible(c))

    def im_pickup_bp(self) -> float:
        """Yield earned on the IM we post, over the part that is eligible as IM; the ineligible part must be
        replaced by eligible IM funded separately (the double-funding case), which earns nothing here."""
        return sum(w * self.yield_override_bp.get(c.code, c.yield_bp) for c, w in self._classes(self.posted) if self._im_eligible(c))

    def _base_csa(self) -> CSA:
        base = replace(self.csa)
        if self.mpor_state == "ON_CHAIN":
            base.settlement = "on_chain"
            base.mpor_days = MPOR_FLOOR_CLEARED_BD
        return base

    def regulatory_csa(self) -> CSA:
        """Recognised collateral only, at its haircut; margined iff recognised VM and enforceable; IM counts as NICA
        only where it is eligible IM in recognised form."""
        csa = self._base_csa()
        frac = self.recognised_fraction("received") if csa.collateralised else 0.0
        csa.crm_recognised = frac > 0.0
        csa.collateral_haircut = (1.0 - frac) if frac > 0.0 else 0.0
        csa.im_exchanged = bool(csa.im_exchanged and csa.crm_recognised and self.im_eligible_fraction() > 0.0)
        csa.im_yield_pickup_bp = self.im_pickup_bp()
        return csa

    def economic_csa(self) -> CSA:
        """What is exchanged. Not enforceable in close-out: the exposure is gross, the CSA uncollateralised."""
        if not self.netting_enforceable:
            un = CSA.uncollateralised()
            un.preset = f"{self.csa.preset}·UNENFORCEABLE"
            return un
        csa = self._base_csa()
        csa.crm_recognised = True
        csa.collateral_haircut = 0.0
        csa.im_yield_pickup_bp = self.im_pickup_bp()
        return csa

    def hqla_level(self, code: str) -> Optional[str]:
        levels = CATALOGUE[code].hqla
        if not levels:
            return None
        return levels[-1] if self.hqla_state == "CEILING" else levels[0]

    def hqla_value(self, amount: float, side: str = "posted") -> dict:
        """LCR30: the HQLA value of a collateral amount by level and haircut; None level counts nothing."""
        comp = self.posted if side == "posted" else self.received
        rows, total = [], 0.0
        for c, w in self._classes(comp):
            lvl = self.hqla_level(c.code)
            v = amount * w * (1.0 - HQLA_HAIRCUT[lvl] / 100.0) if lvl else 0.0
            rows.append({"code": c.code, "weight": w, "level": lvl, "value": v})
            total += v
        return {"total": total, "rows": rows, "state": self.hqla_state}

    def explain(self) -> list[dict]:
        """One line per decision, each with its paragraph: what the derivation drawer shows."""
        out = []
        for c, w in self._classes(self.received):
            out.append({"step": "recognition", "class": c.code, "weight": w, "crm": c.crm, "haircut_pct": c.haircut_pct(self.collateral_maturity_y),
                        "source": c.sources.get("crm"), "haircut_source": c.sources.get("haircut")})
        out.append({"step": "enforceability", "enforceable": self.netting_enforceable,
                    "effect": "collateral reduces exposure and the set is margined" if self.netting_enforceable else "exposure gross; SA-CCR unmargined",
                    "source": "CRE22.14 (legal certainty) and CRE52.18 (margined sets)"})
        for c, w in self._classes(self.posted):
            out.append({"step": "initial margin", "class": c.code, "weight": w, "im_eligible": self._im_eligible(c), "state": self.im_eligibility_state,
                        "pickup_bp": self.yield_override_bp.get(c.code, c.yield_bp), "source": c.sources.get("im")})
        out.append({"step": "margin period of risk", "state": self.mpor_state, "mpor_days": self._base_csa().mpor_days,
                    "source": "CRE52.50 (10 business days non-cleared); the on-chain state uses the cleared floor the paper argues for"})
        return out

    def to_dict(self) -> dict:
        return {"name": self.name, "csa": self.csa.to_dict(), "eligible": list(self.eligible), "posted": dict(self.posted), "received": dict(self.received),
                "netting_enforceable": self.netting_enforceable, "im_eligibility_state": self.im_eligibility_state, "hqla_state": self.hqla_state,
                "mpor_state": self.mpor_state, "collateral_maturity_y": self.collateral_maturity_y,
                "regulatory_csa": self.regulatory_csa().to_dict(), "economic_csa": self.economic_csa().to_dict(),
                "recognised_fraction": self.recognised_fraction(), "im_eligible_fraction": self.im_eligible_fraction(), "im_pickup_bp": self.im_pickup_bp()}


# ── Presets ──────────────────────────────────────────────────────────────────

def _bilateral(csa: Optional[CSA]) -> CSA:
    return replace(csa) if csa is not None else CSA.bilateral(im_exchanged=True)


def preset(name: str, csa: Optional[CSA] = None, **kw) -> Regime:
    """The four shipped regimes on a given CSA's terms (default: daily VM, 10bd MPoR, IM exchanged)."""
    n = name.upper()
    base = _bilateral(csa)
    if n == "CASH_GOVT":
        return Regime("CASH_GOVT", base, ["CASH", "GOVT"], {"GOVT": 1.0}, {"GOVT": 1.0}, **kw)
    if n == "PLUS_STABLECOIN":
        return Regime("PLUS_STABLECOIN", base, ["CASH", "GOVT", "STABLECOIN"], {"STABLECOIN": 1.0}, {"STABLECOIN": 1.0},
                      **{"netting_enforceable": False, **kw})
    if n == "PLUS_TOKENISED_FUND":
        return Regime("PLUS_TOKENISED_FUND", base, ["CASH", "GOVT", "FUND_SHARES_TOKENISED"], {"FUND_SHARES_TOKENISED": 1.0},
                      {"FUND_SHARES_TOKENISED": 1.0}, **kw)
    if n == "PLUS_TOKENISED_SOVEREIGN":
        return Regime("PLUS_TOKENISED_SOVEREIGN", base, ["CASH", "GOVT", "GOVT_TOKENISED"], {"GOVT_TOKENISED": 1.0}, {"GOVT_TOKENISED": 1.0},
                      **{"mpor_state": "ON_CHAIN", **kw})
    raise ValueError(f"unknown preset {name}")


PRESET_NAMES = ("CASH_GOVT", "PLUS_STABLECOIN", "PLUS_TOKENISED_FUND", "PLUS_TOKENISED_SOVEREIGN")


def from_request(d: Optional[dict], csa: Optional[CSA] = None) -> Regime:
    """A regime from a request: a preset name, or a body {name, csa?, eligible, posted, received, switches...}."""
    if d is None:
        return preset("CASH_GOVT", csa)
    if isinstance(d, str):
        return preset(d, csa)
    body = dict(d)
    if body.get("preset"):
        r = preset(body.pop("preset"), CSA.from_request(body.pop("csa")) if body.get("csa") else csa)
        for k in ("eligible", "posted", "received", "netting_enforceable", "im_eligibility_state", "hqla_state", "mpor_state",
                  "collateral_maturity_y", "yield_override_bp", "name"):
            if body.get(k) is not None:
                setattr(r, k, body[k])
        return r
    c = CSA.from_request(body.get("csa")) if body.get("csa") else _bilateral(csa)
    return Regime(str(body.get("name") or "CUSTOM"), c, list(body.get("eligible") or ["CASH", "GOVT"]),
                  dict(body.get("posted") or {"CASH": 1.0}), dict(body.get("received") or {"CASH": 1.0}),
                  bool(body.get("netting_enforceable", True)), str(body.get("im_eligibility_state", "POST")).upper(),
                  str(body.get("hqla_state", "FLOOR")).upper(), str(body.get("mpor_state", "FLOOR")).upper(),
                  float(body.get("collateral_maturity_y", 1.0)), dict(body.get("yield_override_bp") or {}))


def regime_from_counterparty(cp, csa: CSA) -> Regime:
    """The counterparty record's own regime: its eligible collateral and compositions when set, else cash and
    government securities on the record's CSA, enforceable."""
    elig = list(getattr(cp, "eligible_collateral", None) or ["CASH", "GOVT"])
    posted = dict(getattr(cp, "posted_composition", None) or {})
    received = dict(getattr(cp, "received_composition", None) or {})
    if not posted:
        posted = {elig[0]: 1.0}
    if not received:
        received = {elig[0]: 1.0}
    enf = getattr(cp, "netting_enforceable", None)
    return Regime("COUNTERPARTY", replace(csa), elig, posted, received, True if enf is None else bool(enf))
