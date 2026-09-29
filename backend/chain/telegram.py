"""
Telegram channel adapter — transport only.

Crypto OTC desks agree bilateral trades in Telegram groups and "confirm"
them there by hand. Rather than move them, a Rijeka room can mirror its
trade cards and confirmation events into the ONE group the two firms
already use, each carrying a link back to Rijeka to review the terms and
countersign with the firm's wallet.

Nothing depends on Telegram. The canonical record, the hash, both
signatures and the registry entry live in Rijeka and on-chain; if the bot
is down or the group is deleted every confirmation still stands and still
verifies. Only trade cards and lifecycle events are mirrored — never the
free-text chat, which stays in Rijeka under its own access rules.

Delivery is an after-commit outbox: chat._post appends the message id to
session.info; the listener below drains it only once the transaction that
created the message has committed, in a background thread, best effort.

Environment
  TELEGRAM_BOT_TOKEN        from @BotFather (the user creates the bot)
  TELEGRAM_WEBHOOK_SECRET   random string; also sent by Telegram in the
                            X-Telegram-Bot-Api-Secret-Token header
  RIJEKA_PUBLIC_URL         base URL the deep links point at
"""

from __future__ import annotations

import logging
import os
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlalchemy import event
from sqlalchemy.orm import Session

log = logging.getLogger("rijeka.telegram")

CODE_TTL = timedelta(minutes=10)
OUTBOX_KEY = "telegram_outbox"
MIRRORED_CARD_TYPES = ("trade", "trade_event")


# ── Configuration ────────────────────────────────────────────────────────────

def bot_token() -> Optional[str]:
    return os.getenv("TELEGRAM_BOT_TOKEN") or None


def webhook_secret() -> Optional[str]:
    return os.getenv("TELEGRAM_WEBHOOK_SECRET") or None


def public_url() -> str:
    return (os.getenv("RIJEKA_PUBLIC_URL") or "http://localhost:5173").rstrip("/")


def enabled() -> bool:
    return bool(bot_token())


def deep_link(room_id, message_id=None) -> str:
    url = f"{public_url()}/messenger?room={room_id}"
    return url + (f"&card={message_id}" if message_id else "")


# ── Bot API client (thin; injectable for tests) ──────────────────────────────

class BotClient:
    def __init__(self, token: str, timeout: float = 15.0):
        self.base = f"https://api.telegram.org/bot{token}"
        self.timeout = timeout

    def send_message(self, chat_id: str, text: str, *, disable_preview: bool = True) -> dict:
        r = httpx.post(f"{self.base}/sendMessage", timeout=self.timeout, json={
            "chat_id": chat_id, "text": text, "parse_mode": "HTML",
            "disable_web_page_preview": disable_preview,
        })
        r.raise_for_status()
        return r.json()

    def set_webhook(self, url: str, secret: str) -> dict:
        r = httpx.post(f"{self.base}/setWebhook", timeout=self.timeout,
                       json={"url": url, "secret_token": secret, "allowed_updates": ["message"]})
        r.raise_for_status()
        return r.json()

    def get_me(self) -> dict:
        r = httpx.get(f"{self.base}/getMe", timeout=self.timeout)
        r.raise_for_status()
        return r.json()


_client: Optional[BotClient] = None


def client() -> Optional[BotClient]:
    """Process-wide client, or None when no token is configured."""
    global _client
    tok = bot_token()
    if not tok:
        return None
    if _client is None:
        _client = BotClient(tok)
    return _client


def set_client(c: Optional[BotClient]) -> None:
    """Tests inject a fake sender."""
    global _client
    _client = c


# ── Rendering ────────────────────────────────────────────────────────────────

def _esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _short(h: Optional[str], n: int = 10) -> str:
    return (h[:n] + "…" + h[-6:]) if h and len(h) > n + 7 else (h or "—")


def render_card(card: dict, room_id, message_id) -> Optional[str]:
    """
    HTML text for a mirrored message, or None if this card kind is not mirrored.
    Terms are rendered from the booker's summary as shared; each side reviews
    its own view in Rijeka before signing.
    """
    kind = card.get("type")
    if kind == "trade":
        s = card.get("summary") or {}
        legs = s.get("legs") or []
        lines = [f"<b>Trade for confirmation · {_esc(card.get('trade_ref'))}</b>",
                 f"{_esc(card.get('booker_firm'))} → {_esc(card.get('cp_firm'))}",
                 f"{_esc(s.get('instrument'))}{(' · ' + _esc(s.get('structure'))) if s.get('structure') else ''}"
                 f" · {_esc(s.get('notional'))} {_esc(s.get('ccy'))}",
                 f"{_esc(s.get('effective_date'))} → {_esc(s.get('maturity_date'))}"]
        for l in legs[:4]:
            bits = [str(l.get("leg_type") or "")]
            if l.get("rate") is not None:        bits.append(f"{l['rate']}")
            if l.get("index"):                    bits.append(str(l["index"]))
            if l.get("spread_bp") not in (None, "", 0, "0"): bits.append(f"{l['spread_bp']}bp")
            if l.get("frequency"):                bits.append(str(l["frequency"]))
            if l.get("day_count"):                bits.append(str(l["day_count"]))
            lines.append("  • " + _esc(" · ".join(b for b in bits if b)))
        lines += [f"UTI <code>{_esc(card.get('uti'))}</code>" if card.get("uti") else "",
                  f"hash <code>{_esc(_short(card.get('trade_hash')))}</code> · record v{_esc(card.get('schema_version', 1))}",
                  "",
                  f'<a href="{_esc(deep_link(room_id, message_id))}">Review the terms from your side and countersign with your firm\'s wallet</a>']
        return "\n".join(x for x in lines if x is not None)

    if kind == "trade_event":
        status = card.get("status")
        head = {"CONFIRMED": "✓ Confirmed on-chain", "TERMINATED": "■ Terminated on-chain",
                "AMENDED": "✎ Amended on-chain"}.get(status, status or "Update")
        lines = [f"<b>{_esc(head)}</b>"]
        if card.get("body"):
            lines.append(_esc(card["body"]))
        if card.get("explorer_tx"):
            lines.append(f'<a href="{_esc(card["explorer_tx"])}">View the transaction</a>')
        lines.append(f'<a href="{_esc(deep_link(room_id, card.get("card_message_id") or message_id))}">Open in Rijeka</a>')
        return "\n".join(lines)

    return None


