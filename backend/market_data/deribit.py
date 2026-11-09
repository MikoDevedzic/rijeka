"""Digital-asset option vols and forwards from Deribit's public marks.

One unauthenticated request per asset returns the whole option chain with, per instrument, the
exchange's mark volatility, the forward of its expiry (the future where one is listed, the exchange's
synthetic forward where not) and the index price:

    GET /api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option

BTC and ETH come from their own (inverse) chains; SOL from the USDC-settled chain, filtered by base
currency. The functions below turn a chain into what the pricer already reads (pricing/fx_vol.py,
api/routes/currencies.py):

    {PAIR}_VOL   ATM, RR25 and BF25 by tenor, in vol points
    {PAIR}_FWD   forward points by tenor, in quote currency per unit

Per expiry. Every strike's mark vol is placed at its premium-excluded forward call delta Φ(d1), the
convention of the Malz smile the pricer uses, and the vol is read linearly in delta at ¼, ½ and ¾:

    ATM = σ(½)      RR25 = σ(¼) − σ(¾)      BF25 = (σ(¼) + σ(¾))/2 − σ(½)

so the pricer's quadratic in delta returns the venue's marks at those three points. ATM is therefore
the 50-delta-forward vol, not the vol at the forward strike; at these vol levels the two differ.

Across expiries. ATM is interpolated linearly in total variance, RR25 and BF25 linearly in time, to the
surface's tenors. Beyond the last listed expiry all three are held flat, and the row says so in the
source label through the last expiry it names. Forwards: the annualised basis ln(F/S)/T is interpolated
linearly in time and held flat beyond the last expiry; points = S·(e^{bT} − 1) on the venue's index.

Safeguards. An expiry is dropped when it is inside MIN_DAYS, has fewer than MIN_STRIKES usable marks,
has no open interest, does not bracket the 25-delta points, or gives a level outside sanity bounds. A
surface needs MIN_EXPIRIES good expiries or none is produced, and the caller keeps the last good one.
Nothing here writes; the caller stamps the source and the time of the marks on every row it saves.

RIJEKA_DERIBIT=0 turns the source off (the daily rebuild then removes its rows and the parametric
surfaces return). The venue's API usage policy allows unauthenticated public data at a low frequency;
this module makes three requests per run.
"""
from __future__ import annotations

import logging
import math
import os
import time
from datetime import datetime, timezone
from statistics import median
from typing import Optional

import httpx

log = logging.getLogger("rijeka.deribit")

API = "https://www.deribit.com/api/v2/public/get_book_summary_by_currency"
PROVIDER = "Deribit"
URL = "https://www.deribit.com/statistics/BTC/volatility-index"
# asset: the chain's `currency` parameter (SOL's options are USDC-settled and share a chain with other assets)
CHAIN_CURRENCY = {"BTC": "BTC", "ETH": "ETH", "SOL": "USDC"}
ASSETS = tuple(CHAIN_CURRENCY)
SOURCE_PREFIX = "DEMO · Deribit"          # 'DEMO' passes the snapshot table's source whitelist; rows are found by this prefix

VOL_TENORS = ("1W", "1M", "2M", "3M", "6M", "9M", "1Y", "2Y")                 # demo_feed.FX_VOL_TENORS
FWD_TENOR_DAYS = {"1W": 7, "2W": 14, "1M": 30, "2M": 61, "3M": 91, "6M": 182, "9M": 273, "1Y": 365, "2Y": 730}   # currencies.TENOR_DAYS
VOL_TENOR_DAYS = {"1W": 7, "1M": 365 / 12, "2M": 365 / 6, "3M": 365 / 4, "6M": 182.5, "9M": 273.75, "1Y": 365, "2Y": 730}   # fx_vol.TENOR_YEARS

MIN_DAYS = 2.0            # an expiry inside two days is all gamma and event
MIN_STRIKES = 6
MIN_EXPIRIES = 2
ATM_BOUNDS = (0.05, 3.0)  # 5 % to 300 %
MONTHS = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}


def enabled() -> bool:
    return os.getenv("RIJEKA_DERIBIT", "1").strip().lower() not in ("0", "false", "no", "off")


def pair(asset: str) -> str:
    return f"{asset}USD"


# ── Pure: a chain to quotes ────────────────────────────────────────────────────

