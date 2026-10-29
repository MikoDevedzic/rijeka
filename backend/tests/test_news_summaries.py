"""In-app news summaries: feed blurbs, article extraction, the summariser pass, the cron route."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from news import feeds, summarize as sm

RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Fed holds rates, signals patience</title><link>https://www.federalreserve.gov/x</link>
<pubDate>Wed, 29 Oct 2026 18:00:00 GMT</pubDate>
<description><![CDATA[<p>The Committee decided to <b>maintain</b> the target range &amp; noted inflation.</p>]]></description></item>
<item><title>Swap spreads widen</title><link>https://www.risk.net/y</link></item>
</channel></rss>"""

PAGE = """<html><head><title>t</title><style>.x{}</style><script>var a=1;</script></head><body>
<nav>Home | About</nav><header>Press</header>
<article><h1>Statement</h1><p>The Committee decided to maintain the target range for the federal funds rate.</p>
<p>Inflation has moved down &amp; remains somewhat elevated.</p></article>
<footer>Last update</footer></body></html>"""


def test_feed_blurb_is_plain_text_and_tags_use_it():
    items = feeds.parse(RSS, "Federal Reserve")
    assert items[0].description == "The Committee decided to maintain the target range & noted inflation."
    assert "RATES" in items[0].tags                      # 'target range' sits in the blurb, not the title
    assert items[1].description == ""


def test_extract_text_keeps_the_article_and_drops_chrome():
    t = sm.extract_text(PAGE)
    assert t.startswith("Statement")
    assert "maintain the target range" in t and "remains somewhat elevated" in t
    assert "Home | About" not in t and "var a=1" not in t and "Last update" not in t


def _client(reply="Rates unchanged.\nWhy it matters: front-end stays anchored.", stop="end_turn"):
    c = MagicMock()
    c.messages.create.return_value = SimpleNamespace(
        stop_reason=stop,
        content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=reply)])
    return c


def test_summarize_ignores_thinking_blocks_and_refuses_a_cut_off_answer():
    assert sm.summarize("t", "ECB", "x" * 100, "feed", client=_client()).startswith("Rates unchanged.")
    kw = _client().messages.create
    sm.summarize("t", "ECB", "x" * 100, "feed", client=(c := _client()))
    kw = c.messages.create.call_args.kwargs
    assert kw["max_tokens"] >= 2000 and kw["output_config"] == {"effort": "low"}
    import pytest
    with pytest.raises(RuntimeError):
        sm.summarize("t", "ECB", "x" * 100, "feed", client=_client(stop="max_tokens"))
    with pytest.raises(RuntimeError):
        sm.summarize("t", "ECB", "x" * 100, "feed", client=_client(reply=""))


def test_summarize_pending_uses_the_article_for_public_bodies_and_the_blurb_for_the_press(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    rows = [
        SimpleNamespace(id="a", url="https://www.federalreserve.gov/x", title="Fed holds", source="Federal Reserve",
                        description="short", message_id="m1"),
        SimpleNamespace(id="b", url="https://www.ft.com/z", title="Gilts rally", source="FT",
                        description="Gilts rallied after the Bank of England signalled a slower path of rate rises than markets had priced.",
                        message_id=None),
        SimpleNamespace(id="c", url="https://www.ft.com/q", title="Tiny", source="FT", description="", message_id="m3"),
    ]
    db = MagicMock(); db.execute.return_value.all.return_value = rows
    http = MagicMock(); http.get.return_value = SimpleNamespace(text=PAGE, headers={"content-type": "text/html"},
                                                                raise_for_status=lambda: None)
    client = _client()
    out = sm.summarize_pending(db, limit=10, client=client, http=http)
    assert out == {"done": 2, "skipped": 1, "failed": 0, "disabled": False}
    bases = [c.kwargs["messages"][0]["content"] for c in client.messages.create.call_args_list]
    assert "Full article text" in bases[0] and "maintain the target range" in bases[0]
    assert "feed blurb only" in bases[1] and "Gilts rallied" in bases[1]
    assert http.get.call_count == 1                                     # the FT page is never fetched
    sqls = [str(c.args[0]) for c in db.execute.call_args_list]
    assert sum("SET summary = :s" in s for s in sqls) == 2
    assert sum("UPDATE chat_messages SET card" in s for s in sqls) == 1   # only the row with a message
    assert sum("SET summarized_at = now() WHERE id" in s for s in sqls) == 1   # nothing to summarise: marked, not retried
    assert db.commit.called


def test_summarize_pending_leaves_an_item_for_next_time_when_the_model_fails(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    rows = [SimpleNamespace(id="b", url="https://www.ft.com/z", title="Gilts rally", source="FT",
                            description="x" * 100, message_id=None)]
    db = MagicMock(); db.execute.return_value.all.return_value = rows
    client = MagicMock(); client.messages.create.side_effect = RuntimeError("overloaded")
    out = sm.summarize_pending(db, client=client, http=MagicMock())
    assert out["failed"] == 1 and out["done"] == 0
    assert not any("SET summary" in str(c.args[0]) for c in db.execute.call_args_list)


def test_summaries_are_off_without_a_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    db = MagicMock()
    assert sm.summarize_pending(db)["disabled"] is True
    db.execute.assert_not_called()


def test_summarize_route_needs_the_cron_secret(monkeypatch):
    import main
    monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
    c = TestClient(main.app)
    assert c.post("/api/news/summarize").status_code == 403
    from api.routes import news as nr
    db = MagicMock()
    main.app.dependency_overrides[nr.get_db] = lambda: db
    with patch.object(nr._summarize, "summarize_pending", return_value={"done": 3, "skipped": 0, "failed": 0, "disabled": False}) as sp:
        r = c.post("/api/news/summarize?limit=5", headers={"X-Rijeka-Cron": "s3cret"})
    main.app.dependency_overrides.clear()
    assert r.status_code == 200 and r.json()["done"] == 3
    assert sp.call_args.kwargs["limit"] == 5
