"""An LEI is twenty capital letters and digits, and nothing else is stored (api/routes/legal_entities.py).

It is signed into a confirmation and printed on the public register. On a demo instance a key is held for any LEI
that begins DEMO, so until 11 November 2026 an account could name its entity DEMO<markup>, confirm a trade with it
and have the public page write that markup into itself."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from api.routes.legal_entities import LegalEntityCreate, LegalEntityUpdate, clean_lei


@pytest.mark.parametrize("given, stored", [("DEMO0000000A00004000", "DEMO0000000A00004000"), ("5493001KJTIIGC8Y1R12", "5493001KJTIIGC8Y1R12"),
                                           (" 5493001kjtiigc8y1r12 ", "5493001KJTIIGC8Y1R12"), ("", ""), ("   ", "")])
def test_an_lei_is_stored_in_capitals_and_an_entity_may_have_none(given, stored):
    assert clean_lei(given) == stored
    assert LegalEntityCreate(name="A", home_currency="USD", lei=given).lei == stored
    assert LegalEntityUpdate(lei=given).lei == stored


def test_left_out_it_is_no_lei_on_create_and_not_sent_on_update():
    assert LegalEntityCreate(name="A", home_currency="USD").lei == "" and LegalEntityCreate(name="A", home_currency="USD", lei=None).lei == ""
    assert LegalEntityUpdate(name="B").lei is None and "lei" not in LegalEntityUpdate(name="B").dict(exclude_none=True)


@pytest.mark.parametrize("bad", ['DEMO<img src=x onerror=1>', "DEMO0000000A0000400", "DEMO0000000A000040000", "DEMO0000000A0000400 ", "DEMO-000000A00004000",
                                 "DEMO0000000A0000400é", '"><script>', "X", 12])
def test_anything_else_is_refused_on_create_and_on_update(bad):
    with pytest.raises(ValidationError, match="20 capital letters and digits"):
        LegalEntityCreate(name="A", home_currency="USD", lei=bad)
    with pytest.raises(ValidationError, match="20 capital letters and digits"):
        LegalEntityUpdate(lei=bad)


@pytest.mark.parametrize("own_lei, cp_lei, who", [("DEMO<img src=x onerror=1>", "DEMO0000RIJEKABANK01", "your own entity"),
                                                  ("DEMO0000000A00004000", 'DEMO"><script>1</script>', "the counterparty"),
                                                  ("demo0000000a00004000", "DEMO0000RIJEKABANK01", "your own entity"),
                                                  ("DEMO0000000A00004000\n", "DEMO0000RIJEKABANK01", "your own entity"),
                                                  ("DEMO0000000A00004000", "DEMO0000RIJEKABANK01\n", "the counterparty")])
def test_a_confirmation_signs_nothing_but_an_lei(own_lei, cp_lei, who):
    """The Legal Entities page writes its rows straight to the database, past the route's rule, so the rule is held
    where every confirmation passes: before a key is looked up."""
    from api.routes.chain import _resolve_parties
    own = SimpleNamespace(lei=own_lei, name="OWN")
    with pytest.raises(HTTPException) as e:
        _resolve_parties(None, None, parts=(own, None, {"lei": cp_lei, "name": "CP"}, []))
    assert e.value.status_code == 422 and who in e.value.detail and "20 capital letters and digits" in e.value.detail


def test_a_counterparty_linked_to_another_accounts_entity_is_read_as_unlinked():
    from unittest.mock import MagicMock
    from api.routes.chain import _cp_identity
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None          # nothing of this owner's has that id
    cp = SimpleNamespace(legal_entity_id="11111111-1111-4111-8111-111111111111", user_id="owner", name="CP NAME")
    assert _cp_identity(db, cp) == {"lei": None, "name": "CP NAME"}
    assert len(db.query.return_value.filter.call_args.args) == 2, "the lookup is by id AND by the counterparty's owner"

