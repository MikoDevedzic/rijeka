"""
demo_market_data.py — the hosted demo's market data, rebuilt daily from public sources.

POST /api/market-data/demo/tick          cron (X-Rijeka-Cron): fetch, build, write, copy
POST /api/market-data/demo/crypto/tick   cron: digital-asset spot, option vols and forwards (market_data/deribit.py)
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
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db.session import get_db
from market_data import demo_feed, deribit
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

# A demo account takes the template's row for the day. Its own entries stand: a row it typed or imported
# is never replaced, except a fetched spot (source IMPORT), which is the same public price a few minutes older.
PUSH_SQL = """
    INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, created_by, user_id)
    SELECT s.curve_id, s.valuation_date, s.quotes, s.source, u.user_id, u.user_id
    FROM market_data_snapshots s
    CROSS JOIN (SELECT DISTINCT user_id FROM legal_entities WHERE lei LIKE :p AND is_own_entity AND user_id <> :t) u
    WHERE s.user_id = :t AND s.valuation_date = :d AND s.curve_id = ANY(:ids)
    ON CONFLICT (user_id, curve_id, valuation_date) DO UPDATE
      SET quotes = EXCLUDED.quotes, source = EXCLUDED.source, created_at = NOW()
      WHERE market_data_snapshots.source LIKE 'DEMO%'
         OR (market_data_snapshots.source = 'IMPORT' AND right(market_data_snapshots.curve_id, 5) = '_SPOT')
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


def purge_marks(db: Session) -> int:
    """The source switched off (RIJEKA_DERIBIT=0): its rows go, on every account, and the parametric surfaces return."""
    n = db.execute(text("DELETE FROM market_data_snapshots WHERE source LIKE :m"), {"m": MARKS_LIKE}).rowcount or 0
    if n:
        log.warning("deribit is switched off: %d rows removed", n)
    return n


def refresh_crypto(db: Session, dry_run: bool = False, now: Optional[datetime] = None) -> dict:
    """Digital-asset spot (Coinbase), option vols and forwards (Deribit) for the template and every demo account.
    An asset the venue did not answer for keeps the rows it has; nothing is written for it."""
    template = demo._template_user_id(db)
    if template is None:
        raise HTTPException(status_code=503, detail="no template user (RIJEKA_DEMO_TEMPLATE_EMAIL)")
    now = now or datetime.now(timezone.utc)
    today = date.today()
    got = deribit.collect(now)
    summary: dict = {"as_of": now.isoformat(timespec="seconds"), "assets": {}, "failed": got["failed"], "dry_run": dry_run}
    ids: list[str] = []
    for asset, b in got["ok"].items():
        pair = deribit.pair(asset)
        summary["assets"][asset] = {"marks_at": b["asof"].isoformat(timespec="seconds"), "index": b["index"], "expiries": len(b["expiries"]),
                                    "dropped": b["dropped"], "last_expiry": b["last_expiry"]}
        if dry_run:
            summary["assets"][asset].update(vol=b["vol"], forward=b["forward"], by_expiry=b["expiries"])
            continue
        _upsert_snapshot(db, template, f"{pair}_VOL", today, b["vol"], deribit.source("option marks", b))
        _upsert_snapshot(db, template, f"{pair}_FWD", today, b["forward"], deribit.source("forwards", b))
        ids += [f"{pair}_VOL", f"{pair}_FWD"]
    if dry_run:
        return summary
    db.commit()
    try:        # the spot the points sit on, taken in the same minute
        from .crypto import fetch_spot
        from .currencies import _save_pairs
        spots = {deribit.pair(a): px for a, px in fetch_spot(deribit.ASSETS).items()}
        _save_pairs(db, template, spots)
        ids += [f"{p}_SPOT" for p in spots]
        summary["spot"] = spots
    except Exception as e:      # noqa: BLE001 — the half-hourly spot tick stands
        db.rollback()
        log.warning("crypto spot not refreshed with the marks: %s", e)
        summary["spot"] = None
    if ids:
        res = db.execute(text(PUSH_SQL), {"p": demo.DEMO_LEI_PREFIX + "%", "t": template, "d": today, "ids": ids})
        summary["pushed_rows"] = res.rowcount or 0
        db.commit()
    log.info("crypto marks: %s", {a: v["marks_at"] for a, v in summary["assets"].items()} or summary["failed"])
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
    elif not dry_run:
        purge_marks(db)
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
    return {"enabled": enabled(), "sources": demo_feed.SOURCES + venue, "latest": latest,
            "assumptions": {"USD_OIS_MINUS_UST_bp": demo_feed.USD_OIS_MINUS_UST,
                            "EUR_OIS_MINUS_AAA_bp": demo_feed.EUR_OIS_MINUS_AAA,
                            "GBP_OIS_MINUS_GILT_bp": demo_feed.GBP_OIS_MINUS_GILT}}
