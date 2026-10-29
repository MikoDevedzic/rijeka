"""Risk-factor history from public sources, stored as the template user's market snapshots.

The daily demo rebuild writes today's curves and spots to the template account; the
backfill writes the same shapes for past dates, so one table holds the whole series and
tomorrow's tick simply appends. Per curve, the risk factors are the quote tenors (par
rates in percent); per pair, the spot. Changes are taken between consecutive stored
dates: absolute basis points for rates, log returns for spots."""
from __future__ import annotations

import csv
import io
import json
import logging
import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from market_data import demo_feed as feed

log = logging.getLogger("rijeka.risk")

NYFED_SOFR_RANGE = "https://markets.newyorkfed.org/api/rates/secured/sofr/search.json?startDate={a}&endDate={b}"
ECB_ESTR_RANGE = "https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?startPeriod={a}&endPeriod={b}&format=csvdata"
ECB_AAA_RANGE = "https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.{keys}?startPeriod={a}&endPeriod={b}&format=csvdata"
FX_RANGE = "https://api.frankfurter.dev/v1/{a}..{b}?base=USD&symbols=EUR,GBP,JPY,CHF,AUD,CAD"
COINBASE_CANDLES = "https://api.exchange.coinbase.com/products/{asset}-USD/candles?granularity=86400&start={a}T00:00:00Z&end={b}T00:00:00Z"
CRYPTO = ("BTC", "ETH", "SOL")
RATE_CURVES = ("USD_SOFR", "EUR_ESTR", "GBP_SONIA")
SOURCE = "DEMO · history backfill (public sources)"


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

def ust_history(start: date, end: date) -> dict[date, dict[float, float]]:
    """Every daily par curve in the Treasury monthly XML files covering [start, end]."""
    out: dict[date, dict[float, float]] = {}
    d = start.replace(day=1)
    while d <= end:
        try:
            xml = _get(feed.UST_XML_URL.format(yyyymm=d.strftime("%Y%m")))
            for e in re.findall(r"<m:properties>(.*?)</m:properties>", xml, re.S):
                m = re.search(r"<d:NEW_DATE[^>]*>([0-9]{4}-[0-9]{2}-[0-9]{2})", e)
                if not m:
                    continue
                dd = date.fromisoformat(m.group(1))
                pts = {}
                for field, yrs in feed._UST_FIELDS.items():
                    v = re.search(rf"<d:{field}[^>]*>([-0-9.]+)<", e)
                    if v:
                        pts[yrs] = float(v.group(1))
                if len(pts) >= 8 and start <= dd <= end:
                    out[dd] = pts
        except Exception as e:          # noqa: BLE001 — a missing month is a gap, not a failure
            log.warning("UST %s: %s", d.strftime("%Y-%m"), e)
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return out


def sofr_history(start: date, end: date) -> dict[date, float]:
    body = _get(NYFED_SOFR_RANGE.format(a=start.isoformat(), b=end.isoformat()))
    return {date.fromisoformat(r["effectiveDate"]): float(r["percentRate"]) for r in json.loads(body).get("refRates", [])}


def estr_history(start: date, end: date) -> dict[date, float]:
    rows = feed._ecb_csv_last(_get(ECB_ESTR_RANGE.format(a=start.isoformat(), b=end.isoformat())))
    return {d: v for _, d, v in rows}


def ecb_aaa_history(start: date, end: date) -> dict[date, dict[float, float]]:
    rows = feed._ecb_csv_last(_get(ECB_AAA_RANGE.format(keys="+".join(feed._ECB_AAA_KEYS), a=start.isoformat(), b=end.isoformat())))
    out: dict[date, dict[float, float]] = {}
    for key, d, v in rows:
        m = re.search(r"PY_(\d+)([MY])$", key)
        if m:
            out.setdefault(d, {})[int(m.group(1)) / (12 if m.group(2) == "M" else 1)] = v
    return {d: pts for d, pts in out.items() if len(pts) >= 6}


def boe_history(start: date, end: date) -> dict[date, dict[str, float]]:
    text_ = _get(feed.BOE_IADB_URL.format(dfrom=start.strftime("%d/%b/%Y")), attempts=5)
    out: dict[date, dict[str, float]] = {}
    for r in csv.reader(io.StringIO(text_)):
        if len(r) >= 5 and re.match(r"\d{2} \w{3} \d{4}", r[0]):
            try:
                d = datetime.strptime(r[0], "%d %b %Y").date()
                vals = [float(x) for x in r[1:5]]
            except ValueError:
                continue
            if start <= d <= end:
                out[d] = {"SONIA": vals[0], "5Y": vals[1], "10Y": vals[2], "20Y": vals[3]}
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
                for t, lo, hi, op, cl, *_ in rows:
                    d = datetime.fromtimestamp(int(t), tz=timezone.utc).date()
                    out.setdefault(d, {})[f"{asset}USD"] = float(cl)
            except Exception as e:      # noqa: BLE001
                log.warning("coinbase %s %s..%s: %s", asset, a, b, e)
            a = b + timedelta(days=1)
    return out


# ── build and store ──────────────────────────────────────────────────────────

