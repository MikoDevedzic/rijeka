"""
Excel replications of Rijeka's pricing, one workbook per product.

"No black boxes" has to be more than a slogan: for every product a user can
download a workbook that rebuilds the default trade's value with live Excel
formulas from the same market data Rijeka used, next to the number Rijeka's
engine produced. The formulas are the methodology; the engine value is the
test. Dates and the bootstrapped discount factors come from Rijeka as values
(the bootstrap itself is in pricing/bootstrap.py); everything after that —
day counts, DF interpolation, forwards, cashflows, PVs, Bachelier, Black-76 —
is a formula the reader can inspect and change.

Interpolation matches pricing/curve.py: log-linear in DF between bracketing
pillar dates, on calendar-day fractions.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName

from methodology import workbook as W
from pricing.curve import Curve
from pricing.ir_swap import price_swap
from pricing.swaption import price_swaption
from pricing.cap_floor import price_cap
from pricing.fx_option import price_fx_option
from pricing.currency_forward import price_currency_forward
from pricing.fx_exotic import ExoticSpec, price_exotic

# ── Products ────────────────────────────────────────────────────────────────

PRODUCTS = [
    {"id": "irs", "name": "Interest rate swap", "group": "Rates", "section": "3-4",
     "default": "USD 10m · pay 4.00% 30/360 semi-annual vs receive SOFR ACT/360 quarterly · 5y from spot",
     "formula": "PV = Σ N·r·τ·DF(pay) per leg; float coupon = (DF(start)/DF(end) − 1)/τ; NPV = receive − pay",
     "replication": "xlsx"},
    {"id": "ois", "name": "OIS swap", "group": "Rates", "section": "2 and 4",
     "default": "USD 10m · pay 4.00% ACT/360 annual vs receive SOFR compounded ACT/360 annual · 2y from spot",
     "formula": "Compounded overnight coupon equals the DF ratio over the period: (DF(start)/DF(end) − 1)/τ",
     "replication": "xlsx"},
    {"id": "swaption", "name": "European swaption", "group": "Rates", "section": "5",
     "default": "USD 10m · 1y into 5y payer · strike at the forward · ATM normal vol from the surface",
     "formula": "Bachelier: V = A·σ√T·[d·N(d) + n(d)], d = (F − K)/(σ√T); A = Σ τ_i·DF(T_i), F = (DF(T₀) − DF(T_n))/A",
     "replication": "xlsx"},
    {"id": "cap", "name": "Interest rate cap", "group": "Rates", "section": "6",
     "default": "USD 10m · 5y quarterly cap on SOFR · strike at the ATM forward · 85bp normal vol",
     "formula": "Cap = Σ caplets; caplet = N·τ·DF(end)·Bachelier_call(F, K, T_fix, σ)",
     "replication": "xlsx"},
    {"id": "fx_forward", "name": "FX forward (EURUSD)", "group": "FX & digital assets", "section": "12",
     "default": "EUR/USD · EUR 10m · 3-month deliverable forward · rate at the fair forward",
     "formula": "F = S·DF_EUR(T)/DF_USD(T) (covered interest parity, each currency on its own curve); NPV_USD = ±N_EUR·(F − K)·DF_USD(T); FX01 and both IR01s beside the engine's",
     "replication": "xlsx"},
    {"id": "fx_option", "name": "FX option (EURUSD European)", "group": "FX & digital assets", "section": "13",
     "default": "EUR/USD · EUR 10m · 3-month call · strike at the forward · ATM vol from the pair's surface (7.5% without one)",
     "formula": "Garman–Kohlhagen on the forward to settlement: C = DF_USD(T_s)·[F·N(d₁) − K·N(d₂)], d₁ = [ln(F/K) + ½σ²T_e]/(σ√T_e); delta, vega beside the engine's",
     "replication": "xlsx"},
    {"id": "fx_option_styles", "name": "FX option styles: digital, barrier, touch, double barrier", "group": "FX & digital assets", "section": "13",
     "default": "EUR/USD · 3 months · digitals USD 1m / EUR 1m · the eight single barriers at ±5% with a rebate · one-touch, no-touch, double touches · double knock-out and knock-in",
     "formula": "Reiner–Rubinstein closed forms (A–F with η, φ) for barriers and touches; the two-barrier image series summed term by term for double barriers and double touches; American is a tree and has no spreadsheet form",
     "replication": "xlsx"},
    {"id": "crypto_ndf", "name": "Crypto NDF", "group": "FX & digital assets", "section": "12",
     "default": "BTC/USD · 10 BTC · 3-month non-deliverable forward · strike at the forward",
     "formula": "F = S·DF_BTC(T)/DF_USD(T) (cash-and-carry with a BTC funding rate, the same model as an FX forward); NPV = (F − K)·N·DF_USD(T); CRY01, IR01 (discounting) and FUND01 beside the engine's",
     "replication": "xlsx"},
    {"id": "crypto_ndo", "name": "Crypto NDO (European option)", "group": "FX & digital assets", "section": "12",
     "default": "BTC/USD · 10 BTC · 3-month call · strike at the forward · ATM vol from the BTCUSD surface (60% without one) · funding 3%",
     "formula": "Black-76 on the forward F = S·e^(−r_c·T)/DF_USD: C = DF_USD·[F·N(d₁) − K·N(d₂)]; CRY01, IR01 (discounting), FUND01 and vega beside the engine's",
     "replication": "xlsx"},
    {"id": "crypto_option_styles", "name": "Crypto option styles: digital, barrier, touch, double barrier", "group": "FX & digital assets", "section": "13",
     "default": "BTC/USD · 3 months · digitals USD 100k / 1 BTC · the eight single barriers at ±15% with a rebate · touches · double knock-out and knock-in",
     "formula": "the FX option styles' closed forms with the funding rate as the carry (Reiner–Rubinstein; the two-barrier image series); American is a tree",
     "replication": "xlsx"},
    {"id": "xva_rates", "name": "XVA on a swap: Hull-White Monte Carlo, calibration, CSA, waterfall", "group": "Counterparty risk", "section": "9-10",
     "default": "Pay 3.643% on USD 10m for 2y · monthly grid · 200 paths with the engine's own draws (ENGINE) or Excel's (LIVE) · a, σ from the swaption calibration · presets uncollateralised / bilateral 10bd / on-chain 5bd",
     "formula": "r = x + α(t), x stepped exactly; P(t,T) = A·e^(−B·r); V = (K·annuity − (1 − P))·N; C from V(t−δ) by Brownian bridge; EE/ENE/PFE; CVA, DVA, FVA, FBA, SA-CCR EAD → KVA, IM (the 99th percentile move over the margin period) → MVA; RMSE of the fit and a grid around it",
     "replication": "xlsx"},
    {"id": "xva_fx", "name": "XVA on an FX forward: lognormal forward from the pair's surface, CSA, waterfall", "group": "Counterparty risk", "section": "9-10",
     "default": "Buy EUR 10m six months forward at the fair forward · monthly grid · 200 paths with the engine's own draws (ENGINE) or Excel's (LIVE) · σ from the EURUSD surface at K = F · presets uncollateralised / bilateral 10bd / on-chain 5bd",
     "formula": "F_t = F₀·exp(−σ²t/2 + σ·W); V = side·N·(F_t − K)·DF_q(t,T); σ = ATM/RR/BF interpolated to T, Malz smile at Δ = N(½σ√T); C from V(t−δ), the forward bridged in logs a margin period earlier and the trade valued on it; EE/ENE/PFE; CVA, DVA, FVA, FBA, SA-CCR EAD on the FX class (4 %) → KVA, IM (the 99th percentile move over the margin period) → MVA",
     "replication": "xlsx"},
    {"id": "xva_crypto", "name": "XVA on a crypto NDF: lognormal forward from the pair's surface, CSA, waterfall", "group": "Counterparty risk", "section": "9-10",
     "default": "Buy 10 BTC six months forward, USD-settled, at the fair forward · monthly grid · 200 paths (ENGINE or LIVE) · σ from the BTCUSD surface at K = F, or the engine's default without one · presets uncollateralised / bilateral 10bd / on-chain 5bd",
     "formula": "the FX forward's book with the funding rate as the base rate; the add-on of a Group 2a cryptoasset (SCO60.98, 32 %); IM as the percentile move over the margin period",
     "replication": "xlsx"},
    {"id": "xva", "name": "XVA under a CSA: exposure and collateral", "group": "Counterparty risk", "section": "9-10",
     "default": "Monte Carlo MtM paths (HW1F for rates, lognormal forward for FX and digital assets); VM lagged by the MPoR, IM exchanged; E⁺ = max(V − C − IM, 0), E⁻ = min(V − C + IM, 0), PFE 95%",
     "formula": "C(t) = max(V(t−δ) − TH_cp, 0) − max(−V(t−δ) − TH_own, 0), zero below MTA; presets uncollateralised / bilateral 10bd / on-chain 5bd",
     "replication": "doc", "doc": "/docs/xva.md"},
    {"id": "cva", "name": "CVA", "group": "Counterparty risk", "section": None,
     "default": "Counterparty CDS 85bp flat or a term curve, LGD 40%, wrong-way multiplier 1",
     "formula": "CVA = −LGD · Σ EE(t_i) · [Q(t_{i−1}) − Q(t_i)] · P(0,t_i) · WWR, Q(t) = exp(−s·t/LGD)",
     "replication": "doc", "doc": "/docs/xva.md"},
    {"id": "dva", "name": "DVA", "group": "Counterparty risk", "section": None,
     "default": "Own CDS 42bp, own LGD 40%",
     "formula": "DVA = +LGD_own · Σ |ENE(t_i)| · [Q_own(t_{i−1}) − Q_own(t_i)] · P(0,t_i)",
     "replication": "doc", "doc": "/docs/xva.md"},
    {"id": "fva", "name": "FVA and FBA", "group": "Counterparty risk", "section": None,
     "default": "Funding spread 55bp flat or a term curve; benefit at 55% of it",
     "formula": "FVA = −Σ ftp(t_i)·EE(t_i)·Δt·P(0,t_i);  FBA = +Σ ftp(t_i)·fba_ratio·|ENE(t_i)|·Δt·P(0,t_i)",
     "replication": "doc", "doc": "/docs/xva.md"},
    {"id": "kva", "name": "KVA", "group": "Counterparty risk", "section": None,
     "default": "SA-CCR EAD (α 1.4, supervisory duration, margined or unmargined maturity factor), CEM or IMM; 8% × RW; hurdle 12%",
     "formula": "EAD = α·[RC + multiplier·AddOn];  K = 8%·RW_cp·EAD;  KVA = −hurdle · Σ K(t_i)·Δt·P(0,t_i)",
     "replication": "doc", "doc": "/docs/xva.md"},
    {"id": "mva", "name": "MVA", "group": "Counterparty risk", "section": None,
     "default": "IM = the amount the desk sets, held for the life, else the engine's estimate: the 99th percentile fall of the value over the margin period at each date (not ISDA SIMM, which is licensed)",
     "formula": "MVA = −Σ IM(t_i) · max(ftp(t_i) − pickup, 0) · Δt · P(0,t_i)",
     "replication": "doc", "doc": "/docs/xva.md"},
    {"id": "confirm", "name": "On-chain confirmation", "group": "Post-trade", "section": "13",
     "default": "Canonical trade record v2 → keccak256 → EIP-712 signatures by both LEIs → registry on Ethereum",
     "formula": "Verify without us: recompute the hash, recover both signers, read the registry",
     "replication": "verifier", "doc": "https://rijeka.app/verify"},
    {"id": "pnl", "name": "P&L attribution and XVA", "group": "Post-trade", "section": None,
     "default": "Yesterday's mark on yesterday's market → roll the date → cash → each curve by tenor bucket → spot → forward points → residual (on the terms that stood at the previous close) → amendment: NPV(new terms) − NPV(old terms) on today's market → new trades and unwinds; then the XVA reserves' change, netted by the firm's policy",
     "formula": "Sequential full revaluation: rows sum to the total by construction; P&L after XVA = clean P&L − Σ_netted Δ(CVA, DVA, FVA, FBA[, KVA, MVA])",
     "replication": "doc", "doc": "/docs/pnl_attribution.md"},
    {"id": "market_risk", "name": "Market risk: ladder, VaR, stress, limits", "group": "Risk", "section": None,
     "default": "Key-rate IR01 by bump-and-reprice → historical simulation VaR by full revaluation (every trade repriced on each of 2y of observed days; the ladder VaR alongside as the linear comparison) → named stress by full revaluation → limits on any number → backtest: yesterday's VaR against today's clean P&L, Basel traffic light, Kupiec",
     "formula": "P&L_i = Σ_trade [NPV(M + Δ_i) − NPV(M)]·fx; linear: Σ KR01[c,b]·Δ_i[c,b] + Σ spot01[a]·r_i[a]; VaR_q = empirical loss quantile; ES = mean loss beyond; √h horizon",
     "replication": "doc", "doc": "/docs/market_risk.md"},
    {"id": "ccr", "name": "Counterparty credit: netting, real-world PFE, credit limits", "group": "Counterparty risk", "section": None,
     "default": "Netting set on shared paths (HW1F per currency, lognormal per spot; monthly steps sampled as blocks of observed daily changes, the same block for every factor, or Gaussian shocks correlated from public history) → CSA on the netted value → EE, EPE, PFE 95/97.5/99 real-world → limits; the XVA reserves of the risk-neutral run go to the P&L",
     "formula": "x_i = x_{i−1}·e^{−aΔt} + Σ_block Δr (historical) or σ√Δt·z (Gaussian); options on the paths: Bachelier on the path's forward, today's ATM vol flat, physical settlement at expiry; E⁺(t) = max(V − C(t−δ) − IM, 0); PFE_q = quantile_q(E⁺); EPE = mean_{t≤1y} EE; real-world: σ from history, a by policy, zero drift",
     "replication": "doc", "doc": "/docs/ccr.md"},
]

# ── Styling helpers ─────────────────────────────────────────────────────────

H, HF, IN, RJ, MONO = W.F_H, W.FILL_H, W.FILL_IN, W.FILL_RJ, W.F_MONO
_hdr, _widths = W.header, W.widths


@dataclass
class Market:
    valuation_date: date
    curve_id: str
    snapshot_date: Optional[date]
    source: str
    quotes: list            # raw snapshot quotes
    curve: Curve
    vol_quotes: list        # swaption ATM quotes (tenor "ExT", rate bp)
    vol_date: Optional[date]
    fx_vol_quotes: list = field(default_factory=list)   # EURUSD_VOL surface quotes (tenor, quote_type, rate %)
    vol_quotes_by_pair: dict = field(default_factory=dict)   # {pair: surface quotes} for the other pairs (BTCUSD)
    hw1f: Optional[dict] = None                              # the account's stored HW1F calibration: a, sigma_bp, theta, valuation_date


# ── Shared sheets ───────────────────────────────────────────────────────────

def _readme(wb, title, lines, mkt: Market, summary: Optional[list] = None):
    """The book's name and cover notes; the first line describes the default trade. W.finish writes the Cover."""
    lines = [l for l in lines if l]
    W.start(wb, title, lines[1:], mkt, summary=[("Default trade", lines[0])] + list(summary or []))
    return wb.active


