"""IPV: the dependency list from the trades, the pillars of each kind of input, the shift and bump arithmetic, the
tolerance rules and the pillar ladder on a stubbed valuer."""
from datetime import date

import pytest

from api.routes.xva import hypothetical_trade
from ipv import inputs as I
from ipv import tolerances as T
from ipv.ladder import first_order, pillar_ladder
from tests.test_incremental_xva import _swap_body


def _fx_forward(ref="F"):
    return hypothetical_trade({"instrument_type": "FX_FORWARD", "notional": 2e6, "notional_ccy": "EUR", "trade_date": "2026-11-02", "effective_date": "2026-11-04",
                               "maturity_date": "2027-11-04", "terms": {"currency_pair": "EURUSD", "base_notional": 2e6, "forward_rate": 1.10, "value_date": "2027-11-04", "direction": "BUY"}}, None, "u")


def test_dependencies_come_from_the_trades():
    swap, fwd = hypothetical_trade(_swap_body(), None, "u"), _fx_forward()
    deps = I.dependencies([swap, fwd])
    assert "USD_SOFR" in deps and str(swap.id) in deps["USD_SOFR"] and str(fwd.id) in deps["USD_SOFR"]
    assert "EURUSD_SPOT" in deps and deps["EURUSD_SPOT"] == [str(fwd.id)]
    assert any(k.startswith("EUR_") for k in deps)
    assert I.dependencies([]) == {}


def test_kinds_units_and_pillars():
    assert I.kind_of("USD_SOFR") == "RATES" and I.kind_of("USD_SWVOL_ATM") == "SWAPTION_VOL" and I.kind_of("EURUSD_VOL") == "FX_VOL"
    assert I.kind_of("EURUSD_SPOT") == "SPOT" and I.kind_of("BTC_FUNDING") == "FUNDING"
    rates = [{"tenor": "1Y", "rate": 3.79, "quote_type": "OIS"}, {"tenor": "ON", "rate": 3.88, "quote_type": "DEPOSIT"}, {"tenor": "10Y", "rate": 3.90, "quote_type": "OIS", "enabled": False}]
    p = I.pillars_of("USD_SOFR", rates)
    assert [x["key"] for x in p] == ["ON", "1Y"] and p[1]["years"] == 1.0
    sw = [{"tenor": "1Yx5Y", "rate": 89.5}, {"tenor": "5Yx10Y", "rate": 78.4}]
    assert [x["key"] for x in I.pillars_of("USD_SWVOL_ATM", sw)] == ["1Yx5Y", "5Yx10Y"]
    fx = [{"tenor": "1Y", "quote_type": "ATM", "rate": 7.2}, {"tenor": "1Y", "quote_type": "RR25", "rate": -0.4}, {"tenor": "1M", "quote_type": "ATM", "rate": 6.9}]
    assert [x["key"] for x in I.pillars_of("EURUSD_VOL", fx)] == ["1M|ATM", "1Y|ATM", "1Y|RR25"]
    assert I.unit_of("USD_SOFR") == "bp" and I.unit_of("EURUSD_SPOT") == "pct"


def test_shift_bump_and_override_arithmetic():
    assert I.shift("USD_SOFR", 3.79, 3.81) == pytest.approx(2.0)                 # % quotes → bp
    assert I.shift("USD_SWVOL_ATM", 89.5, 91.0) == pytest.approx(1.5)
    assert I.shift("EURUSD_VOL", 7.2, 7.45) == pytest.approx(0.25)
    assert I.shift("EURUSD_SPOT", 1.0862, 1.0970) == pytest.approx(0.9942, abs=1e-3)
    q = [{"tenor": "1Y", "rate": 3.79, "quote_type": "OIS"}, {"tenor": "2Y", "rate": 3.74, "quote_type": "OIS"}]
    b = I.bumped("USD_SOFR", q, "2Y")
    assert b[1]["rate"] == pytest.approx(3.75) and b[0]["rate"] == 3.79
    s = I.bumped("EURUSD_SPOT", [{"tenor": "SPOT", "rate": 1.0862, "quote_type": "SPOT"}], "SPOT")
    assert s[0]["rate"] == pytest.approx(1.0862 * 1.01)
    o = I.with_overrides("USD_SOFR", q, {"1Y": 3.80})
    assert o[0]["rate"] == 3.80 and o[1]["rate"] == 3.74
    assert I.find_quote(q, "USD_SOFR", "2Y")["rate"] == 3.74 and I.find_quote(q, "USD_SOFR", "7Y") is None


