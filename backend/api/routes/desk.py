"""
GET /api/desk/lifecycle     what the desk globe draws: chain health, the action inbox,
                            recent anchors with proof links, and the book as arcs
                            between the entities' home cities.

Nothing here is computed from scratch: trades, events, chat cards and the
chain backend already exist; this reads them once and shapes them for the
home page. Chain reads (latest block, relayer balance) are cached for a
minute so a page load never waits on Sepolia.
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from typing import Any, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.models import ChatMessage, ChatRoomMember, Counterparty, FirmMember, LegalEntity, Trade
from db.session import get_db
from middleware.auth import verify_token

log = logging.getLogger("rijeka.desk")
router = APIRouter(prefix="/api/desk", tags=["desk"])

# Relayer wallet: below this the next few anchors are at risk on Sepolia.
LOW_BALANCE_ETH = 0.02
MATURITY_WINDOW_DAYS = 30
CHAIN_TTL_SECONDS = 60
NETWORKS = {1: "ETHEREUM", 11155111: "SEPOLIA", 31337: "LOCAL"}

# Financial centre per jurisdiction (ISO 3166-1 alpha-2) and per home currency,
# for drawing the book on the globe. A location, not an address.
CITIES = {
    "US": ("NEW YORK", 40.71, -74.01), "GB": ("LONDON", 51.51, -0.13), "DE": ("FRANKFURT", 50.11, 8.68),
    "CH": ("ZURICH", 47.38, 8.54), "JP": ("TOKYO", 35.68, 139.69), "AU": ("SYDNEY", -33.87, 151.21),
    "SG": ("SINGAPORE", 1.35, 103.82), "HK": ("HONG KONG", 22.32, 114.17), "FR": ("PARIS", 48.86, 2.35),
    "NL": ("AMSTERDAM", 52.37, 4.90), "IE": ("DUBLIN", 53.35, -6.26), "LU": ("LUXEMBOURG", 49.61, 6.13),
    "CA": ("TORONTO", 43.65, -79.38), "IT": ("MILAN", 45.46, 9.19), "ES": ("MADRID", 40.42, -3.70),
    "SE": ("STOCKHOLM", 59.33, 18.07), "NO": ("OSLO", 59.91, 10.75), "DK": ("COPENHAGEN", 55.68, 12.57),
    "AE": ("DUBAI", 25.20, 55.27), "IN": ("MUMBAI", 19.08, 72.88), "CN": ("SHANGHAI", 31.23, 121.47),
    "KR": ("SEOUL", 37.57, 126.98), "BR": ("SAO PAULO", -23.55, -46.63), "ZA": ("JOHANNESBURG", -26.20, 28.05),
    "KY": ("GEORGE TOWN", 19.29, -81.37), "BM": ("HAMILTON", 32.29, -64.78), "HR": ("ZAGREB", 45.81, 15.98),
}
CCY_CITY = {"USD": "US", "EUR": "DE", "GBP": "GB", "CHF": "CH", "JPY": "JP", "AUD": "AU", "CAD": "CA",
            "SGD": "SG", "HKD": "HK", "SEK": "SE", "NOK": "NO", "DKK": "DK"}


def city_for(entity: Optional[LegalEntity], default: str = "US") -> dict:
    code = None
    if entity is not None:
        j = (entity.jurisdiction or "").strip().upper()
        code = j if j in CITIES else CCY_CITY.get((entity.home_currency or "").strip().upper())
    name, lat, lon = CITIES[code or default]
    return {"city": name, "lat": lat, "lon": lon, "code": code or default}


# ── chain health ─────────────────────────────────────────────────────────────

_chain_cache: dict[str, Any] = {"at": 0.0, "body": None}


def _chain_health() -> dict:
    now = time.monotonic()
    if _chain_cache["body"] is not None and now - _chain_cache["at"] < CHAIN_TTL_SECONDS:
        return _chain_cache["body"]
    out: dict[str, Any] = {"anchored": False, "network": "OFF-CHAIN"}
    try:
        from chain.attestation import get_backend
        be = get_backend()
        if getattr(be, "anchored", False):
            cid = getattr(be, "chain_id", None)
            out.update(anchored=True, chain_id=cid, network=NETWORKS.get(cid, f"CHAIN {cid}"),
                       registry=getattr(be, "registry", None), explorer=getattr(be, "explorer", None),
                       node="fallback" if getattr(be, "_switched", False) else "primary")
            w3 = getattr(be, "w3", None)
            relayer = getattr(be, "relayer", None)
            if w3 is not None:
                try:
                    out["latest_block"] = int(w3.eth.block_number)
                    out["reachable"] = True
                except Exception as e:                       # node down: say so, keep the rest
                    log.debug("desk: block lookup failed: %s", e)
                    out["reachable"] = False
                if relayer is not None:
                    addr = relayer.address
                    bal = None
                    try:
                        bal = int(w3.eth.get_balance(addr)) / 1e18
                    except Exception as e:
                        log.debug("desk: balance lookup failed: %s", e)
                    out["relayer"] = {"address": addr, "balance_eth": bal,
                                      "low": bal is not None and bal < LOW_BALANCE_ETH}
    except Exception as e:
        log.debug("desk: chain backend unavailable: %s", e)
    _chain_cache.update(at=now, body=out)
    return out


# ── the inbox ────────────────────────────────────────────────────────────────

_COUNTERSIGN_SQL = """
SELECT m.id AS message_id, m.room_id, m.created_at, m.card, t.status
FROM chat_messages m
JOIN chat_room_members rm ON rm.room_id = m.room_id AND rm.user_id = :uid AND rm.status = 'JOINED'
JOIN trades t ON t.id = (m.card->>'trade_id')::uuid
WHERE m.card->>'type' = 'trade' AND m.card->>'cp_firm_id' = :firm AND t.status = 'PENDING'
ORDER BY m.created_at DESC LIMIT 20
"""

_ANCHORS_SQL = """
SELECT e.created_at, e.payload, t.trade_ref, t.instrument_type, t.asset_class, t.counterparty_id
FROM trade_events e JOIN trades t ON t.id = e.trade_id
WHERE t.user_id = :uid AND e.event_type = 'CONFIRMED' AND e.confirmation_hash IS NOT NULL
ORDER BY e.created_at DESC LIMIT :n
"""


_NET_ARCS_SQL = """
SELECT t.status, (t.user_id = :uid) AS mine,
       coalesce(oe.jurisdiction, (SELECT e.jurisdiction FROM legal_entities e WHERE e.user_id = t.user_id AND e.is_own_entity ORDER BY e.created_at LIMIT 1)) AS own_j,
       coalesce(oe.home_currency, (SELECT e.home_currency FROM legal_entities e WHERE e.user_id = t.user_id AND e.is_own_entity ORDER BY e.created_at LIMIT 1)) AS own_c,
       ce.jurisdiction AS cp_j, ce.home_currency AS cp_c
