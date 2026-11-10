"""The capital route's arithmetic on synthetic netted paths, the SA-CCR mapping of hypothetical trades, and the
request validation; the engines that need a database are not touched."""
import math
from datetime import date

import numpy as np
import pytest
from fastapi import HTTPException

from api.routes.capital import CapitalTradeRequest, CounterpartyType, capital_grid, quote_lines, _regimes_for, _types_for
from api.routes.xva import hypothetical_trade
from ccr.saccr_map import from_netting_set, par_rate
from ccr.valuation import NettingSet
from pricing import collateral as COL
from pricing.sa_ccr import SaccrTrade
from tests.test_incremental_xva import _swap_body
from tests.test_xva_engine import make_paths


def _set(n=800, M=5.0, seed=3, notional=1e7, rows=None, im_10d=250_000.0, mtm=0.0):
    paths, p0, theta, T = make_paths(n_paths=n, maturity_y=M, seed=seed, notional=notional)
    V = np.concatenate([np.full((n, 1), mtm), paths], axis=1)
    t = np.array([k / 12 for k in range(T + 1)])
    rows = rows if rows is not None else [SaccrTrade("IR", "USD", notional, 0.0, M, M, 1.0, trade_ref="T")]
    return {"V": V, "t": t, "p0": p0, "rows": rows, "im_10d": im_10d, "gross": notional, "mtm": mtm}


TYPES = [CounterpartyType(type="CORPORATE", rating="UNRATED"), CounterpartyType(type="BANK", rating="A")]


def test_grid_shape_and_the_identities_between_sets():
    sets = {"with": _set(), "without": None, "standalone": _set()}
    regimes = [COL.preset(n) for n in COL.PRESET_NAMES]
    g = capital_grid(sets, regimes, TYPES, 85.0, 0.4, 0.12)
    assert [r["name"] for r in g["regimes"]] == list(COL.PRESET_NAMES) and len(g["types"]) == 2
    for rg in COL.PRESET_NAMES:
        for ct in ("CORPORATE·UNRATED", "BANK·A"):
            c = g["cells"][rg][ct]
            assert c["without"] is None and c["with"] and c["standalone"]
            # an empty set without the trade: the incremental is the set with it, and the trade alone is that set
            for k in ("ead", "kva", "cva", "im"):
                assert c["incremental"][k] == pytest.approx(c["with"][k]) and c["standalone"][k] == pytest.approx(c["with"][k])
        assert g["saccr"][rg]["with"]["ead"] >= 0 and g["saccr"][rg]["standalone"]["trades"][0]["trade_ref"] == "T"


def test_regimes_order_capital_the_way_the_rules_do():
    sets = {"with": _set(), "without": None, "standalone": _set()}
    regimes = [COL.preset(n) for n in COL.PRESET_NAMES]
    g = capital_grid(sets, regimes, TYPES, 85.0, 0.4, 0.12)
    cell = lambda rg: g["cells"][rg]["BANK·A"]["with"]
    cash, stable, fund, sov = (cell(n) for n in COL.PRESET_NAMES)
    assert stable["ead"] > fund["ead"] >= cash["ead"] * 0.999          # unrecognised collateral: unmargined SA-CCR
    assert stable["im"] == 0.0 and cash["im"] > 0                       # stablecoin IM is not eligible: nothing posted counts
    assert abs(stable["cva"]) > abs(cash["cva"])                       # unenforceable: gross exposure
    assert sov["ead"] < cash["ead"]                                    # the on-chain MPoR state: a smaller maturity factor
    assert sov["im"] == pytest.approx(cash["im"] * math.sqrt(5 / 10), rel=0.1)   # and the margin over half the period: about sqrt(1/2), to sampling
    assert cash["rwa"] == pytest.approx(cash["ead"] * 0.30) and cash["k_cva"] > 0
    assert cash["leverage"] >= 1.4 * cash["addon"] * 0.999 and cash["hqla_im"] == pytest.approx(cash["im"])   # government securities: Level 1


def test_incremental_is_with_minus_without_on_common_paths():
    S1, S0 = _set(seed=3), _set(seed=3, notional=5e6)
    sets = {"with": S1, "without": S0, "standalone": _set(seed=3, notional=5e6)}
    g = capital_grid(sets, [COL.preset("CASH_GOVT")], TYPES[:1], 85.0, 0.4, 0.12)
    c = g["cells"]["CASH_GOVT"]["CORPORATE·UNRATED"]
    for k in ("ead", "kva", "cva", "mva", "leverage"):
        assert c["incremental"][k] == pytest.approx(c["with"][k] - c["without"][k])


def test_quote_lines_against_the_first_regime():
    sets = {"with": _set(), "without": None, "standalone": _set()}
    regimes = [COL.preset("CASH_GOVT"), COL.preset("PLUS_STABLECOIN")]
    g = capital_grid(sets, regimes, TYPES[:1], 85.0, 0.4, 0.12)
    q = quote_lines(g["cells"], regimes, TYPES[:1], 1e7, 5.0, 0.035)
    a, b = q["CASH_GOVT"]["CORPORATE·UNRATED"], q["PLUS_STABLECOIN"]["CORPORATE·UNRATED"]
    assert a["cost_vs_first"] == 0.0 and a["running_bp"] == 0.0
    assert b["cost"] > a["cost"] and b["cost_vs_first"] < 0 and b["running_bp"] < 0 and b["upfront_bp"] < 0


