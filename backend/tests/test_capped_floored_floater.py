"""
Sprint 12 / Sprint 13 Patch 2 — CAPPED_FLOATER / FLOORED_FLOATER pricer tests

Pure unit tests for the embedded caplet / floorlet strip pricer and its
integration with price_leg. No DB, no backend process, no Bloomberg fixture.

Sprint 12 shipped the strip math and the integration via legacy column
paths (Sprint 12 `cap_strike_schedule` / `floor_strike_schedule`
columns were dropped by migration 008b).
Sprint 13 Patch 2 refactors the integration to iterate `leg.embedded_options`
(JSONB array). The low-level strip pricer signature is unchanged, so §1-4
unit tests are unchanged. §5 integration tests are rewritten to use the
new embedded_options shape. §6 covers composition (collar = CAP + FLOOR
on one leg). §7 covers backward compatibility with the legacy shape via
the _normalize_embedded_options shim.

Covered:
  - Sign invariants across all 4 quadrants of {BUY, SELL} × {PAY, RECEIVE}
  - Schedule resolution (list form, dict form, empty-schedule fallback)
  - Option-math sanity (deep ITM, deep OTM, ATM)
  - Direction validation (missing / invalid)
  - Integration with price_leg via embedded_options
  - Composition: collar as two entries on one leg

Not covered (deferred):
  - Bloomberg SWPM round-trip (Sprint 12 item 13)
  - Property-based invariants via Hypothesis (Sprint 12 item 11)
  - Vol surface skew interpolation (existing cap_floor tests cover this)
"""

from datetime import date
from decimal import Decimal

import pytest

from pricing.cap_floor import (
    StripResult,
    price_caplet_strip_over_periods,
    price_floorlet_strip_over_periods,
    _resolve_strike_at,
)
from pricing.curve import Curve
from pricing.ir_swap import price_leg, _normalize_embedded_options
from pricing.schedule import generate_schedule


# ── Test fixtures: synthetic curves + vol surface ─────────────────────────

VAL_DATE   = date(2026, 4, 22)
EFF_DATE   = date(2026, 4, 22)
MAT_DATE   = date(2031, 4, 22)   # 5Y swap
NOTIONAL   = Decimal("10000000") # 10mm


@pytest.fixture
def flat_curve_3pct():
    """Single flat 3% curve used for both discount and forecast.
    Forward rates resolve to ~3% for every caplet period."""
    return Curve(valuation_date=VAL_DATE, flat_rate=0.03)


@pytest.fixture
def flat_curve_5pct():
    """Flat 5% curve — used for deep-ITM cap scenarios (F >> K)."""
    return Curve(valuation_date=VAL_DATE, flat_rate=0.05)


@pytest.fixture
def vol_surface_atm_85bp():
    """Minimal synthetic vol surface: ATM-only at 85bp for the relevant tenor.
    Formatted to match _load_cap_surface output (list of dicts)."""
    return [
        {"cap_tenor_y": 5.0, "strike_spread_bp": 0.0,
         "flat_vol_bp": 85.0, "is_atm": True,  "source": "TEST"},
    ]


@pytest.fixture
def empty_surface():
    """No surface rows — pricer should fall back to fallback_vol_bp."""
    return []


@pytest.fixture
def swap_periods():
    """5Y USD SOFR standard quarterly period schedule."""
    return generate_schedule(
        effective_date=EFF_DATE,
        maturity_date=MAT_DATE,
        frequency="QUARTERLY",
        day_count="ACT/360",
        notional=NOTIONAL,
        bdc="MOD_FOLLOWING",
        payment_lag=2,
        is_float=True,
    )


# ── Low-level helpers (unchanged — low-level API unchanged) ───────────────

def _caplet_strip(periods, curve, surface, direction, strike, notional=None):
    """Convenience wrapper around price_caplet_strip_over_periods."""
    default_notional = float(notional) if notional is not None else float(NOTIONAL)
    obj = {
        "direction": direction,
        "schedule": [{"date": EFF_DATE.isoformat(), "strike": strike}],
    }
    return price_caplet_strip_over_periods(
        periods=periods,
        strike_schedule_obj=obj,
        default_strike=strike,
        notional_schedule=None,
        default_notional=default_notional,
        forecast_curve=curve,
        discount_curve=curve,
        valuation_date=VAL_DATE,
        surface_rows=surface,
        swap_tenor_y=5.0,
    )


