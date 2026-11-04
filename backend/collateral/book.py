"""The book's collateral: per counterparty, the schedule in force, today's variation-margin position and initial margin from
the latest stored credit run, what each side is held in by instrument at its haircut, the carry that earns or costs over a
year, the rail; totals by instrument and by class. Read-only over what the credit run and the schedules already hold."""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from collateral import regimes, store, yields
from pricing import collateral as COL


def _market(db, uid: str):
    from pnl.market import Market
    dates = Market.dates(db, uid, upto=date.today())
    if not dates:
        return None, None
    return Market(db, uid, dates[-1]), dates[-1]


def _haircut_pct(inst: COL.Instrument, sched: Optional[COL.Schedule]) -> float:
    if sched is not None:
        for e in sched.eligible:
            if e.get("instrument") == inst.code and e.get("csa_haircut_pct") is not None:
                return float(e["csa_haircut_pct"])
    if inst.csa_haircut_pct is not None:
        return float(inst.csa_haircut_pct)
    return float(inst.klass.haircut_pct(1.0))


def _legs(amount: float, comp: dict[str, float], inst: dict, sched: Optional[COL.Schedule], carry: dict[str, float]) -> list[dict]:
    """One leg per instrument of a composition: the face amount, the haircut, the value after it, the carry per year."""
    if amount <= 0 or not comp:
        return []
    tot = sum(comp.values()) or 1.0
    out = []
    for code, w in sorted(comp.items(), key=lambda kv: -kv[1]):
        i = inst.get(code)
        if i is None:
            continue
        face = amount * float(w) / tot
        h = _haircut_pct(i, sched)
        out.append({"instrument": code, "cls": i.cls, "rail": i.rail, "weight": float(w) / tot, "face_usd": face, "haircut_pct": h,
                    "value_usd": face * (1.0 - h / 100.0), "carry_bp": carry.get(code, 0.0), "carry_per_year_usd": face * carry.get(code, 0.0) / 1e4})
    return out


