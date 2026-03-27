const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend';

function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log('wrote:', rel);
}

// ─── requirements.txt ─────────────────────────────────────────────────────────
write('requirements.txt', `fastapi==0.115.0
uvicorn[standard]==0.30.6
sqlalchemy==2.0.35
psycopg2-binary==2.9.9
python-dotenv==1.0.1
pyjwt==2.9.0
python-multipart==0.0.12
pydantic==2.9.2
`);

// ─── .env.example ─────────────────────────────────────────────────────────────
write('.env.example', `# Copy to .env and fill in values — NEVER COMMIT .env
DATABASE_URL=postgresql://postgres:[password]@db.upuewetohnocfshkhafg.supabase.co:5432/postgres
SUPABASE_JWT_SECRET=[get from Supabase Dashboard > Settings > API > JWT Secret]
FRONTEND_URL=https://app.rijeka.app
`);

// ─── main.py ──────────────────────────────────────────────────────────────────
write('main.py', `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from db.session import engine
from db import models
from api.routes import curves, org, legal_entities, counterparties, trades
import os

@asynccontextmanager
async def lifespan(app: FastAPI):
    models.Base.metadata.create_all(bind=engine)
    yield

app = FastAPI(
    title="Rijeka Risk API",
    description="Open-source full revaluation derivatives risk system",
    version="0.1.0",
    lifespan=lifespan,
)

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "https://app.rijeka.app",
    os.getenv("FRONTEND_URL", ""),
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in ALLOWED_ORIGINS if o],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(curves.router,         prefix="/api/curves",          tags=["Curves"])
app.include_router(org.router,            prefix="/api/org",             tags=["Organisation"])
app.include_router(legal_entities.router, prefix="/api/legal-entities",  tags=["Legal Entities"])
app.include_router(counterparties.router, prefix="/api/counterparties",  tags=["Counterparties"])
app.include_router(trades.router,         prefix="/api/trades",          tags=["Trades"])

@app.get("/health", tags=["System"])
def health():
    return {"status": "ok", "service": "rijeka-risk-api", "version": "0.1.0"}
`);

// ─── db/__init__.py ────────────────────────────────────────────────────────────
write('db/__init__.py', '');

// ─── db/session.py ────────────────────────────────────────────────────────────
write('db/session.py', `from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable not set")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
`);

// ─── db/models.py ─────────────────────────────────────────────────────────────
write('db/models.py', `from sqlalchemy import (
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
`);

// ─── middleware/__init__.py ────────────────────────────────────────────────────
write('middleware/__init__.py', '');

// ─── middleware/auth.py ────────────────────────────────────────────────────────
write('middleware/auth.py', `import jwt
import os
from fastapi import HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")


def verify_token(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")


# Dependency alias for clean route signatures
CurrentUser = Depends(verify_token)
`);

// ─── api/__init__.py ──────────────────────────────────────────────────────────
write('api/__init__.py', '');
write('api/routes/__init__.py', '');

// ─── api/routes/curves.py ─────────────────────────────────────────────────────
write('api/routes/curves.py', `from fastapi import APIRouter, Depends
from middleware.auth import verify_token

router = APIRouter()

CURVE_METADATA = {
    "total_curves": 54,
    "bootstrap_passes": 4,
    "pass_order": ["OIS", "BASIS", "XCCY", "FUNDING"],
    "note": "Full bootstrap engine — Sprint 3",
}


@router.get("/")
def get_curves_metadata(user: dict = Depends(verify_token)):
    return CURVE_METADATA


@router.get("/health")
def curves_health():
    return {"status": "ok", "curves": 54}
`);

