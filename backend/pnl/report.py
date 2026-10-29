"""The book's P&L for a date.

report()   trade rows (explained, new, unwound), converted to the reporting currency at the
           close, rolled up desk → book → trade, bucket totals, MTD / YTD from the stored
           daily rows, and the sign-off state for the date
persist()  the end-of-day write: one mark per trade and one P&L row per trade per date,
           so tomorrow's MTD and YTD are sums of what was signed, not recomputations
summary()  the home-page tile
The tables are optional until the migration is applied: without them the report is
computed live and says so (persisted: false); MTD and YTD then equal the day.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import date, datetime, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from db.models import Trade
from pnl.explain import GROUP, LIVE, ORDER, Valuer, explain_trade, new_trade, unwound_trade
from pnl.market import Market

log = logging.getLogger("rijeka.pnl")
REPORTING_CCY = "USD"
CONVENTION = ("Sequential full revaluation: carry (date roll on the prior market), cash settled, each curve by tenor bucket "
              "0-1Y / 1-5Y / 5-10Y / 10Y+ (discount, forecast, then base), spot, residual. New trades carry their close mark; "
              "unwinds remove the prior mark. Rows sum to the total by construction.")

_tables: dict[str, Any] = {"at": 0.0, "ok": None}


def tables_present(db: Session) -> bool:
    now = time.monotonic()
    if _tables["ok"] is not None and now - _tables["at"] < 60:
        return _tables["ok"]
    try:
        n = db.execute(text("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' "
                            "AND table_name IN ('eod_marks', 'pnl_daily', 'pnl_signoffs')")).scalar()
        ok = int(n or 0) == 3
    except Exception:
        db.rollback(); ok = False
    _tables.update(at=now, ok=ok)
    return ok


# ── reporting currency ───────────────────────────────────────────────────────

def fx_to_usd(mkt: Market, ccy: str) -> Optional[float]:
    ccy = (ccy or "USD").upper()
    if ccy == "USD":
        return 1.0
    s = mkt.spot(f"{ccy}USD")
    if s:
        return s
    s = mkt.spot(f"USD{ccy}")
    return 1.0 / s if s else None


# ── the report ───────────────────────────────────────────────────────────────

def _d(x) -> Optional[date]:
    if x is None:
        return None
    return x.date() if isinstance(x, datetime) else x


def trade_rows(db: Session, user: dict, d0: Optional[date], d1: date) -> tuple[list[dict], dict]:
    uid = user["sub"]
    m1 = Market(db, uid, d1)
    m0 = Market(db, uid, d0, cache=m1._cache) if d0 else None
    valuer = Valuer(db, user)
    trades = db.query(Trade).filter(Trade.user_id == uid).all()
    rows: list[dict] = []
    problems: list[dict] = []
    for t in trades:
        booked = _d(t.trade_date) or _d(t.created_at)
        is_new = d0 is None or (booked is not None and booked > d0)
        try:
            if t.status in LIVE:
                r = new_trade(db, user, t, d1, m1, valuer) if is_new else explain_trade(db, user, t, d0, d1, m0, m1, valuer)
            elif t.status in ("TERMINATED", "CANCELLED", "MATURED") and d0 is not None and not is_new:
                when = _d(t.last_modified_at) or d1
                if when <= d0:
                    continue
                r = unwound_trade(db, user, t, d0, m0, valuer)
            else:
                continue
        except Exception as e:          # noqa: BLE001 — one trade that will not price must not sink the report
            detail = getattr(e, "detail", None) or str(e)
            problems.append({"trade_ref": t.trade_ref, "trade_id": str(t.id), "reason": str(detail)[:160]})
            log.info("pnl: %s not explained: %s", t.trade_ref, str(detail)[:160])
            continue
        r.update(desk=t.desk or "UNASSIGNED", book=t.book or "UNASSIGNED", instrument=t.instrument_type, counterparty_id=str(t.counterparty_id) if t.counterparty_id else None,
                 notional=float(t.notional) if t.notional else None, notional_ccy=t.notional_ccy, status=t.status, maturity=t.maturity_date.isoformat() if t.maturity_date else None)
        # reporting currency
        usd = 0.0; unconverted = []
        for c, v in r["total_by_ccy"].items():
            fx = fx_to_usd(m1, c)
            if fx is None:
                unconverted.append(c)
            else:
                usd += v * fx
        for row in r["rows"]:
            fx = fx_to_usd(m1, row["ccy"]); row["usd"] = row["pnl"] * fx if fx is not None else None
        r["usd"] = usd; r["unconverted"] = unconverted
        r["market_usd"] = sum(x["usd"] or 0.0 for x in r["rows"] if GROUP[x["bucket"]] == "MARKET")
        r["trading_usd"] = sum(x["usd"] or 0.0 for x in r["rows"] if GROUP[x["bucket"]] == "TRADING")
        rows.append(r)
    meta = {"valuations": valuer.calls, "problems": problems, "asof": {"USD_SOFR": m1.snapshot_date("USD_SOFR")}}
    return rows, meta


def rollup(rows: list[dict]) -> dict:
    """desk → book → trade, with DoD in the reporting currency and the market/trading split."""
    def node(name, kind):
        return {"name": name, "kind": kind, "usd": 0.0, "market_usd": 0.0, "trading_usd": 0.0, "children": [], "count": 0}
    root = node("BOOK TOTAL", "ALL")
    desks: dict[str, dict] = {}
    for r in rows:
        d = desks.setdefault(r["desk"], node(r["desk"], "DESK"))
        b = next((x for x in d["children"] if x["name"] == r["book"]), None)
        if b is None:
            b = node(r["book"], "BOOK"); d["children"].append(b)
        leaf = {**node(r["trade_ref"], "TRADE"), "trade_id": r["trade_id"], "usd": r["usd"], "market_usd": r["market_usd"], "trading_usd": r["trading_usd"],
                "count": 1, "kind_detail": r["kind"], "instrument": r["instrument"], "ccy": r["ccy"], "mark": r["mark"], "mark_prev": r["mark_prev"]}
        b["children"].append(leaf)
        for n in (b, d, root):
            n["usd"] += r["usd"]; n["market_usd"] += r["market_usd"]; n["trading_usd"] += r["trading_usd"]; n["count"] += 1
    root["children"] = sorted(desks.values(), key=lambda x: x["name"])
    return root


def buckets(rows: list[dict]) -> list[dict]:
    """Bucket totals in the reporting currency, in the convention's order, with the curve/tenor detail."""
    agg: dict[str, dict] = {}
    for r in rows:
        for x in r["rows"]:
            b = agg.setdefault(x["bucket"], {"bucket": x["bucket"], "group": GROUP[x["bucket"]], "usd": 0.0, "detail": {}})
            if x.get("usd") is not None:
                b["usd"] += x["usd"]
                key = x.get("label") if x["bucket"] in ("RATES", "FX", "CASH") else None
                if key:
                    b["detail"][key] = b["detail"].get(key, 0.0) + x["usd"]
    out = []
    for k in ORDER:
        if k in agg:
            b = agg[k]; b["detail"] = [{"label": l, "usd": v} for l, v in sorted(b["detail"].items(), key=lambda kv: -abs(kv[1]))]
            out.append(b)
    return out


