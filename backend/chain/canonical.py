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
      v2 also carries the digital-asset products (2026-09-29): CRYPTO_OPTION
      (a non-deliverable option) and CRYPTO_FORWARD (a non-deliverable
      forward) on BTC/ETH, as one `product` block instead of legs, with field
      names following the ISDA Digital Asset Derivatives Definitions
      vocabulary (settlement price source, valuation date/time, settlement
      currency, cash settlement; buyer and seller by LEI). The IR_SWAP path is
      unchanged and its pinned vector still holds.

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


# ── Digital-asset products (ISDA Digital Asset Derivatives Definitions) ────
#
# Non-deliverable: cash-settled in `settlement_currency` against the
# `settlement_price_source` on `valuation_date` at `valuation_time`. The
# notional is an amount of the digital asset (e.g. 10 BTC). The booker states
# its side in trade.terms.direction (BUY / SELL of the option, or of the asset
# for a forward); the record names buyer and seller by LEI so either side's
# booking hashes identically.

CRYPTO_INSTRUMENTS = ("CRYPTO_OPTION", "CRYPTO_FORWARD")

_CRYPTO_COMMON = (
    "digital_asset",            # BTC | ETH
    "notional_amount",          # in units of the digital asset
    "valuation_date", "valuation_time", "settlement_date",
    "settlement_currency",      # USD, USDC, ...
    "settlement_price_source",  # per ISDA Settlement Price Source Matrix, e.g. "CME CF BRR"
    "calculation_agent",        # LEI, or null (both parties)
    "disruption_fallback",      # optional free text / reference to the Definitions' fallbacks
)
_CRYPTO_OPTION_FIELDS = _CRYPTO_COMMON + (
    "option_type",              # CALL | PUT
    "exercise_style",           # EUROPEAN | AMERICAN
    "strike_price", "strike_currency",
    "expiration_date", "expiration_time",
    "premium_amount", "premium_currency", "premium_payment_date",
    "automatic_exercise",       # bool
)
# A non-European style (2026-11-02) adds its terms, the FX option's vocabulary; a European NDO keeps
# the record shape above byte for byte, so records confirmed before the styles still verify.
_CRYPTO_OPTION_STYLE_FIELDS = (
    "style", "payout", "payout_currency", "barrier_type", "barrier", "lower", "upper", "rebate", "touch_type", "pay_at_hit",
    "barrier_monitoring", "barrier_determination_agent",
)
_CRYPTO_FORWARD_FIELDS = _CRYPTO_COMMON + (
    "forward_price", "price_currency",
)
_CRYPTO_REQUIRED = {
    "CRYPTO_OPTION":  ("digital_asset", "notional_amount", "option_type", "exercise_style",
                       "expiration_date", "valuation_date", "settlement_date",
                       "settlement_currency", "settlement_price_source",
                       "premium_amount", "premium_currency", "premium_payment_date"),
    "CRYPTO_FORWARD": ("digital_asset", "notional_amount", "forward_price", "price_currency",
                       "valuation_date", "settlement_date", "settlement_currency", "settlement_price_source"),
}
_UPPER = ("digital_asset", "option_type", "exercise_style", "settlement_currency", "strike_currency",
          "premium_currency", "price_currency", "style", "payout_currency", "barrier_type", "touch_type", "barrier_monitoring")
# Stored in trade.terms as JSON, so these arrive as strings; "4100.50" and
# "4100.5" must hash the same.
_NUMERIC = ("notional_amount", "strike_price", "premium_amount", "forward_price", "payout", "barrier", "lower", "upper", "rebate")
# per style, the terms a digital-asset option must state (the FX option's list with the Definitions' strike name)
_CRYPTO_STYLE_REQUIRED = {"EUROPEAN": ("strike_price", "strike_currency"), "AMERICAN": ("strike_price", "strike_currency"),
                          "DIGITAL": ("strike_price", "strike_currency", "payout", "payout_currency"),
                          "BARRIER": ("strike_price", "strike_currency", "barrier_type", "barrier"),
                          "DOUBLE_BARRIER": ("strike_price", "strike_currency", "barrier_type", "lower", "upper"),
                          "TOUCH": ("payout", "payout_currency", "touch_type")}


# ── Currency products: FX spot, forward, NDF ─────────────────────────────
#
# One record shape for a deliverable or non-deliverable forward on a
# currency pair, quoted as the market quotes it (EURUSD: USD per EUR; USDJPY:
# JPY per USD). The booker states BUY or SELL of the base currency in
# trade.terms.direction; the record names buyer and seller of the base by
# LEI so both bookings hash identically. Spot is a forward with a near value
# date. An NDF names the settlement currency, the fixing source and the
# fixing date; a deliverable forward does not.

FX_INSTRUMENTS = ("FX_SPOT", "FX_FORWARD", "NDF", "FX_OPTION")

