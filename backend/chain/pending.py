"""Anchors in flight: a confirm whose transaction was sent but not mined within the request's wait.

POST /api/chain/confirm sends the transaction and waits RIJEKA_CHAIN_SYNC_WAIT_S (25 s) for the
receipt. Mined in time: the CONFIRMED event is written in the request, as always. Not mined: the
signed record (parties, signatures, EIP-712 domain) goes into pending_anchors with the transaction
hash, the route answers 202 and the trade stays PENDING. From then on `resolve()` follows the
transaction, from the scheduler (`reconcile_pending`, every cycle) and from
POST /api/chain/reconcile/{trade_id} (`reconcile_trade`, which the trade window polls), and when
the registry holds the record or the receipt arrives it applies the very same lifecycle transition
the synchronous path applies: one CONFIRMED event with the attestation, the anchor read back
from the chain. A reverted or dropped transaction marks the row FAILED with the reason and the
trade stays PENDING for another attempt.

Two reconcilers may look at one row at once: the row is taken FOR UPDATE and flipped to ANCHORED
in the same transaction as the CONFIRMED event, so the transition is applied once, and the loser
finds the row no longer PENDING.

Without the table (docs/migrations/2026-11-11_pending_anchors.sql) `sync_wait()` is None and confirm waits
the full RECEIPT_TIMEOUT in the request, as before this module existed.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text

from chain.attestation import AnchorReceipt

log = logging.getLogger("rijeka.chain")

DEFAULT_SYNC_WAIT_S = 25.0
DROPPED_AFTER_S = 15 * 60          # a hash the node no longer knows, this long after the send: dropped
NO_HASH_AFTER_S = 30 * 60          # no hash and no registry record this long after the send
MAX_AGE_S = 2 * 3600               # still in the mempool after this: give up, the trade stays PENDING
_table: dict[str, Any] = {"at": 0.0, "present": None}
COLUMNS = ("id, trade_id, user_id, kind, trade_hash, tx_hash, explorer_tx, attestation, idempotency_key, status, reason, "
           "submitted_at, checked_at, resolved_at, attempts")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _rollback(db) -> None:
    try:
        db.rollback()
    except Exception:                    # noqa: BLE001
        pass


def tables_present(db) -> bool:
    """Whether pending_anchors exists. Only a yes is remembered (five minutes): a no is asked again every time, so
    a migration applied while the API runs is seen at the next confirm and not up to five minutes late."""
    if _table["present"] and time.time() - _table["at"] < 300:
        return True
    try:
        ok = bool(db.execute(text("SELECT to_regclass('public.pending_anchors')")).scalar())
    except Exception:                    # noqa: BLE001
        _rollback(db)
        ok = False
    _table.update(at=time.time(), present=ok)
    return ok


def sync_wait(db) -> Optional[float]:
    """Seconds the confirm request waits for the receipt before handing the anchor to this module;
    None (the backend's full timeout) when the table is missing or RIJEKA_CHAIN_SYNC_WAIT_S is 0."""
    if not tables_present(db):
        return None
    raw = (os.getenv("RIJEKA_CHAIN_SYNC_WAIT_S") or "").strip()
    try:
        v = float(raw) if raw else DEFAULT_SYNC_WAIT_S
    except ValueError:
        v = DEFAULT_SYNC_WAIT_S
    return v if v > 0 else None


def _row(r) -> Optional[dict]:
    if r is None:
        return None
    m = r._mapping if hasattr(r, "_mapping") else r
    out = {k: m[k] for k in m.keys()}
    if isinstance(out.get("attestation"), str):
        try:
            out["attestation"] = json.loads(out["attestation"])
        except ValueError:
            pass
    for k in ("id", "trade_id", "user_id"):
        out[k] = str(out[k])
    return out


def _iso(v) -> Optional[str]:
    return v.isoformat() if hasattr(v, "isoformat") else (str(v) if v is not None else None)


# ── rows ─────────────────────────────────────────────────────────────────────

def record(db, *, trade_id, user_id, trade_hash: str, attestation: dict, idempotency_key: Optional[str],
           tx_hash: Optional[str], explorer_tx: Optional[str], note: Optional[str] = None) -> dict:
    """Insert the pending row (or refresh the open one for the trade); commits; returns the row."""
    r = db.execute(text(
        "INSERT INTO pending_anchors (trade_id, user_id, kind, trade_hash, tx_hash, explorer_tx, attestation, idempotency_key, status, reason, submitted_at) "
        "VALUES (:t, :u, 'confirm', :h, :tx, :ex, CAST(:a AS jsonb), :k, 'PENDING', :n, :now) "
        "ON CONFLICT (trade_id) WHERE status = 'PENDING' DO UPDATE SET tx_hash = COALESCE(EXCLUDED.tx_hash, pending_anchors.tx_hash), "
        "explorer_tx = COALESCE(EXCLUDED.explorer_tx, pending_anchors.explorer_tx), attestation = EXCLUDED.attestation, "
        "idempotency_key = COALESCE(EXCLUDED.idempotency_key, pending_anchors.idempotency_key), reason = EXCLUDED.reason "
        f"RETURNING {COLUMNS}"),
        {"t": str(trade_id), "u": str(user_id), "h": trade_hash, "tx": tx_hash, "ex": explorer_tx,
         "a": json.dumps(attestation, default=str), "k": idempotency_key, "n": note, "now": _now()}).first()
    db.commit()
    return _row(r)


def open_for_trade(db, trade_id) -> Optional[dict]:
    r = db.execute(text(f"SELECT {COLUMNS} FROM pending_anchors WHERE trade_id = :t AND status = 'PENDING'"), {"t": str(trade_id)}).first()
    return _row(r)


def latest_for_trade(db, trade_id) -> Optional[dict]:
    r = db.execute(text(f"SELECT {COLUMNS} FROM pending_anchors WHERE trade_id = :t ORDER BY submitted_at DESC LIMIT 1"), {"t": str(trade_id)}).first()
    return _row(r)


def open_rows(db, limit: int = 50) -> list[dict]:
    rs = db.execute(text(f"SELECT {COLUMNS} FROM pending_anchors WHERE status = 'PENDING' ORDER BY submitted_at ASC LIMIT :n"), {"n": limit}).all()
    return [_row(r) for r in rs]


def public(row: Optional[dict]) -> Optional[dict]:
    """The row as the API shows it: no signatures, no key material."""
    if row is None:
        return None
    return {"trade_id": row["trade_id"], "trade_hash": row["trade_hash"], "tx_hash": row.get("tx_hash"), "explorer_tx": row.get("explorer_tx"),
            "status": row["status"], "reason": row.get("reason"), "submitted_at": _iso(row.get("submitted_at")),
            "checked_at": _iso(row.get("checked_at")), "attempts": int(row.get("attempts") or 0)}


# ── the check against the chain ──────────────────────────────────────────────

def check(be, row: dict, now: Optional[datetime] = None) -> tuple[str, Any]:
    """("anchored", AnchorReceipt) | ("pending", note) | ("failed", reason), from the registry record first
    (the truth, whoever sent the transaction) and the transaction's state second."""
    now = now or _now()
    sub = row.get("submitted_at")
    sub = sub if getattr(sub, "tzinfo", None) else (sub.replace(tzinfo=timezone.utc) if sub else now)
    age = (now - sub).total_seconds()
    tx = row.get("tx_hash")
    rec = None
    try:
        rec = be.get(bytes.fromhex(row["trade_hash"][2:]))
    except Exception as e:               # noqa: BLE001 — a node hiccup is not an answer
        log.info("chain: pending %s registry read failed: %s", row["trade_id"][:8], type(e).__name__)
    st: dict = {"state": "unknown"}
    if tx:
        try:
            st = be.tx_state(tx) or st
        except Exception as e:           # noqa: BLE001
            log.info("chain: pending %s tx state read failed: %s", row["trade_id"][:8], type(e).__name__)
            st = {"state": "error"}
    chain_id, registry, explorer = be.chain_id, be.registry, getattr(be, "explorer", None)
    if rec is not None and getattr(rec, "status", "None") != "None":
        if st.get("state") == "mined":
            return "anchored", AnchorReceipt(True, chain_id, registry, tx, int(st["block_number"]), int(st.get("confirmed_at") or rec.confirmed_at), row.get("explorer_tx"))
        return "anchored", AnchorReceipt(True, chain_id, registry, tx, int(rec.block_number), int(rec.confirmed_at),
                                         row.get("explorer_tx") or (f"{explorer}/address/{registry}" if explorer else None),
                                         note="recorded on the registry; the anchor is read from the record")
    state = st.get("state")
    if state == "mined":                 # the receipt says success: the record is there, the read lagged
        return "anchored", AnchorReceipt(True, chain_id, registry, tx, int(st["block_number"]), int(st.get("confirmed_at") or 0), row.get("explorer_tx"),
                                         note="mined; the registry read had not caught up when the anchor was taken")
    if state == "reverted":
        return "failed", f"transaction {tx} reverted in block {st.get('block_number')}; the registry has no record"
    if age > MAX_AGE_S:
        return "failed", f"not mined after {MAX_AGE_S // 3600} hours; the registry has no record"
    if state == "pending":
        return "pending", "the node holds the transaction; waiting for a block"
    if tx and state == "unknown" and age > DROPPED_AFTER_S:
        return "failed", f"transaction {tx} is no longer known to the node after {DROPPED_AFTER_S // 60} minutes (dropped); the registry has no record"
    if not tx and age > NO_HASH_AFTER_S:
        return "failed", f"no transaction hash and no registry record after {NO_HASH_AFTER_S // 60} minutes"
    return "pending", "waiting for the transaction to be mined" if tx else "waiting for the registry record"


# ── applying the result ──────────────────────────────────────────────────────

def apply_confirmed(db, trade, attestation: dict, trade_hash: str, idempotency_key: Optional[str], user_id=None) -> dict:
    """The one transition both the synchronous confirm and the reconciliation apply."""
    from api.routes.trade_events import _apply_lifecycle_transition
    return _apply_lifecycle_transition(
        db=db, user_id=user_id if user_id is not None else trade.user_id, trade=trade,
        event_type="CONFIRMED", new_status="CONFIRMED",
        payload={"attestation": attestation},
        idempotency_key=idempotency_key,
        confirmation_hash=trade_hash,
        counterparty_confirmed=True,
    )


def _load_trade(db, trade_id):
    from db.models import Trade
    return db.query(Trade).filter(Trade.id == UUID(str(trade_id))).first()


def resolve(db, row_id: str, be, now: Optional[datetime] = None) -> dict:
    """Check one pending row and act on it. Returns
    {"outcome": "applied", "result": lifecycle response} when the CONFIRMED event was written here,
    {"outcome": "pending", "row"} while the transaction is in flight,
    {"outcome": "failed", "row"} when it reverted or was dropped,
    {"outcome": "gone", "row"} when another reconciler got there first or the trade is no longer PENDING."""
    locked = _row(db.execute(text(f"SELECT {COLUMNS} FROM pending_anchors WHERE id = :id AND status = 'PENDING' FOR UPDATE"), {"id": str(row_id)}).first())
    if locked is None:
        db.commit()
        r = db.execute(text(f"SELECT {COLUMNS} FROM pending_anchors WHERE id = :id"), {"id": str(row_id)}).first()
        return {"outcome": "gone", "row": _row(r)}
    now = now or _now()
    try:
        state, detail = check(be, locked, now)
    except Exception as e:               # noqa: BLE001 — the check itself failed: count the attempt, try again next cycle
        _rollback(db)
        db.execute(text("UPDATE pending_anchors SET attempts = attempts + 1, checked_at = :t WHERE id = :id"), {"t": now, "id": locked["id"]}); db.commit()
        log.warning("chain: pending %s check failed: %s", locked["trade_id"][:8], type(e).__name__)
        return {"outcome": "pending", "row": {**locked, "attempts": int(locked.get("attempts") or 0) + 1}}
    if state == "pending":
        db.execute(text("UPDATE pending_anchors SET attempts = attempts + 1, checked_at = :t, reason = :r WHERE id = :id"),
                   {"t": now, "r": str(detail)[:300], "id": locked["id"]}); db.commit()
        return {"outcome": "pending", "row": {**locked, "attempts": int(locked.get("attempts") or 0) + 1, "reason": detail}}
    if state == "failed":
        db.execute(text("UPDATE pending_anchors SET status = 'FAILED', attempts = attempts + 1, checked_at = :t, resolved_at = :t, reason = :r WHERE id = :id"),
                   {"t": now, "r": str(detail)[:300], "id": locked["id"]}); db.commit()
        log.warning("chain: anchor for trade %s failed: %s", locked["trade_id"][:8], detail)
        return {"outcome": "failed", "row": {**locked, "status": "FAILED", "reason": detail}}
    # anchored: flip the row and write the event in one transaction
    receipt: AnchorReceipt = detail
    trade = _load_trade(db, locked["trade_id"])
    if trade is None or trade.status != "PENDING":
        why = "trade not found" if trade is None else f"trade already {trade.status}"
        db.execute(text("UPDATE pending_anchors SET status = 'ANCHORED', attempts = attempts + 1, checked_at = :t, resolved_at = :t, reason = :r WHERE id = :id"),
                   {"t": now, "r": why, "id": locked["id"]}); db.commit()
        return {"outcome": "gone", "row": {**locked, "status": "ANCHORED", "reason": why}}
    db.execute(text("UPDATE pending_anchors SET status = 'ANCHORED', attempts = attempts + 1, checked_at = :t, resolved_at = :t, reason = NULL WHERE id = :id"),
               {"t": now, "id": locked["id"]})
    attestation = {**(locked.get("attestation") or {}), "anchor": receipt.to_dict()}
    try:
        result = apply_confirmed(db, trade, attestation, locked["trade_hash"], locked.get("idempotency_key"))
    except Exception:
        _rollback(db)                    # the row is PENDING again with the event unwritten
        db.execute(text("UPDATE pending_anchors SET attempts = attempts + 1, checked_at = :t WHERE id = :id"), {"t": now, "id": locked["id"]}); db.commit()
        raise
    log.info("chain: trade %s confirmed by reconciliation (tx %s, block %s)", locked["trade_id"][:8], receipt.tx_hash, receipt.block_number)
    return {"outcome": "applied", "result": result, "row": {**locked, "status": "ANCHORED"}}


# ── entry points ─────────────────────────────────────────────────────────────

def reconcile_trade(db, trade, be, now: Optional[datetime] = None) -> dict:
    """For POST /api/chain/reconcile/{trade_id} and the confirm route's in-flight guard. The response
    the trade window polls: pending (with the transaction), applied (with the trade), failed (with the
    reason), or nothing in flight."""
    row = open_for_trade(db, trade.id)
    if row is None:
        last = latest_for_trade(db, trade.id)
        if last and last["status"] == "FAILED":
            return {"pending": False, "applied": False, "failed": True, "status": trade.status, "reason": last.get("reason"), "anchor": public(last)}
        return {"pending": False, "applied": False, "status": trade.status, "note": "no anchoring in flight", "anchor": public(last)}
    out = resolve(db, row["id"], be, now)
    if out["outcome"] == "applied":
        return {"pending": False, "applied": True, "status": "CONFIRMED", **out["result"], "anchor": public(out["row"])}
    if out["outcome"] == "failed":
        return {"pending": False, "applied": False, "failed": True, "status": "PENDING", "reason": out["row"].get("reason"), "anchor": public(out["row"])}
    if out["outcome"] == "gone":
        t = _load_trade(db, trade.id)
        return {"pending": False, "applied": False, "status": t.status if t else trade.status, "anchor": public(out.get("row"))}
    r = out["row"]
    return {"pending": True, "applied": False, "status": "PENDING", "tx_hash": r.get("tx_hash"), "explorer_tx": r.get("explorer_tx"),
            "note": r.get("reason"), "anchor": public(r)}


def reconcile_pending(db, be=None, limit: int = 50, now: Optional[datetime] = None) -> dict:
    """The scheduler step: every open row once. Never raises for one row; the summary says what happened."""
    if not tables_present(db):
        return {"skipped": "pending_anchors table missing"}
    if be is None:
        from chain.attestation import get_backend
        be = get_backend()
    rows = open_rows(db, limit)
    if not rows:
        return {"open": 0}
    if not getattr(be, "anchored", False):
        return {"open": len(rows), "skipped": "no chain backend in this process"}
    counts = {"open": len(rows), "applied": 0, "pending": 0, "failed": 0, "gone": 0, "errors": 0}
    for row in rows:
        try:
            counts[resolve(db, row["id"], be, now)["outcome"]] += 1
        except Exception as e:           # noqa: BLE001
            _rollback(db)
            counts["errors"] += 1
            log.warning("chain: reconcile of trade %s failed: %s: %s", row["trade_id"][:8], type(e).__name__, str(e)[:200])
    return counts
