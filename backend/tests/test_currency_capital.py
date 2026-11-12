"""The capital add-on of a currency or digital-asset ticket is SA-CCR's for its asset class (pricing/fx_xva.py
capital_inputs, saccr_rows), by the Basel text:

  CRE52.72   foreign exchange: supervisory factor 4 %
  SCO60.98   a Group 2a cryptoasset: SA-CCR with a "crypto" class in the structure of the FX class, a hedging set per
             pair, supervisory factor 32 %, supervisory option volatility 120 %
  SCO60.99   a Group 2b cryptoasset: exposure = α × (RC + PFE), PFE = 50 % of the gross notional per transaction,
             no hedging set

Each figure below is worked by hand from those paragraphs."""
import math

import numpy as np
import pytest

from pricing import fx_xva
from pricing.csa import CSA
from pricing.fx_exotic import ExoticSpec
from pricing.sa_ccr import supervisory_delta

pytestmark = pytest.mark.usefixtures("monthly_steps")     # monthly steps, as these figures were worked (tests/conftest.py)


def _fwd(pair="BTCUSD", direction="BUY", t=0.5, n=10.0, F=100_000.0, spot=98_000.0, K=None):
    return fx_xva.ForwardXvaInput(pair=pair, base_notional=n, forward=F, strike=K if K is not None else F, t_years=t, df_quote_t=math.exp(-0.04 * t),
                                  quote_zero=0.04, direction=direction, vol_pct=55.0 if pair != "EURUSD" else 8.0, spot01=n * F * 0.01, spot=spot)


def _opt(option_type="CALL", direction="BUY", strike=100_000.0, style="EUROPEAN", t=0.5, pair="BTCUSD", **kw):
    spec = ExoticSpec("TOUCH", "CALL", payout=250_000.0, touch_type="ONE_TOUCH", barrier=120_000.0) if style == "TOUCH" else ExoticSpec(style, option_type, strike=strike, **kw)
    return fx_xva.OptionXvaInput(pair=pair, base_notional=10.0, spot=98_000.0, forward=100_000.0, t_expiry=t - 0.02, t_settle=t, df_quote_t=math.exp(-0.04 * t),
                                 quote_zero=0.04, vol=0.55, spec=spec, direction=direction, spot01=5000.0)


def test_the_group_of_a_digital_asset_is_the_desks_or_the_default_and_a_pair_has_none():
    assert fx_xva.crypto_group_of("BTCUSD") == "2a" and fx_xva.crypto_group_of("ETHUSD") == "2a" and fx_xva.crypto_group_of("SOLUSD") == "2b"
    assert fx_xva.crypto_group_of("SOLUSD", "2a") == "2a" and fx_xva.crypto_group_of("BTCUSD", "Group 2B") == "2b"
    assert fx_xva.crypto_group_of("EURUSD") is None and fx_xva.crypto_group_of("USDJPY", "2b") is None
    with pytest.raises(ValueError):
        fx_xva.crypto_group_of("BTCUSD", "1a")


def test_rows_are_the_legs_in_their_class_at_their_supervisory_delta():
    rows = fx_xva.saccr_rows([_fwd(), _fwd(direction="SELL", t=0.25), _opt("PUT", "BUY", 90_000.0), _opt(style="TOUCH", direction="SELL")])
    assert [r.asset_class for r in rows] == ["CRYPTO"] * 4 and {r.hedging_set for r in rows} == {"BTCUSD"}
    assert rows[0].notional == pytest.approx(10 * 98_000.0) and rows[0].delta == 1.0 and rows[1].delta == -1.0, "the notional in fiat at spot (SCO60.98 (4))"
    assert rows[0].maturity_y == 0.5 and rows[1].maturity_y == 0.25
    # a bought put: the Black delta of a put at the class's 120 % supervisory volatility (CRE52.40), negative
    assert rows[2].delta == pytest.approx(supervisory_delta("PUT", True, 98_000.0, 90_000.0, 0.48, 1.20)) and -1 < rows[2].delta < 0
    # a touch has no strike: ±1; its size is its payout
    assert rows[3].delta == -1.0 and rows[3].notional == 250_000.0
    fx = fx_xva.saccr_rows([_fwd("EURUSD", n=1e7, F=1.17, spot=1.165)])
    assert fx[0].asset_class == "FX" and fx[0].notional == pytest.approx(1e7 * 1.165)


