#!/usr/bin/env python3
"""calibrate_vol_regimes.py — fit a digital asset's vol regimes (pricing/vol_regimes.py) to public daily closes.

    python scripts/calibrate_vol_regimes.py                    # BTC, ETH, SOL: five years of Coinbase's public daily candles
    python scripts/calibrate_vol_regimes.py --closes file.json # {"BTC": {"2021-11-12": 64900.0, ...}, ...}, no network
    python scripts/calibrate_vol_regimes.py --save file.json   # keep what was fetched

The model: a day's vol is base × fast × slow, where fast and slow are two independent two-state Markov chains (a
stress that lasts days, and a level that lasts weeks). Fitted by maximum likelihood with Hamilton's filter. It
prints, per asset: the lines to paste into pricing/vol_regimes.py; the likelihood against one vol and against the
fast chain alone; and the 1st percentile of a 5-, 10- and 14-day log move (and the mean move beyond it) for the
history, the fit and a Gaussian of the same vol, with the sampling band of the history's own figure (a block
bootstrap), so the reader can see what five years can and cannot tell apart.

It reads public prices and writes nothing but what --save names. It is not run by the app: the fitted values are
dated constants in the code, and a refit is a reviewed change.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.request
from datetime import date, timedelta

import numpy as np
from scipy.optimize import minimize

CANDLES = "https://api.exchange.coinbase.com/products/{a}-USD/candles?granularity=86400&start={s}T00:00:00Z&end={e}T00:00:00Z"


def fetch(asset: str, years: float = 5.0) -> dict[str, float]:
    end = date.today()
    a, out = end - timedelta(days=int(365.25 * years)), {}
    while a < end:
        b = min(a + timedelta(days=290), end)
        req = urllib.request.Request(CANDLES.format(a=asset, s=a.isoformat(), e=b.isoformat()), headers={"User-Agent": "rijeka-calibration"})
        with urllib.request.urlopen(req, timeout=30) as r:
            for row in json.load(r):
                out[time.strftime("%Y-%m-%d", time.gmtime(row[0]))] = float(row[4])
        a = b
        time.sleep(0.35)
    return dict(sorted(out.items()))


def _sig(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _chain(stay_low: float, stay_high: float):
    P = np.array([[stay_low, 1.0 - stay_low], [1.0 - stay_high, stay_high]])
    high = (1.0 - stay_low) / (2.0 - stay_low - stay_high)
    return P, np.array([1.0 - high, high])


def loglik(r: np.ndarray, sds, P: np.ndarray, pi: np.ndarray) -> float:
    """Hamilton's filter: the log-likelihood of the returns under a hidden chain with one Gaussian per state."""
    d = np.stack([np.exp(-0.5 * (r / s) ** 2) / (s * math.sqrt(2.0 * math.pi)) for s in sds], axis=1)
    a, ll = pi.copy(), 0.0
    for t in range(len(r)):
        f = (a @ P) * d[t]
        c = f.sum()
        ll += math.log(max(c, 1e-300))
        a = f / c
    return ll


def _one(p, r):
    P, pi = _chain(_sig(p[2]), _sig(p[3]))
    s = math.exp(p[0])
    return -loglik(r, [s, s * (1.0 + math.exp(p[1]))], P, pi)


def _unpack(p):
    s = math.exp(p[0])
    kf, ks = 1.0 + math.exp(p[1]), 1.0 + math.exp(p[4])
    Pf, pif = _chain(_sig(p[2]), _sig(p[3]))
    Ps, pis = _chain(_sig(p[5]), _sig(p[6]))
    return [s, s * kf, s * ks, s * kf * ks], np.kron(Ps, Pf), np.kron(pis, pif), (kf, _sig(p[2]), _sig(p[3])), (ks, _sig(p[5]), _sig(p[6]))


def _two(p, r):
    sds, P, pi, _, _ = _unpack(p)
    return -loglik(r, sds, P, pi)


def fit(r: np.ndarray) -> dict:
    """The fast chain alone, then fast × slow started from it. Returns the parameters and the three likelihoods."""
    nm = dict(method="Nelder-Mead", options={"maxiter": 8000, "xatol": 1e-6, "fatol": 1e-8})
    one = min((minimize(_one, [math.log(r.std() * 0.6), math.log(k), 2.0, 1.0], args=(r,), **nm) for k in (0.8, 2.0)), key=lambda z: z.fun)
    best = None
    for slow in ((4.0, 4.0), (5.0, 3.5), (3.0, 3.0)):
        x0 = [one.x[0] - 0.15, one.x[1], one.x[2], one.x[3], math.log(0.5), slow[0], slow[1]]
        res = minimize(_two, x0, args=(r,), **nm)
        if best is None or res.fun < best.fun:
            best = res
    sds, P, pi, fast, slow = _unpack(best.x)
    if 1.0 / (1.0 - fast[2]) > 1.0 / (1.0 - slow[2]):          # name them by how long the high state lasts
        fast, slow = slow, fast
    n = len(r)
    return {"fast": fast, "slow": slow, "sds": sds, "P": P, "pi": pi, "ll": -best.fun, "ll_fast_only": -one.fun,
            "ll_one_vol": -0.5 * n * (math.log(2.0 * math.pi * r.var()) + 1.0),
            "total_vol": math.sqrt(float((pi * np.array(sds) ** 2).sum()) * 365.0)}


