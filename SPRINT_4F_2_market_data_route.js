// SPRINT_4F_2_market_data_route.js
// Writes: backend/api/routes/market_data.py
// Run from Rijeka root: node SPRINT_4F_2_market_data_route.js

const fs = require('fs');
const path = require('path');
const RIJEKA = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';

const content = `"""
Rijeka — market_data routes (Sprint 4F)

POST /api/market-data/snapshots
  Save or update a curve's pillar quotes for a given valuation date.
  UPSERT on (curve_id, valuation_date).

GET /api/market-data/snapshots/{curve_id}/latest
  Return the most recent snapshot for a curve_id.
  Used by pricer to auto-load curves.

GET /api/market-data/snapshots/{curve_id}
  Return all snapshots for a curve_id (newest first, limit 30).

GET /api/market-data/snapshots/date/{valuation_date}
  Return all curve snapshots for a given date.
  Used by the PRICER tile to load a full market data set.
"""

from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from middleware.auth import verify_token

router = APIRouter(prefix="/api/market-data", tags=["market-data"])


# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────

class PillarQuoteIn(BaseModel):
    tenor: str
    quote_type: str      # OISDeposit | OIS | BASIS | FRA | FUTURES
    rate: float          # stored as % (5.310 = 5.310%)
    enabled: bool = True


class SnapshotIn(BaseModel):
    curve_id: str
    valuation_date: date
    quotes: List[PillarQuoteIn]
    source: str = "MANUAL"


class SnapshotOut(BaseModel):
    id: str
    curve_id: str
    valuation_date: date
    quotes: list
    source: str
    created_at: datetime
    created_by: Optional[str]


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/snapshots", response_model=SnapshotOut)
async def save_snapshot(
    body: SnapshotIn,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Save or update a curve snapshot. UPSERT on (curve_id, valuation_date).
    Requires TRADER or ADMIN role.
    """
    role = user.get("user_metadata", {}).get("role", "viewer").lower()
    if role not in ("trader", "admin"):
        raise HTTPException(status_code=403, detail="Trader or Admin role required")

    user_id = user.get("sub")
    quotes_json = [q.dict() for q in body.quotes]

    result = db.execute(
        text("""
            INSERT INTO market_data_snapshots
              (curve_id, valuation_date, quotes, source, created_by)
            VALUES
              (:curve_id, :valuation_date, :quotes::jsonb, :source, :created_by)
            ON CONFLICT (curve_id, valuation_date)
            DO UPDATE SET
              quotes     = EXCLUDED.quotes,
              source     = EXCLUDED.source,
              created_at = NOW(),
              created_by = EXCLUDED.created_by
            RETURNING id, curve_id, valuation_date, quotes, source, created_at, created_by
        """),
        {
            "curve_id":       body.curve_id,
            "valuation_date": body.valuation_date,
            "quotes":         __import__('json').dumps(quotes_json),
            "source":         body.source,
            "created_by":     user_id,
        }
    )
    db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=500, detail="Snapshot save failed")

    return SnapshotOut(
        id=str(row.id),
        curve_id=row.curve_id,
        valuation_date=row.valuation_date,
        quotes=row.quotes if isinstance(row.quotes, list) else [],
        source=row.source,
        created_at=row.created_at,
        created_by=str(row.created_by) if row.created_by else None,
    )


@router.get("/snapshots/{curve_id}/latest")
async def get_latest_snapshot(
    curve_id: str,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Return the most recent snapshot for a curve_id.
    Returns null if no snapshot exists.
    """
    result = db.execute(
        text("""
            SELECT id, curve_id, valuation_date, quotes, source, created_at, created_by
            FROM market_data_snapshots
            WHERE curve_id = :curve_id
            ORDER BY valuation_date DESC
            LIMIT 1
        """),
        {"curve_id": curve_id}
    )
    row = result.fetchone()
    if not row:
        return {"exists": False, "curve_id": curve_id}

    return {
        "exists":         True,
        "id":             str(row.id),
        "curve_id":       row.curve_id,
        "valuation_date": row.valuation_date.isoformat(),
        "quotes":         row.quotes if isinstance(row.quotes, list) else [],
        "source":         row.source,
        "created_at":     row.created_at.isoformat(),
    }


@router.get("/snapshots/{curve_id}")
async def get_curve_snapshots(
    curve_id: str,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """Return all snapshots for a curve_id, newest first (limit 30)."""
    result = db.execute(
        text("""
            SELECT id, curve_id, valuation_date, quotes, source, created_at
            FROM market_data_snapshots
            WHERE curve_id = :curve_id
            ORDER BY valuation_date DESC
            LIMIT 30
        """),
        {"curve_id": curve_id}
    )
    rows = result.fetchall()
    return [
        {
            "id":             str(r.id),
            "curve_id":       r.curve_id,
            "valuation_date": r.valuation_date.isoformat(),
            "quotes":         r.quotes if isinstance(r.quotes, list) else [],
            "source":         r.source,
            "created_at":     r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/snapshots/date/{valuation_date}")
async def get_snapshots_by_date(
    valuation_date: date,
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Return all curve snapshots for a given valuation date.
    Used by PRICER tile to load a full market data set for a date.
    """
    result = db.execute(
        text("""
            SELECT id, curve_id, valuation_date, quotes, source, created_at
            FROM market_data_snapshots
            WHERE valuation_date = :valuation_date
            ORDER BY curve_id
        """),
        {"valuation_date": valuation_date}
    )
    rows = result.fetchall()
    return [
        {
            "id":             str(r.id),
            "curve_id":       r.curve_id,
            "valuation_date": r.valuation_date.isoformat(),
            "quotes":         r.quotes if isinstance(r.quotes, list) else [],
            "source":         r.source,
            "created_at":     r.created_at.isoformat(),
        }
        for r in rows
    ]
`;

const dest = path.join(RIJEKA, 'backend', 'api', 'routes', 'market_data.py');
fs.writeFileSync(dest, content, 'utf8');
console.log('✓ Written: ' + dest);