def _phi(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def parse_expiry(code: str) -> datetime:
    """'25DEC26' → 2026-12-25 08:00 UTC, when the venue's options expire."""
    return datetime(2000 + int(code[-2:]), MONTHS[code[-5:-2].upper()], int(code[:-5]), 8, tzinfo=timezone.utc)


def _strike(s: str) -> float:
    return float(s.replace("d", "."))          # the venue writes 0.5 as 0d5 on low-priced underlyings


def parse_chain(rows: list[dict], asset: str, now: datetime) -> dict:
    """{asof, index, expiries: [{code, days, t, forward, oi, marks: [(strike, vol)]}]} from a chain's rows.

    One vol per strike: the out-of-the-money instrument's mark (the put below the forward, the call at
    or above it), the other side's when that one has no mark."""
    by: dict[str, dict] = {}
    stamps, index = [], []
    for o in rows or []:
        parts = str(o.get("instrument_name", "")).split("-")
        if len(parts) != 4 or parts[3] not in ("C", "P"):
            continue
        if (o.get("base_currency") or parts[0].split("_")[0]).upper() != asset:
            continue
        iv, fwd = o.get("mark_iv"), o.get("underlying_price")
        if not iv or not fwd or iv <= 0 or fwd <= 0:
            continue
        try:
            k, when = _strike(parts[2]), parse_expiry(parts[1])
        except (ValueError, KeyError):
            continue
        e = by.setdefault(parts[1], {"code": parts[1], "when": when, "fwd": [], "oi": 0.0, "k": {}})
        e["fwd"].append(float(fwd))
        e["oi"] += float(o.get("open_interest") or 0.0)
        e["k"].setdefault(k, {})[parts[3]] = float(iv) / 100.0
        if o.get("creation_timestamp"):
            stamps.append(int(o["creation_timestamp"]))
        if o.get("estimated_delivery_price"):
            index.append(float(o["estimated_delivery_price"]))
    expiries = []
    for e in by.values():
        days = (e["when"] - now).total_seconds() / 86400.0
        f = median(e["fwd"])
        marks = sorted((k, (v.get("P") if k < f else v.get("C")) or v.get("C") or v.get("P")) for k, v in e["k"].items())
        expiries.append({"code": e["code"], "days": days, "t": days / 365.0, "forward": f, "oi": e["oi"], "marks": marks})
    expiries.sort(key=lambda x: x["days"])
    asof = datetime.fromtimestamp(max(stamps) / 1000.0, tz=timezone.utc) if stamps else now
    return {"asset": asset, "asof": asof, "index": median(index) if index else None, "expiries": expiries}


def _at_delta(points: list[tuple[float, float]], target: float) -> Optional[float]:
    """The vol at a call delta, linear between the two marks that bracket it; None when none do."""
    for (d0, v0), (d1, v1) in zip(points, points[1:]):
        if d0 <= target <= d1:
            return v0 if d1 == d0 else v0 + (target - d0) / (d1 - d0) * (v1 - v0)
    return None


def expiry_quote(e: dict) -> tuple[Optional[dict], Optional[str]]:
    """({days, t, forward, atm, rr, bf} in decimals, None) for a usable expiry, or (None, why it was dropped)."""
    if e["days"] < MIN_DAYS:
        return None, "inside two days"
    if e["oi"] <= 0:
        return None, "no open interest"
    t, f = e["t"], e["forward"]
    pts = []
    for k, v in e["marks"]:
        if not v or v <= 0 or k <= 0:
            continue
        d1 = (math.log(f / k) + 0.5 * v * v * t) / (v * math.sqrt(t))
        pts.append((_phi(d1), v))
    pts.sort()
    # a mark whose delta does not rise with the one before it (a stale wing) is left out
    mono: list[tuple[float, float]] = []
    for d, v in pts:
        if not mono or d > mono[-1][0] + 1e-9:
            mono.append((d, v))
    if len(mono) < MIN_STRIKES:
        return None, f"{len(mono)} usable strikes"
    c25, atm, p25 = _at_delta(mono, 0.25), _at_delta(mono, 0.5), _at_delta(mono, 0.75)
    if c25 is None or atm is None or p25 is None:
        return None, "marks do not reach the 25-delta points"
    rr, bf = c25 - p25, 0.5 * (c25 + p25) - atm
    if not (ATM_BOUNDS[0] <= atm <= ATM_BOUNDS[1]) or abs(rr) > atm or not (-0.25 * atm <= bf <= atm):
        return None, f"out of bounds (ATM {atm:.2%}, RR {rr:.2%}, BF {bf:.2%})"
    return {"code": e["code"], "days": e["days"], "t": t, "forward": f, "atm": atm, "rr": rr, "bf": bf}, None


def _lin(xs: list[tuple[float, float]], x: float) -> float:
    """Linear between points, flat beyond them."""
    if x <= xs[0][0]:
        return xs[0][1]
    if x >= xs[-1][0]:
        return xs[-1][1]
    for (a, va), (b, vb) in zip(xs, xs[1:]):
        if a <= x <= b:
            return va if b == a else va + (x - a) / (b - a) * (vb - va)
    return xs[-1][1]


def atm_at(good: list[dict], days: float) -> float:
    """ATM at `days`: linear in total variance between expiries, the nearest expiry's vol beyond them."""
    if days <= good[0]["days"]:
        return good[0]["atm"]
    if days >= good[-1]["days"]:
        return good[-1]["atm"]
    w = _lin([(g["days"], g["atm"] ** 2 * g["days"]) for g in good], days)
    return math.sqrt(max(w, 0.0) / days)


def vol_quotes(good: list[dict]) -> list[dict]:
    """The {PAIR}_VOL snapshot's quotes at the surface tenors, in vol points."""
    out = []
    for tenor in VOL_TENORS:
        d = VOL_TENOR_DAYS[tenor]
        row = (("ATM", atm_at(good, d)), ("RR25", _lin([(g["days"], g["rr"]) for g in good], d)),
               ("BF25", _lin([(g["days"], g["bf"]) for g in good], d)))
        out += [{"tenor": tenor, "quote_type": qt, "rate": round(v * 100.0, 2), "enabled": True} for qt, v in row]
    return out


def forward_quotes(good: list[dict], index: float) -> list[dict]:
    """The {PAIR}_FWD snapshot's quotes: forward points over the index at the forward tenors."""
    basis = [(g["days"], math.log(g["forward"] / index) / g["t"]) for g in good]
    out = []
    for tenor, days in FWD_TENOR_DAYS.items():
        pts = index * (math.exp(_lin(basis, days) * days / 365.0) - 1.0)
        out.append({"tenor": tenor, "quote_type": "FWD_POINTS", "rate": round(pts, 6 if index < 1000 else 2), "enabled": True})
    return out


def build(rows: list[dict], asset: str, now: Optional[datetime] = None) -> dict:
    """A chain to {vol, forward, asof, index, expiries, dropped, last_expiry}; vol and forward are None
    when fewer than MIN_EXPIRIES expiries are usable."""
    now = now or datetime.now(timezone.utc)
    chain = parse_chain(rows, asset, now)
    good, dropped = [], {}
    for e in chain["expiries"]:
        q, why = expiry_quote(e)
        if q:
            good.append(q)
        else:
            dropped[e["code"]] = why
    ok = len(good) >= MIN_EXPIRIES and bool(chain["index"])
    return {"asset": asset, "asof": chain["asof"], "index": chain["index"],
            "vol": vol_quotes(good) if ok else None, "forward": forward_quotes(good, chain["index"]) if ok else None,
            "expiries": [{"code": g["code"], "days": round(g["days"], 2), "forward": round(g["forward"], 4), "atm": round(g["atm"] * 100, 2),
                          "rr25": round(g["rr"] * 100, 2), "bf25": round(g["bf"] * 100, 2)} for g in good],
            "dropped": dropped, "last_expiry": good[-1]["code"] if good else None}


def source(kind: str, built: dict) -> str:
    """'DEMO · Deribit option marks · 2026-11-09 12:46 UTC · listed to 24SEP27, flat beyond'."""
    return f"{SOURCE_PREFIX} {kind} · {built['asof']:%Y-%m-%d %H:%M} UTC · listed to {built['last_expiry']}, flat beyond"


# ── Network ────────────────────────────────────────────────────────────────────

def fetch_chain(asset: str, client: httpx.Client) -> list[dict]:
    r = client.get(API, params={"currency": CHAIN_CURRENCY[asset], "kind": "option"})
    r.raise_for_status()
    return r.json()["result"]


def collect(now: Optional[datetime] = None, assets=ASSETS, pause: float = 0.5) -> dict:
    """{ok: {asset: built}, failed: {asset: why}}. An asset whose chain cannot be read or gives no surface is reported, not fatal."""
    from version import VERSION
    out: dict = {"ok": {}, "failed": {}}
    with httpx.Client(timeout=25.0, headers={"User-Agent": f"rijeka/{VERSION} (+https://rijeka.app)"}) as c:
        for i, asset in enumerate(assets):
            if i:
                time.sleep(pause)
            try:
                b = build(fetch_chain(asset, c), asset, now)
                if b["vol"] is None:
                    raise ValueError(f"{len(b['expiries'])} usable expiries")
                out["ok"][asset] = b
            except Exception as e:      # noqa: BLE001 — one asset must not stop the others; the last good surface stands
                log.warning("deribit %s failed: %s: %s", asset, type(e).__name__, str(e)[:200])
                out["failed"][asset] = f"{type(e).__name__}: {str(e)[:160]}"
    return out
