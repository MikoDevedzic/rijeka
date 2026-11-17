# backend/pricing/cap_floor.py
# ============================================================
# Cap / Floor / Collar pricer — Bachelier (Normal) model
# ============================================================
# Conventions (the market's, for a cap on compounded SOFR):
#   Underlying  : SOFRRATE Index (in-arrears)
#   Pay Freq    : Quarterly
#   Day Count   : ACT/360
#   Settlement  : T+2
#   Bus Adj     : Modified Following
#
# Pricing model:
#   Each caplet/floorlet = Bachelier call/put on forward SOFR
#   Cap  = Σ Bachelier_call(F_i, K, t_i, σ_i) × df_i × τ_i × N
#   Floor= Σ Bachelier_put (F_i, K, t_i, σ_i) × df_i × τ_i × N
#   Collar = Cap - Floor (net premium, positive = buy cap sell floor)
#
# Vol lookup:
#   ATM vol from cap_vol_surface (is_atm=True, tenor=cap_tenor_y)
#   Strike spread = (cap_rate - ATM_forward) in bp
#   Linear interpolation between adjacent quoted strikes
# ============================================================

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

import numpy as np
from scipy.special import ndtr as _ndtr
from scipy.interpolate import interp1d


_SQRT_2PI = np.sqrt(2 * np.pi)


# ── Bachelier caplet/floorlet ────────────────────────────────────────────────

def bachelier_call(F: float, K: float, T: float, sigma: float) -> float:
    """Normal Bachelier call. F,K decimal. T years. sigma decimal/yr. Returns per unit notional·accrual."""
    if T <= 0:
        return max(F - K, 0.0)
    sT = sigma * math.sqrt(T)
    if sT < 1e-12:
        return max(F - K, 0.0)
    d = (F - K) / sT
    # The normal distribution, read directly. scipy.stats.norm.cdf and .pdf give these same numbers to the last
    # bit (they are ndtr and exp(-x^2/2)/sqrt(2 pi) inside a wrapper that checks its arguments) and take about
    # 160 times as long for one number: a caplet is priced three times for its value and its two sensitivities,
    # and a live risk report on twelve trades asked for 155,000 of them, more than half its time
    # (15 November 2026). tests/test_capped_floored_floater.py holds the two to each other exactly.
    return sT * (d * _ndtr(d) + np.exp(-d * d / 2.0) / _SQRT_2PI)


def bachelier_put(F: float, K: float, T: float, sigma: float) -> float:
    """Normal Bachelier put via put-call parity."""
    return bachelier_call(F, K, T, sigma) - (F - K)


def option_time(valuation_date: date, start: date, end: date) -> float:
    """Option time of a SOFR caplet in years: from the valuation date to the middle of its
    accrual period (the in-arrears convention this module states), on ACT/365F. A normal vol
    is quoted per 365-day year, so time must be too; measuring it on ACT/360 overstated the
    variance by 365/360 (≈ +0.7% of an at-the-money premium) until 2026-11."""
    return max((start - valuation_date).days + 0.5 * (end - start).days, 0.0) / 365.0


# ── Caplet schedule ───────────────────────────────────────────────────────────

def _add_months(d: date, months: int) -> date:
    month = d.month + months
    year  = d.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    day   = min(d.day, [31,28,29,31,30,31,30,31,31,30,31,30,31][month])
    return date(year, month, day)


def _mod_following(d: date) -> date:
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def caplet_schedule(spot_date: date, tenor_y: float, freq_per_year: int = 4) -> list[dict]:
    """Generate quarterly caplet schedule. Returns list of {expiry_y, tau, start_date, end_date}."""
    n   = int(tenor_y * freq_per_year)
    mpm = 12 // freq_per_year   # months per period = 3
    sched = []
    prev  = spot_date

    for i in range(1, n + 1):
        end  = _mod_following(_add_months(spot_date, i * mpm))
        tau  = (end - prev).days / 360.0
        expY = (end - spot_date).days / 365.0
        sched.append({
            "period":       i,
            "start_date":   prev,
            "end_date":     end,
            "tau":          tau,
            "expiry_y":     expY,                    # T_end (payment date)
            "expiry_start_y": (prev - spot_date).days / 365.0,  # T_start from spot, ACT/365F (display; pricing uses option_time)
        })
        prev = end
    return sched