// ─── api/routes/org.py ────────────────────────────────────────────────────────
write('api/routes/org.py', `from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db.session import get_db
from db.models import OrgNode
from middleware.auth import verify_token
from pydantic import BaseModel
from typing import Optional
import uuid

router = APIRouter()


class OrgNodeCreate(BaseModel):
    name: str
    node_type: str
    parent_id: Optional[str] = None
    sort_order: int = 0


class OrgNodeUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


def serialize(n: OrgNode) -> dict:
    return {
        "id": str(n.id),
        "parent_id": str(n.parent_id) if n.parent_id else None,
        "name": n.name,
        "node_type": n.node_type,
        "is_active": n.is_active,
        "sort_order": n.sort_order,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("/nodes")
def get_nodes(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    nodes = db.query(OrgNode).order_by(OrgNode.sort_order).all()
    return [serialize(n) for n in nodes]


@router.post("/nodes")
def create_node(body: OrgNodeCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    node = OrgNode(
        name=body.name,
        node_type=body.node_type,
        parent_id=uuid.UUID(body.parent_id) if body.parent_id else None,
        sort_order=body.sort_order,
        created_by=uuid.UUID(user["sub"]),
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    return serialize(node)


@router.put("/nodes/{node_id}")
def update_node(
    node_id: str, body: OrgNodeUpdate,
    db: Session = Depends(get_db), user: dict = Depends(verify_token),
):
    node = db.query(OrgNode).filter(OrgNode.id == uuid.UUID(node_id)).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    for k, v in body.dict(exclude_none=True).items():
        setattr(node, k, v)
    db.commit()
    return serialize(node)
`);

// ─── api/routes/legal_entities.py ─────────────────────────────────────────────
write('api/routes/legal_entities.py', `from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db.session import get_db
from db.models import LegalEntity
from middleware.auth import verify_token
from pydantic import BaseModel
from typing import Optional, List
import uuid

router = APIRouter()


class LegalEntityCreate(BaseModel):
    lei: Optional[str] = None
    name: str
    short_name: Optional[str] = None
    home_currency: str
    jurisdiction: Optional[str] = None
    regulatory_regime: Optional[List[str]] = None
    simm_version: Optional[str] = "2.6"
    im_threshold_m: Optional[float] = None
    ois_curve_id: Optional[str] = None
    is_own_entity: bool = False


class LegalEntityUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    lei: Optional[str] = None
    short_name: Optional[str] = None
    im_threshold_m: Optional[float] = None


def serialize(e: LegalEntity) -> dict:
    return {
        "id": str(e.id),
        "lei": e.lei,
        "name": e.name,
        "short_name": e.short_name,
        "home_currency": e.home_currency,
        "jurisdiction": e.jurisdiction,
        "regulatory_regime": e.regulatory_regime,
        "simm_version": e.simm_version,
        "im_threshold_m": float(e.im_threshold_m) if e.im_threshold_m else None,
        "ois_curve_id": e.ois_curve_id,
        "is_own_entity": e.is_own_entity,
        "is_active": e.is_active,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


@router.get("/")
def get_legal_entities(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return [serialize(e) for e in db.query(LegalEntity).order_by(LegalEntity.created_at).all()]


@router.post("/")
def create_legal_entity(body: LegalEntityCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    entity = LegalEntity(**body.dict(), created_by=uuid.UUID(user["sub"]))
    db.add(entity)
    db.commit()
    db.refresh(entity)
    return serialize(entity)


@router.put("/{entity_id}")
def update_legal_entity(
    entity_id: str, body: LegalEntityUpdate,
    db: Session = Depends(get_db), user: dict = Depends(verify_token),
):
    entity = db.query(LegalEntity).filter(LegalEntity.id == uuid.UUID(entity_id)).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    for k, v in body.dict(exclude_none=True).items():
        setattr(entity, k, v)
    db.commit()
    return serialize(entity)


@router.delete("/{entity_id}")
def delete_legal_entity(entity_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    entity = db.query(LegalEntity).filter(LegalEntity.id == uuid.UUID(entity_id)).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    db.delete(entity)
    db.commit()
    return {"deleted": entity_id}
`);

