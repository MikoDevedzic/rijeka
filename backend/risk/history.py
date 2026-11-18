"""Risk-factor history, stored as the template user's market snapshots.

The daily demo rebuild writes today's curves and spots to the template account; the
backfill writes the same shapes for past dates, so one table holds the whole series and
tomorrow's tick simply appends. Per curve, the risk factors are the quote tenors (par
rates in percent); per pair, the spot; per vol surface, every quote (tenor and type). Changes are
taken between consecutive stored dates: absolute basis points for rates (hundredths of a point for
vols, the same convention), log returns for spots.

Rates are the synthetic market's own history since 0.55.0 (market_data/synthetic_rates.py): the curve of every
business day from the generator that makes today's, so a history and today's curve cannot disagree. Until then
the rates history was built from published fixings and government yields; those rows are replaced when the
backfill runs. Spots are read from public sources as before."""
from __future__ import annotations

import json
import logging
import math
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from market_data import demo_feed as feed
from market_data import synthetic_rates

log = logging.getLogger("rijeka.risk")

FX_RANGE = "https://api.frankfurter.dev/v1/{a}..{b}?base=USD&symbols=EUR,GBP,JPY,CHF,AUD,CAD"
COINBASE_CANDLES = "https://api.exchange.coinbase.com/products/{asset}-USD/candles?granularity=86400&start={a}T00:00:00Z&end={b}T00:00:00Z"
CRYPTO = ("BTC", "ETH", "SOL")
RATE_CURVES = feed.RATE_CURVES
SOURCE = "DEMO · history backfill (public sources for spots)"
RATES_SOURCE = synthetic_rates.SOURCE
MARKET_LIKE = "DEMO · Deribit%"          # deribit.SOURCE_PREFIX: observed marks, not built history


def _get(url: str, attempts: int = 3) -> str:
    """The public sites are flaky from a cloud address (the BoE in particular): retry with a pause."""
    import time
    last: Optional[Exception] = None
    for i in range(attempts):
        try:
            body = feed._get(url)
            if body and body.strip():
                return body
            last = ValueError("empty body")
        except Exception as e:          # noqa: BLE001
            last = e
        time.sleep(2.0 * (i + 1))
    raise RuntimeError(f"{url[:80]}: {last}")


# ── fetchers over a date range ───────────────────────────────────────────────

def rates_history(start: date, end: date, curves=RATE_CURVES) -> dict[str, dict[date, list[dict]]]:
    """{curve_id: {date: quotes}} for every business day from start to end, from the synthetic generator: the same
    pillars the daily rebuild writes (demo_feed.build_rates_curve), carried along the days in one pass."""
    years = [1.0 / 365.0 if t == "ON" else feed.tenor_years(t) for t in feed.OIS_TENORS]
    out: dict[str, dict[date, list[dict]]] = {}
    for c in curves:
        out[c] = {d: [feed._q(t, r, "OISDeposit" if t == "ON" else "OIS") for t, r in zip(feed.OIS_TENORS, row)]
                  for d, row in synthetic_rates.history(c, years, start, end)}
    return out


def fx_history(start: date, end: date) -> dict[date, dict[str, float]]:
    """{date: {EURUSD: 1.08, USDJPY: 150.2, ...}} in the pairs the desk quotes."""
    body = json.loads(_get(FX_RANGE.format(a=start.isoformat(), b=end.isoformat())))
    out: dict[date, dict[str, float]] = {}
    for ds, rates in (body.get("rates") or {}).items():
        d = date.fromisoformat(ds)
        pairs = {}
        for ccy, v in rates.items():
            if ccy in ("EUR", "GBP", "AUD"):
                pairs[f"{ccy}USD"] = 1.0 / float(v)
            else:
                pairs[f"USD{ccy}"] = float(v)
        out[d] = pairs
    return out


def crypto_history(start: date, end: date) -> dict[date, dict[str, float]]:
    out: dict[date, dict[str, float]] = {}
    for asset in CRYPTO:
        a = start
        while a <= end:
            b = min(end, a + timedelta(days=290))
            try:
                rows = json.loads(_get(COINBASE_CANDLES.format(asset=asset, a=a.isoformat(), b=b.isoformat())))
                for t, _lo, _hi, _op, cl, *_ in rows:
                    d = datetime.fromtimestamp(int(t), tz=timezone.utc).date()
                    out.setdefault(d, {})[f"{asset}USD"] = float(cl)
            except Exception as e:      # noqa: BLE001
                log.warning("coinbase %s %s..%s: %s", asset, a, b, e)
            a = b + timedelta(days=1)
    return out


# ── build and store ──────────────────────────────────────────────────────────

def build_days(start: date, end: date) -> dict[str, dict[date, list[dict]]]:
    """{curve_id: {date: quotes}} for every history day: the rates curves from the generator, the spots from the
    public sources (a source that fails leaves a gap, not an error)."""
    out: dict[str, dict[date, list[dict]]] = rates_history(start, end)
    spots: dict[date, dict[str, float]] = {}
    for src in (fx_history, crypto_history):
        try:
            for d, pairs in src(start, end).items():
                spots.setdefault(d, {}).update(pairs)
        except Exception as e:          # noqa: BLE001
            log.warning("spot history %s: %s", src.__name__, e)
    for d, pairs in spots.items():
        for pair, px in pairs.items():
            out.setdefault(f"{pair}_SPOT", {})[d] = [{"tenor": "SPOT", "quote_type": "SPOT", "rate": px, "enabled": True}]
    return out


