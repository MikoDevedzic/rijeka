// SPRINT_4G_tooltips.js
// Adds hover tooltips to sensitivity labels in PricerPage.jsx
// Explains each metric + sign convention + duration interpretation

const fs = require('fs');
const FILE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\pricer\\PricerPage.jsx';
const CSS  = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\pricer\\PricerPage.css';

// ── 1. Add tooltip CSS ────────────────────────────────────────────────────────
let css = fs.readFileSync(CSS, 'utf8');
const tooltipCSS = `
.pp-tip-wrap { position:relative; display:inline-flex; align-items:center; gap:4px; cursor:help; }
.pp-tip-wrap:hover .pp-tip { opacity:1; pointer-events:auto; transform:translateY(0); }
.pp-tip {
  opacity:0; pointer-events:none; transform:translateY(4px);
  transition:opacity 0.15s, transform 0.15s;
  position:absolute; bottom:calc(100% + 8px); left:0;
  background:#0f1a28; border:1px solid rgba(14,201,160,0.2);
  border-radius:5px; padding:8px 10px; width:220px; z-index:999;
  font-family:var(--mono); font-size:0.6rem; line-height:1.6;
  color:rgba(255,255,255,0.7); white-space:normal;
  box-shadow:0 4px 20px rgba(0,0,0,0.4);
}
.pp-tip-title { font-size:0.62rem; font-weight:700; color:var(--accent); letter-spacing:0.08em; margin-bottom:4px; }
.pp-tip-sign { margin-top:5px; padding-top:5px; border-top:1px solid rgba(255,255,255,0.06); }
.pp-tip-pos { color:var(--accent); }
.pp-tip-neg { color:var(--red); }
.pp-tip-icon { font-size:9px; color:rgba(14,201,160,0.5); }
`;
if (!css.includes('pp-tip-wrap')) {
  fs.writeFileSync(CSS, css + tooltipCSS, 'utf8');
  console.log('  ✓ Tooltip CSS added');
}

// ── 2. Add Tooltip component to PricerPage.jsx ────────────────────────────────
let src = fs.readFileSync(FILE, 'utf8');

// Add Tooltip component after the fmtDcf line
const tooltipComponent = `
const TIPS = {
  IR01: {
    title: 'IR01 — Interest Rate Sensitivity',
    body: '+1bp parallel shift on ALL rate curves (discount + forecast). Measures full exposure to interest rate moves.',
    pos: 'IR01 > 0 → Long duration. Rates ↑ = you gain PNL. You benefit when rates rise (e.g. receiver of floating).',
    neg: 'IR01 < 0 → Short duration. Rates ↑ = you lose PNL. You lose when rates rise (e.g. payer of fixed).',
  },
  IR01_DISC: {
    title: 'IR01_DISC — Discount-Only Sensitivity',
    body: '+1bp shift on DISCOUNT curve only. Forecast rates held flat. Isolates the PV effect of discounting from the forecasting effect.',
    pos: 'Typically 10–20% of IR01. For a vanilla IRS, most rate sensitivity comes from forecast rate changes, not discounting.',
    neg: 'If IR01_DISC ≈ IR01, your position has mostly fixed cashflows (fixed leg dominates).',
  },
  THETA: {
    title: 'THETA — Time Decay',
    body: 'NPV change from today to tomorrow, all curves held fixed. The cost of carrying the position for one day.',
    pos: 'THETA > 0 → You earn carry. Position generates daily income (e.g. premium received, positive carry).',
    neg: 'THETA < 0 → You pay carry. Position costs money to hold daily (typical for long optionality or long-dated swaps).',
  },
  NPV: {
    title: 'NPV — Net Present Value',
    body: 'Sum of present values of all projected cashflows, discounted to today using your curve. PAY cashflows are negative, RECEIVE cashflows are positive.',
    pos: 'NPV > 0 → Position is in-the-money. If you closed today, counterparty would owe you this amount (before XVA).',
    neg: 'NPV < 0 → Position is out-of-the-money. You would owe this amount to close today (before XVA).',
  },
};

function Tip({ metric, children }) {
  const t = TIPS[metric];
  if (!t) return <span>{children}</span>;
  const isPos = metric === 'IR01' || metric === 'IR01_DISC';
  return (
    <span className="pp-tip-wrap">
      {children}
      <span className="pp-tip-icon">?</span>
      <div className="pp-tip">
        <div className="pp-tip-title">{t.title}</div>
        <div>{t.body}</div>
        <div className="pp-tip-sign">
          <span className="pp-tip-pos">{t.pos}</span>
        </div>
        <div className="pp-tip-sign">
          <span className="pp-tip-neg">{t.neg}</span>
        </div>
      </div>
    </span>
  );
}

`;

if (!src.includes('const TIPS =')) {
  src = src.replace(
    'const fmtAmt  =',
    tooltipComponent + 'const fmtAmt  ='
  );
  console.log('  ✓ Tip component added');
}

// ── 3. Wire Tip to metric labels ──────────────────────────────────────────────
// NPV metric
src = src.replace(
  `<div className="pp-metric-label">NPV {hasBumps ? '(SCENARIO)' : ''}</div>`,
  `<div className="pp-metric-label"><Tip metric="NPV">NPV {hasBumps ? '(SCENARIO)' : ''}</Tip></div>`
);

// IR01 metric
src = src.replace(
  `<div className="pp-metric-label">IR01</div>`,
  `<div className="pp-metric-label"><Tip metric="IR01">IR01</Tip></div>`
);

// IR01_DISC metric
src = src.replace(
  `<div className="pp-metric-label">IR01_DISC</div>`,
  `<div className="pp-metric-label"><Tip metric="IR01_DISC">IR01_DISC</Tip></div>`
);

// THETA metric
src = src.replace(
  `<div className="pp-metric-label">THETA</div>`,
  `<div className="pp-metric-label"><Tip metric="THETA">THETA</Tip></div>`
);

// Wire Tip to leg table IR01/IR01_DISC headers
src = src.replace(
  `<th style={{textAlign:"right"}}>IR01</th><th style={{textAlign:"right"}}>IR01_DISC</th>`,
  `<th style={{textAlign:"right"}}><Tip metric="IR01">IR01</Tip></th><th style={{textAlign:"right"}}><Tip metric="IR01_DISC">IR01_DISC</Tip></th>`
);

fs.writeFileSync(FILE, src, 'utf8');
console.log('  ✓ Tip wired to NPV, IR01, IR01_DISC, THETA, leg table headers');
console.log('Done. Hover over any sensitivity label to see explanation.');
