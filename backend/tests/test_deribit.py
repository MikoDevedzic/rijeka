"""market_data/deribit.py: a venue's option chain to the pricer's ATM / RR25 / BF25 surface and forward points.

The chains here are built, not recorded: marks are generated from a known smile per expiry (the same Malz
quadratic in forward delta the pricer uses), so the test knows the answer the builder must recover and the
repository carries none of the venue's data."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from statistics import NormalDist
from unittest.mock import patch

import pytest

from market_data import deribit as D
from pricing.fx_vol import parse_surface, smile_vol, vol_at

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
STAMP = int(NOW.timestamp() * 1000) - 4000
INDEX = 74_800.0
# code, forward, ATM, RR25, BF25 (decimals): put skew that flattens with maturity, as the market of November 2026
PILLARS = [("10NOV26", 74_802.0, 0.46, -0.060, 0.012), ("13NOV26", 74_810.0, 0.434, -0.058, 0.015), ("20NOV26", 74_895.0, 0.398, -0.053, 0.015),
           ("27NOV26", 75_000.0, 0.385, -0.049, 0.015), ("25DEC26", 75_290.0, 0.385, -0.034, 0.012), ("26MAR27", 76_340.0, 0.394, -0.028, 0.012),
           ("24SEP27", 78_510.0, 0.403, -0.020, 0.011)]


def chain(pillars=PILLARS, prefix="BTC", base="BTC", index=INDEX, deltas=None, oi=10.0, now=NOW) -> list[dict]:
    """A chain whose mark at every strike is the smile's vol at that strike's forward call delta."""
    rows = []
    deltas = deltas or [i / 50 for i in range(2, 49)]            # 0.04 … 0.96
    for code, fwd, atm, rr, bf in pillars:
        t = (D.parse_expiry(code) - now).total_seconds() / 86400 / 365
        for d in deltas:
            v = smile_vol(atm, rr, bf, d)
            k = fwd * math.exp(-NormalDist().inv_cdf(d) * v * math.sqrt(max(t, 1e-9)) + 0.5 * v * v * t)
            for cp in "CP":
                rows.append({"instrument_name": f"{prefix}-{code}-{k:.6f}-{cp}", "mark_iv": round(v * 100, 4), "underlying_price": fwd,
                             "open_interest": oi, "creation_timestamp": STAMP, "estimated_delivery_price": index, "base_currency": base})
    return rows


def grid(quotes) -> dict:
    g: dict = {}
    for q in quotes:
        g.setdefault(q["tenor"], {})[q["quote_type"]] = q["rate"]
    return g


def test_expiry_marks_are_read_at_the_three_deltas_the_smile_is_quoted_at():
    b = D.build(chain(), "BTC", NOW)
    assert b["dropped"] == {"10NOV26": "inside two days"}
    by = {e["code"]: e for e in b["expiries"]}
    for code, fwd, atm, rr, bf in PILLARS[1:]:
        e = by[code]
        assert e["forward"] == pytest.approx(fwd)
        assert e["atm"] == pytest.approx(atm * 100, abs=0.02) and e["rr25"] == pytest.approx(rr * 100, abs=0.02) and e["bf25"] == pytest.approx(bf * 100, abs=0.02)
    assert b["asof"] == datetime.fromtimestamp(STAMP / 1000, tz=timezone.utc) and b["index"] == INDEX and b["last_expiry"] == "24SEP27"


def test_surface_interpolates_in_variance_and_time_and_is_flat_beyond_the_last_expiry():
    b = D.build(chain(), "BTC", NOW)
    g = grid(b["vol"])
    assert list(g) == list(D.VOL_TENORS) and all(set(row) == {"ATM", "RR25", "BF25"} for row in g.values())
    # 1W sits between the 13 and 20 November expiries: total variance is linear between them
    d = {c: (D.parse_expiry(c) - NOW).total_seconds() / 86400 for c in ("13NOV26", "20NOV26")}
    w = 0.434 ** 2 * d["13NOV26"] + (7 - d["13NOV26"]) / (d["20NOV26"] - d["13NOV26"]) * (0.398 ** 2 * d["20NOV26"] - 0.434 ** 2 * d["13NOV26"])
    assert g["1W"]["ATM"] == pytest.approx(math.sqrt(w / 7) * 100, abs=0.03)
    assert -5.8 < g["1W"]["RR25"] < -5.3 and g["3M"]["RR25"] == pytest.approx(-3.0, abs=0.15)
    # nothing is listed past September 2027: the 1Y and 2Y rows repeat the last expiry, and the source says so
    assert g["1Y"] == g["2Y"] == {"ATM": pytest.approx(40.3, abs=0.02), "RR25": pytest.approx(-2.0, abs=0.02), "BF25": pytest.approx(1.1, abs=0.02)}
    assert D.source("option marks", b) == "DEMO · Deribit option marks · 2026-11-09 11:59 UTC · listed to 24SEP27, flat beyond"
    assert D.source("option marks", b).startswith(D.SOURCE_PREFIX)


def test_the_pricer_returns_the_venue_mark_at_a_listed_strike():
    """End to end through the pricer's own surface reader: a 25-delta put on a quoted tenor prices at the mark."""
    pillars = [("27NOV26", 75_000.0, 0.39, -0.05, 0.015), ("09DEC26", 75_100.0, 0.39, -0.05, 0.015), ("25DEC26", 75_290.0, 0.39, -0.05, 0.015)]
    b = D.build(chain(pillars), "BTC", NOW)                     # 9 December is the 1M tenor seen from 9 November, give or take hours
    surface = parse_surface(b["vol"])
    t, fwd = 1 / 12, 75_100.0
    want = smile_vol(0.39, -0.05, 0.015, 0.75)                   # the 25-delta put
    k = fwd * math.exp(-NormalDist().inv_cdf(0.75) * want * math.sqrt(t) + 0.5 * want * want * t)
    assert vol_at(surface, t, fwd, k) == pytest.approx(want, abs=3e-4)


