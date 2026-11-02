"""Incremental XVA: the credit engine values the ticket's hypothetical trade in the counterparty's netting
set; the route reports with, without and the difference on one date grid."""
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from api.routes.xva import align_ee, hypothetical_trade, xva_levels


def _swap_body(**kw):
    body = {"instrument_type": "INTEREST_RATE_SWAP", "structure": "VANILLA", "notional": 1e7, "notional_ccy": "USD",
            "trade_date": "2026-11-02", "effective_date": "2026-11-04", "maturity_date": "2031-11-04",
            "terms": {"direction": "PAY", "fixed_rate": 0.0375},
            "legs": [{"leg_ref": "FIXED-1", "leg_seq": 1, "leg_type": "FIXED", "direction": "PAY", "currency": "USD", "notional": 1e7,
                      "fixed_rate": 0.0375, "payment_frequency": "ANNUAL"},
                     {"leg_ref": "FLOAT-1", "leg_seq": 2, "leg_type": "FLOAT", "direction": "RECEIVE", "currency": "USD", "notional": 1e7,
                      "spread": 0, "forecast_curve_id": "USD_SOFR", "payment_frequency": "ANNUAL", "reset_frequency": "DAILY"}]}
    body.update(kw)
    return body


def test_hypothetical_trade_is_canonical_and_its_legs_are_complete():
    t = hypothetical_trade(_swap_body(), None, str(uuid.uuid4()))
    assert t.instrument_type == "IR_SWAP" and t.status == "PENDING" and t.maturity_date == date(2031, 11, 4)
    assert len(t._legs) == 2
    fixed, flt = t._legs
    assert fixed["effective_date"] == "2026-11-04" and fixed["maturity_date"] == "2031-11-04"
    assert fixed["discount_curve_id"] == "USD_SOFR" and flt["forecast_curve_id"] == "USD_SOFR"
    assert fixed["day_count"] and fixed["bdc"], "the currency conventions are filled as the booking route fills them"


def test_hypothetical_trade_rejects_what_it_cannot_value():
    with pytest.raises(HTTPException) as e:
        hypothetical_trade(_swap_body(maturity_date=None), None, "u")
    assert e.value.status_code == 422
    with pytest.raises(HTTPException):
        hypothetical_trade(_swap_body(effective_date="04/11/2026"), None, "u")


def test_netting_set_values_a_hypothetical_swap_from_its_own_legs():
    """No database row: the legs travel on the object, the set has one SWAP item in USD."""
    from ccr.valuation import NettingSet
    t = hypothetical_trade(_swap_body(), None, "u")
    ns = NettingSet(None, {"sub": "u"}, [t], date(2026, 11, 2))
    assert len(ns.items) == 1 and ns.items[0]["kind"] == "SWAP" and ns.currencies == {"USD"}
    assert ns.items[0]["maturity"] >= date(2031, 11, 1) and not ns.skipped


def test_levels_and_profiles_align_across_the_two_runs():
    r0 = {"xva": {"cva_usd": -100.0, "dva_usd": 40.0, "fva_usd": -10.0, "fba_usd": 5.0, "kva_usd": -20.0, "mva_usd": -3.0},
          "grid": ["2026-12-02", "2027-01-02"], "ee_rn": [10.0, 8.0]}
    r1 = {"xva": {"cva_usd": -160.0, "dva_usd": 44.0, "fva_usd": -16.0, "fba_usd": 6.0, "kva_usd": -29.0, "mva_usd": -3.0},
          "grid": ["2026-12-02", "2027-01-02", "2027-02-02"], "ee_rn": [15.0, 12.0, 4.0]}
    w0, w1 = xva_levels(r0), xva_levels(r1)
    assert w0["total"] == pytest.approx(-88.0) and w1["total"] == pytest.approx(-158.0)
    assert xva_levels(None)["total"] == 0.0 and xva_levels({"empty": True})["cva"] == 0.0
    ee = align_ee(r0, r1)
    assert ee["grid"] == ["2026-12-02", "2027-01-02", "2027-02-02"]
    assert ee["without"] == [10.0, 8.0, 0.0] and ee["with"] == [15.0, 12.0, 4.0]


