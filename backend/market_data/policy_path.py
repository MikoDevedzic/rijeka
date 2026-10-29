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
    "JPY": {"curve": "JPY_TONA",  "bank": "Bank of Japan",     "fixing": "TONA",  "basis": 365},
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


def implied_path(quotes: list[dict], valuation_date: date, basis: int = 360, months: int = MONTHS) -> dict:
    """Monthly forward overnight rates from the bootstrapped curve, in percent."""
    from pricing.bootstrap import bootstrap_from_dicts
    live = [q for q in quotes if q.get("enabled", True) and q.get("rate") is not None]
    on = next((float(q["rate"]) for q in live if q.get("tenor") == "ON"), None)
    term = [q for q in live if q.get("tenor") != "ON"]
    if len(term) < 2:
        return {"fixing": on, "term_structure": False, "path": [], "cumulative_bp": {}}
    # The curves page stores the editor's names; the bootstrap wants its own.
    kinds = {"OISDeposit": "DEPOSIT", "DEPOSIT": "DEPOSIT", "OIS": "OIS_SWAP", "OIS_SWAP": "OIS_SWAP",
             "SWAP": "OIS_SWAP", "IRS": "IRS", "FRA": "FRA", "FUTURES": "FUTURES"}
    norm = [{**q, "quote_type": kinds.get(q.get("quote_type", "OIS"), "OIS_SWAP"), "rate": float(q["rate"]) / 100.0} for q in live]
    curve = bootstrap_from_dicts(valuation_date, norm)
    grid = [add_months(valuation_date, i) for i in range(0, months + 1)]
    path = []
    for a, b in zip(grid, grid[1:]):
        dfa, dfb = curve.df(a), curve.df(b)
        tau = (b - a).days / basis
        path.append({"date": b.isoformat(), "rate": round((dfa / dfb - 1.0) / tau * 100.0, 4)})
    ref = on if on is not None else path[0]["rate"]
    cum = {k: round((path[i - 1]["rate"] - ref) * 100.0, 1) for k, i in (("6M", 6), ("12M", 12), ("24M", 24)) if i <= len(path)}
    return {"fixing": on, "term_structure": True, "path": path, "cumulative_bp": cum}


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
