"""
Trade cards: each side's view of the terms, and breaks against the
counterparty's own booking. Pure functions over canonical records; no database.
"""

import os
from datetime import date
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "postgresql://unused@localhost/unused")

from api.routes.trade_cards import compare, summarise
from chain.canonical import canonical_payload

BOOKER = {"lei": "254900OPPU84GM83MG36", "name": "RIJEKA CAPITAL"}
CP = {"lei": "DEMO00000000000000CB", "name": "CONFLUENCE BANK AG"}
NAMES = {BOOKER["lei"]: BOOKER["name"], CP["lei"]: CP["name"]}
UTI = BOOKER["lei"] + "0" * 32
FLIP = {"PAY": "RECEIVE", "RECEIVE": "PAY"}


def _trade(**over):
    t = dict(trade_ref="TRD-1", uti=UTI, asset_class="RATES", instrument_type="IR_SWAP", structure="VANILLA",
             notional=Decimal("10000000"), notional_ccy="USD", trade_date=date(2026, 9, 22),
             effective_date=date(2026, 9, 24), maturity_date=date(2031, 9, 24), terms={})
    t.update(over)
    return t


def _legs(fixed_dir="PAY", rate="0.04115425"):
    base = dict(currency="USD", notional=Decimal("10000000"), day_count="ACT/360", payment_frequency="ANNUAL",
                bdc="MOD_FOLLOWING", embedded_options=[], terms={})
    return [
        {**base, "leg_ref": "FIXED-1", "leg_seq": 1, "leg_type": "FIXED", "direction": fixed_dir,
         "fixed_rate": Decimal(rate), "forecast_curve_id": None},
        {**base, "leg_ref": "FLOAT-1", "leg_seq": 2, "leg_type": "FLOAT", "direction": FLIP[fixed_dir],
         "fixed_rate": Decimal("0"), "spread": Decimal("0"), "reset_frequency": "DAILY", "forecast_curve_id": "USD_SOFR"},
    ]


def _ours(**kw):
    return canonical_payload(_trade(), _legs(**kw), BOOKER, CP)


def _theirs(fixed_dir="RECEIVE", rate="0.04115425", **trade_over):
    """Confluence's own booking: their ref, their side of every leg."""
    return canonical_payload(_trade(trade_ref="CB-SWP-0042", **trade_over), _legs(fixed_dir, rate), CP, BOOKER)


def test_each_side_reads_its_own_side():
    rec = _ours()
    booker, cp = summarise(rec, BOOKER["lei"], NAMES), summarise(rec, CP["lei"], NAMES)
    assert [l["you"] for l in booker["legs"] if l["leg_type"] == "FIXED"] == ["PAY"]
    assert [l["you"] for l in cp["legs"] if l["leg_type"] == "FIXED"] == ["RECEIVE"]
    assert cp["you"]["name"] == "CONFLUENCE BANK AG" and cp["them"]["name"] == "RIJEKA CAPITAL"
    assert next(l for l in booker["legs"] if l["leg_type"] == "FIXED")["rate"] == "4.115425%"
    assert next(l for l in cp["legs"] if l["leg_type"] == "FLOAT")["index"] == "USD_SOFR"


def test_v1_records_still_summarise():
    rec = canonical_payload(_trade(), _legs(), BOOKER, CP, version=1)
    cp = summarise(rec, CP["lei"])
    assert [l["you"] for l in cp["legs"]] == ["RECEIVE", "PAY"]
    assert cp["you"]["name"] == "CONFLUENCE BANK AG"


def test_their_own_booking_is_the_same_record():
    assert _ours() == _theirs()
    assert compare(_ours(), _theirs()) == []


def test_a_booking_made_before_sharing_matches_on_terms_despite_its_own_uti():
    assert compare(_ours(), _theirs(uti="SOMEONE-ELSES-UTI")) == []


def test_rate_break_is_reported():
    breaks = compare(_ours(), _theirs(rate="0.04125"))
    assert breaks == [{"field": "FIXED leg fixed_rate", "shared": "0.04115425", "yours": "0.04125"}]


def test_both_paying_fixed_is_a_who_pays_break():
    fields = {b["field"] for b in compare(_ours(), _theirs(fixed_dir="PAY"))}
    assert {"FIXED leg who pays", "FIXED leg who receives", "FLOAT leg who pays"} <= fields