// ─── api/routes/counterparties.py ─────────────────────────────────────────────
write('api/routes/counterparties.py', `from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from db.session import get_db
from db.models import Counterparty
from middleware.auth import verify_token
from pydantic import BaseModel
from typing import Optional
import uuid

router = APIRouter()


class CounterpartyCreate(BaseModel):
    legal_entity_id: Optional[str] = None
    name: str
    isda_agreement: Optional[str] = None
    csa_type: str = "NO_CSA"
    csa_currency: Optional[str] = None
    csa_threshold_m: Optional[float] = None
    csa_mta_k: Optional[float] = None
    discount_curve_id: Optional[str] = None
    im_model: Optional[str] = "SIMM"


class CounterpartyUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    csa_type: Optional[str] = None
    csa_threshold_m: Optional[float] = None
    discount_curve_id: Optional[str] = None


def serialize(c: Counterparty) -> dict:
    return {
        "id": str(c.id),
        "legal_entity_id": str(c.legal_entity_id) if c.legal_entity_id else None,
        "name": c.name,
        "isda_agreement": c.isda_agreement,
        "csa_type": c.csa_type,
        "csa_currency": c.csa_currency,
        "csa_threshold_m": float(c.csa_threshold_m) if c.csa_threshold_m else None,
        "csa_mta_k": float(c.csa_mta_k) if c.csa_mta_k else None,
        "discount_curve_id": c.discount_curve_id,
        "im_model": c.im_model,
        "is_active": c.is_active,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.get("/")
def get_counterparties(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return [serialize(c) for c in db.query(Counterparty).order_by(Counterparty.created_at).all()]


@router.post("/")
def create_counterparty(body: CounterpartyCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    data = body.dict()
    if data.get("legal_entity_id"):
        data["legal_entity_id"] = uuid.UUID(data["legal_entity_id"])
    cp = Counterparty(**data, created_by=uuid.UUID(user["sub"]))
    db.add(cp)
    db.commit()
    db.refresh(cp)
    return serialize(cp)


@router.put("/{cp_id}")
def update_counterparty(
    cp_id: str, body: CounterpartyUpdate,
    db: Session = Depends(get_db), user: dict = Depends(verify_token),
):
    cp = db.query(Counterparty).filter(Counterparty.id == uuid.UUID(cp_id)).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    for k, v in body.dict(exclude_none=True).items():
        setattr(cp, k, v)
    db.commit()
    return serialize(cp)


@router.delete("/{cp_id}")
def delete_counterparty(cp_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    cp = db.query(Counterparty).filter(Counterparty.id == uuid.UUID(cp_id)).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    db.delete(cp)
    db.commit()
    return {"deleted": cp_id}
`);

