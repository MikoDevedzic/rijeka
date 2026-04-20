"""
Rijeka — tests for trade_projection
Sprint 12 item 2.

Invariants tested (charter §1.1):
  - Determinism: same events -> byte-identical projection
  - Monotonicity: event_seq must be 1, 2, 3, ... (no gaps, no disorder)
  - Purity: projection doesn't mutate input events
  - BOOKED first or not at all
  - Event before BOOKED rejected
  - Unknown event types rejected

Pytest-only. Runs without DB. No fixtures needed.
"""

import pytest
from projections.trade_projection import (
    project,
    empty_projection,
    EventLike,
    EventType,
    ProjectionError,
)


# ── Helpers ───────────────────────────────────────────────────────────

def booked(seq=1, trade_id="t-1", ref="TRD-00000001", **extra):
    return EventLike(
        event_seq=seq,
        event_type="BOOKED",
        payload={
            "trade": {
                "id":              trade_id,
                "trade_ref":       ref,
                "asset_class":     "RATES",
                "instrument_type": "IR_SWAP",
                "structure":       "VANILLA",
                "counterparty_id": "cp-1",
                "notional":        10_000_000,
                "notional_ccy":    "USD",
                "terms":           {},
                "book":            "DESK-A",
                "store":           "WORKING",
                **extra,
            },
            "legs": [],
            "cashflows": [],
        },
    )


def ev(seq, et, **payload):
    return EventLike(event_seq=seq, event_type=et, payload=payload)


# ── Entry-point behaviour ─────────────────────────────────────────────

class TestEmptyStream:
    def test_returns_empty_projection(self):
        assert project([]) == empty_projection()

    def test_empty_projection_shape(self):
        p = empty_projection()
        assert p == {"trade": None, "legs": [], "cashflows": []}


class TestBooked:
    def test_populates_trade(self):
        p = project([booked(ref="TRD-123")])
        assert p["trade"]["trade_ref"] == "TRD-123"

    def test_status_forced_pending(self):
        # Even if payload.trade.status claims LIVE, BOOKED sets PENDING.
        e = booked()
        e.payload["trade"]["status"] = "LIVE"
        assert project([e])["trade"]["status"] == "PENDING"

    def test_legs_and_cashflows_carried(self):
        e = booked()
        e.payload["legs"] = [{"id": "leg-1", "leg_ref": "L1", "direction": "PAY"}]
        e.payload["cashflows"] = [{"id": "cf-1", "amount": 100}]
        p = project([e])
        assert len(p["legs"]) == 1
        assert len(p["cashflows"]) == 1
        assert p["legs"][0]["leg_ref"] == "L1"

    def test_missing_trade_dict_rejected(self):
        e = EventLike(event_seq=1, event_type="BOOKED", payload={})
        with pytest.raises(ProjectionError, match="must include 'trade'"):
            project([e])

    def test_double_booked_rejected(self):
        with pytest.raises(ProjectionError, match="already booked"):
            project([booked(1), booked(2)])


class TestStatusTransitions:
    def test_confirmed(self):
        p = project([booked(1), ev(2, "CONFIRMED")])
        assert p["trade"]["status"] == "CONFIRMED"

    def test_activated(self):
        p = project([booked(1), ev(2, "ACTIVATED")])
        assert p["trade"]["status"] == "LIVE"

    def test_full_lifecycle(self):
        events = [
            booked(1),
            ev(2, "CONFIRMED"),
            ev(3, "ACTIVATED"),
            ev(4, "MATURED"),
        ]
        assert project(events)["trade"]["status"] == "MATURED"

    def test_terminated(self):
        events = [booked(1), ev(2, "ACTIVATED"), ev(3, "TERMINATED")]
        assert project(events)["trade"]["status"] == "TERMINATED"

    def test_cancelled(self):
        p = project([booked(1), ev(2, "CANCELLED")])
        assert p["trade"]["status"] == "CANCELLED"

    def test_defaulted(self):
        events = [booked(1), ev(2, "ACTIVATED"), ev(3, "DEFAULTED")]
        assert project(events)["trade"]["status"] == "DEFAULTED"


class TestAmended:
    def test_updates_trade_field(self):
        events = [
            booked(1),
            ev(2, "AMENDED", changes={"trade": {"desk": "NYC"}}),
        ]
        assert project(events)["trade"]["desk"] == "NYC"

    def test_updates_leg_by_id(self):
        b = booked(1)
        b.payload["legs"] = [{"id": "leg-1", "spread": 0.0}]
        events = [
            b,
            ev(2, "AMENDED", changes={"legs": [{"id": "leg-1", "spread": 0.0025}]}),
        ]
        p = project(events)
        assert p["legs"][0]["spread"] == 0.0025

    def test_ignores_unknown_leg_id(self):
        b = booked(1)
        b.payload["legs"] = [{"id": "leg-1", "spread": 0}]
        events = [
            b,
            ev(2, "AMENDED", changes={"legs": [{"id": "leg-UNKNOWN", "spread": 99}]}),
        ]
        # Unknown leg silently ignored (legs without matching id stay untouched).
        # This is deliberate — AMENDED on an unknown leg is a caller bug, but
        # projection doesn't raise because the invariant is "legs by id", not
        # "all leg updates must match".
        assert project(events)["legs"][0]["spread"] == 0

    def test_empty_changes_is_noop(self):
        events = [booked(1), ev(2, "AMENDED", changes={})]
        assert project(events)["trade"]["trade_ref"] == "TRD-00000001"


