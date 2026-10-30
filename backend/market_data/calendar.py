"""The week ahead: scheduled releases and decisions a rates desk waits for, across USD, EUR,
GBP, CHF and JPY, with the last print and, once out, the actual.

Where a date comes from, honestly:
  central banks   the meeting calendars the policy path already uses (policy_path.MEETINGS)
  US CPI, payrolls the BLS schedule as published for 2026-27 (BLS refuses scripted fetches,
                   so the dates are data here, copied 2026-10-30)
  US GDP, PCE     the BEA schedule as published (same)
  Japan CPI       the Statistics Bureau schedule as published (same)
  UK              the ONS time-series API, which carries each series' next release date
  euro area, CH   Eurostat and the Swiss statistics office publish their calendars only as
                   dynamic pages, so those rows carry the usual slot and are flagged ESTIMATED
  UST auctions    TreasuryDirect's upcoming-auctions API
Actuals come from keyless public APIs: BLS (US), ONS (UK), Eurostat (euro area), the SNB data
portal (CH). Japan's e-Stat needs a key, so Japanese rows show the schedule only. There is no
consensus column: survey medians are a terminal product; the surprise shown is against the
previous print, and says so. Everything is cached in memory for an hour."""
from __future__ import annotations

import calendar as _cal
import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo

import httpx

from market_data.policy_path import MEETINGS

log = logging.getLogger("rijeka.calendar")
TIMEOUT = 12.0
CCYS = ("USD", "EUR", "GBP", "CHF", "JPY")
TZ = {"USD": "America/New_York", "EUR": "Europe/Luxembourg", "GBP": "Europe/London", "CHF": "Europe/Zurich", "JPY": "Asia/Tokyo"}
CB = {"USD": ("FOMC decision", "14:00", "Federal Reserve"), "EUR": ("ECB decision", "14:15", "European Central Bank"),
      "GBP": ("MPC decision", "12:00", "Bank of England"), "CHF": ("SNB decision", "09:30", "Swiss National Bank"),
      "JPY": ("BoJ decision", "12:00", "Bank of Japan")}

# ── schedules as published (copied 2026-10-30) ──────────────────────────────
US_CPI = {"2026-11-10": "2026-10", "2026-12-10": "2026-11", "2027-01-13": "2026-12", "2027-02-11": "2027-01", "2027-03-10": "2027-02",
          "2027-04-13": "2027-03", "2027-05-12": "2027-04", "2027-06-10": "2027-05", "2027-07-14": "2027-06", "2027-08-11": "2027-07",
          "2027-09-14": "2027-08", "2027-10-14": "2027-09", "2027-11-10": "2027-10", "2027-12-10": "2027-11"}
US_PAYROLLS = {"2026-11-06": "2026-10", "2026-12-04": "2026-11", "2027-01-08": "2026-12", "2027-02-05": "2027-01", "2027-03-05": "2027-02",
               "2027-04-02": "2027-03", "2027-05-07": "2027-04", "2027-06-04": "2027-05", "2027-07-02": "2027-06", "2027-08-06": "2027-07",
               "2027-09-03": "2027-08", "2027-10-08": "2027-09", "2027-11-05": "2027-10", "2027-12-03": "2027-11"}
US_BEA = [("2026-11-25", "GDP · Q3 second estimate", "2026-Q3", 2), ("2026-11-25", "PCE prices · October", "2026-10", 1),
          ("2026-12-23", "GDP · Q3 third estimate", "2026-Q3", 3), ("2026-12-23", "PCE prices · November", "2026-11", 1)]
JP_CPI = {"2026-11-20": "2026-10", "2026-12-18": "2026-11", "2027-01-22": "2026-12", "2027-02-19": "2027-01", "2027-03-19": "2027-02"}
JP_TOKYO = {"2026-10-30": "2026-10", "2026-11-27": "2026-11", "2026-12-25": "2026-12", "2027-01-29": "2027-01", "2027-02-26": "2027-02", "2027-03-26": "2027-03"}