def history(db: Session, uid: str, d1: date) -> dict:
    """Stored daily totals before d1 in the same month and year (the day itself is live)."""
    if not tables_present(db):
        return {"mtd": 0.0, "ytd": 0.0, "days": 0, "mtd_market": 0.0, "mtd_trading": 0.0, "ytd_market": 0.0, "ytd_trading": 0.0}
    try:
        r = db.execute(text(
            "SELECT coalesce(sum(CASE WHEN pnl_date >= :m THEN usd END),0) mtd, coalesce(sum(usd),0) ytd, count(distinct pnl_date) days, "
            "coalesce(sum(CASE WHEN pnl_date >= :m THEN market_usd END),0) mm, coalesce(sum(CASE WHEN pnl_date >= :m THEN trading_usd END),0) mt, "
            "coalesce(sum(market_usd),0) ym, coalesce(sum(trading_usd),0) yt "
            "FROM pnl_daily WHERE user_id = :u AND pnl_date >= :y AND pnl_date < :d"),
            {"u": uid, "m": d1.replace(day=1), "y": d1.replace(month=1, day=1), "d": d1}).first()
        return {"mtd": float(r.mtd), "ytd": float(r.ytd), "days": int(r.days), "mtd_market": float(r.mm), "mtd_trading": float(r.mt), "ytd_market": float(r.ym), "ytd_trading": float(r.yt)}
    except Exception as e:
        log.debug("history: %s", e); db.rollback()
        return {"mtd": 0.0, "ytd": 0.0, "days": 0, "mtd_market": 0.0, "mtd_trading": 0.0, "ytd_market": 0.0, "ytd_trading": 0.0}


def signoffs(db: Session, uid: str, d1: date) -> list[dict]:
    if not tables_present(db):
        return []
    try:
        rows = db.execute(text("SELECT role, signer_name, signer_user_id, comment, usd_signed, created_at FROM pnl_signoffs "
                               "WHERE user_id = :u AND pnl_date = :d ORDER BY created_at"), {"u": uid, "d": d1}).all()
        return [{"role": r.role, "by": r.signer_name, "signer_user_id": str(r.signer_user_id), "comment": r.comment, "usd_signed": float(r.usd_signed) if r.usd_signed is not None else None,
                 "at": r.created_at.isoformat() if r.created_at else None} for r in rows]
    except Exception as e:
        log.debug("signoffs: %s", e); db.rollback(); return []


