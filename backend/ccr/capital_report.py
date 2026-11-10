"""The book's capital under collateral regimes, and the attribution of the difference to its channels.

For every counterparty the netting set is simulated once on the credit engine's risk-neutral paths (seed 7) and
re-collateralised step by step from the CSA as booked to an on-chain CSA under today's rules, then to the
forward-looking states that need supervisory recognition. Each step changes one thing, and the difference it
makes is that channel's attribution (sequential, like the P&L explain). Common random numbers throughout, so a
difference is the regime, never the noise.

    BASELINE            the record: its CSA type, threshold, MTA, margin frequency, disputes, collateral, enforceability
    THRESHOLD_MTA       variation margin at zero threshold and zero MTA                      CRE52.18–52.19
    MARGIN_FREQUENCY    daily (continuous) margining: MPoR to the 10-day floor                CRE52.50
    DISPUTES            the doubled floor removed                                             CRE52.51
    COLLATERAL          recognised collateral received, close-out netting enforceable          CRE22.34, SCO60.94, CRE52.18
    IM_ELIGIBILITY      eligible IM in the asset held; its yield; no double funding            CFTC §23.156
    = ON_CHAIN_CURRENT
    MPOR_RELIEF         the cleared floor for atomic settlement                   FORWARD      CRE52.50 as argued; not recognised
    TOKENISED_IM        a tokenised sovereign claim eligible as IM, at its yield  FORWARD      CFTC §23.156: a state
    HQLA_L1             Level 1 liquidity treatment of the margin posted          FORWARD      BCBS 238 / LCR30: a state
    = ON_CHAIN_FORWARD

Invariant by construction, and reported as such: initial margin at a given MPoR (the engine's estimate, a function of
the paths and the margin period, not of what the margin is held in), market-risk capital."""
from __future__ import annotations

import logging
import math
import time
from dataclasses import replace
from datetime import date, datetime, timezone
from typing import Any, Optional

import numpy as np
from sqlalchemy.orm import Session

from pricing import capital as CAP
from pricing import collateral as COL
from pricing import sa_ccr as SA
from pricing.csa import CSA, MPOR_FLOOR_BILATERAL_BD
from pricing.xva_engine import WaterfallParams, run_waterfall

log = logging.getLogger("rijeka.capital")

METRICS = ("im", "ead", "rwa", "k_ccr", "k_cva", "kva", "kva_ccr", "kva_cva", "mva", "cva", "dva", "fva", "fba", "colva", "xva_total",
           "leverage", "hqla_im", "addon", "rc", "multiplier", "cost")
COST_KEYS = ("cva", "fva", "kva", "mva", "colva")      # the P&L charge of a regime: the credit, funding, capital and margin costs and the collateral carry
COLUMNS = ("BASELINE", "ON_CHAIN_CURRENT", "ON_CHAIN_FORWARD")
STEPS = (
    ("THRESHOLD_MTA", "Zero threshold and MTA", "CURRENT", "CRE52.18–52.19: the replacement cost is floored at TH + MTA − NICA; atomic settlement makes zero credible"),
    ("MARGIN_FREQUENCY", "Daily margining", "CURRENT", "CRE52.50: re-margining every N business days carries an MPoR of 9 + N; daily gets the 10-day floor"),
    ("DISPUTES", "No dispute doubling", "CURRENT", "CRE52.51: more than two margin disputes in two quarters doubles the floor; a shared record removes the dispute"),
    ("COLLATERAL", "Recognised collateral, enforceable netting", "CURRENT", "CRE22.34 and SCO60.94: the collateral counts and the set is margined (CRE52.18); parity with cash, not superiority"),
    ("IM_ELIGIBILITY", "Eligible IM in the asset held, at its yield", "CURRENT", "CFTC §23.156: no double funding of IM; the posted asset's yield offsets the funding spread (MVA)"),
    ("MPOR_RELIEF", "Cleared-floor MPoR for atomic settlement", "FORWARD", "CRE52.50: the floor is 10 business days for non-cleared sets; the cleared floor needs supervisory recognition"),
    ("TOKENISED_IM", "Tokenised sovereign claim eligible as IM", "FORWARD", "CFTC §23.156: a tokenised sovereign claim is not enumerated; eligibility is a state the firm elects"),
    ("HQLA_L1", "Level 1 liquidity treatment", "FORWARD", "BCBS 238 / LCR30: Level 2A floor, Level 1 ceiling by look-through; a state"),
)
CURRENT_LAST = "IM_ELIGIBILITY"


