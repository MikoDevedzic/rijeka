// sprint4d_leg_ux.js
// node C:\Users\mikod\OneDrive\Desktop\Rijeka\sprint4d_leg_ux.js

const fs   = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';
const NTW  = path.join(ROOT, 'frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx');
const CSS  = path.join(ROOT, 'frontend\\src\\index.css');

let ok = 0, fail = 0;
function swap(filePath, anchor, replacement, label) {
  let src = fs.readFileSync(filePath, 'utf8');
  if (!src.includes(anchor)) {
    console.error(`  ✗ Anchor not found: ${label}`);
    console.error(`    ${JSON.stringify(anchor.substring(0,80))}`);
    fail++; return;
  }
  fs.writeFileSync(filePath, src.replace(anchor, replacement), 'utf8');
  console.log(`  ✓ ${label}`);
  ok++;
}

// ── 1. LegCard — only leg 0 open by default + info-dense header ─────────────
console.log('\n[1/3] LegCard — smarter default open + enriched header');

swap(NTW,
`function LegCard({leg,legIdx,legs,setLegs}) {
  const [open,setOpen]=useState(true)
  const set=(k,v)=>setLegs(legs.map((l,i)=>i===legIdx?{...l,[k]:v}:l))
  const remove=()=>setLegs(legs.filter((_,i)=>i!==legIdx))
  const dc=leg.direction==='PAY'?'var(--red)':'var(--accent)'
  return (
    <div className="leg-card">
      <div className="leg-card-hdr" onClick={()=>setOpen(!open)}>
        <span className="leg-dir-badge" style={{color:dc,borderColor:dc+'60'}}>{leg.direction}</span>
        <span className="leg-type-label">{leg.label}</span>
        <span className="leg-ccy">{leg.currency}</span>
        <span className="leg-notional">{leg.notional?Number(String(leg.notional).replace(/,/g,'')).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})+' '+leg.currency:'—'}</span>
        <span className={`leg-chevron ${open?'leg-chevron-open':''}`}>▾</span>
        {legs.length > 1 && (
          <button
            onClick={e=>{e.stopPropagation();remove()}}
            title="Remove leg"
            style={{
              background:'none', border:'none', color:'var(--text-dim)',
              cursor:'pointer', fontSize:'0.7rem', padding:'0 0.25rem',
              marginLeft:'0.25rem', lineHeight:1, transition:'color 0.12s',
            }}
            onMouseEnter={e=>e.target.style.color='var(--red)'}
            onMouseLeave={e=>e.target.style.color='var(--text-dim)'}
          >✕</button>
        )}
      </div>
      {open&&<div className="leg-body"><LegForm leg={leg} set={set} legs={legs} legIdx={legIdx}/></div>}
    </div>
  )
}`,

`// ── leg summary badges — shown in collapsed header ───────────────────────────
function legSummaryBadges(leg) {
  const badges = []
  const b = (txt, color='#4a6070') => ({ txt, color })

  // Key economic terms per leg type
  if (leg.leg_type === 'FIXED') {
    if (leg.fixed_rate || leg.rate)
      badges.push(b(((leg.fixed_rate||leg.rate)*100).toFixed(2)+'%', 'var(--accent)'))
    if (leg.frequency) badges.push(b(leg.frequency.replace('_','')))
    if (leg.day_count) badges.push(b(leg.day_count))
  } else if (leg.leg_type === 'FLOAT') {
    if (leg.index) badges.push(b(leg.index, 'var(--blue)'))
    const sp = parseFloat(leg.spread||leg.spread_bps||0)
    if (sp) badges.push(b((sp>0?'+':'')+sp+'bp'))
    if (leg.frequency) badges.push(b(leg.frequency.replace('_','')))
    if (leg.embedded_optionality && leg.embedded_optionality!=='NONE')
      badges.push(b('['+leg.embedded_optionality+']','var(--amber)'))
  } else if (['IR_SWAPTION','BERMUDAN_SWAPTION','CAP_FLOOR','FX_OPTION',
               'EQUITY_OPTION','COMMODITY_OPTION','CDS_OPTION'].includes(leg.leg_type)) {
    if (leg.option_type) badges.push(b(leg.option_type,'var(--amber)'))
    if (leg.exercise_style) badges.push(b(leg.exercise_style))
    if (leg.premium_type && leg.premium_type!=='UPFRONT') badges.push(b(leg.premium_type,'var(--purple)'))
    if (leg.premium) badges.push(b('Prem '+Number(leg.premium).toLocaleString()))
  } else if (leg.leg_type === 'CALLABLE_SWAP_OPTION') {
    if (leg.callable_party) badges.push(b(leg.callable_party.replace('_',' '),'var(--amber)'))
    if (leg.exercise_style) badges.push(b(leg.exercise_style))
  } else if (leg.leg_type === 'CAPPED_FLOORED_FLOAT') {
    if (leg.embedded_optionality) badges.push(b(leg.embedded_optionality,'var(--amber)'))
    if (leg.index) badges.push(b(leg.index,'var(--blue)'))
  } else if (leg.leg_type === 'INFLATION') {
    if (leg.index) badges.push(b(leg.index,'var(--blue)'))
    if (leg.inflation_type) badges.push(b(leg.inflation_type==='YOY'?'YoY':'ZC'))
  } else if (leg.leg_type === 'CMS') {
    if (leg.cms_tenor) badges.push(b('CMS'+leg.cms_tenor,'var(--blue)'))
  }

  // Always show maturity if set
  if (leg.maturity_date) badges.push(b('mat '+leg.maturity_date.substring(2)))

  return badges
}

function LegCard({leg,legIdx,legs,setLegs}) {
  // Only first leg open by default — avoids wall-of-forms with multi-leg instruments
  const [open,setOpen]=useState(legIdx===0)
  const set=(k,v)=>setLegs(legs.map((l,i)=>i===legIdx?{...l,[k]:v}:l))
  const remove=()=>setLegs(legs.filter((_,i)=>i!==legIdx))
  const dc=leg.direction==='PAY'?'var(--red)':'var(--accent)'
  const badges = legSummaryBadges(leg)
  return (
    <div className="leg-card">
      <div className="leg-card-hdr" onClick={()=>setOpen(!open)}>
        <span className="leg-dir-badge" style={{color:dc,borderColor:dc+'60'}}>{leg.direction}</span>
        <span className="leg-type-label">{leg.label}</span>
        <span className="leg-ccy">{leg.currency}</span>
        <span className="leg-notional">{leg.notional?Number(String(leg.notional).replace(/,/g,'')).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})+' '+leg.currency:'—'}</span>
        {!open && badges.length > 0 && (
          <span className="leg-summary-badges">
            {badges.map((b,i)=>(
              <span key={i} className="leg-summary-badge" style={{color:b.color,borderColor:b.color+'50'}}>
                {b.txt}
              </span>
            ))}
          </span>
        )}
        <span style={{flex:1}}/>
        <span className={`leg-chevron ${open?'leg-chevron-open':''}`}>▾</span>
        {legs.length > 1 && (
          <button
            onClick={e=>{e.stopPropagation();remove()}}
            title="Remove leg"
            style={{
              background:'none', border:'none', color:'var(--text-dim)',
              cursor:'pointer', fontSize:'0.7rem', padding:'0 0.25rem',
              marginLeft:'0.25rem', lineHeight:1, transition:'color 0.12s',
            }}
            onMouseEnter={e=>e.target.style.color='var(--red)'}
            onMouseLeave={e=>e.target.style.color='var(--text-dim)'}
          >✕</button>
        )}
      </div>
      {open&&<div className="leg-body"><LegForm leg={leg} set={set} legs={legs} legIdx={legIdx}/></div>}
    </div>
  )
}`,
  'LegCard: first-leg-only open + legSummaryBadges in collapsed header'
);

