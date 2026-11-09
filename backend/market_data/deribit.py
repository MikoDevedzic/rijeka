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
source label through the last expiry it names. The pricer then interpolates linearly in vol between
tenors and is flat inside one week, so it returns the venue's mark exactly at a tenor and close to it
between tenors (within a few tenths of a vol point from two weeks out on the term structures seen so
far); an option inside one week is priced at the one-week level, which a steep front end can miss by points. Forwards: the annualised basis ln(F/S)/T is interpolated
linearly in time and held flat beyond the last expiry; points = S·(e^{bT} − 1) on the venue's index.

Safeguards. The venue's response is someone else's data: it is read under a size cap and a deadline,
every number must be finite and every expiry code well formed, and the marks must carry a time within
MAX_AGE of now. An expiry is dropped when it is inside MIN_DAYS, has fewer than MIN_STRIKES usable
marks, has no open interest, does not bracket the 25-delta points, gives a vol level outside sanity
bounds, or a forward further from the index than MAX_BASIS allows; within an expiry a mark that
stands off the line between its neighbours, or whose delta breaks the order of the strikes, is left out. A surface needs MIN_EXPIRIES good
expiries or none is produced, and the caller keeps the last good one; the caller also checks the index
against an independent spot before it stores anything. Nothing here writes; the caller stamps the
source and the time of the marks on every row it saves. What a failure reports is written here, never
copied from the response.

RIJEKA_DERIBIT=0 turns the source off (the daily rebuild then removes its rows and the parametric
surfaces return). The venue's API usage policy allows unauthenticated public data at a low frequency;
this module makes three requests per run.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
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

# demo_feed.FX_VOL_TENORS plus 2W and 3W: the listed term structure is steepest inside the first month, and the
# pricer is linear in vol between tenors, so without them a two- or three-week option misses the venue's mark
VOL_TENORS = ("1W", "2W", "3W", "1M", "2M", "3M", "6M", "9M", "1Y", "2Y")
FWD_TENOR_DAYS = {"1W": 7, "2W": 14, "1M": 30, "2M": 61, "3M": 91, "6M": 182, "9M": 273, "1Y": 365, "2Y": 730}   # currencies.TENOR_DAYS
VOL_TENOR_DAYS = {"1W": 7, "2W": 14, "3W": 21, "1M": 365 / 12, "2M": 365 / 6, "3M": 365 / 4, "6M": 182.5, "9M": 273.75, "1Y": 365, "2Y": 730}   # fx_vol.TENOR_YEARS

MIN_DAYS = 2.0            # an expiry inside two days is all gamma and event
MIN_STRIKES = 6
MIN_EXPIRIES = 2
ATM_BOUNDS = (0.05, 3.0)  # 5 % to 300 %
MAX_BASIS = 2.0           # |ln(F/index)|/T: an annualised basis beyond 200 % is a bad forward or a bad index, not a market
MAX_GAP = 0.5             # |ln(F/index)| whatever the maturity
MAX_AGE = timedelta(minutes=30)       # marks older than this, or dated in the future, are not today's surface
MAX_AHEAD = timedelta(minutes=2)
MAX_BYTES = 8_000_000     # the largest chain (USDC-settled) is under 2 MB
MAX_ROWS = 20_000
MAX_EXPIRIES = 60
DEADLINE = 20.0           # seconds for one chain, whatever the per-read timeout allows
EXPIRY_CODE = re.compile(r"[0-9]{1,2}[A-Z]{3}[0-9]{2}")
STRIKE = re.compile(r"[0-9]{1,9}(?:[.d][0-9]{1,8})?")
MAX_JUMP = 0.25           # a mark more than a quarter away from the line between its neighbours is not part of the smile


class Unusable(ValueError):
    """A chain this module will not build on. The message is written here and safe to publish."""
MONTHS = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}


def enabled() -> bool:
    return os.getenv("RIJEKA_DERIBIT", "1").strip().lower() not in ("0", "false", "no", "off")


def pair(asset: str) -> str:
    return f"{asset}USD"


# ── Pure: a chain to quotes ────────────────────────────────────────────────────

