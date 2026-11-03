"""The POST /api/book/trade bodies the app sends, per product.

Rates bodies are copied from frontend/src/components/trade-window/booking.test.js (the pinned contract: a 5Y
USD SOFR swap, a 1Y into 5Y payer swaption, a 5Y cap, floor and collar). FX and digital-asset bodies are what
FxCryptoPanel.payload() builds from a quote, with the fields TradeWindow adds (parties, dates, desk, book) and
`legs: []`, which booking.py accepts for the no-leg products.
"""
from __future__ import annotations

from datetime import date

TRADE_DATE, EFF, MAT = "2026-11-02", "2026-11-04", "2031-11-04"


def _parties(ids: dict, ref: str) -> dict:
    return {"own_legal_entity_id": ids["own_entity_id"], "counterparty_id": ids["counterparty_id"], "desk": "RATES", "book": "USD-IRS",
            "trade_ref": ref}


def swap(ids: dict, ref: str) -> dict:
    return {
        **_parties(ids, ref),
        "store": "WORKING", "asset_class": "RATES", "instrument_type": "IR_SWAP", "structure": "VANILLA",
        "notional": 10_000_000, "notional_ccy": "USD",
        "trade_date": TRADE_DATE, "effective_date": EFF, "maturity_date": MAT,
        "terms": {
            "direction": "PAY", "float_direction": "RECEIVE",
            "fixed_rate": 0.0375,
            "fixed_pay_freq": "ANNUAL", "fixed_day_count": "ACT/360", "fixed_bdc": "MOD_FOLLOWING", "fixed_calendar": None,
            "float_index": "SOFR", "float_reset_freq": "DAILY", "float_pay_freq": "ANNUAL",
            "float_day_count": "ACT/360", "float_bdc": "MOD_FOLLOWING", "float_calendar": None,
            "spread": 0, "leverage": 1,
        },
        "legs": [
            {
                "leg_ref": "FIXED-1", "leg_seq": 1, "leg_type": "FIXED",
                "direction": "PAY", "currency": "USD", "notional": 10_000_000, "notional_type": "BULLET",
                "effective_date": EFF, "maturity_date": MAT,
                "day_count": "ACT/360", "payment_frequency": "ANNUAL", "bdc": "MOD_FOLLOWING", "payment_calendar": None,
                "stub_type": "SHORT_FRONT", "payment_lag": 2,
                "fixed_rate": 0.0375, "fixed_rate_schedule": None, "notional_schedule": None,
                "discount_curve_id": "USD_SOFR", "forecast_curve_id": None, "ois_compounding": None,
                "terms": {"custom_cashflows": []},
            },
            {
                "leg_ref": "FLOAT-1", "leg_seq": 2, "leg_type": "FLOAT",
                "direction": "RECEIVE", "currency": "USD", "notional": 10_000_000, "notional_type": "BULLET",
                "effective_date": EFF, "maturity_date": MAT,
                "day_count": "ACT/360", "payment_frequency": "ANNUAL", "reset_frequency": "DAILY",
                "bdc": "MOD_FOLLOWING", "payment_calendar": None,
                "stub_type": "SHORT_FRONT", "payment_lag": 2,
                "fixed_rate": 0, "spread": 0, "spread_schedule": None, "leverage": 1, "notional_schedule": None,
                "discount_curve_id": "USD_SOFR", "forecast_curve_id": "USD_SOFR", "ois_compounding": None,
                "terms": {"custom_cashflows": []},
            },
        ],
    }


def swaption(ids: dict, ref: str) -> dict:
    body = swap(ids, ref)
    body.update(instrument_type="IR_SWAPTION", structure="EUROPEAN")
    body["terms"] = {
        **body["terms"], "fixed_rate": 0.04,
        "option": "SWAPTION", "side": "BUY", "is_payer": True,
        "expiry_date": "2027-11-02", "expiry_tenor": "1Y", "exercise_type": "EUROPEAN",
        "strike": 0.04, "vol_bp": 86.5,
        "premium_amount": 25_000, "premium_currency": "USD", "premium_payment_date": "2026-11-04",
    }
    for leg in body["legs"]:
        leg.update(effective_date="2027-11-04", maturity_date="2032-11-03")
    body["legs"][0]["fixed_rate"] = 0.04
    return body


