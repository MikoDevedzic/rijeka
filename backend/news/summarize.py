"""
In-app summaries for the NEWS room.

Each headline gets two or three sentences in Rijeka's own words plus one line
on why a rates, FX or crypto desk should care, so a reader can stay on the
desk and still know what happened. The original is always linked.

What the summary is built from depends on who published it:

  * public bodies (central banks, regulators, ISDA) publish for distribution,
    so the article page is fetched and the summary covers the whole text
    (`summary_basis = 'article'`);
  * commercial publishers forbid automated access in their terms and often
    paywall, so only the headline and the blurb their own feed carries are used
    (`summary_basis = 'feed'`), and the card says so.

Nothing is ever quoted; the model is told to paraphrase. Without an
ANTHROPIC_API_KEY the summariser is a no-op and the cards show headlines only.
"""
from __future__ import annotations

import html
import logging
import os
import re
from typing import Optional

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger("rijeka.news.summarize")

# Sources whose pages may be fetched in full. Everything else is feed-only.
OPEN_SOURCES = {"Federal Reserve", "ECB", "Bank of England", "SEC", "ISDA"}

MODEL = os.getenv("RIJEKA_NEWS_MODEL", "claude-haiku-5-5")
MAX_ARTICLE_CHARS = 9000
MIN_BASIS_CHARS = 60          # below this there is nothing to summarise beyond the title
UA = {"User-Agent": "Rijeka-news/0.1 (+https://rijeka.app)"}

SYSTEM = (
    "You write brief, factual summaries of financial news for an OTC derivatives desk "
    "(rates, FX, crypto). Paraphrase in your own words; never quote the text. Say only what the "
    "text says: no speculation, no advice. Format: two or three sentences, then a new line starting "
    "'Why it matters:' with one sentence for a trader. If you are given only a headline and a short "
    "blurb, summarise just that and keep it to one or two sentences. Plain text, no markdown, no lists."
)


def enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY")) and os.getenv("RIJEKA_NEWS_SUMMARIES", "1").strip().lower() not in ("0", "false", "no", "off")


# ── article text ───────────────────────────────────────────────────────────────

_DROP = re.compile(r"<(script|style|nav|header|footer|aside|form|noscript|svg)\b.*?</\1\s*>", re.S | re.I)
_TAGS = re.compile(r"<[^>]+>")


def extract_text(page: str) -> str:
    """Main text of an HTML page: <article> or <main> if present, else the body, tags stripped."""
    page = _DROP.sub(" ", page)
    m = re.search(r"<article\b.*?</article\s*>", page, re.S | re.I) or re.search(r"<main\b.*?</main\s*>", page, re.S | re.I)
    body = m.group(0) if m else page
    body = re.sub(r"</(p|div|h\d|li|br|tr|section)\s*>", "\n", body, flags=re.I)
    txt = html.unescape(_TAGS.sub(" ", body))
    txt = re.sub(r"[ \t\r\f\v]+", " ", txt)
    txt = re.sub(r"\s*\n\s*", "\n", txt).strip()
    return txt[:MAX_ARTICLE_CHARS]


def fetch_article_text(url: str, timeout: float = 10.0, client: Optional[httpx.Client] = None) -> str:
    own = client is None
    c = client or httpx.Client(timeout=timeout, follow_redirects=True, headers=UA)
    try:
        r = c.get(url)
        r.raise_for_status()
        if "html" not in (r.headers.get("content-type") or "").lower():
            return ""
        return extract_text(r.text)
    finally:
        if own:
            c.close()


# ── the model ──────────────────────────────────────────────────────────────────

def summarize(title: str, source: str, basis_text: str, basis: str, client=None) -> str:
    """Two or three sentences plus a 'Why it matters' line. Raises on API failure."""
    if client is None:
        import anthropic
        client = anthropic.Anthropic()
    what = "Full article text" if basis == "article" else "Headline and the publisher's feed blurb only"
    user = f"Source: {source}\nTitle: {title}\n{what}:\n\n{basis_text.strip()}"
    resp = client.messages.create(model=MODEL, max_tokens=320, system=SYSTEM,
                                  messages=[{"role": "user", "content": user}])
    out = "".join(getattr(b, "text", "") for b in resp.content).strip()
    return out[:1200]


# ── the pass over pending items ────────────────────────────────────────────────

def pending(db: Session, limit: int, days: int = 7) -> list:
    return db.execute(text("""
        SELECT id, url, title, source, description, message_id FROM news_items
        WHERE summary IS NULL AND summarized_at IS NULL
          AND coalesce(published_at, created_at) > now() - make_interval(days => :d)
        ORDER BY coalesce(published_at, created_at) DESC LIMIT :n"""), {"d": days, "n": limit}).all()


def summarize_pending(db: Session, limit: int = 12, client=None, http: Optional[httpx.Client] = None) -> dict:
    """Summarise up to `limit` unsummarised recent items. Items with nothing to summarise are
    marked so they are not retried; a model or network failure leaves the item for next time."""
    out = {"done": 0, "skipped": 0, "failed": 0, "disabled": not enabled()}
    if out["disabled"]:
        return out
    own_http = http is None
    http = http or httpx.Client(timeout=10.0, follow_redirects=True, headers=UA)
    try:
        for row in pending(db, limit):
            basis, basis_text = "feed", (row.description or "")
            if row.source in OPEN_SOURCES:
                try:
                    art = fetch_article_text(row.url, client=http)
                    if len(art) >= MIN_BASIS_CHARS:
                        basis, basis_text = "article", art
                except Exception as e:      # noqa: BLE001 — fall back to the feed blurb
                    log.info("news: article fetch failed for %s: %s", row.url[:80], str(e)[:100])
            if len(basis_text.strip()) < MIN_BASIS_CHARS:
                db.execute(text("UPDATE news_items SET summarized_at = now() WHERE id = :i"), {"i": row.id})
                out["skipped"] += 1
                continue
            try:
                summary = summarize(row.title, row.source, basis_text, basis, client=client)
            except Exception as e:      # noqa: BLE001 — leave it for the next tick
                log.warning("news: summary failed for %s: %s", row.url[:80], str(e)[:160])
                out["failed"] += 1
                continue
            db.execute(text("UPDATE news_items SET summary = :s, summary_basis = :b, summarized_at = now() WHERE id = :i"),
                       {"s": summary, "b": basis, "i": row.id})
            if row.message_id is not None:
                db.execute(text("UPDATE chat_messages SET card = coalesce(card, '{}'::jsonb) || jsonb_build_object("
                                "'summary', cast(:s as text), 'summary_basis', cast(:b as text)) WHERE id = :m"),
                           {"s": summary, "b": basis, "m": row.message_id})
            out["done"] += 1
        db.commit()
    finally:
        if own_http:
            http.close()
    return out
