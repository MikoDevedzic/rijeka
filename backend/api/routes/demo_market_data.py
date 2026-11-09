"""
demo_market_data.py — the hosted demo's market data, rebuilt daily from public sources.

POST /api/market-data/demo/tick          cron (X-Rijeka-Cron): fetch, build, write, copy
POST /api/market-data/demo/crypto/tick   cron: digital-asset spot, option vols and forwards (market_data/deribit.py)
POST /api/market-data/demo/fixings/tick  cron: the venue's daily delivery prices into the fixings store (?count=N backfills)
GET  /api/market-data/demo/sources       public: what the demo prices on, and how fresh

The tick writes the template user's rows (the account every new sign-up is
copied from, see demo.py) and then runs the same copy for every existing demo
account, so visitors already provisioned pick up today's date too. Sources
are stamped `DEMO · …`, which keeps them out of nothing: the pulse and the
provisioning copy only exclude terminal data.

`?dry_run=1` builds everything and writes nothing: the response shows what
would be saved. RIJEKA_DEMO_MARKET_DATA=0 turns the tick off on a self-hosted
instance that runs on its own marks.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, time as clock, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db.session import get_db
from market_data import demo_feed, deribit
from settlement import store as fixing_store
from . import demo
from .news import _secret_ok

log = logging.getLogger("rijeka.demo_market_data")
router = APIRouter(prefix="/api/market-data/demo", tags=["market-data"])

SABR_F_PROXY = 0.035     # as in save_vol_skew: β=0 normal SABR shape does not depend on the level


def enabled() -> bool:
    return os.getenv("RIJEKA_DEMO_MARKET_DATA", "1").strip().lower() not in ("0", "false", "no", "off")


# ── Writers ────────────────────────────────────────────────────────────────────

def _upsert_snapshot(db: Session, uid, curve_id: str, valuation_date: date, quotes: list[dict], source: str) -> None:
    db.execute(text("""
        INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, created_by, user_id)
        VALUES (:c, :d, cast(:q as jsonb), :s, :u, :u)
        ON CONFLICT (user_id, curve_id, valuation_date)
        DO UPDATE SET quotes = EXCLUDED.quotes, source = EXCLUDED.source, created_at = NOW(), created_by = EXCLUDED.created_by
    """), {"c": curve_id, "d": valuation_date, "q": json.dumps(quotes), "s": source, "u": uid})


def _upsert_skew(db: Session, uid, valuation_date: date, cells: list[dict]) -> tuple[int, int]:
    """Skew cells plus a β=0 normal SABR fit per cell, exactly as the manual editor does."""
    from pricing.sabr import calibrate_sabr
    saved = fitted = 0
    for c in cells:
        db.execute(text("""
            INSERT INTO swaption_vol_skew
              (valuation_date, expiry_label, tenor_label, expiry_y, tenor_y, atm_vol_bp,
               spread_m200, spread_m100, spread_m50, spread_m25, spread_p25, spread_p50, spread_p100, spread_p200,
               source, created_by, user_id)
            VALUES (:d, :el, :tl, :ey, :ty, :atm, :m200, :m100, :m50, :m25, :p25, :p50, :p100, :p200, :s, :u, :u)
            ON CONFLICT (user_id, valuation_date, expiry_label, tenor_label)
            DO UPDATE SET expiry_y = EXCLUDED.expiry_y, tenor_y = EXCLUDED.tenor_y, atm_vol_bp = EXCLUDED.atm_vol_bp,
              spread_m200 = EXCLUDED.spread_m200, spread_m100 = EXCLUDED.spread_m100, spread_m50 = EXCLUDED.spread_m50,
              spread_m25 = EXCLUDED.spread_m25, spread_p25 = EXCLUDED.spread_p25, spread_p50 = EXCLUDED.spread_p50,
              spread_p100 = EXCLUDED.spread_p100, spread_p200 = EXCLUDED.spread_p200,
              source = EXCLUDED.source, created_at = NOW(), created_by = EXCLUDED.created_by
        """), {"d": valuation_date, "el": c["expiry_label"], "tl": c["tenor_label"], "ey": c["expiry_y"], "ty": c["tenor_y"],
               "atm": c["atm_vol_bp"], "m200": c["spread_m200"], "m100": c["spread_m100"], "m50": c["spread_m50"],
               "m25": c["spread_m25"], "p25": c["spread_p25"], "p50": c["spread_p50"], "p100": c["spread_p100"],
               "p200": c["spread_p200"], "s": c["source"], "u": uid})
        saved += 1
        strike_vols = {off: c["atm_vol_bp"] + c[f"spread_{'m' if off < 0 else 'p'}{abs(off)}"] for off in demo_feed.SKEW_OFFSETS}
        try:
            alpha, rho, nu, rmse = calibrate_sabr(F=SABR_F_PROXY, T=c["expiry_y"], atm_vol=c["atm_vol_bp"] / 10000.0,
                                                  strike_vols=strike_vols)
        except Exception as e:      # noqa: BLE001 — a cell that will not fit is left for the one-click refit
            log.warning("SABR fit failed for %sx%s: %s", c["expiry_label"], c["tenor_label"], e)
            continue
        db.execute(text("""
            INSERT INTO sabr_params (valuation_date, expiry_label, tenor_label, expiry_y, tenor_y, alpha, rho, nu, beta,
                                     atm_vol_bp, fit_rmse_bp, source, created_by, user_id)
            VALUES (:d, :el, :tl, :ey, :ty, :a, :r, :n, 0.0, :atm, :rmse, 'AUTO', :u, :u)
            ON CONFLICT (user_id, valuation_date, expiry_y, tenor_y)
            DO UPDATE SET alpha = EXCLUDED.alpha, rho = EXCLUDED.rho, nu = EXCLUDED.nu, atm_vol_bp = EXCLUDED.atm_vol_bp,
              fit_rmse_bp = EXCLUDED.fit_rmse_bp, source = 'AUTO', created_at = NOW(), created_by = EXCLUDED.created_by
        """), {"d": valuation_date, "el": c["expiry_label"], "tl": c["tenor_label"], "ey": c["expiry_y"], "ty": c["tenor_y"],
               "a": float(alpha), "r": float(rho), "n": float(nu), "atm": c["atm_vol_bp"], "rmse": float(rmse), "u": uid})
        fitted += 1
    return saved, fitted


def _upsert_caps(db: Session, uid, rows: list[dict]) -> int:
    for r in rows:
        db.execute(text("""
            INSERT INTO cap_vol_surface (valuation_date, cap_tenor_y, strike_spread_bp, is_atm, flat_vol_bp, strike_pct, ticker, source, user_id)
            VALUES (:d, :t, :s, :atm, :v, :k, :tk, :src, :u)
            ON CONFLICT (user_id, valuation_date, cap_tenor_y, strike_spread_bp)
            DO UPDATE SET is_atm = EXCLUDED.is_atm, flat_vol_bp = EXCLUDED.flat_vol_bp, strike_pct = EXCLUDED.strike_pct,
              ticker = EXCLUDED.ticker, source = EXCLUDED.source
        """), {"d": r["valuation_date"], "t": r["cap_tenor_y"], "s": r["strike_spread_bp"], "atm": r["is_atm"],
               "v": r["flat_vol_bp"], "k": r["strike_pct"], "tk": r["ticker"], "src": r["source"], "u": uid})
    return len(rows)


def _demo_user_ids(db: Session, template) -> list:
    rows = db.execute(text(
        "SELECT DISTINCT user_id FROM legal_entities WHERE lei LIKE :p AND is_own_entity AND user_id <> :t"),
        {"p": demo.DEMO_LEI_PREFIX + "%", "t": template}).all()
    return [r[0] for r in rows]


# ── Digital assets: the venue's marks, several times an hour ───────────────────

MARKS_LIKE = deribit.SOURCE_PREFIX + "%"

# Which stored rows the marks tick may replace: one a feed wrote (DEMO …), or a spot labelled IMPORT, which is a fetched
# public price. A row an account typed (MANUAL) or took from a terminal is not replaced by this tick, the template's
# included. (The older writers have their own, older rules: the daily rebuild rewrites the template's row of the day for
# every curve it builds, and the spot ticks the template's spot of the day; docs/architecture.md says which does what.)
FEED_ROW = "{t}.source LIKE 'DEMO%' OR ({t}.source = 'IMPORT' AND right({t}.curve_id, 5) = '_SPOT')"
# An account's own entry stays in force until the account replaces it: when the latest row it holds for a curve,
# whatever its date, is one it entered itself, the feed writes nothing for that curve (as before the feed existed).
OWN_ENTRY_STANDS = ("COALESCE((SELECT " + FEED_ROW.format(t="o") + " FROM market_data_snapshots o "
                    "WHERE o.user_id = {u} AND o.curve_id = {c} ORDER BY o.valuation_date DESC LIMIT 1), true)")
SPOT_TOLERANCE = (0.05, 0.25)      # the venue's index against a spot fetched now, and against the last one stored

# A demo account takes the template's row for the day, and only a row a feed wrote for the template: what the
# template's owner entered by hand or from a licensed source is not pushed by this statement.
PUSH_SQL = """
    INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, created_by, user_id)
    SELECT s.curve_id, s.valuation_date, s.quotes, s.source, u.user_id, u.user_id
    FROM market_data_snapshots s
    CROSS JOIN (SELECT DISTINCT user_id FROM legal_entities WHERE lei LIKE :p AND is_own_entity AND user_id <> :t) u
    WHERE s.user_id = :t AND s.valuation_date = :d AND s.curve_id = ANY(:ids)
      AND (""" + FEED_ROW.format(t="s") + """)
      AND """ + OWN_ENTRY_STANDS.format(u="u.user_id", c="s.curve_id") + """
    ON CONFLICT (user_id, curve_id, valuation_date) DO UPDATE
      SET quotes = EXCLUDED.quotes, source = EXCLUDED.source, created_at = NOW()
      WHERE (""" + FEED_ROW.format(t="market_data_snapshots") + """)
        AND (market_data_snapshots.quotes, market_data_snapshots.source) IS DISTINCT FROM (EXCLUDED.quotes, EXCLUDED.source)
