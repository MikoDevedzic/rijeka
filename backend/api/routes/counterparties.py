import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from db.session import get_db
from db.models import Counterparty
from middleware.auth import verify_token
from pydantic import BaseModel
from typing import Optional
import uuid

router = APIRouter()


CAPITAL_FIELDS = ("counterparty_type", "rating_bucket", "risk_weight_override", "cva_sector", "umr_in_scope",
                  "eligible_collateral", "posted_composition", "received_composition", "netting_enforceable",
                  "margin_frequency_days", "mpor_disputed")          # the last two: docs/migrations/2026-11-04_counterparty_margin_terms.sql


class CapitalAttributes(BaseModel):
    # pricing/capital.py and pricing/collateral.py read these; null means today's defaults
    counterparty_type: Optional[str] = None
    rating_bucket: Optional[str] = None
    risk_weight_override: Optional[float] = None
    cva_sector: Optional[str] = None
    umr_in_scope: Optional[bool] = None
    eligible_collateral: Optional[list] = None
    posted_composition: Optional[dict] = None
    received_composition: Optional[dict] = None
    netting_enforceable: Optional[bool] = None
    margin_frequency_days: Optional[int] = None
    mpor_disputed: Optional[bool] = None


class CounterpartyCreate(CapitalAttributes):
    legal_entity_id: Optional[str] = None
    name: str
    isda_agreement: Optional[str] = None
    csa_type: str = "NO_CSA"
    csa_currency: Optional[str] = None
    csa_threshold_m: Optional[float] = None
    csa_mta_k: Optional[float] = None
    discount_curve_id: Optional[str] = None
    im_model: Optional[str] = "MODEL"      # the desk's amount or the engine's estimate; ISDA SIMM is licensed and not computed (the column's own default is still the old word)


class CounterpartyUpdate(CapitalAttributes):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    isda_agreement: Optional[str] = None
    csa_type: Optional[str] = None
    csa_currency: Optional[str] = None
    csa_threshold_m: Optional[float] = None
    csa_mta_k: Optional[float] = None
    discount_curve_id: Optional[str] = None
    im_model: Optional[str] = None
    legal_entity_id: Optional[str] = None


_CAPITAL_PRESENT: dict[str, bool] = {}


def capital_columns_present(db: Session) -> bool:
    """True once docs/migrations/2026-11-04_counterparty_capital.sql has been applied; cached per process."""
    key = "present"
    if key not in _CAPITAL_PRESENT:
        try:
            n = db.execute(text("SELECT count(*) FROM information_schema.columns WHERE table_name = 'counterparties' AND column_name = ANY(:cols)"),
                           {"cols": list(CAPITAL_FIELDS)}).scalar()
            if int(n or 0) != len(CAPITAL_FIELDS):
                return False                      # a negative answer is re-checked: the migration may be applied while the process runs
            _CAPITAL_PRESENT[key] = True
        except Exception:          # noqa: BLE001
            db.rollback()
            return False
    return _CAPITAL_PRESENT[key]


def read_capital(db: Session, cp_ids: list) -> dict:
    """{counterparty id: {field: value}} for the ids given; empty dicts before the migration."""
    if not cp_ids or not capital_columns_present(db):
        return {str(i): {} for i in cp_ids}
    cols = ", ".join(CAPITAL_FIELDS)
    rows = db.execute(text(f"SELECT id, {cols} FROM counterparties WHERE id = ANY(:ids)"), {"ids": [uuid.UUID(str(i)) for i in cp_ids]}).mappings().all()
    out = {str(i): {} for i in cp_ids}
    for r in rows:
        d = {k: r[k] for k in CAPITAL_FIELDS}
        if d.get("risk_weight_override") is not None:
            d["risk_weight_override"] = float(d["risk_weight_override"])
        out[str(r["id"])] = d
    return out


def write_capital(db: Session, cp_id, patch: dict) -> None:
    """Write the capital fields in `patch`; 409 when any is set before the migration."""
    fields = {k: patch[k] for k in CAPITAL_FIELDS if k in patch}
    if not fields:
        return
    if not capital_columns_present(db):
        raise HTTPException(status_code=409, detail="Counterparty capital attributes need docs/migrations/2026-11-04_counterparty_capital.sql applied first")
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    params = {k: (json.dumps(v) if k in ("eligible_collateral", "posted_composition", "received_composition") and v is not None else v) for k, v in fields.items()}
    casts = {k: f"CAST(:{k} AS jsonb)" for k in ("eligible_collateral", "posted_composition", "received_composition") if k in fields}
    for k, expr in casts.items():
        sets = sets.replace(f"{k} = :{k}", f"{k} = {expr}")
    db.execute(text(f"UPDATE counterparties SET {sets} WHERE id = :id"), {**params, "id": uuid.UUID(str(cp_id))})


def with_capital(cp, attrs: dict):
    """The ORM row and its capital attributes as one read-only object for the engines (getattr-based)."""
    from types import SimpleNamespace
    base = {k: getattr(cp, k) for k in ("id", "name", "csa_type", "csa_currency", "csa_threshold_m", "csa_mta_k", "im_model", "legal_entity_id", "is_active", "user_id")}
    return SimpleNamespace(**base, **{k: attrs.get(k) for k in CAPITAL_FIELDS})


