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
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName

from pricing.curve import Curve
from pricing.schedule import generate_schedule
from pricing.ir_swap import price_swap
from pricing.swaption import price_swaption
from pricing.cap_floor import price_cap, bachelier_call

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
    {"id": "crypto_ndf", "name": "Crypto NDF", "group": "Digital assets", "section": "12",
     "default": "BTC/USD · 10 BTC · 3-month non-deliverable forward · strike at the forward",
     "formula": "F = S·DF_USD(T)/DF_BTC(T) (covered interest parity with a BTC funding rate); NPV = (F − K)·N·DF_USD(T)",
     "replication": "xlsx"},
    {"id": "crypto_ndo", "name": "Crypto NDO (European option)", "group": "Digital assets", "section": "12",
     "default": "BTC/USD · 10 BTC · 3-month call · strike at the forward · 60% lognormal vol",
     "formula": "Black-76: C = DF·[F·N(d₁) − K·N(d₂)], d₁ = [ln(F/K) + ½σ²T]/(σ√T), d₂ = d₁ − σ√T",
     "replication": "xlsx"},
    {"id": "xva", "name": "XVA under a CSA", "group": "Counterparty risk", "section": "9-10",
     "default": "Monte Carlo on a Hull-White 1-factor model calibrated to the swaption surface; VM/IM with MPoR",
     "formula": "CVA = LGD·Σ EE(t_i)·ΔPD_i·DF(t_i); exposure lagged by the margin period of risk; IM from SIMM scaled √(MPoR/10)",
     "replication": "doc", "doc": "/model_validation/v0.4.2_Sprint6B/rijeka_model_validation_v1.pdf"},
    {"id": "simm", "name": "ISDA SIMM initial margin", "group": "Counterparty risk", "section": "9.3",
     "default": "Delta/vega sensitivities per risk class, aggregated with ISDA correlations",
     "formula": "IM = Σ_classes √(Σ_b K_b² + Σ_b Σ_c≠b γ_bc S_b S_c); see the trace workbook",
     "replication": "xlsx-static", "doc": "https://rijeka.app/simm_trace_sample.xlsx"},
    {"id": "confirm", "name": "On-chain confirmation", "group": "Post-trade", "section": "13",
     "default": "Canonical trade record v2 → keccak256 → EIP-712 signatures by both LEIs → registry on Ethereum",
     "formula": "Verify without us: recompute the hash, recover both signers, read the registry",
     "replication": "verifier", "doc": "https://rijeka.app/verify"},
]

# ── Styling helpers ─────────────────────────────────────────────────────────

H = Font(bold=True, color="FFFFFF"); HF = PatternFill("solid", fgColor="0B3D34")
IN = PatternFill("solid", fgColor="FFF4D6")      # inputs the reader may change
RJ = PatternFill("solid", fgColor="E6F4F1")      # Rijeka reference values
MONO = Font(name="Consolas")


def _hdr(ws, row, cols):
    for i, c in enumerate(cols, 1):
        cell = ws.cell(row=row, column=i, value=c); cell.font = H; cell.fill = HF
        cell.alignment = Alignment(horizontal="center")


def _widths(ws, widths):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


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


# ── Shared sheets ───────────────────────────────────────────────────────────

