"""P&L: tenor buckets, the step-wise blend, the roll-up, the bucket totals, sign-off state and the route guards."""
from pnl import explain as E
from pnl import report as R


def test_tenor_years_and_buckets():
    assert E.tenor_years("ON") == 0 and E.tenor_years("6M") == 0.5 and E.tenor_years("2Y") == 2 and E.tenor_years("1W") == 1 / 52
    assert [b[0] for b in E.BUCKETS] == ["0-1Y", "1-5Y", "5-10Y", "10Y+"]


def test_bucket_blend_moves_only_the_bucket_and_adds_new_tenors():
    cur = [{"tenor": "ON", "rate": 4.0}, {"tenor": "1Y", "rate": 4.1}, {"tenor": "2Y", "rate": 4.2}, {"tenor": "10Y", "rate": 4.5}]
    tgt = [{"tenor": "ON", "rate": 3.9}, {"tenor": "1Y", "rate": 4.0}, {"tenor": "2Y", "rate": 4.3}, {"tenor": "5Y", "rate": 4.4}, {"tenor": "10Y", "rate": 4.6}]
    out = {q["tenor"]: q["rate"] for q in E._bucket_quotes(cur, tgt, 1.0001, 5.0001)}
    assert out == {"ON": 4.0, "1Y": 4.1, "2Y": 4.3, "5Y": 4.4, "10Y": 4.5}      # 1Y sits in 0-1Y, so it stays


def _row(ref, desk, book, kind, rows, ccy="USD"):
    usd = sum(r["usd"] for r in rows)
    return {"trade_id": ref, "trade_ref": ref, "desk": desk, "book": book, "kind": kind, "ccy": ccy, "mark": 1.0, "mark_prev": 0.0, "instrument": "IR_SWAP",
            "rows": rows, "total_by_ccy": {ccy: usd}, "usd": usd,
            "market_usd": sum(r["usd"] for r in rows if E.GROUP[r["bucket"]] == "MARKET"), "trading_usd": sum(r["usd"] for r in rows if E.GROUP[r["bucket"]] == "TRADING")}


def test_rollup_and_buckets_split_market_from_trading():
    rows = [_row("A", "RATES", "G10", "EXPLAINED", [{"bucket": "CARRY", "label": "Theta", "ccy": "USD", "pnl": -10, "usd": -10},
                                                    {"bucket": "RATES", "label": "USD_SOFR 1-5Y", "ccy": "USD", "pnl": 120, "usd": 120}]),
            _row("B", "RATES", "G10", "NEW", [{"bucket": "NEW", "label": "New trade", "ccy": "USD", "pnl": 50, "usd": 50}]),
            _row("C", "FX", "SPOT", "EXPLAINED", [{"bucket": "FX", "label": "EURUSD spot", "ccy": "USD", "pnl": -30, "usd": -30}])]
    tree = R.rollup(rows)
    assert tree["usd"] == 130 and tree["market_usd"] == 80 and tree["trading_usd"] == 50 and tree["count"] == 3
    assert [d["name"] for d in tree["children"]] == ["FX", "RATES"]
    rates = next(d for d in tree["children"] if d["name"] == "RATES")
    assert rates["usd"] == 160 and rates["children"][0]["name"] == "G10" and len(rates["children"][0]["children"]) == 2
    b = {x["bucket"]: x for x in R.buckets(rows)}
    assert list(b) == ["CARRY", "RATES", "FX", "NEW"] and b["RATES"]["usd"] == 120 and b["RATES"]["detail"] == [{"label": "USD_SOFR 1-5Y", "usd": 120}]
    assert b["NEW"]["group"] == "TRADING" and b["CARRY"]["group"] == "MARKET"


def test_signoff_status():
    assert R.status_of([]) == "OPEN"
    assert R.status_of([{"role": "TRADER"}]) == "TRADER_SIGNED"
    assert R.status_of([{"role": "CONTROLLER"}]) == "CONTROLLER_SIGNED"
    assert R.status_of([{"role": "TRADER"}, {"role": "CONTROLLER"}]) == "FINAL"


def test_fx_to_usd_uses_either_quoting_direction():
    class M:
        def spot(self, pair): return {"EURUSD": 1.1, "USDJPY": 150.0}.get(pair)
    assert R.fx_to_usd(M(), "USD") == 1.0 and R.fx_to_usd(M(), "EUR") == 1.1 and abs(R.fx_to_usd(M(), "JPY") - 1 / 150) < 1e-12 and R.fx_to_usd(M(), "XYZ") is None


def test_routes_need_auth_or_cron_secret():
    import main
    from fastapi.testclient import TestClient
    c = TestClient(main.app)
    assert c.get("/api/pnl/report").status_code == 401 and c.get("/api/pnl/summary").status_code == 401
    assert c.post("/api/pnl/eod/tick").status_code == 403
    assert c.post("/api/pnl/signoff", json={"date": "2026-10-29", "role": "TRADER"}).status_code == 401
