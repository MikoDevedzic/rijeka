"""The desk's record that a barrier was touched (settlement/knock.py): what may be recorded, and what the option is
once it has been."""
from datetime import date, datetime, timezone

import pytest

from pricing.fx_exotic import ExoticSpec
from settlement import knock

TRADE, TODAY, EXPIRY = date(2026, 11, 2), date(2026, 11, 12), date(2027, 2, 2)
NOW = datetime(2026, 11, 12, 15, 30, tzinfo=timezone.utc)


def _terms(**over):
    return {"digital_asset": "BTC", "notional_amount": "10", "option_type": "CALL", "strike_price": "110000", "style": "BARRIER", "barrier_type": "UP_OUT",
            "barrier": "150000", "rebate": "0.001", "expiration_date": EXPIRY.isoformat(), **over}


def _rec(terms=None, **kw):
    base = dict(instrument_type="CRYPTO_OPTION", status="CONFIRMED", knocked=True, when=date(2026, 11, 10), level=None, trade_date=TRADE, today=TODAY, by="u-1", now=NOW)
    return knock.record(terms if terms is not None else _terms(), **{**base, **kw})


def test_a_touch_is_recorded_with_its_date_its_level_and_who_said_so():
    t = _rec(level=151_200.5)
    assert (t["knocked"], t["knock_date"], t["knock_level"]) == (True, "2026-11-10", 151_200.5)
    assert t["knock_recorded"] == {"at": "2026-11-12T15:30:00+00:00", "by": "u-1"}
    assert {k: v for k, v in t.items() if not k.startswith("knock")} == _terms(), "no other term is touched"
    assert "knock_level" not in _rec()                                   # the level is optional
    again = _rec(t, when=date(2026, 11, 5))                              # a correction replaces the record whole
    assert again["knock_date"] == "2026-11-05" and "knock_level" not in again
    cleared = _rec(t, knocked=None)
    assert cleared == _terms()


def test_never_touched_is_said_only_once_the_option_has_expired():
    with pytest.raises(ValueError, match="once the option has expired"):
        _rec(knocked=False)
    t = _rec(knocked=False, today=EXPIRY)
    assert t["knocked"] is False and t["knock_date"] == EXPIRY.isoformat() and "knock_level" not in t


@pytest.mark.parametrize("kw, why", [
    (dict(instrument_type="FX_OPTION"), "built for a digital asset's options"),
    (dict(instrument_type="CRYPTO_FORWARD"), "built for a digital asset's options"),
    (dict(status="TERMINATED"), "only a pending or confirmed trade"),
    (dict(when=None), "needs the date the level traded"),
    (dict(when=date(2026, 11, 1)), "between the trade date"),
    (dict(when=date(2026, 11, 13)), "the earlier of today and the expiry"),
    (dict(when=date(2027, 2, 3), today=date(2027, 3, 1)), "the earlier of today and the expiry"),
    (dict(level=-1), "the level is a price"),
    (dict(level=float("nan")), "the level is a price"),
    (dict(level=1e300), "the level is a price"),
])
def test_what_it_refuses(kw, why):
    with pytest.raises(ValueError) as e:
        _rec(**kw)
    assert why in str(e.value)


def test_an_option_with_no_barrier_or_no_expiry_takes_no_record():
    with pytest.raises(ValueError, match="has no barrier to record"):
        _rec(_terms(style="EUROPEAN"))
    with pytest.raises(ValueError, match="no expiration date"):
        _rec({k: v for k, v in _terms().items() if k != "expiration_date"})


@pytest.mark.parametrize("spec, direction, kind, amount, words", [
    (ExoticSpec("BARRIER", "CALL", strike=110_000.0, barrier=150_000.0, barrier_type="UP_OUT", rebate=0.001), "BUY", "fixed", 0.0, "knocked out on 2026-11-10: the rebate was paid at the hit"),
    (ExoticSpec("BARRIER", "PUT", strike=90_000.0, barrier=80_000.0, barrier_type="DOWN_IN"), "BUY", "vanilla", None, "knocked in on 2026-11-10: from here the plain option"),
    (ExoticSpec("DOUBLE_BARRIER", "CALL", strike=110_000.0, lower=90_000.0, upper=150_000.0, barrier_type="KNOCK_OUT"), "SELL", "fixed", 0.0, "knocked out"),
    (ExoticSpec("DOUBLE_BARRIER", "CALL", strike=110_000.0, lower=90_000.0, upper=150_000.0, barrier_type="KNOCK_IN"), "SELL", "vanilla", None, "knocked in"),
    (ExoticSpec("TOUCH", "CALL", payout=250_000.0, touch_type="ONE_TOUCH", barrier=150_000.0, pay_at_hit=False), "BUY", "fixed", 250_000.0, "paid at settlement"),
    (ExoticSpec("TOUCH", "CALL", payout=250_000.0, touch_type="ONE_TOUCH", barrier=150_000.0, pay_at_hit=False), "SELL", "fixed", -250_000.0, "paid at settlement"),
    (ExoticSpec("TOUCH", "CALL", payout=250_000.0, touch_type="ONE_TOUCH", barrier=150_000.0, pay_at_hit=True), "BUY", "fixed", 0.0, "paid at the hit"),
    (ExoticSpec("TOUCH", "CALL", payout=250_000.0, touch_type="NO_TOUCH", barrier=150_000.0), "BUY", "fixed", 0.0, "a no-touch pays nothing"),
    (ExoticSpec("TOUCH", "CALL", payout=250_000.0, touch_type="DOUBLE_NO_TOUCH", lower=90_000.0, upper=150_000.0), "BUY", "fixed", 0.0, "a no-touch pays nothing"),
])
def test_what_the_option_is_once_touched(spec, direction, kind, amount, words):
    got = knock.after_touch({"knocked": True, "knock_date": "2026-11-10"}, spec, direction)
    assert got[0] == kind and got[1] == amount and words in got[2]


def test_nothing_recorded_or_never_touched_or_no_barrier_leaves_the_option_as_it_is():
    ko = ExoticSpec("BARRIER", "CALL", strike=110_000.0, barrier=150_000.0, barrier_type="UP_OUT")
    assert knock.after_touch({}, ko, "BUY") is None and knock.after_touch({"knocked": False}, ko, "BUY") is None and knock.after_touch(None, ko, "BUY") is None
    assert knock.after_touch({"knocked": True}, ExoticSpec("EUROPEAN", "CALL", strike=110_000.0), "BUY") is None