def _readme(wb, title, lines, mkt: Market):
    ws = wb.active; ws.title = "README"
    ws["A1"] = f"Rijeka · {title} · Excel replication"; ws["A1"].font = Font(bold=True, size=14)
    rows = [
        "What this is: the default trade rebuilt with live Excel formulas from the market data Rijeka used, "
        "beside the value Rijeka's engine produced. Change a yellow input and the sheet reprices.",
        f"Market data: {mkt.curve_id} snapshot {mkt.snapshot_date} ({mkt.source}); valuation date {mkt.valuation_date}.",
        "Curve sheet: pillar dates and discount factors from Rijeka's OIS bootstrap (pricing/bootstrap.py). "
        "Every DF used elsewhere is interpolated log-linearly between bracketing pillar dates, exactly as pricing/curve.py does.",
        "Colour key: yellow = input you may change · green = Rijeka engine value for comparison · white = formula.",
        "Day counts: ACT/360 = YEARFRAC(…, 2); 30/360 bond basis ≈ YEARFRAC(…, 0) (differs only on end-of-February dates).",
        "Business-day adjustment and payment dates are taken from Rijeka's schedule generator as values.",
        "Each coupon is discounted at its business-day-adjusted payment date, in the sheet and in the engine alike.",
        "", *lines, "",
        "Source: github.com/MikoDevedzic/rijeka · backend/methodology/replicate.py. Apache-2.0.",
    ]
    for i, t in enumerate(rows, 3):
        ws.cell(row=i, column=1, value=t).alignment = Alignment(wrap_text=True, vertical="top")
    ws.column_dimensions["A"].width = 120
    return ws


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
        r = 8 + k; d = date(T0.year + k, T0.month, T0.day); prev = date(T0.year + k - 1, T0.month, T0.day)
        ws.cell(row=r, column=1, value=d).number_format = "yyyy-mm-dd"
        ws.cell(row=r, column=2, value=f"=YEARFRAC(DATE(YEAR(A{r})-1,MONTH(A{r}),DAY(A{r})),A{r},2)")
        ws.cell(row=r, column=3, value=f"={DF(f'A{r}')}").number_format = "0.000000"
        ws.cell(row=r, column=4, value=f"=B{r}*C{r}")
        rows.append(r)
    ws["A15"] = "Annuity A"; ws["B15"] = f"=SUM(D9:D13)"
    ws["A16"] = "DF(T0)"; ws["B16"] = f"={DF('B6')}"
    ws["A17"] = "Forward F"; ws["B17"] = "=(B16-C13)/B15"; ws["B17"].number_format = "0.0000%"
    ws["A18"] = "σ√T"; ws["B18"] = "=B4/10000*SQRT(B2)"
    ws["A19"] = "d"; ws["B19"] = "=B5*(B17-B3)/B18"
    ws["A20"] = "N(d)"; ws["B20"] = "=NORM.S.DIST(B19,TRUE)"
    ws["A21"] = "n(d)"; ws["B21"] = "=NORM.S.DIST(B19,FALSE)"
    ws["A22"] = "Price (formulas)"; ws["B22"] = "=B1*B15*B18*(B19*B20+B21)"; ws["B22"].number_format = "#,##0.00"
    ws["A23"] = "Price (Rijeka)"; ws["B23"] = res.npv; ws["B23"].fill = RJ; ws["B23"].number_format = "#,##0.00"
    ws["A24"] = "Difference"; ws["B24"] = "=B22-B23"; ws["B24"].number_format = "#,##0.00"
    ws["A26"] = "Rijeka forward"; ws["B26"] = res.forward_rate; ws["B26"].fill = RJ; ws["B26"].number_format = "0.0000%"
    ws["A27"] = "Rijeka annuity (per unit notional)"; ws["B27"] = res.annuity / 10_000_000; ws["B27"].fill = RJ
    ws["A29"] = "Rijeka's engine uses the underlying swap's business-day-adjusted schedule; this sheet uses unadjusted annual dates, so expect a difference of a few dollars per million."
    _widths(ws, [30, 22, 14, 14])
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
        "Each caplet: forward F = (DF(start)/DF(end) − 1)/τ; price = N·τ·DF(end)·[(F − K)·N(d) + σ√T·n(d)], d = (F − K)/(σ√T), T = time to fixing.",
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
    _hdr(ws, 5, ["Start", "End", "τ", "T to fixing (y)", "DF(start)", "DF(end)", "Forward", "d", "Caplet PV", "Rijeka PV"])
    r0 = 6
    for k, cp in enumerate(res.caplets):
        r = r0 + k
        ws.cell(row=r, column=1, value=cp["start_date"]).number_format = "yyyy-mm-dd"
        ws.cell(row=r, column=2, value=cp["end_date"]).number_format = "yyyy-mm-dd"
        ws.cell(row=r, column=3, value=f"=YEARFRAC(A{r},B{r},2)")
        ws.cell(row=r, column=4, value=f"=(A{r}-ValDate)/365")
        ws.cell(row=r, column=5, value=f"={DF(f'A{r}')}").number_format = "0.000000"
        ws.cell(row=r, column=6, value=f"={DF(f'B{r}')}").number_format = "0.000000"
        ws.cell(row=r, column=7, value=f"=(E{r}/F{r}-1)/C{r}").number_format = "0.0000%"
        ws.cell(row=r, column=8, value=f"=IF(D{r}>0,(G{r}-$B$2)/($B$3/10000*SQRT(D{r})),0)")
        ws.cell(row=r, column=9, value=f"=IF(D{r}>0,$B$1*C{r}*F{r}*((G{r}-$B$2)*NORM.S.DIST(H{r},TRUE)+$B$3/10000*SQRT(D{r})*NORM.S.DIST(H{r},FALSE)),$B$1*C{r}*F{r}*MAX(G{r}-$B$2,0))").number_format = "#,##0.00"
        c = ws.cell(row=r, column=10, value=cp.get("pv", cp.get("npv", 0.0))); c.fill = RJ; c.number_format = "#,##0.00"
    r1 = r0 + len(res.caplets) - 1
    ws["E1"] = f"=SUM(I{r0}:I{r1})"; ws["E1"].number_format = "#,##0.00"
    _widths(ws, [12, 12, 10, 14, 11, 11, 11, 10, 14, 14])
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
        "NPV = (F − K)·N·DF_USD(T), the same formula as an FX NDF with BTC as the foreign currency (pricing/fx_forward.py).",
        "The canonical on-chain record for this trade is the CRYPTO_FORWARD product in chain/canonical.py (ISDA Digital Asset Derivatives Definitions vocabulary).",
    ], mkt)
    _curve_sheet(wb, mkt)
    ws, T = _crypto_common(wb, mkt, spot_px, r_btc, 3)
    F, dfT, t = _ref_forward(mkt, spot_px, r_btc, T)
    ws["A12"] = "Strike K"; ws["B12"] = "=B8"; ws["B12"].fill = IN; ws["B12"].number_format = "#,##0.00"
    ws["A13"] = "NPV (formulas) = (F − K)·N·DF_USD"; ws["B13"] = "=(B8-B12)*B2*B5"; ws["B13"].number_format = "#,##0.00"
    ws["A14"] = "Reference forward (Rijeka)"; ws["B14"] = F; ws["B14"].fill = RJ; ws["B14"].number_format = "#,##0.00"
    return wb, 0.0


