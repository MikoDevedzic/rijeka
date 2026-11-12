"""An independent derivation of the MVA of a margined digital-asset forward, against the engine.

No library prices an initial margin that is the model's own percentile, so the reference is a second
implementation. The simulation below was written by the model validator on 12 November 2026 from docs/xva.md (§2,
§5b, §7 and §8b) alone, sharing no code with `pricing`; it is kept as she wrote it but for names and layout. It
runs the whole chain a ticket's MVA depends on: the weekly grid, the level (on one vol, and on the regimes' clock
with both chains redrawn inside every step), the value a margin period earlier (today's before the first margin
period has passed), the 99th percentile about the mean, and the funding of that margin to each step's end.

The trade: long 10 BTC three months forward at the forward (worth nothing today), spot 100,000, 55 % vol, USD at
4 %, no carry on the coin, a bilateral CSA with a ten-business-day margin period (10/250 of a year), initial margin
exchanged, the funding spread the engine defaults to (55 bp). Her figures on 12 November 2026, with the engine's
over eight seeds of 40,000 paths: one vol -326.78 against -326.17 (0.19 %), regimes -356.95 against -356.66
(0.08 %); the margin at the first date 165,277 against 165,081 and 185,715 against 185,562."""
import math

import numpy as np
import pytest

from pricing import fx_xva
from pricing.csa import CSA

R, T, N, SPOT, SIGMA = 0.04, 0.25, 10.0, 100_000.0, 0.55
FWD = SPOT * math.exp(R * T)
DELTA, FTP = 10 / 250, 0.0055
STEPS, SUB = 13, 7                                  # thirteen weekly steps, seven sub-steps (days) in each
DT = T / STEPS
H = DT / SUB
FAST, SLOW = (2.62, 0.700, 0.512), (1.80, 0.9860, 0.9814)     # BTC: (ratio, stay low, stay high), as §8b has them


def _d(t):                                          # the discount from t to the forward's date
    return math.exp(-R * (T - t))


def _mva(im):
    return -sum(im[i] * FTP * DT * math.exp(-R * (i + 1) * DT) for i in range(STEPS))


def _margin(move):
    move = move - move.mean()
    return max(np.percentile(-move, 99), 0.0)


def _one_vol(rng, n):
    """The margin at every grid date on one vol: the level drawn exactly at the date and a margin period before."""
    im = []
    for i in range(1, STEPS + 1):
        t = i * DT
        t_lag = max(t - DELTA, 0.0)
        gap = t - t_lag
        m_lag = np.exp(-0.5 * SIGMA ** 2 * t_lag + SIGMA * math.sqrt(t_lag) * rng.standard_normal(n))
        m_now = m_lag * np.exp(-0.5 * SIGMA ** 2 * gap + SIGMA * math.sqrt(gap) * rng.standard_normal(n))
        im.append(_margin(N * FWD * ((m_now - 1) * _d(t) - (m_lag - 1) * _d(t_lag))))
    return im


def _chain(ratio, stay_low, stay_high):
    p = (1 - stay_low) / (2 - stay_low - stay_high)
    low = 1 / math.sqrt(1 - p + p * ratio * ratio)
    return p, low, low * ratio, stay_low + stay_high - 1


def _regimes(rng, n):
    """The same on the regimes: two chains stepped every sub-step from their long-run mix, the level stepped on
    the variance they make, the lagged level drawn inside its sub-step by a bridge on that sub-step's variance."""
    n_sub = STEPS * SUB
    days = H * 365
    mult = np.ones((n, n_sub))
    for c in (FAST, SLOW):
        p, low, high, memory = _chain(*c)
        mem = memory ** days
        stay_low, stay_high = (1 - p) + p * mem, p + (1 - p) * mem
        state = rng.random(n) < p
        cols = []
        for _ in range(n_sub):
            u = rng.random(n)
            state = np.where(state, u < stay_high, u >= stay_low)
            cols.append(np.where(state, high, low))
        mult *= np.array(cols).T
    var = SIGMA ** 2 * H * mult ** 2
    ln_m = np.zeros((n, n_sub + 1))
    ln_m[:, 1:] = np.cumsum(-0.5 * var + np.sqrt(var) * rng.standard_normal((n, n_sub)), axis=1)
    lag_sub = DELTA / H
    im = []
    for i in range(1, STEPS + 1):
        pos, t, lp = i * SUB, i * DT, i * SUB - lag_sub
        if lp <= 0:
            m_lag, t_lag = np.ones(n), 0.0
        else:
            a = int(math.floor(lp))
            w = lp - a
            ln_lag = ln_m[:, a] if w < 1e-12 else (ln_m[:, a] + w * (ln_m[:, a + 1] - ln_m[:, a])
                                                    + rng.standard_normal(n) * np.sqrt(var[:, a] * w * (1 - w)))
            m_lag, t_lag = np.exp(ln_lag), lp * H
        im.append(_margin(N * FWD * ((np.exp(ln_m[:, pos]) - 1) * _d(t) - (m_lag - 1) * _d(t_lag))))
    return im


def _engine(regimes, seeds=(1, 2, 3)):
    out = []
    for seed in seeds:
        inp = fx_xva.ForwardXvaInput(pair="BTCUSD", base_notional=N, forward=FWD, strike=FWD, t_years=T, df_quote_t=math.exp(-R * T),
                                     quote_zero=R, direction="BUY", vol_pct=SIGMA * 100, spot=SPOT, regimes=regimes)
        wf, meta = fx_xva.forward_xva(inp, CSA.bilateral(), n_paths=40_000, seed=seed)
        assert meta["steps"] == STEPS
        out.append((wf.mva, wf.im_0))
    return np.mean(out, axis=0)


@pytest.mark.parametrize("regimes, hers", [(False, -326.78), (True, -356.95)])
def test_the_mva_of_a_margined_forward_is_the_validators(regimes, hers):
    rng = np.random.default_rng(2024)
    im = _regimes(rng, 300_000) if regimes else _one_vol(rng, 600_000)
    mine = _mva(im)
    assert mine == pytest.approx(hers, rel=0.004)                       # the derivation still gives the figure she reported
    mva, im_0 = _engine(regimes)
    assert mva == pytest.approx(mine, rel=0.008), "the engine's MVA against the independent derivation"
    assert im_0 == pytest.approx(im[0], rel=0.012), "the margin at the first date"


def test_the_regimes_raise_the_margin_and_the_mva_by_what_the_methodology_says():
    (one, one_im), (reg, reg_im) = _engine(False), _engine(True)
    assert 1.07 < reg_im / one_im < 1.13                                # the margin at the first date: 7 to 13 % larger
    assert 1.02 < reg / one < 1.10                                      # MVA: 2 to 10 % higher (9.3 % on this ticket)
