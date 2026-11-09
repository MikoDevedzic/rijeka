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
    assert "CORPORATE" in j["presets"] and j["planned"] == []
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


NEW_USER, NEW_EMAIL, NEW_TRADER = "0000000c-0000-4000-8000-0000000000cc", "new_desk@rijeka.test", "NEW.DESK"


def _fresh_user() -> None:
    """A user who has never signed in: an auth row and a profile, no firm, no workspace (and none left from a previous run)."""
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    with eng.begin() as c:
        firms = [r[0] for r in c.execute(sa.text("SELECT firm_id FROM firm_members WHERE user_id = :u"), {"u": NEW_USER}).all()]
        c.execute(sa.text("DELETE FROM firm_members WHERE user_id = :u"), {"u": NEW_USER})
        for f in firms:
            c.execute(sa.text("DELETE FROM module_events WHERE firm_id = :f"), {"f": f})
            c.execute(sa.text("DELETE FROM firm_leis WHERE firm_id = :f"), {"f": f})
            c.execute(sa.text("DELETE FROM firms WHERE id = :f"), {"f": f})
        c.execute(sa.text("""INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
                             VALUES (:id, 'authenticated', 'authenticated', :e, '{}'::jsonb, CAST(:m AS jsonb)) ON CONFLICT (id) DO NOTHING"""),
                  {"id": NEW_USER, "e": NEW_EMAIL, "m": '{"role": "trader"}'})
        c.execute(sa.text("""INSERT INTO profiles (id, trader_id, role, email, full_name, is_active) VALUES (:id, :t, 'trader', :e, 'New Desk', true)
                             ON CONFLICT (id) DO UPDATE SET role = 'trader'"""), {"id": NEW_USER, "t": NEW_TRADER, "e": NEW_EMAIL})
    eng.dispose()


def test_a_new_sign_up_starts_on_the_launch_set_and_can_switch_the_rest_on(client, auth_a, auth_b, monkeypatch):
    from stack.token import mint
    new = {"Authorization": f"Bearer {mint(NEW_USER, NEW_EMAIL, 'trader')}"}
    _fresh_user()
    before_a = client.get("/api/modules", headers=auth_a).json()
    # before the workspace exists: no firm, every module on, nothing to edit
    j = client.get("/api/modules", headers=new).json()
    assert j["firm_id"] is None and all(j["modules"].values()) and j["can_edit"] is False
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "1")
    r = client.post("/api/demo/provision", headers=new)
    assert r.status_code == 200, r.text[:400]
    j = client.get("/api/modules", headers=new).json()
    on = {k for k, v in j["modules"].items() if v}
    assert j["preset"] == "LAUNCH" and j["source"] == "firm" and on == {"CHAIN_CONFIRM", "XVA", "PROMETHEUS", "NEWS"}
    assert j["can_edit"] is True and j["events"][0]["preset"] == "LAUNCH" and j["events"][0]["note"] == "new workspace"
    # signing in again does not reset what the owner then chose
    r = client.put("/api/modules", json={"modules": {**j["modules"], "PNL": True}}, headers=new)
    assert r.status_code == 200 and r.json()["modules"]["PNL"] and r.json()["preset"] == "CUSTOM"
    assert client.post("/api/demo/provision", headers=new).status_code == 200
    assert client.get("/api/modules", headers=new).json()["modules"]["PNL"] is True
    r = client.put("/api/modules", json={"preset": "DEALER"}, headers=new)
    assert r.status_code == 200 and all(r.json()["modules"].values())
    r = client.put("/api/modules", json={"preset": "LAUNCH"}, headers=new)
    assert r.status_code == 200 and not r.json()["modules"]["MARKET_RISK"]
    # an existing firm is exactly as it was, and its switches are its own: the firm's ADMIN member may edit, another member may not
    after_a = client.get("/api/modules", headers=auth_a).json()
    assert after_a["modules"] == before_a["modules"] and after_a["preset"] == before_a["preset"] and all(after_a["modules"].values())
    assert after_a["can_edit"] is True and client.get("/api/modules", headers=auth_b).json()["can_edit"] is False
    assert client.put("/api/modules", json={"preset": "LAUNCH"}, headers=auth_b).status_code == 403
    # where sign-ins do not get a sandbox (a firm deployment), only the admin role switches modules
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
    assert client.get("/api/modules", headers=new).json()["can_edit"] is False
    assert client.put("/api/modules", json={"preset": "DEALER"}, headers=new).status_code == 403
    # a module switched off does not refuse its API: the switch hides and skips, it is not an entitlement (stated in docs/architecture.md)
    assert client.get("/api/modules", headers=new).json()["modules"]["PNL"] is False


def test_an_instance_can_start_new_workspaces_on_everything(client, monkeypatch):
    from stack.token import mint
    new = {"Authorization": f"Bearer {mint(NEW_USER, NEW_EMAIL, 'trader')}"}
    _fresh_user()
    monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "1")
    monkeypatch.setenv("RIJEKA_SIGNUP_PRESET", "none")
    assert client.post("/api/demo/provision", headers=new).status_code == 200
    j = client.get("/api/modules", headers=new).json()
    assert all(j["modules"].values()) and j["source"] == "default" and j["firm_id"]
