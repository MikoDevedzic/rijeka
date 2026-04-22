"""
Sprint 12 item 4 phase 3 — Adversarial RLS isolation tests (first pass).

Runs real HTTP against the backend at localhost:8000 using real Supabase
JWTs for two test users (user_a@rijeka.test, user_b@rijeka.test).

First-pass scope: 8 tests covering the structural work shipped in
migrations 005 + 006 and the atomic trade-events endpoint. Subsequent
passes will extend to trades, counterparties, legal entities, org nodes,
and cashflows once their route-file payload shapes are confirmed.

Prerequisites:
  1. Backend running on localhost:8000
  2. .env.test at repo root with SUPABASE_URL, SUPABASE_ANON_KEY,
     USER_A_PASSWORD, USER_B_PASSWORD
  3. Both Supabase Auth users exist with raw_user_meta_data.role='trader'

Run:
  cd backend
  python -m pytest tests/test_rls_isolation.py -v

Skip (default unit-test run):
  python -m pytest tests/ --ignore=tests/test_rls_isolation.py
  -- OR --
  python -m pytest tests/ -m "not integration"

Data hygiene:
  All rows created during tests carry a TEST-RLS- prefix in their
  reference/identifier fields, or use a far-future val_date (2099-12-31)
  for tables whose natural key includes only dates. Periodic cleanup if
  tests leave orphans:

    DELETE FROM market_data_snapshots WHERE curve_id LIKE 'TEST-RLS-%';
    DELETE FROM market_data_snapshots WHERE valuation_date = '2099-12-31';
    DELETE FROM swaption_vol_skew     WHERE expiry_label LIKE 'TEST-RLS-%';
    DELETE FROM sabr_params           WHERE expiry_label LIKE 'TEST-RLS-%';
    DELETE FROM xva_calibration       WHERE valuation_date = '2099-12-31';
    DELETE FROM trade_legs            WHERE leg_ref      LIKE 'TEST-RLS-%';
    DELETE FROM trades                WHERE trade_ref    LIKE 'TEST-RLS-%';
    DELETE FROM counterparties        WHERE name         LIKE 'TEST-RLS-%';
    DELETE FROM legal_entities        WHERE name         LIKE 'TEST-RLS-%';
"""

import uuid

import httpx
import pytest

pytestmark = pytest.mark.integration

TIMEOUT = httpx.Timeout(10.0, connect=5.0)

# Far-future date for tests that share a natural key on (curve_id, valuation_date)
# and can't namespace the curve_id (e.g. xva_calibration hardcodes USD_SWVOL_ATM).
# Guarantees no collision with any real snapshot you may have saved.
TEST_VAL_DATE = "2099-12-31"


def _suffix() -> str:
    """Short random suffix for TEST-RLS-* identifiers."""
    return uuid.uuid4().hex[:8]


# =============================================================================
# 1. Smoke — both users authenticate + backend accepts their JWTs
# =============================================================================

def test_smoke_both_users_authenticated(user_a_auth, user_b_auth):
    """JWTs fetched successfully, uuids are distinct, tokens non-empty."""
    assert user_a_auth["token"], "user A token empty"
    assert user_b_auth["token"], "user B token empty"
    assert user_a_auth["uuid"] != user_b_auth["uuid"], "users have same uuid!"
    assert len(user_a_auth["token"]) > 100
    assert len(user_b_auth["token"]) > 100


def test_smoke_backend_accepts_both_jwts(backend_url, user_a_headers, user_b_headers):
    """
    Both users can hit an authenticated endpoint. /api/schedules/advance-date
    requires auth but takes no DB state — perfect smoke target.
    """
    body = {"date": "2026-04-22", "calendar": "NEW_YORK", "days": 2}
    for label, headers in [("user_a", user_a_headers), ("user_b", user_b_headers)]:
        r = httpx.post(f"{backend_url}/api/schedules/advance-date", json=body, headers=headers, timeout=TIMEOUT)
        assert r.status_code == 200, f"{label} got {r.status_code}: {r.text[:200]}"


# =============================================================================
# 2. market_data_snapshots — coexistence (validates migration 005)
# =============================================================================