"""

MARKS_UPSERT_SQL = """
    INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, created_by, user_id)
    SELECT CAST(:c AS text), CAST(:d AS date), cast(:q as jsonb), CAST(:s AS text), CAST(:u AS uuid), CAST(:u AS uuid)
    WHERE """ + OWN_ENTRY_STANDS.format(u="CAST(:u AS uuid)", c="CAST(:c AS text)") + """
    ON CONFLICT (user_id, curve_id, valuation_date) DO UPDATE
      SET quotes = EXCLUDED.quotes, source = EXCLUDED.source, created_at = NOW(), created_by = EXCLUDED.created_by
      WHERE market_data_snapshots.source LIKE 'DEMO%'
"""


def kept_marks(db: Session, uid) -> dict[str, dict]:
    """{curve_id: {quotes, source}}: the template's latest vol surface from the venue per pair. The daily rebuild
    writes these instead of the parametric surface, so a day the venue did not answer carries the last good
    marks, with their own time still in the source."""
    if not deribit.enabled():
        return {}
    rows = db.execute(text("""
        SELECT DISTINCT ON (curve_id) curve_id, quotes, source FROM market_data_snapshots
        WHERE user_id = :u AND source LIKE :m AND right(curve_id, 4) = '_VOL'
        ORDER BY curve_id, valuation_date DESC"""), {"u": uid, "m": MARKS_LIKE}).all()
    return {r.curve_id: {"quotes": r.quotes, "source": r.source} for r in rows}


def purge_allowed() -> bool:
    """Whether this process may delete the venue's rows when the source is off. Local development shares the hosted
    database, so a flag in a developer's shell must not be able to. The process that runs the batches may: the
    scheduler is on (on Render by default, on a self-hosted instance by RIJEKA_SCHEDULER=1), or RIJEKA_DERIBIT_PURGE=1
    says so for an instance driven by an outside cron."""
    import scheduler
    return scheduler.enabled() or os.getenv("RIJEKA_DERIBIT_PURGE", "").strip().lower() in ("1", "true", "yes", "on")


def purge_marks(db: Session, template) -> int:
    """The source switched off (RIJEKA_DERIBIT=0): its rows go from the template and the demo accounts, and the
    parametric surfaces and the flat funding rate return. A row in any other account is that account's own."""
    n = db.execute(text("""
        DELETE FROM market_data_snapshots WHERE source LIKE :m AND (user_id = :t OR user_id IN (
            SELECT user_id FROM legal_entities WHERE lei LIKE :p AND is_own_entity))"""),
        {"m": MARKS_LIKE, "t": template, "p": demo.DEMO_LEI_PREFIX + "%"}).rowcount or 0
    if n:
        log.warning("deribit is switched off: %d rows removed", n)
    return n


