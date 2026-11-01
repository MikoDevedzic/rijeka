"""Print the QuantLib reference table from the same rows the tests assert.

    cd backend && python -m tests.reference.report            # markdown, every row
    cd backend && python -m tests.reference.report --summary  # one line per product and metric (worst case)
    cd backend && python -m tests.reference.report --latex    # the summary as a LaTeX longtable body

The methodology's "Independent reference: QuantLib" section is the --latex output; rerun it when a
tolerance or a convention changes."""
from __future__ import annotations

import sys
from collections import OrderedDict

import QuantLib as ql

from tests.reference import (test_ref_bermudan, test_ref_ccr, test_ref_curve, test_ref_fx, test_ref_greeks, test_ref_options,
                             test_ref_swaps)
from tests.reference.refmarket import VAL

MODULES = (test_ref_curve, test_ref_swaps, test_ref_fx, test_ref_options, test_ref_bermudan, test_ref_ccr, test_ref_greeks)


def rows():
    out = []
    for m in MODULES:
        out.extend(m.all_rows())
    return out


def summary(rs):
    groups: "OrderedDict[tuple, list]" = OrderedDict()
    for r in rs:
        groups.setdefault((r.product, r.metric, r.unit, r.kind), []).append(r)
    lines = []
    for (product, metric, unit, kind), g in groups.items():
        worst = max(g, key=lambda r: abs(r.diff))
        causes = sorted({r.cause for r in g if r.cause})
        lines.append({"product": product, "metric": metric, "n": len(g), "worst": worst.diff, "unit": unit, "tol": max(r.tol for r in g),
                      "kind": kind, "ok": all(r.ok for r in g), "cause": causes[0] if causes else "", "case": worst.case})
    return lines


def _fmt(x: float) -> str:
    return f"{x:.2e}" if (x != 0 and abs(x) < 1e-3) else f"{x:.3g}"


def main(argv):
    rs = rows()
    if "--latex" in argv:
        esc = lambda s: s.replace("&", r"\&").replace("%", r"\%").replace("_", r"\_").replace("#", r"\#").replace("→", r"$\to$").replace("≈", r"$\approx$").replace("·", r"$\cdot$").replace("τ", r"$\tau$").replace("σ", r"$\sigma$").replace("−", "-").replace("φ", r"$\phi$")
        for s in summary(rs):
            print(f"{esc(s['product'])} & {esc(s['metric'])} & {s['n']} & {_fmt(s['worst'])} & {esc(s['unit'])} & {_fmt(s['tol'])} & "
                  f"{s['kind']} \\\\")
        return
    print(f"QuantLib {ql.__version__}, valuation date {VAL}, {len(rs)} comparisons, "
          f"{sum(r.ok for r in rs)} within tolerance\n")
    if "--summary" in argv:
        print("| Product | Metric | n | Worst diff | Unit | Tolerance | Kind | Cause of a non-zero difference |")
        print("|---|---|---|---|---|---|---|---|")
        for s in summary(rs):
            print(f"| {s['product']} | {s['metric']} | {s['n']} | {_fmt(s['worst'])} | {s['unit']} | {_fmt(s['tol'])} | {s['kind']} | {s['cause']} |")
        return
    print("| Product | Case | Metric | Rijeka | QuantLib | Diff | Unit | Tol | Verdict | Cause |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in rs:
        print(f"| {r.product} | {r.case} | {r.metric} | {r.rijeka:,.6g} | {r.quantlib:,.6g} | {_fmt(r.diff)} | {r.unit} | {_fmt(r.tol)} | "
              f"{'ok' if r.ok else 'OUT'} | {r.cause} |")


if __name__ == "__main__":
    main(sys.argv[1:])
