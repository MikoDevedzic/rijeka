"""
chain.py — on-chain trade confirmation.

POST /api/chain/confirm/{trade_id}
    PENDING -> CONFIRMED, with both parties' EIP-712 signatures over the
    canonical trade hash, anchored in TradeConfirmationRegistry when a chain
    is configured. The CONFIRMED event carries the full attestation in its
    payload and the hash in trade_events.confirmation_hash. Atomic with the
    status flip; if anchoring fails nothing is written.

GET  /api/chain/attestation/{trade_id}
    The stored attestation plus the live on-chain record.

POST /api/chain/verify/{trade_id}
    Recomputes the canonical hash from the CURRENT trade + legs and checks it
    against the stored hash and the chain. This is what a counterparty or an
    auditor runs: "is what's in the database still what was signed?"

GET  /api/chain/status
    Which backend is active (chain id, registry) — Null when no RPC is set.
"""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import desc
from sqlalchemy.orm import Session

from db.session import get_db
from db.models import Trade, TradeLeg, TradeEvent, LegalEntity, Counterparty
from middleware.auth import verify_token
from api.routes.trade_events import (
    _check_write_role, _validate_idempotency_header, _lookup_idempotent,
    _parse_trade_uuid, _load_pending_trade, _apply_lifecycle_transition,
)
from chain.canonical import canonical_payload, canonical_bytes, trade_hash, CANONICAL_SCHEMA_VERSION
from chain.signing import confirmation_typed_data, sign, recover
from chain.keys import resolve as resolve_key
from chain.attestation import get_backend

