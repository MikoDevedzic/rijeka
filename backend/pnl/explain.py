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

  AMEND      a trade amended in the window: the market steps above are run on the
             economics that stood at the previous close, and the amendment is one step,
             NPV(new terms, today's market) − NPV(old terms, today's market). Several
             amendments in one window collapse into that one step.

Full revaluation at every step means the rows sum to the total by construction; the
order is the convention, stated here and on the report. Trading activity (new trades,
amendments, unwinds) is not attributed to market moves: a new trade's P&L is its mark
today, an unwind's is the removal of yesterday's mark plus any fee in the terms.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime
from types import SimpleNamespace
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from pnl.market import Market, quote_differs
from pnl.valuation import points_curve, spot_curve, trade_curves, value

log = logging.getLogger("rijeka.pnl")

BUCKETS = (("0-1Y", 0.0, 1.0001), ("1-5Y", 1.0001, 5.0001), ("5-10Y", 5.0001, 10.0001), ("10Y+", 10.0001, 1e9))
ORDER = ["CARRY", "CASH", "RATES", "FX", "RESIDUAL", "AMEND", "NEW", "UNWIND"]
GROUP = {"CARRY": "MARKET", "CASH": "MARKET", "RATES": "MARKET", "FX": "MARKET", "RESIDUAL": "MARKET", "AMEND": "TRADING", "NEW": "TRADING", "UNWIND": "TRADING"}
AMENDING_EVENTS = ("AMENDED", "PARTIAL_TERMINATION")
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
            {"t": str(getattr(trade, "_cash_id", None) or trade.id), "d0": d0, "d1": d1}).all()
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


# ── amendments ───────────────────────────────────────────────────────────────

_TRADE_DATE_FIELDS = ("trade_date", "effective_date", "maturity_date")
_TRADE_COPY = ("instrument_type", "structure", "asset_class", "trade_ref", "status", "notional_ccy", "discount_curve_id", "forecast_curve_id",
               "terms", "notional", "trade_date", "effective_date", "maturity_date", "counterparty_id", "user_id", "desk", "book")


def _as_date(v):
    if v is None or isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def shadow_trade(trade, state: dict) -> SimpleNamespace:
    """The trade as it stood before an amendment: the live row's fields, overridden by the
    event's pre_state, with the old legs attached for the pricer (pnl.valuation reads `_legs`).
    Its id is tagged so the valuer and the pricer cache keep it apart from today's terms;
    `_cash_id` keeps settled cash looked up on the real trade."""
    out = SimpleNamespace(**{f: getattr(trade, f, None) for f in _TRADE_COPY})
    for k, v in (state.get("trade") or {}).items():
        if k in ("id", "latest_event_id", "version_seq", "created_at", "created_by", "last_modified_at", "last_modified_by"):
            continue
        setattr(out, k, _as_date(v) if k in _TRADE_DATE_FIELDS else v)
    if out.notional is not None:
        try:
            out.notional = float(out.notional)
        except (TypeError, ValueError):
            pass
    out.id = f"{trade.id}#pre"
    out._cash_id = trade.id
    out._legs = list(state.get("legs") or [])
    return out


def amendment_state_at(db: Session, trade, d0: date, d1: date) -> Optional[dict]:
    """The economics that stood at d0 for a trade amended in (d0, d1]: the pre_state of the
    first amending event in the window, or the projection of the events before it. None when
    the trade was not amended in the window (or its history cannot say what it looked like)."""
    try:
        rows = db.execute(text(
            "SELECT event_seq, event_type, event_date, tx_time, payload, pre_state FROM trade_events "
            "WHERE trade_id = :t ORDER BY event_seq"), {"t": str(trade.id)}).all()
    except Exception as e:          # noqa: BLE001 — no event stream, no amendment to see
        log.debug("amendments %s: %s", getattr(trade, "trade_ref", ""), e); db.rollback(); return None
    first = None
    for r in rows:
        if r.event_type not in AMENDING_EVENTS:
            continue
        when = _as_date(r.event_date) or (r.tx_time.date() if isinstance(r.tx_time, datetime) else None)
        if when is not None and d0 < when <= d1:
            first = r; break
    if first is None:
        return None
    pre = first.pre_state if isinstance(first.pre_state, dict) else {}
    if pre.get("trade"):
        return {"trade": dict(pre["trade"]), "legs": [dict(l) for l in (pre.get("legs") or [])], "event_seq": first.event_seq}
    try:
        from projections.trade_projection import EventLike, project
        before = [EventLike(event_seq=int(r.event_seq), event_type=str(r.event_type), payload=dict(r.payload or {})) for r in rows if r.event_seq < first.event_seq]
        proj = project(before) if before else None
    except Exception as e:          # noqa: BLE001
        log.info("amendments %s: cannot project pre-amendment state: %s", getattr(trade, "trade_ref", ""), e); proj = None
    if proj and proj.get("trade"):
        return {"trade": dict(proj["trade"]), "legs": [dict(l) for l in proj.get("legs") or []], "event_seq": first.event_seq}
    return None


def amended_trade(db: Session, user: dict, trade, old_state: dict, d0: date, d1: date, m0: Market, m1: Market,
                  valuer: Optional[Valuer] = None) -> dict[str, Any]:
    """Market steps on the old terms, then one AMEND step: NPV(new terms, m1) − NPV(old terms, m1)."""
    v = valuer or Valuer(db, user)
    old = shadow_trade(trade, old_state)
    r = explain_trade(db, user, old, d0, d1, m0, m1, v)
    new = v(trade, d1, m1)
    ccy = new["ccy"]
    step = new["npv"] - r["mark"]
    r["rows"].append({"bucket": "AMEND", "label": "Amendment · new terms at close", "ccy": ccy, "pnl": step})
    r["total_by_ccy"][ccy] = r["total_by_ccy"].get(ccy, 0.0) + step
    r.update(trade_id=str(trade.id), trade_ref=trade.trade_ref, kind="AMENDED", ccy=ccy, mark=new["npv"],
             greeks={k: new.get(k) for k in ("ir01", "ir01_disc", "spot01", "theta")},
             fallback=sorted(set(r.get("fallback", []) + new.get("fallback", []))), amended_from_seq=old_state.get("event_seq"))
    return r