# ── the sets ───────────────────────────────────────────────────────────────────────────────────────

def prepare_set(db, user: dict, cp, trades: list, asof: date, mkt, st: dict, tpl, notes: list[str]) -> Optional[dict]:
    """The netting set on the risk-neutral paths with its SA-CCR rows, gross notional and today's
    mark; None for no trades; {"empty": True, ...} when nothing could be simulated."""
    from ccr import calibration as C
    from ccr.report import netting_set_paths
    from ccr.saccr_map import from_netting_set
    from ccr.simulate import df_fn
    if not trades:
        return None
    P = netting_set_paths(db, user, cp, trades, asof, mkt, st, tpl, exposure=False)
    if P["empty"]:
        return {"empty": True, "ns": P["ns"], "missing": P.get("missing")}
    dfs = {}
    for c in P["currencies"]:
        key = f"RATES:{C.CURVE_OF.get(c, c + '_OIS')}"
        if key in P["curves"]:
            dfs[c] = df_fn(P["curves"][key], asof)
    rows, rnotes = from_netting_set(P["ns"], mkt, P["fx"], asof, dfs)
    notes.extend(rnotes)
    mtm = sum(float(x.get("mtm_usd") or 0.0) for x in P["today"])
    return {"V": P["V_rn"], "t": P["p_rn"].t, "p0": P["p0"], "rows": rows, "gross": P["gross"], "mtm": mtm,
            "n_paths": P["n_paths"], "months": P["months"], "ns": P["ns"], "today": P["today"], "empty": False, "csa": P["csa"]}


def _cash_fraction(regime: COL.Regime) -> float:
    try:
        return sum(w for c, w in regime._classes(regime.received) if c.code == "CASH")
    except ValueError:
        return 0.0


def metrics_of(wf, regime: COL.Regime, cash_vm_fraction: float) -> dict:
    lev = CAP.leverage_exposure(wf.v_mean_0, wf.coll_mean_0 * cash_vm_fraction, wf.addon_0)
    hq = regime.hqla_value(wf.im_0, "posted")["total"] if wf.im_0 else 0.0
    m = {"im": wf.im_0, "ead": wf.ead_0, "rwa": wf.rwa_0, "k_ccr": wf.capital_0, "k_cva": wf.k_cva_0,
         "kva": wf.kva, "kva_ccr": wf.kva_ccr, "kva_cva": wf.kva_cva, "mva": wf.mva, "cva": wf.cva, "dva": wf.dva, "fva": wf.fva, "fba": wf.fba, "colva": wf.colva,
         "xva_total": wf.xva_total, "leverage": lev, "hqla_im": hq, "addon": wf.addon_0, "rc": wf.rc_0, "multiplier": wf.multiplier_0}
    m["cost"] = -sum(m[k] for k in COST_KEYS)
    return m


def run_set(S: dict, regime: COL.Regime, ci: CAP.CapitalInputs, cp_cds_bp: float, lgd: float, hurdle: float, seed: int = 43) -> tuple[dict, Any]:
    """One netting set under one regime: the waterfall with the capital legs, and the SA-CCR snapshot at the valuation date."""
    eco, reg = regime.economic_csa(), regime.regulatory_csa()
    V, t, p0 = S["V"], S["t"], S["p0"]
    T1 = V.shape[1]
    dt = float(t[1] - t[0]) if T1 > 1 else 1 / 12
    theta = -math.log(max(p0[-1], 1e-9)) / max(float(t[-1]), 1e-6)
    # initial margin under each regime is the engine's estimate over that regime's margin period (xva_engine.model_im)
    params = WaterfallParams(notional=max(S["gross"], 1.0), maturity_y=float(t[-1]), dt=dt, theta=max(theta, 1e-6),
                             cp_cds_bp=cp_cds_bp, lgd=lgd, hurdle_rate=hurdle)
    wf = run_waterfall(V[:, 1:], float(V[:, 0].mean()), p0, params, eco, np.random.default_rng(seed), reg_csa=reg, capital=ci, saccr=S["rows"] or None)
    V0 = float(S["mtm"])
    C0 = (regime.recognised_fraction("received") * max(V0 - eco.threshold_cp, 0.0)) if eco.collateralised else 0.0
    nica = wf.im_0 if reg.im_exchanged else 0.0
    snap = SA.ead(S["rows"], reg, V0, C0, nica).to_dict() if S["rows"] else None
    return metrics_of(wf, regime, _cash_fraction(regime)), snap