def test_forward_points_carry_the_basis_and_hold_the_rate_flat_beyond_the_last_expiry():
    b = D.build(chain(), "BTC", NOW)
    pts = {q["tenor"]: q["rate"] for q in b["forward"]}
    assert list(pts) == list(D.FWD_TENOR_DAYS) and all(q["quote_type"] == "FWD_POINTS" for q in b["forward"])
    last_days = (D.parse_expiry("24SEP27") - NOW).total_seconds() / 86400
    rate = math.log(78_510.0 / INDEX) / (last_days / 365)
    assert pts["2Y"] == pytest.approx(INDEX * (math.exp(rate * 2) - 1), abs=0.5)        # the rate is held, not the points
    assert pts["1Y"] == pytest.approx(INDEX * (math.exp(rate * 1) - 1), abs=0.5)
    assert 0 < pts["1W"] < pts["1M"] < pts["6M"] < pts["1Y"] < pts["2Y"]
    # the tenor grids are the consumers' own
    from api.routes import currencies
    from market_data import demo_feed
    from pricing.fx_vol import TENOR_YEARS
    assert D.FWD_TENOR_DAYS == {t: currencies.TENOR_DAYS[t] for t in currencies.FWD_TENORS}
    assert list(D.VOL_TENORS) == demo_feed.FX_VOL_TENORS
    assert all(D.VOL_TENOR_DAYS[t] == pytest.approx(TENOR_YEARS[t] * 365) for t in D.VOL_TENORS)


