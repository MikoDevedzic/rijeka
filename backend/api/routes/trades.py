from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from db.session import get_db
from db.models import Trade, Counterparty
from middleware.auth import verify_token
from api.routes._instrument_alias import normalize_instrument_type  # M009 inbound translator
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, Dict, Any
from datetime import date
import uuid, time

router = APIRouter()

# ── Sprint 12 — PRODUCT_TAXONOMY v2 §1.1 allowed IR_SWAP structures ──
# Keep in sync with:
#   - _docs/PRODUCT_TAXONOMY.md §1.1
#   - _docs/migrations/migration_007_ir_swap_capped_floored_floater.sql step 3
#   - _docs/migrations/migration_008b.sql step 4 (CHECK recreation)
#   - DB constraint chk_trades_ir_swap_structure_valid
# Adding a new structure requires updating all surfaces together.
#
# Sprint 13 Patch 5 / migration 008b: CAPPED_FLOATER and FLOORED_FLOATER
# were REMOVED. Per PRODUCT_TAXONOMY §1.11, trade-level structure is
# topology only; embedded optionality (caps, floors, collars) lives on
# the leg via `embedded_options`. A capped VANILLA swap is just
# structure=VANILLA + leg.embedded_options=[{type:CAP,...}].
_ALLOWED_IR_SWAP_STRUCTURES = {
    "VANILLA", "OIS", "BASIS", "ZERO_COUPON", "STEP_UP",
    "AMORTIZING", "ACCRETING",
}

class TradeCreate(BaseModel):
    trade_ref: Optional[str] = None
    status: str = "PENDING"
    store: str = "WORKING"
    asset_class: str
    instrument_type: str
    structure: Optional[str] = None
    own_legal_entity_id: Optional[str] = None
    counterparty_id: Optional[str] = None
    notional: Optional[float] = None
    notional_ccy: str = "USD"
    trade_date: str
    effective_date: str
    maturity_date: str
    terms: Dict[str, Any] = {}
    discount_curve_id: Optional[str] = None
    forecast_curve_id: Optional[str] = None
    desk: Optional[str] = None
    book: Optional[str] = None
    strategy: Optional[str] = None
    class Config:
        extra = "ignore"

    @field_validator("instrument_type", mode="before")
    @classmethod
    def _normalize_instrument_type(cls, v):
        """
        M009 inbound translator: normalize legacy INTEREST_RATE_* strings
        from frontend UIs (TradeBookingWindow, NewTradeWorkspace,
        ScenarioTab) to canonical IR_* form before any downstream
        validation runs. Pass-through for already-canonical values, None,
        empty, or unknown strings — those get caught by the structure
        validator or DB CHECK constraint.

        Sunset: when the legacy frontend UIs are retired in the four-UI
        consolidation (HANDOFF §3), this validator and the
        _instrument_alias module can be deleted.
        """
        return normalize_instrument_type(v)

    @model_validator(mode="after")
    def default_and_validate_structure(self):
        """
        Sprint 12 — PRODUCT_TAXONOMY v2 + migration 007.

        For IR_SWAP trades:
          - NULL/empty structure defaults to 'VANILLA' per §7 (closes L22 backend-side).
          - Structure must be in _ALLOWED_IR_SWAP_STRUCTURES; otherwise raises 422
            instead of waiting for the DB CHECK to throw 500.

        Non-IR_SWAP instrument types are unvalidated here — their own per-instrument
        CHECK constraints (migrations 010+) will enforce their structure sets.
        """
        if self.instrument_type == "IR_SWAP":
            if not self.structure:
                self.structure = "VANILLA"
            if self.structure not in _ALLOWED_IR_SWAP_STRUCTURES:
                raise ValueError(
                    f"Invalid structure '{self.structure}' for IR_SWAP. "
                    f"Allowed: {sorted(_ALLOWED_IR_SWAP_STRUCTURES)}"
                )
        return self

class TradeUpdate(BaseModel):
    status: Optional[str] = None
    store: Optional[str] = None
    terms: Optional[Dict[str, Any]] = None
    desk: Optional[str] = None
    book: Optional[str] = None
    strategy: Optional[str] = None

def serialize(t, cp=None):
    return {
        "id": str(t.id),
        "trade_ref": t.trade_ref,
        "status": t.status,
        "store": t.store,
        "asset_class": t.asset_class,
        "instrument_type": t.instrument_type,
        "structure": getattr(t, "structure", None),
        "counterparty_id": str(t.counterparty_id) if t.counterparty_id else None,
        "counterparty": {"id": str(cp.id), "name": cp.name} if cp else None,
        "own_entity": None,
        "notional": float(t.notional) if t.notional else None,
        "notional_ccy": t.notional_ccy,
        "trade_date": t.trade_date.isoformat() if t.trade_date else None,
        "effective_date": t.effective_date.isoformat() if t.effective_date else None,
        "maturity_date": t.maturity_date.isoformat() if t.maturity_date else None,
        "terms": t.terms or {},
        "discount_curve_id": t.discount_curve_id,
        "forecast_curve_id": t.forecast_curve_id,
        "desk": t.desk,
        "book": t.book,
        "strategy": t.strategy,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "last_modified_at": t.last_modified_at.isoformat() if t.last_modified_at else None,
    }

