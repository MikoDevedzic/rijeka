"""
Public headline feeds for the NEWS room.

Headlines, links and the blurb each feed publishes. Article text is fetched
only for public bodies, by news/summarize.py; commercial publishers' licences
bite there, and a link back is what they want anyway.
Parsing is stdlib (RSS 2.0 and Atom); fetching is httpx with a short timeout
per feed, so one slow publisher cannot stall the tick.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Iterable, Optional

import httpx

log = logging.getLogger("rijeka.news")

# (source label, url). Order is roughly "official first".
FEEDS: list[tuple[str, str]] = [
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("ECB",             "https://www.ecb.europa.eu/rss/press.html"),
    ("Bank of England", "https://www.bankofengland.co.uk/rss/news"),
    ("SEC",             "https://www.sec.gov/news/pressreleases.rss"),
    ("ISDA",            "https://www.isda.org/feed/"),
    ("Risk.net",        "https://www.risk.net/feeds/rss"),
    ("Bloomberg Markets", "https://www.bloomberg.com/feeds/markets/news.rss"),
    ("FT",              "https://www.ft.com/rss/home"),
    ("MarketWatch",     "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
]

# Tag rules: first match per group wins; an item can carry several tags.
TAG_RULES: list[tuple[str, re.Pattern]] = [
    ("RATES",      re.compile(r"\b(fomc|fed funds|rate (decision|cut|hike|path)|interest rates?|treasur(y|ies)|yields?|sofr|€str|estr|sonia|euribor|bund|gilt|curve|inflation|cpi|pce|payrolls|jobs report|central bank|ecb|boe|bank of england|federal reserve|powell|lagarde|bailey|qt|quantitative)\b", re.I)),
    ("CREDIT",     re.compile(r"\b(credit|spreads?|default|downgrade|upgrade|high[- ]yield|investment[- ]grade|cds|bond sale|issuance)\b", re.I)),
    ("FX",         re.compile(r"\b(dollar|euro|yen|sterling|pound|swiss franc|fx|currenc(y|ies)|exchange rate)\b", re.I)),
    ("REGULATION", re.compile(r"\b(margin|umr|simm|basel|clearing|ccp|emir|dodd[- ]frank|mifid|capital requirement|regulat(or|ion|ory)|sec |cftc|esma|isda|reporting)\b", re.I)),
    ("CRYPTO",     re.compile(r"\b(bitcoin|ether(eum)?|crypto|stablecoin|digital asset|token)\b", re.I)),
    ("DERIVATIVES",re.compile(r"\b(swaps?|swaptions?|options?|futures|derivatives?|hedg(e|ing)|volatility|xva|cva)\b", re.I)),
]


@dataclass(frozen=True)
class Item:
    source: str
    title: str
    url: str
    published_at: Optional[datetime]
    tags: tuple[str, ...]
    description: str = ""          # the feed's own blurb, HTML stripped, capped


_HTML_TAG = re.compile(r"<[^>]+>")


def blurb(raw: str, cap: int = 1500) -> str:
    """A feed description/summary/content as plain text."""
    import html as _html
    t = _html.unescape(_HTML_TAG.sub(" ", raw or ""))
    return re.sub(r"\s+", " ", t).strip()[:cap]


def tag(title: str) -> tuple[str, ...]:
    return tuple(t for t, rx in TAG_RULES if rx.search(title or ""))


def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    s = s.strip()
    try:
        d = parsedate_to_datetime(s)                      # RFC 2822 (RSS)
    except (TypeError, ValueError, IndexError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))   # ISO 8601 (Atom)
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _text(el: Optional[ET.Element]) -> str:
    return (el.text or "").strip() if el is not None else ""


def _strip(ns_tag: str) -> str:
    return ns_tag.rsplit("}", 1)[-1]


def parse(xml_bytes: bytes, source: str) -> list[Item]:
    """RSS 2.0 <item> or Atom <entry>. Unknown shapes yield nothing, never raise."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        log.warning("news: %s unparseable: %s", source, e)
        return []
    out: list[Item] = []
    for node in root.iter():
        kind = _strip(node.tag)
        if kind not in ("item", "entry"):
            continue
        fields = {_strip(c.tag): c for c in node}
        title = re.sub(r"\s+", " ", _text(fields.get("title")))
        if kind == "item":
            url = _text(fields.get("link")) or _text(fields.get("guid"))
            when = _parse_date(_text(fields.get("pubDate")) or _text(fields.get("date")))
            desc = blurb(_text(fields.get("description")) or _text(fields.get("encoded")))
        else:
            link = next((c for c in node if _strip(c.tag) == "link" and c.get("rel") in (None, "alternate")), None)
            url = (link.get("href") if link is not None else "") or _text(fields.get("id"))
            when = _parse_date(_text(fields.get("published")) or _text(fields.get("updated")))
            desc = blurb(_text(fields.get("summary")) or _text(fields.get("content")))
        url = (url or "").strip()
        if not title or not url.startswith("http"):
            continue
        out.append(Item(source, title[:300], url[:2000], when, tag(title + " " + desc), desc))
    return out


def fetch(feeds: Iterable[tuple[str, str]] = FEEDS, *, timeout: float = 10.0,
          client: Optional[httpx.Client] = None) -> list[Item]:
    """Every item from every feed that answered; a failing feed is logged and skipped."""
    own = client is None
    c = client or httpx.Client(timeout=timeout, follow_redirects=True,
                               headers={"User-Agent": "Rijeka-news/0.1 (+https://rijeka.app)"})
    items: list[Item] = []
    try:
        for source, url in feeds:
            try:
                r = c.get(url)
                r.raise_for_status()
                items.extend(parse(r.content, source))
            except Exception as e:  # network, 4xx/5xx, parse — keep going
                log.warning("news: %s failed: %s", source, str(e)[:120])
    finally:
        if own:
            c.close()
    return items