# ── ATM forward (weighted caplet forward, i.e. par cap rate) ─────────────────

def compute_atm_forward(discount_curve, valuation_date: date, tenor_y: float,
                        freq_per_year: int = 4) -> float:
    """
    Weighted-average cap forward rate (par cap rate) for a given tenor,
    computed from the discount curve using the same logic as price_cap().
    Used at snap time to derive spread-from-ATM labels for absolute-strike
    cap vol tickers.
    """
    spot_date = valuation_date + timedelta(days=2)
    sched = caplet_schedule(spot_date, tenor_y, freq_per_year)
    fwd_rates, dfs = [], []
    for cp in sched:
        df_s = discount_curve.df(cp['start_date'])
        df_e = discount_curve.df(cp['end_date'])
        tau  = cp['tau']
        fwd  = (df_s / df_e - 1.0) / tau if tau > 0 else 0.0
        fwd_rates.append(fwd)
        dfs.append(df_e)
    total_ann = sum(dfs[i] * sched[i]['tau'] for i in range(len(sched)))
    if total_ann < 1e-8:
        return 0.0
    return sum(fwd_rates[i] * dfs[i] * sched[i]['tau']
               for i in range(len(sched))) / total_ann


# ── Vol lookup from surface ───────────────────────────────────────────────────

def lookup_cap_vol(
    strike_rate: float,          # absolute strike in decimal (e.g. 0.045 = 4.5%)
    atm_forward: float,          # current ATM forward rate in decimal
    cap_tenor_y: float,          # cap tenor in years (1,2,3,5,7,10)
    surface_rows: list[dict],    # rows from cap_vol_surface for this date
    fallback_vol_bp: float = 85.0,
    is_floor: bool = False,      # kept for its callers; since 0.42.2 it does not change the volatility read
) -> tuple[float, str]:
    """
    Look up flat cap vol from surface given absolute strike and tenor.
    One strike has one volatility, whichever option is struck there: a cap and a floor at the same strike are read
    at the same point of the surface, the strike's signed distance from the at-the-money forward. Only then is a
    cap less a floor at one strike worth the swap at that strike, whatever the volatility (put-call parity).
    A surface quoted on one side of the money only is mirrored for a strike on the other side.
    Returns (vol_bp, tier) where tier is 'QUOTED', 'INTERP', or 'FALLBACK'.
    """
    # Filter to this tenor
    tenor_rows = [r for r in surface_rows
                  if abs(float(r['cap_tenor_y']) - cap_tenor_y) < 0.01]
    if not tenor_rows:
        return fallback_vol_bp, 'FALLBACK'

    # ATM row
    atm_row = next((r for r in tenor_rows if r.get('is_atm')), None)
    atm_vol_bp = float(atm_row['flat_vol_bp']) if atm_row else fallback_vol_bp

    # Strike spread vs ATM forward, as it is: not rounded, and signed.
    #
    # Until 0.42.2 a floor was read at the size of its distance: a floor struck 100bp below the money took the
    # volatility quoted 100bp above it and never read the quotes below the money, while a cap at that same strike
    # read the signed distance. On a surface that is not symmetric the two volatilities differed, and a cap less
    # a floor at one strike was not the swap (Emmy, 15 November 2026). The distance is now signed for both. The
    # one case where it is mirrored is a strike on a side of the money where the surface has no quote at all: a
    # surface quoted above the money only says nothing below it, and its smile is taken to be the same on both
    # sides, where a straight line carried through the money would run on downward. That holds for a cap as for a
    # floor: until 0.42.2 a cap struck on the unquoted side was read on that straight line (87.5bp at 50bp below
    # the money on a surface of 85 at the money and 80 at +100; 82.5bp now). One quote on a side is enough for
    # that side to be read as quoted: the line from the money to that quote, carried on beyond it.
    #
    # The volatility is a continuous function of the spread: straight lines through the quoted spreads and the ATM
    # point, carried on in a straight line beyond the last quote. Until 0.40.0 the spread was rounded to a whole
    # basis point, a strike within 5bp of the money took the ATM vol and one within 1bp of a quote took that
    # quote: three steps. A move of the curve moves the ATM forward, so each step made the price jump, and a cap's
    # rate risk depended on the size of the bump it was measured with (618 at 1bp, 845 a basis point at 0.01bp on
    # the test book's cap; Emmy, 15 November 2026). The tier is a label and does not change the number: QUOTED
    # within half a basis point of a quoted spread, INTERP between or beyond them.
    raw_spread_bp = (strike_rate - atm_forward) * 10000

    # Get non-ATM rows, sorted by spread
    skew_rows = sorted(
        [r for r in tenor_rows if not r.get('is_atm')],
        key=lambda r: float(r['strike_spread_bp'])
    )
    this_side = any(float(r['strike_spread_bp']) * raw_spread_bp > 0 for r in skew_rows)
    spread_bp = raw_spread_bp if this_side or raw_spread_bp == 0 else -raw_spread_bp
    if not skew_rows:
        # an ATM quote alone: flat in strike, said to be quoted near the money and a fallback away from it
        return atm_vol_bp, ('QUOTED' if abs(spread_bp) < 5 else 'FALLBACK')

    # Build arrays for interpolation. A distance quoted twice is one point, at the mean of its quotes: two points
    # at one distance would be a step.
    by_spread: dict[float, list[float]] = {}
    for r in skew_rows:
        by_spread.setdefault(float(r['strike_spread_bp']), []).append(float(r['flat_vol_bp']))
    # Add ATM point at spread=0
    if 0.0 not in by_spread:
        by_spread[0.0] = [atm_vol_bp]
    spreads = sorted(by_spread)
    vols    = [sum(by_spread[x]) / len(by_spread[x]) for x in spreads]

    # Interpolate / extrapolate
    if len(spreads) >= 2:
        try:
            f = interp1d(spreads, vols, kind='linear', fill_value='extrapolate')
            vol = float(f(spread_bp))
            vol = max(1.0, min(vol, 500.0))
            quoted = any(abs(s - spread_bp) < 0.5 for s in spreads)
            return vol, ('QUOTED' if quoted else 'INTERP')
        except Exception:
            pass

    return atm_vol_bp, 'FALLBACK'


