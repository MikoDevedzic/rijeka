"""The risk report for a book on a date: the ladder, VaR, stress, limits, history status;
its daily storage; the firm's settings."""
from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from db.models import FirmMember, Trade
from pnl.market import Market
from pnl.report import REPORTING_CCY, fx_to_usd
from risk import history as H
from risk import limits as L
from risk import sensitivities as S
from risk import stress as ST
from risk import var as V
from risk import var_full as VF

log = logging.getLogger("rijeka.risk")


def template_uid(db: Session):
    from api.routes.demo import _template_user_id
    return _template_user_id(db)


def firm_of(db: Session, uid: str):
    fm = db.query(FirmMember).filter(FirmMember.user_id == uid).first()
    return fm.firm_id if fm else None


METHOD_DEFAULTS = {"var_method": "FULL_REVAL", "ccr_sampling": "HISTORICAL", "ccr_paths": 2000, "ccr_drift": "zero"}
VAR_METHODS = ("FULL_REVAL", "LADDER")
CCR_SAMPLINGS = ("HISTORICAL", "GAUSSIAN")
_BASE_COLS = "confidence, secondary_confidence, horizon_days, window_days, min_observations, updated_by_name, updated_at"
_METHOD_COLS = "var_method, ccr_sampling, ccr_paths, ccr_drift"


def settings(db: Session, firm_id) -> dict:
    out = {**V.DEFAULTS, **METHOD_DEFAULTS}
    if firm_id is None or not L.tables_present(db):
        return {**out, "stored": False}
    r = None
    for cols in (_BASE_COLS + ", " + _METHOD_COLS, _BASE_COLS):      # the method columns arrive with 2026-10-31_risk_methods.sql
        try:
            r = db.execute(text(f"SELECT {cols} FROM risk_settings WHERE firm_id = :f"), {"f": str(firm_id)}).first()
            break
        except Exception:
            db.rollback()
    if r is None:
        return {**out, "stored": False}
    got = {"confidence": float(r.confidence), "secondary_confidence": float(r.secondary_confidence), "horizon_days": int(r.horizon_days),
           "window_days": int(r.window_days), "min_observations": int(r.min_observations), "updated_by": r.updated_by_name,
           "updated_at": r.updated_at.isoformat() if r.updated_at else None, "stored": True}
    for k in METHOD_DEFAULTS:
        v = getattr(r, k, None)
        got[k] = (int(v) if k == "ccr_paths" else str(v)) if v is not None else METHOD_DEFAULTS[k]
    return {**out, **got}


def save_settings(db: Session, firm_id, body: dict, by: str, by_name: str) -> dict:
    cur = settings(db, firm_id)
    s = {**cur, **{k: body[k] for k in {**V.DEFAULTS, **METHOD_DEFAULTS} if k in body and body[k] is not None}}
    params = {"f": str(firm_id), "c": s["confidence"], "c2": s["secondary_confidence"], "h": s["horizon_days"], "w": s["window_days"],
              "m": s["min_observations"], "b": by, "bn": by_name, "vm": s["var_method"], "cs": s["ccr_sampling"], "cp": int(s["ccr_paths"]), "cd": s["ccr_drift"]}
    full = ("INSERT INTO risk_settings (firm_id, confidence, secondary_confidence, horizon_days, window_days, min_observations, updated_by, updated_by_name, updated_at, "
            "var_method, ccr_sampling, ccr_paths, ccr_drift) VALUES (:f, :c, :c2, :h, :w, :m, :b, :bn, now(), :vm, :cs, :cp, :cd) "
            "ON CONFLICT (firm_id) DO UPDATE SET confidence = EXCLUDED.confidence, secondary_confidence = EXCLUDED.secondary_confidence, "
            "horizon_days = EXCLUDED.horizon_days, window_days = EXCLUDED.window_days, min_observations = EXCLUDED.min_observations, "
            "updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = now(), var_method = EXCLUDED.var_method, "
            "ccr_sampling = EXCLUDED.ccr_sampling, ccr_paths = EXCLUDED.ccr_paths, ccr_drift = EXCLUDED.ccr_drift")
    base = ("INSERT INTO risk_settings (firm_id, confidence, secondary_confidence, horizon_days, window_days, min_observations, updated_by, updated_by_name, updated_at) "
            "VALUES (:f, :c, :c2, :h, :w, :m, :b, :bn, now()) ON CONFLICT (firm_id) DO UPDATE SET confidence = EXCLUDED.confidence, "
            "secondary_confidence = EXCLUDED.secondary_confidence, horizon_days = EXCLUDED.horizon_days, window_days = EXCLUDED.window_days, "
            "min_observations = EXCLUDED.min_observations, updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = now()")
    try:
        db.execute(text(full), params)
    except Exception:                      # the method columns are not there yet: keep the base parameters
        db.rollback()
        db.execute(text(base), params)
    db.commit()
    return settings(db, firm_id)


