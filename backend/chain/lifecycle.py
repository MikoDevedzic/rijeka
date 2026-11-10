"""
Lifecycle state of an on-chain confirmed trade — shared by the chain routes
and by every route that can mutate a trade's economics.

A trade whose confirmation is anchored on-chain has terms that BOTH parties
signed. Changing those terms off-chain leaves a registry record that no
longer matches the booking: VERIFY fails and nobody can tell whether the
booking or the record is wrong. So once anchored, economics change only via
the chain routes (/api/chain/amend, /api/chain/terminate), which supersede
or close the record with both signatures.

This module has no route imports, so trades.py / trade_legs.py /
trade_events.py can use it without a cycle.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import desc
from sqlalchemy.orm import Session

from db.models import TradeEvent

# Events that carry the current signed record in payload["attestation"].
ATTESTED_EVENT_TYPES = ("CONFIRMED", "AMENDED", "TERMINATED")


def latest_attested_event(db: Session, trade_id: UUID) -> Optional[TradeEvent]:
    """The most recent event holding an attestation: the current signed record."""
    return (db.query(TradeEvent)
              .filter(TradeEvent.trade_id == trade_id,
                      TradeEvent.event_type.in_(ATTESTED_EVENT_TYPES))
              .order_by(desc(TradeEvent.event_seq))
              .first())


def current_attestation(db: Session, trade_id: UUID) -> Optional[dict]:
    ev = latest_attested_event(db, trade_id)
    att = (ev.payload or {}).get("attestation") if ev else None
    return att or None


def anchored_attestation(db: Session, trade_id: UUID) -> Optional[dict]:
    """The current attestation only if it is actually on a chain."""
    att = current_attestation(db, trade_id)
    if att and (att.get("anchor") or {}).get("anchored"):
        return att
    return None


def package_of(att: Optional[dict]) -> Optional[dict]:
    """The package block of an attestation: the trade was confirmed as one leg of a package (chain/canonical.py),
    so what the registry holds is the package's hash, not the trade's own."""
    pk = (att or {}).get("package")
    return pk if isinstance(pk, dict) and pk.get("hash") else None


def anchored_hash(att: Optional[dict]) -> Optional[str]:
    """The hash the registry holds for this attestation: the package's for a leg of a package, else the trade's."""
    pk = package_of(att)
    return pk["hash"] if pk else (att or {}).get("trade_hash")


def refuse_package_leg(db: Session, trade, what: str) -> None:
    """409 for a lifecycle step on ONE leg of a package confirmed as one record. The registry holds the package's
    hash; superseding or closing a single leg means a new package record signed by both, which is not built yet."""
    pk = package_of(current_attestation(db, trade.id))
    if pk is None:
        return
    raise HTTPException(
        status_code=409,
        detail=(f"{trade.trade_ref} was confirmed as leg {pk.get('leg')} of {pk.get('of')} of package {pk.get('trade_id') or pk['hash'][:12] + '…'}: "
                f"one record on chain for the whole package. {what} one leg of a package on its own is not built yet."),
    )


def whole_pending_package(db: Session, trade) -> Optional[tuple]:
    """(the package's trade ID, the number of legs) when `trade` is a leg of a package the server booked and every
    one of its legs is still PENDING, so the package can be confirmed as one record; else None."""
    from api.routes._package import read_package_tag
    from db.models import Trade
    tag = read_package_tag(getattr(trade, "strategy", None))
    if tag is None:
        return None
    _structure, package_id, _i, n = tag
    legs = db.query(Trade).filter(Trade.user_id == trade.user_id, Trade.trade_ref.like(package_id + "-%")).all()
    mine = [t for t in legs if (read_package_tag(t.strategy) or (None, None, None, None))[1] == package_id]
    if len(mine) == n and all(t.status == "PENDING" for t in mine):
        return package_id, n
    return None


def refuse_one_leg_of_a_whole_package(db: Session, trade) -> None:
    """409 for an on-chain confirmation of ONE leg while its package can still be confirmed as one record: a leg
    anchored alone would leave the package unable ever to be. Once a leg has gone its own way (cancelled, confirmed
    off-chain) the others are confirmed one by one, as before."""
    whole = whole_pending_package(db, trade)
    if whole is None:
        return
    package_id, n = whole
    raise HTTPException(
        status_code=409,
        detail=(f"{trade.trade_ref} is a leg of package {package_id}, whose {n} legs are all pending: confirm the package "
                f"as one record (POST /api/chain/confirm-package with its {n} trade ids), not one leg alone."),
    )


def is_terminated(att: Optional[dict]) -> bool:
    return bool(att and att.get("terminated"))


def refuse_offchain_mutation(db: Session, trade, what: str) -> None:
    """
    409 if this trade's terms are anchored on-chain. `what` names the
    attempted change for the message.
    """
    att = anchored_attestation(db, trade.id)
    if att is None:
        return
    a = att.get("anchor") or {}
    pk = package_of(att)
    if pk:
        raise HTTPException(
            status_code=409,
            detail=(f"{trade.trade_ref} is confirmed on-chain as leg {pk.get('leg')} of {pk.get('of')} of package "
                    f"{pk.get('trade_id') or ''} (block {a.get('block_number')}). {what} would leave the signed record out of "
                    f"step with the booking, and one leg of a package cannot be amended or terminated on its own yet."),
        )
    raise HTTPException(
        status_code=409,
        detail=(f"{trade.trade_ref} is confirmed on-chain (block {a.get('block_number')}, "
                f"hash {att.get('trade_hash', '')[:12]}…). {what} would leave the signed record "
                f"out of step with the booking. Amend it with POST /api/chain/amend/{trade.id} "
                f"or close it with POST /api/chain/terminate/{trade.id}; both need the "
                f"counterparty's signature."),
    )
