"""Shared test vectors for the browser's copies of three calculations: forward points between quoted tenors
(api/routes/currencies.interp_points), the settlement amount of a forward, a call and a put
(settlement/rule.settlement_amount), and the vol read off a pair's ATM/RR25/BF25 surface (pricing/fx_vol:
parse_surface, _interp, smile_vol, vol_at, with pricing/fx_option.forward_delta inside the fixed point).
tests/vectors/fx_scenario.json is generated FROM those functions; this test regenerates it and fails when the
file is out of date, and the frontend reads the same file in its own tests (fx-scenario.test.js, fx-vol.test.js),
so the two implementations cannot drift apart unnoticed.

    RIJEKA_UPDATE_VECTORS=1 python -m pytest -q tests/test_fx_scenario_vectors.py     # after a deliberate change

The inputs are made up; none is a market's."""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

VECTORS = Path(__file__).parent / "vectors" / "fx_scenario.json"

CURVES = {
    "every tenor": {"1W": 12.5, "2W": 26.0, "1M": 58.25, "2M": 121.0, "3M": 190.5, "6M": 402.75, "9M": 640.0, "1Y": 905.5, "2Y": 2010.0},
    "three tenors, negative points": {"1M": -4.5, "3M": -13.25, "1Y": -61.0},
    "overnight and a week": {"ON": 0.35, "1W": 2.4},
}
DAYS = {
    "every tenor": [-3, 0, 3, 7, 10, 14, 20, 30, 45, 61, 75, 91, 120, 182, 200, 273, 300, 365, 500, 730, 900],
    "three tenors, negative points": [0, 15, 30, 60, 91, 200, 365, 400],
    "overnight and a week": [1, 4, 7],
}
AMOUNTS = [  # kind, direction, notional, strike, fixing
    ("FORWARD", "BUY", 10, 100_000.0, 104_250.0), ("FORWARD", "SELL", 10, 100_000.0, 104_250.0), ("FORWARD", "BUY", 2.5, 3_800.0, 3_650.5),
    ("FORWARD", "SELL", 250, 182.0, 182.0),
    ("CALL", "BUY", 10, 100_000.0, 104_250.0), ("CALL", "SELL", 10, 100_000.0, 104_250.0), ("CALL", "BUY", 10, 100_000.0, 96_000.0),
    ("CALL", "BUY", 1.25, 3_800.0, 3_800.0),
    ("PUT", "BUY", 10, 100_000.0, 94_000.0), ("PUT", "SELL", 10, 100_000.0, 94_000.0), ("PUT", "BUY", 40, 182.0, 190.75),
]

