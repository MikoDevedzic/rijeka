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
    # per path and step (0.51.0). Five yearly fixed coupons we pay, each a jump in V inside one step, less the floating
    # quarter received in the same step; and fifteen steps in which only a floating quarter is received
    mean = fl.mean(axis=0)
    assert fl.shape == (p.n_paths, len(p.grid)) and mean.max() > 1e6 and (mean > 0).sum() == 5 and (mean < 0).sum() == 15
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


def test_stored_numbers_are_plain_floats():
    import numpy as np
    from ccr.report import _num
    assert _num(np.float64(1.5)) == 1.5 and type(_num(np.float64(1.5))) is float and _num(None) is None


def _par_swap(float_freq: str, fixed_direction: str, rate: float, notional: float = 10e6, start=None, lag: int = 0, leverage=None, spread: float = 0.0):
    from ccr.valuation import leg_schedule
    eff = start or ASOF
    mat = eff.replace(year=eff.year + 5)
    common = {"notional": notional, "day_count": "ACT/360", "effective_date": str(eff), "maturity_date": str(mat), "currency": "USD", "payment_lag": lag}
    legs = [{**common, "leg_type": "FIXED", "direction": fixed_direction, "fixed_rate": rate, "payment_frequency": "ANNUAL"},
            {**common, "leg_type": "FLOAT", "direction": "PAY" if fixed_direction == "RECEIVE" else "RECEIVE", "payment_frequency": float_freq,
             "leverage": leverage, "spread": spread}]
    return {"kind": "SWAP", "ccy": "USD", "legs": [(lg, leg_schedule(lg, ASOF)) for lg in legs], "maturity": mat, "trade": SimpleNamespace(trade_ref="T")}


def _left_today(it, t_i, p0):
    """Today's value of the coupons not yet paid at t_i, from today's curve alone and coupon by coupon: a fixed coupon
    N·c·τ·P(0, pay); a floating one N·(lev·(P(0, start)/P(0, end) − 1) + spread·τ)·P(0, pay). A period that began
    before today grew its past part at today's rate for that length, as the engine is told to assume."""
    from ccr.valuation import years
    tot = 0.0
    for lg, sched in it["legs"]:
        sgn = -1.0 if lg["direction"] == "PAY" else 1.0
        N = lg["notional"]
        for (s_, e_, pay, tau) in sched:
            if years(ASOF, pay) <= t_i + 1e-9:
                continue
            if lg["leg_type"] == "FIXED":
                tot += sgn * N * lg["fixed_rate"] * tau * p0(years(ASOF, pay))
            else:
                ts, te = years(ASOF, s_), years(ASOF, e_)
                grown = (1.0 / p0(-ts) if ts < 0 else p0(ts)) / p0(te)
                lev = 1.0 if lg.get("leverage") is None else lg["leverage"]
                tot += sgn * N * (lev * (grown - 1.0) + (lg.get("spread") or 0.0) * tau) * p0(years(ASOF, pay))
    return tot


