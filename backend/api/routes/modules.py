"""
modules.py — which modules the firm runs.

GET /api/modules       the firm's switches, the catalogue, the presets, the last changes (any signed-in user)
PUT /api/modules       {preset} or {modules: {key: bool}}, optional note (admin); 409 before the migration
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import modules as M
from api.routes._roles import require_admin
from db.session import get_db
from middleware.auth import verify_token

router = APIRouter(prefix="/api/modules", tags=["modules"])


class ModulesBody(BaseModel):
    preset: Optional[str] = None
    modules: Optional[dict] = None
    note: Optional[str] = None


def _view(db: Session, uid: str) -> dict:
    firm_id = M.firm_of_user(db, uid)
    cur = M.for_firm(db, firm_id)
    return {**cur, "firm_id": str(firm_id) if firm_id else None, "writable": M.columns_present(db), **M.catalogue(),
            "events": M.events(db, firm_id), "planned": list(M.PLANNED)}


@router.get("")
def get_modules(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return _view(db, user["sub"])


@router.put("")
def put_modules(body: ModulesBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    require_admin(db, user)
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
    return _view(db, uid)