log = logging.getLogger("rijeka.chain")
router = APIRouter(prefix="/api/chain", tags=["chain"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _load_parties(db: Session, trade: Trade, user_id) -> tuple[LegalEntity, Counterparty]:
    own = db.query(LegalEntity).filter(LegalEntity.id == trade.own_legal_entity_id).first()
    cp  = db.query(Counterparty).filter(Counterparty.id == trade.counterparty_id).first()
    if own is None or cp is None:
        raise HTTPException(status_code=422, detail="Trade needs an own legal entity and a counterparty to be confirmed on-chain.")
    return own, cp


def _cp_identity(db: Session, cp: Counterparty) -> dict:
    """Counterparty LEI/name: from its linked legal entity when it has one."""
    if cp.legal_entity_id:
        le = db.query(LegalEntity).filter(LegalEntity.id == cp.legal_entity_id).first()
        if le is not None:
            return {"lei": le.lei, "name": le.name}
    return {"lei": None, "name": cp.name}


def _canonical_for(db: Session, trade: Trade) -> tuple[dict, bytes]:
    own, cp = _load_parties(db, trade, trade.user_id)
    legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade.id).all()
    payload = canonical_payload(trade, legs, {"lei": own.lei, "name": own.name}, _cp_identity(db, cp))
    return payload, trade_hash(payload)


def _latest_confirmed_event(db: Session, trade_id: UUID) -> Optional[TradeEvent]:
    return (db.query(TradeEvent)
              .filter(TradeEvent.trade_id == trade_id, TradeEvent.event_type == "CONFIRMED")
              .order_by(desc(TradeEvent.event_seq))
              .first())


def _hexb(b: bytes) -> str:
    return "0x" + b.hex()


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/status")
def chain_status(user: dict = Depends(verify_token)):
    be = get_backend()
    return {
        "anchored":       be.anchored,
        "chain_id":       be.chain_id,
        "registry":       be.registry,
        "schema_version": CANONICAL_SCHEMA_VERSION,
        "backend":        type(be).__name__,
    }


@router.post("/confirm/{trade_id}", status_code=201)
def confirm_on_chain(
    trade_id: str,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    user_id = _check_write_role(user)
    _validate_idempotency_header(idempotency_key)
    cached = _lookup_idempotent(db, user_id, idempotency_key)
    if cached:
        return cached

    trade_uuid = _parse_trade_uuid(trade_id)
    trade = _load_pending_trade(db, trade_uuid, user_id)
    own, cp = _load_parties(db, trade, user_id)

    # 1. Canonical record and hash
    payload, h = _canonical_for(db, trade)

    # 2. Party keys. Own entity must be able to sign here; the counterparty's
    #    signature would normally arrive from their system — in this build we
    #    resolve it the same way (dev seed / env key) so the flow is complete.
    try:
        key_own = resolve_key({"lei": own.lei, "name": own.name})
        key_cp  = resolve_key(_cp_identity(db, cp))
    except LookupError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if key_own.address == key_cp.address:
        raise HTTPException(status_code=422, detail="Own entity and counterparty resolve to the same signing key.")
    if key_own.private_key is None or key_cp.private_key is None:
        raise HTTPException(status_code=422, detail="Both parties must be able to sign in this build (address-only keys not yet supported).")

    be = get_backend()
    chain_id = be.chain_id or 31337
    registry = be.registry or "0x0000000000000000000000000000000000000000"

    # 3. Signatures — each party signs the hash bound to the OTHER party
    td_own = confirmation_typed_data(chain_id, registry, h, key_cp.address)
    td_cp  = confirmation_typed_data(chain_id, registry, h, key_own.address)
    sig_own = sign(td_own, key_own.private_key)
    sig_cp  = sign(td_cp,  key_cp.private_key)
    assert recover(td_own, sig_own) == key_own.address
    assert recover(td_cp,  sig_cp)  == key_cp.address

    # 4. Anchor (or record off-chain when no chain is configured)
    try:
        receipt = be.confirm(h, key_own.address, key_cp.address, sig_own, sig_cp)
    except Exception as e:
        log.exception("on-chain confirm failed")
        raise HTTPException(status_code=502, detail=f"Chain anchoring failed: {e}")

    attestation = {
        "schema_version": CANONICAL_SCHEMA_VERSION,
        "trade_hash":     _hexb(h),
        "canonical_bytes_len": len(canonical_bytes(payload)),
        "parties": {
            "own":          {"lei": key_own.lei, "address": key_own.address, "signature": _hexb(sig_own), "key_source": key_own.source},
            "counterparty": {"lei": key_cp.lei,  "address": key_cp.address,  "signature": _hexb(sig_cp),  "key_source": key_cp.source},
        },
        "eip712": {"name": "Rijeka Trade Confirmation", "version": "1", "chain_id": chain_id, "verifying_contract": registry},
        "anchor": receipt.to_dict(),
    }

    # 5. Atomic status flip with the attestation in the event
    return _apply_lifecycle_transition(
        db=db, user_id=user_id, trade=trade,
        event_type="CONFIRMED", new_status="CONFIRMED",
        payload={"attestation": attestation},
        idempotency_key=idempotency_key,
        confirmation_hash=_hexb(h),
        counterparty_confirmed=True,
    )


@router.get("/attestation/{trade_id}")
def get_attestation(trade_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    user_id = user.get("sub")
    trade_uuid = _parse_trade_uuid(trade_id)
    trade = db.query(Trade).filter(Trade.id == trade_uuid, Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    ev = _latest_confirmed_event(db, trade.id)
    if ev is None or not (ev.payload or {}).get("attestation"):
        return {"trade_id": str(trade.id), "status": trade.status, "attestation": None, "on_chain": None}
    att = ev.payload["attestation"]
    be = get_backend()
    rec = None
    try:
        rec = be.get(bytes.fromhex(att["trade_hash"][2:])) if be.anchored else None
    except Exception as e:
        log.warning("chain read failed: %s", e)
    return {
        "trade_id":    str(trade.id),
        "status":      trade.status,
        "event_id":    str(ev.id),
        "event_seq":   ev.event_seq,
        "attestation": att,
        "on_chain":    rec.__dict__ if rec else None,
    }


@router.post("/verify/{trade_id}")
def verify_trade(trade_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Recompute the hash from current state; compare to stored and chain."""
    user_id = user.get("sub")
    trade_uuid = _parse_trade_uuid(trade_id)
    trade = db.query(Trade).filter(Trade.id == trade_uuid, Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")

    payload, h = _canonical_for(db, trade)
    recomputed = _hexb(h)

    ev = _latest_confirmed_event(db, trade.id)
    stored = (ev.confirmation_hash if ev else None) or ((ev.payload or {}).get("attestation", {}) or {}).get("trade_hash") if ev else None
    att = ((ev.payload or {}).get("attestation") if ev else None)

    be = get_backend()
    rec = None
    chain_error = None
    if be.anchored:
        try:
            rec = be.get(h)
        except Exception as e:
            chain_error = str(e)

    sig_ok = None
    if att:
        try:
            chain_id = att["eip712"]["chain_id"]; registry = att["eip712"]["verifying_contract"]
            own = att["parties"]["own"]; cp = att["parties"]["counterparty"]
            r_own = recover(confirmation_typed_data(chain_id, registry, h, cp["address"]), bytes.fromhex(own["signature"][2:]))
            r_cp  = recover(confirmation_typed_data(chain_id, registry, h, own["address"]), bytes.fromhex(cp["signature"][2:]))
            sig_ok = (r_own == own["address"]) and (r_cp == cp["address"])
        except Exception:
            sig_ok = False

    return {
        "trade_id":         str(trade.id),
        "recomputed_hash":  recomputed,
        "stored_hash":      stored,
        "hash_matches":     (stored is not None and stored.lower() == recomputed.lower()),
        "signatures_valid_for_current_state": sig_ok,
        "on_chain":         rec.__dict__ if rec else None,
        "on_chain_confirmed": bool(rec and rec.status == "Confirmed"),
        "chain_error":      chain_error,
        "canonical":        payload,
    }
