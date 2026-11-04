"""The ticket's collateral onto a CSA: what the variation margin is posted and received in (instrument weights), what the
initial margin is posted in, the rail. Resolves the instruments' carry over OIS from the account's market and sets the CSA's
VM carries and IM pickup; records the choice on the CSA for the response and the derivation drawer."""
from __future__ import annotations

from datetime import date
from typing import Optional

from collateral import regimes, store, yields
from pricing import collateral as COL
from pricing.csa import CSA


def _comp(raw, instruments: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for code, w in (raw or {}).items():
        code = str(code).upper()
        if code not in instruments:
            raise ValueError(f"unknown collateral instrument {code}")
        w = float(w)
        if w < 0:
            raise ValueError("collateral weights must be non-negative")
        if w > 0:
            out[code] = w
    tot = sum(out.values())
    return {k: v / tot for k, v in out.items()} if tot > 0 else {}


def apply_collateral(db, uid: str, csa: CSA, body: Optional[dict], mkt=None, asof: Optional[date] = None) -> CSA:
    """body: {posted: {code: w}, received: {code: w}, im_posted?: {code: w}, rail?: bilateral|on_chain}. Blank sides mean
    cash in the CSA currency (zero carry). An explicit im_yield_pickup_bp on the CSA is kept as an override."""
    if not body:
        return csa
    inst = store.instruments(db, regimes.scope_of(db, uid), include_inactive=True)
    posted, received = _comp(body.get("posted"), inst), _comp(body.get("received"), inst)
    im_posted = _comp(body.get("im_posted"), inst) or posted
    rate_fn = yields.curve_rate_bp_fn(db, uid, mkt, asof or date.today()) if mkt is not None else None
    carry = {c: inst[c].carry_bp(rate_fn) for c in set(posted) | set(received) | set(im_posted)}
    yld = {c: inst[c].resolve_yield_bp(rate_fn) for c in carry}
    wavg = lambda comp: sum(w * carry[c] for c, w in comp.items()) if comp else 0.0
    out = CSA(**{k: getattr(csa, k) for k in csa.__dataclass_fields__})
    out.vm_post_carry_bp = wavg(posted)
    out.vm_recv_carry_bp = wavg(received)
    # IM: only the part eligible as IM earns the pickup (the ineligible part is replaced by eligible IM funded separately)
    im_elig = {c: w for c, w in im_posted.items() if inst[c].klass.im_eligible == "YES" or inst[c].klass.im_eligible == "CONDITIONAL"}
    if body.get("im_yield_pickup_bp") is None and (csa.im_yield_pickup_bp == 0.0 or body.get("override_pickup") is False):
        out.im_yield_pickup_bp = sum(w * carry[c] for c, w in im_elig.items()) if im_elig else 0.0
    rail = str(body.get("rail") or "").lower() or None
    out.collateral = {"posted": posted, "received": received, "im_posted": im_posted, "carry_bp": carry, "yield_bp": yld, "rail": rail,
                      "posted_carry_bp": out.vm_post_carry_bp, "received_carry_bp": out.vm_recv_carry_bp, "im_pickup_bp": out.im_yield_pickup_bp,
                      "instruments": {c: {"name": inst[c].name, "cls": inst[c].cls, "rail": inst[c].rail} for c in carry},
                      "ois_known": bool(rate_fn is not None and any(rate_fn(COL.OIS_OF.get(inst[c].currency.upper(), "")) is not None for c in carry))}
    return out


def collateral_from_schedule(db, cp_id) -> Optional[dict]:
    """The counterparty's schedule as the body apply_collateral takes, for the ticket's default."""
    sched = store.schedule(db, cp_id)
    if sched is None:
        return None
    return {"posted": dict(sched.posted), "received": dict(sched.received), "rail": sched.rail}
