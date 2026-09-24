"""
Canonical trade record — the bytes both counterparties sign.

The schema version is inside the payload, so a verifier always knows which
serialisation to reproduce, and a confirmation is always re-derived with the
version it was signed under.

  v1  (2026-09-21) The booker's view: the booker's trade_ref, own/counterparty
      parties, leg directions (PAY/RECEIVE) from the booker's side. The other
      party's own booking can never hash to it.
  v2  (2026-09-24, current) ONE record for both sides. Keyed by the UTI, not
      either firm's reference; parties are the two LEIs in sorted order; each
      leg names its payer and receiver LEI, each embedded option its buyer and
      seller, each custom cashflow its payer and receiver (unsigned amount);
      legs are ordered by content. So each party's own booking of the same
      trade produces the same bytes, and either can re-derive the hash alone.
      Left out as not terms of the contract: firm-internal references and
      leg refs, the booker's discount curve, the trade-level `terms` blob
      (the booker's-view copy of the legs), party names (the LEI identifies).

Rules (a verifier in any language must reproduce these exactly):
  * JSON, UTF-8, keys sorted, separators ',' and ':' (no whitespace)
  * numbers are rendered as decimal STRINGS: no exponent, no trailing
    zeros, no '-0'  (0.0365 -> "0.0365", 10000000.00 -> "10000000")
  * dates/datetimes as ISO-8601 strings (dates: YYYY-MM-DD)
  * null preserved; booleans as JSON booleans; nested objects/lists kept
  * strings unchanged (no case folding, no trimming)
  * only the ECONOMIC fields listed below — no ids, no tenancy, no
    timestamps, no internal book/desk, no status
  * hash = keccak256(bytes)
"""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

from eth_utils import keccak

CANONICAL_SCHEMA_VERSION = 2          # what new confirmations are signed under
SUPPORTED_SCHEMA_VERSIONS = (1, 2)    # what can be re-derived for verification

TRADE_FIELDS = (
    "trade_ref", "uti", "asset_class", "instrument_type", "structure",
    "notional", "notional_ccy", "trade_date", "effective_date", "maturity_date",
    "terms", "discount_curve_id", "forecast_curve_id",
)

LEG_FIELDS = (
    "leg_ref", "leg_seq", "leg_type", "direction", "currency",
    "notional", "notional_type", "notional_schedule",
    "effective_date", "maturity_date", "first_period_start", "last_period_end",
    "day_count", "payment_frequency", "reset_frequency", "bdc", "stub_type",
    "payment_calendar", "payment_lag",
    "fixed_rate", "fixed_rate_type", "fixed_rate_schedule",
    "spread", "spread_type", "spread_schedule",
    "forecast_curve_id", "discount_curve_id",
    "embedded_options", "leverage", "ois_compounding", "terms",
)

PARTY_FIELDS = ("lei", "name")


