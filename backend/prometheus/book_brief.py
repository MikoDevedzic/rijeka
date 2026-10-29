"""
The book brief: Prometheus narrates the book, but never originates a number.

    facts = fact_sheet(db, user, today)      # the engine's numbers, each with an id
    brief = narrate(facts)                   # structured prose bound to fact ids
    kept, dropped = audit(brief, facts)      # sentences the sheet cannot back are removed

The fact sheet is computed by the same pricers the blotter uses: NPV and IR01
per trade on today's curve, totals by currency, the move in the demo curves
since the previous snapshot, pending confirmations, maturities within a
month, CSA terms by counterparty, and the summarised news tagged to what the
book holds. Prometheus is asked for short paragraphs, each citing fact ids,
through structured output. The audit then checks every number in the prose
against the sheet (within rounding), requires at least one valid citation,
and rejects forecasting or advisory language. Whatever fails is dropped and
counted. The page shows the sheet beside the prose, so any sentence can be
checked in one click.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger("rijeka.book_brief")

MODEL = os.getenv("RIJEKA_BRIEF_MODEL", "claude-opus-5-5")
MAX_PRICED = 20                       # trades priced per brief; the rest are listed, not priced
CACHE_SECONDS = 3600
NEWS_HOURS = 48
CLASS_TAG = {"RATES": "RATES", "FX": "FX", "CRYPTO": "CRYPTO", "CREDIT": "CREDIT"}

FORBIDDEN = re.compile(
    r"\b(will|would|expect(?:s|ed|ation)?|forecast(?:s|ed)?|predict(?:s|ed|ion)?|should|recommend(?:s|ed|ation)?|"
    r"likely|unlikely|going to|outlook|bullish|bearish|buy|sell|hedge now|opportunit(?:y|ies))\b", re.I)
# A figure in prose. Not the digits of an identifier such as TRD-93205226 or a date's month and day.
NUMBER = re.compile(r"(?<![\w.-])-?\d+(?:,\d{3})*(?:\.\d+)?(?!\d)")

SYSTEM = (
    "You are Prometheus, the read-only analyst on an OTC derivatives desk. You are given a fact sheet: "
    "numbered facts computed by the desk's own pricing engine and its news feed. Write a short brief of the "
    "book for the trader, in plain prose, two to four paragraphs, each paragraph citing the ids of the facts "
    "it rests on. Rules: use only numbers that appear in the facts, copied as given (you may round to the "
    "same or fewer decimals); say what is, never what will be: no forecasts, no advice, no 'should'; if the "
    "sheet is thin, say so in one sentence rather than padding; name trades by their reference; keep each "
    "paragraph under 90 words. Where a news fact is linked to a position, say what the article reports and "
    "which position it touches, nothing more."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "paragraphs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "facts": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["text", "facts"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["paragraphs"],
    "additionalProperties": False,
}


@dataclass
class Fact:
    id: str
    kind: str                 # book | trade | total | curve | pending | maturity | csa | news
    label: str
    value: Optional[float] = None
    unit: str = ""
    text: str = ""
    extra: dict = field(default_factory=dict)

    def numbers(self) -> list[float]:
        out = [self.value] if self.value is not None else []
        out += [v for v in self.extra.values() if isinstance(v, (int, float)) and not isinstance(v, bool)]
        return out

    def as_dict(self) -> dict:
        return {"id": self.id, "kind": self.kind, "label": self.label, "value": self.value, "unit": self.unit,
                "text": self.text, **({"extra": self.extra} if self.extra else {})}


def enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY")) and os.getenv("RIJEKA_BOOK_BRIEF", "1").strip().lower() not in ("0", "false", "no", "off")


# ── the fact sheet ──────────────────────────────────────────────────────────────

def _price_one(db: Session, user: dict, trade, today: date) -> dict:
    from api.routes.currencies import CURRENCY_INSTRUMENTS, price_booked
    from api.routes.pricer import CurveInput, PriceRequest, price_trade
    if str(trade.instrument_type or "").upper() in CURRENCY_INSTRUMENTS:
        return price_booked(trade, db, user, today)
    ids = [c for c in dict.fromkeys([trade.discount_curve_id, trade.forecast_curve_id]) if c] or ["USD_SOFR"]
    curves = [CurveInput(curve_id=c, quotes=[]) for c in ids]          # empty quotes: the saved snapshot is used
    return price_trade(PriceRequest(trade_id=str(trade.id), valuation_date=today, curves=curves), db, user)


def _curve_moves(db: Session, ccys: set[str]) -> list[Fact]:
    """2Y and 10Y change between the two latest public-source snapshots of each currency's curve."""
    from api.routes.demo import _template_user_id
    from market_data.policy_path import CCY
    uid = _template_user_id(db)
    out: list[Fact] = []
    if uid is None:
        return out
    for ccy in sorted(ccys):
        meta = CCY.get(ccy)
        if not meta:
            continue
        rows = db.execute(text(
            "SELECT valuation_date, quotes FROM market_data_snapshots WHERE user_id = :u AND curve_id = :c "
            "AND upper(coalesce(source,'')) NOT LIKE 'BLOOMBERG%' ORDER BY valuation_date DESC LIMIT 2"),
            {"u": uid, "c": meta["curve"]}).all()
        if len(rows) < 2:
            continue
        def q(quotes, tenor):
            return next((float(x["rate"]) for x in (quotes or []) if x.get("tenor") == tenor and x.get("rate") is not None), None)
        new, old = rows[0], rows[1]
        for tenor in ("2Y", "10Y"):
            a, b = q(old.quotes, tenor), q(new.quotes, tenor)
            if a is None or b is None:
                continue
            out.append(Fact(f"C{len(out) + 1}", "curve", f"{ccy} {tenor} par rate change", round((b - a) * 100, 1), "bp",
                            f"{meta['curve']} {tenor} moved {round((b - a) * 100, 1):+} bp from {old.valuation_date} to {new.valuation_date}: {a:.3f}% → {b:.3f}%",
                            {"from_pct": round(a, 3), "to_pct": round(b, 3)}))
    return out


