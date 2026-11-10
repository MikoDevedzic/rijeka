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
import { INP, LBL, SEC_HDR, TENORS_6, TIPS, SETTLEMENT_PRESETS, SETTLEMENT_DESC, RATES_MVA_NOTE, fmtDollar } from './xva-shared'
import { Keycap } from '../common/Shortcuts'
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
export function PathsWwrSliders({ paths, setPaths, wwr, setWwr, tip, untip, pathsTip = 'paths' }) {
  return (
    <>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
        <TipLabel tipKey={pathsTip} tip={tip} untip={untip} style={{ whiteSpace:'nowrap', marginBottom:0 }}>PATHS</TipLabel>
        <input type='range' min='500' max='5000' step='500' value={paths} onChange={e=>setPaths(parseInt(e.target.value))} style={{flex:1,accentColor:'var(--text-dim)'}}/>
        <span style={{fontSize:'0.8125rem',color:'var(--text-hi)',fontFamily:'var(--mono)',minWidth:'40px',textAlign:'right'}}>{paths.toLocaleString()}</span>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
        <TipLabel tipKey='wwr' tip={tip} untip={untip} style={{ whiteSpace:'nowrap', marginBottom:0 }}>WWR ×</TipLabel>
        <input type='range' min='1.0' max='2.0' step='0.1' value={wwr} onChange={e=>setWwr(parseFloat(e.target.value))} style={{flex:1,accentColor:'var(--text-dim)'}}/>
        <span style={{fontSize:'0.8125rem',color:'var(--text-hi)',fontFamily:'var(--mono)',minWidth:'30px',textAlign:'right'}}>{wwr.toFixed(1)}</span>
      </div>
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
      <SectionHeader>ASSUMPTIONS</SectionHeader>
      <div style={{display:'grid',gridTemplateColumns:'1fr 80px',gap:'4px 8px'}}>
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
      <div style={{marginTop:'8px',fontSize:'0.78rem',color:'var(--text-mute)',lineHeight:1.5,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:'var(--r-1)',padding:'6px 8px'}}>
        {note}
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

// The eight VA cells (buildVaRows) with the bp line, the expanded description under them;
// hovering a cell lights its curve on the chart, clicking it expands the definition.
export function VaStrip({ rows, fmt = fmtDollar, expanded, setExpanded, onHighlight = noop }) {
  const exp = rows.find(r => r.key === expanded)
  return (
    <>
      <div data-testid="va-strip" style={{display:'grid',gridTemplateColumns:`repeat(${rows.length},minmax(0,1fr))`,gap:'1px',background:'var(--border)',borderTop:'1px solid var(--border)'}}>
        {rows.map(row => {
          const isExp = expanded===row.key
          return (
            <div key={row.key}
              onClick={()=>setExpanded(isExp?null:row.key)}
              onMouseEnter={()=>row.curve!=='none'&&onHighlight(row.curve)}
              onMouseLeave={()=>onHighlight(null)}
              style={{background:'var(--panel)',padding:'9px 8px 7px',cursor:'pointer',minWidth:0,overflow:'hidden',
                boxShadow:isExp?'inset 0 2px 0 '+row.color:'none'}}>
              <div style={{fontSize:'0.72rem',fontWeight:500,letterSpacing:'0.09em',color:'var(--text-mute)',fontFamily:'var(--sans)',marginBottom:'5px'}}>{row.label}</div>
              <div style={{fontSize:'0.9375rem',fontWeight:500,color:row.value!=null?row.color:'var(--text-mute)',fontFamily:'var(--mono)',marginBottom:'4px',whiteSpace:'nowrap'}}>
                {fmt(row.value)}
              </div>
              <div>
                {row.sub && <div style={{fontSize:'0.75rem',fontWeight:row.sub.weight,color:row.sub.color,fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>{row.sub.text}</div>}
                {row.sub && <div title={row.sub.caption} style={{fontSize:'0.72rem',color:row.sub.captionColor,fontFamily:'var(--sans)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{row.sub.caption}</div>}
              </div>
            </div>
          )
        })}
      </div>
      {exp && (
        <div style={{background:'var(--bg)',borderTop:'1px solid var(--border)',padding:'10px 16px',fontSize:'0.8125rem',color:'var(--text-dim)',lineHeight:1.7,fontFamily:'var(--sans)'}}>
          <span style={{color:exp.color,fontWeight:500,fontFamily:'var(--mono)',marginRight:'8px'}}>{exp.label}</span>
          {exp.desc}
          {exp.curve!=='none' && <span style={{marginLeft:'8px',fontSize:'0.75rem',color:'var(--text-mute)'}}>· Driven by {exp.curve} curve</span>}
        </div>
      )}
    </>
  )
}

// The ON-CHAIN comparison under the strip: each VA under the on-chain preset against the current
// run (onChainCompareRows), and the line saying it is the same paths and seed.
export function OnChainCompareRow({ rows, current, compare, fmt = fmtDollar, saving = null }) {
  if (!rows?.length || !current || !compare) return null
  const preset = current.csa?.preset?.replace('_','-')
  const bp = (v) => v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} bp`
  return (
    <div style={{background:'var(--bg)',borderTop:'1px solid var(--border)'}}>
      {saving && (
        <div data-testid="saving-on-chain" style={{display:'flex',flexWrap:'wrap',columnGap:'14px',rowGap:'2px',alignItems:'baseline',padding:'7px 16px',borderBottom:'1px solid var(--border)',background:'rgb(var(--accent-rgb) / 0.06)',fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>
          <span style={{fontSize:'0.72rem',letterSpacing:'0.1em',color:'var(--accent)',fontWeight:600,fontFamily:'var(--sans)'}}>SAVING ON CHAIN</span>
          <span style={{fontSize:'1.3rem',lineHeight:1.1,fontWeight:500,letterSpacing:'-0.01em',color:saving.money>=0?'var(--accent-hi)':'var(--down)'}}>{fmt(saving.money)}</span>
          {saving.bpUpfront!=null && <span style={{fontSize:'0.8rem',color:'var(--text-dim)'}}>{bp(saving.bpUpfront)} upfront</span>}
          {saving.bpRunning!=null && <span style={{fontSize:'0.8rem',color:'var(--text-dim)'}}>· {bp(saving.bpRunning)} running</span>}
          <span style={{marginLeft:'auto',fontSize:'0.75rem',color:'var(--text-mute)',fontFamily:'var(--sans)'}}>vs {preset} · same paths, same collateral · bp of notional</span>
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:`repeat(${rows.length},1fr)`,gap:'1px',background:'var(--border)'}}>
        {rows.map(({ key, oc, delta, pct, better }) => (
          <div key={key} style={{background:'var(--bg-deep)',padding:'5px 10px',minWidth:0,overflow:'hidden'}}>
            <div style={{fontSize:'0.8125rem',fontWeight:500,color:oc!=null?'var(--text-hi)':'var(--text-mute)',fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>{fmt(oc)}</div>
            {key==='npv' && <div style={{fontSize:'0.68rem',letterSpacing:'0.1em',color:'var(--accent)',fontFamily:'var(--sans)',fontWeight:600,whiteSpace:'nowrap'}}>ON-CHAIN</div>}
            {pct!=null && key!=='all_in' && (
              <div style={{fontSize:'0.72rem',color:better?'var(--up)':'var(--down)',fontFamily:'var(--mono)',whiteSpace:'nowrap'}} title="on-chain less the current run, and the change in the adjustment's size">
                {fmt(delta)} · {pct>=0?'+':''}{pct.toFixed(0)}%
              </div>
            )}
            {key==='all_in' && delta!=null && (
              <div style={{fontSize:'0.72rem',color:delta>=0?'var(--up)':'var(--down)',fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>{fmt(delta)}</div>
            )}
          </div>
        ))}
      </div>
      <div style={{padding:'5px 16px',fontSize:'0.75rem',color:'var(--text-mute)',fontFamily:'var(--mono)',background:'var(--bg)'}}>
        Same {compare.n_paths?.toLocaleString()} paths, same seed · ON-CHAIN = continuous VM · {compare.csa?.mpor_days}bd MPoR · SIMM IM × {compare.csa?.simm_mpor_scale?.toFixed(3)} · IM {fmt(compare.capital?.im_0)} vs {fmt(current.capital?.im_0)}
      </div>
    </div>
  )
}

// The strip's footer line: "ALL-IN = NPV + … · Click any VA to expand · bp = …".
export function VaFooter({ children }) {
  return (
    <div style={{padding:'5px 16px',fontSize:'0.75rem',color:'var(--text-faint)',fontFamily:'var(--mono)',background:'var(--bg)',borderTop:'1px solid var(--border)'}}>
      {children}
    </div>
  )
}

// The floating tooltip: tooltip = {key, x, y} from tipAt(); the text is TIPS[key].
export function FloatingTip({ tooltip, onLeave = noop }) {
  if (!tooltip || !TIPS[tooltip.key]) return null
  return (
    <div onMouseLeave={onLeave}
      style={{position:'fixed',left:Math.min(tooltip.x,window.innerWidth-360),top:Math.max(8,tooltip.y-8),width:'340px',background:'var(--panel-2)',border:'1px solid var(--border-hi)',borderRadius:'var(--r-3)',padding:'12px 14px',zIndex:9999,boxShadow:'0 12px 36px rgba(0,0,0,0.5)',pointerEvents:'none'}}>
      <div style={{fontSize:'0.8125rem',fontWeight:600,letterSpacing:'0.04em',color:'var(--text-hi)',fontFamily:'var(--sans)',marginBottom:'6px',borderBottom:'1px solid var(--border)',paddingBottom:'6px'}}>{TIPS[tooltip.key].title}</div>
      <div style={{fontSize:'0.75rem',color:'var(--text-dim)',lineHeight:1.7,fontFamily:'var(--sans)',whiteSpace:'pre-wrap'}}>{TIPS[tooltip.key].body}</div>
    </div>
  )
}