def build_days(start: date, end: date) -> dict[str, dict[date, list[dict]]]:
    """{curve_id: {date: quotes}} for every history day we can build from the sources."""
    out: dict[str, dict[date, list[dict]]] = {c: {} for c in RATE_CURVES}
    ust, sofr = ust_history(start, end), sofr_history(start, end)
    for d, par in ust.items():
        s = sofr.get(d) or sofr.get(d - timedelta(days=1)) or sofr.get(d - timedelta(days=3))
        if s is not None:
            out["USD_SOFR"][d] = feed.build_usd_sofr(s, par)
    try:
        aaa, estr = ecb_aaa_history(start, end), estr_history(start, end)
        for d, par in aaa.items():
            e = estr.get(d) or estr.get(d - timedelta(days=1)) or estr.get(d - timedelta(days=3))
            if e is not None:
                out["EUR_ESTR"][d] = feed.build_eur_estr(e, par)
    except Exception as e:              # noqa: BLE001
        log.warning("ECB history: %s", e)
    try:
        for d, row in boe_history(start, end).items():
            out["GBP_SONIA"][d] = feed.build_gbp_sonia(row)
    except Exception as e:              # noqa: BLE001
        log.warning("BoE history: %s", e)
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


def store(db: Session, user_id, days: dict[str, dict[date, list[dict]]], overwrite: bool = False) -> dict[str, int]:
    """Upsert as the template user's snapshots. Existing rows (the daily rebuild's) win unless overwrite."""
    n: dict[str, int] = {}
    for cid, by_date in days.items():
        for d, quotes in by_date.items():
            res = db.execute(text(
                "INSERT INTO market_data_snapshots (curve_id, valuation_date, quotes, source, user_id, created_by) "
                "VALUES (:c, :d, CAST(:q AS jsonb), :s, :u, :u) ON CONFLICT (user_id, curve_id, valuation_date) "
                + ("DO UPDATE SET quotes = EXCLUDED.quotes, source = EXCLUDED.source" if overwrite else "DO NOTHING")),
                {"c": cid, "d": d, "q": json.dumps(quotes), "s": SOURCE, "u": str(user_id)})
            n[cid] = n.get(cid, 0) + (res.rowcount or 0)
    db.commit()
    return n


def backfill(db: Session, user_id, years: float = 2.0, end: Optional[date] = None, overwrite: bool = False) -> dict[str, Any]:
    end = end or date.today()
    start = end - timedelta(days=int(365 * years))
    days = build_days(start, end)
    written = store(db, user_id, days, overwrite=overwrite)
    return {"start": start.isoformat(), "end": end.isoformat(), "built": {c: len(v) for c, v in days.items()}, "written": written}


# ── reading the series ───────────────────────────────────────────────────────

def series(db: Session, user_id, curve_id: str, start: date, end: date) -> list[tuple[date, dict[str, float]]]:
    rows = db.execute(text("SELECT valuation_date, quotes FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c "
                           "AND valuation_date BETWEEN :a AND :b ORDER BY valuation_date"), {"u": str(user_id), "c": curve_id, "a": start, "b": end}).all()
    out = []
    for r in rows:
        q = {x["tenor"]: float(x["rate"]) for x in (r.quotes or []) if x.get("rate") is not None and x.get("enabled", True)}
        if q:
            out.append((r.valuation_date, q))
    return out


def changes(ser: list[tuple[date, dict[str, float]]], kind: str) -> list[tuple[date, dict[str, float]]]:
    """Consecutive-observation changes: bp for rates, log return in percent for spots."""
    out = []
    for (d0, q0), (d1, q1) in zip(ser, ser[1:]):
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
                           "WHERE user_id = :u AND (curve_id = ANY(:ids) OR curve_id LIKE '%\\_SPOT') GROUP BY curve_id ORDER BY curve_id"),
                      {"u": str(user_id), "ids": list(RATE_CURVES)}).all()
    return {r.curve_id: {"observations": int(r.n), "from": r.a.isoformat(), "to": r.b.isoformat()} for r in rows}


# ── fetch here, store there ──────────────────────────────────────────────────
# Some public sites refuse a cloud provider's address (the Bank of England does), so the
# history can be built on another machine (a GitHub runner, a desk) and posted to the API:
#   python -m risk.history --curves GBP_SONIA --years 2 --post https://api --secret ...

def main(argv: Optional[list[str]] = None) -> int:
    import argparse
    import httpx
    ap = argparse.ArgumentParser(description="Build risk-factor history from public sources and post it to a Rijeka API.")
    ap.add_argument("--curves", default="GBP_SONIA", help="comma-separated curve ids to build (rates: USD_SOFR, EUR_ESTR, GBP_SONIA; SPOTS for FX and crypto)")
    ap.add_argument("--years", type=float, default=2.0)
    ap.add_argument("--post", help="API base URL; without it the counts are printed only")
    ap.add_argument("--secret", help="cron secret for X-Rijeka-Cron")
    ap.add_argument("--overwrite", action="store_true")
    a = ap.parse_args(argv)
    end = date.today(); start = end - timedelta(days=int(365 * a.years))
    want = {c.strip().upper() for c in a.curves.split(",") if c.strip()}
    days: dict[str, dict[date, list[dict]]] = {}
    if "USD_SOFR" in want:
        ust, sofr = ust_history(start, end), sofr_history(start, end)
        days["USD_SOFR"] = {d: feed.build_usd_sofr(s_, par) for d, par in ust.items()
                            if (s_ := sofr.get(d) or sofr.get(d - timedelta(days=1)) or sofr.get(d - timedelta(days=3))) is not None}
    if "EUR_ESTR" in want:
        aaa, estr = ecb_aaa_history(start, end), estr_history(start, end)
        days["EUR_ESTR"] = {d: feed.build_eur_estr(e, par) for d, par in aaa.items()
                            if (e := estr.get(d) or estr.get(d - timedelta(days=1)) or estr.get(d - timedelta(days=3))) is not None}
    if "GBP_SONIA" in want:
        days["GBP_SONIA"] = {d: feed.build_gbp_sonia(row) for d, row in boe_history(start, end).items()}
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
