"""
Policy path: what the curve says the overnight rate will be, month by month.

For each currency the hosted desk prices, bootstrap the demo curve and read
off the one-month forward overnight rates for the next two years. That is
the "market-implied policy path" a desk looks at next to the central bank's
own guidance. For USD the Fed's Summary of Economic Projections medians
(the dot plot's year-end medians) are overlaid; the ECB, BoE, SNB and BoJ do
not publish dots.

Everything here is computed from the public-source demo curves (see
demo_feed.py), so it carries the same "indicative" label.
"""
from __future__ import annotations

import html
import json
import logging
import os
import re
from datetime import date, timedelta
from typing import Optional

import httpx

log = logging.getLogger("rijeka.policy_path")

CCY = {
    "USD": {"curve": "USD_SOFR",  "bank": "Federal Reserve",   "fixing": "SOFR",  "basis": 360},
    "EUR": {"curve": "EUR_ESTR",  "bank": "ECB",               "fixing": "€STR",  "basis": 360},
    "GBP": {"curve": "GBP_SONIA", "bank": "Bank of England",   "fixing": "SONIA", "basis": 365},
    "CHF": {"curve": "CHF_SARON", "bank": "SNB",               "fixing": "SARON", "basis": 360},
    "JPY": {"curve": "JPY_TONAR",  "bank": "Bank of Japan",     "fixing": "TONA",  "basis": 365},
}
MONTHS = 24

FED_CAL_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
FED_BASE = "https://www.federalreserve.gov/monetarypolicy/"
DOTS_FILE = os.path.join(os.path.dirname(__file__), "fed_dots.json")


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year; m += 1
    last = (date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)).day
    return date(y, m, min(d.day, last))


def implied_path(quotes: list[dict], valuation_date: date, basis: int = 360, months: int = MONTHS, ccy: Optional[str] = None) -> dict:
    """Monthly forward overnight rates from the bootstrapped curve, in percent."""
    from pricing.bootstrap import bootstrap_from_dicts
    live = [q for q in quotes if q.get("enabled", True) and q.get("rate") is not None]
    on = next((float(q["rate"]) for q in live if q.get("tenor") == "ON"), None)
    term = [q for q in live if q.get("tenor") != "ON"]
    if len(term) < 2:
        return {"fixing": on, "term_structure": False, "path": [], "cumulative_bp": {}, "meetings": []}
    # The curves page stores the editor's names; the bootstrap wants its own.
    kinds = {"OISDeposit": "DEPOSIT", "DEPOSIT": "DEPOSIT", "OIS": "OIS_SWAP", "OIS_SWAP": "OIS_SWAP",
             "SWAP": "OIS_SWAP", "IRS": "IRS", "FRA": "FRA", "FUTURES": "FUTURES"}
    # The currency sets the quoting conventions (day count, calendar, spot lag) in the bootstrap.
    norm = [{**q, "quote_type": kinds.get(q.get("quote_type", "OIS"), "OIS_SWAP"), "rate": float(q["rate"]) / 100.0,
             "currency": (ccy or q.get("currency") or "USD").upper()} for q in live]
    curve = bootstrap_from_dicts(valuation_date, norm)
    grid = [add_months(valuation_date, i) for i in range(0, months + 1)]
    path = []
    for a, b in zip(grid, grid[1:]):
        dfa, dfb = curve.df(a), curve.df(b)
        tau = (b - a).days / basis
        path.append({"date": b.isoformat(), "rate": round((dfa / dfb - 1.0) / tau * 100.0, 4)})
    ref = on if on is not None else path[0]["rate"]
    cum = {k: round((path[i - 1]["rate"] - ref) * 100.0, 1) for k, i in (("6M", 6), ("12M", 12), ("24M", 24)) if i <= len(path)}
    meetings = meeting_pricing(curve, valuation_date, ccy, basis) if ccy else []
    return {"fixing": on, "term_structure": True, "path": path, "cumulative_bp": cum, "meetings": meetings}


# ── Meeting-dated pricing ──────────────────────────────────────────────────────
#
# Published decision dates (the announcement day of each scheduled meeting):
# FOMC fomccalendars.htm; ECB Governing Council monetary policy meetings; BoE
# MPC announcement Thursdays; SNB monetary policy assessments; BoJ MPM second
# day. Extend when the banks publish the next year.
MEETINGS = {
    "USD": ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
            "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08"],
    "EUR": ["2026-10-29", "2026-12-17",
            "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-10", "2027-07-22", "2027-09-09", "2027-10-28", "2027-12-16"],
    "GBP": ["2026-02-05", "2026-03-19", "2026-04-30", "2026-06-18", "2026-07-30", "2026-09-17", "2026-11-05", "2026-12-17",
            "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-17", "2027-07-29", "2027-09-16", "2027-11-04", "2027-12-16"],
    "CHF": ["2026-03-19", "2026-06-18", "2026-09-24", "2026-12-10", "2027-03-18", "2027-06-24", "2027-09-23", "2027-12-16"],
    "JPY": ["2026-01-23", "2026-03-19", "2026-04-28", "2026-06-16", "2026-07-31", "2026-09-18", "2026-10-30", "2026-12-18",
            "2027-01-22", "2027-03-18", "2027-04-28", "2027-06-11", "2027-07-22", "2027-09-22", "2027-10-29", "2027-12-17"],
}
MEETING_STEP_BP = {"USD": 25.0, "EUR": 25.0, "GBP": 25.0, "CHF": 25.0, "JPY": 25.0}


