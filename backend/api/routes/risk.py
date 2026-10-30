"""
GET  /api/risk/report?date=             ladder, VaR, stress, limits for the caller's book
GET  /api/risk/trend                    stored daily VaR / IR01 / NPV / breaches
GET  /api/risk/limits · POST · DELETE   the firm's limits (risk manager or admin writes)
GET  /api/risk/metrics                  metric keys a limit can be set on, from the caller's book
GET  /api/risk/settings · PUT           the firm's VaR settings (risk manager or admin writes)
GET  /api/risk/history                  how much risk-factor history exists
POST /api/risk/history/backfill         cron or admin: start fetching and storing public history (years=) in the background
POST /api/risk/daily/tick               cron: compute and store today's report for every account
"""
from __future__ import annotations

import logging
import os
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from middleware.auth import verify_token
from risk import limits as L
from risk import report as R
from risk import stress as ST

log = logging.getLogger("rijeka.risk")
router = APIRouter(prefix="/api/risk", tags=["risk"])
WRITE_ROLES = {"risk", "admin"}


def _parse(d: Optional[str]) -> Optional[date]:
    try:
        return date.fromisoformat(d) if d else None
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")


def _ctx(db: Session, user: dict) -> dict:
    from api.routes.pnl import _marking_ctx
    return _marking_ctx(db, user)


def _role(db: Session, user: dict) -> str:
    from api.routes.pnl import _role
    return _role(db, user)


def _name(user: dict) -> str:
    from api.routes.pnl import _name
    return _name(user)


def _firm_or_404(db: Session, user: dict):
    f = R.firm_of(db, user["sub"])
    if f is None:
        raise HTTPException(status_code=404, detail="Your account is not in a firm.")
    return f


def _can_write(db: Session, user: dict) -> bool:
    if _role(db, user) in WRITE_ROLES:
        return True
    from db.models import FirmMember
    fm = db.query(FirmMember).filter(FirmMember.user_id == user["sub"]).first()
    return bool(fm and fm.role == "ADMIN")


def _secret_ok(given: Optional[str]) -> bool:
    want = os.environ.get("RIJEKA_CRON_SECRET")
    return bool(want) and given == want