# ── Cap / Floor / Collar pricing ─────────────────────────────────────────────

@dataclass
class CapFloorResult:
    # Primary outputs
    npv:           float
    premium_pct:   float       # NPV as % of notional
    # Greeks
    vega:          float       # $ per 1bp vol move
    ir01:          float       # $ per 1bp parallel rate move
    delta:         float       # dP/dF (aggregate)
    # Per-caplet
    caplets:       list[dict]
    # Metadata
    vol_bp:        float       # vol used (ATM or interpolated)
    vol_tier:      str         # QUOTED / INTERP / FALLBACK
    atm_forward:   float       # ATM forward rate
    n_caplets:     int
    error:         Optional[str] = None


VOL_FLOOR_BP = 0.01      # a shifted vol is never zero or negative: the Bachelier formulas divide by it


def shifted_vol_bp(vol_bp: float, shift_bp: float) -> float:
    """The vol a leg is priced at after a scenario's parallel shift, in bp of normal vol. No shift returns the
    vol untouched (not even rounded), so a price without a scenario is the price it always was."""
    if not shift_bp:
        return vol_bp
    return max(float(vol_bp) + float(shift_bp), VOL_FLOOR_BP)


def price_cap(
    notional:      float,
    cap_rate:      float,          # absolute cap rate in decimal
    tenor_y:       float,          # cap tenor in years
    discount_curve,                # Curve object
    valuation_date: date,
    surface_rows:  list[dict],
    fallback_vol_bp: float = 85.0,
    freq_per_year: int = 4,
    vol_override_bp: Optional[float] = None,  # explicit vol override, skips surface
    vol_shift_bp: float = 0.0,                 # a scenario: the vol as read (or overridden), moved by this many bp
    vol_atm_forward: Optional[float] = None,   # a scenario that moves the curve: the ATM forward the trade's place on the
                                               # surface is read at (the unmoved curve's), so the curve does not move it along the smile
) -> CapFloorResult:
    """Price a cap as sum of Bachelier call caplets."""
    spot_date = valuation_date + timedelta(days=2)
    sched = caplet_schedule(spot_date, tenor_y, freq_per_year)

    # Compute forward rates and DFs
    fwd_rates = []
    dfs       = []
    for cp in sched:
        df_s = discount_curve.df(cp['start_date'])
        df_e = discount_curve.df(cp['end_date'])
        tau  = cp['tau']
        fwd  = (df_s / df_e - 1.0) / tau if tau > 0 else cap_rate
        fwd_rates.append(fwd)
        dfs.append(discount_curve.df(cp['end_date']))

    # ATM forward = par cap rate (weighted avg of caplet forwards)
    total_ann  = sum(dfs[i] * sched[i]['tau'] for i in range(len(sched)))
    atm_forward = sum(fwd_rates[i] * dfs[i] * sched[i]['tau']
                      for i in range(len(sched))) / max(total_ann, 1e-8)

    # Vol lookup — use override if provided, else surface lookup
    if vol_override_bp is not None:
        vol_bp, vol_tier = vol_override_bp, 'OVERRIDE'
    else:
        vol_bp, vol_tier = lookup_cap_vol(
            strike_rate=cap_rate,
            atm_forward=atm_forward if vol_atm_forward is None else vol_atm_forward,
            cap_tenor_y=tenor_y,
            surface_rows=surface_rows,
            fallback_vol_bp=fallback_vol_bp,
        )
    vol_bp = shifted_vol_bp(vol_bp, vol_shift_bp)
    sigma = vol_bp / 10000.0

    # Price caplets (use T_start = period start date as Bachelier expiry — SOFR in-arrears convention)
    npv     = 0.0
    caplets = []
    for i, cp in enumerate(sched):
        F   = fwd_rates[i]
        df  = dfs[i]
        tau = cp['tau']
        T   = option_time(valuation_date, cp['start_date'], cp['end_date'])   # T_mid: midpoint of accrual period (the market's convention)
        pv  = notional * tau * df * bachelier_call(F, cap_rate, T, sigma)
        npv += pv
        caplets.append({
            'period':      cp['period'],
            'start_date':  cp['start_date'].isoformat(),
            'end_date':    cp['end_date'].isoformat(),
            'expiry_y':    round(T, 4),
            'forward':     round(F * 100, 6),
            'df':          round(df, 6),
            'tau':         round(tau, 6),
            'vol_bp':      round(vol_bp, 2),
            'pv':          round(pv, 2),
        })

    # Greeks
    bump = 0.0001   # 1bp
    # Vega: reprice with +1bp vol
    npv_vega_up = sum(
        notional * sched[i]['tau'] * dfs[i] *
        bachelier_call(fwd_rates[i], cap_rate, option_time(valuation_date, sched[i]['start_date'], sched[i]['end_date']), sigma + bump)
        for i in range(len(sched))
    )
    vega = npv_vega_up - npv

    # IR01: parallel +1bp shift to forward rates
    npv_ir_up = sum(
        notional * sched[i]['tau'] * dfs[i] *
        bachelier_call(fwd_rates[i] + bump, cap_rate, option_time(valuation_date, sched[i]['start_date'], sched[i]['end_date']), sigma)
        for i in range(len(sched))
    )
    ir01  = npv_ir_up - npv
    delta = ir01 / bump if bump else 0.0

    return CapFloorResult(
        npv=round(npv, 2),
        premium_pct=round(npv / notional * 100, 4),
        vega=round(vega, 2),
        ir01=round(ir01, 2),
        delta=round(delta, 2),
        caplets=caplets,
        vol_bp=round(vol_bp, 4),
        vol_tier=vol_tier,
        atm_forward=round(atm_forward, 8),
        n_caplets=len(sched),
    )


