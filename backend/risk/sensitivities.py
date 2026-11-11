"""The ladder, by bump-and-reprice through the production pricers.

For every trade and every curve it is valued on, each tenor bucket's quotes are bumped
+1bp and the trade repriced on the as-of market: KR01 by (curve, bucket). A volatility
surface ({PAIR}_VOL for FX options, {CCY}_SWVOL_ATM for swaptions) is bumped +1 vol point
(+1bp of normal vol) per bucket instead: vega by (surface, bucket), kept apart from the rate ladder. Spot deltas come from the currency
pricer (PV for +1 % spot). Totals: IR01 per curve (sum of the buckets), book IR01, vega
per surface, spot01 per asset, NPV. The same bucket set as the P&L explain, so a
day's rates P&L and the ladder speak the same language."""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from pnl.explain import BUCKETS, LIVE, Valuer, _bucket_quotes
from pnl.market import Market, is_vol_surface
from pnl.valuation import points_curve, spot_curve, trade_curves

log = logging.getLogger("rijeka.risk")
BUMP_BP = 1.0
VOL_BUMP = 100.0        # in the bump unit (bp/100): one volatility point on a {PAIR}_VOL surface, 1bp of normal vol on a swaption grid


def _bumped(quotes: list[dict], lo: float, hi: float, bp: float) -> list[dict]:
    target = [{**q, "rate": float(q["rate"]) + bp / 100.0} for q in quotes]
    return _bucket_quotes(quotes, target, lo, hi)


def _carry_points(trade, mkt: Market, bumped: Market, bp: float) -> Market:
    """FUND01 when the forward is quoted: on a pair priced on forward points the stored funding rate does not enter
    the value, the rate the points imply does. +1bp on the funding rate is then +1bp on that implied rate at every
    tenor, which lowers each outright by F·T·1bp: the points are moved by that, so the ladder's FUND01 is the
    ticket's out to the last quoted tenor. Beyond it the pricer carries parity plus the last quoted basis as a
    rate (pricing/forward_points.py, since 0.22.0), so the bump of the last tenor carries through: until then the
    points were held flat there and a longer trade's FUND01 read low (a third low at three years; Emmy, 9 Nov 2026).
    Without points the bumped market is returned as it is."""
    pc = points_curve(trade)
    pts = mkt.quotes(pc) if pc else None
    spot = mkt.spot(pc[: -len("_FWD")]) if pts else None
    if not pts or not spot:
        return bumped
    from api.routes.currencies import TENOR_DAYS
    moved = [{**q, "rate": float(q["rate"]) - (spot + float(q["rate"])) * TENOR_DAYS[q["tenor"]] / 365.0 * bp * 1e-4}
             if q.get("tenor") in TENOR_DAYS and q.get("rate") is not None else q for q in pts]
    return bumped.override(pc, moved)


def trade_ladder(db: Session, user: dict, trade, d: date, mkt: Market, valuer: Valuer) -> dict[str, Any]:
    base = valuer(trade, d, mkt)
    kr01: dict[str, dict[str, float]] = {}
    vega: dict[str, dict[str, float]] = {}
    fund01: dict[str, dict[str, float]] = {}          # a digital asset's funding rate: the desk's FUND01, kept out of IR01
    for cid in trade_curves(trade):
        q = mkt.quotes(cid)
        if not q:
            continue
        is_vol = is_vol_surface(cid)
        target, bump = (vega, VOL_BUMP) if is_vol else (fund01, BUMP_BP) if cid.endswith("_FUNDING") else (kr01, BUMP_BP)
        if len(q) <= 1:                                 # a flat rate or funding level: one bucket
            m = mkt.override(cid, _bumped(q, 0.0, 1e9, bump))
            if target is fund01:
                m = _carry_points(trade, mkt, m, bump)
            target.setdefault(cid, {})["FLAT"] = valuer(trade, d, m)["npv"] - base["npv"]
            continue
        for name, lo, hi in BUCKETS:
            bumped = _bumped(q, lo, hi, bump)
            if bumped == q:
                continue
            m = mkt.override(cid, bumped)
            target.setdefault(cid, {})[name] = valuer(trade, d, m)["npv"] - base["npv"]
    spot01: dict[str, float] = {}
    sc = spot_curve(trade)
    if sc and base.get("spot01") is not None:
        from risk.stress import asset_of
        spot01[asset_of(sc.replace("_SPOT", ""))[0]] = float(base["spot01"])
    return {"trade_id": str(trade.id), "trade_ref": trade.trade_ref, "instrument": trade.instrument_type, "desk": trade.desk or "UNASSIGNED",
            "book": trade.book or "UNASSIGNED", "ccy": base["ccy"], "npv": base["npv"], "kr01": kr01, "spot01": spot01, "vega": vega, "fund01": fund01,
            # CRYBASIS01: +1 bp a year on the forward basis at a fixed spot and USD curve is −1 bp on the funding rate,
            # so each bucket is the negative of its FUND01 bucket (the FUND01 rows themselves are unchanged)
            "crybasis01": {cid: {b: 0.0 - v for b, v in buckets.items()} for cid, buckets in fund01.items()},
            "ir01": sum(sum(b.values()) for b in kr01.values()), "vega_total": sum(sum(b.values()) for b in vega.values()),
            "fund01_total": sum(sum(b.values()) for b in fund01.values()),
            "crybasis01_total": 0.0 - sum(sum(b.values()) for b in fund01.values()),
            "theta": base.get("theta"), "fallback": base.get("fallback", [])}


