"""Booking writes complete legs: dates and curves from the trade, canonical
frequencies, conventions by currency. The row is the contract; no reader
needs a fallback."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from api.routes._leg_defaults import canonical_frequency, complete_leg, leg_is_complete
from api.routes.booking import BookingRequest, LegInput, build_booked_payload, complete_booking
from api.routes import ops


def _body(**legs_kw):
    fixed = dict(leg_ref="FIXED-1", leg_seq=1, leg_type="FIXED", direction="PAY", currency="GBP",
                 notional=Decimal("1e7"), fixed_rate=Decimal("0.04"), **legs_kw.get("fixed", {}))
    flt = {**dict(leg_ref="FLOAT-1", leg_seq=2, leg_type="FLOAT", direction="RECEIVE", currency="GBP",
                  notional=Decimal("1e7"), spread=Decimal("0"), ois_compounding="COMPOUNDING"), **legs_kw.get("float", {})}
    legs = [LegInput(**fixed), LegInput(**flt)]
    return BookingRequest(asset_class="RATES", instrument_type="IR_SWAP", structure="OIS", notional=Decimal("1e7"),
                          notional_ccy="GBP", trade_date=date(2026, 10, 30), effective_date=date(2026, 11, 3),
                          maturity_date=date(2031, 11, 3), terms={}, legs=legs)


def test_frequency_spellings_become_canonical():
    assert canonical_frequency("6M") == "SEMI_ANNUAL"
    assert canonical_frequency("3M") == "QUARTERLY"
    assert canonical_frequency("1M") == "MONTHLY"
    assert canonical_frequency("12M") == "ANNUAL"
    assert canonical_frequency("semiannual") == "SEMI_ANNUAL"
    assert canonical_frequency("Annual") == "ANNUAL"
    assert canonical_frequency(None, "ANNUAL") == "ANNUAL"
    assert canonical_frequency("EVERY_OTHER_TUESDAY") == "EVERY_OTHER_TUESDAY"   # unknown names pass through


def test_bare_legs_are_completed_from_trade_and_currency():
    b = complete_booking(_body())
    fixed, flt = b.legs
    assert (fixed.effective_date, fixed.maturity_date) == (date(2026, 11, 3), date(2031, 11, 3))
    assert fixed.payment_frequency == "ANNUAL" and fixed.day_count == "ACT/365F" and fixed.bdc == "MOD_FOLLOWING"
    assert fixed.discount_curve_id == "GBP_SONIA" and fixed.forecast_curve_id is None
    assert flt.forecast_curve_id == "GBP_SONIA" and flt.reset_frequency == "DAILY"
    assert b.discount_curve_id == "GBP_SONIA" and b.forecast_curve_id == "GBP_SONIA"
    assert all(leg_is_complete(l.model_dump()) for l in b.legs)


def test_client_values_win_and_only_spellings_change():
    b = complete_booking(_body(fixed={"payment_frequency": "6M", "day_count": "30/360", "discount_curve_id": "GBP_SONIA_3M"},
                               float={"payment_frequency": "3M", "forecast_curve_id": "GBP_SONIA_3M", "ois_compounding": None}))
    fixed, flt = b.legs
    assert fixed.payment_frequency == "SEMI_ANNUAL" and fixed.day_count == "30/360" and fixed.discount_curve_id == "GBP_SONIA_3M"
    assert flt.payment_frequency == "QUARTERLY" and flt.reset_frequency == "QUARTERLY" and flt.forecast_curve_id == "GBP_SONIA_3M"
    assert b.discount_curve_id == "GBP_SONIA_3M"


def test_booked_event_payload_carries_the_complete_legs():
    from uuid import uuid4
    b = complete_booking(_body())
    payload = build_booked_payload(b, uuid4(), [uuid4(), uuid4()])
    assert all(leg_is_complete(l) for l in payload["legs"])
    assert payload["legs"][0]["effective_date"] == "2026-11-03"


def test_complete_leg_usd_and_fra():
    fra = complete_leg({"leg_type": "FRA", "currency": "USD"}, effective_date=date(2027, 1, 4), maturity_date=date(2027, 4, 4))
    assert fra["discount_curve_id"] == "USD_SOFR" and fra["forecast_curve_id"] == "USD_SOFR" and fra["day_count"] == "ACT/360"
    zc = complete_leg({"leg_type": "ZERO_COUPON", "currency": "EUR"})
    assert zc["payment_frequency"] == "ZERO_COUPON" and zc["discount_curve_id"] == "EUR_ESTR"


# ── batch health ─────────────────────────────────────────────

class _DB:
    """Returns one scalar per SQL in order; raises for names in `broken`."""
    def __init__(self, values):
        self.values = list(values); self.rolled_back = 0
    def execute(self, sql):
        v = self.values.pop(0)
        if isinstance(v, Exception):
            raise v
        class R:  # noqa
            def scalar(_self): return v
        return R()
    def rollback(self): self.rolled_back += 1


def test_previous_business_day_skips_weekends():
    assert ops.previous_business_day(date(2026, 11, 2)) == date(2026, 10, 30)   # Monday → Friday
    assert ops.previous_business_day(date(2026, 10, 31)) == date(2026, 10, 30)  # Saturday → Friday
    assert ops.previous_business_day(date(2026, 10, 29)) == date(2026, 10, 28)


def test_health_rules_hours_and_business_day():
    now = datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc)   # Monday morning
    db = _DB([now - timedelta(hours=1),            # news: fresh
              now - timedelta(hours=5),            # spots: stale (>3h)
              date(2026, 10, 30),                  # market data: Friday → ok on Monday
              date(2026, 10, 29),                  # pnl: Thursday → stale
              RuntimeError("relation does not exist"),  # risk: missing table → stale, rolled back
              datetime(2026, 10, 30, 23, 0, tzinfo=timezone.utc)])  # ccr: Friday datetime → ok
    out = ops.evaluate(db, now=now)
    c = out["checks"]
    assert c["news"]["ok"] and not c["spots"]["ok"] and c["market_data"]["ok"]
    assert not c["pnl"]["ok"] and not c["risk"]["ok"] and c["ccr"]["ok"]
    assert out["ok"] is False and db.rolled_back == 1
    assert c["pnl"]["rule"] == "on or after 2026-10-30" and c["risk"]["last"] is None


def test_health_all_green():
    now = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
    db = _DB([now, now, date(2026, 10, 29), date(2026, 10, 28), date(2026, 10, 28), date(2026, 10, 28)])
    assert ops.evaluate(db, now=now)["ok"] is True