_FX_FIELDS = (
    "currency_pair",            # EURUSD
    "base_currency", "quote_currency",
    "base_notional",            # amount of the base currency
    "quote_notional",           # base_notional * forward_rate, stated so both sides agree the cash
    "forward_rate",             # contract rate, quote per base (for spot: the dealt rate)
    "value_date",               # settlement date
    "settlement_type",          # DELIVERABLE | NON_DELIVERABLE
    "settlement_currency",      # NDF only
    "fixing_source",            # NDF only, e.g. "WM/Reuters 4pm London", "BCB PTAX"
    "fixing_date",              # NDF only
    "calculation_agent",        # LEI, or null (both parties)
)
_FX_REQUIRED = ("currency_pair", "base_currency", "quote_currency", "base_notional", "forward_rate",
                "value_date", "settlement_type")
_FX_NDF_REQUIRED = ("settlement_currency", "fixing_source", "fixing_date")
_FX_UPPER = ("currency_pair", "base_currency", "quote_currency", "settlement_type", "settlement_currency")
_FX_NUMERIC = ("base_notional", "quote_notional", "forward_rate")


# ── Currency options (ISDA FX and Currency Option Definitions) ───────────
#
# A European option on a currency pair: the right to buy (CALL) or sell (PUT) the base
# currency against the quote currency at the strike, exercised at the expiry time on the
# expiry date, settled on the settlement date by delivery of both currencies or, for a
# non-deliverable option, in the settlement currency against a fixing. The booker states
# BUY or SELL of the option in trade.terms.direction; the record names buyer and seller by
# LEI. The premium is an amount, a currency and a payment date.

_FXO_FIELDS = (
    "currency_pair", "base_currency", "quote_currency",
    "option_type",              # CALL | PUT on the base currency
    "exercise_style",           # EUROPEAN
    "base_notional",            # amount of the base currency
    "quote_notional",           # base_notional * strike
    "strike",                   # quote per base
    "expiry_date", "expiry_time",       # e.g. "10:00 New York"
    "settlement_date",
    "settlement_type",          # DELIVERABLE | NON_DELIVERABLE
    "settlement_currency",      # NDO only
    "fixing_source",            # NDO only
    "premium_amount", "premium_currency", "premium_payment_date",
    "automatic_exercise",       # bool
    "calculation_agent",        # LEI, or null (both parties)
    # styles beyond the vanilla (pricing/fx_exotic.py); absent fields are null in the record
    "style",                    # EUROPEAN | AMERICAN | DIGITAL | BARRIER | DOUBLE_BARRIER | TOUCH
    "payout", "payout_currency",            # DIGITAL / TOUCH: amount and QUOTE | BASE
    "barrier_type",             # BARRIER: UP_IN | UP_OUT | DOWN_IN | DOWN_OUT; DOUBLE_BARRIER: KNOCK_IN | KNOCK_OUT
    "barrier", "lower", "upper",            # levels, quote per base
    "rebate",                   # BARRIER: quote amount per unit base, paid at hit (out) or at expiry (in)
    "touch_type",               # ONE_TOUCH | NO_TOUCH | DOUBLE_ONE_TOUCH | DOUBLE_NO_TOUCH
    "pay_at_hit",               # bool, TOUCH
    "barrier_monitoring",       # CONTINUOUS
    "barrier_determination_agent",          # LEI, or null
)
_FXO_REQUIRED = ("currency_pair", "base_currency", "quote_currency", "option_type", "base_notional",
                 "expiry_date", "settlement_date", "settlement_type", "premium_amount", "premium_currency", "premium_payment_date")
_FXO_STYLE_REQUIRED = {"EUROPEAN": ("strike",), "AMERICAN": ("strike",), "DIGITAL": ("strike", "payout", "payout_currency"),
                       "BARRIER": ("strike", "barrier_type", "barrier"), "DOUBLE_BARRIER": ("strike", "barrier_type", "lower", "upper"),
                       "TOUCH": ("payout", "payout_currency", "touch_type")}
_FXO_NDO_REQUIRED = ("settlement_currency", "fixing_source")
_FXO_UPPER = ("currency_pair", "base_currency", "quote_currency", "option_type", "exercise_style", "settlement_type", "settlement_currency",
              "premium_currency", "style", "payout_currency", "barrier_type", "touch_type", "barrier_monitoring")
_FXO_NUMERIC = ("base_notional", "quote_notional", "strike", "premium_amount", "payout", "barrier", "lower", "upper", "rebate")


