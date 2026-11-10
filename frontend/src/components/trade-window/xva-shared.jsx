// trade-window/xva-shared.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// The XVA tab's shared pieces, lifted from the rates tab (blotter/XVATab.jsx) with their
// markup and styles unchanged, so the FX and digital-asset panel (FxXvaPanel.jsx) lays
// out the same: the PATHS / WWR sliders, SIMULATE / RE-ROLL, the proof expander, the
// spread-curve tenor grid, the SETTLEMENT and ASSUMPTIONS blocks, the chart readouts, the
// VA strip with its bp line and tooltips, the ON-CHAIN comparison row, the footer and the
// floating tooltip. Only the model block differs per product and stays in each tab.
// Pure helpers and constants live in xva-shared.js. The simple view's three pieces are here
// too: the toggle, the counterparty line and the line on what a run assumes.
// ────────────────────────────────────────────────────────────────────────────────────
import { INP, LBL, SEC_HDR, TENORS_6, TIPS, SETTLEMENT_PRESETS, SETTLEMENT_DESC, RATES_MVA_NOTE, fmtDollar, moneySize } from './xva-shared'
import { Keycap } from '../common/Shortcuts'
import Roll from '../common/Roll'
import { Note } from '../common/Note'
import { ariaKey } from '../../lib/shortcuts'

const noop = () => {}

export function SectionHeader({ children, style }) {
  return <div style={{ ...SEC_HDR, ...style }}>{children}</div>
}

// A dashed label that opens a tooltip (TIPS[tipKey]) while hovered.
export function TipLabel({ tipKey, tip = noop, untip = noop, style, children }) {
  return (
    <div onMouseEnter={e => tip(tipKey, e)} onMouseLeave={untip} style={{ ...LBL, ...style }}>{children}</div>
  )
}

// The switch between the tab's two views (useXvaView), at the top of the left column in both.
export function XvaViewToggle({ view, setView }) {
  const simple = view === 'simple'
  return (
    <button data-testid="xva-view-toggle" aria-expanded={!simple} onClick={() => setView(simple ? 'advanced' : 'simple')}
      style={{alignSelf:'flex-end',flexShrink:0,background:'transparent',border:'1px solid var(--border)',color:'var(--text-mute)',fontFamily:'var(--sans)',fontSize:'0.7rem',fontWeight:500,letterSpacing:'0.07em',padding:'3px 8px',borderRadius:'var(--r-1)',cursor:'pointer'}}>
      {simple ? 'SHOW MODEL INPUTS' : 'HIDE MODEL INPUTS'}
    </button>
  )
}