# ── the channel steps ───────────────────────────────────────────────────────────────────────────────

def channel_regimes(base: COL.Regime, yield_bp: Optional[float] = None, disputed: bool = False) -> list[dict]:
    """The baseline and every step's regime, in order; each entry {key, label, state, source, regime}. Each step changes
    one thing in the previous step's regime."""
    out = [{"key": "BASELINE", "label": "CSA as booked", "state": "BASELINE", "source": "the counterparty record", "regime": base}]
    r = base
    for key, label, state, source in STEPS:
        csa = replace(r.csa)
        kw: dict = {}
        if key == "THRESHOLD_MTA":
            csa.collateralised = True; csa.threshold_cp = 0.0; csa.threshold_own = 0.0; csa.mta = 0.0
            if csa.preset == "UNCOLLATERALISED":
                csa.preset = "VM_ONLY"
        elif key == "MARGIN_FREQUENCY":
            csa.mpor_days = (2.0 if disputed else 1.0) * MPOR_FLOOR_BILATERAL_BD      # daily: the floor, still doubled while disputed
        elif key == "DISPUTES":
            csa.mpor_days = MPOR_FLOOR_BILATERAL_BD
        elif key == "COLLATERAL":
            kw = {"eligible": sorted(set(r.eligible) | {"CASH"}), "received": {"CASH": 1.0}, "netting_enforceable": True}
        elif key == "IM_ELIGIBILITY":
            kw = {"posted": {"CASH": 1.0}, "im_eligibility_state": "POST"}
        elif key == "MPOR_RELIEF":
            kw = {"mpor_state": "ON_CHAIN"}
        elif key == "TOKENISED_IM":
            kw = {"eligible": sorted(set(r.eligible) | {"CASH", "GOVT_TOKENISED"}), "posted": {"GOVT_TOKENISED": 1.0}, "received": {"GOVT_TOKENISED": 1.0},
                  "im_eligibility_state": "POST", "yield_override_bp": ({"GOVT_TOKENISED": float(yield_bp)} if yield_bp is not None else dict(r.yield_override_bp))}
        elif key == "HQLA_L1":
            kw = {"hqla_state": "CEILING"}
        r = replace(r, csa=csa, name=key, **kw)
        out.append({"key": key, "label": label, "state": state, "source": source, "regime": r})
    return out


def baseline_regime(cp_view, csa: CSA, db=None, uid: Optional[str] = None, mkt=None, asof=None) -> COL.Regime:
    if db is not None and cp_view is not None:
        from collateral.regimes import regime_for
        return regime_for(db, uid, cp_view, csa, mkt, asof)      # the schedule when one is recorded, else the record's class fields
    return COL.regime_from_counterparty(cp_view, csa) if cp_view is not None else COL.Regime("COUNTERPARTY", replace(csa), ["CASH", "GOVT"])


# ── per counterparty and the book ──────────────────────────────────────────────────────────────────