# ── Link codes ───────────────────────────────────────────────────────────────

def new_code() -> str:
    # 8 chars, unambiguous alphabet, typed by a human into a chat
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


def issue_code(db: Session, room_id: uuid.UUID, user_id: uuid.UUID) -> str:
    from db.models import TelegramLinkCode
    code = new_code()
    db.add(TelegramLinkCode(code=code, room_id=room_id, user_id=user_id,
                            expires_at=datetime.now(timezone.utc) + CODE_TTL))
    return code


def redeem_code(db: Session, code: str, chat_id: str, chat_title: Optional[str]):
    """
    Bind the room the code was issued for to this Telegram chat. Returns the
    TelegramLink, or raises ValueError with a message the bot can reply with.
    """
    from db.models import TelegramLinkCode, TelegramLink
    row = db.get(TelegramLinkCode, code.strip().upper())
    now = datetime.now(timezone.utc)
    if row is None:
        raise ValueError("That code isn't one Rijeka issued. Ask for a new one from the room in Rijeka.")
    if row.used_at is not None:
        raise ValueError("That code was already used.")
    if row.expires_at < now:
        raise ValueError("That code expired (they last 10 minutes). Ask for a new one.")
    existing_for_chat = db.query(TelegramLink).filter(TelegramLink.chat_id == str(chat_id)).first()
    if existing_for_chat is not None and existing_for_chat.room_id != row.room_id:
        raise ValueError("This Telegram group is already linked to a different Rijeka room. Unlink it there first.")
    link = db.get(TelegramLink, row.room_id)
    if link is None:
        link = TelegramLink(room_id=row.room_id, chat_id=str(chat_id), chat_title=chat_title, linked_by=row.user_id)
        db.add(link)
    else:
        link.chat_id, link.chat_title, link.linked_by, link.linked_at = str(chat_id), chat_title, row.user_id, now
    row.used_at = now
    return link


# ── Outbox: deliver only after the creating transaction commits ─────────────

def enqueue(db: Session, message_id: uuid.UUID) -> None:
    """Called by chat._post. Costs nothing when Telegram is not configured."""
    if not enabled():
        return
    db.info.setdefault(OUTBOX_KEY, []).append(message_id)


def deliver(message_id: uuid.UUID, *, sender: Optional[BotClient] = None) -> bool:
    """
    Mirror one committed message to its room's linked Telegram chat, if any.
    Returns True if something was sent. Runs in its own short session.
    """
    from db.session import SessionLocal
    from db.models import ChatMessage, TelegramLink
    c = sender or client()
    if c is None:
        return False
    db = SessionLocal()
    try:
        msg = db.get(ChatMessage, message_id)
        if msg is None or not msg.card or msg.card.get("type") not in MIRRORED_CARD_TYPES:
            return False
        link = db.get(TelegramLink, msg.room_id)
        if link is None:
            return False
        text = render_card(dict(msg.card, body=msg.body if msg.card.get("type") == "trade_event" else None),
                           msg.room_id, msg.id)
        if not text:
            return False
        c.send_message(link.chat_id, text)
        link.last_sent_at = datetime.now(timezone.utc)
        db.commit()
        return True
    except Exception:
        log.exception("telegram mirror failed for message %s", message_id)
        db.rollback()
        return False
    finally:
        db.close()


def _drain(session: Session) -> None:
    ids = session.info.pop(OUTBOX_KEY, None)
    if not ids:
        return
    def run():
        for mid in ids:
            deliver(mid)
    threading.Thread(target=run, name="telegram-outbox", daemon=True).start()


def _discard(session: Session) -> None:
    session.info.pop(OUTBOX_KEY, None)


_registered = False


def register_listeners() -> None:
    """Attach the outbox to the app's session factory. Idempotent."""
    global _registered
    if _registered:
        return
    from db.session import SessionLocal
    event.listen(SessionLocal, "after_commit", _drain)
    event.listen(SessionLocal, "after_rollback", _discard)
    _registered = True
