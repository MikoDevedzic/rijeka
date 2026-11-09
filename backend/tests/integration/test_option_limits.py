"""The option routes at the pricer's limits, through the API (9 November 2026): terms that used to answer 500 price,
and an arithmetic error that still escapes a pricer is answered as terms it cannot value, never as a server error."""
from datetime import date, timedelta
from unittest.mock import patch

import pytest

pytestmark = pytest.mark.integration


def _body(**over):
    today = date.today()
    return {"pair": "BTCUSD", "option_type": "CALL", "base_notional": 10, "expiry_date": (today + timedelta(days=7)).isoformat(),
            "direction": "BUY", "settlement_type": "NON_DELIVERABLE", **over}


def test_an_american_option_far_from_the_money_at_a_low_vol_prices(client, auth_a, pairs):
    spot = pairs["BTCUSD"]["spot"]
    for strike, option_type in ((spot * 5, "CALL"), (spot / 5, "PUT"), (spot / 5, "CALL"), (spot * 5, "PUT")):
        r = client.post("/api/currency/option/price", json=_body(style="AMERICAN", strike=strike, option_type=option_type, vol_pct=2.0), headers=auth_a)
        assert r.status_code == 200, r.text
        q = r.json()
        assert q["npv"] >= 0.0 and all(q[k] == q[k] for k in ("npv", "spot01", "vega", "theta"))        # finite: not NaN


def test_a_touch_paid_at_the_hit_prices_at_a_very_low_vol(client, auth_a, pairs):
    spot = pairs["BTCUSD"]["spot"]
    r = client.post("/api/currency/option/price", json=_body(style="TOUCH", touch_type="ONE_TOUCH", barrier=round(spot * 1.01), payout=100000, payout_currency="QUOTE",
                                                             pay_at_hit=True, vol_pct=0.05), headers=auth_a)
    assert r.status_code == 200, r.text
    assert 0.0 <= r.json()["npv"] <= 100000.0


def test_an_arithmetic_error_from_a_pricer_is_answered_as_terms_not_as_a_server_error(client, auth_a, pairs):
    from api.routes import currencies as C
    with patch.object(C, "price_exotic", side_effect=OverflowError("math range error")):
        r = client.post("/api/currency/option/price", json=_body(style="AMERICAN", vol_pct=55.0), headers=auth_a)
    assert r.status_code == 422, r.text
    assert "outside what the pricer can value" in r.json()["detail"] and "math range" not in r.text
    with patch.object(C, "price_fx_option", side_effect=ZeroDivisionError("float division by zero")):
        r = client.post("/api/currency/option/price", json=_body(), headers=auth_a)
    assert r.status_code == 422 and "division" not in r.text