def test_market_data_snapshots_both_users_coexist(backend_url, user_a_headers, user_b_headers):
    """
    Both users save a snapshot for the same (curve_id, valuation_date).
    After migration 005, the unique constraint is (user_id, curve_id,
    valuation_date) so both INSERTs succeed; two rows exist.
    """
    curve_id = f"TEST-RLS-MDS-{_suffix()}"
    val_date = "2026-04-22"
    body = {
        "curve_id": curve_id,
        "valuation_date": val_date,
        "quotes": [
            {"tenor": "1Y", "quote_type": "OIS", "rate": 3.5, "enabled": True},
            {"tenor": "2Y", "quote_type": "OIS", "rate": 3.6, "enabled": True},
        ],
        "source": "MANUAL",
    }

    r_a = httpx.post(f"{backend_url}/api/market-data/snapshots", json=body, headers=user_a_headers, timeout=TIMEOUT)
    assert r_a.status_code == 200, f"user A save failed: {r_a.status_code} {r_a.text[:300]}"

    r_b = httpx.post(f"{backend_url}/api/market-data/snapshots", json=body, headers=user_b_headers, timeout=TIMEOUT)
    assert r_b.status_code == 200, f"user B save failed (migration 005 regression?): {r_b.status_code} {r_b.text[:300]}"

    assert r_a.json()["id"] != r_b.json()["id"], "same snapshot row — migration 005 didn't swap constraint"


# =============================================================================
# 3. market_data_snapshots — isolation
# =============================================================================

def test_market_data_snapshots_user_b_cannot_read_user_a_snapshot(backend_url, user_a_headers, user_b_headers):
    """
    User A saves a snapshot with a unique curve_id. User B's
    GET /api/market-data/snapshots/{curve_id}/latest should return
    {exists: false} — User A's row must not leak.
    """
    curve_id = f"TEST-RLS-ISO-{_suffix()}"
    body = {
        "curve_id": curve_id,
        "valuation_date": "2026-04-22",
        "quotes": [{"tenor": "1Y", "quote_type": "OIS", "rate": 3.5, "enabled": True}],
        "source": "MANUAL",
    }
    r_a = httpx.post(f"{backend_url}/api/market-data/snapshots", json=body, headers=user_a_headers, timeout=TIMEOUT)
    assert r_a.status_code == 200, f"setup failed: {r_a.status_code}"

    r_b = httpx.get(f"{backend_url}/api/market-data/snapshots/{curve_id}/latest", headers=user_b_headers, timeout=TIMEOUT)
    assert r_b.status_code == 200, f"user B GET latest failed: {r_b.status_code}"
    body_b = r_b.json()
    assert body_b.get("exists") is False, f"user B sees user A's snapshot — tenant leak! body={body_b}"


# =============================================================================
# 4. swaption_vol_skew — coexistence (validates migration 005)
# =============================================================================

def test_swaption_vol_skew_both_users_coexist(backend_url, user_a_headers, user_b_headers):
    """
    Both users save a vol skew cell for the same (valuation_date,
    expiry_label, tenor_label). After migration 005 both inserts must succeed.
    """
    suf = _suffix()
    val_date = "2026-04-22"
    cell = {
        "expiry_label": f"TEST-RLS-{suf}",  # goes into the unique key
        "tenor_label": "5Y",
        "expiry_y": 1.0,
        "tenor_y": 5.0,
        "atm_vol_bp": 85.0,
        "spread_m100": -12.0,
        "spread_p100": 8.0,
        "source": "MANUAL",
    }
    body = {"valuation_date": val_date, "cells": [cell]}

    r_a = httpx.post(f"{backend_url}/api/market-data/vol-skew", json=body, headers=user_a_headers, timeout=TIMEOUT)
    assert r_a.status_code == 200, f"user A vol-skew save failed: {r_a.status_code} {r_a.text[:300]}"

    r_b = httpx.post(f"{backend_url}/api/market-data/vol-skew", json=body, headers=user_b_headers, timeout=TIMEOUT)
    assert r_b.status_code == 200, f"user B vol-skew save failed (migration 005 regression?): {r_b.status_code} {r_b.text[:300]}"

    # Both saves report saved=1
    assert r_a.json().get("saved", 0) >= 1
    assert r_b.json().get("saved", 0) >= 1


