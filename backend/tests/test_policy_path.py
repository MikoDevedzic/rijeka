"""Policy path: implied monthly overnight rates from a curve, Fed SEP medians, the public route."""
from datetime import date
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from market_data import policy_path as pp

SEP = """<html><table><tr><th>Variable</th><th>Median1</th><th>Central Tendency2</th><th>Range3</th></tr>
<tr><th></th><th>2026</th><th>2027</th><th>2028</th><th>2029</th><th>Longer run</th>
<th>2026</th><th>2027</th><th>2028</th><th>2029</th><th>Longer run</th>
<th>2026</th><th>2027</th><th>2028</th><th>2029</th><th>Longer run</th></tr>
<tr><td>Change in real GDP</td><td>1.6</td><td>1.8</td><td>1.9</td><td>1.8</td><td>1.8</td></tr>
<tr><td>Federal funds rate</td><td>4.1</td><td>3.9</td><td>3.6</td><td>3.2</td><td>3.0</td><td>4.1&ndash;4.4</td><td>3.6&ndash;4.4</td></tr>
</table></html>"""

FLAT = [{"tenor": "ON", "quote_type": "OISDeposit", "rate": 4.0, "enabled": True}] + [
    {"tenor": t, "quote_type": "OIS", "rate": 4.0, "enabled": True} for t in ("1M", "3M", "6M", "1Y", "2Y", "3Y")]


def test_sep_medians_parse():
    d = pp.parse_sep(SEP, "2026-09-16")
    assert d["as_of"] == "2026-09-16"
    assert d["medians"] == [{"label": "2026", "rate": 4.1}, {"label": "2027", "rate": 3.9}, {"label": "2028", "rate": 3.6},
                            {"label": "2029", "rate": 3.2}, {"label": "Longer run", "rate": 3.0}]


def test_flat_par_curve_gives_a_near_flat_overnight_path():
    # The fixture quotes 4 % simple at every tenor, which in compounded terms is a gently
    # declining term structure, so the path drifts a little below par; what matters is that
    # it stays near 4 % and does not kink. test_bootstrap_conventions covers a truly flat market.
    r = pp.implied_path(FLAT, date(2026, 10, 29), basis=360)
    assert r["fixing"] == 4.0 and r["term_structure"] is True and len(r["path"]) == 24
    rates = [p["rate"] for p in r["path"]]
    assert all(3.80 <= x <= 4.02 for x in rates) and max(rates) - min(rates) < 0.15
    assert r["path"][0]["date"] == "2026-11-29" and r["path"][-1]["date"] == "2028-10-29"
    assert set(r["cumulative_bp"]) == {"6M", "12M", "24M"} and all(-20 < v <= 0 for v in r["cumulative_bp"].values())


def test_upward_sloping_curve_prices_hikes():
    up = [{"tenor": "ON", "quote_type": "OISDeposit", "rate": 3.0, "enabled": True}] + [
        {"tenor": t, "quote_type": "OIS", "rate": r, "enabled": True}
        for t, r in (("1M", 3.02), ("3M", 3.1), ("6M", 3.25), ("1Y", 3.5), ("2Y", 3.9), ("3Y", 4.1))]
    r = pp.implied_path(up, date(2026, 10, 29))
    assert r["path"][11]["rate"] > r["path"][5]["rate"] > r["path"][0]["rate"]
    assert r["cumulative_bp"]["12M"] > 40 and r["cumulative_bp"]["24M"] > r["cumulative_bp"]["12M"]


def test_overnight_only_curve_reports_no_term_structure():
    r = pp.implied_path([{"tenor": "ON", "quote_type": "SWAP", "rate": -0.07, "enabled": True}], date(2026, 10, 29))
    assert r == {"fixing": -0.07, "term_structure": False, "path": [], "cumulative_bp": {}, "meetings": []}


def test_add_months_clamps_to_month_end():
    assert pp.add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert pp.add_months(date(2026, 10, 29), 24) == date(2028, 10, 29)