def _r0(v: float) -> float:
    """Round to the unit without a negative zero (-0.3 -> 0, not -0)."""
    return round(v, 0) or 0.0


def fact_sheet(db: Session, user: dict, today: Optional[date] = None) -> dict:
    """Every number the brief may use, computed by the engine; nothing here comes from a model."""
    from db.models import Counterparty, Trade
    today = today or date.today()
    uid = user["sub"]
    trades = db.query(Trade).filter(Trade.user_id == uid, Trade.status.in_(("LIVE", "PENDING", "CONFIRMED"))) \
        .order_by(Trade.trade_date.desc().nullslast()).all()
    facts: list[Fact] = []
    by_status: dict[str, int] = {}
    for t in trades:
        by_status[t.status or "?"] = by_status.get(t.status or "?", 0) + 1
    facts.append(Fact("B1", "book", "Trades in the book", len(trades), "trades",
                      f"{len(trades)} trades in the book" + (": " + ", ".join(f"{v} {k.lower()}" for k, v in sorted(by_status.items())) if trades else ""),
                      {k.lower(): v for k, v in by_status.items()}))

    cps = {str(c.id): c for c in db.query(Counterparty).filter(Counterparty.user_id == uid).all()} if trades else {}
    totals: dict[str, float] = {}
    ir01_total = 0.0
    spot01: dict[str, float] = {}          # FX01 / BTC01 by base asset, PV for +1 % spot
    theta: dict[str, float] = {}           # one-day carry by currency
    ccys: set[str] = set()
    priced = 0
    for i, t in enumerate(trades, 1):
        ccy = (t.notional_ccy or "USD").upper()
        ccys.add(ccy)
        cp = cps.get(str(t.counterparty_id))
        label = f"{t.trade_ref} {t.instrument_type} {ccy} {float(t.notional or 0):,.0f}"
        extra: dict[str, Any] = {"notional": float(t.notional or 0), "currency": ccy, "instrument": t.instrument_type,
                                 "counterparty": cp.name if cp else None, "status": t.status,
                                 "maturity": t.maturity_date.isoformat() if t.maturity_date else None}
        npv, npv_ccy, why = None, ccy, None
        if priced < MAX_PRICED:
            try:
                p = _price_one(db, user, t, today)
                npv = p.get("npv")
                npv_ccy = (p.get("npv_ccy") or ccy).upper()
                if p.get("ir01") is not None:
                    extra["ir01"] = round(float(p["ir01"]), 0)
                    ir01_total += float(p["ir01"])
                if npv is not None:
                    npv = round(float(npv), 0)
                    totals[npv_ccy] = totals.get(npv_ccy, 0.0) + npv
                if p.get("spot01") is not None:
                    base = str(p.get("base_currency") or ccy).upper()
                    spot01[base] = spot01.get(base, 0.0) + float(p["spot01"])
                    extra["spot01"] = round(float(p["spot01"]), 0)
                if p.get("theta") is not None:
                    theta[npv_ccy] = theta.get(npv_ccy, 0.0) + float(p["theta"])
                priced += 1
            except Exception as e:      # noqa: BLE001 — a trade that will not price is still listed
                detail = getattr(e, "detail", None) or str(e)
                why = "mirror of the counterparty's booking, no legs to price" if "no legs" in str(detail).lower() else "not priced"
                log.info("brief: %s did not price: %s", t.trade_ref, str(detail)[:120])
                extra["pricing"] = why
        txt = (f"{t.trade_ref}: {t.instrument_type} {ccy} {float(t.notional or 0):,.0f} vs {extra['counterparty'] or 'n/a'}, "
               f"{(t.status or '').lower()}, matures {extra['maturity'] or 'n/a'}"
               + (f", NPV {npv:,.0f} {npv_ccy}" if npv is not None else "")
               + (f", IR01 {extra['ir01']:,.0f}" if "ir01" in extra else "")
               + (f" ({why})" if why else ""))
        extra["npv_ccy"] = npv_ccy if npv is not None else None
        facts.append(Fact(f"T{i}", "trade", label, npv, npv_ccy if npv is not None else "", txt, extra))

    facts[0].extra["priced"] = priced
    facts[0].text += f"; {priced} of {len(trades)} priced on today's curve" if trades else ""
    for ccy, v in sorted(totals.items()):
        facts.append(Fact(f"N_{ccy}", "total", f"Book NPV in {ccy}", round(v, 0), ccy, f"Book NPV {round(v):,} {ccy} on today's curve"))
    if ir01_total:
        facts.append(Fact("IR01", "total", "Book IR01", round(ir01_total, 0), "per bp",
                          f"Book IR01 {round(ir01_total):,} per basis point"))

    facts.extend(_curve_moves(db, ccys))

    pending = [t for t in trades if t.status == "PENDING"]
    if pending:
        facts.append(Fact("P1", "pending", "Pending confirmations", len(pending), "trades",
                          f"{len(pending)} trades await confirmation: " + ", ".join(t.trade_ref for t in pending)))
    soon = [t for t in trades if t.maturity_date and today <= t.maturity_date <= today + timedelta(days=30)]
    if soon:
        facts.append(Fact("M1", "maturity", "Maturing within 30 days", len(soon), "trades",
                          f"{len(soon)} trades mature within 30 days: " + ", ".join(f"{t.trade_ref} on {t.maturity_date}" for t in soon)))
    seen_cp = set()
    for t in trades:
        cp = cps.get(str(t.counterparty_id))
        if cp and cp.id not in seen_cp:
            seen_cp.add(cp.id)
            thr = float(cp.csa_threshold_m) if cp.csa_threshold_m is not None else None
            facts.append(Fact(f"K{len(seen_cp)}", "csa", f"CSA with {cp.name}", thr, "m threshold" if thr is not None else "",
                              f"{cp.name}: {cp.csa_type or 'no CSA'}"
                              + (f", threshold {thr:g}m {cp.csa_currency or ''}".rstrip() if thr is not None else "")
                              + (f", IM {cp.im_model}" if cp.im_model else ""),
                              {"csa_type": cp.csa_type, "im_model": cp.im_model}))

    # news tagged to what the book holds, last 48 hours, summaries only
    classes = {CLASS_TAG.get(str(t.asset_class or "").upper()) for t in trades} - {None}
    if trades:
        rows = db.execute(text(
            "SELECT title, source, url, summary, tags FROM news_items WHERE summary IS NOT NULL "
            "AND coalesce(published_at, created_at) > now() - make_interval(hours => :h) "
            "ORDER BY coalesce(published_at, created_at) DESC LIMIT 40"), {"h": NEWS_HOURS}).all()
        n = 0
        for r in rows:
            if classes & set(r.tags or []):
                n += 1
                facts.append(Fact(f"W{n}", "news", f"{r.source}: {r.title}", None, "",
                                  f"{r.source} reports: {r.title}. {r.summary}", {"url": r.url, "tags": list(r.tags or [])}))
                if n >= 6:
                    break
    return {"valuation_date": today.isoformat(), "generated_at": int(time.time()), "trades": len(trades),
            "priced": priced, "facts": [f.as_dict() for f in facts],
            # the desk's numbers, straight from the pricers: what the home page shows above the trade list
            "totals": {"npv": {k: _r0(v) for k, v in sorted(totals.items())}, "ir01": _r0(ir01_total) if ir01_total else None,
                       "spot01": {k: _r0(v) for k, v in sorted(spot01.items())}, "theta": {k: _r0(v) for k, v in sorted(theta.items())}}}