// ── 2. Collapse all / Expand all above legs.map ──────────────────────────────
console.log('\n[2/3] Add LEGS header with count + collapse/expand all');

swap(NTW,
  `        {/* Sprint 4C: IR OPTIONS quick-switch grid */}`,
  `        {/* Sprint 4D: legs header — count + collapse/expand all */}
        {legs.length > 0 && (
          <div className="legs-header">
            <span className="legs-header__label">LEGS — {legs.length} LEG{legs.length!==1?'S':''}</span>
            <div className="legs-header__actions">
              <button className="legs-header__btn"
                onClick={()=>{
                  // Collapse all — workaround: remount by toggling a key
                  // We use a simpler approach: dispatch click on all open chevrons
                  document.querySelectorAll('.leg-card-hdr').forEach(hdr=>{
                    const chevron=hdr.querySelector('.leg-chevron-open')
                    if(chevron) hdr.click()
                  })
                }}>COLLAPSE ALL</button>
              <button className="legs-header__btn"
                onClick={()=>{
                  document.querySelectorAll('.leg-card-hdr').forEach(hdr=>{
                    const chevron=hdr.querySelector('.leg-chevron')
                    if(!chevron?.classList.contains('leg-chevron-open')) hdr.click()
                  })
                }}>EXPAND ALL</button>
            </div>
          </div>
        )}
        {/* Sprint 4C: IR OPTIONS quick-switch grid */}`,
  'Added LEGS header with collapse/expand all controls'
);

