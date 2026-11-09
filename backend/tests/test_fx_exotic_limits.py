"""The exotic pricers at their limits (9 November 2026).

Found the same day by three checks. (1) An American option whose strike is about 170 standard deviations or more
from the forward, and a barrier or a touch at a very low vol, raised ZeroDivisionError and OverflowError, and the API
answered 500 where a price exists. (2) Emmy: the first-passage value (one unit paid at the first hit of a barrier),
written as a power times Φ, lost its first term wherever Φ underflowed while the power was large (|b|√T/σ above about
3.7): up to 4.7 % of the payout at a low vol, exact at EURUSD's and BTC's. It is now evaluated in logs everywhere, and
by integrating over the time of the hit where the discount rate is too far below zero for the closed form. (3) The
tree's limit where its probabilities saturate is the best of exercising along the drift: now, at expiry, or at the
interior time where the discounted exercise value peaks.

The references here are independent of the pricer: a quadrature of the hitting density, the zero-vol limit worked by
hand, and QuantLib's American engine."""
import itertools
import math

import pytest
from scipy.integrate import quad

from pricing.fx_exotic import ExoticSpec, american_tree, first_passage_value, price_exotic, vanilla

S, R, B = 75_000.0, 0.04, 0.05


def hit_by_quadrature(S_, H, r, b, sigma, T):
    """E[e^{−rτ}·1{τ ≤ T}] from the density of the first time a drifted Brownian motion reaches ln(H/S)."""
    k, nu = math.log(H / S_), b - 0.5 * sigma * sigma

    def f(t):
        return 0.0 if t <= 0 else math.exp(-r * t - (k - nu * t) ** 2 / (2 * sigma * sigma * t)) * abs(k) / (sigma * math.sqrt(2 * math.pi * t ** 3))
    peak = k / nu if nu else None
    return quad(f, 0.0, T, points=[peak] if peak and 0 < peak < T else None, limit=400, epsabs=1e-13, epsrel=1e-12)[0]


FIRST_PASSAGE = [
    # name, S, H, r, b, sigma, T
    ("EURUSD-like, up", 1.085, 1.12, 0.04, 0.015, 0.07, 0.5),
    ("BTC-like, up", 75_000.0, 90_000.0, 0.04, 0.05, 0.55, 0.25),
    ("BTC-like, down", 75_000.0, 60_000.0, 0.04, 0.05, 0.55, 1.0),
    ("low vol, the barrier at the forward: the old form lost 3.9 % of the payout here", 1.0, math.exp(0.10), 0.04, 0.05, 0.015, 2.0),
    ("a wide rate gap: the old form lost 2 % of the payout here", 1.0, math.exp(0.72), 0.40, 0.36, 0.12, 2.0),
    ("down barrier, downward drift, low vol", 1.0, 0.9, 0.03, -0.06, 0.02, 2.0),
    ("no drift at a tiny vol: neither 0 nor 1", 1.0, 1.002, 0.03, 0.0, 0.002, 1.0),
    ("no discounting", 1.0, 1.1, 0.0, 0.02, 0.1, 1.0),
    ("a negative rate, the closed form still applies", 1.0, 1.05, -0.0004, -0.037, 0.075, 1.0),
    ("a rate so negative that λ is not real: by the integral", 1.0, 1.05, -0.005, 0.01, 0.08, 2.0),
]


@pytest.mark.parametrize("name,S_,H,r,b,sigma,T", FIRST_PASSAGE, ids=[c[0] for c in FIRST_PASSAGE])
def test_first_passage_against_a_quadrature_of_the_hitting_density(name, S_, H, r, b, sigma, T):
    assert first_passage_value(S_, H, r, b, sigma, T) == pytest.approx(hit_by_quadrature(S_, H, r, b, sigma, T), rel=1e-9, abs=1e-12)


