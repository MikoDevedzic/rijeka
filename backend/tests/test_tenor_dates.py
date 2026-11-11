"""Dates by market convention (pricing/tenor_dates.py): an FX tenor counts from the spot date and rolls modified
following on the joint calendar of both currencies, with the end-of-month rule; a digital asset counts from today
and settles on the next New York business day; an FX option expires the spot lag before its delivery; a digital
asset's option expires on any day and settles on the first New York business day after. The calendar additions
(pricing/calendars.py: joint, why_closed, holidays_between) that carry it."""
from datetime import date, timedelta

import pytest

from pricing import calendars as C
from pricing import tenor_dates as TD


def test_joint_calendar_is_sorted_deduplicated_and_closed_by_either_side():
    assert C.joint("NEW_YORK", "TARGET") == C.joint("TARGET", "NEW_YORK") == "NEW_YORK+TARGET"
    assert C.joint("TARGET+NEW_YORK", "NEW_YORK") == "NEW_YORK+TARGET"
    assert TD.pair_calendar("EURUSD") == "NEW_YORK+TARGET" and TD.pair_calendar("USDJPY") == "NEW_YORK+TOKYO" and TD.pair_calendar("BTCUSD") == "NEW_YORK"
    assert not C.is_business_day(date(2026, 11, 26), "NEW_YORK+TARGET")      # Thanksgiving closes the joint calendar
    assert C.is_business_day(date(2026, 11, 26), "TARGET")
    assert not C.is_business_day(date(2027, 1, 11), "NEW_YORK+TOKYO")        # Coming of Age Day
    assert C.is_business_day(date(2027, 1, 11), "NEW_YORK")


def test_why_closed_names_the_day_or_the_holiday():
    cal = "NEW_YORK+TARGET"
    assert C.why_closed(date(2027, 5, 8), cal) == "Saturday" and C.why_closed(date(2027, 5, 9), cal) == "Sunday"
    assert C.why_closed(date(2026, 11, 26), cal) == "New York holiday (Thanksgiving Day)"
    assert C.why_closed(date(2026, 12, 25), cal) == "New York and TARGET holiday (Christmas Day)"
    assert C.why_closed(date(2027, 1, 11), "NEW_YORK+TOKYO") == "Tokyo holiday (Coming of Age Day)"
    assert C.why_closed(date(2026, 11, 9), cal) is None
    hol = C.holidays_between(cal, date(2026, 11, 9), date(2027, 11, 9))
    assert date(2026, 11, 11) in hol and date(2026, 11, 26) in hol and date(2026, 12, 25) in hol and date(2027, 5, 31) in hol
    assert all(h.weekday() < 5 for h in hol) and hol == sorted(hol)


def test_month_arithmetic_keeps_the_day_and_clamps_to_the_month_end():
    assert TD.add_months(date(2027, 1, 31), 1) == date(2027, 2, 28)
    assert TD.add_months(date(2028, 2, 29), 12) == date(2029, 2, 28)
    assert TD.add_tenor(date(2026, 11, 12), "3M") == date(2027, 2, 12) and TD.add_tenor(date(2026, 11, 12), "18M") == date(2028, 5, 12)
    assert TD.add_tenor(date(2026, 11, 12), "1W") == date(2026, 11, 19) and TD.add_tenor(date(2026, 11, 12), "2Y") == date(2028, 11, 12)
    with pytest.raises(ValueError):
        TD.parse_tenor("3X")


def test_eurusd_3m_counts_from_the_spot_date_and_rolls_on_the_joint_calendar():
    today = date(2026, 11, 9)                                   # Monday; 11 Nov is Veterans Day in New York
    assert TD.spot("EURUSD", today) == date(2026, 11, 12)
    f = TD.forward_dates("EURUSD", today)
    assert f["3M"] == date(2027, 2, 12) and f["1W"] == date(2026, 11, 19) and f["1Y"] == date(2027, 11, 12)
    assert f["2Y"] == date(2028, 11, 13)                        # 12 Nov 2028 is a Sunday: modified following, same month
    # a value date on Christmas Day (closed in both New York and TARGET) rolls to the 28th
    assert TD.spot("EURUSD", date(2026, 11, 23)) == date(2026, 11, 25)
    assert TD.forward_date("EURUSD", date(2026, 11, 23), "1M") == date(2026, 12, 28)
    # a value date on Thanksgiving (New York alone) rolls too
    assert TD.spot("EURUSD", date(2026, 10, 22)) == date(2026, 10, 26)
    assert TD.forward_date("EURUSD", date(2026, 10, 22), "1M") == date(2026, 11, 27)
    # spot Friday 29 Jan 2027 is the last business day of January: the end-of-month rule gives 31 March, not the 29th
    assert TD.forward_date("EURUSD", date(2027, 1, 27), "2M") == date(2027, 3, 31)
    assert TD.spot("EURUSD", date(2026, 11, 27)) == date(2026, 12, 1)
    assert TD.forward_date("EURUSD", date(2026, 11, 27), "6M") == date(2027, 6, 1)


