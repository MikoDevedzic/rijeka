"""
Currencies — FX and digital assets on one model (pricing/currency_forward.py).

    GET  /api/currency/pairs             supported pairs with spot, as-of, and which curve prices each side
    POST /api/currency/spot/snap         FX reference rates (ECB via frankfurter.dev) + crypto spot (Coinbase), saved as snapshots
    POST /api/currency/spot/tick         same for the demo template account (X-Rijeka-Cron)
    POST /api/currency/forward/price     spot / forward / NDF on any pair, from parameters
    GET  /api/currency/fixings/{pair}    stored fixings of a digital-asset pair (the stored spots before the migration)
    POST /api/currency/fixings           a desk's own fixing for a source the feed does not store
    POST /api/currency/fixings/correct   an administrator's correction of a shared fixing (or the filling of a missing date)

Snapshots: {PAIR}_SPOT with quotes [{"tenor": "SPOT", "rate": quote per base}], source IMPORT.
Discounting: each currency's OIS curve (USD_SOFR, EUR_ESTR, GBP_SONIA, …) through the
pricer's own loader; a digital asset discounts at its funding rate ({ASSET}_FUNDING, MANUAL).

Booked FX_SPOT / FX_FORWARD / NDF / CRYPTO_FORWARD trades are priced from trade.terms by
price_booked() when POST /price meets one. The crypto routes under /api/crypto remain.
A digital-asset trade whose fixing date is reached is answered from the settlement rule
(settlement/rule.py): its stored fixing, or the stored spot flagged provisional.
"""
from __future__ import annotations

import json
import logging
import math
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.models import Trade
from db.session import get_db
from middleware.auth import verify_token
from api.routes._errors import internal
from pricing.currency_forward import price_currency_forward
from pricing.fx_option import price_fx_option
from pricing.fx_exotic import ExoticSpec, price_exotic
from pricing.fx_vol import TENOR_YEARS as VOL_TENORS, lookup_vol, parse_surface, quotes_from_grid
from api.routes.crypto import (ASSETS as CRYPTO_ASSETS, fetch_spot as fetch_crypto_spot, latest_snapshot, _quote, _require_trader)

log = logging.getLogger("rijeka.currency")
router = APIRouter(prefix="/api/currency", tags=["currency"])

# pairs as the market quotes them: quote currency per one unit of base
FX_PAIRS = ("EURUSD", "GBPUSD", "AUDUSD", "USDJPY", "USDCHF", "USDCAD")
CRYPTO_PAIRS = tuple(f"{a}USD" for a in CRYPTO_ASSETS)
PAIRS = FX_PAIRS + CRYPTO_PAIRS
CURVE_FOR = {"USD": "USD_SOFR", "EUR": "EUR_ESTR", "GBP": "GBP_SONIA", "JPY": "JPY_TONAR",
             "CHF": "CHF_SARON", "AUD": "AUD_AONIA", "CAD": "CAD_CORRA"}
PIP = {"USDJPY": 0.01}
FX_FEED_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,JPY,CHF,AUD,CAD"
FX_FEED_NAME = "ECB reference rates (frankfurter.dev, public)"
# When an account has no OIS curve for a currency (the hosted demo copies only
# public-source snapshots), discount it flat at a rate the desk can set
# ({CCY}_FLAT, MANUAL) or, failing that, at the central bank's policy rate.
# Every response says which one it used; a flat curve is illustrative.
POLICY_RATE_PCT = {"EUR": 2.50, "GBP": 3.75, "JPY": 1.25, "CHF": 0.00, "AUD": 4.60, "CAD": 2.25, "USD": 4.00}
POLICY_RATE_NOTE = "central-bank policy rate, late October 2026, illustrative"
FWD_TENORS = ("1W", "2W", "1M", "2M", "3M", "6M", "9M", "1Y", "2Y")
TENOR_DAYS = {"ON": 1, "1W": 7, "2W": 14, "1M": 30, "2M": 61, "3M": 91, "6M": 182, "9M": 273, "1Y": 365, "2Y": 730}
MODES = ("MARKET", "IMPLIED")     # MARKET: outright = spot + quoted points; IMPLIED: parity on the two OIS curves
FIXING_DEFAULT = {"USDJPY": "WM/Reuters 4pm London", "BTCUSD": "CME CF BRR", "ETHUSD": "CME CF ETHUSD_RR", "SOLUSD": "Coinbase SOL-USD"}
# The settlement price sources a digital-asset trade may name, with the time each is published (settlement/sources.py:
# `auto` is the feed's, stored as a shared row; the others are a desk's own entry, POST /api/currency/fixings).
from settlement.sources import SETTLEMENT_SOURCES, check_desk_source, feed_source, printable  # noqa: E402
FIXING_VALUE_MAX = 1e12
FIXING_DAYS_MAX = 366
FIXING_FLOOR = date(2015, 1, 1)             # no digital-asset fixing this desk settles on is older
FIXING_REASON = (10, 500)                   # a correction's reason, in characters
SPOT_AS_FIXING = "stored spot (no fixing stored)"


FIXING_REASON_OVERRIDE = 30                 # and at least this many when the spot's band is overridden
BAND_OVERRIDDEN = "[band overridden] "


def offered_sources(db: Session, pair: str) -> list[dict]:
    """The settlement price sources a ticket on the pair is offered: the benchmark, and the venue's delivery price
    only where the feed is actually delivering it (settlement/store.feed_delivering: switched on, the table there,
    a shared fixing within the last three days). "Fixed automatically each day" is not promised where it is not
    true. Only the offer follows the feed: a record that names the venue's source is still booked, valued and
    mirrored wherever it arrives (settlement/sources.check_booked reads the full list)."""
    from settlement import store
    listed = SETTLEMENT_SOURCES.get(pair) or []
    delivering = bool(listed) and store.feed_delivering(db, pair)
    return [dict(x) for x in listed if delivering or not x["auto"]]


def settlement_default(db: Session, pair: str, offered: Optional[list[dict]] = None) -> Optional[dict]:
    """{source, time}: the settlement price source a new ticket on a digital-asset pair starts on; None for an FX pair.
    The venue's delivery price where it is offered (the feed is delivering it), and the licensed benchmark
    otherwise, because there a delivery price would never be stored and nobody may enter one by hand.

    `fixing_default` in the pairs answer is not this: it stays the benchmark, always, because clients older than
    0.14.0 pair it with a hard-coded 16:00 London and would otherwise book a venue price at a benchmark's time."""
    offered = offered_sources(db, pair) if offered is None else offered
    if not offered:
        return None
    benchmark = FIXING_DEFAULT.get(pair)
    hit = next((x for x in offered if x["auto"]), None) or next((x for x in offered if x["source"] == benchmark), offered[0])
    return {"source": hit["source"], "time": hit["time"]}


def split_pair(pair: str) -> tuple[str, str]:
    p = pair.upper()
    if p not in PAIRS:
        raise HTTPException(status_code=422, detail=f"pair must be one of {', '.join(PAIRS)}")
    base = p[:-3] if p.endswith("USD") and p[:-3] != "USD" else p[:3]
    return base, p[len(base):]


def is_crypto(base: str) -> bool:
    return base.upper() in CRYPTO_ASSETS


# ── market data ────────────────────────────────────────────────────────────

def fetch_fx_spot(timeout: float = 8.0) -> dict[str, float]:
    """quote-per-base for every FX pair, from USD-based reference rates."""
    with httpx.Client(timeout=timeout, follow_redirects=True,
                      headers={"User-Agent": "rijeka/0.4 (+https://rijeka.app)"}) as c:
        r = c.get(FX_FEED_URL)
        r.raise_for_status()
        usd = r.json()["rates"]          # units of CCY per 1 USD
    out = {}
    for pair in FX_PAIRS:
        base, quote = pair[:3], pair[3:]
        try:
            out[pair] = float(usd[quote]) if base == "USD" else 1.0 / float(usd[base])
        except (KeyError, ZeroDivisionError, TypeError):
            log.warning("fx pair %s missing from feed", pair)
    if not out:
        raise RuntimeError("no FX rates could be read")
    return out


