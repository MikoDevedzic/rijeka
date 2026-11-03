"""
ipv.py — independent price verification under P&L.

GET  /api/ipv/run?date=&level=&name=&live=1   the stored run (or built now)
POST /api/ipv/run                               build (the worker when expected, else a thread); GET /run/status
PUT  /api/ipv/override                          {date, level, name, curve_id, pillar, value, reason}  (controller)
DELETE /api/ipv/override/{id}                   withdraw
POST /api/ipv/inputs/approve | /inputs/waive    {date, level, name, curve_id, reason}  (controller)
POST /api/ipv/apply                             the full revaluation on the overrides (the second-order line)
POST /api/ipv/signoff                           {date, level, name, comment}: the gate, then the official P&L (controller)
GET/POST/DELETE /api/ipv/tolerances             the firm's rules (risk, controller, admin write)
POST /api/ipv/independent                       {curve_id, date, quotes, source}: an independent mark (controller)
"""
from __future__ import annotations

import datetime as _dt
import threading
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.routes._errors import internal
from api.routes._limits import heavy
from db.session import get_db
from ipv import run as RUN
from ipv import store as S
from jobs import queue as Q
from middleware.auth import verify_token

router = APIRouter(prefix="/api/ipv", tags=["ipv"])
_jobs: dict[str, dict] = {}


def _parse(d: Optional[str]) -> date:
    try:
        return date.fromisoformat(d) if d else date.today()
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")


def _scope(level: Optional[str], name: Optional[str]) -> dict:
    lv = str(level or "GLOBAL").upper()
    if lv not in RUN.SCOPES:
        raise HTTPException(status_code=422, detail="level must be GLOBAL, DESK or BOOK")
    return {"level": lv, "name": name} if lv != "GLOBAL" else {"level": "GLOBAL"}


def _ctx(db: Session, user: dict) -> dict:
    from api.routes.pnl import _marking_ctx
    return _marking_ctx(db, user)


def _controller(db: Session, user: dict) -> None:
    from api.routes.pnl import _is_controller
    if not _is_controller(db, user):
        raise HTTPException(status_code=403, detail="This needs the controller, CFO or admin role, or firm admin.")


def _name(user: dict) -> str:
    md = user.get("user_metadata") or {}
    return str(md.get("full_name") or user.get("email") or user["sub"][:8])


def _market_date(db: Session, uid: str, d: date) -> date:
    from pnl.market import Market
    dates = Market.dates(db, uid, upto=d)
    if not dates:
        raise HTTPException(status_code=422, detail="No market dates: save or snap a curve first.")
    return dates[-1]


# ── runs ─────────────────────────────────────────────────────────────────────

