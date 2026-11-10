"""
capital.py — collateral regimes and counterparty capital on the ticket.

GET  /api/capital/collateral   the collateral catalogue, the presets, the risk-weight and CVA tables, each with its paragraph
POST /api/capital/trade        the trade's capital under every regime and counterparty type: standalone, the netting set
                               with and without it (common random numbers, seed 7), and the difference; the SA-CCR snapshot
                               and the two CSAs each regime derives, so every cell can be followed to its formula

The arithmetic is in `capital_grid`, a pure function of the netted paths; the route only assembles its inputs
the way POST /api/xva/incremental does.
"""
from __future__ import annotations

import math
import threading
import time
import uuid
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.routes._errors import internal
from api.routes._limits import heavy
from db.session import get_db
from middleware.auth import verify_token
from pricing import capital as CAP
from pricing import collateral as COL
from pricing import sa_ccr as SA
from jobs import queue as Q
from pricing.csa import CSA

router = APIRouter(prefix="/api/capital", tags=["capital"])

from ccr.capital_report import COST_KEYS, METRICS      # one definition for the ticket's grid and the book's report


class CounterpartyType(BaseModel):
    type: str = "CORPORATE"
    rating: str = "UNRATED"
    sector: Optional[str] = None
    rw_override: Optional[float] = None
    label: Optional[str] = None


class CapitalTradeRequest(BaseModel):
    counterparty_id: Optional[str] = None
    trade: Optional[dict] = None          # the booking body the ticket would send
    trade_id: Optional[str] = None        # or a stored trade: the marginal effect of removing it
    regimes: Optional[list] = None        # preset names or regime bodies (pricing/collateral.from_request); default: the counterparty's own and the four presets
    counterparty_types: Optional[list[CounterpartyType]] = None   # default: the record's type, a corporate and a bank
    n_paths: Optional[int] = Field(default=None, ge=200, le=5000)
    hurdle: float = Field(default=0.12, ge=0.0, le=1.0)


@router.get("/collateral")
def collateral_catalogue(user: dict = Depends(verify_token)):
    return {"classes": [c.to_dict() for c in COL.CATALOGUE.values()],
            "presets": [COL.preset(n).to_dict() for n in COL.PRESET_NAMES],
            "haircuts_pct": COL.HAIRCUTS, "haircut_buckets_y": COL.HAIRCUT_BUCKETS_Y, "hqla_haircut_pct": COL.HQLA_HAIRCUT,
            "capital": CAP.tables(), "sa_ccr": {"supervisory": SA.SUPERVISORY, "sources": SA.SOURCES},
            "metrics": METRICS}


# ── the arithmetic ──────────────────────────────────────────────────────────────────────────────────────

def _type_key(ct: CounterpartyType) -> str:
    return ct.label or f"{ct.type.upper()}·{ct.rating.upper()}"


def capital_grid(sets: dict[str, Optional[dict]], regimes: list[COL.Regime], types: list[CounterpartyType],
                 cp_cds_bp: float, lgd: float, hurdle: float, seed: int = 43) -> dict[str, Any]:
    """sets: name → {V (paths × T+1, USD), t (T+1 years), p0 (T+2 discount factors), rows (SaccrTrade list), gross (USD), mtm (today's net mark)} or None for an empty set. Returns, per regime and counterparty
    type, the metrics of every set and the differences; per regime, the SA-CCR snapshot of every set."""
    from ccr.capital_report import run_set
    out_cells: dict[str, dict[str, dict]] = {}
    snapshots: dict[str, dict[str, Any]] = {}
    regime_info = []
    for rg in regimes:
        regime_info.append({**rg.to_dict(), "explain": rg.explain()})
        per_type: dict[str, dict] = {}
        snaps: dict[str, Any] = {}
        for ct in types:
            ci = CAP.CapitalInputs.for_counterparty(ct.type, ct.rating, ct.sector, hurdle, ct.rw_override)
            cells: dict[str, Optional[dict]] = {}
            for name, S in sets.items():
                if S is None:
                    cells[name] = None
                    continue
                m, snap = run_set(S, rg, ci, cp_cds_bp, lgd, hurdle, seed)
                cells[name] = m
                if name not in snaps:
                    snaps[name] = snap
            w1, w0, alone = cells.get("with"), cells.get("without"), cells.get("standalone")
            inc = None
            if w1 is not None:
                base = w0 or {k: 0.0 for k in METRICS}
                inc = {k: w1[k] - base[k] for k in METRICS}
            per_type[_type_key(ct)] = {"inputs": ci.to_dict(), "standalone": alone, "with": w1, "without": w0, "incremental": inc}
        out_cells[rg.name] = per_type
        snapshots[rg.name] = snaps
    return {"regimes": regime_info, "types": [{"key": _type_key(ct), **ct.dict()} for ct in types], "cells": out_cells, "saccr": snapshots}


