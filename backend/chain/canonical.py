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
  v3  (2026-11-19) An option on a rate states the option. Under v2 a swaption's
      record was the swap it delivers and nothing else: no buyer or seller, no
      expiry, no premium, and each leg's payer read from the ticket's PAY or
      RECEIVE chip, so a bought and a sold swaption signed the same bytes and
      the sold one named the wrong payer. v3 adds one `option` block. For
      IR_SWAPTION: buyer and seller by LEI, the right (PAYER or RECEIVER: what
      the buyer does with the fixed rate on exercise), the exercise style, the
      expiry date, a Bermudan's later exercise times as booked, the strike,
      physical settlement, and the premium (amount, currency, date); the legs
      are the swap delivered on exercise, each with the payer it will have if
      the buyer exercises; the trade block leaves out effective and maturity
      dates (the legs carry the swap's, the option its own). For IR_CAP,
      IR_FLOOR and IR_COLLAR the record is v2's (the strikes, the buyer and the
      seller were already on the leg) with the premium: amount, currency,
      date, who pays it and who receives it. ONLY these four instruments are
      signed under v3; every other product is still signed under v2 and its
      bytes are unchanged (signing_version). A confirmation signed under v2
      is re-derived under v2, as always.

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
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

from eth_utils import keccak

CANONICAL_SCHEMA_VERSION = 2          # what a new confirmation is signed under, except an option on a rate (signing_version)
SUPPORTED_SCHEMA_VERSIONS = (1, 2, 3) # what can be re-derived for verification
RATES_OPTIONS = ("IR_SWAPTION", "IR_CAP", "IR_FLOOR", "IR_COLLAR")    # signed under v3: the record states the option
RATES_OPTION_SCHEMA_VERSION = 3

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


def signing_version(trade: Any) -> int:
    """The version a NEW confirmation of this trade is signed under: v3 for an option on a rate, v2 for the rest."""
    return RATES_OPTION_SCHEMA_VERSION if str(_get(trade, "instrument_type") or "").upper() in RATES_OPTIONS else CANONICAL_SCHEMA_VERSION


def canonical_payload(trade: Any, legs: Iterable[Any], own_entity: Any, counterparty: Any,
                      version: int | None = None) -> dict:
    """
    Build the canonical record under `version` (default: the version a new
    confirmation of this trade is signed under, signing_version).

    trade / legs may be ORM rows or dicts; own_entity / counterparty are
    {lei, name}. A confirmation must be re-derived with the version recorded
    in its attestation, never with whatever is current.
    """
    if version is None:
        version = signing_version(trade)
    if version == 1:
        return _canonical_v1(trade, legs, own_entity, counterparty)
    if version == 2:
        return _canonical_v2(trade, legs, own_entity, counterparty)
    if version == 3:
        return _canonical_v3(trade, legs, own_entity, counterparty)
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


# ── Schema v3: an option on a rate states the option ────────────────────────────────────────────
# The option's terms are read from trade.terms, where the ticket books them and where the valuations read them
# (ccr.options.swaption_terms, pnl.valuation): side, is_payer, expiry_date, strike, exercise_type, the premium.

TRADE_FIELDS_V3_SWAPTION = ("asset_class", "instrument_type", "structure", "notional", "notional_ccy", "trade_date")
_BUYS, _SELLS = ("BUY", "LONG"), ("SELL", "SHORT", "WRITE")


_AMOUNT_MAX = Decimal("1e15")
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")
_CCY = re.compile(r"^[A-Z]{3}$")


def _amount(x: Any, what: str) -> Decimal:
    """A number from the booking's free-form terms: finite and of a size money has. The terms are a JSON blob the
    booker writes; what is read from it into a record both parties sign is checked here, not trusted."""
    if isinstance(x, bool) or not isinstance(x, (int, float, Decimal, str)):
        raise ValueError(f"{what} is not a number")
    try:
        d = Decimal(str(x).strip())
    except ArithmeticError:
        raise ValueError(f"{what} is not a number")
    if not d.is_finite() or abs(d) >= _AMOUNT_MAX:
        raise ValueError(f"{what} is not a number a trade can carry")
    return d


def _iso_date(x: Any, what: str) -> str:
    s = x.isoformat() if isinstance(x, (date, datetime)) else str(x or "")
    if not _ISO_DATE.match(s):
        raise ValueError(f"{what} is not a date")
    try:
        return date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        raise ValueError(f"{what} is not a date")


def _premium_v3(terms: dict) -> tuple[dict, Decimal | None]:
    """({premium_amount, premium_currency, premium_payment_date}, the amount as booked with its sign): the record's
    amount is unsigned; all three are null where none was booked."""
    amt = terms.get("premium_amount")
    if amt in (None, ""):
        return {"premium_amount": None, "premium_currency": None, "premium_payment_date": None}, None
    d = _amount(amt, "the premium")
    ccy = str(terms.get("premium_currency") or "").upper()
    if not _CCY.match(ccy) or not terms.get("premium_payment_date"):
        raise ValueError("a premium needs its currency (three letters) and its payment date")
    return {"premium_amount": _num_str(abs(d)), "premium_currency": ccy,
            "premium_payment_date": _iso_date(terms["premium_payment_date"], "the premium's payment date")}, d


