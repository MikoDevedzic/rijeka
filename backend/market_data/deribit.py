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
tenors and is flat inside one week, so it returns the venue's mark at a tenor and not exactly between
tenors (within 0.3 of a vol point on the term structure of 9 November 2026, up to about 1.3 on steep or
event-shaped ones); an option inside one week is priced at the one-week level, which a steep front end
misses by points (2.5 to 10 at four days on the shapes tested). Forwards: the annualised basis ln(F/S)/T is interpolated
linearly in time and held flat beyond the last expiry; points = S·(e^{bT} − 1) on the venue's index.

Safeguards. The venue's response is someone else's data: it is read under a size cap and a deadline,
every number must be finite and every expiry code well formed, and the marks must carry a time within
MAX_AGE of now. An expiry is dropped when it is inside MIN_DAYS, has fewer than MIN_STRIKES usable
marks, has no open interest, does not bracket the 25-delta points, gives a vol level outside sanity
bounds, or a forward further from the index than MAX_BASIS allows; within an expiry a mark that
stands more than a quarter off the median of the five marks around it (the worst first), or whose
delta breaks the order of the strikes, is left out. A surface needs MIN_EXPIRIES good
expiries or none is produced, and the caller keeps the last good one; the caller also checks the index
against an independent spot before it stores anything. Nothing here writes; the caller stamps the
source and the time of the marks on every row it saves. What a failure reports is written here, never
copied from the response.

Delivery prices. The venue publishes one delivery price per index a day, at 08:00 UTC, the price its
own contracts settle on:

    GET /api/v2/public/get_delivery_prices?index_name=btc_usd&count=3

parse_delivery turns the response into fixings ({pair, fixing_date, fixing_time, source, value}) for the
fixings store (settlement/store.py): a trade whose terms name "Deribit BTC delivery price" settles on
that row. The same safeguards: the read is capped and deadlined, a date must be a plain ISO date not in
the future, a price a positive finite number within DELIVERY_BAND of the median of the days around it,
and at most MAX_DELIVERY_ROWS rows are taken. The caller stores a date once and never overwrites it.

RIJEKA_DERIBIT=0 turns the source off (the daily rebuild then removes its rows and the parametric
surfaces return). The venue's API usage policy allows unauthenticated public data at a low frequency;
this module makes three requests per marks run, and three per delivery-price run until the day's
prices are stored.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
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
MAX_JUMP = 0.25           # a mark more than a quarter away from the median of the marks around it is not part of the smile
STALE_WINDOW = 5

# the daily delivery prices (the venue's own settlement prices): one row per index and day
DELIVERY_API = "https://www.deribit.com/api/v2/public/get_delivery_prices"
DELIVERY_URL = "https://docs.deribit.com/#public-get_delivery_prices"
DELIVERY_INDEX = {"BTC": "btc_usd", "ETH": "eth_usd", "SOL": "sol_usd"}       # each answered on 2026-11-09
DELIVERY_TIME = "08:00 UTC"
MAX_DELIVERY_ROWS = 120   # a backfill of four months; a day's run asks for three
DELIVERY_BAND = 0.60      # a price more than 60 % from the median of the five days around it is not that day's price
DELIVERY_WINDOW = 5
ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


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