def test_group_2a_is_the_crypto_class_at_32_percent():
    """One bought 6M forward, uncollateralised. Over the first monthly step five and a half months are left (the
    remaining life is read at the middle of a step, 0.27.0): the add-on is 32 % × the notional in fiat ×
    sqrt(5.5/12) (the unmargined maturity factor, CRE52.48)."""
    wf, meta = fx_xva.forward_xva(_fwd(), CSA.uncollateralised(), n_paths=500)
    assert wf.addon_0 == pytest.approx(0.32 * 10 * 98_000.0 * math.sqrt(5.5 / 12), rel=1e-9)
    assert meta["crypto_group"] == "2a" and "32 %" in meta["capital_basis"] and "SCO60.98" in meta["capital_basis"]
    # whose choice the group was is in the words: the default is the engine's reading, and says what the rule requires
    assert "the engine's default for BTC" in meta["capital_basis"] and "SCO60.55" in meta["capital_basis"] and "Group 2b unless" in meta["capital_basis"]
    _, chosen = fx_xva.forward_xva(_fwd(), CSA.uncollateralised(), n_paths=300, crypto_group="2a")
    assert "set by the desk" in chosen["capital_basis"] and "default" not in chosen["capital_basis"]
    _, sol = fx_xva.forward_xva(_fwd("SOLUSD", n=1000.0, F=200.0, spot=195.0), CSA.uncollateralised(), n_paths=300)
    assert "the engine's default for SOL" in sol["capital_basis"]
    _, eur = fx_xva.forward_xva(_fwd("EURUSD", n=1e7, F=1.17, spot=1.165), CSA.uncollateralised(), n_paths=300)
    assert "default" not in eur["capital_basis"] and "desk" not in eur["capital_basis"]
    # and the charge is no longer a rounding: 8 % × the risk weight × EAD at the hurdle, over the life
    assert wf.kva < -100


def test_group_2b_is_half_the_gross_notional_per_trade_with_no_netting_and_no_multiplier():
    buy, sell = _fwd("SOLUSD", n=1000.0, F=200.0, spot=195.0), _fwd("SOLUSD", direction="SELL", n=1000.0, F=200.0, spot=195.0)
    wf, meta = fx_xva.package_xva([buy, sell], CSA.uncollateralised(), n_paths=500)
    assert meta["crypto_group"] == "2b" and "SCO60.99" in meta["capital_basis"]
    # the two cancel on every path, so RC is nothing; the PFE is 50 % of EACH trade's notional, not of the net
    assert wf.addon_0 == pytest.approx(0.5 * 1000.0 * 195.0 * 2) and wf.multiplier_0 == 1.0
    assert wf.ead_0 == pytest.approx(1.4 * 0.5 * 1000.0 * 195.0 * 2), "α × (RC + PFE), RC = 0"
    assert wf.kva < 0
    # the same two legs of a Group 2a asset net inside the hedging set
    a, b = _fwd(), _fwd(direction="SELL")
    two_a, _ = fx_xva.package_xva([a, b], CSA.uncollateralised(), n_paths=500)
    assert two_a.addon_0 == 0.0 and two_a.kva == 0.0
    # and the desk can put BTC in 2b, or SOL in 2a
    as_2b, m = fx_xva.forward_xva(_fwd(), CSA.uncollateralised(), n_paths=500, crypto_group="2b")
    assert m["crypto_group"] == "2b" and as_2b.addon_0 == pytest.approx(0.5 * 10 * 98_000.0)
    sol_2a, m = fx_xva.forward_xva(buy, CSA.uncollateralised(), n_paths=500, crypto_group="2a")
    assert m["crypto_group"] == "2a" and sol_2a.addon_0 == pytest.approx(0.32 * 1000.0 * 195.0 * math.sqrt(5.5 / 12), rel=1e-9)


def test_a_group_2b_leg_stops_counting_when_it_settles():
    near, far = _fwd("SOLUSD", t=0.25, n=1000.0, F=200.0, spot=195.0), _fwd("SOLUSD", t=0.5, n=1000.0, F=200.0, spot=195.0)
    cap = fx_xva.capital_inputs([near, far], CSA.uncollateralised(), 6, 0.5 / 6, "sa_ccr", None)
    grid = cap["kwargs"]["addon_profiles"][0]
    one = 0.5 * 1000.0 * 195.0
    # a leg counts over every step it is alive through, the one that ends on its settlement included (0.27.0: until then
    # that step was not charged, and the last step of the set carried nothing)
    assert grid[:3] == pytest.approx([2 * one] * 3) and grid[3:] == pytest.approx([one] * 3)
    assert cap["kwargs"]["apply_multiplier"] is False


def test_a_currency_pair_is_the_fx_class_at_4_percent():
    inp = _fwd("EURUSD", n=1e7, F=1.17, spot=1.165, t=1.0)
    wf, meta = fx_xva.forward_xva(inp, CSA.uncollateralised(), n_paths=500)
    assert wf.addon_0 == pytest.approx(0.04 * 1e7 * 1.165 * math.sqrt(11.5 / 12), rel=1e-9)
    assert "CRE52.72" in meta["capital_basis"] and meta["crypto_group"] is None


