"""The calibration of a digital asset's vol regimes (scripts/calibrate_vol_regimes.py): its likelihood is the
likelihood, its two-chain model is the engine's, and on data drawn from known chains the truth scores higher than
one vol, than the fast chain alone and than parameters moved off it. The full fit (minutes, on five years of
closes) is run by hand; what it printed on 11 November 2026 is pinned in tests/test_vol_regimes.py."""
import importlib.util
import itertools
import math
import os

import numpy as np
import pytest

from pricing.vol_regimes import REGIMES, clock, step_variance

_spec = importlib.util.spec_from_file_location("calibrate_vol_regimes", os.path.join(os.path.dirname(__file__), "..", "scripts", "calibrate_vol_regimes.py"))
cal = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cal)


def test_the_filters_likelihood_is_the_sum_over_every_path_of_states():
    """Hamilton's filter against the definition, written out: every sequence of hidden states, its probability and
    the density of the returns given it, added up. Seven returns and four states: 16,384 sequences."""
    rng = np.random.default_rng(1)
    r = rng.standard_normal(7) * 0.03
    sds = [0.01, 0.03, 0.02, 0.06]
    Pf, pif = cal._chain(0.7, 0.5)
    Ps, pis = cal._chain(0.98, 0.97)
    P, pi = np.kron(Ps, Pf), np.kron(pis, pif)
    total = 0.0
    for seq in itertools.product(range(4), repeat=len(r)):
        prob, prev = 1.0, None
        for t, s in enumerate(seq):
            prob *= (pi @ P)[s] if prev is None else P[prev, s]
            prob *= math.exp(-0.5 * (r[t] / sds[s]) ** 2) / (sds[s] * math.sqrt(2 * math.pi))
            prev = s
        total += prob
    assert cal.loglik(r, sds, P, pi) == pytest.approx(math.log(total), rel=1e-10)


def _params(reg, base):
    """The script's own parameter vector for a pair of chains and a base daily vol."""
    logit = lambda x: math.log(x / (1 - x))                                     # noqa: E731
    return [math.log(base), math.log(reg.fast.ratio - 1), logit(reg.fast.stay_low), logit(reg.fast.stay_high),
            math.log(reg.slow.ratio - 1), logit(reg.slow.stay_low), logit(reg.slow.stay_high)]


def test_the_scripts_model_is_the_engines():
    """The four daily vols and the stationary mix the script builds from a parameter vector are the engine's two
    chains: the same levels after scaling, the same shares, the same total variance."""
    reg, sigma = REGIMES["BTC"], 0.514
    (calm, stressed), (low, high) = reg.fast.scales, reg.slow.scales
    base = sigma / math.sqrt(365.0) * calm * low
    sds, P, pi, fast, slow = cal._unpack(_params(reg, base))
    assert sds == pytest.approx([sigma / math.sqrt(365) * f * s for s in (low, high) for f in (calm, stressed)], rel=1e-12)
    assert fast == pytest.approx((reg.fast.ratio, reg.fast.stay_low, reg.fast.stay_high)) and slow == pytest.approx((reg.slow.ratio, reg.slow.stay_low, reg.slow.stay_high))
    assert float((pi * np.array(sds) ** 2).sum() * 365) == pytest.approx(sigma ** 2, rel=1e-12), "the variance on average is the vol's"
    assert pi.sum() == pytest.approx(1.0) and pi[1] + pi[3] == pytest.approx(reg.fast.high_share) and pi[2] + pi[3] == pytest.approx(reg.slow.high_share)
    # and ten days of the script's simulation have the tail ten days of the engine's clock have
    x = cal.simulate(sds, P, pi, 10, n=300_000, seed=5)
    ck = clock(reg, 300_000, 1, 10 / 365.0, seed=7)
    var = sigma ** 2 * (10 / 365.0) * step_variance(ck)[:, 0]
    y = -0.5 * var + np.sqrt(var) * np.random.default_rng(8).standard_normal(300_000)
    assert float(np.percentile(x, 1)) == pytest.approx(float(np.percentile(y, 1)), abs=0.004)
    assert float(x.var()) == pytest.approx(float(y.var()), rel=0.03)


def test_on_data_drawn_from_known_chains_the_truth_scores_highest():
    reg, sigma, n = REGIMES["ETH"], 0.70, 6000
    (calm, stressed), (low, high) = reg.fast.scales, reg.slow.scales
    rng = np.random.default_rng(11)
    r, states = np.empty(n), [rng.random() < reg.fast.high_share, rng.random() < reg.slow.high_share]
    for d in range(n):
        for i, c in enumerate((reg.fast, reg.slow)):
            u = rng.random()
            states[i] = (u < c.stay_high) if states[i] else (u >= c.stay_low)
        sd = sigma / math.sqrt(365) * (stressed if states[0] else calm) * (high if states[1] else low)
        r[d] = sd * rng.standard_normal()
    truth = _params(reg, sigma / math.sqrt(365) * calm * low)
    at_truth = -cal._two(truth, r)
    one_vol = -0.5 * n * (math.log(2 * math.pi * r.var()) + 1)
    assert at_truth > one_vol + 300, "regimes that are there are found: far above one vol"
    # the fast chain alone, at its own best base vol, falls short of both chains
    fast_only = max(-cal._one([math.log(b), truth[1], truth[2], truth[3]], r) for b in np.exp(np.linspace(math.log(0.012), math.log(0.04), 25)))
    assert at_truth > fast_only + 40
    # and moving any one parameter well off the truth lowers the likelihood
    for i, step in ((1, 0.6), (2, 1.0), (3, -1.0), (4, 0.8), (5, -1.5), (6, -1.5)):
        moved = list(truth)
        moved[i] += step
        assert -cal._two(moved, r) < at_truth - 3, f"parameter {i} moved by {step}"


def test_the_report_prints_the_line_to_paste(monkeypatch, capsys):
    """The report on a short series, with the fit itself stood in for (it takes minutes): the line it prints is a
    line pricing/vol_regimes.py can hold, and the tail table has its three periods."""
    reg = REGIMES["SOL"]
    sds, P, pi, fast, slow = cal._unpack(_params(reg, 0.02))
    monkeypatch.setattr(cal, "fit", lambda r: {"fast": fast, "slow": slow, "sds": sds, "P": P, "pi": pi, "ll": -1.0, "ll_fast_only": -2.0, "ll_one_vol": -3.0,
                                               "total_vol": math.sqrt(float((pi * np.array(sds) ** 2).sum()) * 365)})
    monkeypatch.setattr(cal, "simulate", lambda *a, **k: np.random.default_rng(1).standard_normal(5000) * 0.1)
    rng = np.random.default_rng(2)
    px = 100 * np.exp(np.cumsum(rng.standard_normal(400) * 0.04))
    closes = {f"2025-{1 + i // 31:02d}-{1 + i % 31:02d}x{i}": float(p) for i, p in enumerate(px)}
    cal.report("SOL", closes)
    out = capsys.readouterr().out
    line = next(ln for ln in out.splitlines() if ln.strip().startswith("paste:"))
    from pricing.vol_regimes import Chain, Regimes
    made = eval(line.split(":", 2)[2].strip().rstrip(","), {"Regimes": Regimes, "Chain": Chain})      # noqa: S307  (our own line, our own names)
    assert made.fast.ratio == pytest.approx(reg.fast.ratio, abs=0.005) and made.slow.stay_high == pytest.approx(reg.slow.stay_high, abs=5e-5) and made.days == 399
    assert all(f"{h:>2}-day 1st percentile" in out for h in (5, 10, 14))
