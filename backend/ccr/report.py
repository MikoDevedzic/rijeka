"""The book by counterparty: netting set, both measures, CSA, exposure, CVA, limits; storage and the batch."""
from __future__ import annotations

import json
import logging
import math
import time
import uuid
from datetime import date, datetime, timezone
from typing import Any, Optional

import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import Session

from ccr import calibration as C
from ccr.exposure import BUCKETS, csa_from_counterparty, cva as cva_of, exposures
from ccr.simulate import simulate
from ccr.valuation import NettingSet, flows_per_step, netted_paths
from db.models import Counterparty, Trade
from pnl.explain import LIVE
from pnl.market import Market
from pnl.report import fx_to_usd
from pnl.valuation import _curve_input

log = logging.getLogger("rijeka.ccr")
DEFAULTS = {"n_paths": 2000, "drift_mode": "zero", "window_days": 730, "cp_cds_bp": 85.0, "lgd": 0.40}


def tables_present(db: Session) -> bool:
    try:
        return int(db.execute(text("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ccr_daily'")).scalar() or 0) == 1
    except Exception:
        db.rollback(); return False


def settings(db: Session, firm_id) -> dict:
    out = dict(DEFAULTS)
    if firm_id is None:
        return out
    try:
        r = db.execute(text("SELECT ccr_paths, ccr_drift, window_days FROM risk_settings WHERE firm_id = :f"), {"f": str(firm_id)}).first()
        if r:
            if r.ccr_paths: out["n_paths"] = int(r.ccr_paths)
            if r.ccr_drift: out["drift_mode"] = str(r.ccr_drift)
            if r.window_days: out["window_days"] = int(r.window_days)
    except Exception:
        db.rollback()
    return out


def _curves(db: Session, uid: str, mkt: Market, keys: list[str], asof: date) -> dict[str, Any]:
    from api.routes.pricer import _build_curve
    out = {}
    for key in keys:
        cid = key.split(":", 1)[1]
        out[key] = _build_curve(_curve_input(cid, mkt.quotes(cid)), asof, db, uid)
    return out


def _zero_1y(curve, asof: date) -> float:
    from ccr.simulate import add_months
    try:
        return -math.log(max(float(curve.df(add_months(asof, 12))), 1e-9))
    except Exception:
        return 0.03


