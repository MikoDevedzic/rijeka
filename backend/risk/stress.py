"""Named scenarios by full revaluation. Rates in basis points per curve (optionally by
tenor bucket), spots in percent; every live trade is repriced on the shifted market and
the P&L is the difference. The catalogue is the firm's policy; it is listed on the
Configurations page and in the report."""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from pnl.explain import BUCKETS, LIVE, Valuer, _bucket_quotes
from pnl.market import Market
from pnl.valuation import spot_curve, trade_curves

SHORT = ("0-1Y", "1-5Y")
LONG = ("5-10Y", "10Y+")
SCENARIOS = [
    {"id": "PARALLEL_UP_100", "name": "Rates +100bp", "group": "RATES", "rates": {"*": 100}},
    {"id": "PARALLEL_DN_100", "name": "Rates −100bp", "group": "RATES", "rates": {"*": -100}},
    {"id": "PARALLEL_UP_25", "name": "Rates +25bp", "group": "RATES", "rates": {"*": 25}},
    {"id": "PARALLEL_DN_25", "name": "Rates −25bp", "group": "RATES", "rates": {"*": -25}},
    {"id": "STEEPENER_50", "name": "Steepener: short −25 / long +25", "group": "RATES", "rates_by_bucket": {"0-1Y": -25, "1-5Y": -25, "5-10Y": 25, "10Y+": 25}},
    {"id": "FLATTENER_50", "name": "Flattener: short +25 / long −25", "group": "RATES", "rates_by_bucket": {"0-1Y": 25, "1-5Y": 25, "5-10Y": -25, "10Y+": -25}},
    {"id": "USD_UP_10", "name": "USD +10% vs all", "group": "FX", "spots": {"EUR": -10, "GBP": -10, "AUD": -10, "JPY": 10, "CHF": 10, "CAD": 10}},
    {"id": "USD_DN_10", "name": "USD −10% vs all", "group": "FX", "spots": {"EUR": 10, "GBP": 10, "AUD": 10, "JPY": -10, "CHF": -10, "CAD": -10}},
    {"id": "CRYPTO_DN_30", "name": "Digital assets −30%", "group": "CRYPTO", "spots": {"BTC": -30, "ETH": -30, "SOL": -30}},
    {"id": "CRYPTO_UP_30", "name": "Digital assets +30%", "group": "CRYPTO", "spots": {"BTC": 30, "ETH": 30, "SOL": 30}},
    {"id": "RISK_OFF", "name": "Risk-off: rates −50, USD +5%, crypto −30%", "group": "COMBINED", "rates": {"*": -50},
     "spots": {"EUR": -5, "GBP": -5, "AUD": -5, "JPY": 5, "CHF": 5, "CAD": 5, "BTC": -30, "ETH": -30, "SOL": -30}},
]


def asset_of(pair: str) -> tuple[str, float]:
    """The non-USD asset of a quoted pair, and the direction a quote moves when that asset
    strengthens: EURUSD rises with EUR, USDJPY falls with JPY."""
    return (pair[:3], 1.0) if pair.endswith("USD") else (pair[3:], -1.0)


def shifted_market(mkt: Market, scn: dict, curves: list[str], spots: list[str]) -> Market:
    m = mkt
    for cid in curves:
        q = m.quotes(cid)
        if not q:
            continue
        bp = (scn.get("rates") or {}).get(cid, (scn.get("rates") or {}).get("*"))
        if bp is not None:
            m = m.override(cid, [{**x, "rate": float(x["rate"]) + bp / 100.0} for x in q])
            continue
        byb = scn.get("rates_by_bucket")
        if byb and len(q) > 1:
            cur = q
            for name, lo, hi in BUCKETS:
                b = byb.get(name)
                if b:
                    cur = _bucket_quotes(cur, [{**x, "rate": float(x["rate"]) + b / 100.0} for x in q], lo, hi)
            m = m.override(cid, cur)
    for pair in spots:
        asset, direction = asset_of(pair)
        pct = (scn.get("spots") or {}).get(asset)
        s = m.spot(pair)
        if pct is not None and s:
            m = m.with_single(f"{pair}_SPOT", "SPOT", s * (1 + direction * pct / 100.0))
    return m


def run(db: Session, user: dict, trades, d: date, mkt: Market, fx, scenarios=None) -> list[dict[str, Any]]:
    valuer = Valuer(db, user)
    live = [t for t in trades if t.status in LIVE]
    curves = sorted({c for t in live for c in trade_curves(t)})
    spots = sorted({spot_curve(t).replace("_SPOT", "") for t in live if spot_curve(t)})
    base: dict[str, float] = {}
    for t in live:
        try:
            v = valuer(t, d, mkt); base[str(t.id)] = v["npv"] * (fx(v["ccy"]) or 0.0)
        except Exception:               # noqa: BLE001 — unpriceable trades are in the ladder's problem list already
            pass
    out = []
    for scn in scenarios or SCENARIOS:
        m = shifted_market(mkt, scn, curves, spots)
        total = 0.0; by_trade = []
        for t in live:
            if str(t.id) not in base:
                continue
            try:
                v = valuer(t, d, m); p = v["npv"] * (fx(v["ccy"]) or 0.0) - base[str(t.id)]
            except Exception:           # noqa: BLE001
                continue
            total += p; by_trade.append({"trade_ref": t.trade_ref, "pnl": p})
        out.append({**{k: scn[k] for k in ("id", "name", "group")}, "pnl_usd": total,
                    "worst_trades": sorted(by_trade, key=lambda x: x["pnl"])[:3], "valuations": valuer.calls})
    return out
