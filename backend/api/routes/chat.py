"""
chat.py — people-to-people chat across firms (migration 011).

Rooms have PEOPLE as members:
  DIRECT   one-to-one, same firm or across firms
  GROUP    named, invite-only, optionally tagged with one of the creator's
           firm's desks/books
  SUPPORT  one per person, with Rijeka; Prometheus answers first
Inviting someone from your own firm adds them; inviting across firms sends
an invite they accept or decline. A firm's COMPLIANCE members can read, never
post in, every room their firm's people are or were in.

Clients READ rooms/members/messages from Supabase under RLS (that is how
realtime delivers them). Every WRITE comes through here, so the membership
rules live in one place.

GET  /api/chat/me                        you and your firm
GET  /api/chat/firms                     firms on Rijeka
GET  /api/chat/people?q=&firm_id=&lei=   people you can chat with
GET  /api/chat/books                     your firm's desks/books, for tagging rooms
GET  /api/chat/rooms                     your rooms (and invites; for compliance, your firm's)
POST /api/chat/rooms/direct              {user_id}: open or reuse a one-to-one
POST /api/chat/rooms/group               {name, member_ids, book_node_id?}
POST /api/chat/rooms/{id}/invite         {user_ids}
POST /api/chat/rooms/{id}/accept|decline|leave
GET  /api/chat/rooms/{id}/messages
POST /api/chat/rooms/{id}/messages       Prometheus answers in the background when
                                         @mentioned, and always in support rooms
POST /api/chat/rooms/{id}/read

Prometheus in a room uses only what everyone in it already has (see
prometheus/rooms.py).
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from db.models import ChatMessage, ChatRead, ChatRoom, ChatRoomMember, Firm, FirmLei, FirmMember
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
MAX_GROUP = 50


# ── Identity ─────────────────────────────────────────────────────────────────

def _uid(user: dict) -> uuid.UUID:
    return uuid.UUID(user["sub"])


def _my_firm(db: Session, user: dict) -> tuple[FirmMember, Firm]:
    m = db.query(FirmMember).filter(FirmMember.user_id == _uid(user)).first()
    if m is None:
        raise HTTPException(status_code=403, detail="Your account isn't part of a firm on Rijeka yet.")
    return m, db.get(Firm, m.firm_id)


def _names(db: Session, user_ids) -> dict[uuid.UUID, str]:
    """Display names. Not every auth user has a profiles row, so fall back to email."""
    ids = list({u for u in user_ids if u})
    if not ids:
        return {}
    rows = db.execute(text("""
        SELECT u.id, p.full_name, p.trader_id, coalesce(p.email, u.email) AS email
        FROM auth.users u LEFT JOIN profiles p ON p.id = u.id
        WHERE u.id = ANY(:ids)"""), {"ids": ids}).all()
    return {r.id: (r.full_name or r.trader_id or (r.email or "").split("@")[0] or "Unknown") for r in rows}


def _platform(db: Session) -> Firm:
    f = db.query(Firm).filter(Firm.kind == "PLATFORM").first()
    if f is None:
        raise HTTPException(status_code=500, detail="Platform firm missing (migration 010).")
    return f


# ── Rooms and membership ─────────────────────────────────────────────────────

def _members(db: Session, room_id: uuid.UUID) -> list[ChatRoomMember]:
    return db.query(ChatRoomMember).filter(ChatRoomMember.room_id == room_id).all()


def _member(db: Session, room_id: uuid.UUID, user_id: uuid.UUID) -> Optional[ChatRoomMember]:
    return db.get(ChatRoomMember, (room_id, user_id))


def _access(db: Session, room_id: uuid.UUID, me: FirmMember) -> str:
    """JOINED | INVITED | OBSERVER (compliance) | '' (none). Mirrors chat_can_see/chat_can_read."""
    m = _member(db, room_id, me.user_id)
    if m is not None and m.status in ("JOINED", "INVITED"):
        return m.status
    if me.role == "COMPLIANCE" and db.query(ChatRoomMember).filter(
            ChatRoomMember.room_id == room_id, ChatRoomMember.firm_id == me.firm_id,
            ChatRoomMember.status.in_(("JOINED", "LEFT"))).first():
        return "OBSERVER"
    return ""


def _room_for(db: Session, room_id: str, me: FirmMember, need: tuple[str, ...]) -> tuple[ChatRoom, str]:
    try:
        rid = uuid.UUID(room_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Room not found")
    room = db.get(ChatRoom, rid)
    access = _access(db, rid, me) if room else ""
    # 404 whenever you have no access at all: no existence leak.
    if not access:
        raise HTTPException(status_code=404, detail="Room not found")
    if access not in need:
        detail = {"INVITED": "Accept the invite first.",
                  "OBSERVER": "Compliance can read this room but not post in it."}.get(access, "Not allowed.")
        raise HTTPException(status_code=403, detail=detail)
    return room, access


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


def _system(db: Session, room: ChatRoom, body: str) -> None:
    _post(db, room, kind="SYSTEM", name="Rijeka", body=body)


def _lock(db: Session, *keys) -> None:
    """Serialise get-or-create so two clicks can't make two rooms."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": ":".join(sorted(map(str, keys)))})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _add(db: Session, room: ChatRoom, target: FirmMember, inviter: Optional[FirmMember],
         role: str = "MEMBER") -> Optional[str]:
    """
    Add or re-invite someone. Your own firm: joined straight away. Another
    firm: an invite they accept. Returns the new status, or None when they
    were already in (or already invited to) the room.
    """
    m = _member(db, room.id, target.user_id)
    if m is not None and m.status in ("JOINED", "INVITED"):
        return None
    status = "JOINED" if inviter is None or target.firm_id == inviter.firm_id else "INVITED"
    if m is None:
        m = ChatRoomMember(room_id=room.id, user_id=target.user_id, firm_id=target.firm_id, role=role)
        db.add(m)
    m.status, m.firm_id = status, target.firm_id
    m.invited_by = inviter.user_id if inviter else None
    m.joined_at = _now() if status == "JOINED" else None
    m.left_at = None
    return status