def fetch_all_spot() -> dict[str, float]:
    prices: dict[str, float] = {}
    try:
        prices.update(fetch_fx_spot())
    except Exception as e:
        log.warning("fx feed failed: %s", e)
    try:
        prices.update({f"{a}USD": px for a, px in fetch_crypto_spot().items()})
    except Exception as e:
        log.warning("crypto feed failed: %s", e)
    if not prices:
        raise RuntimeError("no spot could be fetched from either feed")
    return prices


def _save_pairs(db: Session, user_id, prices: dict[str, float]) -> int:
    from sqlalchemy import text
    today = date.today()
    n = 0
    for pair, px in prices.items():
        cid = f"{pair}_SPOT"
        quotes = [{"tenor": "SPOT", "quote_type": "SPOT", "rate": px, "enabled": True}]
        db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c AND valuation_date = :d"),
                   {"u": user_id, "c": cid, "d": today})
        db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                        "VALUES (:c, :d, CAST(:q AS jsonb), 'IMPORT', :u, :u)"),
                   {"c": cid, "d": today, "q": json.dumps(quotes), "u": user_id})
        n += 1
    db.commit()
    return n


def forward_curve(db: Session, user_id, pair: str) -> Optional[dict]:
    """Latest {PAIR}_FWD snapshot: {valuation_date, source, points: {tenor: pips}}."""
    row = latest_snapshot(db, user_id, f"{pair}_FWD")
    if not row or not row.quotes:
        return None
    pts = {q["tenor"]: float(q["rate"]) for q in row.quotes
           if q.get("enabled", True) and q.get("rate") is not None and q.get("tenor") in TENOR_DAYS}
    if len(pts) < 2:
        return None
    return {"valuation_date": row.valuation_date.isoformat(), "source": row.source, "points": pts}


def interp_points(points: dict[str, float], days: int) -> float:
    """Forward points at `days`, linear in time between quoted tenors; 0 at spot, flat beyond the last."""
    xs = sorted((TENOR_DAYS[t], v) for t, v in points.items())
    xs = [(0, 0.0)] + xs
    if days <= 0:
        return 0.0
    for (d0, p0), (d1, p1) in zip(xs, xs[1:]):
        if d0 <= days <= d1:
            return p0 + (p1 - p0) * (days - d0) / (d1 - d0) if d1 > d0 else p1
    return xs[-1][1]


def marks_label(source: Optional[str]) -> Optional[str]:
    """A snapshot's source as the ticket prints it: who quoted it and when, without the storage prefix."""
    s = str(source or "").strip()
    return (s[len("DEMO · "):] if s.startswith("DEMO · ") else s) or None


def is_venue(source: Optional[str]) -> bool:
    """A row read from a venue's marks (market_data/deribit.py), which carries the time of the marks in its source."""
    from market_data import deribit
    return deribit.marks_time(source) is not None


def short_label(source: Optional[str], as_of: str, kind: str) -> str:
    """A field's caption: 'Deribit 9 Nov 12:57 UTC' for a venue's marks (the venue and the time, both from the
    source; short enough for one line over an input), otherwise the source, what it is and its date, as before."""
    parts = str(source or "").split(" · ")
    if len(parts) >= 3 and parts[0] == "DEMO" and parts[2].endswith(" UTC"):
        try:
            at = datetime.strptime(parts[2], "%Y-%m-%d %H:%M UTC")
            return f"{parts[1].split()[0]} {at.day} {at:%b %H:%M} UTC"
        except (ValueError, IndexError):        # a label that only looks like a venue's: caption it as any other source
            pass
    return f"{source} {kind} {as_of}"


def forward_mode(db: Session, user_id) -> str:
    row = latest_snapshot(db, user_id, "FX_FORWARD_MODE")
    v = _quote(row, "MODE")
    return "IMPLIED" if v is not None and int(v) == 0 else "MARKET"


def pair_state(db: Session, user_id, pair: str, settlement: bool = True) -> dict[str, Any]:
    """A pair's market as the account holds it. `settlement=False` leaves out the settlement sources, which the
    pricer does not read (one question to the fixings store saved on every price)."""
    base, quote = split_pair(pair)
    s = latest_snapshot(db, user_id, f"{pair}_SPOT")
    out = {"pair": pair, "base": base, "quote": quote, "crypto": is_crypto(base),
           "spot": _quote(s, "SPOT"), "spot_as_of": s.valuation_date.isoformat() if s else None,
           "quote_curve": CURVE_FOR.get(quote), "pip": PIP.get(pair, 1.0 if is_crypto(base) else 1e-4),
           "fixing_default": FIXING_DEFAULT.get(pair, "WM/Reuters 4pm London")}
    if is_crypto(base) and settlement:
        out["fixing_sources"] = offered_sources(db, pair)
        out["settlement_default"] = settlement_default(db, pair, out["fixing_sources"])
    fc = forward_curve(db, user_id, pair)
    out.update(forward_curve=fc and {"valuation_date": fc["valuation_date"], "source": fc["source"], "label": short_label(fc["source"], fc["valuation_date"], "points"),
                                     "tenors": sorted(fc["points"], key=TENOR_DAYS.get)},
               forward_points=fc["points"] if fc else None)
    vs = latest_snapshot(db, user_id, f"{pair}_VOL")
    if vs:
        grid: dict[str, dict[str, float]] = {}
        for q in vs.quotes or []:
            if q.get("rate") is not None and q.get("enabled", True):
                grid.setdefault(str(q.get("tenor")).upper(), {})[str(q.get("quote_type", "ATM")).upper()] = float(q["rate"])
        out["vol_surface"] = {"valuation_date": vs.valuation_date.isoformat(), "source": vs.source,
                              "label": short_label(vs.source, vs.valuation_date.isoformat(), "surface"),
                              "tenors": sorted(grid, key=lambda k: VOL_TENORS.get(k, 99)), "grid": grid}
    else:
        out["vol_surface"] = None
    if is_crypto(base):
        f = latest_snapshot(db, user_id, f"{base}_FUNDING")
        out.update(base_curve=None, funding_pct=_quote(f, "FLAT"), funding_as_of=f.valuation_date.isoformat() if f else None)
    else:
        bc = CURVE_FOR.get(base)
        row = latest_snapshot(db, user_id, bc) if bc else None
        has = bool(row) and sum(1 for q in (row.quotes or []) if q.get("enabled", True) and q.get("rate") is not None) >= 2
        flat = latest_snapshot(db, user_id, f"{base}_FLAT")
        out.update(base_curve=bc, base_curve_available=has,
                   base_flat_pct=_quote(flat, "FLAT") if flat else None,
                   base_fallback=None if has else (f"flat {_quote(flat, 'FLAT')}% ({base}_FLAT)" if flat else f"flat {POLICY_RATE_PCT.get(base)}% ({POLICY_RATE_NOTE})"))
    return out


