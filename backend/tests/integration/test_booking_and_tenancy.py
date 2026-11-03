"""Every product books through POST /api/book/trade with the app's own bodies, prices, and is the caller's alone."""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.integration

LEG_FIELDS = ("effective_date", "maturity_date", "discount_curve_id", "day_count", "payment_frequency", "bdc", "stub_type", "currency")


def test_every_product_books_and_is_pending_with_a_booked_event(client, auth_a, booked):
    assert set(booked) >= {"IR_SWAP", "IR_SWAPTION", "IR_CAP", "IR_FLOOR", "IR_COLLAR", "FX_SPOT", "FX_FORWARD", "NDF",
                           "FX_OPTION", "FX_OPTION_BARRIER", "CRYPTO_FORWARD", "CRYPTO_OPTION"}
    for key, b in booked.items():
        assert b["trade"]["status"] == "PENDING", key
        ev = client.get(f"/api/trade-events/{b['id']}", headers=auth_a)
        assert ev.status_code == 200 and [e["event_type"] for e in ev.json()] == ["BOOKED"], key


def test_every_product_prices_from_its_stored_record(client, auth_a, booked):
    for key, b in booked.items():
        curves = [{"curve_id": b["trade"].get("discount_curve_id") or "USD_SOFR"}]
        r = client.post("/price", json={"trade_id": b["id"], "curves": curves}, headers=auth_a)
        assert r.status_code == 200, f"{key}: {r.status_code} {r.text[:300]}"
        j = r.json()
        assert isinstance(j.get("npv"), (int, float)), key
        assert j.get("trade_id") == b["id"], key


def test_blotter_lists_each_trade_with_its_structure_label(client, auth_a, booked):
    rows = {t["trade_ref"]: t for t in client.get("/api/trades/", headers=auth_a).json()}
    for key, b in booked.items():
        row = rows.get(b["ref"])
        assert row is not None, key
        assert row["instrument_type"] == b["body"]["instrument_type"], key
        assert row["structure"] == b["structure"], (key, row["structure"])
        assert row["counterparty"] and row["counterparty"]["name"], key


def test_rates_legs_come_back_complete(client, auth_a, booked):
    """complete_booking fills dates, curves, day counts, frequencies and stubs on every leg; the stored
    rows, read back through /api/trade-legs, carry them."""
    for key in ("IR_SWAP", "IR_SWAPTION", "IR_CAP", "IR_FLOOR", "IR_COLLAR"):
        legs = client.get(f"/api/trade-legs/{booked[key]['id']}", headers=auth_a).json()
        assert len(legs) == len(booked[key]["body"]["legs"]), key
        for leg in legs:
            for f in LEG_FIELDS:
                assert leg.get(f) not in (None, ""), (key, leg["leg_ref"], f)
            if leg["leg_type"] == "FLOAT":
                assert leg.get("forecast_curve_id") and leg.get("reset_frequency"), (key, leg["leg_ref"])
        if key in ("IR_CAP", "IR_FLOOR", "IR_COLLAR"):
            assert legs[0]["embedded_options"] == booked[key]["body"]["legs"][0]["embedded_options"], key


def test_fx_products_have_no_legs_and_keep_their_terms(client, auth_a, booked):
    for key in ("FX_SPOT", "FX_FORWARD", "NDF", "FX_OPTION", "CRYPTO_FORWARD", "CRYPTO_OPTION"):
        assert booked[key]["legs"] == [], key
        assert booked[key]["trade"]["terms"] == booked[key]["body"]["terms"], key


def test_the_other_tenant_sees_none_of_it(client, auth_b, booked):
    refs = {t["trade_ref"] for t in client.get("/api/trades/", headers=auth_b).json()}
    assert not refs & {b["ref"] for b in booked.values()}
    for key, b in booked.items():
        assert client.get(f"/api/trade-events/{b['id']}", headers=auth_b).status_code == 404, key
        assert client.post("/price", json={"trade_id": b["id"], "curves": [{"curve_id": "USD_SOFR"}]}, headers=auth_b).status_code == 404, key
        assert client.get(f"/api/trade-legs/{b['id']}", headers=auth_b).json() == [], key
        assert client.post("/api/cashflows/bulk", json={"trade_id": b["id"], "cashflows": []}, headers=auth_b).status_code == 404, key
        assert client.delete(f"/api/trades/{b['id']}", headers=auth_b).status_code == 404, key


def test_booking_against_someone_elses_counterparty_is_refused(client, auth_a, ids):
    from tests.integration import bodies as B
    body = B.swap({**ids["a"], "counterparty_id": ids["b"]["counterparty_id"]}, f"IT-FOREIGN-CP-{uuid.uuid4().hex[:6]}")
    r = client.post("/api/book/trade", json=body, headers=auth_a)
    assert r.status_code == 422 and "counterparty" in r.text


def test_idempotency_key_returns_the_same_trade(client, auth_a, ids):
    from tests.integration import bodies as B
    body = B.swap(ids["a"], f"IT-IDEM-{uuid.uuid4().hex[:6]}")
    key = str(uuid.uuid4())
    r1 = client.post("/api/book/trade", json=body, headers={**auth_a, "Idempotency-Key": key})
    r2 = client.post("/api/book/trade", json=body, headers={**auth_a, "Idempotency-Key": key})
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["trade"]["id"] == r2.json()["trade"]["id"] and r2.json()["idempotent_replay"] is True