def price_floor(
    notional:      float,
    floor_rate:    float,
    tenor_y:       float,
    discount_curve,
    valuation_date: date,
    surface_rows:  list[dict],
    fallback_vol_bp: float = 85.0,
    freq_per_year: int = 4,
    vol_override_bp: Optional[float] = None,  # explicit vol override
    vol_shift_bp: float = 0.0,                 # a scenario: the vol as read (or overridden), moved by this many bp
    vol_atm_forward: Optional[float] = None,   # a scenario that moves the curve: the ATM forward the trade's place on the
                                               # surface is read at (the unmoved curve's), so the curve does not move it along the smile
) -> CapFloorResult:
    """Price a floor as sum of Bachelier put floorlets."""
    spot_date = valuation_date + timedelta(days=2)
    sched = caplet_schedule(spot_date, tenor_y, freq_per_year)

    fwd_rates, dfs = [], []
    for cp in sched:
        df_s = discount_curve.df(cp['start_date'])
        df_e = discount_curve.df(cp['end_date'])
        tau  = cp['tau']
        fwd  = (df_s / df_e - 1.0) / tau if tau > 0 else floor_rate
        fwd_rates.append(fwd)
        dfs.append(df_e)

    total_ann   = sum(dfs[i] * sched[i]['tau'] for i in range(len(sched)))
    atm_forward = sum(fwd_rates[i] * dfs[i] * sched[i]['tau']
                      for i in range(len(sched))) / max(total_ann, 1e-8)

    if vol_override_bp is not None:
        vol_bp, vol_tier = vol_override_bp, 'OVERRIDE'
    else:
        vol_bp, vol_tier = lookup_cap_vol(
            strike_rate=floor_rate,
            atm_forward=atm_forward if vol_atm_forward is None else vol_atm_forward,
            cap_tenor_y=tenor_y,
            surface_rows=surface_rows,
            fallback_vol_bp=fallback_vol_bp,
            is_floor=True,
        )
    vol_bp = shifted_vol_bp(vol_bp, vol_shift_bp)
    sigma = vol_bp / 10000.0

    npv, caplets = 0.0, []
    for i, cp in enumerate(sched):
        F  = fwd_rates[i]; df = dfs[i]; tau = cp['tau']
        T  = option_time(valuation_date, cp['start_date'], cp['end_date'])   # T_mid: midpoint (the market's convention)
        pv = notional * tau * df * bachelier_put(F, floor_rate, T, sigma)
        npv += pv
        caplets.append({'period':cp['period'],
                        'start_date':cp['start_date'].isoformat(),'end_date':cp['end_date'].isoformat(),
                        'expiry_y':round(T,4),'forward':round(F*100,6),'df':round(df,6),
                        'tau':round(tau,6),'vol_bp':round(vol_bp,2),'pv':round(pv,2)})

    bump = 0.0001
    npv_vega_up = sum(notional*sched[i]['tau']*dfs[i]*bachelier_put(
        fwd_rates[i],floor_rate,option_time(valuation_date, sched[i]['start_date'], sched[i]['end_date']),sigma+bump) for i in range(len(sched)))
    vega = npv_vega_up - npv
    npv_ir_up = sum(notional*sched[i]['tau']*dfs[i]*bachelier_put(
        fwd_rates[i]+bump,floor_rate,option_time(valuation_date, sched[i]['start_date'], sched[i]['end_date']),sigma) for i in range(len(sched)))
    ir01 = npv_ir_up - npv

    return CapFloorResult(
        npv=round(npv,2), premium_pct=round(npv/notional*100,4),
        vega=round(vega,2), ir01=round(ir01,2), delta=round((ir01/bump) if bump else 0,2),
        caplets=caplets, vol_bp=round(vol_bp,4), vol_tier=vol_tier,
        atm_forward=round(atm_forward,8), n_caplets=len(sched),
    )


