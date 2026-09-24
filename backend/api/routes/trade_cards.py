"""
trade_cards.py — trades shared into chat rooms, and countersigned from there.

A trade card is a chat message carrying one trade's canonical record: the
exact terms the two parties sign (economics + both LEIs; no book, desk or
strategy). Only the booking firm can share it, and only into a room whose
people come from exactly the two parties.

The counterparty reviews the terms from their side, sees whether they match
a booking in their own book, and countersigns with THEIR wallet. Rijeka never
holds that key: a firm admin registers the wallet's address by signing a
challenge with it, and the countersignature must recover to that address.

GET  /api/chat/signer                     your firm's LEIs and registered signing addresses
POST /api/chat/signer/challenge           text to sign with the wallet being registered
POST /api/chat/signer                     {address, message, signature}: register (firm ADMIN)
GET  /api/chat/rooms/{id}/shareable-trades  your trades you could share into this room
POST /api/chat/rooms/{id}/trades          {trade_id}: share a trade card (idempotent per room)
GET  /api/chat/trades/{id}/send-status    from the trade window: can it go to the counterparty, and where it already went
POST /api/chat/trades/{id}/send           send it: reuse your room with that firm (or open one) and post the card once
GET  /api/chat/cards/{message_id}         live card state, from the viewer's side
POST /api/chat/cards/{message_id}/countersign  {address, signature, trade_hash}
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import is_address, to_checksum_address
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.routes import chat
from api.routes.chain import (
    _canonical_for, _eip712_ctx, _hexb, _latest_confirmed_event, _resolve_parties,
    countersign_trade, registered_signer,
)
from chain.signing import confirmation_typed_data, eip712_digest, sign
from db.models import (
    ChatMessage, ChatRoom, ChatRoomMember, Counterparty, Firm, FirmLei, FirmMember,
    LegalEntity, Trade, TradeLeg,
)
from db.session import get_db
from middleware.auth import verify_token

log = logging.getLogger("rijeka.cards")
router = APIRouter(prefix="/api/chat", tags=["chat"])

CHALLENGE_PREFIX = "Rijeka: register signing wallet"
CHALLENGE_TTL_S = 600


# ── Parties ──────────────────────────────────────────────────────────────────

def _cp_lei(db: Session, trade: Trade) -> Optional[str]:
    cp = db.get(Counterparty, trade.counterparty_id) if trade.counterparty_id else None
    if cp is None or cp.legal_entity_id is None:
        return None
    le = db.get(LegalEntity, cp.legal_entity_id)
    return le.lei if le else None


def _firm_of_lei(db: Session, lei: Optional[str]) -> Optional[Firm]:
    claim = db.get(FirmLei, lei) if lei else None
    return db.get(Firm, claim.firm_id) if claim else None


def _firm_of_user(db: Session, user_id) -> Optional[Firm]:
    m = db.query(FirmMember).filter(FirmMember.user_id == user_id).first()
    return db.get(Firm, m.firm_id) if m else None


def _room_firm_ids(db: Session, room_id) -> set:
    """Firms of the people in the room or invited to it: an invite still means the room is theirs."""
    return {m.firm_id for m in db.query(ChatRoomMember).filter(
        ChatRoomMember.room_id == room_id, ChatRoomMember.status.in_(("JOINED", "INVITED")))}


def room_has_trade_cards(db: Session, room_id) -> bool:
    return db.query(ChatMessage.id).filter(
        ChatMessage.room_id == room_id, ChatMessage.card["type"].astext == "trade").first() is not None


# ── Canonical record → what a person reads ──────────────────────────────────

def _pct(x) -> Optional[str]:
    try:
        return f"{float(x) * 100:.6f}".rstrip("0").rstrip(".") + "%"
    except (TypeError, ValueError):
        return None


def _flip(direction: Optional[str]) -> Optional[str]:
    return {"PAY": "RECEIVE", "RECEIVE": "PAY"}.get((direction or "").upper(), direction)


def summarise(payload: dict, *, for_counterparty: bool) -> dict:
    """The signed terms, phrased from one side. Directions are the booker's in
    the record; the counterparty's are the opposite."""
    t, parties = payload["trade"], payload["parties"]
    legs = []
    for l in payload["legs"]:
        d = _flip(l.get("direction")) if for_counterparty else l.get("direction")
        fixed = (l.get("leg_type") or "").upper() == "FIXED"
        spread_bp = None
        try:
            spread_bp = round(float(l.get("spread") or 0) * 10000, 4)
        except (TypeError, ValueError):
            pass
        legs.append({
            "leg_type": l.get("leg_type"), "you": d, "currency": l.get("currency"),
            "notional": l.get("notional"),
            "rate": _pct(l.get("fixed_rate")) if fixed else None,
            "index": None if fixed else (l.get("forecast_curve_id") or (t.get("terms") or {}).get("float_index")),
            "spread_bp": None if fixed else spread_bp,
            "day_count": l.get("day_count"), "frequency": l.get("payment_frequency"),
            "reset": l.get("reset_frequency"),
        })
    you, them = (parties["counterparty"], parties["own"]) if for_counterparty else (parties["own"], parties["counterparty"])
    return {
        "instrument": t.get("instrument_type"), "structure": t.get("structure"),
        "notional": t.get("notional"), "ccy": t.get("notional_ccy"),
        "trade_date": t.get("trade_date"), "effective_date": t.get("effective_date"),
        "maturity_date": t.get("maturity_date"), "legs": legs,
        "you": you, "them": them,
    }


