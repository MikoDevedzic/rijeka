"""Module switches: the catalogue and presets, defaults before the migration, the route's validation."""
import pytest
from fastapi import HTTPException

import modules as M
from api.routes.modules import ModulesBody, put_modules


def test_catalogue_and_presets():
    assert set(M.KEYS) >= {"PNL", "XVA", "MARKET_RISK", "COUNTERPARTY_CREDIT", "CAPITAL", "CHAIN_CONFIRM"}
    assert set(M.PLANNED) == set()          # every module in the catalogue exists
    dealer = M.preset_modules("DEALER")
    assert all(dealer.values())
    corp = M.preset_modules("corporate")
    assert corp["PNL"] and corp["XVA"] and corp["CHAIN_CONFIRM"] and not corp["MARKET_RISK"] and not corp["CAPITAL"]
    assert not M.preset_modules("FUND")["CAPITAL"] and M.preset_modules("FUND")["COUNTERPARTY_CREDIT"]
    cat = M.catalogue()
    assert [m["key"] for m in cat["definitions"]] == list(M.KEYS) and set(cat["presets"]) == set(M.PRESETS)


def test_the_launch_set_is_booking_valuation_xva_and_confirm(monkeypatch):
    launch = M.preset_modules("LAUNCH")
    assert {k for k, on in launch.items() if on} == {"CHAIN_CONFIRM", "XVA", "PROMETHEUS", "NEWS"}
    assert list(M.PRESETS)[0] == "LAUNCH" and "DEALER" in M.PRESETS                 # one click to it, one click back to everything
    # what a new workspace starts on: LAUNCH unless the instance says otherwise; nonsense means "as before" (nothing chosen)
    monkeypatch.delenv("RIJEKA_SIGNUP_PRESET", raising=False)
    assert M.signup_preset() == "LAUNCH"
    for value, want in (("dealer", "DEALER"), ("", None), ("none", None), ("EVERYTHING", None), (" fund ", "FUND")):
        monkeypatch.setenv("RIJEKA_SIGNUP_PRESET", value)
        assert M.signup_preset() == want, value


def test_who_may_switch_modules(monkeypatch):
    from unittest.mock import MagicMock, patch
    user = {"sub": "u-1"}
    db = MagicMock()
    with patch("api.routes._roles.role_of", return_value="admin"):
        assert M.may_edit(db, user)                                                # a profile admin, anywhere
    with patch("api.routes._roles.role_of", return_value="trader"):
        monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
        assert not M.may_edit(db, user) and not db.execute.called                  # a firm deployment: the admin role only
        monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "1")
        db.execute.return_value.first.return_value = (1,)
        assert M.may_edit(db, user)                                                # a sandbox firm's own ADMIN member
        sql = str(db.execute.call_args.args[0])
        assert "m.role = 'ADMIN'" in sql and "WHERE o.firm_id = m.firm_id) = 1" in sql      # ADMIN of a firm of one: a firm with colleagues is not a sandbox
        assert db.execute.call_args.args[1] == {"u": "u-1"}
        db.execute.return_value.first.return_value = None
        assert not M.may_edit(db, user)                                            # a member who is not its admin
        db.execute.side_effect = RuntimeError("no such table")
        assert not M.may_edit(db, user) and db.rollback.called


def test_normalise_ignores_unknown_keys_and_defaults_the_rest():
    n = M.normalise({"PNL": False, "NOPE": False, "XVA": 0})
    assert not n["PNL"] and not n["XVA"] and n["MARKET_RISK"] and "NOPE" not in n


class _DB:
    """A session whose information_schema says the columns are missing."""
    def execute(self, *a, **k):
        class R:
            def scalar(self): return 0
            def first(self): return None
        return R()
    def rollback(self): pass


def test_before_the_migration_everything_is_on(monkeypatch):
    M._PRESENT.clear()
    db = _DB()
    assert not M.columns_present(db)
    assert "present" not in M._PRESENT, "a negative answer is not cached: the migration may land while the process runs"
    assert M.for_firm(db, "firm")["source"] == "default" and all(M.for_firm(db, "firm")["modules"].values())
    with pytest.raises(RuntimeError):
        M.set_for_firm(db, "firm", "u", preset="DEALER")
    M._PRESENT.clear()


