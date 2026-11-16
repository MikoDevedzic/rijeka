"""The door's count of anchored confirmations (GET /api/public/pulse, `confirmations`) against PostgreSQL: a
confirmation the registry holds is counted, one signed and kept off the chain is not, though both carry a hash;
a package of legs confirmed as one is one record on the registry and is counted once, as the register lists it."""
from __future__ import annotations

import json

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

pytestmark = pytest.mark.integration

EVENT = ("INSERT INTO public.trade_events (id, trade_id, user_id, event_type, event_date, effective_date, payload, confirmation_hash) "
         "VALUES (gen_random_uuid(), :t, :u, 'CONFIRMED', current_date, current_date, CAST(:p AS jsonb), :h)")


def test_only_a_confirmation_the_registry_holds_is_counted(booked, ids, stack):
    from api.routes import public
    from db.session import engine
    conn = engine.connect()
    tx = conn.begin()
    try:
        db = Session(bind=conn)
        before = public._scalar(db, public.ANCHORED_SQL)
        assert before is not None
        who = {"t": booked["IR_SWAP"]["id"], "u": ids["a"]["user_id"]}
        for h, anchor in (("0x" + "a1" * 32, {"anchored": True, "block_number": 7, "tx_hash": "0x" + "b2" * 32}),
                          ("0x" + "c3" * 32, {"anchored": False, "note": "no anchor on the registry"}),
                          ("0x" + "d4" * 32, None)):
            att = {"trade_hash": h, "bilateral": True, **({"anchor": anchor} if anchor else {})}
            conn.execute(text(EVENT), {**who, "p": json.dumps({"attestation": att}), "h": h})
        assert public._scalar(db, public.ANCHORED_SQL) == before + 1
        # a package of three legs: each leg's event has its own hash and carries the package's record and anchor
        pkg = {"hash": "0x" + "e5" * 32, "trade_id": "PKG-IT-1", "of": 3}
        for i, product in enumerate(("IR_SWAP", "IR_CAP", "IR_FLOOR"), start=1):
            h = "0x" + f"f{i}" * 32
            att = {"trade_hash": h, "package": {**pkg, "leg": i}, "anchor": {"anchored": True, "block_number": 9, "tx_hash": "0x" + "a7" * 32}}
            conn.execute(text(EVENT), {"t": booked[product]["id"], "u": ids["a"]["user_id"], "p": json.dumps({"attestation": att}), "h": h})
        assert public._scalar(db, public.ANCHORED_SQL) == before + 2
        assert public.build(db)["confirmations"] == before + 2
        listed = public._register(db, 200)
        assert sum(1 for r in listed["confirmations"] if r.get("package_hash") == pkg["hash"] or r.get("trade_hash") == pkg["hash"]) <= 1
    finally:
        tx.rollback()
        conn.close()
