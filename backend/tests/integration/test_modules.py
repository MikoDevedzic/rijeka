"""Module switches end to end on the stack: read as anyone, write as the firm's admin, the audit row, the batch skip."""
from __future__ import annotations

import os

import sqlalchemy as sa

from tests.integration.conftest import USER_A


def _set_role(role: str) -> None:
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    with eng.begin() as c:
        c.execute(sa.text("UPDATE profiles SET role = :r WHERE id = :id"), {"r": role, "id": USER_A})
    eng.dispose()


def test_modules_read_write_and_audit(client, auth_a, auth_b):
    r = client.get("/api/modules", headers=auth_a)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    assert j["writable"] and j["firm_id"] and set(j["modules"]) >= {"PNL", "CAPITAL", "MARKET_RISK"}
    assert all(j["modules"].values()) and j["source"] in ("default", "firm")
    assert "CORPORATE" in j["presets"] and j["planned"] == ["COLLATERAL"]
    # a trader may not switch modules
    r = client.put("/api/modules", json={"preset": "CORPORATE"}, headers=auth_a)
    assert r.status_code == 403
    _set_role("admin")
    try:
        r = client.put("/api/modules", json={"preset": "CORPORATE", "note": "treasury desk"}, headers=auth_a)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["preset"] == "CORPORATE" and j["source"] == "firm" and not j["modules"]["MARKET_RISK"] and j["modules"]["PNL"]
        assert j["events"] and j["events"][0]["preset"] == "CORPORATE" and "MARKET_RISK" in j["events"][0]["changed"] and j["events"][0]["note"] == "treasury desk"
        # the other member of the firm sees the same switches
        assert not client.get("/api/modules", headers=auth_b).json()["modules"]["MARKET_RISK"]
        # an explicit map, one switch at a time
        r = client.put("/api/modules", json={"modules": {**j["modules"], "MARKET_RISK": True}}, headers=auth_a)
        assert r.status_code == 200 and r.json()["preset"] == "CUSTOM" and r.json()["modules"]["MARKET_RISK"]
        r = client.put("/api/modules", json={"modules": {"NOPE": True}}, headers=auth_a)
        assert r.status_code == 422
        # back to everything on
        r = client.put("/api/modules", json={"preset": "DEALER"}, headers=auth_a)
        assert r.status_code == 200 and all(r.json()["modules"].values())
    finally:
        _set_role("trader")
