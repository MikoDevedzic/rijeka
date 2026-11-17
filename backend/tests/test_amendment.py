"""An amendment of named terms, worked out from the booking (chain/amendment.py): what changes on a swap, on a
currency forward, on a digital-asset forward and on an option; what the form is offered; and everything refused."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from chain import amendment as A
from projections.trade_projection import EventLike, project

TODAY = date(2026, 11, 17)


def _trade(**kw):
    base = dict(id=uuid4(), trade_ref="TRD-1", status="CONFIRMED", asset_class="RATES", instrument_type="IR_SWAP", structure="VANILLA",
                notional=Decimal("10000000"), notional_ccy="USD", terms=None)
    return SimpleNamespace(**{**base, **kw})


def _leg(kind, **kw):
    base = dict(id=uuid4(), leg_type=kind, notional=Decimal("10000000"), notional_schedule=[], fixed_rate=None, fixed_rate_schedule=[],
                spread=None, spread_schedule=[])
    return SimpleNamespace(**{**base, **kw})


def _swap():
    return _trade(), [_leg("FIXED", fixed_rate=Decimal("0.03480003")), _leg("FLOAT", fixed_rate=Decimal("0"), spread=Decimal("0"))]


def test_a_swaps_coupon_and_spread_are_set_on_their_own_legs_in_the_forms_units():
    t, legs = _swap()
    offered = {x["key"]: x for x in A.amendable(t, legs)}
    assert set(offered) == {"notional", "fixed_rate", "spread"}
    assert offered["fixed_rate"]["now"] == "3.480003" and offered["fixed_rate"]["unit"] == "%" and offered["spread"]["now"] == "0" and offered["spread"]["unit"] == "bp"
    changes, s = A.changes_for(t, legs, {"fixed_rate": "3.55", "spread": 12.5}, TODAY, reason="rate agreed again\nafter the fixing")
    assert "trade" not in changes
    assert changes["legs"] == [{"id": str(legs[0].id), "fixed_rate": "0.0355"}, {"id": str(legs[1].id), "spread": "0.00125"}]
    assert s == {"kind": "AMENDMENT", "increase": False, "effective_date": "2026-11-17", "reason": "rate agreed again after the fixing",
                 "terms": [{"key": "fixed_rate", "label": "FIXED RATE", "from": "3.480003", "to": "3.55", "unit": "%"},
                           {"key": "spread", "label": "SPREAD", "from": "0", "to": "12.5", "unit": "bp"}]}
    A.apply(t, legs, changes)
    assert legs[0].fixed_rate == Decimal("0.0355") and legs[1].spread == Decimal("0.00125") and t.notional == Decimal("10000000")


def test_an_increase_moves_every_leg_in_proportion_and_a_decrease_is_sent_to_a_partial_termination():
    t, legs = _swap()
    legs.append(_leg("FLOAT", notional=Decimal("9200000.50")))          # a second currency's leg keeps its ratio
    with pytest.raises(ValueError, match="more than one floating leg"):
        A.changes_for(t, legs, {"spread": 5}, TODAY)
    changes, s = A.changes_for(t, legs, {"notional": "12500000"}, TODAY)
    assert changes["trade"] == {"notional": "12500000"}
    assert [c["notional"] for c in changes["legs"]] == ["12500000", "12500000", "11500000.625"]
    assert s["increase"] is True and s["terms"] == [{"key": "notional", "label": "NOTIONAL", "from": "10000000", "to": "12500000", "unit": "USD"}]
    with pytest.raises(ValueError, match="partially terminate"):
        A.changes_for(t, legs, {"notional": "9999999"}, TODAY)
    with pytest.raises(ValueError, match="already has"):
        A.changes_for(t, legs, {"notional": "10000000", "fixed_rate": "3.480003"}, TODAY)


def test_the_copy_of_a_swaps_coupon_and_spread_in_the_trades_terms_moves_with_the_leg():
    t, legs = _swap()
    t.terms = {"fixed_rate": 0.03480003, "spread": 0, "float_index": "SOFR", "fees": []}
    changes, _ = A.changes_for(t, legs, {"fixed_rate": "3.55", "spread": "12.5"}, TODAY)
    assert changes["trade"] == {"terms": {"fixed_rate": 0.0355, "spread": 0.00125, "float_index": "SOFR", "fees": []}}, "a number stays a number, and nothing else moves"
    A.apply(t, legs, changes)
    assert t.terms["fixed_rate"] == 0.0355 and legs[0].fixed_rate == Decimal("0.0355")
    t.terms = {**t.terms, "fixed_rate": 0.04}
    with pytest.raises(ValueError, match="out of step"):
        A.changes_for(t, legs, {"fixed_rate": "3.6"}, TODAY)


def test_a_pending_trades_change_is_a_correction():
    t, legs = _swap()
    t.status = "PENDING"
    assert A.changes_for(t, legs, {"fixed_rate": 3.5}, TODAY)[1]["kind"] == "CORRECTION"


def test_a_currency_forwards_rate_moves_the_cash_it_states_and_an_increase_moves_both_notionals():
    terms = {"currency_pair": "EURUSD", "base_currency": "EUR", "quote_currency": "USD", "base_notional": "10000000", "quote_notional": "11650000.00",
             "forward_rate": "1.165", "value_date": "2027-05-04", "settlement_type": "DELIVERABLE", "fees": [{"type": "UPFRONT", "amount": 5}]}
    t = _trade(asset_class="FX", instrument_type="FX_FORWARD", notional_ccy="EUR", terms=terms)
    assert [(x["key"], x["now"], x["unit"]) for x in A.amendable(t, [])] == [("notional", "10000000", "EUR"), ("forward_rate", "1.165", "USD")]
    changes, s = A.changes_for(t, [], {"forward_rate": "1.17", "notional": 12_000_000}, TODAY)
    new = changes["trade"]["terms"]
    assert changes["trade"]["notional"] == "12000000" and changes["legs"] == []
    assert new["base_notional"] == "12000000" and new["forward_rate"] == "1.17" and new["quote_notional"] == "14040000"
    assert new["fees"] == terms["fees"] and new["value_date"] == "2027-05-04", "nothing else in the record moves"
    assert terms["forward_rate"] == "1.165", "the booking's own terms are not touched until the changes are applied"
    assert [d["key"] for d in s["terms"]] == ["notional", "forward_rate"]
    A.apply(t, [], changes)
    assert t.terms["quote_notional"] == "14040000" and t.notional == Decimal("12000000")
    # the record out of step with the trade is refused, not papered over
    bad = _trade(asset_class="FX", instrument_type="FX_FORWARD", terms={**terms, "base_notional": "9000000"})
    with pytest.raises(ValueError, match="out of step"):
        A.changes_for(bad, [], {"notional": "11000000"}, TODAY)


def test_a_digital_asset_forwards_price_and_an_options_strike_are_the_records_own_terms():
    fwd = _trade(asset_class="CRYPTO", instrument_type="CRYPTO_FORWARD", notional=Decimal("10"), notional_ccy="BTC",
                 terms={"digital_asset": "BTC", "notional_amount": "10", "forward_price": "108463.58", "price_currency": "USD"})
    changes, s = A.changes_for(fwd, [], {"forward_price": "109000"}, TODAY)
    assert changes["trade"] == {"terms": {**fwd.terms, "forward_price": "109000"}}
    assert s["terms"] == [{"key": "forward_price", "label": "FORWARD PRICE", "from": "108463.58", "to": "109000", "unit": "USD"}]
    opt = _trade(asset_class="CRYPTO", instrument_type="CRYPTO_OPTION", structure="EUROPEAN", notional=Decimal("10"), notional_ccy="BTC",
                 terms={"notional_amount": 10.0, "strike_price": 100000.0, "strike_currency": "USD", "option_type": "CALL"})
    c2, _ = A.changes_for(opt, [], {"strike": "101000", "notional": "15"}, TODAY)
    assert c2["trade"]["terms"]["strike_price"] == 101000.0 and c2["trade"]["terms"]["notional_amount"] == 15.0, "a number stays a number in the record"
    fxo = _trade(asset_class="FX", instrument_type="FX_OPTION", structure="BARRIER", notional_ccy="EUR",
                 terms={"base_notional": "10000000", "quote_notional": "11000000", "strike": "1.10", "barrier": "1.2", "quote_currency": "USD"})
    c3, _ = A.changes_for(fxo, [], {"strike": "1.12"}, TODAY)
    assert c3["trade"]["terms"]["strike"] == "1.12" and c3["trade"]["terms"]["quote_notional"] == "11200000" and c3["trade"]["terms"]["barrier"] == "1.2"


def test_what_cannot_be_amended_is_listed_with_its_reason_and_refused_in_the_same_words():
    t, legs = _swap()
    legs[0].fixed_rate_schedule = [{"date": "2027-01-01", "rate": 0.04}]
    legs[1].notional_schedule = [{"date": "2027-01-01", "notional": 5_000_000}]
    offered = {x["key"]: x["why_not"] for x in A.amendable(t, legs)}
    assert offered == {"notional": "a leg of this trade has a notional schedule of its own", "fixed_rate": "the fixed leg has a rate schedule of its own", "spread": None}
    with pytest.raises(ValueError, match="rate schedule of its own: amending its fixed rate is not built yet"):
        A.changes_for(t, legs, {"fixed_rate": 4}, TODAY)
    touch = _trade(asset_class="CRYPTO", instrument_type="CRYPTO_OPTION", structure="TOUCH", notional=Decimal("10"), terms={"payout": 100000, "notional_amount": "10"})
    assert [(x["key"], bool(x["why_not"])) for x in A.amendable(touch, [])] == [("notional", True)], "a touch has no strike, and its size is a payout"
    with pytest.raises(ValueError, match="has no strike to amend"):
        A.changes_for(touch, [], {"strike": 1}, TODAY)
    cap = _trade(instrument_type="IR_CAP")
    assert [x["key"] for x in A.amendable(cap, [_leg("FLOAT", spread=Decimal("0"))])] == ["notional"], "a cap's strike is not amended here yet"
    for request, why in (({}, "at least one term"), ({"maturity_date": "2030-01-01"}, "not a term an amendment can set"), ({"fixed_rate": "abc"}, "is a number"),
                         ({"fixed_rate": "250"}, "between -100 and 100"), ({"spread": "1e9"}, "basis points"), ({"notional": "1e40"}, "is a number")):
        with pytest.raises(ValueError, match=why):
            A.changes_for(*_swap(), request, TODAY)
    with pytest.raises(ValueError, match="above zero"):
        A.changes_for(_trade(asset_class="CRYPTO", instrument_type="CRYPTO_FORWARD", terms={"notional_amount": "10", "forward_price": "5"}, notional=Decimal("10")),
                      [], {"forward_price": "0"}, TODAY)
    gone, legs2 = _swap()
    gone.status = "TERMINATED"
    with pytest.raises(ValueError, match="only a pending or confirmed trade"):
        A.changes_for(gone, legs2, {"fixed_rate": 3}, TODAY)


def test_the_reason_is_one_printable_line_of_bounded_length():
    assert A.clean_reason("  two\tlines\n here\x00 ") == "two lines here"
    assert A.clean_reason("") is None and A.clean_reason(None) is None and len(A.clean_reason("x" * 900)) == A.REASON_MAX


def test_the_event_replays_like_any_amendment():
    t, legs = _swap()
    changes, s = A.changes_for(t, legs, {"fixed_rate": "3.55", "notional": "11000000"}, TODAY)
    booked = EventLike(event_seq=1, event_type="BOOKED", payload={"trade": {"id": str(t.id), "notional": "10000000", "status": "PENDING"},
                                                                 "legs": [{"id": str(leg.id), "notional": "10000000", "fixed_rate": "0.0348"} for leg in legs]})
    p = project([booked, EventLike(event_seq=2, event_type="AMENDED", payload={"changes": changes, "amendment": s})])
    assert p["trade"]["notional"] == "11000000" and p["legs"][0]["fixed_rate"] == "0.0355" and p["legs"][1]["notional"] == "11000000"
