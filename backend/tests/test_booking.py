"""
Rijeka — tests for atomic booking pure functions
Sprint 12 item 3.

Tests the pure helpers (build_booked_payload, validators) that don't
require a DB. Full integration tests (roundtrip POST /api/book/trade,
RLS, idempotency races) land with Sprint 12 item 11 (test harness).
"""

import pytest
from uuid import UUID, uuid4
from decimal import Decimal
from datetime import date

from api.routes.booking import BookingRequest, LegInput, build_booked_payload
from projections.trade_projection import project, EventLike


# ── Helpers ───────────────────────────────────────────────────

def _valid_body(**overrides):
    """Minimal valid BookingRequest for testing."""
    base = dict(
        asset_class="RATES",
        instrument_type="IR_SWAP",
        structure="VANILLA",
        notional=Decimal("10000000"),
        notional_ccy="USD",
        trade_date=date(2026, 4, 20),
        effective_date=date(2026, 4, 22),
        maturity_date=date(2031, 4, 22),
        terms={"direction": "PAY"},
        legs=[
            LegInput(
                leg_ref="FIXED-1",
                leg_seq=1,
                leg_type="FIXED",
                direction="PAY",
                currency="USD",
                notional=Decimal("10000000"),
                fixed_rate=Decimal("0.03665"),
            ),
            LegInput(
                leg_ref="FLOAT-1",
                leg_seq=2,
                leg_type="FLOAT",
                direction="RECEIVE",
                currency="USD",
                notional=Decimal("10000000"),
                spread=Decimal("0"),
                forecast_curve_id="USD_SOFR",
            ),
        ],
    )
    base.update(overrides)
    return BookingRequest(**base)


# ── Validator tests ───────────────────────────────────────────

class TestValidators:
    def test_valid_body_constructs(self):
        b = _valid_body()
        assert b.asset_class == "RATES"
        assert len(b.legs) == 2

    def test_negative_notional_rejected(self):
        with pytest.raises(ValueError, match="notional must be > 0"):
            _valid_body(notional=Decimal("-1"))

    def test_zero_notional_rejected(self):
        with pytest.raises(ValueError, match="notional must be > 0"):
            _valid_body(notional=Decimal("0"))

    def test_empty_legs_rejected(self):
        with pytest.raises(ValueError, match="at least one leg"):
            _valid_body(legs=[])

    def test_maturity_before_effective_rejected(self):
        with pytest.raises(ValueError, match="effective_date must be on or before maturity_date"):
            _valid_body(
                effective_date=date(2031, 4, 22),
                maturity_date=date(2026, 4, 22),
            )

    def test_effective_equals_maturity_allowed(self):
        # Edge case: 0-day trade is valid syntactically; semantics can reject later.
        b = _valid_body(
            effective_date=date(2026, 4, 22),
            maturity_date=date(2026, 4, 22),
        )
        assert b.effective_date == b.maturity_date


class TestLegValidators:
    def test_invalid_direction_rejected(self):
        with pytest.raises(ValueError, match="direction must be PAY or RECEIVE"):
            LegInput(
                leg_ref="X", leg_type="FIXED", direction="BOTH",
                currency="USD",
            )

    def test_pay_accepted(self):
        l = LegInput(leg_ref="X", leg_type="FIXED", direction="PAY", currency="USD")
        assert l.direction == "PAY"

    def test_receive_accepted(self):
        l = LegInput(leg_ref="X", leg_type="FIXED", direction="RECEIVE", currency="USD")
        assert l.direction == "RECEIVE"


# ── build_booked_payload tests ────────────────────────────────

class TestBuildBookedPayload:
    def test_payload_shape(self):
        body = _valid_body()
        trade_id = uuid4()
        leg_ids = [uuid4(), uuid4()]
        p = build_booked_payload(body, trade_id, leg_ids)

        assert set(p.keys()) == {"trade", "legs", "cashflows"}
        assert isinstance(p["trade"], dict)
        assert isinstance(p["legs"], list)
        assert p["cashflows"] == []

    def test_trade_id_embedded(self):
        body = _valid_body()
        trade_id = uuid4()
        p = build_booked_payload(body, trade_id, [uuid4(), uuid4()])
        assert p["trade"]["id"] == str(trade_id)

    def test_leg_ids_embedded(self):
        body = _valid_body()
        trade_id = uuid4()
        leg_ids = [uuid4(), uuid4()]
        p = build_booked_payload(body, trade_id, leg_ids)
        assert p["legs"][0]["id"] == str(leg_ids[0])
        assert p["legs"][1]["id"] == str(leg_ids[1])
        assert all(l["trade_id"] == str(trade_id) for l in p["legs"])

    def test_decimals_converted_to_float(self):
        body = _valid_body()
        p = build_booked_payload(body, uuid4(), [uuid4(), uuid4()])
        # Decimal -> float for JSONB safety
        assert isinstance(p["trade"]["notional"], float)
        assert p["trade"]["notional"] == 10_000_000.0
        assert isinstance(p["legs"][0]["fixed_rate"], float)
        assert p["legs"][0]["fixed_rate"] == 0.03665

    def test_dates_isoformatted(self):
        body = _valid_body()
        p = build_booked_payload(body, uuid4(), [uuid4(), uuid4()])
        assert p["trade"]["trade_date"] == "2026-04-20"
        assert p["trade"]["effective_date"] == "2026-04-22"
        assert p["trade"]["maturity_date"] == "2031-04-22"

    def test_leg_count_matches_body(self):
        body = _valid_body()
        p = build_booked_payload(body, uuid4(), [uuid4(), uuid4()])
        assert len(p["legs"]) == len(body.legs)


# ── Roundtrip: build_booked_payload → project → same trade ────

class TestRoundtripWithProjection:
    """
    Charter §1.1: 'replaying the event stream from BOOKED reconstructs
    the current projection byte-identically.' This is the smoke test.
    """

    def test_booked_payload_projects_to_trade(self):
        body = _valid_body()
        trade_id = uuid4()
        leg_ids = [uuid4(), uuid4()]
        payload = build_booked_payload(body, trade_id, leg_ids)

        event = EventLike(event_seq=1, event_type="BOOKED", payload=payload)
        proj = project([event])

        # Trade projected with status=PENDING, correct id and ref
        assert proj["trade"]["id"] == str(trade_id)
        assert proj["trade"]["status"] == "PENDING"
        assert proj["trade"]["asset_class"] == "RATES"
        assert proj["trade"]["instrument_type"] == "IR_SWAP"
        assert proj["trade"]["structure"] == "VANILLA"

    def test_legs_project_in_order(self):
        body = _valid_body()
        leg_ids = [uuid4(), uuid4()]
        payload = build_booked_payload(body, uuid4(), leg_ids)

        event = EventLike(event_seq=1, event_type="BOOKED", payload=payload)
        proj = project([event])

        assert len(proj["legs"]) == 2
        assert proj["legs"][0]["leg_ref"] == "FIXED-1"
        assert proj["legs"][1]["leg_ref"] == "FLOAT-1"

    def test_subsequent_confirmed_transitions_status(self):
        body = _valid_body()
        payload = build_booked_payload(body, uuid4(), [uuid4(), uuid4()])

        events = [
            EventLike(event_seq=1, event_type="BOOKED", payload=payload),
            EventLike(event_seq=2, event_type="CONFIRMED", payload={}),
        ]
        proj = project(events)
        assert proj["trade"]["status"] == "CONFIRMED"