SOURCES = {"bls": "https://www.bls.gov/schedule/", "bea": "https://www.bea.gov/news/schedule", "ons": "https://www.ons.gov.uk/releasecalendar",
           "estat": "https://www.stat.go.jp/english/data/cpi/1582.html", "eurostat": "https://ec.europa.eu/eurostat/news/euro-indicators/release-calendar",
           "sfso": "https://www.bfs.admin.ch/", "snb": "https://data.snb.ch/", "ust": "https://www.treasurydirect.gov/auctions/upcoming/"}


# ── small cache ──────────────────────────────────────────────────────────────
_CACHE: dict[str, tuple[float, Any]] = {}
TTL = 3600.0


def _cached(key: str, fn: Callable[[], Any]) -> Any:
    hit = _CACHE.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    try:
        val = fn()
    except Exception as e:                  # noqa: BLE001 — a source that is down leaves its column empty
        log.info("calendar: %s failed: %s", key, e)
        val = None
    _CACHE[key] = (time.time(), val)
    return val


# ── actuals ──────────────────────────────────────────────────────────────────
def _bls(series: list[str]) -> dict[str, list[tuple[str, float]]]:
    """BLS public API v1 (no key): {series: [(YYYY-MM, value), ...] newest first}."""
    y = date.today().year
    r = httpx.post("https://api.bls.gov/publicAPI/v1/timeseries/data/", json={"seriesid": series, "startyear": str(y - 2), "endyear": str(y)}, timeout=TIMEOUT)
    r.raise_for_status()
    out = {}
    for s in r.json().get("Results", {}).get("series", []):
        pts = [(f"{d['year']}-{d['period'][1:]}", float(d["value"])) for d in s.get("data", [])
               if d.get("period", "").startswith("M") and d["period"] != "M13" and str(d.get("value", "-")).replace(".", "", 1).replace("-", "", 1).isdigit()]
        out[s["seriesID"]] = sorted(pts, reverse=True)
    return out


def _ons(path: str) -> dict:
    r = httpx.get(f"https://www.ons.gov.uk/{path}/data", timeout=TIMEOUT, follow_redirects=True)
    r.raise_for_status()
    d = r.json()
    pts = []
    for m in d.get("months", []):
        try:
            pts.append((datetime.strptime(m["date"], "%Y %b").strftime("%Y-%m"), float(m["value"])))
        except Exception:               # noqa: BLE001
            continue
    nxt = (d.get("description") or {}).get("nextRelease")
    nd = None
    if nxt:
        try:
            nd = datetime.strptime(nxt, "%d %B %Y").date()
        except ValueError:
            nd = None
    return {"points": sorted(pts, reverse=True), "next": nd}


def _eurostat(dataset: str, params: str) -> list[tuple[str, float]]:
    r = httpx.get(f"https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{dataset}?{params}&lastTimePeriod=4", timeout=TIMEOUT)
    r.raise_for_status()
    d = r.json()
    labels = list(d["dimension"]["time"]["category"]["index"].keys())
    vals = d.get("value", {})
    return sorted([(labels[int(i)], float(v)) for i, v in vals.items()], reverse=True)


def _snb_cpi() -> list[tuple[str, float]]:
    r = httpx.get("https://data.snb.ch/api/cube/plkopr/data/json/en", timeout=TIMEOUT)
    r.raise_for_status()
    for ts in r.json().get("timeseries", []):
        if "National index" in " ".join(h.get("dimItem", "") for h in ts.get("header", [])):
            return sorted([(v["date"], float(v["value"])) for v in ts.get("values", []) if v.get("value") is not None], reverse=True)
    return []


