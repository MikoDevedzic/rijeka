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
    posted_instruments: dict[str, float] = field(default_factory=dict)      # {instrument code: weight} when derived from a schedule
    received_instruments: dict[str, float] = field(default_factory=dict)
    instrument_yields_bp: dict[str, float] = field(default_factory=dict)    # the yield each instrument resolved to

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
                "posted_instruments": dict(self.posted_instruments), "received_instruments": dict(self.received_instruments),
                "instrument_yields_bp": dict(self.instrument_yields_bp),
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


# ── Instruments: a concrete asset a firm can post ────────────────────────────

YIELD_KINDS = ("CURVE", "FIXED", "NONE")      # CURVE: a curve's short rate plus yield_bp; FIXED: yield_bp; NONE: nothing
RAILS = ("bilateral", "on_chain")


@dataclass(frozen=True)
class Instrument:
    """One asset: its regulatory class decides the rules, the instrument carries the economics (currency, issuer,
    rail, yield source, a negotiated haircut). The seed is public tickers and generic classes; a firm adds its own
    rows under its own names (collateral_instruments)."""
    code: str
    name: str
    cls: str                          # CATALOGUE code
    currency: str
    issuer: str
    rail: str                         # bilateral | on_chain
    yield_kind: str                   # CURVE | FIXED | NONE
    yield_ref: Optional[str] = None   # the curve id for CURVE
    yield_bp: float = 0.0             # FIXED: the yield; CURVE: the spread over the curve's short rate
    chain_id: Optional[int] = None
    token_address: Optional[str] = None
    csa_haircut_pct: Optional[float] = None   # a negotiated haircut; None → the class's CRE22.49 row
    active: bool = True
    firm: bool = False                # a firm's own row, not the seed
    note: str = ""

    @property
    def klass(self) -> CollateralClass:
        return CATALOGUE[self.cls]

    def resolve_yield_bp(self, curve_rate_bp=None) -> float:
        """The instrument's yield in bp: FIXED as given; CURVE as the curve's short rate (from the callback, by
        curve id) plus the spread, the spread alone when the curve is not available; NONE is zero."""
        if self.yield_kind == "FIXED":
            return float(self.yield_bp)
        if self.yield_kind == "CURVE":
            r = curve_rate_bp(self.yield_ref) if curve_rate_bp is not None and self.yield_ref else None
            return (float(r) if r is not None else 0.0) + float(self.yield_bp)
        return 0.0

    def to_dict(self) -> dict:
        return {"code": self.code, "name": self.name, "cls": self.cls, "class_label": self.klass.label, "currency": self.currency, "issuer": self.issuer,
                "rail": self.rail, "yield_kind": self.yield_kind, "yield_ref": self.yield_ref, "yield_bp": self.yield_bp, "chain_id": self.chain_id,
                "token_address": self.token_address, "csa_haircut_pct": self.csa_haircut_pct, "active": self.active, "firm": self.firm, "note": self.note,
                "crm": self.klass.crm, "im_eligible": self.klass.im_eligible, "vm_eligible": self.klass.vm_eligible, "hqla": list(self.klass.hqla),
                "sco60_group": self.klass.sco60_group}


def _seed(code, name, cls, ccy, issuer, rail, yk, yref=None, ybp=0.0, chain=None, token=None, note=""):
    return Instrument(code, name, cls, ccy, issuer, rail, yk, yref, ybp, chain, token, None, True, False, note)


