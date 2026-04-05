// add_float_leg_params.js — adds INDEX, SPREAD, LEVERAGE to booking window
// Run: node C:\Users\mikod\OneDrive\Desktop\Rijeka\add_float_leg_params.js

const fs = require('fs');
const PATH = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx';
let f = fs.readFileSync(PATH, 'utf8');

// ── 1. Add INDEX_OPTIONS and INDEX_CURVE_MAP after CCY_FLOAT_DC ──────────────
const AFTER_CCY_FLOAT_DC = `const CCY_FLOAT_DC = {
  USD: 'ACT/360', EUR: 'ACT/360', GBP: 'ACT/365F',
  JPY: 'ACT/365F', CHF: 'ACT/360', AUD: 'ACT/365F', CAD: 'ACT/365F',
}`;

const CCY_INDEX_BLOCK = `const CCY_FLOAT_DC = {
  USD: 'ACT/360', EUR: 'ACT/360', GBP: 'ACT/365F',
  JPY: 'ACT/365F', CHF: 'ACT/360', AUD: 'ACT/365F', CAD: 'ACT/365F',
}

// Floating index options per currency
const CCY_INDICES = {
  USD: ['SOFR','TERM SOFR 1M','TERM SOFR 3M','EFFR'],
  EUR: ['\\u20acSTR','EURIBOR 3M','EURIBOR 6M'],
  GBP: ['SONIA','TERM SONIA 3M'],
  JPY: ['TONAR','TIBOR 3M'],
  CHF: ['SARON'],
  AUD: ['AONIA','BBSW 3M'],
  CAD: ['CORRA'],
}

// Index label → forecast curve ID
const INDEX_CURVE = {
  'SOFR':          'USD_SOFR',
  'TERM SOFR 1M':  'USD_TSOFR_1M',
  'TERM SOFR 3M':  'USD_TSOFR_3M',
  'EFFR':          'USD_EFFR',
  '\\u20acSTR':    'EUR_ESTR',
  'EURIBOR 3M':    'EUR_EURIBOR_3M',
  'EURIBOR 6M':    'EUR_EURIBOR_6M',
  'SONIA':         'GBP_SONIA',
  'TERM SONIA 3M': 'GBP_SONIA_3M',
  'TONAR':         'JPY_TONAR',
  'TIBOR 3M':      'JPY_TIBOR_3M',
  'SARON':         'CHF_SARON',
  'AONIA':         'AUD_AONIA',
  'BBSW 3M':       'AUD_BBSW_3M',
  'CORRA':         'CAD_CORRA',
}`;

f = f.replace(AFTER_CCY_FLOAT_DC, CCY_INDEX_BLOCK);

// ── 2. Add state for index, spread, leverage after rate state ────────────────
f = f.replace(
  `  const [rate,   setRate]   = useState('')`,
  `  const [rate,   setRate]   = useState('')
  const [index,  setIndex]  = useState('SOFR')
  const [spread, setSpread] = useState('0')
  const [leverage,setLeverage]=useState('1.0')`
);

// ── 3. Reset index when CCY changes ─────────────────────────────────────────
f = f.replace(
  `  const [booking,     setBooking]     = useState(false)`,
  `  // Reset index when currency changes
  useEffect(() => { setIndex((CCY_INDICES[ccy] || ['SOFR'])[0]) }, [ccy])

  const [booking,     setBooking]     = useState(false)`
);

// ── 4. Wire spread and leverage into buildLegs float leg ─────────────────────
f = f.replace(
  `        fixed_rate: 0, spread: 0,
        discount_curve_id: curveId, forecast_curve_id: curveId,`,
  `        fixed_rate: 0, spread: spread ? parseFloat(spread)/10000 : 0,
        leverage: leverage ? parseFloat(leverage) : 1.0,
        discount_curve_id: curveId, forecast_curve_id: INDEX_CURVE[index] || curveId,`
);

// ── 5. Add INDEX / SPREAD / LEVERAGE row in UI after DIRECTION/FIXED RATE row ─
f = f.replace(
  `              <div className="tbw-section-lbl">ECONOMICS</div>
              <div className="tbw-row4">`,
  `              <div className="tbw-section-lbl">ECONOMICS</div>
              <div className="tbw-row4">`
);

// Add the float leg params row after FIXED RATE row (after the tbw-row4 closing div)
f = f.replace(
  `              </div>
              <div className="tbw-row3">
                <F label="EFFECTIVE DATE">`,
  `              </div>

              {/* Floating leg parameters */}
              <div className="tbw-section-lbl" style={{marginTop:'6px'}}>FLOATING LEG</div>
              <div style={{display:'flex', gap:'8px', alignItems:'flex-end', marginBottom:'8px'}}>
                <div style={{flex:3}}>
                  <div className="tbw-lbl">INDEX</div>
                  <div className="tbw-chip-row" style={{flexWrap:'wrap'}}>
                    {(CCY_INDICES[ccy]||['SOFR']).map(idx=>(
                      <button key={idx}
                        className={\`tbw-chip \${index===idx?'active':''}\`}
                        onClick={()=>setIndex(idx)}
                        style={{fontSize:'0.46rem'}}
                      >{idx}</button>
                    ))}
                  </div>
                </div>
                <F label="SPREAD (bp)">
                  <input className="tbw-input" type="text" value={spread}
                    placeholder="0" autoComplete="off"
                    style={{width:'80px'}}
                    onChange={e=>setSpread(e.target.value)}/>
                </F>
                <F label="LEVERAGE">
                  <input className="tbw-input" type="text" value={leverage}
                    placeholder="1.0" autoComplete="off"
                    style={{width:'80px'}}
                    onChange={e=>setLeverage(e.target.value)}/>
                </F>
              </div>

              <div className="tbw-row3">
                <F label="EFFECTIVE DATE">`
);

fs.writeFileSync(PATH, f, 'utf8');
console.log('Done.');
console.log('Added: INDEX chip selector per CCY, SPREAD (bp), LEVERAGE fields.');
console.log('Float leg now uses: INDEX_CURVE[index] as forecast_curve_id, spread/10000, leverage.');
console.log('Index resets automatically when CCY changes.');