def validate_capital(d: dict) -> None:
    from pricing.capital import COUNTERPARTY_TYPES, RATING_BUCKETS, CVA_WEIGHTS
    from pricing.collateral import CATALOGUE
    if d.get("counterparty_type") is not None and str(d["counterparty_type"]).upper() not in COUNTERPARTY_TYPES:
        raise HTTPException(status_code=422, detail=f"counterparty_type must be one of {', '.join(COUNTERPARTY_TYPES)}")
    if d.get("rating_bucket") is not None and str(d["rating_bucket"]).upper() not in RATING_BUCKETS:
        raise HTTPException(status_code=422, detail=f"rating_bucket must be one of {', '.join(RATING_BUCKETS)}")
    if d.get("cva_sector") is not None and str(d["cva_sector"]).upper() not in CVA_WEIGHTS:
        raise HTTPException(status_code=422, detail=f"cva_sector must be one of {', '.join(CVA_WEIGHTS)}")
    for k in ("eligible_collateral", "posted_composition", "received_composition"):
        v = d.get(k)
        if v is None:
            continue
        codes = list(v) if k == "eligible_collateral" else list(v.keys())
        bad = [c for c in codes if c not in CATALOGUE]
        if bad:
            raise HTTPException(status_code=422, detail=f"{k}: unknown collateral class {', '.join(bad)}")
        if k != "eligible_collateral" and any(float(w) < 0 for w in v.values()):
            raise HTTPException(status_code=422, detail=f"{k}: weights must be non-negative")
    for k in ("counterparty_type", "rating_bucket", "cva_sector"):
        if d.get(k) is not None:
            d[k] = str(d[k]).upper()
    if d.get("margin_frequency_days") is not None and not (1 <= int(d["margin_frequency_days"]) <= 60):
        raise HTTPException(status_code=422, detail="margin_frequency_days must be between 1 and 60 business days")


def serialize(c: Counterparty, attrs: Optional[dict] = None) -> dict:
    attrs = attrs or {}
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
        **{k: attrs.get(k) for k in CAPITAL_FIELDS},
    }


@router.get("/")
def get_counterparties(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    cps = db.query(Counterparty).filter(Counterparty.user_id == uuid.UUID(user["sub"])).order_by(Counterparty.created_at).all()
    attrs = read_capital(db, [c.id for c in cps])
    return [serialize(c, attrs.get(str(c.id))) for c in cps]


def own_legal_entity(db: Session, user: dict, value) -> uuid.UUID:
    """The legal entity a counterparty is linked to, which must be the caller's own: a confirmation takes the
    counterparty's LEI and name from that record (api/routes/chain.py), so another account's entity, named by its id,
    would be signed into this account's trades."""
    from db.models import LegalEntity
    try:
        eid = uuid.UUID(str(value))
    except ValueError:
        raise HTTPException(status_code=422, detail="legal_entity_id must be a UUID")
    if db.query(LegalEntity.id).filter(LegalEntity.id == eid, LegalEntity.user_id == uuid.UUID(user["sub"])).first() is None:
        raise HTTPException(status_code=422, detail="No legal entity of yours has that id.")
    return eid


@router.post("/")
def create_counterparty(body: CounterpartyCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    data = body.dict()
    validate_capital(data)
    cap = {k: data.pop(k) for k in CAPITAL_FIELDS}
    cap = {k: v for k, v in cap.items() if v is not None}
    if cap and not capital_columns_present(db):
        raise HTTPException(status_code=409, detail="Counterparty capital attributes need docs/migrations/2026-11-04_counterparty_capital.sql applied first")
    if data.get("legal_entity_id"):
        data["legal_entity_id"] = own_legal_entity(db, user, data["legal_entity_id"])
    cp = Counterparty(
        id=uuid.uuid4(),
        **data,
        created_by=uuid.UUID(user["sub"]),
        user_id=uuid.UUID(user["sub"]),
    )
    db.add(cp)
    db.flush()
    write_capital(db, cp.id, cap)
    db.commit()
    db.refresh(cp)
    return serialize(cp, read_capital(db, [cp.id]).get(str(cp.id)))


@router.put("/{cp_id}")
def update_counterparty(
    cp_id: str, body: CounterpartyUpdate,
    db: Session = Depends(get_db), user: dict = Depends(verify_token),
):
    cp = db.query(Counterparty).filter(Counterparty.id == uuid.UUID(cp_id), Counterparty.user_id == uuid.UUID(user["sub"])).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    patch = body.dict(exclude_none=True)
    validate_capital(patch)
    if patch.get("csa_type") is not None and str(patch["csa_type"]).upper() not in ("VM_ONLY", "VM_IM", "NO_CSA"):
        raise HTTPException(status_code=422, detail="csa_type must be VM_ONLY, VM_IM or NO_CSA")
    if patch.get("legal_entity_id"):
        patch["legal_entity_id"] = own_legal_entity(db, user, patch["legal_entity_id"])
    cap = {k: patch.pop(k) for k in CAPITAL_FIELDS if k in patch}
    for k, v in patch.items():
        setattr(cp, k, v)
    if str(getattr(cp, "csa_type", "") or "").upper() == "NO_CSA":
        cp.csa_threshold_m = None; cp.csa_mta_k = None
    write_capital(db, cp.id, cap)
    db.commit()
    return serialize(cp, read_capital(db, [cp.id]).get(str(cp.id)))


@router.delete("/{cp_id}")
def delete_counterparty(cp_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    cp = db.query(Counterparty).filter(Counterparty.id == uuid.UUID(cp_id), Counterparty.user_id == uuid.UUID(user["sub"])).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    db.delete(cp)
    db.commit()
    return {"deleted": cp_id}
