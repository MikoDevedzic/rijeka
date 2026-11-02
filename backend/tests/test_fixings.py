"""Realised overnight fixings from the daily snapshots (pricing/fixings.py): compounding, carry over days
without a snapshot, the no-data case, and the swap pricer using the lookup."""
from datetime import date, timedelta
import json

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from pricing import fixings as FX
from pricing.curve import Curve
from pricing.ir_swap import price_swap

UID = "00000000-0000-0000-0000-000000000001"


def _db(rows):
    """rows: [(date, on_rate_pct)]; a market_data_snapshots table with one USD_SOFR snapshot per row."""
    s = Session(create_engine("sqlite://"))
    s.execute(text("CREATE TABLE market_data_snapshots (curve_id TEXT, user_id TEXT, valuation_date DATE, quotes TEXT)"))
    for d, r in rows:
        quotes = json.dumps([{"tenor": "ON", "quote_type": "OISDeposit", "rate": r, "enabled": True}, {"tenor": "1Y", "quote_type": "OIS", "rate": 3.7}])
        s.execute(text("INSERT INTO market_data_snapshots VALUES ('USD_SOFR', :u, :d, :q)"), {"u": UID, "d": d, "q": quotes})
    s.commit()                      # the template-user probe rolls back on this database; committed rows survive it
    return s


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    monkeypatch.setattr(FX, "_cache", {})


def test_compounds_daily_and_carries_over_weekends():
    # Thu 30 Oct 4.00%, Fri 31 Oct 4.20% (carried Sat, Sun), Mon 3 Nov 4.10%; period started Thu, as-of Wed 5 Nov
    db = _db([(date(2026, 10, 30), 4.00), (date(2026, 10, 31), 4.20), (date(2026, 11, 3), 4.10)])
    rate, note = FX.realised_rate(db, UID, "USD_SOFR", "USD", date(2026, 10, 30), date(2026, 11, 5), "ACT/360")
    growth = (1 + 0.04 / 360) * (1 + 0.042 / 360) ** 3 * (1 + 0.041 / 360) ** 2
    assert rate == pytest.approx((growth - 1) * 360 / 6)
    assert "3 snapshots" in note and "carried" not in note


def test_period_start_before_first_snapshot_uses_the_last_one_on_or_before_it():
    db = _db([(date(2026, 10, 20), 3.90), (date(2026, 10, 28), 3.95)])
    rate, note = FX.realised_rate(db, UID, "USD_SOFR", "USD", date(2026, 10, 25), date(2026, 10, 30), "ACT/360")
    growth = (1 + 0.039 / 360) ** 3 * (1 + 0.0395 / 360) ** 2          # 25,26,27 at 3.90; 28,29 at 3.95
    assert rate == pytest.approx((growth - 1) * 360 / 5)
    rate2, note2 = FX.realised_rate(db, UID, "USD_SOFR", "USD", date(2026, 10, 10), date(2026, 10, 30), "ACT/360")
    assert rate2 is None and "no USD_SOFR snapshot on or before 2026-10-10" in note2


def test_long_gap_is_flagged_and_act365_legs_get_their_own_basis():
    db = _db([(date(2026, 9, 1), 4.00), (date(2026, 9, 20), 4.00)])
    rate, note = FX.realised_rate(db, UID, "USD_SOFR", "USD", date(2026, 9, 1), date(2026, 9, 25), "ACT/360")
    assert rate == pytest.approx(((1 + 0.04 / 360) ** 24 - 1) * 360 / 24) and "carried 19 days" in note
    # a SONIA leg: 365-day compounding, ACT/365F accrual
    s = Session(create_engine("sqlite://"))
    s.execute(text("CREATE TABLE market_data_snapshots (curve_id TEXT, user_id TEXT, valuation_date DATE, quotes TEXT)"))
    s.execute(text("INSERT INTO market_data_snapshots VALUES ('GBP_SONIA', :u, :d, :q)"),
              {"u": UID, "d": date(2026, 10, 1), "q": json.dumps([{"tenor": "ON", "rate": 4.5}])})
    s.commit()
    rate, _ = FX.realised_rate(s, UID, "GBP_SONIA", "GBP", date(2026, 10, 1), date(2026, 10, 11), "ACT/365F")
    assert rate == pytest.approx(((1 + 0.045 / 365) ** 10 - 1) * 365 / 10)


def test_pricer_uses_the_lookup_and_matches_an_explicit_fixing():
    val = date(2026, 10, 30)
    db = _db([(date(2026, 7, 29), 4.30)])                      # 4.30% every day since the period started
    c = Curve(val, flat_rate=0.038)
    common = {"effective_date": "2026-07-30", "maturity_date": "2028-07-30", "currency": "USD", "notional": 1e7, "payment_frequency": "QUARTERLY",
              "day_count": "ACT/360", "bdc": "MOD_FOLLOWING", "discount_curve_id": "USD_SOFR", "forecast_curve_id": "USD_SOFR"}
    legs = [{**common, "leg_type": "FIXED", "direction": "PAY", "fixed_rate": 0.04}, {**common, "leg_type": "FLOAT", "direction": "RECEIVE"}]
    curves = {"USD_SOFR": c}
    lookup, notes = FX.lookup_for(db, UID, legs, owner=UID)
    with_lookup = price_swap("t", legs, curves, val, fixing_lookup=lookup)
    assert notes and notes[0].startswith("realised USD_SOFR ON from 1 snapshots")
    n = (val - date(2026, 7, 30)).days
    explicit = [dict(legs[0]), {**legs[1], "fixings": {"2026-07-30": ((1 + 0.043 / 360) ** n - 1) * 360 / n}}]
    assert with_lookup.npv == pytest.approx(price_swap("t", explicit, curves, val).npv, abs=1e-6)
    without = price_swap("t", legs, curves, val)
    assert with_lookup.npv > without.npv + 1e4                 # realised 4.30% vs a 3.8% forward on three months
