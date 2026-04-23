"""
Sprint 13 Patch 3 (refactored for Patch 5) — embedded_options validation tests.

Pure unit tests for:
  §1. LegInput embedded_options shape validation (12 tests)
  §2. TradeLegCreate accepts collars via embedded_options (2 tests)
  §3. BookingRequest structure + embedded_options permissivity (3 tests)
  §4. _normalize_leg_embedded_options echoes-and-defaults (2 tests)
  §5. build_booked_payload carries embedded_options unchanged (1 test)

No DB, no FastAPI TestClient — tests the validators and the pure normalizer
directly to keep the suite under a second.

Sprint 13 Patch 5 changes vs Patch 3:
  - Deleted all tests that exercised `cap_strike_schedule` /
    `floor_strike_schedule` legacy columns (dropped by migration 008b).
  - Deleted CAPPED_FLOATER / FLOORED_FLOATER structure tests; those
    structures were removed from the allowlist. See
    `test_structure_deprecation.py` for positive rejection coverage.
  - Tests that remain exercise the post-Patch-5 world: single-source
    embedded_options, no dual-write, permissive on any structure.
"""

from datetime import date
from decimal import Decimal

import pytest

from api.routes.booking import (
    LegInput,
    BookingRequest,
    _normalize_leg_embedded_options,
    build_booked_payload,
    _validate_embedded_options_entry,
)
from api.routes.trade_legs import (
    TradeLegCreate,
    _validate_embedded_options_shape,
)


# ── Fixtures ──────────────────────────────────────────────────

TRADE_ID = "11111111-1111-4111-8111-111111111111"
LEG_ID_1 = "22222222-2222-4222-8222-222222222222"

BASE_TRADE_KWARGS = {
    "asset_class":     "RATES",
    "instrument_type": "IR_SWAP",
    "notional":        Decimal("10000000"),
    "notional_ccy":    "USD",
    "trade_date":      date(2026, 4, 23),
    "effective_date":  date(2026, 4, 27),
    "maturity_date":   date(2031, 4, 27),
}


def _fixed_leg(**overrides):
    d = {
        "leg_ref":           "FIXED-1",
        "leg_seq":           1,
        "leg_type":          "FIXED",
        "direction":         "PAY",
        "currency":          "USD",
        "notional":          Decimal("10000000"),
        "effective_date":    date(2026, 4, 27),
        "maturity_date":     date(2031, 4, 27),
        "day_count":         "ACT/360",
        "payment_frequency": "ANNUAL",
        "fixed_rate":        Decimal("0.035959"),
    }
    d.update(overrides)
    return LegInput(**d)


def _float_leg(**overrides):
    d = {
        "leg_ref":           "FLOAT-1",
        "leg_seq":           2,
        "leg_type":          "FLOAT",
        "direction":         "RECEIVE",
        "currency":          "USD",
        "notional":          Decimal("10000000"),
        "effective_date":    date(2026, 4, 27),
        "maturity_date":     date(2031, 4, 27),
        "day_count":         "ACT/360",
        "payment_frequency": "ANNUAL",
        "reset_frequency":   "DAILY",
    }
    d.update(overrides)
    return LegInput(**d)


NEW_CAP_ENTRY = {
    "type":            "CAP",
    "direction":       "SELL",
    "strike_schedule": [{"date": "2026-04-27", "strike": 0.05}],
    "default_strike":  0.05,
}

NEW_FLOOR_ENTRY = {
    "type":            "FLOOR",
    "direction":       "BUY",
    "strike_schedule": [{"date": "2026-04-27", "strike": 0.025}],
    "default_strike":  0.025,
}


# ══════════════════════════════════════════════════════════════════════════
# §1. embedded_options shape validation (the entry-level checker)
# ══════════════════════════════════════════════════════════════════════════

class TestEmbeddedOptionsShape:
    """Direct tests of the shape validator used by both routes."""

    def test_none_is_valid(self):
        _validate_embedded_options_shape(None)  # no raise

    def test_empty_list_is_valid(self):
        _validate_embedded_options_shape([])  # no raise

    def test_single_cap_entry_is_valid(self):
        _validate_embedded_options_shape([NEW_CAP_ENTRY])

    def test_collar_two_entries_is_valid(self):
        _validate_embedded_options_shape([NEW_CAP_ENTRY, NEW_FLOOR_ENTRY])

    def test_non_list_rejected(self):
        with pytest.raises(ValueError, match="must be a list"):
            _validate_embedded_options_shape({"type": "CAP"})

    def test_entry_non_dict_rejected(self):
        with pytest.raises(ValueError, match="must be a dict"):
            _validate_embedded_options_shape(["not-a-dict"])

    def test_missing_type_rejected(self):
        with pytest.raises(ValueError, match=r"\.type is required"):
            _validate_embedded_options_shape([{"direction": "BUY", "default_strike": 0.05}])

    def test_unknown_type_rejected(self):
        with pytest.raises(ValueError, match="type must be one of"):
            _validate_embedded_options_shape([{
                "type": "BARRIER", "direction": "BUY", "default_strike": 0.05
            }])

    def test_missing_direction_rejected(self):
        with pytest.raises(ValueError, match=r"\.direction is required"):
            _validate_embedded_options_shape([{"type": "CAP", "default_strike": 0.05}])

    def test_invalid_direction_rejected(self):
        with pytest.raises(ValueError, match="direction must be one of"):
            _validate_embedded_options_shape([{
                "type": "CAP", "direction": "MAYBE", "default_strike": 0.05
            }])

    def test_no_strikes_at_all_rejected(self):
        with pytest.raises(ValueError, match="at least one of strike_schedule or default_strike"):
            _validate_embedded_options_shape([{"type": "CAP", "direction": "BUY"}])

    def test_strike_schedule_only_is_valid(self):
        """Default_strike can be absent if strike_schedule is present."""
        _validate_embedded_options_shape([{
            "type": "CAP", "direction": "BUY",
            "strike_schedule": [{"date": "2026-04-27", "strike": 0.05}],
        }])


