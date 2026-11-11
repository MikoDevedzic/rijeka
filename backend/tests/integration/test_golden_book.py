"""The pinned sample book (Ada, the numbers guardian). A fixed set of trades on the stack's fixed market of 2 November
2026, valued at that date with fixed seeds: a swap and its par rate, its XVA under each settlement and with the margin
held in a stablecoin, an FX and a digital-asset forward with their XVA, and the swap's capital stock under three
collateral regimes. Every figure is compared with golden_book.json.

A figure that moves is a finding until explained. A deliberate change (a new term, a corrected formula) is recorded:

    RIJEKA_UPDATE_GOLDEN=1 python -m pytest -q -m integration tests/integration/test_golden_book.py

and a line added to GOLDEN_CHANGES.md with the date, what moved, by how much and why. The update path refuses to run
without today's date in that file."""
from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration

HERE = Path(__file__).parent
GOLDEN = HERE / "golden_book.json"
CHANGES = HERE / "GOLDEN_CHANGES.md"
ASOF = "2026-11-02"                 # the stack's market (backend/stack/seed.py)
EFF, MAT = "2026-11-04", "2031-11-04"
SETTLE = "2027-05-04"
REL, ABS = 1e-6, 0.02               # the same seeds give the same paths; the tolerance absorbs platform arithmetic only


def _legs(rate: float) -> list[dict]:
    common = {"currency": "USD", "notional": 10_000_000, "notional_type": "BULLET", "effective_date": EFF, "maturity_date": MAT,
              "day_count": "ACT/360", "payment_frequency": "ANNUAL", "bdc": "MOD_FOLLOWING", "payment_calendar": None, "stub_type": "SHORT_FRONT",
              "payment_lag": 2, "notional_schedule": None, "discount_curve_id": "USD_SOFR", "ois_compounding": None, "terms": {"custom_cashflows": []}}
    return [{**common, "leg_ref": "FIXED-1", "leg_seq": 1, "leg_type": "FIXED", "direction": "PAY", "fixed_rate": rate, "fixed_rate_schedule": None, "forecast_curve_id": None},
            {**common, "leg_ref": "FLOAT-1", "leg_seq": 2, "leg_type": "FLOAT", "direction": "RECEIVE", "reset_frequency": "DAILY", "fixed_rate": 0, "spread": 0,
             "spread_schedule": None, "leverage": 1, "forecast_curve_id": "USD_SOFR"}]


def _swap_trade(ids: dict) -> dict:
    return {"own_legal_entity_id": ids["own_entity_id"], "counterparty_id": ids["counterparty_id"], "desk": "RATES", "book": "USD-IRS", "trade_ref": "GOLDEN-SWAP",
            "store": "WORKING", "asset_class": "RATES", "instrument_type": "IR_SWAP", "structure": "VANILLA", "notional": 10_000_000, "notional_ccy": "USD",
            "trade_date": ASOF, "effective_date": EFF, "maturity_date": MAT,
            "terms": {"direction": "PAY", "float_direction": "RECEIVE", "fixed_rate": 0.0375, "fixed_pay_freq": "ANNUAL", "fixed_day_count": "ACT/360",
                      "fixed_bdc": "MOD_FOLLOWING", "fixed_calendar": None, "float_index": "SOFR", "float_reset_freq": "DAILY", "float_pay_freq": "ANNUAL",
                      "float_day_count": "ACT/360", "float_bdc": "MOD_FOLLOWING", "float_calendar": None, "spread": 0, "leverage": 1},
            "legs": _legs(0.0375)}


def _ok(r, what: str) -> dict:
    assert r.status_code == 200, f"{what}: {r.status_code} {r.text[:400]}"
    return r.json()