def _fx_option_product_v2(trade: Any, own: str, cp: str) -> dict:
    terms = dict(_get(trade, "terms") or {})
    style = _style_defaults(terms)
    terms.setdefault("expiry_time", "10:00 New York")
    missing = [f for f in _FXO_REQUIRED + _FXO_STYLE_REQUIRED[style] if terms.get(f) in (None, "")]
    st = str(terms.get("settlement_type") or "").upper()
    if st == "NON_DELIVERABLE":
        missing += [f for f in _FXO_NDO_REQUIRED if terms.get(f) in (None, "")]
    if missing:
        raise ValueError(f"FX_OPTION record needs {', '.join(missing)} in trade.terms — both parties must state them")
    if st not in ("DELIVERABLE", "NON_DELIVERABLE"):
        raise ValueError("settlement_type must be DELIVERABLE or NON_DELIVERABLE")
    if str(terms["option_type"]).upper() not in ("CALL", "PUT"):
        raise ValueError("option_type must be CALL or PUT")
    _style_checks(terms, style)
    base, quote = str(terms["base_currency"]).upper(), str(terms["quote_currency"]).upper()
    if str(terms["currency_pair"]).upper() != base + quote:
        raise ValueError("currency_pair must be base_currency followed by quote_currency")
    if Decimal(str(terms["base_notional"])) <= 0 or (terms.get("strike") not in (None, "") and Decimal(str(terms["strike"])) <= 0):
        raise ValueError("base_notional and strike must be positive")
    if str(terms["settlement_date"]) < str(terms["expiry_date"]):
        raise ValueError("settlement_date must be on or after expiry_date")
    buyer, seller = _sides(terms.get("direction"), own, cp, pays=("BUY", "LONG"), gets=("SELL", "SHORT"))
    out = {"product": "FX_NDO" if st == "NON_DELIVERABLE" else "FX_OPTION", "buyer": buyer, "seller": seller}
    if terms.get("quote_notional") in (None, "") and terms.get("strike") not in (None, ""):
        terms["quote_notional"] = str(Decimal(str(terms["base_notional"])) * Decimal(str(terms["strike"])))
    for f in _FXO_FIELDS:
        v = terms.get(f)
        if isinstance(v, str) and f in _FXO_UPPER:
            v = v.upper()
        if f in _FXO_NUMERIC and v not in (None, ""):
            v = _num_str(v)
        if f == "automatic_exercise":
            v = bool(v) if v not in (None, "") else True
        if f == "pay_at_hit":
            v = bool(v) if v not in (None, "") else (False if style == "TOUCH" else None)
        out[f] = normalise(v)
    return out


def _fx_product_v2(trade: Any, own: str, cp: str) -> dict:
    itype = str(_get(trade, "instrument_type") or "").upper()
    if itype == "FX_OPTION":
        return _fx_option_product_v2(trade, own, cp)
    terms = dict(_get(trade, "terms") or {})
    missing = [f for f in _FX_REQUIRED if terms.get(f) in (None, "")]
    st = str(terms.get("settlement_type") or "").upper()
    if st == "NON_DELIVERABLE" or itype == "NDF":
        missing += [f for f in _FX_NDF_REQUIRED if terms.get(f) in (None, "")]
    if missing:
        raise ValueError(f"{itype} record needs {', '.join(missing)} in trade.terms — both parties must state them")
    if st not in ("DELIVERABLE", "NON_DELIVERABLE"):
        raise ValueError("settlement_type must be DELIVERABLE or NON_DELIVERABLE")
    if itype == "NDF" and st != "NON_DELIVERABLE":
        raise ValueError("an NDF is NON_DELIVERABLE")
    base, quote = str(terms["base_currency"]).upper(), str(terms["quote_currency"]).upper()
    if str(terms["currency_pair"]).upper() != base + quote:
        raise ValueError("currency_pair must be base_currency followed by quote_currency")
    if Decimal(str(terms["base_notional"])) <= 0 or Decimal(str(terms["forward_rate"])) <= 0:
        raise ValueError("base_notional and forward_rate must be positive")
    buyer, seller = _sides(terms.get("direction"), own, cp, pays=("BUY", "LONG"), gets=("SELL", "SHORT"))
    out = {"product": "FX_SPOT" if itype == "FX_SPOT" else "FX_NDF" if st == "NON_DELIVERABLE" else "FX_FORWARD",
           "buyer": buyer, "seller": seller}
    if terms.get("quote_notional") in (None, ""):
        terms["quote_notional"] = str(Decimal(str(terms["base_notional"])) * Decimal(str(terms["forward_rate"])))
    for f in _FX_FIELDS:
        v = terms.get(f)
        if isinstance(v, str) and f in _FX_UPPER:
            v = v.upper()
        if f in _FX_NUMERIC and v not in (None, ""):
            v = _num_str(v)
        out[f] = normalise(v)
    return out