# =============================================================================
# 5. sabr_params / vol-skew — isolation
# =============================================================================

def test_sabr_params_user_b_sees_only_own(backend_url, user_a_headers, user_b_headers):
    """
    User A saves a manual SABR param with a namespaced expiry_label; User B's
    GET /api/market-data/sabr-params/latest should not return A's row under
    B's tenant.

    We can't guarantee user B's response is empty (B may have prior calibrations),
    but we CAN guarantee A's TEST-RLS-* expiry_label does NOT appear in B's list.
    """
    suf = _suffix()
    body = {
        "valuation_date": "2026-04-22",
        "params": [{
            "expiry_label": f"TEST-RLS-SABR-{suf}",
            "tenor_label": "5Y",
            "expiry_y": 1.0,
            "tenor_y": 5.0,
            "alpha": 0.01,
            "rho": -0.3,
            "nu": 0.4,
            "atm_vol_bp": 85.0,
        }],
    }
    r_a = httpx.post(f"{backend_url}/api/market-data/sabr-params/manual", json=body, headers=user_a_headers, timeout=TIMEOUT)
    assert r_a.status_code == 200, f"setup failed: {r_a.status_code} {r_a.text[:300]}"

    r_b = httpx.get(f"{backend_url}/api/market-data/sabr-params/latest", headers=user_b_headers, timeout=TIMEOUT)
    assert r_b.status_code == 200
    body_b = r_b.json()

    # User B's view must not contain user A's namespaced expiry_label.
    labels_b = [p.get("expiry_label") for p in body_b.get("params", [])]
    assert f"TEST-RLS-SABR-{suf}" not in labels_b, f"tenant leak: user B sees user A's SABR param {labels_b}"


# =============================================================================
# 6. xva_calibration — coexistence (validates migration 006)
# =============================================================================
#
# xva.py's /calibrate endpoint hardcodes curve_id='USD_SWVOL_ATM' and requires
# a prior vol snapshot under that same curve_id. We use a far-future val_date
# (2099-12-31) to avoid colliding with any real data.
#
# SWVOL quotes round-trip through the backend as the combined-tenor format
# `"{expiry}x{tenor}"` — matches bloomberg.py's snap-swvol storage format
# (bloomberg.py:236-246) and xva.py's calibrate split logic (xva.py:136-143).

def test_xva_calibration_both_users_coexist(backend_url, user_a_headers, user_b_headers):
    """
    After migration 006, xva_calibration is UNIQUE(user_id, curve_id,
    valuation_date, model). Both users saving a calibration for the same
    (USD_SWVOL_ATM, val_date, HW1F) must produce two rows.
    """
    val_date = TEST_VAL_DATE  # 2099-12-31 — cannot collide with real data

    # 1. Seed USD_SWVOL_ATM for both users. Quotes use combined-tenor format
    # (PillarQuoteIn requires `tenor: str`; xva.py parses "1Yx5Y" back into
    # expiry + tenor at lines 136-143).
    vol_body = {
        "curve_id": "USD_SWVOL_ATM",
        "valuation_date": val_date,
        "quotes": [
            {"tenor": "1Yx5Y", "quote_type": "SWVOL", "rate": 80.0,  "enabled": True},
            {"tenor": "2Yx5Y", "quote_type": "SWVOL", "rate": 85.0,  "enabled": True},
            {"tenor": "3Yx5Y", "quote_type": "SWVOL", "rate": 90.0,  "enabled": True},
            {"tenor": "5Yx5Y", "quote_type": "SWVOL", "rate": 95.0,  "enabled": True},
            {"tenor": "7Yx5Y", "quote_type": "SWVOL", "rate": 100.0, "enabled": True},
        ],
        "source": "MANUAL",
    }
    for label, headers in [("user_a", user_a_headers), ("user_b", user_b_headers)]:
        r = httpx.post(f"{backend_url}/api/market-data/snapshots", json=vol_body, headers=headers, timeout=TIMEOUT)
        assert r.status_code == 200, f"{label} vol seed failed: {r.status_code} {r.text[:300]}"

    # 2. Calibrate under both users.
    cal_body = {"valuation_date": val_date, "theta": 0.035}
    r_a = httpx.post(f"{backend_url}/api/xva/calibrate", json=cal_body, headers=user_a_headers, timeout=30.0)
    assert r_a.status_code == 200, f"user A calibrate failed: {r_a.status_code} {r_a.text[:300]}"

    r_b = httpx.post(f"{backend_url}/api/xva/calibrate", json=cal_body, headers=user_b_headers, timeout=30.0)
    assert r_b.status_code == 200, f"user B calibrate failed (migration 006 regression?): {r_b.status_code} {r_b.text[:300]}"

    # Both calibrations produced a finite result.
    assert r_a.json().get("sigma_bp") is not None
    assert r_b.json().get("sigma_bp") is not None


