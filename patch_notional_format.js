const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

// ── 1. Patch BookTab.jsx — fmt() function ─────────────────────────────────────
const bookPath = path.join(ROOT, 'components', 'blotter', 'BookTab.jsx');
let book = fs.readFileSync(bookPath, 'utf8');

book = book.replace(
  `function fmt(n) {
  if (!n) return '—'
  if (n>=1e9) return \`\${(n/1e9).toFixed(1)}B\`
  if (n>=1e6) return \`\${(n/1e6).toFixed(0)}M\`
  if (n>=1e3) return \`\${(n/1e3).toFixed(0)}K\`
  return String(n)
}`,
  `function fmt(n) {
  if (!n && n !== 0) return '—'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}`
);

// Update the notional cell to show CCY inline
book = book.replace(
  `<td className="td-num">{fmt(t.notional)}<span className="ccy-label">{t.notional_ccy}</span></td>`,
  `<td className="td-num">{fmt(t.notional)} <span className="ccy-label">{t.notional_ccy}</span></td>`
);

fs.writeFileSync(bookPath, book, 'utf8');
console.log('✅  BookTab.jsx — notional formatted as 10,000,000 USD');

// ── 2. Patch TradeWorkspace.jsx — fmtN() function ─────────────────────────────
const twPath = path.join(ROOT, 'components', 'blotter', 'TradeWorkspace.jsx');
let tw = fs.readFileSync(twPath, 'utf8');

tw = tw.replace(
  `function fmtN(n) {
  if (!n) return '—'
  if (n>=1e9) return \`\${(n/1e9).toFixed(2)}B\`
  if (n>=1e6) return \`\${(n/1e6).toFixed(2)}M\`
  if (n>=1e3) return \`\${(n/1e3).toFixed(2)}K\`
  return n.toLocaleString()
}`,
  `function fmtN(n, ccy) {
  if (!n && n !== 0) return '—'
  const num = Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return ccy ? \`\${num} \${ccy}\` : num
}`
);

// Update the overview panel notional field to pass CCY
tw = tw.replace(
  `['NOTIONAL',fmtN(t.notional)],`,
  `['NOTIONAL',fmtN(t.notional, t.notional_ccy)],`
);

fs.writeFileSync(twPath, tw, 'utf8');
console.log('✅  TradeWorkspace.jsx — notional formatted as 10,000,000 USD');

// ── 3. Patch NewTradeWorkspace.jsx — auto-format notional input on blur ────────
const ntwPath = path.join(ROOT, 'components', 'blotter', 'NewTradeWorkspace.jsx');
let ntw = fs.readFileSync(ntwPath, 'utf8');

// Replace the notional input in CommonLegFields to auto-format on blur
ntw = ntw.replace(
  `    {leg.notional_type==='BULLET'&&<div className="fg"><label>NOTIONAL</label><input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}/></div>}`,
  `    {leg.notional_type==='BULLET'&&<div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000"
        value={leg.notional}
        onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{
          const raw = parseFloat(e.target.value.replace(/,/g,''))
          if (!isNaN(raw)) set('notional', raw.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))
        }}
      />
    </div>}`
);

// Also format the initial/final notional fields
ntw = ntw.replace(
  `  <div className="fg"><label>INITIAL NOTIONAL</label><input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}/></div>
      <div className="fg"><label>FINAL NOTIONAL</label><input placeholder="0" value={leg.final_notional||''} onChange={e=>set('final_notional',e.target.value)}/></div>`,
  `  <div className="fg"><label>INITIAL NOTIONAL</label>
        <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
          onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
      </div>
      <div className="fg"><label>FINAL NOTIONAL</label>
        <input placeholder="0" value={leg.final_notional||''} onChange={e=>set('final_notional',e.target.value)}
          onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('final_notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
      </div>`
);

// Update leg card header to show formatted notional
ntw = ntw.replace(
  `<span className="leg-notional">{leg.notional?Number(String(leg.notional).replace(/,/g,'')).toLocaleString():'—'}</span>`,
  `<span className="leg-notional">{leg.notional?Number(String(leg.notional).replace(/,/g,'')).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})+' '+leg.currency:'—'}</span>`
);

// Update getNotional to handle formatted strings
ntw = ntw.replace(
  `    const firstLeg=legs[0]
    const notional=firstLeg?parseFloat(String(firstLeg.notional||'').replace(/,/g,''))||null:null`,
  `    const firstLeg=legs[0]
    const notional=firstLeg?parseFloat(String(firstLeg.notional||'').replace(/,/g,'').replace(/\s/g,''))||null:null`
);

fs.writeFileSync(ntwPath, ntw, 'utf8');
console.log('✅  NewTradeWorkspace.jsx — notional inputs auto-format on blur');

// ── 4. Update SummaryBar in BookTab to show full format ───────────────────────
// The summary bar top notionals already use fmt() so they'll pick up the change.
// Just need to ensure the ccy-label style looks clean next to the number.
const bookCss = path.join(ROOT, 'components', 'blotter', 'BookTab.css');
let css = fs.readFileSync(bookCss, 'utf8');
css = css.replace(
  `.ccy-label { font-size:0.62rem; opacity:0.5; margin-left:0.2rem; }`,
  `.ccy-label { font-size:0.62rem; opacity:0.6; margin-left:0.3rem; font-weight:600; letter-spacing:0.06em; }`
);
fs.writeFileSync(bookCss, css, 'utf8');
console.log('✅  BookTab.css — CCY label styling updated');

console.log('\nAll done. Examples:');
console.log('  Blotter grid:    10,000,000 USD');
console.log('  Leg card header: 10,000,000 USD');
console.log('  Trade overview:  10,000,000 USD');
console.log('  Input field:     auto-formats to 10,000,000 on blur');