# Vol surfaces in vol points, the shape GET /api/currency/pairs sends as vol_surface.grid. Made up, like the rest.
SURFACES = {
    "eight tenors": {
        "1W": {"ATM": 7.9, "RR25": -0.15, "BF25": 0.12}, "1M": {"ATM": 7.2, "RR25": -0.35, "BF25": 0.2}, "2M": {"ATM": 7.35, "RR25": -0.45, "BF25": 0.23},
        "3M": {"ATM": 7.5, "RR25": -0.55, "BF25": 0.26}, "6M": {"ATM": 7.8, "RR25": -0.7, "BF25": 0.31}, "9M": {"ATM": 7.95, "RR25": -0.8, "BF25": 0.34},
        "1Y": {"ATM": 8.1, "RR25": -0.9, "BF25": 0.37}, "2Y": {"ATM": 8.4, "RR25": -1.0, "BF25": 0.42}},
    "ten tenors with 2W and 3W": {
        "1W": {"ATM": 46.5, "RR25": -3.1, "BF25": 1.4}, "2W": {"ATM": 48.25, "RR25": -2.6, "BF25": 1.55}, "3W": {"ATM": 49.0, "RR25": -2.2, "BF25": 1.6},
        "1M": {"ATM": 50.5, "RR25": -1.8, "BF25": 1.75}, "2M": {"ATM": 52.0, "RR25": -0.9, "BF25": 2.05}, "3M": {"ATM": 53.5, "RR25": 0.4, "BF25": 2.3},
        "6M": {"ATM": 56.0, "RR25": 1.9, "BF25": 2.8}, "9M": {"ATM": 57.5, "RR25": 2.7, "BF25": 3.1}, "1Y": {"ATM": 58.5, "RR25": 3.2, "BF25": 3.3},
        "2Y": {"ATM": 60.0, "RR25": 3.6, "BF25": 3.5}},
    # 1W and 3M quote an ATM alone; 6M a risk reversal and no butterfly; 2M has no ATM and 10Y is not a tenor the surface knows
    "ATM-only tenors mixed in": {
        "1W": {"ATM": 11.0}, "1M": {"ATM": 10.0, "RR25": 1.2, "BF25": 0.3}, "2M": {"RR25": 9.0, "BF25": 9.0}, "3M": {"ATM": 9.5},
        "6M": {"ATM": 9.75, "RR25": 0.6}, "1Y": {"ATM": 10.25, "RR25": 0.2, "BF25": 0.5}, "10Y": {"ATM": 30.0, "RR25": 5.0, "BF25": 5.0}},
    "ATM only": {"1M": {"ATM": 9.0}, "3M": {"ATM": 9.6}, "1Y": {"ATM": 10.4}},
    "zero skew": {"1M": {"ATM": 12.0, "RR25": 0.0, "BF25": 0.0}, "6M": {"ATM": 13.0, "RR25": 0.0, "BF25": 0.0}, "2Y": {"ATM": 14.5, "RR25": 0.0, "BF25": 0.0}},
}
Y = {"ON": 1 / 365, "1W": 7 / 365, "2W": 14 / 365, "3W": 21 / 365, "1M": 1 / 12, "2M": 2 / 12, "3M": 3 / 12, "6M": 0.5, "9M": 0.75, "1Y": 1.0, "2Y": 2.0}
INTERP_AT = {  # years to expiry: on a pillar, between two, before the first, beyond the last
    "eight tenors": [0.0, 3 / 365, Y["1W"], 20 / 365, Y["1M"], 0.125, Y["3M"], 0.4, Y["6M"], 0.9, Y["1Y"], 1.5, Y["2Y"], 3.25],
    "ten tenors with 2W and 3W": [2 / 365, Y["1W"], 10 / 365, Y["2W"], 17 / 365, Y["3W"], 25 / 365, Y["1M"], 45 / 365, 0.625, 1.75, 2.5],
    "ATM-only tenors mixed in": [0.01, Y["1W"], 0.05, Y["1M"], Y["2M"], Y["3M"], 0.3, Y["6M"], 0.8, Y["1Y"], 4.0],
    "ATM only": [0.02, 0.2, Y["3M"], 0.7, 1.4],
    "zero skew": [0.3, 1.25],
}
MONEYNESS = [0.5, 0.7, 0.85, 0.95, 1.0, 1.05, 1.2, 1.5, 2.0]      # strike over forward: a deep put to a deep call
VOL_AT = (  # surface, years to expiry, forward, strike
    [("eight tenors", T, 1.085, round(1.085 * m, 6)) for T in (10 / 365, 1.5) for m in (0.7, 0.9, 0.97, 0.99, 1.0, 1.01, 1.03, 1.1, 1.3)]
    + [("ten tenors with 2W and 3W", T, 104_250.0, round(104_250.0 * m, 2)) for T in (5 / 365, 17 / 365, 0.4, 2.5) for m in MONEYNESS]
    + [("ATM-only tenors mixed in", T, 152.4, k) for T in (0.05, 0.3, 0.8) for k in (120.0, 148.0, 152.4, 157.5, 190.0)]
    + [("ATM only", 0.2, 0.905, 0.8), ("ATM only", 0.7, 0.905, 0.95)]
    + [("zero skew", 0.3, 1.27, 1.1), ("zero skew", 0.3, 1.27, 1.27), ("zero skew", 1.25, 1.27, 1.6)]
    + [("eight tenors", 0.0, 1.085, 1.0), ("eight tenors", 0.0, 1.085, 1.2)]      # no time left: the delta is 1 or 0
)
DELTAS = [  # forward, strike, years to expiry, vol (decimal): the forward delta of a call, Φ(d1)
    (1.085, 1.085, 0.25, 0.075), (1.085, 1.0, 0.25, 0.075), (1.085, 1.2, 0.25, 0.075), (1.085, 0.6, 1.5, 0.082), (1.085, 2.4, 1.5, 0.082),
    (104_250.0, 100_000.0, 17 / 365, 0.49), (104_250.0, 52_125.0, 5 / 365, 0.55), (104_250.0, 208_500.0, 5 / 365, 0.49), (104_250.0, 140_000.0, 2.5, 0.6),
    (152.4, 152.4, 1.0, 0.0001), (152.4, 150.0, 0.0, 0.1), (152.4, 155.0, 0.0, 0.1), (152.4, 150.0, 0.5, 0.0),
]