# =============================================================================
# 7. xva_calibration — isolation
# =============================================================================

def test_xva_calibration_get_latest_is_user_scoped(backend_url, user_a_headers, user_b_headers):
    """
    GET /api/xva/calibration/latest must filter by user_id. If both users
    have calibrations, they must be distinct rows.
    """
    r_a = httpx.get(f"{backend_url}/api/xva/calibration/latest", headers=user_a_headers, timeout=TIMEOUT)
    r_b = httpx.get(f"{backend_url}/api/xva/calibration/latest", headers=user_b_headers, timeout=TIMEOUT)
    assert r_a.status_code == 200
    assert r_b.status_code == 200

    body_a = r_a.json()
    body_b = r_b.json()

    # If both users have a calibration, they must be distinct rows (different id).
    if body_a.get("exists") and body_b.get("exists"):
        assert body_a["id"] != body_b["id"], (
            "user A and user B see the same xva_calibration row — migration 006 regression"
        )


# =============================================================================
# 8. Atomic confirm — cross-tenant 404 (no existence leak)
# =============================================================================

def test_confirm_random_trade_uuid_returns_404(backend_url, user_b_headers):
    """
    POST /api/trade-events/confirm/{uuid} must return 404 for a trade that
    doesn't exist OR belongs to another user. No existence leak across tenants.

    We can't easily create a PENDING trade for user A without knowing the
    trades.py payload shape, so this test uses a random UUID — the assertion
    is that the response is 404 (not 500, not 403, not 200).
    """
    bogus_trade_uuid = str(uuid.uuid4())
    r = httpx.post(
        f"{backend_url}/api/trade-events/confirm/{bogus_trade_uuid}",
        headers=user_b_headers,
        timeout=TIMEOUT,
    )
    assert r.status_code == 404, (
        f"expected 404 for nonexistent trade, got {r.status_code}: {r.text[:200]}"
    )
    assert "not found" in r.text.lower()


# =============================================================================
# 9. counterparties - coexistence across tenants
# =============================================================================

def test_counterparties_both_users_coexist_same_name(backend_url, user_a_headers, user_b_headers):
    """
    Both users create a counterparty with identical payload. There is no
    unique constraint on (user_id, name), but per-user scoping means both
    INSERTs succeed with distinct ids.
    """
    suf = _suffix()
    body = {
        "name": f"TEST-RLS-CP-{suf}",
        "csa_type": "NO_CSA",
        "im_model": "SIMM",
    }

    r_a = httpx.post(f"{backend_url}/api/counterparties/", json=body, headers=user_a_headers, timeout=TIMEOUT)
    assert r_a.status_code == 200, f"user A CP create failed: {r_a.status_code} {r_a.text[:300]}"

    r_b = httpx.post(f"{backend_url}/api/counterparties/", json=body, headers=user_b_headers, timeout=TIMEOUT)
    assert r_b.status_code == 200, f"user B CP create failed: {r_b.status_code} {r_b.text[:300]}"

    assert r_a.json()["id"] != r_b.json()["id"], "counterparty ids collided - user_id not scoping rows"


# =============================================================================
# 10. counterparties - user B cannot see user A's counterparty in list
# =============================================================================

