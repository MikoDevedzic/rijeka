"""
Demo market data from public sources — no terminal data anywhere.

The hosted demo cannot show or redistribute Bloomberg data, so the template
user's curves and vol surfaces are rebuilt daily from sources that publish
freely, with every assumption written down here and stamped into `source`:

  USD_SOFR     NY Fed SOFR fixing (overnight) + US Treasury daily par yield
               curve, less an indicative SOFR-OIS / Treasury spread schedule
  EUR_ESTR     ECB €STR fixing + ECB euro-area AAA government par yield curve,
               plus an indicative swap-over-AAA spread schedule
  GBP_SONIA    Bank of England SONIA fixing + gilt par yields (5Y, 10Y, 20Y),
               less an indicative SONIA-OIS / gilt spread schedule
  CHF_SARON    SNB SARON (monthly average), overnight pillar only
  USD_SWVOL_ATM, swaption skew, cap vols
               SYNTHETIC: a smooth parametric normal-vol surface. Not market.

Everything here is indicative. It exists so the demo prices on numbers of
today's date with a documented provenance, not so anyone trades on it.

Pure functions only: the fetchers return plain data, the builders turn data
into snapshot rows. Writing to the database lives in api/routes/demo_market_data.py.
"""
from __future__ import annotations

import csv
import io
import logging
import math
import re
from datetime import date, datetime, timedelta
from typing import Callable, Optional

import httpx

log = logging.getLogger("rijeka.demo_feed")

UA = {"User-Agent": "rijeka-demo-feed/1 (+https://rijeka.app)"}
TIMEOUT = 25.0

# ── Sources (public, no key) ────────────────────────────────────────────────────

NYFED_SOFR_URL = "https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json"
UST_XML_URL    = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
                  "?data=daily_treasury_yield_curve&field_tdr_date_value_month={yyyymm}")
ECB_ESTR_URL   = "https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?lastNObservations=1&format=csvdata"
ECB_AAA_URL    = ("https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.{keys}"
                  "?lastNObservations=1&format=csvdata")
BOE_IADB_URL   = ("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp"
                  "?csv.x=yes&Datefrom={dfrom}&Dateto=now&SeriesCodes=IUDSOIA,IUDSNPY,IUDMNPY,IUDLNPY"
                  "&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N")
SNB_SARON_URL  = "https://data.snb.ch/api/cube/zimoma/data/csv/en?dimSel=D0(SARON)"

SOURCES = [
    {"curve": "USD_SOFR",      "provider": "NY Fed · US Treasury",      "kind": "public",    "url": "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"},
    {"curve": "EUR_ESTR",      "provider": "ECB",                        "kind": "public",    "url": "https://data.ecb.europa.eu/"},
    {"curve": "GBP_SONIA",     "provider": "Bank of England",            "kind": "public",    "url": "https://www.bankofengland.co.uk/boeapps/database/"},
    {"curve": "CHF_SARON",     "provider": "SNB",                        "kind": "public",    "url": "https://data.snb.ch/"},
    {"curve": "USD_SWVOL_ATM", "provider": "synthetic parametric surface", "kind": "synthetic", "url": None},
    {"curve": "USD_CAPVOL",    "provider": "synthetic parametric surface", "kind": "synthetic", "url": None},
]

# The template user's OIS pillar list; the bootstrap and the curves page expect
# exactly this shape (quote_type strings as stored by the manual editor).
OIS_TENORS = ["ON", "1W", "2W", "3W", "1M", "2M", "3M", "4M", "5M", "6M", "7M", "8M", "9M", "10M", "11M",
              "1Y", "18M", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y", "12Y", "15Y", "20Y",
              "25Y", "30Y", "40Y", "50Y"]

SWVOL_EXPIRIES = [1, 2, 3, 5, 7]
SWVOL_TENORS   = [1, 2, 3, 5, 7, 9]
SKEW_TENORS    = [1, 2, 5]
SKEW_OFFSETS   = [-200, -100, -50, -25, 25, 50, 100, 200]
CAP_TENORS     = [1.0, 2.0, 3.0, 5.0, 7.0, 10.0]
CAP_SPREADS    = [-200, -150, -100, -50, 0, 50, 100, 150, 200]

# ── Indicative spread schedules (bp over the government curve), in years ───────
# Written as (years, bp) knots, linear in between, flat beyond. These are the
# documented assumptions behind "indicative"; change them here, nowhere else.
USD_OIS_MINUS_UST = [(1 / 12, -12), (0.25, -15), (1, -20), (2, -25), (5, -30), (10, -40), (20, -60), (30, -70)]
EUR_OIS_MINUS_AAA = [(0.25, 10), (1, 15), (2, 20), (5, 25), (10, 30), (20, 35), (30, 35)]
GBP_OIS_MINUS_GILT = [(1, -15), (5, -25), (10, -40), (20, -70), (30, -75)]


