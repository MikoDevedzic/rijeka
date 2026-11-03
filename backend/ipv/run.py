"""The IPV run: the inputs the trades in scope are valued on, each pillar's desk and independent mark, its
sensitivity and tolerance, the overrides and their first-order impact, the states, the figures from flash to
official, the gate, the full revaluation on apply, and the sign-off.

States of an input: OVERRIDDEN (a controller set a pillar), APPROVED (approved as marked), VERIFIED (an
independent mark exists and every pillar sits within tolerance), WAIVED (no pillar is material at its
tolerance), PENDING (needs a decision). The gate: official P&L needs no PENDING input and no unvalued trade."""
from __future__ import annotations

import logging
import time
from datetime import date, datetime, timezone
from typing import Any, Optional

from ipv import inputs as I
from ipv import store as S
from ipv import tolerances as T
from ipv.ladder import pillar_ladder
from pnl.explain import LIVE, Valuer
from pnl.market import Market
from pnl.report import fx_to_usd

log = logging.getLogger("rijeka.ipv")

SCOPES = ("GLOBAL", "DESK", "BOOK")


def scope_key(scope: Optional[dict]) -> str:
    s = dict(scope or {})
    level = str(s.get("level") or "GLOBAL").upper()
    if level == "GLOBAL" or not s.get("name"):
        return "GLOBAL"
    return f"{level}:{s['name']}"


def in_scope(trade, scope: Optional[dict]) -> bool:
    s = dict(scope or {})
    level = str(s.get("level") or "GLOBAL").upper()
    if level == "GLOBAL" or not s.get("name"):
        return True
    if level == "DESK":
        return (trade.desk or "UNASSIGNED") == s["name"]
    if level == "BOOK":
        return (trade.book or "UNASSIGNED") == s["name"]
    return True


def row_in_scope(row: dict, scope: Optional[dict]) -> bool:
    s = dict(scope or {})
    level = str(s.get("level") or "GLOBAL").upper()
    if level == "GLOBAL" or not s.get("name"):
        return True
    return (row.get("desk" if level == "DESK" else "book") or "UNASSIGNED") == s["name"]


# ── the states ───────────────────────────────────────────────────────────────

def input_state(pillars: list[dict], decision: Optional[dict], has_independent: bool) -> str:
    if any(p.get("override") is not None for p in pillars):
        return "OVERRIDDEN"
    if decision and decision.get("state") in ("APPROVED", "WAIVED"):
        return decision["state"]
    if has_independent and pillars and all(p["status"] in ("OK", "APPROVED") for p in pillars):
        return "VERIFIED"
    if pillars and not any(p["material"] for p in pillars):
        return "WAIVED"
    return "PENDING"


def gate(inputs: list[dict], unvalued: list[dict]) -> list[str]:
    """What blocks the sign-off; empty when nothing does."""
    out = [f"{i['curve_id']}: {i['state'].lower()}" for i in inputs if i["state"] == "PENDING"]
    out += [f"{u.get('trade_ref')}: not valued ({u.get('reason')})" for u in unvalued]
    return out


# ── the run ──────────────────────────────────────────────────────────────────

