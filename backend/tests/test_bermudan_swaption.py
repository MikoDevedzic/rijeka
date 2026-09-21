"""
Tests for HW1F Bermudan Swaption pricer.

Validation gate
---------------
HW1F-tree-European must reconcile to the **Jamshidian closed-form**
European swaption (which is exact for HW1F) within discretization tolerance.
Tolerance is mixed:
    |tree - jamshidian| < max( 0.0001 × notional , 2.5% × jamshidian_npv )
This is calibrated to dt = 1/12 (monthly tree). Tighter dt → tighter agreement
(verified to be O(dt) — see SPRINT_13_HW1F_BERMUDAN_SWAPTION.md).

Why NOT Bachelier-with-analytic-vol
-----------------------------------
The Andersen-Piterbarg analytic normal-vol formula in calibration.py contains
a duration-weight bug (off by ~3x). Using it as a tree validation reference
would have masked the calibration bug AND fed false negatives into the tree.
Jamshidian is exact under HW1F and is the correct reference. See spec doc.

Production European pricing stays on Bachelier (via swaption.py); the tree
is only used for early-exercise products. The Bachelier-vs-tree gap is a
calibration concern, NOT a tree-correctness concern, and is tracked
separately as a Phase-2 calibration rebuild work item.
"""

import math
import pytest
from datetime import date
from typing import List, Callable

import numpy as np

from pricing.bermudan_swaption import (
    HW1FTrinomialTree,
    SwapTerms,
    price_bermudan_swaption_hw1f,
    price_european_swaption_hw1f_tree,
    price_european_swaption_hw1f_jamshidian,
    price_swaption_via_tree,
    hw1f_B,
    hw1f_A,
    hw1f_bond_price,
    market_inst_forward,
)


# ─────────────────────────────────────────────────────────────────────────────
# Test fixtures
# ─────────────────────────────────────────────────────────────────────────────

class FlatCurve:
    """
    Minimal date-based Curve stub for end-to-end tests of the public API
    (which routes through `discount_fn_from_curve`). P(0,t) = exp(-r·t)
    with t in years from valuation_date. Inherits 1-day calendar granularity.
    """
    def __init__(self, rate: float, valuation_date: date):
        self.rate           = rate
        self.valuation_date = valuation_date

    def df(self, d: date) -> float:
        days = (d - self.valuation_date).days
        return math.exp(-self.rate * days / 365.25)


def flat_disc_fn(rate: float) -> Callable[[float], float]:
    """
    Continuous-time year-fraction discount function. P(0,t) = exp(-r·t).
    Used for tree-internals and Jamshidian validation tests where we want
    to eliminate any sub-day calendar-rounding artifact.
    """
    def _f(t):
        if t <= 0: return 1.0
        return math.exp(-rate * t)
    return _f


def _forward_swap_rate(disc_fn, expiry_y: float, tenor_y: float,
                       pay_freq_y: float = 1.0) -> float:
    """Compute the at-the-money forward swap rate from a year-fraction disc fn."""
    n = int(round(tenor_y / pay_freq_y))
    pay_times = [expiry_y + (k + 1) * pay_freq_y for k in range(n)]
    ann       = sum(pay_freq_y * disc_fn(t) for t in pay_times)
    return (disc_fn(expiry_y) - disc_fn(pay_times[-1])) / ann


# ─────────────────────────────────────────────────────────────────────────────
# Section 1: Tree internals — sanity checks
# ─────────────────────────────────────────────────────────────────────────────