def _swaption_option_v3(trade: Any, legs: list, own: str, cp: str) -> dict:
    terms = dict(_get(trade, "terms") or {})
    fixed = [l for l in legs if str(_get(l, "leg_type") or "").upper() == "FIXED"]
    if len(fixed) != 1 or len(legs) != 2:
        raise ValueError("a swaption's record needs the swap it delivers: one fixed leg and one floating leg")
    # the side: bought unless the booking says sold (the valuations read it the same way: a booking with no side is long)
    buyer, seller = _sides(terms.get("side") or "BUY", own, cp, pays=_BUYS, gets=_SELLS)
    # the right, read as the valuations read it (terms.is_payer where the booking has it, else the ticket's PAY or
    # RECEIVE); a booking that holds the key and no answer is refused, since the valuations would read it as a receiver
    if "is_payer" in terms:
        if not isinstance(terms["is_payer"], bool):
            raise ValueError("a swaption's record needs its right: payer or receiver")
        is_payer = terms["is_payer"]
    elif str(terms.get("direction") or "").upper() in ("PAY", "RECEIVE"):
        is_payer = str(terms["direction"]).upper() == "PAY"
    else:
        raise ValueError("a swaption's record needs its right: payer or receiver")
    # the legs are booked as the holder's swap (the fixed leg paid by a payer swaption's holder), on both sides: a
    # booking whose legs say otherwise is not signed, and one changed after signing no longer re-derives
    if str(_get(fixed[0], "direction") or "").upper() != ("PAY" if is_payer else "RECEIVE"):
        raise ValueError("a swaption's legs are booked as its holder's swap: the fixed leg's direction disagrees with the option's right")
    if not terms.get("expiry_date"):
        raise ValueError("a swaption's record needs its expiry date, which this booking does not hold: book it again from the ticket")
    expiry = _iso_date(terms["expiry_date"], "the expiry date")
    for l in legs:
        if not _get(l, "effective_date") or not _get(l, "maturity_date"):
            raise ValueError("the swap a swaption delivers needs its effective and termination dates on each leg")
    eff = _iso_date(_get(fixed[0], "effective_date"), "the delivered swap's effective date")
    if eff < expiry:
        raise ValueError("the swap a swaption delivers cannot start before the option expires")
    # the strike is the fixed rate of the swap delivered, as the leg holds it (eight decimals); the booking's own copy
    # of it in the terms must be the same rate
    strike = _get(fixed[0], "fixed_rate")
    if strike in (None, ""):
        raise ValueError("a swaption's record needs its strike")
    eight = Decimal("0.00000001")
    # the valuations read terms.strike where the booking has one (an empty one as nought): it must be the leg's rate
    if terms.get("strike") is not None and _amount(terms["strike"], "the strike").quantize(eight) != _amount(strike, "the strike").quantize(eight):
        raise ValueError("a swaption's strike is the fixed rate of the swap it delivers: the booking holds two different rates")
    style = str(terms.get("exercise_type") or _get(trade, "structure") or "EUROPEAN").upper()
    if style not in ("EUROPEAN", "BERMUDAN"):
        raise ValueError("a swaption is exercised EUROPEAN or BERMUDAN")
    times = terms.get("exercise_schedule_y") if style == "BERMUDAN" else None
    if times is not None:
        if not isinstance(times, (list, tuple)) or len(times) > 120:
            raise ValueError("a Bermudan's exercise times are a list of years")
        for t in times:
            if not (0 < _amount(t, "an exercise time") <= 100):
                raise ValueError("an exercise time is a number of years from the trade date, up to a hundred")
    premium, _signed = _premium_v3(terms)
    return normalise({
        "type": "SWAPTION", "buyer": buyer, "seller": seller,
        "right": "PAYER" if is_payer else "RECEIVER",        # PAYER: on exercise the buyer pays the fixed rate
        "exercise_style": style, "expiry_date": expiry,
        # a Bermudan's exercise times as booked, in years from the trade date; null: exercised on the expiry date only
        "exercise_schedule_y": [_num_str(t) for t in times] if times else None,
        "strike": strike, "settlement": "PHYSICAL",
        **premium,
    })