# ── Helpers ────────────────────────────────────────────────────────────────────

def tenor_years(t: str) -> float:
    if t == "ON":
        return 1 / 365
    m = re.fullmatch(r"(\d+)([DWMY])", t)
    if not m:
        raise ValueError(f"bad tenor {t!r}")
    n, u = int(m.group(1)), m.group(2)
    return {"D": n / 365, "W": n * 7 / 365, "M": n / 12, "Y": float(n)}[u]


def interp(knots: list[tuple[float, float]], x: float) -> float:
    """Linear interpolation on (x, y) knots, flat outside the range."""
    pts = sorted(knots)
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def _get(url: str) -> str:
    r = httpx.get(url, headers=UA, timeout=TIMEOUT, follow_redirects=True)
    r.raise_for_status()
    return r.text


# ── Fetchers: each returns (as_of_date, data) and raises on failure ────────────

def fetch_sofr(text: Optional[str] = None) -> tuple[date, float]:
    body = text if text is not None else _get(NYFED_SOFR_URL)
    import json
    rr = json.loads(body)["refRates"][0]
    return date.fromisoformat(rr["effectiveDate"]), float(rr["percentRate"])


_UST_FIELDS = {"BC_1MONTH": 1 / 12, "BC_2MONTH": 2 / 12, "BC_3MONTH": 0.25, "BC_4MONTH": 4 / 12, "BC_6MONTH": 0.5,
               "BC_1YEAR": 1, "BC_2YEAR": 2, "BC_3YEAR": 3, "BC_5YEAR": 5, "BC_7YEAR": 7, "BC_10YEAR": 10,
               "BC_20YEAR": 20, "BC_30YEAR": 30}


def parse_ust_xml(xml: str) -> tuple[date, dict[float, float]]:
    """Latest <entry> of the Treasury daily par yield curve feed → {years: yield %}."""
    entries = re.findall(r"<m:properties>(.*?)</m:properties>", xml, re.S)
    if not entries:
        raise ValueError("no entries in Treasury feed")
    best: Optional[tuple[date, dict[float, float]]] = None
    for e in entries:
        m = re.search(r"<d:NEW_DATE[^>]*>([0-9]{4}-[0-9]{2}-[0-9]{2})", e)
        if not m:
            continue
        d = date.fromisoformat(m.group(1))
        pts = {}
        for field, yrs in _UST_FIELDS.items():
            v = re.search(rf"<d:{field}[^>]*>([-0-9.]+)<", e)
            if v:
                pts[yrs] = float(v.group(1))
        if len(pts) >= 8 and (best is None or d > best[0]):
            best = (d, pts)
    if best is None:
        raise ValueError("no usable Treasury entry")
    return best


def fetch_ust_par(today: Optional[date] = None, text: Optional[str] = None) -> tuple[date, dict[float, float]]:
    if text is not None:
        return parse_ust_xml(text)
    today = today or date.today()
    months = [today.strftime("%Y%m"), (today.replace(day=1) - timedelta(days=1)).strftime("%Y%m")]
    last_err: Optional[Exception] = None
    for yyyymm in months:          # early in a month the current file can be empty
        try:
            return parse_ust_xml(_get(UST_XML_URL.format(yyyymm=yyyymm)))
        except Exception as e:      # noqa: BLE001 — try the previous month
            last_err = e
    raise RuntimeError(f"Treasury feed: {last_err}")


def _ecb_csv_last(body: str) -> list[tuple[str, date, float]]:
    """ECB SDMX csvdata → [(series key, period, value)]."""
    out = []
    for row in csv.DictReader(io.StringIO(body)):
        key = row.get("KEY") or row.get("SERIES_KEY") or ""
        per, val = row.get("TIME_PERIOD"), row.get("OBS_VALUE")
        if not per or val in (None, ""):
            continue
        out.append((key, date.fromisoformat(per[:10]), float(val)))
    return out


def fetch_estr(text: Optional[str] = None) -> tuple[date, float]:
    rows = _ecb_csv_last(text if text is not None else _get(ECB_ESTR_URL))
    if not rows:
        raise ValueError("no €STR observation")
    _, d, v = rows[-1]
    return d, v


_ECB_AAA_KEYS = ["PY_3M", "PY_6M", "PY_9M", "PY_1Y", "PY_2Y", "PY_3Y", "PY_4Y", "PY_5Y", "PY_6Y", "PY_7Y",
                 "PY_8Y", "PY_9Y", "PY_10Y", "PY_12Y", "PY_15Y", "PY_20Y", "PY_25Y", "PY_30Y"]


