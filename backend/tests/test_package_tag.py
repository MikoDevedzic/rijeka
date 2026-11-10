"""The package tag is one format read in two languages (api/routes/_package.py and the browser's fx-legs.js):
this holds the two to each other, and holds the size limit to one definition."""
import re
from pathlib import Path

import pytest

from api.routes import _package as P

JS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "trade-window" / "fx-legs.js"


def test_the_tag_round_trips_and_only_the_servers_shape_is_one():
    tag = P.package_tag("RISK REVERSAL", "TRD-12345678", 2, 3)
    assert tag == "RISK REVERSAL TRD-12345678 2/3" and P.read_package_tag(tag) == ("RISK REVERSAL", "TRD-12345678", 2, 3)
    for not_a_tag in (None, "", "Macro", "STRIP TRD-1234 1/2", "STRIP TRD-12345678-1 1/2", "STRIP TRD-12345678 0/2", "STRIP TRD-12345678 3/2",
                      "BUTTERFLY TRD-12345678 1/2", "strip TRD-12345678 1/2", "STRIP PKG-ABCD1234 1/2", "STRIP TRD-12345678 1/25", " STRIP TRD-12345678 1/2"):
        assert P.read_package_tag(not_a_tag) is None, not_a_tag


def test_a_client_may_not_write_change_or_remove_a_tag():
    from fastapi import HTTPException
    tag = "STRIP TRD-12345678 1/2"
    P.refuse_client_tag("Macro")
    P.refuse_client_tag(None)
    P.refuse_client_tag(tag, was=tag)                       # no change
    P.refuse_client_tag("STRIP PKG-ABCD1234 1/2")           # the older ticket's grouping: only text
    for new, was in ((tag, None), (tag, "Macro"), ("Macro", tag), (None, tag), ("STRIP TRD-12345678 2/2", tag)):
        with pytest.raises(HTTPException) as e:
            P.refuse_client_tag(new, was=was)
        assert e.value.status_code == 422


@pytest.mark.skipif(not JS.exists(), reason="the frontend is not in this checkout")
def test_the_browser_reads_the_same_structures_and_the_same_ids():
    js = JS.read_text()
    m = re.search(r"export const PACKAGE_STRUCTURES = \[([^\]]*)\]", js)
    assert m, "PACKAGE_STRUCTURES in fx-legs.js"
    assert sorted(re.findall(r"'([^']+)'", m.group(1))) == sorted(P.PACKAGE_STRUCTURES), "one list of structures, in two languages"
    rx = re.search(r"const m = /\^(.*?)\$/\.exec\(String\(strategy", js)
    assert rx, "the tag's pattern in readPackageTag"
    assert r"TRD-\d{8}" in rx.group(1), "the browser reads the server's trade ID shape"


def test_one_definition_of_the_size():
    from api.routes import booking, chain, xva
    assert booking.PACKAGE_MAX_LEGS is P.PACKAGE_MAX_LEGS and chain.PACKAGE_MAX_LEGS is P.PACKAGE_MAX_LEGS and xva.PACKAGE_MAX_LEGS is P.PACKAGE_MAX_LEGS
    assert booking.PACKAGE_STRUCTURES is P.PACKAGE_STRUCTURES
