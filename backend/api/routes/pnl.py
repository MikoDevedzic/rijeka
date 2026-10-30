"""
GET  /api/pnl/report?date=YYYY-MM-DD   the book's P&L for a market date (default: latest), attributed and rolled up
GET  /api/pnl/summary                  the home-page tile: DoD / MTD / YTD, market vs trading
GET  /api/pnl/dates                    the market dates a report can be run for
POST /api/pnl/eod?date=                run end of day for the caller: compute and store marks and daily rows
POST /api/pnl/eod/tick                 cron (X-Rijeka-Cron): end of day for every account with trades
POST /api/pnl/signoff                  {date, role: TRADER|CONTROLLER, comment, owner?}: sign the day
GET  /api/pnl/firm?date=               management: every member of my firm's day, with sign-off state
GET  /api/pnl/conventions             the firm's P&L policy as applied: order, buckets, roles, end of day

Engine: backend/pnl. The attribution convention is stated in the report itself.
"""
from __future__ import annotations

import hmac

import logging
import os
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.models import FirmMember
from db.session import get_db
from middleware.auth import verify_token
from api.routes._limits import heavy
from pnl import report as R

log = logging.getLogger("rijeka.pnl")
router = APIRouter(prefix="/api/pnl", tags=["pnl"])
CONTROLLER_ROLES = {"controller", "cfo", "admin"}            # may sign as controller
MANAGEMENT_ROLES = CONTROLLER_ROLES | {"management", "risk"}   # may see every book in the firm


def _parse(d: Optional[str]) -> Optional[date]:
    try:
        return date.fromisoformat(d) if d else None
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")


def _name(user: dict) -> str:
    md = user.get("user_metadata") or {}
    return md.get("display_name") or md.get("full_name") or (user.get("email") or "").split("@")[0] or "trader"


def _role(db: Session, user: dict) -> str:
    """profiles.role (what the admin page sets, immediate) over the JWT claim (may lag)."""
    from api.routes.me import db_role
    return str(db_role(db, user["sub"]) or (user.get("user_metadata") or {}).get("role") or "trader").lower()


def _as_user(db: Session, uid: str) -> dict:
    """A server-side user context for marking someone's book: the pricers check the role claim,
    and a batch has no token. Marking is read-only pricing, so the trader role is granted."""
    from api.routes.me import db_role
    return {"sub": uid, "user_metadata": {"role": db_role(db, uid) or "trader", "batch": True}}


def _firm(db: Session, uid: str) -> Optional[FirmMember]:
    return db.query(FirmMember).filter(FirmMember.user_id == uid).first()


def _is_controller(db: Session, user: dict) -> bool:
    if _role(db, user) in CONTROLLER_ROLES:
        return True
    fm = _firm(db, user["sub"])
    return bool(fm and fm.role in ("ADMIN", "COMPLIANCE"))


def _is_management(db: Session, user: dict) -> bool:
    if _role(db, user) in MANAGEMENT_ROLES:
        return True
    fm = _firm(db, user["sub"])
    return bool(fm and fm.role in ("ADMIN", "COMPLIANCE"))


POLICIES = ("TWO_PERSON", "SINGLE")


def signoff_policy(db: Session, uid: str) -> str:
    """The firm's sign-off policy: TWO_PERSON (trader, then a different controller) or SINGLE
    (one signature finalises; a one-person desk, or a shop where the CFO is the risk and
    control function). Default TWO_PERSON."""
    from api.routes.demo import enabled as demo_enabled
    default = "SINGLE" if demo_enabled() else "TWO_PERSON"      # a hosted-demo workspace is a one-person desk until it says otherwise
    fm = _firm(db, uid)
    if fm is None:
        return default
    try:
        v = db.execute(text("SELECT signoff_policy FROM risk_settings WHERE firm_id = :f"), {"f": str(fm.firm_id)}).scalar()
    except Exception:
        db.rollback(); return default
    return v if v in POLICIES else default


class PolicyBody(BaseModel):
    signoff_policy: Optional[str] = None
    xva_netted: Optional[list[str]] = None