def test_the_form_the_pricer_used_before_was_wrong_at_a_low_vol_and_overflowed_at_a_lower_one():
    def power_times_phi(S_, H, r, b, sigma, T):
        eta = 1.0 if H < S_ else -1.0
        mu = (b - 0.5 * sigma * sigma) / (sigma * sigma)
        lam = math.sqrt(mu * mu + 2.0 * r / (sigma * sigma))
        sT = sigma * math.sqrt(T)
        z = math.log(H / S_) / sT + lam * sT
        N = lambda x: 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))        # noqa: E731
        return (H / S_) ** (mu + lam) * N(eta * z) + (H / S_) ** (mu - lam) * N(eta * z - 2.0 * eta * lam * sT)
    low = (1.0, math.exp(0.10), 0.04, 0.05, 0.015, 2.0)
    exact = hit_by_quadrature(*low)
    assert exact - power_times_phi(*low) > 0.03                         # more than 3 % of the payout was missing
    assert first_passage_value(*low) == pytest.approx(exact, rel=1e-9)
    with pytest.raises(OverflowError):
        power_times_phi(75_000.0, 75_750.0, 0.04, 0.05, 0.0005, 2.0)


def test_first_passage_with_almost_no_vol_is_the_drift_reaching_the_barrier():
    # the spot rides its drift: it reaches H = S·e^{b·τ} at τ = ln(H/S)/b, and one unit paid then is worth e^{−r·τ}
    for H, b, T in ((75_750.0, 0.05, 2.0), (76_000.0, 0.20, 1.0)):
        tau = math.log(H / S) / b
        assert first_passage_value(S, H, R, b, 0.0005, T) == pytest.approx(math.exp(-R * tau), rel=2e-5)
    assert first_passage_value(S, 75_750.0, R, 0.05, 0.0005, 1 / 365) == 0.0        # a day's drift does not reach +1 %
    assert first_passage_value(S, 74_000.0, R, 0.05, 0.0005, 2.0) == pytest.approx(0.0, abs=1e-300)


def test_one_unit_paid_at_a_hit_under_a_negative_rate_can_be_worth_more_than_one():
    # at a low vol the drift reaches the barrier after about 1.5 years, well inside the two, and at a rate of −0.5 %
    # one unit paid then is worth e^{0.0075} now: above 1, which a cap at 1 would have cut
    args = (1.0, math.exp(0.05 * 1.5), -0.005, 0.05, 0.005, 2.0)
    v = first_passage_value(*args)
    assert v == pytest.approx(hit_by_quadrature(*args), rel=1e-9)
    assert 1.005 < v <= math.exp(0.005 * 2.0)


def _drift_limit(S_, K, r, b, T, call):
    """The best of exercising along the drift S·e^{bt}, on a fine grid of times: the limit worked by brute force."""
    sign = 1.0 if call else -1.0
    return max(max(math.exp(-r * t) * sign * (S_ * math.exp(b * t) - K) for t in (T * i / 20000 for i in range(20001))), 0.0)


AMERICAN_LIMIT = [
    # call, K, r, b, sigma, T: each far enough from the forward that the tree's probabilities saturate
    (True, 400_000.0, 0.04, 0.05, 0.02, 7 / 365), (False, 10_000.0, 0.04, 0.05, 0.02, 1 / 365),
    (True, 18_750.0, 0.04, 0.05, 0.0005, 1 / 365), (False, 300_000.0, 0.04, 0.05, 0.0005, 1 / 365),
    (False, 150_000.0, 0.08, -0.10, 0.0035, 2.0),          # a put whose best exercise is at an interior time (r_b above r)
    (True, 37_500.0, 0.10, 0.057, 0.004, 2.0),             # a call the same way
    (False, 140_000.0, 0.04, 0.02, 0.0035, 1.0), (True, 30_000.0, 0.04, -0.01, 0.004, 1.0),
]


@pytest.mark.parametrize("call,K,r,b,sigma,T", AMERICAN_LIMIT)
def test_an_american_option_far_from_the_money_is_the_best_exercise_along_the_drift(call, K, r, b, sigma, T):
    v = american_tree(S, K, r, b, sigma, T, call)
    assert math.isfinite(v) and v >= 0.0
    floor = max(_drift_limit(S, K, r, b, T, call), vanilla(S, K, r, b, sigma, T, call))
    assert v == pytest.approx(floor, rel=2e-5, abs=1e-6 * S)