def _curve_sheet(wb, mkt: Market):
    ws = wb.create_sheet("Curve")
    ws["A1"] = "Valuation date"; ws["B1"] = mkt.valuation_date; ws["B1"].number_format = "yyyy-mm-dd"; ws["B1"].fill = RJ
    wb.defined_names["ValDate"] = DefinedName("ValDate", attr_text="Curve!$B$1")
    ws["D1"] = "Snapshot quotes (as loaded)"; ws["D1"].font = Font(bold=True)
    _hdr(ws, 2, ["Pillar date", "t (ACT/365)", "DF (Rijeka bootstrap)", "Zero rate (cont.)", "", "Tenor", "Type", "Rate %"])
    pil = [(d, df) for d, df in mkt.curve._df_pillars]
    for i, (d, df) in enumerate(pil, 3):
        ws.cell(row=i, column=1, value=d).number_format = "yyyy-mm-dd"
        ws.cell(row=i, column=2, value=f"=(A{i}-ValDate)/365")
        c = ws.cell(row=i, column=3, value=float(df)); c.fill = RJ; c.number_format = "0.000000000"
        ws.cell(row=i, column=4, value=f"=IF(B{i}>0,-LN(C{i})/B{i},\"\")").number_format = "0.0000%"
    last = 2 + len(pil)
    wb.defined_names["PillarDates"] = DefinedName("PillarDates", attr_text=f"Curve!$A$3:$A${last}")
    wb.defined_names["PillarDF"]    = DefinedName("PillarDF",    attr_text=f"Curve!$C$3:$C${last}")
    for i, q in enumerate([q for q in mkt.quotes if q.get("enabled", True)], 3):
        ws.cell(row=i, column=6, value=q.get("tenor")); ws.cell(row=i, column=7, value=q.get("quote_type"))
        c = ws.cell(row=i, column=8, value=float(q.get("rate"))); c.fill = RJ
    _widths(ws, [14, 12, 22, 16, 3, 8, 12, 10])
    return ws


def DF(date_ref: str) -> str:
    """Excel formula: log-linear DF interpolation at the date in `date_ref`, as pricing/curve.py."""
    i = f"MIN(MATCH({date_ref},PillarDates,1),ROWS(PillarDates)-1)"
    d0, d1 = f"INDEX(PillarDates,{i})", f"INDEX(PillarDates,{i}+1)"
    f0, f1 = f"INDEX(PillarDF,{i})", f"INDEX(PillarDF,{i}+1)"
    frac = f"(({date_ref})-{d0})/({d1}-{d0})"
    return f"IF({date_ref}<=INDEX(PillarDates,1),1,EXP((1-{frac})*LN({f0})+{frac}*LN({f1})))"


def _yf(a: str, b: str, dc: str) -> str:
    basis = {"ACT/360": 2, "ACT/365": 3, "ACT/365F": 3, "30/360": 0, "30E/360": 4}.get(dc.upper(), 2)
    return f"YEARFRAC({a},{b},{basis})"


# ── Products ────────────────────────────────────────────────────────────────

def _spot(val: date) -> date:
    d = val + timedelta(days=2)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def _leg_sheet(wb, name, leg: dict, mkt: Market, rijeka_pv: float, rijeka_rows: list):
    ws = wb.create_sheet(name)
    is_float = leg["leg_type"] == "FLOAT"
    ws["A1"] = f"{leg['direction']} {leg['leg_type']} leg"; ws["A1"].font = Font(bold=True, size=12)
    ws["A2"] = "Notional"; ws["B2"] = leg["notional"]; ws["B2"].fill = IN; ws["B2"].number_format = "#,##0"
    ws["A3"] = "Fixed rate" if not is_float else "Spread"; ws["B3"] = leg.get("fixed_rate", 0) if not is_float else leg.get("spread", 0); ws["B3"].fill = IN; ws["B3"].number_format = "0.0000%"
    ws["A4"] = "Day count"; ws["B4"] = leg["day_count"]
    ws["A5"] = "Frequency"; ws["B5"] = leg["payment_frequency"]
    ws["D2"] = "Leg PV (formulas)"; ws["E2"] = None   # filled below
    ws["D3"] = "Leg PV (Rijeka)"; ws["E3"] = rijeka_pv; ws["E3"].fill = RJ; ws["E3"].number_format = "#,##0.00"
    ws["D4"] = "Difference"; ws["E4"] = "=E2-E3"; ws["E4"].number_format = "#,##0.00"
    W.check(wb, name, f"{leg['direction']} {leg['leg_type']} leg PV", "E2", "E3", 1e-9)
    cols = ["Start", "End", "Payment", "τ (formula)", "DF(start)", "DF(end)", "DF(pay)", "Rate", "Cashflow", "PV", "Rijeka PV"]
    _hdr(ws, 7, cols)
    r0 = 8
    for k, p in enumerate(rijeka_rows):
        r = r0 + k
        for j, v in enumerate([p["start"], p["end"], p["pay"]], 1):
            ws.cell(row=r, column=j, value=v).number_format = "yyyy-mm-dd"
        ws.cell(row=r, column=4, value=f"={_yf(f'A{r}', f'B{r}', leg['day_count'])}").number_format = "0.000000"
        ws.cell(row=r, column=5, value=f"={DF(f'A{r}')}").number_format = "0.000000"
        ws.cell(row=r, column=6, value=f"={DF(f'B{r}')}").number_format = "0.000000"
        ws.cell(row=r, column=7, value=f"={DF(f'C{r}')}").number_format = "0.000000"
        if is_float:
            ws.cell(row=r, column=8, value=f"=(E{r}/F{r}-1)/{_yf(f'A{r}', f'B{r}', 'ACT/360')}+$B$3").number_format = "0.0000%"
        else:
            ws.cell(row=r, column=8, value="=$B$3").number_format = "0.0000%"
        ws.cell(row=r, column=9, value=f"=$B$2*H{r}*D{r}").number_format = "#,##0.00"
        ws.cell(row=r, column=10, value=f"=I{r}*G{r}").number_format = "#,##0.00"
        c = ws.cell(row=r, column=11, value=p["pv"]); c.fill = RJ; c.number_format = "#,##0.00"
    r1 = r0 + len(rijeka_rows) - 1
    ws["E2"] = f"=SUM(J{r0}:J{r1})"; ws["E2"].number_format = "#,##0.00"
    _widths(ws, [12, 12, 12, 12, 11, 11, 11, 10, 14, 14, 14])
    return ws


def _swap_workbook(mkt: Market, *, title, fixed_dc, fixed_freq, float_dc, float_freq, years, fixed_rate, ois_note):
    val, spot = mkt.valuation_date, _spot(mkt.valuation_date)
    mat = date(spot.year + years, spot.month, spot.day)
    legs = [
        {"id": "fixed", "leg_ref": "FIXED", "leg_type": "FIXED", "direction": "PAY", "currency": "USD", "notional": 10_000_000,
         "day_count": fixed_dc, "payment_frequency": fixed_freq, "bdc": "MOD_FOLLOWING", "fixed_rate": fixed_rate,
         "effective_date": spot.isoformat(), "maturity_date": mat.isoformat(), "discount_curve_id": mkt.curve_id, "forecast_curve_id": mkt.curve_id},
        {"id": "float", "leg_ref": "FLOAT", "leg_type": "FLOAT", "direction": "RECEIVE", "currency": "USD", "notional": 10_000_000,
         "day_count": float_dc, "payment_frequency": float_freq, "bdc": "MOD_FOLLOWING", "spread": 0.0,
         "effective_date": spot.isoformat(), "maturity_date": mat.isoformat(), "discount_curve_id": mkt.curve_id, "forecast_curve_id": mkt.curve_id},
    ]
    res = price_swap("default", legs, {mkt.curve_id: mkt.curve}, val)
    wb = Workbook()
    _readme(wb, title, [
        f"Default trade: notional USD 10,000,000, effective {spot} (spot), maturity {mat}, pay {fixed_rate:.2%} {fixed_dc} {fixed_freq.lower()}, "
        f"receive SOFR {float_dc} {float_freq.lower()} flat.",
        "Float coupons are forward rates implied by the discount curve: (DF(start)/DF(end) − 1)/τ_ACT/360 — for a compounded overnight "
        "index this equals the compounded daily rate over the period, so one curve serves for discounting and projection.",
        ois_note,
        f"Rijeka NPV (receive − pay): {res.npv:,.2f}. The Summary sheet recomputes it from the leg sheets.",
    ], mkt)
    _curve_sheet(wb, mkt)
    pvs = {}
    for lr in res.legs:
        rows = [{"start": c.period_start, "end": c.period_end, "pay": c.payment_date, "pv": abs(c.pv)} for c in lr.cashflows if c.cashflow_type == "COUPON"]
        leg = next(l for l in legs if l["leg_ref"] == lr.leg_ref)
        _leg_sheet(wb, f"{lr.leg_ref} leg", leg, mkt, abs(lr.pv), rows)
        pvs[lr.leg_ref] = lr.pv
    ws = wb.create_sheet("Summary", 1)
    ws["A1"] = "NPV (formulas)";      ws["B1"] = "='FLOAT leg'!E2-'FIXED leg'!E2"; ws["B1"].number_format = "#,##0.00"
    ws["A2"] = "NPV (Rijeka engine)"; ws["B2"] = res.npv; ws["B2"].fill = RJ; ws["B2"].number_format = "#,##0.00"
    ws["A3"] = "Difference";          ws["B3"] = "=B1-B2"; ws["B3"].number_format = "#,##0.00"
    ws["A5"] = "Par rate (formulas)"; ws["B5"] = "='FLOAT leg'!E2/SUMPRODUCT('FIXED leg'!D8:D200,'FIXED leg'!G8:G200)/'FIXED leg'!B2"; ws["B5"].number_format = "0.0000%"
    ws["A6"] = "Set the fixed rate on the FIXED leg sheet to the par rate and the NPV goes to zero."
    _widths(ws, [24, 18])
    W.check(wb, "Summary", "NPV (receive − pay)", "B1", "B2", 1e-9)
    W.ticket(wb, "ANALYTICS", [("NPV", "Summary!B1", "#,##0.00", "receive − pay, in USD"), ("PAR RATE", "Summary!B5", "0.0000%", "the fixed rate that zeroes the NPV"),
                               ("FIXED LEG PV", "'FIXED leg'!E2", "#,##0.00", "Σ N·r·τ·DF(pay)"), ("FLOAT LEG PV", "'FLOAT leg'!E2", "#,##0.00", "Σ N·f·τ·DF(pay)")])
    W.ticket(wb, "TERMS", [("NOTIONAL", "'FIXED leg'!B2", "#,##0", "USD"), ("FIXED RATE", "'FIXED leg'!B3", "0.0000%", f"{fixed_dc} {fixed_freq.lower()}"),
                           ("VALUATION DATE", "Curve!B1", "yyyy-mm-dd", "the curve's snapshot date")])
    W.derive(wb, "τ", f"YEARFRAC(start, end, basis) · {fixed_dc} on the fixed leg, {float_dc} on the float leg", "'FIXED leg'!D8", "the first coupon's accrual fraction", "0.000000")
    W.derive(wb, "DF(pay)", "log-linear between the bracketing pillar dates: exp((1−w)·ln DF₀ + w·ln DF₁), w = (pay − d₀)/(d₁ − d₀)", "'FIXED leg'!G8", "pricing/curve.py's interpolation, on calendar-day fractions", "0.000000")
    W.derive(wb, "f (float rate)", "(DF(start)/DF(end) − 1)/τ_ACT/360 + spread", "'FLOAT leg'!H8", "for a compounded overnight index this is the compounded daily rate over the period", "0.0000%")
    W.derive(wb, "cashflow", "N · rate · τ", "'FIXED leg'!I8", "the first fixed coupon", "#,##0.00")
    W.derive(wb, "PV", "cashflow · DF(pay)", "'FIXED leg'!J8", "discounted at the business-day-adjusted payment date", "#,##0.00")
    W.derive(wb, "leg PV", "Σ PV over the coupons", "'FIXED leg'!E2", "", "#,##0.00")
    W.derive(wb, "NPV", "float leg PV − fixed leg PV", "Summary!B1", "we pay fixed, receive float", "#,##0.00")
    W.derive(wb, "par rate", "float leg PV / Σ τ_i·DF(pay_i) / N", "Summary!B5", "the fixed rate at which NPV = 0", "0.0000%")
    return wb, res.npv


