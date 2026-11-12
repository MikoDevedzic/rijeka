"""Fees on a trade (pricing/fees.py): what a fee is, what the fees are worth today, and what they do to the
exposure of a currency or digital-asset ticket (pricing/fx_xva.with_fees)."""
import math
from datetime import date

import numpy as np
import pytest

from pricing import fees as F
from pricing import fx_xva
from pricing.csa import CSA

TODAY = date(2026, 11, 12)
GOOD = {"type": "premium", "direction": "pay", "amount": "12500.5", "currency": "usd", "date": "2026-11-16"}


def test_a_fee_is_kept_in_one_shape():
    assert F.normalise([GOOD, {**GOOD, "type": "UPFRONT", "direction": "RECEIVE", "amount": 100, "date": date(2027, 1, 4), "note": "first of two"}]) == [
        {"type": "PREMIUM", "direction": "PAY", "amount": 12500.5, "currency": "USD", "date": "2026-11-16"},
        {"type": "UPFRONT", "direction": "RECEIVE", "amount": 100.0, "currency": "USD", "date": "2027-01-04", "note": "first of two"}]
    assert F.normalise(None) == [] and F.normalise([]) == []
    assert F.normalise([GOOD], "USD")[0]["currency"] == "USD"


@pytest.mark.parametrize("change, says", [
    ({"type": "TIP"}, "the type is one of"), ({"direction": "BOTH"}, "PAY or RECEIVE"), ({"amount": "abc"}, "the amount is a number"),
    ({"amount": 0}, "above zero"), ({"amount": -5}, "above zero"), ({"amount": float("inf")}, "above zero"), ({"currency": "$"}, "the currency is its code"),
    ({"date": "16/11/2026"}, "the date is a date"), ({"date": None}, "the date is a date"), ({"note": "<b>x</b>"}, "plain characters"), ({"note": "x" * 61}, "plain characters"),
])
def test_a_fee_that_is_not_one_is_refused_and_says_why(change, says):
    with pytest.raises(ValueError, match="fee 2: .*" + says):
        F.normalise([GOOD, {**GOOD, **change}])


def test_the_list_itself():
    with pytest.raises(ValueError, match="a list of fees"):
        F.normalise({"type": "PREMIUM"})
    with pytest.raises(ValueError, match="fee 1: a fee has"):
        F.normalise(["premium"])
    with pytest.raises(ValueError, match=f"at most {F.MAX_FEES}"):
        F.normalise([GOOD] * (F.MAX_FEES + 1))
    with pytest.raises(ValueError, match="in the trade's own currency \\(EUR\\), not USD"):
        F.normalise([GOOD], "EUR")


def test_what_the_fees_are_worth_today():
    fees = F.normalise([{**GOOD, "date": "2026-11-10"},                                   # before today: paid
                        {**GOOD, "date": "2026-11-12"},                                   # today: its whole amount
                        {**GOOD, "direction": "RECEIVE", "amount": 4000, "date": "2027-11-12"}])
    out = F.present_values(fees, TODAY, lambda d: math.exp(-0.04 * (d - TODAY).days / 365.0))
    paid, today, later = out["fees"]
    assert paid["paid"] and paid["pv"] == 0.0 and paid["df"] == 0.0
    assert not today["paid"] and today["df"] == 1.0 and today["pv"] == -12500.5
    assert later["pv"] == pytest.approx(4000 * math.exp(-0.04)) and later["df"] == pytest.approx(math.exp(-0.04))
    assert out["pv"] == pytest.approx(-12500.5 + 4000 * math.exp(-0.04)) and out["pay"] == -12500.5 and out["receive"] == pytest.approx(later["pv"])
    assert F.in_years(fees, TODAY) == [(0.0, -12500.5), (1.0, 4000.0)], "a fee already paid is not carried into a simulation"


def test_the_value_of_the_fees_still_to_come():
    cash = [(0.25, -100.0), (0.50, 40.0)]
    v = F.value_at(cash, [0.0, 0.1, 0.25, 0.3, 0.5, 0.7], 0.04)
    e = math.exp
    assert v == pytest.approx([-100 * e(-0.04 * 0.25) + 40 * e(-0.04 * 0.5), -100 * e(-0.04 * 0.15) + 40 * e(-0.04 * 0.4),
                               40 * e(-0.04 * 0.25), 40 * e(-0.04 * 0.2), 0.0, 0.0]), "a fee dated at a time or before it is paid"
    assert F.value_at([], [0.0, 1.0], 0.04) == pytest.approx([0.0, 0.0])


# ── on a ticket's XVA ────────────────────────────────────────────────────────────────────────────────────────

Q = 0.038


def _fwd(strike=108465.61, t=0.5, pair="EURUSD", vol=9.0, n=10_000_000.0, f=1.0850, direction="BUY"):
    return fx_xva.ForwardXvaInput(pair=pair, base_notional=n, forward=f, strike=strike if pair != "EURUSD" else f if strike == 108465.61 else strike,
                                  t_years=t, df_quote_t=math.exp(-Q * t), quote_zero=Q, direction=direction, vol_pct=vol)


@pytest.mark.parametrize("preset", ["UNCOLLATERALISED", "BILATERAL"])
def test_no_fees_changes_nothing(preset):
    csa = CSA.uncollateralised() if preset == "UNCOLLATERALISED" else CSA.from_request({"preset": preset})
    a, ma = fx_xva.forward_xva(_fwd(), csa, n_paths=2000)
    for none in (None, []):
        b, mb = fx_xva.forward_xva(_fwd(), csa, n_paths=2000, fees=none)
        assert (a.cva, a.dva, a.fva, a.kva, a.mva) == (b.cva, b.dva, b.fva, b.kva, b.mva) and np.array_equal(ma["_paths"], mb["_paths"]) and mb["fees"] is None