def test_a_swap_between_coupon_dates_carries_the_floating_interest_accrued_so_far():
    """Found reconciling the XVA runs, 17 November 2026. A running floating period was valued as if it reset today,
    N·(1 − P(t, end)): the interest accrued since the period began was left out. With both legs paying yearly a
    receive-fixed par swap, worth nothing on average, showed the fixed coupon building up with nothing against it:
    +34,628 after a month and +375,222 after eleven on 10M at the par rate of a flat 4 % curve (4.025 %), back to
    nothing after each payment. That was the expected exposure of every swap in the counterparty report, the
    incremental charge and the XVA P&L.

    The check is the martingale one, and it does not use the engine's formula: the value on the path at a grid date,
    discounted along the path, averages to today's value of the coupons not yet paid at that date, read off today's
    curve coupon by coupon (_left_today). The discounting is done twice: by the engine's cash account, and by the
    trapezoid of the short rate that the reference suite uses, which shares nothing with the engine's accrual. Cases:
    three floating frequencies, both directions, a leg that pays two days after each period ends (the ticket's own
    swap; the old code overvalued it by 2,319 on 10M at the start), a swap that started ten days ago and one that
    starts in ten days (off the grid), leverage and a spread on the floating leg."""
    from datetime import timedelta
    from ccr.simulate import account
    p = simulate(_calib("RISK_NEUTRAL", "forward"), _curves(), {"SPOT:EURUSD": 1.10}, {"SPOT:EURUSD": (0.04, 0.02)}, ASOF, 61, n_paths=20000, seed=1)
    key = "RATES:USD_SOFR"
    p0 = p.p0[key]
    D = 1.0 / account(p, key)
    r = p.r[key]
    D2 = np.exp(-np.concatenate([np.zeros((r.shape[0], 1)), np.cumsum(0.5 * (r[:, 1:] + r[:, :-1]) * np.diff(p.t)[None, :], axis=1)], axis=1))
    se36 = D[:, 36].std() / np.sqrt(D.shape[0])
    assert np.allclose(D[:, 0], 1.0) and abs(D[:, 36].mean() - p0(float(p.t[36]))) < 4.0 * se36, "the account discounts back to the curve, within sampling"
    cases = [dict(float_freq=f, fixed_direction=d, rate=0.0402) for f in ("ANNUAL", "QUARTERLY", "SEMI_ANNUAL") for d in ("RECEIVE", "PAY")]
    cases += [dict(float_freq="ANNUAL", fixed_direction="RECEIVE", rate=0.0402, lag=2),
              dict(float_freq="QUARTERLY", fixed_direction="PAY", rate=0.0402, lag=2),
              dict(float_freq="ANNUAL", fixed_direction="RECEIVE", rate=0.0402, start=ASOF - timedelta(days=10)),
              dict(float_freq="QUARTERLY", fixed_direction="RECEIVE", rate=0.0402, start=ASOF + timedelta(days=10)),
              dict(float_freq="QUARTERLY", fixed_direction="RECEIVE", rate=0.0402, leverage=1.5, spread=0.002),
              # a period that has ended and is not yet paid on a grid date: it ended ten days before the date and pays
              # fifteen business days after its end
              dict(float_freq="ANNUAL", fixed_direction="PAY", rate=0.0402, start=ASOF - timedelta(days=10), lag=15)]
    for kw in cases:
        it = _par_swap(**kw)
        zs = []
        for i in range(len(p.grid)):
            v = value_swap(it, p, i, {"USD": 1.0})
            want = _left_today(it, float(p.t[i]), p0)
            if i == 0:
                # today there is no sampling: the value is today's curve's, coupon by coupon, to the dollar. (This is
                # the line that sees a leg run to its last payment date: 2,319 on 10M with a two-day lag. The bounds
                # below are several thousand wide and one seed's sampling error is common to every date.)
                assert abs(v.mean() - want) < 2.0 and v.std() < 1e-6, (kw, v.mean(), want)
            for disc, slack in ((D, 60.0), (D2, 400.0)):          # the trapezoid's own discretisation is a few hundred on 10M
                x = disc[:, i] * v
                se = x.std() / np.sqrt(len(x))
                assert abs(x.mean() - want) < 4.0 * se + slack, (kw, i, x.mean(), want, se)
            zs.append((D[:, i] * v).mean() - want)
        assert abs(float(np.mean(zs))) < 1_500.0, (kw, "no bias across the dates", float(np.mean(zs)))
    # and what it was: eleven months in, with both legs yearly, the old value stood a whole floating year's interest out
    v11 = value_swap(_par_swap("ANNUAL", "RECEIVE", 0.0402), p, 11, {"USD": 1.0}).mean()
    assert abs(v11) < 5_000.0, "about nothing on average; it read +375,222"
    # a leg that pays more often than the other does leave a real saw-tooth: three quarters of floating interest
    # have been paid and the year's fixed coupon has not
    q11 = value_swap(_par_swap("QUARTERLY", "RECEIVE", 0.0402), p, 11, {"USD": 1.0}).mean()
    assert 250_000.0 < q11 < 350_000.0


