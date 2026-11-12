"""Fees on a trade: any number of known payments, each with a type, a direction, an amount, a currency and a date.

An option's premium is one of them; so is an upfront payment on a swap, a broker's fee, an unwind fee, a premium
paid in instalments (several rows). They are part of the trade as it is entered (`terms.fees`), part of its value
(a payment still to come is worth its amount discounted from its date) and part of its exposure (until it is paid,
a fee we are owed is something the counterparty can fail to pay, and a fee we owe is something we can).

    value today  =  Σ  ± amount · DF(0, date)             + we receive, − we pay; a fee dated before today is paid
    value at t   =  Σ  ± amount · DF(t, date)              over the fees dated after t

One currency: every fee of a trade is in the currency the trade is valued in (the quote currency of a pair, the
notional's on a rates trade). A fee in another currency is not taken yet; nothing converts.
"""
from __future__ import annotations

import math
import re
from datetime import date
from typing import Callable, Optional

import numpy as np

FEE_TYPES = ("PREMIUM", "UPFRONT", "BROKERAGE", "UNWIND", "OTHER")
DIRECTIONS = ("PAY", "RECEIVE")
MAX_FEES = 24
_CCY = re.compile(r"[A-Z]{3,5}")
_NOTE = re.compile(r"[A-Za-z0-9 .,:;%/()+&'_-]{0,60}")


def normalise(raw, currency: Optional[str] = None) -> list[dict]:
    """The fees as the record keeps them, or ValueError saying which one is wrong and why. `currency`, when given,
    is the one every fee must be in."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("fees: a list of fees")
    if len(raw) > MAX_FEES:
        raise ValueError(f"fees: at most {MAX_FEES} on a trade")
    out = []
    for i, f in enumerate(raw, 1):
        if not isinstance(f, dict):
            raise ValueError(f"fee {i}: a fee has a type, a direction, an amount, a currency and a date")
        kind = str(f.get("type") or "").upper()
        if kind not in FEE_TYPES:
            raise ValueError(f"fee {i}: the type is one of {', '.join(FEE_TYPES)}")
        direction = str(f.get("direction") or "").upper()
        if direction not in DIRECTIONS:
            raise ValueError(f"fee {i}: the direction is PAY or RECEIVE")
        try:
            amount = float(f.get("amount"))
        except (TypeError, ValueError):
            raise ValueError(f"fee {i}: the amount is a number") from None
        if not (math.isfinite(amount) and amount > 0):
            raise ValueError(f"fee {i}: the amount is above zero (the direction says which way it goes)")
        ccy = str(f.get("currency") or "").upper()
        if not _CCY.fullmatch(ccy):
            raise ValueError(f"fee {i}: the currency is its code")
        if currency and ccy != str(currency).upper():
            raise ValueError(f"fee {i}: a fee is in the trade's own currency ({str(currency).upper()}), not {ccy}")
        try:
            when = f.get("date") if isinstance(f.get("date"), date) else date.fromisoformat(str(f.get("date")))
        except (TypeError, ValueError):
            raise ValueError(f"fee {i}: the date is a date (YYYY-MM-DD)") from None
        note = str(f.get("note") or "").strip()
        if not _NOTE.fullmatch(note):
            raise ValueError(f"fee {i}: the note is up to 60 plain characters")
        out.append({"type": kind, "direction": direction, "amount": amount, "currency": ccy, "date": when.isoformat(), **({"note": note} if note else {})})
    return out


def signed(fee: dict) -> float:
    """The amount from our side: + we receive, − we pay."""
    return float(fee["amount"]) * (1.0 if fee["direction"] == "RECEIVE" else -1.0)


def present_values(fees: list[dict], val_date: date, df: Callable[[date], float]) -> dict:
    """Each fee with its discount factor and value today, and the total. A fee dated before today is paid: worth
    nothing now, and said to be paid. `df(date)` is the discount factor from today on the fees' currency curve."""
    rows, total = [], 0.0
    for f in fees:
        when = date.fromisoformat(f["date"])
        paid = when < val_date
        d = 0.0 if paid else (1.0 if when == val_date else float(df(when)))
        pv = signed(f) * d
        total += pv
        rows.append({**f, "paid": paid, "df": d, "pv": pv})
    return {"fees": rows, "pv": total, "pay": sum(r["pv"] for r in rows if r["pv"] < 0), "receive": sum(r["pv"] for r in rows if r["pv"] > 0)}


def in_years(fees: list[dict], val_date: date) -> list[tuple[float, float]]:
    """(years from the valuation date, signed amount) for the fees dated AFTER it: what a simulation needs of them.
    A fee dated on the valuation date is paid that day: it is in the trade's value today (present_values) and is
    not something either side can still fail to pay, so it is not in an exposure."""
    return [((date.fromisoformat(f["date"]) - val_date).days / 365.0, signed(f)) for f in fees if date.fromisoformat(f["date"]) > val_date]


def value_at(cash: list[tuple[float, float]], t, zero: float) -> np.ndarray:
    """The value at each time in `t` (years) of the fees dated after it, from our side, discounted at a flat
    continuous rate `zero` (the engines' own proxy for the curve along a path). A fee dated at t or before is paid."""
    t = np.atleast_1d(np.asarray(t, dtype=float))
    out = np.zeros_like(t)
    for when, amount in cash:
        left = when - t
        out += np.where(left > 1e-9, amount * np.exp(-zero * np.maximum(left, 0.0)), 0.0)
    return out