def test_date_break_and_missing_leg():
    theirs = _theirs(maturity_date=date(2031, 9, 25))
    assert {"field": "maturity_date", "shared": "2031-09-24", "yours": "2031-09-25"} in compare(_ours(), theirs)
    one_leg = canonical_payload(_trade(trade_ref="X"), _legs("RECEIVE")[:1], CP, BOOKER)
    assert {"field": "FLOAT leg", "shared": "present", "yours": "missing"} in compare(_ours(), one_leg)


# ── Booking the counterparty's side ──────────────────────────────────────────

from types import SimpleNamespace

from api.routes.trade_cards import _mirror_leg, _mirror_terms


def test_mirror_terms_flips_every_direction_and_nothing_else():
    terms = {"direction": "PAY", "float_direction": "RECEIVE", "fixed_rate": "0.04",
             "nested": {"cap_direction": "BUY"}, "notes": "PAY attention"}
    assert _mirror_terms(terms) == {"direction": "RECEIVE", "float_direction": "PAY", "fixed_rate": "0.04",
                                    "nested": {"cap_direction": "SELL"}, "notes": "PAY attention"}


def test_mirror_booking_hashes_to_the_same_v2_record():
    """The counterparty's side, built the way book_mirror builds it, is the same record."""
    legs = _legs()
    legs[1]["embedded_options"] = [{"type": "CAP", "direction": "SELL", "default_strike": Decimal("0.05"), "strike_schedule": []}]
    legs[1]["terms"] = {"custom_cashflows": [{"type": "FEE", "payment_date": "2026-09-25", "accrual_start": None,
                                               "accrual_end": None, "amount": -25000, "currency": "USD"}]}
    rows = [SimpleNamespace(**{**l, "leg_seq": i + 1, "notional_type": "BULLET", "payment_lag": 0,
                               "fixed_rate_type": "FLAT", "spread_type": "FLAT", "leverage": Decimal("1")})
            for i, l in enumerate(legs)]
    mirrored = [_mirror_leg(r).model_dump() for r in rows]
    ours = canonical_payload(_trade(), [vars(r) for r in rows], BOOKER, CP)
    theirs = canonical_payload(_trade(trade_ref="THEIRS"), mirrored, CP, BOOKER)
    assert ours == theirs
    assert [m["direction"] for m in mirrored] == ["RECEIVE", "PAY"]
    assert mirrored[1]["embedded_options"][0]["direction"] == "BUY"
    assert mirrored[1]["terms"]["custom_cashflows"][0]["amount"] == 25000


def _fxo(**over):
    terms = {"style": "BARRIER", "strike": "1.17", "barrier": "1.25", "direction": "BUY", "expiry_date": "2027-02-02", "expiry_time": "10:00 New York",
             "option_type": "CALL", "barrier_type": "UP_OUT", "base_currency": "EUR", "base_notional": "10000000", "currency_pair": "EURUSD",
             "exercise_style": "EUROPEAN", "premium_amount": "0", "quote_currency": "USD", "quote_notional": "11700000", "settlement_date": "2027-02-04",
             "settlement_type": "DELIVERABLE", "premium_currency": "USD", "calculation_agent": None, "automatic_exercise": True,
             "barrier_monitoring": "CONTINUOUS", "premium_payment_date": "2026-11-02", "barrier_determination_agent": None}
    terms.update(over)
    return _trade(asset_class="FX", instrument_type="FX_OPTION", structure="BARRIER", notional_ccy="EUR", terms=terms)


def test_product_records_summarise_and_compare():
    """An FX option (or forward) record has a product block and no legs: each side reads buy/sell, and a
    counterparty booking with the same terms shows no breaks. (A KeyError here is what made the chat
    send fail as 'could not reach Rijeka' on 2026-11-02.)"""
    rec = canonical_payload(_fxo(), [], BOOKER, CP)
    booker, cp = summarise(rec, BOOKER["lei"], NAMES), summarise(rec, CP["lei"], NAMES)
    assert booker["legs"] == [] and booker["product"]["you"] == "BUY" and cp["product"]["you"] == "SELL"
    assert booker["product"]["name"] == "FX_OPTION" and booker["product"]["fields"]["barrier_type"] == "UP_OUT"
    assert "buyer" not in booker["product"]["fields"] and "payout" not in booker["product"]["fields"]     # nulls dropped
    theirs = canonical_payload(_fxo(direction="SELL"), [], CP, BOOKER)            # their booking: they sold it
    assert compare(rec, theirs) == []
    off = canonical_payload(_fxo(direction="SELL", strike="1.18"), [], CP, BOOKER)
    assert [b["field"] for b in compare(rec, off)] == ["strike"]
    swapped = canonical_payload(_fxo(), [], CP, BOOKER)                            # they think they bought it
    assert {b["field"] for b in compare(rec, swapped)} == {"who buys", "who sells"}


