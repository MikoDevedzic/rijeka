"""A currency NDF's fixing (0.39.0): priced to its fixing date, settled in the currency its record names, on the
fixing of the source it names. Every expected figure is worked here from the definition, not from the engine."""
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from pricing.curve import Curve
from pricing.currency_forward import price_currency_forward
from settlement import rule

# FIX is the date the fixed rate delivers on (the pricer's `settlement_date`): for a currency pair the spot date of the
# fixing date, which the routes work out (fixing_read_date, tested below); PAY is the date the amount is paid.
VAL, FIX, PAY = date(2026, 10, 28), date(2027, 1, 26), date(2027, 1, 28)
N, K, S = 1_000_000.0, 148.0, 150.0


def _c(r):
    return Curve(valuation_date=VAL, flat_rate=r)


def _fwd(**over):
    kw = dict(base_currency="USD", quote_currency="JPY", base_notional=N, forward_rate=K, spot=S, valuation_date=VAL,
              settlement_date=FIX, payment_date=PAY, quote_curve=_c(0.005), base_curve=_c(0.04), direction="BUY", pip=0.01)
    return price_currency_forward(**{**kw, **over})


def _ndf(**terms):
    t = {"currency_pair": "USDJPY", "base_notional": str(N), "forward_rate": str(K), "value_date": PAY.isoformat(), "direction": "BUY",
         "fixing_source": "WM/Reuters 4pm London", "fixing_date": FIX.isoformat(), "settlement_currency": "USD", **terms}
    return SimpleNamespace(instrument_type="NDF", terms=t, notional=N, maturity_date=PAY, trade_date=VAL)


# ── the pricer: an amount paid in the base currency ──────────────────────────

def test_an_ndf_paid_in_dollars_is_the_dollar_amount_discounted_on_the_dollar_curve_and_converted_at_spot():
    jpy, usd = _c(0.005), _c(0.04)
    r = _fwd(settle_in_base=True)
    F = S * usd.df(FIX) / jpy.df(FIX)                                   # the forward of the fixing date (no spot lag here)
    assert r.forward == pytest.approx(F, rel=1e-12)
    dollars = N * (1.0 - K / F)                                         # N·(F − K)/F, the amount the fixing would pay
    assert r.npv == pytest.approx(S * dollars * usd.df(PAY), rel=1e-12)   # its dollar value today, in yen at spot
    assert r.npv == pytest.approx(N * (F - K) * r.df_pay, rel=1e-12)      # and the one line every reader rebuilds
    assert r.df_pay == pytest.approx(jpy.df(FIX) * usd.df(PAY) / usd.df(FIX), rel=1e-12)


def test_paid_in_yen_it_is_carried_the_last_two_days_on_the_yen_curve_and_the_two_differ_by_that_carry():
    jpy, usd = _c(0.005), _c(0.04)
    yen, dollars = _fwd(), _fwd(settle_in_base=True)
    assert yen.df_pay == pytest.approx(jpy.df(PAY), rel=1e-12)
    assert dollars.npv / yen.npv == pytest.approx((usd.df(PAY) / usd.df(FIX)) / (jpy.df(PAY) / jpy.df(FIX)), rel=1e-12)
    assert abs(dollars.npv / yen.npv - 1.0) < 3e-4                     # two days of the rate difference: a few parts in 10,000
    assert _fwd(direction="SELL", settle_in_base=True).npv == pytest.approx(-dollars.npv, rel=1e-12)


def test_read_and_paid_on_one_date_the_settlement_currency_makes_no_difference():
    a = _fwd(payment_date=None)
    b = _fwd(payment_date=None, settle_in_base=True)
    c = _fwd(payment_date=FIX, settle_in_base=True)
    for f in ("npv", "ir01", "ir01_disc", "ir01_base", "spot01", "theta", "df_pay", "t_pay"):
        assert getattr(a, f) == getattr(b, f) == getattr(c, f), f


def test_its_sensitivities_are_the_repriced_differences():
    r = _fwd(settle_in_base=True)
    up = _fwd(settle_in_base=True, spot=S * 1.01)
    assert up.npv - r.npv == pytest.approx(r.spot01, rel=1e-9)                              # linear in spot
    base_up = _fwd(settle_in_base=True, base_curve=_c(0.0401))
    quote_up = _fwd(settle_in_base=True, quote_curve=_c(0.0051))
    assert base_up.npv - r.npv == pytest.approx(r.ir01_base, rel=2e-3)
    assert quote_up.npv - r.npv == pytest.approx(r.ir01_disc, rel=2e-3)
    assert r.ir01 == pytest.approx(r.ir01_base + r.ir01_disc, rel=1e-12)