def _quotes(grid: dict) -> list[dict]:
    """A grid as the snapshot rows it is stored as: what the pairs route reads back into vol_surface.grid."""
    return [{"tenor": t, "quote_type": k, "rate": v, "enabled": True} for t, row in grid.items() for k, v in row.items()]


def _pillar(p) -> dict:
    return {"t": p.t, "atm": p.atm, "rr": p.rr, "bf": p.bf, "smile": p.smile}


def build() -> dict:
    from api.routes.currencies import TENOR_DAYS, interp_points
    from pricing.fx_option import forward_delta
    from pricing.fx_vol import TENOR_YEARS, _interp, parse_surface, smile_vol, vol_at
    from settlement.rule import settlement_amount
    pillars = {name: parse_surface(_quotes(grid)) for name, grid in SURFACES.items()}
    return {
        "about": "Generated by backend/tests/test_fx_scenario_vectors.py from api/routes/currencies.interp_points and settlement/rule.settlement_amount. "
                 "Do not edit by hand. Points are linear in days between quoted tenors, zero at spot, flat beyond the last tenor. "
                 "An amount is in the quote currency, undiscounted, from our side.",
        "tenor_days": dict(TENOR_DAYS),
        "interp_points": [{"curve": name, "points": dict(points), "days": d, "expected": interp_points(points, d)} for name, points in CURVES.items() for d in DAYS[name]],
        "settlement_amount": [{"kind": k, "direction": d, "notional": n, "strike": s, "fixing": f, "expected": settlement_amount(k, d, n, s, f)} for k, d, n, s, f in AMOUNTS],
        "about_vol": "Generated by the same test from pricing/fx_vol.parse_surface, _interp, smile_vol and vol_at and pricing/fx_option.forward_delta. Surfaces are in vol points "
                     "({tenor: {ATM, RR25, BF25}}); every expected vol is a decimal. ATM, RR25 and BF25 are each linear in time between "
                     "quoted tenors and flat beyond them (in vol, not variance); RR25 and BF25 skip a tenor that quotes an ATM alone.",
        "tenor_years": dict(TENOR_YEARS),
        "vol_surfaces": {name: {t: dict(row) for t, row in grid.items()} for name, grid in SURFACES.items()},
        "vol_pillars": {name: [_pillar(p) for p in ps] for name, ps in pillars.items()},
        "vol_interp": [{"surface": name, "t": T, "expected": _pillar(_interp(pillars[name], T))} for name, ts in INTERP_AT.items() for T in ts],
        "smile_vol": [{"atm": a, "rr": r, "bf": b, "call_delta": d, "expected": smile_vol(a, r, b, d)}
                      for a, r, b in ((0.072, -0.0035, 0.002), (0.505, 0.019, 0.0175), (0.1, 0.0, 0.0)) for d in (0.1, 0.25, 0.5, 0.75, 0.9)],
        "forward_delta": [{"forward": F, "strike": K, "t": T, "vol": sig, "expected": forward_delta(F, K, T, sig, call=True)} for F, K, T, sig in DELTAS],
        "vol_at": [{"surface": name, "t": T, "forward": F, "strike": K, "expected": vol_at(pillars[name], T, F, K)} for name, T, F, K in VOL_AT],
    }


def test_the_vectors_file_is_what_the_backend_computes():
    now = build()
    if os.getenv("RIJEKA_UPDATE_VECTORS", "").strip() == "1":
        VECTORS.parent.mkdir(exist_ok=True)
        VECTORS.write_text(json.dumps(now, indent=2, ensure_ascii=True, allow_nan=False) + "\n", encoding="utf-8")
    assert VECTORS.exists(), "tests/vectors/fx_scenario.json is missing: run with RIJEKA_UPDATE_VECTORS=1"
    stored = json.loads(VECTORS.read_text(encoding="utf-8"))
    # the same shape and words, and every number to 1e-12 relative: the file was written on one machine and is read
    # on another whose libm rounds erf and exp a unit in the last place differently (CI, 9 November 2026)
    assert _same(stored, now), "tests/vectors/fx_scenario.json is out of date: run with RIJEKA_UPDATE_VECTORS=1 and commit it"


def _same(a, b, rel=1e-12) -> bool:
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b))
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= rel * max(1.0, abs(a), abs(b))
    return a == b