// The simple view's first line: who the trade faces, when the tab was given the name.
export function CounterpartyLine({ name }) {
  if (!name) return null
  return (
    <div style={{display:'flex',alignItems:'baseline',gap:'8px',marginTop:'10px',fontSize:'0.8125rem',fontFamily:'var(--sans)'}}>
      <span style={{color:'var(--text-mute)',flexShrink:0}}>Counterparty</span>
      <span style={{marginLeft:'auto',minWidth:0,color:'var(--text-hi)',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{name}</span>
    </div>
  )
}

// The simple view's muted line under SIMULATE: what the run assumes (runAssumesLine).
export function RunAssumes({ children }) {
  return (
    <div data-testid="xva-run-assumes" style={{fontSize:'0.75rem',color:'var(--text-mute)',lineHeight:1.5,fontFamily:'var(--sans)'}}>
      {children}
    </div>
  )
}

// PATHS and WWR × sliders with their readouts.
// `multiplier` false leaves the wrong-way multiplier out: a currency or digital-asset ticket models the link
// instead (CREDIT AND THE ASSET in FxXvaPanel), and sends the multiplier as 1.
export function PathsWwrSliders({ paths, setPaths, wwr, setWwr, tip, untip, pathsTip = 'paths', multiplier = true }) {
  return (
    <>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
        <TipLabel tipKey={pathsTip} tip={tip} untip={untip} style={{ whiteSpace:'nowrap', marginBottom:0 }}>PATHS</TipLabel>
        <input type='range' min='500' max='5000' step='500' value={paths} onChange={e=>setPaths(parseInt(e.target.value))} style={{flex:1,accentColor:'var(--text-dim)'}}/>
        <span style={{fontSize:'0.8125rem',color:'var(--text-hi)',fontFamily:'var(--mono)',minWidth:'40px',textAlign:'right'}}>{paths.toLocaleString()}</span>
      </div>
      {multiplier && <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
        <TipLabel tipKey='wwr' tip={tip} untip={untip} style={{ whiteSpace:'nowrap', marginBottom:0 }}>WWR ×</TipLabel>
        <input type='range' min='1.0' max='2.0' step='0.1' value={wwr} onChange={e=>setWwr(parseFloat(e.target.value))} style={{flex:1,accentColor:'var(--text-dim)'}}/>
        <span style={{fontSize:'0.8125rem',color:'var(--text-hi)',fontFamily:'var(--mono)',minWidth:'30px',textAlign:'right'}}>{wwr.toFixed(1)}</span>
      </div>}
    </>
  )
}

// The model badge under the sliders: kind 'ok' is the rates "✔ CALIBRATED …" box; 'warn' and
// 'info' the same box in amber / blue; 'muted' the plain note shown when there is nothing yet.
const BADGE = {
  ok:   { color:'var(--up)',     bg:'rgb(var(--up-rgb) / 0.05)', border:'rgb(var(--up-rgb) / 0.18)', dash:'rgb(var(--up-rgb) / 0.3)' },
  warn: { color:'var(--amber)',  bg:'rgba(233,151,90,0.05)',  border:'rgba(233,151,90,0.15)',  dash:'rgba(233,151,90,0.3)' },
  info: { color:'var(--blue)',   bg:'rgba(143,193,230,0.05)',  border:'rgba(143,193,230,0.15)',  dash:'rgba(143,193,230,0.3)' },
}
export function ModelBadge({ kind = 'ok', tipKey, tip = noop, untip = noop, children }) {
  if (kind === 'muted') return <div style={{fontSize:'0.75rem',color:'var(--text-mute)',marginBottom:'8px'}}>{children}</div>
  const c = BADGE[kind] || BADGE.ok
  return (
    <div onMouseEnter={e => tipKey && tip(tipKey, e)} onMouseLeave={untip}
      style={{fontSize:'0.75rem',color:c.color,background:c.bg,
      border:'1px solid '+c.border,borderRadius:'var(--r-1)',padding:'5px 8px',
      marginBottom:'8px',lineHeight:1.5,cursor:tipKey?'help':'default',borderBottom:'1px dashed '+c.dash}}>
      {children}
    </div>
  )
}

// ▶ SIMULATE (seed 42, repeats exactly) and RE-ROLL (a fresh seed; needs a first result).
export function SimulateButtons({ simulating, hasResult, disabled = false, label = '▶ SIMULATE', onSimulate, onReroll }) {
  return (
    <div style={{display:'flex',gap:'6px',marginBottom:'12px'}}>
      <button onClick={onSimulate} disabled={simulating || disabled} data-action="simulate" aria-keyshortcuts={ariaKey('xva')}
        style={{flex:2,padding:'8px',fontSize:'0.8125rem',fontWeight:600,letterSpacing:'0.06em',cursor:'pointer',borderRadius:'var(--r-2)',fontFamily:'var(--sans)',border:'1px solid var(--accent-dim)',background:'rgb(var(--accent-rgb) / 0.08)',color:'var(--accent-hi)',opacity:simulating?0.5:1}}>
        {simulating?'SIMULATING...':label}{!simulating && !disabled && <Keycap id="xva" />}
      </button>
      <button onClick={onReroll} disabled={simulating || disabled || !hasResult}
        title="The same model with fresh random numbers: the numbers move within the Monte Carlo error and settle as you raise PATHS"
        style={{flex:1,padding:'8px',fontSize:'0.8125rem',fontWeight:500,letterSpacing:'0.06em',cursor:'pointer',borderRadius:'var(--r-2)',fontFamily:'var(--sans)',border:'1px solid var(--border-hi)',background:'transparent',color:hasResult?'var(--text-dim)':'var(--text-faint)',opacity:simulating?0.5:1}}>
        RE-ROLL
      </button>
    </div>
  )
}

// The "► CALIBRATION PROOF" style expander: a header with a right-hand figure, the body below when open.
export function ProofExpander({ title, right, open, onToggle, children }) {
  return (
    <div style={{marginBottom:'10px'}}>
      <div
        onClick={onToggle}
        style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',
          padding:'5px 8px',borderRadius:'var(--r-1)',
          background:'rgba(255,255,255,0.02)',border:'1px solid var(--border)',
          marginBottom: open ? '8px' : '0'}}
      >
        <span style={{fontSize:'0.75rem',fontWeight:500,letterSpacing:'.08em',
          color:'var(--text-mute)',fontFamily:'var(--sans)'}}>
          {open ? '▼' : '►'} {title}
        </span>
        {right}
      </div>
      {open && (
        <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',padding:'8px',marginBottom:'4px'}}>
          {children}
        </div>
      )}
    </div>
  )
}

