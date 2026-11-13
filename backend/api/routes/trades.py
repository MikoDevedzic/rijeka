from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from db.session import get_db
from db.models import Trade, TradeEvent, Counterparty, LegalEntity
from middleware.auth import verify_token
from api.routes.pricer import invalidate_trade_cache
from api.routes._instrument_alias import normalize_instrument_type  # M009 inbound translator
from api.routes.trade_cards import their_refs
from api.routes._errors import internal
from api.routes._trade_ref import insert_trade, is_ref_collision
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, Dict, Any
from datetime import date
import logging, uuid

log = logging.getLogger("rijeka.trades")

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

# FX_OPTION: the structure is the option's style (PRODUCT_TAXONOMY §2.2, the same rule as the
# swaption's "structure = exercise style"), the one the ticket chose and the terms carry as
# `style` (pricing/fx_exotic.py). A legacy booking that names only `exercise_style` is EUROPEAN or
# AMERICAN; one that names neither is EUROPEAN.
FX_OPTION_STRUCTURES = ("EUROPEAN", "AMERICAN", "DIGITAL", "BARRIER", "DOUBLE_BARRIER", "TOUCH")


def fx_option_structure(terms) -> str:
    t = terms or {}
    return str(t.get("style") or t.get("exercise_style") or "EUROPEAN").upper()


def validated_structure(instrument_type: Optional[str], structure: Optional[str], terms) -> Optional[str]:
    """The structure a trade row carries, derived and checked the same way on both create paths
    (POST /api/trades and POST /api/book/trade). IR_SWAP: VANILLA by default, else the allowlist.
    FX_OPTION / CRYPTO_OPTION: the option's style; a stated structure must agree with it. Other
    instruments keep what they were given. Raises ValueError (a 422 at the route)."""
    if instrument_type == "IR_SWAP":
        structure = structure or "VANILLA"
        if structure not in _ALLOWED_IR_SWAP_STRUCTURES:
            raise ValueError(f"Invalid structure '{structure}' for IR_SWAP. Allowed: {sorted(_ALLOWED_IR_SWAP_STRUCTURES)}")
        return structure
    if instrument_type in ("FX_OPTION", "CRYPTO_OPTION"):
        style = fx_option_structure(terms)
        if style not in FX_OPTION_STRUCTURES:
            raise ValueError(f"Unknown FX option style '{style}'. Allowed: {list(FX_OPTION_STRUCTURES)}")
        if not structure or structure.upper() == "VANILLA":
            return style
        if structure.upper() != style:
            raise ValueError(f"structure '{structure}' does not match the option's style '{style}'")
        return style
    return structure


def _uuid_or_none(v, name: str):
    if v in (None, ""):
        return None
    try:
        uuid.UUID(str(v))
    except ValueError:
        raise ValueError(f"{name} must be a UUID")
    return str(v)


def _iso_date(v, name: str) -> str:
    try:
        date.fromisoformat(str(v))
    except ValueError:
        raise ValueError(f"{name} must be an ISO date (YYYY-MM-DD)")
    return str(v)


def display_structure(t) -> Optional[str]:
    """The structure the blotter shows. FX options booked before the structure followed the style
    carry VANILLA (or nothing) in the row; their terms still say what they are, so the row is read
    from the terms rather than rewritten."""
    s = getattr(t, "structure", None)
    if getattr(t, "instrument_type", None) in ("FX_OPTION", "CRYPTO_OPTION") and (not s or s == "VANILLA"):
        return fx_option_structure(getattr(t, "terms", None))
    return s

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

    @field_validator("terms")
    @classmethod
    def fees_as_the_record_keeps_them(cls, v):
        """`terms.fees`: any number of known payments (pricing/fees.py). Checked and stored in one shape."""
        if isinstance(v, dict) and "fees" in v:
            from pricing.fees import normalise
            v = {**v, "fees": normalise(v["fees"])}
        return v

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

    @field_validator("status")
    @classmethod
    def _created_pending(cls, v):
        # A trade is created PENDING with a BOOKED event; every later status is a lifecycle fact that
        # goes through /api/trade-events and /api/chain, so it carries an event and, where anchored,
        # both signatures. PUT refuses the same shortcut.
        if str(v or "PENDING").upper() != "PENDING":
            raise ValueError("a trade is created PENDING; status changes go through /api/trade-events and /api/chain")
        return "PENDING"

    @field_validator("own_legal_entity_id")
    @classmethod
    def _entity_uuid(cls, v):
        return _uuid_or_none(v, "own_legal_entity_id")

    @field_validator("counterparty_id")
    @classmethod
    def _counterparty_uuid(cls, v):
        return _uuid_or_none(v, "counterparty_id")

    @field_validator("trade_date", "effective_date", "maturity_date")
    @classmethod
    def _dates_iso(cls, v, info):
        return _iso_date(v, info.field_name)

    @model_validator(mode="after")
    def default_and_validate_structure(self):
        """Structure rules shared with the booking route (validated_structure)."""
        self.structure = validated_structure(self.instrument_type, self.structure, self.terms)
        return self

    @model_validator(mode="after")
    def settlement_source_is_bookable(self):
        """A digital-asset trade names its pair's feed source or a desk source, at that source's time
        (settlement/sources.check_booked, shared with the booking route). New trades only."""
        from settlement.sources import check_booked
        check_booked(self.instrument_type, self.terms, self.trade_date, self.maturity_date)
        return self

