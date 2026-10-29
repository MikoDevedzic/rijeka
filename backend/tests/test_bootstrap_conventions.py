"""The bootstrap applies each currency's quoting conventions when a quote carries none:
SOFR/€STR/SARON OIS are ACT/360, SONIA/TONA ACT/365F. A market whose overnight rate is
flat must come back flat, in both conventions."""
import math
from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

from pricing import bootstrap as bs

VAL = date(2026, 10, 29)


def _flat_market(rate: float, basis: int, spot_lag_days: int):
    """Par OIS quotes implied by a flat overnight rate compounded daily on `basis`, annual pay."""
    spot = VAL + timedelta(days=spot_lag_days)
    df = lambda d: (1 + rate / basis) ** (-(d - VAL).days)
    def par(months):
        mat = spot + relativedelta(months=months); ends = []; cur = mat
        while cur - relativedelta(years=1) > spot:
            ends.append(cur); cur -= relativedelta(years=1)
        ends.append(cur); ends = sorted(ends); starts = [spot] + ends[:-1]
        return (df(spot) - df(mat)) / sum(((e - s).days / basis) * df(e) for s, e in zip(starts, ends))
    return [{"tenor": "ON", "quote_type": "DEPOSIT", "rate": rate}] + [
        {"tenor": t, "quote_type": "OIS_SWAP", "rate": par(m)} for t, m in (("1M", 1), ("3M", 3), ("6M", 6), ("1Y", 12), ("2Y", 24), ("3Y", 36), ("5Y", 60))]


def _cc_forwards(curve, basis):
    pil = sorted(curve._df_pillars)
    return [(math.log(f0) - math.log(f1)) / ((d1 - d0).days / basis) for (d0, f0), (d1, f1) in zip(pil, pil[1:])]


def test_usd_ois_is_act_360_and_a_flat_market_bootstraps_flat():
    q = [{**x, "currency": "USD"} for x in _flat_market(0.04, 360, 4)]       # Thu 29 Oct -> spot Mon 2 Nov
    fw = _cc_forwards(bs.bootstrap_from_dicts(VAL, q), 360)
    target = 360 * math.log(1 + 0.04 / 360)                                   # continuous equivalent of 4 % daily ACT/360
    assert all(abs(f - target) < 2e-5 for f in fw[2:]), fw                   # within 0.2 bp beyond the deposit stub


def test_gbp_ois_is_act_365_and_a_flat_market_bootstraps_flat():
    q = [{**x, "currency": "GBP"} for x in _flat_market(0.04, 365, 0)]       # SONIA: T+0
    fw = _cc_forwards(bs.bootstrap_from_dicts(VAL, q), 365)
    target = 365 * math.log(1 + 0.04 / 365)
    assert all(abs(f - target) < 2e-5 for f in fw[1:]), fw


def test_wrong_convention_would_be_visible():
    # The same USD market read as ACT/365F (the old default) is ~5.5 bp too low at 4 %: the bug this guards against.
    q = [{**x, "currency": "USD", "day_count": "ACT/365F"} for x in _flat_market(0.04, 360, 4) if x["quote_type"] != "DEPOSIT"]
    q.insert(0, {"tenor": "ON", "quote_type": "DEPOSIT", "rate": 0.04, "currency": "USD"})
    fw = _cc_forwards(bs.bootstrap_from_dicts(VAL, q), 360)
    assert fw[-1] < 360 * math.log(1 + 0.04 / 360) - 4e-4


def test_an_explicit_day_count_on_the_quote_wins():
    assert bs.CCY_OIS_DC["USD"] == "ACT/360" and bs.CCY_OIS_DC["GBP"] == "ACT/365F" and bs.CCY_OIS_DC["JPY"] == "ACT/365F"
    q = [{**x, "currency": "USD", "day_count": "ACT/365F"} for x in _flat_market(0.04, 365, 4)]
    fw = _cc_forwards(bs.bootstrap_from_dicts(VAL, q), 365)
    assert all(abs(f - 365 * math.log(1 + 0.04 / 365)) < 2e-5 for f in fw[2:])