def last_marks_at(db: Session) -> Optional[datetime]:
    """The oldest, across the three assets, of the times of the marks behind the template's current surfaces: what
    the health check watches. It reads the time the venue's marks carried (kept in the source when a surface is
    carried forward), not when a row was last written, and only the template's rows, so neither the daily rebuild
    nor a row in someone's own account can make a silent venue look alive. None when an asset has no surface."""
    template = demo._template_user_id(db)
    if template is None:
        return None
    rows = db.execute(text("""
        SELECT DISTINCT ON (curve_id) curve_id, source FROM market_data_snapshots
        WHERE user_id = :u AND curve_id = ANY(:ids) ORDER BY curve_id, valuation_date DESC"""),
        {"u": template, "ids": [f"{deribit.pair(a)}_VOL" for a in deribit.ASSETS]}).all()
    times = [deribit.marks_time(r.source) for r in rows]
    return min(times) if len(times) == len(deribit.ASSETS) and all(times) else None


def _reference_spots(db: Session, template) -> tuple[dict[str, float], dict[str, float]]:
    """(fetched now, last stored) digital-asset spots by pair: what the venue's index is checked against."""
    from .crypto import _quote, fetch_spot, latest_snapshot
    try:
        fresh = {deribit.pair(a): float(px) for a, px in fetch_spot(deribit.ASSETS).items()}
    except Exception as e:      # noqa: BLE001 — the half-hourly spot tick stands
        log.warning("crypto spot not fetched with the marks: %s", type(e).__name__)
        fresh = {}
    stored = {}
    for a in deribit.ASSETS:
        px = _quote(latest_snapshot(db, template, f"{deribit.pair(a)}_SPOT"), "SPOT")
        if px:
            stored[deribit.pair(a)] = float(px)
    return fresh, stored


