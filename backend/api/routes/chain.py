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
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
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
from chain.signing import confirmation_typed_data, sign, recover, eip712_digest
from chain.keys import resolve as resolve_key
from chain.attestation import get_backend

log = logging.getLogger("rijeka.chain")
router = APIRouter(prefix="/api/chain", tags=["chain"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _load_parties(db: Session, trade: Trade, user_id) -> tuple[LegalEntity, Counterparty]:
    own = db.query(LegalEntity).filter(LegalEntity.id == trade.own_legal_entity_id).first()
    cp  = db.query(Counterparty).filter(Counterparty.id == trade.counterparty_id).first()
    missing = []
    if own is None:
        missing.append("own legal entity" if trade.own_legal_entity_id is None
                       else f"own legal entity {trade.own_legal_entity_id} (not found)")
    if cp is None:
        missing.append("counterparty" if trade.counterparty_id is None
                       else f"counterparty {trade.counterparty_id} (not found)")
    if missing:
        raise HTTPException(
            status_code=422,
            detail=("Cannot confirm on-chain: this trade has no " + " and no ".join(missing) +
                    ". A confirmation names both signing parties, so set them on the TRADE tab "
                    "(COUNTERPARTY + BOOK) before booking."),
        )
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



def _resolve_parties(db: Session, trade: Trade):
    """(own_key, cp_key, own_identity, cp_identity). Raises 422 with a usable message."""
    own, cp = _load_parties(db, trade, trade.user_id)
    own_id = {"lei": own.lei, "name": own.name}
    cp_id  = _cp_identity(db, cp)
    try:
        k_own = resolve_key(own_id)
        k_cp  = resolve_key(cp_id)
    except LookupError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if k_own.private_key is None:
        raise HTTPException(status_code=422,
            detail=f"No signing key for our own entity {k_own.lei}. This side must be able to sign.")
    if k_own.address == k_cp.address:
        raise HTTPException(status_code=422, detail="Own entity and counterparty resolve to the same signing key.")
    return k_own, k_cp, own_id, cp_id


def _eip712_ctx():
    be = get_backend()
    return be, (be.chain_id or 31337), (be.registry or "0x" + "0" * 40)


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


@router.get("/request/{trade_id}")
def confirmation_request(trade_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """
    Our half of a bilateral confirmation, for the counterparty to countersign.

    Contains the canonical trade record, its hash, our signature, and the exact
    digest the counterparty must sign. They rebuild the hash from THEIR OWN
    booking and compare: a mismatch is a confirmation break, caught here rather
    than in a reconciliation days later. Only if it matches do they sign.

    Deterministic — EIP-712 signing is RFC-6979, so calling this twice yields
    the same signature. Nothing is stored and nothing is anchored.

    The counterparty returns {address, signature} to POST /countersign, or
    relays confirm() to the registry themselves; the contract accepts a
    validly-signed pair from anyone.
    """
    user_id = user.get("sub")
    trade_uuid = _parse_trade_uuid(trade_id)
    trade = db.query(Trade).filter(Trade.id == trade_uuid, Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")

    k_own, k_cp, own_id, cp_id = _resolve_parties(db, trade)
    payload, h = _canonical_for(db, trade)
    be, chain_id, registry = _eip712_ctx()

    td_own = confirmation_typed_data(chain_id, registry, h, k_cp.address)
    td_cp  = confirmation_typed_data(chain_id, registry, h, k_own.address)

    return {
        "format":         "rijeka-confirmation-request",
        "format_version": 1,
        "generated_at":   datetime.now(timezone.utc).isoformat(),
        "trade_ref":      trade.trade_ref,
        "trade_id":       str(trade.id),
        "canonical":      payload,
        "trade_hash":     _hexb(h),
        "eip712": {"name": "Rijeka Trade Confirmation", "version": "1",
                   "chain_id": chain_id, "verifying_contract": registry},
        "from": {"lei": k_own.lei, "name": own_id.get("name"),
                 "address": k_own.address, "signature": _hexb(sign(td_own, k_own.private_key))},
        "to":   {"lei": k_cp.lei, "name": cp_id.get("name"),
                 "address": k_cp.address,
                 "digest_to_sign": _hexb(eip712_digest(td_cp)),
                 "can_sign_locally": k_cp.private_key is not None},
        "how_to_countersign": [
            "1. Rebuild the canonical record from YOUR booking of this trade and "
            "keccak256 it. It must equal trade_hash. If it does not, the two "
            "bookings disagree — resolve that before signing anything.",
            "2. Sign EIP-712 TradeConfirmation(bytes32 tradeHash,address counterparty) "
            "over {tradeHash: trade_hash, counterparty: from.address} using the domain "
            "in `eip712`. The digest is given as to.digest_to_sign so you can check it.",
            "3. Return {address, signature} to POST /api/chain/countersign/" + str(trade.id) +
            " — or call confirm(trade_hash, from.address, your address, from.signature, "
            "your signature) on the registry yourself. Either party may relay.",
        ],
    }


class CountersignBody(BaseModel):
    address:   str
    signature: str


@router.post("/countersign/{trade_id}", status_code=201)
def countersign(
    trade_id: str,
    body: CountersignBody,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    Accept the counterparty's signature and anchor the confirmation.

    This is the genuinely bilateral path: their signature is produced by their
    system, over their own booking of the trade. We verify it recovers to the
    address registered for their legal entity before anything is submitted.
    """
    user_id = _check_write_role(user)
    _validate_idempotency_header(idempotency_key)
    cached = _lookup_idempotent(db, user_id, idempotency_key)
    if cached:
        return cached

    trade_uuid = _parse_trade_uuid(trade_id)
    trade = _load_pending_trade(db, trade_uuid, user_id)
    k_own, k_cp, own_id, cp_id = _resolve_parties(db, trade)
    payload, h = _canonical_for(db, trade)
    be, chain_id, registry = _eip712_ctx()

    try:
        sig_cp = bytes.fromhex(body.signature[2:] if body.signature.startswith("0x") else body.signature)
    except ValueError:
        raise HTTPException(status_code=422, detail="signature is not hex")
    if len(sig_cp) != 65:
        raise HTTPException(status_code=422, detail=f"signature must be 65 bytes, got {len(sig_cp)}")

    # The signature must be over OUR hash, bound to US, and recover to the
    # address registered for their entity. Anything else is rejected before
    # a transaction is built.
    td_cp = confirmation_typed_data(chain_id, registry, h, k_own.address)
    try:
        recovered = recover(td_cp, sig_cp)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"signature could not be recovered: {e}")
    if recovered.lower() != body.address.lower():
        raise HTTPException(status_code=422,
            detail=f"signature recovers to {recovered}, not the address supplied ({body.address}).")
    if recovered.lower() != k_cp.address.lower():
        raise HTTPException(status_code=422,
            detail=(f"signature is from {recovered}, but {k_cp.lei} is registered as "
                    f"{k_cp.address}. Register their address "
                    f"(RIJEKA_CHAIN_KEY_<LEI>_ADDRESS) or check who signed."))

    td_own  = confirmation_typed_data(chain_id, registry, h, k_cp.address)
    sig_own = sign(td_own, k_own.private_key)

    try:
        receipt = be.confirm(h, k_own.address, k_cp.address, sig_own, sig_cp)
    except Exception as e:
        log.exception("countersign anchoring failed")
        raise HTTPException(status_code=502, detail=f"Chain anchoring failed: {e}")

    attestation = {
        "schema_version": CANONICAL_SCHEMA_VERSION,
        "trade_hash":     _hexb(h),
        "canonical_bytes_len": len(canonical_bytes(payload)),
        "bilateral":      True,
        "parties": {
            "own":          {"lei": k_own.lei, "address": k_own.address,
                             "signature": _hexb(sig_own), "key_source": k_own.source},
            "counterparty": {"lei": k_cp.lei, "address": k_cp.address,
                             "signature": _hexb(sig_cp), "key_source": "countersigned"},
        },
        "eip712": {"name": "Rijeka Trade Confirmation", "version": "1",
                   "chain_id": chain_id, "verifying_contract": registry},
        "anchor": receipt.to_dict(),
    }
    return _apply_lifecycle_transition(
        db=db, user_id=user_id, trade=trade,
        event_type="CONFIRMED", new_status="CONFIRMED",
        payload={"attestation": attestation},
        idempotency_key=idempotency_key,
        confirmation_hash=_hexb(h),
        counterparty_confirmed=True,
    )


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

    # 1. Canonical record and hash
    payload, h = _canonical_for(db, trade)

    # 2. Party keys. This route signs for BOTH sides, which is only possible
    #    when we hold the counterparty's key too — i.e. a demo or a test.
    #    A real bilateral confirmation goes /request -> counterparty signs ->
    #    /countersign, where their signature comes from their own system.
    key_own, key_cp, own_id, cp_id = _resolve_parties(db, trade)
    if key_cp.private_key is None:
        raise HTTPException(status_code=422, detail=(
            f"No signing key held for {key_cp.lei}, which is correct for a real "
            f"counterparty. Use GET /api/chain/request/{trade_id} to produce a "
            f"confirmation request for them to sign, then POST /api/chain/countersign/"
            f"{trade_id} with their signature."))

    be, chain_id, registry = _eip712_ctx()

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
        # Both signatures were produced here. Not a bilateral confirmation.
        "bilateral": False,
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


@router.get("/proof/{trade_id}")
def proof_pack(trade_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """
    Everything needed to verify this trade independently of Rijeka:
    the canonical record, the hash, both signatures, and where it is anchored.

    Hand this file to a counterparty, an auditor or a regulator. They
    recompute keccak256 over the canonical record, check both EIP-712
    signatures, and read the registry directly from a public node. Nothing
    in the check touches Rijeka.
    """
    user_id = user.get("sub")
    trade_uuid = _parse_trade_uuid(trade_id)
    trade = db.query(Trade).filter(Trade.id == trade_uuid, Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    ev = _latest_confirmed_event(db, trade.id)
    att = (ev.payload or {}).get("attestation") if ev else None
    if not att:
        raise HTTPException(status_code=404, detail="This trade has no on-chain confirmation to prove.")

    payload, h = _canonical_for(db, trade)
    return {
        "format":         "rijeka-confirmation-proof",
        "format_version": 1,
        "generated_at":   datetime.now(timezone.utc).isoformat(),
        "trade_ref":      trade.trade_ref,
        "canonical":      payload,
        "trade_hash":     _hexb(h),
        "attestation":    att,
        "how_to_verify": [
            "1. Serialise `canonical` as JSON with keys sorted at every level, "
            "separators ',' and ':', no whitespace, UTF-8.",
            "2. keccak256 those bytes. It must equal `trade_hash` and "
            "`attestation.trade_hash`.",
            "3. Rebuild the EIP-712 digests from `attestation.eip712` "
            "(TradeConfirmation(bytes32 tradeHash,address counterparty); each party "
            "signs with the OTHER party's address) and recover both signatures. They "
            "must equal the two party addresses.",
            "4. Call getConfirmation(trade_hash) on the registry at "
            "`attestation.eip712.verifying_contract` on chain "
            f"{att.get('eip712', {}).get('chain_id')}. Status must be Confirmed and the "
            "parties must match.",
        ],
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