# Economic fields compared between the two sides' bookings. Refs are each
# side's own, so they are left out; directions are compared flipped.
_TRADE_MATCH = ("instrument_type", "structure", "notional", "notional_ccy",
                "trade_date", "effective_date", "maturity_date")
_LEG_MATCH = ("notional", "fixed_rate", "spread", "day_count", "payment_frequency",
              "reset_frequency", "bdc", "forecast_curve_id")


def compare(shared: dict, theirs: dict) -> list[dict]:
    """Breaks between the shared record and the counterparty's own booking of it."""
    breaks = []
    for f in _TRADE_MATCH:
        a, b = shared["trade"].get(f), theirs["trade"].get(f)
        if a != b:
            breaks.append({"field": f, "shared": a, "yours": b})
    sp, tp = shared["parties"], theirs["parties"]
    if (tp["own"].get("lei"), tp["counterparty"].get("lei")) != (sp["counterparty"].get("lei"), sp["own"].get("lei")):
        breaks.append({"field": "parties", "shared": f"{sp['own'].get('lei')} vs {sp['counterparty'].get('lei')}",
                       "yours": f"{tp['counterparty'].get('lei')} vs {tp['own'].get('lei')}"})
    by_key = {((l.get("leg_type") or "").upper(), l.get("currency")): l for l in theirs["legs"]}
    for l in shared["legs"]:
        key = ((l.get("leg_type") or "").upper(), l.get("currency"))
        mine = by_key.get(key)
        name = f"{key[0]} leg"
        if mine is None:
            breaks.append({"field": name, "shared": "present", "yours": "missing"})
            continue
        if _flip(l.get("direction")) != (mine.get("direction") or "").upper():
            breaks.append({"field": f"{name} direction", "shared": _flip(l.get("direction")), "yours": mine.get("direction")})
        for f in _LEG_MATCH:
            if (l.get(f) or None) != (mine.get(f) or None):
                breaks.append({"field": f"{name} {f}", "shared": l.get(f), "yours": mine.get(f)})
    return breaks


def _match_in_book(db: Session, shared: dict, cp_firm: Firm, booker_firm: Firm) -> dict:
    """
    Look for the counterparty's own booking of this trade: trades booked by
    their people against the booker's LEIs. Best candidate's breaks, if any.
    """
    members = [m.user_id for m in db.query(FirmMember).filter(FirmMember.firm_id == cp_firm.id)]
    booker_leis = {l.lei for l in db.query(FirmLei).filter(FirmLei.firm_id == booker_firm.id)}
    if not members:
        return {"status": "NO_BOOKING"}
    best = None
    for t in db.query(Trade).filter(Trade.user_id.in_(members), Trade.status != "CANCELLED").all():
        if _cp_lei(db, t) not in booker_leis:
            continue
        try:
            theirs, _ = _canonical_for(db, t)
        except HTTPException:
            continue
        b = compare(shared, theirs)
        if best is None or len(b) < len(best[1]):
            best = (t, b)
    if best is None:
        return {"status": "NO_BOOKING"}
    t, b = best
    return {"status": "MATCH" if not b else "BREAKS", "trade_ref": t.trade_ref, "breaks": b}


# ── Signing wallet registration ──────────────────────────────────────────────

