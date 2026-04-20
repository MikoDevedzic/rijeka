"""
Rijeka — SQLAlchemy models
Sprint 12 item 1: Bitemporal event-sourcing foundation.

Trade/TradeLeg rows = projections derived from TradeEvent stream.
TradeEvent = append-only source of truth.
Every user-scoped row carries user_id for multi-tenancy (RLS).
"""

from sqlalchemy import (
    Column, String, Boolean, Integer,
    Numeric, Date, DateTime, Text,
    ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()


class OrgNode(Base):
    __tablename__ = "org_nodes"

    id          = Column(UUID(as_uuid=True), primary_key=True)
    parent_id   = Column(UUID(as_uuid=True), ForeignKey("org_nodes.id"), nullable=True)
    name        = Column(String, nullable=False)
    node_type   = Column(String, nullable=False)
    is_active   = Column(Boolean, default=True)
    sort_order  = Column(Integer, default=0)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    created_by  = Column(UUID(as_uuid=True), nullable=True)


class LegalEntity(Base):
    __tablename__ = "legal_entities"

    id                 = Column(UUID(as_uuid=True), primary_key=True)
    lei                = Column(String, nullable=True)
    name               = Column(String, nullable=False)
    short_name         = Column(String, nullable=True)
    home_currency      = Column(String, nullable=True)
    jurisdiction       = Column(String, nullable=True)
    regulatory_regime  = Column(ARRAY(String), nullable=True)
    simm_version       = Column(String, nullable=True)
    im_threshold_m     = Column(Numeric(18, 4), nullable=True)
    ois_curve_id       = Column(String, nullable=True)
    is_own_entity      = Column(Boolean, default=False)
    is_active          = Column(Boolean, default=True)
    created_at         = Column(DateTime(timezone=True), server_default=func.now())
    created_by         = Column(UUID(as_uuid=True), nullable=True)


class Counterparty(Base):
    __tablename__ = "counterparties"

    id                 = Column(UUID(as_uuid=True), primary_key=True)
    legal_entity_id    = Column(UUID(as_uuid=True), ForeignKey("legal_entities.id"), nullable=True)
    name               = Column(String, nullable=False)
    isda_agreement     = Column(String, nullable=True)
    csa_type           = Column(String, nullable=True)
    csa_currency       = Column(String, nullable=True)
    csa_threshold_m    = Column(Numeric(18, 4), nullable=True)
    csa_mta_k          = Column(Numeric(18, 4), nullable=True)
    discount_curve_id  = Column(String, nullable=True)
    im_model           = Column(String, nullable=True)
    is_active          = Column(Boolean, default=True)
    created_at         = Column(DateTime(timezone=True), server_default=func.now())
    created_by         = Column(UUID(as_uuid=True), nullable=True)


# ─────────────────────────────────────────────────────
# Trade — projection row (current state)
# Source of truth is TradeEvent stream. Every mutation
# must flow through an event. Direct UPDATE of economic
# fields without a corresponding event is drift.
# ─────────────────────────────────────────────────────
class Trade(Base):
    __tablename__ = "trades"
    __table_args__ = (
        UniqueConstraint("user_id", "trade_ref", name="uq_trades_user_ref"),
        Index("ix_trades_user_status", "user_id", "status"),
    )

    id                   = Column(UUID(as_uuid=True), primary_key=True)
    trade_ref            = Column(String, nullable=True)   # unique per (user_id, trade_ref)
    uti                  = Column(String, nullable=True)
    status               = Column(String, nullable=True)
    store                = Column(String, nullable=True)
    asset_class          = Column(String, nullable=True)
    instrument_type      = Column(String, nullable=True)
    structure            = Column(String, nullable=True)
    own_legal_entity_id  = Column(UUID(as_uuid=True), ForeignKey("legal_entities.id"), nullable=True)
    counterparty_id      = Column(UUID(as_uuid=True), ForeignKey("counterparties.id"), nullable=True)
    notional             = Column(Numeric(24, 6), nullable=True)
    notional_ccy         = Column(String, nullable=True)
    trade_date           = Column(Date, nullable=True)
    effective_date       = Column(Date, nullable=True)
    maturity_date        = Column(Date, nullable=True)
    terms                = Column(JSONB, nullable=True)
    discount_curve_id    = Column(String, nullable=True)
    forecast_curve_id    = Column(String, nullable=True)
    desk                 = Column(String, nullable=True)
    book                 = Column(String, nullable=True)
    strategy             = Column(String, nullable=True)

    # ── Multi-tenancy (Sprint 12) ──
    user_id              = Column(UUID(as_uuid=True), nullable=True, index=True)

    # ── Event-sourcing link (Sprint 12) ──
    latest_event_id      = Column(UUID(as_uuid=True), ForeignKey("trade_events.id"), nullable=True)
    version_seq          = Column(Integer, nullable=False, default=0)

    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    created_by           = Column(UUID(as_uuid=True), nullable=True)
    last_modified_at     = Column(DateTime(timezone=True), nullable=True)
    last_modified_by     = Column(UUID(as_uuid=True), nullable=True)


# ─────────────────────────────────────────────────────
# TradeLeg — projection (one row per leg)
# ─────────────────────────────────────────────────────
class TradeLeg(Base):
    __tablename__ = "trade_legs"
    __table_args__ = (
        Index("ix_trade_legs_user_trade", "user_id", "trade_id"),
    )

    id                  = Column(UUID(as_uuid=True), primary_key=True)
    trade_id            = Column(UUID(as_uuid=True), ForeignKey("trades.id"), nullable=False)
    leg_ref             = Column(String, nullable=False)
    leg_seq             = Column(Integer, nullable=False, default=0)
    leg_type            = Column(String, nullable=False)
    direction           = Column(String, nullable=False)
    currency            = Column(String, nullable=False)
    notional            = Column(Numeric(24, 6), nullable=True)
    notional_type       = Column(String, nullable=False, default="BULLET")
    notional_schedule   = Column(JSONB, nullable=True)
    effective_date      = Column(Date, nullable=True)
    maturity_date       = Column(Date, nullable=True)
    first_period_start  = Column(Date, nullable=True)
    last_period_end     = Column(Date, nullable=True)
    day_count           = Column(String, nullable=True)
    payment_frequency   = Column(String, nullable=True)
    reset_frequency     = Column(String, nullable=True)
    bdc                 = Column(String, nullable=True)
    stub_type           = Column(String, nullable=True)
    payment_calendar    = Column(String, nullable=True)
    payment_lag         = Column(Integer, default=0)
    fixed_rate          = Column(Numeric(12, 8), nullable=True)
    fixed_rate_type     = Column(String, default="FLAT")
    fixed_rate_schedule = Column(JSONB, nullable=True)
    spread              = Column(Numeric(12, 8), nullable=True)
    spread_type         = Column(String, default="FLAT")
    spread_schedule     = Column(JSONB, nullable=True)
    forecast_curve_id   = Column(String, nullable=True)
    cap_rate            = Column(Numeric(12, 8), nullable=True)
    floor_rate          = Column(Numeric(12, 8), nullable=True)
    leverage            = Column(Numeric(8, 4), default=1.0)
    ois_compounding     = Column(String, nullable=True)
    discount_curve_id   = Column(String, nullable=True)
    terms               = Column(JSONB, nullable=False, default=dict)
    leg_hash            = Column(Text, nullable=True)
    booked_at           = Column(DateTime(timezone=True), nullable=True)

    # ── Multi-tenancy (Sprint 12) ──
    user_id             = Column(UUID(as_uuid=True), nullable=True)

    # ── Event-sourcing link (Sprint 12) ──
    latest_event_id     = Column(UUID(as_uuid=True), ForeignKey("trade_events.id"), nullable=True)
    version_seq         = Column(Integer, nullable=False, default=0)

    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    created_by          = Column(UUID(as_uuid=True), nullable=True)
    last_modified_at    = Column(DateTime(timezone=True), nullable=True)
    last_modified_by    = Column(UUID(as_uuid=True), nullable=True)


# ─────────────────────────────────────────────────────
# Cashflow — projection (cashflow schedule)
# status: PROJECTED | CONFIRMED | SETTLED | CANCELLED
# event_id links to the event that produced this row.
# ─────────────────────────────────────────────────────
class Cashflow(Base):
    __tablename__ = "cashflows"
    __table_args__ = (
        Index("ix_cashflows_user_trade", "user_id", "trade_id"),
    )

    id               = Column(UUID(as_uuid=True), primary_key=True)
    trade_id         = Column(UUID(as_uuid=True), ForeignKey("trades.id"), nullable=False)
    leg_id           = Column(UUID(as_uuid=True), ForeignKey("trade_legs.id"), nullable=False)

    period_start     = Column(Date, nullable=False)
    period_end       = Column(Date, nullable=False)
    payment_date     = Column(Date, nullable=False)
    fixing_date      = Column(Date, nullable=True)

    currency         = Column(String, nullable=False)
    notional         = Column(Numeric(24, 6), nullable=True)
    rate             = Column(Numeric(12, 8), nullable=True)
    dcf              = Column(Numeric(10, 8), nullable=True)
    amount           = Column(Numeric(24, 6), nullable=False)

    amount_override  = Column(Numeric(24, 6), nullable=True)
    is_overridden    = Column(Boolean, nullable=False, default=False)

    status           = Column(String, nullable=False, default="PROJECTED")
    cashflow_type    = Column(String, nullable=False, default="COUPON")

    cashflow_hash    = Column(Text, nullable=True)
    settlement_hash  = Column(Text, nullable=True)

    # ── Multi-tenancy + event provenance (Sprint 12) ──
    user_id          = Column(UUID(as_uuid=True), nullable=True)
    event_id         = Column(UUID(as_uuid=True), ForeignKey("trade_events.id"), nullable=True)
    snapshot_id      = Column(UUID(as_uuid=True), nullable=True)
    computed_as_of   = Column(Date, nullable=True)

    generated_at     = Column(DateTime(timezone=True), server_default=func.now())
    last_modified_at = Column(DateTime(timezone=True), nullable=True)
    last_modified_by = Column(UUID(as_uuid=True), nullable=True)


# ─────────────────────────────────────────────────────
# TradeEvent — append-only source of truth.
# event_seq is monotonic per trade (assigned by DB trigger).
# tx_time = when Rijeka recorded it.
# valid_time = when the fact became true in the world.
# UPDATE and DELETE are rejected by DB triggers.
# ─────────────────────────────────────────────────────
class TradeEvent(Base):
    __tablename__ = "trade_events"
    __table_args__ = (
        UniqueConstraint("trade_id", "event_seq", name="uq_trade_events_trade_seq"),
        Index("ix_trade_events_trade_seq", "trade_id", "event_seq"),
        Index("ix_trade_events_user_tx", "user_id", "tx_time"),
    )

    id                     = Column(UUID(as_uuid=True), primary_key=True)
    trade_id               = Column(UUID(as_uuid=True), ForeignKey("trades.id"), nullable=False)
    event_type             = Column(String, nullable=False)
    event_date             = Column(Date, nullable=False)
    effective_date         = Column(Date, nullable=False)

    # ── Bitemporal + event-sourcing (Sprint 12) ──
    event_seq              = Column(Integer, nullable=False)  # DB trigger assigns on insert
    tx_time                = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    valid_time             = Column(DateTime(timezone=True), nullable=False)
    user_id                = Column(UUID(as_uuid=True), nullable=True)
    snapshot_id            = Column(UUID(as_uuid=True), nullable=True)
    parent_event_id        = Column(UUID(as_uuid=True), ForeignKey("trade_events.id"), nullable=True)

    payload                = Column(JSONB, nullable=False, default=dict)
    pre_state              = Column(JSONB, nullable=False, default=dict)
    post_state             = Column(JSONB, nullable=False, default=dict)
    counterparty_confirmed = Column(Boolean, nullable=False, default=False)
    confirmation_hash      = Column(Text, nullable=True)

    created_at             = Column(DateTime(timezone=True), server_default=func.now())
    created_by             = Column(UUID(as_uuid=True), nullable=True)
 


# ─────────────────────────────────────────────────────
# IdempotencyKey — dedup storage for atomic booking
# Sprint 12 item 3.
#
# Composite PK (user_id, key). Same Idempotency-Key
# reused across users is allowed; same key for same
# user blocks duplicate booking.
# ─────────────────────────────────────────────────────
class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    key        = Column(Text,                    primary_key=True)
    user_id    = Column(UUID(as_uuid=True),      primary_key=True)
    result     = Column(JSONB,                   nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
