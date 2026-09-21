"""
Tests for the three schedule resolvers in pricing/ir_swap.py:
  - _resolve_step_up_rate
  - _resolve_spread_schedule
  - _resolve_notional_schedule

Step-function semantics (per Sprint 5B/5D):
  Period uses the latest schedule entry where entry.date <= period_start.
  If no entry qualifies, fall back to the default value.
  Falsy schedules (None, [], {}) return the default unchanged.

These resolvers shipped Sprint 5B (Apr 7) for STEP_UP rate schedules and
Sprint 5D (Apr 9) for AMORTIZING notional schedules. Tests were not written
at the time. Sprint 12 item 5 closure backfills them.
"""

import pytest
from datetime import date

from pricing.ir_swap import (
    _resolve_step_up_rate,
    _resolve_spread_schedule,
    _resolve_notional_schedule,
)


# Each parametrized over the three resolvers with the field name they read
# and a representative default + alternate values.
RESOLVERS = [
    pytest.param(
        _resolve_step_up_rate, "rate",
        0.04, 0.05, 0.06, 0.07,
        id="rate",
    ),
    pytest.param(
        _resolve_spread_schedule, "spread",
        0.0005, 0.0010, 0.0015, 0.0020,
        id="spread",
    ),
    pytest.param(
        _resolve_notional_schedule, "notional",
        10_000_000.0, 8_000_000.0, 6_000_000.0, 4_000_000.0,
        id="notional",
    ),
]


@pytest.mark.parametrize("resolver,field,default,v1,v2,v3", RESOLVERS)
class TestStepFunctionSemantics:
    """Common step-function semantics across all three schedule resolvers."""

    def test_none_returns_default(self, resolver, field, default, v1, v2, v3):
        assert resolver(None, date(2026, 1, 1), default) == default

    def test_empty_list_returns_default(self, resolver, field, default, v1, v2, v3):
        assert resolver([], date(2026, 1, 1), default) == default

    def test_empty_dict_returns_default(self, resolver, field, default, v1, v2, v3):
        assert resolver({}, date(2026, 1, 1), default) == default

    def test_single_entry_before_period_applies(self, resolver, field, default, v1, v2, v3):
        sched = [{"date": "2025-06-01", field: v1}]
        assert resolver(sched, date(2026, 1, 1), default) == v1

    def test_single_entry_after_period_falls_back(self, resolver, field, default, v1, v2, v3):
        sched = [{"date": "2027-01-01", field: v1}]
        assert resolver(sched, date(2026, 1, 1), default) == default

    def test_entry_exactly_on_period_boundary_applies(self, resolver, field, default, v1, v2, v3):
        # Step-function rule: entry.date <= period_start (inclusive).
        sched = [{"date": "2026-04-01", field: v1}]
        assert resolver(sched, date(2026, 4, 1), default) == v1

    def test_entry_one_day_after_period_does_not_apply(self, resolver, field, default, v1, v2, v3):
        sched = [{"date": "2026-04-02", field: v1}]
        assert resolver(sched, date(2026, 4, 1), default) == default

    def test_multiple_entries_step_correctly(self, resolver, field, default, v1, v2, v3):
        sched = [
            {"date": "2026-04-01", field: v1},
            {"date": "2027-04-01", field: v2},
            {"date": "2028-04-01", field: v3},
        ]
        assert resolver(sched, date(2026, 1, 1), default) == default
        assert resolver(sched, date(2026, 4, 1), default) == v1
        assert resolver(sched, date(2027, 1, 1), default) == v1
        assert resolver(sched, date(2027, 4, 1), default) == v2
        assert resolver(sched, date(2028, 4, 1), default) == v3
        assert resolver(sched, date(2030, 1, 1), default) == v3

    def test_out_of_order_entries_get_sorted(self, resolver, field, default, v1, v2, v3):
        # Schedule given in reverse order; resolver sorts internally.
        sched = [
            {"date": "2027-04-01", field: v2},
            {"date": "2026-04-01", field: v1},
        ]
        assert resolver(sched, date(2026, 6, 1), default) == v1
        assert resolver(sched, date(2027, 6, 1), default) == v2

    def test_dict_form_works(self, resolver, field, default, v1, v2, v3):
        sched = {"2026-04-01": v1, "2027-04-01": v2}
        assert resolver(sched, date(2026, 6, 1), default) == v1
        assert resolver(sched, date(2027, 6, 1), default) == v2

    def test_effective_date_key_works_as_alternative(self, resolver, field, default, v1, v2, v3):
        # Resolvers accept "effective_date" as an alternative to "date".
        sched = [{"effective_date": "2026-04-01", field: v1}]
        assert resolver(sched, date(2026, 6, 1), default) == v1


# ----- Edge cases: tested once via _resolve_step_up_rate as a proxy. -----

class TestEdgeCases:
    """Edge cases tested on _resolve_step_up_rate. Behavior is identical
    across all three resolvers (same _parse_date + sort + walk pattern)."""

    def test_invalid_date_string_skipped(self):
        # Entries that fail _parse_date are silently dropped.
        sched = [
            {"date": "not-a-date", "rate": 0.99},
            {"date": "2026-04-01", "rate": 0.06},
        ]
        assert _resolve_step_up_rate(sched, date(2026, 6, 1), 0.04) == 0.06

    def test_all_invalid_dates_returns_default(self):
        sched = [
            {"date": "garbage", "rate": 0.99},
            {"date": "", "rate": 0.88},
        ]
        assert _resolve_step_up_rate(sched, date(2026, 6, 1), 0.04) == 0.04

    def test_pre_effective_date_entry_applies_to_all_periods(self):
        # Entry dated before any period_start in a typical trade qualifies
        # for every period (entry.date <= period_start always true).
        sched = [{"date": "2020-01-01", "rate": 0.025}]
        assert _resolve_step_up_rate(sched, date(2026, 1, 1), 0.04) == 0.025
        assert _resolve_step_up_rate(sched, date(2030, 1, 1), 0.04) == 0.025

    def test_post_maturity_entry_never_applies(self):
        # Entry dated after every period_start in the trade never qualifies.
        sched = [{"date": "2050-01-01", "rate": 0.99}]
        assert _resolve_step_up_rate(sched, date(2026, 1, 1), 0.04) == 0.04
        assert _resolve_step_up_rate(sched, date(2030, 1, 1), 0.04) == 0.04

    def test_duplicate_dates_last_in_sorted_order_wins(self):
        # Stable sort + sequential walk -> last entry with same date wins.
        sched = [
            {"date": "2026-04-01", "rate": 0.05},
            {"date": "2026-04-01", "rate": 0.06},
        ]
        assert _resolve_step_up_rate(sched, date(2026, 6, 1), 0.04) == 0.06