// One row of the tenor grid: uncontrolled cells, committed to the tab's state on blur as the
// rates tab has always done (no re-render per keystroke).
function SpreadRow({ label, values, onChange, tipKey, tip, untip }) {
  return (
    <div style={{ marginBottom:'4px' }}>
      <div style={{ display:'grid', gridTemplateColumns:'56px repeat(6,1fr)', gap:'3px', alignItems:'center' }}>
        <div onMouseEnter={e=>tip(tipKey,e)} onMouseLeave={untip}
          style={{ fontSize:'0.75rem', color:'var(--text-dim)', fontFamily:'var(--sans)',
            letterSpacing:'0.02em', borderBottom:'1px dotted var(--border-glow)',
            cursor:'help', paddingBottom:'1px', whiteSpace:'nowrap' }}>{label}</div>
        {TENORS_6.map(t => (
          <input key={t} type='text' inputMode='decimal'
            placeholder='—' defaultValue={values?.[t]||''}
            onBlur={e => onChange(t, e.target.value)}
            style={{ ...INP, textAlign:'right', padding:'4px 6px', fontSize:'0.875rem',
              color: values?.[t] ? 'var(--text-hi)' : 'var(--text-mute)' }} />
        ))}
      </div>
    </div>
  )
}

// SPREAD CURVES (bp): CP CDS / OWN CDS / FTP bp on 1Y 2Y 3Y 5Y 7Y 10Y. `spreads` is
// {cp, own, ftp}, each {tenor: string}; onChange(group, tenor, value) on blur;
// spreadCurvePayload() turns the three into the request fields.
export function SpreadCurvesGrid({ spreads, onChange, tip = noop, untip = noop }) {
  return (
    <>
      <SectionHeader>SPREAD CURVES (bp)</SectionHeader>
      <div style={{display:'grid',gridTemplateColumns:'56px repeat(6,1fr)',gap:'3px',marginBottom:'4px'}}>
        <div/>
        {TENORS_6.map(t=>(<div key={t} style={{fontSize:'0.75rem',color:'var(--text-mute)',textAlign:'center',fontFamily:'var(--mono)'}}>{t}</div>))}
      </div>
      <SpreadRow label='CP CDS'  values={spreads.cp}  onChange={(t,v)=>onChange('cp',t,v)}  tipKey='cpCds'  tip={tip} untip={untip} />
      <SpreadRow label='OWN CDS' values={spreads.own} onChange={(t,v)=>onChange('own',t,v)} tipKey='ownCds' tip={tip} untip={untip} />
      <SpreadRow label='FTP bp'  values={spreads.ftp} onChange={(t,v)=>onChange('ftp',t,v)} tipKey='ftp'    tip={tip} untip={untip} />
    </>
  )
}

