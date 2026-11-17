"""One trade through every XVA run that values it (0.52.0). The rates ticket values the trade itself on the paths
(POST /api/xva/simulate with `trade` or `trade_id`), as the counterparty's netting-set run does (POST
/api/xva/incremental): for a trade alone in a set, on one valuation date, with the same paths and the same spreads,
the two are one calculation and must give one answer. Until 0.52.0 the ticket ran a generic swap whose legs settle
monthly, a swaption's terms were not read at all, and until 0.51.0 the netting-set run left the floating leg's
accrued interest out: the two stood three to five times apart on a par swap."""
import pytest

from tests.integration import bodies as B

pytestmark = pytest.mark.integration

FOUR = ("cva", "dva", "fca", "fba")


def _free():
    from api.routes import _limits
    _limits._buckets.clear()


@pytest.fixture(scope="module")
def empty_cp(client, auth_a) -> str:
    """A counterparty with no margin agreement and no trades: a set of one trade is that trade alone."""
    import uuid
    r = client.post("/api/counterparties/", json={"name": f"RC-ALONE-{uuid.uuid4().hex[:8]}", "csa_type": "NO_CSA"}, headers=auth_a)
    assert r.status_code == 200, r.text[:300]
    yield r.json()["id"]
    client.delete(f"/api/counterparties/{r.json()['id']}", headers=auth_a)


def _alone(client, auth, trade, cp, n=1000):
    _free()
    r = client.post("/api/xva/incremental", json={"counterparty_id": cp, "trade": trade, "n_paths": n}, headers=auth)
    assert r.status_code == 200, r.text[:400]
    j = r.json()
    assert j["other_trades"] == 0 and j["csa"]["collateralised"] is False, "a set of this trade alone, with no margin agreement"
    return j


def _ticket(client, auth, **body):
    _free()
    r = client.post("/api/xva/simulate", json={"paths": 1000, "seed": 7, **body}, headers=auth)
    assert r.status_code == 200, r.text[:400]
    return r.json()


def test_a_swap_on_the_ticket_and_alone_in_a_netting_set_is_one_calculation(client, auth_a, ids, empty_cp):
    for name, edit in (("pay 3.75 %", lambda b: b),
                       ("receive 3.2 %", lambda b: (b["terms"].update(direction="RECEIVE", float_direction="PAY", fixed_rate=0.032),
                                                    b["legs"][0].update(direction="RECEIVE", fixed_rate=0.032), b["legs"][1].update(direction="PAY"), b)[-1])):
        sw = edit(B.swap(ids["a"], "RC-SWAP"))
        net = _alone(client, auth_a, sw, empty_cp)
        # the netting-set run reads the firm's counterparty spread and the engine's own defaults, flat: the ticket is given the same
        tk = _ticket(client, auth_a, trade=sw, valuation_date=net["asof"], cp_cds_bp=net["cp_cds_bp"], lgd=net["lgd"])
        assert tk["basis"]["kind"] == "TRADE" and tk["basis"]["valued_as"] == "SWAP" and tk["steps"] == net["months"]
        for k in FOUR:
            assert tk["xva"][k] == pytest.approx(net["incremental"][k], rel=2e-3, abs=1.0), (name, k, tk["xva"][k], net["incremental"][k])
        # capital: the same add-on on the same remaining life
        assert tk["xva"]["kva"] == pytest.approx(net["incremental"]["kva"], rel=5e-3), name
        # and the expected exposure, date by date
        ee_net = net["ee"]["with"]
        assert len(ee_net) == len(tk["ee"]) and max(abs(a - b) for a, b in zip(tk["ee"], ee_net)) < 0.002 * max(ee_net) + 1.0, name


