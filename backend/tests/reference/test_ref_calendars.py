"""The seven business-day calendars (pricing/calendars.py) against QuantLib's, three years from 9 Nov 2026.

Rijeka's calendars come from the `holidays` package at the financial centre's subdivision (England, Zurich, New South
Wales), from a published rule (TARGET: ECB closing days; Toronto: the Canadian bank holidays), or from the national
list plus the bank closures the list leaves out (Tokyo: 2 and 3 January, 31 December). QuantLib's are the market
calendars its users price on. For each, every weekday QuantLib closes must be closed here (a missing holiday puts a
settlement on a day the cash cannot move: Emmy found USDCHF spot on Good Friday, 9 Nov 2026), and every weekday
closed here must be closed in QuantLib (an extra one moves a date for no reason). Both counts must be zero."""
from __future__ import annotations

from datetime import date

import QuantLib as ql

from pricing.calendars import holidays_between
from tests.reference.refmarket import Row, assert_rows, pd_, qd

START, END = date(2026, 11, 9), date(2029, 11, 9)
QL_CALENDARS = {
    "NEW_YORK": ql.UnitedStates(ql.UnitedStates.Settlement),
    "TARGET": ql.TARGET(),
    "LONDON": ql.UnitedKingdom(ql.UnitedKingdom.Settlement),
    "ZURICH": ql.Switzerland(),
    "SYDNEY": ql.Australia(),
    "TORONTO": ql.Canada(),
    "TOKYO": ql.Japan(),
}


def _ql_weekday_holidays(cal) -> set[date]:
    return {pd_(q) for q in cal.holidayList(qd(START), qd(END), False) if pd_(q).weekday() < 5}


def calendar_rows() -> list[Row]:
    rows = []
    for name, cal in QL_CALENDARS.items():
        theirs, ours = _ql_weekday_holidays(cal), set(holidays_between(name, START, END))
        missing, extra = sorted(theirs - ours), sorted(ours - theirs)
        case = f"{name} {START}..{END} ({len(theirs)} QuantLib weekday holidays)"
        rows.append(Row("calendar", case, "weekday holidays QuantLib has and Rijeka lacks", len(missing), 0, "days", 0,
                        extra={"missing": [d.isoformat() for d in missing]}))
        rows.append(Row("calendar", case, "weekday holidays Rijeka has and QuantLib lacks", len(extra), 0, "days", 0,
                        extra={"extra": [d.isoformat() for d in extra]}))
    return rows


def all_rows() -> list[Row]:
    return calendar_rows()


def test_calendars_against_quantlib():
    rows = calendar_rows()
    detail = "\n".join(f"{r.case}: {r.metric}: {r.extra}" for r in rows if not r.ok)
    assert all(r.ok for r in rows), detail
    assert_rows(rows)