def refresh_crypto(db: Session, dry_run: bool = False, now: Optional[datetime] = None) -> dict:
    """Digital-asset spot (Coinbase), option vols and forwards (Deribit) for the template and every demo account.
    An asset the venue did not answer for, or whose index disagrees with the spot, keeps the rows it has."""
    now = now or datetime.now(timezone.utc)
    got = deribit.collect(now)                  # the network first: no database transaction is open while it waits
    template = demo._template_user_id(db)
    if template is None:
        raise HTTPException(status_code=503, detail="no template user (RIJEKA_DEMO_TEMPLATE_EMAIL)")
    today = date.today()
    fresh, stored = _reference_spots(db, template)
    summary: dict = {"as_of": now.isoformat(timespec="seconds"), "assets": {}, "failed": dict(got["failed"]), "dry_run": dry_run}
    ids: list[str] = []
    for asset, b in got["ok"].items():
        pair = deribit.pair(asset)
        ref, tol = (fresh[pair], SPOT_TOLERANCE[0]) if pair in fresh else (stored.get(pair), SPOT_TOLERANCE[1])
        if ref and abs(b["index"] / ref - 1.0) > tol:
            summary["failed"][asset] = f"index {abs(b['index'] / ref - 1.0):.0%} from the spot"
            continue
        summary["assets"][asset] = {"marks_at": b["asof"].isoformat(timespec="seconds"), "index": b["index"], "expiries": len(b["expiries"]),
                                    "dropped": len(b["dropped"]), "last_expiry": b["last_expiry"]}
        if dry_run:
            summary["assets"][asset].update(vol=b["vol"], forward=b["forward"], by_expiry=b["expiries"], dropped=b["dropped"])
            continue
        try:
            with db.begin_nested():             # one asset's rows together, and one asset's failure its own
                for cid, quotes, kind in ((f"{pair}_VOL", b["vol"], "option marks"), (f"{pair}_FWD", b["forward"], "forwards")):
                    db.execute(text(MARKS_UPSERT_SQL), {"c": cid, "d": today, "q": json.dumps(quotes, allow_nan=False),
                                                         "s": deribit.source(kind, b), "u": template})
            ids += [f"{pair}_VOL", f"{pair}_FWD"]
        except Exception as e:      # noqa: BLE001 — the asset keeps the rows it has
            log.warning("crypto marks for %s not stored: %s: %s", asset, type(e).__name__, str(e)[:300])
            summary["assets"].pop(asset, None)
            summary["failed"][asset] = f"not stored ({type(e).__name__})"
    if dry_run:
        return summary
    db.commit()
    summary["spot"] = fresh or None
    if fresh:                   # the spot the points sit on, taken in the same minute
        from .currencies import _save_pairs
        try:
            _save_pairs(db, template, fresh)
            ids += [f"{p}_SPOT" for p in fresh]
        except Exception as e:      # noqa: BLE001
            db.rollback()
            log.warning("crypto spot not stored with the marks: %s", type(e).__name__)
            summary["spot"] = None
    if ids:
        res = db.execute(text(PUSH_SQL), {"p": demo.DEMO_LEI_PREFIX + "%", "t": template, "d": today, "ids": ids})
        summary["pushed_rows"] = res.rowcount or 0
        db.commit()
    log.info("crypto marks: %s", {a: v["marks_at"] for a, v in summary["assets"].items()} or summary["failed"])
    return summary


