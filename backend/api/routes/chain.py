"""
chain.py — on-chain trade confirmation.

POST /api/chain/confirm/{trade_id}
    PENDING -> CONFIRMED, with both parties' EIP-712 signatures over the
    canonical trade hash, anchored in TradeConfirmationRegistry when a chain
    is configured. The CONFIRMED event carries the full attestation in its
    payload and the hash in trade_events.confirmation_hash. Atomic with the
    status flip; if anchoring fails nothing is written. When the transaction
    is sent but not mined within RIJEKA_CHAIN_SYNC_WAIT_S (25 s) the route
    answers 202 {pending: true, tx_hash, explorer_tx, note, trade, legs} and
    chain/pending.py applies the same transition once the block arrives.

POST /api/chain/reconcile/{trade_id}
    Owner only. Checks an anchor in flight for the trade and applies the
    CONFIRMED transition when it is on the registry; the trade window polls it.

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
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import JSONResponse
from api.routes._errors import internal
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.session import get_db
from db.models import Trade, TradeLeg, TradeEvent, LegalEntity, Counterparty, FirmLei
from middleware.auth import verify_token
from api.routes.trade_events import (
    _check_write_role, _validate_idempotency_header, _lookup_idempotent,
    _parse_trade_uuid, _load_pending_trade, _apply_lifecycle_transition,
)
from chain.canonical import (canonical_payload, canonical_bytes, trade_hash, CANONICAL_SCHEMA_VERSION,
                             package_payload, package_hash, PACKAGE_SCHEMA_VERSION)
from chain.signing import (confirmation_typed_data, amendment_typed_data, termination_typed_data,
                           sign, recover, eip712_digest)
from chain.lifecycle import (latest_attested_event, anchored_attestation, is_terminated, package_of, anchored_hash,
                             refuse_package_leg, refuse_one_leg_of_a_whole_package, current_attestation)
from api.routes._package import PACKAGE_MAX_LEGS, read_package_tag
from chain.canonical import TRADE_FIELDS_V2, LEG_FIELDS_V2
from projections.trade_projection import project, EventLike
from db.models import IdempotencyKey
from copy import deepcopy
from datetime import date as _date
from decimal import Decimal
from chain.keys import PartyKey, resolve as resolve_key
from chain.attestation import get_backend, AnchorPending
from chain import pending as P

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
    """Counterparty LEI/name: from its linked legal entity when it has one, and only when that entity is the
    counterparty's owner's: a link to another account's entity (the page writes the row directly, so the API's own
    check does not see it) is read as no link."""
    if cp.legal_entity_id:
        le = db.query(LegalEntity).filter(LegalEntity.id == cp.legal_entity_id, LegalEntity.user_id == cp.user_id).first()
        if le is not None:
            return {"lei": le.lei, "name": le.name}
    return {"lei": None, "name": cp.name}


def trade_parts(db: Session, trade: Trade) -> tuple:
    """(own entity, counterparty entity, counterparty {lei, name}, legs): load once per request, pass as `parts`."""
    own, cp = _load_parties(db, trade, trade.user_id)
    # the record both parties sign carries the owner's legs only: a leg row written by anyone else is not part of it
    return own, cp, _cp_identity(db, cp), db.query(TradeLeg).filter(TradeLeg.trade_id == trade.id, TradeLeg.user_id == trade.user_id).all()


def _canonical_for(db: Session, trade: Trade, version: int = CANONICAL_SCHEMA_VERSION,
                   parts: Optional[tuple] = None) -> tuple[dict, bytes]:
    """
    The canonical record and its hash under `version`. New confirmations use
    the current version; re-deriving an existing one must use the version in
    its attestation (attested_version), or the hash will not match.
    parts: trade_parts(), when the caller already has them (saves 4 queries).
    """
    own, cp, cp_id, legs = parts or trade_parts(db, trade)
    try:
        payload = canonical_payload(trade, legs, {"lei": own.lei, "name": own.name}, cp_id, version=version)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Cannot build the confirmation record: {e}")
    return payload, trade_hash(payload)


def attested_version(att: Optional[dict]) -> int:
    """The schema a stored attestation was signed under (v1 predates the field's use)."""
    return int((att or {}).get("schema_version") or 1)


def ensure_uti(db: Session, trade: Trade) -> str:
    """
    Schema v2 is keyed by the UTI, so a trade needs one before it is signed.
    Generated once, CFTC-style: the booking entity's LEI (20) + 32 characters,
    and shared with the counterparty in the record itself. Caller commits.
    """
    if not trade.uti:
        own = db.query(LegalEntity).filter(LegalEntity.id == trade.own_legal_entity_id).first()
        if own is None or not own.lei:
            raise HTTPException(status_code=422, detail="The own legal entity needs an LEI to issue a UTI.")
        trade.uti = own.lei.upper() + uuid4().hex.upper()
    return trade.uti


def _latest_confirmed_event(db: Session, trade_id: UUID) -> Optional[TradeEvent]:
    """The event holding the CURRENT signed record: CONFIRMED, or the latest AMENDED."""
    return latest_attested_event(db, trade_id)


def _hexb(b: bytes) -> str:
    return "0x" + b.hex()



def registered_signer(db: Session, lei: Optional[str]) -> Optional[PartyKey]:
    """
    The address a firm on Rijeka registered for this LEI (migration 012).
    Address only: the key stays with that firm, so we can verify their
    signature but never produce it.
    """
    if not lei:
        return None
    claim = db.get(FirmLei, lei)
    if claim is None or not claim.signing_address:
        return None
    from eth_utils import to_checksum_address
    return PartyKey(lei, to_checksum_address(claim.signing_address), None, "registered")


def _resolve_parties(db: Session, trade: Trade, parts: Optional[tuple] = None):
    """(own_key, cp_key, own_identity, cp_identity). Raises 422 with a usable message."""
    own, cp, cp_id, _ = parts or trade_parts(db, trade)
    own_id = {"lei": own.lei, "name": own.name}
    # An LEI is signed into the record and printed on the public register. The Legal Entities page writes its rows
    # straight to the database, so the rule is held here, where every confirmation, amendment and termination passes:
    # a demo key signs for anything that begins DEMO, and nothing but an LEI may be signed.
    from api.routes.legal_entities import LEI_RE
    for who, ident in (("your own entity", own_id), ("the counterparty", cp_id)):
        if ident.get("lei") and not LEI_RE.fullmatch(str(ident["lei"])):      # the whole string: `$` alone lets a final newline through
            raise HTTPException(status_code=422, detail=f"The LEI of {who} is not an LEI (20 capital letters and digits). "
                                                        "Correct it under Configurations › Legal Entities, then confirm.")
    try:
        k_own = resolve_key(own_id)
        # A counterparty that registered a signing wallet on Rijeka signs with
        # it; that overrides any env/dev key, so we can no longer sign for them.
        k_cp  = registered_signer(db, cp_id.get("lei")) or resolve_key(cp_id)
    except LookupError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if k_own.private_key is None:
        raise HTTPException(status_code=422,
            detail=f"No signing key for our own entity {k_own.lei}. This side must be able to sign.")
    if k_own.address == k_cp.address:
        raise HTTPException(status_code=422, detail="Own entity and counterparty resolve to the same signing key.")
    return k_own, k_cp, own_id, cp_id


def _check_chain_quota(db: Session, user_id, kind: str = "confirm") -> None:
    """Charge the relayer budget for this caller before anything is sent (chain/budget.py):
    per user, per firm and global caps on anchoring attempts per rolling 24h. 429 when over."""
    from chain.budget import charge
    charge(db, user_id, kind=kind)


def _eip712_ctx():
    be = get_backend()
    return be, (be.chain_id or 31337), (be.registry or "0x" + "0" * 40)


def _pending_response(db: Session, trade: Trade, row: dict):
    """202: the transaction is sent, the trade is still PENDING; the serialised trade and legs ride along
    so the window's confirm handler can treat the body like a lifecycle response."""
    from api.routes.booking import _serialize_trade, _serialize_leg
    legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade.id).order_by(TradeLeg.leg_seq).all()
    body = {"pending": True, "trade_id": str(trade.id), "tx_hash": row.get("tx_hash"), "explorer_tx": row.get("explorer_tx"),
            "note": row.get("reason") or "transaction sent; waiting for the block. Poll POST /api/chain/reconcile/{trade_id}.",
            "submitted_at": P.public(row)["submitted_at"], "anchor": P.public(row),
            "trade": _serialize_trade(trade), "legs": [_serialize_leg(l) for l in legs], "event_id": None, "idempotent_replay": False}
    return JSONResponse(status_code=202, content=body)


