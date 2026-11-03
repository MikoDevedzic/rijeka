"""
GET  /api/ccr/report                    the latest stored run (fast); ?live=1 computes now; ?date=
POST /api/ccr/run?counterparty=         compute in the background and store; GET /api/ccr/status for progress
GET  /api/ccr/status
    The run goes to the worker (jobs/queue.py, a row the worker claims) when the jobs table exists and a
    worker is expected (RIJEKA_WORKER, default on under Render); otherwise a thread of this process, as before.
    Status reads the job row with the in-memory dict as the fallback, in the same shape either way.
POST /api/ccr/daily/tick                cron: run and store for every account (after end of day)
Engine: backend/ccr. Exposure and limits are real-world; CVA is risk-neutral; both say so.
"""
from __future__ import annotations

import hmac

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
from jobs import queue as Q
from middleware.auth import verify_token
from api.routes._limits import heavy

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
    return bool(want) and given is not None and hmac.compare_digest(given, want)


@router.get("/report")
def ccr_report(live: bool = Query(default=False), date_: Optional[str] = Query(default=None, alias="date"), db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    if not live:
        stored = R.latest_stored(db, user["sub"])
        if stored:
            stored["job"] = _job_view(db, user["sub"])
            return stored
    heavy(user, "counterparty run", 4)          # a live report is the Monte Carlo in the request thread
    rep = R.report(db, _ctx(db, user), _parse(date_))
    rep["job"] = _job_view(db, user["sub"])
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


def _job_view(db: Session, uid: str) -> Optional[dict]:
    """The user's latest run: the job row when the table exists, the in-memory dict otherwise; when both
    exist, whichever is in flight, else the more recent."""
    mem = _jobs.get(uid)
    row = None
    if Q.tables_present(db):
        try:
            row = Q.as_status(Q.latest(db, uid, "ccr_run"))
        except Exception:               # noqa: BLE001
            db.rollback(); row = None
    if row is None or mem is None:
        return row or mem
    if row["running"] != bool(mem.get("running")):
        return row if row["running"] else mem
    return row if (row.get("started") or "") >= (mem.get("started") or "") else mem


@router.post("/run")
def run(counterparty: Optional[str] = Query(default=None), db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    uid = user["sub"]
    heavy(user, "counterparty run", 4)
    current = _job_view(db, uid)
    if current and current.get("running"):
        return {"started": False, "reason": "a run is already in progress", "job": current}
    if Q.worker_expected(db):
        jid = Q.enqueue(db, uid, "ccr_run", {"ctx": _ctx(db, user), "counterparty": counterparty})
        return {"started": True, "job": Q.as_status(Q.latest(db, uid, "ccr_run")), "job_id": jid,
                "note": "queued for the worker; GET /api/ccr/status reports progress, GET /api/ccr/report returns the stored result"}
    threading.Thread(target=_run, args=(_ctx(db, user), counterparty), daemon=True).start()
    return {"started": True, "note": "running in the background; GET /api/ccr/status reports progress, GET /api/ccr/report returns the stored result"}


@router.get("/status")
def status(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return {"job": _job_view(db, user["sub"]), "tables": None, "worker": Q.worker_expected(db)}



def _market_date(db: Session, uid: str):
    """The latest market date an account's batch would be stored under; None when it has no data."""
    try:
        from pnl.market import Market
        ds = Market.dates(db, uid)
        return max(ds) if ds else None
    except Exception:           # noqa: BLE001
        db.rollback(); return None


@router.post("/daily/tick")
def daily_tick(db: Session = Depends(get_db), x_rijeka_cron: Optional[str] = Header(None)):
    if not _secret_ok(x_rijeka_cron):
        raise HTTPException(status_code=403, detail="bad cron secret")
    if not R.tables_present(db):
        return {"stored": False, "reason": "tables missing: apply docs/migrations/2026-10-31_ccr.sql"}
    from api.routes.pnl import _as_user
    users = [str(r.user_id) for r in db.execute(text("SELECT DISTINCT user_id FROM trades WHERE status IN ('PENDING','CONFIRMED','LIVE')")).all()]
    done, failed, skipped = [], [], []
    for uid in users:
        try:
            md = _market_date(db, uid)
            latest = R.latest_stored(db, uid)
            if md is not None and latest and latest.get("date") == md.isoformat():
                skipped.append(uid[:8]); continue          # already stored for this market date
            ctx = _as_user(db, uid)
            rep = R.report(db, ctx)
            out = R.store(db, ctx, rep)
            done.append({"user": uid[:8], **out, "breaches": rep.get("breaches", 0)})
        except Exception as e:          # noqa: BLE001
            db.rollback(); failed.append({"user": uid[:8], "error": str(e)[:160]})
    return {"accounts": len(users), "done": done, "failed": failed, "skipped": skipped}
