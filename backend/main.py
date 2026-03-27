from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from db.session import engine
from db import models
from api.routes import curves, org, legal_entities, counterparties, trades, analyse
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
app.include_router(analyse.router,        prefix="/api/analyse",         tags=["AI"])

@app.get("/health", tags=["System"])
def health():
    return {"status": "ok", "service": "rijeka-risk-api", "version": "0.1.0"}
