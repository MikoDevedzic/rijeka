"""Full-revaluation VaR: the day's observed changes land on today's quotes tenor by tenor;
historical sampling in the counterparty simulation keeps the window's co-movements."""
import math
from datetime import date

import numpy as np

from ccr.calibration import Calibration, Factor
from ccr import simulate as SIM
from risk.var_full import shift_quotes


def test_shift_quotes_by_tenor_with_bucket_average_for_the_rest():
    today = [{"tenor": "ON", "rate": 4.0}, {"tenor": "1Y", "rate": 3.9}, {"tenor": "2Y", "rate": 3.8}, {"tenor": "10Y", "rate": 4.1}, {"tenor": "30Y", "rate": 4.3}]
    day = {"1Y": +5.0, "2Y": +3.0, "10Y": -2.0, "20Y": -2.0}   # bp; the 30Y has no history that day
    out = {q["tenor"]: q["rate"] for q in shift_quotes(today, day)}
    assert out["ON"] == 4.0                                 # overnight is never shifted by the par changes
    assert math.isclose(out["1Y"], 3.95) and math.isclose(out["2Y"], 3.83) and math.isclose(out["10Y"], 4.08)
    assert math.isclose(out["30Y"], 4.3 - 0.02)             # takes its bucket's average (10Y+ : the 20Y change)


def _calib(panel, sampling):
    f = {"RATES:USD_SOFR": Factor("RATES:USD_SOFR", "RATES", a=0.05, sigma=0.01),
         "SPOT:EURUSD": Factor("SPOT:EURUSD", "SPOT", sigma=0.08)}
    return Calibration("REAL_WORLD", f, np.eye(2), list(f), drift_mode="zero", sampling=sampling, panel=panel)


class _Curve:
    def df(self, d):
        return math.exp(-0.03 * (d - date(2026, 10, 30)).days / 365.25)


def test_block_increments_keep_correlation_and_scale():
    rng = np.random.default_rng(1)
    n = 500
    z = rng.standard_normal((n, 2))
    rates = 0.01 / math.sqrt(250) * z[:, 0]                                   # daily rate changes, 100bp/yr vol
    spots = 0.08 / math.sqrt(250) * (0.8 * z[:, 0] + 0.6 * z[:, 1])           # 60 % correlated... rho = 0.8
    panel = np.column_stack([rates, spots])
    inc = SIM._block_increments(panel, T=12, n_paths=4000, rng=rng)
    assert inc.shape == (12, 4000, 2)
    monthly_rate_std = inc[:, :, 0].std()
    assert 0.0025 < monthly_rate_std < 0.0033                                 # ≈ 0.01·sqrt(21/250) = 0.0029
    rho = np.corrcoef(inc[:, :, 0].ravel(), inc[:, :, 1].ravel())[0, 1]
    assert 0.6 < rho < 0.98                                                   # the window's co-movement survives (a 24-block sample is noisy)
    assert abs(inc.mean()) < 1e-4                                              # demeaned


def test_simulate_historical_paths_follow_zero_drift_and_lognormal_spots():
    rng = np.random.default_rng(2)
    panel = np.column_stack([0.01 / math.sqrt(250) * rng.standard_normal(400), 0.08 / math.sqrt(250) * rng.standard_normal(400)])
    curves = {"RATES:USD_SOFR": _Curve()}
    for sampling in ("HISTORICAL", "GAUSSIAN"):
        p = SIM.simulate(_calib(panel, sampling), curves, {"SPOT:EURUSD": 1.10}, {"SPOT:EURUSD": (0.03, 0.02)}, date(2026, 10, 30), months=24, n_paths=3000, seed=3)
        r = p.r["RATES:USD_SOFR"]; s = p.s["SPOT:EURUSD"]
        assert abs(r[:, -1].mean() - r[:, 0].mean()) < 0.002                   # zero drift: the mean short rate stays put
        assert 0.005 < r[:, -1].std() < 0.02
        assert abs(np.log(s[:, -1]).mean() - math.log(1.10)) < 0.03             # zero drift in log spot
        assert 0.08 < np.log(s[:, -1]).std() < 0.16                             # ≈ 8 %·sqrt(2)


def test_historical_falls_back_to_gaussian_without_a_panel():
    c = _calib(None, "HISTORICAL")
    p = SIM.simulate(c, {"RATES:USD_SOFR": _Curve()}, {"SPOT:EURUSD": 1.10}, {"SPOT:EURUSD": (0.03, 0.02)}, date(2026, 10, 30), months=6, n_paths=200, seed=3)
    assert p.r["RATES:USD_SOFR"].shape == (200, 7)