def _crypto_product_v2(trade: Any, own: str, cp: str) -> dict:
    itype = str(_get(trade, "instrument_type") or "").upper()
    terms = dict(_get(trade, "terms") or {})
    fields = _CRYPTO_OPTION_FIELDS if itype == "CRYPTO_OPTION" else _CRYPTO_FORWARD_FIELDS
    required = _CRYPTO_REQUIRED[itype]
    style = None
    if itype == "CRYPTO_OPTION":
        style = _style_defaults(terms, fx=False)
        required = required + _CRYPTO_STYLE_REQUIRED[style]
        if style != "EUROPEAN":
            fields = fields + _CRYPTO_OPTION_STYLE_FIELDS
    missing = [f for f in required if terms.get(f) in (None, "")]
    if missing:
        raise ValueError(f"{itype} record needs {', '.join(missing)} in trade.terms — both parties must state them")
    if style is not None and terms.get("exercise_style") not in (None, ""):
        _style_checks(terms, style)
    buyer, seller = _sides(terms.get("direction"), own, cp, pays=("BUY", "LONG"), gets=("SELL", "SHORT"))
    out = {"product": "NDO" if itype == "CRYPTO_OPTION" else "NDF", "buyer": buyer, "seller": seller}
    for f in fields:
        v = terms.get(f)
        if isinstance(v, str) and f in _UPPER:
            v = v.upper()
        if f in _NUMERIC and v not in (None, ""):
            v = _num_str(v)
        out[f] = normalise(v)
    if Decimal(str(terms.get("notional_amount"))) <= 0:
        raise ValueError("notional_amount must be positive")
    if out["product"] == "NDO" and out["option_type"] not in ("CALL", "PUT"):
        raise ValueError("option_type must be CALL or PUT")
    if out["product"] == "NDO" and style != "EUROPEAN":
        out["pay_at_hit"] = bool(terms.get("pay_at_hit")) if terms.get("pay_at_hit") not in (None, "") else (False if style == "TOUCH" else None)
    return out


def _style_defaults(terms: dict, fx: bool = True) -> str:
    """The option's style with the defaults every record carries; returns the style. The digital-asset
    record (fx=False) leaves automatic_exercise as booked, to keep its legacy byte shape."""
    style = str(terms.get("style") or "EUROPEAN").upper()
    if style not in _FXO_STYLE_REQUIRED:
        raise ValueError(f"style must be one of {', '.join(_FXO_STYLE_REQUIRED)}")
    terms["style"] = style
    terms.setdefault("exercise_style", "AMERICAN" if style == "AMERICAN" else "EUROPEAN")
    if fx:
        terms.setdefault("automatic_exercise", True)
    if style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH"):
        terms.setdefault("barrier_monitoring", "CONTINUOUS")
    return style


def _style_checks(terms: dict, style: str) -> None:
    """The style's own consistency rules, shared by the FX and the digital-asset option."""
    if str(terms["exercise_style"]).upper() != ("AMERICAN" if style == "AMERICAN" else "EUROPEAN"):
        raise ValueError("exercise_style must match the style (AMERICAN for an American option, EUROPEAN otherwise)")
    if style == "BARRIER" and str(terms["barrier_type"]).upper() not in ("UP_IN", "UP_OUT", "DOWN_IN", "DOWN_OUT"):
        raise ValueError("barrier_type must be UP_IN, UP_OUT, DOWN_IN or DOWN_OUT")
    if style == "DOUBLE_BARRIER":
        if str(terms["barrier_type"]).upper() not in ("KNOCK_IN", "KNOCK_OUT"):
            raise ValueError("barrier_type must be KNOCK_IN or KNOCK_OUT")
        if Decimal(str(terms["lower"])) >= Decimal(str(terms["upper"])):
            raise ValueError("lower must be below upper")
    if style == "TOUCH" and str(terms["touch_type"]).upper() not in ("ONE_TOUCH", "NO_TOUCH", "DOUBLE_ONE_TOUCH", "DOUBLE_NO_TOUCH"):
        raise ValueError("touch_type must be ONE_TOUCH, NO_TOUCH, DOUBLE_ONE_TOUCH or DOUBLE_NO_TOUCH")


def _canonical_v2(trade: Any, legs: Iterable[Any], own_entity: Any, counterparty: Any) -> dict:
    own, cp = _lei(own_entity, "own entity"), _lei(counterparty, "counterparty")
    if own == cp:
        raise ValueError("both parties have the same LEI")
    itype = str(_get(trade, "instrument_type") or "").upper()
    if itype in CRYPTO_INSTRUMENTS or itype in FX_INSTRUMENTS:
        return {
            "schema": "rijeka-trade",
            "schema_version": 2,
            "uti": normalise(_get(trade, "uti")),
            "parties": sorted([own, cp]),
            "trade": _pick(trade, TRADE_FIELDS_V2),
            "product": _crypto_product_v2(trade, own, cp) if itype in CRYPTO_INSTRUMENTS else _fx_product_v2(trade, own, cp),
        }
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