# ── Digital assets: the venue's daily delivery prices, into the fixings store ──

FIXING_HOUR_UTC = deribit.PUBLISH_HOUR     # the venue publishes a day's delivery price at 08:00 UTC
FIXING_KEYS = [(deribit.pair(a), deribit.delivery_source(a)) for a in deribit.ASSETS]
FIXING_LOOKBACK = 10            # the tick fills holes among the last ten expected dates
FIXING_HEALTH_DAYS = 7          # health is red while any of the seven dates before the latest expected one is missing
FIXING_SPOT_BAND = 0.15         # a delivery price stands within 15 % of the template's stored spot of the same date
FIXING_FRESH_HOURS = 6          # a date missing for less than this is asked for on every pass
FIXING_RETRY_HOURS = 3          # after that, in the first half hour of every third hour (UTC)


def expected_fixing_date(now: Optional[datetime] = None) -> date:
    """The latest date the venue has published a delivery price for (market_data/deribit.py: today from 08:10 UTC)."""
    return deribit.expected_delivery_date(now)


def fixings_missing(db: Session, now: Optional[datetime] = None, days: int = FIXING_LOOKBACK) -> dict[str, list[date]]:
    """{asset: the dates among the last `days` expected ones that have no live shared fixing, oldest first}."""
    last = expected_fixing_date(now)
    wanted = [last - timedelta(days=i) for i in range(days)]
    have = fixing_store.shared_dates(db, FIXING_KEYS, wanted[-1])
    return {a: sorted(d for d in wanted if d not in have[(deribit.pair(a), deribit.delivery_source(a))]) for a in deribit.ASSETS}


def fixings_to_ask(missing: dict[str, list[date]], now: datetime, count: int = 3, force: bool = False, days: int = FIXING_LOOKBACK) -> dict[str, int]:
    """{asset: how many of the venue's latest days to ask for}: only the assets with a date missing, each deep
    enough to reach its oldest missing date. An asset whose newest date has been missing for longer than
    FIXING_FRESH_HOURS (the venue did not publish, or its price failed the checks), or that has only older holes,
    is asked in the first half hour of every FIXING_RETRY_HOURS-th hour instead of on every pass; an empty store
    is asked at once. `force` asks every asset, now, at least `count` deep (a backfill)."""
    last = expected_fixing_date(now)
    published = datetime.combine(last, clock(FIXING_HOUR_UTC), tzinfo=timezone.utc) + deribit.PUBLISH_MARGIN
    fresh = now - published <= timedelta(hours=FIXING_FRESH_HOURS)
    slot = now.hour % FIXING_RETRY_HOURS == 0 and now.minute < 30
    empty = all(len(m) >= days for m in missing.values())
    out: dict[str, int] = {}
    for asset, gone in missing.items():
        depth = min(max(int(count), (last - gone[0]).days + 2 if gone else 0), deribit.MAX_DELIVERY_ROWS)
        if force or (gone and (empty or slot or (fresh and gone[-1] == last))):
            out[asset] = depth
    return out


