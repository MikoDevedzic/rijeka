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