def test_the_accrued_interest_is_the_paths_own_and_not_the_curves():
    """The model validator, 17 November 2026: a martingale check sees a mean; an accrual read off today's curve would
    pass it, and PFE comes from the spread across paths. Against the short rate integrated along each path (a
    trapezoid, which shares nothing with the engine's bonds): the growth of a unit over a year agrees path by path,
    and is spread across paths as the rate is."""
    from ccr.simulate import growth
    p = simulate(_calib("RISK_NEUTRAL", "forward"), _curves(), {"SPOT:EURUSD": 1.10}, {"SPOT:EURUSD": (0.04, 0.02)}, ASOF, 60, n_paths=5000, seed=2)
    key = "RATES:USD_SOFR"
    r = p.r[key]
    integ = np.concatenate([np.zeros((r.shape[0], 1)), np.cumsum(0.5 * (r[:, 1:] + r[:, :-1]) * np.diff(p.t)[None, :], axis=1)], axis=1)
    for (i0, i1) in ((0, 12), (24, 36), (47, 59)):
        g = growth(p, key, float(p.t[i0]), float(p.t[i1]))
        own = np.exp(integ[:, i1] - integ[:, i0])
        assert np.corrcoef(g, own)[0, 1] > 0.999
        assert np.abs(g / own - 1.0).max() < 2e-3, "path by path, within the trapezoid's discretisation"
        if i0:
            assert g.std() > 0.004, "a year's interest three years out is not known today"
    # the pieces join: a span cut at a date off the grid is the product of its two parts
    a, m, b = float(p.t[3]) + 0.02, float(p.t[7]) + 0.05, float(p.t[11])
    assert np.allclose(growth(p, key, a, b), growth(p, key, a, float(p.t[7])) * growth(p, key, float(p.t[7]), b), rtol=1e-12)
    assert np.allclose(growth(p, key, m, m), 1.0) and (growth(p, key, a, m) > 1.0).mean() > 0.99
    # before today there is no path: the past part grows at today's rate for that length, the same on every path
    past = growth(p, key, -0.5, 0.0)
    assert np.allclose(past, 1.0 / p.p0[key](0.5)) and np.allclose(growth(p, key, -0.5, float(p.t[6])), past * growth(p, key, 0.0, float(p.t[6])))


def test_the_floating_coupon_is_a_cash_flow_of_its_step_on_each_path():
    """A period carries its accrued interest in the value until it is paid, so the value jumps at the payment: the
    exposure step must see that payment as it sees a fixed coupon, in the step that holds its date, and as the path
    has it (flows_per_step). The amount is checked against the short rate integrated along the path, and against the
    jump the value itself makes."""
    from ccr.valuation import flows_per_step, years
    p = simulate(_calib("RISK_NEUTRAL", "forward"), _curves(), {"SPOT:EURUSD": 1.10}, {"SPOT:EURUSD": (0.04, 0.02)}, ASOF, 61, n_paths=4000, seed=1)
    key, N = "RATES:USD_SOFR", 10e6
    it = _par_swap("ANNUAL", "RECEIVE", 0.0402)
    fl = flows_per_step(SimpleNamespace(items=[it]), p, {"USD": 1.0})
    assert fl.shape == (p.n_paths, len(p.grid)) and np.all(fl[:, 0] == 0.0)
    steps = [i for i in range(fl.shape[1]) if np.any(fl[:, i] != 0.0)]
    pays = [years(ASOF, pay) for (_s, _e, pay, _tau) in it["legs"][0][1]]
    assert steps == [next(i for i in range(len(p.t)) if float(p.t[i]) >= tp - 1e-9) for tp in pays], "each coupon in the step that holds its payment date"
    r = p.r[key]
    integ = np.concatenate([np.zeros((r.shape[0], 1)), np.cumsum(0.5 * (r[:, 1:] + r[:, :-1]) * np.diff(p.t)[None, :], axis=1)], axis=1)
    V = np.stack([value_swap(it, p, i, {"USD": 1.0}) for i in range(len(p.grid))], axis=1)
    for n, i in enumerate(steps):
        # we receive the fixed coupon (V falls) and pay the floating one (V rises): on each path the net is the
        # floating year's interest on that path, by the path's own short rate, less the fixed coupon
        # (the period is the year from one 29 October to the next, twelve grid steps; its payment can fall a day or
        # two later, in the next step, when the 29th is not a business day)
        own = N * (np.exp(integ[:, 12 * (n + 1)] - integ[:, 12 * n]) - 1.0) - N * 0.0402 * it["legs"][0][1][n][3]
        assert np.corrcoef(fl[:, i], own)[0, 1] > 0.999 and np.abs(fl[:, i] - own).max() < 2.5e-3 * N
        assert abs(fl[:, i].mean()) < 0.1 * N * 0.0402, "at par the two coupons net to little on average"
        if n:
            assert fl[:, i].std() > 20_000.0, "and the floating one is not the same on every path"
        # the value itself jumps by that amount in that step, beside what the market did in the month
        dv = V[:, i] - V[:, i - 1]
        slope = np.cov(dv, fl[:, i])[0, 1] / fl[:, i].var()
        assert 0.9 < slope < 1.1, (i, slope)
    # the direction: a swap that receives the floating leg has the mirror
    mirror = flows_per_step(SimpleNamespace(items=[_par_swap("ANNUAL", "PAY", 0.0402)]), p, {"USD": 1.0})
    assert np.allclose(mirror, -fl)
    fq = flows_per_step(SimpleNamespace(items=[_par_swap("QUARTERLY", "RECEIVE", 0.0402)]), p, {"USD": 1.0})
    assert sum(1 for i in range(fq.shape[1]) if np.any(fq[:, i] != 0.0)) == 20 and fq.mean(axis=0).max() > 0.9 * N * 0.0402 / 4      # a floating quarter paid: V rises