def template_spots(db: Session, pair: str, dates: list[date]) -> dict[date, float]:
    """{date: the template account's stored spot for that date}: the independent price a delivery price is checked
    against (a daily close where the history was backfilled, the last tick of the day where it was live). A date
    the template has no spot for takes the spot of the day before, else of the day after: one day the account did
    not snap must not leave a fixing unstored for good, and the band is wide enough for a day's move."""
    from .crypto import _quote
    template = demo._template_user_id(db)
    if template is None or not dates:
        return {}
    day = timedelta(days=1)
    near = sorted({d + k * day for d in dates for k in (-1, 0, 1)})
    rows = db.execute(text("""
        SELECT DISTINCT ON (valuation_date) valuation_date, quotes FROM market_data_snapshots
        WHERE user_id = :u AND curve_id = :c AND valuation_date = ANY(:d) ORDER BY valuation_date, created_at DESC"""),
        {"u": template, "c": f"{pair}_SPOT", "d": near}).all()
    have = {}
    for r in rows:
        px = _quote(r, "SPOT")
        if px and px > 0:
            have[r.valuation_date] = float(px)
    out = {}
    for d in dates:
        px = have.get(d) or have.get(d - day) or have.get(d + day)
        if px:
            out[d] = px
    return out


def spot_verdict(value: float, spot: Optional[float]) -> str:
    """"ok" within FIXING_SPOT_BAND of the independent spot, "refused" outside it, "unchecked" when there is none."""
    if spot is None:
        return "unchecked"
    return "ok" if abs(float(value) / spot - 1.0) <= FIXING_SPOT_BAND else "refused"


def last_fixing_at(db: Session, now: Optional[datetime] = None) -> Optional[datetime]:
    """What the health check watches: 08:00 UTC on the oldest, across the three assets, of the latest shared fixing
    dates. None (the check is red) when an asset has none, when any of the FIXING_HEALTH_DAYS dates before the
    latest expected one is missing for any asset (a hole after an outage is not silent), and while any stored date
    is disputed (the venue's re-read differs and no administrator has corrected it). The latest expected date
    itself is left to the check's own rule (within 36 hours), so the minutes between publication and the next pass
    are not an alarm. Shared rows only: an account's own entry cannot make a silent feed look alive."""
    if fixing_store.disputed(db, FIXING_KEYS):
        return None
    last = expected_fixing_date(now)
    need = [last - timedelta(days=i) for i in range(1, FIXING_HEALTH_DAYS + 1)]
    have = fixing_store.shared_dates(db, FIXING_KEYS, need[-1])
    if any(not have[k] or any(d not in have[k] for d in need) for k in FIXING_KEYS):
        return None
    return datetime.combine(min(max(have[k]) for k in FIXING_KEYS), clock(FIXING_HOUR_UTC), tzinfo=timezone.utc)