def status_of(signs: list[dict], policy: str = "TWO_PERSON") -> str:
    roles = {s["role"] for s in signs}
    if policy == "SINGLE":
        return "FINAL" if roles else "OPEN"
    return "FINAL" if {"TRADER", "CONTROLLER"} <= roles else "TRADER_SIGNED" if "TRADER" in roles else "CONTROLLER_SIGNED" if "CONTROLLER" in roles else "OPEN"


def xva_policy(db: Session, uid: str) -> tuple[str, ...]:
    """Which XVA components net into the signed P&L (risk_settings.xva_netted, comma-separated)."""
    from pnl.xva import DEFAULT_NETTED
    try:
        fm = db.execute(text("SELECT firm_id FROM firm_members WHERE user_id = :u LIMIT 1"), {"u": uid}).scalar()
        if fm is None:
            return DEFAULT_NETTED
        v = db.execute(text("SELECT xva_netted FROM risk_settings WHERE firm_id = :f"), {"f": str(fm)}).scalar()
        return tuple(x.strip().upper() for x in v.split(",") if x.strip()) if v else DEFAULT_NETTED
    except Exception:
        db.rollback(); return DEFAULT_NETTED


def report(db: Session, user: dict, d1: Optional[date] = None) -> dict:
    uid = user["sub"]
    dates = Market.dates(db, uid, upto=d1 or date.today())
    if not dates:
        return {"date": None, "prev_date": None, "dates": [], "rows": [], "tree": rollup([]), "buckets": [], "totals": {}, "note": "No market dates: save or snap a curve first."}
    d1 = d1 if d1 and d1 in dates else dates[-1]
    prev = [d for d in dates if d < d1]
    d0 = prev[-1] if prev else None
    rows, meta = trade_rows(db, user, d0, d1)
    tree = rollup(rows)
    hist = history(db, uid, d1)
    dod = tree["usd"]
    signs = signoffs(db, uid, d1)
    totals = {"dod": dod, "market": tree["market_usd"], "trading": tree["trading_usd"],
              "mtd": hist["mtd"] + dod, "ytd": hist["ytd"] + dod, "mtd_market": hist["mtd_market"] + tree["market_usd"], "mtd_trading": hist["mtd_trading"] + tree["trading_usd"],
              "ytd_market": hist["ytd_market"] + tree["market_usd"], "ytd_trading": hist["ytd_trading"] + tree["trading_usd"], "history_days": hist["days"]}
    # XVA: the reserve levels and their change, the firm's policy on what nets into the signed figure
    xva = None
    try:
        from pnl import xva as X
        xva = X.section(db, user, d1, xva_policy(db, uid))
        for k in ("dod", "mtd", "ytd"):
            ch = xva.get("day" if k == "dod" else k)
            totals[f"{k}_after_xva"] = totals[k] + ch["netted"] if ch else None
        totals["xva_dod"] = xva["day"]["netted"] if xva.get("day") else None
    except Exception as e:              # noqa: BLE001 — the clean P&L stands on its own
        log.info("pnl: xva section unavailable: %s", e); db.rollback()
    return {"date": d1.isoformat(), "prev_date": d0.isoformat() if d0 else None, "dates": [d.isoformat() for d in dates[-40:]],
            "reporting_ccy": REPORTING_CCY, "convention": CONVENTION, "rows": rows, "tree": tree, "buckets": buckets(rows), "totals": totals, "xva": xva,
            "signoffs": signs, "status": status_of(signs), "persisted": tables_present(db) and _persisted(db, uid, d1),
            "tables": tables_present(db), "meta": meta, "generated_at": datetime.now(timezone.utc).isoformat()}


def _persisted(db: Session, uid: str, d1: date) -> bool:
    try:
        return bool(db.execute(text("SELECT 1 FROM pnl_daily WHERE user_id = :u AND pnl_date = :d LIMIT 1"), {"u": uid, "d": d1}).first())
    except Exception:
        db.rollback(); return False


# ── end of day ───────────────────────────────────────────────────────────────

