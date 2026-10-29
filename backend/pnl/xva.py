"""XVA in the P&L: the reserve levels per counterparty from the risk-neutral netted run
(backend/ccr, the same engine as the credit page), their day-on-day change as the XVA P&L,
and the firm's policy on which components net into the signed figure.

    P&L after XVA = clean P&L − Σ_netted (level_today − level_prev)

Levels are costs negative and benefits positive (CVA −, DVA +, FVA −, FBA +, KVA −, MVA −),
so a rising cost is a negative change, which is a loss. Previous levels come from the stored
daily counterparty run (ccr_daily); without it the levels are shown and the change is not
invented."""
from __future__ import annotations

import logging
from datetime import date
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger("rijeka.pnl")
COMPONENTS = ("cva", "dva", "fva", "fba", "kva", "mva")
DEFAULT_NETTED = ("CVA", "DVA", "FVA", "FBA")


def levels_today(db: Session, user: dict, asof: date) -> dict[str, Any]:
    from ccr import report as CR
    rep = CR.report(db, user, asof, exposure=False)
    by_cp = {}
    for c in rep.get("counterparties", []):
        if c.get("empty") or not c.get("xva"):
            continue
        by_cp[c["counterparty"]] = {k: float(c["xva"].get(f"{k}_usd") or 0.0) for k in COMPONENTS}
    return {"by_counterparty": by_cp, "total": _sum(by_cp.values()), "measure": "RISK_NEUTRAL", "date": rep.get("date"),
            "params": next(({"cp_cds_bp": c["xva"]["cp_cds_bp"], "lgd": c["xva"]["lgd"]} for c in rep.get("counterparties", []) if c.get("xva")), None)}


def _sum(rows) -> dict[str, float]:
    out = {k: 0.0 for k in COMPONENTS}
    for r in rows:
        for k in COMPONENTS:
            out[k] += float(r.get(k) or 0.0)
    return out


def stored_levels(db: Session, uid: str, upto: date, strictly_before: bool = True) -> Optional[tuple[date, dict[str, float], dict[str, dict]]]:
    """(date, totals, by counterparty) of the latest stored counterparty run on or before `upto`."""
    from ccr.report import tables_present
    if not tables_present(db):
        return None
    try:
        d = db.execute(text("SELECT max(run_date) FROM ccr_daily WHERE user_id = :u AND run_date " + ("<" if strictly_before else "<=") + " :d"), {"u": uid, "d": upto}).scalar()
        if d is None:
            return None
        rows = db.execute(text("SELECT counterparty, report FROM ccr_daily WHERE user_id = :u AND run_date = :d"), {"u": uid, "d": d}).all()
    except Exception as e:
        log.debug("xva stored: %s", e); db.rollback(); return None
    by_cp = {}
    for r in rows:
        x = (r.report or {}).get("xva") or (r.report or {}).get("cva") or {}
        if x:
            by_cp[r.counterparty] = {k: float(x.get(f"{k}_usd") or 0.0) for k in COMPONENTS}
    return d, _sum(by_cp.values()), by_cp


def section(db: Session, user: dict, asof: date, netted: tuple[str, ...] = DEFAULT_NETTED) -> dict[str, Any]:
    uid = user["sub"]
    today = levels_today(db, user, asof)
    prev = stored_levels(db, uid, asof, strictly_before=True)
    month_base = stored_levels(db, uid, asof.replace(day=1), strictly_before=True)
    year_base = stored_levels(db, uid, asof.replace(month=1, day=1), strictly_before=True)
    netted_keys = tuple(k.upper() for k in netted)
    def change(base):
        if base is None:
            return None
        ch = {k: today["total"][k] - base[1][k] for k in COMPONENTS}
        return {"from": base[0].isoformat(), "by_component": ch, "netted": sum(v for k, v in ch.items() if k.upper() in netted_keys),
                "all": sum(ch.values())}
    per_cp = []
    for name, lv in today["by_counterparty"].items():
        pv = (prev[2].get(name) if prev else None)
        per_cp.append({"counterparty": name, "today": lv, "prev": pv, "change": {k: lv[k] - pv[k] for k in COMPONENTS} if pv else None})
    return {"measure": "RISK_NEUTRAL", "components": list(COMPONENTS), "netted": list(netted_keys), "levels": today["total"], "levels_date": today["date"],
            "prev_date": prev[0].isoformat() if prev else None, "day": change(prev), "mtd": change(month_base), "ytd": change(year_base),
            "by_counterparty": per_cp, "params": today["params"],
            "note": "Levels from the risk-neutral netted run per counterparty; changes against the stored daily run. Costs negative, benefits positive; a rising cost is a loss."}
