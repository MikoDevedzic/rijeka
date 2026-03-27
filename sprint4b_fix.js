// sprint4b_fix.js
const fs   = require('fs');
const path = require('path');
const NTW  = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka',
                       'frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx');

let src = fs.readFileSync(NTW, 'utf8');

const OLD = `      <div className="sec-lbl">PREMIUM</div>
      <div className="row3">
        <div className="fg"><label>PREMIUM AMOUNT</label><input placeholder="0" value={leg.premium||''} onChange={e=>set('premium',e.target.value)}/></div>
        <div className="fg"><label>PREMIUM CCY</label><select value={leg.premium_currency||'USD'} onChange={e=>set('premium_currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
        <div className="fg"><label>PREMIUM DATE</label><input type="date" value={leg.premium_date||''} onChange={e=>set('premium_date',e.target.value)}/></div>
      </div>`;

const count = src.split(OLD).length - 1;
if (count > 0) {
  src = src.split(OLD).join(`      <PremiumSection leg={leg} set={set}/>`);
  fs.writeFileSync(NTW, src, 'utf8');
  console.log(`✓ Replaced ${count} row3 premium block(s) — Sprint 4B complete 8/8`);
} else {
  // Show what's actually there
  const lines = src.split('\n');
  const idx = lines.findIndex(l => l.includes('sec-lbl">PREMIUM'));
  console.error('✗ Still not matching. Actual lines:');
  if (idx >= 0) lines.slice(idx, idx+8).forEach((l,i) => console.error(`L${idx+i+1}: ${JSON.stringify(l)}`));
}
