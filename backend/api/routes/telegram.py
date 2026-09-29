"""
telegram.py — bind a Rijeka room to the Telegram group two firms already use.

POST /api/telegram/rooms/{room_id}/link-code   a JOINED member gets a one-time code
GET  /api/telegram/rooms/{room_id}             is this room mirrored, and where
DELETE /api/telegram/rooms/{room_id}           stop mirroring (any JOINED member)
POST /api/telegram/webhook/{secret}            Telegram → us. Handles, in a group:
                                                 /link <code>   bind this group to the room
                                                 /unlink        remove the binding
                                                 /start, /help  what the bot does
GET  /api/telegram/status                      configured? bot username? webhook URL to set

The bot never reads the group's conversation into Rijeka. It only posts trade
cards and confirmation events outward, and reacts to its own slash commands.
See chain/telegram.py for the delivery path.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session

from db.session import get_db
from db.models import ChatRoom, ChatRoomMember, TelegramLink
from middleware.auth import verify_token
from api.routes import chat
from chain import telegram as tg

log = logging.getLogger("rijeka.telegram")
router = APIRouter(prefix="/api/telegram", tags=["telegram"])


def _joined(db: Session, room_id: str, user: dict) -> tuple[ChatRoom, ChatRoomMember]:
    """The room, if the caller is a JOINED member of it (compliance observers can't bind)."""
    try:
        rid = uuid.UUID(room_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Room not found")
    me, _ = chat._my_firm(db, user)
    room = db.get(ChatRoom, rid)
    m = db.get(ChatRoomMember, (rid, me.user_id)) if room is not None else None
    if room is None or m is None or m.status != "JOINED":
        raise HTTPException(status_code=404, detail="Room not found")
    if room.kind == "SUPPORT":
        raise HTTPException(status_code=409, detail="The Rijeka Support room can't be mirrored to Telegram.")
    return room, m


def _link_out(link: Optional[TelegramLink]) -> dict:
    if link is None:
        return {"linked": False}
    return {"linked": True, "chat_id": link.chat_id, "chat_title": link.chat_title,
            "linked_at": link.linked_at.isoformat() if link.linked_at else None,
            "last_sent_at": link.last_sent_at.isoformat() if link.last_sent_at else None}


@router.get("/status")
def status(user: dict = Depends(verify_token)):
    out = {"enabled": tg.enabled(), "public_url": tg.public_url(),
           "webhook_path": f"/api/telegram/webhook/{{TELEGRAM_WEBHOOK_SECRET}}"}
    c = tg.client()
    if c is not None:
        try:
            me = c.get_me().get("result") or {}
            out["bot_username"] = me.get("username")
        except Exception as e:  # token wrong, network down — say so, don't 500
            out["bot_error"] = str(e)[:200]
    return out


@router.post("/rooms/{room_id}/link-code", status_code=201)
def link_code(room_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    if not tg.enabled():
        raise HTTPException(status_code=503, detail="Telegram isn't configured on this Rijeka (TELEGRAM_BOT_TOKEN).")
    room, me = _joined(db, room_id, user)
    code = tg.issue_code(db, room.id, me.user_id)
    db.commit()
    bot = None
    c = tg.client()
    if c is not None:
        try:
            bot = (c.get_me().get("result") or {}).get("username")
        except Exception:
            pass
    return {"code": code, "expires_in_s": int(tg.CODE_TTL.total_seconds()), "bot_username": bot,
            "instructions": (f"Add {'@' + bot if bot else 'the Rijeka bot'} to the Telegram group you share with "
                             f"this counterparty, then post:  /link {code}")}


@router.get("/rooms/{room_id}")
def room_link(room_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    room, _ = _joined(db, room_id, user)
    return {"room_id": str(room.id), "enabled": tg.enabled(), **_link_out(db.get(TelegramLink, room.id))}


@router.delete("/rooms/{room_id}")
def unlink_room(room_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    room, me = _joined(db, room_id, user)
    link = db.get(TelegramLink, room.id)
    if link is None:
        return {"linked": False}
    chat_id, title = link.chat_id, link.chat_title
    db.delete(link)
    names = chat._names(db, [me.user_id])
    chat._system(db, room, f"{names[me.user_id]} unlinked this room from Telegram ({title or chat_id}).")
    db.commit()
    c = tg.client()
    if c is not None:
        try:
            c.send_message(chat_id, "This group is no longer linked to a Rijeka room. Nothing further will be posted here.")
        except Exception:
            log.warning("could not notify Telegram chat %s of unlink", chat_id)
    return {"linked": False}


# ── Webhook ──────────────────────────────────────────────────────────────────

HELP = ("I mirror trade confirmations from Rijeka into this group.\n"
        "In Rijeka, open the room you share with this counterparty and choose “Link Telegram” to get a code, then post:\n"
        "/link CODE\n\n"
        "I only post trade cards and on-chain confirmation events, with a link to review and countersign in Rijeka. "
        "I don't read this group's conversation.\n"
        "/unlink removes the binding.")


def _text(update: dict) -> tuple[Optional[dict], str]:
    msg = update.get("message") or update.get("edited_message") or {}
    return msg, (msg.get("text") or "").strip()


@router.post("/webhook/{secret}")
async def webhook(secret: str, request: Request, db: Session = Depends(get_db),
                  x_telegram_bot_api_secret_token: Optional[str] = Header(None)):
    expected = tg.webhook_secret()
    # Both the path and Telegram's header must match: the path stops random
    # posts, the header stops anyone who learned the path.
    if not expected or secret != expected or x_telegram_bot_api_secret_token != expected:
        raise HTTPException(status_code=403, detail="bad webhook secret")
    update = await request.json()
    msg, text = _text(update)
    if not msg or not text.startswith("/"):
        return {"ok": True}          # not a command: ignored, never stored
    chat_obj = msg.get("chat") or {}
    chat_id = str(chat_obj.get("id"))
    title = chat_obj.get("title") or (chat_obj.get("username") and "@" + chat_obj["username"])
    cmd, _, arg = text.partition(" ")
    cmd = cmd.split("@", 1)[0].lower()   # "/link@RijekaBot" → "/link"
    c = tg.client()

    def reply(t: str):
        if c is not None:
            try:
                c.send_message(chat_id, t)
            except Exception:
                log.warning("reply to %s failed", chat_id)

    if cmd in ("/start", "/help"):
        reply(HELP)
    elif cmd == "/link":
        if chat_obj.get("type") not in ("group", "supergroup"):
            reply("Post /link inside the group you share with the counterparty, not in a private chat.")
            return {"ok": True}
        try:
            link = tg.redeem_code(db, arg, chat_id, title)
            room = db.get(ChatRoom, link.room_id)
            chat._system(db, room, f"Linked to Telegram group “{title or chat_id}”. Trade cards and confirmations "
                                   f"will be mirrored there with a link back here.")
            db.commit()
            reply(f"Linked. Trade confirmations from this Rijeka room will appear here. Review and sign at {tg.public_url()}/messenger?room={link.room_id}")
        except ValueError as e:
            db.rollback(); reply(str(e))
    elif cmd == "/unlink":
        link = db.query(TelegramLink).filter(TelegramLink.chat_id == chat_id).first()
        if link is None:
            reply("This group isn't linked to a Rijeka room.")
        else:
            room = db.get(ChatRoom, link.room_id)
            db.delete(link)
            chat._system(db, room, f"Telegram group “{title or chat_id}” unlinked from this room (from Telegram).")
            db.commit()
            reply("Unlinked. Nothing further will be posted here.")
    return {"ok": True}