// SETTLEMENT: the three presets, the one-line description, the preset's own inputs
// (`fields`, the rates tab's threshold / MTA / MPoR / IM yield; none on FX) and the
// "SIMM IM exchanged" and "Compare on-chain" toggles. Picking a preset sets IM exchanged
// on for the collateralised ones, as the rates tab always has.
export function SettlementBlock({ settlement, setSettlement, imExchanged, setImExchanged, compareOnChain, setCompareOnChain,
                                  fields = [], tip = noop, untip = noop, collateral = null, setCollateral = null, instruments = [], scheduleCollateral = null }) {
  return (
    <>
      <SectionHeader>SETTLEMENT & COLLATERAL</SectionHeader>
      <div onMouseEnter={e=>tip('settlement',e)} onMouseLeave={untip}
        style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'3px',marginBottom:'6px'}}>
        {SETTLEMENT_PRESETS.map(([k,label,c])=>(
          <button key={k} onClick={()=>{ setSettlement(k); setImExchanged(k!=='UNCOLLATERALISED') }}
            style={{padding:'7px 2px',fontSize:'0.75rem',fontWeight:500,letterSpacing:'0.06em',cursor:'pointer',borderRadius:'var(--r-2)',
              fontFamily:'var(--sans)',
              border:settlement===k?'1px solid var(--border-glow)':'1px solid var(--border)',
              background:settlement===k?'var(--panel-3)':'transparent',color:settlement===k?c:'var(--text-mute)'}}>
            {label}
          </button>
        ))}
      </div>
      <div style={{fontSize:'0.8rem',color:'var(--text-mute)',lineHeight:1.5,marginBottom:'6px',fontFamily:'var(--sans)'}}>
        {SETTLEMENT_DESC[settlement]}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 80px',gap:'4px 8px'}}>
        {fields.map(({label,val,set,tk,ph})=>(
          <div key={label} style={{display:'contents'}}>
            <TipLabel tipKey={tk} tip={tip} untip={untip} style={{ alignSelf:'center', marginBottom:0 }}>{label}</TipLabel>
            <input type='text' value={val} placeholder={ph} onChange={e=>set(e.target.value)} style={{...INP,textAlign:'right'}}/>
          </div>
        ))}
        <div style={{...LBL,alignSelf:'center',marginBottom:0,borderBottom:'none',cursor:'default'}}>SIMM IM exchanged</div>
        <label style={{display:'flex',justifyContent:'flex-end',alignItems:'center',cursor:'pointer'}}>
          <input type='checkbox' checked={imExchanged} onChange={e=>setImExchanged(e.target.checked)} style={{accentColor:'var(--accent)'}}/>
        </label>
        {settlement!=='ON_CHAIN' && (<>
          <TipLabel tipKey='compare' tip={tip} untip={untip} style={{ alignSelf:'center', marginBottom:0 }}>Compare on-chain</TipLabel>
          <label style={{display:'flex',justifyContent:'flex-end',alignItems:'center',cursor:'pointer'}}>
            <input type='checkbox' checked={compareOnChain} onChange={e=>setCompareOnChain(e.target.checked)} style={{accentColor:'var(--accent)'}}/>
          </label>
        </>)}
      </div>
      {setCollateral && settlement!=='UNCOLLATERALISED' && (
        <CollateralBlock collateral={collateral} setCollateral={setCollateral} instruments={instruments} scheduleCollateral={scheduleCollateral} tip={tip} untip={untip} />
      )}
    </>
  )
}