def irs_workbook(mkt):   return _swap_workbook(mkt, title="Interest rate swap", fixed_dc="30/360", fixed_freq="SEMI_ANNUAL", float_dc="ACT/360", float_freq="QUARTERLY", years=5, fixed_rate=0.04, ois_note="")
def ois_workbook(mkt):   return _swap_workbook(mkt, title="OIS swap", fixed_dc="ACT/360", fixed_freq="ANNUAL", float_dc="ACT/360", float_freq="ANNUAL", years=2, fixed_rate=0.04,
                                               ois_note="OIS convention: both legs annual ACT/360; the float coupon is the daily-compounded SOFR over the year, which the DF ratio reproduces exactly on the curve's own pillars.")


def swaption_workbook(mkt: Market):
    val = mkt.valuation_date
    vol = next((float(q["rate"]) for q in mkt.vol_quotes if q.get("tenor") == "1Yx5Y"), 90.0)
    pre = price_swaption(10_000_000, 1.0, 5.0, 0.04, vol, True, mkt.curve, 1.0, val)
    F = pre.forward_rate
    res = price_swaption(10_000_000, 1.0, 5.0, F, vol, True, mkt.curve, 1.0, val)
    wb = Workbook()
    _readme(wb, "European swaption", [
        f"Default trade: USD 10m payer, 1y expiry into a 5y annual swap, strike = forward {F:.4%}, ATM normal vol {vol:.1f}bp "
        f"(surface point 1Yx5Y, snapshot {mkt.vol_date}).",
        "Annuity A = Σ τ_i·DF(T_i) over the underlying's annual payment dates; forward F = (DF(T₀) − DF(T_n))/A.",
        "Bachelier (normal) price: V = N·A·σ√T·[d·N(d) + n(d)], d = (F − K)/(σ√T), σ in decimal (bp/10,000). Receiver uses −d.",
        f"Rijeka NPV: {res.npv:,.2f}; forward {res.forward_rate:.4%}; annuity {res.annuity:,.2f}.",
    ], mkt)
    _curve_sheet(wb, mkt)
    ws = wb.create_sheet("Swaption", 1)
    T0 = date(val.year + 1, val.month, val.day)
    ws["A1"] = "Notional"; ws["B1"] = 10_000_000; ws["B1"].fill = IN; ws["B1"].number_format = "#,##0"
    ws["A2"] = "Expiry (years)"; ws["B2"] = 1.0; ws["B2"].fill = IN
    ws["A3"] = "Strike"; ws["B3"] = F; ws["B3"].fill = IN; ws["B3"].number_format = "0.0000%"
    ws["A4"] = "Normal vol (bp)"; ws["B4"] = vol; ws["B4"].fill = IN
    ws["A5"] = "Payer (1) / Receiver (-1)"; ws["B5"] = 1; ws["B5"].fill = IN
    ws["A6"] = "Expiry date"; ws["B6"] = T0; ws["B6"].number_format = "yyyy-mm-dd"
    _hdr(ws, 8, ["Payment date", "τ (ACT/360-ish annual)", "DF", "τ·DF"])
    rows = []
    for k in range(1, 6):
        r = 8 + k; d = date(T0.year + k, T0.month, T0.day); prev = date(T0.year + k - 1, T0.month, T0.day)  # noqa: F841  launch audit: assigned, never used
        ws.cell(row=r, column=1, value=d).number_format = "yyyy-mm-dd"
        ws.cell(row=r, column=2, value=f"=YEARFRAC(DATE(YEAR(A{r})-1,MONTH(A{r}),DAY(A{r})),A{r},2)")
        ws.cell(row=r, column=3, value=f"={DF(f'A{r}')}").number_format = "0.000000"
        ws.cell(row=r, column=4, value=f"=B{r}*C{r}")
        rows.append(r)
    ws["A15"] = "Annuity A"; ws["B15"] = "=SUM(D9:D13)"
    ws["A16"] = "DF(T0)"; ws["B16"] = f"={DF('B6')}"
    ws["A17"] = "Forward F"; ws["B17"] = "=(B16-C13)/B15"; ws["B17"].number_format = "0.0000%"
    ws["A18"] = "σ√T"; ws["B18"] = "=B4/10000*SQRT(B2)"
    ws["A19"] = "d"; ws["B19"] = "=B5*(B17-B3)/B18"
    ws["A20"] = "N(d)"; ws["B20"] = "=NORMSDIST(B19)"
    ws["A21"] = "n(d)"; ws["B21"] = "=NORMDIST(B19,0,1,FALSE)"
    ws["A22"] = "Price (formulas)"; ws["B22"] = "=B1*B15*B18*(B19*B20+B21)"; ws["B22"].number_format = "#,##0.00"
    ws["A23"] = "Price (Rijeka)"; ws["B23"] = res.npv; ws["B23"].fill = RJ; ws["B23"].number_format = "#,##0.00"
    ws["A24"] = "Difference"; ws["B24"] = "=B22-B23"; ws["B24"].number_format = "#,##0.00"
    ws["A26"] = "Rijeka forward"; ws["B26"] = res.forward_rate; ws["B26"].fill = RJ; ws["B26"].number_format = "0.0000%"
    ws["A27"] = "Rijeka annuity (per unit notional)"; ws["B27"] = res.annuity / 10_000_000; ws["B27"].fill = RJ
    ws["A29"] = "Rijeka's engine uses the underlying swap's business-day-adjusted schedule; this sheet uses unadjusted annual dates, so expect a difference of a few dollars per million."
    _widths(ws, [30, 22, 14, 14])
    W.check(wb, "Swaption", "Price (Bachelier, unadjusted annual dates vs the engine's adjusted schedule)", "B22", "B23", 2e-3)
    W.check(wb, "Swaption", "Forward swap rate", "B17", "B26", 2e-3)
    W.ticket(wb, "ANALYTICS", [("PRICE", "Swaption!B22", "#,##0.00", "USD, bought"), ("FORWARD", "Swaption!B17", "0.0000%", "the underlying's par rate at expiry"),
                               ("ANNUITY", "Swaption!B15", "0.000000", "Σ τ·DF over the underlying's payment dates")])
    W.ticket(wb, "TERMS", [("NOTIONAL", "Swaption!B1", "#,##0", "USD"), ("EXPIRY", "Swaption!B2", "0.00", "years"), ("STRIKE", "Swaption!B3", "0.0000%", "at the forward"),
                           ("NORMAL VOL", "Swaption!B4", "0.0", "bp, surface point 1Yx5Y")])
    for sym, notn, ref, note, fmt in [("τ·DF", "τ_i · DF(T_i) per payment date", "Swaption!D9", "annual ACT/360 accrual", "0.000000"),
                                      ("A", "Σ τ_i·DF(T_i)", "Swaption!B15", "the annuity", "0.000000"), ("DF(T₀)", "DF at expiry", "Swaption!B16", "", "0.000000"),
                                      ("F", "(DF(T₀) − DF(T_n)) / A", "Swaption!B17", "the forward swap rate", "0.0000%"), ("σ√T", "σ_bp/10⁴ · √T", "Swaption!B18", "", "0.000000"),
                                      ("d", "±(F − K)/(σ√T)", "Swaption!B19", "+ payer, − receiver", "0.000000"), ("N(d), n(d)", "Φ(d), φ(d)", "Swaption!B20", "", "0.000000"),
                                      ("V", "N·A·σ√T·[d·N(d) + n(d)]", "Swaption!B22", "Bachelier", "#,##0.00")]:
        W.derive(wb, sym, notn, ref, note, fmt)
    return wb, res.npv


def cap_workbook(mkt: Market):
    val = mkt.valuation_date
    res = price_cap(10_000_000, 0.0, 5.0, mkt.curve, val, [], vol_override_bp=85.0)
    K = res.atm_forward
    res = price_cap(10_000_000, K, 5.0, mkt.curve, val, [], vol_override_bp=85.0)
    wb = Workbook()
    _readme(wb, "Interest rate cap", [
        f"Default trade: USD 10m, 5y quarterly cap on SOFR, strike = ATM forward {K:.4%}, flat normal vol 85bp (override, so the "
        "replication does not depend on the cap surface).",
        "Each caplet: forward F = (DF(start)/DF(end) − 1)/τ; price = N·τ·DF(end)·[(F − K)·N(d) + σ√T·n(d)], d = (F − K)/(σ√T), "
        "T = time from the valuation date to the middle of the accrual period on ACT/365F (SOFR fixes in arrears over the period).",
        f"Rijeka NPV: {res.npv:,.2f} over {res.n_caplets} caplets.",
    ], mkt)
    _curve_sheet(wb, mkt)
    ws = wb.create_sheet("Cap", 1)
    ws["A1"] = "Notional"; ws["B1"] = 10_000_000; ws["B1"].fill = IN; ws["B1"].number_format = "#,##0"
    ws["A2"] = "Strike"; ws["B2"] = K; ws["B2"].fill = IN; ws["B2"].number_format = "0.0000%"
    ws["A3"] = "Normal vol (bp)"; ws["B3"] = 85.0; ws["B3"].fill = IN
    ws["D1"] = "Cap PV (formulas)"; ws["E1"] = None
    ws["D2"] = "Cap PV (Rijeka)"; ws["E2"] = res.npv; ws["E2"].fill = RJ; ws["E2"].number_format = "#,##0.00"
    ws["D3"] = "Difference"; ws["E3"] = "=E1-E2"; ws["E3"].number_format = "#,##0.00"
    _hdr(ws, 5, ["Start", "End", "τ", "T to mid-period (y)", "DF(start)", "DF(end)", "Forward", "d", "Caplet PV", "Rijeka PV"])
    r0 = 6
    for k, cp in enumerate(res.caplets):
        r = r0 + k
        _d = lambda x: x if isinstance(x, date) else date.fromisoformat(str(x)[:10])      # real dates, so YEARFRAC needs no coercion
        ws.cell(row=r, column=1, value=_d(cp["start_date"])).number_format = "yyyy-mm-dd"
        ws.cell(row=r, column=2, value=_d(cp["end_date"])).number_format = "yyyy-mm-dd"
        ws.cell(row=r, column=3, value=f"=YEARFRAC(A{r},B{r},2)")
        ws.cell(row=r, column=4, value=f"=MAX((A{r}-ValDate)+(B{r}-A{r})/2,0)/365")
        ws.cell(row=r, column=5, value=f"={DF(f'A{r}')}").number_format = "0.000000"
        ws.cell(row=r, column=6, value=f"={DF(f'B{r}')}").number_format = "0.000000"
        ws.cell(row=r, column=7, value=f"=(E{r}/F{r}-1)/C{r}").number_format = "0.0000%"
        ws.cell(row=r, column=8, value=f"=IF(D{r}>0,(G{r}-$B$2)/($B$3/10000*SQRT(D{r})),0)")
        ws.cell(row=r, column=9, value=f"=IF(D{r}>0,$B$1*C{r}*F{r}*((G{r}-$B$2)*NORMSDIST(H{r})+$B$3/10000*SQRT(D{r})*NORMDIST(H{r},0,1,FALSE)),$B$1*C{r}*F{r}*MAX(G{r}-$B$2,0))").number_format = "#,##0.00"
        c = ws.cell(row=r, column=10, value=cp.get("pv", cp.get("npv", 0.0))); c.fill = RJ; c.number_format = "#,##0.00"
    r1 = r0 + len(res.caplets) - 1
    ws["E1"] = f"=SUM(I{r0}:I{r1})"; ws["E1"].number_format = "#,##0.00"
    _widths(ws, [12, 12, 10, 14, 11, 11, 11, 10, 14, 14])
    W.check(wb, "Cap", "Cap PV (Σ caplets)", "E1", "E2", 1e-6)
    W.ticket(wb, "ANALYTICS", [("CAP PV", "Cap!E1", "#,##0.00", f"Σ of {res.n_caplets} caplets, USD")])
    W.ticket(wb, "TERMS", [("NOTIONAL", "Cap!B1", "#,##0", "USD"), ("STRIKE", "Cap!B2", "0.0000%", "the ATM forward"), ("NORMAL VOL", "Cap!B3", "0.0", "bp, flat override")])
    for sym, notn, ref, note, fmt in [("τ", "YEARFRAC(start, end, ACT/360)", f"Cap!C{r0}", "the first caplet", "0.000000"),
                                      ("T", "time to the middle of the accrual period, ACT/365F", f"Cap!D{r0}", "SOFR fixes in arrears over the period", "0.000000"),
                                      ("F", "(DF(start)/DF(end) − 1)/τ", f"Cap!G{r0}", "", "0.0000%"), ("d", "(F − K)/(σ√T)", f"Cap!H{r0}", "", "0.000000"),
                                      ("caplet", "N·τ·DF(end)·[(F − K)·N(d) + σ√T·n(d)]", f"Cap!I{r0}", "Bachelier call", "#,##0.00"), ("cap", "Σ caplets", "Cap!E1", "", "#,##0.00")]:
        W.derive(wb, sym, notn, ref, note, fmt)
    return wb, res.npv


