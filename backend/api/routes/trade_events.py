"""
Rijeka -- /api/trade-events/ routes
Merged: Sprint 3 event stream foundation + Sprint 12 item 3 atomic lifecycle.

Sprint 3 endpoints (generic event stream, lower-level primitives):
  GET  /api/trade-events/{trade_id}   list events for a trade (any role)
  POST /api/trade-events/             append a generic event (trader/admin)
  GET  /api/trade-events/             list all events, optional type filter

Sprint 12 endpoints (atomic lifecycle, state-machine-enforced):
  POST /api/trade-events/confirm/{trade_id}   PENDING -> CONFIRMED
  POST /api/trade-events/cancel/{trade_id}    PENDING -> CANCELLED (terminal)

NO PUT. NO DELETE. Event stream is append-only.

The Sprint 12 confirm/cancel endpoints wrap the full state transition
(event insert + trade projection update + idempotency cache) in a single
Postgres transaction. They enforce the charter's state-machine contract
(Section 4.1) -- only PENDING trades can be confirmed or cancelled.

The Sprint 3 generic POST is a lower-level primitive that appends an event
without touching the trade projection. It intentionally rejects CONFIRMED
(not in VALID_EVENT_TYPES) so the atomic endpoint is the only path that
can produce a CONFIRMED event. Callers using the generic POST for state
transitions that DO have a dedicated atomic endpoint should migrate.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy.orm import Session
from sqlalchemy import desc
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import date, datetime
from copy import deepcopy
from uuid import UUID
import uuid
import logging

from db.session import get_db
from db.models import Trade, TradeLeg, TradeEvent, IdempotencyKey
from middleware.auth import verify_token
from projections.trade_projection import project_from_db
from api.routes.booking import _serialize_trade, _serialize_leg

router = APIRouter(prefix="/api/trade-events", tags=["trade_events"])
log = logging.getLogger(__name__)


# -- Valid event types (Sprint 3 generic POST) --------------------------
# NOTE: CONFIRMED is deliberately absent. The atomic confirm endpoint is
# the only sanctioned way to produce a CONFIRMED event, because it also
# updates the trade projection. Appending CONFIRMED via the generic POST
# would create a projection-inconsistency footgun.
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

WRITE_ROLES = {"trader", "admin"}


# -- Schemas ------------------------------------------------------------

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


class CancelRequest(BaseModel):
    """Optional cancellation reason stored in event payload for audit trail."""
    reason: Optional[str] = None


# =======================================================================
# Sprint 3 generic event stream endpoints
# =======================================================================

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
    Requires TRADER or ADMIN role -- VIEWERs are blocked.

    This is the lower-level primitive. For state transitions with dedicated
    atomic endpoints (CONFIRMED, CANCELLED), use those endpoints instead --
    they also update the trade projection in the same transaction.
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
    Paginated feed of all events across trades -- useful for
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


# =======================================================================
# Sprint 12 item 3 -- atomic lifecycle helpers
# =======================================================================

def _check_write_role(user: dict) -> UUID:
    """Gate endpoint to Trader/Admin roles; return authenticated user_id."""
    role = (user.get("user_metadata") or {}).get("role", "viewer").lower()
    if role not in WRITE_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Trade lifecycle events require Trader or Admin role.",
        )
    return uuid.UUID(user["sub"])


def _parse_trade_uuid(trade_id: str) -> UUID:
    try:
        return UUID(trade_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="trade_id must be a UUID")


def _validate_idempotency_header(key: Optional[str]) -> None:
    if key is None:
        return
    try:
        UUID(key)
    except ValueError:
        raise HTTPException(status_code=400, detail="Idempotency-Key must be a UUID")


def _lookup_idempotent(
    db: Session, user_id: UUID, idempotency_key: Optional[str]
) -> Optional[dict]:
    """Return cached result if this (user_id, key) has a hit, else None."""
    if not idempotency_key:
        return None
    cached = (
        db.query(IdempotencyKey)
        .filter(IdempotencyKey.user_id == user_id,
                IdempotencyKey.key == idempotency_key)
        .first()
    )
    if cached:
        return {**cached.result, "idempotent_replay": True}
    return None


def _load_pending_trade(db: Session, trade_id: UUID, user_id: UUID) -> Trade:
    """
    Fetch the trade iff it belongs to this user.
    404 if the trade does not exist OR belongs to another user (no existence
    leak across tenants). 409 if it exists but is not in PENDING state.
    """
    trade = (
        db.query(Trade)
        .filter(Trade.id == trade_id, Trade.user_id == user_id)
        .first()
    )
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    if trade.status != "PENDING":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Trade status is {trade.status}. "
                "Only PENDING trades can be confirmed or cancelled."
            ),
        )
    return trade


def _build_lifecycle_response(db: Session, trade: Trade, event_id: UUID) -> dict:
    """Serialize trade + legs for atomic-endpoint response (mirrors booking.py)."""
    legs = (
        db.query(TradeLeg)
        .filter(TradeLeg.trade_id == trade.id)
        .order_by(TradeLeg.leg_seq)
        .all()
    )
    return {
        "trade": _serialize_trade(trade),
        "legs": [_serialize_leg(l) for l in legs],
        "event_id": str(event_id),
        "idempotent_replay": False,
    }


def _apply_lifecycle_transition(
    db: Session,
    user_id: UUID,
    trade: Trade,
    event_type: str,
    new_status: str,
    payload: dict,
    idempotency_key: Optional[str],
) -> dict:
    """
    Shared atomic path for CONFIRMED / CANCELLED.

    Transaction:
      1. Compute pre_state via projection (current trade+legs+cashflows)
      2. Build post_state (pre_state + status flip)
      3. INSERT TradeEvent  (trigger assigns event_seq, tx_time, valid_time)
      4. UPDATE trade.status, latest_event_id, version_seq
      5. If Idempotency-Key given, cache the result row
      6. COMMIT

    On any failure rolls back entirely -- no partial state survives.
    """
    event_id = uuid.uuid4()
    today = date.today()

    # Build audit snapshots: current projection, then status-flipped copy.
    pre_state = project_from_db(db, trade.id)
    post_state = deepcopy(pre_state)
    if post_state.get("trade") is not None:
        post_state["trade"]["status"] = new_status

    try:
        event = TradeEvent(
            id=event_id,
            trade_id=trade.id,
            event_type=event_type,
            event_date=today,
            effective_date=today,
            payload=payload,
            pre_state=pre_state,
            post_state=post_state,
            user_id=user_id,
            created_by=user_id,
        )
        db.add(event)
        db.flush()

        # Projection update: status, latest_event_id, version_seq.
        trade.status = new_status
        trade.latest_event_id = event_id
        trade.version_seq = (trade.version_seq or 0) + 1

        db.flush()
        db.refresh(trade)

        result = _build_lifecycle_response(db, trade, event_id)

        if idempotency_key:
            db.add(IdempotencyKey(
                key=idempotency_key,
                user_id=user_id,
                result=result,
            ))

        db.commit()
        return result

    except IntegrityError as e:
        db.rollback()
        msg = str(e.orig) if e.orig else str(e)

        # Race on Idempotency-Key -- refetch winner's cached result.
        if idempotency_key and (
            "idempotency_keys" in msg or "pk_idempotency_keys" in msg
        ):
            cached = (
                db.query(IdempotencyKey)
                .filter(IdempotencyKey.user_id == user_id,
                        IdempotencyKey.key == idempotency_key)
                .first()
            )
            if cached:
                return {**cached.result, "idempotent_replay": True}

        log.exception(f"{event_type} integrity error")
        raise HTTPException(status_code=409, detail=f"Integrity error: {msg}")

    except HTTPException:
        db.rollback()
        raise

    except Exception as e:
        db.rollback()
        log.exception(f"{event_type} transition failed")
        raise HTTPException(status_code=500, detail=f"{event_type} failed: {e}")


# =======================================================================
# Sprint 12 item 3 -- atomic lifecycle routes
# =======================================================================

@router.post("/confirm/{trade_id}", status_code=201)
def confirm_trade(
    trade_id: str,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    PENDING -> CONFIRMED.
    Appends a CONFIRMED event and flips trade.status atomically.
    Returns the updated trade projection with the new event_id.
    """
    user_id = _check_write_role(user)
    _validate_idempotency_header(idempotency_key)

    cached = _lookup_idempotent(db, user_id, idempotency_key)
    if cached:
        return cached

    trade_uuid = _parse_trade_uuid(trade_id)
    trade = _load_pending_trade(db, trade_uuid, user_id)

    return _apply_lifecycle_transition(
        db=db,
        user_id=user_id,
        trade=trade,
        event_type="CONFIRMED",
        new_status="CONFIRMED",
        payload={},
        idempotency_key=idempotency_key,
    )


@router.post("/cancel/{trade_id}", status_code=201)
def cancel_trade(
    trade_id: str,
    body: Optional[CancelRequest] = None,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    PENDING -> CANCELLED (terminal state).
    Appends a CANCELLED event and flips trade.status atomically.
    Optional body {"reason": "..."} is stored in the event payload.
    """
    user_id = _check_write_role(user)
    _validate_idempotency_header(idempotency_key)

    cached = _lookup_idempotent(db, user_id, idempotency_key)
    if cached:
        return cached

    trade_uuid = _parse_trade_uuid(trade_id)
    trade = _load_pending_trade(db, trade_uuid, user_id)

    payload: dict = {}
    if body and body.reason:
        payload["reason"] = body.reason

    return _apply_lifecycle_transition(
        db=db,
        user_id=user_id,
        trade=trade,
        event_type="CANCELLED",
        new_status="CANCELLED",
        payload=payload,
        idempotency_key=idempotency_key,
    )