SEED: dict[str, Instrument] = {i.code: i for i in (
    _seed("USD_CASH", "US dollar cash", "CASH", "USD", "—", "bilateral", "CURVE", "USD_SOFR", 0.0, note="earns the OIS the discounting assumes: zero carry"),
    _seed("EUR_CASH", "Euro cash", "CASH", "EUR", "—", "bilateral", "CURVE", "EUR_ESTR", 0.0),
    _seed("GBP_CASH", "Sterling cash", "CASH", "GBP", "—", "bilateral", "CURVE", "GBP_SONIA", 0.0),
    _seed("UST_BILL", "US Treasury bill", "GOVT", "USD", "US Treasury", "bilateral", "CURVE", "USD_SOFR", 0.0, note="the bill yield is read off the OIS curve until a government curve is loaded"),
    _seed("UST_NOTE", "US Treasury note", "GOVT", "USD", "US Treasury", "bilateral", "CURVE", "USD_SOFR", 0.0),
    _seed("BUND", "German Bund", "GOVT", "EUR", "Bundesrepublik Deutschland", "bilateral", "CURVE", "EUR_ESTR", 0.0),
    _seed("GILT", "UK Gilt", "GOVT", "GBP", "HM Treasury", "bilateral", "CURVE", "GBP_SONIA", 0.0),
    _seed("USDC", "USD Coin", "STABLECOIN", "USD", "Circle", "on_chain", "NONE", None, 0.0, 1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "a payment stablecoin: no yield to the holder"),
    _seed("USDT", "Tether USD", "STABLECOIN", "USD", "Tether", "on_chain", "NONE", None, 0.0, 1, "0xdAC17F958D2ee523a2206206994597C13D831ec7", "a payment stablecoin: no yield to the holder"),
    _seed("PYUSD", "PayPal USD", "STABLECOIN", "USD", "Paxos for PayPal", "on_chain", "NONE", None, 0.0, 1, None, "token address to be entered by the firm"),
    _seed("TOKENISED_MMF", "Tokenised money-market fund share (generic)", "FUND_SHARES_TOKENISED", "USD", "the firm names the fund", "on_chain", "CURVE", "USD_SOFR", -10.0, 1, None,
          "a government money-market fund distributes close to the overnight rate less its expense ratio; the firm overrides with the fund's own yield"),
    _seed("TOKENISED_TBILL", "Tokenised Treasury bill claim (generic)", "GOVT_TOKENISED", "USD", "the firm names the issuer", "on_chain", "CURVE", "USD_SOFR", 0.0, 1, None,
          "a perfected, safe-harboured claim on a Treasury bill; the firm records its legal findings"),
    _seed("BTC", "Bitcoin", "CRYPTO_2A", "USD", "—", "on_chain", "NONE", None, 0.0, None, None, "Group 2a as classified; not recognised collateral"),
    _seed("ETH", "Ether", "CRYPTO_2A", "USD", "—", "on_chain", "NONE", None, 0.0, 1, None, "Group 2a as classified; not recognised collateral"),
    _seed("SOL", "Solana", "CRYPTO_2A", "USD", "—", "on_chain", "NONE", None, 0.0, None, None, "Group 2a as classified; not recognised collateral"),
)}


def instrument_from_row(d: dict, firm: bool = True) -> Instrument:
    """An Instrument from a request body or a database row; validates the class, rail and yield kind."""
    cls = str(d.get("cls") or d.get("class") or "").upper()
    if cls not in CATALOGUE:
        raise ValueError(f"unknown collateral class {cls or '(blank)'}")
    rail = str(d.get("rail") or CATALOGUE[cls].settlement).lower()
    if rail not in RAILS:
        raise ValueError(f"rail must be one of {', '.join(RAILS)}")
    yk = str(d.get("yield_kind") or "NONE").upper()
    if yk not in YIELD_KINDS:
        raise ValueError(f"yield_kind must be one of {', '.join(YIELD_KINDS)}")
    code = str(d.get("code") or "").strip().upper().replace(" ", "_")
    if not code or len(code) > 32:
        raise ValueError("code is required (up to 32 characters)")
    hc = d.get("csa_haircut_pct")
    if hc is not None and not (0.0 <= float(hc) <= 100.0):
        raise ValueError("csa_haircut_pct must be between 0 and 100")
    return Instrument(code, str(d.get("name") or code), cls, str(d.get("currency") or "USD").upper(), str(d.get("issuer") or "—"), rail, yk,
                      (str(d["yield_ref"]) if d.get("yield_ref") else None), float(d.get("yield_bp") or 0.0),
                      (int(d["chain_id"]) if d.get("chain_id") is not None and str(d["chain_id"]) != "" else None), (str(d["token_address"]) if d.get("token_address") else None),
                      (float(hc) if hc is not None else None), bool(d.get("active", True)), firm, str(d.get("note") or ""))


# ── Schedules: the CSA's eligible-collateral annex ──────────────────────────