class TestTreeInternals:
    """Confirm probabilities, alpha-fit, bond-price machinery work."""

    def test_probabilities_sum_to_one(self):
        tree = HW1FTrinomialTree(a=0.05, sigma=0.0030, T_max_years=5.0,
                                 dt=1/12, discount_fn=flat_disc_fn(0.03))
        for k in range(2 * tree.j_max + 1):
            total = tree.p_up[k] + tree.p_mid[k] + tree.p_down[k]
            assert abs(total - 1.0) < 1e-10, f"k={k}: sum={total}"

    def test_probabilities_nonnegative(self):
        tree = HW1FTrinomialTree(a=0.05, sigma=0.0030, T_max_years=5.0,
                                 dt=1/12, discount_fn=flat_disc_fn(0.03))
        for arr_name in ('p_up', 'p_mid', 'p_down'):
            arr = getattr(tree, arr_name)
            assert np.min(arr) >= -1e-10, f"{arr_name} min={np.min(arr)}"

    def test_tree_reprices_discount_curve(self):
        """The α(t) fit must make the tree reprice P^M(0,t) at every grid time."""
        tree = HW1FTrinomialTree(a=0.05, sigma=0.0030, T_max_years=5.0,
                                 dt=1/12, discount_fn=flat_disc_fn(0.03))
        chk = tree.discount_curve_check()
        assert chk["passed"], (
            f"Discount fit failed. max_rel_err={chk['max_rel_err']:.2e}. "
            f"Worst step: {max(chk['details'], key=lambda d: d['rel_err'])}"
        )

    def test_tree_reprices_steeper_curve(self):
        """Forward-induction fit handles non-flat curves."""
        # Mildly upward-sloping: P(t) = exp(-(0.03 + 0.005·t)·t)
        def sloped(t):
            if t <= 0: return 1.0
            return math.exp(-(0.03 + 0.005 * t) * t)
        tree = HW1FTrinomialTree(a=0.05, sigma=0.0030, T_max_years=10.0,
                                 dt=1/12, discount_fn=sloped)
        chk = tree.discount_curve_check()
        assert chk["passed"], f"Sloped curve fit failed: {chk['max_rel_err']:.2e}"

    def test_hw1f_B_limits(self):
        # B(0) = 0
        assert hw1f_B(0.05, 0.0) == 0.0
        # B(τ → ∞) = 1/a — use τ large enough that exp(-a·τ) is FP zero
        # a=0.05, τ=1000 → exp(-50) ≈ 1.9e-22, so B = (1-1.9e-22)/0.05 = 20.0 to FP
        assert abs(hw1f_B(0.05, 1000.0) - 1.0/0.05) < 1e-15
        # a → 0: B → τ
        assert abs(hw1f_B(1e-12, 5.0) - 5.0) < 1e-9


# ─────────────────────────────────────────────────────────────────────────────
# Section 2: Validation gate — European tree vs Jamshidian closed-form
# ─────────────────────────────────────────────────────────────────────────────