// ─── api/routes/trades.py ─────────────────────────────────────────────────────
write('api/routes/trades.py', `from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func as sqlfunc
from db.session import get_db
from db.models import Trade, LegalEntity, Counterparty
from middleware.auth import verify_token
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import date
import uuid

router = APIRouter()


class TradeCreate(BaseModel):
    trade_ref: str
    uti: Optional[str] = None
    status: str = "PENDING"
    store: str = "WORKING"
    asset_class: str
    instrument_type: str
    own_legal_entity_id: Optional[str] = None
    counterparty_id: Optional[str] = None
    notional: Optional[float] = None
    notional_ccy: str
    trade_date: str
    effective_date: str
    maturity_date: str
    terms: Dict[str, Any] = {}
    discount_curve_id: Optional[str] = None
    forecast_curve_id: Optional[str] = None
    desk: Optional[str] = None
    book: Optional[str] = None
    strategy: Optional[str] = None


class TradeUpdate(BaseModel):
    status: Optional[str] = None
    store: Optional[str] = None
    terms: Optional[Dict[str, Any]] = None
    desk: Optional[str] = None
    book: Optional[str] = None
    strategy: Optional[str] = None


def serialize(t: Trade) -> dict:
    return {
        "id": str(t.id),
        "trade_ref": t.trade_ref,
        "uti": t.uti,
        "status": t.status,
        "store": t.store,
        "asset_class": t.asset_class,
        "instrument_type": t.instrument_type,
        "own_legal_entity_id": str(t.own_legal_entity_id) if t.own_legal_entity_id else None,
        "counterparty_id": str(t.counterparty_id) if t.counterparty_id else None,
        "own_entity": (
            {"id": str(t.own_entity.id), "name": t.own_entity.name, "short_name": t.own_entity.short_name}
            if t.own_entity else None
        ),
        "counterparty": (
            {"id": str(t.counterparty.id), "name": t.counterparty.name}
            if t.counterparty else None
        ),
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


def _with_relations(q):
    return q.options(
        joinedload(Trade.own_entity),
        joinedload(Trade.counterparty),
    )


@router.get("/")
def get_trades(
    status: Optional[str] = Query(None),
    asset_class: Optional[str] = Query(None),
    store: Optional[str] = Query(None),
    counterparty_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    q = _with_relations(db.query(Trade))
    if status:        q = q.filter(Trade.status == status)
    if asset_class:   q = q.filter(Trade.asset_class == asset_class)
    if store:         q = q.filter(Trade.store == store)
    if counterparty_id:
        q = q.filter(Trade.counterparty_id == uuid.UUID(counterparty_id))
    return [serialize(t) for t in q.order_by(Trade.trade_date.desc(), Trade.created_at.desc()).all()]


@router.get("/summary")
def trades_summary(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    total     = db.query(Trade).count()
    live      = db.query(Trade).filter(Trade.status == "LIVE").count()
    pending   = db.query(Trade).filter(Trade.status == "PENDING").count()
    matured   = db.query(Trade).filter(Trade.status == "MATURED").count()
    cancelled = db.query(Trade).filter(Trade.status == "CANCELLED").count()
    return {"total": total, "live": live, "pending": pending, "matured": matured, "cancelled": cancelled}


@router.post("/")
def create_trade(body: TradeCreate, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    data = body.dict()
    for fk in ["own_legal_entity_id", "counterparty_id"]:
        if data.get(fk):
            data[fk] = uuid.UUID(data[fk])
    for d in ["trade_date", "effective_date", "maturity_date"]:
        if data.get(d):
            data[d] = date.fromisoformat(data[d])
    trade = Trade(**data, created_by=uuid.UUID(user["sub"]))
    db.add(trade)
    db.commit()
    db.refresh(trade)
    trade = _with_relations(db.query(Trade)).filter(Trade.id == trade.id).first()
    return serialize(trade)


@router.put("/{trade_id}")
def update_trade(
    trade_id: str, body: TradeUpdate,
    db: Session = Depends(get_db), user: dict = Depends(verify_token),
):
    trade = db.query(Trade).filter(Trade.id == uuid.UUID(trade_id)).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    for k, v in body.dict(exclude_none=True).items():
        setattr(trade, k, v)
    trade.last_modified_by = uuid.UUID(user["sub"])
    db.commit()
    return {"id": trade_id, "status": trade.status}


@router.delete("/{trade_id}")
def delete_trade(trade_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    trade = db.query(Trade).filter(Trade.id == uuid.UUID(trade_id)).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")
    if trade.status not in ("PENDING", "CANCELLED"):
        raise HTTPException(status_code=400, detail="Only PENDING or CANCELLED trades can be deleted")
    db.delete(trade)
    db.commit()
    return {"deleted": trade_id}
`);

console.log('\n✅  Backend scaffold complete.');
console.log('Files written to:', ROOT);
console.log('\nNext steps:');
console.log('  1. Copy backend/.env.example to backend/.env and fill in DB credentials');
console.log('  2. Deploy to Render — auto-deploy from backend/ on git push');