def fetch_ecb_aaa_par(text: Optional[str] = None) -> tuple[date, dict[float, float]]:
    body = text if text is not None else _get(ECB_AAA_URL.format(keys="+".join(_ECB_AAA_KEYS)))
    pts: dict[float, float] = {}
    as_of: Optional[date] = None
    for key, d, v in _ecb_csv_last(body):
        m = re.search(r"PY_(\d+)([MY])$", key)
        if not m:
            continue
        yrs = int(m.group(1)) / (12 if m.group(2) == "M" else 1)
        pts[yrs] = v
        as_of = max(as_of, d) if as_of else d
    if len(pts) < 6 or as_of is None:
        raise ValueError("ECB AAA curve: too few points")
    return as_of, pts


def fetch_boe(today: Optional[date] = None, text: Optional[str] = None) -> tuple[date, dict[str, float]]:
    """SONIA fixing and gilt par yields (5Y, 10Y, 20Y) from the BoE database CSV."""
    if text is None:
        today = today or date.today()
        dfrom = (today - timedelta(days=21)).strftime("%d/%b/%Y")
        text = _get(BOE_IADB_URL.format(dfrom=dfrom))
    rows = [r for r in csv.reader(io.StringIO(text)) if len(r) >= 5 and re.match(r"\d{2} \w{3} \d{4}", r[0])]
    if not rows:
        raise ValueError("no BoE rows")
    last = rows[-1]
    d = datetime.strptime(last[0], "%d %b %Y").date()
    vals = [float(x) for x in last[1:5]]
    return d, {"SONIA": vals[0], "5Y": vals[1], "10Y": vals[2], "20Y": vals[3]}


def fetch_saron(text: Optional[str] = None) -> tuple[date, float]:
    """SNB publishes the monthly average; the latest month is the overnight pillar."""
    body = text if text is not None else _get(SNB_SARON_URL)
    last = None
    for r in csv.reader(io.StringIO(body), delimiter=";"):
        if len(r) >= 3 and re.fullmatch(r"\d{4}-\d{2}", r[0]) and r[1] == "SARON":
            try:
                last = (r[0], float(r[2]))
            except ValueError:
                continue
    if last is None:
        raise ValueError("no SARON observation")
    y, m = (int(x) for x in last[0].split("-"))
    return date(y, m, 1), last[1]


# ── Builders ───────────────────────────────────────────────────────────────────

def _q(tenor: str, rate: float, quote_type: str) -> dict:
    return {"tenor": tenor, "quote_type": quote_type, "rate": round(rate, 4), "enabled": True}


def build_ois_quotes(on_rate: float, govt: dict[float, float], spread: list[tuple[float, float]],
                     tenors: list[str] = OIS_TENORS) -> list[dict]:
    """OIS pillar rates = government par yield (interpolated in years) + spread schedule.

    Below the first government point the rate blends from the overnight fixing.
    """
    knots = sorted(govt.items())
    first_y, first_v = knots[0]
    out = []
    for t in tenors:
        if t == "ON":
            out.append(_q(t, on_rate, "OISDeposit"))
            continue
        y = tenor_years(t)
        if y < first_y:
            g_first = first_v + interp(spread, first_y) / 100
            rate = on_rate + (g_first - on_rate) * (y / first_y)
        else:
            rate = interp(knots, y) + interp(spread, y) / 100
        out.append(_q(t, rate, "OIS"))
    return out


def build_usd_sofr(sofr: float, ust: dict[float, float]) -> list[dict]:
    return build_ois_quotes(sofr, ust, USD_OIS_MINUS_UST)


def build_eur_estr(estr: float, aaa: dict[float, float]) -> list[dict]:
    return build_ois_quotes(estr, aaa, EUR_OIS_MINUS_AAA)


def build_gbp_sonia(boe: dict[str, float]) -> list[dict]:
    gilts = {5.0: boe["5Y"], 10.0: boe["10Y"], 20.0: boe["20Y"]}
    return build_ois_quotes(boe["SONIA"], gilts, GBP_OIS_MINUS_GILT)


def build_chf_saron(saron: float) -> list[dict]:
    return [_q("ON", saron, "SWAP")]


# Synthetic normal-vol surface. Level falls with expiry (short-dated rate vol
# is highest in a cutting/hiking cycle), drifts down gently with tenor, and the
# smile is a near-symmetric parabola in strike offset. Numbers are in bp/yr.
def atm_normal_vol_bp(expiry_y: float, tenor_y: float) -> float:
    level = 100.0 - 11.0 * math.log1p(expiry_y)
    shape = 1.09 - 0.035 * math.log1p(tenor_y)
    return round(level * shape, 1)


def skew_spread_bp(offset_bp: int) -> float:
    k = offset_bp
    return round(0.00056 * k * k + 0.008 * k, 2)