def test_unhandled_errors_answer_as_json_with_cors():
    from fastapi.testclient import TestClient
    from main import app
    @app.get("/__boom")
    def boom():
        raise KeyError("legs")
    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/__boom", headers={"Origin": "https://app.rijeka.app"})
    assert r.status_code == 500 and "server log" in r.json()["detail"]
    assert r.headers.get("access-control-allow-origin") == "https://app.rijeka.app"


def test_product_mirror_books_without_legs_and_hashes_to_the_same_record():
    """The counterparty's booking of an FX option, built the way book_mirror builds it: the terms with the
    direction flipped, no legs. BookingRequest used to refuse a trade without legs, so the countersigner's
    blotter never received product trades (2026-11-02)."""
    from api.routes.booking import BookingRequest
    src = _fxo()
    ours = canonical_payload(src, [], BOOKER, CP)
    mirrored = _mirror_terms(src["terms"])
    assert mirrored["direction"] == "SELL" and mirrored["option_type"] == "CALL" and mirrored["barrier_type"] == "UP_OUT"
    theirs = canonical_payload(_trade(trade_ref="THEIRS", asset_class="FX", instrument_type="FX_OPTION", structure="BARRIER", notional_ccy="EUR", terms=mirrored), [], CP, BOOKER)
    assert ours == theirs
    body = BookingRequest(asset_class="FX", instrument_type="FX_OPTION", structure="BARRIER", notional=Decimal("10000000"), notional_ccy="EUR",
                          trade_date=date(2026, 11, 2), effective_date=date(2026, 11, 2), maturity_date=date(2027, 2, 4), terms=mirrored, legs=[])
    assert body.legs == []
    import pytest
    with pytest.raises(ValueError):
        BookingRequest(asset_class="RATES", instrument_type="IR_SWAP", notional=Decimal("1"), trade_date=date(2026, 11, 2),
                       effective_date=date(2026, 11, 2), maturity_date=date(2027, 2, 4), legs=[])


# ── An option on a rate: record v3 states the option (0.61.0) ────────────────────────────────────
# Under v2 a swaption's record was the swap it delivers: a bought and a sold one signed the same bytes, the sold
# one's legs named the wrong payer, and the counterparty's own booking was made with the booker's side.

import pytest

from api.routes.trade_cards import _mirror_option_terms
from chain.canonical import signing_version, trade_hash_hex


def _swaption(side="SELL", is_payer=True, **terms_over):
    terms = {"direction": "PAY" if is_payer else "RECEIVE", "float_direction": "RECEIVE" if is_payer else "PAY", "option": "SWAPTION",
             "side": side, "is_payer": is_payer, "expiry_date": "2027-11-19", "expiry_tenor": "1Y", "exercise_type": "EUROPEAN",
             "strike": 0.03859304, "vol_bp": 94.9, "premium_amount": 165478.07, "premium_currency": "USD", "premium_payment_date": "2026-11-23"}
    terms.update(terms_over)
    return _trade(instrument_type="IR_SWAPTION", structure=terms["exercise_type"], trade_date=date(2026, 11, 19),
                  effective_date=date(2026, 11, 23), maturity_date=date(2031, 11, 23), terms=terms)


def _delivered(is_payer=True, rate="0.03859304"):
    legs = _legs("PAY" if is_payer else "RECEIVE", rate)
    for l in legs:
        l.update(effective_date=date(2027, 11, 23), maturity_date=date(2032, 11, 23))
    return legs


def test_only_an_option_on_a_rate_is_signed_under_v3_and_every_other_record_is_unchanged():
    assert signing_version(_trade()) == 2
    assert signing_version(_fxo()) == 2
    for itype in ("IR_SWAPTION", "IR_CAP", "IR_FLOOR", "IR_COLLAR"):
        assert signing_version(_trade(instrument_type=itype)) == 3
    assert canonical_payload(_trade(), _legs(), BOOKER, CP) == canonical_payload(_trade(), _legs(), BOOKER, CP, version=2)
    with pytest.raises(ValueError, match="signed under v2"):
        canonical_payload(_trade(), _legs(), BOOKER, CP, version=3)
    # a swaption signed before v3 is re-derived as it was signed: the swap, the booker's directions, nothing of the option
    old = canonical_payload(_swaption(), _delivered(), BOOKER, CP, version=2)
    assert old["schema_version"] == 2 and "option" not in old and old["trade"]["maturity_date"] == "2031-11-23"