def test_counterparties_get_list_user_scoped(backend_url, user_a_headers, user_b_headers):
    """A creates CP with namespaced name; B's list must not include it."""
    suf = _suffix()
    name = f"TEST-RLS-CP-ISO-{suf}"
    r_a = httpx.post(
        f"{backend_url}/api/counterparties/",
        json={"name": name, "csa_type": "NO_CSA"},
        headers=user_a_headers, timeout=TIMEOUT,
    )
    assert r_a.status_code == 200

    r_b = httpx.get(f"{backend_url}/api/counterparties/", headers=user_b_headers, timeout=TIMEOUT)
    assert r_b.status_code == 200
    names_b = [cp["name"] for cp in r_b.json()]
    assert name not in names_b, f"tenant leak: user B sees user A's CP {name} in list"


# =============================================================================
# 11. counterparties - user B cannot update user A's counterparty
# =============================================================================

def test_counterparties_put_cross_tenant_404(backend_url, user_a_headers, user_b_headers):
    """A creates CP; B tries PUT with A's id -> 404."""
    r_a = httpx.post(
        f"{backend_url}/api/counterparties/",
        json={"name": f"TEST-RLS-CP-PUT-{_suffix()}", "csa_type": "NO_CSA"},
        headers=user_a_headers, timeout=TIMEOUT,
    )
    assert r_a.status_code == 200
    cp_id = r_a.json()["id"]

    r_b = httpx.put(
        f"{backend_url}/api/counterparties/{cp_id}",
        json={"name": "HIJACKED"},
        headers=user_b_headers, timeout=TIMEOUT,
    )
    assert r_b.status_code == 404, (
        f"expected 404, got {r_b.status_code} - user B updated user A's CP!"
    )


# =============================================================================
# 12. counterparties - user B cannot delete user A's counterparty
# =============================================================================

def test_counterparties_delete_cross_tenant_404(backend_url, user_a_headers, user_b_headers):
    """A creates CP; B tries DELETE with A's id -> 404; A's CP survives."""
    r_a = httpx.post(
        f"{backend_url}/api/counterparties/",
        json={"name": f"TEST-RLS-CP-DEL-{_suffix()}", "csa_type": "NO_CSA"},
        headers=user_a_headers, timeout=TIMEOUT,
    )
    assert r_a.status_code == 200
    cp_id = r_a.json()["id"]

    r_b = httpx.delete(
        f"{backend_url}/api/counterparties/{cp_id}",
        headers=user_b_headers, timeout=TIMEOUT,
    )
    assert r_b.status_code == 404, f"expected 404, got {r_b.status_code}"

    # Verify A's CP survived
    r_a_list = httpx.get(f"{backend_url}/api/counterparties/", headers=user_a_headers, timeout=TIMEOUT)
    assert r_a_list.status_code == 200
    ids_a = [cp["id"] for cp in r_a_list.json()]
    assert cp_id in ids_a, "user A's CP was deleted despite cross-tenant attempt"


# =============================================================================
# 13. legal_entities - user B cannot see user A's entity in list
# =============================================================================

def test_legal_entities_get_list_user_scoped(backend_url, user_a_headers, user_b_headers):
    """A creates entity; B's list must not include it."""
    suf = _suffix()
    name = f"TEST-RLS-LE-ISO-{suf}"
    r_a = httpx.post(
        f"{backend_url}/api/legal-entities/",
        json={"name": name, "home_currency": "USD", "is_own_entity": False, "lei": f"TEST{_suffix().upper()}RLS", "jurisdiction": "US"},
        headers=user_a_headers, timeout=TIMEOUT,
    )
    assert r_a.status_code == 200, f"setup failed: {r_a.status_code} {r_a.text[:300]}"

    r_b = httpx.get(f"{backend_url}/api/legal-entities/", headers=user_b_headers, timeout=TIMEOUT)
    assert r_b.status_code == 200
    names_b = [e["name"] for e in r_b.json()]
    assert name not in names_b, f"tenant leak: user B sees user A's entity {name}"


# =============================================================================
# 14. legal_entities - user B cannot update user A's entity
# =============================================================================