def test_usdjpy_rolls_over_a_tokyo_holiday():
    today = date(2026, 12, 9)                                   # Wednesday; spot Friday 11 Dec
    assert TD.spot("USDJPY", today) == date(2026, 12, 11)
    assert TD.forward_date("USDJPY", today, "1M") == date(2027, 1, 12)        # 11 Jan 2027 is Coming of Age Day
    assert TD.roll("USDJPY", date(2027, 1, 11), "settlement") == {"date": date(2027, 1, 12), "rolled_from": date(2027, 1, 11),
                                                                   "why": "Tokyo holiday (Coming of Age Day)"}


def test_end_of_month_rule_from_a_spot_date_on_the_last_business_day():
    today = date(2027, 6, 28)                                   # Monday; spot Wednesday 30 June, the last business day of June
    assert TD.spot("EURUSD", today) == date(2027, 6, 30) and TD.is_last_business_day_of_month(date(2027, 6, 30), "NEW_YORK+TARGET")
    f = TD.forward_dates("EURUSD", today)
    assert f["2M"] == date(2027, 8, 31)                         # not 30 Aug: the last business day of August
    assert f["1M"] == date(2027, 7, 30)                         # 31 July is a Saturday: the last business day of July
    assert f["1Y"] == date(2028, 6, 30)
    assert f["1W"] == date(2027, 7, 7)                          # weeks are days: the rule is for months
    # a spot date that is not the last business day keeps its day of the month
    assert TD.forward_date("EURUSD", date(2027, 6, 25), "2M") == date(2027, 8, 30)


def test_digital_asset_counts_from_today_and_settles_on_a_new_york_business_day():
    today = date(2026, 11, 9)
    f = TD.forward_dates("BTCUSD", today)
    assert f["6M"] == date(2027, 5, 10)                         # 9 May 2027 is a Sunday: following, Monday
    assert f["3M"] == date(2027, 2, 9) and f["1W"] == date(2026, 11, 16)
    assert TD.forward_date("ETHUSD", date(2026, 10, 26), "1M") == date(2026, 11, 27)        # Thanksgiving: the USD cash moves on Friday
    # following, not modified following: a month-end Saturday goes to the Monday of the next month
    assert TD.forward_date("BTCUSD", date(2027, 4, 29), "1M") == date(2027, 6, 1)            # 29 May 2027 is a Saturday, 31 May Memorial Day


def test_fx_option_expires_the_spot_lag_before_its_delivery():
    today = date(2026, 11, 9)
    o = TD.option_dates("EURUSD", today)
    f = TD.forward_dates("EURUSD", today)
    for t in TD.TENORS:
        assert o[t]["settlement"] == f[t]                       # a 3M option delivers on the 3M forward date
        assert C.is_business_day(o[t]["expiry"], "NEW_YORK+TARGET")
        if o[t]["expiry_rule"] == "spot":
            assert TD.spot("EURUSD", o[t]["expiry"]) == o[t]["settlement"]       # the expiry's spot date is the delivery date
            assert all(TD.spot("EURUSD", o[t]["expiry"] + timedelta(days=k)) != o[t]["settlement"] or not C.is_business_day(o[t]["expiry"] + timedelta(days=k), "NEW_YORK+TARGET")
                       for k in range(1, 5))                                       # and it is the latest such day
    assert o["3M"] == {"expiry": date(2027, 2, 10), "settlement": date(2027, 2, 12), "expiry_rule": "spot"}
    # Emmy's example (vs QuantLib): trade date 10 Nov 2026, 1Y: Veterans Day on T+1 after the expiry is ignored, so the
    # expiry is 10 Nov 2027 for delivery on the 12th, not the 9th (delivery minus two joint business days)
    assert TD.option_date("EURUSD", date(2026, 11, 10), "1Y") == {"expiry": date(2027, 11, 10), "settlement": date(2027, 11, 12), "expiry_rule": "spot"}
    # delivery on the Monday after Thanksgiving week: no business day has it as its spot date (Wednesday's is the
    # Friday, Friday's is 1 December), so the fallback: delivery less two joint business days, and the flag says so
    assert TD.option_date("EURUSD", date(2026, 10, 28), "1M") == {"expiry": date(2026, 11, 25), "settlement": date(2026, 11, 30), "expiry_rule": "fallback"}


