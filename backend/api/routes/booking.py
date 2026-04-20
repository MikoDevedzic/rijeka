"""
Rijeka — atomic trade booking
Sprint 12 item 3.

Single endpoint POST /api/book/trade that atomically:
  1. Inserts Trade projection row (latest_event_id=NULL, version_seq=0)
  2. Inserts BOOKED TradeEvent (trigger assigns event_seq=1, tx_time, valid_time)
  3. Inserts TradeLeg projection rows (latest_event_id=event_id, version_seq=1)
  4. Updates trade.latest_event_id = event_id, version_seq = 1
All in one Postgres transaction. Rolls back entirely on any failure.

Supports Idempotency-Key header (UUID). Duplicate calls with same key
for the same user return the cached result without creating a second trade.

Charter §1.1 invariants:
  - Idempotent booking: same key, same result, at most one trade
  - Event stream replay: BOOKED event carries full {trade, legs} payload,
    projection function reconstructs identically

Cashflows stay outside this endpoint: they're a pricing artifact populated
by /price after booking. Cashflow rows set event_id=BOOKED.id for provenance
(wired in a follow-up patch to pricer.py).
"""

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, List, Dict, Any
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
import uuid
import time
import logging

from db.session import get_db
from db.models import Trade, TradeLeg, TradeEvent, IdempotencyKey
from middleware.auth import verify_token

router = APIRouter(prefix="/api/book", tags=["booking"])
log = logging.getLogger(__name__)

WRITE_ROLES = {"trader", "admin"}


# ── Schemas ───────────────────────────────────────────────────

class LegInput(BaseModel):
    """Leg payload for atomic booking. id + trade_id assigned server-side."""
    leg_ref:             str
    leg_seq:             int = 0
    leg_type:            str
    direction:           str
    currency:            str
    notional:            Optional[Decimal] = None
    notional_type:       str = "BULLET"
    notional_schedule:   Optional[dict] = None
    effective_date:      Optional[date] = None
    maturity_date:       Optional[date] = None
    first_period_start:  Optional[date] = None
    last_period_end:     Optional[date] = None
    day_count:           Optional[str] = None
    payment_frequency:   Optional[str] = None
    reset_frequency:     Optional[str] = None
    bdc:                 Optional[str] = None
    stub_type:           Optional[str] = None
    payment_calendar:    Optional[str] = None
    payment_lag:         int = 0
    fixed_rate:          Optional[Decimal] = None
    fixed_rate_type:     str = "FLAT"
    fixed_rate_schedule: Optional[dict] = None
    spread:              Optional[Decimal] = None
    spread_type:         str = "FLAT"
    spread_schedule:     Optional[dict] = None
    forecast_curve_id:   Optional[str] = None
    cap_rate:            Optional[Decimal] = None
    floor_rate:          Optional[Decimal] = None
    leverage:            Optional[Decimal] = Decimal("1.0")
    ois_compounding:     Optional[str] = None
    discount_curve_id:   Optional[str] = None
    terms:               dict = {}

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, v):
        if v not in ("PAY", "RECEIVE"):
            raise ValueError("direction must be PAY or RECEIVE")
        return v


class BookingRequest(BaseModel):
    """Full atomic booking payload. Matches TradeCreate + legs."""
    trade_ref:           Optional[str] = None
    asset_class:         str
    instrument_type:     str
    structure:           Optional[str] = None
    store:               str = "WORKING"
    own_legal_entity_id: Optional[str] = None
    counterparty_id:     Optional[str] = None
    notional:            Decimal
    notional_ccy:        str = "USD"
    trade_date:          date
    effective_date:      date
    maturity_date:       date
    terms:               Dict[str, Any] = {}
    discount_curve_id:   Optional[str] = None
    forecast_curve_id:   Optional[str] = None
    desk:                Optional[str] = None
    book:                Optional[str] = None
    strategy:            Optional[str] = None
    legs:                List[LegInput]

    @field_validator("notional")
    @classmethod
    def positive_notional(cls, v):
        if v is None or v <= 0:
            raise ValueError("notional must be > 0")
        return v

    @field_validator("legs")
    @classmethod
    def at_least_one_leg(cls, v):
        if not v:
            raise ValueError("at least one leg is required")
        return v

    @model_validator(mode="after")
    def validate_dates(self):
        if self.effective_date > self.maturity_date:
            raise ValueError("effective_date must be on or before maturity_date")
        return self