def test_route_runs_the_set_with_and_without_the_trade_on_the_same_engine(monkeypatch):
    """The composition: the counterparty's live trades plus the hypothetical go to counterparty_report
    twice; the response carries both levels, the difference, the aligned profiles and the mode."""
    import types
    from datetime import date as _date
    import api.routes.xva as X
    from ccr import report as CR
    from pnl import market as PM
    from risk import report as RR
    uid, cpid = uuid.uuid4(), uuid.uuid4()
    cp = types.SimpleNamespace(id=cpid, name="DEMO BANK", csa_type="VM_IM", csa_threshold_m=0, csa_mta_k=0, user_id=uid)
    stored = [types.SimpleNamespace(id=uuid.uuid4(), status="CONFIRMED", counterparty_id=cpid, trade_ref="TRD-1"),
              types.SimpleNamespace(id=uuid.uuid4(), status="CANCELLED", counterparty_id=cpid, trade_ref="TRD-0")]

    class Q:
        def __init__(s, rows): s.rows = rows
        def filter(s, *a, **k): return s
        def first(s): return s.rows[0] if s.rows else None
        def all(s): return s.rows
    class DB:
        def query(s, model):
            return Q([cp]) if model.__name__ == "Counterparty" else Q(stored)
        def rollback(s): pass
    seen = []
    def fake_report(db, user, cp_, trades, asof, mkt, st, tpl, exposure=True):
        seen.append([getattr(t, "trade_ref", "?") for t in trades])
        assert exposure is False
        n = len(trades)
        hyp = [t for t in trades if getattr(t, "_legs", None) is not None]
        assert all(len(t._legs) == 2 for t in hyp)
        return {"counterparty": cp_.name, "counterparty_id": str(cp_.id), "n_paths": st["n_paths"], "months": 60 if hyp else 24,
                "csa_model": {"preset": "ON_CHAIN", "mpor_days": 5}, "skipped": [],
                "xva": {"cva_usd": -100.0 * n, "dva_usd": 30.0 * n, "fva_usd": -10.0 * n, "fba_usd": 2.0 * n, "kva_usd": -20.0 * n, "mva_usd": -5.0 * n},
                "grid": [f"2027-{m:02d}-02" for m in range(1, (6 if hyp else 3))], "ee_rn": [float(10 * n - k) for k in range(5 if hyp else 2)]}
    monkeypatch.setattr(CR, "counterparty_report", fake_report)
    monkeypatch.setattr(CR, "settings", lambda db, f: {"n_paths": 2000, "cp_cds_bp": 85.0, "lgd": 0.4})
    class FakeMarket:
        def __init__(s, db, u, d): s.asof = d
        @staticmethod
        def dates(db, u, upto=None): return [_date(2026, 11, 2)]
    monkeypatch.setattr(PM, "Market", FakeMarket)
    monkeypatch.setattr(RR, "firm_of", lambda db, u: "firm")
    monkeypatch.setattr(RR, "template_uid", lambda db: None)
    monkeypatch.setattr(X, "heavy", lambda *a, **k: None)
    user = {"sub": str(uid), "user_metadata": {"role": "trader"}}
    body = X.IncrementalXvaRequest(counterparty_id=str(cpid), n_paths=500, trade=_swap_body())
    out = X.incremental_xva(body, db=DB(), user=user)
    assert seen == [["TRD-1"], ["TRD-1", "THIS TRADE"]], "live trades only, then with the hypothetical appended"
    assert out["mode"] == "INCREMENTAL" and out["other_trades"] == 1 and out["n_paths"] == 500
    assert out["without"]["total"] == pytest.approx(-103.0) and out["with"]["total"] == pytest.approx(-206.0)
    assert out["incremental"]["cva"] == pytest.approx(-100.0) and out["incremental"]["total"] == pytest.approx(-103.0)
    assert len(out["ee"]["grid"]) == 5 and out["ee"]["without"][2:] == [0.0, 0.0, 0.0], "the shorter run is padded on the longer grid"
    # marginal mode: an existing trade removed
    seen.clear()
    out2 = X.incremental_xva(X.IncrementalXvaRequest(counterparty_id=str(cpid), trade_id=str(stored[0].id)), db=DB(), user=user)
    assert out2["mode"] == "MARGINAL" and seen == [[], ["TRD-1"]][1:] or seen == [["TRD-1"]]
    assert out2["without"]["total"] == 0.0 and out2["with"]["total"] == pytest.approx(-103.0)
    # a trade the engine cannot value is a 422 with the reason, not a zero
    def empty_report(db, user, cp_, trades, asof, mkt, st, tpl, exposure=True):
        return {"empty": True, "skipped": [{"trade_ref": "THIS TRADE", "reason": "XCCY_SWAP not simulated yet"}]}
    monkeypatch.setattr(CR, "counterparty_report", empty_report)
    with pytest.raises(HTTPException) as e:
        X.incremental_xva(body, db=DB(), user=user)
    assert e.value.status_code == 422 and "not simulated" in e.value.detail


def test_forward_xva_takes_the_surface_vol_in_percent():
    """lookup_vol returns a decimal; ForwardXvaInput.vol_pct divides by 100: the route converts (found by review)."""
    import types
    from api.routes.xva import surface_vol_pct
    vs = types.SimpleNamespace(quotes=[{"tenor": "6M", "atm": 7.6}], valuation_date="2026-11-02")
    pct, src = surface_vol_pct(None, "u", "EURUSD", 0.5, 1.17, snapshot=lambda db, u, cid: vs,
                               lookup=lambda quotes, pair, T, F, K, o: (0.076, "ATM", "note"))
    assert pct == pytest.approx(7.6) and "EURUSD_VOL surface" in src and "0.50y" in src
    assert surface_vol_pct(None, "u", "SOLUSD", 0.5, 150.0, snapshot=lambda db, u, cid: None) == (None, None)


def test_forward_xva_hands_back_the_paths_for_the_chart():
    from pricing import fx_xva
    from pricing.csa import CSA
    inp = fx_xva.ForwardXvaInput(pair="EURUSD", base_notional=1e7, forward=1.17, strike=1.17, t_years=0.5, df_quote_t=0.98, quote_zero=0.04, direction="BUY", vol_pct=8.0)
    wf, meta = fx_xva.forward_xva(inp, CSA.uncollateralised(), n_paths=300)
    assert meta["_paths"].shape == (300, meta["steps"]) and abs(float(meta["_paths"][:, 0].mean())) < 2e5
    wf2, meta2 = fx_xva.forward_xva(inp, CSA.from_request({"preset": "ON_CHAIN"}), n_paths=300)
    assert wf2.exposure_paths.shape == meta2["_paths"].shape, "residual paths under a CSA, same grid"