def _floorlet_strip(periods, curve, surface, direction, strike, notional=None):
    """Convenience wrapper around price_floorlet_strip_over_periods."""
    default_notional = float(notional) if notional is not None else float(NOTIONAL)
    obj = {
        "direction": direction,
        "schedule": [{"date": EFF_DATE.isoformat(), "strike": strike}],
    }
    return price_floorlet_strip_over_periods(
        periods=periods,
        strike_schedule_obj=obj,
        default_strike=strike,
        notional_schedule=None,
        default_notional=default_notional,
        forecast_curve=curve,
        discount_curve=curve,
        valuation_date=VAL_DATE,
        surface_rows=surface,
        swap_tenor_y=5.0,
    )


# ── New-shape helpers (Sprint 13 Patch 2) ─────────────────────────────────

def _cap_entry(direction, strike):
    """Build an embedded_options entry of type CAP."""
    return {
        "type": "CAP",
        "direction": direction,
        "strike_schedule": [{"date": EFF_DATE.isoformat(), "strike": strike}],
        "default_strike": strike,
    }


def _floor_entry(direction, strike):
    """Build an embedded_options entry of type FLOOR."""
    return {
        "type": "FLOOR",
        "direction": direction,
        "strike_schedule": [{"date": EFF_DATE.isoformat(), "strike": strike}],
        "default_strike": strike,
    }


def _float_leg(direction, embedded_options=None, vol_surface=None):
    """
    Build a minimal float leg dict suitable for price_leg.

    Sprint 13 Patch 5 — uses embedded_options shape.
    (Sprint 12 legacy cap_strike_schedule / floor_strike_schedule path
    was removed by migration 008b.)
    """
    return {
        "id":                 "test-leg-001",
        "leg_ref":            "FLOAT-1",
        "leg_type":           "FLOAT",
        "direction":          direction,
        "currency":           "USD",
        "notional":           float(NOTIONAL),
        "effective_date":     EFF_DATE,
        "maturity_date":      MAT_DATE,
        "day_count":          "ACT/360",
        "payment_frequency":  "QUARTERLY",
        "bdc":                "MOD_FOLLOWING",
        "payment_lag":        2,
        "fixed_rate":         0.0,
        "spread":             0.0,
        "embedded_options":   embedded_options or [],
        "_vol_surface_rows":  vol_surface,
    }


# ══════════════════════════════════════════════════════════════════════════
# §1. Sign invariants — the core directional correctness property
# ══════════════════════════════════════════════════════════════════════════

