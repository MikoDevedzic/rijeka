"""A digital asset's vol regimes: a stress that lasts days, on a level that lasts weeks.

A digital asset's daily returns are not draws from one bell curve. Violent days come together and pass in two or
three days; and under that, the whole level of activity is higher for a couple of months and then lower for a
couple of months. A single vol reads the moves over a margin period too small, which is where collateral and
initial margin are measured. Here a day's vol is

    sigma_day = sigma * fast * slow

where `fast` and `slow` are two independent two-state Markov chains (calm or stressed; low or high), each scaled
so that its squared multiplier averages one.

What the regimes change is the CLOCK, not the level's law given the clock. Over a step the level is still
lognormal given the variance the step accumulated; the regimes make that variance random. Because each chain's
squared multiplier averages one, the variance expected over any period is exactly the vol the ticket carries (the
surface's, or the desk's): today's price of a forward or an option is untouched, and the vol typed on the ticket
still means what it says. What moves is the spread of outcomes over days and weeks: more mass in the tails, as the
history has.

    low  = 1 / sqrt(1 - p + p * ratio^2)      p = the share of days in the high state
    high = low * ratio                          = (1 - stay_low) / (2 - stay_low - stay_high)

The parameters are a ratio and two daily probabilities per chain and asset, fitted by maximum likelihood
(Hamilton's filter) to public daily closes by backend/scripts/calibrate_vol_regimes.py, which also prints the tails
the fit implies against the history's own and its sampling band. They are dated constants: a refit is a change to
this file, reviewed like any other.

What was tried and not kept, on the same closes. Jumps (Merton, by maximum likelihood): the fit puts about 230
small jumps a year on BTC, which is the day-to-day clustering read as jumps; being independent from day to day they
average out, and the ten-day tail comes out within a point of a Gaussian's. The fast chain alone: a better fit to
the days than jumps, but its stress is over in two or three days and the ten-day tail is still thin. Adding the
slow chain raises the log-likelihood by 36 to 41 on each asset for three more parameters, and puts the 5-, 10- and
14-day tails close to the history's.

Today's regime is not read: each path starts in each state with its long-run share. The vol on the ticket is taken
as the average over the trade's life, not as the vol of today's state.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

SUB_STEP_DAYS = 1.0            # the chains are stepped about once a day inside a grid step


@dataclass(frozen=True)
class Chain:
    """Two states, low and high. `ratio` is the high vol over the low; the two probabilities are of a day in a
    state being followed by a day in the same state."""
    ratio: float
    stay_low: float
    stay_high: float

    def __post_init__(self):
        if not (self.ratio >= 1.0 and 0.0 < self.stay_low < 1.0 and 0.0 < self.stay_high < 1.0):
            raise ValueError("a chain's ratio is at least 1 and both probabilities are strictly between 0 and 1")
        if self.stay_low + self.stay_high <= 1.0:
            raise ValueError("a day's state must make the next day's likelier (stay_low + stay_high > 1)")

    @property
    def high_share(self) -> float:
        """The share of days in the high state, in the long run."""
        return (1.0 - self.stay_low) / (2.0 - self.stay_low - self.stay_high)

    @property
    def scales(self) -> tuple[float, float]:
        """(low, high) as multiples of the vol; their squares average to one."""
        p = self.high_share
        low = 1.0 / math.sqrt(1.0 - p + p * self.ratio ** 2)
        return low, low * self.ratio

    def stay(self, days: float) -> tuple[float, float]:
        """The two probabilities of staying put over `days` (any positive length, not only whole days): the chain
        that agrees with the daily one at every whole day."""
        p = self.high_share
        memory = (self.stay_low + self.stay_high - 1.0) ** days
        return (1.0 - p) + p * memory, p + (1.0 - p) * memory

    @property
    def spells(self) -> tuple[float, float]:
        """How long a low spell and a high spell last on average, in days."""
        return 1.0 / (1.0 - self.stay_low), 1.0 / (1.0 - self.stay_high)


@dataclass(frozen=True)
class Regimes:
    fast: Chain                # calm or stressed: days
    slow: Chain                # low or high: weeks
    as_of: str                 # the last close the fit read
    days: int                  # how many daily returns it read

    def describe(self, vol_pct: float) -> dict:
        (calm, stressed), (low, high) = self.fast.scales, self.slow.scales
        return {"lowest_vol_pct": round(vol_pct * calm * low, 1), "highest_vol_pct": round(vol_pct * stressed * high, 1),
                "fast": {"ratio": self.fast.ratio, "stressed_share_pct": round(self.fast.high_share * 100, 1),
                         "calm_spell_days": round(self.fast.spells[0], 1), "stressed_spell_days": round(self.fast.spells[1], 1)},
                "slow": {"ratio": self.slow.ratio, "high_share_pct": round(self.slow.high_share * 100, 1),
                         "low_spell_days": round(self.slow.spells[0]), "high_spell_days": round(self.slow.spells[1])},
                "as_of": self.as_of, "days": self.days,
                "source": "maximum likelihood on public daily closes (backend/scripts/calibrate_vol_regimes.py)"}


# Fitted on 11 November 2026 to five years of daily closes (Coinbase's public candles, the source risk/history.py
# reads). The script prints these lines; a refit replaces them.
REGIMES: dict[str, Regimes] = {
    "BTC": Regimes(fast=Chain(ratio=2.62, stay_low=0.700, stay_high=0.512), slow=Chain(ratio=1.80, stay_low=0.9860, stay_high=0.9814), as_of="2026-11-11", days=1826),
    "ETH": Regimes(fast=Chain(ratio=2.58, stay_low=0.706, stay_high=0.611), slow=Chain(ratio=1.91, stay_low=0.9780, stay_high=0.9781), as_of="2026-11-11", days=1826),
    "SOL": Regimes(fast=Chain(ratio=2.59, stay_low=0.973, stay_high=0.658), slow=Chain(ratio=1.77, stay_low=0.9785, stay_high=0.9786), as_of="2026-11-11", days=1826),
}


def regimes_of(pair: str) -> Optional[Regimes]:
    """The regimes of the pair's base asset; None for a currency pair or an asset that has not been fitted (those
    keep one vol)."""
    return REGIMES.get(str(pair)[:3].upper())


def clock(reg: Regimes, n_paths: int, steps: int, dt: float, seed: int) -> np.ndarray:
    """The variance clock: for every path, grid step and sub-step inside it, the day's variance as a multiple of
    the ticket's (fast^2 * slow^2: one of four values), shape (n_paths, steps, n_sub), float32. Each path starts in
    each state with its long-run share, since today's regime is not read. Drawn from a generator of its own
    (seeded from `seed`) so that the level's own standard normals are the ones a run without regimes would draw."""
    n_sub = max(1, int(round(dt * 365.0 / SUB_STEP_DAYS)))
    rng = np.random.default_rng([int(seed), 0x7265676D])
    out = np.ones((n_paths, steps, n_sub), dtype=np.float32)
    for chain in (reg.fast, reg.slow):
        stay_low, stay_high = chain.stay(dt * 365.0 / n_sub)
        low, high = chain.scales
        state = rng.random(n_paths) < chain.high_share
        for k in range(steps):
            u = rng.random((n_paths, n_sub))
            for s in range(n_sub):
                state = np.where(state, u[:, s] < stay_high, u[:, s] >= stay_low)
                out[:, k, s] *= np.where(state, high * high, low * low).astype(np.float32)
    return out


def step_variance(ck: np.ndarray) -> np.ndarray:
    """The variance each grid step accumulated, as a multiple of the ticket's: (n_paths, steps), mean one."""
    return ck.mean(axis=2, dtype=np.float64)


def share_before(ck: np.ndarray, step: int, w: float) -> np.ndarray:
    """Of the variance the step accumulated on each path, the share that came in the first `w` of its time
    (0 <= w <= 1): what the fraction of the step's time becomes on the variance clock."""
    n_sub = ck.shape[2]
    x = min(max(w, 0.0), 1.0) * n_sub
    whole = int(math.floor(x + 1e-12))
    part = ck[:, step, :whole].sum(axis=1, dtype=np.float64)
    if whole < n_sub and x - whole > 1e-12:
        part = part + (x - whole) * ck[:, step, whole].astype(np.float64)
    return part / ck[:, step, :].sum(axis=1, dtype=np.float64)