def _cap_like(ids: dict, ref: str, instrument: str, option: str, side: str, cap_rate, floor_rate, embedded: list, vol_bp, premium) -> dict:
    return {
        **_parties(ids, ref),
        "store": "WORKING", "asset_class": "RATES", "instrument_type": instrument, "structure": None,
        "notional": 10_000_000, "notional_ccy": "USD",
        "trade_date": TRADE_DATE, "effective_date": EFF, "maturity_date": MAT,
        "terms": {
            "option": option, "side": side,
            "cap_rate": cap_rate, "floor_rate": floor_rate,
            "vol_bp": vol_bp,
            "premium_amount": premium, "premium_currency": "USD", "premium_payment_date": "2026-11-04",
            "direction": "PAY", "float_direction": "RECEIVE",
            "float_index": "SOFR", "float_reset_freq": "DAILY", "float_pay_freq": "QUARTERLY",
            "float_day_count": "ACT/360", "float_bdc": "MOD_FOLLOWING", "float_calendar": None,
            "spread": 0, "leverage": 0,
        },
        "legs": [{
            "leg_ref": "OPT-1", "leg_seq": 1, "leg_type": "FLOAT",
            "direction": "RECEIVE", "currency": "USD", "notional": 10_000_000, "notional_type": "BULLET",
            "effective_date": EFF, "maturity_date": MAT,
            "day_count": "ACT/360", "payment_frequency": "QUARTERLY", "reset_frequency": "DAILY",
            "bdc": "MOD_FOLLOWING", "payment_calendar": None,
            "stub_type": "SHORT_FRONT", "payment_lag": 2,
            "fixed_rate": 0, "spread": 0, "spread_schedule": None, "leverage": 0,
            "discount_curve_id": "USD_SOFR", "forecast_curve_id": "USD_SOFR", "ois_compounding": None,
            "embedded_options": embedded,
            "terms": {},
        }],
    }


def cap(ids: dict, ref: str) -> dict:
    return _cap_like(ids, ref, "IR_CAP", "CAP", "BUY", 0.045, None,
                     [{"type": "CAP", "direction": "BUY", "default_strike": 0.045, "strike_schedule": [{"date": EFF, "strike": 0.045}]}],
                     91.2, 123_456.78)


def floor(ids: dict, ref: str) -> dict:
    return _cap_like(ids, ref, "IR_FLOOR", "FLOOR", "SELL", None, 0.03,
                     [{"type": "FLOOR", "direction": "SELL", "default_strike": 0.03, "strike_schedule": [{"date": EFF, "strike": 0.03}]}],
                     None, None)


def collar(ids: dict, ref: str) -> dict:
    return _cap_like(ids, ref, "IR_COLLAR", "COLLAR", "BUY", 0.045, 0.03,
                     [{"type": "CAP", "direction": "BUY", "default_strike": 0.045, "strike_schedule": [{"date": EFF, "strike": 0.045}]},
                      {"type": "FLOOR", "direction": "SELL", "default_strike": 0.03, "strike_schedule": [{"date": EFF, "strike": 0.03}]}],
                     90.1, -2_500)


# ── FX and digital assets: FxCryptoPanel.payload() from a quote ───────────────────────────────────────

def _today() -> str:
    return date.today().isoformat()


def _fx_common(ids: dict, ref: str, body: dict) -> dict:
    today = _today()
    return {**body, **_parties(ids, ref), "trade_date": today, "effective_date": today, "legs": []}


def fx_forward(ids: dict, ref: str, pair: dict, quote: dict, inst: str = "FX_FORWARD") -> dict:
    """FX_SPOT / FX_FORWARD / NDF from a /api/currency/forward/price quote (K at the quoted forward)."""
    K = quote["forward"]; settle = quote["settlement_date"]; ndf = inst == "NDF"
    notional = 10_000_000
    return _fx_common(ids, ref, {
        "asset_class": "FX", "instrument_type": inst, "structure": "VANILLA",
        "notional": notional, "notional_ccy": pair["base"], "maturity_date": settle, "discount_curve_id": pair["quote_curve"],
        "terms": {
            "direction": "BUY", "currency_pair": pair["pair"], "base_currency": pair["base"], "quote_currency": pair["quote"],
            "base_notional": str(notional), "forward_rate": str(K), "value_date": settle,
            "settlement_type": "NON_DELIVERABLE" if ndf else "DELIVERABLE",
            **({"settlement_currency": "USD", "fixing_source": pair["fixing_default"], "fixing_date": settle} if ndf else {}),
            "calculation_agent": None,
        },
    })


def _style_fields(style: str, spot: float) -> dict:
    f = {"style": style}
    if style in ("DIGITAL", "TOUCH"):
        f["payout"] = 1_000_000; f["payout_currency"] = "QUOTE"
    if style == "BARRIER":
        f["barrier_type"] = "UP_OUT"; f["barrier"] = round(spot * 1.05, 4); f["rebate"] = 0.001
    if style == "DOUBLE_BARRIER":
        f["barrier_type"] = "KNOCK_OUT"; f["lower"] = round(spot * 0.95, 4); f["upper"] = round(spot * 1.05, 4)
    if style == "TOUCH":
        f["touch_type"] = "ONE_TOUCH"; f["pay_at_hit"] = False; f["barrier"] = round(spot * 1.05, 4)
    return f