def test_thin_stale_and_broken_expiries_are_dropped_with_a_reason():
    good = PILLARS[2:5]
    rows = chain(good)
    rows += chain([("29JAN27", 75_600.0, 0.39, -0.03, 0.012)], deltas=[0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7])   # never reaches 25 delta
    rows += chain([("26FEB27", 75_900.0, 0.39, -0.03, 0.012)], deltas=[0.2, 0.5, 0.8])                  # three strikes
    rows += chain([("26MAR27", 76_340.0, 0.39, -0.03, 0.012)], oi=0.0)                                  # nobody holds it
    rows += chain([("25JUN27", 77_400.0, 4.50, -0.03, 0.012)])                                          # 450 % is not a mark
    rows += [{"instrument_name": "BTC-PERPETUAL", "mark_iv": 40.0, "underlying_price": 1.0}, {"instrument_name": "BTC-24SEP27-80000-C", "mark_iv": None, "underlying_price": 78_000.0},
             {"instrument_name": "BTC-99XXX27-80000-C", "mark_iv": 40.0, "underlying_price": 78_000.0, "base_currency": "BTC"}]
    b = D.build(rows, "BTC", NOW)
    assert [e["code"] for e in b["expiries"]] == [p[0] for p in good]
    assert b["dropped"]["29JAN27"] == "marks do not reach the 25-delta points" and b["dropped"]["26FEB27"] == "3 usable strikes"
    assert b["dropped"]["26MAR27"] == "no open interest" and b["dropped"]["25JUN27"].startswith("out of bounds")
    # one usable expiry is not a surface
    one = D.build(chain(good[:1]), "BTC", NOW)
    assert one["vol"] is None and one["forward"] is None and len(one["expiries"]) == 1


def test_an_asset_is_picked_out_of_a_shared_chain_and_decimal_strikes_parse():
    sol = [("20NOV26", 86.79, 0.62, -0.033, 0.008), ("25DEC26", 87.14, 0.57, -0.022, 0.016), ("26MAR27", 87.97, 0.56, -0.014, 0.016)]
    rows = chain(sol, prefix="SOL_USDC", base="SOL", index=86.68) + chain(PILLARS[2:5], prefix="BTC_USDC", base="BTC")
    b = D.build(rows, "SOL", NOW)
    assert [e["code"] for e in b["expiries"]] == ["20NOV26", "25DEC26", "26MAR27"] and b["index"] == 86.68
    assert grid(b["vol"])["6M"]["ATM"] == pytest.approx(56.0, abs=0.02)                                 # flat beyond March
    assert all(isinstance(q["rate"], float) and q["rate"] > 0 for q in b["forward"])
    assert D._strike("0d5") == 0.5 and D._strike("101") == 101.0
    assert D.parse_expiry("5JAN27") == datetime(2027, 1, 5, 8, tzinfo=timezone.utc)


def test_collect_reports_a_failed_asset_and_keeps_the_others(monkeypatch):
    def fetch(asset, client):
        if asset == "ETH":
            raise RuntimeError("503 from the venue")
        if asset == "SOL":
            return chain(_shifted(PILLARS[2:3]), prefix="SOL_USDC", base="SOL", now=datetime.now(timezone.utc))     # one expiry: no surface
        return chain(_shifted(PILLARS[2:6]), now=datetime.now(timezone.utc))
    with patch.object(D, "fetch_chain", side_effect=fetch):
        got = D.collect(assets=("BTC", "ETH", "SOL"), pause=0)
    assert set(got["ok"]) == {"BTC"} and got["ok"]["BTC"]["vol"]
    assert got["failed"]["ETH"].startswith("RuntimeError") and "usable expiries" in got["failed"]["SOL"]


def _shifted(pillars):
    """The same smiles on expiries that are in the future whenever the test runs."""
    today = datetime.now(timezone.utc)
    out = []
    for i, (_, fwd, atm, rr, bf) in enumerate(pillars):
        d = today + timedelta(days=10 + 30 * i)
        out.append((f"{d.day}{d:%b}".upper() + f"{d:%y}", fwd, atm, rr, bf))
    return out


def test_the_switch(monkeypatch):
    assert D.enabled()
    monkeypatch.setenv("RIJEKA_DERIBIT", "0")
    assert not D.enabled()
    assert D.pair("BTC") == "BTCUSD" and set(D.ASSETS) == {"BTC", "ETH", "SOL"}
