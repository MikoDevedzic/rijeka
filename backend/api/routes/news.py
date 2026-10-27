"""
news.py — a platform-wide NEWS room everyone can read and nobody can post in.

A cron calls POST /api/news/tick every 30 minutes with the shared secret. The
tick fetches public headline feeds (news/feeds.py), stores anything new in
news_items (deduplicated by URL) and posts each as a card in the single NEWS
room, oldest first. Every firm member is joined to that room the first time
they list their rooms (chat.rooms calls ensure_member), so a visitor sees the
feed on day one and existing users pick it up on their next visit.

GET /api/news/items?tag=RATES&limit=100   the same items as a list, for a
                                          dedicated page or a filter

RIJEKA_CRON_SECRET must be set for the tick to be callable at all.
"""

from __future__ import annotations

import hmac
import logging
import os
import uuid
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db
from db.models import ChatRoom, ChatRoomMember, FirmMember
from middleware.auth import verify_token
from api.routes import chat
from news import feeds as _feeds

log = logging.getLogger("rijeka.news")
router = APIRouter(prefix="/api/news", tags=["news"])

ROOM_TITLE = "Market News"
WELCOME = ("Headlines from central banks, regulators, ISDA and the financial press, posted here as they "
           "appear, with a link to the source. Read-only. Tags: RATES, CREDIT, FX, REGULATION, CRYPTO, "
           "DERIVATIVES. Discuss anything here in your own rooms, or ask @prometheus what it means for a position.")
MAX_PER_TICK = 40           # never flood the room after an outage
MAX_AGE_DAYS = 7            # on the very first run, don't backfill a month of history


def _secret_ok(given: Optional[str]) -> bool:
    expected = os.getenv("RIJEKA_CRON_SECRET", "")
    return bool(expected) and bool(given) and hmac.compare_digest(given, expected)


def news_room(db: Session, create: bool = True) -> Optional[ChatRoom]:
    room = db.query(ChatRoom).filter(ChatRoom.kind == "NEWS").first()
    if room is None and create:
        chat._lock(db, "news-room")
        room = db.query(ChatRoom).filter(ChatRoom.kind == "NEWS").first()
        if room is None:
            room = ChatRoom(id=uuid.uuid4(), kind="NEWS", name=ROOM_TITLE)
            db.add(room); db.flush()
            chat._post(db, room, kind="SYSTEM", name="Rijeka", firm=chat._platform(db), body=WELCOME)
    return room


def ensure_member(db: Session, me: FirmMember) -> None:
    """Join this person to the NEWS room (idempotent). Called from chat.rooms."""
    room = news_room(db)
    if chat._member(db, room.id, me.user_id) is None:
        db.add(ChatRoomMember(room_id=room.id, user_id=me.user_id, firm_id=me.firm_id,
                              role="MEMBER", status="JOINED", joined_at=chat._now()))


def ingest(db: Session, items: list[_feeds.Item]) -> int:
    """Store and post what is new. Returns how many were posted."""
    room = news_room(db)
    cutoff = chat._now() - timedelta(days=MAX_AGE_DAYS)
    seen: set[str] = set()
    fresh = []
    for it in items:
        if it.url in seen or (it.published_at is not None and it.published_at < cutoff):
            continue
        seen.add(it.url)
        if db.execute(text("SELECT 1 FROM news_items WHERE url = :u"), {"u": it.url}).first() is None:
            fresh.append(it)
    fresh.sort(key=lambda i: (i.published_at is None, i.published_at or chat._now()))
    posted = 0
    for it in fresh[-MAX_PER_TICK:]:
        card = {"type": "news", "source": it.source, "title": it.title, "url": it.url,
                "published_at": it.published_at.isoformat() if it.published_at else None,
                "tags": list(it.tags)}
        msg = chat._post(db, room, kind="SYSTEM", name=it.source, body=f"{it.source}: {it.title}", card=card)
        db.flush()
        db.execute(text("""INSERT INTO news_items (url, title, source, published_at, tags, message_id)
                           VALUES (:u, :t, :s, :p, :g, :m) ON CONFLICT (url) DO NOTHING"""),
                   {"u": it.url, "t": it.title, "s": it.source, "p": it.published_at, "g": list(it.tags), "m": msg.id})
        posted += 1
    return posted


@router.post("/tick")
def tick(db: Session = Depends(get_db), x_rijeka_cron: Optional[str] = Header(None)):
    if not _secret_ok(x_rijeka_cron):
        raise HTTPException(status_code=403, detail="bad cron secret")
    items = _feeds.fetch()
    posted = ingest(db, items)
    db.commit()
    return {"fetched": len(items), "posted": posted}


@router.get("/items")
def items(tag: Optional[str] = None, limit: int = Query(default=100, ge=1, le=500),
          db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    sql = "SELECT url, title, source, published_at, tags FROM news_items"
    params: dict = {"n": limit}
    if tag:
        sql += " WHERE :tag = ANY(tags)"; params["tag"] = tag.upper()
    sql += " ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT :n"
    return [{"url": r.url, "title": r.title, "source": r.source,
             "published_at": r.published_at.isoformat() if r.published_at else None, "tags": list(r.tags or [])}
            for r in db.execute(text(sql), params)]
