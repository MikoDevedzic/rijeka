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


def test_the_frontend_and_the_backend_name_the_same_modules():
    """Two lists of the module keys exist (backend/modules.py and the frontend store); nothing else ties them (Nikola)."""
    import re
    from pathlib import Path
    js = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "store" / "useModulesStore.js").read_text()
    keys = re.findall(r"'([A-Z_]+)'", re.search(r"MODULE_KEYS = \[(.*?)\]", js, re.S).group(1))
    assert keys == list(M.KEYS)
    routes = dict(re.findall(r"'(/[a-z/]+)': \[([^\]]*)\]", js))
    assert routes and all(set(re.findall(r"'([A-Z_]+)'", v)) <= set(M.KEYS) for v in routes.values())