def test_tolerance_rules_most_specific_wins_and_defaults():
    rules = [{"id": "a", "input_pattern": "*", "pillar_pattern": "*", "tol": 5.0, "unit": "bp", "materiality_usd": 100},
             {"id": "b", "input_pattern": "USD_SOFR", "pillar_pattern": "*", "tol": 1.0, "unit": "bp", "materiality_usd": 500},
             {"id": "c", "input_pattern": "USD_SOFR", "pillar_pattern": "10Y", "tol": 2.0, "unit": "bp", "materiality_usd": 500},
             {"id": "d", "input_pattern": "*_VOL", "pillar_pattern": "*", "tol": 0.3, "unit": "vol_pt", "materiality_usd": 50}]
    assert T.rule_for(rules, "USD_SOFR", "5Y")["rule_id"] == "b"
    assert T.rule_for(rules, "USD_SOFR", "10Y")["rule_id"] == "c" and T.rule_for(rules, "USD_SOFR", "10Y")["tol"] == 2.0
    assert T.rule_for(rules, "EURUSD_VOL", "1Y|RR25")["rule_id"] == "d"
    assert T.rule_for(rules, "EUR_ESTR", "2Y")["rule_id"] == "a"
    d = T.rule_for([], "USD_SWVOL_ATM", "1Yx5Y")
    assert d["source"] == "default" and d["tol"] == 1.5 and d["unit"] == "vol_bp"
    assert T.pillar_status(0.4, 1.0, False) == "OK" and T.pillar_status(1.4, 1.0, False) == "REVIEW"
    assert T.pillar_status(1.4, 1.0, True) == "OVERRIDDEN" and T.pillar_status(None, 1.0, False) == "UNVERIFIED"
    assert T.pillar_status(0.2, 1.0, False, approved=True) == "APPROVED"
    assert T.material(-900.0, 1.0, 1000.0) is False and T.material(1200.0, 1.0, 1000.0) is True


class _T:
    def __init__(self, i): self.id = f"t{i}"


class _Mkt:
    """Quotes with overrides, as pnl.market.Market: a valuer reading the 5Y quote gives a linear value."""
    def __init__(self, quotes, overrides=None): self.q, self.ov = quotes, overrides or {}
    def quotes(self, cid): return self.ov.get(cid, self.q)
    def override(self, cid, quotes): return _Mkt(self.q, {**self.ov, cid: quotes})


def test_pillar_ladder_on_a_linear_valuer():
    quotes = [{"tenor": "2Y", "rate": 3.74, "quote_type": "OIS"}, {"tenor": "5Y", "rate": 3.77, "quote_type": "OIS"}, {"tenor": "10Y", "rate": 3.90, "quote_type": "OIS"}]
    mkt = _Mkt(quotes)
    # trade 1 is worth −9,800 per bp of the 5Y quote, trade 2 +2,000 per bp of the 10Y, both in EUR at 1.10
    def valuer(t, d, m):
        q = {x["tenor"]: x["rate"] for x in m.quotes("USD_SOFR")}
        npv = -9_800 * (q["5Y"] - 3.77) * 100 if t.id == "t1" else 2_000 * (q["10Y"] - 3.90) * 100
        return {"npv": npv, "ccy": "EUR"}
    lad = pillar_ladder([_T(1), _T(2)], date(2026, 11, 3), mkt, "USD_SOFR", valuer, lambda c: 1.10)
    assert lad["5Y"] == pytest.approx(-9_800 * 1.10) and lad["10Y"] == pytest.approx(2_000 * 1.10) and lad["2Y"] == pytest.approx(0.0)
    fo = first_order(lad, {"5Y": 2.0, "10Y": -1.0})
    assert fo["total"] == pytest.approx(-9_800 * 1.10 * 2 - 2_000 * 1.10)
    assert pillar_ladder([_T(1)], date(2026, 11, 3), _Mkt(None), "USD_SOFR", valuer, lambda c: 1.0) == {}
