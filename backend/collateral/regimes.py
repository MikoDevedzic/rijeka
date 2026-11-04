"""The counterparty's regime: from its schedule when one is recorded (instruments, rail, yields from market data),
else from the class-level fields on the record (the pre-schedule behaviour, docs/migrations/2026-11-04_counterparty_capital.sql)."""
from __future__ import annotations

from datetime import date
from typing import Optional

from collateral import store, yields
from pricing import collateral as COL
from pricing.csa import CSA


def scope_of(db, uid: str):
    """Instruments are shared by the firm; an account without a firm keeps its own list under its user id."""
    from risk.report import firm_of
    return firm_of(db, uid) or uid


def regime_for(db, uid: str, cp_view, csa: CSA, mkt=None, asof: Optional[date] = None, name: str = "COUNTERPARTY") -> COL.Regime:
    cp_id = getattr(cp_view, "id", None) if cp_view is not None else None
    sched = store.schedule(db, cp_id, asof) if cp_id is not None else None
    if sched is None:
        if cp_view is None:
            return COL.Regime(name, CSA(**{k: getattr(csa, k) for k in csa.__dataclass_fields__}), ["CASH", "GOVT"])
        r = COL.regime_from_counterparty(cp_view, csa)
        r.name = name
        return r
    inst = store.instruments(db, scope_of(db, uid), include_inactive=True)
    enf = getattr(cp_view, "netting_enforceable", None)
    rate_fn = yields.curve_rate_bp_fn(db, uid, mkt, asof or date.today()) if mkt is not None else None
    return COL.regime_from_schedule(sched, csa, inst, name=name, netting_enforceable=True if enf is None else bool(enf), curve_rate_bp=rate_fn)


def class_fields(sched: COL.Schedule, instruments: dict) -> dict:
    """The class-level fields the record keeps in step with its schedule, so every reader that predates schedules
    (the regimes report's record block, the counterparty list) sees the same facts."""
    def by_class(comp: dict) -> dict:
        out: dict = {}
        for code, w in comp.items():
            cls = instruments[code].cls
            out[cls] = out.get(cls, 0.0) + float(w)
        return out
    elig = sorted({instruments[e["instrument"]].cls for e in sched.eligible})
    return {"eligible_collateral": elig, "posted_composition": by_class(sched.posted), "received_composition": by_class(sched.received)}