@router.get("/signer")
def signer(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me, firm = chat._my_firm(db, user)
    leis = db.query(FirmLei).filter(FirmLei.firm_id == firm.id).all()
    return {"firm": firm.name, "can_register": me.role == "ADMIN",
            "leis": [{"lei": l.lei, "signing_address": l.signing_address,
                      "set_at": l.signer_set_at.isoformat() if l.signer_set_at else None} for l in leis]}


class ChallengeBody(BaseModel):
    address: str


def _challenge_text(firm: Firm, leis: list[str], address: str, ts: int) -> str:
    return (f"{CHALLENGE_PREFIX}\n\nFirm: {firm.name}\nLEI: {', '.join(leis)}\n"
            f"Address: {address}\nIssued: {ts}\n\n"
            "Signing this proves you control this wallet. It does not move funds or cost gas.")


@router.post("/signer/challenge")
def signer_challenge(body: ChallengeBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me, firm = chat._my_firm(db, user)
    if me.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Only a firm admin can register the signing wallet.")
    if not is_address(body.address):
        raise HTTPException(status_code=422, detail="Not an Ethereum address.")
    leis = sorted(l.lei for l in db.query(FirmLei).filter(FirmLei.firm_id == firm.id))
    if not leis:
        raise HTTPException(status_code=422, detail="Your firm hasn't claimed an LEI yet.")
    ts = int(datetime.now(timezone.utc).timestamp())
    return {"message": _challenge_text(firm, leis, to_checksum_address(body.address), ts)}


class RegisterBody(BaseModel):
    address: str
    message: str = Field(max_length=2000)
    signature: str


@router.post("/signer")
def register_signer(body: RegisterBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me, firm = chat._my_firm(db, user)
    if me.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Only a firm admin can register the signing wallet.")
    if not is_address(body.address):
        raise HTTPException(status_code=422, detail="Not an Ethereum address.")
    address = to_checksum_address(body.address)
    leis = sorted(l.lei for l in db.query(FirmLei).filter(FirmLei.firm_id == firm.id))
    # The message must be the one we'd issue for this firm and address, recently.
    try:
        ts = int(body.message.rsplit("Issued: ", 1)[1].split("\n", 1)[0])
    except (IndexError, ValueError):
        raise HTTPException(status_code=422, detail="That isn't a Rijeka registration challenge.")
    if body.message != _challenge_text(firm, leis, address, ts):
        raise HTTPException(status_code=422, detail="The challenge doesn't match this firm and address. Request a new one.")
    if abs(datetime.now(timezone.utc).timestamp() - ts) > CHALLENGE_TTL_S:
        raise HTTPException(status_code=422, detail="The challenge expired. Request a new one.")
    try:
        recovered = Account.recover_message(encode_defunct(text=body.message), signature=body.signature)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Signature could not be recovered: {e}")
    if recovered.lower() != address.lower():
        raise HTTPException(status_code=422, detail=f"Signed by {recovered}, not {address}.")
    now = datetime.now(timezone.utc)
    for l in db.query(FirmLei).filter(FirmLei.firm_id == firm.id):
        l.signing_address, l.signer_set_at, l.signer_set_by = address, now, me.user_id
    db.commit()
    return {"address": address, "leis": leis}


# ── Sharing ──────────────────────────────────────────────────────────────────

def _shareable(db: Session, room: ChatRoom, me: FirmMember) -> tuple[Optional[Firm], list[Trade]]:
    """The other firm, and my trades with it, if this room is exactly my firm + one other."""
    firms = _room_firm_ids(db, room.id)
    others = firms - {me.firm_id}
    if room.kind == "SUPPORT" or len(others) != 1 or me.firm_id not in firms:
        return None, []
    other = db.get(Firm, next(iter(others)))
    if other.kind == "PLATFORM":
        return None, []
    other_leis = {l.lei for l in db.query(FirmLei).filter(FirmLei.firm_id == other.id)}
    trades = [t for t in db.query(Trade).filter(Trade.user_id == me.user_id, Trade.status != "CANCELLED")
                             .order_by(Trade.created_at.desc()).all()
              if _cp_lei(db, t) in other_leis]
    return other, trades


@router.get("/rooms/{room_id}/shareable-trades")
def shareable_trades(room_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me, _ = chat._my_firm(db, user)
    room, _ = chat._room_for(db, room_id, me, ("JOINED",))
    other, trades = _shareable(db, room, me)
    if other is None:
        raise HTTPException(status_code=422,
            detail="Trades can be shared only in a room whose people are from your firm and that trade's counterparty.")
    return {"counterparty": other.name, "trades": [
        {"id": str(t.id), "trade_ref": t.trade_ref, "status": t.status, "instrument": t.instrument_type,
         "notional": float(t.notional) if t.notional is not None else None, "ccy": t.notional_ccy,
         "maturity_date": t.maturity_date.isoformat() if t.maturity_date else None}
        for t in trades]}


class ShareBody(BaseModel):
    trade_id: str


def _existing_card(db: Session, room_id, trade_id) -> Optional[ChatMessage]:
    return (db.query(ChatMessage)
              .filter(ChatMessage.room_id == room_id, ChatMessage.card["type"].astext == "trade",
                      ChatMessage.card["trade_id"].astext == str(trade_id))
              .order_by(ChatMessage.created_at).first())


def _post_card(db: Session, room: ChatRoom, me: FirmMember, my_firm: Firm, other: Firm, trade: Trade) -> tuple[ChatMessage, bool]:
    """Post the trade's card in this room, once. Returns (message, already_there)."""
    existing = _existing_card(db, room.id, trade.id)
    if existing is not None:
        return existing, True
    try:
        payload, h = _canonical_for(db, trade)
    except HTTPException as e:
        raise HTTPException(status_code=422, detail=e.detail)
    card = {
        "type": "trade", "trade_id": str(trade.id), "trade_ref": trade.trade_ref,
        "booker_firm_id": str(my_firm.id), "booker_firm": my_firm.name,
        "cp_firm_id": str(other.id), "cp_firm": other.name,
        "trade_hash": _hexb(h), "status_at_share": trade.status,
        "summary": summarise(payload, for_counterparty=False),   # booker's side; viewers get their own via GET
    }
    names = chat._names(db, [me.user_id])
    msg = chat._post(db, room, kind="USER", name=names[me.user_id], firm=my_firm, user_id=me.user_id,
                     body=f"Shared {trade.trade_ref} for confirmation.", card=card)
    chat._mark_read(db, room.id, me.user_id)
    db.commit()
    return msg, False


@router.post("/rooms/{room_id}/trades", status_code=201)
def share_trade(room_id: str, body: ShareBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me, my_firm = chat._my_firm(db, user)
    room, _ = chat._room_for(db, room_id, me, ("JOINED",))
    other, trades = _shareable(db, room, me)
    trade = next((t for t in trades if str(t.id) == body.trade_id), None)
    if other is None or trade is None:
        raise HTTPException(status_code=404, detail="That trade can't be shared in this room.")
    msg, already = _post_card(db, room, me, my_firm, other, trade)
    return {"message": chat._serialize_msg(msg), "already_shared": already}


# ── From the trade window ───────────────────────────────────────────────────

def _my_trade(db: Session, trade_id: str, me: FirmMember) -> Trade:
    try:
        tid = uuid.UUID(trade_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Trade not found")
    trade = db.query(Trade).filter(Trade.id == tid, Trade.user_id == me.user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return trade


def _cp_people(db: Session, firm: Firm) -> list[FirmMember]:
    return db.query(FirmMember).filter(FirmMember.firm_id == firm.id, FirmMember.role != "COMPLIANCE").all()


def _pair_rooms(db: Session, me: FirmMember, other: Firm) -> list[ChatRoom]:
    """Your rooms whose people are exactly your firm and this one, most recent activity first."""
    mine = [m.room_id for m in db.query(ChatRoomMember).filter(
        ChatRoomMember.user_id == me.user_id, ChatRoomMember.status == "JOINED")]
    rooms = [r for r in db.query(ChatRoom).filter(ChatRoom.id.in_(mine), ChatRoom.kind != "SUPPORT").all()
             if _room_firm_ids(db, r.id) == {me.firm_id, other.id}] if mine else []
    return sorted(rooms, key=lambda r: r.last_message_at or r.created_at, reverse=True)


def _room_title(db: Session, room: ChatRoom, other: Firm) -> str:
    return room.name or other.name


@router.get("/trades/{trade_id}/send-status")
def send_status(trade_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me, my_firm = chat._my_firm(db, user)
    trade = _my_trade(db, trade_id, me)
    lei = _cp_lei(db, trade)
    other = _firm_of_lei(db, lei)
    people = _cp_people(db, other) if other else []
    sent = []
    for room in (_pair_rooms(db, me, other) if other else []):
        m = _existing_card(db, room.id, trade.id)
        if m is not None:
            sent.append({"room_id": str(room.id), "message_id": str(m.id), "room_title": _room_title(db, room, other)})
    reason = None
    if trade.status != "PENDING":
        reason = f"{trade.trade_ref} is {trade.status}."
    elif other is None:
        reason = "This counterparty isn't on Rijeka yet."
    elif not people:
        reason = f"Nobody from {other.name} is on Rijeka yet."
    return {
        "trade_id": str(trade.id), "trade_ref": trade.trade_ref, "status": trade.status,
        "counterparty": {"name": other.name if other else None, "lei": lei, "on_network": bool(people),
                         "has_signer": bool(registered_signer(db, lei))},
        "sent": sent, "can_send": reason is None, "reason": reason,
    }


@router.post("/trades/{trade_id}/send", status_code=201)
def send_trade(trade_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """
    Send a pending trade to its counterparty for countersignature: into your
    most recent room with exactly that firm, or a new one (a direct chat when
    they have one person on Rijeka, a group otherwise). Posts the card once;
    sending again returns the card already there.
    """
    me, my_firm = chat._my_firm(db, user)
    if me.role == "COMPLIANCE":
        raise HTTPException(status_code=403, detail="Compliance observes chats; it doesn't send trades.")
    trade = _my_trade(db, trade_id, me)
    st = send_status(trade_id, db=db, user=user)
    if not st["can_send"]:
        raise HTTPException(status_code=409, detail=st["reason"])
    other = _firm_of_lei(db, st["counterparty"]["lei"])

    rooms = _pair_rooms(db, me, other)
    room = next((r for r in rooms if _existing_card(db, r.id, trade.id) is not None), None) or (rooms[0] if rooms else None)
    created = False
    if room is None:
        people = _cp_people(db, other)
        if len(people) == 1:
            rid = chat.open_direct(chat.OpenDirect(user_id=str(people[0].user_id)), db=db, user=user)["id"]
        else:
            rid = chat.open_group(chat.OpenGroup(name=f"{my_firm.name} / {other.name}",
                                                 member_ids=[str(p.user_id) for p in people]), db=db, user=user)["id"]
        room, created = db.get(ChatRoom, uuid.UUID(rid)), True
    msg, already = _post_card(db, room, me, my_firm, other, trade)
    return {"room_id": str(room.id), "message_id": str(msg.id), "room_title": _room_title(db, room, other),
            "already_sent": already, "created_room": created}


# ── Card state and countersign ───────────────────────────────────────────────

def _card_context(db: Session, message_id: str, user: dict):
    me, my_firm = chat._my_firm(db, user)
    try:
        mid = uuid.UUID(message_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Card not found")
    msg = db.get(ChatMessage, mid)
    if msg is None or not msg.card or msg.card.get("type") != "trade":
        raise HTTPException(status_code=404, detail="Card not found")
    room, access = chat._room_for(db, str(msg.room_id), me, ("JOINED", "OBSERVER"))
    card = msg.card
    side = ("BOOKER" if str(my_firm.id) == card["booker_firm_id"]
            else "COUNTERPARTY" if str(my_firm.id) == card["cp_firm_id"] else None)
    if side is None:
        raise HTTPException(status_code=403, detail="Only the two parties to this trade can see its details.")
    trade = db.get(Trade, uuid.UUID(card["trade_id"]))
    if trade is None:
        raise HTTPException(status_code=404, detail="The trade behind this card no longer exists.")
    return me, my_firm, room, access, msg, card, side, trade


@router.get("/cards/{message_id}")
def card_state(message_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    me, my_firm, room, access, msg, card, side, trade = _card_context(db, message_id, user)
    payload, h = _canonical_for(db, trade)
    current = _hexb(h)
    out = {
        "trade_ref": trade.trade_ref, "side": side, "status": trade.status,
        "booker_firm": card["booker_firm"], "cp_firm": card["cp_firm"],
        "shared_hash": card["trade_hash"], "current_hash": current,
        "changed_since_shared": current != card["trade_hash"],
        "summary": summarise(payload, for_counterparty=side == "COUNTERPARTY"),
        "can_act": access == "JOINED",
    }
    ev = _latest_confirmed_event(db, trade.id)
    att = (ev.payload or {}).get("attestation") if ev else None
    if att:
        a = att.get("anchor") or {}
        out["confirmation"] = {"trade_hash": att.get("trade_hash"), "chain_id": a.get("chain_id"),
                               "block_number": a.get("block_number"), "tx_hash": a.get("tx_hash"),
                               "explorer_tx": a.get("explorer_tx"), "anchored": a.get("anchored"),
                               "bilateral": att.get("bilateral", False)}
    if side == "COUNTERPARTY" and trade.status == "PENDING":
        cp_firm = db.get(Firm, uuid.UUID(card["cp_firm_id"]))
        booker_firm = db.get(Firm, uuid.UUID(card["booker_firm_id"]))
        out["match"] = _match_in_book(db, payload, cp_firm, booker_firm)
        cp_lei = _cp_lei(db, trade)
        reg = registered_signer(db, cp_lei)
        out["signing"] = {"lei": cp_lei, "registered_address": reg.address if reg else None,
                          "can_register": me.role == "ADMIN"}
        if reg:
            k_own, k_cp, own_id, cp_id = _resolve_parties(db, trade)
            be, chain_id, registry = _eip712_ctx()
            td_cp = confirmation_typed_data(chain_id, registry, h, k_own.address)
            td_own = confirmation_typed_data(chain_id, registry, h, k_cp.address)
            out["signing"].update({
                "chain_id": chain_id,
                # eth_signTypedData_v4 wants bytes32 as hex.
                "typed_data": {**td_cp, "message": {**td_cp["message"], "tradeHash": current}},
                "digest": _hexb(eip712_digest(td_cp)),
                # The same request the command-line tool reads (chain/tools/countersign.py).
                "request": {
                    "format": "rijeka-confirmation-request", "format_version": 1,
                    "trade_ref": trade.trade_ref, "trade_id": str(trade.id),
                    "canonical": payload, "trade_hash": current,
                    "eip712": {"name": "Rijeka Trade Confirmation", "version": "1",
                               "chain_id": chain_id, "verifying_contract": registry},
                    "from": {"lei": k_own.lei, "name": own_id.get("name"), "address": k_own.address,
                             "signature": _hexb(sign(td_own, k_own.private_key))},
                    "to": {"lei": k_cp.lei, "name": cp_id.get("name"), "address": k_cp.address,
                           "digest_to_sign": _hexb(eip712_digest(td_cp)), "can_sign_locally": False},
                },
            })
    return out


class CountersignBody(BaseModel):
    address: str
    signature: str
    trade_hash: str


@router.post("/cards/{message_id}/countersign", status_code=201)
def card_countersign(message_id: str, body: CountersignBody, db: Session = Depends(get_db),
                     user: dict = Depends(verify_token)):
    me, my_firm, room, access, msg, card, side, trade = _card_context(db, message_id, user)
    if side != "COUNTERPARTY" or access != "JOINED":
        raise HTTPException(status_code=403, detail="Only the counterparty's people in this room can countersign.")
    if trade.status != "PENDING":
        raise HTTPException(status_code=409, detail=f"{trade.trade_ref} is {trade.status}, not awaiting confirmation.")
    if registered_signer(db, _cp_lei(db, trade)) is None:
        raise HTTPException(status_code=409, detail="Your firm hasn't registered a signing wallet yet.")
    countersign_trade(db, trade, body.address, body.signature, expected_hash=body.trade_hash,
                      note={"channel": "chat", "room_id": str(room.id), "user_id": str(me.user_id)})

    # countersign_trade committed the CONFIRMED event; tell the room.
    db.expire_all()
    ev = _latest_confirmed_event(db, trade.id)
    a = ((ev.payload or {}).get("attestation") or {}).get("anchor") or {}
    room = db.get(ChatRoom, room.id)
    where = (f"block {a.get('block_number'):,}" if a.get("block_number") else "the registry")
    names = chat._names(db, [me.user_id])
    chat._post(db, room, kind="SYSTEM", name="Rijeka",
               body=f"✓ {trade.trade_ref} confirmed on-chain — countersigned by {names[me.user_id]} · "
                    f"{my_firm.name}, anchored at {where}.",
               card={"type": "trade_event", "trade_id": str(trade.id), "status": "CONFIRMED",
                     "card_message_id": str(msg.id), "explorer_tx": a.get("explorer_tx")})
    db.commit()
    return {"status": "CONFIRMED", "block_number": a.get("block_number"), "explorer_tx": a.get("explorer_tx")}
