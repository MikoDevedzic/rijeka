import os
os.environ["TZ"] = "America/New_York"
"""
Rijeka — FastAPI application entry point
Sprint 3D: pricer router added.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import (
    schedules,
    curves,
    org,
    legal_entities,
    counterparties,
    trades,
    analyse,
    trade_events,
    trade_legs,
    cashflows,
    pricer,
    market_data,
    bloomberg,
    xva,
)

app = FastAPI(
    title="Rijeka API",
    description="Open-source full revaluation derivatives risk platform.",
    version="0.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "https://app.rijeka.app",
        "https://rijeka.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(curves.router)
app.include_router(org.router)
app.include_router(legal_entities.router, prefix="/api/legal-entities", tags=["legal-entities"])
app.include_router(counterparties.router, prefix="/api/counterparties", tags=["counterparties"])
app.include_router(trades.router, prefix="/api/trades", tags=["trades"])
app.include_router(analyse.router, prefix="/api/analyse", tags=["analyse"])
app.include_router(trade_events.router)
app.include_router(trade_legs.router)
app.include_router(cashflows.router)
app.include_router(pricer.router)
app.include_router(market_data.router)
app.include_router(xva.router)
app.include_router(bloomberg.router, prefix="/api")
app.include_router(schedules.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "service": "rijeka-api", "version": "0.4.0"}




