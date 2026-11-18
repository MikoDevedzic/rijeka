"""Evaluate a replication workbook's Checks sheet outside Excel: every formula against the engine's value.

    python -m scripts.check_workbook xva_rates [--paths 12] [--presets UNCOLLATERALISED BILATERAL ON_CHAIN]

The book is built on a stated test market (a sloped curve, one swaption quote), not on an account's: nothing is read
from a database. It needs `pycel`, which is not among the project's requirements (pip install pycel in a scratch
environment); tests/test_methodology.py runs the same check where pycel is installed and skips where it is not.

pycel does not read this openpyxl's defined names, nor ROWS, PERCENTILE, VARP, STDEV, SUMSQ, NORMSINV or RAND. So the
copy it evaluates has the names written out as their cells, ROWS(range) as its count and the LIVE draw as zero
(ENGINE mode never reads it), and the missing functions are given here by Excel's own definitions."""
from __future__ import annotations

import io
import math
import re
import sys
import tempfile
from datetime import date, timedelta

import numpy as np


# ── the functions pycel lacks (loaded by pycel as a plugin: this module's name) ──────────────────────────────

def _flat(*args):
    out = []

    def walk(v):
        if isinstance(v, (tuple, list)):
            for x in v:
                walk(x)
        elif not (isinstance(v, bool) or v is None or isinstance(v, str)):
            out.append(float(v))
    for a in args:
        walk(a)
    return out


def percentile(values, k):
    return float(np.percentile(_flat(values), float(k) * 100.0))        # linear interpolation, as Excel's PERCENTILE


def sumsq(*args):
    return float(sum(x * x for x in _flat(*args)))


def varp(*args):
    return float(np.var(_flat(*args)))


def stdev(*args):
    v = _flat(*args)
    return float(np.std(v, ddof=1)) if len(v) > 1 else 0.0


# ── the test market and the evaluation ────────────────────────────────────────────────────────────────────────

def test_market(val: date = date(2026, 8, 3)):
    from methodology import replicate as rep
    from pricing.curve import Curve
    pil = [(val, 1.0)] + [(val + timedelta(days=int(round(365.25 * y))), math.exp(-(0.03 + 0.004 * math.log(1 + y)) * y)) for y in (0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30)]
    return rep.Market(valuation_date=val, curve_id="USD_SOFR", snapshot_date=val, source="TEST", quotes=[{"tenor": "5Y", "quote_type": "OIS", "rate": 4.0, "enabled": True}],
                      curve=Curve(val, df_pillars=pil), vol_quotes=[{"tenor": "1Yx5Y", "rate": 90.0, "enabled": True}], vol_date=val)


def evaluation_copy(wb):
    """The workbook with its names written out as cells, for an evaluator that cannot read them."""
    from openpyxl.utils import range_boundaries
    names = {name: dn.attr_text.replace("$", "") for name, dn in wb.defined_names.items()}
    order = sorted(names, key=len, reverse=True)
    pat = re.compile(r"(?<![A-Za-z0-9_!'.])(" + "|".join(re.escape(n) for n in order) + r")(?![A-Za-z0-9_(!])")

    def rows_of(m):
        c0, r0, c1, r1 = range_boundaries(names.get(m.group(1), m.group(1)).split("!")[-1])
        return str(r1 - r0 + 1)
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                v = c.value
                if isinstance(v, str) and v.startswith("="):
                    v = re.sub(r"ROWS\(([A-Za-z0-9_]+)\)", rows_of, v.replace("NORMSINV(RAND())", "0"))
                    c.value = pat.sub(lambda m: names[m.group(1)], v)
    return wb


def run_checks(wb, preset_cell: str | None = None, preset: str | None = None) -> list[dict]:
    """Every row of the Checks sheet evaluated: [{sheet, label, formula, engine, rel, tol, ok}]. `preset_cell` is set
    to `preset` first (a CSA preset on an XVA book)."""
    from pycel import ExcelCompiler
    wb = evaluation_copy(wb)
    if preset_cell and preset:
        sheet, addr = preset_cell.split("!")
        wb[sheet][addr] = preset
    ws = wb["Checks"]
    rows = [(r, ws.cell(row=r, column=1).value, ws.cell(row=r, column=2).value, float(ws.cell(row=r, column=7).value))
            for r in range(5, ws.max_row + 1) if ws.cell(row=r, column=3).value]
    with tempfile.NamedTemporaryFile(suffix=".xlsx") as f:
        wb.save(f.name)
        xl = ExcelCompiler(filename=f.name, plugins=(__name__,))
        out = []
        for r, sheet, label, tol in rows:
            fv, ev = xl.evaluate(f"Checks!C{r}"), xl.evaluate(f"Checks!D{r}")
            rel = abs(float(fv) - float(ev)) / max(abs(float(ev)), 1.0)
            out.append({"sheet": sheet, "label": label, "formula": float(fv), "engine": float(ev), "rel": rel, "tol": tol, "ok": rel <= tol})
    return out


def main(argv: list[str]) -> int:
    import argparse
    from openpyxl import load_workbook
    from methodology import replicate as rep, workbook as W
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("product"); ap.add_argument("--paths", type=int, default=12)
    ap.add_argument("--presets", nargs="*", default=None); ap.add_argument("--date", default="2026-08-03")
    a = ap.parse_args(argv)
    mkt = test_market(date.fromisoformat(a.date))
    if a.product == "xva_rates":
        from methodology.xva_workbook import PRESETS, xva_rates_workbook
        wb, _ = xva_rates_workbook(mkt, a.paths)
        W.finish(wb)
        bio = io.BytesIO(); wb.save(bio)
        presets = [(p, "Exposure!B4") for p in (a.presets or PRESETS)]
    else:
        data, _ = rep.build(a.product, mkt)
        bio = io.BytesIO(data); presets = [(None, None)]
    bad = 0
    for preset, cell in presets:
        res = run_checks(load_workbook(io.BytesIO(bio.getvalue())), cell, preset)
        fails = [x for x in res if not x["ok"]]
        bad += len(fails)
        worst = max(res, key=lambda x: x["rel"]) if res else None
        print(f"{a.product} {preset or ''}: {len(res)} checks, {len(fails)} failing" + (f", worst {worst['rel']:.1e} ({worst['label']})" if worst else ""))
        for x in fails[:20]:
            print(f"  FAIL {x['sheet']}: {x['label']}: sheet {x['formula']:,.6f} engine {x['engine']:,.6f} rel {x['rel']:.2e}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