def book_ladder(db: Session, user: dict, trades, d: date, mkt: Market, fx) -> dict[str, Any]:
    """Every live trade's ladder, plus totals in the reporting currency (fx: ccy -> usd rate)."""
    valuer = Valuer(db, user)
    rows, problems = [], []
    for t in trades:
        if t.status not in LIVE:
            continue
        try:
            rows.append(trade_ladder(db, user, t, d, mkt, valuer))
        except Exception as e:          # noqa: BLE001
            detail = getattr(e, "detail", None) or str(e)
            problems.append({"trade_ref": t.trade_ref, "reason": str(detail)[:160]})
    by_curve: dict[str, dict[str, float]] = {}
    by_vol: dict[str, dict[str, float]] = {}
    by_fund: dict[str, float] = {}
    spot01: dict[str, float] = {}
    npv_usd = ir01_usd = vega_usd = fund01_usd = 0.0
    unconverted: set[str] = set()
    for r in rows:
        k = fx(r["ccy"])
        if k is None:
            unconverted.add(r["ccy"]); continue
        r["usd_rate"] = k
        npv_usd += r["npv"] * k
        ir01_usd += r["ir01"] * k
        for cid, buckets in r["kr01"].items():
            for b, v in buckets.items():
                by_curve.setdefault(cid, {})[b] = by_curve.setdefault(cid, {}).get(b, 0.0) + v * k
        for cid, buckets in (r.get("vega") or {}).items():
            for b, v in buckets.items():
                by_vol.setdefault(cid, {})[b] = by_vol.setdefault(cid, {}).get(b, 0.0) + v * k
                vega_usd += v * k
        for cid, buckets in (r.get("fund01") or {}).items():
            by_fund[cid] = by_fund.get(cid, 0.0) + sum(buckets.values()) * k
            fund01_usd += sum(buckets.values()) * k
        for a, v in r["spot01"].items():
            spot01[a] = spot01.get(a, 0.0) + v * k
    ladder = [{"curve": cid, "buckets": {b: by_curve[cid].get(b, 0.0) for b, *_ in BUCKETS} | ({"FLAT": by_curve[cid]["FLAT"]} if "FLAT" in by_curve[cid] else {}),
               "total": sum(by_curve[cid].values())} for cid in sorted(by_curve)]
    vega_ladder = [{"curve": cid, "buckets": {b: by_vol[cid].get(b, 0.0) for b, *_ in BUCKETS} | ({"FLAT": by_vol[cid]["FLAT"]} if "FLAT" in by_vol[cid] else {}),
                    "total": sum(by_vol[cid].values())} for cid in sorted(by_vol)]
    return {"rows": rows, "ladder": ladder, "spot01": spot01, "npv_usd": npv_usd, "ir01_usd": ir01_usd, "valuations": valuer.calls,
            "vega": vega_ladder, "vega_usd": vega_usd, "vol_bump": "1 vol point (FX) · 1bp normal vol (swaptions)",
            "fund01": by_fund, "fund01_usd": fund01_usd,
            "crybasis01": {cid: 0.0 - v for cid, v in by_fund.items()}, "crybasis01_usd": 0.0 - fund01_usd,
            "problems": problems, "unconverted": sorted(unconverted), "bump_bp": BUMP_BP, "buckets": [b[0] for b in BUCKETS]}