# ══════════════════════════════════════════════════════════════════════════
# §2. TradeLegCreate — collars and shape enforcement
# ══════════════════════════════════════════════════════════════════════════

class TestTradeLegCreateEmbeddedOptions:
    """
    Post-Patch-5: a leg may carry any number of embedded_options entries.
    Collars are two entries (one CAP + one FLOOR) on the same leg.
    """

    def test_collar_via_embedded_options_accepted(self):
        """Two entries on one leg — the canonical collar shape."""
        leg = TradeLegCreate(
            id=LEG_ID_1,
            trade_id=TRADE_ID,
            leg_ref="FLOAT-1",
            leg_seq=2,
            leg_type="FLOAT",
            direction="RECEIVE",
            currency="USD",
            embedded_options=[NEW_CAP_ENTRY, NEW_FLOOR_ENTRY],
        )
        assert len(leg.embedded_options) == 2

    def test_embedded_options_shape_enforced(self):
        """Malformed embedded_options array is rejected at booking-shape layer."""
        with pytest.raises(Exception):
            TradeLegCreate(
                id=LEG_ID_1,
                trade_id=TRADE_ID,
                leg_ref="FLOAT-1",
                leg_seq=2,
                leg_type="FLOAT",
                direction="RECEIVE",
                currency="USD",
                embedded_options=[{"type": "CAP"}],  # no direction, no strike
            )


# ══════════════════════════════════════════════════════════════════════════
# §3. BookingRequest permissivity
# ══════════════════════════════════════════════════════════════════════════

class TestBookingRequestEmbeddedOptions:
    """
    Post-Patch-5: embedded_options is orthogonal to trade-level structure
    (PRODUCT_TAXONOMY §1.11). Any IR_SWAP structure in the allowlist may
    carry embedded_options on any FLOAT leg.
    """

    def test_vanilla_with_no_optionality_ok(self):
        """Baseline — plain swap, no optionality, no structure-leg issue."""
        req = BookingRequest(
            structure="VANILLA",
            legs=[_fixed_leg(), _float_leg()],
            **BASE_TRADE_KWARGS,
        )
        assert req.structure == "VANILLA"

    def test_vanilla_with_embedded_cap_accepted(self):
        """§1.11 — a capped VANILLA swap is just structure=VANILLA +
        leg.embedded_options=[CAP]. No dedicated structure required."""
        req = BookingRequest(
            structure="VANILLA",
            legs=[
                _fixed_leg(),
                _float_leg(embedded_options=[NEW_CAP_ENTRY]),
            ],
            **BASE_TRADE_KWARGS,
        )
        assert req.structure == "VANILLA"

    def test_ois_with_collar_accepted(self):
        """§1.11 — a collared OIS swap is structure=OIS +
        leg.embedded_options=[CAP, FLOOR]. Also VANILLA."""
        req = BookingRequest(
            structure="OIS",
            legs=[
                _fixed_leg(),
                _float_leg(embedded_options=[NEW_CAP_ENTRY, NEW_FLOOR_ENTRY]),
            ],
            **BASE_TRADE_KWARGS,
        )
        assert req.structure == "OIS"
        assert len(req.legs[1].embedded_options) == 2


# ══════════════════════════════════════════════════════════════════════════
# §4. _normalize_leg_embedded_options — echo-and-default
# ══════════════════════════════════════════════════════════════════════════

class TestNormalizeSingleWrite:
    """
    Post-Patch-5: the normalizer no longer dual-writes. It passes embedded_options
    through unchanged and materializes the DB default ([]) when absent.
    """

    def test_normalizer_passes_through_embedded_options(self):
        leg = _float_leg(embedded_options=[NEW_CAP_ENTRY])
        out = _normalize_leg_embedded_options(leg)
        assert out["embedded_options"] == [NEW_CAP_ENTRY]

    def test_plain_leg_normalizes_to_empty_list(self):
        """Vanilla float leg — embedded_options materializes as [] for the
        NOT NULL DB column."""
        leg = _float_leg()
        out = _normalize_leg_embedded_options(leg)
        assert out["embedded_options"] == []


# ══════════════════════════════════════════════════════════════════════════
# §5. build_booked_payload carries embedded_options
# ══════════════════════════════════════════════════════════════════════════

class TestBuildBookedPayload:
    """The BOOKED event payload must carry embedded_options verbatim so
    event replay reconstructs the leg identically."""

    def test_booked_payload_carries_embedded_options(self):
        req = BookingRequest(
            structure="VANILLA",
            legs=[
                _fixed_leg(),
                _float_leg(embedded_options=[NEW_CAP_ENTRY]),
            ],
            **BASE_TRADE_KWARGS,
        )
        import uuid as _u
        trade_id = _u.uuid4()
        leg_ids  = [_u.uuid4(), _u.uuid4()]
        payload  = build_booked_payload(req, trade_id, leg_ids)
        float_leg_dict = payload["legs"][1]
        assert len(float_leg_dict["embedded_options"]) == 1
        assert float_leg_dict["embedded_options"][0]["type"] == "CAP"
        assert float_leg_dict["embedded_options"][0]["direction"] == "SELL"
        assert float_leg_dict["embedded_options"][0]["default_strike"] == 0.05