def test_policy_path_route_is_public_cached_and_carries_dots_for_usd():
    import main
    from api.routes import public
    row = MagicMock(valuation_date=date(2026, 10, 29), quotes=FLAT, source="DEMO · test")
    db = MagicMock(); db.execute.return_value.first.return_value = row
    main.app.dependency_overrides[public.get_db] = lambda: db
    public._pp_cache.clear()
    with patch.object(public, "_template_user_id", return_value="uid"), \
         patch.object(pp, "fed_dots", return_value={"as_of": "2026-09-16", "medians": [{"label": "2026", "rate": 4.1}]}):
        c = TestClient(main.app)
        r = c.get("/api/public/policy-path?ccy=usd")
        r2 = c.get("/api/public/policy-path?ccy=USD")
        bad = c.get("/api/public/policy-path?ccy=XXX")
    main.app.dependency_overrides.clear()
    assert r.status_code == 200 and bad.status_code == 404
    b = r.json()
    assert b["ccy"] == "USD" and b["bank"] == "Federal Reserve" and b["as_of"] == "2026-10-29"
    assert len(b["path"]) == 24 and b["dots"]["medians"][0]["rate"] == 4.1 and b["term_structure"] is True
    assert db.execute.call_count == 1 and r2.json() == b             # second call served from the cache


def test_policy_path_route_without_a_snapshot_degrades():
    import main
    from api.routes import public
    db = MagicMock(); db.execute.return_value.first.return_value = None
    main.app.dependency_overrides[public.get_db] = lambda: db
    public._pp_cache.clear()
    with patch.object(public, "_template_user_id", return_value="uid"):
        r = TestClient(main.app).get("/api/public/policy-path?ccy=EUR")
    main.app.dependency_overrides.clear()
    b = r.json()
    assert r.status_code == 200 and b["bank"] == "ECB" and b["path"] == [] and b["as_of"] is None and "dots" not in b


def test_flat_negative_curve_still_bootstraps():
    from market_data import demo_feed as f
    r = pp.implied_path(f.build_chf_saron(-0.068), date(2026, 10, 29))
    assert r["term_structure"] is True and len(r["path"]) == 24
    assert all(-0.25 < p["rate"] < 0.1 for p in r["path"])


def test_meeting_calendars_are_dated_and_ordered():
    from datetime import date as _d
    for ccy, days in pp.MEETINGS.items():
        ds = [_d.fromisoformat(x) for x in days]
        assert ds == sorted(ds) and len(set(ds)) == len(ds), ccy
        assert all(d.weekday() < 5 for d in ds), f"{ccy} has a weekend decision date"
    assert "2026-12-09" in pp.MEETINGS["USD"] and "2026-12-17" in pp.MEETINGS["GBP"] and "2026-12-10" in pp.MEETINGS["CHF"]


def test_upward_sloping_curve_prices_hikes_at_the_next_meetings():
    up = [{"tenor": "ON", "quote_type": "OISDeposit", "rate": 3.0, "enabled": True}] + [
        {"tenor": t, "quote_type": "OIS", "rate": r, "enabled": True}
        for t, r in (("1M", 3.02), ("3M", 3.1), ("6M", 3.25), ("1Y", 3.5), ("2Y", 3.9), ("3Y", 4.1))]
    r = pp.implied_path(up, date(2026, 10, 29), ccy="USD")
    m = r["meetings"]
    assert [x["date"] for x in m] == ["2026-12-09", "2027-01-27", "2027-03-17", "2027-04-28"]   # the next four decisions
    assert all(x["move_bp"] > 0 for x in m) and m[-1]["cumulative_bp"] > m[0]["cumulative_bp"] > 0
    assert m[0]["cumulative_bp"] == m[0]["move_bp"] and abs(m[1]["cumulative_bp"] - (m[0]["move_bp"] + m[1]["move_bp"])) < 0.11
    assert m[0]["move_bp"] > 8                                                     # a 1Y at 3.5 over a 3.0 fixing: hikes priced early
    assert m[0]["steps"] == round(m[0]["move_bp"] / 25.0, 2) and 3.0 < m[0]["implied_rate"] < 3.6


def test_flat_curve_prices_nothing_at_the_meetings_and_no_calendar_means_no_rows():
    r = pp.implied_path(FLAT, date(2026, 10, 29), basis=360, ccy="USD")
    assert all(abs(x["move_bp"]) < 6 for x in r["meetings"]) and len(r["meetings"]) == 4
    assert pp.implied_path(FLAT, date(2026, 10, 29), basis=360)["meetings"] == []            # no currency given
    assert pp.implied_path(FLAT, date(2026, 10, 29), basis=360, ccy="AUD")["meetings"] == []  # no calendar
