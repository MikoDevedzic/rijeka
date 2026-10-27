"""NEWS room: feed parsing, tagging, cron auth, read-only posting."""
import os
from unittest.mock import MagicMock

import pytest

RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>Fed</title>
<item><title>Federal Reserve issues FOMC statement</title><link>https://www.federalreserve.gov/x/1.htm</link>
<pubDate>Mon, 27 Oct 2026 18:00:00 GMT</pubDate></item>
<item><title>  Minutes of the   Board   </title><link>https://www.federalreserve.gov/x/2.htm</link><pubDate>garbage</pubDate></item>
<item><title>no link</title></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>ISDA</title>
<entry><title>ISDA publishes SIMM 2.8 margin methodology</title>
<link rel="alternate" href="https://www.isda.org/a/simm"/><link rel="self" href="https://www.isda.org/self"/>
<published>2026-10-26T09:30:00Z</published><id>urn:x</id></entry></feed>"""


def test_parse_rss_and_atom():
    from news.feeds import parse
    rss = parse(RSS, "Federal Reserve")
    assert [i.title for i in rss] == ["Federal Reserve issues FOMC statement", "Minutes of the Board"]
    assert rss[0].url.endswith("/1.htm") and rss[0].published_at.year == 2026 and rss[0].published_at.tzinfo
    assert rss[1].published_at is None                      # bad date → None, item kept
    atom = parse(ATOM, "ISDA")
    assert len(atom) == 1 and atom[0].url == "https://www.isda.org/a/simm"   # alternate link, not self
    assert atom[0].published_at.hour == 9 and "REGULATION" in atom[0].tags


def test_parse_garbage_is_empty():
    from news.feeds import parse
    assert parse(b"<html>not a feed", "x") == [] and parse(b"", "x") == []


def test_tags():
    from news.feeds import tag
    assert tag("Fed holds rates, signals cut as Treasury yields fall") == ("RATES",)
    assert set(tag("ISDA SIMM margin update for cleared swaps")) >= {"REGULATION", "DERIVATIVES"}
    assert tag("Bitcoin tops $100k") == ("CRYPTO",)
    assert tag("Company announces new CEO") == ()


def test_fetch_survives_a_dead_feed(monkeypatch):
    from news import feeds
    class R:
        def __init__(self, content, ok=True): self.content, self.ok = content, ok
        def raise_for_status(self):
            if not self.ok: raise RuntimeError("500")
    class C:
        def get(self, url): return R(RSS) if "fed" in url else R(b"", ok=False)
    items = feeds.fetch([("Federal Reserve", "https://fed/x"), ("Dead", "https://dead/x")], client=C())
    assert len(items) == 2 and all(i.source == "Federal Reserve" for i in items)


def test_tick_requires_secret(monkeypatch):
    from fastapi.testclient import TestClient
    from main import app
    from db.session import get_db
    app.dependency_overrides[get_db] = lambda: MagicMock()
    try:
        c = TestClient(app)
        monkeypatch.delenv("RIJEKA_CRON_SECRET", raising=False)
        assert c.post("/api/news/tick", headers={"X-Rijeka-Cron": "anything"}).status_code == 403   # unset → never callable
        monkeypatch.setenv("RIJEKA_CRON_SECRET", "s3cret")
        assert c.post("/api/news/tick").status_code == 403
        assert c.post("/api/news/tick", headers={"X-Rijeka-Cron": "wrong"}).status_code == 403
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_humans_cannot_post_in_news_room():
    from fastapi import HTTPException
    from api.routes import chat
    db = MagicMock()
    room = MagicMock(kind="NEWS")
    me = MagicMock(); firm = MagicMock(kind="OTHER")
    chat._my_firm = lambda db, user: (me, firm)       # type: ignore[assignment]
    chat._room_for = lambda db, rid, me, need: (room, "JOINED")   # type: ignore[assignment]
    body = MagicMock(body="hello")
    with pytest.raises(HTTPException) as e:
        chat.post_message("r", body, MagicMock(), db=db, user={"sub": "x"})
    assert e.value.status_code == 403 and "read-only" in e.value.detail
