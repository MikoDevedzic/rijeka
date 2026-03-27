from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db.session import get_db
from db.models import LegalEntity
from middleware.auth import verify_token
from pydantic import BaseModel
from typing import Optional, List
import uuid

router = APIRouter()


class LegalEntityCreate(BaseModel):
    lei: Optional[str] = None
    name: str
    short_name: Optional[str] = None
    home_currency: str
    jurisdiction: Optional[str] = None
    regulatory_regime: Optional[List[str]] = None
    simm_version: Optional[str] = "2.6"
    im_threshold_m: Optional[float] = None
    ois_curve_id: Optional[str] = None
    is_own_entity: bool = False


class LegalEntityUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    lei: Optional[str] = None
    short_name: Optional[str] = None
    im_threshold_m: Optional[float] = None


def serialize(e: LegalEntity) -> dict:
    return {
        "id": str(e.id),
        "lei": e.lei,
        "name": e.name,
        "short_name": e.short_name,
        "home_currency": e.home_currency,
        "jurisdiction": e.jurisdiction,
        "regulatory_regime": e.regulatory_regime,
        "simm_version": e.simm_version,
        "im_threshold_m": float(e.im_threshold_m) if e.im_threshold_m else None,
        "ois_curve_id": e.ois_curve_id,
        "is_own_entity": e.is_own_entity,
        "is_active": e.is_active,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


@router.get("/")
def get_legal_entities(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return [serialize(e) for e in db.query(LegalEntity).order_by(LegalEntity.created_at).all()]


@router.post("/")
def create_legal_entity(body: LegalEntityCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    entity = LegalEntity(**body.dict(), created_by=uuid.UUID(user["sub"]))
    db.add(entity)
    db.commit()
    db.refresh(entity)
    return serialize(entity)


@router.put("/{entity_id}")
def update_legal_entity(
    entity_id: str, body: LegalEntityUpdate,
    db: Session = Depends(get_db), user: dict = Depends(verify_token),
):
    entity = db.query(LegalEntity).filter(LegalEntity.id == uuid.UUID(entity_id)).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    for k, v in body.dict(exclude_none=True).items():
        setattr(entity, k, v)
    db.commit()
    return serialize(entity)


@router.delete("/{entity_id}")
def delete_legal_entity(entity_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    entity = db.query(LegalEntity).filter(LegalEntity.id == uuid.UUID(entity_id)).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    db.delete(entity)
    db.commit()
    return {"deleted": entity_id}
