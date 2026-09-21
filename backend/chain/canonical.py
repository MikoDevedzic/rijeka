"""
Canonical trade record — the bytes both counterparties sign.

Schema v1 is Rijeka's own shape. When the ISDA CDM edge layer lands, v2
hashes over the CDM JSON; the schema version is inside the payload, so a
verifier always knows which serialisation to reproduce.

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

CANONICAL_SCHEMA_VERSION = 1

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


def canonical_payload(trade: Any, legs: Iterable[Any], own_entity: Any, counterparty: Any) -> dict:
    """
    Build the schema-v1 canonical record.

    trade / legs may be ORM rows or dicts. Legs are ordered by leg_seq
    (then leg_ref) so the record does not depend on query order.
    """
    legs_sorted = sorted(legs, key=lambda l: (int(_get(l, "leg_seq") or 0), str(_get(l, "leg_ref") or "")))
    return {
        "schema": "rijeka-trade",
        "schema_version": CANONICAL_SCHEMA_VERSION,
        "trade": _pick(trade, TRADE_FIELDS),
        "legs": [_pick(l, LEG_FIELDS) for l in legs_sorted],
        "parties": {
            "own":          _pick(own_entity, PARTY_FIELDS),
            "counterparty": _pick(counterparty, PARTY_FIELDS),
        },
    }


def canonical_bytes(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def trade_hash(payload: dict) -> bytes:
    """keccak256 of the canonical bytes. 32 bytes."""
    return keccak(canonical_bytes(payload))


def trade_hash_hex(payload: dict) -> str:
    return "0x" + trade_hash(payload).hex()
