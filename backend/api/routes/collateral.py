"""Collateral: the firm's instrument list and the schedule per counterparty.

GET    /api/collateral/instruments            the seed with the firm's rows over it, every yield resolved from today's market
POST   /api/collateral/instruments            add or replace one of the firm's rows (trader, controller, risk, admin)
DELETE /api/collateral/instruments/{code}     remove the firm's row (a seed entry is overridden, never removed)
GET    /api/collateral/schedules              {counterparty id: the schedule in force} for the account
GET    /api/collateral/schedule/{cp_id}       the schedule in force, its history, and the regime it derives
PUT    /api/collateral/schedule/{cp_id}       a new version; the record's class-level fields follow it
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.routes._roles import role_of
from collateral import regimes, store, yields
from db.session import get_db
from middleware.auth import verify_token
from pricing import collateral as COL

router = APIRouter(prefix="/api/collateral", tags=["collateral"])

EDIT_ROLES = ("trader", "controller", "risk", "admin")


def _can_edit(db: Session, user: dict) -> None:
    if role_of(db, user) not in EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Editing collateral needs the trader, controller, risk or admin role.")


def _name(user: dict) -> str:
    md = user.get("user_metadata") or {}
    return str(md.get("display_name") or md.get("full_name") or user.get("email") or user.get("sub") or "")[:80]


def _market(db: Session, uid: str):
    from pnl.market import Market
    dates = Market.dates(db, uid, upto=date.today())
    if not dates:
        return None, None
    return Market(db, uid, dates[-1]), dates[-1]


class InstrumentBody(BaseModel):
    code: str
    name: Optional[str] = None
    cls: str
    currency: Optional[str] = "USD"
    issuer: Optional[str] = None
    rail: Optional[str] = None
    yield_kind: Optional[str] = "NONE"
    yield_ref: Optional[str] = None
    yield_bp: Optional[float] = 0.0
    chain_id: Optional[int] = None
    token_address: Optional[str] = None
    csa_haircut_pct: Optional[float] = None
    active: Optional[bool] = True
    note: Optional[str] = None


class ScheduleBody(BaseModel):
    eligible: list[dict]
    posted: Optional[dict] = None
    received: Optional[dict] = None
    rail: Optional[str] = "bilateral"
    effective_from: Optional[str] = None
    note: Optional[str] = None


def _instruments_view(db: Session, uid: str) -> dict:
    scope = regimes.scope_of(db, uid)
    inst = store.instruments(db, scope, include_inactive=True)
    mkt, asof = _market(db, uid)
    rate_fn = yields.curve_rate_bp_fn(db, uid, mkt, asof) if mkt is not None else None
    ys = yields.resolve_all(inst, rate_fn)
    rows = [{**i.to_dict(), "yield_today_bp": ys[c]} for c, i in sorted(inst.items())]
    return {"instruments": rows, "classes": [c.to_dict() for c in COL.CATALOGUE.values()], "rails": list(COL.RAILS), "yield_kinds": list(COL.YIELD_KINDS),
            "writable": store.tables_present(db), "asof": asof.isoformat() if asof else None, "seed": sorted(COL.SEED)}


@router.get("/instruments")
def list_instruments(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return _instruments_view(db, user["sub"])


@router.post("/instruments")
def put_instrument(body: InstrumentBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _can_edit(db, user)
    try:
        inst = COL.instrument_from_row(body.dict(), firm=True)
        store.put_instrument(db, regimes.scope_of(db, user["sub"]), inst, user["sub"])
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    db.commit()
    return _instruments_view(db, user["sub"])


@router.delete("/instruments/{code}")
def delete_instrument(code: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _can_edit(db, user)
    try:
        n = store.remove_instrument(db, regimes.scope_of(db, user["sub"]), code.upper())
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not n:
        raise HTTPException(status_code=404, detail="No firm row with that code (a seed entry is overridden by adding a row with its code, not removed)")
    db.commit()
    return _instruments_view(db, user["sub"])


def _counterparty(db: Session, uid: str, cp_id: str):
    from api.routes.counterparties import read_capital, with_capital
    from db.models import Counterparty
    try:
        cid = uuid.UUID(cp_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="counterparty id must be a UUID")
    cp = db.query(Counterparty).filter(Counterparty.id == cid, Counterparty.user_id == uuid.UUID(uid)).first()
    if cp is None:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    return cp, with_capital(cp, read_capital(db, [cp.id]).get(str(cp.id), {}))


def _schedule_view(db: Session, uid: str, cp, cp_view) -> dict:
    from ccr.exposure import csa_from_counterparty
    sched = store.schedule(db, cp.id)
    mkt, asof = _market(db, uid)
    regime = regimes.regime_for(db, uid, cp_view, csa_from_counterparty(cp_view), mkt, asof)
    return {"counterparty_id": str(cp.id), "counterparty": cp.name, "schedule": sched.to_dict() if sched else None, "history": store.history(db, cp.id),
            "regime": regime.to_dict(), "explain": regime.explain(), "writable": store.tables_present(db), "asof": asof.isoformat() if asof else None}


@router.get("/schedules")
def list_schedules(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """{counterparty id: the schedule in force today} for every counterparty of the account (the list page's summary column)."""
    from db.models import Counterparty
    ids = [c.id for c in db.query(Counterparty).filter(Counterparty.user_id == uuid.UUID(user["sub"])).all()]
    return {"schedules": {k: (v.to_dict() if v else None) for k, v in store.schedules(db, ids).items()}, "writable": store.tables_present(db)}


@router.get("/schedule/{cp_id}")
def get_schedule(cp_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    cp, cp_view = _counterparty(db, user["sub"], cp_id)
    return _schedule_view(db, user["sub"], cp, cp_view)


@router.put("/schedule/{cp_id}")
def put_schedule(cp_id: str, body: ScheduleBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _can_edit(db, user)
    uid = user["sub"]
    cp, cp_view = _counterparty(db, uid, cp_id)
    inst = store.instruments(db, regimes.scope_of(db, uid), include_inactive=True)
    try:
        sched = COL.schedule_from_request(body.dict(), inst)
        if sched.effective_from:
            date.fromisoformat(sched.effective_from)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    from api.routes.counterparties import capital_columns_present, write_capital
    try:
        store.put_schedule(db, cp.id, uid, sched, uid, _name(user))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if capital_columns_present(db):
        write_capital(db, cp.id, regimes.class_fields(sched, inst))
    db.commit()
    _, cp_view = _counterparty(db, uid, cp_id)
    return _schedule_view(db, uid, cp, cp_view)
