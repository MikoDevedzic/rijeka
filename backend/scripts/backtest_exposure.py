#!/usr/bin/env python3
"""backtest_exposure.py — does the level the exposure paths simulate cover what the level did? A backtest of a
digital asset's simulated moves against public daily closes, after the Basel Committee's "Sound practices for
backtesting counterparty credit risk models" (December 2010): forecast the distribution at a date, see where the
realised move fell in it, count how often it fell in the tails, over several horizons.

    python scripts/backtest_exposure.py                      # BTC, ETH, SOL: five years of Coinbase's public daily candles
    python scripts/backtest_exposure.py --closes file.json   # {"BTC": {"2021-11-12": 64900.0, ...}, ...}, no network
    python scripts/backtest_exposure.py --holdout 0.6        # also: regimes refitted on the first 60 %, tested on the rest
    python scripts/backtest_exposure.py --json out.json      # the table as data

What is tested. On every day of the history (after a warm-up) the model is given a vol and asked for the 1st, 5th,
95th and 99th percentile of the log move over the next h days; the move that followed is then counted as beyond
each or not. Two models: one vol (a lognormal level), and the engine's vol regimes (pricing/vol_regimes.py, the
clock the exposure paths use, drawn by the engine's own code). A forward's value is monotone in the level, so the
level's percentile is the trade's: the 14-day rows are the test of initial margin (the 99th percentile over a
ten-business-day margin period, each way) and the 95 % rows are the test of the PFE the ticket draws.

The vol the model is given is the realised vol of the 90 days before (the history of the implied vols a ticket
carries is not held): a stand-in, and the first limit of this evidence. The drift is the martingale's.

The band. Days overlap, and the vol is itself an estimate, so a binomial band would be wrong. Instead the same
procedure is run on histories simulated from the model itself (same length, same warm-up, same overlap): the band
is where 95 % of those counts fall. A count outside the band is one the model would rarely produce if it were true.

It reads public prices and writes nothing but what --json names. It is not run by the app.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np
from scipy.special import ndtr

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from pricing import vol_regimes as vr                                   # noqa: E402

HORIZONS = (5, 10, 14, 30, 91)            # days; a digital asset trades every day, so 14 days is ten business days
LEVELS = (0.01, 0.05, 0.95, 0.99)
WARM_UP = 90                              # days of history behind every vol the model is given
S_GRID = np.geomspace(0.004, 2.5, 70)     # the move's sd over the horizon (vol x sqrt(time)), where quantiles are tabulated


def clock_multipliers(reg, days: int, n: int = 20_000, seed: int = 11) -> np.ndarray:
    """The variance a horizon of `days` accumulates as a multiple of the ticket's, on the engine's own clock."""
    return vr.clock(reg, n, 1, days / 365.0, seed).u[:, 0]


def quantile_table(u) -> np.ndarray:
    """For each level and each sd on S_GRID, the model's quantile of the log move divided by the sd. Given the
    clock's multiplier U the move is normal with mean -s^2 U / 2 and variance s^2 U; `u` None is one vol (U = 1)."""
    u = np.ones(1) if u is None else np.sort(u)[:: max(1, len(u) // 2000)]
    out = np.zeros((len(LEVELS), len(S_GRID)))
    for j, s in enumerate(S_GRID):
        lo, hi = np.full(len(LEVELS), -12.0), np.full(len(LEVELS), 12.0)
        for _ in range(60):                                             # bisection on the mixture's distribution
            mid = 0.5 * (lo + hi)
            f = ndtr((mid[:, None] * s + 0.5 * s * s * u[None, :]) / (s * np.sqrt(u[None, :]))).mean(axis=1)
            below = f < np.array(LEVELS)
            lo, hi = np.where(below, mid, lo), np.where(below, hi, mid)
        out[:, j] = 0.5 * (lo + hi)
    return out


def trailing_vol(r: np.ndarray) -> np.ndarray:
    """vol[t]: the annualised realised vol of the WARM_UP daily returns before day t (zero mean)."""
    c = np.concatenate([[0.0], np.cumsum(r * r)])
    v = np.full(len(r) + 1, np.nan)
    v[WARM_UP:] = np.sqrt((c[WARM_UP:] - c[:-WARM_UP]) / WARM_UP * 365.0)
    return v


def exceedances(r: np.ndarray, h: int, table: np.ndarray, start: int = WARM_UP) -> tuple[np.ndarray, int]:
    """The share of days on which the h-day move that followed was below the model's 1st and 5th percentile and
    above its 95th and 99th. `r` is the daily log returns; day t's forecast uses the vol of the days before t."""
    cs = np.concatenate([[0.0], np.cumsum(r)])
    t = np.arange(max(start, WARM_UP), len(r) - h + 1)
    move = cs[t + h] - cs[t]
    s = trailing_vol(r)[t] * math.sqrt(h / 365.0)
    q = np.stack([np.interp(s, S_GRID, table[k]) for k in range(len(LEVELS))]) * s
    return np.array([(move < q[0]).mean(), (move < q[1]).mean(), (move > q[2]).mean(), (move > q[3]).mean()]), len(t)


def simulate_history(reg, vol: float, days: int, n: int, seed: int) -> np.ndarray:
    """`n` histories of daily log returns from the model itself: (n, days). `reg` None is one vol."""
    rng = np.random.default_rng([seed, 0x6274])
    var = np.full((n, days), vol * vol / 365.0)
    if reg is not None:
        var = var * vr.clock(reg, n, days, 1.0 / 365.0, seed).u
    return -0.5 * var + np.sqrt(var) * rng.standard_normal((n, days))


def backtest(r: np.ndarray, reg, sims: int = 500, start: int = WARM_UP, seed: int = 7) -> list[dict]:
    """Every horizon, both models: the history's exceedance shares and the band the model's own histories give."""
    vol = float(r.std() * math.sqrt(365.0))
    rows = []
    for name, model in (("one vol", None), ("regimes", reg)):
        sim = simulate_history(model, vol, len(r), sims, seed)
        for h in HORIZONS:
            table = quantile_table(None if model is None else clock_multipliers(model, h))
            got, n = exceedances(r, h, table, start)
            ref = np.array([exceedances(sim[i], h, table, start)[0] for i in range(sims)])
            lo, hi = np.percentile(ref, 2.5, axis=0), np.percentile(ref, 97.5, axis=0)
            rows.append({"model": name, "days": h, "n": n, "share": got.tolist(), "low": lo.tolist(), "high": hi.tolist(),
                         "inside": [bool(a <= g <= b) for g, a, b in zip(got, lo, hi)]})
    return rows


def show(asset: str, label: str, rows: list[dict], out=None) -> None:
    out = out or sys.stdout
    print(f"\n{asset} · {label}", file=out)
    print(f"  {'model':8} {'days':>4} {'n':>5}   " + "   ".join(f"{('below ' if a < 0.5 else 'above ') + format(a, '.0%'):>22}" for a in LEVELS), file=out)
    for x in rows:
        cells = [f"{g:6.2%} ({a:5.2%}-{b:5.2%}){' ' if ok else '*'}" for g, a, b, ok in zip(x["share"], x["low"], x["high"], x["inside"])]
        print(f"  {x['model']:8} {x['days']:>4} {x['n']:>5}   " + "   ".join(f"{c:>22}" for c in cells), file=out)


def outside(rows: list[dict]) -> dict[str, tuple[int, int]]:
    """Per model: how many of its cells (a horizon and a percentile) fall outside the band, of how many."""
    out: dict[str, tuple[int, int]] = {}
    for x in rows:
        a, b = out.get(x["model"], (0, 0))
        out[x["model"]] = (a + sum(not ok for ok in x["inside"]), b + len(x["inside"]))
    return out


def returns_of(closes: dict[str, float]) -> np.ndarray:
    return np.diff(np.log(np.array([closes[k] for k in sorted(closes)], dtype=float)))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--closes", help="read daily closes from this JSON file instead of fetching them")
    p.add_argument("--assets", default="BTC,ETH,SOL")
    p.add_argument("--holdout", type=float, help="also refit the regimes on this first share of the history and test on the rest")
    p.add_argument("--sims", type=int, default=500, help="histories simulated from the model for each band")
    p.add_argument("--json", help="write the table to this file")
    a = p.parse_args(argv)
    assets = [x.strip().upper() for x in a.assets.split(",") if x.strip()]
    from scripts import calibrate_vol_regimes as cal
    if a.closes:
        with open(a.closes) as f:
            data = json.load(f)
    else:
        data = {x: cal.fetch(x) for x in assets}
    result = {}
    for x in assets:
        r = returns_of(data[x])
        rows = backtest(r, vr.REGIMES[x], a.sims)
        show(x, f"{len(r)} daily returns to {sorted(data[x])[-1]}; regimes as the engine holds them (fitted on this history: in sample)", rows)
        result[x] = {"in_sample": rows}
        if a.holdout:
            k = int(len(r) * a.holdout)
            head = r[:k] - r[:k].mean()
            f = cal.fit(head)
            reg = vr.Regimes(fast=vr.Chain(*f["fast"]), slow=vr.Chain(*f["slow"]), as_of=sorted(data[x])[k], days=k)
            rows = backtest(r, reg, a.sims, start=k)
            show(x, f"regimes refitted on the first {k} days (to {reg.as_of}), tested on the {len(r) - k} after: out of sample", rows)
            result[x]["holdout"] = {"fitted_to": reg.as_of, "fast": list(f["fast"]), "slow": list(f["slow"]), "rows": rows}
    print("\n  share of days beyond the model's percentile (the band 95 % of the model's own histories fall in); * = outside the band")
    for part, pick in (("in sample", lambda v: v["in_sample"]), ("out of sample", lambda v: (v.get("holdout") or {}).get("rows"))):
        tally: dict[str, list[int]] = {}
        for v in result.values():
            for name, (bad, of) in outside(pick(v) or []).items():
                tally.setdefault(name, [0, 0])
                tally[name][0] += bad
                tally[name][1] += of
        if tally:
            print(f"  outside the band, {part}: " + "; ".join(f"{name} {bad} of {of} cells" for name, (bad, of) in tally.items())
                  + " (a band of 95 % leaves about one cell in twenty outside when the model is true; the cells are not independent)")
    if a.json:
        with open(a.json, "w") as f:
            json.dump(result, f, indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