def simulate(sds, P, pi, days: int, n: int = 300_000, seed: int = 5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    cum, sds = np.cumsum(P, axis=1), np.array(sds)
    st = np.searchsorted(np.cumsum(pi), rng.random(n)).clip(0, len(sds) - 1)
    x = np.zeros(n)
    for _ in range(days):
        st = (rng.random(n)[:, None] > cum[st]).sum(axis=1).clip(0, len(sds) - 1)
        sd = sds[st]
        x += -0.5 * sd * sd + sd * rng.standard_normal(n)
    return x


def _tail(v: np.ndarray) -> tuple[float, float]:
    q = float(np.percentile(v, 1))
    return q, float(v[v <= q].mean())


def report(asset: str, closes: dict[str, float], out=None) -> dict:
    out = out or sys.stdout
    px = np.array(list(closes.values()))
    r = np.diff(np.log(px))
    r = r - r.mean()
    n, last = len(r), list(closes)[-1]
    f = fit(r)
    (kf, af, bf), (ks, as_, bs) = f["fast"], f["slow"]
    print(f"\n{asset}: {n} daily returns to {last}; sample vol {r.std() * math.sqrt(365):.1%}, the fit's {f['total_vol']:.1%}", file=out)
    print(f"  log-likelihood: one vol {f['ll_one_vol']:.1f}; the fast chain alone {f['ll_fast_only']:.1f} (+{f['ll_fast_only'] - f['ll_one_vol']:.1f}); "
          f"fast x slow {f['ll']:.1f} (+{f['ll'] - f['ll_fast_only']:.1f} for three more parameters, in-sample; a regular chi-squared bar is about 4 at 5 %, the true one higher: the slow chain is not identified at ratio 1)", file=out)
    print(f"  fast: stressed vol {kf:.2f} x calm; a calm spell {1 / (1 - af):.1f} days, a stressed one {1 / (1 - bf):.1f}", file=out)
    print(f"  slow: high vol {ks:.2f} x low; a low spell {1 / (1 - as_):.0f} days, a high one {1 / (1 - bs):.0f}", file=out)
    print(f'  paste:    "{asset}": Regimes(fast=Chain(ratio={kf:.2f}, stay_low={af:.3f}, stay_high={bf:.3f}), '
          f'slow=Chain(ratio={ks:.2f}, stay_low={as_:.4f}, stay_high={bs:.4f}), as_of="{last}", days={n}),', file=out)
    rng = np.random.default_rng(3)
    for h in (5, 10, 14):
        hist = np.log(px[h:] / px[:-h])
        hq, he = _tail(hist)
        mq, me = _tail(simulate(f["sds"], f["P"], f["pi"], h))
        g = 2.326 * f["total_vol"] * math.sqrt(h / 365.0)
        band = []
        for _ in range(300):                       # the history's own sampling error: blocks of 60 days, redrawn
            idx = np.concatenate([np.arange(s, s + 60) % n for s in rng.integers(0, n, n // 60 + 1)])[:n]
            cs = np.concatenate([[0.0], np.cumsum(r[idx])])
            band.append(np.percentile(cs[h:] - cs[:-h], 1))
        print(f"  {h:>2}-day 1st percentile: history {hq:+.3f} (its band {np.percentile(band, 5):+.3f} to {np.percentile(band, 95):+.3f}) | fit {mq:+.3f} | Gaussian {-g:+.3f}"
              f"      mean beyond it: history {he:+.3f} | fit {me:+.3f} | Gaussian {-g * 1.146:+.3f}", file=out)
    return f


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--closes", help="read daily closes from this JSON file instead of fetching them")
    p.add_argument("--save", help="write the closes that were read to this JSON file")
    p.add_argument("--assets", default="BTC,ETH,SOL")
    a = p.parse_args(argv)
    assets = [x.strip().upper() for x in a.assets.split(",") if x.strip()]
    if a.closes:
        with open(a.closes) as f:
            data = json.load(f)
    else:
        data = {x: fetch(x) for x in assets}
    if a.save:
        with open(a.save, "w") as f:
            json.dump(data, f)
    for x in assets:
        report(x, data[x])
    return 0


if __name__ == "__main__":
    sys.exit(main())