@router.get("/run")
def get_run(date_: Optional[str] = Query(default=None, alias="date"), level: Optional[str] = None, name: Optional[str] = None, live: bool = False,
            db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    uid = user["sub"]
    d = _market_date(db, uid, _parse(date_))
    scope = _scope(level, name)
    if live:
        heavy(user, "live P&L report", 6)
        try:
            return RUN.build_and_store(db, _ctx(db, user), d, scope)
        except Exception as e:          # noqa: BLE001
            db.rollback()
            raise internal(422, "The IPV run failed", e)
    stored = S.get_run(db, uid, d, RUN.scope_key(scope))
    if stored:
        stored.update(date=d.isoformat(), scope_key=RUN.scope_key(scope), gate=RUN.gate(stored["inputs"], stored["unvalued"]), overrides=S.overrides(db, uid, d, RUN.scope_key(scope)),
                      job=_job_view(db, uid), tables=True)
        return stored
    return {"date": d.isoformat(), "scope": scope, "scope_key": RUN.scope_key(scope), "inputs": [], "status": None, "job": _job_view(db, uid), "tables": S.tables_present(db),
            "note": "No run yet for this date and scope: RUN IPV derives the inputs from the book and verifies them."}


def _run_thread(ctx: dict, d: date, scope: dict) -> None:
    from db.session import SessionLocal
    uid = ctx["sub"]
    job = _jobs.setdefault(uid, {})
    job.update(running=True, started=_dt.datetime.now(_dt.timezone.utc).isoformat(), finished=None, error=None, current=None, done=0, total=0, result=None)
    db = SessionLocal()
    try:
        r = RUN.build_and_store(db, ctx, d, scope, progress=job)
        job["result"] = {"date": r["date"], "scope_key": r["scope_key"], "inputs": len(r["inputs"]), "gate": r["gate"], "seconds": r["seconds"]}
    except Exception as e:              # noqa: BLE001
        db.rollback(); job["error"] = str(e)[:300]
    finally:
        db.close()
        job.update(running=False, finished=_dt.datetime.now(_dt.timezone.utc).isoformat())


def _job_view(db: Session, uid: str) -> Optional[dict]:
    mem = _jobs.get(uid)
    row = None
    if Q.tables_present(db):
        try:
            row = Q.as_status(Q.latest(db, uid, "ipv_run"))
        except Exception:               # noqa: BLE001
            db.rollback(); row = None
    if row is None or mem is None:
        return row or mem
    if row["running"] != bool(mem.get("running")):
        return row if row["running"] else mem
    return row if (row.get("started") or "") >= (mem.get("started") or "") else mem


class RunBody(BaseModel):
    date: Optional[str] = None
    level: Optional[str] = "GLOBAL"
    name: Optional[str] = None


@router.post("/run")
def post_run(body: RunBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    uid = user["sub"]
    if not S.tables_present(db):
        raise HTTPException(status_code=409, detail="IPV needs docs/migrations/2026-11-05_ipv.sql applied first")
    heavy(user, "live P&L report", 4)
    d, scope = _market_date(db, uid, _parse(body.date)), _scope(body.level, body.name)
    current = _job_view(db, uid)
    if current and current.get("running"):
        return {"started": False, "reason": "a run is already in progress", "job": current}
    if Q.worker_expected(db):
        jid = Q.enqueue(db, uid, "ipv_run", {"ctx": _ctx(db, user), "date": d.isoformat(), "scope": scope})
        return {"started": True, "job": Q.as_status(Q.latest(db, uid, "ipv_run")), "job_id": jid}
    threading.Thread(target=_run_thread, args=(_ctx(db, user), d, scope), daemon=True).start()
    return {"started": True, "note": "running in the background"}


@router.get("/run/status")
def run_status(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return {"job": _job_view(db, user["sub"]), "worker": Q.worker_expected(db)}


# ── overrides and decisions ───────────────────────────────────────────────────

class OverrideBody(BaseModel):
    date: Optional[str] = None
    level: Optional[str] = "GLOBAL"
    name: Optional[str] = None
    curve_id: str
    pillar: str
    value: float
    reason: str = Field(default="", max_length=400)


@router.put("/override")
def put_override(body: OverrideBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _controller(db, user)
    uid = user["sub"]
    d, scope = _market_date(db, uid, _parse(body.date)), _scope(body.level, body.name)
    from ipv import inputs as I
    from pnl.market import Market
    quotes = Market(db, uid, d).quotes(body.curve_id)
    q = I.find_quote(quotes or [], body.curve_id, body.pillar)
    if q is None:
        raise HTTPException(status_code=422, detail=f"{body.curve_id} has no pillar {body.pillar} on {d}")
    if not body.reason.strip():
        raise HTTPException(status_code=422, detail="an override needs a reason")
    try:
        oid = S.put_override(db, uid, d, RUN.scope_key(scope), body.curve_id, body.pillar, float(q["rate"]), body.value, body.reason.strip(), uid, _name(user))
        db.commit()
        run = RUN.build_and_store(db, _ctx(db, user), d, scope)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:          # noqa: BLE001
        db.rollback()
        raise internal(422, "The override could not be applied", e)
    return {"override_id": oid, **run}


@router.delete("/override/{oid}")
def delete_override(oid: str, date_: Optional[str] = Query(default=None, alias="date"), level: Optional[str] = None, name: Optional[str] = None,
                    db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _controller(db, user)
    uid = user["sub"]
    try:
        n = S.withdraw_override(db, uid, oid)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not n:
        raise HTTPException(status_code=404, detail="Override not found")
    db.commit()
    d, scope = _market_date(db, uid, _parse(date_)), _scope(level, name)
    return RUN.build_and_store(db, _ctx(db, user), d, scope)


class DecisionBody(BaseModel):
    date: Optional[str] = None
    level: Optional[str] = "GLOBAL"
    name: Optional[str] = None
    curve_id: str
    reason: str = ""


def _decide(body: DecisionBody, state: str, db: Session, user: dict) -> dict:
    _controller(db, user)
    uid = user["sub"]
    d, scope = _market_date(db, uid, _parse(body.date)), _scope(body.level, body.name)
    if state == "WAIVED" and not body.reason.strip():
        raise HTTPException(status_code=422, detail="a waiver needs a reason")
    try:
        return RUN.decide(db, _ctx(db, user), d, scope, body.curve_id, state, body.reason.strip(), _name(user))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/inputs/approve")
def approve_input(body: DecisionBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return _decide(body, "APPROVED", db, user)


@router.post("/inputs/waive")
def waive_input(body: DecisionBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return _decide(body, "WAIVED", db, user)


class ScopeBody(BaseModel):
    date: Optional[str] = None
    level: Optional[str] = "GLOBAL"
    name: Optional[str] = None
    comment: str = ""


@router.post("/apply")
def apply(body: ScopeBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _controller(db, user)
    uid = user["sub"]
    heavy(user, "live P&L report", 6)
    d, scope = _market_date(db, uid, _parse(body.date)), _scope(body.level, body.name)
    try:
        return RUN.build_and_store(db, _ctx(db, user), d, scope, apply=True)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:          # noqa: BLE001
        db.rollback()
        raise internal(422, "The revaluation failed", e)


@router.post("/signoff", status_code=201)
def signoff(body: ScopeBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _controller(db, user)
    uid = user["sub"]
    heavy(user, "live P&L report", 6)
    d, scope = _market_date(db, uid, _parse(body.date)), _scope(body.level, body.name)
    try:
        return RUN.sign(db, _ctx(db, user), d, scope, _name(user), body.comment)
    except PermissionError as e:
        raise HTTPException(status_code=409, detail=f"The gate is not clear: {e}")
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:          # noqa: BLE001
        db.rollback()
        raise internal(422, "The sign-off failed", e)


# ── tolerances and independent marks ─────────────────────────────────────────

def _firm_or_404(db: Session, user: dict):
    from risk.report import firm_of
    f = firm_of(db, user["sub"])
    if f is None:
        raise HTTPException(status_code=404, detail="Your account is not in a firm.")
    return f


def _can_write_rules(db: Session, user: dict) -> None:
    from api.routes.pnl import _is_controller, _role
    if _role(db, user) in ("risk", "admin") or _is_controller(db, user):
        return
    raise HTTPException(status_code=403, detail="Tolerances are set by the risk, controller or admin role.")


@router.get("/tolerances")
def get_tolerances(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    from ipv.tolerances import DEFAULTS, DEFAULT_MATERIALITY_USD
    return {"rules": S.list_tolerances(db, _firm_or_404(db, user)), "defaults": DEFAULTS, "default_materiality_usd": DEFAULT_MATERIALITY_USD,
            "units": ["bp", "vol_bp", "vol_pt", "pct"], "tables": S.tables_present(db)}


class ToleranceBody(BaseModel):
    input_pattern: str = Field(min_length=1, max_length=60)
    pillar_pattern: str = Field(default="*", max_length=40)
    tol: float = Field(gt=0)
    unit: str
    materiality_usd: float = Field(default=0.0, ge=0)
    note: str = ""


@router.post("/tolerances", status_code=201)
def post_tolerance(body: ToleranceBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _can_write_rules(db, user)
    if body.unit not in ("bp", "vol_bp", "vol_pt", "pct"):
        raise HTTPException(status_code=422, detail="unit must be bp, vol_bp, vol_pt or pct")
    f = _firm_or_404(db, user)
    try:
        tid = S.add_tolerance(db, f, body.input_pattern.strip().upper(), body.pillar_pattern.strip().upper() or "*", body.tol, body.unit, body.materiality_usd, body.note, user["sub"], _name(user))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    db.commit()
    return {"id": tid, "rules": S.list_tolerances(db, f)}


@router.delete("/tolerances/{tid}")
def delete_tolerance(tid: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _can_write_rules(db, user)
    f = _firm_or_404(db, user)
    try:
        n = S.remove_tolerance(db, f, tid)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not n:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.commit()
    return {"removed": n, "rules": S.list_tolerances(db, f)}


class IndependentBody(BaseModel):
    curve_id: str
    date: Optional[str] = None
    quotes: list[dict]
    source: str = Field(default="UPLOAD", max_length=40)


@router.post("/independent", status_code=201)
def post_independent(body: IndependentBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _controller(db, user)
    uid = user["sub"]
    d = _parse(body.date)
    clean: list[dict[str, Any]] = []
    for q in body.quotes:
        if q.get("tenor") is None or q.get("rate") is None:
            raise HTTPException(status_code=422, detail="every quote needs a tenor and a rate")
        clean.append({"tenor": str(q["tenor"]), "rate": float(q["rate"]), "quote_type": q.get("quote_type") or "", "enabled": True})
    try:
        S.put_independent(db, uid, body.curve_id.upper(), d, clean, body.source, uid)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    db.commit()
    return {"curve_id": body.curve_id.upper(), "date": d.isoformat(), "quotes": len(clean), "source": body.source}