def test_digital_asset_option_settles_on_the_forward_date_and_expires_the_business_day_before():
    today = date(2026, 11, 9)
    o, f = TD.option_dates("BTCUSD", today), TD.forward_dates("BTCUSD", today)
    rule = {"expiry_rule": "business day before settlement"}
    for t in TD.TENORS:
        assert o[t]["settlement"] == f[t]                                               # one 3M forward on the ticket, as FX
        assert C.is_business_day(o[t]["expiry"], "NEW_YORK") and C.add_business_days(o[t]["expiry"], 1, "NEW_YORK") == o[t]["settlement"]
    assert o["3M"] == {"expiry": date(2027, 2, 8), "settlement": date(2027, 2, 9), **rule}
    assert o["6M"] == {"expiry": date(2027, 5, 7), "settlement": date(2027, 5, 10), **rule}             # 9 May is a Sunday: settles Monday, fixes Friday
    assert TD.option_date("BTCUSD", date(2026, 11, 25), "1M") == {"expiry": date(2026, 12, 24), "settlement": date(2026, 12, 28), **rule}   # Christmas
    assert TD.option_date("BTCUSD", date(2026, 11, 6), "1W") == {"expiry": date(2026, 11, 12), "settlement": date(2026, 11, 13), **rule}


def test_roll_for_each_kind():
    # FX settlement and expiry: modified following on the joint calendar
    assert TD.roll("EURUSD", date(2026, 11, 26), "settlement") == {"date": date(2026, 11, 27), "rolled_from": date(2026, 11, 26),
                                                                    "why": "New York holiday (Thanksgiving Day)"}
    assert TD.roll("EURUSD", date(2027, 1, 30), "expiry") == {"date": date(2027, 1, 29), "rolled_from": date(2027, 1, 30), "why": "Saturday"}
    assert TD.roll("EURUSD", date(2026, 11, 9), "settlement") == {"date": date(2026, 11, 9), "rolled_from": None, "why": None}
    # digital asset: settlement following on New York, an expiry not rolled
    assert TD.roll("BTCUSD", date(2027, 1, 30), "settlement") == {"date": date(2027, 2, 1), "rolled_from": date(2027, 1, 30), "why": "Saturday"}
    assert TD.roll("BTCUSD", date(2027, 1, 30), "expiry") == {"date": date(2027, 1, 30), "rolled_from": None, "why": None}
    assert TD.roll("BTCUSD", date(2026, 11, 26), "settlement")["why"] == "New York holiday (Thanksgiving Day)"
    with pytest.raises(ValueError):
        TD.roll("BTCUSD", date(2027, 1, 30), "fixing")


def test_calendar_block_and_notes():
    today = date(2026, 11, 9)
    b = TD.calendar_block("EURUSD", today)
    assert b["name"] == "NEW_YORK+TARGET" and b["weekend"] == ["SAT", "SUN"]
    # eleven years of holidays (three until 0.22.0): a date typed out to the ten-year tenor is rolled in the browser too
    assert "2026-11-26" in b["holidays"] and "2027-12-24" in b["holidays"] and "2036-11-27" in b["holidays"]
    assert "2029-11-09" < b["holidays"][-1] <= "2037-11-09"
    assert b["holidays"] == sorted(b["holidays"]) and all(date.fromisoformat(h).weekday() < 5 for h in b["holidays"])
    assert TD.calendar_block("BTCUSD", today)["name"] == "NEW_YORK"
    assert TD.settlement_note("EURUSD", date(2027, 2, 12)) == (True, None)
    ok, note = TD.settlement_note("BTCUSD", date(2027, 5, 9))
    assert ok is False and note == "settlement Sun 9 May 2027 is a Sunday; the market would settle on Mon 10 May 2027"
    ok, note = TD.settlement_note("EURUSD", date(2026, 12, 25), "expiry")
    assert ok is False and note.startswith("expiry Fri 25 Dec 2026 is a New York and TARGET holiday (Christmas Day); the market would expire on Mon 28 Dec 2026")