def price_collar(
    notional:    float,
    cap_rate:    float,
    floor_rate:  float,
    tenor_y:     float,
    discount_curve,
    valuation_date: date,
    surface_rows: list[dict],
    fallback_vol_bp: float = 85.0,
    freq_per_year: int = 4,
    vol_shift_bp: float = 0.0,          # a scenario: both legs' vols, as read from the surface, moved by this many bp
    vol_atm_forward: Optional[float] = None,   # ... and read at this ATM forward, when the scenario moves the curve
) -> dict:
    """
    Price a collar = long cap + short floor (from buyer's perspective).
    Net premium = cap premium - floor premium.
    Positive net = pay premium (cap > floor cost).
    """
    cap_result   = price_cap(notional, cap_rate, tenor_y, discount_curve,
                             valuation_date, surface_rows, fallback_vol_bp, freq_per_year, vol_shift_bp=vol_shift_bp, vol_atm_forward=vol_atm_forward)
    floor_result = price_floor(notional, floor_rate, tenor_y, discount_curve,
                               valuation_date, surface_rows, fallback_vol_bp, freq_per_year, vol_shift_bp=vol_shift_bp, vol_atm_forward=vol_atm_forward)

    net_npv     = cap_result.npv - floor_result.npv
    net_pct     = cap_result.premium_pct - floor_result.premium_pct
    net_vega    = cap_result.vega - floor_result.vega
    net_ir01    = cap_result.ir01 - floor_result.ir01

    return {
        "cap":   cap_result,
        "floor": floor_result,
        "net_npv":      round(net_npv, 2),
        "net_pct":      round(net_pct, 4),
        "net_vega":     round(net_vega, 2),
        "net_ir01":     round(net_ir01, 2),
        "zero_cost_spread_bp": round((cap_rate - floor_rate) * 10000, 2),
    }