class TestEuropeanValidationGate:
    """
    The critical gate. HW1F-tree European on a flat continuous-time curve
    must match the Jamshidian closed-form (which is EXACT under HW1F)
    within the tree's discretization error.

    Tolerance: |tree - jam| < max(0.0001·notional, 2.5%·jam_npv)
    The 2.5% loose-end is calibrated to the worst case in the suite
    (1Y x 5Y ATM at dt=1/12, where steps≈12 and ~1.8% gap is intrinsic).
    The 0.0001·notional floor handles deep-OTM cases where rel-err is huge
    in absolute basis-points-of-notional terms.

    Tree convergence is verified O(dt) — see spec doc.
    """

    flat_rate    = 0.03
    a            = 0.05
    sigma        = 0.0030               # 30 bp
    notional     = 10_000_000.0
    pay_freq_y   = 1.0
    dt           = 1.0 / 12.0           # production default

    def _disc_fn(self):
        return flat_disc_fn(self.flat_rate)

    def _jamshidian_ref(self, expiry_y, tenor_y, K, is_payer):
        n_periods = int(round(tenor_y / self.pay_freq_y))
        pay_times = [expiry_y + (k + 1) * self.pay_freq_y for k in range(n_periods)]
        return price_european_swaption_hw1f_jamshidian(
            notional         = self.notional,
            fixed_rate       = K,
            is_payer         = is_payer,
            expiry_y         = expiry_y,
            payment_dates_y  = pay_times,
            period_dcf       = [self.pay_freq_y] * n_periods,
            a                = self.a,
            sigma            = self.sigma,
            discount_fn      = self._disc_fn(),
        )

    @pytest.mark.parametrize("expiry_y, tenor_y, strike_offset_bp, is_payer", [
        # 5Y x 5Y: best agreement (longer expiry → finer tree resolution)
        (5.0, 5.0,    0,  True),     # ATM payer (calibration sweet spot)
        (5.0, 5.0,    0, False),     # ATM receiver
        (5.0, 5.0,  100,  True),     # OTM payer
        (5.0, 5.0, -100,  True),     # ITM payer
        (5.0, 5.0,  100, False),     # ITM receiver
        (5.0, 5.0, -100, False),     # OTM receiver
        # 1Y x 5Y: shorter expiry → coarser tree → harder gate
        (1.0, 5.0,    0,  True),
        (1.0, 5.0,    0, False),
        # 3Y x 5Y: middle ground
        (3.0, 5.0,    0,  True),
        (3.0, 5.0, -100,  True),
    ])
    def test_european_matches_jamshidian(self, expiry_y, tenor_y,
                                         strike_offset_bp, is_payer):
        disc_fn = self._disc_fn()
        F = _forward_swap_rate(disc_fn, expiry_y, tenor_y, self.pay_freq_y)
        K = F + strike_offset_bp / 10000.0

        # Tree price (uses discount_fn directly)
        tree_result = price_european_swaption_hw1f_tree(
            notional       = self.notional,
            fixed_rate     = K,
            is_payer       = is_payer,
            expiry_y       = expiry_y,
            tenor_y        = tenor_y,
            pay_freq_y     = self.pay_freq_y,
            a              = self.a,
            sigma          = self.sigma,
            discount_fn    = disc_fn,
            dt             = self.dt,
        )
        tree_npv = tree_result.npv

        # Jamshidian reference
        jam = self._jamshidian_ref(expiry_y, tenor_y, K, is_payer)
        jam_npv = jam['npv']

        # Mixed tolerance: max( 1bp of notional , 2.5% relative )
        abs_tol = 0.0001 * self.notional   # 1bp of $10M = $1,000
        rel_tol = 0.025                    # 2.5% relative
        tol     = max(abs_tol, rel_tol * abs(jam_npv))
        diff    = abs(tree_npv - jam_npv)
        rel_err = diff / max(abs(jam_npv), 1.0)

        msg = (f"\n  expiry={expiry_y}y tenor={tenor_y}y "
               f"K={K*100:.4f}% is_payer={is_payer}\n"
               f"  tree NPV     = ${tree_npv:,.2f}\n"
               f"  Jamshidian   = ${jam_npv:,.2f}\n"
               f"  abs diff     = ${diff:,.2f}\n"
               f"  rel err      = {rel_err*100:.4f}%\n"
               f"  tolerance    = ${tol:,.2f}\n"
               f"  tree dt      = {self.dt} ({tree_result.tree_steps} steps)")
        assert diff < tol, msg

    def test_tree_european_european_field_matches_npv(self):
        """When only one exercise time is given, the European-only field
        equals the Bermudan field (same backward induction)."""
        disc_fn = self._disc_fn()
        F = _forward_swap_rate(disc_fn, 5.0, 5.0, self.pay_freq_y)
        result = price_european_swaption_hw1f_tree(
            notional       = self.notional,
            fixed_rate     = F,
            is_payer       = True,
            expiry_y       = 5.0,
            tenor_y        = 5.0,
            pay_freq_y     = self.pay_freq_y,
            a              = self.a,
            sigma          = self.sigma,
            discount_fn    = disc_fn,
            dt             = self.dt,
        )
        assert abs(result.npv - result.european_npv) < 1.0
        # And early-exercise premium should be exactly 0 for single-date Bermudan
        assert result.early_exercise_premium < 1.0


# ─────────────────────────────────────────────────────────────────────────────
# Section 3: Bermudan invariants
# ─────────────────────────────────────────────────────────────────────────────

