// wire_tenor_dates.js
// Run: node C:\Users\mikod\OneDrive\Desktop\Rijeka\wire_tenor_dates.js

const fs = require('fs');
const PATH = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx';

let f = fs.readFileSync(PATH, 'utf8');

// ── 1. Add TENORS constant after CURRENCIES ───────────────────────────────────
f = f.replace(
  `const CURRENCIES  = ['USD','EUR','GBP','JPY','CHF','AUD','CAD']`,
  `const CURRENCIES  = ['USD','EUR','GBP','JPY','CHF','AUD','CAD']

const TENORS = ['1M','2M','3M','6M','9M','1Y','18M','2Y','3Y','4Y','5Y','6Y','7Y','8Y','9Y','10Y','12Y','15Y','20Y','25Y','30Y','40Y','50Y']`
);

// ── 2. Add tenor state after matDate state ────────────────────────────────────
f = f.replace(
  `  const [matDate, setMatDate] = useState(defs.matDate)`,
  `  const [matDate, setMatDate] = useState(defs.matDate)
  const [tenor,   setTenor]   = useState('5Y')
  const [datesLoading, setDatesLoading] = useState(false)`
);

// ── 3. Add fetchScheduleDates function before applyIndexDefaults ──────────────
f = f.replace(
  `  const applyIndexDefaults = (idx) => {`,
  `  // Fetch computed dates from backend whenever tenor/ccy/tdate changes
  const fetchScheduleDates = async (newTenor, newCcy, newTdate) => {
    setDatesLoading(true)
    try {
      const { data:{ session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch(API + '/api/schedules/preview', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade_date: newTdate || tdate,
          tenor: newTenor || tenor,
          currency: newCcy || ccy,
        })
      })
      if (!res.ok) return
      const data = await res.json()
      setEffDate(data.effective_date)
      setMatDate(data.maturity_date)
    } catch(_) {}
    finally { setDatesLoading(false) }
  }

  const applyIndexDefaults = (idx) => {`
);

// ── 4. Call fetchScheduleDates on mount ───────────────────────────────────────
f = f.replace(
  `  // Reset on CCY change
  useEffect(() => {`,
  `  // Fetch dates on mount
  useEffect(() => { fetchScheduleDates('5Y', 'USD', tdate) }, [])

  // Reset on CCY change
  useEffect(() => {`
);

// ── 5. Update CCY change handler to also fetch dates ─────────────────────────
f = f.replace(
  `    if (rateRef.current) rateRef.current.dataset.userEdited = ''
  }, [ccy])`,
  `    if (rateRef.current) rateRef.current.dataset.userEdited = ''
    fetchScheduleDates(tenor, ccy, tdate)
  }, [ccy])`
);

// ── 6. Add tenor change handler ───────────────────────────────────────────────
f = f.replace(
  `  const applyIndexDefaults = (idx) => {`,
  `  const handleTenorChange = (t) => {
    setTenor(t)
    fetchScheduleDates(t, ccy, tdate)
    if (rateRef.current) rateRef.current.dataset.userEdited = ''
  }

  const applyIndexDefaults = (idx) => {`
);