# ═════════════════════════════════════════════════════════════════════
# Sprint 12 — CAPPED_FLOATER / FLOORED_FLOATER strip pricer
# ═════════════════════════════════════════════════════════════════════
# Used by pricing/ir_swap.py::price_leg when a float leg carries a
# populated cap_strike_schedule or floor_strike_schedule JSONB column.
# Accepts pre-computed CouponPeriod objects (period-aligned to the swap)
# rather than regenerating its own caplet grid like price_cap() does.
#
# JSONB shape of the strike schedule object:
#   {
#     "direction": "BUY" | "SELL",
#     "schedule": [{"date": "YYYY-MM-DD", "strike": 0.05}, ...]
#               | {"YYYY-MM-DD": 0.05, ...}
#   }
# Resolution rule (mirrors ir_swap._resolve_step_up_rate):
#   last schedule entry where entry.date <= period_start; fall back to
#   the scalar trade_legs.cap_rate / floor_rate field if no entry qualifies.

from dataclasses import field as _field


@dataclass
class StripResult:
    npv:          float           # SIGNED: direction BUY -> +strip value, SELL -> -strip value
    vega:         float           # $ per 1bp vol move (signed same as npv)
    ir01:         float           # $ per 1bp parallel rate move (signed same as npv)
    atm_forward:  float           # weighted-avg forward rate over strip periods (metadata)
    vol_tier:     str             # QUOTED / INTERP / FALLBACK / OVERRIDE (worst tier seen)
    n_periods:    int
    direction:    str             # "BUY" or "SELL" (echoed for audit)
    caplets:      list = _field(default_factory=list)   # per-period {start_date, end_date, strike, forward, df, tau, vol_bp, pv}
    error:        Optional[str] = None


def _parse_date_safe(v):
    """Local copy — cap_floor.py doesn't import ir_swap._parse_date to avoid a cycle."""
    from datetime import date as _date
    if not v:
        return None
    if isinstance(v, _date):
        return v
    try:
        return _date.fromisoformat(str(v)[:10])
    except Exception:
        return None


def _resolve_strike_at(strike_entries, period_start, default_strike):
    """
    Resolve per-period strike from a schedule's entries (list or dict form).
    `strike_entries` is the INNER list/dict from {direction, schedule}.schedule.
    Rule: last entry where entry.date <= period_start. Fall back to default_strike.
    """
    if not strike_entries:
        return default_strike
    if isinstance(strike_entries, dict):
        pairs = [(k, float(v)) for k, v in strike_entries.items()]
    else:
        pairs = [
            (e.get("date") or e.get("effective_date"),
             float(e.get("strike", default_strike)))
            for e in strike_entries
        ]
    parsed = []
    for d, s in pairs:
        pd = _parse_date_safe(d)
        if pd is not None:
            parsed.append((pd, s))
    parsed.sort(key=lambda x: x[0])
    applicable = default_strike
    for entry_date, entry_strike in parsed:
        if entry_date <= period_start:
            applicable = entry_strike
    return applicable


def _resolve_notional_at(notional_schedule, period_start, default_notional):
    """Duplicate of ir_swap._resolve_notional_schedule — kept local to avoid import cycle."""
    if not notional_schedule:
        return default_notional
    if isinstance(notional_schedule, dict):
        pairs = [(k, float(v)) for k, v in notional_schedule.items()]
    else:
        pairs = [
            (e.get("date") or e.get("effective_date"),
             float(e.get("notional", default_notional)))
            for e in notional_schedule
        ]
    parsed = []
    for d, n in pairs:
        pd = _parse_date_safe(d)
        if pd is not None:
            parsed.append((pd, n))
    parsed.sort(key=lambda x: x[0])
    applicable = default_notional
    for entry_date, entry_notional in parsed:
        if entry_date <= period_start:
            applicable = entry_notional
    return applicable