def load_cps(db, trades_list):
    ids = [t.counterparty_id for t in trades_list if t.counterparty_id]
    if not ids:
        return {}
    return {c.id: c for c in db.query(Counterparty).filter(Counterparty.id.in_(ids)).all()}

@router.get("/")
def get_trades(
    status: Optional[str] = Query(None),
    asset_class: Optional[str] = Query(None),
    store: Optional[str] = Query(None),
    counterparty_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    q = db.query(Trade).filter(Trade.user_id == uuid.UUID(user["sub"]))
    if status:          q = q.filter(Trade.status == status)
    if asset_class:     q = q.filter(Trade.asset_class == asset_class)
    if store:           q = q.filter(Trade.store == store)
    if counterparty_id: q = q.filter(Trade.counterparty_id == uuid.UUID(counterparty_id))
    trades_list = q.order_by(Trade.trade_date.desc(), Trade.created_at.desc()).all()
    cps = load_cps(db, trades_list)
    return [serialize(t, cps.get(t.counterparty_id)) for t in trades_list]

@router.get("/summary")
def trades_summary(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    uid = uuid.UUID(user["sub"])
    return {
        "total":     db.query(Trade).filter(Trade.user_id == uid).count(),
        "live":      db.query(Trade).filter(Trade.user_id == uid, Trade.status=="LIVE").count(),
        "pending":   db.query(Trade).filter(Trade.user_id == uid, Trade.status=="PENDING").count(),
        "matured":   db.query(Trade).filter(Trade.user_id == uid, Trade.status=="MATURED").count(),
        "cancelled": db.query(Trade).filter(Trade.user_id == uid, Trade.status=="CANCELLED").count(),
    }

@router.post("/")
def create_trade(body: TradeCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    new_id    = uuid.uuid4()
    trade_ref = body.trade_ref or f"TRD-{str(int(time.time()))[-8:]}"
    kwargs = {
        "id":                   new_id,
        "trade_ref":            trade_ref,
        "status":               body.status,
        "store":                body.store,
        "asset_class":          body.asset_class,
        "instrument_type":      body.instrument_type,
        "own_legal_entity_id":  uuid.UUID(body.own_legal_entity_id) if body.own_legal_entity_id else None,
        "counterparty_id":      uuid.UUID(body.counterparty_id) if body.counterparty_id else None,
        "notional":             body.notional,
        "notional_ccy":         body.notional_ccy,
        "trade_date":           date.fromisoformat(body.trade_date),
        "effective_date":       date.fromisoformat(body.effective_date),
        "maturity_date":        date.fromisoformat(body.maturity_date),
        "terms":                body.terms,
        "discount_curve_id":    body.discount_curve_id,
        "forecast_curve_id":    body.forecast_curve_id,
        "desk":                 body.desk,
        "book":                 body.book,
        "strategy":             body.strategy,
        "user_id":              uuid.UUID(user["sub"]),
        "created_by":           uuid.UUID(user["sub"]),
    }
    kwargs["structure"] = body.structure
    try:
        trade = Trade(**kwargs)
        db.add(trade)
        db.commit()
        db.refresh(trade)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"DB error: {str(e)}")
    cp = db.query(Counterparty).filter(Counterparty.id == trade.counterparty_id).first() if trade.counterparty_id else None
    return serialize(trade, cp)

@router.put("/{trade_id}")
def update_trade(trade_id: str, body: TradeUpdate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    t = db.query(Trade).filter(Trade.id == uuid.UUID(trade_id), Trade.user_id == uuid.UUID(user["sub"])).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trade not found")
    for k, v in body.dict(exclude_none=True).items():
        setattr(t, k, v)
    t.last_modified_by = uuid.UUID(user["sub"])
    db.commit()
    return {"id": trade_id, "status": t.status}

@router.delete("/{trade_id}")
def delete_trade(trade_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    t = db.query(Trade).filter(Trade.id == uuid.UUID(trade_id), Trade.user_id == uuid.UUID(user["sub"])).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trade not found")
    if t.status not in ("PENDING", "CANCELLED"):
        raise HTTPException(status_code=400, detail="Only PENDING or CANCELLED trades can be deleted")
    db.delete(t)
    db.commit()
    return {"deleted": trade_id}