// ── 7. Replace the PRIMARY ECONOMICS row — add TENOR, keep dates editable ─────
f = f.replace(
  `            <SectionHdr>PRIMARY ECONOMICS</SectionHdr>
            <Row>
              <Fld label="NOTIONAL" flex={2.5}>
                <input ref={notionalRef} style={{...inp,fontSize:'0.68rem',fontWeight:700}} type="text"
                  defaultValue="10,000,000" placeholder="10,000,000" autoComplete="off"
                  onBlur={e=>{const r=e.target.value.replace(/[^0-9]/g,'');e.target.value=r?Number(r).toLocaleString('en-US'):''}}/>
              </Fld>
              <Fld label="CCY" flex={0.9}>
                <select style={{...sel,fontSize:'0.68rem',fontWeight:700}} value={ccy} onChange={e=>setCcy(e.target.value)}>
                  {CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </Fld>
              <Fld label="DIRECTION" flex={1.8}>
                <div style={{display:'flex',gap:'5px',height:'31px'}}>
                  <DirBtn label="PAY FIXED"     active={dir==='PAY'}     color="var(--red)"    onClick={()=>setDir('PAY')}/>
                  <DirBtn label="RECEIVE FIXED" active={dir==='RECEIVE'} color="var(--accent)" onClick={()=>setDir('RECEIVE')}/>
                </div>
              </Fld>
              <Fld label="EFFECTIVE DATE" flex={1.6}>
                <input style={{...inp,fontSize:'0.62rem'}} type="date" value={effDate} onChange={e=>setEffDate(e.target.value)}/>
              </Fld>
              <Fld label="MATURITY DATE" flex={1.6}>
                <input style={{...inp,fontSize:'0.62rem'}} type="date" value={matDate} onChange={e=>setMatDate(e.target.value)}/>
              </Fld>
            </Row>`,
  `            <SectionHdr>PRIMARY ECONOMICS</SectionHdr>
            <Row>
              <Fld label="NOTIONAL" flex={2.5}>
                <input ref={notionalRef} style={{...inp,fontSize:'0.68rem',fontWeight:700}} type="text"
                  defaultValue="10,000,000" placeholder="10,000,000" autoComplete="off"
                  onBlur={e=>{const r=e.target.value.replace(/[^0-9]/g,'');e.target.value=r?Number(r).toLocaleString('en-US'):''}}/>
              </Fld>
              <Fld label="CCY" flex={0.9}>
                <select style={{...sel,fontSize:'0.68rem',fontWeight:700}} value={ccy} onChange={e=>setCcy(e.target.value)}>
                  {CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </Fld>
              <Fld label="DIRECTION" flex={1.8}>
                <div style={{display:'flex',gap:'5px',height:'31px'}}>
                  <DirBtn label="PAY FIXED"     active={dir==='PAY'}     color="var(--red)"    onClick={()=>setDir('PAY')}/>
                  <DirBtn label="RECEIVE FIXED" active={dir==='RECEIVE'} color="var(--accent)" onClick={()=>setDir('RECEIVE')}/>
                </div>
              </Fld>
              <Fld label="TENOR" flex={1.0}>
                <select style={{...sel,fontSize:'0.68rem',fontWeight:700}} value={tenor} onChange={e=>handleTenorChange(e.target.value)}>
                  {TENORS.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </Fld>
              <Fld label={\`EFFECTIVE DATE\${datesLoading?' ⟳':''}\`} flex={1.5}>
                <input style={{...inp,fontSize:'0.60rem',color:datesLoading?'var(--text-dim)':'var(--text)'}}
                  type="date" value={effDate} onChange={e=>setEffDate(e.target.value)}/>
              </Fld>
              <Fld label={\`MATURITY DATE\${datesLoading?' ⟳':''}\`} flex={1.5}>
                <input style={{...inp,fontSize:'0.60rem',color:datesLoading?'var(--text-dim)':'var(--text)'}}
                  type="date" value={matDate} onChange={e=>setMatDate(e.target.value)}/>
              </Fld>
            </Row>`
);

// ── 8. Also fetch dates when trade date changes ───────────────────────────────
f = f.replace(
  `<input style={inp} type="date" value={tdate} onChange={e=>setTdate(e.target.value)}/>`,
  `<input style={inp} type="date" value={tdate} onChange={e=>{setTdate(e.target.value);fetchScheduleDates(tenor,ccy,e.target.value)}}/>`
);

fs.writeFileSync(PATH, f, 'utf8');
console.log('Done.');
console.log('Added:');
console.log('  - TENOR dropdown (1M → 50Y) in PRIMARY ECONOMICS row');
console.log('  - fetchScheduleDates() calls /api/schedules/preview on mount');
console.log('  - Effective + maturity dates auto-populated from backend');
console.log('  - Dates show ⟳ spinner while loading');
console.log('  - User can still manually override both dates');
console.log('  - Changing tenor/ccy/trade-date re-fetches dates automatically');
console.log('  - Changing tenor also clears the user-edited rate flag');
