from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from db.session import get_db
from db.models import Trade, Counterparty
from middleware.auth import verify_token
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import date
import uuid, time

router = APIRouter()

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
    if hasattr(Trade, "structure"):
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
