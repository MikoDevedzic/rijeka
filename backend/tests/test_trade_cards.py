"""
Trade cards: the counterparty's view of the terms, and breaks against their
own booking. Pure functions; no database.
"""

import copy
import os

os.environ.setdefault("DATABASE_URL", "postgresql://unused@localhost/unused")

from api.routes.trade_cards import compare, summarise

BOOKER = {"lei": "254900OPPU84GM83MG36", "name": "RIJEKA CAPITAL"}
CP = {"lei": "DEMO00000000000000CB", "name": "CONFLUENCE BANK AG"}


def _record(own, cp, fixed_dir="PAY", rate="0.04115425", ref="TRD-1"):
    float_dir = "RECEIVE" if fixed_dir == "PAY" else "PAY"
    leg = dict(currency="USD", notional="10000000", day_count="ACT/360", payment_frequency="ANNUAL",
               bdc="MOD_FOLLOWING", spread=None, reset_frequency=None, forecast_curve_id=None)
    return {
        "trade": {"trade_ref": ref, "instrument_type": "IR_SWAP", "structure": "VANILLA", "notional": "10000000",
                  "notional_ccy": "USD", "trade_date": "2026-09-22", "effective_date": "2026-09-24",
                  "maturity_date": "2031-09-24", "terms": {"float_index": "SOFR"}},
        "legs": [
            {**leg, "leg_ref": "FIXED-1", "leg_type": "FIXED", "direction": fixed_dir, "fixed_rate": rate},
            {**leg, "leg_ref": "FLOAT-1", "leg_type": "FLOAT", "direction": float_dir, "fixed_rate": "0",
             "spread": "0", "reset_frequency": "DAILY", "forecast_curve_id": "USD_SOFR"},
        ],
        "parties": {"own": own, "counterparty": cp},
    }


def test_counterparty_sees_the_other_side():
    rec = _record(BOOKER, CP, fixed_dir="PAY")
    booker, cp = summarise(rec, for_counterparty=False), summarise(rec, for_counterparty=True)
    assert [l["you"] for l in booker["legs"]] == ["PAY", "RECEIVE"]
    assert [l["you"] for l in cp["legs"]] == ["RECEIVE", "PAY"]
    assert cp["you"]["name"] == "CONFLUENCE BANK AG" and cp["them"]["name"] == "RIJEKA CAPITAL"
    assert booker["legs"][0]["rate"] == "4.115425%"


def test_mirror_booking_with_its_own_ref_matches():
    shared = _record(BOOKER, CP, fixed_dir="PAY", ref="TRD-1")
    theirs = _record(CP, BOOKER, fixed_dir="RECEIVE", ref="CB-SWP-0042")   # their side, their ref
    assert compare(shared, theirs) == []


def test_rate_break_is_reported():
    shared = _record(BOOKER, CP, fixed_dir="PAY")
    theirs = _record(CP, BOOKER, fixed_dir="RECEIVE", rate="0.04125")
    assert compare(shared, theirs) == [{"field": "FIXED leg fixed_rate", "shared": "0.04115425", "yours": "0.04125"}]


def test_same_direction_on_both_sides_is_a_break():
    shared = _record(BOOKER, CP, fixed_dir="PAY")
    theirs = _record(CP, BOOKER, fixed_dir="PAY")   # both think they pay fixed
    fields = {b["field"] for b in compare(shared, theirs)}
    assert {"FIXED leg direction", "FLOAT leg direction"} <= fields


def test_wrong_parties_and_dates_are_breaks():
    shared = _record(BOOKER, CP)
    theirs = _record({"lei": "OTHER", "name": "X"}, BOOKER, fixed_dir="RECEIVE")
    theirs["trade"]["maturity_date"] = "2031-09-25"
    fields = {b["field"] for b in compare(shared, theirs)}
    assert {"parties", "maturity_date"} <= fields


def test_missing_leg_is_a_break():
    shared = _record(BOOKER, CP)
    theirs = copy.deepcopy(_record(CP, BOOKER, fixed_dir="RECEIVE"))
    theirs["legs"] = theirs["legs"][:1]
    assert {"field": "FLOAT leg", "shared": "present", "yours": "missing"} in compare(shared, theirs)