def test_a_swaption_record_names_who_bought_it_and_a_sold_one_is_not_a_bought_one():
    sold = canonical_payload(_swaption("SELL"), _delivered(), BOOKER, CP)
    bought = canonical_payload(_swaption("BUY"), _delivered(), BOOKER, CP)
    assert sold["schema_version"] == 3
    o = sold["option"]
    assert (o["buyer"], o["seller"]) == (CP["lei"], BOOKER["lei"])
    assert (bought["option"]["buyer"], bought["option"]["seller"]) == (BOOKER["lei"], CP["lei"])
    assert trade_hash_hex(sold) != trade_hash_hex(bought)
    assert o == {"type": "SWAPTION", "buyer": CP["lei"], "seller": BOOKER["lei"], "right": "PAYER", "exercise_style": "EUROPEAN",
                 "expiry_date": "2027-11-19", "exercise_schedule_y": None, "strike": "0.03859304", "settlement": "PHYSICAL",
                 "premium_amount": "165478.07", "premium_currency": "USD", "premium_payment_date": "2026-11-23"}
    # the swap delivered: the buyer of a payer swaption pays the fixed rate if it exercises, whoever booked the trade
    fixed = lambda rec: next(l for l in rec["legs"] if l["leg_type"] == "FIXED")
    assert (fixed(sold)["payer"], fixed(sold)["receiver"]) == (CP["lei"], BOOKER["lei"])
    assert (fixed(bought)["payer"], fixed(bought)["receiver"]) == (BOOKER["lei"], CP["lei"])
    assert fixed(sold)["effective_date"] == "2027-11-23" and fixed(sold)["maturity_date"] == "2032-11-23"
    # the trade block holds no date of the ticket's that is neither the option's nor the swap's
    assert set(sold["trade"]) == {"asset_class", "instrument_type", "structure", "notional", "notional_ccy", "trade_date"}
    # a receiver: the buyer receives the fixed rate
    rec = canonical_payload(_swaption("BUY", is_payer=False), _delivered(False), BOOKER, CP)
    assert rec["option"]["right"] == "RECEIVER" and fixed(rec)["payer"] == CP["lei"]


KNOWN_SWAPTION_V3_HASH = "0x6f953d132c80423574e00dfba68db5d87609b4830223e133d0e9b600c24eddec"


def test_the_swaption_record_is_pinned():
    assert trade_hash_hex(canonical_payload(_swaption("SELL"), _delivered(), BOOKER, CP)) == KNOWN_SWAPTION_V3_HASH


def test_the_counterparty_s_own_booking_of_a_swaption_is_the_same_record_with_the_side_turned():
    ours_trade, legs = _swaption("SELL"), _delivered()
    theirs_terms = _mirror_option_terms(ours_trade["terms"], "IR_SWAPTION")
    assert theirs_terms["side"] == "BUY" and theirs_terms["is_payer"] is True and theirs_terms["direction"] == "PAY"
    rows = [SimpleNamespace(**{**l, "notional_type": "BULLET", "payment_lag": 2, "fixed_rate_type": "FLAT", "spread_type": "FLAT",
                               "leverage": Decimal("1")}) for l in legs]
    kept = [_mirror_leg(r, flip=False).model_dump() for r in rows]
    assert [m["direction"] for m in kept] == ["PAY", "RECEIVE"]
    ours = canonical_payload(ours_trade, [vars(r) for r in rows], BOOKER, CP)
    theirs = canonical_payload({**ours_trade, "trade_ref": "THEIRS", "terms": theirs_terms}, kept, CP, BOOKER)
    assert ours == theirs
    assert compare(ours, theirs) == []
    # booked with the booker's side (as it was until 0.61.0), the two disagree on who bought the option
    wrong = canonical_payload({**ours_trade, "trade_ref": "THEIRS"}, kept, CP, BOOKER)
    assert {b["field"] for b in compare(ours, wrong)} >= {"who buys the option", "who sells the option"}
    # each side reads its own side of the option and of the premium
    mine, yours = summarise(ours, BOOKER["lei"], NAMES), summarise(ours, CP["lei"], NAMES)
    assert (mine["option"]["you"], mine["option"]["premium"]) == ("SELL", "RECEIVE")
    assert (yours["option"]["you"], yours["option"]["premium"]) == ("BUY", "PAY")
    assert yours["option"]["fields"]["expiry_date"] == "2027-11-19"
    assert next(l for l in yours["legs"] if l["leg_type"] == "FIXED")["you"] == "PAY"


