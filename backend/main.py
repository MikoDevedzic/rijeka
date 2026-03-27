"""
Rijeka — FastAPI application entry point
Sprint 3D: pricer router added.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import (
    curves,
    org,
    legal_entities,
    counterparties,
    trades,
    analyse,
    trade_events,
    trade_legs,
    cashflows,
    pricer,         # Sprint 3D
)

app = FastAPI(
    title="Rijeka API",
    description="Open-source full revaluation derivatives risk platform.",
    version="0.3.3",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://app.rijeka.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(curves.router)
app.include_router(org.router)
app.include_router(legal_entities.router)
app.include_router(counterparties.router)
app.include_router(trades.router)
app.include_router(analyse.router)
app.include_router(trade_events.router)
app.include_router(trade_legs.router)
app.include_router(cashflows.router)
app.include_router(pricer.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "service": "rijeka-api", "version": "0.3.3"}
