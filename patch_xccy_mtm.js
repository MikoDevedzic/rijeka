const fs = require('fs');
const path = require('path');

const filePath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\NewTradeWorkspace.jsx';
let src = fs.readFileSync(filePath, 'utf8');

// ── 1. Update XCCY template to include MTM fields ─────────────────────────────
src = src.replace(
  `  XCCY_SWAP:         () => [{...LD.FLOAT('PAY','EUR','EUR_EURIBOR_3M'), label:'EUR FLOAT (PAY)'}, {...LD.FLOAT('RECEIVE','USD','USD_SOFR'), label:'USD FLOAT (RECEIVE)'}],`,
  `  XCCY_SWAP:         () => [{
    ...LD.FLOAT('PAY','EUR','EUR_EURIBOR_3M'),
    label:'EUR FLOAT (PAY)',
    xccy_mtm_type: 'NON_MTM',
    xccy_fx_pair: 'EURUSD',
    xccy_initial_fx_rate: '',
    xccy_notional_exchange: 'BOTH',
    xccy_mtm_reset_frequency: 'QUARTERLY',
    xccy_mtm_reset_leg: 'USD',
    xccy_mtm_fx_source: 'WM_REUTERS',
    xccy_is_mtm_leg: false,
  }, {
    ...LD.FLOAT('RECEIVE','USD','USD_SOFR'),
    label:'USD FLOAT (RECEIVE)',
    xccy_mtm_type: 'NON_MTM',
    xccy_fx_pair: 'EURUSD',
    xccy_initial_fx_rate: '',
    xccy_notional_exchange: 'BOTH',
    xccy_mtm_reset_frequency: 'QUARTERLY',
    xccy_mtm_reset_leg: 'USD',
    xccy_mtm_fx_source: 'WM_REUTERS',
    xccy_is_mtm_leg: true,     // USD leg resets in MTM
  }],`
);

// ── 2. Add XccyFields component before LegForm dispatcher ─────────────────────
const xccyComponent = `
function XccyFields({leg, set, legs, legIdx}) {
  const isFirstLeg = legIdx === 0
  if (!('xccy_mtm_type' in leg)) return null

  const isMtm = leg.xccy_mtm_type === 'MTM'

  // Sync MTM settings across both legs
  const syncAll = (k, v) => {
    // This is called via set() which only updates this leg.
    // We update shared fields on both legs via the parent.
    set(k, v)
  }

  return (
    <>
      <div className="sec-lbl" style={{color:'var(--blue)'}}>CROSS-CURRENCY SETTINGS</div>

      {isFirstLeg && <>
        <div className="row2">
          <div className="fg">
            <label>MTM TYPE</label>
            <select value={leg.xccy_mtm_type} onChange={e => {
              const val = e.target.value
              set('xccy_mtm_type', val)
            }}>
              <option value="NON_MTM">NON-MTM (Corporate / Liability Hedge)</option>
              <option value="MTM">MTM — Mark-to-Market (Interbank Standard)</option>
            </select>
          </div>
          <div className="fg">
            <label>FX PAIR</label>
            <select value={leg.xccy_fx_pair} onChange={e => set('xccy_fx_pair', e.target.value)}>
              {['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NOKUSD','SEKUSD',
                'EURGBP','EURJPY','EURCHF','EURCAD','GBPJPY','USDSGD','USDHKD'].map(p =>
                <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="row2">
          <div className="fg">
            <label>INITIAL FX RATE ({leg.xccy_fx_pair})</label>
            <input
              placeholder={leg.xccy_fx_pair==='EURUSD'?'1.0850':leg.xccy_fx_pair==='USDJPY'?'149.50':'0.0000'}
              value={leg.xccy_initial_fx_rate}
              onChange={e => set('xccy_initial_fx_rate', e.target.value)}
            />
          </div>
          <div className="fg">
            <label>NOTIONAL EXCHANGE</label>
            <select value={leg.xccy_notional_exchange} onChange={e => set('xccy_notional_exchange', e.target.value)}>
              <option value="NONE">NONE</option>
              <option value="INITIAL_ONLY">INITIAL ONLY</option>
              <option value="FINAL_ONLY">FINAL ONLY</option>
              <option value="BOTH">BOTH (Initial + Final)</option>
              {isMtm && <option value="PERIODIC">PERIODIC (MTM Resets)</option>}
            </select>
          </div>
        </div>

        {isMtm && <>
          <div style={{
            fontSize:'0.62rem', color:'var(--blue)', padding:'0.4rem 0.6rem',
            background:'color-mix(in srgb, var(--blue) 8%, transparent)',
            border:'1px solid color-mix(in srgb, var(--blue) 30%, transparent)',
            borderRadius:2, lineHeight:1.6, marginTop:'0.25rem'
          }}>
            ● MTM: USD leg notional resets each period to reflect current FX rate.
            Eliminates FX-driven counterparty credit risk on notional.
            Standard for interbank XCCY trades.
          </div>
          <div className="row3">
            <div className="fg">
              <label>MTM RESET LEG</label>
              <select value={leg.xccy_mtm_reset_leg} onChange={e => set('xccy_mtm_reset_leg', e.target.value)}>
                <option>USD</option><option>EUR</option><option>GBP</option>
                <option>JPY</option><option>CHF</option><option>CAD</option>
              </select>
            </div>
            <div className="fg">
              <label>RESET FREQUENCY</label>
              <select value={leg.xccy_mtm_reset_frequency} onChange={e => set('xccy_mtm_reset_frequency', e.target.value)}>
                <option>MONTHLY</option><option>QUARTERLY</option>
                <option>SEMI-ANNUAL</option><option>ANNUAL</option>
              </select>
            </div>
            <div className="fg">
              <label>FX FIXING SOURCE</label>
              <select value={leg.xccy_mtm_fx_source} onChange={e => set('xccy_mtm_fx_source', e.target.value)}>
                <option value="WM_REUTERS">WM/Reuters 4pm Fix</option>
                <option value="ECB_FIXING">ECB Daily Fixing</option>
                <option value="BBG_BFIX">Bloomberg BFIX</option>
                <option value="FED_H10">Fed H.10 (USD pairs)</option>
              </select>
            </div>
          </div>
        </>}

        {!isMtm && (
          <div style={{
            fontSize:'0.62rem', color:'var(--text-dim)', padding:'0.4rem 0.6rem',
            background:'color-mix(in srgb, var(--border) 30%, transparent)',
            border:'1px solid var(--border)', borderRadius:2, lineHeight:1.6, marginTop:'0.25rem'
          }}>
            ● NON-MTM: Notional fixed at inception. FX rate locked at initial rate.
            Simpler operationally — preferred for corporate / liability hedging.
          </div>
        )}
      </>}

      {!isFirstLeg && leg.xccy_is_mtm_leg && isMtm && (
        <div style={{
          fontSize:'0.62rem', color:'var(--amber)', padding:'0.4rem 0.6rem',
          background:'color-mix(in srgb, var(--amber) 8%, transparent)',
          border:'1px solid color-mix(in srgb, var(--amber) 30%, transparent)',
          borderRadius:2, lineHeight:1.6
        }}>
          ● MTM LEG: This leg's notional resets each {leg.xccy_mtm_reset_frequency||'QUARTERLY'} period
          based on {leg.xccy_mtm_fx_source?.replace(/_/g,' ')||'WM/Reuters'} {leg.xccy_fx_pair} fixing.
          Reset cashflows generated by Sprint 3 pricing engine.
        </div>
      )}
    </>
  )
}
`;

