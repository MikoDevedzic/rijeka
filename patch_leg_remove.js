const fs = require('fs');
const path = require('path');

const filePath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx';
let src = fs.readFileSync(filePath, 'utf8');

// ── 1. Add remove button to leg card header ───────────────────────────────────
src = src.replace(
  `function LegCard({leg,legIdx,legs,setLegs}) {
  const [open,setOpen]=useState(true)
  const set=(k,v)=>setLegs(legs.map((l,i)=>i===legIdx?{...l,[k]:v}:l))
  const dc=leg.direction==='PAY'?'var(--red)':'var(--accent)'
  return (
    <div className="leg-card">
      <div className="leg-card-hdr" onClick={()=>setOpen(!open)}>
        <span className="leg-dir-badge" style={{color:dc,borderColor:dc+'60'}}>{leg.direction}</span>
        <span className="leg-type-label">{leg.label}</span>
        <span className="leg-ccy">{leg.currency}</span>
        <span className="leg-notional">{leg.notional?Number(String(leg.notional).replace(/,/g,'')).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})+' '+leg.currency:'—'}</span>
        <span className={\`leg-chevron \${open?'leg-chevron-open':''}\`}>▾</span>
      </div>`,
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
        <span className={\`leg-chevron \${open?'leg-chevron-open':''}\`}>▾</span>
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
      </div>`
);

fs.writeFileSync(filePath, src, 'utf8');
console.log('✅  Leg remove button added.');
console.log('    ✕ appears on hover on any leg header.');
console.log('    Button hidden when only 1 leg remains (cannot remove last leg).');
