"""A swaption on the exposure paths, through its expiry (0.66.0).

Three things were wrong and each is held here. The option was priced, before its expiry, on a par swap that starts
at the expiry and ends on the last payment date, while the swap delivered starts two business days later and its
floating leg ends on the last period's end; the forward it was valued on was of that par swap too; and the holder
decided on the first grid date at or after the expiry, up to a month late. The test that would have caught all
three is the last one: the option's discounted value is a martingale through the expiry."""
import math
from datetime import date, timedelta
from types import SimpleNamespace

import numpy as np
import pytest

from ccr import calibration as C
from ccr import options as O
from ccr.simulate import account, bond, bond_at, ou_bridge, rate_between, rate_shift, simulate, spot_between
from ccr.valuation import NettingSet, flows_per_step, leg_schedule, value_swap
from pricing.bermudan_swaption import price_european_swaption_hw1f_jamshidian as bond_options
from pricing.bermudan_swaption import price_european_swaption_hw1f_terms as on_cash_flows
from pricing.curve import Curve

ASOF = date(2026, 11, 23)
KEY = "RATES:USD_SOFR"
A_, SIG = 0.03, 0.008
FX = {"USD": 1.0}


def paths(months, n=100000, seed=3, measure="RISK_NEUTRAL", drift_mode="forward", **kw):
    f = {KEY: C.Factor(KEY, "RATES", a=A_, sigma=SIG)}
    calib = C.Calibration(measure, f, np.eye(1), list(f), drift_mode=drift_mode, **kw)
    return simulate(calib, {KEY: Curve(valuation_date=ASOF, flat_rate=0.0375)}, {}, {}, ASOF, months, n_paths=n, seed=seed)


def swaption(expiry, start, tenor=5, K=0.0382, N=10e6, is_payer=True, freq="ANNUAL"):
    mat = start.replace(year=start.year + tenor)
    fixed = {"leg_type": "FIXED", "direction": "PAY" if is_payer else "RECEIVE", "notional": N, "fixed_rate": K, "payment_frequency": "ANNUAL",
             "day_count": "ACT/360", "effective_date": str(start), "maturity_date": str(mat), "currency": "USD"}
    flt = {"leg_type": "FLOAT", "direction": "RECEIVE" if is_payer else "PAY", "notional": N, "payment_frequency": freq, "day_count": "ACT/360",
           "effective_date": str(start), "maturity_date": str(mat), "currency": "USD"}
    scheds = [(fixed, leg_schedule(fixed, ASOF)), (flt, leg_schedule(flt, ASOF))]
    return {"trade": SimpleNamespace(trade_ref="S"), "kind": "SWAPTION", "ccy": "USD", "legs": scheds, "fixed_sched": scheds[0][1], "start": scheds[0][1][0][0],
            "maturity": mat, "expiry": expiry, "K": K, "is_payer": is_payer, "N": N, "vol": 0.0080}


def swap_at(item, p, j):
    return value_swap(item, p, j, FX)


def years(d):
    return (d - ASOF).days / 365.25


# ── the price ────────────────────────────────────────────────────────────────

P0 = lambda t: math.exp(-0.0375 * t - 0.001 * t * t) if t > 0 else 1.0       # noqa: E731
PAY, TAU, K_ = [2.0, 3.0, 4.0, 5.0, 6.0], [1.0139, 1.0167, 1.0139, 1.0139, 1.0139], 0.045


@pytest.mark.parametrize("payer", [True, False])
@pytest.mark.parametrize("start", [None, 1.0 + 2 / 365.25, 1.25])
def test_the_price_on_cash_flows_is_the_sum_of_bond_options_where_the_swap_is_a_par_bond(payer, start):
    """Two derivations of one price: options on the bonds (Jamshidian, with a put on the bond to the start where the
    swap starts late) and the swap's cash flows term by term."""
    T0 = start or 1.0
    j = bond_options(1.0, K_, payer, 1.0, PAY, TAU, A_, SIG, P0, start_y=start)
    terms = [(-K_ * t, [(q, 1)]) for q, t in zip(PAY, TAU)] + [(1.0, [(T0, 1)]), (-1.0, [(PAY[-1], 1)])]
    g = on_cash_flows(terms, payer, 1.0, A_, SIG, P0)
    assert g["npv"] == pytest.approx(j["npv"], abs=1e-12)
    assert abs(sum(t["at_root"] for t in g["terms"])) < 1e-12                      # nothing at the root
    assert j["start"] == pytest.approx(T0)