def quote_lines(cells: dict, regimes: list[COL.Regime], types: list[CounterpartyType], notional: float, m_years: float, rate: float) -> dict:
    """The cost of the incremental charge (CVA + FVA + KVA + MVA, as a positive number) under every regime against the
    first one, as a running or upfront spread of the trade's notional."""
    if not regimes:
        return {}
    first = regimes[0].name
    out: dict[str, dict] = {}
    for rg in regimes:
        out[rg.name] = {}
        for ct in types:
            key = _type_key(ct)
            a, b = cells.get(first, {}).get(key, {}), cells.get(rg.name, {}).get(key, {})
            ia, ib = a.get("incremental") or a.get("standalone"), b.get("incremental") or b.get("standalone")
            if not ia or not ib:
                out[rg.name][key] = None
                continue
            cost_a = -sum(ia[k] for k in COST_KEYS)
            cost_b = -sum(ib[k] for k in COST_KEYS)
            q = CAP.quote_advantage(cost_a - cost_b, notional, m_years, rate)
            out[rg.name][key] = {**q, "cost": cost_b, "cost_vs_first": cost_a - cost_b}
    return out


# ── the route ────────────────────────────────────────────────────────────────────────────────────────────

def _regimes_for(body: CapitalTradeRequest, cp, db=None, uid: Optional[str] = None, mkt=None, asof=None) -> list[COL.Regime]:
    from ccr.exposure import csa_from_counterparty
    own = csa_from_counterparty(cp) if cp else CSA.uncollateralised()
    terms = own if own.collateralised else CSA.bilateral(im_exchanged=True)
    if body.regimes:
        out = []
        for r in body.regimes:
            try:
                out.append(COL.from_request(r, terms))
            except (ValueError, KeyError) as e:
                raise HTTPException(status_code=422, detail=f"regimes: {e}")
        return out
    if cp and db is not None:
        from collateral.regimes import regime_for
        out = [regime_for(db, uid, cp, own, mkt, asof)]          # the schedule when one is recorded, else the record's class fields
    else:
        out = [COL.regime_from_counterparty(cp, own)] if cp else []
    out += [COL.preset(n, terms) for n in COL.PRESET_NAMES]
    return out


def _types_for(body: CapitalTradeRequest, cp) -> list[CounterpartyType]:
    if body.counterparty_types:
        out = body.counterparty_types
    else:
        out = []
        if cp is not None and getattr(cp, "counterparty_type", None):
            out.append(CounterpartyType(type=cp.counterparty_type, rating=getattr(cp, "rating_bucket", None) or "UNRATED",
                                        sector=getattr(cp, "cva_sector", None), rw_override=float(cp.risk_weight_override) if getattr(cp, "risk_weight_override", None) is not None else None,
                                        label="COUNTERPARTY"))
        out += [CounterpartyType(type="CORPORATE", rating="UNRATED"), CounterpartyType(type="BANK", rating="A"), CounterpartyType(type="FUND", rating="UNRATED")]
    for ct in out:
        try:
            CAP.risk_weight(ct.type, ct.rating, ct.rw_override)
            CAP.cva_weight(ct.sector, ct.rating, ct.type)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=f"counterparty_types: {e}")
    return out