def build(db, user: dict, d: date, scope: Optional[dict] = None, rules: Optional[list[dict]] = None, apply: bool = False,
          prior: Optional[dict] = None, progress: Optional[dict] = None) -> dict[str, Any]:
    """The run for an account, date and scope. `prior` carries the stored run's decisions (approvals, waivers).
    `apply` revalues the book on the overridden market for the second-order line."""
    from db.models import Trade
    from pnl import report as R
    t0 = time.time()
    uid = user["sub"]
    sk = scope_key(scope)
    mkt = Market(db, uid, d)
    fx = lambda c: fx_to_usd(mkt, c)
    valuer = Valuer(db, user)
    trades = [t for t in db.query(Trade).filter(Trade.user_id == uid).all() if t.status in LIVE and in_scope(t, scope)]
    deps = I.dependencies(trades)
    ovs = S.overrides(db, uid, d, sk)
    ov_by: dict[str, dict[str, dict]] = {}
    for o in ovs:
        ov_by.setdefault(o["curve_id"], {})[o["pillar"]] = o
    decisions = {i["curve_id"]: i.get("decision") for i in (prior or {}).get("inputs") or [] if i.get("decision")}
    rules = rules if rules is not None else []
    by_id = {str(t.id): t for t in trades}
    inputs: list[dict] = []
    first_total = 0.0
    for n, (cid, tids) in enumerate(sorted(deps.items())):
        if progress is not None:
            progress.update(current=cid, done=n, total=len(deps))
        quotes = mkt.quotes(cid)
        kind, unit = I.kind_of(cid), I.unit_of(cid)
        row: dict[str, Any] = {"curve_id": cid, "kind": kind, "unit": unit, "unit_label": I.UNIT_LABEL[unit], "trades": len(tids), "trade_ids": tids,
                               "desk_snapshot_date": (mkt.snapshot_date(cid).isoformat() if mkt.snapshot_date(cid) else None), "decision": decisions.get(cid)}
        if not quotes:
            # the trades read a default for this input (no snapshot): nothing to ladder, but a controller still decides
            dec = decisions.get(cid)
            row.update(pillars=[], state=(dec["state"] if dec and dec.get("state") in ("APPROVED", "WAIVED") else "PENDING"), unladdered=True,
                       note="no snapshot: the trades read a default value; approve or waive", sensitivity_total=0.0, first_order=0.0, has_independent=False)
            inputs.append(row)
            continue
        indep = S.independent_quotes(db, uid, cid, d)
        iq = indep["quotes"] if indep else None
        dep_trades = [by_id[t] for t in tids if t in by_id]
        try:
            sens = pillar_ladder(dep_trades, d, mkt, cid, valuer, fx)
        except Exception as e:          # noqa: BLE001
            log.info("ipv: ladder for %s failed: %s", cid, e)
            sens = {}
        pillars = []
        fo_input = 0.0
        for p in I.pillars_of(cid, quotes):
            rule = T.rule_for(rules, cid, p["key"])
            desk = p["value"]
            ind_q = I.find_quote(iq, cid, p["key"]) if iq else None
            ind = float(ind_q["rate"]) if ind_q else None
            gap = I.shift(cid, desk, ind) if ind is not None else None
            ov = ov_by.get(cid, {}).get(p["key"])
            s = float(sens.get(p["key"], 0.0))
            ov_shift = I.shift(cid, desk, ov["override_value"]) if ov else None
            impact = s * ov_shift if ov_shift is not None else 0.0
            fo_input += impact
            approved = bool(decisions.get(cid) and decisions[cid].get("state") == "APPROVED")
            pillars.append({**p, "desk": desk, "independent": ind, "gap": gap, "sensitivity": s, "tol": rule["tol"], "tol_source": rule["source"],
                            "material": T.material(s, rule["tol"], rule["materiality_usd"]), "override": ov["override_value"] if ov else None,
                            "override_id": ov["id"] if ov else None, "override_reason": ov["reason"] if ov else None, "override_by": ov["author_name"] if ov else None,
                            "shift": ov_shift, "impact": impact, "status": T.pillar_status(gap, rule["tol"], ov is not None, approved)})
        row.update(pillars=pillars, sensitivity_total=sum(x["sensitivity"] for x in pillars), first_order=fo_input, has_independent=iq is not None,
                   independent_source=(f"{indep['source']} · {indep['date']}" if indep else None), unladdered=not sens,
                   review=sum(1 for x in pillars if x["status"] == "REVIEW"), overridden=sum(1 for x in pillars if x["override"] is not None))
        row["state"] = input_state(pillars, decisions.get(cid), iq is not None)
        first_total += fo_input
        inputs.append(row)
    # the flash: the trading P&L's day at this scope, from the stored day when there is one
    rep = R.report(db, user, d, prefer_stored=True)
    rows = [r for r in rep.get("rows") or [] if row_in_scope(r, scope)]
    flash = sum(float(r.get("usd") or 0.0) for r in rows)
    unvalued = [p for p in (rep.get("meta") or {}).get("problems") or [] if p.get("trade_id") in by_id]
    xva = None
    if sk == "GLOBAL":
        xva = (rep.get("totals") or {}).get("xva_dod")
    out: dict[str, Any] = {"date": d.isoformat(), "scope": dict(scope or {"level": "GLOBAL"}), "scope_key": sk, "status": (prior or {}).get("status") or "OPEN",
                           "inputs": inputs, "unvalued": unvalued, "trades": len(trades), "flash_usd": flash, "first_order_usd": first_total,
                           "second_order_usd": (prior or {}).get("second_order_usd"), "xva_usd": xva, "applied_at": (prior or {}).get("applied_at"),
                           "overrides": ovs, "pnl_date": rep.get("date"), "flash_from_store": bool(rep.get("from_store")), "valuations": valuer.calls}
    if apply and ovs:
        out.update(apply_overrides(db, user, d, scope, out, rep))
    elif apply:
        out.update(second_order_usd=0.0, applied_at=datetime.now(timezone.utc).isoformat())
    out["official_usd"] = flash + first_total + float(out.get("second_order_usd") or 0.0) + float(xva or 0.0)
    out["gate"] = gate(inputs, unvalued)
    out["seconds"] = round(time.time() - t0, 1)
    return out