def _phi(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _num(v) -> Optional[float]:
    """A finite float from the venue's number, or None (a string, a bool, NaN and Infinity are not numbers here)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) else None


def parse_expiry(code: str) -> datetime:
    """'25DEC26' → 2026-12-25 08:00 UTC, when the venue's options expire."""
    if not EXPIRY_CODE.fullmatch(code):
        raise ValueError("expiry code")
    return datetime(2000 + int(code[-2:]), MONTHS[code[-5:-2].upper()], int(code[:-5]), 8, tzinfo=timezone.utc)


def _strike(s: str) -> float:
    if not STRIKE.fullmatch(s):
        raise ValueError("strike")
    return float(s.replace("d", "."))          # the venue writes 0.5 as 0d5 on low-priced underlyings


def parse_chain(rows: list[dict], asset: str, now: datetime) -> dict:
    """{asof, index, expiries: [{code, days, t, forward, oi, marks: [(strike, vol)]}]} from a chain's rows.

    One vol per strike: the out-of-the-money instrument's mark (the put below the forward, the call at
    or above it), the other side's when that one has no mark."""
    by: dict[str, dict] = {}
    stamps, index = [], []
    for o in rows or []:
        if not isinstance(o, dict):
            continue
        name, base = o.get("instrument_name"), o.get("base_currency")
        parts = name.split("-") if isinstance(name, str) else []
        if len(parts) != 4 or parts[3] not in ("C", "P"):
            continue
        if (base if isinstance(base, str) and base else parts[0].split("_")[0]).upper() != asset:
            continue
        iv, fwd = _num(o.get("mark_iv")), _num(o.get("underlying_price"))
        if not iv or not fwd or iv <= 0 or fwd <= 0:
            continue
        try:
            k, when = _strike(parts[2]), parse_expiry(parts[1])
        except (ValueError, KeyError):
            continue
        if k <= 0 or (parts[1] not in by and len(by) >= MAX_EXPIRIES):
            continue
        e = by.setdefault(parts[1], {"code": parts[1], "when": when, "fwd": [], "oi": 0.0, "k": {}})
        e["fwd"].append(fwd)
        e["oi"] += max(_num(o.get("open_interest")) or 0.0, 0.0)
        e["k"].setdefault(k, {})[parts[3]] = iv / 100.0
        stamp, idx = _num(o.get("creation_timestamp")), _num(o.get("estimated_delivery_price"))
        if stamp and 0 < stamp < 4e12:                 # milliseconds, this century
            stamps.append(stamp)
        if idx and idx > 0:
            index.append(idx)
    expiries = []
    for e in by.values():
        days = (e["when"] - now).total_seconds() / 86400.0
        f = median(e["fwd"])
        marks = sorted((k, (v.get("P") if k < f else v.get("C")) or v.get("C") or v.get("P")) for k, v in e["k"].items())
        expiries.append({"code": e["code"], "days": days, "t": days / 365.0, "forward": f, "oi": e["oi"], "marks": marks})
    expiries.sort(key=lambda x: x["days"])
    asof = datetime.fromtimestamp(max(stamps) / 1000.0, tz=timezone.utc) if stamps else None
    return {"asset": asset, "asof": asof, "index": median(index) if index else None, "expiries": expiries}


def _at_delta(points: list[tuple[float, float]], target: float) -> Optional[float]:
    """The vol at a call delta, linear between the two marks that bracket it; None when none do."""
    for (d0, v0), (d1, v1) in zip(points, points[1:]):
        if d0 <= target <= d1:
            return v0 if d1 == d0 else v0 + (target - d0) / (d1 - d0) * (v1 - v0)
    return None


def _off_the_line(a: tuple[float, float], m: tuple[float, float], b: tuple[float, float]) -> bool:
    (ka, va), (k, v), (kb, vb) = a, m, b
    line = va + (k - ka) / (kb - ka) * (vb - va) if kb > ka else 0.5 * (va + vb)
    return abs(v - line) > MAX_JUMP * line


def expiry_quote(e: dict, index: Optional[float] = None) -> tuple[Optional[dict], Optional[str]]:
    """({days, t, forward, atm, rr, bf} in decimals, None) for a usable expiry, or (None, why it was dropped)."""
    if e["days"] < MIN_DAYS:
        return None, "inside two days"
    if e["oi"] <= 0:
        return None, "no open interest"
    t, f = e["t"], e["forward"]
    if index:
        gap = abs(math.log(f / index))
        if gap > MAX_GAP or gap / t > MAX_BASIS:
            return None, "forward too far from the index"
    marks = [(k, v) for k, v in e["marks"] if v and v > 0 and k > 0]          # by strike, rising
    # a stale mark stands off the smile: one more than MAX_JUMP from the line between its neighbours is left out
    smooth = [m for i, m in enumerate(marks) if not (0 < i < len(marks) - 1 and _off_the_line(marks[i - 1], m, marks[i + 1]))]
    # and the call delta must fall as the strike rises: a mark that breaks the order is left out
    mono: list[tuple[float, float]] = []
    for k, v in smooth:
        d = _phi((math.log(f / k) + 0.5 * v * v * t) / (v * math.sqrt(t)))
        if not mono or d < mono[-1][0] - 1e-9:
            mono.append((d, v))
    mono.reverse()                                                              # by delta, rising
    if len(mono) < MIN_STRIKES:
        return None, f"{len(mono)} usable strikes"
    c25, atm, p25 = _at_delta(mono, 0.25), _at_delta(mono, 0.5), _at_delta(mono, 0.75)
    if c25 is None or atm is None or p25 is None:
        return None, "marks do not reach the 25-delta points"
    rr, bf = c25 - p25, 0.5 * (c25 + p25) - atm
    if not (ATM_BOUNDS[0] <= atm <= ATM_BOUNDS[1]) or abs(rr) > 0.5 * atm or not (-0.1 * atm <= bf <= 0.5 * atm):
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
        q, why = expiry_quote(e, chain["index"])
        if q:
            good.append(q)
        else:
            dropped[e["code"]] = why
    asof = chain["asof"]
    why = None
    if not chain["index"]:
        why = "no index price"
    elif asof is None:
        why = "marks carry no time"
    elif not (now - MAX_AGE <= asof <= now + MAX_AHEAD):
        why = f"marks dated {int((now - asof).total_seconds() // 60)} minutes from now"
    elif len(good) < MIN_EXPIRIES:
        why = f"{len(good)} usable expiries"
    ok = why is None
    return {"asset": asset, "asof": asof, "index": chain["index"], "why": why,
            "vol": vol_quotes(good) if ok else None, "forward": forward_quotes(good, chain["index"]) if ok else None,
            "expiries": [{"code": g["code"], "days": round(g["days"], 2), "forward": round(g["forward"], 4), "atm": round(g["atm"] * 100, 2),
                          "rr25": round(g["rr"] * 100, 2), "bf25": round(g["bf"] * 100, 2)} for g in good],
            "dropped": dropped, "last_expiry": good[-1]["code"] if good else None}


def source(kind: str, built: dict) -> str:
    """'DEMO · Deribit option marks · 2026-11-09 12:46 UTC · listed to 24SEP27, flat beyond'."""
    return f"{SOURCE_PREFIX} {kind} · {built['asof']:%Y-%m-%d %H:%M} UTC · listed to {built['last_expiry']}, flat beyond"


# ── Network ────────────────────────────────────────────────────────────────────

def fetch_chain(asset: str, client: httpx.Client) -> list:
    """The chain's rows, read under a byte cap and a wall-clock deadline (the client's timeout is per read)."""
    started, body = time.monotonic(), bytearray()
    with client.stream("GET", API, params={"currency": CHAIN_CURRENCY[asset], "kind": "option"}) as r:
        if r.status_code != 200:
            raise Unusable(f"HTTP {r.status_code}")
        for chunk in r.iter_bytes():
            body += chunk
            if len(body) > MAX_BYTES:
                raise Unusable("response over the size cap")
            if time.monotonic() - started > DEADLINE:
                raise Unusable("response over the deadline")
    try:
        rows = json.loads(body)["result"]
    except (ValueError, KeyError, TypeError):
        raise Unusable("response is not the expected JSON") from None
    if not isinstance(rows, list) or len(rows) > MAX_ROWS:
        raise Unusable("response is not a list of instruments within the row cap")
    return rows


def collect(now: Optional[datetime] = None, assets=ASSETS, pause: float = 0.5) -> dict:
    """{ok: {asset: built}, failed: {asset: why}}. An asset whose chain cannot be read or gives no surface is reported, not fatal."""
    from version import VERSION
    out: dict = {"ok": {}, "failed": {}}
    with httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=False,
                      headers={"User-Agent": f"rijeka/{VERSION} (+https://rijeka.app)"}) as c:
        for i, asset in enumerate(assets):
            if i:
                time.sleep(pause)
            try:
                b = build(fetch_chain(asset, c), asset, now)
                if b["vol"] is None:
                    raise Unusable(b["why"] or "no surface")
                out["ok"][asset] = b
            except Unusable as e:       # our own words: safe on the public health page
                log.warning("deribit %s unusable: %s", asset, e)
                out["failed"][asset] = str(e)
            except Exception as e:      # noqa: BLE001 — one asset must not stop the others; the last good surface stands
                log.warning("deribit %s failed: %s: %r", asset, type(e).__name__, str(e)[:200])
                out["failed"][asset] = type(e).__name__          # the message may quote the venue: it stays in the log
    return out


def marks_time(source: Optional[str]) -> Optional[datetime]:
    """The time of the marks from a stored row's source label ('DEMO · Deribit … · 2026-11-09 12:57 UTC · …')."""
    parts = str(source or "").split(" · ")
    if len(parts) < 3 or not str(source).startswith(SOURCE_PREFIX):
        return None
    try:
        return datetime.strptime(parts[2], "%Y-%m-%d %H:%M UTC").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
