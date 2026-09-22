"""
chat.py — firms and firm-to-firm chat rooms.

Clients READ firms/rooms/messages straight from Supabase under RLS (that is
how realtime delivers new messages). Every WRITE comes through here, so the
membership rules live in one place:

GET  /api/chat/me                     your firm (or none yet)
GET  /api/chat/firms                  the directory of firms on Rijeka
GET  /api/chat/rooms                  your firm's rooms, newest activity first;
                                      creates your Rijeka support room on first call
POST /api/chat/rooms                  open (get-or-create) a room with another firm,
                                      by firm_id or by a counterparty's LEI
GET  /api/chat/rooms/{id}/messages    history, oldest first
POST /api/chat/rooms/{id}/messages    post; Prometheus answers in the background
                                      when @mentioned, and always in support rooms
POST /api/chat/rooms/{id}/read        mark read

Prometheus in a room uses only what every firm in the room already has (see
prometheus/rooms.py): Rijeka's public code and docs, and in a bilateral room
the records of trades confirmed on-chain between the two firms.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from db.models import ChatMessage, ChatRead, ChatRoom, ChatRoomFirm, Firm, FirmLei, FirmMember
from db.session import SessionLocal, get_db
from middleware.auth import verify_token
from prometheus.rooms import answer_in_room, mentions_prometheus, shared_confirmations
from prometheus.tools import make_readonly

log = logging.getLogger("rijeka.chat")
router = APIRouter(prefix="/api/chat", tags=["chat"])

SUPPORT_WELCOME = (
    "Welcome to your Rijeka support room. Ask anything about pricing, XVA, margin, "
    "on-chain confirmation or how to model a risk in Rijeka. Prometheus answers first; "
    "a Rijeka specialist can join here too. Product ideas and bugs are welcome."
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _uid(user: dict) -> uuid.UUID:
    return uuid.UUID(user["sub"])


def _my_firm(db: Session, user: dict) -> tuple[FirmMember, Firm]:
    m = db.query(FirmMember).filter(FirmMember.user_id == _uid(user)).first()
    if m is None:
        raise HTTPException(status_code=403,
                            detail="Your account isn't part of a firm on Rijeka yet.")
    return m, db.get(Firm, m.firm_id)


def _platform(db: Session) -> Firm:
    f = db.query(Firm).filter(Firm.kind == "PLATFORM").first()
    if f is None:
        raise HTTPException(status_code=500, detail="Platform firm missing (migration 010).")
    return f


def _display_name(db: Session, user_id: uuid.UUID) -> str:
    # Not every auth user has a profiles row (e.g. accounts made in the
    # dashboard), so fall back to the auth email.
    row = db.execute(text("""
        SELECT p.full_name, p.trader_id, coalesce(p.email, u.email) AS email
        FROM auth.users u LEFT JOIN profiles p ON p.id = u.id
        WHERE u.id = :id"""), {"id": user_id}).first()
    if row is None:
        return "Unknown"
    return row.full_name or row.trader_id or (row.email or "").split("@")[0] or "Unknown"


def _room_firm_ids(db: Session, room_id: uuid.UUID) -> list[uuid.UUID]:
    return [r.firm_id for r in db.query(ChatRoomFirm).filter(ChatRoomFirm.room_id == room_id).all()]


def _room_for(db: Session, room_id: str, firm: Firm) -> ChatRoom:
    try:
        rid = uuid.UUID(room_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Room not found")
    room = db.get(ChatRoom, rid)
    # 404 for rooms you're not in too: no existence leak across firms.
    if room is None or firm.id not in _room_firm_ids(db, rid):
        raise HTTPException(status_code=404, detail="Room not found")
    return room


def _serialize_msg(m: ChatMessage) -> dict:
    return {
        "id": str(m.id), "room_id": str(m.room_id), "sender_kind": m.sender_kind,
        "sender_user_id": str(m.sender_user_id) if m.sender_user_id else None,
        "sender_firm_id": str(m.sender_firm_id) if m.sender_firm_id else None,
        "sender_name": m.sender_name, "sender_firm": m.sender_firm,
        "body": m.body, "card": m.card,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _post(db: Session, room: ChatRoom, *, kind: str, name: str, body: str,
          firm: Optional[Firm] = None, user_id: Optional[uuid.UUID] = None,
          card: Optional[dict] = None) -> ChatMessage:
    msg = ChatMessage(
        id=uuid.uuid4(), room_id=room.id, sender_kind=kind, sender_user_id=user_id,
        sender_firm_id=firm.id if firm else None, sender_name=name,
        sender_firm=firm.name if firm else None, body=body, card=card,
    )
    db.add(msg)
    room.last_message_at = datetime.now(timezone.utc)
    return msg


def _new_room(db: Session, kind: str, firms: list[Firm], created_by) -> ChatRoom:
    room = ChatRoom(id=uuid.uuid4(), kind=kind, created_by=created_by)
    db.add(room)
    db.flush()
    for f in firms:
        db.add(ChatRoomFirm(room_id=room.id, firm_id=f.id))
    db.flush()
    return room


def _lock_pair(db: Session, a: uuid.UUID, b: uuid.UUID) -> None:
    """Serialise get-or-create for one firm pair so two clicks can't make two rooms."""
    key = ":".join(sorted([str(a), str(b)]))
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": key})