def test_a_swap_whose_value_turns_twice_is_refused():
    # a made-up set of terms with two roots in the bracket: the closed form rests on one
    two_roots = [(1.0, [(3.0, 1)]), (-2.02, [(2.0, 1)]), (1.0195, [(1.5, 1)])]
    with pytest.raises(RuntimeError):
        on_cash_flows(two_roots, True, 1.0, A_, SIG, P0)


def test_the_validators_own_integration_of_the_payoff_gives_the_same_price():
    """The model validator, 23 November 2026: the delivered swap's payoff integrated over the factor at the expiry
    with his own bond formula, on the checks' market: 77,625.0163, and the three steps from the old 79,533.155 (own
    start 78,305.92; each period to its own end 77,707.33; coupons paid after the period's end 77,625.02). Here the
    same integration, by quadrature, against the closed form, on a swap with a late start and a late payment."""
    terms = [(-K_ * t, [(q, 1)]) for q, t in zip(PAY, TAU)]
    T0, lag = 1.0 + 2 / 365.25, 2 / 365.25
    ends = [T0 + k for k in range(1, 6)]
    for s_, e_ in zip([T0] + ends[:-1], ends):
        terms += [(1.0, [(s_, 1), (e_ + lag, 1), (e_, -1)]), (-1.0, [(e_ + lag, 1)])]
    from pricing.bermudan_swaption import hw1f_bond_price
    for payer in (True, False):
        g = on_cash_flows(terms, payer, 1.0, A_, SIG, P0)
        r = np.linspace(g["mu"] - 9 * g["s"], g["mu"] + 9 * g["s"], 20001)
        dens = np.exp(-0.5 * ((r - g["mu"]) / g["s"]) ** 2) / (g["s"] * math.sqrt(2 * math.pi))
        val = np.zeros_like(r)
        for w, bonds in terms:
            v = np.full_like(r, w)
            for T, sgn in bonds:
                pb = np.array([hw1f_bond_price(A_, SIG, 1.0, T, float(x), P0) for x in r[::200]])
                pb = np.exp(np.interp(r, r[::200], np.log(pb)))               # a bond is exp-affine in r: its log is a line
                v = v * pb if sgn > 0 else v / pb
            val += v
        pay = np.maximum(val if payer else -val, 0.0)
        assert g["P_expiry"] * float(np.trapezoid(pay * dens, r)) == pytest.approx(g["npv"], rel=2e-6)


def test_a_payer_less_a_receiver_is_the_forward_swap_and_a_late_start_is_worth_less_to_the_payer():
    terms = lambda T0: [(-K_ * t, [(q, 1)]) for q, t in zip(PAY, TAU)] + [(1.0, [(T0, 1)]), (-1.0, [(PAY[-1], 1)])]    # noqa: E731
    for T0 in (1.0, 1.0 + 2 / 365.25):
        pay, rec = on_cash_flows(terms(T0), True, 1.0, A_, SIG, P0), on_cash_flows(terms(T0), False, 1.0, A_, SIG, P0)
        swap = P0(T0) - P0(PAY[-1]) - K_ * sum(t * P0(q) for q, t in zip(PAY, TAU))
        assert pay["npv"] - rec["npv"] == pytest.approx(swap, abs=1e-12)
    assert on_cash_flows(terms(1.0 + 2 / 365.25), True, 1.0, A_, SIG, P0)["npv"] < on_cash_flows(terms(1.0), True, 1.0, A_, SIG, P0)["npv"]


