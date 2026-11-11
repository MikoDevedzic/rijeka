from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db.session import get_db
from db.models import LegalEntity
from middleware.auth import verify_token
from pydantic import BaseModel, field_validator
from typing import Optional, List
import re
import uuid

router = APIRouter()

# An LEI is twenty capital letters and digits (ISO 17442). It is signed into a confirmation and printed on the public
# register (api/routes/public.py), and on a demo instance a key is held for any LEI that begins DEMO (chain/keys.py),
# so an entity whose LEI was other text could be confirmed and anchored with it. Nothing else is stored.
LEI_RE = re.compile(r"^[A-Z0-9]{20}$")


def clean_lei(v):
    """The LEI as stored: upper case, or the empty string for an entity that has none (the column takes no null, and
    a blank was always stored as ''). Anything else that is not twenty capitals and digits is refused. None stays
    None: on an update it means the LEI was not sent."""
    if v is None:
        return None
    v = str(v).strip().upper()
    if v and not LEI_RE.match(v):
        raise ValueError("an LEI is 20 capital letters and digits (ISO 17442)")
    return v


def _lei_on_create(v):
    return clean_lei(v) or ""          # left out of the body: no LEI, stored as '' (it used to reach the column as null: a 500)


class LegalEntityCreate(BaseModel):
    lei: Optional[str] = ""
    name: str
    short_name: Optional[str] = None
    home_currency: str
    jurisdiction: Optional[str] = None
    regulatory_regime: Optional[List[str]] = None
    simm_version: Optional[str] = "2.6"
    im_threshold_m: Optional[float] = None
    ois_curve_id: Optional[str] = None
    is_own_entity: bool = False

    _lei = field_validator("lei", mode="before")(_lei_on_create)


class LegalEntityUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    lei: Optional[str] = None
    short_name: Optional[str] = None
    im_threshold_m: Optional[float] = None

    _lei = field_validator("lei", mode="before")(clean_lei)


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
    return [serialize(e) for e in db.query(LegalEntity).filter(LegalEntity.user_id == uuid.UUID(user["sub"])).order_by(LegalEntity.created_at).all()]


@router.post("/")
def create_legal_entity(body: LegalEntityCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    entity = LegalEntity(
        id=uuid.uuid4(),
        **body.dict(),
        created_by=uuid.UUID(user["sub"]),
        user_id=uuid.UUID(user["sub"]),
    )
    db.add(entity)
    db.commit()
    db.refresh(entity)
    return serialize(entity)


@router.put("/{entity_id}")
def update_legal_entity(
    entity_id: str, body: LegalEntityUpdate,
    db: Session = Depends(get_db), user: dict = Depends(verify_token),
):
    entity = db.query(LegalEntity).filter(LegalEntity.id == uuid.UUID(entity_id), LegalEntity.user_id == uuid.UUID(user["sub"])).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    for k, v in body.dict(exclude_none=True).items():
        setattr(entity, k, v)
    db.commit()
    return serialize(entity)


@router.delete("/{entity_id}")
def delete_legal_entity(entity_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    entity = db.query(LegalEntity).filter(LegalEntity.id == uuid.UUID(entity_id), LegalEntity.user_id == uuid.UUID(user["sub"])).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    db.delete(entity)
    db.commit()
    return {"deleted": entity_id}