def test_legal_entities_put_cross_tenant_404(backend_url, user_a_headers, user_b_headers):
    """A creates entity; B tries PUT with A's id -> 404."""
    r_a = httpx.post(
        f"{backend_url}/api/legal-entities/",
        json={"name": f"TEST-RLS-LE-PUT-{_suffix()}", "home_currency": "USD", "lei": f"TEST{_suffix().upper()}PUT", "jurisdiction": "US"},
        headers=user_a_headers, timeout=TIMEOUT,
    )
    assert r_a.status_code == 200
    entity_id = r_a.json()["id"]

    r_b = httpx.put(
        f"{backend_url}/api/legal-entities/{entity_id}",
        json={"name": "HIJACKED"},
        headers=user_b_headers, timeout=TIMEOUT,
    )
    assert r_b.status_code == 404


# =============================================================================
# 15. legal_entities - user B cannot delete user A's entity
# =============================================================================

def test_legal_entities_delete_cross_tenant_404(backend_url, user_a_headers, user_b_headers):
    """A creates entity; B tries DELETE with A's id -> 404; A's entity survives."""
    r_a = httpx.post(
        f"{backend_url}/api/legal-entities/",
        json={"name": f"TEST-RLS-LE-DEL-{_suffix()}", "home_currency": "USD", "lei": f"TEST{_suffix().upper()}DEL", "jurisdiction": "US"},
        headers=user_a_headers, timeout=TIMEOUT,
    )
    assert r_a.status_code == 200
    entity_id = r_a.json()["id"]

    r_b = httpx.delete(
        f"{backend_url}/api/legal-entities/{entity_id}",
        headers=user_b_headers, timeout=TIMEOUT,
    )
    assert r_b.status_code == 404

    r_a_list = httpx.get(f"{backend_url}/api/legal-entities/", headers=user_a_headers, timeout=TIMEOUT)
    assert r_a_list.status_code == 200
    ids_a = [e["id"] for e in r_a_list.json()]
    assert entity_id in ids_a, "user A's entity was deleted despite cross-tenant attempt"


# =============================================================================
# Helper: minimal PENDING IR_SWAP trade for user
# =============================================================================

def _create_pending_trade(backend_url, headers, ref_suffix=None):
    """
    Create a minimal PENDING IR_SWAP trade. Returns the response body.
    No counterparty, no legs, just the trade shell - sufficient for tenancy
    and lifecycle tests. Caller responsible for cleanup via TEST-RLS-* prefix.
    """
    suf = ref_suffix or _suffix()
    body = {
        "trade_ref": f"TEST-RLS-TRD-{suf}",
        "status": "PENDING",
        "store": "WORKING",
        "asset_class": "RATES",
        "instrument_type": "IR_SWAP",
        "notional": 10_000_000.0,
        "notional_ccy": "USD",
        "trade_date": "2026-04-22",
        "effective_date": "2026-04-24",
        "maturity_date": "2031-04-24",
        "terms": {},
    }
    r = httpx.post(f"{backend_url}/api/trades/", json=body, headers=headers, timeout=TIMEOUT)
    if r.status_code != 200:
        raise RuntimeError(f"trade create failed: {r.status_code} {r.text[:400]}")
    return r.json()


# =============================================================================
# 16. trades - user B's list does not include user A's trade
# =============================================================================

def test_trades_get_list_user_scoped(backend_url, user_a_headers, user_b_headers):
    trade_a = _create_pending_trade(backend_url, user_a_headers)
    trade_ref_a = trade_a["trade_ref"]

    r_b = httpx.get(f"{backend_url}/api/trades/", headers=user_b_headers, timeout=TIMEOUT)
    assert r_b.status_code == 200
    refs_b = [t["trade_ref"] for t in r_b.json()]
    assert trade_ref_a not in refs_b, f"tenant leak: user B sees user A's trade {trade_ref_a}"


# =============================================================================
# 17. trades - user B cannot PUT user A's trade
# =============================================================================

def test_trades_put_cross_tenant_404(backend_url, user_a_headers, user_b_headers):
    trade_a = _create_pending_trade(backend_url, user_a_headers)
    trade_id = trade_a["id"]

    r_b = httpx.put(
        f"{backend_url}/api/trades/{trade_id}",
        json={"desk": "HIJACKED"},
        headers=user_b_headers, timeout=TIMEOUT,
    )
    assert r_b.status_code == 404


# =============================================================================
# 18. trades - user B cannot DELETE user A's trade
# =============================================================================