def test_route_validation(monkeypatch):
    import api.routes.modules as route
    monkeypatch.setattr(M, "may_edit", lambda db, user: False)
    with pytest.raises(HTTPException) as e:
        put_modules(ModulesBody(preset="DEALER"), db=None, user={"sub": "u"})
    assert e.value.status_code == 403 and route.put_modules is put_modules      # refused before anything is read or written
    monkeypatch.setattr(M, "may_edit", lambda db, user: True)
    monkeypatch.setattr(M, "firm_of_user", lambda db, uid: "firm")
    monkeypatch.setattr(M, "columns_present", lambda db: True)
    with pytest.raises(HTTPException) as e:
        put_modules(ModulesBody(preset="NOPE"), db=None, user={"sub": "u"})
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        put_modules(ModulesBody(modules={"NOPE": True}), db=None, user={"sub": "u"})
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        put_modules(ModulesBody(), db=None, user={"sub": "u"})
    assert e.value.status_code == 422
    monkeypatch.setattr(M, "firm_of_user", lambda db, uid: None)
    with pytest.raises(HTTPException) as e:
        put_modules(ModulesBody(preset="DEALER"), db=None, user={"sub": "u"})
    assert e.value.status_code == 422


def test_the_launch_view_follows_the_last_preset_chosen_not_the_name_of_the_current_one(monkeypatch):
    from unittest.mock import MagicMock
    monkeypatch.setattr(M, "columns_present", lambda db: True)
    db = MagicMock()
    for last_named, want in (("LAUNCH", "launch"), ("DEALER", "full"), ("CORPORATE", "full"), (None, "full")):
        db.execute.return_value.first.return_value = (last_named,) if last_named else None
        assert M.view_for_firm(db, "firm") == want, last_named
    assert "preset <> 'CUSTOM' ORDER BY at DESC LIMIT 1" in str(db.execute.call_args.args[0])       # one module switched on (CUSTOM) does not end the launch view
    assert M.view_for_firm(db, None) == "full"
    db.execute.side_effect = RuntimeError("no such table")
    assert M.view_for_firm(db, "firm") == "full" and db.rollback.called
    monkeypatch.setattr(M, "columns_present", lambda db: False)
    assert M.view_for_firm(MagicMock(), "firm") == "full"


