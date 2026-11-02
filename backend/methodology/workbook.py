"""
The replication workbook's skeleton: what every product's export shares, so a reader meets the same
book each time.

    Cover       what the trade is, the market it was priced on, the checks' verdict, the colour key
    Ticket      the ticket as the trader saw it, rebuilt in cells: every number is a live link into
                the sheet that derives it (click it and Excel goes there)
    Derivation  the maths, top to bottom, each line with its live value and a link to its cell
    Inputs, Curve, the product's own sheets, Scenario
    Checks      every formula-against-engine comparison with its tolerance and a PASS / FAIL that
                the cover sums up

Plain openpyxl: styles, hyperlinks, data validation, conditional formatting and native charts; no
macros, no external links, so the file opens clean in Excel, Numbers and Google Sheets.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from openpyxl import Workbook
from openpyxl.chart import Reference, ScatterChart, Series
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

INK, ACCENT, AMBER, RED, MUTED = "0B3D34", "0DD4A8", "F0A020", "E05040", "6B7280"
F_TITLE = Font(name="Calibri", size=20, bold=True, color=INK)
F_SUB = Font(name="Calibri", size=11, color=MUTED)
F_H = Font(name="Calibri", bold=True, color="FFFFFF")
F_SECTION = Font(name="Calibri", size=11, bold=True, color=INK)
F_MONO = Font(name="Consolas", size=10)
F_LINK = Font(name="Consolas", size=10, color="1F5FBF", underline="single")
FILL_H = PatternFill("solid", fgColor=INK)
FILL_IN = PatternFill("solid", fgColor="FFF4D6")      # inputs the reader may change
FILL_RJ = PatternFill("solid", fgColor="E6F4F1")      # Rijeka engine values
FILL_PASS = PatternFill("solid", fgColor="D6F5EC")
FILL_FAIL = PatternFill("solid", fgColor="FBD9D3")
FILL_BAND = PatternFill("solid", fgColor="F4F6F6")
THIN = Side(style="thin", color="D9DEDD")
BOX = Border(top=THIN, bottom=THIN, left=THIN, right=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")
TAB = {"Cover": INK, "Ticket": ACCENT, "Derivation": "1F5FBF", "Checks": AMBER}


def _meta(wb: Workbook) -> dict:
    if not hasattr(wb, "_rijeka"):
        wb._rijeka = {"title": "", "lines": [], "mkt": None, "summary": [], "checks": [], "ticket": [], "derivation": [], "scenario": None}
    return wb._rijeka


# ── registration, called by the product builders while they write their sheets ──

def start(wb: Workbook, title: str, lines: list[str], mkt, summary: Optional[list[tuple[str, Any]]] = None) -> None:
    """Names the book; the Cover is written by finish() once every sheet exists."""
    m = _meta(wb)
    m.update(title=title, lines=[l for l in lines if l], mkt=mkt, summary=list(summary or []))
    ws = wb.active
    ws.title = "Cover"


def check(wb: Workbook, sheet: str, label: str, formula_ref: str, engine_ref: str, tol: float = 1e-5) -> None:
    """A formula-against-engine comparison for the Checks sheet: relative tolerance on max(|engine|, 1)."""
    _meta(wb)["checks"].append({"sheet": sheet, "label": label, "formula": formula_ref, "engine": engine_ref, "tol": tol})


def ticket(wb: Workbook, section: str, rows: list[tuple]) -> None:
    """A section of the ticket mirror: rows of (label, 'Sheet!B8', number format, note)."""
    _meta(wb)["ticket"].append((section, rows))


def derive(wb: Workbook, symbol: str, notation: str, ref: Optional[str], note: str = "", fmt: str = "General") -> None:
    """One line of the derivation ledger: the symbol, its formula in notation, the cell that computes it."""
    _meta(wb)["derivation"].append((symbol, notation, ref, note, fmt))


def ref_cell(ws, row: int, label: str, formula: str, engine: float, fmt: str = "#,##0.00", tol: float = 1e-5) -> None:
    """Label | formula | engine value | difference, and the check that goes with it."""
    ws.cell(row=row, column=1, value=label)
    ws.cell(row=row, column=2, value=formula).number_format = fmt
    c = ws.cell(row=row, column=3, value=engine); c.fill = FILL_RJ; c.number_format = fmt
    ws.cell(row=row, column=4, value=f"=B{row}-C{row}").number_format = fmt
    check(ws.parent, ws.title, label, f"B{row}", f"C{row}", tol)


def header(ws, row: int, cols: list[str]) -> None:
    for i, c in enumerate(cols, 1):
        cell = ws.cell(row=row, column=i, value=c); cell.font = F_H; cell.fill = FILL_H
        cell.alignment = Alignment(horizontal="center", vertical="center")


def widths(ws, ws_widths: list[float]) -> None:
    for i, w in enumerate(ws_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def _split(ref: str) -> tuple[str, str]:
    """"'FIXED leg'!E2" or "European!B8" → ("FIXED leg", "E2")."""
    sheet, addr = ref.split("!", 1)
    return sheet.strip("'"), addr.replace("$", "")


def link(cell, ref: str, text: Optional[str] = None) -> None:
    """An in-book hyperlink: ref like "European!B8" (the sheet name is quoted for Excel)."""
    sheet, addr = _split(ref)
    cell.hyperlink = f"#'{sheet}'!{addr}"
    cell.value = text if text is not None else f"→ {sheet} · {addr}"
    cell.font = F_LINK


def dropdown(ws, addr: str, options: list[str]) -> None:
    dv = DataValidation(type="list", formula1='"' + ",".join(options) + '"', allow_blank=False)
    ws.add_data_validation(dv)
    dv.add(ws[addr])


def scenario(wb: Workbook, ws_title: str, x_ref: tuple, series: list[tuple[str, tuple]], title: str, x_title: str, y_title: str) -> None:
    """A native XY chart on ws_title: x_ref and each series are (min_col, min_row, max_row)."""
    _meta(wb)["scenario"] = (ws_title, x_ref, series, title, x_title, y_title)


# ── the shared sheets, written last ───────────────────────────────────────────

def _cover(wb: Workbook) -> None:
    m = _meta(wb); mkt = m["mkt"]
    ws = wb["Cover"]
    ws["A1"] = f"Rijeka · {m['title']}"; ws["A1"].font = F_TITLE
    ws["A2"] = "Excel replication · the trade rebuilt with live formulas beside the engine's values"; ws["A2"].font = F_SUB
    ws["A3"] = (f"Market data: {mkt.curve_id} snapshot {mkt.snapshot_date} ({mkt.source}) · valuation date {mkt.valuation_date}"
                if mkt is not None else ""); ws["A3"].font = F_SUB
    r = 5
    ws.cell(row=r, column=1, value="THE TRADE").font = F_SECTION; r += 1
    for label, value in m["summary"]:
        ws.cell(row=r, column=1, value=label).font = Font(color=MUTED)
        c = ws.cell(row=r, column=2, value=value); c.font = F_MONO; c.alignment = Alignment(wrap_text=True, vertical="top")
        r += 1
    r += 1
    ws.cell(row=r, column=1, value="CHECKS").font = F_SECTION; r += 1
    n = len(m["checks"])
    if n:
        ws.cell(row=r, column=1, value="Formula vs engine comparisons").font = Font(color=MUTED); ws.cell(row=r, column=2, value=n).font = F_MONO; r += 1
        ws.cell(row=r, column=1, value="Passing").font = Font(color=MUTED); c = ws.cell(row=r, column=2, value='=COUNTIF(Checks!$H:$H,"PASS")'); c.font = F_MONO; r += 1
        ws.cell(row=r, column=1, value="Failing").font = Font(color=MUTED); c = ws.cell(row=r, column=2, value='=COUNTIF(Checks!$H:$H,"FAIL")'); c.font = F_MONO
        ws.conditional_formatting.add(f"B{r}", CellIsRule(operator="greaterThan", formula=["0"], fill=FILL_FAIL))
        ws.conditional_formatting.add(f"B{r}", CellIsRule(operator="equal", formula=["0"], fill=FILL_PASS)); r += 1
        ws.cell(row=r, column=1, value="Worst relative difference").font = Font(color=MUTED); c = ws.cell(row=r, column=2, value="=MAX(Checks!$F:$F)"); c.font = F_MONO; c.number_format = "0.0E+00"; r += 1
        ws.cell(row=r, column=1, value="Verdict").font = Font(color=MUTED)
        c = ws.cell(row=r, column=2, value='=IF(COUNTIF(Checks!$H:$H,"FAIL")=0,"EVERY FORMULA REPRODUCES THE ENGINE","SEE THE CHECKS SHEET")'); c.font = Font(bold=True)
        ws.conditional_formatting.add(f"B{r}", CellIsRule(operator="equal", formula=['"EVERY FORMULA REPRODUCES THE ENGINE"'], fill=FILL_PASS, font=Font(bold=True, color=INK)))
        ws.conditional_formatting.add(f"B{r}", CellIsRule(operator="equal", formula=['"SEE THE CHECKS SHEET"'], fill=FILL_FAIL, font=Font(bold=True, color=RED)))
        r += 1
    r += 1
    ws.cell(row=r, column=1, value="HOW TO READ THIS BOOK").font = F_SECTION; r += 1
    guide = [
        "Ticket: the numbers the trader saw, each one a link into the sheet that derives it.",
        "Derivation: the maths line by line, every quantity with its live value and its cell.",
        "Inputs: the yellow cells are yours to change; every sheet reprices.",
        "Curve: pillar dates and discount factors from Rijeka's bootstrap; every DF elsewhere is interpolated log-linearly between them, as pricing/curve.py does.",
        "Green cells are the engine's own values, written at export; white cells are formulas; the Checks sheet compares them.",
    ] + m["lines"] + ["Source: github.com/MikoDevedzic/rijeka · backend/methodology/replicate.py · Apache-2.0."]
    for t in guide:
        c = ws.cell(row=r, column=1, value=t); c.alignment = WRAP
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
        ws.row_dimensions[r].height = 15 * max(1, len(t) // 110 + 1)
        r += 1
    ws.cell(row=r + 1, column=1, value="Colour key").font = F_SECTION
    k1 = ws.cell(row=r + 2, column=1, value="input you may change"); k1.fill = FILL_IN
    k2 = ws.cell(row=r + 3, column=1, value="Rijeka engine value"); k2.fill = FILL_RJ
    ws.cell(row=r + 4, column=1, value="formula")
    widths(ws, [44, 96])
    ws.sheet_view.showGridLines = False


def _ticket(wb: Workbook) -> None:
    m = _meta(wb)
    if not m["ticket"]:
        return
    ws = wb.create_sheet("Ticket")
    ws["A1"] = "THE TICKET, AS THE TRADER SAW IT"; ws["A1"].font = F_TITLE
    ws["A2"] = "Every value is live, and a link: click the reference to go to the cell that derives it."; ws["A2"].font = F_SUB
    r = 4
    for section, rows in m["ticket"]:
        ws.cell(row=r, column=1, value=section).font = F_SECTION; r += 1
        header(ws, r, ["", "Value", "Derived in", "Note"]); r += 1
        for label, ref, fmt, note in rows:
            ws.cell(row=r, column=1, value=label)
            sheet, addr = _split(ref)
            v = ws.cell(row=r, column=2, value=f"='{sheet}'!{addr}"); v.number_format = fmt; v.font = F_MONO
            link(ws.cell(row=r, column=3), ref)
            ws.cell(row=r, column=4, value=note).font = Font(color=MUTED)
            for col in range(1, 5):
                ws.cell(row=r, column=col).border = BOX
            r += 1
        r += 1
    widths(ws, [34, 20, 26, 70])
    ws.freeze_panes = "A4"
    ws.sheet_view.showGridLines = False


def _derivation(wb: Workbook) -> None:
    m = _meta(wb)
    if not m["derivation"]:
        return
    ws = wb.create_sheet("Derivation")
    ws["A1"] = "THE MATHS, TOP TO BOTTOM"; ws["A1"].font = F_TITLE
    ws["A2"] = "Each line: the quantity, its formula, its live value and the cell that computes it. Change an input and read the chain again."; ws["A2"].font = F_SUB
    header(ws, 4, ["Quantity", "Formula", "Value", "Cell", "Convention / note"])
    r = 5
    for symbol, notation, ref, note, fmt in m["derivation"]:
        ws.cell(row=r, column=1, value=symbol).font = Font(bold=True, color=INK)
        n = ws.cell(row=r, column=2, value=notation); n.font = F_MONO; n.alignment = WRAP
        if ref:
            sheet, addr = _split(ref)
            v = ws.cell(row=r, column=3, value=f"='{sheet}'!{addr}"); v.number_format = fmt; v.font = F_MONO
            link(ws.cell(row=r, column=4), ref)
        c = ws.cell(row=r, column=5, value=note); c.font = Font(color=MUTED); c.alignment = WRAP
        if r % 2 == 0:
            for col in range(1, 6):
                ws.cell(row=r, column=col).fill = FILL_BAND
        r += 1
    widths(ws, [22, 58, 18, 24, 60])
    ws.freeze_panes = "A5"
    ws.sheet_view.showGridLines = False


def _checks(wb: Workbook) -> None:
    m = _meta(wb)
    if not m["checks"]:
        return
    ws = wb.create_sheet("Checks")
    ws["A1"] = "EVERY FORMULA AGAINST THE ENGINE"; ws["A1"].font = F_TITLE
    ws["A2"] = "Relative difference on max(|engine|, 1); PASS within the tolerance. The cover sums this sheet up."; ws["A2"].font = F_SUB
    header(ws, 4, ["Sheet", "Comparison", "Formula", "Engine", "Difference", "Relative", "Tolerance", "Status"])
    r = 5
    for ck in m["checks"]:
        s = ck["sheet"]
        ws.cell(row=r, column=1, value=s)
        link(ws.cell(row=r, column=2), f"{s}!{ck['formula']}", ck["label"])
        ws.cell(row=r, column=3, value=f"='{s}'!{ck['formula']}").font = F_MONO
        ws.cell(row=r, column=4, value=f"='{s}'!{ck['engine']}").font = F_MONO
        ws.cell(row=r, column=5, value=f"=C{r}-D{r}").font = F_MONO
        c = ws.cell(row=r, column=6, value=f"=ABS(E{r})/MAX(ABS(D{r}),1)"); c.font = F_MONO; c.number_format = "0.0E+00"
        t = ws.cell(row=r, column=7, value=ck["tol"]); t.font = F_MONO; t.number_format = "0.0E+00"
        ws.cell(row=r, column=8, value=f'=IF(F{r}<=G{r},"PASS","FAIL")').font = Font(bold=True)
        r += 1
    rng = f"H5:H{r - 1}"
    ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"PASS"'], fill=FILL_PASS, font=Font(bold=True, color=INK)))
    ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"FAIL"'], fill=FILL_FAIL, font=Font(bold=True, color=RED)))
    for row in ws.iter_rows(min_row=5, max_row=r - 1, min_col=3, max_col=5):
        for c in row:
            c.number_format = "#,##0.0000"
    widths(ws, [16, 52, 16, 16, 14, 11, 11, 9])
    ws.freeze_panes = "A5"
    ws.sheet_view.showGridLines = False


def _chart(wb: Workbook) -> None:
    sc = _meta(wb)["scenario"]
    if not sc:
        return
    ws_title, x_ref, series, title, x_title, y_title = sc
    ws = wb[ws_title]
    ch = ScatterChart()
    ch.title, ch.style, ch.height, ch.width = title, 13, 9.5, 18
    ch.x_axis.title, ch.y_axis.title = x_title, y_title
    xs = Reference(ws, min_col=x_ref[0], min_row=x_ref[1], max_row=x_ref[2])
    for name, (col, r0, r1) in series:
        ys = Reference(ws, min_col=col, min_row=r0, max_row=r1)
        s = Series(ys, xs, title=name)
        s.marker.symbol = "circle"; s.marker.size = 5
        ch.series.append(s)
    ws.add_chart(ch, "J2")


def finish(wb: Workbook) -> Workbook:
    """Writes Cover, Ticket, Derivation, the chart and Checks; orders and dresses the sheets."""
    _ticket(wb); _derivation(wb); _chart(wb); _checks(wb); _cover(wb)
    order = ["Cover", "Ticket", "Derivation", "Inputs", "Curve"]
    rest = [s for s in wb.sheetnames if s not in order + ["Checks"]]
    final = [s for s in order if s in wb.sheetnames] + rest + (["Checks"] if "Checks" in wb.sheetnames else [])
    wb._sheets = [wb[s] for s in final]
    for s in wb.worksheets:
        s.sheet_properties.tabColor = TAB.get(s.title, "A7B4B2")
        s.page_setup.orientation = "landscape"; s.page_setup.fitToWidth = 1; s.sheet_properties.pageSetUpPr.fitToPage = True
    wb.active = 0
    return wb