# ── narration + audit ───────────────────────────────────────────────────────────

def narrate(sheet: dict, client=None) -> list[dict]:
    """Paragraphs with fact ids, from the model, through structured output. Raises on API failure."""
    if client is None:
        import anthropic
        client = anthropic.Anthropic()
    lines = [f"[{f['id']}] {f['text']}" for f in sheet["facts"]]
    user = (f"Valuation date {sheet['valuation_date']}. {sheet['trades']} trades, {sheet['priced']} priced.\n\nFACTS\n"
            + "\n".join(lines))
    resp = client.messages.create(model=MODEL, max_tokens=4000, system=SYSTEM,
                                  output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
                                  messages=[{"role": "user", "content": user}])
    text_ = next((b.text for b in resp.content if getattr(b, "type", "") == "text"), "")
    return json.loads(text_)["paragraphs"]


def _num_ok(n: float, pool: list[float]) -> bool:
    for v in pool:
        if abs(v) >= 1000 and abs(n - v) <= max(1.0, abs(v) * 0.006):      # rounding to thousands / millions
            return True
        if abs(n - v) <= 0.0051 * max(1.0, 10 ** max(0, -_decimals(n))) or abs(n - round(v, _decimals(n))) < 1e-9:
            return True
    return False


def _decimals(n: float) -> int:
    s = repr(n)
    return len(s.split(".")[1]) if "." in s else 0


