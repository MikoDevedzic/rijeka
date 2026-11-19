"""What a ticket's XVA run says about itself beside its figures (0.60.1): said only where it is true."""
import os

os.environ.setdefault("DATABASE_URL", "postgresql://unused@localhost/unused")

from api.routes.xva import _two_floats_that_cancel


def _leg(direction, **over):
    leg = {"leg_type": "FLOAT", "direction": direction, "currency": "USD", "notional": 10_000_000, "leverage": 1, "spread": 0,
           "effective_date": "2026-11-23", "maturity_date": "2031-11-23"}
    leg.update(over)
    return (leg, [])


def _swap(a, b, **over):
    return {"kind": "SWAP", "legs": [a, b], **over}


def test_two_floating_legs_are_said_to_cancel_only_where_they_do():
    assert _two_floats_that_cancel(_swap(_leg("PAY"), _leg("RECEIVE"))) is True
    # a basis spread, another notional, a leverage, other dates, the same way round: each has exposure on the paths
    for other in (_leg("RECEIVE", spread=0.0010), _leg("RECEIVE", notional=12_000_000), _leg("RECEIVE", leverage=2),
                  _leg("RECEIVE", maturity_date="2032-11-23"), _leg("PAY"), _leg("RECEIVE", currency="EUR"),
                  _leg("RECEIVE", spread_schedule=[{"date": "2028-11-23", "spread": 0.001}])):
        assert _two_floats_that_cancel(_swap(_leg("PAY"), other)) is False
    assert _two_floats_that_cancel(_swap(_leg("PAY"), _leg("RECEIVE", leg_type="FIXED"))) is False
    assert _two_floats_that_cancel(_swap(_leg("PAY"), _leg("RECEIVE"), caplets=[1])) is False
    assert _two_floats_that_cancel({"kind": "SWAPTION", "legs": [_leg("PAY"), _leg("RECEIVE")]}) is False
    assert _two_floats_that_cancel({"kind": "SWAP", "legs": [_leg("PAY")]}) is False
