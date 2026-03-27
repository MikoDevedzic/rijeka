"""
Rijeka — SQLAlchemy models
Sprint 3C: Cashflow added.
Trade row = current-state cache. TradeEvent stream = truth.
TradeLeg = first-class leg store.
Cashflow = generated cashflow schedule.
"""

from sqlalchemy import (
    Column, String, Boolean, Integer,
    Numeric, Date, DateTime, Text,
    ForeignKey
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


class Trade(Base):
    __tablename__ = "trades"

    id                   = Column(UUID(as_uuid=True), primary_key=True)
    trade_ref            = Column(String, unique=True, nullable=True)
    uti                  = Column(String, nullable=True)
    status               = Column(String, nullable=True)
    store                = Column(String, nullable=True)
    asset_class          = Column(String, nullable=True)
    instrument_type      = Column(String, nullable=True)
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
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    created_by           = Column(UUID(as_uuid=True), nullable=True)
    last_modified_at     = Column(DateTime(timezone=True), nullable=True)
    last_modified_by     = Column(UUID(as_uuid=True), nullable=True)


class TradeLeg(Base):
    __tablename__ = "trade_legs"

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
    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    created_by          = Column(UUID(as_uuid=True), nullable=True)
    last_modified_at    = Column(DateTime(timezone=True), nullable=True)
    last_modified_by    = Column(UUID(as_uuid=True), nullable=True)


# ─────────────────────────────────────────────────────
# Cashflows  (Sprint 3C — generated cashflow schedule)
# ─────────────────────────────────────────────────────
# status values (enforced by DB CHECK constraint):
#   PROJECTED | CONFIRMED | SETTLED | CANCELLED
#
# amount        = generated value (notional * rate * dcf)
# amount_override = set by user inline edit (non-destructive)
# effective_amount = COALESCE(amount_override, amount)  — compute in app
class Cashflow(Base):
    __tablename__ = "cashflows"

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

    cashflow_hash    = Column(Text, nullable=True)
    settlement_hash  = Column(Text, nullable=True)

    generated_at     = Column(DateTime(timezone=True), server_default=func.now())
    last_modified_at = Column(DateTime(timezone=True), nullable=True)
    last_modified_by = Column(UUID(as_uuid=True), nullable=True)


# ─────────────────────────────────────────────────────
# Trade Events  (Sprint 3A — immutable append-only)
# ─────────────────────────────────────────────────────
class TradeEvent(Base):
    __tablename__ = "trade_events"

    id                     = Column(UUID(as_uuid=True), primary_key=True)
    trade_id               = Column(UUID(as_uuid=True), ForeignKey("trades.id"), nullable=False)
    event_type             = Column(String, nullable=False)
    event_date             = Column(Date, nullable=False)
    effective_date         = Column(Date, nullable=False)
    payload                = Column(JSONB, nullable=False, default=dict)
    pre_state              = Column(JSONB, nullable=False, default=dict)
    post_state             = Column(JSONB, nullable=False, default=dict)
    counterparty_confirmed = Column(Boolean, nullable=False, default=False)
    confirmation_hash      = Column(Text, nullable=True)
    created_at             = Column(DateTime(timezone=True), server_default=func.now())
    created_by             = Column(UUID(as_uuid=True), nullable=True)