def test_the_vectors_cover_the_cases_and_agree_with_figures_worked_by_hand():
    """So the file is not only the code agreeing with itself."""
    v = build()
    cases = {(c["curve"], c["days"]): c["expected"] for c in v["interp_points"]}
    assert len(cases) == 32 and len(v["settlement_amount"]) == 11
    full = CURVES["every tenor"]
    assert cases[("every tenor", 0)] == 0.0 and cases[("every tenor", -3)] == 0.0                         # at spot, and before it
    assert cases[("every tenor", 3)] == pytest.approx(12.5 * 3 / 7)                                       # between spot and the first tenor
    assert cases[("every tenor", 45)] == pytest.approx(58.25 + (121.0 - 58.25) * 15 / 31)                 # between 1M (30 days) and 2M (61)
    assert cases[("every tenor", 500)] == pytest.approx(905.5 + (2010.0 - 905.5) * 135 / 365)             # between 1Y and 2Y
    assert cases[("every tenor", 900)] == 2010.0                                                          # flat beyond the last tenor
    for tenor, days in v["tenor_days"].items():                                                           # exactly on a tenor: its own points
        if tenor in full:
            assert cases[("every tenor", days)] == pytest.approx(full[tenor]), tenor
    between = {("1W", "2W"): 10, ("2W", "1M"): 20, ("1M", "2M"): 45, ("2M", "3M"): 75, ("3M", "6M"): 120, ("6M", "9M"): 200, ("9M", "1Y"): 300, ("1Y", "2Y"): 500}
    for (a, b), d in between.items():                                                                     # a case between every pair of neighbours
        assert v["tenor_days"][a] < d < v["tenor_days"][b] and min(full[a], full[b]) < cases[("every tenor", d)] < max(full[a], full[b])
    assert cases[("three tenors, negative points", 15)] == pytest.approx(-2.25) and cases[("three tenors, negative points", 400)] == -61.0
    assert cases[("overnight and a week", 4)] == pytest.approx(0.35 + (2.4 - 0.35) * 3 / 6)
    amounts = {(c["kind"], c["direction"], c["notional"], c["strike"], c["fixing"]): c["expected"] for c in v["settlement_amount"]}
    assert amounts[("FORWARD", "BUY", 10, 100_000.0, 104_250.0)] == 42_500.0 and amounts[("FORWARD", "SELL", 10, 100_000.0, 104_250.0)] == -42_500.0
    assert amounts[("FORWARD", "BUY", 2.5, 3_800.0, 3_650.5)] == pytest.approx(-373.75) and amounts[("FORWARD", "SELL", 250, 182.0, 182.0)] == 0.0
    assert amounts[("CALL", "BUY", 10, 100_000.0, 104_250.0)] == 42_500.0 and amounts[("CALL", "SELL", 10, 100_000.0, 104_250.0)] == -42_500.0
    assert amounts[("CALL", "BUY", 10, 100_000.0, 96_000.0)] == 0.0 and amounts[("CALL", "BUY", 1.25, 3_800.0, 3_800.0)] == 0.0
    assert amounts[("PUT", "BUY", 10, 100_000.0, 94_000.0)] == 60_000.0 and amounts[("PUT", "SELL", 10, 100_000.0, 94_000.0)] == -60_000.0
    assert amounts[("PUT", "BUY", 40, 182.0, 190.75)] == 0.0