def test_a_swaption_record_is_refused_where_the_booking_does_not_say_what_the_option_is():
    with pytest.raises(ValueError, match="expiry date"):
        canonical_payload(_swaption(expiry_date=None), _delivered(), BOOKER, CP)
    with pytest.raises(ValueError, match="two different rates"):
        canonical_payload(_swaption(strike=0.04), _delivered(), BOOKER, CP)
    with pytest.raises(ValueError, match="cannot start before the option expires"):
        canonical_payload(_swaption(expiry_date="2028-01-10"), _delivered(), BOOKER, CP)
    with pytest.raises(ValueError, match="one fixed leg and one floating leg"):
        canonical_payload(_swaption(), _delivered()[:1], BOOKER, CP)
    with pytest.raises(ValueError, match="its payment date"):
        canonical_payload(_swaption(premium_payment_date=None), _delivered(), BOOKER, CP)
    # the terms are a blob the booker writes: what the valuations would read another way than the record is refused
    for bad, why in (({"strike": ""}, "not a number"), ({"is_payer": None}, "payer or receiver"), ({"premium_amount": "abc"}, "not a number"),
                     ({"premium_amount": "1E+999000"}, "a trade can carry"), ({"premium_amount": "NaN"}, "a trade can carry"),
                     ({"premium_currency": "DOLLARS"}, "three letters"), ({"premium_payment_date": "soon"}, "not a date"),
                     ({"expiry_date": "2027-13-45"}, "not a date"), ({"exercise_type": "X" * 500}, "EUROPEAN or BERMUDAN$"),
                     ({"exercise_type": "BERMUDAN", "exercise_schedule_y": [1, "x"]}, "not a number"),
                     ({"exercise_type": "BERMUDAN", "exercise_schedule_y": [1, 500]}, "up to a hundred"),
                     ({"exercise_type": "BERMUDAN", "exercise_schedule_y": list(range(1, 200))}, "a list of years")):
        with pytest.raises(ValueError, match=why):
            canonical_payload(_swaption(**bad), _delivered(), BOOKER, CP)
    # legs turned after signing (or booked the other way round) do not re-derive: the fixed leg is the holder's
    with pytest.raises(ValueError, match="disagrees with the option's right"):
        canonical_payload(_swaption(), _delivered(False), BOOKER, CP)
    undated = _delivered(); undated[1]["maturity_date"] = None
    with pytest.raises(ValueError, match="effective and termination dates"):
        canonical_payload(_swaption(), undated, BOOKER, CP)
    # no premium booked: the record says none, it does not make one up
    none = canonical_payload(_swaption(premium_amount=None), _delivered(), BOOKER, CP)["option"]
    assert (none["premium_amount"], none["premium_currency"], none["premium_payment_date"]) == (None, None, None)
    # a Bermudan's later exercise times, as booked
    berm = canonical_payload(_swaption(exercise_type="BERMUDAN", exercise_schedule_y=[1, 2, 3.5]), _delivered(), BOOKER, CP)["option"]
    assert (berm["exercise_style"], berm["exercise_schedule_y"]) == ("BERMUDAN", ["1", "2", "3.5"])


def _cap(kind="CAP", side="BUY", premium=97322.39, options=None):
    terms = {"option": kind, "side": side, "cap_rate": 0.045, "floor_rate": None, "vol_bp": 81.5, "premium_amount": premium,
             "premium_currency": "USD", "premium_payment_date": "2026-11-23", "direction": "PAY", "float_direction": "RECEIVE"}
    leg = {"leg_ref": "OPT-1", "leg_seq": 1, "leg_type": "FLOAT", "direction": "RECEIVE", "currency": "USD", "notional": Decimal("10000000"),
           "day_count": "ACT/360", "payment_frequency": "QUARTERLY", "reset_frequency": "DAILY", "bdc": "MOD_FOLLOWING",
           "fixed_rate": Decimal("0"), "spread": Decimal("0"), "leverage": Decimal("0"), "forecast_curve_id": "USD_SOFR", "terms": {},
           "embedded_options": options or [{"type": "CAP", "direction": side, "default_strike": Decimal("0.045"), "strike_schedule": []}]}
    return _trade(instrument_type=f"IR_{kind}", structure=None, terms=terms), [leg]