def own_rates_rows(db: Session, user_id) -> dict[str, int]:
    """{rates curve: rows} this account holds of its own: entered by hand, imported, or snapped from a feed (anything
    whose source is not the demo's). A desk that has its own curve keeps all of it unless its admin asks otherwise:
    the synthetic history is never mixed into it (the independent reviewer, 18 November 2026: a self-hosted desk's
    imported curves would have been replaced by a press of BACKFILL)."""
    rows = db.execute(text("SELECT curve_id, count(*) FROM market_data_snapshots WHERE user_id = :u AND curve_id = ANY(:ids) "
                           "AND source NOT LIKE 'DEMO%' GROUP BY curve_id"), {"u": str(user_id), "ids": list(RATE_CURVES)}).all()
    return {r[0]: int(r[1]) for r in rows}


def own_rates_curves(db: Session, user_id) -> set[str]:
    return set(own_rates_rows(db, user_id))


def stored_rates_days(db: Session, user_id) -> dict[str, list[date]]:
    """{rates curve: every date a row is stored for}. The backfill remakes each of them, also a day before its
    window and a weekend's (which carries Friday's curve): a row the old feed wrote is not left standing."""
    rows = db.execute(text("SELECT curve_id, valuation_date FROM market_data_snapshots WHERE user_id = :u AND curve_id = ANY(:ids)"),
                      {"u": str(user_id), "ids": list(RATE_CURVES)}).all()
    out: dict[str, list[date]] = {}
    for r in rows:
        out.setdefault(r[0], []).append(r[1])
    return out


def store(db: Session, user_id, days: dict[str, dict[date, list[dict]]], overwrite: bool = False, source: str = SOURCE,
          only_over_demo: bool = False) -> dict[str, int]:
    """Upsert as the template user's snapshots. Existing rows (the daily rebuild's) win unless overwrite; a row
    read from a venue (market_data/deribit.py) is never replaced by a built one. `only_over_demo`: with overwrite,
    replace a row only if the demo wrote it (its source begins DEMO), never a desk's own."""
    n: dict[str, int] = {}
    for cid, by_date in days.items():
        for d, quotes in by_date.items():
            res = db.execute(text(
                "INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                "VALUES (:c, :d, CAST(:q AS jsonb), :s, :u, :u) ON CONFLICT (user_id, curve_id, valuation_date) "
                + ("DO UPDATE SET quotes = EXCLUDED.quotes, source = EXCLUDED.source WHERE market_data_snapshots.source NOT LIKE :keep"
                   + (" AND market_data_snapshots.source LIKE 'DEMO%'" if only_over_demo else "")
                   if overwrite else "DO NOTHING")),
                {"c": cid, "d": d, "q": json.dumps(quotes), "s": source, "u": str(user_id), **({"keep": MARKET_LIKE} if overwrite else {})})
            n[cid] = n.get(cid, 0) + (res.rowcount or 0)
    db.commit()
    return n


def backfill(db: Session, user_id, years: float = 2.0, end: Optional[date] = None, overwrite: bool = False,
             replace_own: bool = False) -> dict[str, Any]:
    """Rates: every business day of the window, and every other day a row is already stored for, made again by the
    generator (the same numbers on a second run). Only over rows the demo wrote, and not at all for a curve the desk
    holds rows of its own for, unless `replace_own`: then the desk's own rows of the rates curves are replaced too
    (an admin's explicit choice, on the hosted template whose owner once entered curves by hand). Spots: fetched;
    a spot's existing days are kept unless `overwrite`."""
    end = end or date.today()
    start = end - timedelta(days=int(365 * years))
    days = build_days(start, end)
    own = own_rates_rows(db, user_id)
    stored = stored_rates_days(db, user_id)
    rates: dict[str, dict[date, list[dict]]] = {}
    for c in RATE_CURVES:
        if c in own and not replace_own:
            continue
        by_day = dict(days.get(c) or {})
        for d in stored.get(c, []):
            if d not in by_day and d <= end:
                by_day[d] = feed.build_rates_curve(c, d)
        rates[c] = by_day
    written = store(db, user_id, rates, overwrite=True, source=RATES_SOURCE, only_over_demo=not replace_own)
    written.update(store(db, user_id, {c: v for c, v in days.items() if c not in RATE_CURVES}, overwrite=overwrite))
    # the vol surfaces follow from the stored series (risk/vols.py); synthetic either way, so always rewritten
    from risk import vols
    vdays = vols.history_days(db, user_id, start, end)
    written.update(store(db, user_id, vdays, overwrite=True, source=vols.SOURCE))
    days.update(vdays)
    return {"start": start.isoformat(), "end": end.isoformat(), "built": {c: len(v) for c, v in days.items()}, "written": written,
            "kept_own": {c: n for c, n in sorted(own.items()) if not replace_own},
            "replaced_own": {c: n for c, n in sorted(own.items()) if replace_own}}


