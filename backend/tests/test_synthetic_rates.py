"""The synthetic rates market (0.55.0): one stated generator behind every rates curve of the hosted demo."""
import hashlib
import math
import statistics
from datetime import date, timedelta

import pytest

from market_data import synthetic_rates as R

D = R.SET_ON
GRID = [1 / 365, 0.25, 1.0, 2.0, 5.0, 10.0, 30.0]


def test_on_the_day_they_were_set_a_curve_is_its_parameters():
    assert D == date(2026, 11, 17) and R.is_business_day(D)
    for c, (b0, b1, b2, tau) in R.PARAMS.items():
        assert R.factors(c, D) == {f: 0.0 for f in R.FACTORS}
        assert R.par_rate(c, D, 1e-9) == pytest.approx(b0 + b1, abs=1e-6)              # the overnight rate
        assert R.par_rate(c, D, 1e4) == pytest.approx(b0, abs=1e-3)                    # the long end
        x = 2.0 / tau
        f1 = (1 - math.exp(-x)) / x
        assert R.par_rate(c, D, 2.0) == pytest.approx(b0 + b1 * f1 + b2 * (f1 - math.exp(-x)), abs=1e-12)
        assert R.overnight(c, D) == pytest.approx(R.par_rate(c, D, 1 / 365), abs=1e-12)


def test_a_curve_is_a_pure_function_of_the_curve_and_the_date():
    other = date(2026, 11, 2)
    for c in R.PARAMS:
        a, b = R.curve_rates(c, other, GRID), R.curve_rates(c, other, GRID)
        assert a == b and all(math.isfinite(x) for x in a) and a != R.curve_rates(c, D, GRID)
    # pinned: a change to the seed, the parameters or the recipe moves every curve, and this says so first
    assert R.par_rate("USD_SOFR", other, 10.0) == pytest.approx(3.965, abs=0.0006)
    assert R.overnight("EUR_ESTR", other) == pytest.approx(1.916, abs=0.0006)
    assert R.par_rate("JPY_TONAR", date(2024, 11, 18), 10.0) == pytest.approx(1.851, abs=0.0006)


def test_a_shock_is_made_as_the_recipe_says():
    """Written out from the methodology's text, not from the function: the SHA-256 of 'seed|key|...', two uniforms
    from its first sixteen bytes, Box-Muller's cosine branch; and a curve's shock is half shared, half its own."""
    def n(*key):
        h = hashlib.sha256("|".join(str(k) for k in ("rijeka synthetic rates 1", *key)).encode()).digest()
        u1 = (int.from_bytes(h[:8], "big") + 1) / (2 ** 64 + 1)
        u2 = int.from_bytes(h[8:16], "big") / 2 ** 64
        return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
    day = date(2026, 11, 18)
    for c in R.PARAMS:
        for f in R.FACTORS:
            want = math.sqrt(0.5) * n("all", f, day.toordinal()) + math.sqrt(0.5) * n(c, f, day.toordinal())
            assert R.shock(c, f, day) == pytest.approx(want, abs=1e-15)
    xs = [R._normal("test", i) for i in range(20_000)]
    assert abs(statistics.fmean(xs)) < 0.03 and 0.97 < statistics.pstdev(xs) < 1.03


def test_a_factor_walks_out_of_the_set_day_one_business_day_at_a_time():
    """The day after: one shock. Two days after: the first carried by phi and a second. The same going back."""
    c, f = "GBP_SONIA", "level"
    s = R.SIGMA_BP[f] / 100.0 * R.VOL_SCALE[c]
    d1, d2 = date(2026, 11, 18), date(2026, 11, 19)
    assert R.factors(c, d1)[f] == pytest.approx(s * R.shock(c, f, d1), abs=1e-15)
    assert R.factors(c, d2)[f] == pytest.approx(R.PHI * s * R.shock(c, f, d1) + s * R.shock(c, f, d2), abs=1e-15)
    b1, b2 = date(2026, 11, 16), date(2026, 11, 13)                                    # Monday, then the Friday before it
    assert R.factors(c, b1)[f] == pytest.approx(s * R.shock(c, f, b1), abs=1e-15)
    assert R.factors(c, b2)[f] == pytest.approx(R.PHI * s * R.shock(c, f, b1) + s * R.shock(c, f, b2), abs=1e-15)
    assert R.PHI == pytest.approx(math.exp(-0.05 / 252), abs=1e-15)