def test_capital_is_held_for_the_admin_role_on_a_hosted_demo(monkeypatch):
    from unittest.mock import MagicMock, patch
    assert M.ON_REQUEST == ("CAPITAL",) and set(M.ON_REQUEST) <= set(M.KEYS) and "@" in M.CONTACT
    monkeypatch.delenv("RIJEKA_HELD_MODULES", raising=False)
    db, user = MagicMock(), {"sub": "u-1"}
    with patch("api.routes._roles.role_of", return_value="trader") as role:
        monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "0")
        assert M.locked(db, user) == () and not role.called                        # a self-hosted desk: nothing is held back, nothing is read
        monkeypatch.setenv("RIJEKA_DEMO_PROVISION", "1")
        assert M.locked(db, user) == ("CAPITAL",)                                  # the hosted demo: everyone but the admin role
    for other in ("viewer", "sales", ""):
        with patch("api.routes._roles.role_of", return_value=other):
            assert M.locked(db, user) == ("CAPITAL",), other
    with patch("api.routes._roles.role_of", return_value="admin"):
        assert M.locked(db, user) == ()
    # an instance that keeps sandboxes says what it holds: nothing, or its own list; a value that names no module holds the default
    with patch("api.routes._roles.role_of", return_value="trader") as role:
        for value, want in (("NONE", ()), ("", ()), (" none ", ()), ("capital, ipv", ("CAPITAL", "IPV")), ("IPV", ("IPV",)), ("NONE,IPV", ("IPV",)),
                            ("CAPITL", ("CAPITAL",)), ("CAPTIAL,PNL", ("PNL", "CAPITAL")), ("0", ("CAPITAL",)), ("*", ("CAPITAL",))):      # a mistyped name never releases capital
            monkeypatch.setenv("RIJEKA_HELD_MODULES", value)
            assert M.held() == want and M.locked(db, user) == want, value
        monkeypatch.setenv("RIJEKA_HELD_MODULES", "NONE")
        role.reset_mock()
        assert M.locked(db, user) == () and not role.called
    monkeypatch.delenv("RIJEKA_HELD_MODULES")
    assert M.held() == M.ON_REQUEST
    # off, whatever the firm's row or a preset says; nothing else moves
    assert M.without(M.all_on(), ("CAPITAL",)) == {**M.all_on(), "CAPITAL": False} and M.without(M.all_on(), ()) == M.all_on()
    assert M.without(M.preset_modules("LAUNCH"), ("CAPITAL",)) == M.preset_modules("LAUNCH")
    cat = M.catalogue(("CAPITAL",))
    assert [m["key"] for m in cat["definitions"] if m.get("on_request")] == ["CAPITAL"]
    assert not any(p["modules"]["CAPITAL"] for p in cat["presets"].values()) and cat["presets"]["DEALER"]["modules"]["PNL"]
    assert cat["presets"]["DEALER"]["desc"] == "everything on (capital on request)"
    assert all(p["desc"] == M.PRESETS[k]["desc"] + " (capital on request)" for k, p in cat["presets"].items())      # LAUNCH's "one switch away" too
    assert M.catalogue()["presets"]["DEALER"]["desc"] == "everything on"
    assert not any(m.get("on_request") for m in M.catalogue()["definitions"]) and all(M.catalogue()["presets"]["DEALER"]["modules"].values())
    assert not any("on_request" in m for m in M.MODULES)                           # the catalogue marks a copy, never the definitions
    # what a user has: on in the firm's row and not held from that user; the role is read only for a held module
    asked = []
    monkeypatch.setattr(M, "firm_of_user", lambda db, uid: "firm")
    monkeypatch.setattr(M, "for_firm", lambda db, firm_id: {"modules": {**M.all_on(), "IPV": False}, "preset": "DEALER", "source": "firm"})
    monkeypatch.setattr(M, "locked", lambda db, user: asked.append(user["sub"]) or (("CAPITAL",) if user["sub"] == "demo" else ()))
    assert M.is_on(db, "demo", "PNL") is True and M.is_on(db, "demo", "IPV") is False and asked == []      # the nightly ticks cost what they did
    assert M.is_on(db, "demo", "CAPITAL") is False and M.is_on(db, "boss", "CAPITAL") is True and asked == ["demo", "boss"]
    assert M.for_user(db, "demo")["modules"]["CAPITAL"] is True                                           # the row, as it is


