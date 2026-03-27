"""
Rijeka — /api/trade-legs/ routes
Sprint 3B: first-class leg store.

GET  /api/trade-legs/{trade_id}         all legs for a trade (ordered by leg_seq)
GET  /api/trade-legs/leg/{leg_id}       single leg
POST /api/trade-legs/                   create/upsert a leg at booking
PUT  /api/trade-legs/leg/{leg_id}       update non-economic fields (pre-live only)

No hard DELETE — use trade status transitions + trade_events.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
import uuid

from db.session import get_db
from db.models import TradeLeg
from middleware.auth import verify_token

router = APIRouter(prefix="/api/trade-legs", tags=["trade_legs"])

WRITE_ROLES = {"trader", "admin"}

VALID_LEG_TYPES = {
    "FIXED", "FLOAT", "ZERO_COUPON", "INFLATION",
    "CMS", "CDS_FEE", "CDS_CONTINGENT",
    "TOTAL_RETURN", "EQUITY_RETURN", "EQUITY_FWD",
    "VARIANCE", "DIVIDEND",
    "COMMODITY_FLOAT", "EMISSIONS_FLOAT",
    "RPA_FEE", "RPA_CONTINGENT",
    # Sprint 3E: Options
    "IR_SWAPTION", "CAP_FLOOR",
    "FX_OPTION",
    "EQUITY_OPTION",
    "COMMODITY_OPTION",
    "CDS_OPTION",
    # Sprint 3F: Extended options
    "BERMUDAN_SWAPTION",
    "CALLABLE_SWAP_OPTION",
    "CAPPED_FLOORED_FLOAT",
    "EXTENDABLE_FORWARD",
    "COMMODITY_ASIAN_OPTION",
}


# ── Schemas ───────────────────────────────────────────────────
class TradeLegCreate(BaseModel):
    id:                  UUID
    trade_id:            UUID
    leg_ref:             str
    leg_seq:             int           = 0
    leg_type:            str
    direction:           str
    currency:            str
    notional:            Optional[Decimal] = None
    notional_type:       str           = "BULLET"
    notional_schedule:   Optional[dict] = None
    effective_date:      Optional[date] = None
    maturity_date:       Optional[date] = None
    first_period_start:  Optional[date] = None
    last_period_end:     Optional[date] = None
    day_count:           Optional[str]  = None
    payment_frequency:   Optional[str]  = None
    reset_frequency:     Optional[str]  = None
    bdc:                 Optional[str]  = None
    stub_type:           Optional[str]  = None
    payment_calendar:    Optional[str]  = None
    payment_lag:         int            = 0
    fixed_rate:          Optional[Decimal] = None
    fixed_rate_type:     str            = "FLAT"
    fixed_rate_schedule: Optional[dict] = None
    spread:              Optional[Decimal] = None
    spread_type:         str            = "FLAT"
    spread_schedule:     Optional[dict] = None
    forecast_curve_id:   Optional[str]  = None
    cap_rate:            Optional[Decimal] = None
    floor_rate:          Optional[Decimal] = None
    leverage:            Optional[Decimal] = Decimal("1.0")
    ois_compounding:     Optional[str]  = None
    discount_curve_id:   Optional[str]  = None
    terms:               dict           = {}
    leg_hash:            Optional[str]  = None
    booked_at:           Optional[datetime] = None

    @field_validator("leg_type")
    @classmethod
    def validate_leg_type(cls, v):
        if v not in VALID_LEG_TYPES:
            raise ValueError(f"Invalid leg_type '{v}'. Must be one of: {sorted(VALID_LEG_TYPES)}")
        return v

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, v):
        if v not in ("PAY", "RECEIVE"):
            raise ValueError("direction must be PAY or RECEIVE")
        return v


class TradeLegUpdate(BaseModel):
    """
    Only fields safe to update post-booking.
    Economic fields (fixed_rate, notional, maturity) require an AMENDED event
    and will be handled by the pricing engine in a later sprint.
    """
    discount_curve_id:  Optional[str]  = None
    forecast_curve_id:  Optional[str]  = None
    payment_calendar:   Optional[str]  = None
    terms:              Optional[dict] = None


class TradeLegOut(BaseModel):
    id:                  UUID
    trade_id:            UUID
    leg_ref:             str
    leg_seq:             int
    leg_type:            str
    direction:           str
    currency:            str
    notional:            Optional[Decimal]
    notional_type:       str
    notional_schedule:   Optional[dict]
    effective_date:      Optional[date]
    maturity_date:       Optional[date]
    first_period_start:  Optional[date]
    last_period_end:     Optional[date]
    day_count:           Optional[str]
    payment_frequency:   Optional[str]
    reset_frequency:     Optional[str]
    bdc:                 Optional[str]
    stub_type:           Optional[str]
    payment_calendar:    Optional[str]
    payment_lag:         int
    fixed_rate:          Optional[Decimal]
    fixed_rate_type:     str
    fixed_rate_schedule: Optional[dict]
    spread:              Optional[Decimal]
    spread_type:         str
    spread_schedule:     Optional[dict]
    forecast_curve_id:   Optional[str]
    cap_rate:            Optional[Decimal]
    floor_rate:          Optional[Decimal]
    leverage:            Optional[Decimal]
    ois_compounding:     Optional[str]
    discount_curve_id:   Optional[str]
    terms:               dict
    leg_hash:            Optional[str]
    booked_at:           Optional[datetime]
    created_at:          datetime
    created_by:          Optional[UUID]
    last_modified_at:    Optional[datetime]

    model_config = {"from_attributes": True}


# ── Routes ────────────────────────────────────────────────────
@router.get("/{trade_id}", response_model=List[TradeLegOut])
def list_legs_for_trade(
    trade_id: UUID,
    db:       Session = Depends(get_db),
    user:     dict    = Depends(verify_token),
):
    """All legs for a trade, ordered by leg_seq."""
    return (
        db.query(TradeLeg)
        .filter(TradeLeg.trade_id == trade_id)
        .order_by(TradeLeg.leg_seq)
        .all()
    )


@router.get("/leg/{leg_id}", response_model=TradeLegOut)
def get_leg(
    leg_id: UUID,
    db:     Session = Depends(get_db),
    user:   dict    = Depends(verify_token),
):
    leg = db.query(TradeLeg).filter(TradeLeg.id == leg_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Leg not found")
    return leg


@router.post("/", response_model=TradeLegOut, status_code=201)
def create_leg(
    body: TradeLegCreate,
    db:   Session = Depends(get_db),
    user: dict    = Depends(verify_token),
):
    """
    Create a leg at booking time. leg_id set client-side (crypto.randomUUID()).
    Called once per leg when a trade is booked.
    """
    role = (user.get("user_metadata") or {}).get("role", "viewer").lower()
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Leg creation requires Trader or Admin role.")

    existing = db.query(TradeLeg).filter(TradeLeg.id == body.id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Leg {body.id} already exists.")

    leg = TradeLeg(**body.model_dump(), created_by=user.get("sub"))
    db.add(leg)
    db.commit()
    db.refresh(leg)
    return leg


@router.put("/leg/{leg_id}", response_model=TradeLegOut)
def update_leg(
    leg_id: UUID,
    body:   TradeLegUpdate,
    db:     Session = Depends(get_db),
    user:   dict    = Depends(verify_token),
):
    """
    Update non-economic leg fields only.
    Economic amendments require a trade_event AMENDED entry first.
    """
    role = (user.get("user_metadata") or {}).get("role", "viewer").lower()
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Requires Trader or Admin role.")

    leg = db.query(TradeLeg).filter(TradeLeg.id == leg_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Leg not found")

    updates = body.model_dump(exclude_none=True)
    for field, value in updates.items():
        setattr(leg, field, value)

    leg.last_modified_at = datetime.utcnow()
    leg.last_modified_by = user.get("sub")
    db.commit()
    db.refresh(leg)
    return leg