def test_the_limit_joins_quantlib_on_both_sides_of_the_point_where_the_tree_stops():
    ql = pytest.importorskip("QuantLib")

    def reference(K, r, rb, sigma, T, call):
        today = ql.Date(9, 11, 2026)
        ql.Settings.instance().evaluationDate = today
        dc = ql.Actual365Fixed()
        proc = ql.BlackScholesMertonProcess(ql.QuoteHandle(ql.SimpleQuote(1.0)), ql.YieldTermStructureHandle(ql.FlatForward(today, rb, dc)),
                                            ql.YieldTermStructureHandle(ql.FlatForward(today, r, dc)),
                                            ql.BlackVolTermStructureHandle(ql.BlackConstantVol(today, ql.NullCalendar(), sigma, dc)))
        opt = ql.VanillaOption(ql.PlainVanillaPayoff(ql.Option.Call if call else ql.Option.Put, K), ql.AmericanExercise(today, today + int(round(T * 365))))
        opt.setPricingEngine(ql.QdFpAmericanEngine(proc, ql.QdFpAmericanEngine.accurateScheme()))
        return opt.NPV()
    # a put with the base rate above the quote rate, at a vol of 0.354 %: K 1.90 is priced by the tree (|d1| 168),
    # 1.95 to 2.20 by the limit (|d1| 173 to 197); before the interior time was added the limit was 20 to 32 bp low
    for K in (1.90, 1.95, 1.97, 2.00, 2.20):
        v = american_tree(1.0, K, 0.08, 0.08 - 0.18, 0.00354, 2.0, False)
        assert abs(v - reference(K, 0.08, 0.18, 0.00354, 2.0, False)) < 0.2e-4, K          # within 0.2 bp of notional
    for K in (0.50, 0.52, 0.55):
        v = american_tree(1.0, K, 0.10, 0.10 - 0.043, 0.004, 2.0, True)
        assert abs(v - reference(K, 0.10, 0.043, 0.004, 2.0, True)) < 0.2e-4, K


@pytest.mark.parametrize("call,K", [(True, 40_000.0), (False, 150_000.0), (True, 150_000.0), (False, 40_000.0)])
def test_deep_in_or_out_of_the_money_at_an_ordinary_vol_the_tree_itself_gives_that_limit(call, K):
    v = american_tree(S, K, R, B, 0.10, 30 / 365, call)
    assert v == pytest.approx(max(vanilla(S, K, R, B, 0.10, 30 / 365, call), (S - K) if call else (K - S), 0.0), rel=1e-9, abs=1e-6)


def test_no_style_raises_an_arithmetic_error_or_a_bare_math_error_on_a_wide_grid_of_terms():
    bad = []
    for T, vol, m in itertools.product([1 / 365, 7 / 365, 30 / 365, 1.0, 2.0], [0.0005, 0.005, 0.02, 0.1, 0.6, 3.0], [0.25, 0.5, 0.9, 0.99, 1.01, 1.1, 2.0, 4.0]):
        level = S * m
        specs = [ExoticSpec("AMERICAN", ot, strike=level) for ot in ("CALL", "PUT")]
        specs += [ExoticSpec("DIGITAL", ot, strike=level, payout=1e6, payout_currency="QUOTE") for ot in ("CALL", "PUT")]
        specs += [ExoticSpec("TOUCH", touch_type=tt, barrier=level, payout=1e6, payout_currency="QUOTE", pay_at_hit=hit)
                  for tt, hit in (("ONE_TOUCH", True), ("ONE_TOUCH", False), ("NO_TOUCH", False))]
        for bt in ("UP_OUT", "UP_IN", "DOWN_OUT", "DOWN_IN"):
            if bt.startswith("UP") == (m > 1):
                specs += [ExoticSpec("BARRIER", ot, strike=k, barrier=level, barrier_type=bt, rebate=5.0) for ot in ("CALL", "PUT") for k in (S, S / 2, S * 2)]
        for spec in specs:
            try:
                x = price_exotic(spec, base_notional=10, spot=S, forward=S * 1.0001, df_quote=0.999, t_expiry=T, vol=vol, direction="BUY")
            except ValueError as e:
                if "math domain" in str(e) or "math range" in str(e):        # a bare library error is not a refusal in words
                    bad.append(("bare math error", spec.style, m, T, vol))
                continue
            except ArithmeticError as e:
                bad.append((type(e).__name__, spec.style, spec.barrier_type or spec.touch_type, m, T, vol))
                continue
            if not all(math.isfinite(v) for v in (x.npv, x.spot01, x.vega, x.theta) if v is not None):
                bad.append(("not finite", spec.style, m, T, vol))
    assert bad == []