def _worst_tier(tiers):
    """QUOTED < INTERP < FALLBACK in order of increasing uncertainty. Return worst seen."""
    order = {"QUOTED": 0, "OVERRIDE": 0, "INTERP": 1, "FALLBACK": 2}
    return max(tiers, key=lambda t: order.get(t, 3))


def _price_strip_core(
    periods,
    strike_schedule_obj,
    default_strike,
    notional_schedule,
    default_notional,
    forecast_curve,
    discount_curve,
    valuation_date,
    surface_rows,
    swap_tenor_y,
    is_floor,
    fallback_vol_bp,
    vol_override_bp,
):
    """
    Shared core for caplet and floorlet strip pricing.
    Returns StripResult with SIGNED npv/vega/ir01 (direction applied).
    """
    # Parse direction from the JSONB object
    if not isinstance(strike_schedule_obj, dict):
        return StripResult(npv=0.0, vega=0.0, ir01=0.0, atm_forward=0.0,
                           vol_tier="ERROR", n_periods=0, direction="UNKNOWN",
                           error="strike_schedule is not a dict")
    direction = (strike_schedule_obj.get("direction") or "").upper()
    if direction not in ("BUY", "SELL"):
        return StripResult(npv=0.0, vega=0.0, ir01=0.0, atm_forward=0.0,
                           vol_tier="ERROR", n_periods=0, direction=direction or "UNKNOWN",
                           error=f"direction must be 'BUY' or 'SELL', got {direction!r}")
    sign = 1.0 if direction == "BUY" else -1.0
    strike_entries = strike_schedule_obj.get("schedule")

    # Pre-compute forward rates, DFs, and accruals for each future period
    fwds, dfs_disc, taus, strikes, notionals, periods_live = [], [], [], [], [], []
    for p in periods:
        if p.payment_date < valuation_date:
            continue  # past-dated — skip
        df_s = forecast_curve.df(p.period_start)
        df_e = forecast_curve.df(p.period_end)
        tau  = float(p.dcf)
        fwd  = (df_s / df_e - 1.0) / tau if tau > 0 and df_e > 1e-10 else 0.0
        K    = _resolve_strike_at(strike_entries, p.period_start, default_strike)
        N    = _resolve_notional_at(notional_schedule, p.period_start, default_notional)
        fwds.append(fwd)
        dfs_disc.append(discount_curve.df(p.payment_date))      # paid with the coupon, on the adjusted date
        taus.append(tau)
        strikes.append(float(K) if K is not None else 0.0)
        notionals.append(N)
        periods_live.append(p)

    if not periods_live:
        return StripResult(npv=0.0, vega=0.0, ir01=0.0, atm_forward=0.0,
                           vol_tier="EMPTY", n_periods=0, direction=direction)

    # ATM forward — weighted average over periods (same formula as price_cap)
    total_ann = sum(dfs_disc[i] * taus[i] for i in range(len(periods_live)))
    atm_forward = (
        sum(fwds[i] * dfs_disc[i] * taus[i] for i in range(len(periods_live))) / total_ann
        if total_ann > 1e-8 else 0.0
    )

    # Per-caplet pricing
    bump = 0.0001  # 1bp
    npv_unsigned       = 0.0
    npv_vega_up        = 0.0
    npv_ir_up          = 0.0
    caplets_out        = []
    tiers_seen         = []
    vol_at: dict = {}        # the surface's answer for a strike: the periods of a strip mostly share one, and the
                             # forward, the tenor and the surface are the strip's, so it is asked once a strike

    for i, p in enumerate(periods_live):
        F   = fwds[i]
        K   = strikes[i]
        N   = notionals[i]
        df  = dfs_disc[i]
        tau = taus[i]
        T   = option_time(valuation_date, p.period_start, p.period_end)

        # Per-caplet vol lookup
        if vol_override_bp is not None:
            vol_bp, vol_tier = vol_override_bp, 'OVERRIDE'
        else:
            if K not in vol_at:
                vol_at[K] = lookup_cap_vol(
                    strike_rate=K,
                    atm_forward=atm_forward,
                    cap_tenor_y=swap_tenor_y,
                    surface_rows=surface_rows,
                    fallback_vol_bp=fallback_vol_bp,
                    is_floor=is_floor,
                )
            vol_bp, vol_tier = vol_at[K]
        tiers_seen.append(vol_tier)
        sigma = vol_bp / 10000.0

        if is_floor:
            payoff_unit = bachelier_put(F, K, T, sigma)
            payoff_ir   = bachelier_put(F + bump, K, T, sigma)
            payoff_vega = bachelier_put(F, K, T, sigma + bump)
        else:
            payoff_unit = bachelier_call(F, K, T, sigma)
            payoff_ir   = bachelier_call(F + bump, K, T, sigma)
            payoff_vega = bachelier_call(F, K, T, sigma + bump)

        pv_caplet      = N * tau * df * payoff_unit
        pv_caplet_ir   = N * tau * df * payoff_ir
        pv_caplet_vega = N * tau * df * payoff_vega

        npv_unsigned += pv_caplet
        npv_ir_up    += pv_caplet_ir
        npv_vega_up  += pv_caplet_vega

        caplets_out.append({
            'period_start': p.period_start.isoformat(),
            'start_date':   p.period_start.isoformat(),   # alias for ir_swap.py consumer
            'end_date':     p.period_end.isoformat(),
            'expiry_y':     round(T, 4),
            'forward':      round(F, 8),
            'strike':       round(K, 8),
            'notional':     round(N, 2),
            'df':           round(df, 8),
            'tau':          round(tau, 6),
            'vol_bp':       round(vol_bp, 2),
            'vol_tier':     vol_tier,
            # signed pv so ir_swap.py can treat this as a regular cashflow contribution
            'pv':           round(sign * pv_caplet, 4),
        })

    return StripResult(
        npv          = round(sign * npv_unsigned, 4),
        vega         = round(sign * (npv_vega_up - npv_unsigned), 4),
        ir01         = round(sign * (npv_ir_up   - npv_unsigned), 4),
        atm_forward  = round(atm_forward, 8),
        vol_tier     = _worst_tier(tiers_seen) if tiers_seen else "EMPTY",
        n_periods    = len(periods_live),
        direction    = direction,
        caplets      = caplets_out,
    )


