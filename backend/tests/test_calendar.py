"""The week ahead: dates from the published schedules, actuals attached to the right period, surprise against the previous print."""
from datetime import date

from market_data import calendar as C


def test_yoy_and_diff_from_levels_newest_first():
    pts = [("2026-09", 110.0), ("2026-08", 109.0), ("2025-09", 100.0), ("2025-08", 99.0)]
    assert C.yoy(pts) == [("2026-09", 10.0), ("2026-08", 10.10101010101011)] or abs(C.yoy(pts)[0][1] - 10.0) < 1e-9
    assert C.diff([("2026-09", 1029.0), ("2026-08", 1000.0), ("2026-07", 990.0)]) == [("2026-09", 29.0), ("2026-08", 10.0)]


def test_business_day_helpers():
    assert C.last_business_day(2026, 10) == date(2026, 10, 30)      # Saturday 31st → Friday
    assert C.last_business_day(2026, 11) == date(2026, 11, 30)
    assert C.nth_business_day(2026, 11, 4) == date(2026, 11, 5)      # Nov 2026 starts on a Sunday


def test_scheduled_rows_in_window_from_published_schedules():
    rows = C.scheduled(date(2026, 11, 2), date(2026, 11, 13), ons_next={"cpi": date(2026, 11, 18), "labour": date(2026, 11, 17)})
    names = {(r["ccy"], r["name"], r["date"]) for r in rows}
    assert ("GBP", "MPC decision", "2026-11-05") in names
    assert ("USD", "Non-farm payrolls", "2026-11-06") in names and ("USD", "CPI", "2026-11-10") in names
    assert ("CHF", "CPI", "2026-11-05") in names
    assert not any(r["ccy"] == "GBP" and r["kind"] == "DATA" for r in rows)       # ONS dates fall after the window
    cpi = next(r for r in rows if r["ccy"] == "USD" and r["name"] == "CPI")
    assert cpi["period"] == "2026-10" and cpi["time_local"] == "08:30" and cpi["tz"] == "America/New_York" and cpi["when"].startswith("2026-11-10T13:30")
    assert all(r["estimated"] for r in rows if r["ccy"] in ("EUR", "CHF") and r["kind"] == "DATA")


def test_attach_actuals_uses_previous_print_and_the_row_period():
    rows = [C._row(date(2026, 11, 10), "08:30", "USD", "CPI", "DATA", 1, "2026-10", "US_CPI_YOY", "% y/y"),
            C._row(date(2026, 12, 10), "08:30", "USD", "CPI", "DATA", 1, "2026-11", "US_CPI_YOY", "% y/y")]
    C.attach_actuals(rows, {"US_CPI_YOY": [("2026-10", 3.5), ("2026-09", 3.74), ("2026-08", 3.3)]})
    assert rows[0]["last"] == {"period": "2026-09", "value": 3.74} and rows[0]["actual"] == {"period": "2026-10", "value": 3.5}
    assert abs(rows[0]["surprise"] + 0.24) < 1e-9
    assert rows[1]["last"] == {"period": "2026-10", "value": 3.5} and rows[1]["actual"] is None and rows[1]["surprise"] is None