# ── Helpers ───────────────────────────────────────────────────

def _json_safe(v):
    """Convert Decimal/date/datetime/UUID to JSON-safe values for JSONB storage."""
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, dict):
        return {k: _json_safe(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_json_safe(x) for x in v]
    return v


def build_booked_payload(body: BookingRequest, trade_id: UUID, leg_ids: List[UUID]) -> dict:
    """
    Pure function: assemble the BOOKED event payload from validated input.
    Shape matches trade_projection._h_booked contract:
        {"trade": {...}, "legs": [...], "cashflows": []}
    """
    trade_dict = _json_safe({
        "id": trade_id,
        "trade_ref": body.trade_ref,
        "asset_class": body.asset_class,
        "instrument_type": body.instrument_type,
        "structure": body.structure,
        "store": body.store,
        "own_legal_entity_id": body.own_legal_entity_id,
        "counterparty_id": body.counterparty_id,
        "notional": body.notional,
        "notional_ccy": body.notional_ccy,
        "trade_date": body.trade_date,
        "effective_date": body.effective_date,
        "maturity_date": body.maturity_date,
        "terms": body.terms,
        "discount_curve_id": body.discount_curve_id,
        "forecast_curve_id": body.forecast_curve_id,
        "desk": body.desk,
        "book": body.book,
        "strategy": body.strategy,
    })

    legs_dicts = []
    for leg_id, leg in zip(leg_ids, body.legs):
        d = _json_safe({
            **leg.model_dump(),
            "id": leg_id,
            "trade_id": trade_id,
        })
        legs_dicts.append(d)

    return {
        "trade": trade_dict,
        "legs": legs_dicts,
        "cashflows": [],
    }


def _serialize_trade(t: Trade) -> dict:
    return {
        "id": str(t.id),
        "trade_ref": t.trade_ref,
        "status": t.status,
        "store": t.store,
        "asset_class": t.asset_class,
        "instrument_type": t.instrument_type,
        "structure": t.structure,
        "counterparty_id": str(t.counterparty_id) if t.counterparty_id else None,
        "own_legal_entity_id": str(t.own_legal_entity_id) if t.own_legal_entity_id else None,
        "notional": float(t.notional) if t.notional is not None else None,
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
        "latest_event_id": str(t.latest_event_id) if t.latest_event_id else None,
        "version_seq": t.version_seq,
        "user_id": str(t.user_id) if t.user_id else None,
    }


def _serialize_leg(l: TradeLeg) -> dict:
    return {
        "id": str(l.id),
        "trade_id": str(l.trade_id),
        "leg_ref": l.leg_ref,
        "leg_seq": l.leg_seq,
        "leg_type": l.leg_type,
        "direction": l.direction,
        "currency": l.currency,
        "notional": float(l.notional) if l.notional is not None else None,
        "notional_type": l.notional_type,
        "effective_date": l.effective_date.isoformat() if l.effective_date else None,
        "maturity_date": l.maturity_date.isoformat() if l.maturity_date else None,
        "fixed_rate": float(l.fixed_rate) if l.fixed_rate is not None else None,
        "spread": float(l.spread) if l.spread is not None else None,
        "day_count": l.day_count,
        "payment_frequency": l.payment_frequency,
        "reset_frequency": l.reset_frequency,
        "bdc": l.bdc,
        "payment_calendar": l.payment_calendar,
        "payment_lag": l.payment_lag,
        "forecast_curve_id": l.forecast_curve_id,
        "discount_curve_id": l.discount_curve_id,
        "ois_compounding": l.ois_compounding,
        "leverage": float(l.leverage) if l.leverage is not None else None,
        "terms": l.terms or {},
        "version_seq": l.version_seq,
    }


# ── Route ─────────────────────────────────────────────────────

@router.post("/trade", status_code=201)
def book_trade_atomic(
    body: BookingRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Atomic booking: BOOKED event + trade + legs in one Postgres transaction.
    Idempotent by (user_id, Idempotency-Key) header when provided.
    """
    role = (user.get("user_metadata") or {}).get("role", "viewer").lower()
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Booking requires Trader or Admin role.")

    user_id = uuid.UUID(user["sub"])

    # ── Idempotency short-circuit ─────────────────────────────
    if idempotency_key:
        try:
            uuid.UUID(idempotency_key)
        except ValueError:
            raise HTTPException(status_code=400, detail="Idempotency-Key must be a UUID")

        cached = (
            db.query(IdempotencyKey)
            .filter(IdempotencyKey.user_id == user_id,
                    IdempotencyKey.key == idempotency_key)
            .first()
        )
        if cached:
            return {**cached.result, "idempotent_replay": True}

    # ── Generate IDs up front ─────────────────────────────────
    trade_id = uuid.uuid4()
    event_id = uuid.uuid4()
    leg_ids = [uuid.uuid4() for _ in body.legs]
    trade_ref = body.trade_ref or f"TRD-{str(int(time.time()))[-8:]}"

    # ── Build BOOKED payload (pure) ──────────────────────────
    booked_payload = build_booked_payload(body, trade_id, leg_ids)

    # ── Atomic DB writes ──────────────────────────────────────
    try:
        # Step 1: trade row with latest_event_id=NULL (FK satisfied by NULL)
        trade = Trade(
            id=trade_id,
            trade_ref=trade_ref,
            status="PENDING",
            store=body.store,
            asset_class=body.asset_class,
            instrument_type=body.instrument_type,
            structure=body.structure,
            own_legal_entity_id=uuid.UUID(body.own_legal_entity_id) if body.own_legal_entity_id else None,
            counterparty_id=uuid.UUID(body.counterparty_id) if body.counterparty_id else None,
            notional=body.notional,
            notional_ccy=body.notional_ccy,
            trade_date=body.trade_date,
            effective_date=body.effective_date,
            maturity_date=body.maturity_date,
            terms=body.terms,
            discount_curve_id=body.discount_curve_id,
            forecast_curve_id=body.forecast_curve_id,
            desk=body.desk,
            book=body.book,
            strategy=body.strategy,
            user_id=user_id,
            latest_event_id=None,
            version_seq=0,
            created_by=user_id,
        )
        db.add(trade)
        db.flush()  # materialize trade row before event inserts (FK trade_events.trade_id)

        # Step 2: BOOKED event. Trigger tr_trade_events_assign_seq assigns event_seq=1,
        #         tx_time=now(), valid_time=effective_date::timestamptz.
        event = TradeEvent(
            id=event_id,
            trade_id=trade_id,
            event_type="BOOKED",
            event_date=body.trade_date,
            effective_date=body.effective_date,
            payload=booked_payload,
            pre_state={},
            post_state=booked_payload,
            user_id=user_id,
            created_by=user_id,
        )
        db.add(event)
        db.flush()

        # Step 3: leg rows, each with latest_event_id=BOOKED.id, version_seq=1
        for leg_id, leg_input in zip(leg_ids, body.legs):
            leg_row = TradeLeg(
                id=leg_id,
                trade_id=trade_id,
                user_id=user_id,
                latest_event_id=event_id,
                version_seq=1,
                booked_at=datetime.utcnow(),
                created_by=user_id,
                **leg_input.model_dump(),
            )
            db.add(leg_row)

        # Step 4: link trade to BOOKED event
        trade.latest_event_id = event_id
        trade.version_seq = 1

        db.flush()
        db.refresh(trade)

        # ── Build response ────────────────────────────────────
        legs_rows = (
            db.query(TradeLeg)
            .filter(TradeLeg.trade_id == trade_id)
            .order_by(TradeLeg.leg_seq)
            .all()
        )
        result = {
            "trade": _serialize_trade(trade),
            "legs": [_serialize_leg(l) for l in legs_rows],
            "event_id": str(event_id),
            "idempotent_replay": False,
        }

        # Step 5: cache idempotency result in the same transaction
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

        # Racing duplicate on Idempotency-Key — refetch winner's cached result
        if idempotency_key and ("idempotency_keys" in msg or "pk_idempotency_keys" in msg):
            cached = (
                db.query(IdempotencyKey)
                .filter(IdempotencyKey.user_id == user_id,
                        IdempotencyKey.key == idempotency_key)
                .first()
            )
            if cached:
                return {**cached.result, "idempotent_replay": True}

        # Duplicate trade_ref for this user
        if "uq_trades_user_ref" in msg:
            raise HTTPException(
                status_code=409,
                detail=f"trade_ref '{trade_ref}' already exists for this user",
            )

        log.exception("Booking integrity error")
        raise HTTPException(status_code=409, detail=f"Integrity error: {msg}")

    except HTTPException:
        db.rollback()
        raise

    except Exception as e:
        db.rollback()
        log.exception("Booking failed")
        raise HTTPException(status_code=500, detail=f"Booking failed: {e}")
