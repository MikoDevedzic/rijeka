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


def test_route_needs_auth():
    import main
    assert TestClient(main.app).get("/api/prometheus/brief").status_code == 401