def _off_its_neighbours(marks: list[tuple[float, float]], i: int) -> float:
    """How far mark i stands from the median vol of the five marks around it (itself included; at an end of the
    chain, the five nearest), as a fraction of that median. A median of five is unmoved by one bad mark or by two
    side by side, and a mark at the end of the chain is judged like any other instead of anchoring its neighbour."""
    lo = max(0, min(i - STALE_WINDOW // 2, len(marks) - STALE_WINDOW))
    mid = median(v for _, v in marks[lo:lo + STALE_WINDOW])
    return abs(marks[i][1] - mid) / mid if mid > 0 else 0.0


def _without_stale(marks: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """The marks by strike with stale ones left out: a mark more than MAX_JUMP from the median of the five around
    it, the worst first, re-read after each removal. History of this function (Emmy, 9 November 2026): comparing a
    mark with the line between its two neighbours also convicted the neighbours of a stale mark; taking the worst
    first fixed one stale mark and failed on two side by side and on one at the end of a short chain. What it
    still cannot see: three stale marks side by side (the expiry then usually fails the bounds), and it can drop
    an honest mark where neighbouring strikes differ by a third in vol (a four-day smile on a very sparse grid);
    an expiry left without marks around 25 delta is dropped, not misread."""
    kept = list(marks)
    while len(kept) >= STALE_WINDOW:
        worst, i = max((_off_its_neighbours(kept, j), j) for j in range(len(kept)))
        if worst <= MAX_JUMP:
            break
        del kept[i]
    return kept


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
    smooth = _without_stale(marks)
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


# ── Pure: delivery prices to fixings ───────────────────────────────────────────

def delivery_source(asset: str) -> str:
    """'Deribit BTC delivery price': the settlement price source a trade's terms name, and the stored row's source."""
    return f"{PROVIDER} {asset} delivery price"


def parse_delivery(payload, asset: str, today: Optional[date] = None) -> list[dict]:
    """[{pair, fixing_date, fixing_time, source, value}], ascending by date, from the venue's
    {"result": {"data": [{"date": "2026-11-09", "delivery_price": 73906.34}, ...]}}.

    Only the first MAX_DELIVERY_ROWS rows are read. A row is kept when its date is a plain ISO date (ASCII digits,
    a real calendar day) not after `today` (UTC), its price a positive finite number, and the date not already
    taken (the first row for a date stands). Then a price more than DELIVERY_BAND from the median of the
    DELIVERY_WINDOW days around it (itself included; at an end, the nearest ones) is dropped: one bad row among
    its neighbours goes, and a batch of one or two rows has no neighbours to be judged by, so two rows that
    disagree that far both go. Anything else in the payload is ignored; junk gives an empty list, never an error."""
    today = today or datetime.now(timezone.utc).date()
    result = payload.get("result") if isinstance(payload, dict) else None
    data = result.get("data") if isinstance(result, dict) else None
    by: dict[date, float] = {}
    for o in (data if isinstance(data, list) else [])[:MAX_DELIVERY_ROWS]:
        if not isinstance(o, dict):
            continue
        d, v = o.get("date"), _num(o.get("delivery_price"))
        if not isinstance(d, str) or not ISO_DATE.fullmatch(d) or v is None or v <= 0:
            continue
        try:
            day = date(int(d[:4]), int(d[5:7]), int(d[8:]))
        except ValueError:
            continue
        if day > today or day in by:
            continue
        by[day] = v
    days = sorted(by)
    kept = []
    for i, day in enumerate(days):
        lo = max(0, min(i - DELIVERY_WINDOW // 2, len(days) - DELIVERY_WINDOW))
        mid = median(by[x] for x in days[lo:lo + DELIVERY_WINDOW])
        if abs(by[day] / mid - 1.0) <= DELIVERY_BAND:
            kept.append(day)
    return [{"pair": pair(asset), "fixing_date": day, "fixing_time": DELIVERY_TIME, "source": delivery_source(asset), "value": by[day]} for day in kept]


# ── Network ────────────────────────────────────────────────────────────────────

def _read_result(client: httpx.Client, url: str, params: dict):
    """The `result` of one of the venue's public methods, read under a byte cap and a wall-clock deadline (the
    client's timeout is per read). Every failure is an Unusable in this module's own words."""
    started, body = time.monotonic(), bytearray()
    with client.stream("GET", url, params=params) as r:
        if r.status_code != 200:
            raise Unusable(f"HTTP {int(r.status_code)}")
        for chunk in r.iter_bytes():
            body += chunk
            if len(body) > MAX_BYTES:
                raise Unusable("response over the size cap")
            if time.monotonic() - started > DEADLINE:
                raise Unusable("response over the deadline")
    try:
        return json.loads(body)["result"]
    except (ValueError, KeyError, TypeError):
        raise Unusable("response is not the expected JSON") from None


def fetch_chain(asset: str, client: httpx.Client) -> list:
    """The chain's rows (capped and deadlined by _read_result), within the row cap."""
    rows = _read_result(client, API, {"currency": CHAIN_CURRENCY[asset], "kind": "option"})
    if not isinstance(rows, list) or len(rows) > MAX_ROWS:
        raise Unusable("response is not a list of instruments within the row cap")
    return rows


def fetch_delivery(asset: str, client: httpx.Client, count: int = 3) -> dict:
    """The venue's latest `count` daily delivery prices for the asset's index, as the payload parse_delivery
    reads ({"result": {"data": [...]}}), read like a chain and within the row cap."""
    count = max(1, min(int(count), MAX_DELIVERY_ROWS))
    result = _read_result(client, DELIVERY_API, {"index_name": DELIVERY_INDEX[asset], "count": count})
    data = result.get("data") if isinstance(result, dict) else None
    if not isinstance(data, list) or len(data) > MAX_DELIVERY_ROWS:
        raise Unusable("response is not a list of delivery prices within the row cap")
    return {"result": {"data": data}}


def _client() -> httpx.Client:
    from version import VERSION
    return httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=False,
                        headers={"User-Agent": f"rijeka/{VERSION} (+https://rijeka.app)"})


def _each(assets, pause: float, what: str, read) -> dict:
    """{ok: {asset: read(asset, client)}, failed: {asset: why}} over one client. An asset that cannot be read is
    reported, not fatal; what is reported is written here, never copied from the response."""
    out: dict = {"ok": {}, "failed": {}}
    with _client() as c:
        for i, asset in enumerate(assets):
            if i:
                time.sleep(pause)
            try:
                out["ok"][asset] = read(asset, c)
            except Unusable as e:       # our own words: safe on the public health page
                log.warning("deribit %s %s unusable: %s", what, asset, e)
                out["failed"][asset] = str(e)
            except Exception as e:      # noqa: BLE001 — one asset must not stop the others; what is stored stands
                log.warning("deribit %s %s failed: %s: %r", what, asset, type(e).__name__, str(e)[:200])
                out["failed"][asset] = type(e).__name__          # the message may quote the venue: it stays in the log
    return out


def collect(now: Optional[datetime] = None, assets=ASSETS, pause: float = 0.5) -> dict:
    """{ok: {asset: built}, failed: {asset: why}}. An asset whose chain cannot be read or gives no surface is reported, not fatal."""
    def read(asset: str, c: httpx.Client) -> dict:
        b = build(fetch_chain(asset, c), asset, now)
        if b["vol"] is None:
            raise Unusable(b["why"] or "no surface")
        return b
    return _each(assets, pause, "marks", read)


def collect_delivery(count: int = 3, assets=ASSETS, today: Optional[date] = None, pause: float = 0.5) -> dict:
    """{ok: {asset: [fixing rows, ascending by date]}, failed: {asset: why}} from the venue's delivery prices."""
    def read(asset: str, c: httpx.Client) -> list[dict]:
        rows = parse_delivery(fetch_delivery(asset, c, count), asset, today)
        if not rows:
            raise Unusable("no usable delivery price")
        return rows
    return _each(assets, pause, "delivery prices", read)


def marks_time(source: Optional[str]) -> Optional[datetime]:
    """The time of the marks from a stored row's source label ('DEMO · Deribit … · 2026-11-09 12:57 UTC · …')."""
    parts = str(source or "").split(" · ")
    if len(parts) < 3 or not str(source).startswith(SOURCE_PREFIX):
        return None
    try:
        return datetime.strptime(parts[2], "%Y-%m-%d %H:%M UTC").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
