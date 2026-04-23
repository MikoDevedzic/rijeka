"""
Sprint 13 Patch 5 — structure deprecation tests.

Migration 008b removed `CAPPED_FLOATER` and `FLOORED_FLOATER` from the
IR_SWAP structure allowlist per PRODUCT_TAXONOMY §1.11. This test file
locks in that both structures are now REJECTED at the validation layer,
both on TradeCreate (direct trade creation) and on BookingRequest
(atomic booking endpoint).

Replaces the Sprint 12 `test_booking_structure_validation.py` file, which
tested the old `structure=CAPPED_FLOATER requires exactly one FLOAT leg
with cap_strike_schedule populated` cross-field rules — those rules, along
with the columns they referenced, no longer exist.

Pure Pydantic tests. No DB, no TestClient.
"""

from datetime import date
from decimal import Decimal

import pytest

from api.routes.booking import BookingRequest, LegInput
from api.routes.trades  import TradeCreate


# ── Fixtures ──────────────────────────────────────────────────────────────

BASE_BOOKING_KWARGS = {
    "asset_class":     "RATES",
    "instrument_type": "IR_SWAP",
    "notional":        Decimal("10000000"),
    "notional_ccy":    "USD",
    "trade_date":      date(2026, 4, 23),
    "effective_date":  date(2026, 4, 27),
    "maturity_date":   date(2031, 4, 27),
}

BASE_TRADECREATE_KWARGS = {
    "asset_class":     "RATES",
    "instrument_type": "IR_SWAP",
    "notional":        10_000_000.0,
    "notional_ccy":    "USD",
    "trade_date":      "2026-04-23",
    "effective_date":  "2026-04-27",
    "maturity_date":   "2031-04-27",
}


def _fixed_leg():
    return LegInput(
        leg_ref="FIXED-1", leg_seq=1, leg_type="FIXED",
        direction="PAY", currency="USD", notional=Decimal("10000000"),
        effective_date=date(2026, 4, 27), maturity_date=date(2031, 4, 27),
        fixed_rate=Decimal("0.035959"),
    )


def _float_leg():
    return LegInput(
        leg_ref="FLOAT-1", leg_seq=2, leg_type="FLOAT",
        direction="RECEIVE", currency="USD", notional=Decimal("10000000"),
        effective_date=date(2026, 4, 27), maturity_date=date(2031, 4, 27),
    )


# ══════════════════════════════════════════════════════════════════════════
# §1. TradeCreate rejects deprecated structures
# ══════════════════════════════════════════════════════════════════════════

class TestTradeCreateRejectsDeprecated:
    """
    trades.py::TradeCreate runs an IR_SWAP allowlist check. Post-migration-008b,
    CAPPED_FLOATER and FLOORED_FLOATER are absent from the allowlist. Any
    attempt to create such a trade must 422 before it reaches the DB CHECK
    constraint.
    """

    def test_capped_floater_rejected(self):
        with pytest.raises(ValueError, match="Invalid structure 'CAPPED_FLOATER'"):
            TradeCreate(structure="CAPPED_FLOATER", **BASE_TRADECREATE_KWARGS)

    def test_floored_floater_rejected(self):
        with pytest.raises(ValueError, match="Invalid structure 'FLOORED_FLOATER'"):
            TradeCreate(structure="FLOORED_FLOATER", **BASE_TRADECREATE_KWARGS)

    def test_vanilla_still_accepted(self):
        """Sanity: the baseline structure still works."""
        tc = TradeCreate(structure="VANILLA", **BASE_TRADECREATE_KWARGS)
        assert tc.structure == "VANILLA"

    def test_ois_still_accepted(self):
        tc = TradeCreate(structure="OIS", **BASE_TRADECREATE_KWARGS)
        assert tc.structure == "OIS"


# ══════════════════════════════════════════════════════════════════════════
# §2. BookingRequest rejects deprecated structures
# ══════════════════════════════════════════════════════════════════════════

class TestBookingRequestRejectsDeprecated:
    """
    booking.py::BookingRequest also runs the IR_SWAP allowlist check (Patch 5
    added this defense so the booking endpoint can't be used to bypass
    TradeCreate's check). Post-migration-008b both structures 422.
    """

    def test_capped_floater_rejected(self):
        with pytest.raises(ValueError, match="Invalid structure 'CAPPED_FLOATER'"):
            BookingRequest(
                structure="CAPPED_FLOATER",
                legs=[_fixed_leg(), _float_leg()],
                **BASE_BOOKING_KWARGS,
            )

    def test_floored_floater_rejected(self):
        with pytest.raises(ValueError, match="Invalid structure 'FLOORED_FLOATER'"):
            BookingRequest(
                structure="FLOORED_FLOATER",
                legs=[_fixed_leg(), _float_leg()],
                **BASE_BOOKING_KWARGS,
            )

    def test_vanilla_still_accepted(self):
        """Sanity: baseline booking still works."""
        req = BookingRequest(
            structure="VANILLA",
            legs=[_fixed_leg(), _float_leg()],
            **BASE_BOOKING_KWARGS,
        )
        assert req.structure == "VANILLA"