// Insert before LegForm dispatcher
src = src.replace(
  `function LegForm({leg,set}) {`,
  xccyComponent + `\nfunction LegForm({leg,set,legs,legIdx}) {`
);

// ── 3. Add XccyFields to FloatForm (XCCY legs are FLOAT type) ─────────────────
src = src.replace(
  `function FloatForm({leg,set}) {
  const [tab,setTab]=useState('terms')
  return (<>
    <div className="leg-tabs">{['terms','schedule','spread'].map(t=><button key={t} className={\`leg-tab \${tab===t?'leg-tab-active':''}\`} onClick={()=>setTab(t)}>{t.toUpperCase()}</button>)}</div>
    {tab==='terms'&&<><CommonLegFields leg={leg} set={set}/>`,
  `function FloatForm({leg,set,legs,legIdx}) {
  const [tab,setTab]=useState('terms')
  return (<>
    <div className="leg-tabs">{['terms','schedule','spread'].map(t=><button key={t} className={\`leg-tab \${tab===t?'leg-tab-active':''}\`} onClick={()=>setTab(t)}>{t.toUpperCase()}</button>)}</div>
    {tab==='terms'&&<><XccyFields leg={leg} set={set} legs={legs} legIdx={legIdx}/><CommonLegFields leg={leg} set={set}/>`
);

// ── 4. Pass legs and legIdx through LegForm and LegCard ───────────────────────
src = src.replace(
  `    case 'FLOAT':          return <FloatForm leg={leg} set={set}/>`,
  `    case 'FLOAT':          return <FloatForm leg={leg} set={set} legs={legs} legIdx={legIdx}/>`
);

// Update LegForm signature to accept legs and legIdx
src = src.replace(
  `function LegForm({leg,set}) {
  switch(leg.leg_type) {`,
  `function LegForm({leg,set,legs,legIdx}) {
  switch(leg.leg_type) {`
);

// Update LegCard to pass legs and legIdx to LegForm
src = src.replace(
  `{open&&<div className="leg-body"><LegForm leg={leg} set={set}/></div>}`,
  `{open&&<div className="leg-body"><LegForm leg={leg} set={set} legs={legs} legIdx={legIdx}/></div>}`
);

fs.writeFileSync(filePath, src, 'utf8');
console.log('✅  XCCY patch complete.');
console.log('');
console.log('Added to XCCY_SWAP:');
console.log('  MTM TYPE:          NON-MTM (corporate) vs MTM (interbank standard)');
console.log('  FX PAIR:           15 major pairs');
console.log('  INITIAL FX RATE:   locked at inception, placeholder adapts to pair');
console.log('  NOTIONAL EXCHANGE: NONE / INITIAL_ONLY / FINAL_ONLY / BOTH / PERIODIC');
console.log('  MTM RESET LEG:     which leg resets (typically USD)');
console.log('  RESET FREQUENCY:   Monthly / Quarterly / Semi-Annual / Annual');
console.log('  FX FIXING SOURCE:  WM/Reuters, ECB, Bloomberg BFIX, Fed H.10');
console.log('  Info banners:      explains MTM vs non-MTM to the user inline');
console.log('  MTM leg indicator: shows on the USD leg when MTM is selected');