def anchor_confirmation(db: Session, trade: Trade, user_id, be, h: bytes, party_a: str, party_b: str, sig_own: bytes, sig_cp: bytes,
                        attestation: dict, idempotency_key: Optional[str], wait: Optional[float] = None):
    """Send confirm() and finish the confirmation: the CONFIRMED event when the receipt arrives within
    `wait` seconds (chain/pending.sync_wait: 25 s with the pending_anchors table, the backend's full
    timeout without it), otherwise a pending_anchors row and a 202. `attestation` is the signed record
    without its anchor. A transaction already in flight for the trade is reconciled instead of resent."""
    if P.tables_present(db) and P.open_for_trade(db, trade.id) is not None:
        out = P.reconcile_trade(db, trade, be)
        if out.get("applied"):
            return {k: v for k, v in out.items() if k in ("trade", "legs", "event_id", "idempotent_replay")}
        if out.get("pending"):
            return _pending_response(db, trade, P.open_for_trade(db, trade.id) or {})
        # failed: the row is closed with its reason; a fresh transaction goes below
    wait = P.sync_wait(db) if wait is None else wait
    try:
        receipt = be.confirm(h, party_a, party_b, sig_own, sig_cp, wait=wait)
    except AnchorPending as pend:
        row = P.record(db, trade_id=trade.id, user_id=trade.user_id, trade_hash=_hexb(h), attestation=attestation,
                       idempotency_key=idempotency_key, tx_hash=pend.tx_hash, explorer_tx=pend.explorer_tx, note=pend.note)
        log.info("on-chain confirm of %s pending: tx %s", trade.trade_ref, pend.tx_hash)
        return _pending_response(db, trade, row)
    except Exception as e:
        log.exception("on-chain confirm failed")
        raise internal(502, "Chain anchoring failed", e)
    return P.apply_confirmed(db, trade, {**attestation, "anchor": receipt.to_dict()}, _hexb(h), idempotency_key, user_id=user_id)


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
    if not trade.uti:
        ensure_uti(db, trade)
        db.commit()
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
    _check_chain_quota(db, user_id, kind="countersign")
    _validate_idempotency_header(idempotency_key)
    cached = _lookup_idempotent(db, user_id, idempotency_key)
    if cached:
        return cached

    trade_uuid = _parse_trade_uuid(trade_id)
    trade = _load_pending_trade(db, trade_uuid, user_id)
    return countersign_trade(db, trade, body.address, body.signature, idempotency_key=idempotency_key)