def test_with_a_spot_lag_it_is_still_the_base_amount_on_the_base_curve_converted_at_spot():
    jpy, usd = _c(0.005), _c(0.04)
    sd = date(2026, 10, 30)                                             # the quoted spot delivers two days on
    for side, sign in (("BUY", 1.0), ("SELL", -1.0)):
        r = _fwd(settle_in_base=True, spot_date=sd, direction=side)
        F = S * (usd.df(FIX) / usd.df(sd)) / (jpy.df(FIX) / jpy.df(sd))
        assert r.forward == pytest.approx(F, rel=1e-12)
        # dollars paid on PAY, brought to the spot date on the dollar curve, converted at spot, discounted in yen to today
        assert r.npv == pytest.approx(sign * N * (1.0 - K / F) * (usd.df(PAY) / usd.df(sd)) * S * jpy.df(sd), rel=1e-12)


def test_on_the_eve_of_the_fixing_and_one_day_on_the_value_is_the_same_cash_flow():
    jpy, usd = _c(0.005), _c(0.04)
    eve = FIX - timedelta(days=1)
    kw = dict(valuation_date=eve, quote_curve=Curve(valuation_date=eve, flat_rate=0.005), base_curve=Curve(valuation_date=eve, flat_rate=0.04))
    r = _fwd(settle_in_base=True, **kw)
    assert r.npv == pytest.approx(N * (r.forward - K) * (jpy.df(FIX) / jpy.df(eve)) * (usd.df(PAY) / usd.df(FIX)), rel=1e-12)
    # theta is the value one day later at the same spot and curves: on the fixing date the forward is the spot
    assert r.npv + r.theta == pytest.approx(N * (S - K) * usd.df(PAY) / usd.df(FIX), rel=1e-12)
    # and well before the fixing it is the repriced difference
    far = _fwd(settle_in_base=True)
    d1 = VAL + timedelta(days=1)
    later = _fwd(settle_in_base=True, valuation_date=d1, quote_curve=Curve(valuation_date=d1, flat_rate=0.005), base_curve=Curve(valuation_date=d1, flat_rate=0.04))
    assert far.theta == pytest.approx(later.npv - far.npv, rel=1e-9)


# ── the date the fixed rate delivers on ──────────────────────────────────────

def test_a_currency_fixing_is_the_spot_rate_for_delivery_on_its_spot_date_and_a_digital_assets_delivers_at_once():
    from api.routes.currencies import fixing_read_date, ndf_fixing_date, spot_date
    settle = date(2027, 1, 29)                                          # a Friday
    fix = ndf_fixing_date(settle, "EUR", "USD")                         # Wednesday 27 January
    assert fixing_read_date(fix, settle, False, "EUR", "USD") == settle           # the usual fixing date: the forward is the deliverable one
    early = date(2026, 12, 29)                                          # a record that fixes a month before it settles
    assert fixing_read_date(early, settle, False, "EUR", "USD") == spot_date(early, False, "EUR", "USD") == date(2026, 12, 31)
    assert fixing_read_date(date(2027, 1, 28), settle, False, "EUR", "USD") == settle   # never after the settlement date
    assert fixing_read_date(early, settle, True, "BTC", "USD") == early                # a digital asset: the fixing date itself


# ── the rule: terms, dates, amounts ──────────────────────────────────────────

def test_the_rule_reads_an_ndf_from_its_record():
    k = rule.parse(_ndf())
    assert (k["pair"], k["shape"], k["notional"], k["strike"], k["settle"], k["fixing_date"]) == ("USDJPY", "FORWARD", N, K, PAY, FIX)
    assert k["source"] == "WM/Reuters 4pm London" and k["settle_in_base"] is True and k["amount_currency"] == "USD"
    assert rule.parse(_ndf(settlement_currency="JPY"))["settle_in_base"] is False
    # tickets before 0.39.0 wrote USD on every pair and the settlement date as the fixing date. The record decides:
    # an older USDJPY settles in dollars, its base currency; an older EURUSD in dollars, its quote currency; an
    # older cross, which names neither of its two, in its quote currency
    older = dict(settlement_currency="USD", fixing_date=PAY.isoformat())
    assert rule.parse(_ndf(**older))["amount_currency"] == "USD" and rule.parse(_ndf(**older))["settle_in_base"] is True
    assert rule.parse(_ndf(currency_pair="EURUSD", **older))["settle_in_base"] is False
    old = rule.parse(_ndf(currency_pair="EURGBP", **older))
    assert old["settle_in_base"] is False and old["amount_currency"] == "GBP" and old["fixing_date"] == PAY
    # no fixing date, or one after the settlement date: it fixes on its settlement date, as every NDF did before
    assert rule.parse(_ndf(fixing_date=None))["fixing_date"] == PAY
    assert rule.parse(_ndf(fixing_date=(PAY + timedelta(days=1)).isoformat()))["fixing_date"] == PAY
    assert rule.parse(_ndf(fixing_source=None))["source"] == ""
    assert rule.terms_of(SimpleNamespace(instrument_type="FX_FORWARD", terms={}, notional=1, maturity_date=PAY)) is None