def test_trades_delete_cross_tenant_404(backend_url, user_a_headers, user_b_headers):
    trade_a = _create_pending_trade(backend_url, user_a_headers)
    trade_id = trade_a["id"]

    r_b = httpx.delete(f"{backend_url}/api/trades/{trade_id}", headers=user_b_headers, timeout=TIMEOUT)
    assert r_b.status_code == 404

    r_a_list = httpx.get(f"{backend_url}/api/trades/", headers=user_a_headers, timeout=TIMEOUT)
    assert r_a_list.status_code == 200
    ids_a = [t["id"] for t in r_a_list.json()]
    assert trade_id in ids_a, "user A's trade was deleted despite cross-tenant attempt"


# =============================================================================
# 19. trades - /summary counts are user-scoped
# =============================================================================

def test_trades_summary_is_user_scoped(backend_url, user_a_headers, user_b_headers):
    """
    A creates a PENDING trade. A's summary.pending increases by >=1;
    B's summary.total is unchanged.
    """
    r_a_before = httpx.get(f"{backend_url}/api/trades/summary", headers=user_a_headers, timeout=TIMEOUT)
    r_b_before = httpx.get(f"{backend_url}/api/trades/summary", headers=user_b_headers, timeout=TIMEOUT)
    assert r_a_before.status_code == 200 and r_b_before.status_code == 200
    pending_a_before = r_a_before.json().get("pending", 0)
    total_b_before = r_b_before.json().get("total", 0)

    _create_pending_trade(backend_url, user_a_headers)

    r_a_after = httpx.get(f"{backend_url}/api/trades/summary", headers=user_a_headers, timeout=TIMEOUT)
    r_b_after = httpx.get(f"{backend_url}/api/trades/summary", headers=user_b_headers, timeout=TIMEOUT)
    assert r_a_after.json()["pending"] >= pending_a_before + 1, (
        f"user A pending didn't increase: {pending_a_before} -> {r_a_after.json()['pending']}"
    )
    assert r_b_after.json()["total"] == total_b_before, (
        f"user B total changed after user A created a trade: "
        f"{total_b_before} -> {r_b_after.json()['total']}"
    )


# =============================================================================
# 20. trade-events confirm - positive happy path (owner confirms own trade)
# =============================================================================

def test_confirm_own_pending_trade_succeeds(backend_url, user_a_headers):
    """
    A creates a PENDING trade, A confirms it -> 200 + status=CONFIRMED.
    Closes the positive-path gap left by the phase 3 first pass (which only
    tested the cross-tenant 404 case with a random UUID).
    """
    trade_a = _create_pending_trade(backend_url, user_a_headers)
    trade_id = trade_a["id"]
    assert trade_a["status"] == "PENDING"

    r_confirm = httpx.post(
        f"{backend_url}/api/trade-events/confirm/{trade_id}",
        headers=user_a_headers, timeout=TIMEOUT,
    )
    # 201 Created: endpoint appends a row to trade_events (new resource)
    assert r_confirm.status_code == 201, (
        f"confirm failed for own PENDING trade: {r_confirm.status_code} {r_confirm.text[:300]}"
    )

    # Verify status flipped
    r_list = httpx.get(f"{backend_url}/api/trades/", headers=user_a_headers, timeout=TIMEOUT)
    assert r_list.status_code == 200
    trade_after = next((t for t in r_list.json() if t["id"] == trade_id), None)
    assert trade_after is not None, "confirmed trade missing from own list"
    assert trade_after["status"] == "CONFIRMED", (
        f"expected status=CONFIRMED after confirm, got {trade_after['status']}"
    )


# =============================================================================
# 21. trade-events confirm - cross-tenant attempt on REAL trade returns 404
# =============================================================================

