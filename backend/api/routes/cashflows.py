"""
Rijeka — /api/cashflows/ routes
Sprint 3C: generated cashflow schedule.

GET  /api/cashflows/{trade_id}              all cashflows for a trade (by payment date)
GET  /api/cashflows/leg/{leg_id}            all cashflows for a single leg
POST /api/cashflows/bulk                    write full schedule at booking (replaces existing)
PUT  /api/cashflows/{cashflow_id}/override  non-destructive amount override
PUT  /api/cashflows/{cashflow_id}/status    status transition (CONFIRMED/SETTLED/CANCELLED)
DELETE /api/cashflows/trade/{trade_id}      wipe + regenerate (called by pricing engine)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
import uuid

from db.session import get_db
from db.models import Cashflow
from middleware.auth import verify_token

router = APIRouter(prefix="/api/cashflows", tags=["cashflows"])

WRITE_ROLES  = {"trader", "admin"}
VALID_STATUS = {"PROJECTED", "CONFIRMED", "SETTLED", "CANCELLED"}


# ── Schemas ───────────────────────────────────────────────────
class CashflowIn(BaseModel):
    trade_id:     UUID
    leg_id:       UUID
    period_start: date
    period_end:   date
    payment_date: date
    fixing_date:  Optional[date]    = None
    currency:     str
    notional:     Optional[Decimal] = None
    rate:         Optional[Decimal] = None
    dcf:          Optional[Decimal] = None
    amount:       Decimal


class CashflowBulkIn(BaseModel):
    """Replace entire cashflow schedule for a trade."""
    trade_id:   UUID
    cashflows:  List[CashflowIn]


class CashflowOverrideIn(BaseModel):
    amount_override: Decimal


class CashflowStatusIn(BaseModel):
    status: str


class CashflowOut(BaseModel):
    id:              UUID
    trade_id:        UUID
    leg_id:          UUID
    period_start:    date
    period_end:      date
    payment_date:    date
    fixing_date:     Optional[date]
    currency:        str
    notional:        Optional[Decimal]
    rate:            Optional[Decimal]
    dcf:             Optional[Decimal]
    amount:          Decimal
    amount_override: Optional[Decimal]
    is_overridden:   bool
    status:          str
    cashflow_hash:   Optional[str]
    generated_at:    datetime
    last_modified_at: Optional[datetime]

    model_config = {"from_attributes": True}


# ── Routes ────────────────────────────────────────────────────
@router.get("/{trade_id}", response_model=List[CashflowOut])
def list_cashflows_for_trade(
    trade_id: UUID,
    db:       Session = Depends(get_db),
    user:     dict    = Depends(verify_token),
):
    """All cashflows for a trade ordered by payment date."""
    return (
        db.query(Cashflow)
        .filter(Cashflow.trade_id == trade_id)
        .order_by(Cashflow.payment_date, Cashflow.leg_id)
        .all()
    )


@router.get("/leg/{leg_id}", response_model=List[CashflowOut])
def list_cashflows_for_leg(
    leg_id: UUID,
    db:     Session = Depends(get_db),
    user:   dict    = Depends(verify_token),
):
    """All cashflows for a single leg ordered by payment date."""
    return (
        db.query(Cashflow)
        .filter(Cashflow.leg_id == leg_id)
        .order_by(Cashflow.payment_date)
        .all()
    )


@router.post("/bulk", response_model=List[CashflowOut], status_code=201)
def write_cashflow_schedule(
    body: CashflowBulkIn,
    db:   Session = Depends(get_db),
    user: dict    = Depends(verify_token),
):
    """
    Write a complete cashflow schedule for a trade.
    Deletes existing PROJECTED cashflows first (repricing wipe-and-replace).
    Preserves CONFIRMED and SETTLED cashflows — those have already been fixed/settled.
    Called by the pricing engine after bootstrapping curves.
    """
    role = (user.get("user_metadata") or {}).get("role", "viewer").lower()
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Requires Trader or Admin role.")

    # Wipe only PROJECTED cashflows — preserve CONFIRMED/SETTLED
    db.query(Cashflow).filter(
        Cashflow.trade_id == body.trade_id,
        Cashflow.status == "PROJECTED"
    ).delete(synchronize_session=False)

    created = []
    for cf in body.cashflows:
        row = Cashflow(
            id=uuid.uuid4(),
            trade_id=cf.trade_id,
            leg_id=cf.leg_id,
            period_start=cf.period_start,
            period_end=cf.period_end,
            payment_date=cf.payment_date,
            fixing_date=cf.fixing_date,
            currency=cf.currency,
            notional=cf.notional,
            rate=cf.rate,
            dcf=cf.dcf,
            amount=cf.amount,
            status="PROJECTED",
        )
        db.add(row)
        created.append(row)

    db.commit()
    for row in created:
        db.refresh(row)
    return created


@router.put("/{cashflow_id}/override", response_model=CashflowOut)
def override_cashflow(
    cashflow_id: UUID,
    body:        CashflowOverrideIn,
    db:          Session = Depends(get_db),
    user:        dict    = Depends(verify_token),
):
    """
    Non-destructive amount override — mirrors trades.terms.cashflow_overrides.
    Original generated amount preserved in 'amount'.
    Effective amount = amount_override (when set) or amount.
    """
    role = (user.get("user_metadata") or {}).get("role", "viewer").lower()
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Requires Trader or Admin role.")

    cf = db.query(Cashflow).filter(Cashflow.id == cashflow_id).first()
    if not cf:
        raise HTTPException(status_code=404, detail="Cashflow not found.")

    cf.amount_override  = body.amount_override
    cf.is_overridden    = True
    cf.last_modified_at = datetime.utcnow()
    cf.last_modified_by = user.get("sub")
    db.commit()
    db.refresh(cf)
    return cf


@router.put("/{cashflow_id}/status", response_model=CashflowOut)
def update_cashflow_status(
    cashflow_id: UUID,
    body:        CashflowStatusIn,
    db:          Session = Depends(get_db),
    user:        dict    = Depends(verify_token),
):
    """Transition cashflow status: PROJECTED → CONFIRMED → SETTLED or CANCELLED."""
    role = (user.get("user_metadata") or {}).get("role", "viewer").lower()
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Requires Trader or Admin role.")

    if body.status not in VALID_STATUS:
        raise HTTPException(status_code=422, detail=f"Invalid status: {body.status}")

    cf = db.query(Cashflow).filter(Cashflow.id == cashflow_id).first()
    if not cf:
        raise HTTPException(status_code=404, detail="Cashflow not found.")

    cf.status           = body.status
    cf.last_modified_at = datetime.utcnow()
    cf.last_modified_by = user.get("sub")
    db.commit()
    db.refresh(cf)
    return cf


@router.delete("/trade/{trade_id}", status_code=204)
def wipe_projected_cashflows(
    trade_id: UUID,
    db:       Session = Depends(get_db),
    user:     dict    = Depends(verify_token),
):
    """
    Wipe all PROJECTED cashflows for a trade.
    Called before repricing to clear stale schedule.
    CONFIRMED and SETTLED cashflows are never touched.
    """
    role = (user.get("user_metadata") or {}).get("role", "viewer").lower()
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Requires Trader or Admin role.")

    db.query(Cashflow).filter(
        Cashflow.trade_id == trade_id,
        Cashflow.status == "PROJECTED"
    ).delete(synchronize_session=False)
    db.commit()
