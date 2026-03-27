"""
Rijeka — /api/trade-events/ routes
Sprint 3: event stream foundation.

GET  /api/trade-events/{trade_id}          list events for a trade (newest first)
POST /api/trade-events/                    append event (traders + admins)

NO PUT. NO DELETE. Event stream is append-only.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import date, datetime
from uuid import UUID
import uuid

from db.session import get_db
from db.models import TradeEvent
from middleware.auth import verify_token

router = APIRouter(prefix="/api/trade-events", tags=["trade_events"])

# ── Valid event types ──────────────────────────────────────────
VALID_EVENT_TYPES = {
    "BOOKED",
    "ACTIVATED",
    "AMENDED",
    "BOOK_TRANSFER",
    "STORE_CHANGE",
    "PARTIAL_TERMINATION",
    "NOVATED",
    "TERMINATED",
    "MATURED",
    "CANCELLED",
    "DEFAULTED",
    "COMPRESSION",
    "CREDIT_EVENT",
}

# Roles allowed to write events (VIEWERs are read-only)
WRITE_ROLES = {"trader", "admin"}


# ── Schemas ───────────────────────────────────────────────────
class TradeEventCreate(BaseModel):
    trade_id:               UUID
    event_type:             str
    event_date:             date
    effective_date:         date
    payload:                dict  = {}
    pre_state:              dict  = {}
    post_state:             dict  = {}
    counterparty_confirmed: bool  = False
    confirmation_hash:      Optional[str] = None

    @field_validator("event_type")
    @classmethod
    def validate_event_type(cls, v: str) -> str:
        if v not in VALID_EVENT_TYPES:
            raise ValueError(
                f"Invalid event_type '{v}'. "
                f"Must be one of: {sorted(VALID_EVENT_TYPES)}"
            )
        return v


class TradeEventOut(BaseModel):
    id:                     UUID
    trade_id:               UUID
    event_type:             str
    event_date:             date
    effective_date:         date
    payload:                dict
    pre_state:              dict
    post_state:             dict
    counterparty_confirmed: bool
    confirmation_hash:      Optional[str]
    created_at:             datetime
    created_by:             Optional[UUID]

    model_config = {"from_attributes": True}


# ── Routes ────────────────────────────────────────────────────
@router.get("/{trade_id}", response_model=List[TradeEventOut])
def list_trade_events(
    trade_id: UUID,
    limit:    int     = Query(default=200, ge=1, le=1000),
    offset:   int     = Query(default=0,   ge=0),
    db:       Session = Depends(get_db),
    user:     dict    = Depends(verify_token),
):
    """
    Return all events for a trade, newest first.
    All authenticated users can read (VIEWERs included).
    """
    events = (
        db.query(TradeEvent)
        .filter(TradeEvent.trade_id == trade_id)
        .order_by(desc(TradeEvent.created_at))
        .offset(offset)
        .limit(limit)
        .all()
    )
    return events


@router.post("/", response_model=TradeEventOut, status_code=201)
def append_trade_event(
    body: TradeEventCreate,
    db:   Session = Depends(get_db),
    user: dict    = Depends(verify_token),
):
    """
    Append an immutable event to the stream.
    Requires TRADER or ADMIN role — VIEWERs are blocked.
    """
    role = (user.get("user_metadata") or {}).get("role", "viewer").lower()
    if role not in WRITE_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Event creation requires Trader or Admin role."
        )

    event = TradeEvent(
        id=uuid.uuid4(),
        trade_id=body.trade_id,
        event_type=body.event_type,
        event_date=body.event_date,
        effective_date=body.effective_date,
        payload=body.payload,
        pre_state=body.pre_state,
        post_state=body.post_state,
        counterparty_confirmed=body.counterparty_confirmed,
        confirmation_hash=body.confirmation_hash,
        created_by=user.get("sub"),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.get("/", response_model=List[TradeEventOut])
def list_all_events(
    event_type: Optional[str] = Query(default=None),
    limit:      int           = Query(default=100, ge=1, le=500),
    offset:     int           = Query(default=0,   ge=0),
    db:         Session       = Depends(get_db),
    user:       dict          = Depends(verify_token),
):
    """
    Paginated feed of all events across trades — useful for
    PNL attribution and risk feeds in Sprint 4.
    """
    q = db.query(TradeEvent).order_by(desc(TradeEvent.created_at))
    if event_type:
        if event_type not in VALID_EVENT_TYPES:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown event_type filter: {event_type}"
            )
        q = q.filter(TradeEvent.event_type == event_type)
    return q.offset(offset).limit(limit).all()