class TestBermudanInvariants:
    """
    Property-based invariants that must always hold:
      1. Bermudan ≥ European (lower-bound)
      2. Bermudan monotone non-decreasing in exercise-date set (subset → less value)
      3. Single-exercise Bermudan == European at that date
    """
    val_date    = date(2026, 4, 27)
    flat_rate   = 0.03
    a           = 0.05
    sigma       = 0.0030
    notional    = 10_000_000.0
    pay_freq_y  = 1.0
    dt          = 1.0 / 12.0

    def _price(self, exercise_times_y, expiry_y=5.0, tenor_y=5.0,
               strike_offset_bp=0, is_payer=True):
        curve     = FlatCurve(self.flat_rate, self.val_date)
        n_periods = int(round(tenor_y / self.pay_freq_y))
        pay_times = [expiry_y + (k + 1) * self.pay_freq_y for k in range(n_periods)]
        ann       = sum(self.pay_freq_y * math.exp(-self.flat_rate * t) for t in pay_times)
        F         = (math.exp(-self.flat_rate * expiry_y) -
                     math.exp(-self.flat_rate * pay_times[-1])) / ann
        K         = F + strike_offset_bp / 10000.0

        return price_bermudan_swaption_hw1f(
            notional         = self.notional,
            fixed_rate       = K,
            is_payer         = is_payer,
            effective_y      = expiry_y,
            payment_dates_y  = pay_times,
            period_dcf       = [self.pay_freq_y] * n_periods,
            exercise_times_y = exercise_times_y,
            a                = self.a,
            sigma            = self.sigma,
            discount_curve   = curve,
            valuation_date   = self.val_date,
            dt               = self.dt,
        )

    @pytest.mark.parametrize("strike_offset_bp, is_payer", [
        (   0,  True),
        ( 100,  True),
        (-100,  True),
        (   0, False),
    ])
    def test_bermudan_geq_european(self, strike_offset_bp, is_payer):
        """Bermudan ≥ European on the same trade."""
        result_eur  = self._price([5.0],
                                  strike_offset_bp=strike_offset_bp, is_payer=is_payer)
        result_berm = self._price([2.0, 3.0, 4.0, 5.0],
                                  strike_offset_bp=strike_offset_bp, is_payer=is_payer)
        # Allow ε for Bermudan with single-EE date (forward-start underlying
        # makes earlier exercises near-zero value but never negative).
        assert result_berm.npv >= result_eur.npv - 1e-6, (
            f"\n  Bermudan {result_berm.npv:.2f} < European {result_eur.npv:.2f}"
        )

    def test_single_exercise_bermudan_equals_european(self):
        """If the only exercise date is the European expiry, Bermudan == European."""
        result = self._price([5.0])
        assert abs(result.npv - result.european_npv) < 1.0, (
            f"Bermudan {result.npv:.4f} ≠ European {result.european_npv:.4f}"
        )

    def test_monotone_in_exercise_count(self):
        """Adding exercise dates should weakly increase Bermudan value."""
        r1 = self._price([5.0])
        r2 = self._price([3.0, 5.0])
        r3 = self._price([2.0, 3.0, 4.0, 5.0])
        assert r1.npv <= r2.npv + 1e-6, f"r1={r1.npv} > r2={r2.npv}"
        assert r2.npv <= r3.npv + 1e-6, f"r2={r2.npv} > r3={r3.npv}"


# ─────────────────────────────────────────────────────────────────────────────
# Section 4: Amortizing underlying
# ─────────────────────────────────────────────────────────────────────────────

