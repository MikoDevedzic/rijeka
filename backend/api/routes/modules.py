"""
modules.py — which modules the firm runs.

GET /api/modules       the firm's switches, the catalogue, the presets, the last changes (any signed-in user)
PUT /api/modules       {preset} or {modules: {key: bool}}, optional note (the admin role, or the owner of a sandbox firm of one: modules.may_edit); 409 before the migration
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import modules as M
from db.session import get_db
from middleware.auth import verify_token

router = APIRouter(prefix="/api/modules", tags=["modules"])


class ModulesBody(BaseModel):
    preset: Optional[str] = None
    modules: Optional[dict] = None
    note: Optional[str] = Field(None, max_length=500)


def _view(db: Session, uid: str, user: Optional[dict] = None) -> dict:
    firm_id = M.firm_of_user(db, uid)
    cur = M.for_firm(db, firm_id)
    return {**cur, "firm_id": str(firm_id) if firm_id else None, "writable": M.columns_present(db),
            "can_edit": bool(user and firm_id and M.may_edit(db, user)), "view": M.view_for_firm(db, firm_id), **M.catalogue(),
            "events": M.events(db, firm_id), "planned": list(M.PLANNED)}


@router.get("")
def get_modules(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return _view(db, user["sub"], user)


@router.put("")
def put_modules(body: ModulesBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    if not M.may_edit(db, user):
        raise HTTPException(status_code=403, detail="Switching modules needs the admin role.")
    from api.routes._limits import heavy
    heavy(user, "module switches", 20)
    uid = user["sub"]
    firm_id = M.firm_of_user(db, uid)
    if firm_id is None:
        raise HTTPException(status_code=422, detail="You are not a member of a firm.")
    if not M.columns_present(db):
        raise HTTPException(status_code=409, detail="Module switches need docs/migrations/2026-11-04_firm_modules.sql applied first")
    if body.preset:
        if body.preset.upper() not in M.PRESETS:
            raise HTTPException(status_code=422, detail=f"preset must be one of {', '.join(M.PRESETS)}")
    elif body.modules is None:
        raise HTTPException(status_code=422, detail="preset or modules is required")
    else:
        bad = [k for k in body.modules if k not in M.KEYS]
        if bad:
            raise HTTPException(status_code=422, detail=f"unknown module {', '.join(bad)}")
    M.set_for_firm(db, firm_id, uid, body.modules, body.preset, body.note)
    db.commit()
    return _view(db, uid, user)
