"""What fixes, day by day: the book's exposure to each coming fixing, by index.

Two kinds of fixing, kept apart because they are hedged apart.

Rate resets. Every floating period the pricer values is compounded in arrears from an overnight index (the
forecast curve it is projected on: USD_SOFR, EUR_ESTR, ...): its rate is not set on one day but on every business
day from the period's start to its end, each day's fixing counting for the calendar days until the next one. So on
a business day D the book "resets" every floating period that contains D:

    resetting on D, index I   = Σ over such periods of  ± notional            (+ where the desk receives the float)
    fixing 01 on D, index I   = Σ  ± notional × (dcf / days in the period) × n(D) × DF(payment) × 1bp

n(D) is the calendar days D's fixing counts for (three over a weekend), dcf / days is the period's accrual per
calendar day in the leg's own day count, and DF is the discount factor to the period's payment date, read from the
valuation itself. Summed over a period's days it is the period's notional × dcf × DF × 1bp: the value of one basis
point on the period's rate, which is what the ladder's forecast IR01 is made of. Day-to-day compounding (a
fixing's effect on the interest earned on earlier days' interest) is left out: at 5 % over a quarter it is about
1 % of the figure. A leg that fixes once a period (CMS) is one reset on its fixing date, for the whole period.

Settlement fixings. A non-deliverable forward (a currency NDF, a digital-asset forward) is settled against one
published price on its fixing date. Each is listed on that date, by pair and source, with the notional that fixes
and the value of 1 % on the price (the trade's own spot 01).

Not in it, and said so in the result: caps, floors and swaptions (an option on a fixing is a delta, not a
notional), option expiries, and anything the valuation could not price. Nothing here reprices: it reads the periods
of the valuation the ladder has already made (pnl.valuation.value keeps them), so a trade the desk values is a
trade whose fixings are here.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Callable, Optional

from pnl.explain import LIVE
from pricing.calendars import is_business_day, leg_calendar

log = logging.getLogger("rijeka.risk")
HORIZON_DAYS = 92                 # calendar days of resets listed day by day: a quarter, the longest period most swaps have
FLOATING = ("FLOAT", "OIS")       # compounded in arrears from the overnight fixings
SINGLE = ("CMS",)                 # one fixing a period, in advance
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


def period_resets(cf: dict, leg: dict, index: str, calendar: str, asof: date, upto: date) -> list[dict]:
    """One floating period of a priced leg → its resets from `asof` to `upto`: {date, index, ccy, days, notional,
    fixing01} in the leg's currency, signed + where the desk receives the floating rate."""
    start, end = _d(cf.get("period_start")), _d(cf.get("period_end"))
    n, dcf = float(cf.get("notional") or 0.0), float(cf.get("dcf") or 0.0)
    if not start or not end or end <= start or not n or not dcf:
        return []
    sign = 1.0 if str(leg.get("direction") or "").upper().startswith("REC") else -1.0
    df = float(cf["df"]) if cf.get("df") is not None else 1.0
    ccy = str(leg.get("currency") or "USD").upper()
    if str(leg.get("leg_type") or "").upper() in SINGLE:
        fix = _d(cf.get("fixing_date")) or start
        if fix < asof or fix > upto:
            return []
        return [{"date": fix, "index": index, "ccy": ccy, "days": (end - start).days, "notional": sign * abs(n), "fixing01": sign * abs(n) * dcf * df * BP}]
    per_day = dcf / (end - start).days
    return [{"date": d, "index": index, "ccy": ccy, "days": k, "notional": sign * abs(n), "fixing01": sign * abs(n) * per_day * k * df * BP}
            for d, k in fixing_days(start, end, asof, upto, calendar)]


def trade_resets(priced_legs: list[dict], legs: dict[str, dict], default_index: str, asof: date, upto: date) -> list[dict]:
    """Every reset of one trade from the legs the pricer returned (`priced_legs`) and the trade's own legs by id
    (for the curve a leg is projected on and the calendar its dates roll on)."""
    out = []
    for pl in priced_legs or []:
        if str(pl.get("leg_type") or "").upper() not in FLOATING + SINGLE:
            continue
        meta = legs.get(str(pl.get("leg_id"))) or {}
        index = str(meta.get("forecast_curve_id") or default_index or "").upper()
        cal = leg_calendar({**meta, "currency": pl.get("currency") or meta.get("currency")})
        for cf in pl.get("cashflows") or []:
            if str(cf.get("cashflow_type") or "COUPON").upper() not in ("COUPON", "FLOAT", "INTEREST"):
                continue
            out += period_resets(cf, pl, index, cal, asof, upto)
    return out


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
    note = "no fixing date on the trade: its settlement date" if not named else ""
    if fix.weekday() >= 5 and unit.upper() in _CURRENCIES:
        note = (note + "; " if note else "") + "a weekend: no currency fixing is published"
    return {"date": fix, "pair": pair, "source": source or "", "unit": unit,
            "units": sign * abs(float(terms.get("notional") or 0.0)), "spot01": spot01, "note": note}


def book_fixings(db, user: dict, trades, d: date, mkt, fx: Callable[[str], Optional[float]], valuer=None, horizon_days: int = HORIZON_DAYS) -> dict[str, Any]:
    """The book's fixings from `d`: rate resets day by day for `horizon_days`, and every settlement fixing to come.
    `valuer` is the ladder's (pnl.explain.Valuer), so a trade is priced once for both."""
    from api.routes.currencies import CURRENCY_INSTRUMENTS
    from pnl.explain import Valuer
    from pnl.valuation import _currency_terms, _trade_legs
    valuer = valuer or Valuer(db, user)
    upto = d + timedelta(days=horizon_days)
    resets: dict[tuple, dict] = {}
    settle: dict[tuple, dict] = {}
    not_covered: dict[str, int] = {}
    problems, unconverted = [], set()
    for t in trades:
        if t.status not in LIVE:
            continue
        itype = str(t.instrument_type or "").upper()
        try:
            if itype in OPTIONAL:
                not_covered[itype] = not_covered.get(itype, 0) + 1
                continue
            v = valuer(t, d, mkt)
            if itype in CURRENCY_INSTRUMENTS:
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
            priced = v.get("legs")
            if not priced:
                continue
            legs = {str(l.get("id")): l for l in _trade_legs(db, user, t)}
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
            "not_covered": not_covered, "problems": problems, "unconverted": sorted(unconverted),
            "method": "a floating period resets on every business day it runs over; fixing 01 = notional x accrual a day x days the fixing counts for x discount factor x 1bp"}