@router.get("/report")
def risk_report(date_: Optional[str] = Query(default=None, alias="date"), db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    rep = R.report(db, _ctx(db, user), _parse(date_))
    rep["can_write"] = _can_write(db, user)
    rep["role"] = _role(db, user)
    return rep


@router.get("/trend")
def risk_trend(days: int = 60, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return {"trend": R.trend(db, user["sub"], max(1, min(days, 400)))}


@router.get("/limits")
def get_limits(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    f = _firm_or_404(db, user)
    return {"limits": L.list_limits(db, f), "can_write": _can_write(db, user), "metric_help": L.METRIC_HELP, "tables": L.tables_present(db)}


class LimitBody(BaseModel):
    metric: str
    scope: str = "ALL"
    scope_name: Optional[str] = None
    limit: float
    warn_pct: float = 80.0
    note: str = ""


@router.post("/limits", status_code=201)
def post_limit(body: LimitBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    f = _firm_or_404(db, user)
    if not _can_write(db, user):
        raise HTTPException(status_code=403, detail="Setting limits needs the risk or admin role, or firm admin.")
    if not L.tables_present(db):
        raise HTTPException(status_code=409, detail="tables missing: apply docs/migrations/2026-10-30_market_risk.sql")
    if body.scope.upper() not in ("ALL", "DESK", "BOOK"):
        raise HTTPException(status_code=422, detail="scope must be ALL, DESK or BOOK")
    if body.scope.upper() != "ALL" and not body.scope_name:
        raise HTTPException(status_code=422, detail="scope_name is required for DESK and BOOK")
    if body.limit <= 0:
        raise HTTPException(status_code=422, detail="limit must be positive")
    L.add_limit(db, f, body.metric, body.scope, body.scope_name, body.limit, body.warn_pct, body.note, user["sub"], _name(user))
    return {"limits": L.list_limits(db, f)}


@router.delete("/limits/{limit_id}")
def delete_limit(limit_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    f = _firm_or_404(db, user)
    if not _can_write(db, user):
        raise HTTPException(status_code=403, detail="Removing limits needs the risk or admin role, or firm admin.")
    n = L.remove_limit(db, f, limit_id)
    if not n:
        raise HTTPException(status_code=404, detail="No such limit in your firm.")
    return {"limits": L.list_limits(db, f)}


@router.get("/metrics")
def metrics(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Keys a limit can be set on, from what the caller's book actually reports."""
    rep = R.report(db, _ctx(db, user))
    keys = ["VAR_99_1D", "VAR_95_1D", "ES_99_1D", "VAR_H", "NPV", "IR01"]
    for row in rep["ladder"].get("ladder", []):
        keys.append(f"IR01:{row['curve']}")
        keys += [f"KR01:{row['curve']}:{b}" for b in row["buckets"]]
    keys += [f"SPOT01:{a}" for a in rep["ladder"].get("spot01", {})]
    keys += [f"STRESS:{s['id']}" for s in ST.SCENARIOS]
    desks = sorted({r["desk"] for r in rep.get("ladder_rows", [])}); books = sorted({r["book"] for r in rep.get("ladder_rows", [])})
    return {"metrics": keys, "desks": desks, "books": books, "scenarios": [{"id": s["id"], "name": s["name"]} for s in ST.SCENARIOS], "help": L.METRIC_HELP}


class SettingsBody(BaseModel):
    confidence: Optional[float] = None
    secondary_confidence: Optional[float] = None
    horizon_days: Optional[int] = None
    window_days: Optional[int] = None
    min_observations: Optional[int] = None
    var_method: Optional[str] = None          # FULL_REVAL | LADDER
    ccr_sampling: Optional[str] = None        # HISTORICAL | GAUSSIAN  (the real-world exposure run)
    ccr_paths: Optional[int] = None
    ccr_drift: Optional[str] = None           # zero | historical


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    f = R.firm_of(db, user["sub"])
    return {**R.settings(db, f), "can_write": _can_write(db, user), "tables": L.tables_present(db)}


@router.put("/settings")
def put_settings(body: SettingsBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    f = _firm_or_404(db, user)
    if not _can_write(db, user):
        raise HTTPException(status_code=403, detail="VaR settings need the risk or admin role, or firm admin.")
    if not L.tables_present(db):
        raise HTTPException(status_code=409, detail="tables missing: apply docs/migrations/2026-10-30_market_risk.sql")
    b = body.model_dump()
    if b.get("confidence") is not None and not (0.5 < b["confidence"] < 1):
        raise HTTPException(status_code=422, detail="confidence must be between 0.5 and 1")
    if b.get("window_days") is not None and not (30 <= b["window_days"] <= 3650):
        raise HTTPException(status_code=422, detail="window_days must be 30..3650")
    if b.get("var_method") is not None and b["var_method"] not in R.VAR_METHODS:
        raise HTTPException(status_code=422, detail=f"var_method must be one of {R.VAR_METHODS}")
    if b.get("ccr_sampling") is not None and b["ccr_sampling"] not in R.CCR_SAMPLINGS:
        raise HTTPException(status_code=422, detail=f"ccr_sampling must be one of {R.CCR_SAMPLINGS}")
    if b.get("ccr_paths") is not None and not (200 <= b["ccr_paths"] <= 20000):
        raise HTTPException(status_code=422, detail="ccr_paths must be 200..20000")
    if b.get("ccr_drift") is not None and b["ccr_drift"] not in ("zero", "historical"):
        raise HTTPException(status_code=422, detail="ccr_drift must be zero or historical")
    return R.save_settings(db, f, b, user["sub"], _name(user))


_backfill: dict = {"running": False, "started": None, "finished": None, "result": None, "error": None}


def _run_backfill(tpl, years: float, overwrite: bool) -> None:
    from db.session import SessionLocal
    from risk import history as H
    import datetime as _dt
    _backfill.update(running=True, started=_dt.datetime.now(_dt.timezone.utc).isoformat(), finished=None, result=None, error=None)
    db = SessionLocal()
    try:
        _backfill["result"] = H.backfill(db, tpl, years=years, overwrite=overwrite)
    except Exception as e:              # noqa: BLE001
        db.rollback(); _backfill["error"] = str(e)[:300]
        log.warning("backfill failed: %s", e)
    finally:
        db.close()
        _backfill.update(running=False, finished=_dt.datetime.now(_dt.timezone.utc).isoformat())


@router.get("/history")
def history_status(db: Session = Depends(get_db), x_rijeka_cron: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    from risk import history as H
    if not _secret_ok(x_rijeka_cron):
        if not authorization:
            raise HTTPException(status_code=401, detail="Missing auth")
        import asyncio
        asyncio.run(verify_token(authorization))
    tpl = R.template_uid(db)
    return {"template": str(tpl) if tpl else None, "series": H.status(db, tpl) if tpl else {}, "backfill": _backfill}


@router.post("/history/backfill")
def backfill(years: float = Query(default=2.0), overwrite: bool = Query(default=False), db: Session = Depends(get_db),
             x_rijeka_cron: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    from risk import history as H
    if not _secret_ok(x_rijeka_cron):
        if not authorization:
            raise HTTPException(status_code=401, detail="Missing auth")
        import asyncio
        user = asyncio.run(verify_token(authorization))
        if not _can_write(db, user):
            raise HTTPException(status_code=403, detail="Backfill needs the risk or admin role.")
    tpl = R.template_uid(db)
    if tpl is None:
        raise HTTPException(status_code=409, detail="No template account.")
    if _backfill["running"]:
        return {"started": False, "reason": "a backfill is already running", "backfill": _backfill}
    import threading
    threading.Thread(target=_run_backfill, args=(tpl, max(0.1, min(years, 10.0)), overwrite), daemon=True).start()
    return {"started": True, "years": years, "note": "running in the background; GET /api/risk/history reports progress and the result"}


@router.post("/history/ingest")
def ingest_history(payload: dict, overwrite: bool = Query(default=False), db: Session = Depends(get_db), x_rijeka_cron: Optional[str] = Header(None)):
    """History built elsewhere (a runner, a desk) for sites that refuse this server's address:
    {curve_id: {YYYY-MM-DD: quotes}}, stored as the template account's snapshots."""
    from risk import history as H
    if not _secret_ok(x_rijeka_cron):
        raise HTTPException(status_code=403, detail="bad cron secret")
    tpl = R.template_uid(db)
    if tpl is None:
        raise HTTPException(status_code=409, detail="No template account.")
    days: dict = {}
    for cid, by_date in (payload or {}).items():
        if not isinstance(by_date, dict):
            continue
        for ds, quotes in by_date.items():
            try:
                d = date.fromisoformat(ds)
            except ValueError:
                continue
            if isinstance(quotes, list) and quotes:
                days.setdefault(str(cid)[:40], {})[d] = quotes
    written = H.store(db, tpl, days, overwrite=overwrite)
    return {"received": {c: len(v) for c, v in days.items()}, "written": written}


@router.post("/daily/tick")
def daily_tick(db: Session = Depends(get_db), x_rijeka_cron: Optional[str] = Header(None)):
    if not _secret_ok(x_rijeka_cron):
        raise HTTPException(status_code=403, detail="bad cron secret")
    if not L.tables_present(db):
        return {"stored": False, "reason": "tables missing: apply docs/migrations/2026-10-30_market_risk.sql"}
    from api.routes.pnl import _as_user
    users = [str(r.user_id) for r in db.execute(text("SELECT DISTINCT user_id FROM trades")).all()]
    done, failed = [], []
    for uid in users:
        try:
            ctx = _as_user(db, uid)
            rep = R.report(db, ctx)
            out = R.store(db, ctx, rep)
            done.append({"user": uid[:8], **out})
        except Exception as e:          # noqa: BLE001
            db.rollback(); failed.append({"user": uid[:8], "error": str(e)[:160]})
            log.warning("risk daily for %s failed: %s", uid[:8], e)
    return {"accounts": len(users), "done": done, "failed": failed}
