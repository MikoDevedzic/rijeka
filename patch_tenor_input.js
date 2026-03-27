const fs = require('fs');
const path = require('path');

const filePath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx';
let src = fs.readFileSync(filePath, 'utf8');

// ── 1. Add tenor parser utility after uuidv4 ──────────────────────────────────
src = src.replace(
  `// ── Leg ref generator — human readable + UUID ─────────────────────────────────`,
  `// ── Tenor parser — '5Y', '18M', '6M', '2Y6M', '90D' → maturity date ──────────
function parseTenor(tenor, fromDate) {
  if (!tenor || !fromDate) return ''
  const d = new Date(fromDate)
  if (isNaN(d.getTime())) return ''

  // Normalise: uppercase, trim
  const t = tenor.trim().toUpperCase()

  // Handle combined e.g. 2Y6M
  const combined = t.match(/^(\\d+)Y(\\d+)M$/)
  if (combined) {
    d.setFullYear(d.getFullYear() + parseInt(combined[1]))
    d.setMonth(d.getMonth() + parseInt(combined[2]))
    return d.toISOString().substring(0, 10)
  }

  // Single unit
  const match = t.match(/^(\\d+(?:\\.\\d+)?)(Y|M|W|D)$/)
  if (!match) return ''
  const n = parseFloat(match[1]), unit = match[2]

  if (unit === 'Y') { d.setFullYear(d.getFullYear() + Math.floor(n)); if (n % 1) d.setMonth(d.getMonth() + Math.round((n % 1) * 12)) }
  if (unit === 'M') d.setMonth(d.getMonth() + Math.round(n))
  if (unit === 'W') d.setDate(d.getDate() + Math.round(n * 7))
  if (unit === 'D') d.setDate(d.getDate() + Math.round(n))

  return d.toISOString().substring(0, 10)
}

// ── Leg ref generator — human readable + UUID ─────────────────────────────────`
);

// ── 2. Add tenor state variable ───────────────────────────────────────────────
src = src.replace(
  `  const [notionalExchange,setNotionalExchange]=useState(false)`,
  `  const [notionalExchange,setNotionalExchange]=useState(false)
  const [tenor,setTenor]=useState('5Y')`
);

// ── 3. Set default maturity date to 5Y from today ────────────────────────────
src = src.replace(
  `  const [maturityDate,setMatDate]=useState('')`,
  `  const [maturityDate,setMatDate]=useState(()=>parseTenor('5Y', new Date().toISOString().substring(0,10)))`
);

// ── 4. Replace the maturity date field with tenor + maturity side by side ─────
src = src.replace(
  `              <div className="fg"><label>MATURITY DATE *</label><input type="date" value={maturityDate} onChange={e=>setMatDate(e.target.value)}/></div>`,
  `              <div className="fg">
                <label>TENOR</label>
                <input
                  placeholder="5Y, 10Y, 6M, 18M, 2Y6M, 90D"
                  value={tenor}
                  onChange={e => {
                    setTenor(e.target.value)
                    const mat = parseTenor(e.target.value, effectiveDate)
                    if (mat) setMatDate(mat)
                  }}
                  style={{fontWeight:600, letterSpacing:'0.06em'}}
                />
              </div>
              <div className="fg">
                <label>MATURITY DATE *</label>
                <input
                  type="date"
                  value={maturityDate}
                  onChange={e => {
                    setMatDate(e.target.value)
                    setTenor('') // clear tenor when date is manually set
                  }}
                />
              </div>`
);

// ── 5. Update effectiveDate onChange to recalculate maturity if tenor set ─────
src = src.replace(
  `              <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={effectiveDate} onChange={e=>setEffDate(e.target.value)}/></div>`,
  `              <div className="fg"><label>EFFECTIVE DATE</label>
                <input type="date" value={effectiveDate} onChange={e=>{
                  setEffDate(e.target.value)
                  if (tenor) {
                    const mat = parseTenor(tenor, e.target.value)
                    if (mat) setMatDate(mat)
                  }
                }}/>
              </div>`
);

fs.writeFileSync(filePath, src, 'utf8');
console.log('✅  Tenor input patched.');
console.log('');
console.log('Supported tenor formats:');
console.log('  5Y    → 5 years from effective date');
console.log('  10Y   → 10 years');
console.log('  6M    → 6 months');
console.log('  18M   → 18 months');
console.log('  2Y6M  → 2 years and 6 months');
console.log('  90D   → 90 days');
console.log('  1W    → 1 week');
console.log('');
console.log('Default: 5Y (maturity pre-populated on load)');
console.log('Maturity recalculates when: tenor changes OR effective date changes');
console.log('Clearing tenor field and setting date directly also works');