def _crypto_common(wb, mkt: Market, spot_px: float, btc_rate: float, months: int):
    val = mkt.valuation_date
    T = date(val.year + (val.month + months - 1) // 12, (val.month + months - 1) % 12 + 1, min(val.day, 28))
    ws = wb.create_sheet("Inputs", 1)
    ws["A1"] = "BTC/USD spot"; ws["B1"] = spot_px; ws["B1"].fill = IN; ws["B1"].number_format = "#,##0.00"
    ws["A2"] = "Notional (BTC)"; ws["B2"] = 10; ws["B2"].fill = IN
    ws["A3"] = "Settlement date"; ws["B3"] = T; ws["B3"].number_format = "yyyy-mm-dd"; ws["B3"].fill = IN
    ws["A4"] = "T (ACT/365)"; ws["B4"] = "=(B3-ValDate)/365"
    ws["A5"] = "USD DF(T) from the SOFR curve"; ws["B5"] = f"={DF('B3')}"; ws["B5"].number_format = "0.000000"
    ws["A6"] = "BTC funding rate (cont., p.a.)"; ws["B6"] = btc_rate; ws["B6"].fill = IN; ws["B6"].number_format = "0.00%"
    ws["A7"] = "BTC DF(T) = exp(−r_BTC·T)"; ws["B7"] = "=EXP(-B6*B4)"; ws["B7"].number_format = "0.000000"
    ws["A8"] = "Forward F = S·DF_BTC/DF_USD"; ws["B8"] = "=B1*B7/B5"; ws["B8"].number_format = "#,##0.00"
    ws["A10"] = "The forward is cash-and-carry: F = S·exp((r_USD − r_BTC)·T). Borrow USD at SOFR to buy BTC today, lend the BTC at its funding rate; the forward must repay the USD interest, so positive USD rates put the forward above spot. Set the BTC rate to the lending rate you can actually get."
    _widths(ws, [34, 18])
    return ws, T


def _ref_forward(mkt, spot_px, btc_rate, T):
    t = (T - mkt.valuation_date).days / 365
    return spot_px * math.exp(-btc_rate * t) / mkt.curve.df(T), mkt.curve.df(T), t


def crypto_ndf_workbook(mkt: Market):
    spot_px, r_btc = 65_000.0, 0.03
    wb = Workbook()
    _readme(wb, "Crypto NDF", [
        "Default trade: buy 10 BTC forward, 3 months, USD-settled, strike at the forward (so the NPV is zero on day one). "
        "Change the strike or the spot on the Inputs sheet to see the mark.",
        "NPV = (F − K)·N·DF_USD(T), the same formula as an FX NDF with BTC as the base currency (pricing/currency_forward.py).",
        "The canonical on-chain record for this trade is the CRYPTO_FORWARD product in chain/canonical.py (ISDA Digital Asset Derivatives Definitions vocabulary).",
    ], mkt)
    _curve_sheet(wb, mkt)
    ws, T = _crypto_common(wb, mkt, spot_px, r_btc, 3)
    F, dfT, t = _ref_forward(mkt, spot_px, r_btc, T)
    ws["A12"] = "Strike K"; ws["B12"] = "=B8"; ws["B12"].fill = IN; ws["B12"].number_format = "#,##0.00"
    ws["A13"] = "NPV (formulas) = (F − K)·N·DF_USD"; ws["B13"] = "=(B8-B12)*B2*B5"; ws["B13"].number_format = "#,##0.00"
    ws["A14"] = "Reference forward (Rijeka)"; ws["B14"] = F; ws["B14"].fill = RJ; ws["B14"].number_format = "#,##0.00"
    r = _forward_engine_rows(ws, mkt, base="BTC", quote="USD", S=spot_px, N=10, T=T, base_rate=r_btc, K_cell="B12", npv_cell="B13", k_off=-1000.0, crypto=True, row0=16)
    _widths(ws, [62, 18, 18, 14])
    W.ticket(wb, "ANALYTICS", [("NET NPV", "Inputs!B18", "#,##0.00", "USD, at the yellow strike"), ("CRY01", "Inputs!B19", "#,##0.00", "PV for +1% spot"),
                               ("IR01 (DISC)", "Inputs!B20", "#,##0.0000", "+1bp on the USD curve"), ("FUND01", "Inputs!B21", "#,##0.0000", "+1bp on the funding rate")])
    W.ticket(wb, "MARKET", [("SPOT", "Inputs!B1", "#,##0.00", "USD per BTC"), ("FAIR FORWARD", "Inputs!B8", "#,##0.00", "cash-and-carry"), ("DF USD", "Inputs!B5", "0.000000", "to settlement"),
                            ("FUNDING RATE", "Inputs!B6", "0.00%", "continuous, p.a.")])
    for sym, notn, ref, note, fmt in [("T", "(settlement − valuation)/365", "Inputs!B4", "ACT/365", "0.0000"), ("DF_USD", "from the SOFR curve, log-linear", "Inputs!B5", "", "0.000000"),
                                      ("DF_BTC", "exp(−r_c·T)", "Inputs!B7", "the funding rate as the base rate", "0.000000"), ("F", "S·DF_BTC/DF_USD", "Inputs!B8", "cash-and-carry forward", "#,##0.00"),
                                      ("NPV", "(F − K)·N·DF_USD", "Inputs!B13", "", "#,##0.00"), ("CRY01", "N·S·DF_BTC·1%", "Inputs!B19", "exact: a forward is linear in spot", "#,##0.00"),
                                      ("IR01", "−N·K·[DF_USD·e^(−1bp·T) − DF_USD]", "Inputs!B20", "the discounting curve alone", "#,##0.0000"),
                                      ("FUND01", "N·S·[DF_BTC·e^(−1bp·T) − DF_BTC]", "Inputs!B21", "the funding rate", "#,##0.0000")]:
        W.derive(wb, sym, notn, ref, note, fmt)
    return wb, r.npv


def _forward_engine_rows(ws, mkt: Market, *, base: str, quote: str, S: float, N: float, T: date, base_rate: float, K_cell: str, npv_cell: str,
                         k_off: float, crypto: bool, row0: int):
    """Beneath a forward's formula block: the engine's NPV and sensitivities at an off-market strike, with the
    sheet's closed forms beside them. NPV = N·(S·DF_b − K·DF_q): FX01/CRY01 = N·S·DF_b·1 %; IR01 on the discounting
    curve = −N·K·ΔDF_q for +1bp; the base curve's (FUND01 on a digital asset) = N·S·ΔDF_b for +1bp."""
    t = (T - mkt.valuation_date).days / 365.0
    F = S * math.exp(-base_rate * t) / mkt.curve.df(T)
    K = F + k_off
    r = price_currency_forward(base_currency=base, quote_currency=quote, base_notional=N, forward_rate=K, spot=S, valuation_date=mkt.valuation_date,
                               settlement_date=T, quote_curve=mkt.curve, base_rate=base_rate, direction="BUY")
    ws[K_cell] = K
    delta, fund = ("CRY01", "FUND01") if crypto else ("FX01", f"IR01 BASE ({base})")
    ws.cell(row=row0, column=1, value=f"Engine comparison at K = F {k_off:+,.4g} (the yellow strike above)").font = Font(bold=True)
    _hdr(ws, row0 + 1, ["", "Formulas", "Rijeka engine", "Difference"])
    _ref_cell(ws, row0 + 2, f"NPV ({quote})", f"={npv_cell}", r.npv)
    _ref_cell(ws, row0 + 3, f"{delta}: NPV for +1% spot = N·S·DF_{base}·1%", "=B2*B1*0.01*B7", getattr(r, "spot01", None) if getattr(r, "spot01", None) is not None else r.delta_quote_per_pct)
    _ref_cell(ws, row0 + 4, f"IR01{' (discounting)' if crypto else ' ' + quote + ' curve'}: −N·K·[DF_{quote}·e^(−1bp·T) − DF_{quote}]", f"=-B2*{K_cell}*(B5*EXP(-0.0001*B4)-B5)", r.ir01_disc, "#,##0.0000")
    _ref_cell(ws, row0 + 5, f"{fund}: N·S·[DF_{base}·e^(−1bp·T) − DF_{base}]", "=B2*B1*(B7*EXP(-0.0001*B4)-B7)", r.ir01_base, "#,##0.0000")
    ws.cell(row=row0 + 7, column=1, value=("On a digital asset IR01 is the discounting sensitivity alone and FUND01 the funding rate's; " if crypto else "IR01 is the sum of both curves' rows; ")
            + "a forward is linear in spot, so the +1% row is exact (no gamma).")
    return r


def fx_forward_workbook(mkt: Market):
    spot, r_eur = 1.1133, 0.025
    wb = Workbook()
    _readme(wb, "FX forward", [
        "Default trade: buy EUR 10m three months forward against USD, dealt at the fair forward (so the NPV is zero on day one). "
        "Change the rate K or the spot on the Inputs sheet to see the mark.",
        "Covered interest parity, each currency on its own curve: F = S·DF_EUR(T)/DF_USD(T), NPV_USD = N_EUR·(F − K)·DF_USD(T). "
        "USD discounts off the SOFR curve on the Curve sheet; EUR is discounted flat here at 2.50% (the ECB deposit rate, illustrative) "
        "because the hosted demo carries no EUR OIS curve; on a desk, DF_EUR comes from the €STR curve the same way.",
        "This is the same formula as the crypto NDF with EUR in place of the digital asset (pricing/currency_forward.py). "
        "The canonical on-chain record for this trade is the FX product in chain/canonical.py.",
    ], mkt)
    _curve_sheet(wb, mkt)
    val = mkt.valuation_date
    T = date(val.year + (val.month + 2) // 12, (val.month + 2) % 12 + 1, min(val.day, 28))
    ws = wb.create_sheet("Inputs", 1)
    ws["A1"] = "EUR/USD spot (USD per EUR)"; ws["B1"] = spot; ws["B1"].fill = IN; ws["B1"].number_format = "0.00000"
    ws["A2"] = "Notional (EUR)"; ws["B2"] = 10_000_000; ws["B2"].fill = IN; ws["B2"].number_format = "#,##0"
    ws["A3"] = "Settlement date"; ws["B3"] = T; ws["B3"].number_format = "yyyy-mm-dd"; ws["B3"].fill = IN
    ws["A4"] = "T (ACT/365)"; ws["B4"] = "=(B3-ValDate)/365"
    ws["A5"] = "USD DF(T) from the SOFR curve"; ws["B5"] = f"={DF('B3')}"; ws["B5"].number_format = "0.000000"
    ws["A6"] = "EUR rate (cont., p.a., flat)"; ws["B6"] = r_eur; ws["B6"].fill = IN; ws["B6"].number_format = "0.00%"
    ws["A7"] = "EUR DF(T) = exp(−r_EUR·T)"; ws["B7"] = "=EXP(-B6*B4)"; ws["B7"].number_format = "0.000000"
    ws["A8"] = "Forward F = S·DF_EUR/DF_USD"; ws["B8"] = "=B1*B7/B5"; ws["B8"].number_format = "0.00000"
    ws["A9"] = "Forward points (F − S)·10⁴"; ws["B9"] = "=(B8-B1)*10000"; ws["B9"].number_format = "0.0"
    ws["A11"] = "Rate K (USD per EUR)"; ws["B11"] = "=B8"; ws["B11"].fill = IN; ws["B11"].number_format = "0.00000"
    ws["A12"] = "NPV_USD (formulas) = N·(F − K)·DF_USD"; ws["B12"] = "=B2*(B8-B11)*B5"; ws["B12"].number_format = "#,##0.00"
    t = (T - val).days / 365
    F = spot * math.exp(-r_eur * t) / mkt.curve.df(T)
    ws["A13"] = "Reference forward (Rijeka)"; ws["B13"] = F; ws["B13"].fill = RJ; ws["B13"].number_format = "0.00000"
    ws["A15"] = "Positive USD rates above EUR rates put the forward above spot: borrow USD, buy EUR today, lend EUR; the forward repays the USD interest."
    r = _forward_engine_rows(ws, mkt, base="EUR", quote="USD", S=spot, N=10_000_000, T=T, base_rate=r_eur, K_cell="B11", npv_cell="B12", k_off=-0.0050, crypto=False, row0=17)
    _widths(ws, [62, 18, 18, 14])
    W.ticket(wb, "ANALYTICS", [("NET NPV", "Inputs!B19", "#,##0.00", "USD, at the yellow rate K"), ("FX01", "Inputs!B20", "#,##0.00", "PV for +1% spot"),
                               ("IR01 USD", "Inputs!B21", "#,##0.0000", "+1bp on the USD curve"), ("IR01 EUR", "Inputs!B22", "#,##0.0000", "+1bp on the EUR rate")])
    W.ticket(wb, "MARKET", [("SPOT", "Inputs!B1", "0.00000", "USD per EUR"), ("FAIR FORWARD", "Inputs!B8", "0.00000", "covered interest parity"), ("POINTS", "Inputs!B9", "0.0", "(F − S)·10⁴"),
                            ("DF USD", "Inputs!B5", "0.000000", "to settlement")])
    for sym, notn, ref, note, fmt in [("T", "(settlement − valuation)/365", "Inputs!B4", "ACT/365", "0.0000"), ("DF_USD", "from the SOFR curve, log-linear", "Inputs!B5", "", "0.000000"),
                                      ("DF_EUR", "exp(−r_EUR·T)", "Inputs!B7", "flat here; the €STR curve on a desk", "0.000000"), ("F", "S·DF_EUR/DF_USD", "Inputs!B8", "parity", "0.00000"),
                                      ("NPV", "N·(F − K)·DF_USD", "Inputs!B12", "", "#,##0.00"), ("FX01", "N·S·DF_EUR·1%", "Inputs!B20", "exact: a forward is linear in spot", "#,##0.00"),
                                      ("IR01 USD", "−N·K·[DF_USD·e^(−1bp·T) − DF_USD]", "Inputs!B21", "", "#,##0.0000"), ("IR01 EUR", "N·S·[DF_EUR·e^(−1bp·T) − DF_EUR]", "Inputs!B22", "", "#,##0.0000")]:
        W.derive(wb, sym, notn, ref, note, fmt)
    return wb, r.npv


# ── FX and digital-asset options ───────────────────────────────────────────
# Both option workbooks share the Inputs sheet: spot, the two rates, the dates, the vol, and from
# them the forward to settlement, the quote rate r and the carry b over the time to expiry, exactly
# how pricing/fx_exotic.price_exotic reads its inputs (r = −ln DF_q(T_s)/T_e, b = ln(F/S)/T_e), so
# every style sheet is in the engine's own variables.

FX_SPOT, FX_R_EUR, FX_VOL_DEFAULT, FX_NOTIONAL = 1.1133, 0.025, 0.075, 10_000_000
_NAMES = {"Spot": "B1", "Notl": "B2", "Te": "B5", "Ts": "B6", "DFq": "B7", "Fwd": "B10", "Sigma": "B11", "Rq": "B12", "Bc": "B13", "SqT": "B14", "DFe": "B15", "DFb": "B16"}

# The two option cases: a currency pair (the base currency's rate from its curve, flat here) and a digital
# asset (its funding rate as the base rate, cash-settled the day after expiry). Same formulas, different labels.
FX_CASE = dict(pair="EURUSD", base="EUR", quote="USD", spot=FX_SPOT, base_rate=FX_R_EUR, base_rate_label="EUR rate (cont., p.a., flat)",
               notional=FX_NOTIONAL, vol_default=FX_VOL_DEFAULT, settle_lag=2, spot_fmt="0.00000", barrier_pct=0.05, payout=1_000_000.0, rebate=0.01,
               rate_note="EUR is discounted flat at the yellow rate because the hosted demo carries no EUR OIS curve; on a desk DF_EUR comes from the €STR curve.",
               delta="FX01", funding="IR01 BASE")
CRYPTO_CASE = dict(pair="BTCUSD", base="BTC", quote="USD", spot=65_000.0, base_rate=0.03, base_rate_label="BTC funding rate (cont., p.a.)",
                   notional=10.0, vol_default=0.60, settle_lag=1, spot_fmt="#,##0.00", barrier_pct=0.15, payout=100_000.0, rebate=100.0,
                   rate_note="The funding (lending or staking) rate is the digital asset's base rate: F = S·e^(−r_c·T)/DF_USD, the cash-and-carry forward.",
                   delta="CRY01", funding="FUND01")


def _N(x: str) -> str:
    return f"NORMSDIST({x})"           # the legacy function: Excel 2007, Numbers and Google Sheets read it without a compatibility prompt


def _fx_dates(val: date, settle_lag: int = 2) -> tuple[date, date]:
    exp = date(val.year + (val.month + 2) // 12, (val.month + 2) % 12 + 1, min(val.day, 28))
    while exp.weekday() >= 5:
        exp += timedelta(days=1)
    settle = exp + timedelta(days=settle_lag)
    while settle_lag >= 2 and settle.weekday() >= 5:
        settle += timedelta(days=1)
    return exp, settle


def _fx_vol(mkt: Market, case: dict) -> tuple[float, str]:
    quotes = mkt.fx_vol_quotes if case["pair"] == "EURUSD" else (mkt.vol_quotes_by_pair or {}).get(case["pair"])
    for q in quotes or []:
        if str(q.get("tenor", "")).upper() == "3M" and str(q.get("quote_type", "ATM")).upper() == "ATM" and q.get("rate") is not None:
            return float(q["rate"]) / 100.0, f"the account's {case['pair']} surface, 3M ATM"
    return case["vol_default"], f"a flat desk default (no {case['pair']} surface saved)"


def _fx_inputs(wb, mkt: Market, case: dict = FX_CASE):
    """Inputs sheet and the engine's view of the same numbers (S, F, DF_q to settlement, T_e, σ)."""
    val = mkt.valuation_date
    exp, settle = _fx_dates(val, case["settle_lag"])
    vol, vol_src = _fx_vol(mkt, case)
    base, quote, S, rb, N = case["base"], case["quote"], case["spot"], case["base_rate"], case["notional"]
    ws = wb.create_sheet("Inputs", 1)
    ws["A1"] = f"{base}/{quote} spot ({quote} per {base})"; ws["B1"] = S; ws["B1"].fill = IN; ws["B1"].number_format = case["spot_fmt"]
    ws["A2"] = f"Notional ({base})"; ws["B2"] = N; ws["B2"].fill = IN; ws["B2"].number_format = "#,##0.####"
    ws["A3"] = "Expiry date"; ws["B3"] = exp; ws["B3"].number_format = "yyyy-mm-dd"; ws["B3"].fill = IN
    ws["A4"] = f"Settlement date (expiry + {case['settle_lag']} {'business days' if case['settle_lag'] >= 2 else 'day'})"; ws["B4"] = settle; ws["B4"].number_format = "yyyy-mm-dd"; ws["B4"].fill = IN
    ws["A5"] = "T_e to expiry (ACT/365)"; ws["B5"] = "=(B3-ValDate)/365"
    ws["A6"] = "T_s to settlement (ACT/365)"; ws["B6"] = "=(B4-ValDate)/365"
    ws["A7"] = f"{quote} DF(T_s) from the SOFR curve"; ws["B7"] = f"={DF('B4')}"; ws["B7"].number_format = "0.000000"
    ws["A8"] = case["base_rate_label"]; ws["B8"] = rb; ws["B8"].fill = IN; ws["B8"].number_format = "0.00%"
    ws["A9"] = f"{base} DF(T_s) = exp(−r_{base}·T_s)"; ws["B9"] = "=EXP(-B8*B6)"; ws["B9"].number_format = "0.000000"
    ws["A10"] = f"Forward to settlement F = S·DF_{base}/DF_{quote}"; ws["B10"] = "=B1*B9/B7"; ws["B10"].number_format = case["spot_fmt"]
    ws["A11"] = "Vol σ (lognormal, decimal)"; ws["B11"] = vol; ws["B11"].fill = IN; ws["B11"].number_format = "0.00%"
    ws["A12"] = f"r = −ln DF_{quote}(T_s) / T_e  (the engine's quote rate)"; ws["B12"] = "=-LN(B7)/B5"; ws["B12"].number_format = "0.0000%"
    ws["A13"] = "b = ln(F/S) / T_e  (the engine's carry)"; ws["B13"] = "=LN(B10/B1)/B5"; ws["B13"].number_format = "0.0000%"
    ws["A14"] = "σ√T_e"; ws["B14"] = "=B11*SQRT(B5)"
    ws["A15"] = f"e^(−r·T_e) = DF_{quote}(T_s)"; ws["B15"] = "=EXP(-B12*B5)"; ws["B15"].number_format = "0.000000"
    ws["A16"] = f"e^((b−r)·T_e) = F·DF_{quote}(T_s)/S"; ws["B16"] = "=EXP((B13-B12)*B5)"; ws["B16"].number_format = "0.000000"
    ws["A18"] = (f"Vol source: {vol_src}. The engine applies the smile vol at the strike; at the forward that is the ATM vol, and a barrier or touch "
                 "is valued at the same flat vol across the barrier (methodology §13). Change any yellow cell and every style sheet reprices.")
    ws["A19"] = case["rate_note"]
    for name, ref in _NAMES.items():
        wb.defined_names[name] = DefinedName(name, attr_text=f"Inputs!${ref[0]}${ref[1:]}")
    _widths(ws, [58, 16])
    T_e, T_s = (exp - val).days / 365.0, (settle - val).days / 365.0
    df_s = mkt.curve.df(settle)
    F = S * math.exp(-rb * T_s) / df_s
    return dict(val=val, exp=exp, settle=settle, S=S, N=N, F=F, df=df_s, T_e=T_e, T_s=T_s, vol=vol, base=base, quote=quote, case=case)


_ref_cell = W.ref_cell


def _option_workbook(mkt: Market, case: dict):
    base, quote, crypto = case["base"], case["quote"], case["pair"] != "EURUSD"
    wb = Workbook()
    _readme(wb, "Crypto NDO (European option)" if crypto else "FX option (European)", [
        (f"Default trade: buy a 3-month {base} call / {quote} put on {case['notional']:g} {base}, strike at the forward, "
         + ("cash-settled against the settlement price source the day after expiry (a non-deliverable option in the ISDA Digital Asset Derivatives Definitions' vocabulary)." if crypto
            else "settled two business days after expiry.")),
        (f"{'Black-76' if crypto else 'Garman–Kohlhagen'} on the forward to settlement, discounted in {quote} to settlement: C = DF_{quote}(T_s)·[F·N(d₁) − K·N(d₂)], "
         "d₁ = [ln(F/K) + ½σ²T_e]/(σ√T_e), d₂ = d₁ − σ√T_e; the put from parity (pricing/fx_option.py, methodology §12–13). "
         + ("The digital asset's funding rate is its base rate: one engine with the FX option." if crypto else "")),
        (f"Delta ({case['delta']}): forward delta Φ(d₁) and the spot position in {base} = Φ(d₁)·DF_{quote}·F/S·N. Vega: the engine reprices at σ + 1 point; the analytic "
         "N·DF·F·n(d₁)·√T_e·0.01 is shown beside it (the gap is volga over the one-point move). "
         + ("IR01 on a digital asset is the discounting curve's sensitivity alone; the funding rate's is FUND01." if crypto else "IR01 is the sum of both curves' sensitivities.")),
        case["rate_note"],
        ("The canonical on-chain record is the CRYPTO_OPTION product (NDO) in chain/canonical.py (ISDA Digital Asset Derivatives Definitions fields)." if crypto
         else "The canonical on-chain record is the FX_OPTION product in chain/canonical.py (ISDA FX and Currency Option Definitions fields)."),
    ], mkt)
    _curve_sheet(wb, mkt)
    p = _fx_inputs(wb, mkt, case)
    res = price_fx_option(base_currency=base, quote_currency=quote, base_notional=p["N"], option_type="CALL", strike=p["F"], spot=p["S"], forward=p["F"],
                          df_quote=p["df"], valuation_date=p["val"], expiry_date=p["exp"], settlement_date=p["settle"], vol=p["vol"], direction="BUY",
                          spot_date=None)      # the carry runs from the valuation date here, as the sheet's rate rows do (the note says so)
    ws = wb.create_sheet("European", 2)
    ws["A1"] = f"Strike K ({quote} per {base})"; ws["B1"] = "=Fwd"; ws["B1"].fill = IN; ws["B1"].number_format = case["spot_fmt"]
    ws["A2"] = f"Call (1) / Put (-1) on {base}"; ws["B2"] = 1; ws["B2"].fill = IN
    ws["A3"] = "d₁"; ws["B3"] = "=(LN(Fwd/B1)+0.5*Sigma^2*Te)/SqT"
    ws["A4"] = "d₂"; ws["B4"] = "=B3-SqT"
    ws["A5"] = f"Premium per {base} ({quote})"; ws["B5"] = f"=DFq*B2*(Fwd*{_N('B2*B3')}-B1*{_N('B2*B4')})"; ws["B5"].number_format = "#,##0.000000"
    _hdr(ws, 7, ["", "Formulas", "Rijeka engine", "Difference"])
    _ref_cell(ws, 8, f"Premium total ({quote}) = NPV bought", "=B5*Notl", res.npv)
    _ref_cell(ws, 9, f"Premium in {base}", "=B8/Spot", res.npv / p["S"], "#,##0.000000")
    _ref_cell(ws, 10, "Forward delta Φ(d₁) (put: Φ(d₁) − 1)", f"=IF(B2=1,{_N('B3')},{_N('B3')}-1)", res.forward_delta, "0.000000")
    _ref_cell(ws, 11, f"Spot position ({base}) = fwd delta·DF_{quote}·F/S·N", "=B10*DFq*Fwd/Spot*Notl", res.delta_base_units, "#,##0.0000")
    _ref_cell(ws, 12, f"{case['delta']}: NPV change for +1% spot (repriced)",
              f"=Notl*DFq*B2*(Fwd*1.01*{_N('B2*((LN(Fwd*1.01/B1)+0.5*Sigma^2*Te)/SqT)')}-B1*{_N('B2*((LN(Fwd*1.01/B1)+0.5*Sigma^2*Te)/SqT-SqT)')})-B8", res.spot01)
    ws["A13"] = "Vega analytic per 1 vol pt = N·DF·F·n(d₁)·√T_e·0.01"; ws["B13"] = "=Notl*DFq*Fwd*NORMDIST(B3,0,1,FALSE)*SQRT(Te)*0.01"; ws["B13"].number_format = "#,##0.00"
    d1u = "((LN(Fwd/B1)+0.5*(Sigma+0.01)^2*Te)/((Sigma+0.01)*SQRT(Te)))"
    _ref_cell(ws, 14, "Vega repriced (σ + 1 pt) − premium", f"=Notl*DFq*B2*(Fwd*{_N('B2*' + d1u)}-B1*{_N('B2*(' + d1u + '-(Sigma+0.01)*SQRT(Te))')})-B8", res.vega)
    _ref_cell(ws, 15, f"{'IR01 (discounting, ' + quote + ' +1bp)' if crypto else 'IR01 ' + quote + ' curve (+1bp)'}: F up by the carry, DF down",
              f"=Notl*DFq*EXP(-0.0001*Ts)*B2*(Fwd*EXP(0.0001*(Ts-1/365*0))*{_N('B2*((LN(Fwd*EXP(0.0001*Ts)/B1)+0.5*Sigma^2*Te)/SqT)')}-B1*{_N('B2*((LN(Fwd*EXP(0.0001*Ts)/B1)+0.5*Sigma^2*Te)/SqT-SqT)')})-B8",
              res.ir01_disc, "#,##0.0000")
    _ref_cell(ws, 16, f"{case['funding']} ({base} +1bp): F down by the carry",
              f"=Notl*DFq*B2*(Fwd*EXP(-0.0001*Ts)*{_N('B2*((LN(Fwd*EXP(-0.0001*Ts)/B1)+0.5*Sigma^2*Te)/SqT)')}-B1*{_N('B2*((LN(Fwd*EXP(-0.0001*Ts)/B1)+0.5*Sigma^2*Te)/SqT-SqT)')})-B8",
              res.ir01_base, "#,##0.0000")
    ws["A18"] = f"Put–call parity check: C − P = DF_{quote}·(F − K)·N"; ws["B18"] = f"=Notl*DFq*((Fwd*{_N('B3')}-B1*{_N('B4')})-(B1*{_N('-B4')}-Fwd*{_N('-B3')}))-Notl*DFq*(Fwd-B1)"; ws["B18"].number_format = "0.000000"
    ws["A20"] = ("Sold option: the same numbers with the opposite sign. The premium is a cash flow on its payment date, not part of the value once paid. "
                 "The rate rows assume the carry runs over T_s from the valuation date, as the engine does without a spot lag" + (" (a digital asset settles its spot the next day)." if crypto else "."))
    _widths(ws, [58, 18, 18, 14])
    W.dropdown(ws, "B2", ["1", "-1"])
    delta, fund = case["delta"], case["funding"]
    W.ticket(wb, "ANALYTICS", [("OPTION NPV", "European!B8", "#,##0.00", f"{quote}, bought"), ("DELTA", "European!B11", "#,##0.0000", f"spot position in {base}"),
                               (delta, "European!B12", "#,##0.00", "PV for +1% spot, repriced"), ("VEGA / 1PT", "European!B14", "#,##0.00", "repriced at σ + 1 point"),
                               ("IR01" + (" (DISC)" if crypto else " " + quote), "European!B15", "#,##0.0000", f"+1bp on the {quote} curve"),
                               (fund, "European!B16", "#,##0.0000", "+1bp on the funding rate" if crypto else f"+1bp on the {base} curve"),
                               ("FORWARD DELTA", "European!B10", "0.0%", "Φ(d₁), premium-excluded")])
    W.ticket(wb, "MARKET", [("SPOT", "Inputs!B1", case["spot_fmt"], f"{quote} per {base}"), ("FORWARD TO SETTLEMENT", "Inputs!B10", case["spot_fmt"], "S·DF_b/DF_q"),
                            ("STRIKE", "European!B1", case["spot_fmt"], "at the forward unless changed"), ("VOL", "Inputs!B11", "0.00%", "lognormal, the surface's ATM"),
                            (f"DF {quote}", "Inputs!B7", "0.000000", "to settlement"), ("T_e / T_s", "Inputs!B5", "0.0000", "ACT/365 to expiry; settlement on Inputs!B6")])
    for sym, notn, ref, note, fmt in [("T_e, T_s", "(expiry − valuation)/365, (settlement − valuation)/365", "Inputs!B5", "ACT/365", "0.0000"),
                                      (f"DF_{quote}", "from the SOFR curve to settlement, log-linear", "Inputs!B7", "", "0.000000"),
                                      (f"DF_{base}", f"exp(−r_{base}·T_s)", "Inputs!B9", "the funding rate as the base rate" if crypto else "flat here", "0.000000"),
                                      ("F", f"S·DF_{base}/DF_{quote}", "Inputs!B10", "the forward to settlement", case["spot_fmt"]),
                                      ("r, b", f"−ln DF_{quote}/T_e,  ln(F/S)/T_e", "Inputs!B12", "the engine's quote rate and carry; b on Inputs!B13", "0.0000%"),
                                      ("σ√T_e", "σ·√T_e", "Inputs!B14", "", "0.000000"),
                                      ("d₁", "[ln(F/K) + ½σ²T_e]/(σ√T_e)", "European!B3", "", "0.000000"), ("d₂", "d₁ − σ√T_e", "European!B4", "", "0.000000"),
                                      ("premium / unit", f"DF_{quote}·φ·[F·N(φd₁) − K·N(φd₂)]", "European!B5", "φ = +1 call, −1 put; the put from parity", "#,##0.000000"),
                                      ("NPV", "premium · N", "European!B8", "bought; a sold option carries the opposite sign", "#,##0.00"),
                                      ("forward delta", "Φ(d₁)  (put: Φ(d₁) − 1)", "European!B10", "premium-excluded, the delta the smile is quoted on", "0.0000"),
                                      ("spot position", f"Φ(d₁)·DF_{quote}·F/S·N", "European!B11", f"in {base}", "#,##0.0000"),
                                      (delta, "NPV(F·1.01) − NPV", "European!B12", "the forward moves with spot, the discounting does not", "#,##0.00"),
                                      ("vega", "NPV(σ + 0.01) − NPV", "European!B14", "repriced; the analytic N·DF·F·n(d₁)·√T_e·0.01 on B13", "#,##0.00"),
                                      ("IR01", "NPV(F·e^(1bp·T_s), DF·e^(−1bp·T_s)) − NPV", "European!B15", f"+1bp on the {quote} curve: the forward up by the carry, the discount factor down", "#,##0.0000"),
                                      (fund, "NPV(F·e^(−1bp·T_s)) − NPV", "European!B16", "+1bp on the base rate: the forward down by the carry", "#,##0.0000")]:
        W.derive(wb, sym, notn, ref, note, fmt)
    # Scenario: NPV against spot, by the same closed form, with the payoff at expiry beside it
    sc = wb.create_sheet("Scenario")
    sc["A1"] = "NPV AGAINST SPOT"; sc["A1"].font = W.F_TITLE
    sc["A2"] = "The forward moves one for one with spot; the discounting does not. The payoff line is the option at expiry, discounted."; sc["A2"].font = W.F_SUB
    W.header(sc, 4, ["Spot shock", "Spot", "Forward", "d₁", "d₂", "NPV", "Payoff at expiry (disc.)"])
    for i, sh in enumerate(range(-10, 11, 2)):
        r = 5 + i
        sc.cell(row=r, column=1, value=sh / 100.0).number_format = "0%"
        sc.cell(row=r, column=2, value=f"=Spot*(1+A{r})").number_format = case["spot_fmt"]
        sc.cell(row=r, column=3, value=f"=Fwd*(1+A{r})").number_format = case["spot_fmt"]
        sc.cell(row=r, column=4, value=f"=(LN(C{r}/European!$B$1)+0.5*Sigma^2*Te)/SqT").number_format = "0.0000"
        sc.cell(row=r, column=5, value=f"=D{r}-SqT").number_format = "0.0000"
        sc.cell(row=r, column=6, value=f"=Notl*DFq*European!$B$2*(C{r}*{_N('European!$B$2*D' + str(r))}-European!$B$1*{_N('European!$B$2*E' + str(r))})").number_format = "#,##0"
        sc.cell(row=r, column=7, value=f"=Notl*DFq*MAX(European!$B$2*(C{r}-European!$B$1),0)").number_format = "#,##0"
    W.widths(sc, [12, 14, 14, 10, 10, 16, 22])
    sc.sheet_view.showGridLines = False
    W.scenario(wb, "Scenario", (2, 5, 15), [("NPV", (6, 5, 15)), ("Payoff at expiry", (7, 5, 15))], f"{base} {'call' if True else 'put'} on {case['notional']:g} {base}: NPV vs spot", f"spot ({quote} per {base})", quote)
    return wb, res.npv


def fx_option_workbook(mkt: Market):
    return _option_workbook(mkt, FX_CASE)


def crypto_ndo_workbook(mkt: Market):
    return _option_workbook(mkt, CRYPTO_CASE)


def _styles_workbook(mkt: Market, case: dict):
    base, quote, crypto = case["base"], case["quote"], case["pair"] != "EURUSD"
    wb = Workbook()
    _readme(wb, "Crypto option styles" if crypto else "FX option styles", [
        (f"Default: 3-month {base}/{quote} options on {case['notional']:g} {base} (payouts {quote} {case['payout']:,.0f} or {base} {case['payout'] / (case['spot'] if crypto else 1):g}), "
         f"strike at the forward, barriers {case['barrier_pct']:.0%} either side of spot, rebate {quote} {case['rebate']:g} per {base}."
         + (" The digital asset's funding rate is the carry; settlement in cash the day after expiry." if crypto else "")),
        "Digital (Reiner–Rubinstein): cash-or-nothing Q·e^(−rT)·N(±d₂); a fixed EUR amount is asset-or-nothing Q·S·e^((b−r)T)·N(±d₁); "
        "d₁ = [ln(S/K) + (b + ½σ²)T]/(σ√T).",
        "Single barrier: the Reiner–Rubinstein terms A–F with η (+1 down, −1 up) and φ (+1 call, −1 put), μ = (b − ½σ²)/σ², λ = √(μ² + 2r/σ²); "
        "knock-out rebate paid at the hit (term F), knock-in rebate paid at expiry if never hit (term E) — the engine's convention. "
        "The engine integrates the payoff against the survival density numerically (pricing/fx_exotic.py); the closed forms here are its independent check.",
        "Touch: P(no hit) = N(ηx₂ − ησ√T) − (H/S)^(2μ)·N(ηy₂ − ησ√T); one-touch at expiry Q·e^(−rT)·(1 − P), at the hit Q·F/R (the first-passage value), no-touch Q·e^(−rT)·P.",
        "Double barrier and double touch: the survival density between two barriers is the image series Σₙ [φ(y − 2nW) − φ(y − 2l + 2nW)] with the drift restored "
        "by exp(my/v − m²/2v); integrated against the payoff each image term is a pair of normal probabilities, listed one row per n on the DoubleBarrier sheet "
        "and summed (n = −12…12, as the engine). Knock-in = vanilla − knock-out; double one-touch = Q·e^(−rT) − double no-touch.",
        "American: valued on a Leisen–Reimer tree (801 steps); a tree is not a spreadsheet formula, so its check is QuantLib's (methodology §15), not this workbook.",
        "All values are from the holder's side; a sold option carries the opposite sign.",
    ], mkt)
    _curve_sheet(wb, mkt)
    p = _fx_inputs(wb, mkt, case)
    S, F, N = p["S"], p["F"], p["N"]
    Hup, Hdn, R, Q = round(S * (1 + case["barrier_pct"]), 4), round(S * (1 - case["barrier_pct"]), 4), case["rebate"], case["payout"]
    fmt_px = case["spot_fmt"]
    kw = dict(base_notional=N, spot=S, forward=F, df_quote=p["df"], t_expiry=p["T_e"], vol=p["vol"], direction="BUY")

    def ref(**spec):
        return price_exotic(ExoticSpec(**spec), **kw).npv

    # ── Digital ──
    ws = wb.create_sheet("Digital", 2)
    ws["A1"] = "Strike K"; ws["B1"] = "=Fwd"; ws["B1"].fill = IN; ws["B1"].number_format = fmt_px
    ws["A2"] = f"Payout Q ({quote} for cash-or-nothing; {base} for the {base}-amount digital)"; ws["B2"] = Q; ws["B2"].fill = IN; ws["B2"].number_format = "#,##0"
    ws["A3"] = "d₁ = [ln(S/K) + (b + ½σ²)T_e]/(σ√T_e)"; ws["B3"] = "=(LN(Spot/B1)+(Bc+0.5*Sigma^2)*Te)/SqT"
    ws["A4"] = "d₂ = d₁ − σ√T_e"; ws["B4"] = "=B3-SqT"
    _hdr(ws, 6, ["", "Formulas", "Rijeka engine", "Difference"])
    _ref_cell(ws, 7, "Cash-or-nothing call: Q·e^(−rT)·N(d₂)", f"=B2*DFe*{_N('B4')}", ref(style="DIGITAL", option_type="CALL", strike=F, payout=Q))
    _ref_cell(ws, 8, "Cash-or-nothing put: Q·e^(−rT)·N(−d₂)", f"=B2*DFe*{_N('-B4')}", ref(style="DIGITAL", option_type="PUT", strike=F, payout=Q))
    _ref_cell(ws, 9, f"{base}-amount call (asset-or-nothing): Q·S·e^((b−r)T)·N(d₁)", f"=B2*Spot*DFb*{_N('B3')}", ref(style="DIGITAL", option_type="CALL", strike=F, payout=Q, payout_currency="BASE"))
    _ref_cell(ws, 10, f"{base}-amount put: Q·S·e^((b−r)T)·N(−d₁)", f"=B2*Spot*DFb*{_N('-B3')}", ref(style="DIGITAL", option_type="PUT", strike=F, payout=Q, payout_currency="BASE"))
    ws["A12"] = "Parity: cash call + cash put = Q·e^(−rT)"; ws["B12"] = "=B7+B8-B2*DFe"; ws["B12"].number_format = "0.000000"
    _widths(ws, [62, 18, 18, 14])

    # ── Barrier ──
    ws = wb.create_sheet("Barrier", 3)
    ws["A1"] = "Strike K"; ws["B1"] = "=Fwd"; ws["B1"].fill = IN; ws["B1"].number_format = fmt_px
    ws["A2"] = "Up barrier H (above spot)"; ws["B2"] = Hup; ws["B2"].fill = IN; ws["B2"].number_format = fmt_px
    ws["A3"] = "Down barrier H (below spot)"; ws["B3"] = Hdn; ws["B3"].fill = IN; ws["B3"].number_format = fmt_px
    ws["A4"] = f"Rebate R ({quote} per {base} of notional)"; ws["B4"] = R; ws["B4"].fill = IN; ws["B4"].number_format = "#,##0.0000"
    ws["A5"] = "μ = (b − ½σ²)/σ²"; ws["B5"] = "=(Bc-0.5*Sigma^2)/Sigma^2"
    ws["A6"] = "λ = √(μ² + 2r/σ²)"; ws["B6"] = "=SQRT(B5^2+2*Rq/Sigma^2)"
    cols = ["Type", "φ", "η", "H", "x₁", "x₂", "y₁", "y₂", "z", "A", "B", "C", "D", "E", "F", "Per EUR (formulas)", "Total (formulas)", "Rijeka engine", "Difference"]
    _hdr(ws, 8, cols)
    cases = [("UP_IN", "CALL"), ("UP_IN", "PUT"), ("UP_OUT", "CALL"), ("UP_OUT", "PUT"), ("DOWN_IN", "CALL"), ("DOWN_IN", "PUT"), ("DOWN_OUT", "CALL"), ("DOWN_OUT", "PUT")]
    price_of = {  # (barrier_type, option) → (formula if K > H, formula if K < H), in terms of the row's A..F cells
        ("DOWN_IN", "CALL"): ("C+E", "A-B+D+E"), ("UP_IN", "CALL"): ("A+E", "B-C+D+E"),
        ("DOWN_IN", "PUT"): ("B-C+D+E", "A+E"), ("UP_IN", "PUT"): ("A-B+D+E", "C+E"),
        ("DOWN_OUT", "CALL"): ("A-C+F", "B-D+F"), ("UP_OUT", "CALL"): ("F", "A-B+C-D+F"),
        ("DOWN_OUT", "PUT"): ("A-B+C-D+F", "F"), ("UP_OUT", "PUT"): ("B-D+F", "A-C+F"),
    }
    L = {c: get_column_letter(i + 1) for i, c in enumerate(cols)}
    for k, (bt, ot) in enumerate(cases):
        r = 9 + k
        phi, eta, H = (1 if ot == "CALL" else -1), (-1 if bt.startswith("UP") else 1), ("$B$2" if bt.startswith("UP") else "$B$3")
        ws.cell(row=r, column=1, value=f"{bt.replace('_', '-and-').lower()} {ot.lower()}")
        ws.cell(row=r, column=2, value=phi); ws.cell(row=r, column=3, value=eta)
        ws.cell(row=r, column=4, value=f"={H}").number_format = fmt_px
        P, E_, Hc = f"{L['φ']}{r}", f"{L['η']}{r}", f"{L['H']}{r}"
        ws.cell(row=r, column=5, value="=LN(Spot/$B$1)/SqT+(1+$B$5)*SqT")
        ws.cell(row=r, column=6, value=f"=LN(Spot/{Hc})/SqT+(1+$B$5)*SqT")
        ws.cell(row=r, column=7, value=f"=LN({Hc}^2/(Spot*$B$1))/SqT+(1+$B$5)*SqT")
        ws.cell(row=r, column=8, value=f"=LN({Hc}/Spot)/SqT+(1+$B$5)*SqT")
        ws.cell(row=r, column=9, value=f"=LN({Hc}/Spot)/SqT+$B$6*SqT")
        x1, x2, y1, y2, z = (f"{L[c]}{r}" for c in ("x₁", "x₂", "y₁", "y₂", "z"))
        ws.cell(row=r, column=10, value=f"={P}*Spot*DFb*{_N(P + '*' + x1)}-{P}*$B$1*DFe*{_N(P + '*' + x1 + '-' + P + '*SqT')}")
        ws.cell(row=r, column=11, value=f"={P}*Spot*DFb*{_N(P + '*' + x2)}-{P}*$B$1*DFe*{_N(P + '*' + x2 + '-' + P + '*SqT')}")
        ws.cell(row=r, column=12, value=f"={P}*Spot*DFb*({Hc}/Spot)^(2*($B$5+1))*{_N(E_ + '*' + y1)}-{P}*$B$1*DFe*({Hc}/Spot)^(2*$B$5)*{_N(E_ + '*' + y1 + '-' + E_ + '*SqT')}")
        ws.cell(row=r, column=13, value=f"={P}*Spot*DFb*({Hc}/Spot)^(2*($B$5+1))*{_N(E_ + '*' + y2)}-{P}*$B$1*DFe*({Hc}/Spot)^(2*$B$5)*{_N(E_ + '*' + y2 + '-' + E_ + '*SqT')}")
        ws.cell(row=r, column=14, value=f"=$B$4*DFe*({_N(E_ + '*' + x2 + '-' + E_ + '*SqT')}-({Hc}/Spot)^(2*$B$5)*{_N(E_ + '*' + y2 + '-' + E_ + '*SqT')})")
        ws.cell(row=r, column=15, value=f"=$B$4*(({Hc}/Spot)^($B$5+$B$6)*{_N(E_ + '*' + z)}+({Hc}/Spot)^($B$5-$B$6)*{_N(E_ + '*' + z + '-2*' + E_ + '*$B$6*SqT')})")
        hi, lo = price_of[(bt, ot)]
        term = lambda expr: "".join((("+" if ch == "+" else "-") if ch in "+-" else f"{L[ch]}{r}") for ch in expr)  # noqa: B023  (called within this iteration only)
        ws.cell(row=r, column=16, value=f"=IF($B$1>{Hc},{term(hi)},{term(lo)})").number_format = "0.000000"
        ws.cell(row=r, column=17, value=f"={L['Per EUR (formulas)']}{r}*Notl").number_format = "#,##0.00"
        c = ws.cell(row=r, column=18, value=ref(style="BARRIER", option_type=ot, strike=F, barrier_type=bt, barrier=(Hup if bt.startswith("UP") else Hdn), rebate=R)); c.fill = RJ; c.number_format = "#,##0.00"
        ws.cell(row=r, column=19, value=f"={L['Total (formulas)']}{r}-{L['Rijeka engine']}{r}").number_format = "#,##0.00"
        W.check(wb, "Barrier", f"{bt.replace('_', '-and-').lower()} {ot.lower()} (Reiner–Rubinstein)", f"{L['Total (formulas)']}{r}", f"{L['Rijeka engine']}{r}", 1e-5)
    ws["A18"] = "In + out = vanilla + both rebates' values; move K across H and the IF picks the other branch of each case (Haug, §4.17.1)."
    _widths(ws, [22, 4, 4, 9] + [9] * 5 + [11] * 6 + [16, 16, 16, 12])

    # ── Touch ──
    ws = wb.create_sheet("Touch", 4)
    ws["A1"] = f"Payout Q ({quote})"; ws["B1"] = Q; ws["B1"].fill = IN; ws["B1"].number_format = "#,##0"
    ws["A2"] = "Up barrier H (above spot)"; ws["B2"] = Hup; ws["B2"].fill = IN; ws["B2"].number_format = fmt_px
    ws["A3"] = "Down barrier H (below spot)"; ws["B3"] = Hdn; ws["B3"].fill = IN; ws["B3"].number_format = fmt_px
    ws["A4"] = "μ"; ws["B4"] = "=(Bc-0.5*Sigma^2)/Sigma^2"
    ws["A5"] = "λ"; ws["B5"] = "=SQRT(B4^2+2*Rq/Sigma^2)"
    _hdr(ws, 7, ["Barrier", "η", "H", "x₂ − σ√T", "y₂ − σ√T", "z", "P(no hit)", "First-passage value per USD", "", "", "", ""])
    for k, (lab, eta, H) in enumerate((("up", -1, "$B$2"), ("down", 1, "$B$3"))):
        r = 8 + k
        ws.cell(row=r, column=1, value=lab); ws.cell(row=r, column=2, value=eta); ws.cell(row=r, column=3, value=f"={H}").number_format = fmt_px
        ws.cell(row=r, column=4, value=f"=LN(Spot/C{r})/SqT+$B$4*SqT")
        ws.cell(row=r, column=5, value=f"=LN(C{r}/Spot)/SqT+$B$4*SqT")
        ws.cell(row=r, column=6, value=f"=LN(C{r}/Spot)/SqT+$B$5*SqT")
        ws.cell(row=r, column=7, value=f"={_N(f'B{r}*D{r}')}-(C{r}/Spot)^(2*$B$4)*{_N(f'B{r}*E{r}')}").number_format = "0.000000"
        ws.cell(row=r, column=8, value=f"=(C{r}/Spot)^($B$4+$B$5)*{_N(f'B{r}*F{r}')}+(C{r}/Spot)^($B$4-$B$5)*{_N(f'B{r}*F{r}-2*B{r}*$B$5*SqT')}").number_format = "0.000000"
    _hdr(ws, 11, ["", "Formulas", "Rijeka engine", "Difference"])
    rows = [("One-touch up, paid at the hit: Q·first-passage", "=B1*H8", dict(touch_type="ONE_TOUCH", barrier=Hup, pay_at_hit=True)),
            ("One-touch up, paid at expiry: Q·e^(−rT)·(1 − P)", "=B1*DFe*(1-G8)", dict(touch_type="ONE_TOUCH", barrier=Hup)),
            ("No-touch up: Q·e^(−rT)·P", "=B1*DFe*G8", dict(touch_type="NO_TOUCH", barrier=Hup)),
            ("One-touch down, paid at the hit", "=B1*H9", dict(touch_type="ONE_TOUCH", barrier=Hdn, pay_at_hit=True)),
            ("One-touch down, paid at expiry", "=B1*DFe*(1-G9)", dict(touch_type="ONE_TOUCH", barrier=Hdn)),
            ("No-touch down", "=B1*DFe*G9", dict(touch_type="NO_TOUCH", barrier=Hdn))]
    for k, (lab, f, spec) in enumerate(rows):
        _ref_cell(ws, 12 + k, lab, f, ref(style="TOUCH", payout=Q, **spec))
    ws["A19"] = "The double touches are on the DoubleBarrier sheet (they need the two-barrier series)."
    _widths(ws, [52, 18, 18, 14, 12, 12, 12, 26])

    # ── Double barrier (image series) ──
    ws = wb.create_sheet("DoubleBarrier", 5)
    Lo, Up = Hdn, Hup
    ws["A1"] = "Strike K"; ws["B1"] = "=Fwd"; ws["B1"].fill = IN; ws["B1"].number_format = fmt_px
    ws["A2"] = "Lower barrier L"; ws["B2"] = Lo; ws["B2"].fill = IN; ws["B2"].number_format = fmt_px
    ws["A3"] = "Upper barrier U"; ws["B3"] = Up; ws["B3"].fill = IN; ws["B3"].number_format = fmt_px
    ws["A4"] = f"Touch payout Q ({quote})"; ws["B4"] = Q; ws["B4"].fill = IN; ws["B4"].number_format = "#,##0"
    ws["A5"] = "l = ln(L/S)"; ws["B5"] = "=LN(B2/Spot)"
    ws["A6"] = "u = ln(U/S)"; ws["B6"] = "=LN(B3/Spot)"
    ws["A7"] = "W = u − l"; ws["B7"] = "=B6-B5"
    ws["A8"] = "k = ln(K/S)"; ws["B8"] = "=LN(B1/Spot)"
    ws["A9"] = "m = (b − ½σ²)·T_e"; ws["B9"] = "=(Bc-0.5*Sigma^2)*Te"
    ws["A10"] = "v = σ²·T_e"; ws["B10"] = "=Sigma^2*Te"
    ws["A11"] = "s = √v"; ws["B11"] = "=SQRT(B10)"
    ws["A12"] = "call integrates over (max(l,k), u); put over (l, min(u,k))"
    hdr = ["n", "c₁ = 2nW", "c₂ = 2l − 2nW", "Call term(c₁)", "Call term(c₂)", "Put term(c₁)", "Put term(c₂)", "Survival(c₁)", "Survival(c₂)"]
    _hdr(ws, 14, hdr)
    G = lambda x, c: _N(f"(({x})-({c})-$B$9)/$B$11")
    G1 = lambda x, c: _N(f"(({x})-({c})-$B$9-$B$10)/$B$11")
    def call_term(c):
        a = "MAX($B$5,$B$8)"
        return f"IF({a}<$B$6,EXP($B$9*({c})/$B$10)*(Spot*EXP(({c})+$B$9+$B$10/2)*({G1('$B$6', c)}-{G1(a, c)})-$B$1*({G('$B$6', c)}-{G(a, c)})),0)"
    def put_term(c):
        bb = "MIN($B$6,$B$8)"
        return f"IF({bb}>$B$5,EXP($B$9*({c})/$B$10)*($B$1*({G(bb, c)}-{G('$B$5', c)})-Spot*EXP(({c})+$B$9+$B$10/2)*({G1(bb, c)}-{G1('$B$5', c)})),0)"
    def surv_term(c):
        return f"EXP($B$9*({c})/$B$10)*({G('$B$6', c)}-{G('$B$5', c)})"
    r0 = 15
    for k, n in enumerate(range(-12, 13)):
        r = r0 + k
        ws.cell(row=r, column=1, value=n)
        ws.cell(row=r, column=2, value=f"=2*A{r}*$B$7"); ws.cell(row=r, column=3, value=f"=2*$B$5-2*A{r}*$B$7")
        ws.cell(row=r, column=4, value="=" + call_term(f"B{r}")); ws.cell(row=r, column=5, value="=" + call_term(f"C{r}"))
        ws.cell(row=r, column=6, value="=" + put_term(f"B{r}")); ws.cell(row=r, column=7, value="=" + put_term(f"C{r}"))
        ws.cell(row=r, column=8, value="=" + surv_term(f"B{r}")); ws.cell(row=r, column=9, value="=" + surv_term(f"C{r}"))
    r1 = r0 + 24
    s_ = lambda col: f"SUM({col}{r0}:{col}{r1})"
    ws["K1"] = "Vanilla call per EUR (Garman–Kohlhagen)"; ws["L1"] = f"=DFq*(Fwd*{_N('(LN(Fwd/B1)+0.5*Sigma^2*Te)/SqT')}-B1*{_N('(LN(Fwd/B1)-0.5*Sigma^2*Te)/SqT')})"
    ws["K2"] = "Vanilla put per EUR"; ws["L2"] = "=L1-DFq*(Fwd-B1)"
    for j, h in enumerate(["Formulas", "Rijeka engine", "Difference"], 12):      # row 4, columns L–N only (B4 is the touch payout)
        c = ws.cell(row=4, column=j, value=h); c.font = H; c.fill = HF; c.alignment = Alignment(horizontal="center")
    def ref2(label, row, formula, value):
        ws.cell(row=row, column=11, value=label); ws.cell(row=row, column=12, value=formula).number_format = "#,##0.00"
        c = ws.cell(row=row, column=13, value=value); c.fill = RJ; c.number_format = "#,##0.00"
        ws.cell(row=row, column=14, value=f"=L{row}-M{row}").number_format = "#,##0.00"
        W.check(wb, "DoubleBarrier", label, f"L{row}", f"M{row}", 1e-5)
    ref2("Double knock-out call: e^(−rT)·Σ(call c₁ − call c₂)·N", 5, f"=DFe*({s_('D')}-{s_('E')})*Notl", ref(style="DOUBLE_BARRIER", option_type="CALL", strike=F, barrier_type="KNOCK_OUT", lower=Lo, upper=Up))
    ref2("Double knock-in call = vanilla − knock-out", 6, "=L1*Notl-L5", ref(style="DOUBLE_BARRIER", option_type="CALL", strike=F, barrier_type="KNOCK_IN", lower=Lo, upper=Up))
    ref2("Double knock-out put", 7, f"=DFe*({s_('F')}-{s_('G')})*Notl", ref(style="DOUBLE_BARRIER", option_type="PUT", strike=F, barrier_type="KNOCK_OUT", lower=Lo, upper=Up))
    ref2("Double knock-in put = vanilla − knock-out", 8, "=L2*Notl-L7", ref(style="DOUBLE_BARRIER", option_type="PUT", strike=F, barrier_type="KNOCK_IN", lower=Lo, upper=Up))
    ref2("Double no-touch: Q·e^(−rT)·Σ(survival c₁ − survival c₂)", 9, f"=B4*DFe*({s_('H')}-{s_('I')})", ref(style="TOUCH", touch_type="DOUBLE_NO_TOUCH", payout=Q, lower=Lo, upper=Up))
    ref2("Double one-touch = Q·e^(−rT) − double no-touch", 10, "=B4*DFe-L9", ref(style="TOUCH", touch_type="DOUBLE_ONE_TOUCH", payout=Q, lower=Lo, upper=Up))
    ws["K12"] = "Each row n is one image of the two-barrier reflection; the sum converges in a handful of terms at these widths (Ikeda–Kunitomo, 1992)."
    _widths(ws, [6, 12, 12, 14, 14, 14, 14, 13, 13, 2, 50, 18, 18, 14])
    W.ticket(wb, "DIGITAL", [("CASH CALL", "Digital!B7", "#,##0.00", f"pays Q {quote} above the strike"), ("CASH PUT", "Digital!B8", "#,##0.00", ""),
                             (f"{base}-AMOUNT CALL", "Digital!B9", "#,##0.00", "asset-or-nothing"), (f"{base}-AMOUNT PUT", "Digital!B10", "#,##0.00", "")])
    W.ticket(wb, "BARRIER (total, formulas)", [(f"{bt.replace('_', '-and-').lower()} {ot.lower()}", f"Barrier!Q{9 + k}", "#,##0.00", "Reiner–Rubinstein") for k, (bt, ot) in enumerate(cases)])
    W.ticket(wb, "TOUCH", [(lab, f"Touch!B{12 + k}", "#,##0.00", "") for k, (lab, _, _) in enumerate(rows)])
    W.ticket(wb, "DOUBLE BARRIER", [("KNOCK-OUT CALL", "DoubleBarrier!L5", "#,##0.00", "image series"), ("KNOCK-IN CALL", "DoubleBarrier!L6", "#,##0.00", "vanilla − knock-out"),
                                    ("KNOCK-OUT PUT", "DoubleBarrier!L7", "#,##0.00", ""), ("KNOCK-IN PUT", "DoubleBarrier!L8", "#,##0.00", ""),
                                    ("DOUBLE NO-TOUCH", "DoubleBarrier!L9", "#,##0.00", "Q·e^(−rT)·P(no exit)"), ("DOUBLE ONE-TOUCH", "DoubleBarrier!L10", "#,##0.00", "Q·e^(−rT) − DNT")])
    for sym, notn, ref_, note, fmt in [("r, b", f"−ln DF_{quote}/T_e,  ln(F/S)/T_e", "Inputs!B12", "the engine's quote rate and carry (b on Inputs!B13)", "0.0000%"),
                                       ("d₁, d₂ (digital)", "[ln(S/K) + (b + ½σ²)T]/(σ√T), d₁ − σ√T", "Digital!B3", "", "0.000000"),
                                       ("cash digital", "Q·e^(−rT)·N(±d₂)", "Digital!B7", "cash-or-nothing", "#,##0.00"),
                                       (f"{base}-amount digital", "Q·S·e^((b−r)T)·N(±d₁)", "Digital!B9", "asset-or-nothing", "#,##0.00"),
                                       ("μ", "(b − ½σ²)/σ²", "Barrier!B5", "Reiner–Rubinstein", "0.000000"), ("λ", "√(μ² + 2r/σ²)", "Barrier!B6", "", "0.000000"),
                                       ("x₁, x₂, y₁, y₂, z", "ln(S/K)/σ√T + (1+μ)σ√T, ln(S/H)/σ√T + (1+μ)σ√T, ln(H²/SK)/σ√T + (1+μ)σ√T, ln(H/S)/σ√T + (1+μ)σ√T, ln(H/S)/σ√T + λσ√T", "Barrier!E9", "the first case's row; the others follow", "0.000000"),
                                       ("A … F", "the six Reiner–Rubinstein terms with φ (call/put) and η (down/up)", "Barrier!J9", "A on J9 … F on O9", "0.000000"),
                                       ("barrier price", "the case's combination of A–F, by K against H", "Barrier!P9", "Haug §4.17.1 table; × N on the next column", "0.000000"),
                                       ("P(no hit)", "N(ηx₂ − ησ√T) − (H/S)^(2μ)·N(ηy₂ − ησ√T)", "Touch!G8", "survival to expiry, up barrier", "0.000000"),
                                       ("first-passage value", "(H/S)^(μ+λ)·N(ηz) + (H/S)^(μ−λ)·N(ηz − 2ηλσ√T)", "Touch!H8", "one unit paid at the hit", "0.000000"),
                                       ("m, v", "(b − ½σ²)·T, σ²·T", "DoubleBarrier!B9", "the log-return's drift and variance (v on B10)", "0.000000"),
                                       ("image term", "e^(m·c/v)·[S·e^(c+m+v/2)·(N(…) − N(…)) − K·(N(…) − N(…))] for the image c = 2nW", "DoubleBarrier!D15", "n = −12 … 12, one row each", "0.000000"),
                                       ("knock-out", "e^(−rT)·Σₙ(term(c₁) − term(c₂))·N", "DoubleBarrier!L5", "", "#,##0.00"),
                                       ("double no-touch", "Q·e^(−rT)·Σₙ(survival(c₁) − survival(c₂))", "DoubleBarrier!L9", "", "#,##0.00")]:
        W.derive(wb, sym, notn, ref_, note, fmt)
    return wb, ref(style="DOUBLE_BARRIER", option_type="CALL", strike=F, barrier_type="KNOCK_OUT", lower=Lo, upper=Up)


def fx_option_styles_workbook(mkt: Market):
    return _styles_workbook(mkt, FX_CASE)


def crypto_option_styles_workbook(mkt: Market):
    return _styles_workbook(mkt, CRYPTO_CASE)


def xva_rates_workbook(mkt):
    from methodology.xva_workbook import xva_rates_workbook as _b
    return _b(mkt)


def xva_fx_workbook(mkt):
    from methodology.fx_xva_workbook import xva_fx_workbook as _b
    return _b(mkt)


def xva_crypto_workbook(mkt):
    from methodology.fx_xva_workbook import xva_crypto_workbook as _b
    return _b(mkt)


BUILDERS = {"irs": irs_workbook, "ois": ois_workbook, "swaption": swaption_workbook, "cap": cap_workbook, "xva_rates": xva_rates_workbook,
            "fx_forward": fx_forward_workbook, "fx_option": fx_option_workbook, "fx_option_styles": fx_option_styles_workbook,
            "crypto_ndf": crypto_ndf_workbook, "crypto_ndo": crypto_ndo_workbook, "crypto_option_styles": crypto_option_styles_workbook,
            "xva_fx": xva_fx_workbook, "xva_crypto": xva_crypto_workbook}


def build(product: str, mkt: Market) -> tuple[bytes, float]:
    wb, ref = BUILDERS[product](mkt)
    W.finish(wb)
    bio = io.BytesIO(); wb.save(bio)
    return bio.getvalue(), ref