def test_the_paths_start_at_the_pricers_value_of_the_trade(client, auth_a, auth_b, booked):
    """Two engines value one trade: the pricer, and the paths at their start. They are not forced together; the answer
    carries both, and on a swap they stand within a thousandth of the notional's basis point value."""
    tid = booked["IR_SWAP"]["id"]
    pr = client.post("/price", json={"trade_id": tid, "curves": [{"curve_id": "USD_SOFR"}]}, headers=auth_a).json()
    tk = _ticket(client, auth_a, trade_id=tid, npv=pr["npv"])
    assert tk["anchor"]["npv"] == pytest.approx(pr["npv"], abs=0.01)
    assert abs(tk["anchor"]["model_v0"] - pr["npv"]) < 0.1 * abs(pr["ir01"]), (tk["anchor"], pr["ir01"])
    assert tk["anchor"]["delta"] == pytest.approx(pr["npv"] - tk["anchor"]["model_v0"], abs=0.02)
    assert tk["xva"]["all_in"] == pytest.approx(pr["npv"] + tk["xva"]["xva_total"], abs=0.02), "the all-in is the pricer's value and the adjustments"
    # a stored trade by its id is the trade the ticket would send
    same = _ticket(client, auth_a, trade=booked["IR_SWAP"]["body"], npv=pr["npv"])
    for k in FOUR + ("kva",):
        assert same["xva"][k] == pytest.approx(tk["xva"][k], rel=1e-9, abs=0.01), k
    # a trade is read only among the account's own: this one, asked for by another account, is not found
    # (and the answer is the one a trade that does not exist gets: nothing says the id is someone's)
    theirs = client.post("/api/xva/simulate", json={"trade_id": tid}, headers=auth_b)
    nobody = client.post("/api/xva/simulate", json={"trade_id": "00000000-0000-0000-0000-000000000001"}, headers=auth_b)
    assert theirs.status_code == 404 and nobody.status_code == 404 and theirs.json() == nobody.json()
    assert client.post("/api/xva/simulate", json={"trade_id": "00000000-0000-0000-0000-000000000001"}, headers=auth_a).status_code == 404
    assert client.post("/api/xva/simulate", json={"trade_id": "not-a-uuid"}, headers=auth_a).status_code == 422


def test_a_swaption_is_an_option_on_the_paths_and_not_a_swap(client, auth_a, ids, empty_cp):
    so = B.swaption(ids["a"], "RC-SWO")                     # bought, 1Y into 5Y payer, struck at 4 %
    net = _alone(client, auth_a, so, empty_cp)
    tk = _ticket(client, auth_a, trade=so, valuation_date=net["asof"], cp_cds_bp=net["cp_cds_bp"], lgd=net["lgd"])
    assert tk["basis"]["valued_as"] == "SWAPTION"
    opt = tk["basis"]["options"][0]
    assert opt["kind"] == "PAYER SWAPTION" and opt["side"] == "LONG" and opt["vol_bp"] > 0 and opt["vol_source"]
    for k in FOUR:
        assert tk["xva"][k] == pytest.approx(net["incremental"][k], rel=2e-3, abs=1.0), (k, tk["xva"][k], net["incremental"][k])
    # a bought option is never worth less than nothing: nothing is owed by us until it is exercised
    assert min(tk["ene"][:10]) > -0.5 and max(tk["ee"][:10]) > 0
    assert tk["ene"][30] < 0, "after expiry it is a swap where it was exercised, and a swap can be owed"
    # what it was: the same request without the trade is a swap of expiry plus tenor at the strike, and says so
    old = _ticket(client, auth_a, notional=10_000_000, maturity_y=6.0, fixed_rate=0.04, direction="PAY",
                  instrument_type="IR_SWAPTION", swaption_expiry_y=1.0, swaption_tenor_y=5.0, swaption_vol_bp=86.5, swaption_is_payer=True)
    assert old["basis"]["kind"] == "GENERIC_SWAP" and "generic swap" in old["basis"]["note"]
    # a swap is owed as often as it is owing; the option was not: the old figures carried a DVA several times too large
    assert old["xva"]["dva"] > 3 * tk["xva"]["dva"] and abs(old["xva"]["cva"]) > 1.1 * abs(tk["xva"]["cva"])