@router.get("/pairs")
def pairs(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    mode = forward_mode(db, user["sub"])
    out = [pair_state(db, user["sub"], p) for p in PAIRS]
    for p in out:
        if p.get("forward_curve"):
            p["forward_curve"]["in_use"] = mode == "MARKET"          # on IMPLIED the points are stored and not priced on
    return {"pairs": out, "forward_mode": mode,
            "forward_tenors": list(FWD_TENORS), "tenor_days": dict(TENOR_DAYS),
            "feeds": {"fx": FX_FEED_NAME, "crypto": "Coinbase spot (public)"}}


class ForwardCurveIn(BaseModel):
    pair: str
    valuation_date: Optional[date] = None
    points: dict[str, float] = Field(default_factory=dict, description="tenor -> forward points in pips (Bloomberg convention); empty with a spot saves the spot alone")
    spot: Optional[float] = Field(None, description="outright spot to save alongside, if the snap carried one")
    source: str = "MANUAL"


@router.post("/forward-curve")
def save_forward_curve(req: ForwardCurveIn, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Save a pair's forward points by tenor as a {PAIR}_FWD snapshot (and the spot, if given)."""
    _require_trader(user)
    pair = req.pair.upper(); split_pair(pair)
    if req.source.upper() not in ("MANUAL", "BLOOMBERG", "IMPORT"):
        raise HTTPException(status_code=422, detail="source must be MANUAL, BLOOMBERG or IMPORT")
    pts = {t.upper(): float(v) for t, v in req.points.items() if t.upper() in TENOR_DAYS and v is not None}
    spot_only = not pts and req.spot is not None        # a desk spot on a pair whose points come from a feed: the points are not the desk's to re-save
    if len(pts) < 2 and not spot_only:
        raise HTTPException(status_code=422, detail="give at least two tenors")
    from sqlalchemy import text
    uid, today = uuid.UUID(user["sub"]), req.valuation_date or date.today()
    quotes = [{"tenor": t, "quote_type": "FWD_POINTS", "rate": v, "enabled": True} for t, v in sorted(pts.items(), key=lambda kv: TENOR_DAYS[kv[0]])]
    for cid, q in ((f"{pair}_FWD", None if spot_only else quotes), (f"{pair}_SPOT", [{"tenor": "SPOT", "quote_type": "SPOT", "rate": float(req.spot), "enabled": True}] if req.spot else None)):
        if q is None:
            continue
        db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c AND valuation_date = :d"), {"u": uid, "c": cid, "d": today})
        db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                        "VALUES (:c, :d, CAST(:q AS jsonb), :s, :u, :u)"), {"c": cid, "d": today, "q": json.dumps(q), "s": req.source.upper(), "u": uid})
    db.commit()
    return pair_state(db, uid, pair)


class UseFeedIn(BaseModel):
    pair: str


HANDED_BACK = "DEMO · handed back to the feed"      # a feed row by its prefix: the next marks run replaces it


@router.post("/forward-curve/use-feed")
def use_feed_forwards(req: UseFeedIn, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Go back to the venue's forwards on a digital-asset pair, without deleting anything.

    An account's own entry for a curve stays in force until the account replaces it, so a desk that once saved
    points keeps pricing on them. This replaces it: today's row for the pair is written with the account's current
    points under a feed label, so the forward does not move until the next marks run overwrites it with the
    venue's (minutes). The saved rows of earlier dates stay where they are: a past day re-runs on the points it had.

    Only for an account the feed writes to (the template, and accounts that are copies of it), or the promise
    would not be kept. When the caller is the template, the demo accounts still pricing on a copy of the
    template's own curve (same curve, date, quotes and source as a template row: a copy, not somebody's entry)
    are handed back with it, or they would keep the template's old curve for good."""
    _require_trader(user)
    from api.routes._limits import heavy
    heavy(user, "forward points back to the feed", 6)
    pair = req.pair.upper(); base, _ = split_pair(pair)
    if not is_crypto(base):
        raise HTTPException(status_code=422, detail="only a digital-asset pair has a feed for forward points")
    from sqlalchemy import text
    from api.routes import demo, demo_market_data
    from market_data import deribit
    uid, cid, today = uuid.UUID(user["sub"]), f"{pair}_FWD", date.today()
    is_template = str(demo._template_user_id(db)) == str(uid)
    fed = is_template or db.execute(text("SELECT 1 FROM legal_entities WHERE user_id = :u AND is_own_entity AND lei LIKE :p LIMIT 1"),
                                    {"u": uid, "p": demo.DEMO_LEI_PREFIX + "%"}).first() is not None
    if not (deribit.enabled() and demo_market_data.enabled() and fed):
        raise HTTPException(status_code=409, detail="the venue feed does not write to this account, so there is nothing to go back to")
    if not is_template:
        # a copy account receives the feed's forwards from the template: while the template itself prices on its own
        # saved points there are none to receive, and handing back would promise forwards that never come
        tpl = latest_snapshot(db, demo._template_user_id(db), cid)
        if tpl is None or not str(tpl.source or "").startswith("DEMO"):
            raise HTTPException(status_code=409, detail=f"the feed has no forwards for {pair} on this instance yet, so your saved points stay in force")
    users = [uid]
    if is_template and demo.enabled():
        users += [r[0] for r in db.execute(text("""
            SELECT d.user_id FROM (SELECT DISTINCT ON (user_id) user_id, curve_id, valuation_date, quotes, source FROM market_data_snapshots
                                   WHERE curve_id = :c ORDER BY user_id, valuation_date DESC) d
            JOIN market_data_snapshots t ON t.user_id = :u AND t.curve_id = d.curve_id AND t.valuation_date = d.valuation_date
                                        AND t.quotes = d.quotes AND t.source = d.source
            WHERE d.user_id <> :u AND d.source NOT LIKE 'DEMO%'
              AND d.user_id IN (SELECT user_id FROM legal_entities WHERE lei LIKE :p AND is_own_entity)"""),
            {"u": uid, "c": cid, "p": demo.DEMO_LEI_PREFIX + "%"}).all()]
    n = db.execute(text("""
        INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, created_by, user_id)
        SELECT l.curve_id, :d, l.quotes, :s, l.user_id, l.user_id
        FROM (SELECT DISTINCT ON (user_id) user_id, curve_id, quotes, source FROM market_data_snapshots
              WHERE curve_id = :c AND user_id = ANY(:users) ORDER BY user_id, valuation_date DESC) l
        WHERE l.source NOT LIKE 'DEMO%'
        ON CONFLICT (user_id, curve_id, valuation_date) DO UPDATE SET source = EXCLUDED.source, created_at = NOW()"""),
        {"c": cid, "d": today, "s": HANDED_BACK, "users": users}).rowcount or 0
    db.commit()
    log.info("forward points for %s handed back to the feed in %d account(s)", pair, n)
    mine = pair_state(db, uid, pair)
    return {**mine, "handed_back": bool(mine.get("forward_curve") and mine["forward_curve"]["source"] == HANDED_BACK), "accounts": n}


class VolSurfaceIn(BaseModel):
    pair: str
    valuation_date: Optional[date] = None
    grid: dict[str, dict[str, float]] = Field(..., description="tenor -> {ATM, RR25, BF25} in vol points (% p.a.)")
    source: str = "MANUAL"


@router.post("/vol-surface")
def save_vol_surface(req: VolSurfaceIn, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Save a pair's option vols by tenor (ATM, 25-delta risk reversal, 25-delta butterfly) as a {PAIR}_VOL snapshot."""
    _require_trader(user)
    pair = req.pair.upper(); base, _ = split_pair(pair)
    if is_crypto(base):
        raise HTTPException(status_code=422, detail="digital-asset vols are not in Phase 1")
    if req.source.upper() not in ("MANUAL", "BLOOMBERG", "IMPORT"):
        raise HTTPException(status_code=422, detail="source must be MANUAL, BLOOMBERG or IMPORT")
    grid = {t.upper(): {k.upper(): float(v) for k, v in (row or {}).items() if v is not None} for t, row in req.grid.items() if t.upper() in VOL_TENORS}
    quotes = quotes_from_grid({t: r for t, r in grid.items() if r.get("ATM")})
    if len(parse_surface(quotes)) < 2:
        raise HTTPException(status_code=422, detail="give an ATM vol at two tenors or more")
    from sqlalchemy import text
    uid, today = uuid.UUID(user["sub"]), req.valuation_date or date.today()
    cid = f"{pair}_VOL"
    db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c AND valuation_date = :d"), {"u": uid, "c": cid, "d": today})
    db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                    "VALUES (:c, :d, CAST(:q AS jsonb), :s, :u, :u)"), {"c": cid, "d": today, "q": json.dumps(quotes), "s": req.source.upper(), "u": uid})
    db.commit()
    return pair_state(db, uid, pair)


class ForwardModeIn(BaseModel):
    mode: str = Field(..., description="MARKET (spot + quoted points) or IMPLIED (parity on the two OIS curves)")