def _invitable(db: Session, user_ids: list[str], me: FirmMember) -> list[FirmMember]:
    out = []
    for raw in user_ids:
        try:
            uid = uuid.UUID(raw)
        except ValueError:
            raise HTTPException(status_code=404, detail="Person not found")
        fm = db.query(FirmMember).filter(FirmMember.user_id == uid).first()
        if fm is None:
            raise HTTPException(status_code=404, detail="That person isn't on Rijeka.")
        if fm.role == "COMPLIANCE":
            raise HTTPException(status_code=422, detail="Compliance officers observe rooms; they aren't invited into them.")
        if uid != me.user_id:
            out.append(fm)
    return out


def _ensure_support_room(db: Session, me: FirmMember) -> None:
    if me.role == "COMPLIANCE":
        return
    _lock(db, "support", me.user_id)
    exists = (db.query(ChatRoom).join(ChatRoomMember, ChatRoomMember.room_id == ChatRoom.id)
                .filter(ChatRoom.kind == "SUPPORT", ChatRoomMember.user_id == me.user_id).first())
    if exists is not None:
        return
    room = ChatRoom(id=uuid.uuid4(), kind="SUPPORT", created_by=me.user_id)
    db.add(room)
    db.flush()
    _add(db, room, me, None)
    _post(db, room, kind="SYSTEM", name="Rijeka", firm=_platform(db), body=SUPPORT_WELCOME)
    db.commit()


# ── Routes: identity and directory ───────────────────────────────────────────

