// SPRINT_4E_NTW.js
// Transforms ntw-right in NewTradeWorkspace.jsx:
//   - Adds INDICATIVE PRICER zone (flat rate input, RUN, NPV + leg PVs)
//   - Keeps CASHFLOW PREVIEW below it (scrollable)
//   - All pricing is client-side (no trade_id at this stage)
// Also appends CSS to NewTradeWorkspace.css

const fs = require('fs');

const JSX = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx';
const CSS = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\NewTradeWorkspace.css';

// ─────────────────────────────────────────────────────────────────────────────
// 1. CSS — append pricer zone styles
// ─────────────────────────────────────────────────────────────────────────────
const newCSS = `
/* Sprint 4E: ntw-right indicative pricer zone */
.ntw-pricer-zone { padding:0.75rem 1rem; border-bottom:1px solid var(--border); flex-shrink:0; background:var(--bg-deep); }
.ntw-curve-row { display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem; }
.ntw-curve-id { font-size:0.6rem; font-weight:700; letter-spacing:0.1em; color:var(--text-dim); min-width:72px; }
.ntw-curve-input { background:var(--panel-2); border:1px solid var(--border); color:var(--text); font-family:var(--mono); font-size:0.78rem; padding:0.25rem 0.45rem; border-radius:2px; outline:none; width:78px; text-align:right; }
.ntw-curve-input:focus { border-color:var(--accent); }
.ntw-curve-unit { font-size:0.68rem; color:var(--text-dim); }
.ntw-run-btn { margin-left:auto; padding:0.25rem 0.9rem; background:rgba(14,201,160,0.07); border:1px solid var(--accent); border-radius:2px; font-family:var(--mono); font-size:0.62rem; font-weight:700; letter-spacing:0.1em; color:var(--accent); cursor:pointer; transition:background 0.12s; }
.ntw-run-btn:hover { background:rgba(14,201,160,0.16); }
.ntw-metrics { display:grid; grid-template-columns:1fr 1fr; gap:0.4rem; margin-top:0.5rem; }
.ntw-metric { background:var(--panel); border:1px solid var(--border); border-radius:2px; padding:0.4rem 0.6rem; }
.ntw-metric-label { font-size:0.55rem; font-weight:700; letter-spacing:0.12em; color:var(--text-dim); margin-bottom:0.15rem; }
.ntw-metric-value { font-size:0.82rem; font-weight:700; font-family:var(--mono); }
.ntw-metric-sub { font-size:0.55rem; color:var(--text-dim); margin-top:0.1rem; }
.ntw-pricer-empty { padding:1rem; text-align:center; font-size:0.62rem; color:var(--text-dim); letter-spacing:0.08em; }
.ntw-leg-pvs { margin-top:0.4rem; border-top:1px solid var(--border); padding-top:0.4rem; }
.ntw-leg-pv-row { display:flex; justify-content:space-between; align-items:center; padding:0.15rem 0; font-size:0.6rem; font-family:var(--mono); }
.ntw-leg-pv-ref { color:var(--text-dim); }
.ntw-cf-footer { padding:0.4rem 0.75rem; font-size:0.58rem; color:var(--text-dim); border-top:1px solid var(--border); font-style:italic; flex-shrink:0; }
`;