def countersign_trade(db: Session, trade: Trade, address: str, signature: str, *,
                      expected_hash: Optional[str] = None, idempotency_key: Optional[str] = None,
                      note: Optional[dict] = None, charge_user=None) -> dict:
    """
    Verify the counterparty's signature over the trade's CURRENT canonical
    hash and anchor the confirmation. Shared by POST /countersign (the booker
    relays it) and the chat trade card (the counterparty submits it).

    expected_hash: the hash the signer reviewed; if the booking has changed
    since, refuse rather than anchor terms they didn't see.
    charge_user: who pays the relayer budget when the caller has not been charged yet (the
    chat-card signer); the /countersign route charges its own caller before calling here.
    """
    if charge_user is not None:
        _check_chain_quota(db, charge_user, kind="countersign")
    k_own, k_cp, own_id, cp_id = _resolve_parties(db, trade)
    ensure_uti(db, trade)   # committed with the CONFIRMED event
    payload, h = _canonical_for(db, trade)
    be, chain_id, registry = _eip712_ctx()
    if expected_hash and expected_hash.lower() != _hexb(h).lower():
        raise HTTPException(status_code=409,
            detail="The booking changed after you reviewed it. Review the current terms and sign again.")

    try:
        sig_cp = bytes.fromhex(signature[2:] if signature.startswith("0x") else signature)
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
    if recovered.lower() != address.lower():
        raise HTTPException(status_code=422,
            detail=f"signature recovers to {recovered}, not the address supplied ({address}).")
    if recovered.lower() != k_cp.address.lower():
        raise HTTPException(status_code=422,
            detail=(f"signature is from {recovered}, but {k_cp.lei} is registered as "
                    f"{k_cp.address}. Register the signing wallet for that LEI, or check who signed."))

    td_own  = confirmation_typed_data(chain_id, registry, h, k_cp.address)
    sig_own = sign(td_own, k_own.private_key)

    try:
        receipt = be.confirm(h, k_own.address, k_cp.address, sig_own, sig_cp)
    except Exception as e:
        log.exception("countersign anchoring failed")
        raise internal(502, "Chain anchoring failed", e)

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
    if note:
        attestation["via"] = note
    return _apply_lifecycle_transition(
        db=db, user_id=trade.user_id, trade=trade,
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
    # one leg of a package whose legs are all pending is not anchored alone: the package could then never be one record
    refuse_one_leg_of_a_whole_package(db, trade)
    _check_chain_quota(db, user_id, kind="confirm")           # charged for a trade that can be confirmed, not for a refusal

    # 1. Canonical record and hash (current schema; v2 needs the UTI first)
    ensure_uti(db, trade)
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

    # 4. The signed record (its anchor is added when the chain answers)
    attestation = {
        "schema_version": CANONICAL_SCHEMA_VERSION,
        "trade_hash":     _hexb(h),
        "canonical_bytes_len": len(canonical_bytes(payload)),
        "parties": {
            "own":          {"lei": key_own.lei, "address": key_own.address, "signature": _hexb(sig_own), "key_source": key_own.source},
            "counterparty": {"lei": key_cp.lei,  "address": key_cp.address,  "signature": _hexb(sig_cp),  "key_source": key_cp.source},
        },
        "eip712": {"name": "Rijeka Trade Confirmation", "version": "1", "chain_id": chain_id, "verifying_contract": registry},
        # Both signatures were produced here. Not a bilateral confirmation.
        "bilateral": False,
    }

    # 5. Anchor (or record off-chain when no chain is configured), then the atomic status flip with the
    #    attestation in the event; or 202 with the transaction when the block has not come in time.
    return anchor_confirmation(db, trade, user_id, be, h, key_own.address, key_cp.address, sig_own, sig_cp, attestation, idempotency_key)


# ── A package of trades confirmed as one ─────────────────────────────────────────────────────────

def package_tag_of(trade: Trade) -> Optional[tuple]:
    """(structure, the package's trade ID, the leg's place, the number of legs) from the trade's `strategy`, as
    POST /api/book/package wrote it (api/routes/_package.py). Only a tag the server wrote: a client cannot."""
    return read_package_tag(trade.strategy)


class PackageConfirmBody(BaseModel):
    trade_ids: List[str]


@router.post("/confirm-package", status_code=201)
def confirm_package_on_chain(
    body: PackageConfirmBody,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    user: dict = Depends(verify_token),
):
    """
    ONE confirmation for a package of trades (a strip, a collar): every leg PENDING -> CONFIRMED together.

    Each leg keeps its own UTI and its own canonical record. The parties sign, and the registry anchors once, the
    PACKAGE record: the two LEIs and the legs' hashes, sorted (chain/canonical.package_payload). Each leg's
    CONFIRMED event carries its own hash, the package's hash, record and transaction, and its place. All of the
    package's legs are named, all are PENDING, and all are confirmed or none: the events and the status flips are
    one transaction, written only after the registry has the record.

    Like POST /confirm this signs for both sides, which is possible only when the counterparty's key is held (a
    demo entity); for a counterparty with its own wallet each leg goes through /request and /countersign.
    Amending or terminating one leg of a package confirmed this way is refused for now (chain/lifecycle).

    What the signatures cover is the legs listed and their terms. That these are ALL the legs of the package is
    the booking's fact (the tag only the server writes), not something the registry knows.

    The route waits for the receipt in the request and has no pending-anchor path. After a lost answer or a failed
    write the same request finishes the job: the UTIs are committed before anything is signed, so the same hashes
    are derived, the registry is found to hold the record, and nothing is sent or charged again.
    """
    user_id = _check_write_role(user)
    _validate_idempotency_header(idempotency_key)
    cached = _lookup_idempotent(db, user_id, idempotency_key)
    if cached:
        return cached

    ids = [_parse_trade_uuid(x) for x in (body.trade_ids or [])]
    if not 2 <= len(ids) <= PACKAGE_MAX_LEGS or len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail=f"trade_ids: the {2} to {PACKAGE_MAX_LEGS} legs of one package, each once")
    trades = [_load_pending_trade(db, i, user_id) for i in ids]

    # the legs of ONE package, all of them: the booking's own tag says which package, which place, how many
    tags = [package_tag_of(t) for t in trades]
    if any(t is None for t in tags):
        missing = ", ".join(tr.trade_ref for tr, tg in zip(trades, tags) if tg is None)
        raise HTTPException(status_code=422, detail=f"{missing}: not a leg of a package. Confirm a single trade with POST /api/chain/confirm/{{trade_id}}.")
    structure, package_id, _i, n = tags[0]
    if any((tg[1], tg[3]) != (package_id, n) for tg in tags) or sorted(tg[2] for tg in tags) != list(range(1, n + 1)):
        raise HTTPException(status_code=422, detail=f"These are not all the legs of one package: {package_id} has {n} legs and every one of them is confirmed together.")
    trades = [tr for _tg, tr in sorted(zip(tags, trades), key=lambda x: x[0][2])]
    if len({(t.own_legal_entity_id, t.counterparty_id) for t in trades}) != 1:
        raise HTTPException(status_code=422, detail="The legs of a package are between the same two parties.")

    # party keys: both held, as POST /confirm
    key_own, key_cp, _own_id, _cp_id = _resolve_parties(db, trades[0])
    if key_cp.private_key is None:
        raise HTTPException(status_code=422, detail=(
            f"No signing key held for {key_cp.lei}, which is correct for a real counterparty. A package is confirmed as one "
            f"record only with a counterparty whose key is held; with {key_cp.lei} confirm each leg through "
            f"GET /api/chain/request/{{trade_id}} and POST /api/chain/countersign/{{trade_id}}."))

    # each leg's own record (v2 needs its UTI). The UTIs are committed before anything is signed: a second try
    # after a lost answer then derives the same hashes, finds the record on the registry and finishes.
    for t in trades:
        ensure_uti(db, t)
    db.commit()
    records = [_canonical_for(db, t) for t in trades]
    leg_hashes = [_hexb(h) for _p, h in records]
    try:
        pkg = package_payload(leg_hashes, records[0][0]["parties"])
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Cannot build the package record: {e}")
    H = package_hash(pkg)

    # a leg with a transaction of its own in flight (a single confirm that answered 202) is not swept into a package
    if P.tables_present(db):
        flying = [t.trade_ref for t in trades if P.open_for_trade(db, t.id) is not None]
        if flying:
            raise HTTPException(status_code=409, detail=f"{', '.join(flying)}: a confirmation of its own is already in flight. Let it finish (or fail) first.")

    be, chain_id, registry = _eip712_ctx()
    # one anchor, one charge; and none when the registry already holds this record (a second try after a lost answer)
    already = None
    if be.anchored:
        try:
            already = be.get(H)
        except Exception as e:      # noqa: BLE001
            log.info("chain: registry read before the package anchor failed: %s", type(e).__name__)
    if not (already is not None and getattr(already, "status", "None") == "Confirmed"):
        _check_chain_quota(db, user_id, kind="confirm")
    td_own = confirmation_typed_data(chain_id, registry, H, key_cp.address)
    td_cp  = confirmation_typed_data(chain_id, registry, H, key_own.address)
    sig_own = sign(td_own, key_own.private_key)
    sig_cp  = sign(td_cp,  key_cp.private_key)
    assert recover(td_own, sig_own) == key_own.address
    assert recover(td_cp,  sig_cp)  == key_cp.address

    try:
        receipt = be.confirm(H, key_own.address, key_cp.address, sig_own, sig_cp)
    except Exception as e:
        log.exception("on-chain confirm of package %s failed", package_id)
        raise internal(502, "Chain anchoring failed", e)
    anchor = receipt.to_dict()

    results = []
    try:
        # The legs again, locked, as they stand NOW: the anchor took its time, and another request may have finished
        # this package, or a leg may have gone its own way, meanwhile.
        locked = {t.id: t for t in db.query(Trade).filter(Trade.id.in_([t.id for t in trades]), Trade.user_id == user_id).with_for_update().all()}
        trades = [locked[t.id] for t in trades]
        if all(t.status == "CONFIRMED" and (package_of(current_attestation(db, t.id)) or {}).get("hash") == _hexb(H) for t in trades):
            from api.routes.booking import _serialize_trade
            db.rollback()
            return {"package": {"trade_id": package_id, "structure": structure, "legs": n, "hash": _hexb(H), "record": pkg, "anchor": anchor},
                    "trades": [_serialize_trade(t) for t in trades], "idempotent_replay": True}
        gone = [t.trade_ref for t in trades if t.status != "PENDING"]
        if gone:
            raise HTTPException(status_code=409, detail=(
                f"{', '.join(gone)} changed while the package was being anchored and is no longer pending. The package record is on the "
                f"registry; nothing was recorded here. Tell the operator: package {package_id}, hash {_hexb(H)}."))
        for i, (t, (payload, h)) in enumerate(zip(trades, records), start=1):
            attestation = {
                "schema_version": CANONICAL_SCHEMA_VERSION,
                "trade_hash":     _hexb(h),                       # this leg's own record
                "canonical_bytes_len": len(canonical_bytes(payload)),
                # what was signed and anchored: the package record, of which this leg is one
                "package": {"schema_version": PACKAGE_SCHEMA_VERSION, "hash": _hexb(H), "legs": pkg["legs"], "parties": pkg["parties"],
                            "trade_id": package_id, "structure": structure, "leg": i, "of": n,
                            "canonical_bytes_len": len(canonical_bytes(pkg))},
                "parties": {
                    "own":          {"lei": key_own.lei, "address": key_own.address, "signature": _hexb(sig_own), "key_source": key_own.source},
                    "counterparty": {"lei": key_cp.lei,  "address": key_cp.address,  "signature": _hexb(sig_cp),  "key_source": key_cp.source},
                },
                "eip712": {"name": "Rijeka Trade Confirmation", "version": "1", "chain_id": chain_id, "verifying_contract": registry},
                "bilateral": False,                               # both signatures were produced here
                "anchor": anchor,
            }
            results.append(_apply_lifecycle_transition(
                db=db, user_id=user_id, trade=t, event_type="CONFIRMED", new_status="CONFIRMED",
                payload={"attestation": attestation}, idempotency_key=None,
                confirmation_hash=_hexb(h), counterparty_confirmed=True, commit=False))
        out = {"package": {"trade_id": package_id, "structure": structure, "legs": n, "hash": _hexb(H), "record": pkg, "anchor": anchor},
               "trades": [r["trade"] for r in results], "idempotent_replay": False}
        if idempotency_key:
            db.add(IdempotencyKey(key=idempotency_key, user_id=user_id, result=out))
        db.commit()
    except HTTPException as e:
        db.rollback()
        if e.status_code == 409 and "no longer pending" in str(e.detail):
            raise
        log.error("package %s anchored but not recorded: %s", package_id, e.detail)
        raise HTTPException(status_code=500, detail="The package is on the registry but was not recorded; confirm it again to finish.")
    except Exception as e:      # noqa: BLE001
        db.rollback()
        log.exception("package %s anchored but not recorded", package_id)
        raise internal(500, "The package is on the registry but was not recorded; confirm it again to finish", e)
    from api.routes.pricer import invalidate_trade_cache
    invalidate_trade_cache()
    return out