def _fwd(curve, a: date, b: date, basis: int) -> float:
    """Simple forward overnight rate between two dates, in percent."""
    tau = max((b - a).days, 1) / basis
    return (curve.df(a) / curve.df(b) - 1.0) / tau * 100.0


def meeting_pricing(curve, valuation_date: date, ccy: str, basis: int, n: int = 4) -> list[dict]:
    """What the curve prices for the next n decisions: the forward overnight rate for the window
    between consecutive meetings, each step as basis points against the window before it,
    the cumulative move against the rate priced up to the first decision, and the fraction of a standard step that is.
    A one-day settlement lag after the decision is applied to the window (the new rate
    takes effect the next business day)."""
    dates = [date.fromisoformat(d) for d in MEETINGS.get(ccy.upper(), []) if date.fromisoformat(d) > valuation_date]
    if len(dates) < 2:
        return []
    dates = dates[: n + 1]
    out = []
    lag = timedelta(days=1)
    # The reference is the curve's own rate up to the first decision, not the overnight
    # fixing: an annual-pay par curve implies an overnight level a few bp off the fixing,
    # and that basis must not read as a move at the first meeting.
    base = _fwd(curve, valuation_date, dates[0], basis)
    prev = base
    step = MEETING_STEP_BP.get(ccy.upper(), 25.0)
    for i, m in enumerate(dates[:-1]):
        a, b = m + lag, dates[i + 1] + lag
        r = _fwd(curve, a, b, basis)
        move = (r - prev) * 100.0
        out.append({"date": m.isoformat(), "implied_rate": round(r, 3), "move_bp": round(move, 1),
                    "cumulative_bp": round((r - base) * 100.0, 1), "steps": round(round(move, 1) / step, 2)})
        prev = r
    return out


# ── Fed dots (SEP medians) ──────────────────────────────────────────────────────

def parse_sep(page: str, as_of: str) -> dict:
    """The 'Federal funds rate' median row of the SEP table → {year|'Longer run': rate}."""
    t = re.search(r"<table.*?</table>", page, re.S)
    if not t:
        raise ValueError("no SEP table")
    cells = lambda frag: [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", frag, re.S)]
    heads = cells(t.group(0))
    cols = [h for h in heads if re.fullmatch(r"\d{4}|Longer run", h)]
    n = len(cols) // 3 if len(cols) >= 3 else len(cols)           # median, central tendency, range share one header row
    years = cols[:n]
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", t.group(0), re.S):
        txt = cells(row)
        if txt and re.search(r"federal funds rate", txt[0], re.I):
            vals = [v for v in txt[1:] if re.fullmatch(r"\d+\.\d+", v)]
            med = {y: float(v) for y, v in zip(years, vals[:n])}
            if med:
                return {"as_of": as_of, "medians": [{"label": y, "rate": med[y]} for y in years if y in med]}
    raise ValueError("no federal funds rate row")


def fetch_fed_dots(timeout: float = 15.0) -> dict:
    h = {"User-Agent": "Mozilla/5.0 (rijeka-demo-feed)"}
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=h) as c:
        cal = c.get(FED_CAL_URL); cal.raise_for_status()
        names = sorted(set(re.findall(r"fomcprojtabl(\d{8})\.htm", cal.text)))
        if not names:
            raise ValueError("no projection tables linked")
        stamp = names[-1]
        page = c.get(f"{FED_BASE}fomcprojtabl{stamp}.htm"); page.raise_for_status()
    return parse_sep(page.text, f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:]}")


_dots: Optional[dict] = None


def fed_dots(refresh: bool = False) -> Optional[dict]:
    """Latest SEP medians: fetched when asked, else the copy shipped with the code."""
    global _dots
    if refresh or _dots is None:
        try:
            _dots = fetch_fed_dots()
            try:
                json.dump(_dots, open(DOTS_FILE, "w"), indent=2)
            except OSError:
                pass
        except Exception as e:      # noqa: BLE001 — fall back to the shipped copy
            log.info("fed dots fetch failed: %s", str(e)[:120])
            if _dots is None:
                try:
                    _dots = json.load(open(DOTS_FILE))
                except (OSError, ValueError):
                    _dots = None
    return _dots