def refresh_fixings(db: Session, count: int = 3, dry_run: bool = False, now: Optional[datetime] = None, force: bool = False) -> dict:
    """The venue's delivery prices into the fixings store, for both drivers (the scheduler and the cron route).

    What is missing among the last FIXING_LOOKBACK expected dates decides what is asked (fixings_to_ask): nothing
    when every date is stored. A new date is stored only when its price is within FIXING_SPOT_BAND of the template's
    stored spot of that date; without a spot to check against it is not stored (`unchecked`), outside the band
    neither (`refused`). When a re-read of a stored date differs, nothing of that asset's batch is stored and the
    date is disputed (settlement/store.put_shared). An asset the venue did not answer for keeps what it has.
    The summary carries counts and dates, never the venue's text."""
    now = now or datetime.now(timezone.utc)
    missing = fixings_missing(db, now)
    ask = fixings_to_ask(missing, now, count=count, force=force)
    summary: dict = {"stored": True, "dry_run": dry_run, "current": not any(missing.values()), "asked": sorted(ask),
                     "waiting": sorted(a for a, gone in missing.items() if gone and a not in ask), "failed": {}, "assets": {}}
    if not ask:
        return summary
    db.rollback()                               # the reads above are closed: no database transaction is open while the network waits
    got = deribit.collect_delivery(count=ask, assets=tuple(a for a in deribit.ASSETS if a in ask), now=now)
    summary["failed"] = dict(got["failed"])
    totals = {k: 0 for k in ("written", "known", "differs", "unchecked", "refused", "held")}
    for asset, rows in got["ok"].items():
        try:
            spots = template_spots(db, deribit.pair(asset), [r["fixing_date"] for r in rows])
            verdicts = {r["fixing_date"]: spot_verdict(r["value"], spots.get(r["fixing_date"])) for r in rows}
            with db.begin_nested():             # one asset's rows together, and one asset's failure its own
                res = fixing_store.put_shared(db, rows, verdicts, write=not dry_run)
        except Exception as e:      # noqa: BLE001 — the asset keeps the rows it has
            log.warning("fixings for %s not stored: %s: %s", asset, type(e).__name__, str(e)[:300])
            summary["failed"][asset] = f"not stored ({type(e).__name__})"
            continue
        summary["assets"][asset] = {"read": len(rows), "latest": rows[-1]["fixing_date"].isoformat(), **res}
        if res["differs"]:
            summary["failed"][asset] = "a re-read differs from a stored fixing: nothing stored, the date is disputed"
        for k in totals:
            totals[k] += res[k]
    if not dry_run:
        db.commit()
    summary.update(totals)
    log.info("crypto fixings: %s", {a: (v["latest"], v["written"]) for a, v in summary["assets"].items()} or summary["failed"])
    return summary


def refresh(db: Session, valuation_date: Optional[date] = None, dry_run: bool = False) -> dict:
    """Fetch, build and (unless dry_run) write the demo market data. Returns a summary."""
    valuation_date = valuation_date or date.today()
    template = demo._template_user_id(db)
    if template is None:
        raise HTTPException(status_code=503, detail="no template user (RIJEKA_DEMO_TEMPLATE_EMAIL)")

    built = demo_feed.assemble(demo_feed.collect(valuation_date), valuation_date)
    if deribit.enabled():
        built["curves"].update(kept_marks(db, template))        # the venue's marks stand over the parametric surface
    elif not dry_run and purge_allowed():
        purge_marks(db, template)
    summary: dict = {
        "valuation_date": valuation_date.isoformat(),
        "curves": {cid: {"quotes": len(cv["quotes"]), "source": cv["source"]} for cid, cv in built["curves"].items()},
        "skew_cells": len(built["skew"]), "cap_rows": len(built["caps"]),
        "failed_sources": built["failed"], "dry_run": dry_run,
    }
    if dry_run:
        summary["preview"] = {cid: cv["quotes"][:6] for cid, cv in built["curves"].items()}
        return summary

    try:
        for cid, cv in built["curves"].items():
            _upsert_snapshot(db, template, cid, valuation_date, cv["quotes"], cv["source"])
        saved, fitted = _upsert_skew(db, template, valuation_date, built["skew"])
        caps = _upsert_caps(db, template, built["caps"])
        db.commit()
        # the vol surfaces' level follows the realised vol of the series just stored (risk/vols.py),
        # so the day's surface continues the history the VaR samples
        from risk import vols
        try:
            summary["vol_surfaces_scaled"] = sum(vols.refresh(db, template, valuation_date).values())
        except Exception as e:      # noqa: BLE001 — the parametric surfaces stand when the series cannot be read
            db.rollback()
            log.warning("vol surfaces not scaled for %s: %s", valuation_date, e)
            summary["vol_surfaces_scaled"] = 0
    except IntegrityError as e:
        db.rollback()
        if "source_check" in str(e.orig):
            # The source whitelist predates demo data: say so instead of a bare 500.
            raise HTTPException(status_code=409, detail=(
                "market data source whitelist rejects 'DEMO …' sources; apply "
                "docs/migrations/2026-10-29_demo_market_data_source.sql once and run the tick again"))
        raise

    copied_to = 0
    for uid in _demo_user_ids(db, template):
        try:
            demo._copy_market_data(db, template, uid)
            copied_to += 1
        except Exception as e:      # noqa: BLE001 — one visitor's copy must not block the rest
            log.warning("demo market data copy to %s failed: %s", str(uid)[:8], e)
            db.rollback()
    db.commit()
    summary.update(skew_saved=saved, sabr_fitted=fitted, caps_saved=caps, copied_to=copied_to)
    log.info("demo market data %s: %s", valuation_date, {k: v for k, v in summary.items() if k != "curves"})
    return summary


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/tick")
def tick(dry_run: bool = Query(default=False), db: Session = Depends(get_db),
         x_rijeka_cron: Optional[str] = Header(None)):
    if not _secret_ok(x_rijeka_cron):
        raise HTTPException(status_code=403, detail="bad cron secret")
    if not enabled():
        return {"enabled": False}
    return refresh(db, dry_run=dry_run)