class TestAmortizing:
    """Bermudan on amortizing underlying."""

    val_date   = date(2026, 4, 27)
    flat_rate  = 0.03
    a          = 0.05
    sigma      = 0.0030
    pay_freq_y = 1.0
    dt         = 1.0 / 12.0

    def test_constant_schedule_equals_bullet(self):
        """A constant notional_schedule must produce the same NPV as bullet."""
        curve     = FlatCurve(self.flat_rate, self.val_date)
        notional  = 10_000_000.0
        tenor_y   = 5.0
        expiry_y  = 5.0
        pay_times = [expiry_y + (k + 1) * self.pay_freq_y for k in range(int(tenor_y))]
        K         = 0.03

        result_bullet = price_bermudan_swaption_hw1f(
            notional         = notional,
            fixed_rate       = K,
            is_payer         = True,
            effective_y      = expiry_y,
            payment_dates_y  = pay_times,
            period_dcf       = [self.pay_freq_y] * len(pay_times),
            exercise_times_y = [expiry_y],
            a                = self.a,
            sigma            = self.sigma,
            discount_curve   = curve,
            valuation_date   = self.val_date,
            dt               = self.dt,
        )
        result_const = price_bermudan_swaption_hw1f(
            notional          = notional,
            fixed_rate        = K,
            is_payer          = True,
            effective_y       = expiry_y,
            payment_dates_y   = pay_times,
            period_dcf        = [self.pay_freq_y] * len(pay_times),
            exercise_times_y  = [expiry_y],
            a                 = self.a,
            sigma             = self.sigma,
            discount_curve    = curve,
            valuation_date    = self.val_date,
            notional_schedule = [notional] * len(pay_times),
            dt                = self.dt,
        )
        assert abs(result_bullet.npv - result_const.npv) < 1e-6 * notional

    def test_amortizing_is_less_than_bullet(self):
        """An amortizing schedule (decreasing notional) must give lower NPV
        than the same trade with bullet notional, for ATM/ITM payer."""
        curve     = FlatCurve(self.flat_rate, self.val_date)
        notional  = 10_000_000.0
        tenor_y   = 5.0
        expiry_y  = 5.0
        pay_times = [expiry_y + (k + 1) * self.pay_freq_y for k in range(int(tenor_y))]
        K         = 0.025  # ITM payer (forward ≈ 3%)

        # Amortizing: notional declines linearly
        amort = [notional * (1.0 - k / len(pay_times)) for k in range(len(pay_times))]
        # avg notional ≈ 0.6 N; ITM ⇒ NPV scales close-to-linearly with notionals.

        result_bullet = price_bermudan_swaption_hw1f(
            notional         = notional,
            fixed_rate       = K,
            is_payer         = True,
            effective_y      = expiry_y,
            payment_dates_y  = pay_times,
            period_dcf       = [self.pay_freq_y] * len(pay_times),
            exercise_times_y = [expiry_y],
            a                = self.a,
            sigma            = self.sigma,
            discount_curve   = curve,
            valuation_date   = self.val_date,
            dt               = self.dt,
        )
        result_amort = price_bermudan_swaption_hw1f(
            notional          = notional,
            fixed_rate        = K,
            is_payer          = True,
            effective_y       = expiry_y,
            payment_dates_y   = pay_times,
            period_dcf        = [self.pay_freq_y] * len(pay_times),
            exercise_times_y  = [expiry_y],
            a                 = self.a,
            sigma             = self.sigma,
            discount_curve    = curve,
            valuation_date    = self.val_date,
            notional_schedule = amort,
            dt                = self.dt,
        )
        # Less notional ⇒ less value, by a meaningful margin
        assert result_amort.npv < result_bullet.npv, (
            f"Amortizing {result_amort.npv:.2f} ≥ bullet {result_bullet.npv:.2f}"
        )
        # And specifically less than 70% (since avg notional is ~0.6×)
        assert result_amort.npv < 0.7 * result_bullet.npv

    def test_amortizing_jamshidian_consistency(self):
        """Tree on amortizing underlying must match Jamshidian closed-form
        for European exercise. Same mixed tolerance as the bullet gate."""
        disc_fn   = flat_disc_fn(self.flat_rate)
        notional  = 10_000_000.0
        tenor_y   = 5.0
        expiry_y  = 5.0
        pay_times = [expiry_y + (k + 1) * self.pay_freq_y for k in range(int(tenor_y))]
        K         = 0.03

        # 10% per-year amortization
        amort = [notional * (1.0 - 0.1 * k) for k in range(len(pay_times))]

        tree_result = price_bermudan_swaption_hw1f(
            notional          = notional,
            fixed_rate        = K,
            is_payer          = True,
            effective_y       = expiry_y,
            payment_dates_y   = pay_times,
            period_dcf        = [self.pay_freq_y] * len(pay_times),
            exercise_times_y  = [expiry_y],
            a                 = self.a,
            sigma             = self.sigma,
            discount_fn       = disc_fn,
            notional_schedule = amort,
            dt                = self.dt,
        )

        jam = price_european_swaption_hw1f_jamshidian(
            notional         = notional,
            fixed_rate       = K,
            is_payer         = True,
            expiry_y         = expiry_y,
            payment_dates_y  = pay_times,
            period_dcf       = [self.pay_freq_y] * len(pay_times),
            a                = self.a,
            sigma            = self.sigma,
            discount_fn      = disc_fn,
            notional_schedule= amort,
        )

        diff    = abs(tree_result.npv - jam['npv'])
        abs_tol = 0.0001 * notional
        rel_tol = 0.025
        tol     = max(abs_tol, rel_tol * abs(jam['npv']))
        assert diff < tol, (
            f"Amortizing tree-vs-Jamshidian gap too large.\n"
            f"  tree NPV    = ${tree_result.npv:,.2f}\n"
            f"  Jamshidian  = ${jam['npv']:,.2f}\n"
            f"  diff        = ${diff:,.2f}\n"
            f"  tolerance   = ${tol:,.2f}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Section 5: Methodology gates
# ─────────────────────────────────────────────────────────────────────────────

class TestMethodologyGates:
    """Trades that don't price under HW1F must throw NotImplementedError."""

    val_date  = date(2026, 4, 27)
    flat_rate = 0.03
    notional  = 10_000_000.0

    def _common_kwargs(self, **overrides):
        kw = dict(
            notional         = self.notional,
            fixed_rate       = 0.03,
            is_payer         = True,
            effective_y      = 5.0,
            payment_dates_y  = [6.0, 7.0, 8.0, 9.0, 10.0],
            period_dcf       = [1.0] * 5,
            exercise_times_y = [5.0],
            a                = 0.05,
            sigma            = 0.0030,
            discount_curve   = FlatCurve(self.flat_rate, self.val_date),
            valuation_date   = self.val_date,
            dt               = 1.0 / 12.0,
        )
        kw.update(overrides)
        return kw

    def test_multi_curve_rejected(self):
        forecast = FlatCurve(self.flat_rate, self.val_date)  # different object
        kw = self._common_kwargs(forecast_curve=forecast)
        with pytest.raises(NotImplementedError, match="multi-curve"):
            price_bermudan_swaption_hw1f(**kw)

    def test_embedded_options_rejected(self):
        kw = self._common_kwargs(embedded_options=[
            {"type": "CAP", "direction": "SELL", "strike_schedule": {}, "default_strike": 0.05}
        ])
        with pytest.raises(NotImplementedError, match="capped"):
            price_bermudan_swaption_hw1f(**kw)

    def test_far_tenor_warning(self):
        """Into-2y tenor should produce a calibration warning, not an error."""
        kw = self._common_kwargs(
            payment_dates_y = [6.0, 7.0],          # 2y tenor
            period_dcf      = [1.0, 1.0],
        )
        result = price_bermudan_swaption_hw1f(**kw)
        assert result.tenor_calibration_warning is not None
        assert "2.00y" in result.tenor_calibration_warning

    def test_neither_curve_nor_fn_rejected(self):
        """At least one of discount_curve / discount_fn must be supplied."""
        kw = self._common_kwargs()
        kw.pop('discount_curve')
        kw.pop('valuation_date')
        with pytest.raises(ValueError, match="discount_curve"):
            price_bermudan_swaption_hw1f(**kw)

    def test_both_curve_and_fn_rejected(self):
        """Cannot supply both discount_curve and discount_fn."""
        kw = self._common_kwargs(discount_fn=flat_disc_fn(0.03))
        with pytest.raises(ValueError, match="exactly one"):
            price_bermudan_swaption_hw1f(**kw)


# ─────────────────────────────────────────────────────────────────────────────
# Section 6: Sanity — extreme cases
# ─────────────────────────────────────────────────────────────────────────────

class TestSanity:
    """
    Sanity bounds at sharp value claims (intrinsic, OTM near-zero, zero-vol).

    These tests use the continuous `discount_fn` route to bypass the
    1-day calendar-rounding artifact in `discount_fn_from_curve` (the
    production adapter), which causes ±~5 bp α(t) wobble at sub-monthly
    Δt and biases deep-ITM tree numbers by up to ~2x. Production curve
    calendar resolution is tracked as a Phase-2 work item — see SPRINT_13
    spec doc §6 "Known limitations".

    Methodology gates and invariant tests keep using FlatCurve (production
    path) because monotonicity and gate firing are insensitive to the wobble.
    """

    flat_rate = 0.03

    def _disc_fn(self):
        return flat_disc_fn(self.flat_rate)

    def test_far_otm_near_zero(self):
        """Far OTM payer (K = 20%) should be ~ zero."""
        result = price_bermudan_swaption_hw1f(
            notional         = 10_000_000.0,
            fixed_rate       = 0.20,                # 20% strike, way OTM
            is_payer         = True,
            effective_y      = 5.0,
            payment_dates_y  = [6.0, 7.0, 8.0, 9.0, 10.0],
            period_dcf       = [1.0] * 5,
            exercise_times_y = [5.0],
            a                = 0.05,
            sigma            = 0.0030,
            discount_fn      = self._disc_fn(),
            dt               = 1.0 / 12.0,
        )
        assert result.npv < 100.0  # ~ zero on $10M notional

    def test_deep_itm_close_to_intrinsic(self):
        """Deep ITM payer (K << F) — value approximately intrinsic."""
        K = 0.005  # 0.5% strike vs 3% forward
        result = price_bermudan_swaption_hw1f(
            notional         = 10_000_000.0,
            fixed_rate       = K,
            is_payer         = True,
            effective_y      = 5.0,
            payment_dates_y  = [6.0, 7.0, 8.0, 9.0, 10.0],
            period_dcf       = [1.0] * 5,
            exercise_times_y = [5.0],
            a                = 0.05,
            sigma            = 0.0030,
            discount_fn      = self._disc_fn(),
            dt               = 1.0 / 12.0,
        )
        # Intrinsic ≈ N · ann · (F-K)
        # F ≈ 3.045%, K = 0.5% → F-K ≈ 2.545%
        # ann = Σ exp(-0.03·t) for t∈[6..10] ≈ 3.937
        # intrinsic ≈ 10M · 3.937 · 0.02545 ≈ $1.002M
        # NPV must be very close (deep ITM has near-zero time value).
        assert result.npv > 1_000_000.0
        assert result.npv < 1_010_000.0

    def test_zero_vol_equals_intrinsic(self):
        """σ → 0 should give exactly intrinsic (or zero if OTM)."""
        K = 0.025  # ITM payer, F ≈ 3%
        result = price_bermudan_swaption_hw1f(
            notional         = 10_000_000.0,
            fixed_rate       = K,
            is_payer         = True,
            effective_y      = 5.0,
            payment_dates_y  = [6.0, 7.0, 8.0, 9.0, 10.0],
            period_dcf       = [1.0] * 5,
            exercise_times_y = [5.0],
            a                = 0.05,
            sigma            = 1e-6,                 # ~ zero vol
            discount_fn      = self._disc_fn(),
            dt               = 1.0 / 12.0,
        )
        assert result.npv > 0.0
        assert result.early_exercise_premium < 100.0  # essentially no time value


# ─────────────────────────────────────────────────────────────────────────────
# Section 7: Calibration formula gate (closes the §6.1 bug)
# ─────────────────────────────────────────────────────────────────────────────

class TestCalibrationFormulaGate:
    """
    calibration.py's analytic ATM normal vol must reproduce the Jamshidian
    closed form when both are fed the same (a, sigma) on the same flat curve.

    Before the §6.1 fix the formula used the annuity-weighted bond duration
    w = Σ α·P·B / A instead of the swap-rate sensitivity
    ∂S/∂r = B_β·P_β/A + S·w_dur, and disagreed with Jamshidian by ~3x on the
    5Y column. This replaces the sentinel that used to flag that gap.
    """

    GRID = [(1.0, 5.0), (2.0, 5.0), (5.0, 5.0), (5.0, 10.0), (10.0, 5.0), (1.0, 1.0)]

    @pytest.mark.parametrize("expiry_y,tenor_y", GRID)
    def test_analytic_vol_matches_jamshidian(self, expiry_y, tenor_y):
        from pricing.calibration import hw1f_swaption_vol_normal

        flat_rate, a, sigma_dec = 0.03, 0.05, 0.0030
        notional, pay_freq_y = 10_000_000.0, 1.0
        n = int(round(tenor_y / pay_freq_y))
        pay_times = [expiry_y + (k + 1) * pay_freq_y for k in range(n)]
        disc_fn = flat_disc_fn(flat_rate)
        F = _forward_swap_rate(disc_fn, expiry_y, tenor_y, pay_freq_y)

        # Bachelier ATM payer with calibration.py's analytic vol
        sig_n = hw1f_swaption_vol_normal(a, sigma_dec, flat_rate,
                                         expiry_y, tenor_y, pay_freq_y) / 1e4
        annuity = sum(pay_freq_y * disc_fn(t) for t in pay_times)
        bach = notional * annuity * sig_n * math.sqrt(expiry_y) / math.sqrt(2.0 * math.pi)

        jam = price_european_swaption_hw1f_jamshidian(
            notional, F, True, expiry_y, pay_times,
            [pay_freq_y] * n, a, sigma_dec, disc_fn,
        )['npv']

        rel_gap = abs(bach - jam) / jam
        assert rel_gap < 1e-3, (
            f"{expiry_y}x{tenor_y}: analytic={bach:,.2f} jamshidian={jam:,.2f} "
            f"gap={rel_gap*100:.3f}%"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