def persist(db: Session, user: dict, rep: dict) -> dict:
    """Write the marks and the daily rows for the report's date. Idempotent: a rerun replaces the day."""
    if not tables_present(db):
        return {"persisted": False, "reason": "tables missing: apply docs/migrations/2026-10-30_pnl.sql"}
    if not rep.get("date"):
        return {"persisted": False, "reason": "no market date"}
    uid, d1 = user["sub"], date.fromisoformat(rep["date"])
    n = 0
    for r in rep["rows"]:
        g = r.get("greeks") or {}
        db.execute(text(
            "INSERT INTO eod_marks (id, user_id, trade_id, mark_date, npv, ccy, ir01, ir01_disc, spot01, theta, detail) "
            "VALUES (:id, :u, :t, :d, :npv, :c, :ir01, :ir01d, :s01, :th, CAST(:det AS jsonb)) "
            "ON CONFLICT (user_id, trade_id, mark_date) DO UPDATE SET npv = EXCLUDED.npv, ccy = EXCLUDED.ccy, ir01 = EXCLUDED.ir01, "
            "ir01_disc = EXCLUDED.ir01_disc, spot01 = EXCLUDED.spot01, theta = EXCLUDED.theta, detail = EXCLUDED.detail, created_at = now()"),
            {"id": str(uuid.uuid4()), "u": uid, "t": r["trade_id"], "d": d1, "npv": r["mark"], "c": r["ccy"], "ir01": g.get("ir01"), "ir01d": g.get("ir01_disc"),
             "s01": g.get("spot01"), "th": g.get("theta"), "det": json.dumps({"kind": r["kind"], "fallback": r.get("fallback", [])})})
        db.execute(text(
            "INSERT INTO pnl_daily (id, user_id, trade_id, pnl_date, prev_date, kind, ccy, total, usd, market_usd, trading_usd, rows, desk, book) "
            "VALUES (:id, :u, :t, :d, :p, :k, :c, :tot, :usd, :m, :tr, CAST(:rows AS jsonb), :desk, :book) "
            "ON CONFLICT (user_id, trade_id, pnl_date) DO UPDATE SET prev_date = EXCLUDED.prev_date, kind = EXCLUDED.kind, ccy = EXCLUDED.ccy, total = EXCLUDED.total, "
            "usd = EXCLUDED.usd, market_usd = EXCLUDED.market_usd, trading_usd = EXCLUDED.trading_usd, rows = EXCLUDED.rows, desk = EXCLUDED.desk, book = EXCLUDED.book, created_at = now()"),
            {"id": str(uuid.uuid4()), "u": uid, "t": r["trade_id"], "d": d1, "p": rep.get("prev_date"), "k": r["kind"], "c": r["ccy"],
             "tot": r["total_by_ccy"].get(r["ccy"], 0.0), "usd": r["usd"], "m": r["market_usd"], "tr": r["trading_usd"], "rows": json.dumps(r["rows"]),
             "desk": r["desk"], "book": r["book"]})
        n += 1
    db.commit()
    _tables["at"] = 0.0
    return {"persisted": True, "rows": n, "date": rep["date"]}


def sign(db: Session, user: dict, owner_uid: str, d1: date, role: str, comment: str, usd_signed: Optional[float], signer_name: str) -> dict:
    if not tables_present(db):
        raise RuntimeError("tables missing: apply docs/migrations/2026-10-30_pnl.sql")
    db.execute(text("INSERT INTO pnl_signoffs (id, user_id, pnl_date, role, signer_user_id, signer_name, comment, usd_signed) "
                    "VALUES (:id, :u, :d, :r, :s, :n, :c, :v)"),
               {"id": str(uuid.uuid4()), "u": owner_uid, "d": d1, "r": role, "s": user["sub"], "n": signer_name, "c": comment or "", "v": usd_signed})
    db.commit()
    s = signoffs(db, owner_uid, d1)
    return {"signoffs": s, "status": status_of(s)}


def summary(db: Session, user: dict) -> dict:
    rep = report(db, user)
    t = rep.get("totals") or {}
    return {"date": rep.get("date"), "prev_date": rep.get("prev_date"), "reporting_ccy": REPORTING_CCY, "status": rep.get("status", "OPEN"),
            "dod": t.get("dod"), "mtd": t.get("mtd"), "ytd": t.get("ytd"), "market": t.get("market"), "trading": t.get("trading"),
            "mtd_market": t.get("mtd_market"), "mtd_trading": t.get("mtd_trading"), "ytd_market": t.get("ytd_market"), "ytd_trading": t.get("ytd_trading"),
            "dod_after_xva": t.get("dod_after_xva"), "mtd_after_xva": t.get("mtd_after_xva"), "ytd_after_xva": t.get("ytd_after_xva"), "xva_dod": t.get("xva_dod"),
            "xva_levels": (rep.get("xva") or {}).get("levels"),
            "buckets": [{"bucket": b["bucket"], "group": b["group"], "usd": b["usd"]} for b in rep.get("buckets", [])],
            "trades": len(rep.get("rows", [])), "problems": len((rep.get("meta") or {}).get("problems", [])), "persisted": rep.get("persisted", False), "tables": rep.get("tables", False)}