def build_swvol_atm() -> list[dict]:
    return [{"tenor": f"{e}Yx{t}Y", "quote_type": "SWVOL", "rate": atm_normal_vol_bp(e, t), "enabled": True}
            for e in SWVOL_EXPIRIES for t in SWVOL_TENORS]


def build_skew_cells(source: str) -> list[dict]:
    cells = []
    for e in SWVOL_EXPIRIES:
        for t in SKEW_TENORS:
            cell = {"expiry_label": f"{e}Y", "tenor_label": f"{t}Y", "expiry_y": float(e), "tenor_y": float(t),
                    "atm_vol_bp": atm_normal_vol_bp(e, t), "source": source}
            for off in SKEW_OFFSETS:
                cell[f"spread_{'m' if off < 0 else 'p'}{abs(off)}"] = skew_spread_bp(off)
            cells.append(cell)
    return cells


def cap_flat_vol_bp(cap_tenor_y: float, spread_bp: int) -> float:
    atm = 96.0 - 11.0 * math.log(cap_tenor_y) if cap_tenor_y > 1 else 96.0
    return round(atm + 0.0005 * spread_bp * spread_bp, 1)


def build_cap_rows(valuation_date: date, atm_fwd_pct: Callable[[float], float], source: str) -> list[dict]:
    rows = []
    for T in CAP_TENORS:
        f = atm_fwd_pct(T)
        for s in CAP_SPREADS:
            rows.append({"valuation_date": valuation_date, "cap_tenor_y": T, "strike_spread_bp": s,
                         "is_atm": s == 0, "flat_vol_bp": cap_flat_vol_bp(T, s),
                         "strike_pct": round(f + s / 100, 6), "ticker": None, "source": source})
    return rows


def par_rate_lookup(quotes: list[dict]) -> Callable[[float], float]:
    pts = [(tenor_years(q["tenor"]), q["rate"]) for q in quotes if q["quote_type"] == "OIS"]
    return lambda yrs: interp(pts, yrs)


# ── Orchestration (network) ────────────────────────────────────────────────────

def collect(today: Optional[date] = None) -> dict:
    """Fetch every source once. A source that fails is reported, not fatal."""
    today = today or date.today()
    out: dict = {"ok": {}, "failed": {}}

    def step(name: str, fn: Callable[[], object]):
        try:
            out["ok"][name] = fn()
        except Exception as e:      # noqa: BLE001 — one dead feed must not stop the others
            log.warning("demo feed %s failed: %s", name, e)
            out["failed"][name] = str(e)[:200]

    step("sofr", fetch_sofr)
    step("ust",  lambda: fetch_ust_par(today))
    step("estr", fetch_estr)
    step("aaa",  fetch_ecb_aaa_par)
    step("boe",  lambda: fetch_boe(today))
    step("saron", fetch_saron)
    return out


def assemble(collected: dict, valuation_date: date) -> dict:
    """Turn fetched data into snapshot rows; curves whose inputs failed are skipped."""
    ok = collected["ok"]
    curves: dict[str, dict] = {}

    def src(label: str, *as_of: date) -> str:
        d = max(as_of).isoformat() if as_of else valuation_date.isoformat()
        return f"DEMO · {label} · as of {d}"

    if "sofr" in ok and "ust" in ok:
        (d1, sofr), (d2, ust) = ok["sofr"], ok["ust"]
        curves["USD_SOFR"] = {"quotes": build_usd_sofr(sofr, ust), "source": src("NY Fed SOFR + UST par, indicative spread", d1, d2)}
    if "estr" in ok and "aaa" in ok:
        (d1, estr), (d2, aaa) = ok["estr"], ok["aaa"]
        curves["EUR_ESTR"] = {"quotes": build_eur_estr(estr, aaa), "source": src("ECB €STR + AAA par, indicative spread", d1, d2)}
    if "boe" in ok:
        d1, boe = ok["boe"]
        curves["GBP_SONIA"] = {"quotes": build_gbp_sonia(boe), "source": src("BoE SONIA + gilt par, indicative spread", d1)}
    if "saron" in ok:
        d1, saron = ok["saron"]
        curves["CHF_SARON"] = {"quotes": build_chf_saron(saron), "source": src(f"SNB SARON monthly avg {d1:%Y-%m}")}

    synthetic = "DEMO · synthetic surface"
    curves["USD_SWVOL_ATM"] = {"quotes": build_swvol_atm(), "source": synthetic}
    skew = build_skew_cells(synthetic)
    fwd = par_rate_lookup(curves["USD_SOFR"]["quotes"]) if "USD_SOFR" in curves else (lambda _y: 4.0)
    caps = build_cap_rows(valuation_date, fwd, synthetic)
    return {"valuation_date": valuation_date, "curves": curves, "skew": skew, "caps": caps,
            "failed": collected["failed"]}
