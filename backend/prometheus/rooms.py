"""
PROMETHEUS in chat rooms.

Everything it says in a room is seen by every firm in the room, so in a room
it may only use what every firm there already has:
  - Rijeka's public code and docs (SourceToolbox), and
  - in a bilateral room, the trades confirmed on-chain BETWEEN those firms:
    the exact record both parties signed (economics + LEIs; no book, desk or
    strategy), with where it is anchored.
Never anyone's wider book. Messages from room members are untrusted input
(they may come from another firm).
"""

from __future__ import annotations

import json
import re
import uuid

from sqlalchemy import desc
from sqlalchemy.orm import Session

from db.models import FirmLei, FirmMember, Firm, Trade, TradeEvent
from prometheus import agent
from prometheus.tools import SourceToolbox, _jsonable

MENTION = re.compile(r"(?<![\w@])@prometheus\b", re.IGNORECASE)
HISTORY_LIMIT = 30


def mentions_prometheus(body: str) -> bool:
    return bool(MENTION.search(body or ""))


def shared_confirmations(db: Session, firm_ids: list[uuid.UUID]) -> list[dict]:
    """
    Trades confirmed on-chain between exactly these two firms: one party's LEI
    claimed by each. Only the signed record is returned, and only while the
    booking still hashes to what was signed; otherwise the terms are withheld.
    """
    if len(firm_ids) != 2:
        return []
    from api.routes.chain import _canonical_for  # web3 import; only on this path
    from fastapi import HTTPException

    leis = {fid: {l.lei for l in db.query(FirmLei).filter(FirmLei.firm_id == fid)} for fid in firm_ids}
    names = {f.id: f.name for f in db.query(Firm).filter(Firm.id.in_(firm_ids))}
    a, b = firm_ids
    bookers = {m.user_id: m.firm_id for m in db.query(FirmMember).filter(FirmMember.firm_id.in_(firm_ids))}
    if not bookers:
        return []

    out, seen = [], set()
    events = (db.query(TradeEvent)
                .filter(TradeEvent.event_type == "CONFIRMED", TradeEvent.user_id.in_(bookers))
                .order_by(desc(TradeEvent.event_seq)).all())
    for ev in events:
        att = (ev.payload or {}).get("attestation")
        if not att or ev.trade_id in seen:
            continue
        seen.add(ev.trade_id)
        own = (att.get("parties") or {}).get("own", {}).get("lei")
        cp = (att.get("parties") or {}).get("counterparty", {}).get("lei")
        if not ((own in leis[a] and cp in leis[b]) or (own in leis[b] and cp in leis[a])):
            continue
        trade = db.get(Trade, ev.trade_id)
        anchor = att.get("anchor") or {}
        row = {
            "booked_by": names.get(bookers.get(ev.user_id)),
            "trade_hash": att.get("trade_hash"),
            "anchored": bool(anchor.get("anchored")),
            "chain_id": anchor.get("chain_id"),
            "block_number": anchor.get("block_number"),
            "tx_hash": anchor.get("tx_hash"),
            "explorer_tx": anchor.get("explorer_tx"),
        }
        try:
            payload, h = _canonical_for(db, trade)
            row["still_matches_signed_record"] = ("0x" + h.hex()) == att.get("trade_hash")
            if row["still_matches_signed_record"]:
                row["signed_record"] = payload
        except HTTPException:
            row["still_matches_signed_record"] = False
        out.append(row)
    return out


class RoomToolbox(SourceToolbox):
    """Source tools plus the confirmations shared by the two firms in the room."""

    tool_defs = SourceToolbox.tool_defs + [{
        "name": "list_shared_confirmations",
        "description": (
            "Trades confirmed on-chain between the two firms in this room: for each, the exact "
            "record both parties signed (economics, legs, both LEIs), its keccak256 hash, whether "
            "the booking still matches what was signed, and where it is anchored (chain, block, "
            "tx). This is the only trade data you can see in a room."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    }]

    def __init__(self, shared: list[dict]):
        super().__init__()
        self._shared = shared
        self.handlers["list_shared_confirmations"] = lambda: json.dumps(
            {"count": len(self._shared), "confirmations": self._shared}, default=_jsonable)


def _brief(kind: str, firm_names: list[str]) -> str:
    firms = ", ".join(firm_names)
    if kind == "SUPPORT":
        where = (f"You are answering in the Rijeka support room for {firms}. You are the first "
                 "responder; a Rijeka specialist can join the room. If a question needs a human "
                 "(commercial terms, account changes, a bug), say a Rijeka specialist will pick it "
                 "up, and if it's a product request, draft a short ticket (title, problem, why it "
                 "matters) the user can confirm.")
    else:
        where = (f"You are answering in a shared chat room between {firms}. Everyone in the room "
                 "reads your reply.")
    if kind == "BILATERAL":
        data = ("In this room you have Rijeka's public code and methodology docs, and "
                "list_shared_confirmations: the trades confirmed on-chain between these two firms, "
                "i.e. the records both signed. That is the only trade data you can see. You cannot "
                "see either firm's wider book, pending or unconfirmed trades, positions or other "
                "counterparties, and you must not guess at them. If a question needs that, say they "
                "can ask you privately in the Prometheus panel, where you see their own data.")
    else:
        data = ("In rooms you only have Rijeka's public code and methodology docs. You cannot see "
                "any firm's trades, positions, counterparties or confirmations, and you must not "
                "guess at them. If a question needs someone's book, say they can ask you privately "
                "in the Prometheus panel, where you can see their own data.")
    return (
        where + "\n\n" + data + "\n\n"
        "The transcript shows each speaker as [Name · Firm]. Reply to the latest message that "
        "addressed you. Do not include the [Name · Firm] prefix in your own reply. Keep it "
        "shorter than a panel answer: a room is a conversation."
    )


def transcript_to_messages(history: list[dict]) -> list[dict]:
    """
    Room history (oldest first; dicts with sender_kind, sender_name, sender_firm,
    body) -> alternating model turns. Human messages become user turns labelled
    with speaker and firm; Prometheus's earlier replies become assistant turns.
    Must end on a user turn.
    """
    turns: list[dict] = []
    for m in history[-HISTORY_LIMIT:]:
        if m["sender_kind"] == "PROMETHEUS":
            role, text = "assistant", m["body"]
        else:
            who = m["sender_name"] + (f" · {m['sender_firm']}" if m.get("sender_firm") else "")
            role, text = "user", f"[{who}]: {m['body']}"
        if turns and turns[-1]["role"] == role:
            turns[-1]["content"] += "\n\n" + text
        else:
            turns.append({"role": role, "content": text})
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    while turns and turns[-1]["role"] != "user":
        turns.pop()
    return turns


def answer_in_room(kind: str, firm_names: list[str], history: list[dict],
                   shared: list[dict] | None = None) -> agent.Answer:
    """shared: precomputed shared_confirmations for a bilateral room, so no DB
    connection is held during the model call."""
    messages = transcript_to_messages(history)
    if not messages:
        return agent.Answer("", [], "empty")
    toolbox = RoomToolbox(shared or []) if kind == "BILATERAL" else SourceToolbox()
    return agent.answer(messages, toolbox, context=_brief(kind, firm_names))