def counterparty_capital(db, user: dict, cp_view, trades: list, asof: date, mkt, st: dict, tpl, hurdle: float = 0.12,
                         yield_bp: Optional[float] = None) -> dict[str, Any]:
    from ccr.exposure import csa_from_counterparty
    t0 = time.time()
    notes: list[str] = []
    cp = cp_view
    base = {"counterparty_id": str(getattr(cp, "id", "")) or None if cp is not None else None, "counterparty": getattr(cp, "name", None) or "UNASSIGNED", "trades": len(trades)}
    S = prepare_set(db, user, cp, trades, asof, mkt, st, tpl, notes)
    if S is None or S.get("empty"):
        skipped = S["ns"].skipped if S else []
        if S and S.get("missing"):
            skipped = skipped + [{"trade_ref": "*", "reason": f"no spot for {', '.join(S['missing'])}"}]
        return {**base, "empty": True, "skipped": skipped, "simulated": 0}
    csa = csa_from_counterparty(cp) if cp is not None else CSA.uncollateralised()
    ci = CAP.CapitalInputs.for_counterparty(getattr(cp, "counterparty_type", None) or "CORPORATE", getattr(cp, "rating_bucket", None) or "UNRATED",
                                            getattr(cp, "cva_sector", None), hurdle,
                                            float(cp.risk_weight_override) if getattr(cp, "risk_weight_override", None) is not None else None)
    steps = channel_regimes(baseline_regime(cp, csa, db, user["sub"], mkt, asof), yield_bp, bool(getattr(cp, "mpor_disputed", None) or False))
    cp_cds, lgd = float(st.get("cp_cds_bp") or 85.0), float(st.get("lgd") or 0.4)
    rows, snaps = [], {}
    prev = None
    for sdef in steps:
        m, snap = run_set(S, sdef["regime"], ci, cp_cds, lgd, hurdle)
        delta = {k: (m[k] - prev[k]) if prev is not None else 0.0 for k in METRICS}
        rg = sdef["regime"]
        rows.append({"key": sdef["key"], "label": sdef["label"], "state": sdef["state"], "source": sdef["source"], "metrics": m, "delta": delta,
                     "csa": {"collateralised": rg.csa.collateralised, "threshold": rg.csa.threshold_cp, "mta": rg.csa.mta, "mpor_days": rg.regulatory_csa().mpor_days,
                             "im_exchanged": rg.csa.im_exchanged, "received": rg.received, "posted": rg.posted, "enforceable": rg.netting_enforceable,
                             "recognised_fraction": rg.recognised_fraction(), "im_eligible_fraction": rg.im_eligible_fraction(), "pickup_bp": rg.im_pickup_bp(),
                             "hqla_state": rg.hqla_state, "mpor_state": rg.mpor_state}})
        if sdef["key"] in ("BASELINE", CURRENT_LAST, STEPS[-1][0]):
            snaps[sdef["key"]] = snap
        prev = m
    by_key = {r["key"]: r for r in rows}
    cols = {"BASELINE": by_key["BASELINE"]["metrics"], "ON_CHAIN_CURRENT": by_key[CURRENT_LAST]["metrics"], "ON_CHAIN_FORWARD": by_key[STEPS[-1][0]]["metrics"]}
    rate = -math.log(max(S["p0"][-1], 1e-9)) / max(float(S["t"][-1]), 1e-6)
    m_years = float(S["t"][-1])
    quote = {c: CAP.quote_advantage(cols["BASELINE"]["cost"] - cols[c]["cost"], max(S["gross"], 1.0), m_years, rate) for c in COLUMNS}
    return {**base, "empty": False, "simulated": len(S["ns"].items), "skipped": S["ns"].skipped, "gross_notional_usd": S["gross"], "mtm_usd": S["mtm"],
            "n_paths": S["n_paths"], "months": S["months"], "maturity_y": m_years, "inputs": ci.to_dict(),
            "record": {"csa_type": getattr(cp, "csa_type", None), "threshold_m": float(getattr(cp, "csa_threshold_m", 0) or 0), "mta_k": float(getattr(cp, "csa_mta_k", 0) or 0),
                       "margin_frequency_days": getattr(cp, "margin_frequency_days", None) or 1, "mpor_disputed": bool(getattr(cp, "mpor_disputed", None) or False),
                       "mpor_days": csa.mpor_days, "eligible_collateral": list(getattr(cp, "eligible_collateral", None) or ["CASH", "GOVT"]),
                       "netting_enforceable": getattr(cp, "netting_enforceable", None) is not False},
            "steps": rows, "columns": cols, "quote": quote, "saccr": snaps, "notes": sorted(set(notes)), "seconds": round(time.time() - t0, 1)}