def _find_room(db: Session, kind: str, firm_ids: list[uuid.UUID]) -> Optional[ChatRoom]:
    """A room of this kind whose firms are exactly firm_ids."""
    rid = (db.query(ChatRoomFirm.room_id)
             .join(ChatRoom, ChatRoom.id == ChatRoomFirm.room_id)
             .filter(ChatRoom.kind == kind)
             .group_by(ChatRoomFirm.room_id)
             .having(func.count() == len(firm_ids))
             .having(func.count().filter(ChatRoomFirm.firm_id.in_(firm_ids)) == len(firm_ids))
             .first())
    return db.get(ChatRoom, rid[0]) if rid else None


def _ensure_support_room(db: Session, firm: Firm) -> None:
    if firm.kind == "PLATFORM":
        return
    platform = _platform(db)
    _lock_pair(db, firm.id, platform.id)
    if _find_room(db, "SUPPORT", [firm.id, platform.id]) is not None:
        return
    room = _new_room(db, "SUPPORT", [firm, platform], None)
    _post(db, room, kind="SYSTEM", name="Rijeka", firm=platform, body=SUPPORT_WELCOME)
    db.commit()


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/me")
def me(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    m = db.query(FirmMember).filter(FirmMember.user_id == _uid(user)).first()
    if m is None:
        return {"firm": None}
    f = db.get(Firm, m.firm_id)
    return {"firm": {"id": str(f.id), "name": f.name, "kind": f.kind,
                     "coverage_tier": f.coverage_tier}, "role": m.role,
            "display_name": _display_name(db, _uid(user))}


@router.get("/firms")
def firms(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    leis: dict[uuid.UUID, list[str]] = {}
    for l in db.query(FirmLei).all():
        leis.setdefault(l.firm_id, []).append(l.lei)
    members = dict(db.query(FirmMember.firm_id, func.count()).group_by(FirmMember.firm_id).all())
    return [
        {"id": str(f.id), "name": f.name, "kind": f.kind, "leis": leis.get(f.id, []),
         "on_network": members.get(f.id, 0) > 0}
        for f in db.query(Firm).order_by(Firm.name).all()
    ]


@router.get("/rooms")
def rooms(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me_uid = _uid(user)
    _, firm = _my_firm(db, user)
    _ensure_support_room(db, firm)

    room_ids = [r.room_id for r in db.query(ChatRoomFirm).filter(ChatRoomFirm.firm_id == firm.id).all()]
    out = []
    for room in db.query(ChatRoom).filter(ChatRoom.id.in_(room_ids)).all() if room_ids else []:
        others = (db.query(Firm).join(ChatRoomFirm, ChatRoomFirm.firm_id == Firm.id)
                    .filter(ChatRoomFirm.room_id == room.id, Firm.id != firm.id).all())
        last = (db.query(ChatMessage).filter(ChatMessage.room_id == room.id)
                  .order_by(ChatMessage.created_at.desc()).first())
        read = db.get(ChatRead, (room.id, me_uid))
        unread_q = db.query(func.count()).select_from(ChatMessage).filter(
            ChatMessage.room_id == room.id,
            (ChatMessage.sender_user_id.is_(None)) | (ChatMessage.sender_user_id != me_uid))
        if read is not None:
            unread_q = unread_q.filter(ChatMessage.created_at > read.last_read_at)
        out.append({
            "id": str(room.id), "kind": room.kind,
            "title": "Rijeka Support" if room.kind == "SUPPORT" else ", ".join(o.name for o in others),
            "firms": [{"id": str(o.id), "name": o.name} for o in others],
            "last_message": _serialize_msg(last) if last else None,
            "last_message_at": room.last_message_at.isoformat() if room.last_message_at else None,
            "unread": unread_q.scalar() or 0,
        })
    # Support room pinned first, then most recent activity.
    out.sort(key=lambda r: (r["kind"] != "SUPPORT", -(datetime.fromisoformat(r["last_message_at"]).timestamp()
                                                       if r["last_message_at"] else 0)))
    return out


class OpenRoom(BaseModel):
    firm_id: Optional[str] = None
    lei: Optional[str] = None

    @model_validator(mode="after")
    def _one(self):
        if bool(self.firm_id) == bool(self.lei):
            raise ValueError("give exactly one of firm_id or lei")
        return self


@router.post("/rooms", status_code=201)
def open_room(body: OpenRoom, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _, firm = _my_firm(db, user)
    if body.lei:
        claim = db.get(FirmLei, body.lei.strip().upper())
        if claim is None:
            raise HTTPException(status_code=404,
                                detail="That counterparty isn't on Rijeka yet — no firm has claimed its LEI.")
        target = db.get(Firm, claim.firm_id)
    else:
        try:
            target = db.get(Firm, uuid.UUID(body.firm_id))
        except ValueError:
            target = None
        if target is None:
            raise HTTPException(status_code=404, detail="Firm not found")
    if target.id == firm.id:
        raise HTTPException(status_code=422, detail="That's your own firm.")
    if target.kind == "PLATFORM":
        _ensure_support_room(db, firm)
        room = _find_room(db, "SUPPORT", [firm.id, target.id])
        return {"id": str(room.id), "kind": room.kind, "created": False}

    _lock_pair(db, firm.id, target.id)
    room = _find_room(db, "BILATERAL", [firm.id, target.id])
    created = room is None
    if created:
        room = _new_room(db, "BILATERAL", [firm, target], _uid(user))
        _post(db, room, kind="SYSTEM", name="Rijeka", firm=None,
              body=f"{firm.name} opened a chat with {target.name}. "
                   "Mention @prometheus to ask about Rijeka's methodology.")
        _mark_read(db, room.id, _uid(user))
        db.commit()
    return {"id": str(room.id), "kind": room.kind, "created": created}


@router.get("/rooms/{room_id}/messages")
def messages(room_id: str, limit: int = Query(default=200, ge=1, le=500),
             db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    _, firm = _my_firm(db, user)
    room = _room_for(db, room_id, firm)
    rows = (db.query(ChatMessage).filter(ChatMessage.room_id == room.id)
              .order_by(ChatMessage.created_at.desc()).limit(limit).all())
    return [_serialize_msg(m) for m in reversed(rows)]


class PostMessage(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


@router.post("/rooms/{room_id}/messages", status_code=201)
def post_message(room_id: str, body: PostMessage, background: BackgroundTasks,
                 db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    member, firm = _my_firm(db, user)
    room = _room_for(db, room_id, firm)
    text_ = body.body.strip()
    if not text_:
        raise HTTPException(status_code=422, detail="Empty message")
    msg = _post(db, room, kind="USER", name=_display_name(db, member.user_id), firm=firm,
                user_id=member.user_id, body=text_)
    _mark_read(db, room.id, member.user_id)
    db.commit()

    # Support rooms: Prometheus is the first responder for client firms.
    # Anywhere: an explicit @prometheus.
    wants_prometheus = mentions_prometheus(text_) or (room.kind == "SUPPORT" and firm.kind != "PLATFORM")
    if wants_prometheus:
        background.add_task(_prometheus_reply, room.id)
    return {"message": _serialize_msg(msg), "prometheus_pending": wants_prometheus}


def _mark_read(db: Session, room_id: uuid.UUID, user_id: uuid.UUID) -> None:
    now = datetime.now(timezone.utc)
    r = db.get(ChatRead, (room_id, user_id))
    if r is None:
        db.add(ChatRead(room_id=room_id, user_id=user_id, last_read_at=now))
    else:
        r.last_read_at = now


@router.post("/rooms/{room_id}/read", status_code=204)
def mark_read(room_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    member, firm = _my_firm(db, user)
    room = _room_for(db, room_id, firm)
    _mark_read(db, room.id, member.user_id)
    db.commit()


# ── Prometheus reply (background) ────────────────────────────────────────────

def _prometheus_reply(room_id: uuid.UUID) -> None:
    """
    Runs after the poster's request returns; the reply reaches everyone in
    the room through realtime. The DB connection is not held during the model
    call (which takes tens of seconds).
    """
    db = SessionLocal()
    try:
        room = db.get(ChatRoom, room_id)
        firms = (db.query(Firm).join(ChatRoomFirm, ChatRoomFirm.firm_id == Firm.id)
                   .filter(ChatRoomFirm.room_id == room_id).all())
        history = [
            {"sender_kind": m.sender_kind, "sender_name": m.sender_name,
             "sender_firm": m.sender_firm, "body": m.body}
            for m in reversed(db.query(ChatMessage).filter(ChatMessage.room_id == room_id)
                                .order_by(ChatMessage.created_at.desc()).limit(40).all())
            if m.sender_kind != "SYSTEM"
        ]
        kind = room.kind
        firm_names = [f.name for f in firms if f.kind != "PLATFORM"]
        platform_id = next((f.id for f in firms if f.kind == "PLATFORM"), None)
        firm_ids = [f.id for f in firms]
        db.rollback()
        shared = []
        if kind == "BILATERAL":
            # The records both firms signed; computed on a read-only transaction.
            make_readonly(db)
            shared = shared_confirmations(db, firm_ids)
            db.rollback()
    finally:
        db.close()

    card = None
    if not os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_API_KEY") == "PLACEHOLDER":
        body, kind_out = "Prometheus isn't configured on this server.", "SYSTEM"
    else:
        try:
            ans = answer_in_room(kind, firm_names, history, shared)
            body, kind_out = ans.text, "PROMETHEUS"
            if not body:
                return
            if ans.sources:
                card = {"type": "prometheus", "sources": ans.sources}
        except Exception:
            log.exception("prometheus room reply failed")
            body, kind_out = "Prometheus couldn't answer just now — try again in a moment.", "SYSTEM"

    db = SessionLocal()
    try:
        room = db.get(ChatRoom, room_id)
        platform = db.get(Firm, platform_id) if platform_id else _platform(db)
        _post(db, room, kind=kind_out, name="Prometheus" if kind_out == "PROMETHEUS" else "Rijeka",
              firm=platform, body=body, card=card)
        db.commit()
    finally:
        db.close()
