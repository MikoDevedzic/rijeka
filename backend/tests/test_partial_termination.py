"""A partial termination, worked out from the booking (chain/partial_termination.py): what changes on a swap, on a
currency forward and on a digital-asset trade, the fee that joins the trade's fees, and everything it refuses."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from chain import partial_termination as PT
from projections.trade_projection import EventLike, project

TODAY = date(2026, 11, 12)


def _trade(**kw):
    base = dict(id=uuid4(), trade_ref="TRD-1", status="CONFIRMED", structure="VANILLA", notional=Decimal("10000000"), notional_ccy="USD", terms=None)
    return SimpleNamespace(**{**base, **kw})


def _leg(notional, **kw):
    return SimpleNamespace(id=uuid4(), notional=None if notional is None else Decimal(str(notional)), notional_schedule=None, **kw)


def test_a_swap_keeps_its_terms_and_every_leg_moves_in_proportion():
    t, legs = _trade(), [_leg("10000000"), _leg("10000000")]
    changes, s = PT.changes_for(t, legs, "6000000", None, TODAY)
    assert changes["trade"] == {"notional": "6000000"}
    assert changes["legs"] == [{"id": str(legs[0].id), "notional": "6000000"}, {"id": str(legs[1].id), "notional": "6000000"}]
    assert s == {"from_notional": "10000000", "to_notional": "6000000", "terminated_notional": "4000000", "notional_ccy": "USD",
                 "effective_date": "2026-11-12", "fee": None}
    # legs in two currencies keep their ratio; a leg with no notional of its own is left alone
    xccy = [_leg("10000000"), _leg("9200000.50"), _leg(None)]
    c2, _ = PT.changes_for(_trade(), xccy, "2500000", None, TODAY)
    assert [x["notional"] for x in c2["legs"]] == ["2500000", "2300000.125"]
    PT.apply(t, legs, changes)
    assert t.notional == Decimal("6000000") and [leg.notional for leg in legs] == [Decimal("6000000")] * 2 and t.terms is None


def test_a_currency_forwards_record_carries_the_new_notional_and_the_cash_in_proportion():
    terms = {"currency_pair": "EURUSD", "base_currency": "EUR", "quote_currency": "USD", "base_notional": "10000000", "quote_notional": "11650000.00",
             "forward_rate": "1.165", "settlement_date": "2027-05-04"}
    t = _trade(notional_ccy="EUR", terms=terms)
    changes, s = PT.changes_for(t, [], Decimal("2500000"), {"direction": "RECEIVE", "amount": 18000, "date": "2026-11-16"}, TODAY)
    new = changes["trade"]["terms"]
    assert new["base_notional"] == "2500000" and new["quote_notional"] == "2912500" and new["forward_rate"] == "1.165"
    assert new["fees"] == [{"type": "UNWIND", "direction": "RECEIVE", "amount": 18000.0, "currency": "USD", "date": "2026-11-16",
                            "note": "partial termination 10000000 to 2500000"}]
    assert s["fee"] == new["fees"][0] and s["terminated_notional"] == "7500000"
    assert terms["base_notional"] == "10000000" and "fees" not in terms, "the booking's own terms are not touched until apply"
    PT.apply(t, [], changes)
    assert t.terms["base_notional"] == "2500000" and t.notional == Decimal("2500000")


def test_a_digital_asset_trade_keeps_the_type_its_record_held_and_its_other_fees():
    terms = {"digital_asset": "BTC", "notional_amount": 10.0, "forward_price": "108600", "price_currency": "USD",
             "fees": [{"type": "BROKERAGE", "direction": "PAY", "amount": 250.0, "currency": "USD", "date": "2026-11-12"}]}
    t = _trade(notional=Decimal("10"), notional_ccy="BTC", terms=terms)
    changes, s = PT.changes_for(t, [], "7.5", {"direction": "PAY", "amount": "1200.50", "date": TODAY.isoformat(), "note": "agreed by phone"}, TODAY)
    new = changes["trade"]["terms"]
    assert new["notional_amount"] == 7.5 and isinstance(new["notional_amount"], float)
    assert [f["type"] for f in new["fees"]] == ["BROKERAGE", "UNWIND"] and new["fees"][1]["amount"] == 1200.5 and new["fees"][1]["note"] == "agreed by phone"
    assert s["to_notional"] == "7.5" and s["notional_ccy"] == "BTC"


@pytest.mark.parametrize("over, new, fee, why", [
    ({}, "10000000", None, "below the trade's 10000000"),
    ({}, "12000000", None, "below the trade's"),
    ({}, "0", None, "above zero"),
    ({}, "-5", None, "above zero"),
    ({}, "abc", None, "the notional is a number"),
    ({"status": "TERMINATED"}, "5000000", None, "only a pending or confirmed trade"),
    ({"status": "CANCELLED"}, "5000000", None, "only a pending or confirmed trade"),
    ({"notional": None}, "5", None, "has no notional to reduce"),
    ({"structure": "TOUCH"}, "5000000", None, "size is a payout"),
    ({"terms": {"payout": "25000"}}, "5000000", None, "size is a payout"),
    ({"terms": {"base_notional": "9000000"}}, "5000000", None, "out of step with itself"),
    ({}, "5000000", {"direction": "PAY", "amount": 100, "date": "2026-11-11"}, "paid today or later"),
    ({}, "5000000", {"direction": "PAY", "amount": -1, "date": "2026-11-13"}, "amount is above zero"),
    ({}, "5000000", {"direction": "SIDEWAYS", "amount": 1, "date": "2026-11-13"}, "PAY or RECEIVE"),
    ({}, "5000000", {"direction": "PAY", "amount": 1, "date": "2026-11-13", "currency": "EUR"}, "the trade's own currency (USD)"),
    ({"terms": {"fees": [{"type": "OTHER", "direction": "PAY", "amount": 1, "currency": "USD", "date": "2026-11-13"}] * 24}}, "5000000",
     {"direction": "PAY", "amount": 1, "date": "2026-11-13"}, "at most 24"),
])
def test_what_it_refuses_and_in_what_words(over, new, fee, why):
    with pytest.raises(ValueError, match=None) as e:
        PT.changes_for(_trade(**over), [_leg("10000000")], new, fee, TODAY)
    assert why in str(e.value), str(e.value)


def test_a_leg_with_a_schedule_of_its_own_is_refused():
    leg = _leg("10000000")
    leg.notional_schedule = [{"date": "2027-01-01", "notional": 8_000_000}]
    with pytest.raises(ValueError) as e:
        PT.changes_for(_trade(), [leg], "5000000", None, TODAY)
    assert "notional schedule" in str(e.value)


def test_the_event_replays_like_an_amendment_and_the_older_shape_still_reads():
    leg_id = str(uuid4())
    booked = EventLike(event_seq=1, event_type="BOOKED", payload={"trade": {"id": "t", "notional": "10", "status": "PENDING", "terms": {"notional_amount": "10"}},
                                                                 "legs": [{"id": leg_id, "notional": "10"}], "cashflows": []})
    part = EventLike(event_seq=2, event_type="PARTIAL_TERMINATION", payload={
        "changes": {"trade": {"notional": "6", "terms": {"notional_amount": "6"}}, "legs": [{"id": leg_id, "notional": "6"}]},
        "partial_termination": {"from_notional": "10", "to_notional": "6"}})
    p = project([booked, part])
    assert p["trade"]["notional"] == "6" and p["trade"]["terms"] == {"notional_amount": "6"} and p["legs"][0]["notional"] == "6"
    old = EventLike(event_seq=2, event_type="PARTIAL_TERMINATION", payload={"leg_id": leg_id, "new_notional": 4})
    assert project([booked, old])["legs"][0]["notional"] == 4