def test_a_coupon_is_not_a_market_move_over_the_margin_period():
    """The model validator, 17 November 2026. The value a margin period back is drawn by a bridge between grid dates,
    with noise from the spread of the step's change. In a step that holds a coupon that spread is the coupon's: the
    margined exposure at a yearly swap's payment dates stood 8 % to several times above what the market leaves over
    ten days, and at the last payment, when nothing is left to move, tens of thousands on 10M. The bridge is now
    drawn on the value with its payments taken out and the payments put back.

    The reference is the same set with its payments taken out, which has no jump at all, through the same exposure
    step with no flows given."""
    from ccr.exposure import cva
    from ccr.valuation import flows_per_step
    p = simulate(_calib("REAL_WORLD"), _curves(), {"SPOT:EURUSD": 1.10}, {"SPOT:EURUSD": (0.04, 0.02)}, ASOF, 61, n_paths=6000, seed=4)
    it = _par_swap("ANNUAL", "RECEIVE", 0.0402)
    V = np.stack([value_swap(it, p, i, {"USD": 1.0}) for i in range(len(p.grid))], axis=1)
    fl = flows_per_step(SimpleNamespace(items=[it]), p, {"USD": 1.0})
    csa = csa_from_counterparty(SimpleNamespace(csa_type="VM", csa_threshold_m=0, csa_mta_k=0))
    got = exposures(V, p.t, csa, flows=fl)
    smooth = exposures(V - np.cumsum(fl, axis=1), p.t, csa)
    assert np.allclose(got["ee"], smooth["ee"], rtol=1e-9, atol=1e-6) and np.allclose(got["pfe"]["95"], smooth["pfe"]["95"], rtol=1e-9, atol=1e-6)
    blind = exposures(V, p.t, csa)                                           # the bridge on the value as it stands
    steps = [i for i in range(fl.shape[1]) if np.any(fl[:, i] != 0.0)]
    last = steps[-1] - 1                                                     # the exposure arrays start at the first date after today
    assert got["ee"][last] < 0.05 * blind["ee"][last] and blind["ee"][last] > 10_000.0, "nothing is left to move after the last coupon"
    assert all(got["ee"][i - 1] < blind["ee"][i - 1] for i in steps)
    # one number per step is taken as it was (a fixed coupon), and no flows at all is the bridge on the value
    assert np.allclose(exposures(V, p.t, csa, flows=fl.mean(axis=0))["ee"][0], exposures(V - np.cumsum(fl.mean(axis=0))[None, :], p.t, csa)["ee"][0])
    # the credit engine's CVA of a margined set takes the payments out the same way
    p0 = [float(p.p0["RATES:USD_SOFR"](float(x))) for x in p.t]
    a = cva(V, p.t, p0, csa, 10e6, flows=fl)
    b = cva(V, p.t, p0, csa, 10e6)
    assert abs(a["cva_usd"]) < abs(b["cva_usd"]) and a["ee_rn"][last] < 0.05 * b["ee_rn"][last]
    # and an uncollateralised set does not read them
    none = csa_from_counterparty(SimpleNamespace(csa_type="NO_CSA"))
    assert cva(V, p.t, p0, none, 10e6, flows=fl)["cva_usd"] == cva(V, p.t, p0, none, 10e6)["cva_usd"]