def test_an_option_enters_at_its_delta_and_a_margined_set_takes_the_margined_factor():
    put = _opt("PUT", "BUY", 90_000.0)
    wf, _ = fx_xva.option_xva(put, CSA.uncollateralised(), n_paths=400)
    d = supervisory_delta("PUT", True, 98_000.0, 90_000.0, 0.48, 1.20)
    m_left = 0.5 - 0.25 / 6                       # the middle of the first of six steps
    assert wf.addon_0 == pytest.approx(0.32 * abs(d) * 10 * 98_000.0 * math.sqrt(m_left), rel=1e-9)
    csa = CSA.bilateral()
    wfm, _ = fx_xva.forward_xva(_fwd(), csa, n_paths=400)
    assert wfm.addon_0 == pytest.approx(0.32 * 10 * 98_000.0 * 1.5 * math.sqrt(10 / 250), rel=1e-9), "CRE52.52: 1.5 × sqrt(MPoR / 250)"


def test_the_other_capital_models_are_as_they_were():
    inp = _fwd()
    cem, m = fx_xva.forward_xva(inp, CSA.uncollateralised(), n_paths=400, capital_model="cem")
    imm, m2 = fx_xva.forward_xva(inp, CSA.uncollateralised(), n_paths=400, capital_model="imm")
    assert "CEM" in m["capital_basis"] and "internal model" in m2["capital_basis"]
    assert cem.kva < 0 and imm.kva < 0 and imm.ead_0 == pytest.approx(1.4 * imm.ee[0])
    assert np.isfinite([cem.kva, imm.kva]).all()


# ── the whole life is charged, on any grid (0.27.0) ────────────────────────

def _on_grid(monkeypatch, per_year):
    monkeypatch.setattr(fx_xva, "exposure_grid", lambda ty, _=None: (max(2, int(math.ceil(ty * per_year))), ty / max(2, int(math.ceil(ty * per_year)))))


def test_kva_charges_the_whole_life_of_a_short_trade():
    """A one-month forward is two monthly steps. Capital is held through both: by hand, a Group 2b asset's add-on
    alone (50 % of the notional, at α = 1.4, 8 % capital, the hurdle) over the whole month is a floor for KVA. Until
    0.27.0 the step that ends on the settlement was not charged and KVA was about half of this floor's month."""
    from pricing.xva_engine import ALPHA, CAP_R
    t = 1.0 / 12
    wf, meta = fx_xva.forward_xva(_fwd("SOLUSD", t=t, n=1000.0, F=200.0, spot=195.0), CSA.uncollateralised(), n_paths=1000, hurdle_rate=0.12)
    assert meta["steps"] == 2 and meta["crypto_group"] == "2b"
    # dealt at the fair forward the mean value is about nothing, so the replacement cost is too and KVA is the add-on's
    # integral: κ · 8 % · α · 0.5 N S · ∫ e^(−rt) dt over the month (Emmy's closed form, 12 Nov 2026: −109.02 against the
    # engine's −108.93 at 4,000 paths; the convention before 0.27.0 gave −54.51, half)
    closed = 0.12 * CAP_R * ALPHA * 0.5 * 1000.0 * 195.0 * (1.0 - math.exp(-0.04 * t)) / 0.04
    assert closed == pytest.approx(109.02, abs=0.005)
    assert -wf.kva == pytest.approx(closed, rel=0.01)
    # and MVA of a margin the desk sets is funded over both steps
    csa = CSA(preset="UNCOLLATERALISED", collateralised=False, im_exchanged=True, mpor_days=10.0)
    m, _ = fx_xva.forward_xva(_fwd("SOLUSD", t=t, n=1000.0, F=200.0, spot=195.0), csa, n_paths=1000, im_amount=10_000.0, ftp_bp=55.0)
    assert -m.mva == pytest.approx(10_000.0 * 0.0055 * (t / 2) * (math.exp(-0.04 * t / 2) + math.exp(-0.04 * t)), rel=1e-9)


@pytest.mark.parametrize("pair,kw", [("BTCUSD", {}), ("SOLUSD", dict(n=1000.0, F=200.0, spot=195.0)), ("EURUSD", dict(n=1e7, F=1.17, spot=1.165))])
@pytest.mark.parametrize("t", [1.0 / 12, 0.25, 1.0])
def test_kva_does_not_depend_on_the_grid(monkeypatch, pair, kw, t):
    """Uncollateralised, the same trade on monthly, weekly and daily steps: KVA agrees within ten per cent (each grid
    draws its own paths, and the replacement cost is read at each step's end). Before 0.27.0 the monthly figure of a
    one-month trade was 45 % of the daily one (the last of two steps uncharged)."""
    out = {}
    for per_year in (12, 52, 365):
        _on_grid(monkeypatch, per_year)
        out[per_year] = fx_xva.forward_xva(_fwd(pair, t=t, **kw), CSA.uncollateralised(), n_paths=2000)[0].kva
    assert out[12] == pytest.approx(out[365], rel=0.10) and out[52] == pytest.approx(out[365], rel=0.10), out