def _ust_upcoming() -> list[dict]:
    r = httpx.get("https://www.treasurydirect.gov/TA_WS/securities/upcoming?format=json", timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def yoy(points: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Index levels newest first → annual % change newest first."""
    by = dict(points)
    out = []
    for p, v in points:
        y, m = p.split("-")
        prev = by.get(f"{int(y) - 1}-{m}")
        if prev:
            out.append((p, (v / prev - 1.0) * 100.0))
    return out


def diff(points: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Levels newest first → one-period change newest first (payrolls)."""
    return [(points[i][0], points[i][1] - points[i + 1][1]) for i in range(len(points) - 1)]


def _series() -> dict[str, list[tuple[str, float]]]:
    """Every actuals series the rows draw on, keyed by name; each newest first."""
    bls = _cached("bls", lambda: _bls(["CUUR0000SA0", "CES0000000001", "LNS14000000"])) or {}
    ons_cpi = _cached("ons_cpi", lambda: _ons("economy/inflationandpriceindices/timeseries/d7g7/mm23")) or {}
    ons_ur = _cached("ons_ur", lambda: _ons("employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms")) or {}
    # the euro area aggregate is EA21 since Bulgaria joined (2026); the EA code stopped updating
    # HICP moved to the 2025 base in 2026; the euro-indicators table (ei_cphi_m, annual rate RT12) is the one that keeps updating
    ea_hicp = _cached("ea_hicp", lambda: _eurostat("ei_cphi_m", "geo=EA21&unit=RT12&indic=TOTAL")) or []
    ea_ur = _cached("ea_ur", lambda: _eurostat("une_rt_m", "geo=EA21&age=TOTAL&sex=T&unit=PC_ACT&s_adj=SA")) or []
    ea_gdp = _cached("ea_gdp", lambda: _eurostat("namq_10_gdp", "geo=EA21&unit=CLV_PCH_PRE&s_adj=SCA&na_item=B1GQ")) or \
        _cached("ea_gdp_ea", lambda: _eurostat("namq_10_gdp", "geo=EA&unit=CLV_PCH_PRE&s_adj=SCA&na_item=B1GQ")) or []
    ch = _cached("snb_cpi", _snb_cpi) or []
    return {"US_CPI_YOY": yoy(bls.get("CUUR0000SA0", [])), "US_NFP": diff(bls.get("CES0000000001", [])), "US_UR": bls.get("LNS14000000", []),
            "UK_CPI_YOY": ons_cpi.get("points", []), "UK_UR": ons_ur.get("points", []), "EA_HICP_YOY": ea_hicp, "EA_UR": ea_ur, "EA_GDP_QOQ": ea_gdp, "CH_CPI_YOY": yoy(ch),
            "_ons_next": {"cpi": ons_cpi.get("next"), "labour": ons_ur.get("next")}}


# ── dates ────────────────────────────────────────────────────────────────────
def business_day(d: date, back: bool = True) -> date:
    while d.weekday() >= 5:
        d -= timedelta(days=1) if back else -timedelta(days=1)
    return d


def last_business_day(y: int, m: int) -> date:
    return business_day(date(y, m, _cal.monthrange(y, m)[1]))


def nth_business_day(y: int, m: int, n: int) -> date:
    d = date(y, m, 1); k = 0
    while True:
        if d.weekday() < 5:
            k += 1
            if k == n:
                return d
        d += timedelta(days=1)


def _ym(d: date, months: int = 0) -> tuple[int, int]:
    y, m = divmod(d.month - 1 + months, 12)
    return d.year + y, m + 1


def _when(d: date, hhmm: str, ccy: str) -> datetime:
    h, m = (int(x) for x in hhmm.split(":"))
    return datetime(d.year, d.month, d.day, h, m, tzinfo=ZoneInfo(TZ[ccy])).astimezone(timezone.utc)


def _row(d: date, hhmm: str, ccy: str, name: str, kind: str, tier: int, period: Optional[str] = None, series: Optional[str] = None,
         unit: str = "", estimated: bool = False, source: str = "", note: str = "") -> dict:
    return {"when": _when(d, hhmm, ccy).isoformat(), "date": d.isoformat(), "time_local": hhmm, "tz": TZ[ccy], "ccy": ccy, "name": name, "kind": kind,
            "tier": tier, "period": period, "series": series, "unit": unit, "estimated": estimated, "source": source, "note": note}


def scheduled(d0: date, d1: date, ons_next: Optional[dict] = None) -> list[dict]:
    """Every row whose date falls in [d0, d1], before actuals are attached."""
    rows: list[dict] = []
    for ccy, dates in MEETINGS.items():
        name, hhmm, src = CB[ccy]
        for s in dates:
            d = date.fromisoformat(s)
            if d0 <= d <= d1:
                rows.append(_row(d, hhmm, ccy, name, "CB", 1, source=src, note="rate decision" + (" · time varies" if ccy == "JPY" else "")))
    for s, per in US_CPI.items():
        d = date.fromisoformat(s)
        if d0 <= d <= d1:
            rows.append(_row(d, "08:30", "USD", "CPI", "DATA", 1, per, "US_CPI_YOY", "% y/y", source=SOURCES["bls"]))
    for s, per in US_PAYROLLS.items():
        d = date.fromisoformat(s)
        if d0 <= d <= d1:
            rows.append(_row(d, "08:30", "USD", "Non-farm payrolls", "DATA", 1, per, "US_NFP", "k", source=SOURCES["bls"]))
            rows.append(_row(d, "08:30", "USD", "Unemployment rate", "DATA", 2, per, "US_UR", "%", source=SOURCES["bls"]))
    for s, name, per, tier in US_BEA:
        d = date.fromisoformat(s)
        if d0 <= d <= d1:
            rows.append(_row(d, "08:30", "USD", name, "DATA", tier, per, None, "", source=SOURCES["bea"], note="actual: BEA API needs a key"))
    for s, per in JP_CPI.items():
        d = date.fromisoformat(s)
        if d0 <= d <= d1:
            rows.append(_row(d, "08:30", "JPY", "National CPI", "DATA", 1, per, None, "% y/y", source=SOURCES["estat"], note="actual: e-Stat needs a key"))
    for s, per in JP_TOKYO.items():
        d = date.fromisoformat(s)
        if d0 <= d <= d1:
            rows.append(_row(d, "08:30", "JPY", "Tokyo CPI", "DATA", 2, per, None, "% y/y", source=SOURCES["estat"], note="actual: e-Stat needs a key"))
    # UK: the ONS API carries the next release date of each series
    nx = ons_next or {}
    if nx.get("cpi") and d0 <= nx["cpi"] <= d1:
        y, m = _ym(nx["cpi"], -1)
        rows.append(_row(nx["cpi"], "07:00", "GBP", "CPI", "DATA", 1, f"{y}-{m:02d}", "UK_CPI_YOY", "% y/y", source=SOURCES["ons"]))
    if nx.get("labour") and d0 <= nx["labour"] <= d1:
        y, m = _ym(nx["labour"], -3)
        rows.append(_row(nx["labour"], "07:00", "GBP", "Labour market · unemployment rate", "DATA", 2, f"{y}-{m:02d}", "UK_UR", "%", source=SOURCES["ons"],
                         note="three-month rate to the reference month"))
    # euro area and Switzerland: the usual slot, flagged
    for months_back in range(0, 3):
        y, m = _ym(d0, months_back)
        for d, name, per, tier, ser, unit in (
                (last_business_day(y, m), "Flash HICP", f"{y}-{m:02d}", 1, "EA_HICP_YOY", "% y/y"),
                (last_business_day(y, m), "Unemployment rate", "{:04d}-{:02d}".format(*_ym(date(y, m, 1), -1)), 2, "EA_UR", "%"),
        ):
            if d0 <= d <= d1 and not any(r["ccy"] == "EUR" and r["name"] == name and r["date"] == d.isoformat() for r in rows):
                rows.append(_row(d, "11:00", "EUR", name, "DATA", tier, per, ser, unit, estimated=True, source=SOURCES["eurostat"],
                                 note="Eurostat's calendar is not machine-readable: this is the usual slot"))
        if m in (1, 4, 7, 10):
            q = (m - 1) // 3 or 4; qy = y if m != 1 else y - 1
            d = last_business_day(y, m)
            if d0 <= d <= d1:
                rows.append(_row(d, "11:00", "EUR", f"GDP · Q{q} flash", "DATA", 1, f"{qy}-Q{q}", "EA_GDP_QOQ", "% q/q", estimated=True, source=SOURCES["eurostat"],
                                 note="Eurostat's calendar is not machine-readable: this is the usual slot"))
        d = nth_business_day(y, m, 4)
        if d0 <= d <= d1:
            rows.append(_row(d, "08:30", "CHF", "CPI", "DATA", 1, "{:04d}-{:02d}".format(*_ym(date(y, m, 1), -1)), "CH_CPI_YOY", "% y/y", estimated=True,
                             source=SOURCES["sfso"], note="the statistics office publishes in the first week; this is the usual slot"))
    return rows


def auctions(d0: date, d1: date) -> list[dict]:
    """UST coupon auctions announced on TreasuryDirect, inside the window."""
    out = []
    for a in _cached("ust", _ust_upcoming) or []:
        if a.get("securityType") not in ("Note", "Bond"):
            continue
        s = (a.get("competitiveAuctionCloseDate") or a.get("auctionDate") or "")[:10]
        if not s:
            continue
        d = date.fromisoformat(s)
        if d0 <= d <= d1:
            amt = float(a.get("offeringAmount") or 0) / 1e9
            out.append(_row(d, "13:00", "USD", f"UST {a.get('securityTerm')} {a.get('securityType', '').lower()} auction", "AUCTION", 3, source=SOURCES["ust"],
                            note=f"${amt:.0f}bn{' · reopening' if a.get('reopening') == 'Yes' else ''}"))
    return out


def attach_actuals(rows: list[dict], series: dict[str, list[tuple[str, float]]]) -> None:
    """last = the latest print before the row's period (what the desk compares against); actual = the row's
    period when it has been published; surprise = actual − last."""
    for r in rows:
        key = r.get("series")
        pts = series.get(key) if key else None
        r["last"] = r["actual"] = r["surprise"] = None
        if not pts:
            continue
        per = r.get("period")
        before = [p for p in pts if per is None or p[0] < per]
        hit = next((p for p in pts if p[0] == per), None)
        if before:
            r["last"] = {"period": before[0][0], "value": round(before[0][1], 2)}
        if hit:
            r["actual"] = {"period": hit[0], "value": round(hit[1], 2)}
            if before:
                r["surprise"] = round(hit[1] - before[0][1], 2)


def week_ahead(today: Optional[date] = None, back_days: int = 3, ahead_days: int = 14) -> dict[str, Any]:
    today = today or date.today()
    d0, d1 = today - timedelta(days=back_days), today + timedelta(days=ahead_days)
    series = _series()
    rows = scheduled(d0, d1, series.get("_ons_next")) + auctions(d0, d1)
    attach_actuals(rows, series)
    rows.sort(key=lambda r: (r["when"], r["tier"], r["ccy"]))
    sources_ok = {k: v is not None for k, v in ((k, _CACHE.get(k, (0, None))[1]) for k in ("bls", "ons_cpi", "ons_ur", "ea_hicp", "ea_ur", "ea_gdp", "snb_cpi", "ust"))}
    return {"as_of": today.isoformat(), "from": d0.isoformat(), "to": d1.isoformat(), "currencies": list(CCYS), "rows": rows,
            "sources": sources_ok, "generated_at": datetime.now(timezone.utc).isoformat(),
            "note": "Dates from the agencies' published schedules (central banks, BLS, BEA, Statistics Bureau), the ONS API (UK) and the usual slot where a calendar is not machine-readable (euro area, CH; flagged). "
                    "No consensus feed: the surprise is against the previous print. Actuals from BLS, ONS, Eurostat and the SNB; Japan's e-Stat needs a key."}


_WEEK: dict[str, Any] = {"at": 0.0, "body": None}


def cached_week_ahead() -> dict[str, Any]:
    if _WEEK["body"] is not None and time.time() - _WEEK["at"] < 1800:
        return _WEEK["body"]
    body = week_ahead()
    _WEEK.update(at=time.time(), body=body)
    return body