@router.post("/reconcile/{trade_id}")
def reconcile_anchor(trade_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Where an anchor in flight stands; applies the CONFIRMED transition when the registry has it.
    {pending: true, tx_hash, explorer_tx, note} while the transaction waits for a block;
    {pending: false, applied: true, status: CONFIRMED, trade, legs, event_id} once it is written;
    {pending: false, failed: true, reason} when the transaction reverted or was dropped (the trade stays PENDING);
    {pending: false, status} when nothing is in flight."""
    user_id = user.get("sub")
    trade = db.query(Trade).filter(Trade.id == _parse_trade_uuid(trade_id), Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    if trade.status != "PENDING":
        return {"pending": False, "applied": False, "status": trade.status}
    if not P.tables_present(db):
        return {"pending": False, "applied": False, "status": trade.status, "note": "no anchoring in flight"}
    return P.reconcile_trade(db, trade, get_backend())




# ── Amend / terminate — the signed record follows the trade ─────────────────
#
# Once a confirmation is anchored, the terms are what BOTH parties signed.
# Changing the booking off-chain leaves the registry pointing at a record the
# booking no longer hashes to. So an amendment is itself a bilateral act:
# both sign TradeAmendment(prevHash, newHash), the registry marks prevHash
# Superseded and records newHash with prevHash as its parent. Termination is
# TradeTermination(hash), both signed, status Terminated.
#
# The counterparty flow mirrors confirmation: a stateless *-request that
# returns our signature and the digest they must sign, then the apply route
# with their signature. When we hold both keys (demo / test) the apply route
# signs both and marks the attestation bilateral: false.

_TRADE_DATE_FIELDS = ("trade_date", "effective_date", "maturity_date")
_LEG_DATE_FIELDS   = ("effective_date", "maturity_date", "first_period_start", "last_period_end")
_LEG_NUM_FIELDS    = ("notional", "fixed_rate", "spread", "leverage")
_LEG_AMENDABLE     = set(LEG_FIELDS_V2) | {"direction", "forecast_curve_id", "terms", "embedded_options"}


def _coerce(field: str, v, date_fields, num_fields):
    if v is None:
        return None
    if field in date_fields and isinstance(v, str):
        return _date.fromisoformat(v)
    if field in num_fields and not isinstance(v, Decimal):
        return Decimal(str(v))
    if field == "payment_lag":
        return int(v)
    return v


def _apply_changes(db: Session, trade: Trade, legs: list, changes: dict) -> None:
    """
    Apply an AMENDED `changes` contract to the ORM rows, in-session, no commit.
    Only economic fields — the ones in the canonical record — may change here.
    Anything else (status, store, book, desk) is not an amendment.
    """
    if not isinstance(changes, dict) or not (changes.get("trade") or changes.get("legs")):
        raise HTTPException(status_code=422, detail="`changes` must contain `trade` and/or `legs` updates.")
    for k, v in (changes.get("trade") or {}).items():
        if k not in TRADE_FIELDS_V2:
            raise HTTPException(status_code=422, detail=f"`{k}` is not an economic trade term; it cannot be amended here.")
        setattr(trade, k, _coerce(k, v, _TRADE_DATE_FIELDS, ("notional",)))
    by_id = {str(l.id): l for l in legs}
    for upd in (changes.get("legs") or []):
        lid = str(upd.get("id") or "")
        leg = by_id.get(lid)
        if leg is None:
            raise HTTPException(status_code=422, detail=f"leg {lid or '?'} is not on this trade.")
        for k, v in upd.items():
            if k == "id":
                continue
            if k not in _LEG_AMENDABLE:
                raise HTTPException(status_code=422, detail=f"`{k}` is not an economic leg term; it cannot be amended here.")
            setattr(leg, k, _coerce(k, v, _LEG_DATE_FIELDS, _LEG_NUM_FIELDS))
    db.flush()
    db.expire(trade); [db.expire(l) for l in legs]


def _current_record(db: Session, trade: Trade):
    """(attestation, prev_hash bytes) for an anchored, non-terminated trade, else 409."""
    att = anchored_attestation(db, trade.id)
    if att is None:
        raise HTTPException(status_code=409, detail=f"{trade.trade_ref} has no on-chain confirmation to act on.")
    if is_terminated(att):
        raise HTTPException(status_code=409, detail=f"{trade.trade_ref} is terminated on-chain; nothing further can change.")
    return att, bytes.fromhex(att["trade_hash"][2:])


def _preview_amendment(db: Session, trade: Trade, changes: dict):
    """
    Apply `changes` in a savepoint, compute the new record, roll back.
    Returns (att, prev_hash, new_payload, new_hash). Deterministic.
    """
    att, prev = _current_record(db, trade)
    sp = db.begin_nested()
    try:
        legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade.id).all()
        _apply_changes(db, trade, legs, changes)
        payload, new = _canonical_for(db, trade, attested_version(att))
    finally:
        sp.rollback()
        db.expire_all()
    if new == prev:
        raise HTTPException(status_code=422, detail="These changes do not alter any signed term; nothing to amend.")
    return att, prev, payload, new


def _apply_attested_event(db: Session, trade: Trade, *, event_type: str, new_status: str,
                          payload: dict, confirmation_hash: Optional[str], idempotency_key: Optional[str],
                          mutate=None, counterparty_confirmed: bool = True) -> dict:
    """
    Like trade_events._apply_lifecycle_transition, but the audit post_state is
    the real projection AFTER this event (so an AMENDED snapshot shows the
    amended terms, not just a status flip), and `mutate()` runs inside the
    same transaction so rows and event commit — or roll back — together.
    """
    import uuid as _uuid
    from datetime import date as _d
    cached = _lookup_idempotent(db, trade.user_id, idempotency_key)
    if cached:
        return cached
    event_id = _uuid.uuid4()
    pre_rows = (db.query(TradeEvent).filter(TradeEvent.trade_id == trade.id)
                  .order_by(TradeEvent.event_seq.asc()).all())
    pre_events = [EventLike.from_row(r) for r in pre_rows]
    pre_state = project(pre_events) if pre_events else {}
    next_seq = (pre_events[-1].event_seq + 1) if pre_events else 1
    post_state = project(pre_events + [EventLike(event_seq=next_seq, event_type=event_type, payload=payload)]) \
                 if pre_events else deepcopy(pre_state)
    if post_state.get("trade") is not None:
        post_state["trade"]["status"] = new_status
    try:
        if mutate:
            mutate()
        db.add(TradeEvent(
            id=event_id, trade_id=trade.id, event_type=event_type,
            event_date=_d.today(), effective_date=_d.today(),
            payload=payload, pre_state=pre_state, post_state=post_state,
            user_id=trade.user_id, created_by=trade.user_id,
            confirmation_hash=confirmation_hash, counterparty_confirmed=counterparty_confirmed,
        ))
        db.flush()
        trade.status = new_status
        trade.latest_event_id = event_id
        trade.version_seq = (trade.version_seq or 0) + 1
        db.flush(); db.refresh(trade)
        from api.routes.trade_events import _build_lifecycle_response
        result = _build_lifecycle_response(db, trade, event_id)
        if idempotency_key:
            db.add(IdempotencyKey(key=idempotency_key, user_id=trade.user_id, result=result))
        db.commit()
        return result
    except HTTPException:
        db.rollback(); raise
    except Exception as e:
        db.rollback()
        log.exception("%s failed", event_type)
        raise internal(500, f"{event_type} failed", e)


def _cp_signature_or_ours(db, trade, k_own, k_cp, td_cp, td_own, address, signature, what: str):
    """
    Resolve the counterparty's signature for a lifecycle action.
    Given one, verify it recovers to their registered/known address. Given
    none, sign for them only if we hold their key (demo/test) and say so.
    Returns (sig_own, sig_cp, bilateral).
    """
    sig_own = sign(td_own, k_own.private_key)
    if signature:
        try:
            sig_cp = bytes.fromhex(signature[2:] if signature.startswith("0x") else signature)
        except ValueError:
            raise HTTPException(status_code=422, detail="signature is not hex")
        if len(sig_cp) != 65:
            raise HTTPException(status_code=422, detail=f"signature must be 65 bytes, got {len(sig_cp)}")
        try:
            rec = recover(td_cp, sig_cp)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"signature could not be recovered: {e}")
        if address and rec.lower() != address.lower():
            raise HTTPException(status_code=422, detail=f"signature recovers to {rec}, not the address supplied ({address}).")
        if rec.lower() != k_cp.address.lower():
            raise HTTPException(status_code=422, detail=(
                f"signature is from {rec}, but {k_cp.lei} is registered as {k_cp.address}."))
        return sig_own, sig_cp, True
    if k_cp.private_key is None:
        raise HTTPException(status_code=422, detail=(
            f"No signing key held for {k_cp.lei}, which is correct for a real counterparty. "
            f"Get their signature over the {what} request and resubmit with {{address, signature}}."))
    return sig_own, sign(td_cp, k_cp.private_key), False


class AmendRequestBody(BaseModel):
    changes: dict


class AmendBody(BaseModel):
    changes: dict
    address:   Optional[str] = None
    signature: Optional[str] = None


@router.post("/amend-request/{trade_id}")
def amendment_request(trade_id: str, body: AmendRequestBody, db: Session = Depends(get_db),
                      user: dict = Depends(verify_token)):
    """
    Our half of an amendment, for the counterparty to countersign. Nothing is
    stored or anchored: the changes are applied in a savepoint to compute the
    new record and hash, then rolled back. Deterministic, so /amend with the
    same `changes` re-derives the identical new hash.
    """
    user_id = user.get("sub")
    trade = db.query(Trade).filter(Trade.id == _parse_trade_uuid(trade_id), Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    refuse_package_leg(db, trade, "Amending")
    att, prev, payload, new = _preview_amendment(db, trade, body.changes)
    k_own, k_cp, own_id, cp_id = _resolve_parties(db, trade)
    be, chain_id, registry = _eip712_ctx()
    td_own = amendment_typed_data(chain_id, registry, prev, new, k_cp.address)
    td_cp  = amendment_typed_data(chain_id, registry, prev, new, k_own.address)
    return {
        "format": "rijeka-amendment-request", "format_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "trade_ref": trade.trade_ref, "trade_id": str(trade.id),
        "changes": body.changes,
        "prev_hash": _hexb(prev), "new_hash": _hexb(new),
        "canonical": payload,
        "eip712": {"name": "Rijeka Trade Confirmation", "version": "1",
                   "chain_id": chain_id, "verifying_contract": registry},
        "from": {"lei": k_own.lei, "name": own_id.get("name"), "address": k_own.address,
                 "signature": _hexb(sign(td_own, k_own.private_key))},
        "to":   {"lei": k_cp.lei, "name": cp_id.get("name"), "address": k_cp.address,
                 "digest_to_sign": _hexb(eip712_digest(td_cp)),
                 "can_sign_locally": k_cp.private_key is not None},
        "how_to_countersign": [
            "1. Apply `changes` to YOUR booking of this trade and re-hash it. It must equal new_hash. "
            "Check prev_hash is the record you signed.",
            "2. Sign EIP-712 TradeAmendment(bytes32 prevHash,bytes32 newHash,address counterparty) with "
            "counterparty = from.address. The digest is to.digest_to_sign.",
            f"3. Return {{address, signature}} with the same `changes` to POST /api/chain/amend/{trade.id}, "
            "or call amend(prev_hash, new_hash, from.signature, your signature) on the registry yourself.",
        ],
    }


@router.post("/amend/{trade_id}", status_code=201)
def amend_on_chain(trade_id: str, body: AmendBody,
                   idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
                   db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """
    Apply `changes`, supersede the signed record on-chain with both
    signatures, and append an AMENDED event carrying the new attestation.
    Rows and event commit together; any failure leaves the booking untouched.
    """
    user_id = _check_write_role(user)
    _check_chain_quota(db, user_id, kind="amend")
    _validate_idempotency_header(idempotency_key)
    trade = db.query(Trade).filter(Trade.id == _parse_trade_uuid(trade_id), Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    refuse_package_leg(db, trade, "Amending")
    if trade.status != "CONFIRMED":
        raise HTTPException(status_code=409, detail=f"{trade.trade_ref} is {trade.status}; only a CONFIRMED trade can be amended.")

    att, prev, payload, new = _preview_amendment(db, trade, body.changes)
    k_own, k_cp, own_id, cp_id = _resolve_parties(db, trade)
    be, chain_id, registry = _eip712_ctx()
    td_own = amendment_typed_data(chain_id, registry, prev, new, k_cp.address)
    td_cp  = amendment_typed_data(chain_id, registry, prev, new, k_own.address)
    sig_own, sig_cp, bilateral = _cp_signature_or_ours(db, trade, k_own, k_cp, td_cp, td_own,
                                                       body.address, body.signature, "amendment")
    try:
        receipt = be.amend(prev, new, sig_own, sig_cp)
    except Exception as e:
        log.exception("on-chain amend failed")
        raise internal(502, "Chain anchoring failed", e)

    attestation = {
        "schema_version": attested_version(att),
        "trade_hash":     _hexb(new),
        "prev_hash":      _hexb(prev),
        "canonical_bytes_len": len(canonical_bytes(payload)),
        "bilateral":      bilateral,
        "parties": {
            "own":          {"lei": k_own.lei, "address": k_own.address, "signature": _hexb(sig_own), "key_source": k_own.source},
            "counterparty": {"lei": k_cp.lei,  "address": k_cp.address,  "signature": _hexb(sig_cp),
                             "key_source": "countersigned" if bilateral else k_cp.source},
        },
        "eip712": {"name": "Rijeka Trade Confirmation", "version": "1", "chain_id": chain_id, "verifying_contract": registry},
        "anchor": receipt.to_dict(),
    }

    def _mutate():
        legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade.id).all()
        _apply_changes(db, trade, legs, body.changes)
        _, h2 = _canonical_for(db, trade, attested_version(att))
        if h2 != new:   # cannot happen unless the booking changed between preview and apply
            raise HTTPException(status_code=409, detail="The booking changed while the amendment was being anchored; re-run the request.")

    return _apply_attested_event(db, trade, event_type="AMENDED", new_status="CONFIRMED",
                                 payload={"changes": body.changes, "attestation": attestation},
                                 confirmation_hash=_hexb(new), idempotency_key=idempotency_key, mutate=_mutate)


# ── Partial termination ──────────────────────────────────────────────────────
#
# The trade stays, on a smaller notional (chain/partial_termination.py works out what changes, from the booking and
# never from the request). When the trade's record is anchored the registry is told as for an amendment: the old
# record is superseded by the new one with both signatures, and the event is AMENDED with the new attestation and a
# `partial_termination` block. When it is not anchored (pending, or signed on an instance with no chain) the booking
# changes, the event is PARTIAL_TERMINATION, and nothing is claimed about a signature.

class PartialFee(BaseModel):
    direction: str
    amount:    float
    date:      _date
    currency:  Optional[str] = None
    note:      Optional[str] = None


class PartialTerminationRequestBody(BaseModel):
    new_notional: Decimal
    fee:          Optional[PartialFee] = None


class PartialTerminationBody(PartialTerminationRequestBody):
    address:   Optional[str] = None
    signature: Optional[str] = None


def _partial_changes(db: Session, trade: Trade, body) -> tuple[dict, dict]:
    """(changes, summary) for this request on the booking as it stands, or 422 in the rule's own words."""
    from chain import partial_termination as PT
    legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade.id).all()
    fee = None if body.fee is None else {"direction": body.fee.direction, "amount": body.fee.amount, "date": body.fee.date.isoformat(),
                                         "currency": body.fee.currency, "note": body.fee.note}
    try:
        return PT.changes_for(trade, legs, body.new_notional, fee, datetime.now(timezone.utc).date())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _preview_partial(db: Session, trade: Trade, changes: dict, att: dict):
    """The record and hash the trade will have once `changes` are on it: applied in a savepoint, rolled back."""
    from chain import partial_termination as PT
    prev = bytes.fromhex(att["trade_hash"][2:])
    sp = db.begin_nested()
    try:
        legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade.id).all()
        PT.apply(trade, legs, changes)
        db.flush()
        db.expire(trade); [db.expire(leg) for leg in legs]
        payload, new = _canonical_for(db, trade, attested_version(att))
    finally:
        sp.rollback()
        db.expire_all()
    if new == prev:
        raise HTTPException(status_code=422, detail="This reduction does not alter any signed term; nothing to supersede.")
    return prev, payload, new


