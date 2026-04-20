"""
Rijeka — Trade event-stream projection
Sprint 12 item 2.

Pure function: events[] -> {trade, legs, cashflows}.

Charter §1.1 invariants enforced:
  - Deterministic: same events -> byte-identical projection
  - Replayable: replay from BOOKED reconstructs current state
  - Monotonic: event_seq strictly 1, 2, 3, ... (no gaps, no reorder)

This module has ZERO database imports. It takes duck-typed events
(anything with event_seq/event_type/payload) and returns a dict.
The DB layer adapts SQLAlchemy TradeEvent rows to EventLike and calls project().

Event payload contracts are defined per handler below. Authoritative.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Callable
from copy import deepcopy
from enum import Enum


# ────────────────────────────────────────────────────────────────────────────
# Event types — canonical superset. trade_events.py::VALID_EVENT_TYPES
# should import from here once Sprint 12 item 3 ships.
# ────────────────────────────────────────────────────────────────────────────
class EventType(str, Enum):
    BOOKED              = "BOOKED"
    CONFIRMED           = "CONFIRMED"       # new in Sprint 12 — closes BUG-L1
    ACTIVATED           = "ACTIVATED"
    AMENDED             = "AMENDED"
    BOOK_TRANSFER       = "BOOK_TRANSFER"
    STORE_CHANGE        = "STORE_CHANGE"
    PARTIAL_TERMINATION = "PARTIAL_TERMINATION"
    NOVATED             = "NOVATED"
    TERMINATED          = "TERMINATED"
    MATURED             = "MATURED"
    CANCELLED           = "CANCELLED"
    DEFAULTED           = "DEFAULTED"
    COMPRESSION         = "COMPRESSION"
    CREDIT_EVENT        = "CREDIT_EVENT"


# Events whose only effect on projection is a status transition on the trade.
_STATUS_ONLY: dict[EventType, str] = {
    EventType.CONFIRMED:  "CONFIRMED",
    EventType.ACTIVATED:  "LIVE",
    EventType.TERMINATED: "TERMINATED",
    EventType.MATURED:    "MATURED",
    EventType.CANCELLED:  "CANCELLED",
    EventType.DEFAULTED:  "DEFAULTED",
}


# ────────────────────────────────────────────────────────────────────────────
# Duck-typed event. Accepts SQLAlchemy TradeEvent rows via .from_row(),
# or plain dicts via .from_dict(). The projection never imports SQLAlchemy.
# ────────────────────────────────────────────────────────────────────────────
@dataclass
class EventLike:
    event_seq: int
    event_type: str
    payload: dict[str, Any]

    @classmethod
    def from_row(cls, row) -> "EventLike":
        return cls(
            event_seq=int(row.event_seq),
            event_type=str(row.event_type),
            payload=dict(row.payload or {}),
        )

    @classmethod
    def from_dict(cls, d: dict) -> "EventLike":
        return cls(
            event_seq=int(d["event_seq"]),
            event_type=str(d["event_type"]),
            payload=dict(d.get("payload") or {}),
        )


# Projection shape.
#   trade:      dict | None  — single row matching Trade projection
#   legs:       list[dict]   — rows matching TradeLeg projection, order preserved
#   cashflows:  list[dict]   — rows matching Cashflow projection, order preserved
Projection = dict[str, Any]


def empty_projection() -> Projection:
    return {"trade": None, "legs": [], "cashflows": []}


class ProjectionError(Exception):
    """Raised when an event stream can't be projected (bad order, bad payload,
    missing BOOKED, unknown event type, etc)."""


# ────────────────────────────────────────────────────────────────────────────
# Entry point
# ────────────────────────────────────────────────────────────────────────────
def project(events: list[EventLike]) -> Projection:
    """
    Fold an event stream into a projection.

    Input contract:
      - events sorted by event_seq ASC
      - event_seq strictly monotonic from 1 (no gaps, no duplicates)
      - first event MUST be BOOKED if any events are present

    Returns:
      empty_projection() if events is empty
      populated projection otherwise

    Raises:
      ProjectionError on invariant violation (gap, disorder, bad payload,
      unknown event type, event before BOOKED).
    """
    p = empty_projection()
    expected_seq = 1

    for e in events:
        if e.event_seq != expected_seq:
            raise ProjectionError(
                f"event_seq gap/disorder: expected {expected_seq}, got {e.event_seq}"
            )
        expected_seq += 1

        try:
            et = EventType(e.event_type)
        except ValueError:
            raise ProjectionError(f"Unknown event_type: {e.event_type!r}")

        p = _apply(p, et, e.payload)

    return p


# ────────────────────────────────────────────────────────────────────────────
# Dispatch
# ────────────────────────────────────────────────────────────────────────────
def _apply(p: Projection, et: EventType, payload: dict) -> Projection:
    # Purity: no caller ever observes in-place mutation of their input.
    p = deepcopy(p)

    if et == EventType.BOOKED:
        return _h_booked(p, payload)

    # Every non-BOOKED event requires an existing trade.
    if p["trade"] is None:
        raise ProjectionError(f"{et.value} received before BOOKED")

    if et in _STATUS_ONLY:
        p["trade"]["status"] = _STATUS_ONLY[et]
        return p

    handler = _COMPLEX_HANDLERS.get(et)
    if handler is None:
        raise ProjectionError(f"No handler registered for {et.value}")
    return handler(p, payload)


# ────────────────────────────────────────────────────────────────────────────
# Handlers — one per non-status-only event type
# ────────────────────────────────────────────────────────────────────────────

def _h_booked(p: Projection, payload: dict) -> Projection:
    """
    BOOKED payload contract:
      {
        "trade":     {...full trade row fields...},
        "legs":      [ {...full TradeLeg row fields...}, ... ],   # optional
        "cashflows": [ {...full Cashflow row fields...}, ... ],   # optional
      }
    Sets trade.status = "PENDING" regardless of what payload.trade.status
    contains — status is owned by the event stream, not BOOKED payload.
    """
    if p["trade"] is not None:
        raise ProjectionError("BOOKED received but trade is already booked")

    trade = payload.get("trade")
    if not isinstance(trade, dict):
        raise ProjectionError("BOOKED payload must include 'trade' dict")

    p["trade"] = dict(trade)
    p["trade"]["status"] = "PENDING"
    p["legs"] = [dict(leg) for leg in (payload.get("legs") or [])]
    p["cashflows"] = [dict(cf) for cf in (payload.get("cashflows") or [])]
    return p


def _h_amended(p: Projection, payload: dict) -> Projection:
    """
    AMENDED payload contract:
      {
        "changes": {
          "trade":     { field: value, ... },                        # optional
          "legs":      [ {"id": <leg_id>, field: value, ...}, ... ], # optional
          "cashflows": [ {"id": <cf_id>,  field: value, ...}, ... ], # optional
        }
      }
    Only fields present are updated. Missing fields stay at prior value.
    """
    changes = payload.get("changes") or {}

    for k, v in (changes.get("trade") or {}).items():
        p["trade"][k] = v

    leg_updates = {c["id"]: c for c in (changes.get("legs") or []) if "id" in c}
    for leg in p["legs"]:
        upd = leg_updates.get(leg.get("id"))
        if upd:
            for k, v in upd.items():
                if k != "id":
                    leg[k] = v

    cf_updates = {c["id"]: c for c in (changes.get("cashflows") or []) if "id" in c}
    for cf in p["cashflows"]:
        upd = cf_updates.get(cf.get("id"))
        if upd:
            for k, v in upd.items():
                if k != "id":
                    cf[k] = v

    return p


def _h_book_transfer(p: Projection, payload: dict) -> Projection:
    """BOOK_TRANSFER payload: {"new_book": "<name>"}"""
    new_book = payload.get("new_book")
    if new_book is None:
        raise ProjectionError("BOOK_TRANSFER payload missing 'new_book'")
    p["trade"]["book"] = new_book
    return p


def _h_store_change(p: Projection, payload: dict) -> Projection:
    """STORE_CHANGE payload: {"new_store": "<store>"}"""
    new_store = payload.get("new_store")
    if new_store is None:
        raise ProjectionError("STORE_CHANGE payload missing 'new_store'")
    p["trade"]["store"] = new_store
    return p


def _h_partial_termination(p: Projection, payload: dict) -> Projection:
    """
    PARTIAL_TERMINATION payload:
      {"leg_id": "<uuid>", "new_notional": <number>}
    """
    leg_id = payload.get("leg_id")
    new_notional = payload.get("new_notional")
    if leg_id is None or new_notional is None:
        raise ProjectionError(
            "PARTIAL_TERMINATION payload missing 'leg_id' or 'new_notional'"
        )

    for leg in p["legs"]:
        if leg.get("id") == leg_id:
            leg["notional"] = new_notional
            return p

    raise ProjectionError(f"PARTIAL_TERMINATION references unknown leg_id {leg_id}")


def _h_novated(p: Projection, payload: dict) -> Projection:
    """NOVATED payload: {"new_counterparty_id": "<uuid>"}. Also sets status=NOVATED."""
    new_cp = payload.get("new_counterparty_id")
    if new_cp is None:
        raise ProjectionError("NOVATED payload missing 'new_counterparty_id'")
    p["trade"]["counterparty_id"] = new_cp
    p["trade"]["status"] = "NOVATED"
    return p


def _h_credit_event(p: Projection, payload: dict) -> Projection:
    """
    CREDIT_EVENT payload: {"as_of": date, "kind": str, "note": str}
    Appended to trade.terms.credit_events[]. Does not mutate economics.
    """
    terms = dict(p["trade"].get("terms") or {})
    existing = list(terms.get("credit_events") or [])
    existing.append({
        "as_of": payload.get("as_of"),
        "kind":  payload.get("kind"),
        "note":  payload.get("note"),
    })
    terms["credit_events"] = existing
    p["trade"]["terms"] = terms
    return p


def _h_compression(p: Projection, payload: dict) -> Projection:
    """Not implemented — compression replaces multiple trades with one,
    which is a cross-trade operation beyond single-projection scope."""
    raise ProjectionError(
        "COMPRESSION handler not implemented — requires multi-trade context"
    )


_COMPLEX_HANDLERS: dict[EventType, Callable[[Projection, dict], Projection]] = {
    EventType.AMENDED:             _h_amended,
    EventType.BOOK_TRANSFER:       _h_book_transfer,
    EventType.STORE_CHANGE:        _h_store_change,
    EventType.PARTIAL_TERMINATION: _h_partial_termination,
    EventType.NOVATED:             _h_novated,
    EventType.CREDIT_EVENT:        _h_credit_event,
    EventType.COMPRESSION:         _h_compression,
}


# ────────────────────────────────────────────────────────────────────────────
# DB adapter — convenience for item 3 (atomic booking) and item 7 (shell re-open)
# ────────────────────────────────────────────────────────────────────────────
def project_from_db(session, trade_id) -> Projection:
    """
    Fetch all events for a trade ordered by event_seq, project them.
    Kept thin so the pure function stays testable without a DB.
    """
    from db.models import TradeEvent  # lazy import to keep pure module DB-free at import

    rows = (
        session.query(TradeEvent)
        .filter(TradeEvent.trade_id == trade_id)
        .order_by(TradeEvent.event_seq.asc())
        .all()
    )
    return project([EventLike.from_row(r) for r in rows])