@dataclass
class Schedule:
    """Per counterparty: the admitted instruments (for VM, for IM, at a negotiated haircut and a concentration
    limit), what is posted and received today by instrument, and the settlement rail. Versioned by effective date."""
    eligible: list[dict] = field(default_factory=list)       # [{instrument, vm, im, csa_haircut_pct, limit_pct}]
    posted: dict[str, float] = field(default_factory=dict)   # {instrument: weight}
    received: dict[str, float] = field(default_factory=dict)
    rail: str = "bilateral"
    effective_from: Optional[str] = None
    note: str = ""

    def to_dict(self) -> dict:
        return {"eligible": [dict(e) for e in self.eligible], "posted": dict(self.posted), "received": dict(self.received), "rail": self.rail,
                "effective_from": self.effective_from, "note": self.note}


def schedule_from_request(d: Optional[dict], instruments: dict[str, Instrument]) -> Schedule:
    """Validate a schedule body against the instrument list: every code known, weights non-negative and not all zero,
    what is posted or received admitted for VM, the rail one of the two."""
    body = dict(d or {})
    elig = []
    seen = set()
    for e in body.get("eligible") or []:
        code = str(e.get("instrument") or e.get("code") or "").upper()
        if code not in instruments:
            raise ValueError(f"eligible: unknown instrument {code or '(blank)'}")
        if code in seen:
            continue
        seen.add(code)
        hc = e.get("csa_haircut_pct")
        lim = e.get("limit_pct")
        elig.append({"instrument": code, "vm": bool(e.get("vm", True)), "im": bool(e.get("im", True)),
                     "csa_haircut_pct": (float(hc) if hc is not None and str(hc) != "" else None), "limit_pct": (float(lim) if lim is not None and str(lim) != "" else None)})
    if not elig:
        raise ValueError("eligible: at least one instrument")

    def comp(key: str) -> dict[str, float]:
        raw = body.get(key) or {}
        out = {}
        for code, w in raw.items():
            code = str(code).upper()
            if code not in seen:
                raise ValueError(f"{key}: {code} is not on the eligible list")
            w = float(w)
            if w < 0:
                raise ValueError(f"{key}: weights must be non-negative")
            if w > 0:
                out[code] = w
        if not out:
            out = {elig[0]["instrument"]: 1.0}
        tot = sum(out.values())
        return {k: v / tot for k, v in out.items()}

    rail = str(body.get("rail") or "bilateral").lower()
    if rail not in RAILS:
        raise ValueError(f"rail must be one of {', '.join(RAILS)}")
    return Schedule(elig, comp("posted"), comp("received"), rail, (str(body["effective_from"]) if body.get("effective_from") else None), str(body.get("note") or ""))


def regime_from_schedule(sched: Schedule, csa: CSA, instruments: dict[str, Instrument], name: str = "COUNTERPARTY",
                         netting_enforceable: bool = True, curve_rate_bp=None, **kw) -> Regime:
    """The counterparty's regime from its schedule: eligible classes are the admitted instruments' classes, the
    compositions aggregate by class, the on-chain rail sets the on-chain MPoR state, and each class's yield is the
    weighted yield of the instruments posted in it (resolved through the curve callback)."""
    by_class_posted: dict[str, float] = {}
    by_class_received: dict[str, float] = {}
    yields: dict[str, float] = {}
    for code, w in sched.posted.items():
        inst = instruments[code]
        by_class_posted[inst.cls] = by_class_posted.get(inst.cls, 0.0) + w
        yields[code] = inst.resolve_yield_bp(curve_rate_bp)
    for code, w in sched.received.items():
        inst = instruments[code]
        by_class_received[inst.cls] = by_class_received.get(inst.cls, 0.0) + w
        yields.setdefault(code, inst.resolve_yield_bp(curve_rate_bp))
    y_override: dict[str, float] = {}
    for cls, wc in by_class_posted.items():
        if wc > 0:
            y_override[cls] = sum(w * yields[c] for c, w in sched.posted.items() if instruments[c].cls == cls) / wc
    eligible = sorted({instruments[e["instrument"]].cls for e in sched.eligible} | set(by_class_posted) | set(by_class_received))
    return Regime(name, replace(csa), eligible, by_class_posted or {eligible[0]: 1.0}, by_class_received or {eligible[0]: 1.0},
                  netting_enforceable, mpor_state=("ON_CHAIN" if sched.rail == "on_chain" else "FLOOR"), yield_override_bp=y_override,
                  posted_instruments=dict(sched.posted), received_instruments=dict(sched.received), instrument_yields_bp=yields, **kw)
