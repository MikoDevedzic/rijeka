"""Realised overnight fixings for a floating period under way.

A floating coupon on a compounded overnight index that has started but not paid is worth the rate
realised so far compounded with the curve's forward for the rest (pricing/ir_swap._project_float_rate).
Until November 2026 nothing supplied the realised part, so the elapsed days were assumed to have accrued
at the remaining stub's forward: wrong by the gap between realised and forward overnight rates, times
the elapsed fraction (11bp of notional in the reference test where they differed by 40bp).

The realised part is rebuilt from the market data the desk already keeps: every daily snapshot of an
OIS curve carries the overnight rate as its ON quote (market_data/demo_feed.py writes the day's SOFR,
€STR, SONIA ... print there; a manual or Bloomberg snapshot carries the same tenor). The ON quote saved
on day d is taken as the overnight rate from d to the next day and carried over days with no snapshot
(weekends, holidays, a missed build), compounded on the index's own basis (ACT/360 for SOFR, €STR and
SARON; ACT/365F for SONIA, TONA, AONIA, CORRA):

    growth(s, v) = Π_{d in [s, v)} (1 + r_ON(d) / basis),   R = (growth − 1) / τ_leg(s, v)

R is the simple rate over the elapsed part on the leg's own day count, which is what the pricer blends
with the forward. If there is no snapshot on or before the period start the elapsed accrual cannot be
rebuilt and the lookup returns None, so the pricer keeps its forward assumption; a window with a gap
longer than GAP_DAYS between snapshots is flagged in the note that travels with the price.

The snapshots are the template user's (the account whose market data every demo visitor prices on),
with the caller's own as the fallback. Reads are cached for CACHE_SECONDS, keyed by (user, curve,
start, as-of), because a full-revaluation VaR prices the same seasoned swap hundreds of times a day.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date, timedelta
from typing import Any, Callable, Optional

from sqlalchemy import text

from pricing.bootstrap import CCY_DEPO_DC
from pricing.day_count import dcf

log = logging.getLogger("rijeka.fixings")

CACHE_SECONDS = 90
GAP_DAYS = 7
_cache: dict[tuple, tuple[float, Any]] = {}
_template: dict[str, Any] = {"at": 0.0, "uid": None}

# the curve id a float leg forecasts on -> the index's compounding basis
CURVE_BASIS = {"USD_SOFR": 360, "EUR_ESTR": 360, "CHF_SARON": 360, "GBP_SONIA": 365, "JPY_TONA": 365, "JPY_TONAR": 365,
               "AUD_AONIA": 365, "CAD_CORRA": 365}

FixingLookup = Callable[[date, date, str], Optional[float]]


def _basis(curve_id: str, currency: str) -> int:
    if curve_id in CURVE_BASIS:
        return CURVE_BASIS[curve_id]
    return 365 if CCY_DEPO_DC.get((currency or "USD").upper(), "ACT/360").startswith("ACT/365") else 360


def _quotes(raw) -> list[dict]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    return raw if isinstance(raw, list) else []


def _on_rate(quotes: list[dict]) -> Optional[float]:
    for q in quotes:
        if str(q.get("tenor", "")).upper() in ("ON", "O/N", "OVERNIGHT") and q.get("rate") is not None and q.get("enabled", True):
            try:
                return float(q["rate"]) / 100.0           # snapshots store percent
            except (TypeError, ValueError):
                return None
    return None


def on_series(db, user_id, curve_id: str, start: date, end: date) -> list[tuple[date, float]]:
    """(date, overnight rate) from the snapshots dated in [start − 31d, end], oldest first; the first entry
    is the last snapshot on or before `start` when there is one."""
    rows = db.execute(text(
        "SELECT valuation_date, quotes FROM market_data_snapshots WHERE curve_id = :c AND user_id = :u "
        "AND valuation_date BETWEEN :a AND :b ORDER BY valuation_date"),
        {"c": curve_id, "u": str(user_id), "a": start - timedelta(days=31), "b": end}).all()
    out = []
    for r in rows:
        d = r.valuation_date if isinstance(r.valuation_date, date) else date.fromisoformat(str(r.valuation_date)[:10])
        rate = _on_rate(_quotes(r.quotes))
        if rate is not None:
            out.append((d, rate))
    before = [x for x in out if x[0] <= start]
    return ([before[-1]] if before else []) + [x for x in out if x[0] > start]


def compound(series: list[tuple[date, float]], start: date, end: date, basis: int) -> tuple[Optional[float], int]:
    """Growth factor over [start, end) carrying each rate to the next snapshot; (None, 0) without a rate at the
    start. Also returns the longest run of days carried on one rate."""
    if not series or series[0][0] > start or end <= start:
        return None, 0
    growth, longest = 1.0, 0
    idx, rate = 0, series[0][1]
    d = start
    run_from = start
    while d < end:
        while idx + 1 < len(series) and series[idx + 1][0] <= d:
            idx += 1
            rate = series[idx][1]
            run_from = d
        growth *= 1.0 + rate / basis
        longest = max(longest, (d - run_from).days + 1)
        d += timedelta(days=1)
    return growth, longest


def realised_rate(db, user_id, curve_id: str, currency: str, start: date, asof: date, day_count: str) -> tuple[Optional[float], str]:
    """(simple rate over [start, asof) on the leg's day count, note) or (None, why)."""
    if asof <= start:
        return None, "period not started"
    key = (str(user_id), curve_id, start, asof, day_count)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    series = on_series(db, user_id, curve_id, start, asof)
    growth, longest = compound(series, start, asof, _basis(curve_id, currency))
    if growth is None:
        out = (None, f"no {curve_id} snapshot on or before {start}: elapsed accrual assumed at the forward")
    else:
        tau = float(dcf(day_count, start, asof))
        rate = (growth - 1.0) / tau if tau > 0 else None
        note = f"realised {curve_id} ON from {len(series)} snapshots"
        if longest > GAP_DAYS:
            note += f"; one rate carried {longest} days"
        out = (rate, note)
    _cache[key] = (time.time(), out)
    return out


def template_user(db) -> Optional[str]:
    if time.time() - _template["at"] < 60:
        return _template["uid"]
    uid = None
    try:
        from api.routes.demo import _template_user_id
        u = _template_user_id(db)
        uid = str(u) if u else None
    except Exception as e:                      # noqa: BLE001 — no template user is a normal self-hosted state
        log.debug("fixings: template user: %s", e)
        db.rollback()
    _template.update(at=time.time(), uid=uid)
    return uid


def lookup_for(db, user_id: str, legs: list[dict], owner: Optional[str] = None) -> tuple[FixingLookup, list[str]]:
    """A FixingLookup over the template user's snapshots (else the caller's; `owner` overrides both), plus a
    list the pricer fills with the notes of every realised fixing it used, for the response."""
    notes: list[str] = []
    owner = owner or template_user(db) or user_id
    curve_of = {id(l): (l.get("forecast_curve_id") or l.get("discount_curve_id") or "USD_SOFR", l.get("currency") or "USD") for l in legs}

    def lookup(period_start: date, asof: date, day_count: str, leg: Optional[dict] = None) -> Optional[float]:
        cid, ccy = curve_of.get(id(leg), ("USD_SOFR", "USD")) if leg is not None else ("USD_SOFR", "USD")
        try:
            rate, note = realised_rate(db, owner, cid, ccy, period_start, asof, day_count)
        except Exception as e:                  # noqa: BLE001 — a table that is not there is "no fixings"
            log.debug("fixings: %s", e)
            try:
                db.rollback()
            except Exception:                   # noqa: BLE001
                pass
            return None
        if note not in notes:
            notes.append(note)
        return rate
    return lookup, notes
