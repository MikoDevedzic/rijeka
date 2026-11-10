"""The package record (chain/canonical.package_payload): what both parties sign and the registry anchors once for a
package of trades. A verifier in any language must reproduce these bytes: the vector below is pinned."""
import pytest
from eth_utils import keccak

from chain.canonical import PACKAGE_SCHEMA, PACKAGE_SCHEMA_VERSION, canonical_bytes, package_hash, package_payload

A = "0x" + "11" * 32
B = "0x" + "22" * 32
C = "0x" + "0a" * 32
LEI_1, LEI_2 = "5493001KJTIIGC8Y1R12", "254900OPPU84GM83MG36"


def test_the_record_is_the_two_leis_and_the_legs_hashes_sorted_and_nothing_else():
    p = package_payload([B, A, C], [LEI_2, LEI_1])
    assert p == {"schema": "rijeka-package", "schema_version": 1, "parties": sorted([LEI_1, LEI_2]), "legs": [C, A, B]}
    assert (PACKAGE_SCHEMA, PACKAGE_SCHEMA_VERSION) == ("rijeka-package", 1)
    # the order the legs are given in, and the case of a hash, are not terms of the package
    assert package_payload([A.upper().replace("0X", "0x"), C, B], [LEI_1, LEI_2]) == p
    assert package_hash(package_payload([C, B, A], [LEI_1, LEI_2])) == package_hash(p)


def test_the_pinned_vector():
    """Any implementation: JSON, keys sorted, separators ',' and ':', UTF-8, then keccak256."""
    p = package_payload([A, B], [LEI_1, LEI_2])
    raw = canonical_bytes(p)
    assert raw == (b'{"legs":["0x1111111111111111111111111111111111111111111111111111111111111111",'
                   b'"0x2222222222222222222222222222222222222222222222222222222222222222"],'
                   b'"parties":["254900OPPU84GM83MG36","5493001KJTIIGC8Y1R12"],"schema":"rijeka-package","schema_version":1}')
    h = package_hash(p)
    assert h == keccak(raw) and len(h) == 32
    assert h.hex() == keccak(raw).hex()
    # a leg added, removed or changed is another package
    assert package_hash(package_payload([A, B, C], [LEI_1, LEI_2])) != h
    assert package_hash(package_payload([A, C], [LEI_1, LEI_2])) != h
    assert package_hash(package_payload([A, B], [LEI_1, "254900OPPU84GM83MG37"])) != h


def test_what_is_not_a_package_is_refused():
    for legs in ([A], [], [A, A], [A, "0x1234"], [A, "11" * 32], [A, "0x" + "zz" * 32]):
        with pytest.raises(ValueError):
            package_payload(legs, [LEI_1, LEI_2])
    for parties in ([LEI_1], [LEI_1, LEI_1], [LEI_1, LEI_2, LEI_1], [LEI_1, ""]):
        with pytest.raises(ValueError):
            package_payload([A, B], parties)
    with pytest.raises(ValueError):
        package_hash({"schema": "rijeka-trade", "schema_version": 2})
    with pytest.raises(ValueError):
        package_hash({**package_payload([A, B], [LEI_1, LEI_2]), "schema_version": 2})


def test_a_leg_of_a_package_knows_what_the_registry_holds():
    from chain.lifecycle import anchored_hash, package_of
    single = {"trade_hash": A}
    leg = {"trade_hash": A, "package": {"hash": B, "legs": [A, C], "leg": 1, "of": 2}}
    assert package_of(single) is None and anchored_hash(single) == A
    assert package_of(leg)["of"] == 2 and anchored_hash(leg) == B
    assert package_of(None) is None and anchored_hash(None) is None and package_of({"package": {}}) is None
