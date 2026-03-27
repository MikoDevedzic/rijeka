// SPRINT_4G_1_ir_swap.js
// Patches backend/pricing/ir_swap.py:
//   - Adds df, zero_rate fields to CashflowResult
//   - Computes them in price_leg
// Run from Rijeka root: node SPRINT_4G_1_ir_swap.js

const fs = require('fs');
const FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\pricing\\ir_swap.py';
let src = fs.readFileSync(FILE, 'utf8');
const orig = src;

// 1. Add df and zero_rate to CashflowResult dataclass
src = src.replace(
  `@dataclass
class CashflowResult:
    period_start:  date
    period_end:    date
    payment_date:  date
    fixing_date:   Optional[date]
    currency:      str
    notional:      float
    rate:          float        # fixed rate or projected forward rate
    dcf:           float
    amount:        float        # notional * rate * dcf
    pv:            float        # amount * df(payment_date)`,
  `@dataclass
class CashflowResult:
    period_start:  date
    period_end:    date
    payment_date:  date
    fixing_date:   Optional[date]
    currency:      str
    notional:      float
    rate:          float        # fixed rate or projected forward rate
    dcf:           float
    amount:        float        # notional * rate * dcf
    pv:            float        # amount * df(payment_date)
    df:            float = 1.0  # discount factor to payment_date
    zero_rate:     float = 0.0  # continuously-compounded zero rate to payment_date`
);

// 2. In price_leg, after computing pv_cf, also store df and zero_rate
src = src.replace(
  `        amount = float(p.notional) * rate * float(p.dcf)
        pv_cf  = amount * df`,
  `        amount = float(p.notional) * rate * float(p.dcf)
        pv_cf  = amount * df
        zero_r = discount_curve.zero_rate(p.payment_date)`
);

// 3. Add df and zero_rate to each CashflowResult constructor call
// The constructor is called as: cashflows.append(CashflowResult(...))
// Find it and add the new fields
src = src.replace(
  `            cashflows.append(CashflowResult(
                period_start = p.period_start,
                period_end   = p.period_end,
                payment_date = p.payment_date,
                fixing_date  = p.fixing_date if hasattr(p, 'fixing_date') else None,
                currency     = currency,
                notional     = float(p.notional),
                rate         = rate,
                dcf          = float(p.dcf),
                amount       = amount,
                pv           = pv_cf,
            ))`,
  `            cashflows.append(CashflowResult(
                period_start = p.period_start,
                period_end   = p.period_end,
                payment_date = p.payment_date,
                fixing_date  = p.fixing_date if hasattr(p, 'fixing_date') else None,
                currency     = currency,
                notional     = float(p.notional),
                rate         = rate,
                dcf          = float(p.dcf),
                amount       = amount,
                pv           = pv_cf,
                df           = df,
                zero_rate    = zero_r,
            ))`
);

if (src === orig) {
  console.log('No changes — check anchors');
  process.exit(1);
}
fs.writeFileSync(FILE, src, 'utf8');
console.log('Done. ir_swap.py patched — CashflowResult now includes df + zero_rate');