def _partial_trade(db: Session, trade_id: str, user_id) -> Trade:
    trade = db.query(Trade).filter(Trade.id == _parse_trade_uuid(trade_id), Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    refuse_package_leg(db, trade, "Partially terminating")
    if P.tables_present(db) and P.open_for_trade(db, trade.id) is not None:
        raise HTTPException(status_code=409, detail=f"{trade.trade_ref}'s confirmation is still being anchored; reduce it once that has landed.")
    return trade


@router.post("/partial-termination-request/{trade_id}")
def partial_termination_request(trade_id: str, body: PartialTerminationRequestBody, db: Session = Depends(get_db),
                                user: dict = Depends(verify_token)):
    """Our half of a partial termination of an anchored trade, for the counterparty to countersign. Nothing is
    stored or anchored. Deterministic: /partial-terminate with the same body re-derives the same new hash."""
    trade = _partial_trade(db, trade_id, user.get("sub"))
    att, _ = _current_record(db, trade)
    changes, summary = _partial_changes(db, trade, body)
    prev, payload, new = _preview_partial(db, trade, changes, att)
    k_own, k_cp, own_id, cp_id = _resolve_parties(db, trade)
    be, chain_id, registry = _eip712_ctx()
    td_own = amendment_typed_data(chain_id, registry, prev, new, k_cp.address)
    td_cp  = amendment_typed_data(chain_id, registry, prev, new, k_own.address)
    return {
        "format": "rijeka-partial-termination-request", "format_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "trade_ref": trade.trade_ref, "trade_id": str(trade.id),
        "partial_termination": summary, "changes": changes,
        "prev_hash": _hexb(prev), "new_hash": _hexb(new), "canonical": payload,
        "eip712": {"name": "Rijeka Trade Confirmation", "version": "1", "chain_id": chain_id, "verifying_contract": registry},
        "from": {"lei": k_own.lei, "name": own_id.get("name"), "address": k_own.address,
                 "signature": _hexb(sign(td_own, k_own.private_key))},
        "to":   {"lei": k_cp.lei, "name": cp_id.get("name"), "address": k_cp.address,
                 "digest_to_sign": _hexb(eip712_digest(td_cp)), "can_sign_locally": k_cp.private_key is not None},
        "how_to_countersign": [
            "1. Reduce YOUR booking of this trade to partial_termination.to_notional (and the record's own notional terms "
            "with it) and re-hash it. It must equal new_hash. Check prev_hash is the record you signed.",
            "2. Sign EIP-712 TradeAmendment(bytes32 prevHash,bytes32 newHash,address counterparty) with "
            "counterparty = from.address. The digest is to.digest_to_sign.",
            f"3. Return {{address, signature}} with the same new_notional and fee to POST /api/chain/partial-terminate/{trade.id}.",
        ],
    }


@router.post("/partial-terminate/{trade_id}", status_code=201)
def partial_terminate(trade_id: str, body: PartialTerminationBody,
                      idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
                      db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """
    Reduce a trade's notional and book the fee for the unwind. An anchored trade's record is superseded on-chain
    with both signatures (an AMENDED event carrying the new attestation); one that is not anchored is changed on
    the booking alone (a PARTIAL_TERMINATION event). Rows and event commit together.
    """
    from chain import partial_termination as PT
    user_id = _check_write_role(user)
    _validate_idempotency_header(idempotency_key)
    cached = _lookup_idempotent(db, user_id, idempotency_key)
    if cached:
        return cached
    trade = _partial_trade(db, trade_id, user_id)
    att = anchored_attestation(db, trade.id)
    if is_terminated(att):
        raise HTTPException(status_code=409, detail=f"{trade.trade_ref} is terminated on-chain; nothing further can change.")
    changes, summary = _partial_changes(db, trade, body)

    def _mutate(expect: Optional[bytes] = None):
        legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade.id).all()
        PT.apply(trade, legs, changes)
        db.flush()
        if expect is not None:
            db.expire(trade); [db.expire(leg) for leg in legs]
            _, h2 = _canonical_for(db, trade, attested_version(att))
            if h2 != expect:   # cannot happen unless the booking changed between preview and apply
                raise HTTPException(status_code=409, detail="The booking changed while the record was being anchored; re-run the request.")

    if att is None:
        out = _apply_attested_event(db, trade, event_type="PARTIAL_TERMINATION", new_status=trade.status,
                                    payload={"changes": changes, "partial_termination": {**summary, "anchored": False}},
                                    confirmation_hash=None, idempotency_key=idempotency_key, mutate=_mutate,
                                    counterparty_confirmed=False)
    else:
        _check_chain_quota(db, user_id, kind="amend")
        prev, payload, new = _preview_partial(db, trade, changes, att)
        k_own, k_cp, own_id, cp_id = _resolve_parties(db, trade)
        be, chain_id, registry = _eip712_ctx()
        td_own = amendment_typed_data(chain_id, registry, prev, new, k_cp.address)
        td_cp  = amendment_typed_data(chain_id, registry, prev, new, k_own.address)
        sig_own, sig_cp, bilateral = _cp_signature_or_ours(db, trade, k_own, k_cp, td_cp, td_own,
                                                           body.address, body.signature, "partial termination")
        try:
            receipt = be.amend(prev, new, sig_own, sig_cp)
        except Exception as e:
            log.exception("on-chain partial termination failed")
            raise internal(502, "Chain anchoring failed", e)
        attestation = {
            "schema_version": attested_version(att),
            "trade_hash":     _hexb(new),
            "prev_hash":      _hexb(prev),
            "canonical_bytes_len": len(canonical_bytes(payload)),
            "bilateral":      bilateral,
            "parties": {
                "own":          {"lei": k_own.lei, "address": k_own.address, "signature": _hexb(sig_own), "key_source": k_own.source},
                "counterparty": {"lei": k_cp.lei,  "address": k_cp.address,  "signature": _hexb(sig_cp),
                                 "key_source": "countersigned" if bilateral else k_cp.source},
            },
            "eip712": {"name": "Rijeka Trade Confirmation", "version": "1", "chain_id": chain_id, "verifying_contract": registry},
            "anchor": receipt.to_dict(),
        }
        out = _apply_attested_event(db, trade, event_type="AMENDED", new_status=trade.status,
                                    payload={"changes": changes, "attestation": attestation,
                                             "partial_termination": {**summary, "anchored": True}},
                                    confirmation_hash=_hexb(new), idempotency_key=idempotency_key,
                                    mutate=lambda: _mutate(new))
    from api.routes.pricer import invalidate_trade_cache
    invalidate_trade_cache()
    # what was done, beside the trade as it now stands (a replay of the same Idempotency-Key answers the trade alone)
    return {**out, "partial_termination": {**summary, "anchored": att is not None}}


class TerminateBody(BaseModel):
    address:   Optional[str] = None
    signature: Optional[str] = None
    reason:    Optional[str] = None


@router.get("/terminate-request/{trade_id}")
def termination_request(trade_id: str, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Our half of a termination: our signature and the digest the counterparty must sign."""
    user_id = user.get("sub")
    trade = db.query(Trade).filter(Trade.id == _parse_trade_uuid(trade_id), Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    refuse_package_leg(db, trade, "Terminating")
    att, h = _current_record(db, trade)
    k_own, k_cp, own_id, cp_id = _resolve_parties(db, trade)
    be, chain_id, registry = _eip712_ctx()
    td_own = termination_typed_data(chain_id, registry, h, k_cp.address)
    td_cp  = termination_typed_data(chain_id, registry, h, k_own.address)
    return {
        "format": "rijeka-termination-request", "format_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "trade_ref": trade.trade_ref, "trade_id": str(trade.id),
        "trade_hash": _hexb(h),
        "eip712": {"name": "Rijeka Trade Confirmation", "version": "1", "chain_id": chain_id, "verifying_contract": registry},
        "from": {"lei": k_own.lei, "name": own_id.get("name"), "address": k_own.address,
                 "signature": _hexb(sign(td_own, k_own.private_key))},
        "to":   {"lei": k_cp.lei, "name": cp_id.get("name"), "address": k_cp.address,
                 "digest_to_sign": _hexb(eip712_digest(td_cp)), "can_sign_locally": k_cp.private_key is not None},
        "how_to_countersign": [
            "1. Confirm trade_hash is the record you signed (compare with your own booking).",
            "2. Sign EIP-712 TradeTermination(bytes32 tradeHash,address counterparty) with counterparty = from.address.",
            f"3. Return {{address, signature}} to POST /api/chain/terminate/{trade.id}, or call "
            "terminate(trade_hash, from.signature, your signature) on the registry yourself.",
        ],
    }


@router.post("/terminate/{trade_id}", status_code=201)
def terminate_on_chain(trade_id: str, body: TerminateBody,
                       idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
                       db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Close the signed record on-chain with both signatures; TERMINATED event and status."""
    user_id = _check_write_role(user)
    _check_chain_quota(db, user_id, kind="terminate")
    _validate_idempotency_header(idempotency_key)
    trade = db.query(Trade).filter(Trade.id == _parse_trade_uuid(trade_id), Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    refuse_package_leg(db, trade, "Terminating")
    if trade.status != "CONFIRMED":
        raise HTTPException(status_code=409, detail=f"{trade.trade_ref} is {trade.status}; only a CONFIRMED trade can be terminated.")
    att, h = _current_record(db, trade)
    k_own, k_cp, own_id, cp_id = _resolve_parties(db, trade)
    be, chain_id, registry = _eip712_ctx()
    td_own = termination_typed_data(chain_id, registry, h, k_cp.address)
    td_cp  = termination_typed_data(chain_id, registry, h, k_own.address)
    sig_own, sig_cp, bilateral = _cp_signature_or_ours(db, trade, k_own, k_cp, td_cp, td_own,
                                                       body.address, body.signature, "termination")
    try:
        receipt = be.terminate(h, sig_own, sig_cp)
    except Exception as e:
        log.exception("on-chain terminate failed")
        raise internal(502, "Chain anchoring failed", e)
    attestation = {**att, "terminated": True, "bilateral": bilateral,
                   "termination": {"anchor": receipt.to_dict(), "reason": body.reason,
                                   "signatures": {"own": _hexb(sig_own), "counterparty": _hexb(sig_cp)}}}
    return _apply_attested_event(db, trade, event_type="TERMINATED", new_status="TERMINATED",
                                 payload={"reason": body.reason, "attestation": attestation},
                                 confirmation_hash=_hexb(h), idempotency_key=idempotency_key)

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
        # a leg of a package: the registry holds the package's hash
        rec = be.get(bytes.fromhex(anchored_hash(att)[2:])) if be.anchored else None
    except Exception as e:
        log.warning("chain read failed: %s", e)
    return {
        "trade_id":    str(trade.id),
        "status":      trade.status,
        "event_id":    str(ev.id),
        "event_seq":   ev.event_seq,
        "attestation": att,
        "anchored_hash": anchored_hash(att),
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

    payload, h = _canonical_for(db, trade, attested_version(att))
    pk = package_of(att)
    if pk:
        # A leg of a package. What both parties signed and the registry holds is the PACKAGE record, so that is the
        # proof's `canonical` and `trade_hash`: a verifier that knows nothing of packages checks exactly that record,
        # its signatures and its anchor. The leg's own record travels beside it (`leg`), with its hash, which is one
        # of the record's `legs`: a verifier that knows packages checks this trade's terms are in what was signed.
        record = package_payload(pk["legs"], pk.get("parties") or payload["parties"])
        return {
            "format":         "rijeka-confirmation-proof",
            "format_version": 1,
            "generated_at":   datetime.now(timezone.utc).isoformat(),
            "trade_ref":      trade.trade_ref,
            "canonical":      record,
            "trade_hash":     _hexb(package_hash(record)),
            "leg":            {"canonical": payload, "trade_hash": _hexb(h), "leg": pk.get("leg"), "of": pk.get("of")},
            "package":        {"trade_id": pk.get("trade_id"), "structure": pk.get("structure"), "legs": pk.get("of")},
            "attestation":    att,
            "how_to_verify": [
                "This trade was confirmed as one leg of a package: both parties signed, and the registry holds, the "
                "PACKAGE record (`canonical`), which lists the hash of every leg.",
                "1. Serialise `canonical` as JSON with keys sorted at every level, separators ',' and ':', no whitespace, "
                "UTF-8, and keccak256 it. It must equal `trade_hash` and `attestation.package.hash`.",
                "2. Rebuild the EIP-712 digests from `attestation.eip712` "
                "(TradeConfirmation(bytes32 tradeHash,address counterparty) with tradeHash = `trade_hash`; each party "
                "signs with the OTHER party's address) and recover both signatures. They must equal the two party addresses.",
                "3. Call getConfirmation(trade_hash) on the registry at `attestation.eip712.verifying_contract` on chain "
                f"{att.get('eip712', {}).get('chain_id')}. Status must be Confirmed and the parties must match.",
                "4. This leg: serialise `leg.canonical` the same way and keccak256 it. It must equal `leg.trade_hash`, "
                "and `leg.trade_hash` must be one of `canonical.legs`. Then these terms are in what was signed.",
                "5. To check the whole package, repeat step 4 with the proof of each of its legs.",
            ],
        }
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

    ev = _latest_confirmed_event(db, trade.id)
    stored = (ev.confirmation_hash if ev else None) or ((ev.payload or {}).get("attestation", {}) or {}).get("trade_hash") if ev else None
    att = ((ev.payload or {}).get("attestation") if ev else None)

    # Re-derive under the schema the confirmation was signed with.
    payload, h = _canonical_for(db, trade, attested_version(att) if att else CANONICAL_SCHEMA_VERSION)
    recomputed = _hexb(h)

    # A leg of a package: what was signed and anchored is the package record. The leg's own hash, recomputed from
    # the booking as it stands, must be one of the record's legs, and the record must hash to what was stored.
    pk = package_of(att)
    package = None
    signed = h
    if pk:
        try:
            record = package_payload(pk["legs"], pk.get("parties") or payload["parties"])
            signed = package_hash(record)
            package = {"trade_id": pk.get("trade_id"), "leg": pk.get("leg"), "of": pk.get("of"), "hash": pk["hash"],
                       "recomputed_hash": _hexb(signed), "hash_matches": _hexb(signed).lower() == str(pk["hash"]).lower(),
                       "leg_in_package": recomputed.lower() in [str(x).lower() for x in pk["legs"]]}
        except (ValueError, KeyError, TypeError) as e:
            signed = bytes.fromhex(str(pk["hash"])[2:])
            package = {"trade_id": pk.get("trade_id"), "leg": pk.get("leg"), "of": pk.get("of"), "hash": pk["hash"],
                       "recomputed_hash": None, "hash_matches": False, "leg_in_package": False, "error": str(e)}

    be = get_backend()
    rec = None
    chain_error = None
    if be.anchored:
        try:
            rec = be.get(signed)
        except Exception as e:
            chain_error = str(e)

    sig_ok = None
    if att:
        try:
            chain_id = att["eip712"]["chain_id"]; registry = att["eip712"]["verifying_contract"]
            own = att["parties"]["own"]; cp = att["parties"]["counterparty"]
            r_own = recover(confirmation_typed_data(chain_id, registry, signed, cp["address"]), bytes.fromhex(own["signature"][2:]))
            r_cp  = recover(confirmation_typed_data(chain_id, registry, signed, own["address"]), bytes.fromhex(cp["signature"][2:]))
            sig_ok = (r_own == own["address"]) and (r_cp == cp["address"])
            # a leg of a package: the signatures stand for this trade only while its record is still one of the legs
            if package is not None:
                sig_ok = sig_ok and package["hash_matches"] and package["leg_in_package"]
        except Exception:
            sig_ok = False

    return {
        "trade_id":         str(trade.id),
        "lifecycle":        {"event": ev.event_type if ev else None,
                             "prev_hash": (att or {}).get("prev_hash"),
                             "terminated": is_terminated(att),
                             "on_chain_prev": (rec.prev_hash if rec and rec.prev_hash and int(rec.prev_hash, 16) else None)},
        "recomputed_hash":  recomputed,
        "stored_hash":      stored,
        "hash_matches":     (stored is not None and stored.lower() == recomputed.lower()),
        "signatures_valid_for_current_state": sig_ok,
        "on_chain":         rec.__dict__ if rec else None,
        "on_chain_confirmed": bool(rec and rec.status == "Confirmed"),
        "chain_error":      chain_error,
        "canonical":        payload,
        "package":          package,
    }
