from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db.session import get_db
from db.models import Counterparty
from middleware.auth import verify_token
from pydantic import BaseModel
from typing import Optional
import uuid

router = APIRouter()


class CounterpartyCreate(BaseModel):
    legal_entity_id: Optional[str] = None
    name: str
    isda_agreement: Optional[str] = None
    csa_type: str = "NO_CSA"
    csa_currency: Optional[str] = None
    csa_threshold_m: Optional[float] = None
    csa_mta_k: Optional[float] = None
    discount_curve_id: Optional[str] = None
    im_model: Optional[str] = "SIMM"


class CounterpartyUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    csa_type: Optional[str] = None
    csa_threshold_m: Optional[float] = None
    discount_curve_id: Optional[str] = None


def serialize(c: Counterparty) -> dict:
    return {
        "id": str(c.id),
        "legal_entity_id": str(c.legal_entity_id) if c.legal_entity_id else None,
        "name": c.name,
        "isda_agreement": c.isda_agreement,
        "csa_type": c.csa_type,
        "csa_currency": c.csa_currency,
        "csa_threshold_m": float(c.csa_threshold_m) if c.csa_threshold_m else None,
        "csa_mta_k": float(c.csa_mta_k) if c.csa_mta_k else None,
        "discount_curve_id": c.discount_curve_id,
        "im_model": c.im_model,
        "is_active": c.is_active,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.get("/")
def get_counterparties(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return [serialize(c) for c in db.query(Counterparty).order_by(Counterparty.created_at).all()]


@router.post("/")
def create_counterparty(body: CounterpartyCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    data = body.dict()
    if data.get("legal_entity_id"):
        data["legal_entity_id"] = uuid.UUID(data["legal_entity_id"])
    cp = Counterparty(**data, created_by=uuid.UUID(user["sub"]))
    db.add(cp)
    db.commit()
    db.refresh(cp)
    return serialize(cp)


@router.put("/{cp_id}")
def update_counterparty(
    cp_id: str, body: CounterpartyUpdate,
    db: Session = Depends(get_db), user: dict = Depends(verify_token),
):
    cp = db.query(Counterparty).filter(Counterparty.id == uuid.UUID(cp_id)).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    for k, v in body.dict(exclude_none=True).items():
        setattr(cp, k, v)
    db.commit()
    return serialize(cp)


@router.delete("/{cp_id}")
def delete_counterparty(cp_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    cp = db.query(Counterparty).filter(Counterparty.id == uuid.UUID(cp_id)).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    db.delete(cp)
    db.commit()
    return {"deleted": cp_id}