@router.post("/forward-mode")
def set_forward_mode(req: ForwardModeIn, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _require_trader(user)
    mode = req.mode.upper()
    if mode not in MODES:
        raise HTTPException(status_code=422, detail="mode must be MARKET or IMPLIED")
    from sqlalchemy import text
    uid, today = uuid.UUID(user["sub"]), date.today()
    quotes = [{"tenor": "MODE", "quote_type": "SETTING", "rate": 1 if mode == "MARKET" else 0, "enabled": True}]
    db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = 'FX_FORWARD_MODE' AND valuation_date = :d"), {"u": uid, "d": today})
    db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                    "VALUES ('FX_FORWARD_MODE', :d, CAST(:q AS jsonb), 'MANUAL', :u, :u)"), {"d": today, "q": json.dumps(quotes), "u": uid})
    db.commit()
    return {"forward_mode": mode}


@router.post("/spot/snap")
def snap(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _require_trader(user)
    try:
        prices = fetch_all_spot()
    except Exception as e:
        raise internal(502, "spot feeds unavailable", e)
    n = _save_pairs(db, uuid.UUID(user["sub"]), prices)
    return {"saved": n, "prices": prices, "as_of": date.today().isoformat()}


@router.post("/spot/tick")
def tick(db: Session = Depends(get_db), x_rijeka_cron: Optional[str] = Header(None, alias="X-Rijeka-Cron")):
    secret = os.getenv("RIJEKA_CRON_SECRET", "")
    if not secret or x_rijeka_cron != secret:
        raise HTTPException(status_code=401, detail="bad cron secret")
    from api.routes.demo import _template_user_id
    uid = _template_user_id(db)
    if uid is None:
        raise HTTPException(status_code=422, detail="RIJEKA_DEMO_TEMPLATE_EMAIL is not set or has no account")
    try:
        prices = fetch_all_spot()
    except Exception as e:
        raise internal(502, "spot feeds unavailable", e)
    return {"saved": _save_pairs(db, uid, prices), "prices": prices}


# ── fixings ────────────────────────────────────────────────────────────────

def fixings_view(db: Session, user_id, pair: str, days: int = 30) -> dict:
    """{pair, stored, sources, fixings}: the account's own and the shared fixings of the last `days`, ascending by
    date. Before the fixings table exists (`stored` false) the account's stored spots stand in, one per date, each
    marked origin SPOT: what an expired trade is valued on until a fixing is stored."""
    from sqlalchemy import text
    from settlement import store
    days = max(1, min(int(days), FIXING_DAYS_MAX))
    out = {"pair": pair, "stored": store.tables_present(db), "sources": offered_sources(db, pair)}
    if pair not in SETTLEMENT_SOURCES:
        return {**out, "fixings": []}
    if out["stored"]:
        return {**out, "fixings": store.recent(db, pair, days, user_id)}
    rows = db.execute(text("SELECT DISTINCT ON (valuation_date) valuation_date, quotes, source FROM market_data_snapshots "
                           "WHERE user_id = :u AND curve_id = :c AND valuation_date >= :d ORDER BY valuation_date, created_at DESC"),
                      {"u": user_id, "c": f"{pair}_SPOT", "d": date.today() - timedelta(days=days)}).all()
    spots = [(r.valuation_date, _quote(r, "SPOT")) for r in rows]
    return {**out, "fixings": [{"date": d.isoformat(), "source": SPOT_AS_FIXING, "time": None, "value": float(v), "origin": "SPOT", "own": False, "disputed": False}
                               for d, v in spots if v is not None]}


@router.get("/fixings/{pair}")
def get_fixings(pair: str, days: int = Query(30), db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    pair = pair.upper()
    split_pair(pair)
    return fixings_view(db, user["sub"], pair, days)


class FixingIn(BaseModel):
    pair: str = Field(..., max_length=12)
    fixing_date: date
    source: str = Field(..., max_length=400, description="the settlement price source as a trade's terms name it; at most 80 characters once trimmed")
    value: float


def _fixing_inputs(pair_in: str, value_in: float) -> tuple[str, str, float]:
    """(pair, asset, value) of a fixing entry, or 422: a digital-asset pair, a positive finite number."""
    pair = str(pair_in).upper()
    base, _ = split_pair(pair)
    if not is_crypto(base) or pair not in SETTLEMENT_SOURCES:
        raise HTTPException(status_code=422, detail="fixings are stored for digital-asset pairs")
    value = float(value_in)
    if not math.isfinite(value) or value <= 0 or value > FIXING_VALUE_MAX:
        raise HTTPException(status_code=422, detail="value must be a positive, finite number")
    return pair, base, value


@router.post("/fixings")
def save_fixing(req: FixingIn, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """A desk's own fixing for a pair, date and source. A second entry for the same key supersedes the first, which
    is kept. A source the feed stores, or a name that reads like one, is refused: those rows are shared and
    published, not anyone's to enter (an administrator corrects one with POST /api/currency/fixings/correct)."""
    _require_trader(user)
    from api.routes._limits import heavy
    heavy(user, "fixing entry", 30)
    from sqlalchemy.exc import IntegrityError
    from settlement import store
    pair, _, value = _fixing_inputs(req.pair, req.value)
    try:
        source = check_desk_source(req.source)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    today = max(date.today(), datetime.now(timezone.utc).date())      # a date that has begun anywhere the server could be
    if req.fixing_date > today:
        raise HTTPException(status_code=422, detail="fixing_date cannot be in the future")
    if req.fixing_date < FIXING_FLOOR:
        raise HTTPException(status_code=422, detail=f"fixing_date cannot be before {FIXING_FLOOR.isoformat()}")
    if not store.tables_present(db):
        raise HTTPException(status_code=409, detail="fixings are not stored on this instance yet (the fixings migration is not applied)")
    when = next((x["time"] for x in SETTLEMENT_SOURCES[pair] if x["source"] == source), None)
    uid = uuid.UUID(user["sub"])
    used = store.own_usage(db, uid, pair, req.fixing_date, source)
    if used["total"] >= store.OWN_TOTAL_MAX:              # a replacement keeps the row it replaces, so it counts too
        raise HTTPException(status_code=409, detail=f"this account has stored {store.OWN_TOTAL_MAX} fixings, replaced ones included, the most it may; no further entry is taken")
    if not used["replaces"] and used["rows"] >= store.OWN_ROWS_MAX:
        raise HTTPException(status_code=422, detail=f"this account already holds {store.OWN_ROWS_MAX} fixings of its own, the most it may")
    if not used["source_known"] and used["sources"] >= store.OWN_SOURCES_MAX:
        raise HTTPException(status_code=422, detail=f"this account already uses {store.OWN_SOURCES_MAX} sources on {pair}, the most it may")
    try:
        store.put_own(db, uid, pair, req.fixing_date, source, value, when)
        db.commit()
    except IntegrityError:
        db.rollback()                 # two entries for the same key at the same moment: one stands
        raise HTTPException(status_code=409, detail="another entry for this fixing was stored at the same moment; send it again")
    log.info("fixing entered for %s %s by %s", pair, req.fixing_date, str(uid)[:8])
    return fixings_view(db, user["sub"], pair, max(30, (date.today() - req.fixing_date).days + 1))


class FixingCorrectionIn(BaseModel):
    pair: str = Field(..., max_length=12)
    fixing_date: date
    source: str = Field(..., max_length=400)
    value: float
    reason: str = Field(..., max_length=4000, description="why the shared fixing is corrected; 10 to 500 characters, kept with the row")
    override_band: bool = Field(False, description="store the value although the stored spot of the date is more than 15 % away, or missing; the reason is then at least 30 characters")


@router.post("/fixings/correct")
def correct_fixing(req: FixingCorrectionIn, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """An administrator's correction of a shared fixing: the pair's feed source, a date the venue has published,
    a value that passes the feed's own checks (the asset's bounds, and within 15 % of the template's stored spot of
    that date). The live shared row is kept, marked superseded; the correction takes its place with its author and
    reason, and a dispute on the date ends. The same call fills a date that has no shared row, one the venue no
    longer serves.

    `override_band`: a genuine fixing after a move larger than the band, or on a date with no stored spot, could
    otherwise be stored by nobody. With it the band is not applied and a spot is not required (the source, the date
    window and the bounds still are), the reason is at least 30 characters, and the stored note says the band was
    overridden.

    Two gates beside the admin role, because these rows decide every account's settlement amounts and the role is
    only as good as the way an account comes by it: the caller is the instance's own account (the template
    account), and the route is off (409) until the sign-up role migration is applied in the database."""
    from api.routes import demo, demo_market_data
    from api.routes._limits import heavy
    from api.routes._roles import require_admin
    from market_data import deribit
    from sqlalchemy.exc import IntegrityError
    from settlement import store
    require_admin(db, user)
    # the admin role alone is not enough for a row every account settles on: the instance's own account only (the
    # template account the feeds write to), so a role gained any other way cannot move a shared fixing
    if str(demo._template_user_id(db) or "") != str(user["sub"]):
        raise HTTPException(status_code=403, detail="a shared fixing is corrected from the instance's own account")
    heavy(user, "fixing correction", 6)
    try:
        from api.routes.ops import signup_role_applied
        safe = signup_role_applied(db) is True
    except Exception:          # noqa: BLE001 — unknown is not applied
        db.rollback()
        safe = False
    if not safe:
        raise HTTPException(status_code=409, detail="corrections are off until the sign-up role migration is applied")
    pair, base, value = _fixing_inputs(req.pair, req.value)
    source = str(req.source)
    if source != feed_source(pair):
        raise HTTPException(status_code=422, detail=f"a correction is for the shared source of the pair, {feed_source(pair)}; a desk's own source is entered as its own fixing")
    low, high = deribit.DELIVERY_BOUNDS[base]
    if not (low <= value <= high):
        raise HTTPException(status_code=422, detail=f"value is outside what a {base} price can be")
    if req.fixing_date < FIXING_FLOOR or req.fixing_date > demo_market_data.expected_fixing_date():
        raise HTTPException(status_code=422, detail="fixing_date must be a date the venue has published a price for")
    reason = " ".join(str(req.reason).split())
    least = FIXING_REASON_OVERRIDE if req.override_band else FIXING_REASON[0]
    if not (least <= len(reason) <= FIXING_REASON[1]) or not printable(reason):
        raise HTTPException(status_code=422, detail=f"reason: {least} to {FIXING_REASON[1]} printable characters saying why")
    if not store.tables_present(db):
        raise HTTPException(status_code=409, detail="fixings are not stored on this instance yet (the fixings migration is not applied)")
    if req.override_band:
        reason = BAND_OVERRIDDEN + reason
    else:
        verdict = demo_market_data.spot_verdict(value, demo_market_data.template_spots(db, pair, [req.fixing_date]).get(req.fixing_date))
        if verdict == "unchecked":
            raise HTTPException(status_code=422, detail="there is no stored spot for that date to check the value against; send override_band with a fuller reason to store it")
        if verdict != "ok":
            raise HTTPException(status_code=422, detail=f"value is more than {demo_market_data.FIXING_SPOT_BAND:.0%} from the stored spot of that date; send override_band with a fuller reason to store it")
    uid = uuid.UUID(user["sub"])
    try:
        store.put_correction(db, pair, req.fixing_date, source, value, deribit.DELIVERY_TIME, uid, reason)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="another correction of this fixing was stored at the same moment; read it and send again if needed")
    log.warning("shared fixing %s %s corrected by %s%s", pair, req.fixing_date, str(uid)[:8], " (band overridden)" if req.override_band else "")
    return fixings_view(db, user["sub"], pair, max(30, (date.today() - req.fixing_date).days + 1))


# ── pricing ────────────────────────────────────────────────────────────────

class CurrencyPriceRequest(BaseModel):
    pair: str = Field(..., examples=["EURUSD"])
    shape: str = Field("FORWARD", description="SPOT | FORWARD | NDF")
    base_notional: float = Field(..., gt=0)
    settlement_date: Optional[date] = Field(None, description="omitted for SPOT: T+2 (T+0 for a digital asset)")
    valuation_date: Optional[date] = None
    forward_rate: Optional[float] = Field(None, description="contract rate K; omitted = at the fair forward")
    direction: str = "BUY"
    spot: Optional[float] = Field(None, gt=0)
    base_rate_pct: Optional[float] = Field(None, description="digital asset only: funding override, % p.a.")


def _curve(db: Session, user_id: str, curve_id: str, val_date: date):
    from api.routes.pricer import _build_curve, CurveInput
    try:
        return _build_curve(CurveInput(curve_id=curve_id), val_date, db, user_id)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"{curve_id}: {e}")


def spot_date(val_date: date, crypto: bool, base: Optional[str] = None, quote: Optional[str] = None) -> date:
    """T+1 for a digital asset; T+2 for an FX pair, counted in business days of both currencies when
    they are given (a Tokyo holiday moves USDJPY spot), weekdays otherwise."""
    if crypto:
        return val_date + timedelta(days=1)
    if base and quote:
        from pricing.calendars import add_business_days, ccy_to_calendar
        cals = sorted({ccy_to_calendar(base), ccy_to_calendar(quote)})
        return add_business_days(val_date, 2, "+".join(cals))
    d, n = val_date, 0
    while n < 2:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return d


def _price(db: Session, user_id: str, pair: str, *, shape: str, base_notional: float, settlement: Optional[date],
           val_date: date, K: Optional[float], direction: str, spot_override: Optional[float],
           base_rate_pct: Optional[float]) -> dict:
    st = pair_state(db, user_id, pair, settlement=False)
    base, quote, crypto = st["base"], st["quote"], st["crypto"]
    shape = (shape or "FORWARD").upper()
    if shape not in ("SPOT", "FORWARD", "NDF"):
        raise HTTPException(status_code=422, detail="shape must be SPOT, FORWARD or NDF")
    settle = settlement or spot_date(val_date, crypto, base, quote)
    if shape == "SPOT":
        settle = spot_date(val_date, crypto, base, quote)
    if spot_override is not None:
        S, s_src = float(spot_override), "request"
    elif st["spot"] is not None:
        S, s_src = st["spot"], f"snapshot {st['spot_as_of']}"
    else:
        raise HTTPException(status_code=422, detail=f"No {pair} spot saved. Click SNAP SPOT or pass spot.")
    q_curve = _curve(db, user_id, st["quote_curve"], val_date)
    kw: dict[str, Any] = {}
    if crypto:
        if base_rate_pct is not None:
            kw["base_rate"], b_src = float(base_rate_pct) / 100, "request"
        elif st.get("funding_pct") is not None:
            kw["base_rate"], b_src = st["funding_pct"] / 100, f"snapshot {st['funding_as_of']}"
        else:
            kw["base_rate"], b_src = 0.0, "default 0%"
    elif st.get("base_curve_available"):
        try:
            kw["base_curve"], b_src = _curve(db, user_id, st["base_curve"], val_date), st["base_curve"]
        except HTTPException as e:          # a row exists but does not bootstrap: fall back, and say so
            log.warning("%s did not build (%s); flat fallback", st["base_curve"], e.detail)
            st["base_curve_available"] = False
    if not crypto and not st.get("base_curve_available"):
        flat = st.get("base_flat_pct")
        rate = flat if flat is not None else POLICY_RATE_PCT.get(base)
        if rate is None:
            raise HTTPException(status_code=422, detail=f"No {st['base_curve']} snapshot and no flat rate for {base}.")
        kw["base_rate"], b_src = float(rate) / 100, (st.get("base_fallback") or
                                                     (f"flat {flat}% ({base}_FLAT)" if flat is not None else f"flat {rate}% ({POLICY_RATE_NOTE})"))
    # a quoted FX spot settles on the spot date, and the forward carries from there; a digital
    # asset's spot settles at once (pricing/currency_forward.py)
    fx_spot = None if crypto else spot_date(val_date, False, base, quote)
    try:
        implied = price_currency_forward(base_currency=base, quote_currency=quote, base_notional=base_notional,
                                         forward_rate=K, spot=S, valuation_date=val_date, settlement_date=settle,
                                         quote_curve=q_curve, direction=direction, pip=st["pip"], spot_date=fx_spot, **kw)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    mode = forward_mode(db, user_id)          # digital assets too: futures / forward prices by expiry are a quoted curve
    if crypto and base_rate_pct is not None:
        mode = "IMPLIED"                      # a funding rate named on the ticket is the desk's own carry: it wins over quoted points
    fc = st.get("forward_points")
    r, basis_pts = implied, None
    f_src = (f"spot carried at the funding rate ({b_src})" if crypto else "implied from the two OIS curves (interest-rate parity)")
    mkt_pts = None
    if fc:
        days = (settle - (fx_spot or val_date)).days          # forward points are quoted from the spot date
        mkt_pts = interp_points(fc, days)
        f_mkt = S + mkt_pts * st["pip"]
        basis_pts = mkt_pts - implied.forward_points
        if mode == "MARKET" and shape != "SPOT" and f_mkt > 0:
            # the market forward implies the base-currency rate over spot -> settlement
            from pricing.currency_forward import implied_base_rate, year_fraction
            sd = fx_spot or val_date
            rate_b = implied_base_rate(f_mkt, S, implied.df_quote, float(q_curve.df(sd)), implied.t, year_fraction(val_date, sd))
            r = price_currency_forward(base_currency=base, quote_currency=quote, base_notional=base_notional,
                                       forward_rate=K, spot=S, valuation_date=val_date, settlement_date=settle,
                                       quote_curve=q_curve, direction=direction, pip=st["pip"], spot_date=fx_spot,
                                       base_rate=rate_b)
            f_src = f"market points ({pair}_FWD {st['forward_curve']['valuation_date']}, {marks_label(st['forward_curve']['source'])}), basis {basis_pts:+.1f} pts vs parity"
    out = r.__dict__.copy()
    out.update(pair=pair, shape=shape, valuation_date=val_date.isoformat(), settlement_date=settle.isoformat(),
               spot_source=s_src, base_discounting=b_src, quote_curve=st["quote_curve"],
               quote_curve_snapshot=str(getattr(q_curve, "snapshot_date", "") or ""),
               forward_mode=mode, forward_source=f_src, implied_forward=implied.forward, implied_points=implied.forward_points,
               market_points=mkt_pts, basis_points=basis_pts,
               model="F = S·DF_base/DF_quote (parity) or S + quoted points (market); NPV_quote = ±N_base·(F−K)·DF_quote; ACT/365")
    # the desk's taxonomy: on a digital asset IR01 is the discounting curve's sensitivity alone and the
    # funding rate's is FUND01; on a currency pair both legs are rate curves and IR01 is their sum
    out["crypto"] = crypto
    out["fund01"] = out.get("ir01_base") if crypto else None
    if crypto and out.get("ir01_disc") is not None:
        out["ir01"] = out["ir01_disc"]
    return out


@router.post("/forward/price")
def price_forward(req: CurrencyPriceRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    pair = req.pair.upper()
    split_pair(pair)
    val_date = req.valuation_date or date.today()
    return _price(db, user["sub"], pair, shape=req.shape, base_notional=req.base_notional, settlement=req.settlement_date,
                  val_date=val_date, K=req.forward_rate, direction=req.direction, spot_override=req.spot,
                  base_rate_pct=req.base_rate_pct)


class CurrencyOptionRequest(BaseModel):
    pair: str = Field(..., examples=["EURUSD"])
    option_type: str = Field(..., description="CALL | PUT on the base currency")
    base_notional: float = Field(..., gt=0)
    expiry_date: date
    settlement_date: Optional[date] = Field(None, description="omitted: two business days after expiry")
    strike: Optional[float] = Field(None, gt=0, description="omitted = at the forward")
    direction: str = Field("BUY", description="BUY | SELL of the option")
    valuation_date: Optional[date] = None
    vol_pct: Optional[float] = Field(None, gt=0, description="override, vol points; omitted = the pair's surface")
    spot: Optional[float] = Field(None, gt=0)
    settlement_type: str = Field("DELIVERABLE", description="DELIVERABLE | NON_DELIVERABLE (cash in the quote currency)")
    # styles beyond the European vanilla (pricing/fx_exotic.py)
    style: str = Field("EUROPEAN", description="EUROPEAN | AMERICAN | DIGITAL | BARRIER | DOUBLE_BARRIER | TOUCH")
    payout: Optional[float] = Field(None, gt=0, description="DIGITAL / TOUCH: the amount paid")
    payout_currency: str = Field("QUOTE", description="QUOTE (cash-or-nothing) | BASE (a fixed base amount)")
    barrier_type: Optional[str] = Field(None, description="BARRIER: UP_IN | UP_OUT | DOWN_IN | DOWN_OUT; DOUBLE_BARRIER: KNOCK_IN | KNOCK_OUT")
    barrier: Optional[float] = Field(None, gt=0)
    lower: Optional[float] = Field(None, gt=0)
    upper: Optional[float] = Field(None, gt=0)
    rebate: float = Field(0.0, ge=0, description="BARRIER: quote-currency amount per unit of base notional")
    touch_type: Optional[str] = Field(None, description="TOUCH: ONE_TOUCH | NO_TOUCH | DOUBLE_ONE_TOUCH | DOUBLE_NO_TOUCH")
    pay_at_hit: bool = False


def spec_from(fields: dict, option_type: str, strike: Optional[float]) -> ExoticSpec:
    """An ExoticSpec from request or trade.terms fields (style defaults to EUROPEAN)."""
    g = lambda k, d=None: fields.get(k, d) if fields.get(k) is not None else d
    return ExoticSpec(style=str(g("style", "EUROPEAN")).upper(), option_type=str(option_type or "CALL").upper(), strike=strike,
                      payout=float(g("payout")) if g("payout") is not None else None, payout_currency=str(g("payout_currency", "QUOTE")).upper(),
                      barrier_type=str(g("barrier_type")).upper() if g("barrier_type") else None,
                      barrier=float(g("barrier")) if g("barrier") is not None else None, lower=float(g("lower")) if g("lower") is not None else None,
                      upper=float(g("upper")) if g("upper") is not None else None, rebate=float(g("rebate", 0.0) or 0.0),
                      touch_type=str(g("touch_type")).upper() if g("touch_type") else None, pay_at_hit=bool(g("pay_at_hit", False)))


def _price_option(db: Session, user_id: str, pair: str, *, option_type: str, base_notional: float, expiry: date, settlement: Optional[date],
                  strike: Optional[float], direction: str, val_date: date, vol_pct: Optional[float], spot_override: Optional[float],
                  settlement_type: str = "DELIVERABLE", style_fields: Optional[dict] = None) -> dict:
    """An FX option on the pair's market: the forward to settlement from the forward engine (so the account's
    forward mode, quoted points or parity, applies), the vol from the pair's surface, Garman–Kohlhagen on top."""
    base, quote = split_pair(pair)
    crypto = is_crypto(base)                      # a digital asset: the same model, the funding rate as the base rate, cash-settled
    if crypto:
        settlement_type = "NON_DELIVERABLE"
    if expiry <= val_date:
        raise HTTPException(status_code=422, detail="expiry_date must be after the valuation date")
    settle = settlement or spot_date(expiry, crypto, base, quote)
    if settle < expiry:
        raise HTTPException(status_code=422, detail="settlement_date must be on or after the expiry date")
    fwd = _price(db, user_id, pair, shape="FORWARD", base_notional=base_notional, settlement=settle, val_date=val_date, K=None,
                 direction="BUY", spot_override=spot_override, base_rate_pct=None)
    F, S, df_q = float(fwd["forward"]), float(fwd["spot"]), float(fwd["df_quote"])
    T_e = (expiry - val_date).days / 365.0
    spec = spec_from(style_fields or {}, option_type, float(strike) if strike is not None else None)
    if spec.style in ("EUROPEAN", "AMERICAN", "BARRIER", "DOUBLE_BARRIER", "DIGITAL") and spec.strike is None:
        spec.strike = F
    K = spec.strike if spec.strike is not None else F
    vs = latest_snapshot(db, user_id, f"{pair}_VOL")
    vol, tier, vol_note = lookup_vol(vs.quotes if vs else None, pair, T_e, F, K, vol_pct)
    try:
        if spec.style == "EUROPEAN":
            r = price_fx_option(base_currency=base, quote_currency=quote, base_notional=base_notional, option_type=option_type, strike=K,
                                spot=S, forward=F, df_quote=df_q, valuation_date=val_date, expiry_date=expiry, settlement_date=settle, vol=vol,
                                direction=direction, spot_date=spot_date(val_date, crypto, base, quote))
            out = r.__dict__.copy()
            quoted = crypto and fwd["forward_mode"] == "MARKET" and fwd["market_points"] is not None
            out["method"] = ("Black-76 on the quoted forward (the basis in the points as the carry)" if quoted
                             else "Black-76 on the forward (the funding rate as the carry)" if crypto else "Garman–Kohlhagen")
        else:
            x = price_exotic(spec, base_notional=base_notional, spot=S, forward=F, df_quote=df_q, t_expiry=T_e, vol=vol, direction=direction)
            out = {"base_currency": base, "quote_currency": quote, "option_type": spec.option_type, "direction": str(direction).upper(),
                   "base_notional": float(base_notional), "strike": K, "spot": S, "forward": F, "vol": vol, "t_expiry": T_e,
                   "t_settle": (settle - val_date).days / 365.0, "df_quote": df_q, "npv": x.npv, "premium_unit": x.unit, "d1": None, "d2": None,
                   "forward_delta": None, "delta_base_units": x.delta_base_units, "spot01": x.spot01, "gamma_1pct": x.gamma_1pct, "vega": x.vega,
                   "ir01": x.ir01, "ir01_disc": x.ir01_disc, "ir01_base": x.ir01_base, "theta": x.theta, "intrinsic": None, "time_value": None,
                   "method": x.method, "r_quote": x.r_quote, "r_base": x.r_base}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    out.update(style=spec.style, payout=spec.payout, payout_currency=spec.payout_currency, barrier_type=spec.barrier_type, barrier=spec.barrier,
               lower=spec.lower, upper=spec.upper, rebate=spec.rebate, touch_type=spec.touch_type, pay_at_hit=spec.pay_at_hit)
    # the desk's taxonomy: on a digital asset IR01 is the discounting curve's sensitivity alone and the
    # funding rate's is FUND01; on a currency pair both curves are rates and IR01 is their sum
    out["fund01"] = out["ir01_base"] if crypto else None
    if crypto:
        out["ir01"] = out["ir01_disc"]
    out["crypto"] = crypto
    out.update(pair=pair, shape="OPTION", valuation_date=val_date.isoformat(), expiry_date=expiry.isoformat(), settlement_date=settle.isoformat(),
               settlement_type=str(settlement_type or "DELIVERABLE").upper(), vol_pct=round(vol * 100, 4), vol_tier=tier, vol_source=vol_note,
               vol_snapshot=vs.valuation_date.isoformat() if vs else None, vol_marks=marks_label(vs.source) if vs and tier != "OVERRIDE" and is_venue(vs.source) else None,
               spot_source=fwd["spot_source"], base_discounting=fwd["base_discounting"], quote_curve=fwd["quote_curve"],
               quote_curve_snapshot=fwd["quote_curve_snapshot"], forward_mode=fwd["forward_mode"], forward_source=fwd["forward_source"],
               implied_forward=fwd["implied_forward"], market_points=fwd["market_points"], basis_points=fwd["basis_points"],
               forward_points=fwd["forward_points"], df_base=fwd["df_base"], quote_rate=fwd["quote_rate"], base_rate=fwd["base_rate"],
               t=fwd["t"], quote_notional=base_notional * K,
               model=f"{out.get('method', 'Garman–Kohlhagen')} on the forward to settlement; σ from the pair's ATM/RR25/BF25 surface (Malz smile in delta); ACT/365")
    return out


def _booked_option_args(t: dict, trade: Trade) -> dict:
    """The option-pricing arguments of a booked FX_OPTION or CRYPTO_OPTION, from its canonical terms."""
    if str(trade.instrument_type or "").upper() == "CRYPTO_OPTION":
        return dict(pair=f"{str(t['digital_asset']).upper()}USD", option_type=str(t.get("option_type") or "CALL"),
                    base_notional=float(t.get("notional_amount") or trade.notional), expiry=date.fromisoformat(str(t["expiration_date"])),
                    settlement=date.fromisoformat(str(t.get("settlement_date") or trade.maturity_date)),
                    strike=float(t["strike_price"]) if t.get("strike_price") not in (None, "") else None, settlement_type="NON_DELIVERABLE")
    return dict(pair=str(t.get("currency_pair") or f"{t.get('base_currency', '')}{t.get('quote_currency', '')}").upper(),
                option_type=str(t.get("option_type") or "CALL"), base_notional=float(t.get("base_notional") or trade.notional),
                expiry=date.fromisoformat(str(t["expiry_date"])), settlement=date.fromisoformat(str(t.get("settlement_date") or trade.maturity_date)),
                strike=float(t["strike"]) if t.get("strike") not in (None, "") else None, settlement_type=str(t.get("settlement_type") or "DELIVERABLE"))


@router.post("/option/price")
def price_option(req: CurrencyOptionRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    pair = req.pair.upper(); split_pair(pair)
    val_date = req.valuation_date or date.today()
    return _price_option(db, user["sub"], pair, option_type=req.option_type, base_notional=req.base_notional, expiry=req.expiry_date,
                         settlement=req.settlement_date, strike=req.strike, direction=req.direction, val_date=val_date, vol_pct=req.vol_pct,
                         spot_override=req.spot, settlement_type=req.settlement_type,
                         style_fields={k: getattr(req, k) for k in ("style", "payout", "payout_currency", "barrier_type", "barrier", "lower", "upper",
                                                                    "rebate", "touch_type", "pay_at_hit")})


class OptionLadderRequest(CurrencyOptionRequest):
    spot_shocks_pct: list[float] = Field(default=[-10, -5, -2, -1, 0, 1, 2, 5, 10])
    vol_shocks_pts: list[float] = Field(default=[-2, -1, 0, 1, 2])


@router.post("/option/ladder")
def option_ladder(req: OptionLadderRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """NPV repriced on a grid of spot and vol shocks, for the ticket's scenario tab (every style, the same pricer)."""
    pair = req.pair.upper(); split_pair(pair)
    val_date = req.valuation_date or date.today()
    st = pair_state(db, user["sub"], pair)
    S0 = req.spot or st.get("spot")
    if not S0:
        raise HTTPException(status_code=422, detail=f"No {pair} spot saved. Click SNAP SPOT or pass spot.")
    fields = {k: getattr(req, k) for k in ("style", "payout", "payout_currency", "barrier_type", "barrier", "lower", "upper", "rebate", "touch_type", "pay_at_hit")}
    base = _price_option(db, user["sub"], pair, option_type=req.option_type, base_notional=req.base_notional, expiry=req.expiry_date,
                         settlement=req.settlement_date, strike=req.strike, direction=req.direction, val_date=val_date, vol_pct=req.vol_pct,
                         spot_override=S0, settlement_type=req.settlement_type, style_fields=fields)
    vol0 = base["vol_pct"]
    rows = []
    for sp in req.spot_shocks_pct[:15]:
        row = {"spot_pct": sp, "spot": S0 * (1 + sp / 100.0), "npv": {}}
        for vp in req.vol_shocks_pts[:7]:
            try:
                q = _price_option(db, user["sub"], pair, option_type=req.option_type, base_notional=req.base_notional, expiry=req.expiry_date,
                                  settlement=req.settlement_date, strike=base["strike"], direction=req.direction, val_date=val_date,
                                  vol_pct=max(vol0 + vp, 0.05), spot_override=S0 * (1 + sp / 100.0), settlement_type=req.settlement_type, style_fields=fields)
                row["npv"][f"{vp:g}"] = q["npv"]
            except HTTPException:
                row["npv"][f"{vp:g}"] = None
        rows.append(row)
    return {"pair": pair, "style": base["style"], "base_npv": base["npv"], "base_vol_pct": vol0, "spot": S0, "spot_shocks_pct": req.spot_shocks_pct[:15],
            "vol_shocks_pts": req.vol_shocks_pts[:7], "rows": rows, "spot01": base["spot01"], "vega": base["vega"]}


class FlatRateRequest(BaseModel):
    currency: str
    rate_pct: float = Field(..., description="flat continuous zero used when the currency has no OIS curve, % p.a.")


@router.post("/flat")
def set_flat(req: FlatRateRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _require_trader(user)
    ccy = req.currency.upper()
    if ccy not in CURVE_FOR:
        raise HTTPException(status_code=422, detail=f"currency must be one of {', '.join(CURVE_FOR)}")
    from sqlalchemy import text
    uid, cid, today = uuid.UUID(user["sub"]), f"{ccy}_FLAT", date.today()
    quotes = [{"tenor": "FLAT", "quote_type": "FLAT", "rate": float(req.rate_pct), "enabled": True}]
    db.execute(text("DELETE FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c AND valuation_date = :d"),
               {"u": uid, "c": cid, "d": today})
    db.execute(text("INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                    "VALUES (:c, :d, CAST(:q AS jsonb), 'MANUAL', :u, :u)"), {"c": cid, "d": today, "q": json.dumps(quotes), "u": uid})
    db.commit()
    return {"currency": ccy, "flat_pct": float(req.rate_pct)}


CURRENCY_INSTRUMENTS = ("FX_SPOT", "FX_FORWARD", "NDF", "CRYPTO_FORWARD", "FX_OPTION", "CRYPTO_OPTION")
OPTION_INSTRUMENTS = ("FX_OPTION", "CRYPTO_OPTION")


def price_booked(trade: Trade, db: Session, user: dict, val_date: date, states: bool = False) -> dict:
    """A booked currency trade, from trade.terms (the canonical record's fields).

    `states`: the caller reads `state` and wants a digital-asset trade's fixed or settled view from its fixing date
    on (_booked_fixed). Without it the answer is what it was before the settlement rule existed, 422 from a forward's
    settlement date and from an option's expiry included: a client that takes every 200 for a live quote (the web
    app before 0.14.0) must never be handed a view whose forward and discount factor are null."""
    t = dict(trade.terms or {})
    itype = str(trade.instrument_type or "").upper()
    from settlement import rule
    digital = itype in rule.INSTRUMENTS
    k = rule.terms_of(trade) if digital else None
    reached = k is not None and val_date >= k["fixing_date"]
    if reached and states:
        # the booked valuation, which applies the settlement rule (settlement/rule.py)
        from pnl.market import Market
        mkt = Market(db, user["sub"], val_date)
        fix = rule.settlement(db, user["sub"], trade, val_date, cache=getattr(mkt, "_cache", None))
        if fix is not None:
            return _booked_fixed(trade, db, user, val_date, mkt, fix)
    live = digital and not reached            # a live quote says so; an old-style answer past the fixing date says nothing
    if itype in OPTION_INSTRUMENTS:
        try:
            a = _booked_option_args(t, trade)
            out = _price_option(db, user["sub"], a.pop("pair"), direction=str(t.get("direction") or "BUY"), val_date=val_date, vol_pct=None,
                                spot_override=None, style_fields=t, **a)
        except (KeyError, TypeError, ValueError) as e:
            raise HTTPException(status_code=422, detail=f"trade.terms is missing or malformed: {e}")
        out.update(trade_id=str(trade.id), trade_ref=trade.trade_ref, instrument_type=itype, npv_ccy=out["quote_currency"], legs=[], shape="OPTION")
        if live:
            out["state"] = "LIVE"
        return out
    try:
        if itype == "CRYPTO_FORWARD":
            k = rule.parse(trade)             # the one reading of a digital asset's terms
            pair, notional, K, settle, shape = k["pair"], k["notional"], k["strike"], k["settle"], "NDF"
        else:
            pair = str(t.get("currency_pair") or f"{t.get('base_currency','')}{t.get('quote_currency','')}").upper()
            notional = float(t.get("base_notional") or trade.notional)
            K = float(t["forward_rate"]) if t.get("forward_rate") not in (None, "") else None
            settle = date.fromisoformat(str(t.get("value_date") or trade.maturity_date))
            shape = "SPOT" if itype == "FX_SPOT" else "NDF" if itype == "NDF" else "FORWARD"
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"trade.terms is missing or malformed: {e}")
    split_pair(pair)
    out = _price(db, user["sub"], pair, shape="FORWARD" if shape == "SPOT" else shape, base_notional=notional,
                 settlement=settle, val_date=val_date, K=K, direction=str(t.get("direction") or "BUY"),
                 spot_override=None, base_rate_pct=None)
    out.update(trade_id=str(trade.id), trade_ref=trade.trade_ref, instrument_type=itype, npv_ccy=out["quote_currency"],
               legs=[], shape=shape)
    if live:
        out["state"] = "LIVE"
    return out


# What a live quote carries and a fixed or settled view does not: there, each is null, so a reader that tests
# `state` never meets a missing key (and one that does not cannot mistake the view for a quote).
QUOTE_ONLY = ("forward", "df_quote", "df_base", "t", "t_settle", "t_expiry", "vol_pct", "spot01", "vega")


def _booked_fixed(trade: Trade, db: Session, user: dict, val_date: date, mkt, fix: dict) -> dict:
    """A digital-asset trade from its fixing date on: the booked valuation (pnl/valuation.py, which applies the
    settlement rule) as a response. `state` is FIXED while the settlement date is ahead (the amount, final or
    provisional, and its discounted value) and SETTLED from that date (the mark is zero, the amount is reported).
    Before the rule existed a forward answered 422 from its settlement date and an option from its expiry."""
    from pnl.valuation import _currency_terms, value
    from settlement import rule
    itype = str(trade.instrument_type or "").upper()
    try:
        pair, t = _currency_terms(trade)
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(status_code=422, detail=f"trade.terms is missing or malformed: {e}")
    base, quote = split_pair(pair)
    try:
        v = value(db, user, trade, val_date, mkt)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    option, settled = t["shape"] == "OPTION", bool(v.get("settled"))
    z = rule._z
    K = t["K"]
    out = {"state": "SETTLED" if settled else "FIXED", "trade_id": str(trade.id), "trade_ref": trade.trade_ref, "instrument_type": itype,
           "npv_ccy": quote, "legs": [], "pair": pair, "shape": "OPTION" if option else "NDF", "crypto": True, "base_currency": base,
           "quote_currency": quote, "direction": str(t["direction"]).upper(), "base_notional": float(t["notional"]),
           "quote_notional": float(t["notional"]) * K if K is not None else None,
           "valuation_date": val_date.isoformat(), "settlement_date": t["settle"].isoformat(), "settled": settled, "npv": z(v["npv"]),
           "fixing_date": fix["fixing_date"].isoformat(), "fixing_source": fix["source"] or None,
           **{f: v.get(f) for f in ("fixing", "settlement_amount", "settlement_price", "provisional", "provisional_reason", "provisional_basis")},
           "ir01": z(v.get("ir01") or 0.0), "ir01_disc": z(v.get("ir01_disc") or 0.0), "fund01": z(v.get("fund01") or 0.0), "theta": z(v.get("theta") or 0.0),
           "model": v.get("model") or ("settled: the mark is zero from the settlement date; the amount is reported beside it" if settled else None),
           **{f: None for f in QUOTE_ONLY}}
    if "settlement_amount_if_touched" in v:             # only while the knock state of a barrier or touch is not recorded
        out["settlement_amount_if_touched"] = v["settlement_amount_if_touched"]
    if option:
        try:
            spec = spec_from(t.get("style_fields") or {}, t["option_type"], K)
        except (TypeError, ValueError) as e:
            raise HTTPException(status_code=422, detail=f"trade.terms is missing or malformed: {e}")
        # the term sheet's fields, as a live quote carries them (null where the style has none)
        out.update(option_type=t["option_type"], strike=K, expiry_date=t["expiry"].isoformat(), settlement_type="NON_DELIVERABLE", style=spec.style,
                   payout=spec.payout, payout_currency=spec.payout_currency, barrier_type=spec.barrier_type, barrier=spec.barrier, lower=spec.lower,
                   upper=spec.upper, rebate=spec.rebate, touch_type=spec.touch_type, pay_at_hit=spec.pay_at_hit)
    else:
        out["forward_rate"] = K
    return out
