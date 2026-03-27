from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func as sqlfunc
from db.session import get_db
from db.models import Trade, LegalEntity, Counterparty
from middleware.auth import verify_token
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import date
import uuid

router = APIRouter()


class TradeCreate(BaseModel):
    trade_ref: str
    uti: Optional[str] = None
    status: str = "PENDING"
    store: str = "WORKING"
    asset_class: str
    instrument_type: str
    own_legal_entity_id: Optional[str] = None
    counterparty_id: Optional[str] = None
    notional: Optional[float] = None
    notional_ccy: str
    trade_date: str
    effective_date: str
    maturity_date: str
    terms: Dict[str, Any] = {}
    discount_curve_id: Optional[str] = None
    forecast_curve_id: Optional[str] = None
    desk: Optional[str] = None
    book: Optional[str] = None
    strategy: Optional[str] = None


class TradeUpdate(BaseModel):
    status: Optional[str] = None
    store: Optional[str] = None
    terms: Optional[Dict[str, Any]] = None
    desk: Optional[str] = None
    book: Optional[str] = None
    strategy: Optional[str] = None


def serialize(t: Trade) -> dict:
    return {
        "id": str(t.id),
        "trade_ref": t.trade_ref,
        "uti": t.uti,
        "status": t.status,
        "store": t.store,
        "asset_class": t.asset_class,
        "instrument_type": t.instrument_type,
        "own_legal_entity_id": str(t.own_legal_entity_id) if t.own_legal_entity_id else None,
        "counterparty_id": str(t.counterparty_id) if t.counterparty_id else None,
        "own_entity": (
            {"id": str(t.own_entity.id), "name": t.own_entity.name, "short_name": t.own_entity.short_name}
            if t.own_entity else None
        ),
        "counterparty": (
            {"id": str(t.counterparty.id), "name": t.counterparty.name}
            if t.counterparty else None
        ),
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


def _with_relations(q):
    return q.options(
        joinedload(Trade.own_entity),
        joinedload(Trade.counterparty),
    )


@router.get("/")
def get_trades(
    status: Optional[str] = Query(None),
    asset_class: Optional[str] = Query(None),
    store: Optional[str] = Query(None),
    counterparty_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    q = _with_relations(db.query(Trade))
    if status:        q = q.filter(Trade.status == status)
    if asset_class:   q = q.filter(Trade.asset_class == asset_class)
    if store:         q = q.filter(Trade.store == store)
    if counterparty_id:
        q = q.filter(Trade.counterparty_id == uuid.UUID(counterparty_id))
    return [serialize(t) for t in q.order_by(Trade.trade_date.desc(), Trade.created_at.desc()).all()]


@router.get("/summary")
def trades_summary(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    total     = db.query(Trade).count()
    live      = db.query(Trade).filter(Trade.status == "LIVE").count()
    pending   = db.query(Trade).filter(Trade.status == "PENDING").count()
    matured   = db.query(Trade).filter(Trade.status == "MATURED").count()
    cancelled = db.query(Trade).filter(Trade.status == "CANCELLED").count()
    return {"total": total, "live": live, "pending": pending, "matured": matured, "cancelled": cancelled}


@router.post("/")
def create_trade(body: TradeCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    data = body.dict()
    for fk in ["own_legal_entity_id", "counterparty_id"]:
        if data.get(fk):
            data[fk] = uuid.UUID(data[fk])
    for d in ["trade_date", "effective_date", "maturity_date"]:
        if data.get(d):
            data[d] = date.fromisoformat(data[d])
    trade = Trade(**data, created_by=uuid.UUID(user["sub"]))
    db.add(trade)
    db.commit()
    db.refresh(trade)
    trade = _with_relations(db.query(Trade)).filter(Trade.id == trade.id).first()
    return serialize(trade)


@router.put("/{trade_id}")
def update_trade(
    trade_id: str, body: TradeUpdate,
    db: Session = Depends(get_db), user: dict = Depends(verify_token),
):
    trade = db.query(Trade).filter(Trade.id == uuid.UUID(trade_id)).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    for k, v in body.dict(exclude_none=True).items():
        setattr(trade, k, v)
    trade.last_modified_by = uuid.UUID(user["sub"])
    db.commit()
    return {"id": trade_id, "status": trade.status}


@router.delete("/{trade_id}")
def delete_trade(trade_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    trade = db.query(Trade).filter(Trade.id == uuid.UUID(trade_id)).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    if trade.status not in ("PENDING", "CANCELLED"):
        raise HTTPException(status_code=400, detail="Only PENDING or CANCELLED trades can be deleted")
    db.delete(trade)
    db.commit()
    return {"deleted": trade_id}
