"""Counterparty credit: joint simulation under both measures, netting, the CSA on the netted value, limits keys."""
from datetime import date, timedelta
import numpy as np

from ccr import calibration as C
from ccr.exposure import csa_from_counterparty, exposures
from ccr.simulate import bond, simulate
from ccr.valuation import value_swap
from pricing.curve import Curve
from types import SimpleNamespace

ASOF = date(2026, 10, 29)


def _calib(measure, drift_mode="zero", rho=0.0):
    f = {"RATES:USD_SOFR": C.Factor("RATES:USD_SOFR", "RATES", a=0.05, sigma=0.008),
         "SPOT:EURUSD": C.Factor("SPOT:EURUSD", "SPOT", sigma=0.08)}
    corr = np.array([[1.0, rho], [rho, 1.0]])
    return C.Calibration(measure, f, corr, list(f), drift_mode=drift_mode)


def _curves():
    return {"RATES:USD_SOFR": Curve(valuation_date=ASOF, flat_rate=0.04)}


def test_bond_prices_reproduce_the_curve_today_and_rates_keep_their_drift_by_measure():
    for measure, mode in (("RISK_NEUTRAL", "forward"), ("REAL_WORLD", "zero")):
        p = simulate(_calib(measure, mode), _curves(), {"SPOT:EURUSD": 1.10}, {"SPOT:EURUSD": (0.04, 0.02)}, ASOF, 60, n_paths=4000, seed=1)
        assert abs(bond(p, "RATES:USD_SOFR", 0, 5.0).mean() - _curves()["RATES:USD_SOFR"].df(ASOF + timedelta(days=int(5 * 365.25)))) < 1e-6
        r = p.r["RATES:USD_SOFR"]
        if mode == "zero":
            assert abs(r[:, -1].mean() - r[:, 0].mean()) < 0.0015           # real world: no drift in the short rate
        s = p.s["SPOT:EURUSD"]
        assert abs(np.log(s[:, -1]).mean() - np.log(1.10) - ((0.02 - 0.5 * 0.08 ** 2) * 5 if mode == "forward" else -0.5 * 0.08 ** 2 * 5)) < 0.02


def test_correlation_is_honoured():
    p = simulate(_calib("REAL_WORLD", rho=0.8), _curves(), {"SPOT:EURUSD": 1.10}, {"SPOT:EURUSD": (0.04, 0.02)}, ASOF, 24, n_paths=6000, seed=2)
    dx = np.diff(p.x["RATES:USD_SOFR"], axis=1)[:, 0]; ds = np.diff(np.log(p.s["SPOT:EURUSD"]), axis=1)[:, 0]
    assert 0.7 < np.corrcoef(dx, ds)[0, 1] < 0.9


def _swap_item(direction_fixed="PAY", rate=None, notional=50e6, years_=5):
    eff, mat = ASOF, ASOF.replace(year=ASOF.year + years_)
    if rate is None:                                    # the par rate of a flat 4 % curve, annual, approximately
        rate = 0.04
    legs = [({"leg_type": "FIXED", "direction": direction_fixed, "notional": notional, "fixed_rate": rate, "payment_frequency": "ANNUAL", "day_count": "ACT/360",
              "effective_date": str(eff), "maturity_date": str(mat), "currency": "USD"}, None),
            ({"leg_type": "FLOAT", "direction": "RECEIVE" if direction_fixed == "PAY" else "PAY", "notional": notional, "payment_frequency": "QUARTERLY", "day_count": "ACT/360",
              "effective_date": str(eff), "maturity_date": str(mat), "currency": "USD"}, None)]
    from ccr.valuation import leg_schedule
    return {"kind": "SWAP", "ccy": "USD", "legs": [(lg, leg_schedule(lg, ASOF)) for lg, _ in legs], "maturity": mat, "trade": SimpleNamespace(trade_ref="T")}


