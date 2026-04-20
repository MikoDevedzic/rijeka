"""
Rijeka -- tests for atomic lifecycle endpoint pure functions
Sprint 12 item 3 sibling (CONFIRMED / CANCELLED).

Tests the pure helpers (role gate, UUID parsing, idempotency-key validation,
CancelRequest schema) and a projection-level roundtrip that confirms the
BOOKED -> CONFIRMED and BOOKED -> CANCELLED event streams reconstruct the
expected trade.status.

DB-dependent paths (_load_pending_trade, _lookup_idempotent,
_build_lifecycle_response, _apply_lifecycle_transition) are covered by
integration tests that land with Sprint 12 item 11 (test harness: pytest
+ Hypothesis + Vitest + Playwright).
"""

import pytest
from uuid import UUID, uuid4
from decimal import Decimal
from datetime import date

from fastapi import HTTPException

from api.routes.trade_events import (
    CancelRequest,
    VALID_EVENT_TYPES,
    _check_write_role,
    _parse_trade_uuid,
    _validate_idempotency_header,
)
from api.routes.booking import BookingRequest, LegInput, build_booked_payload
from projections.trade_projection import project, EventLike


# -- Helpers ------------------------------------------------------------

def _user(role: str = "trader", sub: str = None) -> dict:
    """Build a minimal auth-token payload that verify_token would return."""
    return {
        "sub": sub or str(uuid4()),
        "user_metadata": {"role": role},
    }


def _valid_booking_body(**overrides) -> BookingRequest:
    """Minimal valid BookingRequest; mirrors test_booking.py::_valid_body."""
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


# -- CancelRequest schema tests ----------------------------------------

class TestCancelRequestValidator:
    def test_missing_reason_is_optional(self):
        body = CancelRequest()
        assert body.reason is None

    def test_string_reason_accepted(self):
        body = CancelRequest(reason="counterparty pulled out")
        assert body.reason == "counterparty pulled out"

    def test_empty_string_reason_accepted(self):
        # Empty string is distinct from None; _apply_lifecycle_transition
        # short-circuits on `if body.reason` so empty string = no payload entry.
        body = CancelRequest(reason="")
        assert body.reason == ""

    def test_extra_fields_ignored(self):
        # Pydantic default is to ignore extras -- a client cannot sneak
        # an arbitrary payload shape past the schema.
        body = CancelRequest.model_validate({"reason": "x", "malicious": "y"})
        assert body.reason == "x"
        assert not hasattr(body, "malicious")


# -- Role gate tests ---------------------------------------------------

class TestCheckWriteRole:
    def test_trader_accepted(self):
        u = _user(role="trader")
        result = _check_write_role(u)
        assert isinstance(result, UUID)
        assert str(result) == u["sub"]

    def test_admin_accepted(self):
        u = _user(role="admin")
        result = _check_write_role(u)
        assert isinstance(result, UUID)

    def test_trader_uppercase_accepted(self):
        # Role comparison is case-insensitive (.lower() before membership check).
        u = _user(role="TRADER")
        _check_write_role(u)

    def test_viewer_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _check_write_role(_user(role="viewer"))
        assert exc.value.status_code == 403
        assert "Trader or Admin" in exc.value.detail

    def test_unknown_role_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _check_write_role(_user(role="risk_manager"))
        assert exc.value.status_code == 403

    def test_missing_role_defaults_to_viewer_and_rejected(self):
        # If user_metadata.role is absent, helper treats as "viewer" (rejected).
        u = {"sub": str(uuid4()), "user_metadata": {}}
        with pytest.raises(HTTPException) as exc:
            _check_write_role(u)
        assert exc.value.status_code == 403

    def test_missing_user_metadata_rejected(self):
        u = {"sub": str(uuid4())}
        with pytest.raises(HTTPException) as exc:
            _check_write_role(u)
        assert exc.value.status_code == 403


# -- UUID parsing tests ------------------------------------------------

class TestParseTradeUuid:
    def test_valid_uuid_parsed(self):
        tid = uuid4()
        result = _parse_trade_uuid(str(tid))
        assert result == tid

    def test_invalid_uuid_rejected_400(self):
        with pytest.raises(HTTPException) as exc:
            _parse_trade_uuid("not-a-uuid")
        assert exc.value.status_code == 400
        assert "UUID" in exc.value.detail

    def test_empty_string_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _parse_trade_uuid("")
        assert exc.value.status_code == 400

    def test_integer_like_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _parse_trade_uuid("12345")
        assert exc.value.status_code == 400


# -- Idempotency header tests ------------------------------------------