class TradeUpdate(BaseModel):
    status: Optional[str] = None
    store: Optional[str] = None
    terms: Optional[Dict[str, Any]] = None
    desk: Optional[str] = None
    book: Optional[str] = None
    strategy: Optional[str] = None

    @field_validator("terms")
    @classmethod
    def fees_as_the_record_keeps_them(cls, v):
        """An update's `terms.fees` is checked as a new trade's is (pricing/fees.py)."""
        if isinstance(v, dict) and "fees" in v:
            from pricing.fees import normalise
            v = {**v, "fees": normalise(v["fees"])}
        return v

def serialize(t, cp=None):
    return {
        "id": str(t.id),
        "trade_ref": t.trade_ref,
        "status": t.status,
        "store": t.store,
        "asset_class": t.asset_class,
        "instrument_type": t.instrument_type,
        "structure": display_structure(t),
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

@router.get("/their-refs")
def trades_their_refs(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """{trade id: {trade_ref, firm}}: the counterparty's own booking of each of your trades, matched by UTI."""
    return their_refs(db, uuid.UUID(user["sub"]))

@router.post("/")
def create_trade(body: TradeCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    from api.routes._package import refuse_client_tag
    refuse_client_tag(body.strategy)
    new_id    = uuid.uuid4()
    kwargs = {
        "id":                   new_id,
        "trade_ref":            body.trade_ref,    # the client's own, or None: insert_trade names it
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
    # a trade may only point at the caller's own entity and counterparty
    if kwargs.get("counterparty_id") and not db.query(Counterparty).filter(Counterparty.id == kwargs["counterparty_id"], Counterparty.user_id == kwargs["user_id"]).first():
        raise HTTPException(status_code=422, detail="counterparty_id is not one of yours")
    if kwargs.get("own_legal_entity_id") and not db.query(LegalEntity).filter(LegalEntity.id == kwargs["own_legal_entity_id"], LegalEntity.user_id == kwargs["user_id"]).first():
        raise HTTPException(status_code=422, detail="own_legal_entity_id is not one of yours")
    try:
        # a reference the client did not give is generated, and cannot repeat for this user (_trade_ref.py)
        trade = insert_trade(db, lambda ref: Trade(**{**kwargs, "trade_ref": ref}), body.trade_ref)
        kwargs["trade_ref"] = trade.trade_ref
        # The BOOKED event: the first fact of the trade's lifecycle, as POST /api/book/trade writes it,
        # so an event stream exists for every trade however it was created.
        payload = {"trade": {k: (str(v) if isinstance(v, (uuid.UUID, date)) else v) for k, v in kwargs.items()}, "legs": []}
        db.add(TradeEvent(id=uuid.uuid4(), trade_id=new_id, event_type="BOOKED", event_date=kwargs["trade_date"],
                          effective_date=kwargs["effective_date"], payload=payload, pre_state={}, post_state=payload,
                          user_id=kwargs["user_id"], created_by=kwargs["user_id"]))
        db.commit()
        invalidate_trade_cache()
        db.refresh(trade)
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        if isinstance(e, IntegrityError) and is_ref_collision(e):
            # only a reference the client supplied can get here; it is refused, not replaced (as POST /api/book/trade does)
            raise HTTPException(status_code=409, detail=f"trade_ref '{kwargs['trade_ref']}' already exists for this user")
        log.exception("trade %s (%s/%s structure %s) could not be saved: %s", kwargs["trade_ref"] or "(not yet named)", body.asset_class, body.instrument_type, kwargs["structure"], e)
        raise HTTPException(status_code=500, detail="The trade could not be saved; the error is in the server log.")
    cp = db.query(Counterparty).filter(Counterparty.id == trade.counterparty_id).first() if trade.counterparty_id else None
    return serialize(trade, cp)

@router.put("/{trade_id}")
def update_trade(trade_id: uuid.UUID, body: TradeUpdate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    if str((user.get("user_metadata") or {}).get("role", "viewer")).lower() not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Editing a trade requires the Trader or Admin role.")
    t = db.query(Trade).filter(Trade.id == trade_id, Trade.user_id == uuid.UUID(user["sub"])).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trade not found")
    updates = body.dict(exclude_none=True)
    if "strategy" in updates:
        from api.routes._package import refuse_client_tag
        refuse_client_tag(updates["strategy"], was=t.strategy)
    if "status" in updates:
        # Status is a lifecycle fact, not a field: it changes through /api/trade-events and /api/chain, where the change is
        # an event and, on chain, signed by both parties. Until 13 November 2026 this refused only a trade already
        # anchored: a cancelled trade could be set back to PENDING here and then confirmed, a pending one set to CONFIRMED
        # with no event and no signature, and any word at all was stored as a status.
        if updates["status"] != t.status:
            raise HTTPException(status_code=409, detail=(
                f"{t.trade_ref} is {t.status}, and a trade's status is not edited. It is confirmed, cancelled or terminated "
                "through /api/trade-events and /api/chain, where the change is an event."))
        updates.pop("status")
    if "terms" in updates and updates["terms"] != (t.terms or {}):
        # The terms are what both parties confirm. They are edited while the trade is PENDING and nothing is in flight; after
        # that they change by an amendment, which is an event (and, on chain, signed). Until 13 November 2026 a confirmed,
        # cancelled or terminated trade's terms were edited here with no event.
        if t.status != "PENDING":
            raise HTTPException(status_code=409, detail=(
                f"{t.trade_ref} is {t.status}: its terms are not edited. A confirmed trade's terms change by an amendment (/api/chain/amend)."))
        from api.routes.trade_events import _refuse_while_anchoring
        _refuse_while_anchoring(db, t, "editing its terms")
    if "terms" in updates:
        # the fields the settlement rule reads are held to the booking rule when an edit changes them; an edit that
        # leaves them as they are is not a re-validation of an older record
        from settlement.sources import INSTRUMENTS, SETTLEMENT_FIELDS, check_booked
        was = dict(t.terms or {})
        if str(t.instrument_type or "").upper() in INSTRUMENTS and any(was.get(f) != (updates["terms"] or {}).get(f) for f in SETTLEMENT_FIELDS):
            try:
                check_booked(t.instrument_type, updates["terms"], t.trade_date, t.maturity_date)
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))
    for k, v in updates.items():
        setattr(t, k, v)
    t.last_modified_by = uuid.UUID(user["sub"])
    db.commit()
    invalidate_trade_cache()
    return {"id": str(trade_id), "status": t.status}

@router.delete("/{trade_id}")
def delete_trade(trade_id: uuid.UUID, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    t = db.query(Trade).filter(Trade.id == trade_id, Trade.user_id == uuid.UUID(user["sub"])).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trade not found")
    if t.status not in ("PENDING", "CANCELLED"):
        raise HTTPException(status_code=400, detail="Only PENDING or CANCELLED trades can be deleted")
    # Events are kept (ON DELETE RESTRICT, and a trigger refuses their deletion): a trade with a
    # lifecycle is cancelled through /api/trade-events, not deleted.
    if db.query(TradeEvent).filter(TradeEvent.trade_id == t.id).count():
        raise HTTPException(status_code=409, detail="This trade has lifecycle events and cannot be deleted; cancel it instead.")
    try:
        db.delete(t)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise internal(409, "The trade could not be deleted; other records refer to it", e)
    invalidate_trade_cache()
    return {"deleted": trade_id}