def test_target_closes_on_good_friday_and_easter_monday_from_the_published_rule():
    assert C.easter_sunday(2027) == date(2027, 3, 28) and C.easter_sunday(2028) == date(2028, 4, 16) and C.easter_sunday(2026) == date(2026, 4, 5)
    assert set(C.target_holidays(2027)) == {date(2027, 1, 1), date(2027, 3, 26), date(2027, 3, 29), date(2027, 5, 1), date(2027, 12, 25), date(2027, 12, 26)}
    assert not C.is_business_day(date(2027, 3, 26), "TARGET") and not C.is_business_day(date(2027, 3, 29), "TARGET")
    assert C.is_business_day(date(2027, 3, 26), "NEW_YORK")                                    # New York is open on Good Friday
    assert C.why_closed(date(2027, 3, 26), "NEW_YORK+TARGET") == "TARGET holiday (Good Friday)"
    assert C.why_closed(date(2027, 3, 29), "NEW_YORK+TARGET") == "TARGET holiday (Easter Monday)"
    # spot Tuesday 26 Jan 2027 + 2M = Good Friday: modified following over Easter Monday to Tuesday 30 March
    assert TD.spot("EURUSD", date(2027, 1, 22)) == date(2027, 1, 26)
    assert TD.forward_date("EURUSD", date(2027, 1, 22), "2M") == date(2027, 3, 30)
    hol = TD.calendar_block("EURUSD", date(2026, 11, 9))["holidays"]
    assert "2027-03-26" in hol and "2027-03-29" in hol and "2028-04-14" in hol and "2028-04-17" in hol
    for today in (date(2027, 1, 22), date(2027, 2, 24), date(2026, 12, 23)):
        for d in TD.forward_dates("EURUSD", today).values():
            assert d not in (date(2027, 3, 26), date(2027, 3, 29)) and C.is_business_day(d, "NEW_YORK+TARGET")


def test_spot_date_by_the_market_rule():
    from api.routes.currencies import spot_date
    # a USD holiday on T+1 is ignored: Tuesday 10 Nov 2026, Veterans Day on the Wednesday, spot Thursday 12 Nov
    assert spot_date(date(2026, 11, 10), False, "EUR", "USD") == date(2026, 11, 12)
    # a USD holiday on the spot date itself moves it: Monday 9 Nov, T+2 would be Veterans Day
    assert spot_date(date(2026, 11, 9), False, "EUR", "USD") == date(2026, 11, 12)
    # a TARGET holiday on T+1 counts: Friday 14 Apr 2028, Easter Monday the 17th, spot Wednesday 19 April
    assert spot_date(date(2028, 4, 14), False, "EUR", "USD") == date(2028, 4, 19)
    assert spot_date(date(2028, 4, 14), False, "USD", "JPY") == date(2028, 4, 18)             # Tokyo is open on Easter Monday
    # a Tokyo holiday moves USDJPY: Thursday 7 Jan 2027, Coming of Age Day on Monday the 11th
    assert spot_date(date(2027, 1, 7), False, "USD", "JPY") == date(2027, 1, 12)
    assert spot_date(date(2026, 11, 2), False, "EUR", "USD") == date(2026, 11, 4)              # the pinned book's spot date
    # a digital asset's spot settles at once: the spot date is the valuation date, the lag 0, tenors count from today
    assert spot_date(date(2026, 11, 9), True, "BTC", "USD") == date(2026, 11, 9) and TD.spot("BTCUSD", date(2026, 11, 9)) == date(2026, 11, 9)
    assert TD.spot_lag("BTCUSD") == 0 and TD.spot_lag("EURUSD") == 2 and TD.spot_lag("USDCAD") == 1
    # USDCAD is T+1: Monday 9 Nov 2026 settles Tuesday; Tuesday 10 Nov, Remembrance Day in Toronto on the 11th, settles Thursday 12th
    assert spot_date(date(2026, 11, 9), False, "USD", "CAD") == date(2026, 11, 10)
    assert spot_date(date(2026, 11, 10), False, "USD", "CAD") == date(2026, 11, 12)
    assert TD.forward_date("USDCAD", date(2026, 11, 9), "1M") == date(2026, 12, 10)
    assert TD.option_date("USDCAD", date(2026, 11, 9), "1M") == {"expiry": date(2026, 12, 9), "settlement": date(2026, 12, 10), "expiry_rule": "spot"}
    # USDCHF from Wednesday 24 Mar 2027: Good Friday and Easter Monday close Zurich, spot Tuesday 30 March
    assert spot_date(date(2027, 3, 24), False, "USD", "CHF") == date(2027, 3, 30)
    assert spot_date(date(2026, 11, 10), False) == date(2026, 11, 12)                          # weekdays alone when no currencies are given
