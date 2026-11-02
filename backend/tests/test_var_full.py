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


# ── volatility surfaces as VaR factors (issue #30) ───────────────────────────
from types import SimpleNamespace

from pnl.market import Market, is_vol_surface
from risk import var as V
from risk import vols
from risk.var_full import factor_days, shift_vol_quotes, shifted_market


def _surface(atm=7.5, rr=-0.4, bf=0.2):
    out = []
    for t in ("1M", "3M", "1Y"):
        out += [{"tenor": t, "quote_type": "ATM", "rate": atm, "enabled": True}, {"tenor": t, "quote_type": "RR25", "rate": rr, "enabled": True},
                {"tenor": t, "quote_type": "BF25", "rate": bf, "enabled": True}]
    return out


def test_vol_quotes_shift_per_tenor_and_type_with_the_type_average_for_the_rest():
    today = _surface()
    day = {"1M|ATM": +50.0, "3M|ATM": +30.0, "1M|RR25": -10.0}            # hundredths of a vol point
    out = {(q["tenor"], q["quote_type"]): q["rate"] for q in shift_vol_quotes(today, day)}
    assert math.isclose(out[("1M", "ATM")], 8.0) and math.isclose(out[("3M", "ATM")], 7.8)
    assert math.isclose(out[("1Y", "ATM")], 7.9)                        # no 1Y history: the ATM average (+40)
    assert math.isclose(out[("1M", "RR25")], -0.5) and math.isclose(out[("3M", "RR25")], -0.5)   # RR average is the one RR change
    assert out[("1M", "BF25")] == 0.2                                   # no BF history at all: untouched


def test_a_surface_is_a_secondary_factor_that_never_shortens_the_window():
    d0 = date(2026, 10, 1)
    dates = [d0 + __import__("datetime").timedelta(days=i) for i in range(6)]
    def series(db, uid, cid, start, end):
        if cid == "USD_SOFR":
            return [(d, {"1Y": 4.0 + 0.01 * i, "5Y": 4.1 + 0.02 * i}) for i, d in enumerate(dates)]
        if cid == "EURUSD_SPOT":
            return [(d, {"SPOT": 1.10 + 0.001 * i}) for i, d in enumerate(dates)]
        if cid == "EURUSD_VOL":
            return [(d, {"1M|ATM": 7.0 + 0.1 * i, "1M|RR25": -0.4}) for i, d in enumerate(dates[-3:])]   # three days of vol history
        return []
    days, missing, coverage = factor_days(None, "t", ["USD_SOFR", "EURUSD_VOL", "GBP_SONIA"], ["EURUSD"], dates[-1], 30, series=series)
    assert missing == ["GBP_SONIA"]
    assert len(days) == 5                                               # the five rate/spot changes, not the two vol ones
    assert coverage == {"EURUSD_VOL": {"days": 2, "of": 5, "from": dates[-2].isoformat()}}
    assert all("USD_SOFR" in row and "EURUSD_SPOT" in row for _, row in days)
    assert sum(1 for _, row in days if "EURUSD_VOL" in row) == 2
    vol_day = next(row for _, row in days if "EURUSD_VOL" in row)["EURUSD_VOL"]
    assert math.isclose(vol_day["1M|ATM"], 10.0) and vol_day["1M|RR25"] == 0.0       # +0.1 point = 10 hundredths


def test_shifted_market_moves_the_surface_the_pricer_reads():
    d = date(2026, 11, 2)
    m = Market(None, "u", d, overrides={"EURUSD_VOL": _surface(), "USD_SOFR": [{"tenor": "1Y", "rate": 4.0, "quote_type": "OIS"}], "EURUSD_SPOT": [{"tenor": "SPOT", "rate": 1.1, "quote_type": "SPOT"}]})
    row = {"EURUSD_VOL": {"3M|ATM": +100.0}, "USD_SOFR": {"1Y": +5.0}, "EURUSD_SPOT": {"SPOT": 1.0}}
    m2 = shifted_market(m, row, ["USD_SOFR", "EURUSD_VOL"], ["EURUSD"])
    atm = {q["tenor"]: q["rate"] for q in m2.quotes("EURUSD_VOL") if q["quote_type"] == "ATM"}
    assert math.isclose(atm["3M"], 8.5) and math.isclose(atm["1M"], 8.5)          # 1M takes the ATM average: the one ATM change
    assert math.isclose(m2.single("USD_SOFR", "1Y"), 4.05) and math.isclose(m2.spot("EURUSD"), 1.1 * math.exp(0.01))
    assert m.quotes("EURUSD_VOL")[0]["rate"] == 7.5                                # the base market is untouched


