"""
Complete a booked leg from its trade and the currency's market conventions.

Every client (the ticket, the legacy booking window, chat, scripts and tests)
may leave a leg without dates, curve ids, a standard frequency name or a day
count. The pricer used to fill the gaps at valuation time, silently, and the
P&L, market risk and counterparty credit batches then met legs they could not
schedule. Booking now writes the complete leg, so the stored row is the
contract and every downstream reader sees the same trade.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

# Overnight curve per currency (mirrors the ticket's CCY_CURVE).
CCY_CURVE = {
    "USD": "USD_SOFR", "EUR": "EUR_ESTR", "GBP": "GBP_SONIA", "JPY": "JPY_TONAR",
    "CHF": "CHF_SARON", "AUD": "AUD_AONIA", "CAD": "CAD_CORRA", "SGD": "SGD_SORA",
    "SEK": "SEK_SWESTR", "NOK": "NOK_NOWA", "NZD": "NZD_NZIONA", "HKD": "HKD_HONIA",
    "DKK": "DKK_DESTR", "MXN": "MXN_TIIE",
}
# OIS day count per currency (ACT/360: USD, EUR, CHF, SEK, DKK, MXN; ACT/365F elsewhere).
CCY_DAY_COUNT = {
    "USD": "ACT/360", "EUR": "ACT/360", "CHF": "ACT/360", "SEK": "ACT/360", "DKK": "ACT/360", "MXN": "ACT/360",
    "GBP": "ACT/365F", "JPY": "ACT/365F", "AUD": "ACT/365F", "CAD": "ACT/365F", "SGD": "ACT/365F",
    "NOK": "ACT/365F", "NZD": "ACT/365F", "HKD": "ACT/365F",
}
CANONICAL_FREQUENCIES = {"DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL", "ZERO_COUPON"}
FREQUENCY_ALIASES = {
    "D": "DAILY", "1D": "DAILY", "W": "WEEKLY", "1W": "WEEKLY",
    "M": "MONTHLY", "1M": "MONTHLY", "Q": "QUARTERLY", "3M": "QUARTERLY",
    "S": "SEMI_ANNUAL", "SA": "SEMI_ANNUAL", "6M": "SEMI_ANNUAL", "SEMIANNUAL": "SEMI_ANNUAL", "SEMI-ANNUAL": "SEMI_ANNUAL",
    "A": "ANNUAL", "Y": "ANNUAL", "1Y": "ANNUAL", "12M": "ANNUAL", "YEARLY": "ANNUAL",
    "ZC": "ZERO_COUPON", "ZERO": "ZERO_COUPON", "BULLET": "ZERO_COUPON",
}


def canonical_frequency(value: Any, default: Optional[str] = None) -> Optional[str]:
    """'6M' → 'SEMI_ANNUAL', 'semiannual' → 'SEMI_ANNUAL'; unknown names pass through unchanged."""
    if value is None or str(value).strip() == "":
        return default
    s = str(value).strip().upper().replace(" ", "_")
    if s in CANONICAL_FREQUENCIES:
        return s
    return FREQUENCY_ALIASES.get(s, s)


def complete_leg(leg: dict, *, effective_date: Optional[date] = None, maturity_date: Optional[date] = None,
                 discount_curve_id: Optional[str] = None, forecast_curve_id: Optional[str] = None,
                 currency: Optional[str] = None) -> dict:
    """Return a copy of the leg with every schedulable field set.

    Dates come from the trade when the leg has none; curves from the trade,
    then the currency's overnight curve; frequencies are canonical names; the
    day count, business day convention and stub follow the currency. Values
    the client set are never changed, except frequency spellings.
    """
    out = dict(leg)
    ccy = str(out.get("currency") or currency or "USD").upper()
    out["currency"] = ccy
    kind = str(out.get("leg_type") or "").upper()
    if not out.get("effective_date"):
        out["effective_date"] = effective_date
    if not out.get("maturity_date"):
        out["maturity_date"] = maturity_date
    out["payment_frequency"] = canonical_frequency(
        out.get("payment_frequency"), "ZERO_COUPON" if kind == "ZERO_COUPON" else "ANNUAL")
    if kind == "FLOAT":
        out["reset_frequency"] = canonical_frequency(
            out.get("reset_frequency"), "DAILY" if out.get("ois_compounding") else out["payment_frequency"])
    elif out.get("reset_frequency"):
        out["reset_frequency"] = canonical_frequency(out.get("reset_frequency"))
    if not out.get("day_count"):
        out["day_count"] = CCY_DAY_COUNT.get(ccy, "ACT/360")
    if not out.get("bdc"):
        out["bdc"] = "MOD_FOLLOWING"
    if not out.get("stub_type"):
        out["stub_type"] = "SHORT_FRONT"
    if not out.get("discount_curve_id"):
        out["discount_curve_id"] = discount_curve_id or CCY_CURVE.get(ccy, f"{ccy}_OIS")
    if kind in ("FLOAT", "FRA") and not out.get("forecast_curve_id"):
        out["forecast_curve_id"] = forecast_curve_id or out["discount_curve_id"]
    return out


def leg_is_complete(leg: dict) -> bool:
    kind = str(leg.get("leg_type") or "").upper()
    needed = ["effective_date", "maturity_date", "payment_frequency", "day_count", "discount_curve_id"]
    if kind in ("FLOAT", "FRA"):
        needed.append("forecast_curve_id")
    return all(leg.get(k) for k in needed) and leg.get("payment_frequency") in CANONICAL_FREQUENCIES