def test_the_amount_is_in_the_currency_the_record_settles_in():
    assert rule.forward_amount("BUY", N, K, 152.0) == pytest.approx(4_000_000.0)                       # yen: N·(fixing − K)
    assert rule.forward_amount("BUY", N, K, 152.0, in_base=True) == pytest.approx(4_000_000.0 / 152.0)  # dollars: the same at the fixing
    assert rule.forward_amount("SELL", N, K, 152.0, in_base=True) == pytest.approx(-26_315.789473684, rel=1e-12)
    assert rule.forward_amount("BUY", N, K, 144.0, in_base=True) == pytest.approx(-4_000_000.0 / 144.0)


def test_before_the_fixing_date_nothing_and_from_it_the_fixing_or_the_spot_marked_provisional():
    t = _ndf()
    assert rule.settlement(None, "u", t, FIX - timedelta(days=1), spot=151.0) is None
    prov = rule.settlement(None, "u", t, FIX, spot=151.0)                  # no store, no stored spot: the caller's spot, provisional
    assert prov["provisional"] and prov["provisional_reason"] == rule.NO_FIXING and prov["price"] == 151.0
    assert prov["settlement_amount"] == pytest.approx(N * 3.0 / 151.0) and prov["amount_currency"] == "USD"
    row = {"source": "WM/Reuters 4pm London", "date": FIX.isoformat(), "time": "16:00 London", "value": 152.0, "origin": "MANUAL"}
    cache = {f"fixing:USDJPY:{FIX}:WM/Reuters 4pm London": row}
    fixed = rule.settlement(None, "u", t, PAY, spot=160.0, cache=cache)    # the stored fixing, whatever spot does afterwards
    assert not fixed["provisional"] and fixed["price"] == 152.0 and fixed["settlement_amount"] == pytest.approx(4_000_000.0 / 152.0)
    rep = rule.report(fixed)
    assert rep["settlement_currency"] == "USD" and rep["fixing_date"] == FIX.isoformat() and rep["fixing_source"] == "WM/Reuters 4pm London"
    yen = rule.report(rule.settlement(None, "u", _ndf(settlement_currency="JPY"), PAY, cache=cache))
    assert yen["settlement_amount"] == pytest.approx(4_000_000.0) and yen["settlement_currency"] == "JPY"


# ── the fixing date a ticket starts on ───────────────────────────────────────

def test_the_default_fixing_date_is_the_business_day_whose_spot_date_is_the_settlement_date():
    from api.routes.currencies import ndf_fixing_date, spot_date
    from pricing.calendars import ccy_to_calendar, is_business_day, joint
    assert ndf_fixing_date(date(2027, 1, 29), "EUR", "USD") == date(2027, 1, 27)        # Friday: two business days before
    assert ndf_fixing_date(date(2027, 2, 1), "EUR", "USD") == date(2027, 1, 28)         # Monday: Thursday, over the weekend
    assert ndf_fixing_date(date(2027, 1, 29), "USD", "CAD") == date(2027, 1, 28)        # USDCAD spot is T+1
    for base, quote in (("EUR", "USD"), ("USD", "JPY"), ("USD", "CAD"), ("EUR", "GBP")):
        both = joint(ccy_to_calendar(base), ccy_to_calendar(quote))
        s = date(2026, 12, 1)
        while s < date(2027, 3, 1):
            if is_business_day(s, both):
                d = ndf_fixing_date(s, base, quote)
                assert d < s and is_business_day(d, both) and spot_date(d, False, base, quote) <= s, (base, quote, s, d)
                later = d + timedelta(days=1)                # no later business day still spots on or before the settlement date
                while later < s:
                    assert not (is_business_day(later, both) and spot_date(later, False, base, quote) <= s), (base, quote, s, later)
                    later += timedelta(days=1)
            s += timedelta(days=1)
