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
    monkeypatch.setattr(route, "require_admin", lambda db, user: None)
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
