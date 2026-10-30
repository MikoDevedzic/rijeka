"""Backtesting arithmetic: the Basel zones fall out of the binomial, Kupiec behaves, exceptions are counted on the right side."""
import math
from datetime import date

from risk import backtest as B


def test_basel_zones_at_250_days_and_99_percent():
    zones = {k: B.zone(k, 250, 0.01)["zone"] for k in range(0, 13)}
    assert all(zones[k] == "GREEN" for k in range(0, 5))
    assert all(zones[k] == "YELLOW" for k in range(5, 10))
    assert all(zones[k] == "RED" for k in range(10, 13))


def test_kupiec_accepts_the_expected_rate_and_rejects_a_bad_model():
    ok = B.kupiec(3, 250, 0.01)
    assert ok["p_value"] > 0.05 and ok["reject"] is False
    bad = B.kupiec(15, 250, 0.01)
    assert bad["p_value"] < 0.001 and bad["reject"] is True
    zero = B.kupiec(0, 250, 0.01)
    assert math.isclose(zero["lr"], -2 * 250 * math.log(0.99)) and zero["reject"] is True    # Kupiec is two-sided: no exceptions in 250 days is too few at 1 %


def test_evaluate_counts_losses_beyond_var_only():
    ser = [{"date": f"2026-01-{i+1:02d}", "pnl": p, "var99": 100.0, "var95": 60.0} for i, p in enumerate([-50, -120, 150, -100, -61, 30, -101])]
    h = B.evaluate(ser, 0.99, "var99")
    assert h["exceptions"] == 2 and [e["date"] for e in h["exception_days"]] == ["2026-01-02", "2026-01-07"]
    assert math.isclose(h["expected"], 0.07) and h["enough"] is False and h["zone"] == "TOO FEW DAYS"
    s = B.evaluate(ser, 0.95, "var95")
    assert s["exceptions"] == 4                      # -120, -100, -61, -101
    assert math.isclose(h["worst_ratio"], 1.2)


class _DB:
    def __init__(self, pnl_rows, var_rows):
        self.pnl_rows, self.var_rows = pnl_rows, var_rows
    def execute(self, sql, params=None):
        rows = self.var_rows if "risk_daily" in str(sql) else self.pnl_rows
        class R:
            def all(_self): return rows
        return R()


class _Row:
    def __init__(self, **kw): self.__dict__.update(kw)


def test_series_pairs_each_pnl_day_with_the_var_standing_before_it():
    pnl = [_Row(pnl_date=date(2026, 10, 30), dirty=-500.0, clean=-450.0, carry=-20.0),
           _Row(pnl_date=date(2026, 10, 29), dirty=100.0, clean=80.0, carry=10.0),
           _Row(pnl_date=date(2026, 10, 28), dirty=5.0, clean=5.0, carry=0.0)]          # no VaR before it: dropped
    var = [_Row(risk_date=date(2026, 10, 28), var_1d=300.0, v95=200.0, lin=290.0, conf=0.99, conf2=0.95),
           _Row(risk_date=date(2026, 10, 29), var_1d=400.0, v95=250.0, lin=390.0, conf=0.99, conf2=0.95)]
    out = B.run(_DB(pnl, var), "u", measure="hypothetical")
    assert out["observations"] == 2
    assert [r["var_date"] for r in out["series"]] == ["2026-10-28", "2026-10-29"]
    assert out["series"][1]["pnl"] == -430.0 and out["series"][1]["var99"] == 400.0
    assert out["headline"]["exceptions"] == 1 and out["secondary"]["exceptions"] == 1
    assert out["note"] and out["linear"]["exceptions"] == 1