def test_a_cap_record_carries_its_premium_and_who_pays_it():
    t, legs = _cap()
    rec = canonical_payload(t, legs, BOOKER, CP)
    assert rec["schema_version"] == 3
    assert rec["option"] == {"type": "CAP", "buyer": BOOKER["lei"], "seller": CP["lei"], "premium_amount": "97322.39", "premium_currency": "USD",
                             "premium_payment_date": "2026-11-23", "premium_payer": BOOKER["lei"], "premium_receiver": CP["lei"]}
    # the leg is v2's: the strike, the buyer and the seller were already on it
    v2 = canonical_payload(t, legs, BOOKER, CP, version=2)
    assert rec["legs"] == v2["legs"] and rec["trade"] == v2["trade"]
    assert rec["legs"][0]["embedded_options"][0]["buyer"] == BOOKER["lei"]
    # a sold floor: the premium is booked as its buyer sees it, and the buyer pays it
    t, legs = _cap("FLOOR", "SELL", 94717.73, [{"type": "FLOOR", "direction": "SELL", "default_strike": Decimal("0.03"), "strike_schedule": []}])
    o = canonical_payload(t, legs, BOOKER, CP)["option"]
    assert (o["buyer"], o["premium_payer"], o["premium_receiver"]) == (CP["lei"], CP["lei"], BOOKER["lei"])
    # a collar whose floor is worth more than its cap: the side that bought the cap is paid
    t, legs = _cap("COLLAR", "BUY", -1250.5, [{"type": "CAP", "direction": "BUY", "default_strike": Decimal("0.045"), "strike_schedule": []},
                                              {"type": "FLOOR", "direction": "SELL", "default_strike": Decimal("0.03"), "strike_schedule": []}])
    o = canonical_payload(t, legs, BOOKER, CP)["option"]
    assert (o["premium_amount"], o["premium_payer"], o["premium_receiver"]) == ("1250.5", CP["lei"], BOOKER["lei"])


def test_the_counterparty_s_own_booking_of_a_cap_is_the_same_record():
    t, legs = _cap("CAP", "SELL")
    rows = [SimpleNamespace(**{**l, "notional_type": "BULLET", "payment_lag": 2, "fixed_rate_type": "FLAT", "spread_type": "FLAT"}) for l in legs]
    mirrored = [_mirror_leg(r).model_dump() for r in rows]
    theirs_terms = _mirror_option_terms(t["terms"], "IR_CAP")
    assert theirs_terms["side"] == "BUY" and mirrored[0]["embedded_options"][0]["direction"] == "BUY"
    ours = canonical_payload(t, [vars(r) for r in rows], BOOKER, CP)
    theirs = canonical_payload({**t, "trade_ref": "THEIRS", "terms": theirs_terms}, mirrored, CP, BOOKER)
    assert ours == theirs and ours["option"]["buyer"] == CP["lei"]
    # with the side left as the booker's (as it was), the booking disagrees with the option on its own leg: no record
    with pytest.raises(ValueError, match="says one side bought the cap and the option on its leg says the other"):
        canonical_payload({**t, "trade_ref": "THEIRS", "terms": _mirror_terms(t["terms"])}, mirrored, CP, BOOKER)


def test_a_cap_s_buyer_is_read_from_the_option_on_its_leg_and_a_leg_without_one_is_refused():
    t, legs = _cap("CAP", "SELL")
    del t["terms"]["side"]                                  # an API booking with no side: the leg says who sold
    o = canonical_payload(t, legs, BOOKER, CP)["option"]
    assert (o["buyer"], o["seller"], o["premium_payer"]) == (CP["lei"], BOOKER["lei"], CP["lei"])
    t, legs = _cap("CAP", "BUY"); legs[0]["embedded_options"] = []
    with pytest.raises(ValueError, match="needs its option on the leg"):
        canonical_payload(t, legs, BOOKER, CP)
    t, legs = _cap("FLOOR", "BUY")                           # a floor whose leg holds a cap
    with pytest.raises(ValueError, match="needs its option on the leg"):
        canonical_payload(t, legs, BOOKER, CP)
    t, legs = _cap("COLLAR", "BUY", 100, [{"type": "CAP", "direction": "BUY", "default_strike": Decimal("0.045"), "strike_schedule": []},
                                          {"type": "FLOOR", "direction": "BUY", "default_strike": Decimal("0.03"), "strike_schedule": []}])
    with pytest.raises(ValueError, match="bought by the same side"):
        canonical_payload(t, legs, BOOKER, CP)
