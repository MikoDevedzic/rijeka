"""
Rijeka — /api/trade-legs/ routes
Sprint 3B: first-class leg store.
Sprint 13 Patch 3: leg-level embedded_options validator.
Sprint 13 Patch 5: legacy cap_strike_schedule / floor_strike_schedule columns
                   DROPPED per migration 008b; their Pydantic fields and the
                   `validate_strike_schedule_shape` validator are gone.

GET  /api/trade-legs/{trade_id}         all legs for a trade (ordered by leg_seq)
GET  /api/trade-legs/leg/{leg_id}       single leg
POST /api/trade-legs/                   create/upsert a leg at booking
PUT  /api/trade-legs/leg/{leg_id}       update non-economic fields (pre-live only)

No hard DELETE — use trade status transitions + trade_events.

Sprint 13 Patch 3 changes:
  - Removed `validate_strike_schedules_mutually_exclusive` (Sprint 12). A leg
    may now carry BOTH a cap and a floor via two entries in embedded_options
    (the collar composition — PRODUCT_TAXONOMY §1.11). The legacy columns
    remain mutually exclusive only because each only supports one direction;
    the new shape supersedes that constraint.
  - Added `embedded_options` field on both TradeLegCreate input and
    TradeLegOut output.
  - Added shape validator for each embedded_options entry.

Sprint 13 Patch 5 changes:
  - Dropped the Sprint 12 `cap_strike_schedule` / `floor_strike_schedule`
    fields from TradeLegCreate and TradeLegOut.
  - Dropped the `validate_strike_schedule_shape` model validator.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator, model_validator
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

# ── Sprint 13 Patch 3 — embedded_options shape constants ──────────────────
# Known option types. Unknown types are rejected at booking time — the pricer
# silently skips unknowns (forward-compat), but the write path is the place
# to catch typos. New types (DIGITAL_CAP, BARRIER, RANGE) added here when they
# ship their pricing leg in cap_floor.py / barrier.py / etc.
EMBEDDED_OPTION_TYPES = {"CAP", "FLOOR"}
EMBEDDED_OPTION_DIRECTIONS = {"BUY", "SELL"}


def _validate_embedded_options_shape(embedded_options, field_name="embedded_options"):
    """
    Pure function: validate the shape of an embedded_options array.

    Shape (per PRODUCT_TAXONOMY §1.11):
      [
        {
          "type":            "CAP" | "FLOOR",
          "direction":       "BUY" | "SELL",
          "strike_schedule": list[{date, strike}] | dict[str, num],
          "default_strike":  number | None,
        },
        ...
      ]

    Raises ValueError on malformed shape. Empty array (zero entries) is valid —
    that's a plain-vanilla leg with the column populated but no optionality.
    """
    if embedded_options is None:
        return  # treated as []
    if not isinstance(embedded_options, list):
        raise ValueError(
            f"{field_name} must be a list; got {type(embedded_options).__name__}"
        )
    for i, entry in enumerate(embedded_options):
        path = f"{field_name}[{i}]"
        if not isinstance(entry, dict):
            raise ValueError(f"{path} must be a dict; got {type(entry).__name__}")
        t = entry.get("type")
        if t is None:
            raise ValueError(f"{path}.type is required")
        if t not in EMBEDDED_OPTION_TYPES:
            raise ValueError(
                f"{path}.type must be one of {sorted(EMBEDDED_OPTION_TYPES)}, got {t!r}"
            )
        d = entry.get("direction")
        if d is None:
            raise ValueError(f"{path}.direction is required")
        if d not in EMBEDDED_OPTION_DIRECTIONS:
            raise ValueError(
                f"{path}.direction must be one of {sorted(EMBEDDED_OPTION_DIRECTIONS)}, got {d!r}"
            )
        # strike_schedule is optional if default_strike is set, and vice versa,
        # but at least one source of strikes must be present.
        strike_schedule = entry.get("strike_schedule")
        default_strike  = entry.get("default_strike")
        if strike_schedule is None and default_strike is None:
            raise ValueError(
                f"{path} requires at least one of strike_schedule or default_strike"
            )
        if strike_schedule is not None and not isinstance(strike_schedule, (list, dict)):
            raise ValueError(
                f"{path}.strike_schedule must be a list or dict; "
                f"got {type(strike_schedule).__name__}"
            )


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
    cap_rate:              Optional[Decimal] = None
    floor_rate:            Optional[Decimal] = None
    # Sprint 13 Patch 3 — leg-level embedded optionality (PRODUCT_TAXONOMY §1.11).
    # Array of option entries; multiple compose freely (e.g., collar = CAP + FLOOR).
    # Sprint 13 Patch 5: the Sprint 12 legacy columns `cap_strike_schedule`
    # and `floor_strike_schedule` were DROPPED here (migration 008b). Any
    # equivalent input now arrives via `embedded_options`.
    embedded_options:      Optional[list] = None
    leverage:              Optional[Decimal] = Decimal("1.0")
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

    # NOTE (Sprint 13 Patch 3): the Sprint 12 validator
    # `validate_strike_schedules_mutually_exclusive` has been REMOVED.
    # A leg may now carry both a CAP and a FLOOR entry in embedded_options
    # (collar composition per PRODUCT_TAXONOMY §1.11). The legacy columns
    # remain single-direction-only because they were built that way, but
    # that's an artifact of the legacy shape, not a product rule. Collars
    # booked via the new shape (two embedded_options entries) are valid.
    #
    # Sprint 13 Patch 5: the legacy shape validator
    # `validate_strike_schedule_shape` (which enforced the JSONB shape of
    # `cap_strike_schedule` / `floor_strike_schedule`) was REMOVED here
    # along with those columns themselves (migration 008b).

    @model_validator(mode="after")
    def validate_embedded_options_array(self):
        """
        Sprint 13 Patch 3 — enforce embedded_options entry shape.
        Empty list / None is valid; populated arrays must pass per-entry checks.
        """
        _validate_embedded_options_shape(self.embedded_options, "embedded_options")
        return self


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
    cap_rate:              Optional[Decimal]
    floor_rate:            Optional[Decimal]
    # Sprint 13 Patch 3 — surface the new column so UI round-trips see it.
    # Sprint 13 Patch 5 — legacy cap_strike_schedule / floor_strike_schedule
    # fields were DROPPED here (migration 008b).
    embedded_options:      Optional[list]
    leverage:              Optional[Decimal]
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
        .filter(TradeLeg.trade_id == trade_id, TradeLeg.user_id == uuid.UUID(user["sub"]))
        .order_by(TradeLeg.leg_seq)
        .all()
    )


@router.get("/leg/{leg_id}", response_model=TradeLegOut)
def get_leg(
    leg_id: UUID,
    db:     Session = Depends(get_db),
    user:   dict    = Depends(verify_token),
):
    leg = db.query(TradeLeg).filter(TradeLeg.id == leg_id, TradeLeg.user_id == uuid.UUID(user["sub"])).first()
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

    # Sprint 13 Patch 3 — materialize embedded_options as [] rather than NULL
    # so the ORM sees a non-None JSONB default. The DB column is NOT NULL
    # DEFAULT '[]' but passing None would still fight the NOT NULL at ORM level.
    payload = body.model_dump()
    if payload.get("embedded_options") is None:
        payload["embedded_options"] = []

    leg = TradeLeg(**payload, created_by=user.get("sub"), user_id=uuid.UUID(user["sub"]))
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

    leg = db.query(TradeLeg).filter(TradeLeg.id == leg_id, TradeLeg.user_id == uuid.UUID(user["sub"])).first()
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
