"""Rewrite the default quotes in frontend/src/data/ratesCurves.js with synthetic values.

The curves page ships with a default quote beside every instrument, shown until the API answers and to a desk
that has stored nothing. Until 0.55.0 those numbers were typed in during March 2026 and their origin was not
written down. They are now made, by this script, and nothing else writes them:

  * the five curves the hosted demo builds (market_data/synthetic_rates.PARAMS): that generator's curve on the
    day its parameters were set;
  * every other overnight curve: the same Nelson-Siegel shape with hand-set parameters below, no daily move;
  * a term-rate curve quoted in per cent: its base curve plus a fixed spread;
  * a basis or cross-currency curve quoted in basis points: a smooth schedule from a short-end to a long-end
    value set by hand below.

The tickers beside the quotes are labels for a desk that connects its own feed; no number comes from one.

    cd backend && python scripts/synthetic_rates_defaults.py            # rewrites the file in place
    cd backend && python scripts/synthetic_rates_defaults.py --check    # exits 1 if the file is not what this makes
"""
from __future__ import annotations

import math
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from market_data import synthetic_rates as R  # noqa: E402

TARGET = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / "ratesCurves.js"
ON = R.SET_ON

# overnight curves the demo does not build: (long end %, overnight less long end %, hump %, tau years), set by hand
OTHER_OIS = {
    "USD_EFFR":   (4.32, -0.45, -1.00, 2.0),
    "AUD_AONIA":  (4.55, -0.40, -0.70, 2.0),
    "CAD_CORRA":  (3.60, -0.85, -0.60, 2.5),
    "SEK_SWESTR": (2.75, -0.55, -0.50, 2.5),
    "NOK_NOWA":   (4.10, 0.35, -0.60, 2.0),
    "DKK_DESTR":  (2.75, -0.90, -0.50, 2.5),
    "NZD_NZIONA": (4.40, -1.10, -0.60, 2.0),
    "HKD_HONIA":  (3.90, -0.30, -0.80, 2.0),
    "SGD_SORA":   (2.70, -0.80, -0.40, 2.5),
}
# a term-rate curve quoted in per cent: basis points over its base curve
OVER_BASE_BP = {"USD_TSOFR_1M": 1.5, "USD_TSOFR_3M": 3.0, "USD_TSOFR_6M": 5.0}
# curves quoted in basis points: (short end, long end), reached as 1 - exp(-t / 4 years)
BP_SCHEDULE = {
    "USD_EFFR": (2.0, 6.0),                                  # the effective rate over the secured one, as a basis
    "USD_1M3M": (-1.5, -3.0), "USD_3M6M": (-2.5, -5.0),
    "XCCY_EURUSD": (-6.0, -14.0), "XCCY_GBPUSD": (-3.0, -9.0), "XCCY_JPYUSD": (-22.0, -48.0), "XCCY_CHFUSD": (-12.0, -28.0),
    "XCCY_AUDUSD": (6.0, 14.0), "XCCY_CADUSD": (-4.0, -10.0), "XCCY_SEKUSD": (-8.0, -14.0), "XCCY_NOKUSD": (-10.0, -16.0),
    "XCCY_NZDUSD": (8.0, 16.0), "XCCY_HKDUSD": (-6.0, -18.0), "XCCY_SGDUSD": (-10.0, -24.0), "XCCY_DKKUSD": (-12.0, -20.0),
}
FIXING_CURVE = {"SOFR": "USD_SOFR", "ESTR": "EUR_ESTR", "SONIA": "GBP_SONIA", "TONAR": "JPY_TONAR", "SARON": "CHF_SARON", "AONIA": "AUD_AONIA",
                "CORRA": "CAD_CORRA", "SWESTR": "SEK_SWESTR", "NOWA": "NOK_NOWA", "DESTR": "DKK_DESTR", "NZIONA": "NZD_NZIONA", "HONIA": "HKD_HONIA",
                "SORA": "SGD_SORA"}
HEADER = ("//  Every quote in this file is SYNTHETIC: made by backend/scripts/synthetic_rates_defaults.py from a stated\n"
          f"//  recipe (parameters set by hand on {ON.isoformat()}), not read from any feed. The tickers are labels for a desk\n"
          "//  that connects its own market data.\n")


def years(tenor: str) -> float:
    if tenor == "ON":
        return 1.0 / 365.0
    m = re.fullmatch(r"(\d+)([WMY])", tenor)
    n, u = int(m.group(1)), m.group(2)
    return n * {"W": 7.0 / 365.0, "M": 1.0 / 12.0, "Y": 1.0}[u]


def ois(curve: str, t: float) -> float:
    if curve in R.PARAMS:
        return R.par_rate(curve, ON, t)
    b0, b1, b2, tau = OTHER_OIS[curve]
    return R._ns(t, b0, b1, b2, tau)


def bp(curve: str, t: float) -> float:
    a, b = BP_SCHEDULE[curve]
    return a + (b - a) * (1.0 - math.exp(-t / 4.0))


def make(text: str) -> str:
    out, curve, base = [], None, None
    key_years = lambda k: years("ON" if k == "ON" else f"{k[1:]}{k[0]}")          # M3 -> 3M, Y10 -> 10Y, W1 -> 1W
    for line in text.split("\n"):
        m = re.search(r"\bid: '([A-Z0-9_]+)', ccy: ", line)
        if m:
            curve, base = m.group(1), None
        b = re.search(r"baseCurveId: '([A-Z0-9_]+)'", line)
        if b:
            base = b.group(1)
        q = re.search(r"tenor: '([A-Za-z0-9]+)'.*?quote:\s*(-?[0-9.]+),\s*unit: '(%|bp)'", line)
        if q and curve:
            t, unit = years(q.group(1)), q.group(3)
            if unit == "%":
                v = ois(curve, t) if (curve in R.PARAMS or curve in OTHER_OIS) else ois(base, t) + OVER_BASE_BP[curve] / 100.0
                new = f"{v:.3f}"
            else:
                new = f"{bp(curve, t):.1f}"
            line = line[:q.start(2)] + new + line[q.end(2):]
        if "oisRef: {" in line and base:
            line = re.sub(r"\b(ON|[WMY]\d+): -?[0-9.]+", lambda k, base=base: f"{k.group(1)}: {ois(base, key_years(k.group(1))):.3f}", line)
        f = re.search(r"\{ id: '([A-Z]+)',\s+name: .*latest: (-?[0-9.]+) \}", line)
        if f and f.group(1) in FIXING_CURVE:
            line = line[:f.start(2)] + f"{ois(FIXING_CURVE[f.group(1)], 1.0 / 365.0):.3f}" + line[f.end(2):]
        out.append(line)
    text = "\n".join(out)
    if HEADER not in text:
        marker = "//  RATES CURVE UNIVERSE\n"
        assert text.count(marker) == 1
        text = text.replace(marker, marker + HEADER)
    return text


if __name__ == "__main__":
    was = TARGET.read_text()
    now = make(was)
    if "--check" in sys.argv:
        sys.exit(0 if was == now else 1)
    TARGET.write_text(now)
    print(f"{TARGET.name}: {sum(a != b for a, b in zip(was.split(chr(10)), now.split(chr(10))))} lines changed")