def test_someone_capital_is_held_from_can_never_switch_it_on_and_only_a_preset_switches_it_off(monkeypatch):
    from unittest.mock import MagicMock
    import json
    import api.routes.modules as route
    db, user = MagicMock(), {"sub": "u"}
    monkeypatch.setattr(M, "may_edit", lambda db, user: True)
    monkeypatch.setattr(M, "firm_of_user", lambda db, uid: "firm")
    monkeypatch.setattr(M, "columns_present", lambda db: True)
    monkeypatch.setattr(M, "locked", lambda db, user: ("CAPITAL",))
    monkeypatch.setattr(route, "_view", lambda db, user: {"ok": True})
    monkeypatch.setattr("api.routes._limits.heavy", lambda *a, **k: None)
    # what the row says after each kind of save, by what it said before: never switched on; a map (the page sends it
    # off because that is how it was answered) leaves it; a preset that has it off switches it off
    cases = ((ModulesBody(preset="DEALER"), {True: True, False: False}),
             (ModulesBody(preset="LAUNCH"), {True: False, False: False}),
             (ModulesBody(preset="FUND"), {True: False, False: False}),
             (ModulesBody(modules={**M.all_on(), "CAPITAL": True}), {True: True, False: False}),
             (ModulesBody(modules={**M.all_on(), "CAPITAL": False, "NEWS": False}), {True: True, False: False}))
    for row_has in (True, False):
        monkeypatch.setattr(M, "for_firm", lambda db, firm_id, strict=False, v=row_has: {"modules": {**M.all_on(), "CAPITAL": v}, "preset": "DEALER", "source": "firm"})
        for body, want in cases:
            db.reset_mock()
            assert put_modules(body, db=db, user=user) == {"ok": True} and db.commit.called      # never refused: a page opened before the deploy still saves
            stored = json.loads(db.execute.call_args_list[0].args[1]["m"])
            assert stored["CAPITAL"] is want[row_has], (row_has, body)
            audit = db.execute.call_args_list[1].args[1]
            assert json.loads(audit["a"]) == stored and json.loads(audit["b"])["CAPITAL"] is row_has
        assert stored["NEWS"] is False and stored["PNL"] is True                                   # the rest of what was asked is stored
    db.reset_mock()
    put_modules(ModulesBody(preset="FUND"), db=db, user=user)
    assert json.loads(db.execute.call_args_list[0].args[1]["m"]) == M.preset_modules("FUND")       # every other switch is the preset's
    # the row could not be read: nothing is written (a failed read answers "every module on" everywhere else, and
    # kept as the "before" it would have switched capital on), and the caller is told to try again
    from sqlalchemy.exc import OperationalError
    monkeypatch.undo()                              # the real for_firm from here
    assert M.for_firm.__module__ == "modules" and M.for_firm.__name__ == "for_firm"
    monkeypatch.setattr(M, "may_edit", lambda db, user: True); monkeypatch.setattr(M, "firm_of_user", lambda db, uid: "firm")
    monkeypatch.setattr(M, "columns_present", lambda db: True); monkeypatch.setattr(M, "locked", lambda db, user: ("CAPITAL",))
    monkeypatch.setattr("api.routes._limits.heavy", lambda *a, **k: None)
    db = MagicMock(); db.execute.side_effect = OperationalError("SELECT", {}, Exception("connection dropped"))
    for body in (ModulesBody(preset="DEALER"), ModulesBody(modules={"PNL": True})):
        db.reset_mock()
        with pytest.raises(HTTPException) as e:
            put_modules(body, db=db, user=user)
        assert e.value.status_code == 503 and db.execute.call_count == 1 and not db.commit.called and db.rollback.called
    assert M.for_firm(db, "firm")["modules"] == M.all_on()                                         # for showing pages a failed read is still "everything on"
    db = MagicMock()
    monkeypatch.setattr(M, "for_firm", lambda db, firm_id, strict=False: {"modules": {**M.all_on(), "CAPITAL": False}, "preset": "DEALER", "source": "firm"})
    monkeypatch.setattr(route, "_view", lambda db, user: {"ok": True})
    # nobody held back: stored as asked
    monkeypatch.setattr(M, "locked", lambda db, user: ())
    db.reset_mock()
    put_modules(ModulesBody(preset="DEALER"), db=db, user=user)
    assert json.loads(db.execute.call_args_list[0].args[1]["m"]) == M.all_on()
    # a new workspace has nothing before it: provisioning passes nobody as held, and the row is the preset as it is
    import inspect
    import api.routes.demo as demo
    assert 'M.set_for_firm(db, firm.id, str(uid), preset=preset, note="new workspace")' in inspect.getsource(demo)


def test_the_frontend_and_the_backend_name_the_same_modules():
    """Two lists of the module keys exist (backend/modules.py and the frontend store); nothing else ties them (Nikola)."""
    import re
    from pathlib import Path
    js = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "store" / "useModulesStore.js").read_text()
    keys = re.findall(r"'([A-Z_]+)'", re.search(r"MODULE_KEYS = \[(.*?)\]", js, re.S).group(1))
    assert keys == list(M.KEYS)
    routes = dict(re.findall(r"'(/[a-z/]+)': \[([^\]]*)\]", js))
    assert routes and all(set(re.findall(r"'([A-Z_]+)'", v)) <= set(M.KEYS) for v in routes.values())