def test_a_cap_is_refused_in_words_and_a_margined_run_takes_the_coupons_out(client, auth_a, ids):
    _free()
    r = client.post("/api/xva/simulate", json={"paths": 500, "trade": B.cap(ids["a"], "RC-CAP")}, headers=auth_a)
    assert r.status_code == 422 and "XVA is not available for this trade yet: a cap is not valued on the exposure paths" in r.text
    # a refusal is in the engine's words, never the sender's: an instrument it does not know is not named back
    odd = dict(B.cap(ids["a"], "RC-ODD"), instrument_type="<b>x</b>")
    _free()
    r = client.post("/api/xva/simulate", json={"paths": 500, "trade": odd}, headers=auth_a)
    assert r.status_code == 422 and "<b>" not in r.text
    # a currency trade is not this run's
    _free()
    r = client.post("/api/xva/simulate", json={"paths": 500, "trade": {"instrument_type": "FX_FORWARD", "notional": 1e6, "notional_ccy": "EUR",
                                                                        "maturity_date": "2027-06-01", "terms": {"pair": "EURUSD"}}}, headers=auth_a)
    assert r.status_code == 422, r.text[:200]
    # what a trade body may cost is bounded before anything is valued: legs, dates, size
    many = B.swap(ids["a"], "RC-MANY")
    many["legs"] = many["legs"] * 20
    far = B.swap(ids["a"], "RC-FAR")
    far["maturity_date"] = "9999-12-31"
    import time
    for bad, word in ((many, "legs"), (far, "years of today")):
        for route, body in (("/api/xva/simulate", {"paths": 500, "trade": bad}), ("/api/xva/incremental", {"trade": bad, "n_paths": 300})):
            _free()
            t0 = time.time()
            r = client.post(route, json=body, headers=auth_a)
            assert r.status_code == 422 and word in r.text and time.time() - t0 < 1.0, (route, word, r.status_code, r.text[:160])
    # what one run may cost is bounded: a very long trade at many paths is told how many fit
    long = B.swap(ids["a"], "RC-LONG")
    for part in (long, *long["legs"]):
        part["maturity_date"] = "2076-11-04"
    _free()
    r = client.post("/api/xva/simulate", json={"paths": 10000, "trade": long}, headers=auth_a)
    assert r.status_code == 422 and "paths fit" in r.text, r.text[:200]
    sw = B.swap(ids["a"], "RC-SWAP-M")
    open_ = _ticket(client, auth_a, trade=sw)
    vm = _ticket(client, auth_a, trade=sw, csa={"preset": "BILATERAL", "threshold_cp": 0, "mta": 0, "im_exchanged": False})
    # a margined swaption: after exercise its swap's coupons are payments on the paths where it was exercised, taken
    # out of the margin period's bridge like a swap's
    so = B.swaption(ids["a"], "RC-SWO-M")
    so_open = _ticket(client, auth_a, trade=so)
    so_vm = _ticket(client, auth_a, trade=so, csa={"preset": "BILATERAL", "threshold_cp": 0, "mta": 0, "im_exchanged": False})
    assert so_vm["basis"]["options"][0]["vol_used_bp"] > 0, "the vol the option was valued at on the paths, beside the market's"
    assert max(so_vm["ee"][-8:]) < 0.2 * max(so_open["ee"][-8:]), (max(so_vm["ee"][-8:]), max(so_open["ee"][-8:]))
    # daily margin with a ten-day margin period leaves the move of ten days, not of years
    assert abs(vm["xva"]["cva"]) < 0.3 * abs(open_["xva"]["cva"]) and vm["csa"]["collateralised"] is True
    # the last months hold the last yearly coupon and nothing else to move: with the coupon taken out of the margin
    # period's bridge the margined exposure there is a small part of the open one
    assert max(vm["ee"][-6:]) < 0.15 * max(open_["ee"][-6:])
