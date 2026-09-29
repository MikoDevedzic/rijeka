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
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from db.session import get_db
from db.models import Trade, TradeLeg, TradeEvent, LegalEntity, Counterparty, FirmLei
from middleware.auth import verify_token
from api.routes.trade_events import (
    _check_write_role, _validate_idempotency_header, _lookup_idempotent,
    _parse_trade_uuid, _load_pending_trade, _apply_lifecycle_transition,
)
from chain.canonical import canonical_payload, canonical_bytes, trade_hash, CANONICAL_SCHEMA_VERSION
from chain.signing import (confirmation_typed_data, amendment_typed_data, termination_typed_data,
                           sign, recover, eip712_digest)
from chain.lifecycle import latest_attested_event, anchored_attestation, is_terminated
from chain.canonical import TRADE_FIELDS_V2, LEG_FIELDS_V2
from projections.trade_projection import project, project_from_db, EventLike
from db.models import IdempotencyKey
from copy import deepcopy
from datetime import date as _date
from decimal import Decimal
from chain.keys import PartyKey, resolve as resolve_key
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


def trade_parts(db: Session, trade: Trade) -> tuple:
    """(own entity, counterparty entity, counterparty {lei, name}, legs): load once per request, pass as `parts`."""
    own, cp = _load_parties(db, trade, trade.user_id)
    return own, cp, _cp_identity(db, cp), db.query(TradeLeg).filter(TradeLeg.trade_id == trade.id).all()


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
    _validate_idempotency_header(idempotency_key)
    cached = _lookup_idempotent(db, user_id, idempotency_key)
    if cached:
        return cached

    trade_uuid = _parse_trade_uuid(trade_id)
    trade = _load_pending_trade(db, trade_uuid, user_id)
    return countersign_trade(db, trade, body.address, body.signature, idempotency_key=idempotency_key)


def countersign_trade(db: Session, trade: Trade, address: str, signature: str, *,
                      expected_hash: Optional[str] = None, idempotency_key: Optional[str] = None,
                      note: Optional[dict] = None) -> dict:
    """
    Verify the counterparty's signature over the trade's CURRENT canonical
    hash and anchor the confirmation. Shared by POST /countersign (the booker
    relays it) and the chat trade card (the counterparty submits it).

    expected_hash: the hash the signer reviewed; if the booking has changed
    since, refuse rather than anchor terms they didn't see.
    """
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
                          payload: dict, confirmation_hash: str, idempotency_key: Optional[str],
                          mutate=None) -> dict:
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
            confirmation_hash=confirmation_hash, counterparty_confirmed=True,
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
        raise HTTPException(status_code=500, detail=f"{event_type} failed: {e}")


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
    _validate_idempotency_header(idempotency_key)
    trade = db.query(Trade).filter(Trade.id == _parse_trade_uuid(trade_id), Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
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
        raise HTTPException(status_code=502, detail=f"Chain anchoring failed: {e}")

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
    _validate_idempotency_header(idempotency_key)
    trade = db.query(Trade).filter(Trade.id == _parse_trade_uuid(trade_id), Trade.user_id == user_id).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
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
        raise HTTPException(status_code=502, detail=f"Chain anchoring failed: {e}")
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

    payload, h = _canonical_for(db, trade, attested_version(att))
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
    }
