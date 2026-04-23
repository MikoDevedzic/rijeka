"""
Sprint 13 Patch 2 — PRODUCT_TAXONOMY §1.11.1 gate test.

Locks in the behavior that IR_SWAPTION on an underlying with non-empty
embedded_options raises NotImplementedError. This prevents silent
misrouting through the vanilla SABR/Bachelier swaption engine, which
would produce misspecified prices by 30–200 bp depending on moneyness.

The gate exists because:
  1. Vanilla swaption engine assumes single-swap-rate dynamics; capped
     underlying breaks this assumption.
  2. HW1F calibration against swaption grid alone does not fit cap vol.
  3. Jamshidian decomposition requires monotonicity check + MC fallback.
  4. No Bloomberg fixtures exist for this instrument class.

Phase 2 lifts this gate after all four conditions are met.

The gate is intentionally located at the pricer boundary — NOT the
booking boundary. Booking such a trade is allowed (schema is
forward-compatible for Phase 2). Only pricing is blocked.
"""

import pytest

from api.routes.pricer import _check_ir_swaption_embedded_options_gate


class TestIRSwaptionEmbeddedOptionsGate:
    """The gate must:
      - no-op on vanilla IR_SWAPTION (no embedded_options anywhere)
      - no-op on non-swaption trades regardless of embedded_options
      - RAISE on IR_SWAPTION when any underlying leg has embedded_options
    """

    def test_vanilla_swaption_passes(self):
        """No embedded_options on any underlying leg → gate does not fire."""
        legs = [
            {"leg_type": "FIXED", "embedded_options": []},
            {"leg_type": "FLOAT", "embedded_options": []},
        ]
        # Must not raise
        _check_ir_swaption_embedded_options_gate("IR_SWAPTION", legs)

    def test_non_swaption_with_embedded_options_passes(self):
        """IR_SWAP (not swaption) with embedded_options on float leg → gate
        does not fire. CAPPED_FLOATER / FLOORED_FLOATER trades price normally."""
        legs = [
            {"leg_type": "FIXED", "embedded_options": []},
            {"leg_type": "FLOAT", "embedded_options": [
                {"type": "CAP", "direction": "SELL",
                 "strike_schedule": [], "default_strike": 0.04}
            ]},
        ]
        # Must not raise
        _check_ir_swaption_embedded_options_gate("IR_SWAP", legs)

    def test_swaption_with_capped_underlying_raises(self):
        """IR_SWAPTION + embedded CAP on underlying → NotImplementedError."""
        legs = [
            {"leg_type": "FIXED", "embedded_options": []},
            {"leg_type": "FLOAT", "embedded_options": [
                {"type": "CAP", "direction": "SELL",
                 "strike_schedule": [], "default_strike": 0.04}
            ]},
        ]
        with pytest.raises(NotImplementedError) as exc_info:
            _check_ir_swaption_embedded_options_gate("IR_SWAPTION", legs)
        msg = str(exc_info.value)
        # Error message must reference the taxonomy section and Phase 2
        # so operators know why the trade was rejected.
        assert "Phase 2" in msg
        assert "§1.11.1" in msg
        assert "hello@rijeka.app" in msg

    def test_swaption_with_floored_underlying_raises(self):
        """IR_SWAPTION + embedded FLOOR on underlying → NotImplementedError."""
        legs = [
            {"leg_type": "FIXED", "embedded_options": []},
            {"leg_type": "FLOAT", "embedded_options": [
                {"type": "FLOOR", "direction": "BUY",
                 "strike_schedule": [], "default_strike": 0.02}
            ]},
        ]
        with pytest.raises(NotImplementedError):
            _check_ir_swaption_embedded_options_gate("IR_SWAPTION", legs)

    def test_swaption_with_collared_underlying_raises(self):
        """IR_SWAPTION on underlying that carries both CAP and FLOOR entries
        (i.e., collared floater) → still raises. Composition does not change
        the gate behavior — ANY embedded_options triggers it."""
        legs = [
            {"leg_type": "FLOAT", "embedded_options": [
                {"type": "CAP",   "direction": "SELL",
                 "strike_schedule": [], "default_strike": 0.05},
                {"type": "FLOOR", "direction": "BUY",
                 "strike_schedule": [], "default_strike": 0.02},
            ]},
        ]
        with pytest.raises(NotImplementedError):
            _check_ir_swaption_embedded_options_gate("IR_SWAPTION", legs)

    def test_none_instrument_type_does_not_raise(self):
        """Defensive: instrument_type=None should not raise, even if legs
        somehow carry embedded_options. The gate only fires for IR_SWAPTION."""
        legs = [{"embedded_options": [{"type": "CAP", "direction": "SELL"}]}]
        # Must not raise
        _check_ir_swaption_embedded_options_gate(None, legs)

    def test_empty_legs_does_not_raise(self):
        """IR_SWAPTION with empty legs list → gate has nothing to check."""
        _check_ir_swaption_embedded_options_gate("IR_SWAPTION", [])

    def test_gate_accepts_orm_style_objects(self):
        """The /price endpoint passes ORM-converted dicts, but the helper
        must also tolerate ORM attribute access (future-proofing)."""

        class FakeLeg:
            def __init__(self, embedded):
                self.embedded_options = embedded

        legs = [FakeLeg([{"type": "CAP", "direction": "SELL"}])]
        with pytest.raises(NotImplementedError):
            _check_ir_swaption_embedded_options_gate("IR_SWAPTION", legs)