// What the margin is held in: one select per side over the firm's instruments (code · carry over OIS), the
// counterparty's schedule as the default and a button back to it, the carries the engine will use.
const carryFmt = (bp) => bp == null ? '' : `${bp >= 0 ? '+' : '−'}${Math.abs(Math.round(bp))} bp`
function CollateralBlock({ collateral, setCollateral, instruments, scheduleCollateral, tip, untip }) {
  const sides = [['posted', 'VM posted in'], ['received', 'VM received in']]
  const value = (v) => (v && typeof v === 'object' && Object.keys(v).length === 1) ? Object.keys(v)[0] : (typeof v === 'string' ? v : (v && Object.keys(v).length > 1 ? '__SCHEDULE__' : ''))
  const carryOf = (v) => {
    if (!v) return 0
    const comp = typeof v === 'string' ? { [v]: 1 } : v
    const tot = Object.values(comp).reduce((s_, w) => s_ + Number(w), 0) || 1
    return Object.entries(comp).reduce((s_, [k, w]) => s_ + Number(w) / tot * (instruments.find(i => i.code === k)?.carry_today_bp ?? 0), 0)
  }
  const fromSchedule = scheduleCollateral && collateral && collateral.source === 'SCHEDULE'
  return (
    <div style={{marginTop:'6px'}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 150px',gap:'4px 8px',alignItems:'center'}}>
        {sides.map(([key, label]) => (
          <div key={key} style={{display:'contents'}}>
            <TipLabel tipKey='collateral' tip={tip} untip={untip} style={{ alignSelf:'center', marginBottom:0 }}>{label}</TipLabel>
            <select value={value(collateral?.[key])}
              onChange={e => setCollateral(c => ({ ...(c || {}), [key]: e.target.value === '__SCHEDULE__' ? (scheduleCollateral?.[key] || null) : (e.target.value || null), source: 'TICKET' }))}
              style={{...INP,textAlign:'right',cursor:'pointer'}} aria-label={label}>
              <option value=''>cash (CSA currency)</option>
              {collateral?.[key] && typeof collateral[key] === 'object' && Object.keys(collateral[key]).length > 1 && <option value='__SCHEDULE__'>schedule mix</option>}
              {instruments.filter(i => i.active !== false).map(i => <option key={i.code} value={i.code}>{i.code} {carryFmt(i.carry_today_bp)}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div style={{display:'flex',gap:'8px',alignItems:'center',marginTop:'4px',fontSize:'0.75rem',color:'var(--text-mute)',fontFamily:'var(--mono)'}}>
        <span>carry over OIS · posted {carryFmt(carryOf(collateral?.posted))} · received {carryFmt(carryOf(collateral?.received))}</span>
        {scheduleCollateral && !fromSchedule && (
          <button onClick={() => setCollateral({ ...scheduleCollateral, source: 'SCHEDULE' })}
            style={{marginLeft:'auto',background:'transparent',border:'1px solid var(--border-hi)',color:'var(--text-dim)',fontFamily:'var(--sans)',fontSize:'0.7rem',letterSpacing:'0.05em',padding:'3px 7px',borderRadius:'var(--r-1)',cursor:'pointer'}}>
            COUNTERPARTY'S SCHEDULE
          </button>
        )}
        {fromSchedule && <span style={{marginLeft:'auto',color:'var(--text-dim)'}}>from the counterparty's schedule</span>}
      </div>
    </div>
  )
}

// ASSUMPTIONS: LGD %, FBA/FTP ratio, Hurdle rate %, SIMM IM $M, the capital model and the MVA note.
export function AssumptionsBlock({ lgd, setLgd, fbaRatio, setFbaRatio, hurdle, setHurdle, simmIm, setSimmIm, capModel, setCapModel,
                                   note = RATES_MVA_NOTE, simmTip = 'simmIm', tip = noop, untip = noop }) {
  const rows = [
    {label:'LGD %',val:lgd,set:setLgd,tk:'lgd'},
    {label:'FBA/FTP ratio',val:fbaRatio,set:setFbaRatio,tk:'fbaRatio'},
    {label:'Hurdle rate %',val:hurdle,set:setHurdle,tk:'hurdle'},
    {label:'SIMM IM $M',val:simmIm,set:setSimmIm,tk:simmTip},
  ]
  return (
    <>
      <SectionHeader>ASSUMPTIONS<Note inline>{note}</Note></SectionHeader>
      <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 72px minmax(0,1fr) 72px',gap:'5px 10px'}}>
        {rows.map(({label,val,set,tk})=>(
          <div key={label} style={{display:'contents'}}>
            <TipLabel tipKey={tk} tip={tip} untip={untip} style={{ alignSelf:'center', marginBottom:0 }}>{label}</TipLabel>
            <input type='text' value={val} onChange={e=>set(e.target.value)} style={{...INP,textAlign:'right'}}/>
          </div>
        ))}
        <TipLabel tipKey='capModel' tip={tip} untip={untip} style={{ alignSelf:'center', marginBottom:0 }}>Capital model</TipLabel>
        <select value={capModel} onChange={e=>setCapModel(e.target.value)} style={{...INP,cursor:'pointer'}}>
          <option value='sa_ccr'>SA-CCR</option>
          <option value='cem'>CEM</option>
          <option value='imm'>IMM</option>
        </select>
      </div>
    </>
  )
}

// Bottom-left of the chart: the seed, the path-steps and the engine time of the last run.
export function RunReadout({ result }) {
  if (!result) return null
  const seed = result.seed ?? 42
  return (
    <div style={{fontSize:'0.7rem',color:'var(--text-mute)',fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>
      seed {seed}{seed===42?' (repeats exactly)':' (re-rolled)'} · {result.path_steps?.toLocaleString()} path-steps simulated in {result.engine_ms} ms
    </div>
  )
}

// Bottom-right of the chart: paths · the model's own line (`model`) · the CSA with its peak EE
// gross → residual, and anything else the tab appends (`children`).
export function ChartReadout({ result, model, fmt = fmtDollar, children }) {
  if (!result) return null
  const csa = result.csa
  return (
    <div style={{marginLeft:'auto',textAlign:'right',fontSize:'0.7rem',color:'var(--text-mute)',fontFamily:'var(--mono)'}}>
      {result.n_paths?.toLocaleString()} paths · {model}
      {csa && (
        <span style={{color:csa.collateralised?'var(--text-dim)':'var(--down)', marginLeft:'8px'}}>
          · {String(csa.preset||'').replace('_','-')}{csa.collateralised ? ` · ${csa.mpor_days}bd MPoR` : ''}{csa.im_exchanged ? ' · IM' : ''}
          {csa.collateralised && result.ee_gross && (() => {
            const g = Math.max(...result.ee_gross), r = Math.max(...result.ee)
            return <span style={{color:'var(--text-mute)'}}> · peak EE gross {fmt(g)} → residual {fmt(r)} ({g>0?(-100*(1-r/g)).toFixed(0):'0'}%)</span>
          })()}
        </span>
      )}
      {children}
    </div>
  )
}

// ── The results, as one table ─────────────────────────────────────────────────────────────────────────
// The adjustments run across (NPV, CVA … ALL-IN); each line of figures is a row with its name printed once at
// the left: the run itself, its size in basis points, the same run settled on chain, and the change. Every row
// of money is set the same way (one size, one face) and a figure takes the colour of its sign and nothing else:
// a cost is the colour of a negative, a benefit of a positive, a rounded zero is unsigned and quiet. ALL-IN is
// the one column that stands out. VaStrip draws the head and the run; OnChainCompareRow draws the saving and
// the on-chain rows on the same columns, so the two read as one table.
const VA_COLS = (n) => `132px repeat(${n}, minmax(0, 1fr))`
const VA_ROW = { display:'grid', alignItems:'stretch', padding:'0 12px 0 16px', minWidth:'780px' }
const VA_NAME = { fontSize:'11px', fontWeight:500, letterSpacing:'0.08em', color:'var(--text-mute)', fontFamily:'var(--sans)', textAlign:'left', padding:'8px 8px 7px 0', minWidth:0, whiteSpace:'nowrap', lineHeight:1.25 }
const VA_CELL = { fontFamily:'var(--mono)', fontVariantNumeric:'tabular-nums', textAlign:'right', padding:'7px 4px', whiteSpace:'nowrap', minWidth:0 }
const VA_MONEY = { ...VA_CELL, fontSize:'13.5px', fontWeight:500 }
const VA_SMALL = { ...VA_CELL, fontSize:'12px', fontWeight:400, padding:'0 4px 7px' }
// in the basis-point row of a swap, two cells hold a rate, not basis points: each says which
const RATE_WORD = { 'par rate': 'par', 'all-in rate': 'rate' }
const VA_TOTAL = { background:'var(--panel)', boxShadow:'inset 1px 0 0 var(--border-hi)' }
// a figure that rounds to nothing at the precision it is printed at: no sign, no colour
const isZero = (text) => /^[+\-−]?\s*(?:[A-Z]{3}\s?|[$€£¥])?0(\.0+)?(\s?bp|%)?$/.test(String(text).trim())
// (the test reads the text as it will be printed: "+$0", "-0.0bp")
const unsigned = (text) => isZero(text) ? String(text).replace(/^[+\-−]/, '') : text
const signTone = (v, text) => (v == null || !Number.isFinite(Number(v)) || isZero(text)) ? 'var(--text-dim)' : Number(v) > 0 ? 'var(--up)' : 'var(--down)'

export function VaStrip({ rows, fmt = fmtDollar, expanded, setExpanded, onHighlight = noop, runLabel = 'THIS RUN', also = [] }) {
  const size = moneySize([...rows.map(r => unsigned(fmt(r.value))), ...also.map(v => unsigned(fmt(v)))])
  const exp = rows.find(r => r.key === expanded)
  const cols = VA_COLS(rows.length)
  const subName = rows.find(r => r.key === 'cva')?.sub?.caption || rows.find(r => r.sub)?.sub?.caption
  const col = (row) => ({
    onClick: () => setExpanded(expanded === row.key ? null : row.key),
    onMouseEnter: () => row.curve !== 'none' && onHighlight(row.curve),
    onMouseLeave: () => onHighlight(null),
  })
  return (
    <>
      <div data-testid="va-strip" style={{background:'var(--bg)',borderTop:'1px solid var(--border)'}}>
        <div style={{...VA_ROW,gridTemplateColumns:cols,borderBottom:'1px solid var(--border)',background:'var(--panel)'}}>
          <div style={VA_NAME} />
          {rows.map(row => (
            <button key={row.key} type="button" {...col(row)} aria-expanded={expanded === row.key}
              title={`${row.label}: press for its definition`}
              style={{...VA_CELL,background:'transparent',border:'none',cursor:'pointer',fontFamily:'var(--sans)',fontSize:'11px',fontWeight:row.key==='all_in'?600:500,letterSpacing:'0.08em',
                color:row.key==='all_in'||expanded===row.key?'var(--text-hi)':'var(--text-mute)',boxShadow:expanded===row.key?'inset 0 -2px 0 var(--text-dim)':'none'}}>{row.label}</button>
          ))}
        </div>
        <div style={{...VA_ROW,gridTemplateColumns:cols}} data-testid="va-run">
          <div style={VA_NAME}>{runLabel}</div>
          {rows.map(row => {
            const text = unsigned(fmt(row.value))
            return (
              <div key={row.key} {...col(row)} title={text} style={{...VA_MONEY,fontSize:size,cursor:'pointer',color:row.value!=null?signTone(row.value, text):'var(--text-mute)',...(row.key==='all_in'?{...VA_TOTAL,fontWeight:600}:null)}}>
                <Roll>{text}</Roll>
              </div>
            )
          })}
        </div>
        {subName && (
          <div style={{...VA_ROW,gridTemplateColumns:cols}} data-testid="va-bp">
            <div style={{...VA_NAME,padding:'0 8px 7px 0'}}>{/rate/.test(subName) ? 'BP ON RATE' : 'BP OF NOTIONAL'}</div>
            {rows.map(row => (
              <div key={row.key} title={row.sub?.caption} style={{...VA_SMALL,color:'var(--text-dim)',...(row.key==='all_in'?VA_TOTAL:null)}}>
                {row.sub && RATE_WORD[row.sub.caption] && <span style={{fontFamily:'var(--sans)',fontSize:'11px',color:'var(--text-mute)',marginRight:'4px'}}>{RATE_WORD[row.sub.caption]}</span>}
                {row.sub ? unsigned(row.sub.text).replace(/\s?bp$/, '') : '—'}
              </div>
            ))}
          </div>
        )}
      </div>
      {exp && (
        <div style={{background:'var(--bg)',borderTop:'1px solid var(--border)',padding:'10px 16px',fontSize:'12.5px',color:'var(--text-dim)',lineHeight:1.6,fontFamily:'var(--sans)'}}>
          <span style={{color:'var(--text-hi)',fontWeight:600,letterSpacing:'0.06em',marginRight:'8px'}}>{exp.label}</span>
          {exp.desc}
          {exp.curve!=='none' && <span style={{marginLeft:'8px',color:'var(--text-mute)'}}>· Driven by the {exp.curve} curve</span>}
        </div>
      )}
    </>
  )
}

// The same run settled on chain, on the table's own columns: the saving, then each adjustment and its change.
export function OnChainCompareRow({ rows, current, compare, fmt = fmtDollar, saving = null }) {
  if (!rows?.length || !current || !compare) return null
  const preset = current.csa?.preset?.replace('_','-')
  const bp = (v) => v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} bp`
  const cols = VA_COLS(rows.length)
  const size = moneySize(rows.flatMap(r => [unsigned(fmt(r.cur)), unsigned(fmt(r.oc))]))
  const onChainNote = <>Same {compare.n_paths?.toLocaleString()} paths, same seed. On chain is continuous variation margin, a {compare.csa?.mpor_days} business day margin period of risk, SIMM IM × {compare.csa?.simm_mpor_scale?.toFixed(3)}; IM {fmt(compare.capital?.im_0)} against {fmt(current.capital?.im_0)}.</>
  return (
    <div style={{background:'var(--bg)',borderTop:'1px solid var(--border)'}}>
      {saving && (
        <div data-testid="saving-on-chain" style={{display:'flex',flexWrap:'wrap',columnGap:'14px',rowGap:'2px',alignItems:'baseline',padding:'8px 16px',borderBottom:'1px solid var(--border)',background:'rgb(var(--accent-rgb) / 0.06)',fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>
          <span style={{fontSize:'11px',letterSpacing:'0.1em',color:'var(--accent)',fontWeight:600,fontFamily:'var(--sans)'}}>SAVING ON CHAIN</span>
          <span style={{fontSize:'18px',lineHeight:1.1,fontWeight:500,letterSpacing:'-0.01em',color:saving.money>=0?'var(--accent-hi)':'var(--down)'}}><Roll>{fmt(saving.money)}</Roll></span>
          {saving.bpUpfront!=null && <span style={{fontSize:'12px',color:'var(--text-dim)'}}>{bp(saving.bpUpfront)} upfront</span>}
          {saving.bpRunning!=null && <span style={{fontSize:'12px',color:'var(--text-dim)'}}>· {bp(saving.bpRunning)} running</span>}
          <Note inline>against {preset}, on the same paths with the same collateral; basis points are of the notional</Note>
        </div>
      )}
      <div style={{...VA_ROW,gridTemplateColumns:cols}} data-testid="va-on-chain">
        <div style={{...VA_NAME,color:'var(--accent)',fontWeight:600}}>ON CHAIN<Note inline markOnly>{onChainNote}</Note></div>
        {rows.map(({ key, oc }) => {
          const text = unsigned(fmt(oc))
          return <div key={key} title={text} style={{...VA_MONEY,fontSize:size,color:oc!=null?signTone(oc, text):'var(--text-mute)',...(key==='all_in'?{...VA_TOTAL,fontWeight:600}:null)}}>{text}</div>
        })}
      </div>
      <div style={{...VA_ROW,gridTemplateColumns:cols}} data-testid="va-change">
        <div style={{...VA_NAME,padding:'0 8px 7px 0'}}>CHANGE</div>
        {rows.map(({ key, delta, pct }) => {
          const text = delta == null || key === 'npv' ? '—' : unsigned(fmt(delta))
          return (
            <div key={key} title={pct != null ? `on chain less this run; the adjustment is ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% in size` : 'on chain less this run'}
              style={{...VA_SMALL,color:text==='—'?'var(--text-mute)':signTone(delta, text),...(key==='all_in'?VA_TOTAL:null)}}>{text}</div>
          )
        })}
      </div>
      <div className="rj-notes-only" style={{padding:'0 16px 7px'}}>{onChainNote}</div>
    </div>
  )
}

// The strip's footer line: "ALL-IN = NPV + … · Click any VA to expand · bp = …".
export function VaFooter({ children }) {
  return (
    <div style={{padding:'6px 16px',fontSize:'11.5px',color:'var(--text-mute)',fontFamily:'var(--sans)',background:'var(--bg)',borderTop:'1px solid var(--border)'}}>
      Press a column for its definition<Note inline>{children}</Note>
    </div>
  )
}

// The floating tooltip: tooltip = {key, x, y} from tipAt(); the text is TIPS[key].
export function FloatingTip({ tooltip, onLeave = noop }) {
  if (!tooltip || !TIPS[tooltip.key]) return null
  return (
    <div onMouseLeave={onLeave}
      style={{position:'fixed',left:Math.min(tooltip.x,window.innerWidth-360),...(tooltip.y > window.innerHeight * 0.55 ? {bottom:Math.max(8, window.innerHeight - tooltip.y - 28)} : {top:Math.max(8,tooltip.y-8)}),width:'340px',background:'var(--panel-2)',border:'1px solid var(--border-hi)',borderRadius:'var(--r-3)',padding:'12px 14px',zIndex:9999,boxShadow:'0 12px 36px rgba(0,0,0,0.5)',pointerEvents:'none'}}>
      <div style={{fontSize:'0.8125rem',fontWeight:600,letterSpacing:'0.04em',color:'var(--text-hi)',fontFamily:'var(--sans)',marginBottom:'6px',borderBottom:'1px solid var(--border)',paddingBottom:'6px'}}>{TIPS[tooltip.key].title}</div>
      <div style={{fontSize:'0.75rem',color:'var(--text-dim)',lineHeight:1.7,fontFamily:'var(--sans)',whiteSpace:'pre-wrap'}}>{TIPS[tooltip.key].body}</div>
    </div>
  )
}