@router.get("/me")
def me(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    m = db.query(FirmMember).filter(FirmMember.user_id == _uid(user)).first()
    if m is None:
        return {"firm": None}
    f = db.get(Firm, m.firm_id)
    return {"user_id": str(m.user_id), "role": m.role, "display_name": _names(db, [m.user_id]).get(m.user_id),
            "firm": {"id": str(f.id), "name": f.name, "kind": f.kind, "coverage_tier": f.coverage_tier}}


@router.get("/firms")
def firms(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    leis: dict[uuid.UUID, list[str]] = {}
    for l in db.query(FirmLei).all():
        leis.setdefault(l.firm_id, []).append(l.lei)
    people = dict(db.query(FirmMember.firm_id, func.count())
                    .filter(FirmMember.role != "COMPLIANCE").group_by(FirmMember.firm_id).all())
    return [{"id": str(f.id), "name": f.name, "kind": f.kind, "leis": leis.get(f.id, []),
             "on_network": people.get(f.id, 0) > 0}
            for f in db.query(Firm).order_by(Firm.name).all()]


@router.get("/people")
def people(q: Optional[str] = None, firm_id: Optional[str] = None, lei: Optional[str] = None,
           db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """People you can start a chat with or invite. Compliance officers aren't listed."""
    me_m, _ = _my_firm(db, user)
    qry = (db.query(FirmMember, Firm).join(Firm, Firm.id == FirmMember.firm_id)
             .filter(FirmMember.role != "COMPLIANCE", FirmMember.user_id != me_m.user_id, Firm.kind != "PLATFORM"))
    if lei:
        claim = db.get(FirmLei, lei.strip().upper())
        if claim is None:
            raise HTTPException(status_code=404, detail="That counterparty isn't on Rijeka yet — no firm has claimed its LEI.")
        qry = qry.filter(FirmMember.firm_id == claim.firm_id)
    if firm_id:
        try:
            qry = qry.filter(FirmMember.firm_id == uuid.UUID(firm_id))
        except ValueError:
            raise HTTPException(status_code=404, detail="Firm not found")
    rows = qry.all()
    names = _names(db, [m.user_id for m, _ in rows])
    out = [{"user_id": str(m.user_id), "name": names.get(m.user_id, "Unknown"),
            "firm_id": str(f.id), "firm_name": f.name, "same_firm": f.id == me_m.firm_id}
           for m, f in rows]
    if q:
        ql = q.lower()
        out = [p for p in out if ql in p["name"].lower() or ql in p["firm_name"].lower()]
    return sorted(out, key=lambda p: (not p["same_firm"], p["firm_name"], p["name"]))


@router.get("/books")
def books(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Your firm's desks and books (org hierarchy), for tagging a group room."""
    me_m, _ = _my_firm(db, user)
    rows = db.execute(text("""
        SELECT n.id, n.node_type, n.name, p.name AS parent
        FROM org_nodes n LEFT JOIN org_nodes p ON p.id = n.parent_id
        JOIN firm_members fm ON fm.user_id = n.user_id
        WHERE fm.firm_id = :firm AND n.is_active AND lower(n.node_type) IN ('desk', 'book')
        ORDER BY p.name NULLS FIRST, n.name"""), {"firm": me_m.firm_id}).all()
    return [{"id": r.id, "type": r.node_type.lower(),
             "label": f"{r.parent} / {r.name}" if r.node_type.lower() == "book" and r.parent else r.name}
            for r in rows]


# ── Routes: rooms ────────────────────────────────────────────────────────────

def _room_summary(db: Session, room: ChatRoom, me: FirmMember, access: str,
                  firms_by_id: dict, names: dict) -> dict:
    members = _members(db, room.id)
    active = [m for m in members if m.status in ("JOINED", "INVITED")]

    def who(m):
        return f"{names.get(m.user_id, 'Unknown')} · {firms_by_id[m.firm_id].name}"

    if room.kind == "SUPPORT":
        owner = next((m for m in members if m.status == "JOINED"), None)
        title = f"Rijeka Support · {names.get(owner.user_id)}" if access == "OBSERVER" and owner else "Rijeka Support"
    elif room.kind == "DIRECT":
        if access == "OBSERVER":
            title = " ↔ ".join(who(m) for m in members)
        else:
            other = next((m for m in members if m.user_id != me.user_id), None)
            title = who(other) if other else "Direct chat"
    else:
        title = room.name or "Group"

    last = (db.query(ChatMessage).filter(ChatMessage.room_id == room.id)
              .order_by(ChatMessage.created_at.desc()).first())
    unread = 0
    if access in ("JOINED", "OBSERVER"):
        read = db.get(ChatRead, (room.id, me.user_id))
        uq = db.query(func.count()).select_from(ChatMessage).filter(
            ChatMessage.room_id == room.id,
            ChatMessage.sender_user_id.is_(None) | (ChatMessage.sender_user_id != me.user_id))
        if read is not None:
            uq = uq.filter(ChatMessage.created_at > read.last_read_at)
        unread = uq.scalar() or 0
    mine = next((m for m in members if m.user_id == me.user_id), None)
    return {
        "id": str(room.id), "kind": room.kind, "title": title, "name": room.name,
        "book_label": room.book_label, "my_access": access,
        # Firms whose people have joined: who can read this room.
        "firms": sorted({firms_by_id[m.firm_id].name for m in members if m.status == "JOINED"}),
        "members": [{"user_id": str(m.user_id), "name": names.get(m.user_id, "Unknown"),
                     "firm_name": firms_by_id[m.firm_id].name, "status": m.status, "role": m.role}
                    for m in active],
        "invited_by": names.get(mine.invited_by) if access == "INVITED" and mine and mine.invited_by else None,
        "last_message": _serialize_msg(last) if last and access != "INVITED" else None,
        "last_message_at": room.last_message_at.isoformat() if room.last_message_at else None,
        "unread": unread,
    }


@router.get("/rooms")
def rooms(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me_m, _ = _my_firm(db, user)
    _ensure_support_room(db, me_m)

    access: dict[uuid.UUID, str] = {
        m.room_id: m.status for m in db.query(ChatRoomMember).filter(
            ChatRoomMember.user_id == me_m.user_id, ChatRoomMember.status.in_(("JOINED", "INVITED")))}
    if me_m.role == "COMPLIANCE":
        for (rid,) in db.query(ChatRoomMember.room_id).filter(
                ChatRoomMember.firm_id == me_m.firm_id,
                ChatRoomMember.status.in_(("JOINED", "LEFT"))).distinct():
            access.setdefault(rid, "OBSERVER")
    if not access:
        return []

    room_rows = db.query(ChatRoom).filter(ChatRoom.id.in_(access)).all()
    all_members = db.query(ChatRoomMember).filter(ChatRoomMember.room_id.in_(access)).all()
    names = _names(db, [m.user_id for m in all_members] + [m.invited_by for m in all_members])
    firms_by_id = {f.id: f for f in db.query(Firm).all()}
    out = [_room_summary(db, r, me_m, access[r.id], firms_by_id, names) for r in room_rows]

    def order(r):
        ts = datetime.fromisoformat(r["last_message_at"]).timestamp() if r["last_message_at"] else 0
        own_support = r["kind"] == "SUPPORT" and r["my_access"] != "OBSERVER"
        # Invites first, then your support room, then most recent activity.
        return (r["my_access"] != "INVITED", not own_support, -ts)
    return sorted(out, key=order)


class OpenDirect(BaseModel):
    user_id: str


@router.post("/rooms/direct", status_code=201)
def open_direct(body: OpenDirect, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me_m, me_firm = _my_firm(db, user)
    if me_m.role == "COMPLIANCE":
        raise HTTPException(status_code=403, detail="Compliance observes chats; it doesn't start them.")
    targets = _invitable(db, [body.user_id], me_m)
    if not targets:
        raise HTTPException(status_code=422, detail="That's you.")
    other = targets[0]
    _lock(db, "direct", me_m.user_id, other.user_id)
    existing = db.execute(text("""
        SELECT r.id FROM chat_rooms r
        WHERE r.kind = 'DIRECT'
          AND EXISTS (SELECT 1 FROM chat_room_members WHERE room_id = r.id AND user_id = :a)
          AND EXISTS (SELECT 1 FROM chat_room_members WHERE room_id = r.id AND user_id = :b)
        LIMIT 1"""), {"a": me_m.user_id, "b": other.user_id}).scalar()
    if existing:
        room = db.get(ChatRoom, existing)
        _add(db, room, me_m, None)          # rejoin if you had left
        _add(db, room, other, me_m)         # re-invite if they had left or declined
        db.commit()
        return {"id": str(room.id), "created": False}

    room = ChatRoom(id=uuid.uuid4(), kind="DIRECT", created_by=me_m.user_id)
    db.add(room)
    db.flush()
    _add(db, room, me_m, None, role="OWNER")
    status = _add(db, room, other, me_m)
    names = _names(db, [me_m.user_id, other.user_id])
    other_firm = db.get(Firm, other.firm_id)
    _system(db, room, f"{names[me_m.user_id]} · {me_firm.name} started a chat with "
                      f"{names[other.user_id]} · {other_firm.name}"
                      + (" (invite pending)." if status == "INVITED" else "."))
    _mark_read(db, room.id, me_m.user_id)
    db.commit()
    return {"id": str(room.id), "created": True}


class OpenGroup(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    member_ids: list[str] = Field(default_factory=list, max_length=MAX_GROUP)
    book_node_id: Optional[str] = None


@router.post("/rooms/group", status_code=201)
def open_group(body: OpenGroup, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me_m, me_firm = _my_firm(db, user)
    if me_m.role == "COMPLIANCE":
        raise HTTPException(status_code=403, detail="Compliance observes chats; it doesn't start them.")
    targets = _invitable(db, body.member_ids, me_m)
    room = ChatRoom(id=uuid.uuid4(), kind="GROUP", name=body.name.strip(), created_by=me_m.user_id)
    if body.book_node_id:
        tag = next((b for b in books(db=db, user=user) if b["id"] == body.book_node_id), None)
        if tag is None:
            raise HTTPException(status_code=404, detail="That desk/book isn't in your firm's hierarchy.")
        room.book_node_id, room.book_label, room.book_firm_id = tag["id"], tag["label"], me_firm.id
    db.add(room)
    db.flush()
    _add(db, room, me_m, None, role="OWNER")
    names = _names(db, [me_m.user_id] + [t.user_id for t in targets])
    _system(db, room, f"{names[me_m.user_id]} · {me_firm.name} created {room.name}"
                      + (f" for {room.book_label}" if room.book_label else "") + ".")
    added = [t for t in targets if _add(db, room, t, me_m)]
    if added:
        _system(db, room, f"{names[me_m.user_id]} invited " + ", ".join(names[t.user_id] for t in added) + ".")
    _mark_read(db, room.id, me_m.user_id)
    db.commit()
    return {"id": str(room.id), "created": True}


class Invite(BaseModel):
    user_ids: list[str] = Field(min_length=1, max_length=MAX_GROUP)


@router.post("/rooms/{room_id}/invite")
def invite(room_id: str, body: Invite, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me_m, _ = _my_firm(db, user)
    room, _ = _room_for(db, room_id, me_m, ("JOINED",))
    if room.kind != "GROUP":
        raise HTTPException(status_code=422, detail="Only group rooms take more people. Start a group instead.")
    targets = _invitable(db, body.user_ids, me_m)
    # Shared trade terms are for the two parties only: no third firm joins later.
    present = {m.firm_id for m in _members(db, room.id) if m.status in ("JOINED", "INVITED")}
    if any(t.firm_id not in present for t in targets):
        from api.routes.trade_cards import room_has_trade_cards
        if room_has_trade_cards(db, room.id):
            raise HTTPException(status_code=422, detail="This room has shared trades, so it stays between its "
                                                        "current firms. Start a new room to include another firm.")
    active = sum(1 for m in _members(db, room.id) if m.status in ("JOINED", "INVITED"))
    if active + len(targets) > MAX_GROUP:
        raise HTTPException(status_code=422, detail=f"Rooms hold at most {MAX_GROUP} people.")
    added = [t for t in targets if _add(db, room, t, me_m)]
    if added:
        names = _names(db, [me_m.user_id] + [t.user_id for t in added])
        _system(db, room, f"{names[me_m.user_id]} invited " + ", ".join(names[t.user_id] for t in added) + ".")
    db.commit()
    return {"invited": [str(t.user_id) for t in added]}


def _set_status(db: Session, room: ChatRoom, me_m: FirmMember, status: str, note: str) -> None:
    m = _member(db, room.id, me_m.user_id)
    m.status = status
    if status == "JOINED":
        m.joined_at = _now()
    if status == "LEFT":
        m.left_at = _now()
    name = _names(db, [me_m.user_id])[me_m.user_id]
    _system(db, room, f"{name} · {db.get(Firm, me_m.firm_id).name} {note}.")


@router.post("/rooms/{room_id}/accept")
def accept(room_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me_m, _ = _my_firm(db, user)
    room, _ = _room_for(db, room_id, me_m, ("INVITED",))
    _set_status(db, room, me_m, "JOINED", "joined")
    _mark_read(db, room.id, me_m.user_id)
    db.commit()
    return {"id": str(room.id), "status": "JOINED"}


@router.post("/rooms/{room_id}/decline")
def decline(room_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me_m, _ = _my_firm(db, user)
    room, _ = _room_for(db, room_id, me_m, ("INVITED",))
    _set_status(db, room, me_m, "DECLINED", "declined the invite")
    db.commit()
    return {"id": str(room.id), "status": "DECLINED"}


@router.post("/rooms/{room_id}/leave")
def leave(room_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me_m, _ = _my_firm(db, user)
    room, _ = _room_for(db, room_id, me_m, ("JOINED",))
    if room.kind == "SUPPORT":
        raise HTTPException(status_code=422, detail="Your support room stays with you.")
    _set_status(db, room, me_m, "LEFT", "left")
    db.commit()
    return {"id": str(room.id), "status": "LEFT"}


@router.get("/rooms/{room_id}/messages")
def messages(room_id: str, limit: int = Query(default=200, ge=1, le=500),
             db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me_m, _ = _my_firm(db, user)
    room, _ = _room_for(db, room_id, me_m, ("JOINED", "OBSERVER"))
    rows = (db.query(ChatMessage).filter(ChatMessage.room_id == room.id)
              .order_by(ChatMessage.created_at.desc()).limit(limit).all())
    return [_serialize_msg(m) for m in reversed(rows)]


class PostMessage(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


@router.post("/rooms/{room_id}/messages", status_code=201)
def post_message(room_id: str, body: PostMessage, background: BackgroundTasks,
                 db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me_m, me_firm = _my_firm(db, user)
    room, _ = _room_for(db, room_id, me_m, ("JOINED",))
    text_ = body.body.strip()
    if not text_:
        raise HTTPException(status_code=422, detail="Empty message")
    msg = _post(db, room, kind="USER", name=_names(db, [me_m.user_id])[me_m.user_id], firm=me_firm,
                user_id=me_m.user_id, body=text_)
    _mark_read(db, room.id, me_m.user_id)
    db.commit()

    # Support rooms: Prometheus is the first responder for clients.
    # Anywhere: an explicit @prometheus.
    wants = mentions_prometheus(text_) or (room.kind == "SUPPORT" and me_firm.kind != "PLATFORM")
    if wants:
        background.add_task(_prometheus_reply, room.id)
    return {"message": _serialize_msg(msg), "prometheus_pending": wants}


def _mark_read(db: Session, room_id: uuid.UUID, user_id: uuid.UUID) -> None:
    r = db.get(ChatRead, (room_id, user_id))
    if r is None:
        db.add(ChatRead(room_id=room_id, user_id=user_id, last_read_at=_now()))
    else:
        r.last_read_at = _now()


@router.post("/rooms/{room_id}/read", status_code=204)
def mark_read(room_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me_m, _ = _my_firm(db, user)
    room, _ = _room_for(db, room_id, me_m, ("JOINED", "OBSERVER"))
    _mark_read(db, room.id, me_m.user_id)
    db.commit()


# ── Prometheus reply (background) ────────────────────────────────────────────

def _book_tag(db: Session, room: ChatRoom) -> Optional[dict]:
    if not room.book_node_id or not room.book_firm_id:
        return None
    row = db.execute(text("SELECT node_type, name FROM org_nodes WHERE id = :id"),
                     {"id": room.book_node_id}).first()
    if row is None:
        return None
    return {"firm_id": room.book_firm_id, "node_type": row.node_type.lower(), "name": row.name}


def _room_cards(db: Session, room_id: uuid.UUID) -> list[dict]:
    """Trade cards shared in this room, with each trade's current status."""
    from db.models import Trade
    out = []
    for m in db.query(ChatMessage).filter(ChatMessage.room_id == room_id,
                                          ChatMessage.card["type"].astext == "trade").all():
        c = m.card
        t = db.get(Trade, uuid.UUID(c["trade_id"]))
        out.append({"trade_ref": c.get("trade_ref"), "booked_by": c.get("booker_firm"),
                    "counterparty": c.get("cp_firm"), "terms_booker_side": c.get("summary"),
                    "trade_hash": c.get("trade_hash"), "status_now": t.status if t else "DELETED",
                    "shared_at": m.created_at})
    return out


def _prometheus_reply(room_id: uuid.UUID) -> None:
    """
    Runs after the poster's request returns; the reply reaches the room via
    realtime. No DB connection is held during the model call.
    """
    db = SessionLocal()
    try:
        room = db.get(ChatRoom, room_id)
        joined = [m for m in _members(db, room_id) if m.status == "JOINED"]
        firms = {f.id: f for f in db.query(Firm).filter(Firm.id.in_({m.firm_id for m in joined}))}
        client_firms = [f for f in firms.values() if f.kind != "PLATFORM"]
        history = [
            {"sender_kind": m.sender_kind, "sender_name": m.sender_name,
             "sender_firm": m.sender_firm, "body": m.body}
            for m in reversed(db.query(ChatMessage).filter(ChatMessage.room_id == room_id)
                                .order_by(ChatMessage.created_at.desc()).limit(40).all())
            if m.sender_kind != "SYSTEM"
        ]
        kind, book_label = room.kind, room.book_label
        firm_names = sorted(f.name for f in client_firms)
        cards = _room_cards(db, room_id)
        # Trade records only when the room's people are from exactly the two
        # parties — no third firm, and no Rijeka staff, in the room.
        shared = None
        if kind != "SUPPORT" and len(client_firms) == 2 and len(firms) == 2:
            book = _book_tag(db, room)
            pair = [f.id for f in client_firms]
            db.rollback()
            make_readonly(db)
            shared = shared_confirmations(db, pair, book)
        db.rollback()
    finally:
        db.close()

    card = None
    if not os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_API_KEY") == "PLACEHOLDER":
        body, kind_out = "Prometheus isn't configured on this server.", "SYSTEM"
    else:
        try:
            ans = answer_in_room(kind, firm_names, history, shared, book_label, cards)
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
        _post(db, room, kind=kind_out, name="Prometheus" if kind_out == "PROMETHEUS" else "Rijeka",
              firm=_platform(db), body=body, card=card)
        db.commit()
    finally:
        db.close()