def counterparty_report(db: Session, user: dict, cp, trades: list, asof: date, mkt: Market, st: dict, tpl) -> dict[str, Any]:
    t0 = time.time()
    uid = user["sub"]
    ns = NettingSet(db, user, trades, asof)
    base = {"counterparty_id": str(cp.id) if cp else None, "counterparty": cp.name if cp else "UNASSIGNED",
            "csa": {"type": getattr(cp, "csa_type", None), "threshold_m": float(getattr(cp, "csa_threshold_m", 0) or 0), "mta_k": float(getattr(cp, "csa_mta_k", 0) or 0)} if cp else None,
            "trades": len(trades), "simulated": len(ns.items), "skipped": ns.skipped}
    if not ns.items:
        return {**base, "empty": True}
    currencies, pairs = sorted(ns.currencies), sorted(ns.pairs)
    rw = C.real_world(db, tpl, currencies, pairs, asof, int(st["window_days"]), st["drift_mode"]) if tpl else C.risk_neutral(db, uid, currencies, pairs)
    rn = C.risk_neutral(db, uid, currencies, pairs)
    rate_keys = [k for k in rw.order if k.startswith("RATES:")]
    curves = _curves(db, uid, mkt, rate_keys, asof)
    spots = {f"SPOT:{p}": mkt.spot(p) for p in pairs}
    missing = [p for p, s in zip(pairs, spots.values()) if not s]
    if missing:
        return {**base, "empty": True, "skipped": ns.skipped + [{"trade_ref": "*", "reason": f"no spot for {', '.join(missing)}"}]}
    from api.routes.currencies import POLICY_RATE_PCT
    spot_rates, flat_base = {}, {}
    for p in pairs:
        quote, b = p[3:], p[:3]
        rq = _zero_1y(curves[f"RATES:{C.CURVE_OF.get(quote, quote + '_OIS')}"], asof)
        bkey = f"RATES:{C.CURVE_OF.get(b)}" if b in C.CURVE_OF else None
        if bkey and bkey in curves:
            rb = _zero_1y(curves[bkey], asof)
        else:
            flat = mkt.single(f"{b}_FUNDING", "FLAT") if b not in C.CURVE_OF and mkt.single(f"{b}_FUNDING", "FLAT") is not None else mkt.single(f"{b}_FLAT", "FLAT")
            rb = float(flat if flat is not None else POLICY_RATE_PCT.get(b, 0.0)) / 100.0
            flat_base[p] = rb
        spot_rates[f"SPOT:{p}"] = (rq, rb)
    fx = {c: (fx_to_usd(mkt, c) or 0.0) for c in currencies | {"USD"}} if isinstance(currencies, set) else {c: (fx_to_usd(mkt, c) or 0.0) for c in set(currencies) | {"USD"}}
    months, n_paths = ns.months, int(st["n_paths"])
    csa = csa_from_counterparty(cp) if cp else csa_from_counterparty(None)
    # IM for a CSA that exchanges it: SIMM weight on the netting set's IR01 (ladder), MPoR-scaled
    im0 = 0.0
    if csa.im_exchanged:
        try:
            from pnl.explain import Valuer
            from pricing.xva_engine import simm_ir_risk_weight
            from risk.sensitivities import trade_ladder
            val = Valuer(db, user)
            ir01 = sum(trade_ladder(db, user, it["trade"], asof, mkt, val)["ir01"] * fx.get(it["ccy"], 1.0) for it in ns.items)
            im0 = abs(ir01) * simm_ir_risk_weight((ns.max_maturity - asof).days / 365.25) * csa.simm_mpor_scale
        except Exception as e:          # noqa: BLE001
            log.info("ccr: IM estimate failed for %s: %s", base["counterparty"], e)
    # real world: exposure
    p_rw = simulate(rw, curves, spots, spot_rates, asof, months, n_paths, seed=7)
    V_rw, today = netted_paths(ns, p_rw, fx, flat_base)
    flows = flows_per_step(ns, p_rw, fx) if csa.collateralised else None
    ex = exposures(V_rw, p_rw.t, csa, im0, flows=flows)
    # risk neutral: CVA
    p_rn = simulate(rn, curves, spots, spot_rates, asof, months, n_paths, seed=7)
    V_rn, _ = netted_paths(ns, p_rn, fx, flat_base)
    usd_key = next((k for k in rate_keys if k.endswith("USD_SOFR")), rate_keys[0])
    p0 = [float(p_rn.p0[usd_key](tt)) for tt in p_rn.t] + [float(p_rn.p0[usd_key](float(p_rn.t[-1]) + 1 / 12))]
    gross = sum(abs(float(it["trade"].notional or 0)) * fx.get((it["trade"].notional_ccy or "USD").upper(), 1.0) for it in ns.items)
    cv = cva_of(V_rn, p_rn.t, p0, csa, gross, cp_cds_bp=float(st["cp_cds_bp"]), lgd=float(st["lgd"]), im0_usd=im0)
    grid = [d.isoformat() for d in p_rw.grid[1:]]
    return {**base, "empty": False, "asof": asof.isoformat(), "grid": grid, "t": [float(x) for x in p_rw.t[1:]], "n_paths": n_paths, "months": months,
            "csa_model": {"preset": csa.preset, "collateralised": csa.collateralised, "threshold_usd": csa.threshold_cp, "mta_usd": csa.mta, "mpor_days": csa.mpor_days, "im_exchanged": csa.im_exchanged},
            "trades_today": today, "gross_notional_usd": gross,
            "exposure": {k: v for k, v in ex.items() if k not in ("mean_collateral",)}, "mean_collateral": ex["mean_collateral"],
            "cva": {k: v for k, v in cv.items() if k not in ("ee_rn", "pfe95_rn")}, "ee_rn": cv["ee_rn"], "pfe95_rn": cv["pfe95_rn"],
            "calibration": {"real_world": rw.as_dict(), "risk_neutral": rn.as_dict()},
            "measures": {"exposure": "REAL_WORLD", "cva": "RISK_NEUTRAL"}, "seconds": round(time.time() - t0, 1)}


def report(db: Session, user: dict, asof: Optional[date] = None, only_counterparty: Optional[str] = None, progress: Optional[dict] = None) -> dict[str, Any]:
    uid = user["sub"]
    from risk.report import firm_of, template_uid
    dates = Market.dates(db, uid, upto=asof or date.today())
    if not dates:
        return {"date": None, "counterparties": [], "note": "No market dates: save or snap a curve first."}
    asof = asof if asof and asof in dates else dates[-1]
    mkt = Market(db, uid, asof)
    st = settings(db, firm_of(db, uid))
    tpl = template_uid(db)
    trades = [t for t in db.query(Trade).filter(Trade.user_id == uid).all() if t.status in LIVE]
    cps = {c.id: c for c in db.query(Counterparty).filter(Counterparty.user_id == uid).all()}
    groups: dict = {}
    for t in trades:
        groups.setdefault(t.counterparty_id, []).append(t)
    out = []
    items = [(cid, ts) for cid, ts in groups.items() if not only_counterparty or str(cid) == only_counterparty]
    for n, (cid, ts) in enumerate(items):
        if progress is not None:
            progress.update(current=cps.get(cid).name if cps.get(cid) else "UNASSIGNED", done=n, total=len(items))
        try:
            out.append(counterparty_report(db, user, cps.get(cid), ts, asof, mkt, st, tpl))
        except Exception as e:          # noqa: BLE001
            db.rollback()
            log.warning("ccr: %s failed: %s", cid, e)
            out.append({"counterparty_id": str(cid) if cid else None, "counterparty": cps.get(cid).name if cps.get(cid) else "UNASSIGNED", "trades": len(ts), "error": str(e)[:200], "empty": True})
    rep = {"date": asof.isoformat(), "dates": [d.isoformat() for d in dates[-40:]], "settings": st, "counterparties": out, "quantiles": ["95", "97.5", "99"],
           "totals": {"peak_pfe95_usd": sum(c["exposure"]["peak_pfe95_usd"] for c in out if not c.get("empty")),
                      "epe_1y_usd": sum(c["exposure"]["epe_1y_usd"] for c in out if not c.get("empty")),
                      "current_exposure_usd": sum(c["exposure"]["current_exposure_usd"] for c in out if not c.get("empty")),
                      "cva_usd": sum(c["cva"]["cva_usd"] for c in out if not c.get("empty")), "counterparties": len(out)},
           "generated_at": datetime.now(timezone.utc).isoformat(), "tables": tables_present(db)}
    rep["limits"] = _limits(db, uid, rep)
    rep["breaches"] = sum(1 for x in rep["limits"] if x["status"] == "BREACH")
    return rep