def _get(obj: Any, name: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def _num_str(x: Any) -> str:
    """Decimal string: no exponent, no trailing zeros, no negative zero."""
    try:
        d = Decimal(str(x))
    except InvalidOperation:
        raise ValueError(f"not a number: {x!r}")
    if d.is_nan() or d.is_infinite():
        raise ValueError(f"non-finite number: {x!r}")
    d = d.normalize()
    if d == 0:
        return "0"
    s = format(d, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def normalise(v: Any) -> Any:
    """Recursively normalise a value per the schema rules."""
    if v is None or isinstance(v, bool) or isinstance(v, str):
        return v
    if isinstance(v, (int, float, Decimal)):
        return _num_str(v)
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, dict):
        return {str(k): normalise(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [normalise(x) for x in v]
    # UUIDs and anything else: string form
    return str(v)


def _pick(obj: Any, fields: Iterable[str]) -> dict:
    return {f: normalise(_get(obj, f)) for f in fields}


def canonical_payload(trade: Any, legs: Iterable[Any], own_entity: Any, counterparty: Any,
                      version: int = CANONICAL_SCHEMA_VERSION) -> dict:
    """
    Build the canonical record under `version` (default: current).

    trade / legs may be ORM rows or dicts; own_entity / counterparty are
    {lei, name}. A confirmation must be re-derived with the version recorded
    in its attestation, never with whatever is current.
    """
    if version == 1:
        return _canonical_v1(trade, legs, own_entity, counterparty)
    if version == 2:
        return _canonical_v2(trade, legs, own_entity, counterparty)
    raise ValueError(f"unsupported canonical schema version {version!r}")


def _canonical_v1(trade: Any, legs: Iterable[Any], own_entity: Any, counterparty: Any) -> dict:
    """Schema v1 (frozen). Legs ordered by leg_seq, then leg_ref."""
    legs_sorted = sorted(legs, key=lambda l: (int(_get(l, "leg_seq") or 0), str(_get(l, "leg_ref") or "")))
    return {
        "schema": "rijeka-trade",
        "schema_version": 1,
        "trade": _pick(trade, TRADE_FIELDS),
        "legs": [_pick(l, LEG_FIELDS) for l in legs_sorted],
        "parties": {
            "own":          _pick(own_entity, PARTY_FIELDS),
            "counterparty": _pick(counterparty, PARTY_FIELDS),
        },
    }


# ── Schema v2: one record for both parties ─────────────────────────────────

TRADE_FIELDS_V2 = (
    "asset_class", "instrument_type", "structure",
    "notional", "notional_ccy", "trade_date", "effective_date", "maturity_date",
)

LEG_FIELDS_V2 = (
    "leg_type", "currency",
    "notional", "notional_type", "notional_schedule",
    "effective_date", "maturity_date", "first_period_start", "last_period_end",
    "day_count", "payment_frequency", "reset_frequency", "bdc", "stub_type",
    "payment_calendar", "payment_lag",
    "fixed_rate", "fixed_rate_type", "fixed_rate_schedule",
    "spread", "spread_type", "spread_schedule",
    "leverage", "ois_compounding",
)


def _lei(entity: Any, role: str) -> str:
    lei = _get(entity, "lei")
    if not lei:
        raise ValueError(f"schema v2 needs the {role}'s LEI: both parties are identified by LEI alone")
    return str(lei)


def _sides(direction: Any, own: str, cp: str, pays=("PAY",), gets=("RECEIVE",)) -> tuple[str, str]:
    """(first, second) party for a booker's-view direction: PAY -> (own, cp)."""
    d = str(direction or "").upper()
    if d in pays:
        return own, cp
    if d in gets:
        return cp, own
    raise ValueError(f"direction must be one of {pays + gets}, got {direction!r}")


def _options_v2(options: Any, own: str, cp: str) -> list:
    out = []
    for o in options or []:
        o = dict(o)
        buyer, seller = _sides(o.pop("direction", None), own, cp, pays=("BUY", "LONG"), gets=("SELL", "SHORT"))
        out.append(normalise({**o, "buyer": buyer, "seller": seller}))
    return sorted(out, key=lambda x: _json(x))


def _cashflows_v2(rows: Any, own: str, cp: str) -> list:
    """Custom cashflows are signed from the booker's side (negative = the booker pays)."""
    out = []
    for r in rows or []:
        amt = Decimal(str(_get(r, "amount") or 0))
        payer, receiver = (own, cp) if amt < 0 else (cp, own)
        out.append(normalise({
            "type": _get(r, "type"), "payment_date": _get(r, "payment_date"),
            "accrual_start": _get(r, "accrual_start"), "accrual_end": _get(r, "accrual_end"),
            "currency": _get(r, "currency"), "amount": abs(amt), "payer": payer, "receiver": receiver,
        }))
    return sorted(out, key=lambda x: (x["payment_date"] or "", x["type"] or "", x["payer"], x["amount"]))


def _json(v: Any) -> str:
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _canonical_v2(trade: Any, legs: Iterable[Any], own_entity: Any, counterparty: Any) -> dict:
    own, cp = _lei(own_entity, "own entity"), _lei(counterparty, "counterparty")
    if own == cp:
        raise ValueError("both parties have the same LEI")
    out_legs = []
    for l in legs:
        payer, receiver = _sides(_get(l, "direction"), own, cp)
        leg = _pick(l, LEG_FIELDS_V2)
        leg.update({
            "payer": payer, "receiver": receiver,
            "index": normalise(_get(l, "forecast_curve_id")),
            "embedded_options": _options_v2(_get(l, "embedded_options"), own, cp),
            "custom_cashflows": _cashflows_v2((_get(l, "terms") or {}).get("custom_cashflows"), own, cp),
        })
        out_legs.append(leg)
    out_legs.sort(key=_json)   # by content: no side's leg numbering enters
    return {
        "schema": "rijeka-trade",
        "schema_version": 2,
        "uti": normalise(_get(trade, "uti")),
        "parties": sorted([own, cp]),
        "trade": _pick(trade, TRADE_FIELDS_V2),
        "legs": out_legs,
    }


def canonical_bytes(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def trade_hash(payload: dict) -> bytes:
    """keccak256 of the canonical bytes. 32 bytes."""
    return keccak(canonical_bytes(payload))


def trade_hash_hex(payload: dict) -> str:
    return "0x" + trade_hash(payload).hex()