def crypto_ndo_workbook(mkt: Market):
    spot_px, r_btc, sigma = 65_000.0, 0.03, 0.60
    wb = Workbook()
    _readme(wb, "Crypto NDO", [
        "Default trade: buy a 3-month European call on 10 BTC, USD-settled, strike at the forward, 60% lognormal vol.",
        "Black-76 on the forward: C = DF_USD·[F·N(d₁) − K·N(d₂)], d₁ = [ln(F/K) + ½σ²T]/(σ√T), d₂ = d₁ − σ√T. Put via parity: P = C − DF·(F − K).",
        "Premium is quoted in USD and in BTC (premium / spot). The canonical on-chain record is the CRYPTO_OPTION product in chain/canonical.py.",
    ], mkt)
    _curve_sheet(wb, mkt)
    ws, T = _crypto_common(wb, mkt, spot_px, r_btc, 3)
    F, dfT, t = _ref_forward(mkt, spot_px, r_btc, T)
    ws["A12"] = "Strike K"; ws["B12"] = "=B8"; ws["B12"].fill = IN; ws["B12"].number_format = "#,##0.00"
    ws["A13"] = "Vol σ (lognormal)"; ws["B13"] = sigma; ws["B13"].fill = IN; ws["B13"].number_format = "0.00%"
    ws["A14"] = "Call (1) / Put (-1)"; ws["B14"] = 1; ws["B14"].fill = IN
    ws["A15"] = "d₁"; ws["B15"] = "=(LN(B8/B12)+0.5*B13^2*B4)/(B13*SQRT(B4))"
    ws["A16"] = "d₂"; ws["B16"] = "=B15-B13*SQRT(B4)"
    ws["A17"] = "Premium per BTC (USD)"; ws["B17"] = "=B5*B14*(B8*NORM.S.DIST(B14*B15,TRUE)-B12*NORM.S.DIST(B14*B16,TRUE))"; ws["B17"].number_format = "#,##0.00"
    ws["A18"] = "Premium total (USD)"; ws["B18"] = "=B17*B2"; ws["B18"].number_format = "#,##0.00"
    ws["A19"] = "Premium in BTC"; ws["B19"] = "=B18/B1"; ws["B19"].number_format = "0.0000"
    # reference
    from math import erf, sqrt, log
    N = lambda x: 0.5 * (1 + erf(x / sqrt(2)))
    d1 = (log(F / F) + 0.5 * sigma ** 2 * t) / (sigma * sqrt(t)); d2 = d1 - sigma * sqrt(t)
    ref = dfT * (F * N(d1) - F * N(d2)) * 10
    ws["A21"] = "Reference premium total (Rijeka, same formula)"; ws["B21"] = ref; ws["B21"].fill = RJ; ws["B21"].number_format = "#,##0.00"
    return wb, ref


BUILDERS = {"irs": irs_workbook, "ois": ois_workbook, "swaption": swaption_workbook, "cap": cap_workbook,
            "crypto_ndf": crypto_ndf_workbook, "crypto_ndo": crypto_ndo_workbook}


def build(product: str, mkt: Market) -> tuple[bytes, float]:
    wb, ref = BUILDERS[product](mkt)
    bio = io.BytesIO(); wb.save(bio)
    return bio.getvalue(), ref
