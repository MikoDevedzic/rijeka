"""What fixes, day by day: the book's exposure to each coming fixing, by index.

Two kinds of fixing, kept apart because they are hedged apart.

Rate resets. Every floating period the pricer values is compounded in arrears from an overnight index (the
forecast curve it is projected on: USD_SOFR, EUR_ESTR, ...): its rate is not set on one day but on every business
day from the period's start to its end, each day's fixing counting for the calendar days until the next one. So on
a business day D the book "resets" every floating period that contains D:

    resetting on D, index I   = Σ over such periods of  ± notional × leverage      (+ where the desk receives the float)
    fixing 01 on D, index I   = Σ  ± notional × leverage × a × n(D) × DF(payment) × 1bp × (1 + R·τ) / (1 + R·a·n(D))

n(D) is the calendar days D's fixing counts for (three over a weekend), a = τ / days in the period is the period's
accrual per calendar day in the leg's own day count, DF is the discount factor to the period's payment date and R
the period's projected rate, both read from the valuation. The last factor is the compounding: a fixing also earns
on every other day's interest of its period, exactly Π over the other days of (1 + f·a·n), written with the
period's own rate for every day's (the difference is a few parts in a hundred thousand). Without it the figure is
low by R·τ: 1.3 % on a quarter at 5 %, 5 % on a year. The discount factor is held: a fixing 01 is the forecast's
share of the ladder's IR01, not its discounting. A leg's leverage scales it (a leg booked at leverage 0 has no
linear exposure and is not listed); a spread does not. A CMS leg is valued by the pricer as the same compounded
forward and is listed the same way. The days are the business days of the leg's currency, the index's own calendar.

Settlement fixings. A non-deliverable forward (a currency NDF, a digital-asset forward) is settled against one
published price on its fixing date. Each is listed on that date, by pair and source, with the notional that fixes
and the value of 1 % on the price (the trade's own spot 01, which is on its forward).

Not in it, and said so in the result: caps, floors and swaptions (an option on a fixing is a delta, not a
notional), option expiries, and anything the valuation could not price. A floating leg that carries a cap or a
floor is listed as the plain reset it would be without it, and counted. One pricing of each rates trade is made
for this (pnl.valuation.priced_legs), on the market and date of the ladder.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Callable, Optional

from pnl.explain import LIVE
from pricing.calendars import ccy_to_calendar, is_business_day

log = logging.getLogger("rijeka.risk")
HORIZON_DAYS = 92                 # calendar days of resets listed day by day: a quarter, the longest period most swaps have
FLOATING = ("FLOAT", "OIS", "CMS")       # what the pricer projects on a forecast curve, compounded over the period
OPTIONAL = ("IR_CAP", "IR_FLOOR", "IR_COLLAR", "IR_SWAPTION", "BERMUDAN_SWAPTION", "FX_OPTION", "CRYPTO_OPTION")
BP = 1e-4
_CURRENCIES = {"USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "MXN", "ZAR", "SGD", "HKD", "CNH", "CNY", "TRY", "BRL", "INR", "KRW"}


def _d(x) -> Optional[date]:
    if isinstance(x, date):
        return x
    try:
        return date.fromisoformat(str(x)[:10])
    except (TypeError, ValueError):
        return None


def fixing_days(start: date, end: date, asof: date, upto: date, calendar: str) -> list[tuple[date, int]]:
    """The business days from `asof` on whose fixing sets part of a period [start, end), each with the calendar days
    of the period it counts for (to the next business day, or to the period's end), and none past `upto`. A period
    that opens on a day that is not a business day (its dates are not adjusted) is opened by the fixing of the
    business day before it, which is listed on its own date if that is still to come."""
    out = []
    d = max(start, asof)
    if not is_business_day(d, calendar):
        nxt = d
        while nxt < end and not is_business_day(nxt, calendar):
            nxt += timedelta(days=1)
        if d == start:
            prev = start - timedelta(days=1)
            while not is_business_day(prev, calendar):
                prev -= timedelta(days=1)
            if asof <= prev <= upto:
                out.append((prev, (nxt - start).days))
        d = nxt                                              # from `asof` inside the period: the days to the next business day are fixed already
    while d < end and d <= upto:
        nxt = d + timedelta(days=1)
        while nxt < end and not is_business_day(nxt, calendar):
            nxt += timedelta(days=1)
        out.append((d, (min(nxt, end) - d).days))
        d = nxt
    return out


def period_resets(cf: dict, leg: dict, index: str, calendar: str, asof: date, upto: date, leverage: float = 1.0) -> list[dict]:
    """One floating period of a priced leg → its resets from `asof` to `upto`: {date, index, ccy, days, notional,
    fixing01} in the leg's currency, signed + where the desk receives the floating rate."""
    start, end = _d(cf.get("period_start")), _d(cf.get("period_end"))
    n, dcf = float(cf.get("notional") or 0.0), float(cf.get("dcf") or 0.0)
    if not start or not end or end <= start or not n or not dcf or not leverage:
        return []
    sign = 1.0 if str(leg.get("direction") or "").upper().startswith("REC") else -1.0
    df = float(cf["df"]) if cf.get("df") is not None else 1.0
    ccy = str(leg.get("currency") or "USD").upper()
    per_day = dcf / (end - start).days
    size = sign * abs(n) * leverage
    # the period's projected index rate, for the compounding: the cashflow's rate is leverage x index + spread, and
    # the spread is left in (it moves the factor by spread x accrual, a few parts in ten thousand)
    r = float(cf["rate"]) / leverage if cf.get("rate") is not None else 0.0
    grow = 1.0 + r * dcf
    return [{"date": d, "index": index, "ccy": ccy, "days": k, "notional": size,
             "fixing01": size * per_day * k * df * BP * grow / (1.0 + r * per_day * k)}
            for d, k in fixing_days(start, end, asof, upto, calendar)]


def _number(x, default: float) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def trade_resets(priced_legs: list[dict], legs: dict[str, dict], default_index: str, asof: date, upto: date) -> list[dict]:
    """Every reset of one trade from the legs the pricer returned (`priced_legs`) and the trade's own legs by id
    (for the curve a leg is projected on and its leverage)."""
    out = []
    for pl in priced_legs or []:
        if str(pl.get("leg_type") or "").upper() not in FLOATING:
            continue
        meta = legs.get(str(pl.get("leg_id"))) or {}
        index = str(meta.get("forecast_curve_id") or default_index or "").upper()
        cal = ccy_to_calendar(str(pl.get("currency") or meta.get("currency") or "USD"))      # the index's days, not the payment calendar's
        lev = _number(meta.get("leverage"), 1.0) if meta.get("leverage") is not None else 1.0
        for cf in pl.get("cashflows") or []:
            if str(cf.get("cashflow_type") or "COUPON").upper() != "COUPON":
                continue
            out += period_resets(cf, pl, index, cal, asof, upto, lev)
    return out


def embedded_options(legs: dict[str, dict]) -> int:
    """How many of a trade's floating legs carry a cap or a floor: listed as plain resets, and counted."""
    return sum(1 for l in legs.values() if str(l.get("leg_type") or "").upper() in FLOATING and _number(l.get("leverage"), 1.0)
               and (l.get("cap_rate") is not None or l.get("floor_rate") is not None or l.get("embedded_options")))


def settlement_fixing(trade, terms: dict, pair: str, source: str, spot01: Optional[float], asof: date) -> Optional[dict]:
    """A non-deliverable forward's one fixing, if it is still to come: {date, pair, source, unit, units, spot01}."""
    named = _d(terms.get("fixing_date")) or _d((trade.terms or {}).get("fixing_date"))
    fix = named or _d(terms.get("settle"))
    if not fix or fix < asof:
        return None
    sign = -1.0 if str(terms.get("direction") or "BUY").upper() in ("SELL", "PAY", "SHORT") else 1.0
    unit = pair[:-3] if len(pair) > 3 else pair
    # what a reader should know of the date: the trade names no fixing date (its settlement date stands in), or a
    # currency's fixing falls on a weekend, when no currency fixing is published (a digital asset's is, every day)
    note = "its settlement date" if not named else ""            # short: it stands beside the date
    if fix.weekday() >= 5 and unit.upper() in _CURRENCIES:
        note = (note + ", " if note else "") + "a weekend"
    return {"date": fix, "pair": pair, "source": source or "", "unit": unit,
            "units": sign * abs(float(terms.get("notional") or 0.0)), "spot01": spot01, "note": note}


def book_fixings(db, user: dict, trades, d: date, mkt, fx: Callable[[str], Optional[float]], valuer=None, horizon_days: int = HORIZON_DAYS) -> dict[str, Any]:
    """The book's fixings from `d`: rate resets day by day for `horizon_days`, and every settlement fixing to come.
    `valuer` is the ladder's (pnl.explain.Valuer), so a trade is priced once for both."""
    from api.routes.currencies import CURRENCY_INSTRUMENTS
    from pnl.explain import Valuer
    from pnl.valuation import _currency_terms, _trade_legs, priced_legs
    valuer = valuer or Valuer(db, user)
    upto = d + timedelta(days=horizon_days)
    resets: dict[tuple, dict] = {}
    settle: dict[tuple, dict] = {}
    not_covered: dict[str, int] = {}
    problems, unconverted, capped = [], set(), 0
    for t in trades:
        if t.status not in LIVE:
            continue
        itype = str(t.instrument_type or "").upper()
        try:
            if itype in OPTIONAL:
                not_covered[itype] = not_covered.get(itype, 0) + 1
                continue
            if itype in CURRENCY_INSTRUMENTS:
                v = valuer(t, d, mkt)
                pair, terms = _currency_terms(t)
                if terms.get("shape") != "NDF":
                    continue                                    # a deliverable forward or a spot trade settles; nothing fixes
                k = fx(v.get("ccy") or "USD")
                s01 = float(v["spot01"]) * k if v.get("spot01") is not None and k is not None else None
                src = str((t.terms or {}).get("settlement_price_source") or (t.terms or {}).get("fixing_source") or "")
                row = settlement_fixing(t, terms, pair, src, s01, d)
                if row:
                    key = (row["date"], row["pair"], row["source"])
                    a = settle.setdefault(key, {"date": row["date"].isoformat(), "pair": row["pair"], "source": row["source"], "unit": row["unit"],
                                                "buy_units": 0.0, "sell_units": 0.0, "net_units": 0.0, "spot01_usd": 0.0, "trades": 0, "note": row["note"]})
                    a["buy_units" if row["units"] > 0 else "sell_units"] += row["units"]
                    a["net_units"] += row["units"]; a["spot01_usd"] += row["spot01"] or 0.0; a["trades"] += 1
                continue
            priced = priced_legs(db, user, t, d, mkt)
            if not priced:
                continue
            legs = {str(l.get("id")): l for l in _trade_legs(db, user, t)}
            capped += embedded_options(legs)
            rows = trade_resets(priced, legs, t.forecast_curve_id or t.discount_curve_id or "", d, upto)
            seen = set()
            for r in rows:
                k = fx(r["ccy"])
                if k is None:
                    unconverted.add(r["ccy"]); continue
                key = (r["date"], r["index"])
                a = resets.setdefault(key, {"date": r["date"].isoformat(), "index": r["index"], "ccy": r["ccy"], "days": r["days"],
                                            "receive_usd": 0.0, "pay_usd": 0.0, "net_usd": 0.0, "fixing01_usd": 0.0, "trades": 0})
                a["receive_usd" if r["notional"] > 0 else "pay_usd"] += r["notional"] * k
                a["net_usd"] += r["notional"] * k; a["fixing01_usd"] += r["fixing01"] * k
                a["days"] = max(a["days"], r["days"])
                if key not in seen:
                    a["trades"] += 1; seen.add(key)
        except Exception as e:          # noqa: BLE001 — one trade that cannot be read must not lose the book's fixings
            try:
                db.rollback()            # a query that failed must not leave the session aborted for the trades after it
            except Exception:           # noqa: BLE001
                pass
            detail = getattr(e, "detail", None) or str(e)
            problems.append({"trade_ref": t.trade_ref, "reason": str(detail)[:160]})
    rows = sorted(resets.values(), key=lambda r: (r["date"], r["index"]))
    by_index: dict[str, dict] = {}
    for r in rows:
        b = by_index.setdefault(r["index"], {"index": r["index"], "ccy": r["ccy"], "days_listed": 0, "fixing01_usd": 0.0, "peak_net_usd": 0.0, "peak_date": None,
                                             "first_date": r["date"], "first_net_usd": r["net_usd"], "first_fixing01_usd": r["fixing01_usd"]})
        b["days_listed"] += 1; b["fixing01_usd"] += r["fixing01_usd"]
        if abs(r["net_usd"]) > abs(b["peak_net_usd"]):
            b["peak_net_usd"], b["peak_date"] = r["net_usd"], r["date"]
    return {"asof": d.isoformat(), "to": upto.isoformat(), "horizon_days": horizon_days, "resets": rows, "by_index": sorted(by_index.values(), key=lambda b: b["index"]),
            "settlements": sorted(settle.values(), key=lambda r: (r["date"], r["pair"], r["source"])),
            "not_covered": not_covered, "embedded_options": capped, "problems": problems, "unconverted": sorted(unconverted),
            "method": "a floating period resets on every business day it runs over; fixing 01 = notional x leverage x accrual a day x days the fixing counts for "
                      "x discount factor x 1bp x the compounding of the period's other days"}