def test_confirm_cross_tenant_real_trade_404(backend_url, user_a_headers, user_b_headers):
    """
    Stricter than test 8: A creates a REAL PENDING trade; B attempts to
    confirm it. Must return 404 (no existence leak), and A's trade must
    still be PENDING afterward (no silent state mutation).
    """
    trade_a = _create_pending_trade(backend_url, user_a_headers)
    trade_id = trade_a["id"]

    r_b = httpx.post(
        f"{backend_url}/api/trade-events/confirm/{trade_id}",
        headers=user_b_headers, timeout=TIMEOUT,
    )
    assert r_b.status_code == 404, (
        f"expected 404 on cross-tenant confirm, got {r_b.status_code}: {r_b.text[:200]}"
    )

    # Verify A's trade still PENDING (no silent confirm)
    r_list = httpx.get(f"{backend_url}/api/trades/", headers=user_a_headers, timeout=TIMEOUT)
    trade_after = next((t for t in r_list.json() if t["id"] == trade_id), None)
    assert trade_after is not None
    assert trade_after["status"] == "PENDING", (
        f"trade status changed despite cross-tenant confirm attempt: {trade_after['status']}"
    )


# =============================================================================
# 22. trade_legs - user B sees no legs when querying user A's trade_id
# =============================================================================

def test_trade_legs_list_by_trade_is_user_scoped(backend_url, user_a_headers, user_b_headers):
    """
    A creates a trade + leg. B queries /api/trade-legs/{A-trade-id}.
    Because the query filters by user_id, B's result must not include A's leg.
    """
    trade_a = _create_pending_trade(backend_url, user_a_headers)
    leg_id = str(uuid.uuid4())
    leg_body = {
        "id": leg_id,
        "trade_id": trade_a["id"],
        "leg_ref": f"TEST-RLS-LEG-{_suffix()}",
        "leg_seq": 0,
        "leg_type": "FIXED",
        "direction": "PAY",
        "currency": "USD",
    }
    r_leg = httpx.post(f"{backend_url}/api/trade-legs/", json=leg_body, headers=user_a_headers, timeout=TIMEOUT)
    assert r_leg.status_code == 201, f"leg create failed: {r_leg.status_code} {r_leg.text[:300]}"

    r_b = httpx.get(f"{backend_url}/api/trade-legs/{trade_a['id']}", headers=user_b_headers, timeout=TIMEOUT)
    assert r_b.status_code == 200, f"user B leg-list by trade_id failed: {r_b.status_code}"
    legs_b = r_b.json()
    assert all(l["id"] != leg_id for l in legs_b), (
        f"tenant leak: user B sees user A's leg {leg_id} in list {legs_b}"
    )


# =============================================================================
# 23. trade_legs - user B cannot GET user A's leg by leg_id
# =============================================================================

def test_trade_legs_get_single_cross_tenant_404(backend_url, user_a_headers, user_b_headers):
    trade_a = _create_pending_trade(backend_url, user_a_headers)
    leg_id = str(uuid.uuid4())
    r_leg = httpx.post(
        f"{backend_url}/api/trade-legs/",
        json={
            "id": leg_id, "trade_id": trade_a["id"],
            "leg_ref": f"TEST-RLS-LEG-{_suffix()}",
            "leg_type": "FIXED", "direction": "PAY", "currency": "USD",
        },
        headers=user_a_headers, timeout=TIMEOUT,
    )
    assert r_leg.status_code == 201

    r_b = httpx.get(f"{backend_url}/api/trade-legs/leg/{leg_id}", headers=user_b_headers, timeout=TIMEOUT)
    assert r_b.status_code == 404, f"expected 404, got {r_b.status_code}: {r_b.text[:200]}"


# =============================================================================
# 24. trade_legs - user B cannot PUT user A's leg
# =============================================================================

def test_trade_legs_put_cross_tenant_404(backend_url, user_a_headers, user_b_headers):
    trade_a = _create_pending_trade(backend_url, user_a_headers)
    leg_id = str(uuid.uuid4())
    r_leg = httpx.post(
        f"{backend_url}/api/trade-legs/",
        json={
            "id": leg_id, "trade_id": trade_a["id"],
            "leg_ref": f"TEST-RLS-LEG-{_suffix()}",
            "leg_type": "FIXED", "direction": "PAY", "currency": "USD",
        },
        headers=user_a_headers, timeout=TIMEOUT,
    )
    assert r_leg.status_code == 201

    r_b = httpx.put(
        f"{backend_url}/api/trade-legs/leg/{leg_id}",
        json={"terms": {"hijacked": True}},
        headers=user_b_headers, timeout=TIMEOUT,
    )
    assert r_b.status_code == 404