// ── 3. CSS ───────────────────────────────────────────────────────────────────
console.log('\n[3/3] CSS — leg summary badges + legs header');

{
  let css = fs.readFileSync(CSS, 'utf8');
  if (!css.includes('leg-summary-badges')) {
    css += `
/* ── Sprint 4D: leg UX improvements ───────────────────────────────────────── */

/* Summary badges shown in collapsed leg header */
.leg-summary-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: 8px;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.leg-summary-badge {
  border: 1px solid;
  border-radius: 3px;
  color: var(--text-dim);
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  white-space: nowrap;
}

/* Legs section header */
.legs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  margin-top: 4px;
}
.legs-header__label {
  color: var(--text-muted, #8899aa);
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.legs-header__actions {
  display: flex;
  gap: 6px;
}
.legs-header__btn {
  background: none;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 3px;
  color: var(--text-dim, #6a8090);
  cursor: pointer;
  font-family: var(--mono, 'JetBrains Mono', monospace);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 3px 8px;
  transition: border-color 0.12s, color 0.12s;
}
.legs-header__btn:hover {
  border-color: var(--accent, #0ec9a0);
  color: var(--accent, #0ec9a0);
}

/* Make collapsed leg-card-hdr more compact */
.leg-card-hdr {
  min-height: 36px;
}

/* ── end Sprint 4D ─────────────────────────────────────────────────────────── */
`;
    fs.writeFileSync(CSS, css, 'utf8');
    console.log('  ✓ Appended leg UX CSS');
    ok++;
  } else {
    console.log('  ℹ CSS already present');
    ok++;
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log(`Sprint 4D complete: ${ok} passed, ${fail} failed`);
if (fail === 0) {
  console.log('\n✅ Verify in browser:');
  console.log('   1. Select BERMUDAN SWAPTION (4 legs) — only leg 1 open');
  console.log('   2. Collapsed legs show dir/label/notional + key term badges');
  console.log('   3. COLLAPSE ALL / EXPAND ALL buttons above legs work');
  console.log('   4. Switch to IR SWAP VANILLA — leg 1 open, leg 2 collapsed');
  console.log('   5. Collapsed FIXED leg badge shows rate% + frequency + day count');
  console.log('   6. Collapsed FLOAT leg badge shows index + spread if set');
} else {
  console.log('\n⚠  Fix ✗ items and re-run.');
}
console.log('─'.repeat(60));