@router.post("/crypto/tick")
def crypto_tick(dry_run: bool = Query(default=False), db: Session = Depends(get_db),
                x_rijeka_cron: Optional[str] = Header(None)):
    if not _secret_ok(x_rijeka_cron):
        raise HTTPException(status_code=403, detail="bad cron secret")
    if not enabled() or not deribit.enabled():
        return {"enabled": False}
    return refresh_crypto(db, dry_run=dry_run)


@router.post("/fixings/tick")
def fixings_tick(count: int = Query(default=3, ge=1, le=deribit.MAX_DELIVERY_ROWS), dry_run: bool = Query(default=False),
                 force: bool = Query(default=False), db: Session = Depends(get_db), x_rijeka_cron: Optional[str] = Header(None)):
    """The feed's tick. Asks the venue only for what is missing; `force=1` with `count=N` re-reads the last N days
    of every asset (a backfill beyond the ten days the tick looks after)."""
    if not _secret_ok(x_rijeka_cron):
        raise HTTPException(status_code=403, detail="bad cron secret")
    if not fixing_store.feed_enabled():
        return {"enabled": False}
    if not fixing_store.tables_present(db):           # a deploy ahead of the migration: nothing to store into, so nothing is asked
        return {"stored": False}
    return refresh_fixings(db, count=count, dry_run=dry_run, force=force)


@router.get("/sources")
def sources(db: Session = Depends(get_db)):
    """Public on purpose: the provenance of the demo's market data and the latest date per curve is part
    of the open-data story (the landing page says 'public sources'; this is the list). No account data."""
    template = demo._template_user_id(db)
    latest: dict[str, dict] = {}
    if template is not None:
        rows = db.execute(text("""
            SELECT DISTINCT ON (curve_id) curve_id, valuation_date, source FROM market_data_snapshots
            WHERE user_id = :u AND source LIKE 'DEMO%' ORDER BY curve_id, valuation_date DESC"""), {"u": template}).all()
        latest = {r.curve_id: {"valuation_date": r.valuation_date.isoformat(), "source": r.source} for r in rows}
    venue = [{"curve": f"{deribit.pair(a)}_{kind}", "provider": f"{deribit.PROVIDER} {what} (public API, unauthenticated)", "kind": "public", "url": deribit.URL}
             for a in deribit.ASSETS for kind, what in (("VOL", "option marks"), ("FWD", "forwards by expiry"))] if deribit.enabled() else []
    if fixing_store.feed_enabled() and fixing_store.tables_present(db):        # listed where the feed stores them, not before
        venue += [{"curve": f"{deribit.pair(a)}_FIXING", "provider": f"{deribit.delivery_source(a)}, daily at {deribit.DELIVERY_TIME} (public API, unauthenticated)",
                   "kind": "public", "url": deribit.DELIVERY_URL} for a in deribit.ASSETS]
    return {"enabled": enabled(), "sources": demo_feed.SOURCES + venue, "latest": latest,
            "assumptions": {"USD_OIS_MINUS_UST_bp": demo_feed.USD_OIS_MINUS_UST,
                            "EUR_OIS_MINUS_AAA_bp": demo_feed.EUR_OIS_MINUS_AAA,
                            "GBP_OIS_MINUS_GILT_bp": demo_feed.GBP_OIS_MINUS_GILT}}