def test_the_cash_flows_are_the_swap_the_paths_deliver():
    """The option's forward and annuity before the expiry are of the swap value_swap delivers: on every path
    N·A·(F − K) is that swap's value, so a payer less a receiver is the swap, path by path."""
    p = paths(15, n=500)
    expiry = p.grid[12]
    for freq in ("ANNUAL", "QUARTERLY"):
        pay, rec = swaption(expiry, expiry + timedelta(days=2), freq=freq), swaption(expiry, expiry + timedelta(days=2), is_payer=False, freq=freq)
        own = O.hw_implied_vol(rec, p)                                   # the receiver's own vol, from its own exact price
        for i in (0, 5, 11):
            vp, vr = O.value_swaption(pay, p, i, FX, swap_at), O.value_swaption(rec, p, i, FX, swap_at)
            # each at its own vol: apart by the convexity of a coupon paid after its period's end, which the price
            # counts and the swap on the paths does not (a few units on ten million; the model validator, 4 to 7)
            assert float(np.abs(vp - vr - swap_at(pay, p, i)).max()) < 1e-6 * 10e6
        rec["_hw_vol"] = {id(p): O.hw_implied_vol(pay, p)}               # at one vol the identity is exact: N·A·(F − K) is the swap
        for i in (0, 5, 11):
            vp, vr = O.value_swaption(pay, p, i, FX, swap_at), O.value_swaption(rec, p, i, FX, swap_at)
            assert float(np.abs(vp - vr - swap_at(pay, p, i)).max()) < 1e-4
        assert abs(own - O.hw_implied_vol(pay, p)) < 1e-6
    fl = O.swaption_flows(pay, ASOF)
    assert len(fl["fixed"]) == 5 and any(len(b) == 3 for _, b in fl["floating"])     # a period paid after its end: P(start)·P(pay)/P(end)
    assert min(T for _, b in fl["floating"] for T, _ in b) == pytest.approx(years(pay["start"]))


def test_an_item_without_legs_keeps_the_par_swap_from_its_start():
    p = paths(15, n=200)
    expiry = p.grid[12]
    full = swaption(expiry, expiry)
    bare = {k: full[k] for k in ("expiry", "fixed_sched", "start", "N", "K", "vol", "is_payer", "ccy")}
    fl = O.swaption_flows(bare, ASOF)
    assert fl["floating"] == [(1.0, [(years(expiry), 1)]), (-1.0, [(fl["fixed"][-1][0], 1)])]
    g = O.hw_price(bare, p)
    j = bond_options(1.0, bare["K"], True, years(expiry), [T for T, _ in fl["fixed"]], [t for _, t in fl["fixed"]], A_, SIG, p.p0[KEY])
    assert g["npv"] == pytest.approx(j["npv"], abs=1e-12)


# ── the rate's state inside a step ───────────────────────────────────────────

def test_a_rates_state_inside_a_step_has_the_paths_own_law():
    p = paths(3, n=200000)
    for j in range(len(p.grid)):
        assert np.shares_memory(rate_between(p, KEY, float(p.t[j])), p.x[KEY][:, j])
    assert p.inside == {}
    D = (p.grid[2] - p.grid[1]).days
    T = years(p.grid[1] + timedelta(days=9))
    x_e, lo, hi = rate_between(p, KEY, T), p.x[KEY][:, 1], p.x[KEY][:, 2]
    n = p.n_paths
    v = lambda t: SIG ** 2 * (1 - math.exp(-2 * A_ * t)) / (2 * A_)      # noqa: E731
    assert x_e.var() == pytest.approx(v(T), rel=4 * math.sqrt(2 / n))
    k = ou_bridge(A_, SIG, 9, D)
    resid = x_e - (lo * k["decay_d"] + k["c_d"] * (hi - lo * k["decay_D"]))
    assert resid.var() == pytest.approx(k["var"], rel=4 * math.sqrt(2 / n))
    assert abs(np.corrcoef(resid, lo)[0, 1]) < 4 / math.sqrt(n) and abs(np.corrcoef(resid, hi)[0, 1]) < 4 / math.sqrt(n)
    step_on = hi - x_e * math.exp(-A_ * (D - 9) / 365.25)                # what is left of the step is new
    assert abs(np.corrcoef(step_on, x_e)[0, 1]) < 4 / math.sqrt(n)
    assert step_on.var() == pytest.approx(v((D - 9) / 365.25), rel=4 * math.sqrt(2 / n))
    q = paths(3, n=200000)
    T2 = years(p.grid[1] + timedelta(days=20))
    assert np.array_equal(rate_between(q, KEY, T2), rate_between(p, KEY, T2)) and np.array_equal(rate_between(q, KEY, T), x_e)   # any order


