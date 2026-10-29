"""Day-on-day P&L of one trade, attributed by sequential full revaluation.

Starting from yesterday's mark on yesterday's market, the valuation is moved one
thing at a time, in a fixed order, and each step's change is one row:

  CARRY      roll the valuation date to today on yesterday's market (theta, roll-down, accrual)
  CASH       coupons and settlements that paid between the two dates (realised)
  RATES      each curve the trade is valued on, moved tenor bucket by tenor bucket
             (0-1Y, 1-5Y, 5-10Y, 10Y+), discount curve first, then forecast, then the base
  FX         the spot rate, then the quoted forward points (FX and digital-asset forwards)
  RESIDUAL   whatever is left between the last step and today's mark on today's market:
             cross effects and anything not moved explicitly (a vol surface, a quote the
             market has that the step list does not). Shown, never spread.

Full revaluation at every step means the rows sum to the total by construction; the
order is the convention, stated here and on the report. Trading activity (new trades,
unwinds) is not attributed to market moves: a new trade's P&L is its mark today, an
unwind's is the removal of yesterday's mark plus any fee in the terms.
"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from pnl.market import Market, quote_differs
from pnl.valuation import points_curve, spot_curve, trade_curves, value

log = logging.getLogger("rijeka.pnl")

BUCKETS = (("0-1Y", 0.0, 1.0001), ("1-5Y", 1.0001, 5.0001), ("5-10Y", 5.0001, 10.0001), ("10Y+", 10.0001, 1e9))
ORDER = ["CARRY", "CASH", "RATES", "FX", "RESIDUAL", "NEW", "UNWIND"]
GROUP = {"CARRY": "MARKET", "CASH": "MARKET", "RATES": "MARKET", "FX": "MARKET", "RESIDUAL": "MARKET", "NEW": "TRADING", "UNWIND": "TRADING"}
LIVE = ("PENDING", "CONFIRMED", "LIVE")


def tenor_years(t: str) -> float:
    t = str(t or "").upper().strip()
    if t in ("ON", "O/N", "TN", "SN", "SPOT", "FLAT"):
        return 0.0
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([DWMY])", t)
    if not m:
        return 0.0
    n, u = float(m.group(1)), m.group(2)
    return {"D": n / 365, "W": n / 52, "M": n / 12, "Y": n}[u]


class Valuer:
    """Memoised valuations for one explain run: the same (trade, date, market) is priced once."""
    def __init__(self, db: Session, user: dict):
        self.db, self.user, self.memo = db, user, {}
        self.calls = 0

    def __call__(self, trade, d: date, mkt: Market) -> dict:
        key = (str(trade.id), d, mkt.signature())
        if key not in self.memo:
            self.calls += 1
            self.memo[key] = value(self.db, self.user, trade, d, mkt)
        return self.memo[key]


def cash_settled(db: Session, trade, d0: date, d1: date) -> dict[str, float]:
    """Flows paid in (d0, d1], signed from our side, by currency."""
    out: dict[str, float] = {}
    try:
        rows = db.execute(text(
            "SELECT c.currency, coalesce(c.amount_override, c.amount) AS amt, l.direction FROM cashflows c "
            "JOIN trade_legs l ON l.id = c.leg_id WHERE c.trade_id = :t AND c.payment_date > :d0 AND c.payment_date <= :d1"),
            {"t": str(trade.id), "d0": d0, "d1": d1}).all()
    except Exception as e:          # noqa: BLE001 — no schedule, no cash
        log.debug("cash: %s", e); db.rollback(); return out
    for r in rows:
        if r.amt is None:
            continue
        amt = float(r.amt)
        sign = -1.0 if str(r.direction or "").upper().startswith("PAY") else 1.0
        # stored amounts may already carry a sign; a signed amount is taken as is
        v = amt if amt < 0 else sign * abs(amt)
        out[str(r.currency).upper()] = out.get(str(r.currency).upper(), 0.0) + v
    return out


def _bucket_quotes(current: list[dict], target: list[dict], lo: float, hi: float) -> list[dict]:
    """Current quotes with the tenors in [lo, hi) taken from the target."""
    tgt = {q.get("tenor"): q for q in target}
    out = []
    seen = set()
    for q in current:
        t = q.get("tenor"); seen.add(t)
        y = tenor_years(t)
        out.append(dict(tgt[t]) if lo <= y < hi and t in tgt else dict(q))
    for t, q in tgt.items():                      # a tenor the old snapshot did not have
        if t not in seen and lo <= tenor_years(t) < hi:
            out.append(dict(q))
    return out


def explain_trade(db: Session, user: dict, trade, d0: date, d1: date, m0: Market, m1: Market, valuer: Optional[Valuer] = None) -> dict[str, Any]:
    v = valuer or Valuer(db, user)
    rows: list[dict] = []
    v00 = v(trade, d0, m0)
    ccy = v00["ccy"]
    v10 = v(trade, d1, m0)
    rows.append({"bucket": "CARRY", "label": "Theta & roll-down", "ccy": ccy, "pnl": v10["npv"] - v00["npv"]})
    for c, amt in cash_settled(db, trade, d0, d1).items():
        rows.append({"bucket": "CASH", "label": f"Cash settled {c}", "ccy": c, "pnl": amt})
    mk, cur = m0, v10["npv"]
    moved: list[str] = []
    for cid in trade_curves(trade):
        q0, q1 = m0.quotes(cid), m1.quotes(cid)
        if not quote_differs(q0, q1):
            continue
        if len(q1) <= 1 or len(q0) <= 1:         # a single quote (flat rate, funding): one step
            mk = mk.override(cid, q1); val = v(trade, d1, mk)
            rows.append({"bucket": "RATES", "label": f"{cid} level", "curve": cid, "tenor": "FLAT", "ccy": ccy, "pnl": val["npv"] - cur}); cur = val["npv"]
            moved.append(cid); continue
        for name, lo, hi in BUCKETS:
            blended = _bucket_quotes(mk.quotes(cid) or q0, q1, lo, hi)
            if not quote_differs(mk.quotes(cid) or q0, blended):
                continue
            mk = mk.override(cid, blended); val = v(trade, d1, mk)
            rows.append({"bucket": "RATES", "label": f"{cid} {name}", "curve": cid, "tenor": name, "ccy": ccy, "pnl": val["npv"] - cur}); cur = val["npv"]
        moved.append(cid)
    sc = spot_curve(trade)
    if sc:
        s0, s1 = m0.single(sc, "SPOT"), m1.single(sc, "SPOT")
        if s0 is not None and s1 is not None and s0 != s1:
            mk = mk.with_single(sc, "SPOT", s1); val = v(trade, d1, mk)
            rows.append({"bucket": "FX", "label": f"{sc.replace('_SPOT', '')} spot {s0:g} → {s1:g}", "curve": sc, "ccy": ccy, "pnl": val["npv"] - cur}); cur = val["npv"]
    pc = points_curve(trade)
    if pc and quote_differs(m0.quotes(pc), m1.quotes(pc)):
        mk = mk.override(pc, m1.quotes(pc)); val = v(trade, d1, mk)
        rows.append({"bucket": "FX", "label": f"{pc.replace('_FWD', '')} forward points", "curve": pc, "ccy": ccy, "pnl": val["npv"] - cur}); cur = val["npv"]
    v11 = v(trade, d1, m1)
    resid = v11["npv"] - cur
    if abs(resid) > 0.005:
        rows.append({"bucket": "RESIDUAL", "label": "Cross & unattributed", "ccy": ccy, "pnl": resid})
    total_by_ccy: dict[str, float] = {}
    for r in rows:
        total_by_ccy[r["ccy"]] = total_by_ccy.get(r["ccy"], 0.0) + r["pnl"]
    return {"trade_id": str(trade.id), "trade_ref": trade.trade_ref, "kind": "EXPLAINED", "ccy": ccy,
            "mark_prev": v00["npv"], "mark": v11["npv"], "rows": rows, "total_by_ccy": total_by_ccy,
            "greeks": {k: v11.get(k) for k in ("ir01", "ir01_disc", "spot01", "theta")},
            "fallback": sorted(set(v00.get("fallback", []) + v11.get("fallback", []))), "moved": moved}


def new_trade(db: Session, user: dict, trade, d1: date, m1: Market, valuer: Optional[Valuer] = None) -> dict[str, Any]:
    v = (valuer or Valuer(db, user))(trade, d1, m1)
    row = {"bucket": "NEW", "label": "New trade · mark at close", "ccy": v["ccy"], "pnl": v["npv"]}
    return {"trade_id": str(trade.id), "trade_ref": trade.trade_ref, "kind": "NEW", "ccy": v["ccy"], "mark_prev": None, "mark": v["npv"],
            "rows": [row], "total_by_ccy": {v["ccy"]: v["npv"]}, "greeks": {k: v.get(k) for k in ("ir01", "ir01_disc", "spot01", "theta")},
            "fallback": v.get("fallback", []), "moved": []}


def unwound_trade(db: Session, user: dict, trade, d0: date, m0: Market, valuer: Optional[Valuer] = None) -> dict[str, Any]:
    try:
        v = (valuer or Valuer(db, user))(trade, d0, m0)
        prev, ccy = v["npv"], v["ccy"]
    except Exception as e:          # noqa: BLE001 — a mirror booking with no legs has no mark to remove
        log.info("unwind %s: no prior mark (%s)", trade.trade_ref, e)
        prev, ccy = 0.0, (trade.notional_ccy or "USD").upper()
    fee = 0.0
    try:
        fee = float((trade.terms or {}).get("termination_fee") or 0.0)
    except (TypeError, ValueError):
        fee = 0.0
    rows = [{"bucket": "UNWIND", "label": f"{(trade.status or 'unwound').title()} · prior mark removed", "ccy": ccy, "pnl": -prev}]
    if fee:
        rows.append({"bucket": "UNWIND", "label": "Termination fee", "ccy": ccy, "pnl": fee})
    return {"trade_id": str(trade.id), "trade_ref": trade.trade_ref, "kind": "UNWIND", "ccy": ccy, "mark_prev": prev, "mark": 0.0,
            "rows": rows, "total_by_ccy": {ccy: -prev + fee}, "greeks": {}, "fallback": [], "moved": []}