class TestBookTransfer:
    def test_updates_book(self):
        events = [booked(1), ev(2, "BOOK_TRANSFER", new_book="DESK-B")]
        assert project(events)["trade"]["book"] == "DESK-B"

    def test_missing_new_book_rejected(self):
        events = [booked(1), ev(2, "BOOK_TRANSFER")]
        with pytest.raises(ProjectionError, match="'new_book'"):
            project(events)


class TestStoreChange:
    def test_updates_store(self):
        events = [booked(1), ev(2, "STORE_CHANGE", new_store="PRODUCTION")]
        assert project(events)["trade"]["store"] == "PRODUCTION"


class TestPartialTermination:
    def test_reduces_leg_notional(self):
        b = booked(1)
        b.payload["legs"] = [{"id": "leg-1", "notional": 10_000_000}]
        events = [
            b,
            ev(2, "PARTIAL_TERMINATION", leg_id="leg-1", new_notional=6_000_000),
        ]
        assert project(events)["legs"][0]["notional"] == 6_000_000

    def test_unknown_leg_rejected(self):
        events = [
            booked(1),
            ev(2, "PARTIAL_TERMINATION", leg_id="leg-X", new_notional=1),
        ]
        with pytest.raises(ProjectionError, match="unknown leg_id"):
            project(events)


class TestNovation:
    def test_changes_cp_and_status(self):
        events = [booked(1), ev(2, "NOVATED", new_counterparty_id="cp-2")]
        p = project(events)
        assert p["trade"]["counterparty_id"] == "cp-2"
        assert p["trade"]["status"] == "NOVATED"


class TestCreditEvent:
    def test_appends_to_terms(self):
        events = [
            booked(1),
            ev(2, "CREDIT_EVENT", as_of="2026-04-20", kind="downgrade", note="S&P A->BBB"),
        ]
        p = project(events)
        ce = p["trade"]["terms"]["credit_events"]
        assert len(ce) == 1
        assert ce[0]["kind"] == "downgrade"

    def test_multiple_credit_events_accumulate(self):
        events = [
            booked(1),
            ev(2, "CREDIT_EVENT", as_of="2026-04-20", kind="downgrade", note="A"),
            ev(3, "CREDIT_EVENT", as_of="2026-04-21", kind="downgrade", note="B"),
        ]
        assert len(project(events)["trade"]["terms"]["credit_events"]) == 2

    def test_does_not_change_status(self):
        events = [
            booked(1),
            ev(2, "ACTIVATED"),
            ev(3, "CREDIT_EVENT", as_of="2026-04-20", kind="downgrade", note="X"),
        ]
        assert project(events)["trade"]["status"] == "LIVE"


class TestCompression:
    def test_raises_not_implemented(self):
        events = [booked(1), ev(2, "COMPRESSION")]
        with pytest.raises(ProjectionError, match="not implemented"):
            project(events)


# ── Invariants (charter §1.1) ─────────────────────────────────────────

class TestInvariants:
    def test_monotonic_sequence_enforced(self):
        # Gap: 1, then 3
        events = [booked(1), ev(3, "CONFIRMED")]
        with pytest.raises(ProjectionError, match="gap/disorder"):
            project(events)

    def test_duplicate_seq_rejected(self):
        events = [booked(1), ev(1, "CONFIRMED")]
        with pytest.raises(ProjectionError, match="gap/disorder"):
            project(events)

    def test_must_start_at_seq_1(self):
        events = [booked(2)]
        with pytest.raises(ProjectionError, match="expected 1"):
            project(events)

    def test_determinism(self):
        events = [booked(1), ev(2, "CONFIRMED"), ev(3, "ACTIVATED")]
        assert project(events) == project(events)

    def test_input_not_mutated(self):
        events = [booked(1)]
        snapshot = {
            "seq":     events[0].event_seq,
            "type":    events[0].event_type,
            "payload": {**events[0].payload},
            "trade":   {**events[0].payload["trade"]},
        }
        project(events)
        assert events[0].event_seq == snapshot["seq"]
        assert events[0].event_type == snapshot["type"]
        assert events[0].payload["trade"] == snapshot["trade"]

    def test_projection_doesnt_share_refs_with_payload(self):
        """Mutating the returned projection must not affect future replays."""
        events = [booked(1)]
        p1 = project(events)
        p1["trade"]["trade_ref"] = "MUTATED"
        p2 = project(events)
        assert p2["trade"]["trade_ref"] == "TRD-00000001"


class TestRejections:
    def test_event_before_booked(self):
        events = [ev(1, "CONFIRMED")]
        with pytest.raises(ProjectionError, match="before BOOKED"):
            project(events)

    def test_unknown_event_type(self):
        events = [ev(1, "FLARGH")]
        with pytest.raises(ProjectionError, match="Unknown event_type"):
            project(events)


class TestEventLikeAdapter:
    def test_from_dict(self):
        e = EventLike.from_dict({
            "event_seq": 1,
            "event_type": "BOOKED",
            "payload": {"trade": {"id": "t"}},
        })
        assert e.event_seq == 1
        assert e.event_type == "BOOKED"

    def test_from_dict_handles_null_payload(self):
        e = EventLike.from_dict({"event_seq": 1, "event_type": "BOOKED", "payload": None})
        assert e.payload == {}
