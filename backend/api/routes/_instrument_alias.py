"""
_instrument_alias.py — legacy instrument_type translator (Migration 009, Apr 24 2026).

Backend canonical form is IR_* (IR_SWAP, IR_SWAPTION, IR_CAP, IR_FLOOR,
IR_COLLAR, etc.). Pricer.py and the DB CHECK constraint
chk_trades_instrument_type_no_legacy enforce IR_* exclusively.

Legacy frontend UIs (TradeBookingWindow.jsx, NewTradeWorkspace.jsx,
ScenarioTab.jsx, scenario-panel.jsx) still emit INTEREST_RATE_*
strings on inbound API payloads. Rather than coupling Migration 009 to
a frontend-side rename across ~35 sites in code that is already slated
for deletion in the four-UI consolidation (HANDOFF §3), this module
translates inbound legacy strings to the canonical form at the API
boundary.

Sunset: delete this module when TradeBookingWindow.jsx and
NewTradeWorkspace.jsx are retired. Track in L21 closure note.

Usage at the API boundary:

    from api.routes._instrument_alias import normalize_instrument_type

    @router.post("/trades")
    def create_trade(body: TradeCreate, ...):
        body.instrument_type = normalize_instrument_type(body.instrument_type)
        ...

Or as a Pydantic field validator:

    from pydantic import field_validator
    from api.routes._instrument_alias import normalize_instrument_type

    class TradeCreate(BaseModel):
        instrument_type: Optional[str] = None

        @field_validator("instrument_type")
        @classmethod
        def _normalize_instrument(cls, v):
            return normalize_instrument_type(v)
"""

from __future__ import annotations
from typing import Optional


# Legacy INTEREST_RATE_* -> canonical IR_* mapping.
# Add entries here if any other legacy strings surface from older code paths.
INSTRUMENT_TYPE_LEGACY_MAP = {
    "INTEREST_RATE_SWAP":     "IR_SWAP",
    "INTEREST_RATE_SWAPTION": "IR_SWAPTION",
    "INTEREST_RATE_CAP":      "IR_CAP",
    "INTEREST_RATE_FLOOR":    "IR_FLOOR",
    "INTEREST_RATE_COLLAR":   "IR_COLLAR",
}


def normalize_instrument_type(value: Optional[str]) -> Optional[str]:
    """
    Translate a legacy INTEREST_RATE_* instrument_type string to the
    canonical IR_* form. Pass through any value that is None, empty,
    already canonical, or unknown — callers are responsible for whatever
    validation comes next (Pydantic Literal types, CHECK constraints, etc.).

    Examples
    --------
    >>> normalize_instrument_type("INTEREST_RATE_CAP")
    'IR_CAP'
    >>> normalize_instrument_type("IR_SWAP")
    'IR_SWAP'
    >>> normalize_instrument_type(None) is None
    True
    >>> normalize_instrument_type("")
    ''
    >>> normalize_instrument_type("UNKNOWN_INSTRUMENT")
    'UNKNOWN_INSTRUMENT'
    """
    if value is None:
        return None
    if not isinstance(value, str):
        # Defensive: don't crash on numeric / dict payloads — let the
        # downstream validator catch them with a clearer message.
        return value
    return INSTRUMENT_TYPE_LEGACY_MAP.get(value, value)