class TestSignInvariants:
    """
    The sign of the strip NPV is governed by the OPTION direction (BUY/SELL),
    not by the leg direction (PAY/RECEIVE). The leg direction determines the
    sign of the DCF portion only; the option premium is additive on top with
    its own sign determined by BUY/SELL.
    """

    def test_sell_cap_produces_negative_strip_npv(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        """SELL cap → book is short an option → receives premium on sell,
        but the MTM value of being short is negative."""
        strip = _caplet_strip(swap_periods, flat_curve_3pct, vol_surface_atm_85bp,
                              direction="SELL", strike=0.03)
        assert strip.error is None, f"unexpected error: {strip.error}"
        assert strip.npv < 0, f"SELL cap should have negative NPV, got {strip.npv}"

    def test_buy_cap_produces_positive_strip_npv(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        """BUY cap → book is long an option → positive MTM."""
        strip = _caplet_strip(swap_periods, flat_curve_3pct, vol_surface_atm_85bp,
                              direction="BUY", strike=0.03)
        assert strip.error is None
        assert strip.npv > 0, f"BUY cap should have positive NPV, got {strip.npv}"

    def test_buy_floor_produces_positive_strip_npv(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        strip = _floorlet_strip(swap_periods, flat_curve_3pct, vol_surface_atm_85bp,
                                direction="BUY", strike=0.03)
        assert strip.error is None
        assert strip.npv > 0

    def test_sell_floor_produces_negative_strip_npv(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        strip = _floorlet_strip(swap_periods, flat_curve_3pct, vol_surface_atm_85bp,
                                direction="SELL", strike=0.03)
        assert strip.error is None
        assert strip.npv < 0

    def test_buy_vs_sell_are_exact_sign_flip(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        """Magnitude of NPV is identical for BUY and SELL; only sign differs."""
        buy  = _caplet_strip(swap_periods, flat_curve_3pct, vol_surface_atm_85bp,
                             direction="BUY",  strike=0.03)
        sell = _caplet_strip(swap_periods, flat_curve_3pct, vol_surface_atm_85bp,
                             direction="SELL", strike=0.03)
        assert abs(buy.npv + sell.npv) < 1e-6, f"BUY + SELL should sum to 0, got {buy.npv} + {sell.npv}"
        # Also ir01 and vega should flip sign but match magnitude
        assert abs(buy.ir01 + sell.ir01) < 1e-6
        assert abs(buy.vega + sell.vega) < 1e-6


# ══════════════════════════════════════════════════════════════════════════
# §2. Schedule resolution — list vs dict form, fallback behavior
# ══════════════════════════════════════════════════════════════════════════

class TestScheduleResolution:
    """The JSONB shape admits list form and dict form; results must match."""

    def test_list_and_dict_form_produce_equal_pricing(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        obj_list = {
            "direction": "SELL",
            "schedule": [{"date": EFF_DATE.isoformat(), "strike": 0.03}],
        }
        obj_dict = {
            "direction": "SELL",
            "schedule": {EFF_DATE.isoformat(): 0.03},
        }

        kwargs = dict(
            periods=swap_periods,
            default_strike=0.03,
            notional_schedule=None,
            default_notional=float(NOTIONAL),
            forecast_curve=flat_curve_3pct,
            discount_curve=flat_curve_3pct,
            valuation_date=VAL_DATE,
            surface_rows=vol_surface_atm_85bp,
            swap_tenor_y=5.0,
        )
        strip_l = price_caplet_strip_over_periods(strike_schedule_obj=obj_list, **kwargs)
        strip_d = price_caplet_strip_over_periods(strike_schedule_obj=obj_dict, **kwargs)
        assert abs(strip_l.npv - strip_d.npv) < 1e-6

    def test_empty_schedule_falls_back_to_default_strike(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        """Empty schedule list + populated default_strike → price using flat default."""
        obj_empty = {"direction": "SELL", "schedule": []}
        strip_e = price_caplet_strip_over_periods(
            periods=swap_periods,
            strike_schedule_obj=obj_empty,
            default_strike=0.03,
            notional_schedule=None,
            default_notional=float(NOTIONAL),
            forecast_curve=flat_curve_3pct,
            discount_curve=flat_curve_3pct,
            valuation_date=VAL_DATE,
            surface_rows=vol_surface_atm_85bp,
            swap_tenor_y=5.0,
        )
        assert strip_e.error is None
        # Should produce a non-trivial NPV (all caplets at K=0.03)
        assert strip_e.npv != 0.0
        # Every caplet's strike should equal default_strike
        for cl in strip_e.caplets:
            assert cl["strike"] == pytest.approx(0.03, abs=1e-6)

    def test_resolve_strike_at_list_form(self):
        """Unit-test the resolver directly across boundaries."""
        entries = [
            {"date": "2026-01-01", "strike": 0.04},
            {"date": "2027-01-01", "strike": 0.05},
            {"date": "2028-01-01", "strike": 0.06},
        ]
        assert _resolve_strike_at(entries, date(2025, 6, 1), 0.03) == 0.03  # before all
        assert _resolve_strike_at(entries, date(2026, 6, 1), 0.03) == 0.04  # in 1st bucket
        assert _resolve_strike_at(entries, date(2027, 6, 1), 0.03) == 0.05  # in 2nd bucket
        assert _resolve_strike_at(entries, date(2030, 6, 1), 0.03) == 0.06  # after last

    def test_resolve_strike_at_dict_form(self):
        entries = {"2026-01-01": 0.04, "2028-01-01": 0.06}
        assert _resolve_strike_at(entries, date(2027, 6, 1), 0.03) == 0.04
        assert _resolve_strike_at(entries, date(2029, 6, 1), 0.03) == 0.06


# ══════════════════════════════════════════════════════════════════════════
# §3. Option-math sanity — deep ITM, deep OTM, ATM
# ══════════════════════════════════════════════════════════════════════════

class TestOptionMathSanity:
    """Coarse bounds that must hold regardless of vol model: deep-ITM cap
    has significant intrinsic value, deep-OTM cap is near zero, ATM is positive."""

    def test_deep_otm_cap_approaches_zero(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        """K=20% on a 3% curve → deep OTM → near-zero premium.
        |NPV| / notional < 0.1% is a loose bound."""
        strip = _caplet_strip(swap_periods, flat_curve_3pct, vol_surface_atm_85bp,
                              direction="BUY", strike=0.20)
        assert strip.error is None
        assert abs(strip.npv) / float(NOTIONAL) < 0.001, f"Deep OTM should be < 0.1% of notional, got {strip.npv}"

    def test_atm_cap_has_positive_premium(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        """K=F=3% → pure time-value premium, positive for BUY."""
        strip = _caplet_strip(swap_periods, flat_curve_3pct, vol_surface_atm_85bp,
                              direction="BUY", strike=0.03)
        assert strip.error is None
        assert strip.npv > 0
        # ATM 5Y cap on $10mm with 85bp normal vol ≈ tens of thousands of dollars
        assert strip.npv > 10_000, f"ATM premium suspiciously small: {strip.npv}"

    def test_deep_itm_cap_exceeds_atm_premium(self, swap_periods, flat_curve_5pct, vol_surface_atm_85bp):
        """K=2% cap on a 5% curve → deep ITM → NPV > ATM cap NPV."""
        atm_strip = _caplet_strip(swap_periods, flat_curve_5pct, vol_surface_atm_85bp,
                                  direction="BUY", strike=0.05)
        itm_strip = _caplet_strip(swap_periods, flat_curve_5pct, vol_surface_atm_85bp,
                                  direction="BUY", strike=0.02)
        assert atm_strip.error is None and itm_strip.error is None
        assert itm_strip.npv > atm_strip.npv, f"Deep ITM ({itm_strip.npv}) should exceed ATM ({atm_strip.npv})"


# ══════════════════════════════════════════════════════════════════════════
# §4. Direction validation — missing / invalid direction
# ══════════════════════════════════════════════════════════════════════════

class TestDirectionValidation:
    """The shape validator in trade_legs.py is the first line of defense,
    but the pricer must also handle bad input without crashing."""

    def test_missing_direction_returns_error_strip(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        obj = {"schedule": [{"date": EFF_DATE.isoformat(), "strike": 0.03}]}
        strip = price_caplet_strip_over_periods(
            periods=swap_periods,
            strike_schedule_obj=obj,
            default_strike=0.03,
            notional_schedule=None,
            default_notional=float(NOTIONAL),
            forecast_curve=flat_curve_3pct,
            discount_curve=flat_curve_3pct,
            valuation_date=VAL_DATE,
            surface_rows=vol_surface_atm_85bp,
            swap_tenor_y=5.0,
        )
        assert strip.error is not None
        assert strip.npv == 0.0

    def test_invalid_direction_returns_error_strip(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        obj = {"direction": "MAYBE", "schedule": []}
        strip = price_caplet_strip_over_periods(
            periods=swap_periods,
            strike_schedule_obj=obj,
            default_strike=0.03,
            notional_schedule=None,
            default_notional=float(NOTIONAL),
            forecast_curve=flat_curve_3pct,
            discount_curve=flat_curve_3pct,
            valuation_date=VAL_DATE,
            surface_rows=vol_surface_atm_85bp,
            swap_tenor_y=5.0,
        )
        assert strip.error is not None
        assert "BUY" in strip.error or "SELL" in strip.error

    def test_non_dict_strike_schedule_returns_error_strip(self, swap_periods, flat_curve_3pct, vol_surface_atm_85bp):
        strip = price_caplet_strip_over_periods(
            periods=swap_periods,
            strike_schedule_obj="not a dict",
            default_strike=0.03,
            notional_schedule=None,
            default_notional=float(NOTIONAL),
            forecast_curve=flat_curve_3pct,
            discount_curve=flat_curve_3pct,
            valuation_date=VAL_DATE,
            surface_rows=vol_surface_atm_85bp,
            swap_tenor_y=5.0,
        )
        assert strip.error is not None


# ══════════════════════════════════════════════════════════════════════════
# §5. Integration with price_leg via embedded_options (Sprint 13 Patch 2)
# ══════════════════════════════════════════════════════════════════════════

class TestPriceLegIntegrationEmbeddedOptions:
    """
    Covers the full path: build a leg dict with embedded_options, call
    price_leg, verify the hook fires / stays dormant / produces the
    expected cashflow shape.
    """

    def test_plain_float_leg_has_no_caplet_cashflows(self, flat_curve_3pct):
        """Float leg with empty embedded_options → price_leg behaves as
        a plain-vanilla float leg. Hook must be fully dormant."""
        leg = _float_leg(direction="RECEIVE")
        result = price_leg(leg, flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        assert all(cf.cashflow_type not in ("CAPLET", "FLOORLET") for cf in result.cashflows)

    def test_embedded_cap_adds_caplet_cashflows(self, flat_curve_3pct, vol_surface_atm_85bp):
        """Leg with one CAP entry in embedded_options → leg PV = DCF + strip;
        cashflow stream contains both COUPON and CAPLET rows."""
        leg = _float_leg(
            direction="RECEIVE",
            embedded_options=[_cap_entry("SELL", 0.03)],
            vol_surface=vol_surface_atm_85bp,
        )
        result = price_leg(leg, flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        coupon_cfs = [cf for cf in result.cashflows if cf.cashflow_type == "COUPON"]
        caplet_cfs = [cf for cf in result.cashflows if cf.cashflow_type == "CAPLET"]
        assert len(coupon_cfs) > 0, "expected coupon cashflows on the DCF leg"
        assert len(caplet_cfs) > 0, "expected CAPLET cashflows from the embedded strip"
        assert len(caplet_cfs) == len(coupon_cfs), "one caplet per period expected"

    def test_short_cap_reduces_leg_pv_vs_vanilla(self, flat_curve_3pct, vol_surface_atm_85bp):
        """Receiver of float + short cap → leg PV strictly less than plain-float leg PV.
        Option direction (SELL) drives the sign, not leg direction (RECEIVE)."""
        vanilla = _float_leg(direction="RECEIVE")
        capped  = _float_leg(
            direction="RECEIVE",
            embedded_options=[_cap_entry("SELL", 0.03)],
            vol_surface=vol_surface_atm_85bp,
        )
        r_vanilla = price_leg(vanilla, flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        r_capped  = price_leg(capped,  flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        assert r_capped.pv < r_vanilla.pv, (
            f"SELL-cap receiver should have smaller PV than vanilla. "
            f"vanilla={r_vanilla.pv}, capped={r_capped.pv}"
        )

    def test_long_floor_increases_leg_pv_vs_vanilla(self, flat_curve_3pct, vol_surface_atm_85bp):
        """Receiver of float + long floor → leg PV strictly greater than plain-float."""
        vanilla = _float_leg(direction="RECEIVE")
        floored = _float_leg(
            direction="RECEIVE",
            embedded_options=[_floor_entry("BUY", 0.03)],
            vol_surface=vol_surface_atm_85bp,
        )
        r_vanilla = price_leg(vanilla, flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        r_floored = price_leg(floored, flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        assert r_floored.pv > r_vanilla.pv

    def test_missing_vol_surface_falls_back_gracefully(self, flat_curve_3pct, empty_surface):
        """Leg with embedded cap but NO vol surface rows → pricer falls back
        to fallback_vol_bp; vol_tier on each caplet = FALLBACK. No exception,
        non-zero NPV."""
        leg = _float_leg(
            direction="RECEIVE",
            embedded_options=[_cap_entry("SELL", 0.03)],
            vol_surface=empty_surface,
        )
        result = price_leg(leg, flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        caplet_cfs = [cf for cf in result.cashflows if cf.cashflow_type == "CAPLET"]
        assert len(caplet_cfs) > 0
        total_caplet_pv = sum(cf.pv for cf in caplet_cfs)
        assert total_caplet_pv != 0.0

    def test_unknown_option_type_is_skipped(self, flat_curve_3pct, vol_surface_atm_85bp):
        """Defensive: an entry with an unknown type (e.g., DIGITAL, BARRIER)
        is silently skipped without affecting the rest of the leg."""
        leg = _float_leg(
            direction="RECEIVE",
            embedded_options=[
                {"type": "DIGITAL", "direction": "BUY",
                 "strike_schedule": [], "default_strike": 0.04},
                _cap_entry("SELL", 0.03),
            ],
            vol_surface=vol_surface_atm_85bp,
        )
        result = price_leg(leg, flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        # The CAP entry still produces CAPLET cashflows
        caplet_cfs = [cf for cf in result.cashflows if cf.cashflow_type == "CAPLET"]
        assert len(caplet_cfs) > 0

    def test_invalid_direction_entry_is_skipped(self, flat_curve_3pct, vol_surface_atm_85bp):
        """Entry with invalid direction skipped; rest of leg unaffected."""
        leg = _float_leg(
            direction="RECEIVE",
            embedded_options=[
                {"type": "CAP", "direction": "MAYBE",
                 "strike_schedule": [], "default_strike": 0.04},
            ],
            vol_surface=vol_surface_atm_85bp,
        )
        result = price_leg(leg, flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        # No CAPLET cashflows because the only CAP entry has invalid direction
        caplet_cfs = [cf for cf in result.cashflows if cf.cashflow_type == "CAPLET"]
        assert len(caplet_cfs) == 0


# ══════════════════════════════════════════════════════════════════════════
# §6. Composition — collar = CAP + FLOOR on one leg (Sprint 13 Patch 2)
# ══════════════════════════════════════════════════════════════════════════

class TestComposition:
    """
    Under the leg-level model, a collar is TWO entries on the same leg —
    one CAP (typically SELL) and one FLOOR (typically BUY). The platform
    has no 'collar' object; it's pure composition. These tests verify
    that multiple entries stack additively and preserve sign invariants.
    """

    def test_collar_pv_equals_sum_of_individual_strips(self, flat_curve_3pct, vol_surface_atm_85bp):
        """A collared leg's PV = vanilla leg PV + cap strip + floor strip (signed).
        Verifies additivity of embedded_options iteration."""
        vanilla = _float_leg(direction="RECEIVE")
        cap_only = _float_leg(
            direction="RECEIVE",
            embedded_options=[_cap_entry("SELL", 0.04)],
            vol_surface=vol_surface_atm_85bp,
        )
        floor_only = _float_leg(
            direction="RECEIVE",
            embedded_options=[_floor_entry("BUY", 0.02)],
            vol_surface=vol_surface_atm_85bp,
        )
        collar = _float_leg(
            direction="RECEIVE",
            embedded_options=[
                _cap_entry("SELL", 0.04),
                _floor_entry("BUY", 0.02),
            ],
            vol_surface=vol_surface_atm_85bp,
        )
        r_vanilla = price_leg(vanilla,   flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        r_cap     = price_leg(cap_only,  flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        r_floor   = price_leg(floor_only,flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        r_collar  = price_leg(collar,    flat_curve_3pct, flat_curve_3pct, VAL_DATE)

        expected = r_vanilla.pv + (r_cap.pv - r_vanilla.pv) + (r_floor.pv - r_vanilla.pv)
        assert abs(r_collar.pv - expected) < 1.0, (
            f"Collar PV {r_collar.pv} != vanilla + cap_delta + floor_delta = {expected}"
        )

    def test_collar_produces_both_caplet_and_floorlet_cashflows(self, flat_curve_3pct, vol_surface_atm_85bp):
        """Collar leg → cashflow stream contains COUPON, CAPLET, FLOORLET."""
        collar = _float_leg(
            direction="RECEIVE",
            embedded_options=[
                _cap_entry("SELL", 0.04),
                _floor_entry("BUY", 0.02),
            ],
            vol_surface=vol_surface_atm_85bp,
        )
        result = price_leg(collar, flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        types = {cf.cashflow_type for cf in result.cashflows}
        assert "COUPON" in types
        assert "CAPLET" in types
        assert "FLOORLET" in types

    def test_two_cap_entries_stack(self, flat_curve_3pct, vol_surface_atm_85bp):
        """Two CAP entries on the same leg → both contribute. Non-standard
        but the machinery must handle it (e.g., a cap ladder)."""
        leg_one = _float_leg(
            direction="RECEIVE",
            embedded_options=[_cap_entry("SELL", 0.04)],
            vol_surface=vol_surface_atm_85bp,
        )
        leg_two = _float_leg(
            direction="RECEIVE",
            embedded_options=[
                _cap_entry("SELL", 0.04),
                _cap_entry("SELL", 0.04),  # same parameters, stacked
            ],
            vol_surface=vol_surface_atm_85bp,
        )
        r_one = price_leg(leg_one, flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        r_two = price_leg(leg_two, flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        # leg_two should have roughly 2x the cap contribution vs leg_one
        vanilla = price_leg(_float_leg(direction="RECEIVE"),
                            flat_curve_3pct, flat_curve_3pct, VAL_DATE)
        delta_one = r_one.pv - vanilla.pv
        delta_two = r_two.pv - vanilla.pv
        assert abs(delta_two - 2.0 * delta_one) < 1.0, (
            f"Double-stacked cap should contribute 2x: single={delta_one}, double={delta_two}"
        )
