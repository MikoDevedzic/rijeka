"""Historical-simulation VaR by full revaluation.

Each historical day's observed changes are applied to today's market, quote by quote
(bp per tenor for every curve the book is valued on, log returns for spots), and every
live trade is repriced on that shifted market through the production pricers:
    P&L_i = Σ_trades [ NPV(trade, market + Δ_i) − NPV(trade, market) ] · fx
VaR is the empirical loss quantile over the window, expected shortfall the mean loss
beyond it, the multi-day figure scales by √horizon. Nothing is linearised: convexity,
the curve shape inside a bucket and the spot-rate cross terms are all in the number.
The ladder VaR is computed alongside as the linear comparison; the gap between the two
is the convexity the ladder cannot see. The bootstrapped curves are cached per market,
so a day costs one bootstrap per curve plus one valuation per trade."""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from pnl.explain import LIVE, Valuer
from pnl.market import Market
from pnl.valuation import spot_curve, trade_curves
from risk import history as H
from risk import var as V
from risk.stress import asset_of
from risk.var import _bucket_of, quantiles, _hist

MAX_VALUATIONS = 60_000          # per report: beyond this the full revaluation is skipped and the ladder VaR reported, with a note
METHOD = "historical simulation by full revaluation (every trade repriced on each day's shifted market)"


def shift_quotes(quotes: list[dict], change_bp: dict[str, float]) -> list[dict]:
    """Today's quotes plus the day's observed change per tenor; a tenor without its own
    history takes the average change of its bucket (the ladder's convention)."""
    by_bucket: dict[str, list[float]] = {}
    for t, v in change_bp.items():
        if t not in ("ON", "FLAT"):
            by_bucket.setdefault(_bucket_of(t), []).append(v)
    avg = {b: sum(v) / len(v) for b, v in by_bucket.items()}
    out = []
    for q in quotes:
        t = q.get("tenor")
        bp = change_bp.get(t)
        if bp is None:
            bp = change_bp.get("FLAT") if t == "FLAT" else avg.get(_bucket_of(t)) if t not in ("ON", "FLAT") else None
        out.append({**q, "rate": float(q["rate"]) + (bp or 0.0) / 100.0} if bp is not None else q)
    return out


def shifted_market(mkt: Market, day: dict[str, dict[str, float]], curves: list[str], spots: list[str]) -> Market:
    """day: factor -> change; rates keyed by curve id (bp per tenor), spots by '<PAIR>_SPOT' ({'SPOT': log return %})."""
    m = mkt
    for cid in curves:
        q = m.quotes(cid)
        ch = day.get(cid)
        if q and ch:
            m = m.override(cid, shift_quotes(q, ch))
    for pair in spots:
        ch = day.get(f"{pair}_SPOT")
        s = m.spot(pair)
        if ch and s:
            m = m.with_single(f"{pair}_SPOT", "SPOT", s * math.exp(ch.get("SPOT", 0.0) / 100.0))
    return m


def factor_days(db: Session, template_uid, curves: list[str], pairs: list[str], asof: date, window_days: int) -> tuple[list[tuple[date, dict]], list[str]]:
    """Per historical date, every factor's change; only dates where every factor with history has one."""
    start = asof - timedelta(days=window_days)
    changes: dict[str, list[tuple[date, dict[str, float]]]] = {}
    for cid in curves:
        changes[cid] = H.changes(H.series(db, template_uid, cid, start, asof), "rate")
    for pair in pairs:
        changes[f"{pair}_SPOT"] = [(d, {"SPOT": c.get("SPOT", 0.0)}) for d, c in H.changes(H.series(db, template_uid, f"{pair}_SPOT", start, asof), "spot")]
    missing = [f for f, ch in changes.items() if not ch]
    usable = [f for f, ch in changes.items() if ch]
    by_date: dict[date, dict] = {}
    for f in usable:
        for d, ch in changes[f]:
            by_date.setdefault(d, {})[f] = ch
    days = [(d, row) for d, row in sorted(by_date.items()) if all(f in row for f in usable)]
    return days, missing


def compute(db: Session, user: dict, template_uid, trades, d: date, mkt: Market, fx, settings: dict,
            linear: Optional[dict] = None, max_valuations: int = MAX_VALUATIONS) -> dict[str, Any]:
    s = {**V.DEFAULTS, **(settings or {})}
    live = [t for t in trades if t.status in LIVE]
    curves = sorted({c for t in live for c in trade_curves(t) if mkt.quotes(c)})
    pairs = sorted({spot_curve(t).replace("_SPOT", "") for t in live if spot_curve(t)})
    days, missing = factor_days(db, template_uid, curves, pairs, d, int(s["window_days"]))
    valuer = Valuer(db, user)
    base: dict[str, float] = {}
    for t in live:
        try:
            v = valuer(t, d, mkt); base[str(t.id)] = v["npv"] * (fx(v["ccy"]) or 0.0)
        except Exception:               # noqa: BLE001 — the ladder lists unpriceable trades
            pass
    priced = [t for t in live if str(t.id) in base]
    budget = len(days) * len(priced)
    out: dict[str, Any] = {"method": METHOD, "confidence": s["confidence"], "secondary_confidence": s["secondary_confidence"],
                           "horizon_days": max(1, int(s["horizon_days"])), "window_days": int(s["window_days"]), "min_observations": int(s["min_observations"]),
                           "missing_factors": missing, "trades": len(priced), "valuations_planned": budget}
    if budget > max_valuations:
        lin = linear or {}
        return {**lin, **{k: out[k] for k in ("missing_factors", "trades", "valuations_planned")},
                "method": lin.get("method", V.compute.__doc__ or "ladder"), "full_revaluation": False,
                "note": f"full revaluation skipped: {budget:,} valuations exceed the budget of {max_valuations:,}; the ladder VaR is reported"}
    pnl: list[tuple[date, float]] = []
    for day, row in days:
        m = shifted_market(mkt, row, curves, pairs)
        total = 0.0
        for t in priced:
            try:
                v = valuer(t, d, m); total += v["npv"] * (fx(v["ccy"]) or 0.0) - base[str(t.id)]
            except Exception:           # noqa: BLE001
                continue
        pnl.append((day, total))
    vals = [v for _, v in pnl]
    main, second = quantiles(vals, float(s["confidence"])), quantiles(vals, float(s["secondary_confidence"]))
    h = out["horizon_days"]; scale = math.sqrt(h)
    worst = sorted(pnl, key=lambda x: x[1])[:5]
    out.update({"full_revaluation": True, "observations": len(vals), "enough": len(vals) >= int(s["min_observations"]),
                "var_1d": main["var"], "es_1d": main["es"], "var_h": main["var"] * scale, "es_h": main["es"] * scale,
                "var_1d_secondary": second["var"], "es_1d_secondary": second["es"],
                "window_from": pnl[0][0].isoformat() if pnl else None, "window_to": pnl[-1][0].isoformat() if pnl else None,
                "worst_days": [{"date": dd.isoformat(), "pnl": v} for dd, v in worst], "histogram": _hist(vals),
                "series": [{"date": dd.isoformat(), "pnl": v} for dd, v in pnl], "valuations": valuer.calls})
    if linear:
        out["linear"] = {"var_1d": linear.get("var_1d"), "es_1d": linear.get("es_1d"), "observations": linear.get("observations"),
                         "method": linear.get("method")}
        if linear.get("var_1d") is not None:
            out["convexity_1d"] = out["var_1d"] - float(linear["var_1d"])
    return out
