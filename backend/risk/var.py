"""Historical-simulation VaR on the ladder.

Each historical day's observed changes (bp per quote tenor, averaged into the ladder's
tenor buckets; log returns for spots) are applied to today's sensitivities:
    P&L_i = Σ_curve Σ_bucket KR01[c,b] · Δ_i[c,b]  +  Σ_asset spot01[a] · r_i[a]
VaR at a confidence level is the empirical loss quantile over the window; expected
shortfall is the mean loss beyond it; the multi-day figure scales by √horizon. This is
the sensitivities-based form (linear in the factors): fast, transparent, and honest about
what it leaves out (convexity, vol). Factors with no history are listed, not ignored."""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from pnl.explain import BUCKETS, tenor_years
from risk import history as H

DEFAULTS = {"confidence": 0.99, "horizon_days": 1, "window_days": 730, "min_observations": 60, "secondary_confidence": 0.95}
# spot01 is PV for +1 % in the asset; the stored series is the desk's quoted pair, so a
# USD-first quote (USDJPY) moves the other way
PAIR_OF = {"EUR": "EURUSD", "GBP": "GBPUSD", "AUD": "AUDUSD", "NZD": "NZDUSD", "JPY": "USDJPY", "CHF": "USDCHF", "CAD": "USDCAD",
           "BTC": "BTCUSD", "ETH": "ETHUSD", "SOL": "SOLUSD"}


def spot_series_id(asset: str) -> tuple[str, float]:
    pair = PAIR_OF.get(asset, f"{asset}USD")
    return f"{pair}_SPOT", (1.0 if pair.endswith("USD") else -1.0)


def _bucket_of(tenor: str) -> str:
    y = tenor_years(tenor)
    for name, lo, hi in BUCKETS:
        if lo <= y < hi:
            return name
    return BUCKETS[-1][0]


def factor_changes(db: Session, template_uid, curves: list[str], spots: list[str], asof: date, window_days: int) -> dict[str, list[tuple[date, dict[str, float]]]]:
    start = asof - timedelta(days=window_days)
    out = {}
    for cid in curves:
        ser = H.series(db, template_uid, cid, start, asof)
        ch = H.changes(ser, "rate")
        # average the tenor changes into the ladder's buckets
        out[cid] = [(d, _to_buckets(c)) for d, c in ch]
    for a in spots:
        sid, sign = spot_series_id(a)
        ser = H.series(db, template_uid, sid, start, asof)
        out[f"{a}_SPOT"] = [(d, {"SPOT": sign * c.get("SPOT", 0.0)}) for d, c in H.changes(ser, "spot")]
    return out


def _to_buckets(ch: dict[str, float]) -> dict[str, float]:
    acc: dict[str, list[float]] = {}
    for t, v in ch.items():
        if t in ("ON", "FLAT"):
            continue
        acc.setdefault(_bucket_of(t), []).append(v)
    return {b: sum(v) / len(v) for b, v in acc.items()}


def simulate(ladder: list[dict], spot01: dict[str, float], changes: dict[str, list[tuple[date, dict[str, float]]]]) -> tuple[list[tuple[date, float]], list[str]]:
    """Daily P&L per historical date, over the dates every factor has (intersection)."""
    kr = {row["curve"]: row["buckets"] for row in ladder}
    needed = [c for c in kr if any(abs(v) > 1e-9 for v in kr[c].values())] + [f"{a}_SPOT" for a, v in spot01.items() if abs(v) > 1e-9]
    missing = [f for f in needed if not changes.get(f)]
    usable = [f for f in needed if changes.get(f)]
    if not usable:
        return [], missing
    by_date: dict[date, dict[str, dict[str, float]]] = {}
    for f in usable:
        for d, ch in changes[f]:
            by_date.setdefault(d, {})[f] = ch
    pnl = []
    for d in sorted(by_date):
        row = by_date[d]
        if any(f not in row for f in usable):
            continue
        v = 0.0
        for c, buckets in kr.items():
            if c in row:
                v += sum(buckets.get(b, 0.0) * row[c].get(b, 0.0) for b in buckets)
        for a, s01 in spot01.items():
            f = f"{a}_SPOT"
            if f in row:
                v += s01 * row[f].get("SPOT", 0.0)
        pnl.append((d, v))
    return pnl, missing


def quantiles(pnl: list[float], confidence: float) -> dict[str, float]:
    if not pnl:
        return {"var": 0.0, "es": 0.0}
    losses = sorted(-x for x in pnl)                      # positive = loss
    n = len(losses)
    k = min(n - 1, max(0, int(math.ceil(confidence * n)) - 1))
    var = losses[k]
    tail = losses[k:]
    return {"var": max(0.0, var), "es": max(0.0, sum(tail) / len(tail))}


def compute(db: Session, template_uid, ladder: list[dict], spot01: dict[str, float], asof: date, settings: dict) -> dict[str, Any]:
    s = {**DEFAULTS, **(settings or {})}
    curves = [row["curve"] for row in ladder]
    ch = factor_changes(db, template_uid, curves, list(spot01), asof, int(s["window_days"]))
    pnl, missing = simulate(ladder, spot01, ch)
    vals = [v for _, v in pnl]
    main, second = quantiles(vals, float(s["confidence"])), quantiles(vals, float(s["secondary_confidence"]))
    h = max(1, int(s["horizon_days"]))
    scale = math.sqrt(h)
    worst = sorted(pnl, key=lambda x: x[1])[:5]
    return {"method": "historical simulation on the ladder (sensitivities-based, linear)", "confidence": s["confidence"], "secondary_confidence": s["secondary_confidence"],
            "horizon_days": h, "window_days": int(s["window_days"]), "observations": len(vals), "enough": len(vals) >= int(s["min_observations"]),
            "min_observations": int(s["min_observations"]),
            "var_1d": main["var"], "es_1d": main["es"], "var_h": main["var"] * scale, "es_h": main["es"] * scale,
            "var_1d_secondary": second["var"], "es_1d_secondary": second["es"],
            "window_from": pnl[0][0].isoformat() if pnl else None, "window_to": pnl[-1][0].isoformat() if pnl else None,
            "worst_days": [{"date": d.isoformat(), "pnl": v} for d, v in worst], "missing_factors": missing,
            "histogram": _hist(vals), "series": [{"date": d.isoformat(), "pnl": v} for d, v in pnl]}


def _hist(vals: list[float], bins: int = 24) -> list[dict]:
    if len(vals) < 2:
        return []
    lo, hi = min(vals), max(vals)
    if hi <= lo:
        return []
    w = (hi - lo) / bins
    counts = [0] * bins
    for v in vals:
        counts[min(bins - 1, int((v - lo) / w))] += 1
    return [{"from": lo + i * w, "to": lo + (i + 1) * w, "n": c} for i, c in enumerate(counts)]