FROM trades t
LEFT JOIN legal_entities oe ON oe.id = t.own_legal_entity_id
LEFT JOIN counterparties c ON c.id = t.counterparty_id
LEFT JOIN legal_entities ce ON ce.id = c.legal_entity_id
WHERE t.status IN ('PENDING', 'CONFIRMED', 'LIVE')
ORDER BY t.created_at DESC LIMIT 300
"""

_NET_ANCHORS_SQL = """
SELECT e.created_at, e.payload, (t.user_id = :uid) AS mine
FROM trade_events e JOIN trades t ON t.id = e.trade_id
WHERE e.event_type = 'CONFIRMED' AND e.confirmation_hash IS NOT NULL
ORDER BY e.created_at DESC LIMIT 60
"""


def network(db: Session, uid) -> dict:
    """Every desk on the instance, reduced to cities, statuses and block numbers: enough to
    light the globe for a visitor whose own book is empty, nothing that names anyone."""
    arcs: dict[tuple, dict] = {}
    anchors: list[dict] = []
    try:
        for r in db.execute(text(_NET_ARCS_SQL), {"uid": str(uid)}):
            a = city_for(SimpleNamespace(jurisdiction=r.own_j, home_currency=r.own_c))
            b = city_for(SimpleNamespace(jurisdiction=r.cp_j, home_currency=r.cp_c), default=a["code"])
            key = (a["city"], b["city"], r.status, bool(r.mine))
            if key not in arcs:
                arcs[key] = {"from": a, "to": b, "status": r.status, "mine": bool(r.mine), "count": 0}
            arcs[key]["count"] += 1
        for r in db.execute(text(_NET_ANCHORS_SQL), {"uid": str(uid)}):
            anchor = ((r.payload or {}).get("attestation") or {}).get("anchor") or {}
            if anchor.get("anchored"):
                anchors.append({"block_number": anchor.get("block_number"), "confirmed_at": _iso(r.created_at), "mine": bool(r.mine)})
    except Exception as e:
        log.debug("desk: network failed: %s", e)
        db.rollback()
    total = 0
    try:
        total = int(db.execute(text("SELECT count(*) FROM trade_events WHERE event_type = 'CONFIRMED' AND confirmation_hash IS NOT NULL "
                                    "AND (payload->'attestation'->'anchor'->>'anchored') = 'true'")).scalar() or 0)
    except Exception:
        db.rollback()
    return {"arcs": list(arcs.values()), "anchors": anchors[:40], "total_anchored": total}


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.astimezone(timezone.utc).isoformat() if dt.tzinfo else dt.replace(tzinfo=timezone.utc).isoformat()
    return str(dt)


def _product(instrument: Optional[str], asset_class: Optional[str]) -> str:
    return (instrument or asset_class or "TRADE").replace("_", " ").upper()


def lifecycle(db: Session, user: dict) -> dict:
    uid = user.get("sub")
    today = date.today()
    trades = db.query(Trade).filter(Trade.user_id == uid).all()
    cps = {c.id: c for c in db.query(Counterparty).filter(Counterparty.user_id == uid).all()}
    ents = {e.id: e for e in db.query(LegalEntity).filter(LegalEntity.user_id == uid).all()}
    own = next((e for e in ents.values() if e.is_own_entity and e.is_active is not False), None)
    home = city_for(own)
    cp_name = lambda t: (cps.get(t.counterparty_id).name if t.counterparty_id in cps else None)

    actions: list[dict] = []
    # 1. Cards shared with my firm that wait for my countersignature.
    fm = db.query(FirmMember).filter(FirmMember.user_id == uid).first()
    if fm is not None:
        try:
            for r in db.execute(text(_COUNTERSIGN_SQL), {"uid": str(uid), "firm": str(fm.firm_id)}):
                card = r.card or {}
                actions.append({"kind": "COUNTERSIGN", "title": f"Countersign {card.get('trade_ref', '')}".strip(),
                                "detail": f"from {card.get('booker_firm', 'a counterparty')}",
                                "trade_ref": card.get("trade_ref"), "room_id": str(r.room_id),
                                "message_id": str(r.message_id), "since": _iso(r.created_at), "href": f"/messenger?room={r.room_id}"})
        except Exception as e:
            log.debug("desk: countersign inbox failed: %s", e)
            db.rollback()
    # 2. My bookings that still wait for the other side.
    for t in sorted((t for t in trades if t.status == "PENDING"), key=lambda t: t.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)[:10]:
        actions.append({"kind": "AWAITING", "title": f"{t.trade_ref} awaits confirmation",
                        "detail": f"with {cp_name(t) or 'counterparty'} · {_product(t.instrument_type, t.asset_class)}",
                        "trade_ref": t.trade_ref, "trade_id": str(t.id), "since": _iso(t.created_at), "href": f"/blotter?trade={t.id}"})
    # 3. Maturities and settlements inside the window.
    for t in sorted((t for t in trades if t.status in ("CONFIRMED", "LIVE") and t.maturity_date), key=lambda t: t.maturity_date):
        days = (t.maturity_date - today).days
        if 0 <= days <= MATURITY_WINDOW_DAYS:
            settles = (t.asset_class or "").upper() in ("FX", "CRYPTO", "DIGITAL")
            actions.append({"kind": "MATURITY", "title": f"{t.trade_ref} {'settles' if settles else 'matures'} {'today' if days == 0 else f'in {days}d'}",
                            "detail": f"{t.maturity_date.isoformat()} · {cp_name(t) or ''}".strip(" ·"),
                            "trade_ref": t.trade_ref, "trade_id": str(t.id), "due": t.maturity_date.isoformat(), "href": f"/blotter?trade={t.id}"})
    # 4. Confirmations that were signed but never reached the chain.
    anchors: list[dict] = []
    try:
        for r in db.execute(text(_ANCHORS_SQL), {"uid": str(uid), "n": 12}):
            att = (r.payload or {}).get("attestation") or {}
            a = att.get("anchor") or {}
            cp = cps.get(r.counterparty_id)
            row = {"trade_ref": r.trade_ref, "counterparty": cp.name if cp else None,
                   "product": _product(r.instrument_type, r.asset_class), "confirmed_at": _iso(r.created_at),
                   "anchored": bool(a.get("anchored")), "block_number": a.get("block_number"), "tx_hash": a.get("tx_hash"),
                   "explorer_tx": a.get("explorer_tx"), "trade_hash": att.get("trade_hash"), "bilateral": bool(att.get("bilateral"))}
            anchors.append(row)
            if not row["anchored"]:
                actions.append({"kind": "OFF_CHAIN", "title": f"{r.trade_ref} confirmed off-chain",
                                "detail": a.get("note") or "no anchor on the registry", "trade_ref": r.trade_ref,
                                "since": row["confirmed_at"]})
    except Exception as e:
        log.debug("desk: anchors failed: %s", e)
        db.rollback()

    # The book as arcs: own entity → counterparty's home city.
    arcs = []
    for t in trades:
        if t.status not in ("PENDING", "CONFIRMED", "LIVE"):
            continue
        cp = cps.get(t.counterparty_id)
        to = city_for(ents.get(cp.legal_entity_id) if cp and cp.legal_entity_id in ents else None, default=home["code"])
        arcs.append({"trade_ref": t.trade_ref, "status": t.status, "counterparty": cp.name if cp else None,
                     "product": _product(t.instrument_type, t.asset_class), "to": to,
                     "notional": float(t.notional) if t.notional else None, "ccy": t.notional_ccy})
    # 5. Limit breaches and warnings from the last stored risk report (the daily run, or RUN NOW on the risk page).
    try:
        from risk.report import latest_stored
        last = latest_stored(db, str(uid))
        for lim in (last or {}).get("limits", []):
            kind = "LIMIT" if lim.get("status") == "BREACH" else "LIMIT_WARN"
            where = "book" if lim.get("scope") == "ALL" else f"{lim.get('scope', '').lower()} {lim.get('scope_name')}"
            actions.append({"kind": kind, "title": f"{lim.get('metric')} {'breached' if kind == 'LIMIT' else 'near limit'} on {where}",
                            "detail": f"{lim.get('utilisation_pct', 0):.0f}% of {lim.get('limit'):,.0f} · as of {last.get('date')}", "href": "/risk"})
    except Exception as e:              # noqa: BLE001
        log.debug("desk: limits failed: %s", e)
    chain = _chain_health()
    if chain.get("relayer", {}).get("low"):
        actions.append({"kind": "WALLET", "title": "Relayer wallet is low",
                        "detail": f"{chain['relayer']['balance_eth']:.4f} ETH on {chain.get('network', 'chain')} · top up to keep anchoring",
                        "href": None})
    if chain.get("anchored") and chain.get("reachable") is False:
        actions.append({"kind": "NODE", "title": "Chain node unreachable", "detail": "anchoring will retry on the fallback node", "href": None})
    counts = {"confirmed": sum(1 for t in trades if t.status == "CONFIRMED"), "pending": sum(1 for t in trades if t.status == "PENDING"),
              "anchored": sum(1 for a in anchors if a["anchored"]), "actions": len(actions)}
    return {"as_of": datetime.now(timezone.utc).isoformat(), "home": home, "chain": chain, "actions": actions,
            "anchors": anchors[:8], "arcs": arcs, "counts": counts, "network": network(db, uid)}


@router.get("/lifecycle")
def desk_lifecycle(db: Session = Depends(get_db), user: dict = Depends(verify_token)):
    return lifecycle(db, user)