def test_netting_two_opposite_swaps_leaves_no_exposure_and_one_swap_has_a_hump():
    p = simulate(_calib("REAL_WORLD"), _curves(), {"SPOT:EURUSD": 1.10}, {"SPOT:EURUSD": (0.04, 0.02)}, ASOF, 60, n_paths=2000, seed=3)
    a, b = _swap_item("PAY"), _swap_item("RECEIVE")
    T1 = len(p.grid)
    Va = np.stack([value_swap(a, p, i, {"USD": 1.0}) for i in range(T1)], axis=1)
    Vb = np.stack([value_swap(b, p, i, {"USD": 1.0}) for i in range(T1)], axis=1)
    assert abs(Va[:, 0].mean()) < 50e6 * 0.01                        # near par today (flat curve, approximate par rate)
    net = exposures(Va + Vb, p.t, csa_from_counterparty(None))
    one = exposures(Va, p.t, csa_from_counterparty(None))
    assert net["peak_pfe95_usd"] < 1.0 and one["peak_pfe95_usd"] > 1e6         # netting works; a 50m 5y swap has real PFE
    assert one["ee"][0] < one["ee"][11] and 0 < one["peak_at_years"] < 5           # the hump
    assert one["pfe"]["99"][12] >= one["pfe"]["97.5"][12] >= one["pfe"]["95"][12] >= one["ee"][12]


def test_csa_from_counterparty_record():
    cp = SimpleNamespace(csa_type="VM_IM", csa_threshold_m=0.5, csa_mta_k=250)
    c = csa_from_counterparty(cp)
    assert c.collateralised and c.im_exchanged and c.threshold_cp == 500_000 and c.mta == 250_000 and c.mpor_days == 10
    assert not csa_from_counterparty(SimpleNamespace(csa_type="NO_CSA")).collateralised


def test_collateral_cuts_the_exposure():
    p = simulate(_calib("REAL_WORLD"), _curves(), {"SPOT:EURUSD": 1.10}, {"SPOT:EURUSD": (0.04, 0.02)}, ASOF, 60, n_paths=2000, seed=4)
    V = np.stack([value_swap(_swap_item("PAY"), p, i, {"USD": 1.0}) for i in range(len(p.grid))], axis=1)
    open_ = exposures(V, p.t, csa_from_counterparty(SimpleNamespace(csa_type="NO_CSA")))
    from ccr.valuation import flows_per_step
    ns = SimpleNamespace(items=[_swap_item("PAY")])
    csa = csa_from_counterparty(SimpleNamespace(csa_type="VM", csa_threshold_m=0, csa_mta_k=0))
    fl = flows_per_step(ns, p, {"USD": 1.0})
    assert fl.max() > 1e6 and (fl > 0).sum() == 5                            # five annual fixed coupons we pay, each a jump in V inside one step
    vm = exposures(V, p.t, csa, flows=fl)
    assert vm["peak_pfe95_usd"] < 0.5 * open_["peak_pfe95_usd"]           # a 10-day MPoR on a monthly grid leaves the half-month move, not the coupon


def test_limit_keys_for_counterparties():
    from risk import limits as L
    rep = {"ccr": {"RIJEKA DEMO BANK AG": {"exposure": {"peak_pfe95_usd": 1.2e6, "epe_1y_usd": 3e5, "current_exposure_usd": 1e5, "pfe95_by_bucket": {"1-5Y": 9e5}}, "xva": {"cva_usd": -4e4}}}}
    assert L.metric_value("PFE_PEAK:Rijeka Demo Bank AG", rep, []) == 1.2e6 and L.metric_value("PFE:RIJEKA DEMO BANK AG:1-5Y", rep, []) == 9e5
    assert L.metric_value("CVA:RIJEKA DEMO BANK AG", rep, []) == 4e4 and L.metric_value("CE:RIJEKA DEMO BANK AG", rep, []) == 1e5 and L.metric_value("EPE:NOBODY", rep, []) is None
    ev = L.evaluate([{"metric": "PFE_PEAK:RIJEKA DEMO BANK AG", "scope": "ALL", "scope_name": None, "limit": 1e6, "warn_pct": 80}], rep)
    assert ev[0]["status"] == "BREACH" and round(ev[0]["utilisation_pct"]) == 120


def test_routes_need_auth_or_cron():
    import main
    from fastapi.testclient import TestClient
    c = TestClient(main.app)
    assert c.get("/api/ccr/report").status_code == 401 and c.post("/api/ccr/run").status_code == 401 and c.post("/api/ccr/daily/tick").status_code == 403
