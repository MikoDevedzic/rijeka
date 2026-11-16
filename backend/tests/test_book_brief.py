"""Book brief: the audit that keeps Prometheus honest, the fact sheet, the route."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from prometheus import book_brief as bb

SHEET = {"valuation_date": "2026-10-29", "generated_at": 0, "trades": 2, "priced": 2, "facts": [
    {"id": "B1", "kind": "book", "label": "Trades in the book", "value": 2, "unit": "trades", "text": "2 trades in the book: 2 confirmed"},
    {"id": "T1", "kind": "trade", "label": "TRD-1 IR_SWAP USD 50,000,000", "value": -1848668.0, "unit": "USD",
     "text": "TRD-1: IR_SWAP USD 50,000,000 vs RIJEKA DEMO BANK AG, confirmed, matures 2031-11-02, NPV -1,848,668 USD, IR01 4,613",
     "extra": {"notional": 50000000.0, "ir01": 4613.0, "currency": "USD"}},
    {"id": "C1", "kind": "curve", "label": "USD 10Y par rate change", "value": 37.4, "unit": "bp",
     "text": "USD_SOFR 10Y moved +37.4 bp from 2026-08-02 to 2026-10-29: 4.276% → 4.650%", "extra": {"from_pct": 4.276, "to_pct": 4.65}},
    {"id": "W1", "kind": "news", "label": "Federal Reserve: Fed holds", "value": None, "unit": "",
     "text": "Federal Reserve reports: Fed holds. The Committee kept the target range unchanged.", "extra": {"url": "https://x", "tags": ["RATES"]}},
]}


def test_audit_keeps_grounded_prose_and_drops_the_rest():
    paragraphs = [
        {"text": "The book holds 2 trades, both confirmed.", "facts": ["B1"]},                                     # ok
        {"text": "TRD-1 is a 50,000,000 USD swap with NPV -1,848,668 USD and IR01 of 4,613.", "facts": ["T1"]},   # ok
        {"text": "The 10Y par rate moved 37.4 bp, from 4.28% to 4.65%.", "facts": ["C1"]},                         # ok, rounded
        {"text": "The book holds 3 trades.", "facts": ["B1"]},                                                      # wrong number
        {"text": "Rates will likely rise further, so you should hedge now.", "facts": ["C1"]},                     # forecast + advice
        {"text": "NPV is -1,848,668 USD.", "facts": []},                                                            # no citation
        {"text": "NPV is -1,848,668 USD.", "facts": ["Z9"]},                                                        # unknown citation
        {"text": "The Fed kept the target range unchanged, which touches TRD-1.", "facts": ["W1", "T1"]},          # ok, no numbers
    ]
    kept, dropped = bb.audit(paragraphs, SHEET)
    assert [k["text"][:12] for k in kept] == ["The book hol", "TRD-1 is a 5", "The 10Y par ", "The Fed kept"]
    reasons = [d["reason"] for d in dropped]
    assert any("number not in the cited facts: 3" in r for r in reasons)
    assert any("forecasting or advisory" in r for r in reasons)
    assert sum("no valid fact citation" in r for r in reasons) == 2


def test_audit_ignores_identifier_digits_and_dates():
    kept, dropped = bb.audit([{"text": "TRD-1 matures on 2031-11-02 and faces RIJEKA DEMO BANK AG.", "facts": ["T1"]},
                              {"text": "Reference TRD-93205226 is not on the sheet, but the sentence has no figure.", "facts": ["T1"]}], SHEET)
    assert len(kept) == 2 and not dropped
    assert bb.NUMBER.findall("TRD-93205226 shows NPV -1,848,668 USD on 2031-11-02, +37.4 bp") == ["-1,848,668", "2031", "37.4"]


def test_audit_accepts_million_rounding_but_not_a_different_figure():
    kept, dropped = bb.audit([{"text": "NPV is about -1,849,000 USD.", "facts": ["T1"]},
                              {"text": "NPV is about -1,900,000 USD.", "facts": ["T1"]}], SHEET)
    assert len(kept) == 1 and "1,849,000" in kept[0]["text"] and "1,900,000" in dropped[0]["text"]


def test_narrate_uses_structured_output_and_fact_ids():
    client = MagicMock()
    client.messages.create.return_value = SimpleNamespace(content=[
        SimpleNamespace(type="thinking", thinking=""),
        SimpleNamespace(type="text", text='{"paragraphs":[{"text":"The book holds 2 trades.","facts":["B1"]}]}')])
    out = bb.narrate(SHEET, client=client)
    assert out == [{"text": "The book holds 2 trades.", "facts": ["B1"]}]
    kw = client.messages.create.call_args.kwargs
    assert kw["output_config"]["format"]["type"] == "json_schema" and kw["output_config"]["effort"] == "low"
    assert "[T1] TRD-1: IR_SWAP" in kw["messages"][0]["content"] and "no forecasts" in kw["system"]


def test_brief_without_a_key_returns_facts_only(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    bb._cache.clear()
    monkeypatch.setattr(bb, "_report_stamp", lambda db, uid: None)
    with patch.object(bb, "fact_sheet", return_value={**SHEET, "trades": 2}):
        out = bb.brief(MagicMock(), {"sub": "u1"})
    assert out["enabled"] is False and out["paragraphs"] == [] and len(out["facts"]) == 4


def test_brief_is_cached_per_user_and_survives_a_model_failure(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    bb._cache.clear()
    monkeypatch.setattr(bb, "_report_stamp", lambda db, uid: None)
    with patch.object(bb, "fact_sheet", return_value={**SHEET, "trades": 2}) as fs, \
         patch.object(bb, "narrate", side_effect=RuntimeError("overloaded")):
        a = bb.brief(MagicMock(), {"sub": "u2"})
        b = bb.brief(MagicMock(), {"sub": "u2"})
    assert a["paragraphs"] == [] and "narration_error" in a and fs.call_count == 1 and b is a


class _Mods:
    def __init__(self, on): self.on = on
    def for_user(self, db, uid): return {"modules": {"MARKET_RISK": self.on}}


def test_where_the_valuation_comes_from(monkeypatch):
    """The stored risk report where there is one; nothing, said so, where one is due and none is stored; the pricers
    only where the firm has market risk off and so has no report to disagree with. The brief never makes a report."""
    import sys
    from risk import report as R
    db = MagicMock()
    stored = {"date": "2026-11-02", "ladder": {"npv_usd": 1.0}, "ladder_rows": []}
    monkeypatch.setitem(sys.modules, "modules", _Mods(True))
    monkeypatch.setattr(R, "stored_report", lambda db, uid, d=None: stored)
    monkeypatch.setattr(R, "report", lambda *a, **k: (_ for _ in ()).throw(AssertionError("the brief must not compute a report")))
    assert bb._risk_report(db, "u") == (stored, bb.REPORT)
    monkeypatch.setattr(R, "stored_report", lambda db, uid, d=None: None)
    assert bb._risk_report(db, "u") == (None, bb.NONE)
    monkeypatch.setattr(R, "stored_report", lambda db, uid, d=None: {"date": None, "note": "No market dates"})
    assert bb._risk_report(db, "u") == (None, bb.NONE)
    # a report stored before it carried its by-trade rows cannot say which trade a figure is of: not read
    monkeypatch.setattr(R, "stored_report", lambda db, uid, d=None: {"date": "2026-10-01", "ladder": {"npv_usd": 1.0}})
    assert bb._risk_report(db, "u") == (None, bb.NONE)
    monkeypatch.setattr(R, "stored_report", lambda db, uid, d=None: (_ for _ in ()).throw(RuntimeError("down")))
    assert bb._risk_report(db, "u") == (None, bb.NONE) and db.rollback.called
    monkeypatch.setitem(sys.modules, "modules", _Mods(False))
    assert bb._risk_report(db, "u") == (None, bb.PRICERS)


def test_a_brief_kept_from_before_a_newer_risk_report_is_not_served_after_it(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    bb._cache.clear()
    stamps = iter(["2026-11-02|08:00", "2026-11-02|08:00", "2026-11-03|08:00"])
    monkeypatch.setattr(bb, "_report_stamp", lambda db, uid: next(stamps))
    with patch.object(bb, "fact_sheet", return_value={**SHEET, "trades": 2}) as fs:
        a = bb.brief(MagicMock(), {"sub": "u3"})
        b = bb.brief(MagicMock(), {"sub": "u3"})            # the same report: the kept brief
        c = bb.brief(MagicMock(), {"sub": "u3"})            # a newer report: made again
    assert b is a and c is not a and fs.call_count == 2 and c["report_stamp"] == "2026-11-03|08:00"


class _Q:
    def __init__(self, rows): self.rows = rows
    def filter(self, *a, **k): return self
    def order_by(self, *a): return self
    def all(self): return self.rows


class _DB:
    """The book as fact_sheet reads it: the trades, no counterparties, no news."""
    def __init__(self, trades): self.trades = trades
    def query(self, model): return _Q(self.trades if model.__name__ == "Trade" else [])
    def execute(self, *a, **k): return SimpleNamespace(all=lambda: [], first=lambda: None)
    def rollback(self): pass


def _trade(n, **kw):
    from datetime import date, datetime, timezone
    base = dict(id=f"id-{n}", trade_ref=f"TRD-{n}", status="CONFIRMED", trade_date=date(2026, 10, 1), notional_ccy="USD", counterparty_id=None,
                instrument_type="IR_SWAP", notional=10_000_000, maturity_date=date(2031, 11, 2), asset_class="RATES",
                last_modified_at=datetime(2026, 10, 1, tzinfo=timezone.utc))
    return SimpleNamespace(**{**base, **kw})


REPORT = {"date": "2026-11-02", "reporting_ccy": "USD", "generated_at": "2026-11-02T22:00:00+00:00", "stored_at": "2026-11-02T22:00:05+00:00",
          "ladder": {"npv_usd": -1_500_000.4, "ir01_usd": 4613.2, "spot01": {"EUR": 1200.0, "JPY": 0.2}, "crybasis01_usd": 38.0,
                     "problems": [{"trade_ref": "TRD-4", "reason": "no curve"}]},
          "ladder_rows": [{"trade_id": "id-1", "trade_ref": "TRD-1", "ccy": "USD", "npv": -1_848_668.2, "ir01": 4613.2, "spot01": {}, "theta": 120.0, "usd_rate": 1.0},
                          {"trade_id": "id-3", "trade_ref": "TRD-3", "ccy": "EUR", "npv": 348_000.0, "ir01": 0.0, "spot01": {"EUR": 1200.0}, "theta": -20.0, "usd_rate": 1.1},
                          {"trade_id": "id-9", "trade_ref": "TRD-9", "ccy": "USD", "npv": 0.6, "ir01": 0.0, "spot01": {}, "theta": None, "usd_rate": 1.0}]}


def _sheet(monkeypatch, source, trades, report=None, price=None):
    monkeypatch.setattr(bb, "_risk_report", lambda db, uid: (report, source))
    monkeypatch.setattr(bb, "_curve_moves", lambda db, ccys: [])
    monkeypatch.setattr(bb, "_price_one", price or (lambda *a, **k: (_ for _ in ()).throw(AssertionError("this brief must not price a trade"))))
    return bb.fact_sheet(_DB(trades), {"sub": "u"})


def test_the_sheet_is_the_stored_report_and_says_how_the_book_has_changed_since(monkeypatch):
    from datetime import datetime, timezone
    trades = [_trade(1), _trade(2),                                                        # in the report; booked since it was made
              _trade(3, notional_ccy="EUR", last_modified_at=datetime(2026, 11, 3, tzinfo=timezone.utc)),      # amended after it was made
              _trade(4)]                                                                    # in it, and not valued by it
    s = _sheet(monkeypatch, bb.REPORT, trades, REPORT)                                      # (TRD-9 is in the report and no longer in the book)
    f = {x["id"]: x for x in s["facts"]}
    assert s["source"] == "risk_report" and s["report_date"] == "2026-11-02" and s["valuation_date"] == "2026-11-02" and s["priced"] == 2
    # the book's figures are the report's own totals, rounded to the unit
    assert f["N_USD"]["value"] == -1_500_000 and f["IR01"]["value"] == 4613 and f["S_EUR"]["value"] == 1200 and "S_JPY" not in f
    assert f["CRYBASIS01"]["value"] == 38 and f["THETA"]["value"] == 98            # 120 x 1.0 - 20 x 1.1
    assert s["totals"] == {"npv": {"USD": -1_500_000}, "ir01": 4613, "spot01": {"EUR": 1200}, "theta": {"USD": 98}}
    # each trade is its row; one the report does not carry has no figure and says which case it is
    assert f["T1"]["value"] == -1_848_668 and "IR01 4,613 USD" in f["T1"]["text"] and "(" not in f["T1"]["text"].split("IR01")[1]
    assert f["T2"]["value"] is None and "not in the risk report of 2026-11-02: booked since" in f["T2"]["text"]
    assert f["T3"]["value"] == 348_000 and f["T3"]["unit"] == "EUR" and "changed since the risk report of 2026-11-02: the figure is as it stood then" in f["T3"]["text"]
    assert f["T4"]["value"] is None and "not valued in the risk report of 2026-11-02: no curve" in f["T4"]["text"]
    # and the sheet says, once, that the totals are of the book as it stood: a trade booked, one changed, one gone
    assert s["report_differs"] == {"booked": 1, "changed": 1, "gone": 1}
    r1 = f["R1"]["text"]
    assert "stored risk report of 2026-11-02 (made 2026-11-02 22:00 UTC)" in r1 and "not a pricing of today" in r1
    assert "1 booked since (TRD-2)" in r1 and "1 changed since (TRD-3)" in r1 and "1 valued in it and no longer live (TRD-9)" in r1
    assert "The totals are of the book as it stood then" in r1
    # a book that has not changed says nothing of the kind
    same = _sheet(monkeypatch, bb.REPORT, [_trade(1), _trade(3, notional_ccy="EUR"), _trade(9)], REPORT)
    assert same["report_differs"] == {} and "changed since" not in next(x for x in same["facts"] if x["id"] == "R1")["text"]


def test_with_no_report_stored_the_sheet_carries_no_valuation_and_prices_nothing(monkeypatch):
    s = _sheet(monkeypatch, bb.NONE, [_trade(1), _trade(2)])
    f = {x["id"]: x for x in s["facts"]}
    assert s["source"] == "none" and s["priced"] == 0 and s["report_date"] is None and s["report_differs"] == {}
    assert all(x["value"] is None for x in s["facts"] if x["kind"] == "trade") and not [x for x in s["facts"] if x["kind"] == "total"]
    assert "No risk report is stored for this book yet" in f["R1"]["text"] and "none valued: no risk report is stored yet" in f["B1"]["text"]
    assert s["totals"] == {"npv": {}, "ir01": None, "spot01": {}, "theta": {}}


def test_with_market_risk_off_the_trades_are_priced_as_before(monkeypatch):
    s = _sheet(monkeypatch, bb.PRICERS, [_trade(1)], price=lambda db, user, t, today: {"npv": -100.4, "npv_ccy": "USD", "ir01": 5.2, "theta": 1.0})
    f = {x["id"]: x for x in s["facts"]}
    assert s["source"] == "pricers" and s["priced"] == 1 and "R1" not in f
    assert f["T1"]["value"] == -100 and f["N_USD"]["value"] == -100 and f["IR01"]["value"] == 5 and "on today's curve" in f["N_USD"]["text"]
    assert s["totals"]["npv"] == {"USD": -100} and s["totals"]["ir01"] == 5


def test_a_date_in_a_fact_is_not_a_figure_the_prose_may_round_to(monkeypatch):
    sheet = {"facts": [{"id": "R1", "kind": "book", "label": "", "value": None, "unit": "",
                        "text": "Valuation figures are the stored risk report of 2026-11-02 (made 2026-11-16 08:30 UTC)"},
                       {"id": "N_USD", "kind": "total", "label": "", "value": -1500000.0, "unit": "USD", "text": "Book NPV -1,500,000 USD in the risk report of 2026-11-02"}]}
    kept, dropped = bb.audit([
        {"text": "The figures are those of the risk report of 2026-11-02.", "facts": ["R1"]},                 # a date as the fact writes it
        {"text": "The figures are those of the risk report of 2 November 2026.", "facts": ["R1"]},             # the same date in words
        {"text": "Book NPV is -1,500,000 USD in that report.", "facts": ["N_USD"]},
        {"text": "Book NPV is 2,030 USD.", "facts": ["R1", "N_USD"]},                                          # near a year: not a figure of the sheet
        {"text": "The book holds 30 trades.", "facts": ["R1"]},                                                # the minutes of a time
        {"text": "The report of 3 November 2026 says so.", "facts": ["R1"]},                                   # another day
    ], sheet)
    assert [k["text"][:28] for k in kept] == ["The figures are those of the", "The figures are those of the", "Book NPV is -1,500,000 USD i"]
    assert [d["reason"] for d in dropped] == ["number not in the cited facts: 2,030", "number not in the cited facts: 30", "number not in the cited facts: 3"]


def test_route_needs_auth():
    import main
    assert TestClient(main.app).get("/api/prometheus/brief").status_code == 401