def test_ladder_var_adds_vega_times_the_atm_move_on_observed_days():
    d1, d2 = date(2026, 11, 2), date(2026, 11, 3)
    ladder = [{"curve": "USD_SOFR", "buckets": {"1Y-2Y": 100.0}}]
    vega = [{"curve": "EURUSD_VOL", "buckets": {"<1Y": 2000.0}}]                    # USD per vol point
    changes = {"USD_SOFR": [(d1, {"1Y-2Y": 2.0}), (d2, {"1Y-2Y": -1.0})], "EURUSD_VOL": [(d2, {"<1Y": 50.0})]}   # vol observed on d2 only
    pnl, missing = V.simulate(ladder, {}, changes, vega)
    assert missing == [] and [v for _, v in pnl] == [200.0, -100.0 + 2000.0 * 0.5]
    pnl2, missing2 = V.simulate(ladder, {}, {"USD_SOFR": changes["USD_SOFR"]}, vega)
    assert missing2 == ["EURUSD_VOL"] and [v for _, v in pnl2] == [200.0, -100.0]
    assert V._atm_only({"1M|ATM": 1.0, "1M|RR25": 2.0, "1Yx5Y|SWVOL": 3.0}) == {"1M": 1.0, "1Yx5Y": 3.0}


def test_surfaces_follow_the_realised_vol_of_their_series():
    import random
    rng = random.Random(7)
    calm = [1.10]
    for _ in range(300):
        calm.append(calm[-1] * math.exp(rng.gauss(0, 0.05 / math.sqrt(252))))
    wild = calm + [calm[-1]]
    for _ in range(30):
        wild.append(wild[-1] * math.exp(rng.gauss(0, 0.20 / math.sqrt(252))))
    assert vols.scale(calm[:20], 21) == 1.0                                          # too little history: parametric
    k_calm, k_wild = vols.scale(calm, 21), vols.scale(wild, 21)
    assert 0.8 < k_calm < 1.25 and 1.4 < k_wild <= 2.0                              # a turbulent month lifts the short end
    s = vols.fx_surface("EURUSD", wild)
    atm = {q["tenor"]: q["rate"] for q in s if q["quote_type"] == "ATM"}
    base = {q["tenor"]: q["rate"] for q in __import__("market_data.demo_feed", fromlist=["x"]).build_fx_vols("EURUSD") if q["quote_type"] == "ATM"}
    assert atm["1M"] > base["1M"] * 1.3 and abs(atm["2Y"] - base["2Y"] * k_wild) < 0.05 or atm["2Y"] >= base["2Y"]
    assert [q["rate"] for q in s if q["quote_type"] == "RR25"] == [q["rate"] for q in __import__("market_data.demo_feed", fromlist=["x"]).build_fx_vols("EURUSD") if q["quote_type"] == "RR25"]
    rates = [4.0 + 0.0005 * rng.gauss(0, 1) for _ in range(200)]
    sw = vols.swvol_surface(rates)
    assert len(sw) == len(__import__("market_data.demo_feed", fromlist=["x"]).build_swvol_atm()) and all(q["rate"] > 0 for q in sw)


def test_swaption_surface_is_a_vol_surface_bucketed_by_expiry():
    from pnl.explain import tenor_years
    from pnl.valuation import trade_curves
    assert is_vol_surface("EURUSD_VOL") and is_vol_surface("USD_SWVOL_ATM") and not is_vol_surface("USD_SOFR")
    assert tenor_years("1Yx5Y") == 1.0 and tenor_years("3Yx10Y") == 3.0 and tenor_years("6M") == 0.5
    t = SimpleNamespace(instrument_type="IR_SWAPTION", notional_ccy="USD", discount_curve_id="USD_SOFR", forecast_curve_id=None, terms={})
    assert trade_curves(t) == ["USD_SOFR", "USD_SWVOL_ATM"]