def price_caplet_strip_over_periods(
    periods,                  # list[CouponPeriod] from pricing/schedule.py::generate_schedule
    strike_schedule_obj,      # {"direction": "BUY"|"SELL", "schedule": [...]}
    default_strike,           # fallback strike (scalar trade_legs.cap_rate)
    notional_schedule,        # JSONB (list or dict) or None
    default_notional,         # fallback notional (leg.notional)
    forecast_curve,           # Curve — for forward rates
    discount_curve,           # Curve — for discounting
    valuation_date,           # date
    surface_rows,             # list[dict] from pricer._load_cap_surface
    swap_tenor_y,             # float — tenor for vol surface lookup
    fallback_vol_bp=85.0,
    vol_override_bp=None,
):
    """Price a strip of Bachelier call caplets aligned to swap periods.
    Returns StripResult with SIGNED npv (direction from strike_schedule_obj)."""
    return _price_strip_core(
        periods=periods, strike_schedule_obj=strike_schedule_obj,
        default_strike=default_strike, notional_schedule=notional_schedule,
        default_notional=default_notional, forecast_curve=forecast_curve,
        discount_curve=discount_curve, valuation_date=valuation_date,
        surface_rows=surface_rows, swap_tenor_y=swap_tenor_y,
        is_floor=False, fallback_vol_bp=fallback_vol_bp,
        vol_override_bp=vol_override_bp,
    )


def price_floorlet_strip_over_periods(
    periods,
    strike_schedule_obj,
    default_strike,
    notional_schedule,
    default_notional,
    forecast_curve,
    discount_curve,
    valuation_date,
    surface_rows,
    swap_tenor_y,
    fallback_vol_bp=85.0,
    vol_override_bp=None,
):
    """Price a strip of Bachelier put floorlets aligned to swap periods.
    The vol is read at the strike's signed distance from the money, where a cap at that strike is (lookup_cap_vol).
    Returns StripResult with SIGNED npv (direction from strike_schedule_obj)."""
    return _price_strip_core(
        periods=periods, strike_schedule_obj=strike_schedule_obj,
        default_strike=default_strike, notional_schedule=notional_schedule,
        default_notional=default_notional, forecast_curve=forecast_curve,
        discount_curve=discount_curve, valuation_date=valuation_date,
        surface_rows=surface_rows, swap_tenor_y=swap_tenor_y,
        is_floor=True, fallback_vol_bp=fallback_vol_bp,
        vol_override_bp=vol_override_bp,
    )
