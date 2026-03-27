from sqlalchemy import (
    Column, String, Boolean, Numeric, Integer,
    Date, DateTime, JSON, ForeignKey, Text
)
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from db.session import Base
import uuid


class OrgNode(Base):
    __tablename__ = "org_nodes"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_id  = Column(UUID(as_uuid=True), ForeignKey("org_nodes.id"), nullable=True)
    name       = Column(Text, nullable=False)
    node_type  = Column(Text, nullable=False)
    is_active  = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(UUID(as_uuid=True), nullable=True)


class LegalEntity(Base):
    __tablename__ = "legal_entities"

    id                 = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lei                = Column(Text, nullable=True)
    name               = Column(Text, nullable=False)
    short_name         = Column(Text, nullable=True)
    home_currency      = Column(Text, nullable=False)
    jurisdiction       = Column(Text, nullable=True)
    regulatory_regime  = Column(ARRAY(Text), nullable=True)
    simm_version       = Column(Text, nullable=True)
    im_threshold_m     = Column(Numeric(16, 4), nullable=True)
    ois_curve_id       = Column(Text, nullable=True)
    is_own_entity      = Column(Boolean, default=False)
    is_active          = Column(Boolean, default=True)
    created_at         = Column(DateTime(timezone=True), server_default=func.now())
    created_by         = Column(UUID(as_uuid=True), nullable=True)

    counterparties = relationship("Counterparty", back_populates="legal_entity")
    trades_own     = relationship(
        "Trade",
        foreign_keys="Trade.own_legal_entity_id",
        back_populates="own_entity",
    )


class Counterparty(Base):
    __tablename__ = "counterparties"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    legal_entity_id  = Column(UUID(as_uuid=True), ForeignKey("legal_entities.id"), nullable=True)
    name             = Column(Text, nullable=False)
    isda_agreement   = Column(Text, nullable=True)
    csa_type         = Column(Text, nullable=True)
    csa_currency     = Column(Text, nullable=True)
    csa_threshold_m  = Column(Numeric(16, 4), nullable=True)
    csa_mta_k        = Column(Numeric(16, 4), nullable=True)
    discount_curve_id = Column(Text, nullable=True)
    im_model         = Column(Text, nullable=True)
    is_active        = Column(Boolean, default=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    created_by       = Column(UUID(as_uuid=True), nullable=True)

    legal_entity = relationship("LegalEntity", back_populates="counterparties")
    trades       = relationship("Trade", back_populates="counterparty")


class Trade(Base):
    __tablename__ = "trades"

    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trade_ref           = Column(Text, unique=True, nullable=False)
    uti                 = Column(Text, nullable=True)

    status              = Column(Text, nullable=False, default="PENDING")
    store               = Column(Text, nullable=False, default="WORKING")

    asset_class         = Column(Text, nullable=False)
    instrument_type     = Column(Text, nullable=False)

    own_legal_entity_id = Column(UUID(as_uuid=True), ForeignKey("legal_entities.id"), nullable=True)
    counterparty_id     = Column(UUID(as_uuid=True), ForeignKey("counterparties.id"), nullable=True)

    notional            = Column(Numeric(24, 6), nullable=True)
    notional_ccy        = Column(Text, nullable=False)
    trade_date          = Column(Date, nullable=False)
    effective_date      = Column(Date, nullable=False)
    maturity_date       = Column(Date, nullable=False)

    terms               = Column(JSON, nullable=False, default=dict)

    discount_curve_id   = Column(Text, nullable=True)
    forecast_curve_id   = Column(Text, nullable=True)

    desk                = Column(Text, nullable=True)
    book                = Column(Text, nullable=True)
    strategy            = Column(Text, nullable=True)

    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    created_by          = Column(UUID(as_uuid=True), nullable=True)
    last_modified_at    = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_modified_by    = Column(UUID(as_uuid=True), nullable=True)

    own_entity   = relationship("LegalEntity", foreign_keys=[own_legal_entity_id], back_populates="trades_own")
    counterparty = relationship("Counterparty", back_populates="trades")