def compute(client, auth, ids) -> dict:
    """{figure name: number}, flat, in a fixed order."""
    out: dict[str, float] = {}
    curves = [{"curve_id": "USD_SOFR", "quotes": []}]

    # the swap at 3.75 %, and the par rate of the same schedule
    p = _ok(client.post("/price/preview", json={"legs": _legs(0.0375), "valuation_date": ASOF, "curves": curves}, headers=auth), "swap price")
    for k in ("npv", "ir01", "ir01_disc", "theta"):
        if p.get(k) is not None:
            out[f"swap.{k}"] = float(p[k])
    par = _ok(client.post("/api/price/par-rate", json={"curve_id": "USD_SOFR", "valuation_date": ASOF, "effective_date": EFF, "maturity_date": MAT, "currency": "USD",
                                                       "notional": 10_000_000, "direction": "PAY", "fixed_pay_freq": "ANNUAL", "fixed_day_count": "ACT/360",
                                                       "fixed_bdc": "MOD_FOLLOWING", "fixed_payment_lag": 2, "float_index": "SOFR", "float_reset_freq": "DAILY",
                                                       "float_pay_freq": "ANNUAL", "float_day_count": "ACT/360", "float_bdc": "MOD_FOLLOWING", "float_payment_lag": 2,
                                                       "spread": 0, "leverage": 1.0}, headers=auth), "par rate")
    out["swap.par_rate_pct"] = float(par["par_rate"])

    # its XVA: no CSA, bilateral, on chain, and bilateral with the margin held in a stablecoin on both sides
    base = {"notional": 10_000_000, "maturity_y": 5.0, "fixed_rate": 0.0375, "paths": 500, "seed": 42, "npv": out["swap.npv"], "ir01": out["swap.ir01"],
            "valuation_date": ASOF, "curve_id": "USD_SOFR"}
    cases = {"none": {"preset": "UNCOLLATERALISED"}, "bilateral": {"preset": "BILATERAL", "threshold_cp": 0, "mta": 0, "im_exchanged": True},
             "on_chain": {"preset": "ON_CHAIN", "im_exchanged": True}}
    for name, csa in cases.items():
        x = _ok(client.post("/api/xva/simulate", json={**base, "csa": csa}, headers=auth), f"xva {name}")["xva"]
        for k in ("cva", "dva", "fva", "fba", "kva", "mva", "colva", "xva_total"):
            out[f"xva.{name}.{k}"] = float(x[k])
    x = _ok(client.post("/api/xva/simulate", json={**base, "csa": cases["bilateral"], "collateral": {"posted": {"USDC": 1}, "received": {"USDC": 1}}},
                        headers=auth), "xva usdc")
    for k in ("mva", "colva", "xva_total"):
        out[f"xva.bilateral_usdc.{k}"] = float(x["xva"][k])
    out["xva.bilateral_usdc.post_carry_bp"] = float(x["csa"]["vm_post_carry_bp"])

    # an FX and a digital-asset forward, and the FX forward's XVA
    for pair, n in (("EURUSD", 10_000_000), ("BTCUSD", 10)):
        q = _ok(client.post("/api/currency/forward/price", json={"pair": pair, "shape": "FORWARD", "base_notional": n, "direction": "BUY",
                                                                 "settlement_date": SETTLE, "valuation_date": ASOF}, headers=auth), f"{pair} forward")
        for k in ("forward", "npv", "spot01"):
            if q.get(k) is not None:
                out[f"fwd.{pair}.{k}"] = float(q[k])
    fx = _ok(client.post("/api/xva/currency", json={"pair": "EURUSD", "base_notional": 10_000_000, "settlement_date": SETTLE, "direction": "BUY", "paths": 500,
                                                    "seed": 42, "valuation_date": ASOF, "csa": cases["bilateral"]}, headers=auth), "EURUSD xva")["xva"]
    for k in ("cva", "fva", "kva", "mva", "colva", "xva_total"):
        out[f"xva.EURUSD.bilateral.{k}"] = float(fx[k])
    # a margined digital-asset forward, pinned from 11 November 2026: at its vol the margin estimate, the tail beyond
    # the margin and the capital add-on are where a change to the engine shows first. One settlement only: the XVA
    # routes take six runs a minute from one account, and this is the sixth
    bx = _ok(client.post("/api/xva/currency", json={"pair": "BTCUSD", "base_notional": 10, "settlement_date": SETTLE, "direction": "BUY", "paths": 500,
                                                    "seed": 42, "valuation_date": ASOF, "csa": cases["bilateral"]}, headers=auth), "BTCUSD xva")["xva"]
    for k in ("cva", "dva", "fva", "fba", "kva", "mva", "xva_total"):
        out[f"xva.BTCUSD.bilateral.{k}"] = float(bx[k])

    # the swap's capital stock alone, under three collateral regimes on stated terms (not the record's, which other tests edit)
    terms = {"preset": "BILATERAL", "threshold_cp": 0, "mta": 0, "im_exchanged": True}
    cap = _ok(client.post("/api/capital/trade", json={"counterparty_id": ids["counterparty_id"], "trade": _swap_trade(ids), "n_paths": 300,
                                                      "regimes": [{"preset": n, "csa": terms} for n in ("CASH_GOVT", "PLUS_STABLECOIN", "PLUS_TOKENISED_SOVEREIGN")],
                                                      "counterparty_types": [{"type": "BANK", "rating": "A"}]}, headers=auth), "capital")
    assert cap["asof"] == ASOF, f"the stack's market moved to {cap['asof']}: the pinned book is valued on {ASOF}"
    for regime in ("CASH_GOVT", "PLUS_STABLECOIN", "PLUS_TOKENISED_SOVEREIGN"):
        cell = cap["cells"][regime]["BANK·A"]["standalone"]
        for k in ("im", "ead", "rwa", "k_ccr", "k_cva", "leverage", "hqla_im"):
            out[f"capital.{regime}.{k}"] = float(cell[k])
    return out


def test_golden_book(client, auth_a, ids):
    got = compute(client, auth_a, ids["a"])
    if os.getenv("RIJEKA_UPDATE_GOLDEN") == "1":
        today = date.today().isoformat()
        assert CHANGES.exists() and today in CHANGES.read_text(), f"add a line dated {today} to {CHANGES.name} saying what moved and why, then update"
        GOLDEN.write_text(json.dumps({"asof": ASOF, "figures": got}, indent=1) + "\n")
        pytest.skip(f"golden file written with {len(got)} figures")
    assert GOLDEN.exists(), "no golden file: run once with RIJEKA_UPDATE_GOLDEN=1 (see the module docstring)"
    want = json.loads(GOLDEN.read_text())["figures"]
    assert set(got) == set(want), f"figures added or removed: {sorted(set(got) ^ set(want))}"
    moved = []
    for k, w in want.items():
        g = got[k]
        if abs(g - w) > max(ABS, REL * abs(w)):
            moved.append(f"{k}: {w:,.6f} → {g:,.6f} ({g - w:+,.6f})")
    assert not moved, "pinned figures moved (explain in GOLDEN_CHANGES.md, then update):\n" + "\n".join(moved)
    # relations that hold whatever the level: cash carries nothing, a stablecoin costs, margining cuts the credit charge
    assert got["xva.bilateral.colva"] == 0.0 and got["xva.none.colva"] == 0.0 and got["xva.on_chain.colva"] == 0.0
    assert got["xva.bilateral_usdc.colva"] < 0 and got["xva.bilateral_usdc.post_carry_bp"] < 0
    assert abs(got["xva.bilateral.cva"]) < abs(got["xva.none.cva"])
    assert got["capital.PLUS_STABLECOIN.ead"] >= got["capital.CASH_GOVT.ead"] and got["capital.PLUS_STABLECOIN.im"] == 0.0
