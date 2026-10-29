"""Limits on any reported number. A limit names a metric key, a scope (the book total, a
desk or a book), a value and a warning level. Keys follow the report:

  VAR_99_1D · VAR_95_1D · ES_99_1D · VAR_H          VaR and expected shortfall (reporting ccy)
  IR01 · IR01:<curve> · KR01:<curve>:<bucket>        rates sensitivities, absolute value
  SPOT01:<asset>                                     FX01 / BTC01, absolute value
  NPV                                                absolute mark
  STRESS:<scenario id>                               the scenario's loss (positive = loss)

Utilisation is |value| / limit; a breach is utilisation ≥ 100 %, a warning ≥ warn_pct.
Limits are the firm's (set by the risk manager) and apply to each member's book."""
from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

METRIC_HELP = {
    "VAR_99_1D": "1-day VaR at the main confidence", "VAR_95_1D": "1-day VaR at the secondary confidence", "ES_99_1D": "1-day expected shortfall",
    "VAR_H": "VaR over the configured horizon", "IR01": "book IR01, all curves, absolute", "IR01:<curve>": "IR01 of one curve, absolute",
    "KR01:<curve>:<bucket>": "one tenor bucket of one curve, absolute", "SPOT01:<asset>": "PV for +1% spot in one asset, absolute",
    "NPV": "book mark, absolute", "STRESS:<scenario>": "loss under a named scenario",
    "PFE_PEAK:<counterparty>": "peak 95% PFE of the netting set (real-world)", "PFE:<counterparty>:<bucket>": "largest 95% PFE inside the tenor bucket",
    "EPE:<counterparty>": "expected positive exposure, first year", "CVA:<counterparty>": "CVA of the netting set (risk-neutral), absolute", "CE:<counterparty>": "current exposure after collateral",
}


def tables_present(db: Session) -> bool:
    try:
        n = db.execute(text("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('risk_limits', 'risk_settings', 'risk_daily')")).scalar()
        return int(n or 0) == 3
    except Exception:
        db.rollback(); return False


def list_limits(db: Session, firm_id) -> list[dict]:
    if not tables_present(db) or firm_id is None:
        return []
    rows = db.execute(text("SELECT id, metric, scope, scope_name, limit_value, warn_pct, note, set_by_name, created_at FROM risk_limits "
                           "WHERE firm_id = :f AND active ORDER BY scope, scope_name, metric"), {"f": str(firm_id)}).all()
    return [{"id": str(r.id), "metric": r.metric, "scope": r.scope, "scope_name": r.scope_name, "limit": float(r.limit_value), "warn_pct": float(r.warn_pct),
             "note": r.note, "set_by": r.set_by_name, "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]


def add_limit(db: Session, firm_id, metric: str, scope: str, scope_name: Optional[str], limit: float, warn_pct: float, note: str, set_by: str, set_by_name: str) -> dict:
    db.execute(text("INSERT INTO risk_limits (id, firm_id, metric, scope, scope_name, limit_value, warn_pct, note, set_by, set_by_name, active) "
                    "VALUES (:id, :f, :m, :s, :sn, :l, :w, :n, :b, :bn, true)"),
               {"id": str(uuid.uuid4()), "f": str(firm_id), "m": metric.strip().upper(), "s": scope.upper(), "sn": scope_name, "l": limit, "w": warn_pct, "n": note or "", "b": set_by, "bn": set_by_name})
    db.commit()
    return {"ok": True}


def remove_limit(db: Session, firm_id, limit_id: str) -> int:
    r = db.execute(text("UPDATE risk_limits SET active = false WHERE id = :id AND firm_id = :f"), {"id": limit_id, "f": str(firm_id)})
    db.commit()
    return r.rowcount or 0


# ── evaluation against a report ──────────────────────────────────────────────

def metric_value(metric: str, rep: dict, scope_rows: list[dict]) -> Optional[float]:
    """The number a limit refers to, for the rows in scope (the whole book when scope is ALL)."""
    m = metric.upper()
    v = rep.get("var") or {}
    if m == "VAR_99_1D": return v.get("var_1d")
    if m == "VAR_95_1D": return v.get("var_1d_secondary")
    if m == "ES_99_1D": return v.get("es_1d")
    if m == "VAR_H": return v.get("var_h")
    if m == "NPV": return abs(sum(r["npv"] * r.get("usd_rate", 0.0) for r in scope_rows))
    if m == "IR01": return abs(sum(r["ir01"] * r.get("usd_rate", 0.0) for r in scope_rows))
    if m.startswith("IR01:"):
        cid = m.split(":", 1)[1]
        return abs(sum(sum(r["kr01"].get(cid, {}).values()) * r.get("usd_rate", 0.0) for r in scope_rows))
    if m.startswith("KR01:"):
        _, cid, b = (m.split(":") + [None, None])[:3]
        return abs(sum(r["kr01"].get(cid, {}).get(b, 0.0) * r.get("usd_rate", 0.0) for r in scope_rows))
    if m.startswith("SPOT01:"):
        a = m.split(":", 1)[1]
        return abs(sum(r["spot01"].get(a, 0.0) * r.get("usd_rate", 0.0) for r in scope_rows))
    if m.startswith("STRESS:"):
        sid = m.split(":", 1)[1]
        s = next((x for x in rep.get("stress", []) if x["id"] == sid), None)
        return max(0.0, -s["pnl_usd"]) if s else None
    # counterparty credit: PFE_PEAK:<cp>, PFE:<cp>:<bucket>, EPE:<cp>, CVA:<cp>, CE:<cp> (names upper-cased)
    ccr = {k.upper(): v for k, v in (rep.get("ccr") or {}).items()}
    if m.startswith(("PFE_PEAK:", "EPE:", "CVA:", "CE:")):
        kind, name = m.split(":", 1)
        c = ccr.get(name)
        if not c:
            return None
        return {"PFE_PEAK": c["exposure"]["peak_pfe95_usd"], "EPE": c["exposure"]["epe_1y_usd"], "CVA": abs(c["cva"]["cva_usd"]),
                "CE": c["exposure"]["current_exposure_usd"]}[kind]
    if m.startswith("PFE:"):
        parts = m.split(":")
        if len(parts) == 3:
            c = ccr.get(parts[1])
            return c["exposure"]["pfe95_by_bucket"].get(parts[2]) if c else None
    return None


def evaluate(limits: list[dict], rep: dict) -> list[dict]:
    rows = rep.get("ladder_rows") or []
    out = []
    for lim in limits:
        scope = lim["scope"].upper()
        in_scope = rows if scope == "ALL" else [r for r in rows if (r["desk"] if scope == "DESK" else r["book"]) == lim["scope_name"]]
        if scope != "ALL" and lim["metric"].upper().startswith(("VAR", "ES", "STRESS", "PFE", "EPE", "CVA", "CE")):
            val = None                                  # VaR and stress are book-level numbers in this foundation
            note = "book-level metric; set the limit on scope ALL"
        else:
            val = metric_value(lim["metric"], rep, in_scope); note = None
        util = (abs(val) / lim["limit"] * 100.0) if (val is not None and lim["limit"]) else None
        status = "NA" if util is None else "BREACH" if util >= 100 else "WARN" if util >= lim["warn_pct"] else "OK"
        out.append({**lim, "value": val, "utilisation_pct": util, "status": status, "note_eval": note})
    return out