def report(db: Session, user: dict, d: Optional[date] = None) -> dict[str, Any]:
    uid = user["sub"]
    dates = Market.dates(db, uid, upto=d or date.today())
    if not dates:
        return {"date": None, "note": "No market dates: save or snap a curve first.", "ladder": {"rows": [], "ladder": []}, "var": {}, "stress": [], "limits": []}
    d = d if d and d in dates else dates[-1]
    mkt = Market(db, uid, d)
    fx = lambda ccy: fx_to_usd(mkt, ccy)
    trades = db.query(Trade).filter(Trade.user_id == uid).all()
    lad = S.book_ladder(db, user, trades, d, mkt, fx)
    firm_id = firm_of(db, uid)
    st = settings(db, firm_id)
    tpl = template_uid(db)
    var = V.compute(db, tpl, lad["ladder"], lad["spot01"], d, st) if tpl else {"observations": 0, "enough": False, "missing_factors": []}
    if tpl and st.get("var_method", "FULL_REVAL") == "FULL_REVAL":
        # the headline VaR reprices the book on each historical day; the ladder VaR rides along as the linear comparison
        var = VF.compute(db, user, tpl, trades, d, mkt, fx, st, linear=var)
    stress = ST.run(db, user, trades, d, mkt, fx)
    rep = {"date": d.isoformat(), "dates": [x.isoformat() for x in dates[-40:]], "reporting_ccy": REPORTING_CCY, "settings": st,
           "ladder": {k: v for k, v in lad.items() if k != "rows"}, "ladder_rows": lad["rows"], "var": var, "stress": stress,
           "scenarios": [{k: s[k] for k in ("id", "name", "group")} for s in ST.SCENARIOS],
           "history": H.status(db, tpl) if tpl else {}, "firm_id": str(firm_id) if firm_id else None,
           "generated_at": datetime.now(timezone.utc).isoformat()}
    lims = L.list_limits(db, firm_id)
    rep["limits"] = L.evaluate(lims, rep)
    rep["breaches"] = sum(1 for x in rep["limits"] if x["status"] == "BREACH")
    rep["warnings"] = sum(1 for x in rep["limits"] if x["status"] == "WARN")
    rep["tables"] = L.tables_present(db)
    return rep


def store(db: Session, user: dict, rep: dict) -> dict:
    if not L.tables_present(db) or not rep.get("date"):
        return {"stored": False}
    slim = {k: v for k, v in rep.items() if k not in ("ladder_rows",)}
    slim["var"] = {k: v for k, v in (rep.get("var") or {}).items() if k not in ("series", "histogram")}
    db.execute(text("INSERT INTO risk_daily (id, user_id, risk_date, report, var_1d, ir01_usd, npv_usd, breaches) "
                    "VALUES (:id, :u, :d, CAST(:r AS jsonb), :v, :i, :n, :b) ON CONFLICT (user_id, risk_date) DO UPDATE SET report = EXCLUDED.report, "
                    "var_1d = EXCLUDED.var_1d, ir01_usd = EXCLUDED.ir01_usd, npv_usd = EXCLUDED.npv_usd, breaches = EXCLUDED.breaches, created_at = now()"),
               {"id": str(uuid.uuid4()), "u": user["sub"], "d": rep["date"], "r": json.dumps(slim, default=str),
                "v": None if (rep.get("var") or {}).get("var_1d") is None else float((rep.get("var") or {}).get("var_1d")),
                "i": None if rep["ladder"].get("ir01_usd") is None else float(rep["ladder"].get("ir01_usd")),
                "n": None if rep["ladder"].get("npv_usd") is None else float(rep["ladder"].get("npv_usd")), "b": int(rep.get("breaches", 0))})
    db.commit()
    return {"stored": True, "date": rep["date"], "breaches": rep.get("breaches", 0)}


def latest_stored(db: Session, uid: str) -> Optional[dict]:
    if not L.tables_present(db):
        return None
    try:
        r = db.execute(text("SELECT risk_date, var_1d, ir01_usd, npv_usd, breaches, report FROM risk_daily WHERE user_id = :u ORDER BY risk_date DESC LIMIT 1"), {"u": uid}).first()
    except Exception:
        db.rollback(); return None
    if r is None:
        return None
    return {"date": r.risk_date.isoformat(), "var_1d": float(r.var_1d) if r.var_1d is not None else None, "ir01_usd": float(r.ir01_usd) if r.ir01_usd is not None else None,
            "npv_usd": float(r.npv_usd) if r.npv_usd is not None else None, "breaches": int(r.breaches or 0),
            "limits": [x for x in (r.report or {}).get("limits", []) if x.get("status") in ("BREACH", "WARN")]}


def trend(db: Session, uid: str, days: int = 60) -> list[dict]:
    if not L.tables_present(db):
        return []
    try:
        rows = db.execute(text("SELECT risk_date, var_1d, ir01_usd, npv_usd, breaches FROM risk_daily WHERE user_id = :u ORDER BY risk_date DESC LIMIT :n"), {"u": uid, "n": days}).all()
    except Exception:
        db.rollback(); return []
    return [{"date": r.risk_date.isoformat(), "var_1d": float(r.var_1d) if r.var_1d is not None else None, "ir01_usd": float(r.ir01_usd) if r.ir01_usd is not None else None,
             "npv_usd": float(r.npv_usd) if r.npv_usd is not None else None, "breaches": int(r.breaches or 0)} for r in reversed(rows)]