@router.get("/policy")
def get_policy(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    from pnl.xva import COMPONENTS
    return {"signoff_policy": signoff_policy(db, user["sub"]), "policies": list(POLICIES), "xva_netted": list(R.xva_policy(db, user["sub"])),
            "xva_components": [c.upper() for c in COMPONENTS], "can_write": _is_controller(db, user) or _role(db, user) in ("risk",)}


@router.put("/policy")
def put_policy(body: PolicyBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    fm = _firm(db, user["sub"])
    if fm is None:
        raise HTTPException(status_code=404, detail="Your account is not in a firm.")
    if not (_is_controller(db, user) or _role(db, user) == "risk"):
        raise HTTPException(status_code=403, detail="The sign-off policy is set by the controller, CFO, risk or admin role, or a firm admin.")
    from pnl.xva import COMPONENTS
    pol = (body.signoff_policy or signoff_policy(db, user["sub"])).upper()
    if pol not in POLICIES:
        raise HTTPException(status_code=422, detail=f"signoff_policy must be one of {', '.join(POLICIES)}")
    netted = [x.upper() for x in (body.xva_netted if body.xva_netted is not None else R.xva_policy(db, user["sub"]))]
    if any(x.lower() not in COMPONENTS for x in netted):
        raise HTTPException(status_code=422, detail=f"xva_netted must be among {', '.join(c.upper() for c in COMPONENTS)}")
    try:
        db.execute(text("INSERT INTO risk_settings (firm_id, signoff_policy, xva_netted, updated_by, updated_by_name) VALUES (:f, :p, :x, :b, :bn) "
                        "ON CONFLICT (firm_id) DO UPDATE SET signoff_policy = EXCLUDED.signoff_policy, xva_netted = EXCLUDED.xva_netted, updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = now()"),
                   {"f": str(fm.firm_id), "p": pol, "x": ",".join(netted), "b": user["sub"], "bn": _name(user)})
        db.commit()
    except Exception as e:
        db.rollback(); raise HTTPException(status_code=409, detail=f"policy needs the market risk tables: {str(e)[:80]}")
    return {"signoff_policy": pol, "xva_netted": netted}


@router.get("/conventions")
def conventions(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """The firm's P&L policy as the engine applies it. Read-only for now; these are the constants."""
    from pnl.explain import BUCKETS, ORDER, GROUP
    return {
        "reporting_ccy": R.REPORTING_CCY,
        "attribution": {"method": "sequential full revaluation", "order": ORDER, "groups": GROUP,
                        "tenor_buckets": [b[0] for b in BUCKETS], "curve_order": ["discount", "forecast", "base currency"],
                        "fx_steps": ["spot", "quoted forward points"], "residual": "shown, never spread"},
        "marks": {"source": "production pricers on the saved market at or before the date", "market_dates": "dates with a saved USD_SOFR snapshot",
                  "fx_conversion": "reporting currency at the close of the report date"},
        "trading": {"new_trade": "close mark on the first market date after booking", "unwind": "prior mark removed, plus any termination fee in the terms"},
        "end_of_day": {"when": "daily by cron after the market data rebuild, and on demand (RUN END OF DAY)", "stores": ["eod_marks", "pnl_daily"],
                       "rerun": "replaces the day"},
        "sign_off": {"order": ["TRADER", "CONTROLLER"], "trader": "the book's owner", "controller_roles": sorted(CONTROLLER_ROLES),
                     "management_roles": sorted(MANAGEMENT_ROLES), "firm_roles_that_qualify": ["ADMIN", "COMPLIANCE"],
                     "final": "both signatures; visible to management with the comments"},
        "your_role": _role(db, user), "you_may_sign_as_controller": _is_controller(db, user), "you_may_see_the_firm": _is_management(db, user),
        "signoff_policy": signoff_policy(db, user["sub"]),
        "policy_note": "Roles and the sign-off policy are the firm's. On the hosted demo each workspace is its own firm, the person at the desk picks the hat, and the policy "
                       "starts as SINGLE (one signature finalises the day: a one-person desk, or a shop where the CFO is also the control function); a firm with a control "
                       "function sets TWO_PERSON, where the trader signs and then a different person with the controller, CFO or admin role.",
        "history_tables": R.tables_present(db), "migration": "docs/migrations/2026-10-30_pnl.sql", "roles_migration": "docs/migrations/2026-10-30_pnl_roles.sql",
    }


def _marking_ctx(db: Session, user: dict) -> dict:
    """The caller's own book, priced with marking rights whatever their role: a controller or
    manager reading their own (empty) book, or a viewer, must not get a 403 from the pricer."""
    return {**user, "user_metadata": {**(user.get("user_metadata") or {}), "role": "trader", "actual_role": _role(db, user)}}


@router.get("/report")
def pnl_report(date_: Optional[str] = Query(default=None, alias="date"), live: bool = Query(default=False),
               db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    """The stored day opens instantly; live=1 revalues every trade now (RUN END OF DAY stores it)."""
    if live:
        heavy(user, "live P&L report", 6)
    rep = R.report(db, _marking_ctx(db, user), _parse(date_), prefer_stored=not live)
    rep["signoff_policy"] = signoff_policy(db, user["sub"])
    rep["status"] = R.status_of(rep.get("signoffs", []), rep["signoff_policy"])
    rep["can_control"] = _is_controller(db, user)
    rep["role"] = _role(db, user)
    return rep


@router.get("/summary")
def pnl_summary(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return R.summary(db, _marking_ctx(db, user))


@router.get("/dates")
def pnl_dates(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    from pnl.market import Market
    return {"dates": [d.isoformat() for d in Market.dates(db, user["sub"])]}


@router.post("/eod")
def run_eod(date_: Optional[str] = Query(default=None, alias="date"), db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    rep = R.report(db, _marking_ctx(db, user), _parse(date_))
    out = R.persist(db, user, rep)
    return {**out, "totals": rep.get("totals"), "status": rep.get("status")}


def _secret_ok(given: Optional[str]) -> bool:
    want = os.environ.get("RIJEKA_CRON_SECRET")
    return bool(want) and given is not None and hmac.compare_digest(given, want)


@router.post("/eod/tick")
def eod_tick(db: Session = Depends(get_db), x_rijeka_cron: Optional[str] = Header(None)):
    if not _secret_ok(x_rijeka_cron):
        raise HTTPException(status_code=403, detail="bad cron secret")
    if not R.tables_present(db):
        return {"persisted": False, "reason": "tables missing: apply docs/migrations/2026-10-30_pnl.sql"}
    users = [str(r.user_id) for r in db.execute(text("SELECT DISTINCT user_id FROM trades")).all()]
    done, failed = [], []
    for uid in users:
        try:
            ctx = _as_user(db, uid)
            rep = R.report(db, ctx)
            out = R.persist(db, ctx, rep)
            done.append({"user": uid[:8], "date": out.get("date"), "rows": out.get("rows")})
        except Exception as e:          # noqa: BLE001
            db.rollback(); failed.append({"user": uid[:8], "error": str(e)[:160]})
            log.warning("eod for %s failed: %s", uid[:8], e)
    return {"accounts": len(users), "done": done, "failed": failed}


class SignBody(BaseModel):
    date: str
    role: str
    comment: str = ""
    owner: Optional[str] = None          # a controller signs someone else's book


@router.post("/signoff", status_code=201)
def signoff(body: SignBody, db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    role = body.role.upper()
    if role not in ("TRADER", "CONTROLLER"):
        raise HTTPException(status_code=422, detail="role must be TRADER or CONTROLLER")
    owner = body.owner or user["sub"]
    policy = signoff_policy(db, owner)
    if role == "CONTROLLER" and not _is_controller(db, user):
        raise HTTPException(status_code=403, detail="Controller sign-off needs the controller, CFO or admin role, or firm admin.")
    if role == "CONTROLLER" and policy == "TWO_PERSON":
        prior = R.signoffs(db, owner, _parse(body.date))
        if any(s["role"] == "TRADER" and s["signer_user_id"] == user["sub"] for s in prior):
            raise HTTPException(status_code=403, detail="Two-person policy: the controller must be a different person from the trader who signed. Switch the firm to SINGLE if one person runs the desk.")
    if role == "TRADER" and owner != user["sub"]:
        raise HTTPException(status_code=403, detail="A trader signs their own book.")
    if owner != user["sub"]:
        mine, theirs = _firm(db, user["sub"]), _firm(db, owner)
        if not (mine and theirs and mine.firm_id == theirs.firm_id):
            raise HTTPException(status_code=403, detail="That book is not in your firm.")
    d1 = _parse(body.date)
    ctx = user if owner == user["sub"] else _as_user(db, owner)
    rep = R.report(db, ctx, d1)
    if rep.get("date") != body.date:
        raise HTTPException(status_code=422, detail=f"No report for {body.date}; latest market date is {rep.get('date')}.")
    if not rep.get("persisted"):
        R.persist(db, ctx, rep)          # what is signed is what is stored
    try:
        out = R.sign(db, user, owner, d1, role, body.comment, rep["totals"]["dod"], _name(user))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    out["status"] = R.status_of(out["signoffs"], policy)
    return out


@router.get("/firm")
def firm_view(date_: Optional[str] = Query(default=None, alias="date"), db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    fm = _firm(db, user["sub"])
    if fm is None:
        raise HTTPException(status_code=404, detail="Your account is not in a firm.")
    if not _is_management(db, user):
        raise HTTPException(status_code=403, detail="Management view needs the management, controller, CFO or admin role, or firm admin.")
    members = db.query(FirmMember).filter(FirmMember.firm_id == fm.firm_id).all()
    d1 = _parse(date_)
    out = []
    for m in members:
        uid = str(m.user_id)
        try:
            rep = R.report(db, _as_user(db, uid), d1)
        except Exception as e:          # noqa: BLE001
            db.rollback(); out.append({"user_id": uid, "error": str(e)[:120]}); continue
        if not rep.get("rows") and not rep.get("date"):
            continue
        t = rep.get("totals") or {}
        out.append({"user_id": uid, "role": m.role, "date": rep.get("date"), "dod": t.get("dod"), "mtd": t.get("mtd"), "ytd": t.get("ytd"),
                    "market": t.get("market"), "trading": t.get("trading"), "trades": len(rep.get("rows", [])), "status": rep.get("status"),
                    "signoffs": rep.get("signoffs", []), "desks": [{"name": d["name"], "usd": d["usd"]} for d in rep["tree"]["children"]]})
    return {"firm_id": str(fm.firm_id), "members": out, "reporting_ccy": R.REPORTING_CCY}