const existingCSS = fs.readFileSync(CSS, 'utf8');
if (!existingCSS.includes('ntw-pricer-zone')) {
  fs.writeFileSync(CSS, existingCSS + newCSS, 'utf8');
  console.log('  ✓ CSS appended');
} else {
  console.log('  i CSS already patched');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. JSX — patch NewTradeWorkspace
// ─────────────────────────────────────────────────────────────────────────────
let src = fs.readFileSync(JSX, 'utf8');
const orig = src;

// Guard
if (src.includes('ntw-pricer-zone')) {
  console.log('  i JSX already patched'); process.exit(0);
}

// ── 2a. Add indicative pricing state + function after existing state declarations
// Anchor: the cfs= line (confirmed from diagnostic L1859)
const cfsLine = `  const cfs=genCFs(legs,effectiveDate,maturityDate)`;

const pricerLogic = `
  // Sprint 4E: indicative pricer state
  const [indRate, setIndRate] = React.useState('5.25')
  const [indResult, setIndResult] = React.useState(null)
  const [indBusy, setIndBusy] = React.useState(false)

  const runIndicative = React.useCallback(() => {
    setIndBusy(true)
    const r = parseFloat(indRate) / 100
    if (isNaN(r) || r <= 0 || !effectiveDate || !maturityDate) {
      setIndResult(null); setIndBusy(false); return
    }
    const today = new Date(effectiveDate)
    const FM = {MONTHLY:1,QUARTERLY:3,'SEMI-ANNUAL':6,ANNUAL:12}
    let totalNPV = 0
    const legPVs = []
    legs.forEach((leg, li) => {
      const N = parseFloat(String(leg.notional||'').replace(/,/g,'')) || 0
      const m = FM[leg.frequency]
      if (!m || !N) { legPVs.push({label:leg.label||('L'+(li+1)), direction:leg.direction, pv:0}); return }
      const sign = leg.direction === 'PAY' ? -1 : 1
      let legPV = 0
      let d = new Date(effectiveDate); d.setMonth(d.getMonth() + m)
      const matD = new Date(maturityDate)
      while (d <= matD) {
        const t = Math.max((d - today) / (365.25 * 86400000), 0)
        const df = Math.exp(-r * t)
        const dcf = m / 12
        const rate = leg.leg_type === 'FIXED' ? (parseFloat(leg.fixed_rate) || 0) : r
        legPV += N * rate * dcf * df
        d = new Date(d); d.setMonth(d.getMonth() + m)
      }
      legPV *= sign
      totalNPV += legPV
      legPVs.push({label: leg.label || ('L' + (li+1)), direction: leg.direction, pv: legPV})
    })
    // PV01: bump 1bp
    let npv1bp = 0
    const r1 = r + 0.0001
    legs.forEach((leg) => {
      const N = parseFloat(String(leg.notional||'').replace(/,/g,'')) || 0
      const m = FM[leg.frequency]
      if (!m || !N) return
      const sign = leg.direction === 'PAY' ? -1 : 1
      let legPV = 0
      let d = new Date(effectiveDate); d.setMonth(d.getMonth() + m)
      const matD = new Date(maturityDate)
      while (d <= matD) {
        const t = Math.max((d - today) / (365.25 * 86400000), 0)
        const df = Math.exp(-r1 * t)
        const dcf = m / 12
        const rate = leg.leg_type === 'FIXED' ? (parseFloat(leg.fixed_rate) || 0) : r1
        legPV += N * rate * dcf * df
        d = new Date(d); d.setMonth(d.getMonth() + m)
      }
      npv1bp += sign * legPV
    })
    const pv01 = npv1bp - totalNPV
    setIndResult({npv: totalNPV, pv01, legs: legPVs})
    setIndBusy(false)
  }, [legs, effectiveDate, maturityDate, indRate])

`;

if (!src.includes('indRate')) {
  if (!src.includes(cfsLine)) {
    console.error('MISS: cfs line anchor'); process.exit(1);
  }
  src = src.replace(cfsLine, pricerLogic + cfsLine);
  console.log('  ✓ indicative pricing logic injected');
}

// ── 2b. Replace ntw-right content
// Find the ntw-right div and replace its entire content
const rightStart = `        <div className="ntw-right">`;
const rightIdx = src.indexOf(rightStart);
if (rightIdx === -1) { console.error('MISS: ntw-right div'); process.exit(1); }

// Find the closing </div> of ntw-right by tracking depth
let depth = 0, i = rightIdx, end = -1;
while (i < src.length) {
  if (src[i] === '<') {
    if (src.slice(i, i+4) === '<div' && (src[i+4] === ' ' || src[i+4] === '\n' || src[i+4] === '>')) depth++;
    if (src.slice(i, i+6) === '</div>') { depth--; if (depth === 0) { end = i + 6; break; } }
  }
  i++;
}
if (end === -1) { console.error('MISS: ntw-right closing div'); process.exit(1); }

const fmtCcy = (v) => `v >= 0 ? '+$' + Math.round(v).toLocaleString('en-US') : '-$' + Math.round(Math.abs(v)).toLocaleString('en-US')`;

const newRight = `        <div className="ntw-right">

          {/* ── Indicative Pricer ── */}
          <div className="ntw-section-hdr">INDICATIVE PRICER</div>
          <div className="ntw-pricer-zone">
            <div className="ntw-curve-row">
              <span className="ntw-curve-id">FLAT RATE</span>
              <input
                className="ntw-curve-input"
                type="text"
                inputMode="decimal"
                value={indRate}
                onChange={e => setIndRate(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runIndicative()}
              />
              <span className="ntw-curve-unit">%</span>
              <button className="ntw-run-btn" onClick={runIndicative} disabled={indBusy}>
                {indBusy ? '...' : '▶ RUN'}
              </button>
            </div>

            {!indResult && (
              <div className="ntw-pricer-empty">Enter rate and click RUN to see indicative NPV</div>
            )}

            {indResult && (() => {
              const npv = indResult.npv
              const pv01 = indResult.pv01
              const npvColor = npv >= 0 ? 'var(--accent)' : 'var(--red)'
              const fmtAmt = v => (v >= 0 ? '+' : '-') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US')
              return (
                <>
                  <div className="ntw-metrics">
                    <div className="ntw-metric">
                      <div className="ntw-metric-label">NPV</div>
                      <div className="ntw-metric-value" style={{color:npvColor}}>{fmtAmt(npv)}</div>
                      <div className="ntw-metric-sub">indicative</div>
                    </div>
                    <div className="ntw-metric">
                      <div className="ntw-metric-label">PV01</div>
                      <div className="ntw-metric-value" style={{color:'var(--blue)'}}>{fmtAmt(pv01)}</div>
                      <div className="ntw-metric-sub">+1bp parallel</div>
                    </div>
                  </div>
                  <div className="ntw-leg-pvs">
                    {indResult.legs.map((lp, li) => (
                      <div key={li} className="ntw-leg-pv-row">
                        <span className="ntw-leg-pv-ref">{lp.label}</span>
                        <span style={{color: lp.pv >= 0 ? 'var(--accent)' : 'var(--red)', fontWeight:700}}>{fmtAmt(lp.pv)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>

          {/* ── Cashflow Preview ── */}
          <div className="ntw-section-hdr">
            CASHFLOW PREVIEW{cfs.length > 0 ? \` — \${cfs.length} flows\` : ''}
          </div>
          <div className="cf-preview">
            {cfs.length === 0
              ? <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.68rem',letterSpacing:'0.1em'}}>SET EFFECTIVE AND MATURITY DATES TO PREVIEW</div>
              : <table className="cf-table">
                  <thead><tr><th>DATE</th><th>LEG</th><th>DIR</th><th>TYPE</th><th>CCY</th><th style={{textAlign:'right'}}>EST. AMOUNT</th></tr></thead>
                  <tbody>
                    {cfs.map((cf, i) => (
                      <tr key={i}>
                        <td>{cf.date}</td>
                        <td style={{color:'var(--text-dim)',fontSize:'0.62rem'}}>{cf.label}</td>
                        <td><span style={{color:cf.dir==='PAY'?'var(--red)':'var(--accent)',fontWeight:700,fontSize:'0.62rem'}}>{cf.dir}</span></td>
                        <td style={{color:'var(--text-dim)',fontSize:'0.62rem'}}>{cf.type}</td>
                        <td style={{color:'var(--text-dim)'}}>{cf.ccy}</td>
                        <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'0.68rem',color:cf.dir==='PAY'?'var(--red)':'var(--accent)',opacity:0.75}}>
                          {cf.amount
                            ? (cf.dir==='PAY'?'-':'+')+Math.round(cf.amount).toLocaleString('en-US')
                            : <span style={{color:'var(--text-dim)'}}>—</span>}
                          <span style={{fontSize:'0.55rem',color:'var(--text-dim)',marginLeft:3}}>est</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </div>
          <div className="ntw-cf-footer">Amounts are indicative. Confirmed at booking via pricing engine.</div>
        </div>`;

src = src.slice(0, rightIdx) + newRight + src.slice(end);
console.log('  ✓ ntw-right replaced with pricer + cashflow zones');

// ── 2c. Add React import if missing (for React.useState, React.useCallback)
if (!src.includes('import React') && !src.includes("import { useState")) {
  // Already has useState from 'react' — just need React.useState → useState
  src = src.replace(/React\.useState/g, 'useState');
  src = src.replace(/React\.useCallback/g, 'useCallback');
  // Add useCallback to imports
  src = src.replace(
    "import { useState, useEffect } from 'react'",
    "import { useState, useEffect, useCallback } from 'react'"
  );
  console.log('  ✓ React.useState/useCallback → named imports');
} else {
  // Has named imports — replace React. prefix
  src = src.replace(/React\.useState/g, 'useState');
  src = src.replace(/React\.useCallback/g, 'useCallback');
  if (!src.includes('useCallback')) {
    src = src.replace(
      "import { useState, useEffect } from 'react'",
      "import { useState, useEffect, useCallback } from 'react'"
    );
  }
  console.log('  ✓ React. prefix removed, useCallback added to imports');
}

// Write
if (src === orig) { console.log('No changes.'); process.exit(1); }
fs.writeFileSync(JSX, src, 'utf8');
console.log('\n✓ Done. Vite will hot-reload.');
console.log('NEW TRADE → set dates → right panel shows INDICATIVE PRICER + CASHFLOW PREVIEW');
console.log('Enter 5.25 → RUN → NPV + PV01 + per-leg PVs appear above cashflows.');