class TestValidateIdempotencyHeader:
    def test_none_accepted(self):
        # Header absent -> no validation (endpoint treats key as optional).
        _validate_idempotency_header(None)  # no raise

    def test_valid_uuid_accepted(self):
        _validate_idempotency_header(str(uuid4()))  # no raise

    def test_invalid_uuid_rejected_400(self):
        with pytest.raises(HTTPException) as exc:
            _validate_idempotency_header("not-a-uuid")
        assert exc.value.status_code == 400
        assert "Idempotency-Key" in exc.value.detail

    def test_empty_string_rejected(self):
        # Empty string is truthy-false but non-None -- it IS passed to
        # validation and should fail UUID parse.
        with pytest.raises(HTTPException) as exc:
            _validate_idempotency_header("")
        assert exc.value.status_code == 400


# -- VALID_EVENT_TYPES guard ------------------------------------------

class TestValidEventTypesGuard:
    """
    CONFIRMED must NOT be in VALID_EVENT_TYPES. This is a deliberate design
    choice: the atomic confirm_trade endpoint is the only path that creates
    CONFIRMED events, because it also updates the trade projection. If a
    future developer adds CONFIRMED here, the generic POST would silently
    create projection-inconsistent events.
    """

    def test_confirmed_absent(self):
        assert "CONFIRMED" not in VALID_EVENT_TYPES, (
            "CONFIRMED must stay out of VALID_EVENT_TYPES -- atomic "
            "confirm endpoint is the only sanctioned creation path."
        )

    def test_cancelled_present(self):
        # CANCELLED is in the set (preserved from Sprint 3) because the
        # generic POST predates the atomic cancel endpoint. This is
        # acceptable existing behavior; a future hardening pass can close it.
        assert "CANCELLED" in VALID_EVENT_TYPES

    def test_booked_present(self):
        assert "BOOKED" in VALID_EVENT_TYPES


# -- Projection roundtrip tests ---------------------------------------

class TestLifecycleProjectionRoundtrip:
    """
    Charter Section 1.1: 'replaying the event stream from BOOKED reconstructs
    the current projection byte-identically.' Confirms that appending a
    CONFIRMED or CANCELLED event (exactly what the atomic endpoint does)
    produces the expected trade.status after projection replay.
    """

    def _booked_event(self, seq: int = 1) -> EventLike:
        payload = build_booked_payload(
            _valid_booking_body(), uuid4(), [uuid4(), uuid4()]
        )
        return EventLike(event_seq=seq, event_type="BOOKED", payload=payload)

    def test_booked_alone_projects_pending(self):
        proj = project([self._booked_event()])
        assert proj["trade"]["status"] == "PENDING"

    def test_booked_then_confirmed_projects_confirmed(self):
        events = [
            self._booked_event(seq=1),
            EventLike(event_seq=2, event_type="CONFIRMED", payload={}),
        ]
        proj = project(events)
        assert proj["trade"]["status"] == "CONFIRMED"

    def test_booked_then_cancelled_projects_cancelled(self):
        events = [
            self._booked_event(seq=1),
            EventLike(event_seq=2, event_type="CANCELLED", payload={}),
        ]
        proj = project(events)
        assert proj["trade"]["status"] == "CANCELLED"

    def test_cancelled_event_with_reason_payload_still_projects(self):
        # CANCELLED is status-only per projection _STATUS_ONLY; any payload
        # content (our optional reason) is ignored by the projection and
        # does not affect trade.status.
        events = [
            self._booked_event(seq=1),
            EventLike(
                event_seq=2,
                event_type="CANCELLED",
                payload={"reason": "counterparty withdrew"},
            ),
        ]
        proj = project(events)
        assert proj["trade"]["status"] == "CANCELLED"

    def test_confirmed_preserves_legs(self):
        # Status flip does not touch legs; all original legs remain, in order.
        events = [
            self._booked_event(seq=1),
            EventLike(event_seq=2, event_type="CONFIRMED", payload={}),
        ]
        proj = project(events)
        assert len(proj["legs"]) == 2
        assert proj["legs"][0]["leg_ref"] == "FIXED-1"
        assert proj["legs"][1]["leg_ref"] == "FLOAT-1"

    def test_cancelled_preserves_trade_economics(self):
        # Status flip does not touch notional, dates, or terms.
        events = [
            self._booked_event(seq=1),
            EventLike(event_seq=2, event_type="CANCELLED", payload={}),
        ]
        proj = project(events)
        assert proj["trade"]["notional"] == 10_000_000.0
        assert proj["trade"]["notional_ccy"] == "USD"
        assert proj["trade"]["asset_class"] == "RATES"
        assert proj["trade"]["instrument_type"] == "IR_SWAP"