def test_a_bond_from_the_grids_state_is_the_grids_bond():
    p = paths(6, n=300)
    assert np.array_equal(bond_at(p, KEY, float(p.t[4]), p.x[KEY][:, 4], 3.0), bond(p, KEY, 4, 3.0))
    T = years(p.grid[4] + timedelta(days=11))
    inside = bond_at(p, KEY, T, rate_between(p, KEY, T), 3.0)
    assert np.all(inside > 0) and abs(float(inside.mean() / (p.p0[KEY](3.0) / p.p0[KEY](T))) - 1) < 0.01


def test_a_real_world_run_keeps_its_shift_inside_a_step():
    p = paths(3, n=100000, measure="REAL_WORLD", drift_mode="zero")
    assert rate_shift(paths(3, n=10), KEY, 0.1) == 0.0
    T = years(p.grid[1] + timedelta(days=13))
    se = SIG * math.sqrt(T) / math.sqrt(p.n_paths)
    assert abs(float(rate_between(p, KEY, T).mean()) - rate_shift(p, KEY, T)) < 4 * se
    for j in (1, 2):
        assert abs(float(p.x[KEY][:, j].mean()) - rate_shift(p, KEY, float(p.t[j]))) < 4 * se     # the same formula simulate() used


def test_a_rate_and_a_spot_move_together_inside_a_step_and_the_spot_is_the_one_it_was():
    skey = "SPOT:EURUSD"
    f = {KEY: C.Factor(KEY, "RATES", a=A_, sigma=SIG), skey: C.Factor(skey, "SPOT", sigma=0.08)}
    corr = np.array([[1.0, 0.5], [0.5, 1.0]])
    both = simulate(C.Calibration("REAL_WORLD", f, corr, [KEY, skey], drift_mode="zero"), {KEY: Curve(valuation_date=ASOF, flat_rate=0.0375)},
                    {skey: 1.165}, {skey: (0.04, 0.02)}, ASOF, 2, n_paths=40000, seed=4)
    D = (both.grid[1] - both.grid[0]).days
    T = years(both.grid[0] + timedelta(days=D // 2))
    k = ou_bridge(A_, SIG, D // 2, D)
    lo, hi = both.x[KEY][:, 0] - rate_shift(both, KEY, 0.0), both.x[KEY][:, 1] - rate_shift(both, KEY, float(both.t[1]))
    r_res = rate_between(both, KEY, T) - rate_shift(both, KEY, T) - (lo * k["decay_d"] + k["c_d"] * (hi - lo * k["decay_D"]))
    s_lo, s_hi = np.log(both.s[skey][:, 0]), np.log(both.s[skey][:, 1])
    s_res = np.log(spot_between(both, skey, T)) - (s_lo + (D // 2) / D * (s_hi - s_lo))
    assert np.corrcoef(r_res, s_res)[0, 1] == pytest.approx(0.5, abs=0.03)
    # the spot's level inside a step does not depend on a rate having one: its draw comes first
    alone = simulate(C.Calibration("REAL_WORLD", {skey: f[skey]}, np.eye(1), [skey], drift_mode="zero"), {}, {skey: 1.165}, {skey: (0.04, 0.02)}, ASOF, 2,
                     n_paths=40000, seed=4)
    a_res = np.log(spot_between(alone, skey, T)) - (np.log(alone.s[skey][:, 0]) + (D // 2) / D * (np.log(alone.s[skey][:, 1]) - np.log(alone.s[skey][:, 0])))
    assert np.allclose(a_res, s_res, rtol=0, atol=1e-12)


# ── the exercise ─────────────────────────────────────────────────────────────

def test_the_holder_decides_at_the_expiry_not_on_the_next_grid_date():
    p = paths(8, n=20000)
    expiry = p.grid[3] + timedelta(days=3)
    it = swaption(expiry, expiry + timedelta(days=2))
    took = O.exercised(it, p, swap_at)
    at_expiry = value_swap(it, p, 4, FX, at=years(expiry))
    assert np.array_equal(took, at_expiry > 0)
    late = swap_at(it, p, 4) > 0                                         # what the engine looked at until 0.66.0
    assert 0.03 < float((took != late).mean()) < 0.25                    # a month on, the swap has turned on some paths
    after = O.value_swaption(it, p, 4, FX, swap_at)
    assert np.array_equal(after != 0, took) and float(after[took & ~late].max()) < 0        # exercised, then under water: still ours
    # the state the decision was made on is the one every bond at the expiry is read from, and its swap is the cash flows
    fl = O.swaption_flows(it, ASOF)
    x_e = rate_between(p, KEY, years(expiry))
    Pe = lambda T: bond_at(p, KEY, years(expiry), x_e, T)                # noqa: E731
    payer = O._sum_of_bond_products(fl["floating"], Pe) - it["K"] * sum(tau * Pe(T) for T, tau in fl["fixed"])
    assert float(np.abs(payer * it["N"] - at_expiry).max()) < 1e-6 * it["N"]
    # a receiver takes the other side of the same state
    rec = swaption(expiry, expiry + timedelta(days=2), is_payer=False)
    assert np.array_equal(O.exercised(rec, p, swap_at), at_expiry < 0)


def test_an_expiry_on_a_grid_date_is_decided_on_that_date_and_draws_nothing():
    p = paths(8, n=2000)
    it = swaption(p.grid[3], p.grid[3] + timedelta(days=2))
    assert np.array_equal(O.exercised(it, p, swap_at), swap_at(it, p, 3) > 0) and p.inside == {}


def test_the_exercised_swaps_coupons_follow_the_same_decision():
    p = paths(30, n=3000)
    expiry = p.grid[3] + timedelta(days=10)
    it = swaption(expiry, expiry + timedelta(days=2), tenor=2)
    ns = SimpleNamespace(items=[it])
    fl = flows_per_step(ns, p, FX)
    took = O.exercised(it, p, swap_at)
    assert np.all(fl[~took] == 0.0) and float(np.abs(fl[took]).sum()) > 0
    assert isinstance(NettingSet, type)


# ── what would have caught it ────────────────────────────────────────────────

@pytest.mark.parametrize("months,off,lag", [(12, 0, 2), (12, 3, 2), (12, 27, 2), (3, 0, 2), (3, 3, 2), (3, 15, 2)])
def test_the_options_discounted_value_is_a_martingale_through_its_expiry(months, off, lag):
    p = paths(months + 3)
    expiry = p.grid[months] + timedelta(days=off)
    it = swaption(expiry, expiry + timedelta(days=lag))
    A = account(p, KEY)
    v0 = float(O.value_swaption(it, p, 0, FX, swap_at).mean())
    assert v0 == pytest.approx(it["N"] * O.hw_price(it, p)["npv"], rel=1e-6)          # today: the model's exact price
    first_after = months if off == 0 else months + 1
    for j in (months - 1, first_after, first_after + 1):
        v = O.value_swaption(it, p, j, FX, swap_at) / A[:, j]
        assert abs(float(v.mean()) - v0) < 3.5 * float(v.std() / math.sqrt(p.n_paths)), (j, float(v.mean()) / v0 - 1)
    if off and off <= 15:
        # until 0.66.0: the holder decided on the grid date after the expiry, two weeks to a month late: an option
        # with a later expiry, worth more (with 27 days gone the next grid date is three days on, and it is close)
        j = first_after
        late = np.maximum(swap_at(it, p, j), 0.0) / A[:, j]
        assert float(late.mean()) > v0 * (1.02 if months == 12 else 1.05)