def _limits(db: Session, uid: str, rep: dict) -> list[dict]:
    from risk import limits as L
    from risk.report import firm_of
    lims = [l for l in L.list_limits(db, firm_of(db, uid)) if l["metric"].upper().split(":")[0] in ("PFE_PEAK", "PFE", "EPE", "CVA", "CE")]
    return L.evaluate(lims, {"ladder_rows": [], "var": {}, "stress": [], "ccr": {c["counterparty"]: c for c in rep["counterparties"] if not c.get("empty")}})


def store(db: Session, user: dict, rep: dict) -> dict:
    if not tables_present(db) or not rep.get("date"):
        return {"stored": False}
    n = 0
    for c in rep["counterparties"]:
        slim = {k: v for k, v in c.items() if k not in ("mean_collateral", "ee_rn", "pfe95_rn")}
        db.execute(text("INSERT INTO ccr_daily (id, user_id, run_date, counterparty_id, counterparty, report, peak_pfe95, epe_1y, cva, current_exposure) "
                        "VALUES (:id, :u, :d, :c, :n, CAST(:r AS jsonb), :p, :e, :v, :ce) ON CONFLICT (user_id, run_date, counterparty) DO UPDATE SET report = EXCLUDED.report, "
                        "peak_pfe95 = EXCLUDED.peak_pfe95, epe_1y = EXCLUDED.epe_1y, cva = EXCLUDED.cva, current_exposure = EXCLUDED.current_exposure, counterparty_id = EXCLUDED.counterparty_id, created_at = now()"),
                   {"id": str(uuid.uuid4()), "u": user["sub"], "d": rep["date"], "c": c.get("counterparty_id"), "n": c["counterparty"], "r": json.dumps(slim, default=str),
                    "p": (c.get("exposure") or {}).get("peak_pfe95_usd"), "e": (c.get("exposure") or {}).get("epe_1y_usd"), "v": (c.get("cva") or {}).get("cva_usd"),
                    "ce": (c.get("exposure") or {}).get("current_exposure_usd")})
        n += 1
    db.commit()
    return {"stored": True, "rows": n, "date": rep["date"]}


def latest_stored(db: Session, uid: str) -> Optional[dict]:
    if not tables_present(db):
        return None
    try:
        rows = db.execute(text("SELECT run_date, counterparty, report, created_at FROM ccr_daily WHERE user_id = :u AND run_date = "
                               "(SELECT max(run_date) FROM ccr_daily WHERE user_id = :u) ORDER BY counterparty"), {"u": uid}).all()
    except Exception:
        db.rollback(); return None
    if not rows:
        return None
    cps = [r.report for r in rows]
    rep = {"date": rows[0].run_date.isoformat(), "stored_at": max(r.created_at for r in rows).isoformat(), "counterparties": cps, "quantiles": ["95", "97.5", "99"],
           "totals": {"peak_pfe95_usd": sum(c["exposure"]["peak_pfe95_usd"] for c in cps if not c.get("empty")),
                      "epe_1y_usd": sum(c["exposure"]["epe_1y_usd"] for c in cps if not c.get("empty")),
                      "current_exposure_usd": sum(c["exposure"]["current_exposure_usd"] for c in cps if not c.get("empty")),
                      "cva_usd": sum(c["cva"]["cva_usd"] for c in cps if not c.get("empty")), "counterparties": len(cps)}, "from_store": True, "tables": True}
    rep["limits"] = _limits(db, uid, rep)
    rep["breaches"] = sum(1 for x in rep["limits"] if x["status"] == "BREACH")
    return rep
