"""
GET /api/prometheus/brief            the book brief: computed facts + audited narration, cached an hour
GET /api/prometheus/brief?refresh=1  recompute now

The facts come from the pricers; the prose from Prometheus, bound to fact ids
and audited against the numbers before it is returned (prometheus/book_brief.py).
Without an ANTHROPIC_API_KEY the response carries the facts and no prose.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from db.session import get_db
from middleware.auth import verify_token
from prometheus import book_brief as bb

router = APIRouter(prefix="/api/prometheus", tags=["prometheus"])


@router.get("/brief")
def brief(refresh: bool = Query(default=False), db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return bb.brief(db, user, refresh=refresh)