def option_price_request(pair: str, style: str, spot: float, expiry: str, crypto: bool, notional) -> dict:
    """The /api/currency/option/price body the panel sends."""
    return {"pair": pair, "option_type": "CALL", "base_notional": notional, "expiry_date": expiry, "direction": "BUY",
            "settlement_type": "NON_DELIVERABLE" if crypto else "DELIVERABLE", **_style_fields(style, spot)}


def fx_option(ids: dict, ref: str, pair: dict, quote: dict, style: str) -> dict:
    notional = 10_000_000
    sf = {k: (str(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v) for k, v in _style_fields(style, quote["spot"]).items()}
    barrier_like = style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH")
    return _fx_common(ids, ref, {
        "asset_class": "FX", "instrument_type": "FX_OPTION", "structure": style,
        "notional": notional, "notional_ccy": pair["base"], "maturity_date": quote["settlement_date"], "discount_curve_id": pair["quote_curve"],
        "terms": {
            "direction": "BUY", "currency_pair": pair["pair"], "base_currency": pair["base"], "quote_currency": pair["quote"],
            "option_type": "CALL", "exercise_style": "AMERICAN" if style == "AMERICAN" else "EUROPEAN",
            "base_notional": str(notional),
            **({"strike": str(quote["strike"]), "quote_notional": str(notional * quote["strike"])} if style != "TOUCH" else {}),
            **sf,
            **({"barrier_monitoring": "CONTINUOUS", "barrier_determination_agent": None} if barrier_like else {}),
            "expiry_date": quote["expiry_date"], "expiry_time": "10:00 New York", "settlement_date": quote["settlement_date"],
            "settlement_type": "DELIVERABLE",
            "premium_amount": str(abs(round(quote["npv"] * 100) / 100)), "premium_currency": pair["quote"], "premium_payment_date": quote["valuation_date"],
            "vol_pct": quote["vol_pct"], "vol_tier": quote["vol_tier"], "automatic_exercise": True, "calculation_agent": None,
        },
    })


def crypto_forward(ids: dict, ref: str, pair: dict, quote: dict) -> dict:
    K = quote["forward"]; settle = quote["settlement_date"]; notional = 10
    return _fx_common(ids, ref, {
        "asset_class": "CRYPTO", "instrument_type": "CRYPTO_FORWARD", "structure": "VANILLA",
        "notional": notional, "notional_ccy": pair["base"], "maturity_date": settle, "discount_curve_id": pair["quote_curve"],
        "terms": {
            "digital_asset": pair["base"], "notional_amount": str(notional), "direction": "BUY", "forward_price": str(K), "price_currency": "USD",
            "valuation_date": settle, "valuation_time": "16:00 London", "settlement_date": settle, "settlement_currency": "USD",
            "settlement_price_source": pair["fixing_default"], "calculation_agent": None,
            "disruption_fallback": "ISDA Digital Asset Derivatives Definitions fallbacks",
        },
    })


def crypto_option(ids: dict, ref: str, pair: dict, quote: dict, style: str) -> dict:
    notional = 10
    sf = {k: (str(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v) for k, v in _style_fields(style, quote["spot"]).items()}
    barrier_like = style in ("BARRIER", "DOUBLE_BARRIER", "TOUCH")
    return _fx_common(ids, ref, {
        "asset_class": "CRYPTO", "instrument_type": "CRYPTO_OPTION", "structure": style,
        "notional": notional, "notional_ccy": pair["base"], "maturity_date": quote["settlement_date"], "discount_curve_id": pair["quote_curve"],
        "terms": {
            "direction": "BUY", "digital_asset": pair["base"], "notional_amount": str(notional), "option_type": "CALL",
            "exercise_style": "AMERICAN" if style == "AMERICAN" else "EUROPEAN",
            **({"strike_price": str(quote["strike"]), "strike_currency": "USD"} if style != "TOUCH" else {}),
            **sf,
            **({"barrier_monitoring": "CONTINUOUS", "barrier_determination_agent": None} if barrier_like else {}),
            "expiration_date": quote["expiry_date"], "expiration_time": "08:00 UTC", "valuation_date": quote["expiry_date"], "valuation_time": "08:00 UTC",
            "settlement_date": quote["settlement_date"], "settlement_currency": "USD", "settlement_price_source": pair["fixing_default"],
            "premium_amount": str(abs(round(quote["npv"] * 100) / 100)), "premium_currency": "USD", "premium_payment_date": quote["valuation_date"],
            "vol_pct": quote["vol_pct"], "vol_tier": quote["vol_tier"], "automatic_exercise": True, "calculation_agent": None,
            "disruption_fallback": "ISDA Digital Asset Derivatives Definitions fallbacks",
        },
    })


STYLES = ("EUROPEAN", "AMERICAN", "DIGITAL", "BARRIER", "DOUBLE_BARRIER", "TOUCH")