def test_the_vol_vectors_cover_the_cases_and_agree_with_figures_worked_by_hand():
    """The surface reading the browser copies (fx-vol.js): the cases the file must hold, and figures worked by hand."""
    import math
    from pricing.fx_vol import TENOR_YEARS
    v = build()
    assert v["tenor_years"] == dict(TENOR_YEARS) and all(v["tenor_years"][t] == y for t, y in Y.items())
    interp = {(c["surface"], c["t"]): c["expected"] for c in v["vol_interp"]}
    at = {(c["surface"], c["t"], c["forward"], c["strike"]): c["expected"] for c in v["vol_at"]}
    assert len(interp) == len(v["vol_interp"]) == 44 and len(at) == len(v["vol_at"]) == 76 and len(v["smile_vol"]) == 15 and len(v["forward_delta"]) == 13

    # the pillars: a tenor without an ATM and a tenor the surface does not know are dropped; smile is "RR25 or BF25 quoted"
    mixed = v["vol_pillars"]["ATM-only tenors mixed in"]
    assert [p["t"] for p in mixed] == [7 / 365, 1 / 12, 0.25, 0.5, 1.0] and [p["smile"] for p in mixed] == [False, True, False, True, True]
    assert mixed[3] == {"t": 0.5, "atm": 0.0975, "rr": 0.006, "bf": 0.0, "smile": True}                  # an RR with no BF: the BF reads as zero
    assert len(v["vol_pillars"]["ten tenors with 2W and 3W"]) == 10 and len(v["vol_pillars"]["eight tenors"]) == 8
    assert [p["t"] for p in v["vol_pillars"]["ten tenors with 2W and 3W"]][:4] == [7 / 365, 14 / 365, 21 / 365, 1 / 12]

    # on a pillar: its own quotes
    e = interp[("eight tenors", 1 / 12)]
    assert (e["atm"], e["rr"], e["bf"], e["smile"]) == (pytest.approx(0.072), pytest.approx(-0.0035), pytest.approx(0.002), True)
    for name, grid in SURFACES.items():
        for t, row in grid.items():
            if (name, Y.get(t)) in interp and "ATM" in row:
                assert interp[(name, Y[t])]["atm"] == pytest.approx(row["ATM"] / 100), (name, t)
    # between 1M and 2M, halfway in time (0.125 years): the mean of the two, each quote on its own
    e = interp[("eight tenors", 0.125)]
    assert e["atm"] == pytest.approx(0.07275) and e["rr"] == pytest.approx(-0.004) and e["bf"] == pytest.approx(0.00215)
    # linear in vol, not in variance: between 1Y (8.1) and 2Y (8.4) at 1.5 years the ATM is 8.25. Total variance linear in time
    # would give sqrt((0.081²·1 + 0.084²·2)/2 / 1.5) = sqrt(0.0103365/1.5) = 8.3012, which this is not
    assert interp[("eight tenors", 1.5)]["atm"] == pytest.approx(0.0825, abs=1e-12)
    assert math.sqrt((0.081 ** 2 * 1.0 + 0.084 ** 2 * 2.0) / 2 / 1.5) == pytest.approx(0.0830120, abs=1e-7)
    # before the first tenor and beyond the last: flat
    assert interp[("eight tenors", 0.0)] == {"t": 0.0, "atm": 0.079, "rr": -0.0015, "bf": 0.0012, "smile": True}
    assert interp[("eight tenors", 3.25)] == {"t": 3.25, "atm": 0.084, "rr": -0.01, "bf": 0.0042, "smile": True}
    # the ten-tenor surface between 2W and 3W (17 days): 48.25 + (49.0 − 48.25)·3/7, −2.6 + 0.4·3/7, 1.55 + 0.05·3/7
    e = interp[("ten tenors with 2W and 3W", 17 / 365)]
    assert e["atm"] == pytest.approx(0.4825 + 0.0075 * 3 / 7) and e["rr"] == pytest.approx(-0.026 + 0.004 * 3 / 7) and e["bf"] == pytest.approx(0.0155 + 0.0005 * 3 / 7)
    # ATM-only tenors mixed in. At 0.3 years the ATM runs 3M (9.5) → 6M (9.75): 9.5 + 0.25·0.05/0.25 = 9.55. The RR and BF skip the
    # 3M tenor and run 1M → 6M: RR 1.2 + (0.6 − 1.2)·(0.3 − 1/12)/(0.5 − 1/12) = 0.888, BF 0.3 + (0 − 0.3)·0.52 = 0.144
    e = interp[("ATM-only tenors mixed in", 0.3)]
    assert e["atm"] == pytest.approx(0.0955) and e["rr"] == pytest.approx(0.00888) and e["bf"] == pytest.approx(0.00144) and e["smile"] is True
    # before the first smiled tenor the skew is the 1M's, though the ATM there is the 1W's
    e = interp[("ATM-only tenors mixed in", 0.01)]
    assert (e["atm"], e["rr"], e["bf"]) == (pytest.approx(0.11), pytest.approx(0.012), pytest.approx(0.003))
    e = interp[("ATM only", 0.2)]
    assert e["smile"] is False and e["rr"] == 0.0 and e["bf"] == 0.0 and e["atm"] == pytest.approx(0.09 + 0.006 * (0.2 - 1 / 12) / (0.25 - 1 / 12))

    # the smile: the three quoted points come back at call deltas of 0.25, 0.5 and 0.75
    sm = {(c["atm"], c["rr"], c["bf"], c["call_delta"]): c["expected"] for c in v["smile_vol"]}
    assert sm[(0.072, -0.0035, 0.002, 0.5)] == 0.072
    assert sm[(0.072, -0.0035, 0.002, 0.25)] == pytest.approx(0.072 + 0.002 - 0.0035 / 2)               # the 25-delta call: ATM + BF + RR/2 = 7.225
    assert sm[(0.072, -0.0035, 0.002, 0.75)] == pytest.approx(0.072 + 0.002 + 0.0035 / 2)               # the 25-delta put: ATM + BF − RR/2 = 7.575
    assert sm[(0.072, -0.0035, 0.002, 0.1)] == pytest.approx(0.072 - 2 * -0.0035 * -0.4 + 16 * 0.002 * 0.16)     # 7.432

    # the forward delta of a call, Φ(d1): at the forward d1 = ½σ√T = ½·0.075·0.5 = 0.01875 and Φ(0.01875) = 0.50748 (Φ(x) ≈ ½ + x/√(2π)
    # this close to zero: 0.5 + 0.01875·0.398942 = 0.50748); with no time or no vol it is 1 in the money and 0 out of it
    fd = {(c["forward"], c["strike"], c["t"], c["vol"]): c["expected"] for c in v["forward_delta"]}
    assert fd[(1.085, 1.085, 0.25, 0.075)] == pytest.approx(0.50748, abs=1e-5)
    assert fd[(152.4, 150.0, 0.0, 0.1)] == 1.0 and fd[(152.4, 155.0, 0.0, 0.1)] == 0.0 and fd[(152.4, 150.0, 0.5, 0.0)] == 1.0
    # a strike at half or twice the forward five days out is past what a double can tell from 1 and 0: ln 2 over σ√T is more than ten deviations
    assert fd[(104_250.0, 208_500.0, 5 / 365, 0.49)] == 0.0 and fd[(104_250.0, 52_125.0, 5 / 365, 0.55)] == 1.0

    # the vol at a strike. No skew, or no smile quoted: the ATM at that expiry, whatever the strike
    assert at[("zero skew", 0.3, 1.27, 1.1)] == at[("zero skew", 0.3, 1.27, 1.27)] == pytest.approx(0.12 + 0.01 * (0.3 - 1 / 12) / (0.5 - 1 / 12))
    assert at[("zero skew", 1.25, 1.27, 1.6)] == pytest.approx(0.13 + 0.015 * 0.75 / 1.5)
    assert at[("ATM only", 0.7, 0.905, 0.95)] == pytest.approx(0.096 + 0.008 * 0.45 / 0.75)
    # no time left: a strike below the forward is a call of delta 1, above it of delta 0 (ATM ∓ RR + 4·BF at the 1W quotes)
    assert at[("eight tenors", 0.0, 1.085, 1.0)] == pytest.approx(0.079 + 0.0015 + 4 * 0.0012)
    assert at[("eight tenors", 0.0, 1.085, 1.2)] == pytest.approx(0.079 - 0.0015 + 4 * 0.0012)
    # the skew has its sign: on a negative risk reversal a low strike carries more vol than a high one and more than the
    # strike at the forward
    low, mid, high = (at[("eight tenors", 1.5, 1.085, round(1.085 * m, 6))] for m in (0.9, 1.0, 1.1))
    assert low > high and low > mid


def test_vol_at_gives_back_the_quotes_at_their_own_strikes():
    """Independent of the vectors: the strike whose forward call delta is ½ (K = F·exp(½σ²T) at σ = ATM) prices at the ATM, and
    the strikes of the 25-delta call and put at the quoted wing vols, on the 3M tenor of the eight-tenor surface."""
    import math
    from pricing.fx_vol import parse_surface, vol_at
    pillars = parse_surface(_quotes(SURFACES["eight tenors"]))
    F, T, atm, rr, bf = 1.085, 0.25, 0.075, -0.0055, 0.0026
    assert vol_at(pillars, T, F, F * math.exp(0.5 * atm * atm * T)) == pytest.approx(atm, abs=1e-12)
    z = 0.6744897501960817                                    # Φ(z) = 0.75
    for d1, wing in ((-z, atm + bf + rr / 2), (z, atm + bf - rr / 2)):          # the 25-delta call (7.485), the 25-delta put (8.035)
        K = F * math.exp(-d1 * wing * math.sqrt(T) + 0.5 * wing * wing * T)
        assert vol_at(pillars, T, F, K) == pytest.approx(wing, abs=1e-9)