def report(db, user: dict) -> dict[str, Any]:
    from ccr.report import latest_stored
    from db.models import Counterparty
    import uuid as _uuid
    uid = user["sub"]
    stored = latest_stored(db, uid)
    by_name = {c.get("counterparty"): c for c in (stored or {}).get("counterparties") or []}
    inst = store.instruments(db, regimes.scope_of(db, uid), include_inactive=True)
    mkt, asof = _market(db, uid)
    rate_fn = yields.curve_rate_bp_fn(db, uid, mkt, asof) if mkt is not None else None
    carry = {c: i.carry_bp(rate_fn) for c, i in inst.items()}
    cps = db.query(Counterparty).filter(Counterparty.user_id == _uuid.UUID(uid), Counterparty.is_active == True).order_by(Counterparty.name).all()   # noqa: E712
    scheds = store.schedules(db, [c.id for c in cps])
    rows: list[dict] = []
    by_inst: dict[str, dict] = {}
    by_cls: dict[str, dict] = {}
    tot = {"vm_held_usd": 0.0, "vm_posted_usd": 0.0, "im_usd": 0.0, "carry_per_year_usd": 0.0, "on_chain_usd": 0.0, "requirement_usd": 0.0}

    def add(bucket: dict, key: str, leg: dict, side: str):
        b = bucket.setdefault(key, {"key": key, "posted_usd": 0.0, "held_usd": 0.0, "value_usd": 0.0, "carry_per_year_usd": 0.0})
        b["posted_usd" if side == "posted" else "held_usd"] += leg["face_usd"]
        b["value_usd"] += leg["value_usd"]
        b["carry_per_year_usd"] += leg["carry_per_year_usd"]

    for cp in cps:
        s = scheds.get(str(cp.id))
        rep = by_name.get(cp.name)
        ex = (rep or {}).get("exposure") or {}
        csa_type = str(getattr(cp, "csa_type", None) or "NO_CSA").upper()
        collateralised = csa_type not in ("NO_CSA", "NONE", "")
        c_now = float(ex.get("collateral_now_usd") or 0.0) if collateralised else 0.0       # + = we hold theirs
        held, posted = max(c_now, 0.0), max(-c_now, 0.0)
        im = float(ex.get("im0_usd") or 0.0) if collateralised and "IM" in csa_type else 0.0
        ccy = str(getattr(cp, "csa_currency", None) or "USD").upper()
        cash = f"{ccy}_CASH" if f"{ccy}_CASH" in inst else "USD_CASH"
        posted_comp = dict(s.posted) if s else {cash: 1.0}
        received_comp = dict(s.received) if s else {cash: 1.0}
        legs_posted = _legs(posted + im, posted_comp, inst, s, carry)          # what we post: VM when out of the money, plus our IM
        legs_held = _legs(held + im, received_comp, inst, s, carry)           # what we hold: their VM when in the money, plus their IM
        carry_year = sum(l["carry_per_year_usd"] for l in legs_posted) + sum(l["carry_per_year_usd"] for l in legs_held)
        rail = s.rail if s else "bilateral"
        req = posted + held + 2 * im
        for l in legs_posted:
            add(by_inst, l["instrument"], l, "posted"); add(by_cls, l["cls"], l, "posted")
        for l in legs_held:
            add(by_inst, l["instrument"], l, "held"); add(by_cls, l["cls"], l, "held")
        tot["vm_held_usd"] += held; tot["vm_posted_usd"] += posted; tot["im_usd"] += im; tot["carry_per_year_usd"] += carry_year
        tot["requirement_usd"] += req
        if rail == "on_chain":
            tot["on_chain_usd"] += req
        rows.append({"counterparty_id": str(cp.id), "counterparty": cp.name, "csa_type": csa_type, "csa_currency": ccy,
                     "threshold_m": float(getattr(cp, "csa_threshold_m", 0) or 0), "mta_k": float(getattr(cp, "csa_mta_k", 0) or 0),
                     "schedule": s.to_dict() if s else None, "rail": rail, "has_run": rep is not None and not rep.get("empty"),
                     "trades": (rep or {}).get("trades"), "v0_usd": ex.get("v0_usd"), "vm_held_usd": held, "vm_posted_usd": posted, "im_usd": im,
                     "current_exposure_usd": ex.get("current_exposure_usd"), "posted": legs_posted, "held": legs_held, "carry_per_year_usd": carry_year,
                     "note": None if rep is not None else "no stored credit run for this counterparty: positions unknown until Risk → Counterparty credit runs"})
    return {"date": (stored or {}).get("date"), "stored_at": (stored or {}).get("stored_at"), "asof": asof.isoformat() if asof else None,
            "counterparties": rows, "totals": {**tot, "on_chain_share": (tot["on_chain_usd"] / tot["requirement_usd"]) if tot["requirement_usd"] > 0 else None,
                                               "counterparties": len(rows), "with_schedule": sum(1 for r in rows if r["schedule"])},
            "by_instrument": sorted(by_inst.values(), key=lambda b: -(b["posted_usd"] + b["held_usd"])),
            "by_class": sorted(by_cls.values(), key=lambda b: -(b["posted_usd"] + b["held_usd"])),
            "instruments": {c: {"name": i.name, "cls": i.cls, "rail": i.rail, "carry_bp": carry[c]} for c, i in inst.items()},
            "writable": store.tables_present(db),
            "notes": ["positions are the latest stored credit run's: the variation margin against the netted value today (+ held, − posted) and the initial margin "
                      "when the CSA exchanges it, posted and received alike; what each side is held in is the counterparty's schedule, cash in the CSA currency without one",
                      "the value after haircut uses the schedule's negotiated haircut, else the instrument's, else the class's CRE22.49 row at one year",
                      "carry per year is the face amount times the instrument's carry over OIS: what posted margin earns above cash and what held margin earns above the rebate",
                      "settlement of margin calls on chain is on the roadmap; the rail here is the schedule's"]}