def _canonical_v3(trade: Any, legs: Iterable[Any], own_entity: Any, counterparty: Any) -> dict:
    itype = str(_get(trade, "instrument_type") or "").upper()
    if itype not in RATES_OPTIONS:
        raise ValueError(f"schema v3 is the record of an option on a rate; {itype or 'this trade'} is signed under v2")
    legs = list(legs)
    out = _canonical_v2(trade, legs, own_entity, counterparty)
    own, cp = _lei(own_entity, "own entity"), _lei(counterparty, "counterparty")
    out["schema_version"] = 3
    terms = dict(_get(trade, "terms") or {})
    if itype == "IR_SWAPTION":
        option = _swaption_option_v3(trade, legs, own, cp)
        # the swap delivered on exercise: who pays each leg if the buyer exercises, whichever side booked it
        fixed_payer, fixed_receiver = (option["buyer"], option["seller"]) if option["right"] == "PAYER" else (option["seller"], option["buyer"])
        for leg in out["legs"]:
            if str(leg.get("leg_type") or "").upper() == "FIXED":
                leg["payer"], leg["receiver"] = fixed_payer, fixed_receiver
            else:
                leg["payer"], leg["receiver"] = fixed_receiver, fixed_payer
        out["legs"].sort(key=_json)
        out["trade"] = _pick(trade, TRADE_FIELDS_V3_SWAPTION)
    else:
        # a cap, a floor, a collar: the strikes and who buys and sells each are on the leg (v2). The premium is booked
        # as the buyer of the structure sees it: positive paid by that side, negative (a collar whose floor is worth
        # more) paid to it. The record holds it unsigned, with who pays and who receives.
        kind = itype.replace("IR_", "")
        # who bought the structure is read from the options on the leg, which the record already holds and the
        # valuations read: the buyer of the cap (a cap, a collar) or of the floor (a floor). The booking's own
        # terms.side must say the same, and a collar is a cap bought from the side that buys the floor.
        written = [o for l in out["legs"] for o in (l.get("embedded_options") or [])]
        of = lambda t: [o for o in written if str(o.get("type") or "").upper() == t]      # noqa: E731
        caps, floors = of("CAP"), of("FLOOR")
        want = {"CAP": (1, 0), "FLOOR": (0, 1), "COLLAR": (1, 1)}[kind]
        if (len(caps), len(floors)) != want or len(written) != sum(want):
            raise ValueError(f"the record of a {kind.lower()} needs its option on the leg, with its strike: this booking's leg does not hold it")
        lead = (caps or floors)[0]
        buyer, seller = lead["buyer"], lead["seller"]
        if kind == "COLLAR" and (floors[0]["buyer"], floors[0]["seller"]) != (seller, buyer):
            raise ValueError("a collar is a cap bought from the side that buys the floor: this booking's two options are bought by the same side")
        if terms.get("side") not in (None, "") and _sides(terms["side"], own, cp, pays=_BUYS, gets=_SELLS) != (buyer, seller):
            raise ValueError(f"the booking says one side bought the {kind.lower()} and the option on its leg says the other")
        premium, signed = _premium_v3(terms)
        payer = receiver = None
        if signed is not None:
            payer, receiver = (buyer, seller) if signed >= 0 else (seller, buyer)
        option = normalise({"type": kind, "buyer": buyer, "seller": seller, **premium, "premium_payer": payer, "premium_receiver": receiver})
    out["option"] = option
    return out


# ── A package of trades confirmed as one ────────────────────────────────────────────────────────
# A package (a strip, a collar) is several trades between the same two parties, each with its own UTI and its own
# canonical record (above). The package record is what the parties sign and the registry anchors ONCE: the two
# LEIs and the hashes of the legs' records, sorted. It commits to every term of every leg; a leg is proved by
# re-deriving its own record, finding its hash in `legs`, and re-deriving the package hash. Neither firm's
# reference for the package enters: each side derives the same bytes from its own bookings of the legs.
PACKAGE_SCHEMA = "rijeka-package"
PACKAGE_SCHEMA_VERSION = 1


def package_payload(leg_hashes: Iterable[str], parties: Iterable[str]) -> dict:
    """The package record under the current version. leg_hashes: '0x' + 64 hex, one per leg (at least two, no
    repeats); parties: the two LEIs."""
    legs = sorted(str(h).lower() for h in leg_hashes)
    if len(legs) < 2:
        raise ValueError("a package has at least two legs")
    if len(set(legs)) != len(legs):
        raise ValueError("two legs of a package have the same record")
    for h in legs:
        if not (h.startswith("0x") and len(h) == 66 and all(c in "0123456789abcdef" for c in h[2:])):
            raise ValueError(f"{h!r} is not a 32-byte hash")
    ps = sorted(str(x) for x in parties)
    if len(ps) != 2 or ps[0] == ps[1] or not all(ps):
        raise ValueError("a package is between two parties with different LEIs")
    return {"schema": PACKAGE_SCHEMA, "schema_version": PACKAGE_SCHEMA_VERSION, "parties": ps, "legs": legs}


def package_hash(payload: dict) -> bytes:
    """keccak256 of the package record's canonical bytes. 32 bytes: what both parties sign and the registry holds."""
    if payload.get("schema") != PACKAGE_SCHEMA or payload.get("schema_version") != PACKAGE_SCHEMA_VERSION:
        raise ValueError("not a package record of a supported version")
    return keccak(canonical_bytes(payload))


def canonical_bytes(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def trade_hash(payload: dict) -> bytes:
    """keccak256 of the canonical bytes. 32 bytes."""
    return keccak(canonical_bytes(payload))


def trade_hash_hex(payload: dict) -> str:
    return "0x" + trade_hash(payload).hex()
