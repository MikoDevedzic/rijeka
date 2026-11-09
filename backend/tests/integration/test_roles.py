"""The role of a request is the profile's, never the token's own claim (Magnus and Edgar, 9 November 2026).

A token's user_metadata.role is written by the client at sign-up. Before this, an account with no profile row (the
sign-up function swallows its own errors, so a failed insert leaves none) was given the role its token claimed."""
import uuid

import pytest
import sqlalchemy as sa

pytestmark = pytest.mark.integration


def _bearer(uid: str, role: str) -> dict:
    from stack.token import mint
    return {"Authorization": f"Bearer {mint(uid, f'{uid[:8]}@rijeka.test', role)}"}


def test_an_account_with_no_profile_row_is_a_viewer_whatever_its_token_claims(client):
    from middleware.auth import forget_role
    uid = str(uuid.uuid4())
    forget_role(uid)
    auth = _bearer(uid, "admin")
    assert client.get("/api/me/role", headers=auth).json()["role"] == "viewer"
    # the admin-only views and the write routes answer as to a viewer
    assert client.get("/api/ops/usage", headers=auth).status_code == 403
    body = {"pair": "BTCUSD", "fixing_date": "2026-11-01", "source": "Deribit BTC delivery price", "value": 100000.0, "reason": "a claim in a token is not a role"}
    assert client.post("/api/currency/fixings/correct", json=body, headers=auth).status_code == 403
    assert client.post("/api/currency/fixings", json={"pair": "BTCUSD", "fixing_date": "2026-11-01", "source": "CME CF BRR", "value": 100000.0}, headers=auth).status_code == 403


def test_the_profile_decides_and_a_new_role_is_read_once_the_cache_is_dropped(client, stack):
    import os
    from middleware.auth import forget_role
    uid = str(uuid.uuid4())
    eng = sa.create_engine(os.environ["DATABASE_URL"])
    try:
        with eng.begin() as c:
            c.execute(sa.text("INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) "
                              "VALUES (:id, 'authenticated', 'authenticated', :e, '{}'::jsonb, '{\"role\": \"admin\"}'::jsonb)"), {"id": uid, "e": f"{uid[:8]}@rijeka.test"})
            assert c.execute(sa.text("SELECT role FROM profiles WHERE id = :id"), {"id": uid}).scalar() == "viewer"      # the sign-up function, not the metadata
        forget_role(uid)
        auth = _bearer(uid, "admin")
        assert client.get("/api/me/role", headers=auth).json()["role"] == "viewer"
        with eng.begin() as c:
            c.execute(sa.text("UPDATE profiles SET role = 'trader' WHERE id = :id"), {"id": uid})
        forget_role(uid)
        assert client.get("/api/me/role", headers=auth).json()["role"] == "trader"
    finally:
        with eng.begin() as c:
            c.execute(sa.text("DELETE FROM profiles WHERE id = :id"), {"id": uid})
            c.execute(sa.text("DELETE FROM auth.users WHERE id = :id"), {"id": uid})
        eng.dispose()
        forget_role(uid)