def audit(paragraphs: list[dict], sheet: dict) -> tuple[list[dict], list[dict]]:
    """Keep paragraphs whose every number is in the cited facts, with at least one valid citation and no
    forecasting or advisory language. Returns (kept, dropped-with-reason)."""
    by_id = {f["id"]: f for f in sheet["facts"]}
    kept, dropped = [], []
    for p in paragraphs:
        ids = [i for i in (p.get("facts") or []) if i in by_id]
        txt = str(p.get("text") or "").strip()
        if not txt:
            continue
        if not ids:
            dropped.append({"text": txt, "reason": "no valid fact citation"}); continue
        m = FORBIDDEN.search(txt)
        if m:
            dropped.append({"text": txt, "reason": f"forecasting or advisory language: '{m.group(0)}'"}); continue
        pool: list[float] = []
        for i in ids:
            f = by_id[i]
            if f.get("value") is not None:
                pool.append(float(f["value"]))
            pool += [float(v) for v in (f.get("extra") or {}).values() if isinstance(v, (int, float)) and not isinstance(v, bool)]
            pool += [float(x.replace(",", "")) for x in NUMBER.findall(f.get("text") or "")]
        bad = None
        for raw in NUMBER.findall(txt):
            n = float(raw.replace(",", ""))
            if not _num_ok(n, pool):
                bad = raw; break
        if bad is not None:
            dropped.append({"text": txt, "reason": f"number not in the cited facts: {bad}"}); continue
        kept.append({"text": txt, "facts": ids})
    return kept, dropped


# ── the brief, cached per user ──────────────────────────────────────────────────

_cache: dict[str, dict] = {}


def brief(db: Session, user: dict, refresh: bool = False, client=None) -> dict:
    uid = user["sub"]
    hit = _cache.get(uid)
    if hit and not refresh and time.time() - hit["generated_at"] < CACHE_SECONDS:
        return hit
    sheet = fact_sheet(db, user)
    out = {**sheet, "generated_at": int(time.time()), "paragraphs": [], "dropped": [],
           "model": MODEL if enabled() else None, "enabled": enabled()}
    if enabled() and sheet["trades"] > 0:
        try:
            kept, dropped = audit(narrate(sheet, client=client), sheet)
            out.update(paragraphs=kept, dropped=dropped)
        except Exception as e:      # noqa: BLE001 — the facts still show; the prose can wait
            log.warning("brief narration failed for %s: %s", uid[:8], str(e)[:160])
            out["narration_error"] = str(e)[:160]
    _cache[uid] = out
    return out