def report(db: Session, user: dict, progress: Optional[dict] = None, hurdle: float = 0.12, yield_bp: Optional[float] = None,
           n_paths: Optional[int] = None, only_counterparty: Optional[str] = None) -> dict[str, Any]:
    from api.routes.counterparties import read_capital, with_capital
    from ccr.report import LIVE, settings
    from db.models import Counterparty, Trade
    from pnl.market import Market
    from risk.report import firm_of, template_uid
    uid = user["sub"]
    dates = Market.dates(db, uid, upto=date.today())
    if not dates:
        return {"date": None, "counterparties": [], "note": "No market dates: save or snap a curve first."}
    asof = dates[-1]
    mkt = Market(db, uid, asof)
    st = dict(settings(db, firm_of(db, uid)))
    if n_paths:
        st["n_paths"] = int(n_paths)
    tpl = template_uid(db)
    trades = [t for t in db.query(Trade).filter(Trade.user_id == uid).all() if t.status in LIVE]
    cps = {c.id: c for c in db.query(Counterparty).filter(Counterparty.user_id == uid).all()}
    attrs = read_capital(db, list(cps))
    groups: dict = {}
    for t in trades:
        groups.setdefault(t.counterparty_id, []).append(t)
    items = [(cid, ts) for cid, ts in groups.items() if cid in cps and (not only_counterparty or str(cid) == only_counterparty)]
    out = []
    for n, (cid, ts) in enumerate(items):
        cp = cps[cid]
        if progress is not None:
            progress.update(current=cp.name, done=n, total=len(items))
        view = with_capital(cp, attrs.get(str(cid), {}))
        try:
            out.append(counterparty_capital(db, user, view, ts, asof, mkt, st, tpl, hurdle, yield_bp))
        except Exception as e:          # noqa: BLE001
            db.rollback()
            log.warning("capital: %s failed: %s", cid, e)
            out.append({"counterparty_id": str(cid), "counterparty": cp.name, "trades": len(ts), "error": str(e)[:200], "empty": True})
    if progress is not None:
        progress.update(done=len(items), total=len(items), current=None)
    good = [c for c in out if not c.get("empty")]
    totals = {col: {k: sum(c["columns"][col][k] for c in good) for k in METRICS} for col in COLUMNS}
    steps = []
    for key, label, state, source in STEPS:
        steps.append({"key": key, "label": label, "state": state, "source": source,
                      "delta": {k: sum(next(s for s in c["steps"] if s["key"] == key)["delta"][k] for c in good) for k in METRICS}})
    gross = sum(c["gross_notional_usd"] for c in good)
    wm = sum(c["gross_notional_usd"] * c["maturity_y"] for c in good) / gross if gross > 0 else 0.0
    quote = {col: CAP.quote_advantage(totals["BASELINE"]["cost"] - totals[col]["cost"], max(gross, 1.0), wm, 0.04) for col in COLUMNS}
    unassigned = sum(len(ts) for cid, ts in groups.items() if cid not in cps)
    return {"date": asof.isoformat(), "counterparties": out, "totals": totals, "steps": steps, "quote": quote, "columns": list(COLUMNS),
            "metrics": list(METRICS), "cost_keys": list(COST_KEYS), "hurdle": hurdle, "yield_bp": yield_bp, "gross_notional_usd": gross,
            "unassigned_trades": unassigned, "seed": 7, "measure": "RISK_NEUTRAL",
            "invariants": ["initial margin at a given margin period of risk: the engine's estimate from the paths, not a function of what the margin is held in",
                           "market-risk capital (FRTB): not a function of collateral or settlement; not computed here",
                           "every column and step runs on the same paths (seed 7): a difference is the regime, not the noise",
                           "P&L charges (CVA, FVA, KVA, MVA) and regulatory stock (RWA, K) are separate ledgers and are never added to each other"],
            "generated_at": datetime.now(timezone.utc).isoformat()}