@router.post("/trade")
def capital_trade(body: CapitalTradeRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    if not body.trade and not body.trade_id:
        raise HTTPException(status_code=422, detail="trade or trade_id is required")
    heavy(user, "counterparty run", 6)
    from api.routes.xva import hypothetical_trade
    from ccr.report import LIVE, settings
    from db.models import Counterparty, Trade
    from pnl.market import Market
    from risk.report import firm_of, template_uid
    t0 = time.time()
    uid = user["sub"]
    dates = Market.dates(db, uid, upto=date.today())
    if not dates:
        raise HTTPException(status_code=422, detail="No market dates: save or snap a curve first.")
    asof = dates[-1]
    mkt = Market(db, uid, asof)
    st = dict(settings(db, firm_of(db, uid)))
    if body.n_paths:
        st["n_paths"] = int(body.n_paths)
    tpl = template_uid(db)
    cp = None
    if body.counterparty_id:
        try:
            cpid = uuid.UUID(body.counterparty_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="counterparty_id must be a UUID")
        cp = db.query(Counterparty).filter(Counterparty.id == cpid, Counterparty.user_id == uuid.UUID(uid)).first()
        if cp is None:
            raise HTTPException(status_code=404, detail="Counterparty not found")
    cp_id = cp.id if cp else None
    from api.routes.counterparties import read_capital, with_capital
    cp_view = with_capital(cp, read_capital(db, [cp.id]).get(str(cp.id), {})) if cp else None
    regimes, types = _regimes_for(body, cp_view, db, uid, mkt, asof), _types_for(body, cp_view)
    existing = [t for t in db.query(Trade).filter(Trade.user_id == uuid.UUID(uid), Trade.counterparty_id == cp_id).all() if t.status in LIVE]
    if body.trade_id:
        try:
            tid = uuid.UUID(body.trade_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="trade_id must be a UUID")
        this = next((t for t in existing if t.id == tid), None)
        if this is None:
            raise HTTPException(status_code=404, detail="Trade not found in this counterparty's live set")
        with_trades, without, alone, mode = existing, [t for t in existing if t.id != tid], [this], "MARGINAL"
    else:
        hyp = hypothetical_trade(body.trade, cp_id, uid)
        with_trades, without, alone, mode = existing + [hyp], existing, [hyp], "INCREMENTAL"

    notes: list[str] = []

    from ccr.capital_report import prepare_set

    def prepare(trades):
        try:
            return prepare_set(db, user, cp, trades, asof, mkt, st, tpl, notes)
        except HTTPException:
            raise
        except Exception as e:          # noqa: BLE001
            db.rollback()
            raise internal(422, "The credit engine could not value this set", e)

    S_with, S_without, S_alone = prepare(with_trades), prepare(without), prepare(alone)
    if S_with is None or S_with.get("empty"):
        reasons = "; ".join(f"{x.get('trade_ref')}: {x.get('reason')}" for x in (S_with or {}).get("ns").skipped) if S_with else ""
        raise HTTPException(status_code=422, detail=f"The trade cannot be valued on the exposure paths yet. {reasons}".strip())
    sets = {"with": S_with, "without": None if (S_without is None or S_without.get("empty")) else S_without,
            "standalone": None if (S_alone is None or S_alone.get("empty")) else S_alone}
    # the netting set's IM is not exchanged when the record says so; the regimes' CSAs decide per regime
    grid = capital_grid(sets, regimes, types, float(st.get("cp_cds_bp") or 85.0), float(st.get("lgd") or 0.4), float(body.hurdle))
    alone_t = S_alone["t"] if S_alone and not S_alone.get("empty") else S_with["t"]
    rate = -math.log(max(S_with["p0"][-1], 1e-9)) / max(float(S_with["t"][-1]), 1e-6)
    notional = float((S_alone or S_with)["gross"])
    quotes = quote_lines(grid["cells"], regimes, types, notional, float(alone_t[-1]), rate)
    notes = sorted(set(notes))
    notes.append("common random numbers: every set and every regime runs on the same risk-neutral paths (seed 7), so differences are the trade and the regime, not the noise")
    notes.append("the regulatory CSA keeps collateral the rules recognise, at its haircut; the economic CSA is what is exchanged; both are shown per regime")
    notes.append("IM: the engine's own estimate from the paths, the 99th percentile move over each regime's margin period; Rijeka does not compute ISDA SIMM, which is licensed")
    return {"mode": mode, "counterparty": cp.name if cp else "UNASSIGNED", "counterparty_id": str(cp_id) if cp_id else None, "asof": asof.isoformat(),
            "n_paths": S_with["n_paths"], "months": S_with["months"], "seed": 7, "other_trades": len(without), "measure": "RISK_NEUTRAL",
            "metrics": METRICS, "cost_keys": COST_KEYS, "quote": quotes, "trades_today": S_with["today"],
            "cp_cds_bp": float(st.get("cp_cds_bp") or 85.0), "lgd": float(st.get("lgd") or 0.4), "hurdle": float(body.hurdle),
            "notes": notes, "seconds": round(time.time() - t0, 1), **grid}


# ── the book under regimes: run on the worker (or a thread), poll, read ───────────────────────────────

_jobs: dict[str, dict] = {}          # uid → the in-memory job when there is no jobs table


class PortfolioRequest(BaseModel):
    hurdle: float = Field(default=0.12, ge=0.0, le=1.0)
    yield_bp: Optional[float] = Field(default=None, ge=0.0, le=2000.0)     # the tokenised sovereign claim's yield in the forward column
    n_paths: Optional[int] = Field(default=None, ge=200, le=5000)


def _ctx(db: Session, user: dict) -> dict:
    from api.routes.pnl import _marking_ctx
    return _marking_ctx(db, user)


def _run_thread(ctx: dict, body: PortfolioRequest) -> None:
    import datetime as _dt
    from ccr import capital_report as CR
    from db.session import SessionLocal
    uid = ctx["sub"]
    job = _jobs.setdefault(uid, {})
    job.update(running=True, started=_dt.datetime.now(_dt.timezone.utc).isoformat(), finished=None, error=None, current=None, done=0, total=0, result=None)
    db = SessionLocal()
    try:
        job["result"] = CR.report(db, ctx, progress=job, hurdle=body.hurdle, yield_bp=body.yield_bp, n_paths=body.n_paths)
    except Exception as e:              # noqa: BLE001
        db.rollback(); job["error"] = str(e)[:300]
    finally:
        db.close()
        job.update(running=False, finished=_dt.datetime.now(_dt.timezone.utc).isoformat())


def _job_view(db: Session, uid: str) -> Optional[dict]:
    mem = _jobs.get(uid)
    row = None
    if Q.tables_present(db):
        try:
            row = Q.as_status(Q.latest(db, uid, "capital_run"))
        except Exception:               # noqa: BLE001
            db.rollback(); row = None
    if row is None or mem is None:
        return row or mem
    if row["running"] != bool(mem.get("running")):
        return row if row["running"] else mem
    return row if (row.get("started") or "") >= (mem.get("started") or "") else mem


@router.post("/portfolio")
def portfolio_run(body: PortfolioRequest, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """Start the book's run: the worker when one is expected, else a thread; GET /portfolio/status reports progress and
    GET /portfolio returns the result."""
    uid = user["sub"]
    heavy(user, "counterparty run", 4)
    current = _job_view(db, uid)
    if current and current.get("running"):
        return {"started": False, "reason": "a run is already in progress", "job": current}
    if Q.worker_expected(db):
        jid = Q.enqueue(db, uid, "capital_run", {"ctx": _ctx(db, user), "hurdle": body.hurdle, "yield_bp": body.yield_bp, "n_paths": body.n_paths})
        return {"started": True, "job": Q.as_status(Q.latest(db, uid, "capital_run")), "job_id": jid, "note": "queued for the worker"}
    threading.Thread(target=_run_thread, args=(_ctx(db, user), body), daemon=True).start()
    return {"started": True, "note": "running in the background"}


@router.get("/portfolio/status")
def portfolio_status(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return {"job": _job_view(db, user["sub"]), "worker": Q.worker_expected(db)}


@router.get("/portfolio")
def portfolio_report(live: bool = False, hurdle: float = 0.12, yield_bp: Optional[float] = None, n_paths: Optional[int] = None,
                     db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """The latest run's report; live=1 computes it in the request (small books, tests)."""
    if live:
        heavy(user, "counterparty run", 6)
        from ccr import capital_report as CR
        rep = CR.report(db, _ctx(db, user), hurdle=hurdle, yield_bp=yield_bp, n_paths=n_paths)
        rep["from_store"] = False
        return rep
    job = _job_view(db, user["sub"])
    if job and job.get("result"):
        return {**job["result"], "from_store": True, "job": {k: v for k, v in job.items() if k != "result"}}
    return {"date": None, "counterparties": [], "job": job, "note": "No run yet: RUN NOW simulates every netting set under the regimes."}
