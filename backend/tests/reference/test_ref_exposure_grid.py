"""CVA of an uncollateralised forward against continuous time, by closed form: none of the engine's code, no random
numbers. The expected exposure of a forward dealt at K is a call's undiscounted value,
EE(t) = N e^{-r(T-t)} [F Φ(d1) − K Φ(d2)] with σ√t, and CVA = LGD ∫ EE(t) e^{-rt} h e^{-ht} dt, h = spread / LGD.

Emmy, 12 November 2026, on this case: the rule until 0.28.0 (monthly steps, the exposure at each step's end) reads
28 % high at one month and 20 % at three; the engine now (weekly steps, the exposure averaged across each step) reads
2.7 % and 1.7 % low. The averaged rule is a trapezoid, and on a profile that grows like √t a trapezoid reads low:
2.6 % at one month, 0.7 % at three, 0.1 % at a year, by the rule alone."""
import math

import numpy as np
import pytest

from pricing import fx_xva
from pricing.csa import CSA

N, F, SIGMA, R, CDS_BP, LGD = 10.0, 105_000.0, 0.55, 0.04, 85.0, 0.40
_phi = np.vectorize(lambda x: 0.5 * (1.0 + math.erf(x / math.sqrt(2.0))))


def _ee(t, T):
    sd = SIGMA * np.sqrt(t)
    d1 = 0.5 * sd                      # at the money forward: ln(F/K) = 0
    return N * np.exp(-R * (T - t)) * F * (_phi(d1) - _phi(d1 - sd))


def _continuous(T, n=20000):
    h = CDS_BP / 1e4 / LGD
    t = (np.arange(n) + 0.5) * T / n
    return -LGD * float(np.sum(_ee(t, T) * np.exp(-R * t) * h * np.exp(-h * t))) * T / n


def _step_end(T, steps):
    """The rule until 0.28.0, by the same closed form: the exposure at each step's end against the step's default."""
    h, dt = CDS_BP / 1e4 / LGD, T / steps
    t = np.arange(1, steps + 1) * dt
    return -LGD * float(np.sum(_ee(t, T) * (np.exp(-h * (t - dt)) - np.exp(-h * t)) * np.exp(-R * t)))


@pytest.mark.parametrize("T, monthly_steps, old_high", [(1.0 / 12, 2, 0.25), (0.25, 3, 0.17), (1.0, 12, 0.05)])
def test_cva_of_a_forward_against_continuous_time(T, monthly_steps, old_high):
    exact = _continuous(T)
    inp = fx_xva.ForwardXvaInput(pair="BTCUSD", base_notional=N, forward=F, strike=F, t_years=T, df_quote_t=math.exp(-R * T), quote_zero=R,
                                 direction="BUY", vol_pct=SIGMA * 100, spot=F, regimes=False)
    wf, meta = fx_xva.forward_xva(inp, CSA.uncollateralised(), n_paths=40000, cp_cds_bp=CDS_BP, lgd=LGD)
    assert meta["steps"] == max(2, math.ceil(52 * T))
    assert wf.cva == pytest.approx(exact, rel=0.04), (wf.cva, exact)
    assert exact < wf.cva < 0, "the trapezoid reads a concave profile low: the charge is a little under the continuous one"
    assert _step_end(T, monthly_steps) / exact - 1.0 > old_high, "what the rule until 0.28.0 read on its monthly steps"


def test_the_two_figures_the_documents_quote():
    assert _continuous(1.0 / 12) == pytest.approx(-31.249, abs=0.01) and _continuous(0.25) == pytest.approx(-160.751, abs=0.02)
    assert _step_end(1.0 / 12, 2) / _continuous(1.0 / 12) - 1.0 == pytest.approx(0.280, abs=0.005)
    assert _step_end(0.25, 3) / _continuous(0.25) - 1.0 == pytest.approx(0.197, abs=0.005)