def test_a_weekend_carries_the_last_business_day():
    sat, fri = date(2026, 11, 14), date(2026, 11, 13)
    assert not R.is_business_day(sat) and R.is_business_day(fri)
    for c in R.PARAMS:
        assert R.curve_rates(c, sat, GRID) == R.curve_rates(c, fri, GRID)
        assert R.curve_rates(c, sat + timedelta(days=1), GRID) == R.curve_rates(c, fri, GRID)
    assert R.curve_rates("USD_SOFR", date(2026, 11, 21), GRID) == R.curve_rates("USD_SOFR", date(2026, 11, 20), GRID)   # after the set day too


def test_a_history_is_the_same_numbers_day_by_day_on_both_sides_of_the_set_day():
    start, end = date(2026, 9, 1), date(2027, 1, 29)
    h = R.history("GBP_SONIA", GRID, start, end)
    assert [d for d, _ in h] == [x for x in (start + timedelta(days=i) for i in range((end - start).days + 1)) if R.is_business_day(x)]
    for d, row in (h[0], h[17], h[-1], next(x for x in h if x[0] == D)):
        assert row == pytest.approx(R.curve_rates("GBP_SONIA", d, GRID), abs=1e-12)
    assert R.history("GBP_SONIA", GRID, date(2026, 11, 14), date(2026, 11, 15)) == []     # a weekend alone
    assert R.history("GBP_SONIA", GRID, end, start) == []


def test_the_moves_are_of_the_size_and_kinship_the_recipe_states():
    start = date(2022, 11, 17)
    sd = {}
    hist = {c: R.history(c, [10.0], start, D) for c in R.PARAMS}
    for c, h in hist.items():
        ch = [(b[1][0] - a[1][0]) * 100 for a, b in zip(h, h[1:])]
        assert len(ch) > 1000
        sd[c] = statistics.pstdev(ch)
        # at ten years the level shock is nearly all of it: 3.5 bp a day times the currency's scale
        assert sd[c] == pytest.approx(3.55 * R.VOL_SCALE[c], rel=0.08), c
    assert sd["JPY_TONAR"] < sd["CHF_SARON"] < sd["EUR_ESTR"] < sd["USD_SOFR"] < sd["GBP_SONIA"]
    du = [(b[1][0] - a[1][0]) for a, b in zip(hist["USD_SOFR"], hist["USD_SOFR"][1:])]
    de = [(b[1][0] - a[1][0]) for a, b in zip(hist["EUR_ESTR"], hist["EUR_ESTR"][1:])]
    mu, me = statistics.fmean(du), statistics.fmean(de)
    corr = sum((a - mu) * (b - me) for a, b in zip(du, de)) / (len(du) * statistics.pstdev(du) * statistics.pstdev(de))
    assert 0.40 < corr < 0.60                                       # half of each shock's variance is shared
    # it wanders from the set day's level like a slow random walk: within a few standard deviations of sigma * sqrt(days)
    for c, h in hist.items():
        far = max(abs(r[0] - R.par_rate(c, D, 10.0)) for _, r in h)
        assert far < 4 * 0.035 * R.VOL_SCALE[c] * math.sqrt(len(h)), (c, far)


def test_the_frontends_default_quotes_are_what_the_script_makes():
    """frontend/src/data/ratesCurves.js is written by scripts/synthetic_rates_defaults.py and by nothing else: a quote
    typed into it by hand, or a change to the recipe without a rerun, fails here."""
    import importlib.util
    import pathlib
    path = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "synthetic_rates_defaults.py"
    spec = importlib.util.spec_from_file_location("synthetic_rates_defaults", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not mod.TARGET.exists():
        pytest.skip("the frontend is not in this checkout")
    text = mod.TARGET.read_text()
    assert mod.make(text) == text
    assert "Every quote in this file is SYNTHETIC" in text and text.count("quote:") > 400