def test_saccr_mapping_of_a_hypothetical_swap_and_forward():
    asof = date(2026, 11, 2)
    swap = hypothetical_trade(_swap_body(), None, "u")
    fwd = hypothetical_trade({"instrument_type": "FX_FORWARD", "notional": 2e6, "notional_ccy": "EUR", "trade_date": "2026-11-02",
                              "effective_date": "2026-11-04", "maturity_date": "2027-11-04",
                              "terms": {"currency_pair": "EURUSD", "base_notional": 2e6, "forward_rate": 1.10, "value_date": "2027-11-04", "direction": "SELL"}},
                             None, "u")
    ns = NettingSet(None, {"sub": "u"}, [swap, fwd], asof)
    assert len(ns.items) == 2 and not ns.skipped
    rows, notes = from_netting_set(ns, None, {"USD": 1.0, "EUR": 1.10}, asof, None)
    assert [r.asset_class for r in rows] == ["IR", "FX"]
    ir, fx = rows
    assert ir.hedging_set == "USD" and ir.delta == 1.0 and ir.end_y == pytest.approx(5.0, abs=0.02) and ir.notional == 1e7
    assert fx.hedging_set == "EURUSD" and fx.delta == -1.0 and fx.notional == pytest.approx(2e6 * 1.10) and fx.end_y == pytest.approx(1.0, abs=0.02)
    assert any("no spot" in n for n in notes)
    # a digital asset whose ticket defaults to Group 2b: the book-level mapping runs it as Group 2a and says so, once
    def sol(ref):
        t = hypothetical_trade({"instrument_type": "CRYPTO_FORWARD", "notional": 1000, "notional_ccy": "SOL", "trade_date": "2026-11-02", "effective_date": "2026-11-02",
                                "maturity_date": "2027-02-02", "terms": {"digital_asset": "SOL", "notional_amount": "1000", "direction": "BUY", "forward_price": "200",
                                                                         "price_currency": "USD", "valuation_date": "2027-02-02", "settlement_date": "2027-02-02",
                                                                         "settlement_currency": "USD", "settlement_price_source": "DERIBIT"}}, None, "u")
        t.trade_ref = ref
        return t
    ns2 = NettingSet(None, {"sub": "u"}, [sol("S1"), sol("S2")], asof)
    rows2, notes2 = from_netting_set(ns2, None, {"USD": 1.0}, asof, None)
    assert len(rows2) == 2, (ns2.skipped, notes2)
    if rows2:
        assert all(r.asset_class == "CRYPTO" for r in rows2)
        assert sum("Group 2b" in n and "SOL" in n for n in notes2) == 1


def test_par_rate_from_a_flat_curve():
    asof = date(2026, 1, 1)
    df = lambda t: math.exp(-0.04 * t)
    sched = [(date(2026, 1, 1), date(2027, 1, 1), date(2027, 1, 1), 1.0), (date(2027, 1, 1), date(2028, 1, 1), date(2028, 1, 1), 1.0)]
    r = par_rate(sched, asof, df)
    assert r == pytest.approx(math.exp(0.04) - 1, rel=1e-3)
    assert par_rate([], asof, df) is None


def test_request_defaults_and_validation():
    class CP:
        csa_type = "VM_IM"; csa_threshold_m = 0; csa_mta_k = 500; counterparty_type = "BANK"; rating_bucket = "A"; cva_sector = None
        risk_weight_override = None; eligible_collateral = None; posted_composition = None; received_composition = None; netting_enforceable = None
    body = CapitalTradeRequest(trade={"x": 1})
    regs = _regimes_for(body, CP())
    assert [r.name for r in regs] == ["COUNTERPARTY", *COL.PRESET_NAMES]
    assert regs[1].csa.collateralised and regs[1].csa.mta == 500e3
    tys = _types_for(body, CP())
    assert tys[0].label == "COUNTERPARTY" and tys[0].type == "BANK" and len(tys) == 4
    with pytest.raises(HTTPException) as e:
        _regimes_for(CapitalTradeRequest(trade={}, regimes=["NOPE"]), None)
    assert e.value.status_code == 422
    with pytest.raises(HTTPException):
        _types_for(CapitalTradeRequest(trade={}, counterparty_types=[CounterpartyType(type="HEDGE_FUND")]), None)
    regs = _regimes_for(CapitalTradeRequest(trade={}, regimes=[{"preset": "CASH_GOVT", "name": "MINE", "collateral_maturity_y": 7}]), None)
    assert regs[0].name == "MINE" and regs[0].collateral_maturity_y == 7


def test_route_needs_a_trade(monkeypatch):
    from api.routes.capital import capital_trade
    with pytest.raises(HTTPException) as e:
        capital_trade(CapitalTradeRequest(), db=None, user={"sub": "u"})
    assert e.value.status_code == 422
