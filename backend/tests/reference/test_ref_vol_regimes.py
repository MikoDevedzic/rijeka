"""An independent derivation of a digital asset's vol regimes (pricing/vol_regimes.py), against the engine.

No library carries this model, so the reference is a second implementation. The simulation below was written by
the model validator on 12 November 2026 from the methodology's description alone (§9.3), sharing no code with
`pricing`: both chains redrawn every day from their long-run mix, the level stepped every day. It is kept as she
wrote it but for names and layout. Two things are held: the tails the methodology's table quotes, and the margin
the engine calls on a forward at its first monthly date, which runs the whole path (the clock, the level, the
bridge to the date a margin period earlier, the percentile)."""
import math

import numpy as np
import pytest

from pricing import fx_xva
from pricing.xva_engine import model_im

pytestmark = pytest.mark.usefixtures("monthly_steps")     # monthly steps, as these figures were worked (tests/conftest.py)

# BTC, as the methodology's table has it: (ratio, stay low, stay high) of the fast chain and of the slow one
FAST, SLOW = (2.62, 0.700, 0.512), (1.80, 0.9860, 0.9814)


def _chain(ratio, stay_low, stay_high):
    p = (1 - stay_low) / (2 - stay_low - stay_high)
    low = 1 / math.sqrt(1 - p + p * ratio * ratio)
    return p, low, low * ratio, stay_low, stay_high


def _log_moves(rng, days, n, sigma, checkpoints=(), regimes=True):
    """ln M after `days`, and at each checkpoint day, with both regimes redrawn daily (or on one vol)."""
    F, S = _chain(*FAST), _chain(*SLOW)
    x, seen = np.zeros(n), {}
    fast, slow = rng.random(n) < F[0], rng.random(n) < S[0]
    for d in range(1, days + 1):
        fast = np.where(fast, rng.random(n) < F[4], rng.random(n) >= F[3])
        slow = np.where(slow, rng.random(n) < S[4], rng.random(n) >= S[3])
        v = (sigma * (np.where(fast, F[2], F[1]) * np.where(slow, S[2], S[1]) if regimes else 1.0)) ** 2 / 365
        x += -0.5 * v + np.sqrt(v) * rng.standard_normal(n)
        if d in checkpoints:
            seen[d] = x.copy()
    return x, seen


@pytest.mark.parametrize("days, tail, beyond", [(5, -0.162, None), (10, -0.226, -0.274), (14, -0.267, None)])
def test_the_tails_the_methodology_quotes(days, tail, beyond):
    x, _ = _log_moves(np.random.default_rng(11), days, 400_000, 0.514)
    q = float(np.percentile(x, 1))
    assert q == pytest.approx(tail, abs=0.004)
    if beyond is not None:
        assert float(x[x <= q].mean()) == pytest.approx(beyond, abs=0.005)
    assert abs(float(np.mean(np.exp(x))) - 1.0) < 0.002, "the level is a martingale"


def test_the_margin_the_engine_calls_at_the_first_date():
    """Bought 10 BTC forward at the money, 55 % vol, six months, a margin period of 14 days: the 99th percentile
    rise of the value from day 16 to day 30, about its mean. The validator's figure on 400,000 paths was 330,520
    with the regimes and 300,640 on one vol (a ratio of 1.099); the engine's, on three seeds, 328,170 to 333,698."""
    n, sigma, f0, zero, T = 400_000, 0.55, 108465.61, 0.038, 180 / 365
    value = lambda ln_m, day: 10 * (f0 * np.exp(ln_m) - f0) * math.exp(-zero * (T - day / 365))      # noqa: E731

    def called(regimes, seed):
        _, seen = _log_moves(np.random.default_rng(seed), 30, n, sigma, checkpoints=(16, 30), regimes=regimes)
        move = value(seen[30], 30) - value(seen[16], 16)
        return float(np.percentile(move - move.mean(), 99))
    reference, one_vol = called(True, 7), called(False, 8)
    inp = fx_xva.ForwardXvaInput(pair="BTCUSD", base_notional=10, forward=f0, strike=f0, t_years=T, df_quote_t=math.exp(-zero * T), quote_zero=zero,
                                 direction="BUY", vol_pct=55)
    noise = {}
    paths, _, _ = fx_xva.simulate_paths(inp, n_paths=200_000, seed=42, noise_out=noise)
    call, _ = model_im(paths, noise["lag"](14 / 365, np.random.default_rng(43)))
    assert call[0] == pytest.approx(reference, rel=0.03), (call[0], reference)
    assert 1.06 < reference / one_vol < 1.14, "and the regimes raise it over one vol by about a tenth"
    inp.regimes = False
    paths1, _, _ = fx_xva.simulate_paths(inp, n_paths=200_000, seed=42, noise_out=noise)
    call1, _ = model_im(paths1, noise["lag"](14 / 365, np.random.default_rng(43)))
    assert call1[0] == pytest.approx(one_vol, rel=0.02), "on one vol the two agree more closely still"
