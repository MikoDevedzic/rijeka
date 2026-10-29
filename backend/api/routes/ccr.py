"""
GET  /api/ccr/report                    the latest stored run (fast); ?live=1 computes now; ?date=
POST /api/ccr/run?counterparty=         compute in the background and store; GET /api/ccr/status for progress
GET  /api/ccr/status
POST /api/ccr/daily/tick                cron: run and store for every account (after end of day)
Engine: backend/ccr. Exposure and limits are real-world; CVA is risk-neutral; both say so.
"""
from __future__ import annotations

import datetime as _dt
import logging
import os
import threading
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ccr import report as R
from db.session import get_db
from middleware.auth import verify_token

log = logging.getLogger("rijeka.ccr")
router = APIRouter(prefix="/api/ccr", tags=["ccr"])
_jobs: dict[str, dict] = {}


def _parse(d: Optional[str]) -> Optional[date]:
    try:
        return date.fromisoformat(d) if d else None
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")


def _ctx(db: Session, user: dict) -> dict:
    from api.routes.pnl import _marking_ctx
    return _marking_ctx(db, user)


def _secret_ok(given: Optional[str]) -> bool:
    want = os.environ.get("RIJEKA_CRON_SECRET")
    return bool(want) and given == want


@router.get("/report")
def ccr_report(live: bool = Query(default=False), date_: Optional[str] = Query(default=None, alias="date"), db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    if not live:
        stored = R.latest_stored(db, user["sub"])
        if stored:
            stored["job"] = _jobs.get(user["sub"])
            return stored
    rep = R.report(db, _ctx(db, user), _parse(date_))
    rep["job"] = _jobs.get(user["sub"])
    rep["from_store"] = False
    return rep


def _run(ctx: dict, counterparty: Optional[str]) -> None:
    from db.session import SessionLocal
    uid = ctx["sub"]
    job = _jobs.setdefault(uid, {})
    job.update(running=True, started=_dt.datetime.now(_dt.timezone.utc).isoformat(), finished=None, error=None, current=None, done=0, total=0)
    db = SessionLocal()
    try:
        rep = R.report(db, ctx, None, only_counterparty=counterparty, progress=job)
        out = R.store(db, ctx, rep)
        job.update(result={"counterparties": len(rep["counterparties"]), **out, "seconds": sum(c.get("seconds", 0) for c in rep["counterparties"])})
    except Exception as e:              # noqa: BLE001
        db.rollback(); job["error"] = str(e)[:300]
        log.warning("ccr run for %s failed: %s", uid[:8], e)
    finally:
        db.close()
        job.update(running=False, finished=_dt.datetime.now(_dt.timezone.utc).isoformat())


@router.post("/run")
def run(counterparty: Optional[str] = Query(default=None), db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    uid = user["sub"]
    if _jobs.get(uid, {}).get("running"):
        return {"started": False, "reason": "a run is already in progress", "job": _jobs[uid]}
    threading.Thread(target=_run, args=(_ctx(db, user), counterparty), daemon=True).start()
    return {"started": True, "note": "running in the background; GET /api/ccr/status reports progress, GET /api/ccr/report returns the stored result"}


@router.get("/status")
def status(user: dict = Depends(verify_token)):
    return {"job": _jobs.get(user["sub"]), "tables": None}


@router.post("/daily/tick")
def daily_tick(db: Session = Depends(get_db), x_rijeka_cron: Optional[str] = Header(None)):
    if not _secret_ok(x_rijeka_cron):
        raise HTTPException(status_code=403, detail="bad cron secret")
    if not R.tables_present(db):
        return {"stored": False, "reason": "tables missing: apply docs/migrations/2026-10-31_ccr.sql"}
    from api.routes.pnl import _as_user
    users = [str(r.user_id) for r in db.execute(text("SELECT DISTINCT user_id FROM trades WHERE status IN ('PENDING','CONFIRMED','LIVE')")).all()]
    done, failed = [], []
    for uid in users:
        try:
            ctx = _as_user(db, uid)
            rep = R.report(db, ctx)
            out = R.store(db, ctx, rep)
            done.append({"user": uid[:8], **out, "breaches": rep.get("breaches", 0)})
        except Exception as e:          # noqa: BLE001
            db.rollback(); failed.append({"user": uid[:8], "error": str(e)[:160]})
    return {"accounts": len(users), "done": done, "failed": failed}