# ── reading the series ───────────────────────────────────────────────────────

def factor_key(q: dict, by_type: bool) -> str:
    """A quote's factor name: its tenor, or 'tenor|type' on a surface that quotes several rows per tenor."""
    return f"{q.get('tenor')}|{q.get('quote_type') or ''}" if by_type else str(q.get("tenor"))


def series(db: Session, user_id, curve_id: str, start: date, end: date, by_type: Optional[bool] = None) -> list[tuple[date, dict[str, float]]]:
    """by_type: key the quotes by tenor and quote type (a vol surface); default: by the curve's kind."""
    from pnl.market import is_vol_surface
    bt = is_vol_surface(curve_id) if by_type is None else by_type
    rows = db.execute(text("SELECT valuation_date, quotes FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c "
                           "AND valuation_date BETWEEN :a AND :b ORDER BY valuation_date"), {"u": str(user_id), "c": curve_id, "a": start, "b": end}).all()
    out = []
    for r in rows:
        q = {factor_key(x, bt): float(x["rate"]) for x in (r.quotes or []) if x.get("rate") is not None and x.get("enabled", True)}
        if q:
            out.append((r.valuation_date, q))
    return out


def changes(ser: list[tuple[date, dict[str, float]]], kind: str) -> list[tuple[date, dict[str, float]]]:
    """Consecutive-observation changes: bp for rates, log return in percent for spots."""
    out = []
    for (_d0, q0), (d1, q1) in zip(ser, ser[1:]):
        ch = {}
        for t, v1 in q1.items():
            v0 = q0.get(t)
            if v0 is None:
                continue
            ch[t] = (v1 - v0) * 100.0 if kind == "rate" else (math.log(v1 / v0) * 100.0 if v0 > 0 and v1 > 0 else 0.0)
        if ch:
            out.append((d1, ch))
    return out


def status(db: Session, user_id) -> dict[str, Any]:
    rows = db.execute(text("SELECT curve_id, count(*) n, min(valuation_date) a, max(valuation_date) b FROM market_data_snapshots "
                           "WHERE user_id = :u AND (curve_id = ANY(:ids) OR curve_id LIKE '%\\_SPOT' OR curve_id LIKE '%\\_VOL' "
                           "OR curve_id LIKE '%\\_SWVOL\\_ATM') GROUP BY curve_id ORDER BY curve_id"),
                      {"u": str(user_id), "ids": list(RATE_CURVES)}).all()
    own = own_rates_rows(db, user_id)
    # `own`: for a rates curve, how many of its rows are the desk's own and not the demo's (a backfill keeps them)
    return {r.curve_id: {"observations": int(r.n), "from": r.a.isoformat(), "to": r.b.isoformat(),
                         **({"own": own.get(r.curve_id, 0)} if r.curve_id in RATE_CURVES else {})} for r in rows}


# ── fetch here, store there ───────────────────────────────────────────────────────
# A public site can refuse a cloud provider's address, so the spots' history can be built on another machine (a
# GitHub runner, a desk) and posted to the API. Rates need no fetching: the API makes them (rates_history).
#   python -m risk.history --curves SPOTS --years 2 --post https://api --secret ...

def main(argv: Optional[list[str]] = None) -> int:
    import argparse
    import httpx
    ap = argparse.ArgumentParser(description="Build risk-factor history and post it to a Rijeka API.")
    ap.add_argument("--curves", default="SPOTS", help="comma-separated: SPOTS for FX and crypto (fetched), or a rates curve id (made by the generator; the API makes these itself)")
    ap.add_argument("--years", type=float, default=2.0)
    ap.add_argument("--post", help="API base URL; without it the counts are printed only")
    ap.add_argument("--secret", help="cron secret for X-Rijeka-Cron")
    ap.add_argument("--overwrite", action="store_true")
    a = ap.parse_args(argv)
    end = date.today(); start = end - timedelta(days=int(365 * a.years))
    want = {c.strip().upper() for c in a.curves.split(",") if c.strip()}
    days: dict[str, dict[date, list[dict]]] = {}
    days.update(rates_history(start, end, [c for c in RATE_CURVES if c in want]))
    if "SPOTS" in want:
        for src in (fx_history, crypto_history):
            for d, pairs in src(start, end).items():
                for pair, px in pairs.items():
                    days.setdefault(f"{pair}_SPOT", {})[d] = [{"tenor": "SPOT", "quote_type": "SPOT", "rate": px, "enabled": True}]
    print({c: len(v) for c, v in days.items()})
    if not a.post:
        return 0
    payload = {c: {d.isoformat(): q for d, q in v.items()} for c, v in days.items()}
    r = httpx.post(f"{a.post.rstrip('/')}/api/risk/history/ingest", params={"overwrite": str(a.overwrite).lower()},
                   headers={"X-Rijeka-Cron": a.secret or ""}, json=payload, timeout=300)
    print(r.status_code, r.text[:400])
    return 0 if r.status_code == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