def apply_overrides(db, user: dict, d: date, scope: Optional[dict], run: dict, flash_rep: dict) -> dict[str, Any]:
    """Revalue the book on the overridden market: official day = the report on it; second order = official −
    flash − first order."""
    from pnl import report as R
    uid = user["sub"]
    mkt = Market(db, uid, d)
    over: dict[str, list[dict]] = {}
    for o in run["overrides"]:
        cid = o["curve_id"]
        over.setdefault(cid, {})[o["pillar"]] = o["override_value"]
    overrides = {cid: I.with_overrides(cid, mkt.quotes(cid) or [], vals) for cid, vals in over.items()}
    rep = R.report(db, user, d, prefer_stored=False, overrides=overrides)
    rows = [r for r in rep.get("rows") or [] if row_in_scope(r, scope)]
    official_day = sum(float(r.get("usd") or 0.0) for r in rows)
    second = official_day - run["flash_usd"] - run["first_order_usd"]
    return {"second_order_usd": second, "applied_at": datetime.now(timezone.utc).isoformat(), "official_day_revalued_usd": official_day}


def build_and_store(db, user: dict, d: date, scope: Optional[dict] = None, apply: bool = False, progress: Optional[dict] = None) -> dict[str, Any]:
    from risk.report import firm_of
    uid = user["sub"]
    sk = scope_key(scope)
    prior = S.get_run(db, uid, d, sk)
    rules = S.list_tolerances(db, firm_of(db, uid))
    run = build(db, user, d, scope, rules, apply=apply, prior=prior, progress=progress)
    if S.tables_present(db):
        S.put_run(db, uid, d, sk, run)
        db.commit()
    return run


def decide(db, user: dict, d: date, scope: Optional[dict], curve_id: str, state: str, reason: str, name: str) -> dict[str, Any]:
    """Approve as marked, or waive, one input; recorded on the stored run and the run rebuilt."""
    uid = user["sub"]
    sk = scope_key(scope)
    prior = S.get_run(db, uid, d, sk)
    if prior is None:
        raise ValueError("no run for that date and scope: run IPV first")
    found = False
    for i in prior["inputs"]:
        if i["curve_id"] == curve_id:
            i["decision"] = {"state": state, "by": name, "by_id": uid, "at": datetime.now(timezone.utc).isoformat(), "reason": reason}
            found = True
    if not found:
        raise ValueError(f"{curve_id} is not an input of this run")
    S.put_run(db, uid, d, sk, prior)
    db.commit()
    return build_and_store(db, user, d, scope)


def sign(db, user: dict, d: date, scope: Optional[dict], signer_name: str, comment: str) -> dict[str, Any]:
    from pnl import report as R
    uid = user["sub"]
    sk = scope_key(scope)
    run = build_and_store(db, user, d, scope, apply=True)
    if run["gate"]:
        raise PermissionError("; ".join(run["gate"]))
    S.mark_signed(db, uid, d, sk, user["sub"], signer_name)
    if sk == "GLOBAL":
        R.sign(db, user, uid, d, "IPV", comment or "official P&L: flash + IPV + XVA", run["official_usd"], signer_name)
    db.commit()
    run["status"] = "SIGNED"
    run["signed_name"] = signer_name
    return run