@pytest.mark.parametrize("preset", ["UNCOLLATERALISED", "BILATERAL"])
def test_a_fee_received_at_settlement_is_the_same_forward_struck_lower(preset):
    """Bought N at K with a fee A received at settlement pays N(F − K) + A = N(F − (K − A/N)): the two tickets are
    one trade, so their paths, today's value, margin and every XVA are the same. (The fee is dated a moment after
    the last grid date, where a fee dated on it would count as paid.)"""
    csa = CSA.uncollateralised() if preset == "UNCOLLATERALISED" else CSA.from_request({"preset": preset})
    t, n, a = 0.5, 10_000_000.0, 60_000.0
    with_fee, m1 = fx_xva.forward_xva(_fwd(t=t), csa, n_paths=4000, fees=[(t + 1e-7, a)])
    lower, m2 = fx_xva.forward_xva(_fwd(strike=1.0850 - a / n, t=t), csa, n_paths=4000)
    assert np.allclose(m1["_paths"], m2["_paths"], rtol=1e-9, atol=1e-3) and m1["v0"] == pytest.approx(m2["v0"], rel=1e-7)      # the moment after settlement is 1e-7 of a year of discounting
    for k in ("cva", "dva", "fva", "fba", "kva", "mva"):
        assert getattr(with_fee, k) == pytest.approx(getattr(lower, k), rel=1e-6, abs=1e-6), k
    assert with_fee.im_profile == pytest.approx(lower.im_profile, rel=1e-6)
    assert m1["fees"]["count"] == 1 and m1["fees"]["pv"] == pytest.approx(a * math.exp(-Q * t), rel=1e-6)


def test_a_fee_we_are_owed_is_exposure_until_it_is_paid_and_one_we_owe_is_the_counterpartys():
    csa = CSA.uncollateralised()
    base, _ = fx_xva.forward_xva(_fwd(), csa, n_paths=4000)
    owed, mo = fx_xva.forward_xva(_fwd(), csa, n_paths=4000, fees=[(0.26, 80_000.0)])       # received in three months
    owe, _ = fx_xva.forward_xva(_fwd(), csa, n_paths=4000, fees=[(0.26, -80_000.0)])       # paid in three months
    grid = np.arange(1, 7) * (0.5 / 6)
    before = grid < 0.26
    assert np.all(np.array(owed.ee)[before] > np.array(base.ee)[before]) and np.array(owed.ee)[~before] == pytest.approx(np.array(base.ee)[~before])
    assert np.all(np.abs(np.array(owe.ene))[before] > np.abs(np.array(base.ene))[before]) and np.array(owe.ene)[~before] == pytest.approx(np.array(base.ene)[~before])
    assert abs(owed.cva) > abs(base.cva) and abs(owe.cva) < abs(base.cva) and abs(owe.dva) > abs(base.dva)
    assert mo["fees"]["on_grid"][:3] == pytest.approx([80_000 * math.exp(-Q * (0.26 - g)) for g in grid[:3]]) and mo["fees"]["on_grid"][3:] == [0.0, 0.0, 0.0]


def test_a_known_payment_is_not_a_risk_so_the_margin_does_not_move():
    csa = CSA.from_request({"preset": "BILATERAL"})
    base, _ = fx_xva.forward_xva(_fwd(), csa, n_paths=4000)
    fee, _ = fx_xva.forward_xva(_fwd(), csa, n_paths=4000, fees=[(0.26, 80_000.0), (0.40, -15_000.0)])
    assert fee.im_profile == pytest.approx(base.im_profile, rel=1e-9), "initial margin is the move about its mean: a scheduled payment is the mean's"
    assert fee.mva == pytest.approx(base.mva, rel=1e-9)


def test_an_option_and_a_package_carry_their_fees_too():
    from pricing.fx_exotic import ExoticSpec
    t = 0.5
    opt = fx_xva.OptionXvaInput(pair="EURUSD", base_notional=10_000_000.0, spot=1.0840, forward=1.0850, t_expiry=t, t_settle=t, df_quote_t=math.exp(-Q * t),
                                quote_zero=Q, vol=0.09, spec=ExoticSpec("EUROPEAN", "CALL", strike=1.09), direction="BUY")
    csa = CSA.uncollateralised()
    # a premium we still owe in two months: until it is paid our exposure to the counterparty is the option's value less it
    plain, mp = fx_xva.option_xva(opt, csa, n_paths=3000)
    owing, mf = fx_xva.option_xva(opt, csa, n_paths=3000, fees=[(2 / 12 + 0.01, -150_000.0)])
    assert mf["v0"] == pytest.approx(mp["v0"] - 150_000 * math.exp(-Q * (2 / 12 + 0.01)), rel=1e-9)
    assert owing.ee[0] < plain.ee[0] and owing.ee[-1] == pytest.approx(plain.ee[-1]) and abs(owing.cva) < abs(plain.cva)
    pkg, mk = fx_xva.package_xva([_fwd(), opt], csa, n_paths=3000, fees=[(2 / 12 + 0.01, -150_000.0)])
    pkg0, mk0 = fx_xva.package_xva([_fwd(), opt], csa, n_paths=3000)
    assert mk["fees"]["count"] == 1 and mk["v0"] == pytest.approx(mk0["v0"] - 150_000 * math.exp(-Q * (2 / 12 + 0.01)), rel=1e-9) and abs(pkg.cva) < abs(pkg0.cva)
