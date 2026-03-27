// SPRINT_4G_leg_greeks.js
// Adds per-leg IR01 and IR01_DISC to LegResult and price_swap
// Also patches pricer.py response and PricerPage leg table

const fs = require('fs');

const IR_SWAP = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\pricing\\ir_swap.py';
const PRICER  = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\api\\routes\\pricer.py';
const PAGE    = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\pricer\\PricerPage.jsx';

// ── 1. ir_swap.py: add ir01/ir01_disc to LegResult ───────────────────────────
let irswap = fs.readFileSync(IR_SWAP, 'utf8');

irswap = irswap.replace(
  `@dataclass
class LegResult:
    leg_id:     str
    leg_ref:    str`,
  `@dataclass
class LegResult:
    leg_id:     str
    leg_ref:    str`
);

// Add ir01/ir01_disc fields to LegResult
irswap = irswap.replace(
  `    currency:   str
    pv:         float           # present value (signed: negative=pay, positive=receive)
    cashflows:  List[CashflowResult] = field(default_factory=list)`,
  `    currency:   str
    pv:         float           # present value (signed: negative=pay, positive=receive)
    cashflows:  List[CashflowResult] = field(default_factory=list)
    ir01:       float = 0.0     # per-leg: +1bp all curves → ΔPNL
    ir01_disc:  float = 0.0     # per-leg: +1bp disc curve only → ΔPNL`
);

// In price_swap, after pricing each leg, compute per-leg IR01/IR01_DISC
// Find the return LegResult call in price_leg and add greeks computation in price_swap
// Strategy: compute them in price_swap after getting leg_results

irswap = irswap.replace(
  `    leg_results = []
    for leg in legs:
        disc_id = leg.get("discount_curve_id") or "default"
        fore_id = leg.get("forecast_curve_id") or disc_id
        disc_curve = curves.get(disc_id) or curves.get("default")
        fore_curve = curves.get(fore_id) or curves.get("default")`,
  `    # Pre-compute bumped curve sets for per-leg greeks
    bumped_all  = {k: v.shifted(1.0) for k, v in curves.items()}
    # For IR01_DISC: identify discount curve IDs across all legs
    all_disc_ids = {(leg.get("discount_curve_id") or "default") for leg in legs}
    all_fore_ids = {(leg.get("forecast_curve_id") or leg.get("discount_curve_id") or "default") for leg in legs}
    shared = all_disc_ids & all_fore_ids
    bumped_disc = dict(curves)
    for cid in all_disc_ids:
        if cid in bumped_disc:
            bumped_disc[cid + "__disc"] = bumped_disc[cid].shifted(1.0)
    # Build patched legs with disc suffix for IR01_DISC calculation
    def _patch_disc(leg):
        d = leg.get("discount_curve_id") or "default"
        if d in shared:
            l2 = dict(leg); l2["discount_curve_id"] = d + "__disc"; return l2
        return leg

    leg_results = []
    for leg in legs:
        disc_id = leg.get("discount_curve_id") or "default"
        fore_id = leg.get("forecast_curve_id") or disc_id
        disc_curve = curves.get(disc_id) or curves.get("default")
        fore_curve = curves.get(fore_id) or curves.get("default")`
);

// After each leg result, compute its individual IR01/IR01_DISC
// Find where leg_results.append happens
irswap = irswap.replace(
  `        leg_results.append(lr)`,
  `        # Per-leg IR01: reprice this single leg with all curves bumped
        disc_bumped = bumped_all.get(disc_id) or bumped_all.get("default")
        fore_bumped = bumped_all.get(fore_id) or bumped_all.get("default")
        lr_bumped   = price_leg(leg, disc_bumped, fore_bumped, valuation_date)
        leg_ir01    = lr_bumped.pv - lr.pv

        # Per-leg IR01_DISC: bump disc only, keep forecast flat
        disc_only   = bumped_disc.get(disc_id + "__disc") or bumped_disc.get(disc_id)
        lr_disc     = price_leg(_patch_disc(leg), disc_only, fore_curve, valuation_date) if disc_only else lr
        leg_ir01_disc = lr_disc.pv - lr.pv

        lr.ir01      = leg_ir01
        lr.ir01_disc = leg_ir01_disc
        leg_results.append(lr)`
);

fs.writeFileSync(IR_SWAP, irswap, 'utf8');
console.log('  ✓ ir_swap.py — per-leg ir01/ir01_disc added');

// ── 2. pricer.py: expose leg ir01/ir01_disc in _lr() serializer ──────────────
let pricer = fs.readFileSync(PRICER, 'utf8');

pricer = pricer.replace(
  `            "pv":        float(lr.pv) if lr.pv is not None else None,
            "cashflows": [`,
  `            "pv":        float(lr.pv)        if lr.pv        is not None else None,
            "ir01":      float(lr.ir01)      if hasattr(lr, 'ir01')      else None,
            "ir01_disc": float(lr.ir01_disc) if hasattr(lr, 'ir01_disc') else None,
            "cashflows": [`
);

fs.writeFileSync(PRICER, pricer, 'utf8');
console.log('  ✓ pricer.py — leg ir01/ir01_disc in response');

// ── 3. PricerPage.jsx: add IR01/IR01_DISC columns to leg breakdown table ─────
let page = fs.readFileSync(PAGE, 'utf8');

// Update leg table headers
page = page.replace(
  `<th>LEG</th><th>TYPE</th><th>DIR</th><th>DISC CURVE</th><th>FCAST CURVE</th><th className="r">PV</th>`,
  `<th>LEG</th><th>TYPE</th><th>DIR</th><th>DISC CURVE</th><th>FCAST CURVE</th><th className="r">PV</th><th className="r">IR01</th><th className="r">IR01_DISC</th>`
);

// Update leg table rows
page = page.replace(
  `                      <td className="r pp-mono" style={{color:npvClr(leg.pv),fontWeight:700}}>{fmtAmt(leg.pv)}</td>
                    </tr>`,
  `                      <td className="r pp-mono" style={{color:npvClr(leg.pv),fontWeight:700}}>{fmtAmt(leg.pv)}</td>
                      <td className="r pp-mono" style={{color:'var(--blue)',fontSize:'0.6rem'}}>{leg.ir01 != null ? fmtAmt(leg.ir01) : '—'}</td>
                      <td className="r pp-mono" style={{color:'var(--text-dim)',fontSize:'0.6rem'}}>{leg.ir01_disc != null ? fmtAmt(leg.ir01_disc) : '—'}</td>
                    </tr>`
);

fs.writeFileSync(PAGE, page, 'utf8');
console.log('  ✓ PricerPage.jsx — IR01/IR01_DISC columns in leg table');
console.log('\nDone. Backend auto-reloads. RUN PRICER to see per-leg greeks.');
