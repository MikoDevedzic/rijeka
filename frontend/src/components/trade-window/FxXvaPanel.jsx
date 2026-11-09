// trade-window/FxXvaPanel.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// XVA for an FX or digital-asset forward or option, on the rates tab's skeleton: the same
// two columns, the same sections in the same order (model block · PATHS / WWR · SIMULATE ·
// proof · SPREAD CURVES · SETTLEMENT · ASSUMPTIONS | exposure chart · VA strip · ON-CHAIN row
// · footer), the shared pieces from xva-shared.jsx. Only the model block differs: FORWARD
// MODEL (a lognormal forward at the pair's surface vol) or OPTION ON THE PATHS (the style's
// closed form along the same paths), with the SURFACE PROOF in the place of the calibration
// proof. bp here is bp of the quote-currency notional, since an FX trade has no IR01.
// POST /api/xva/currency and /api/xva/currency-option (backend/pricing/fx_xva.py).
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import ExposureCanvas from './ExposureCanvas'
import IncrementalXva from './IncrementalXva'
import {
  SectionHeader, TipLabel, PathsWwrSliders, ModelBadge, SimulateButtons, ProofExpander,
  SpreadCurvesGrid, SettlementBlock, AssumptionsBlock, RunReadout, ChartReadout,
  VaStrip, OnChainCompareRow, VaFooter, FloatingTip, XvaViewToggle, CounterpartyLine, RunAssumes,
} from './xva-shared.jsx'
import {
  INP, XVA_ROW, XVA_LEFT, XVA_RIGHT, XVA_CHART_HEIGHT, defaultSpreads, FX_MVA_NOTE, fmtMoney, tipAt, numOrNull, spreadCurvePayload, simmImValue,
  buildVaRows, onChainCompareRows, fxCsaBody, quoteNotional, volBadge, collateralBody, onChainSaving, useXvaView, runAssumesLine, fxModelWords, HIDDEN_INPUT_DEFAULTS,
} from './xva-shared'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

const VOL_MODES = [['SURFACE', 'SURFACE · TERM + SMILE'], ['FLAT', 'FLAT VOL']]
const MODE_TITLE = {
  SURFACE: "The paths step with the surface's ATM term structure; an option is valued at each date at the forward vol for its remaining life and the smile at its path's moneyness (sticky-delta)",
  FLAT: "One vol, today's at the strike and expiry, held along the whole path (the Excel replication's case)",
}

// SURFACE PROOF: where the vol came from on the last run, the mode, the vol used and the
// step vols the paths were drawn with (a forward in SURFACE mode), in the place of the
// rates tab's CALIBRATION PROOF.
function SurfaceProof({ result }) {
  const [open, setOpen] = useState(false)
  const p = result?.params
  if (!p) return null
  const steps = Array.isArray(p.step_vols_pct) ? p.step_vols_pct : null
  const right = (
    <span style={{marginLeft:'auto',fontSize:'0.8rem',color:'var(--accent)',fontFamily:'var(--mono)',fontWeight:700}}>
      vol {Number(p.vol_pct).toFixed(2)}%
    </span>
  )
  const rows = [
    ['VOL USED', `${Number(p.vol_pct).toFixed(3)} %`],
    ['SOURCE', p.vol_source || '—'],
    ['MODE', p.vol_mode || '—'],
    ...(p.style ? [['STYLE', String(p.style).replace(/_/g, ' ')]] : []),
    ['IM WEIGHT', p.im_rw_per_pct != null ? `${p.im_rw_per_pct} per 1% (${p.im_basis || 'spot delta'})` : '—'],
    ['MODEL', p.model || '—'],
  ]
  return (
    <ProofExpander title='SURFACE PROOF' right={right} open={open} onToggle={() => setOpen(o => !o)}>
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',fontFamily:'var(--mono)',fontSize:'0.8rem'}}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} style={{borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
              <td style={{padding:'3px 5px',width:'80px',color:'var(--text-mute)',fontWeight:700,letterSpacing:'.08em',verticalAlign:'top'}}>{k}</td>
              <td style={{padding:'3px 5px',color:'var(--text-dim)',fontFamily:'var(--sans)',lineHeight:1.5}}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {steps && (
        <div style={{marginTop:'6px',paddingTop:'6px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'0.8rem',color:'var(--text-mute)',fontFamily:'var(--mono)',fontWeight:700,letterSpacing:'.08em',marginBottom:'4px'}}>
            STEP VOLS (%) · {steps.length} monthly steps
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:'3px'}}>
            {steps.map((v, i) => (
              <span key={i} style={{fontSize:'0.75rem',fontFamily:'var(--mono)',color:'var(--accent)',background:'rgba(13,212,168,0.05)',
                border:'1px solid rgba(13,212,168,0.15)',borderRadius:'2px',padding:'1px 4px'}}>
                <span style={{color:'var(--text-mute)'}}>{i + 1}m </span>{Number(v).toFixed(2)}
              </span>
            ))}
          </div>
        </div>
      )}
    </ProofExpander>
  )
}

export default function FxXvaPanel({ quote, counterpartyId, counterpartyName, buildTrade, tradeId }) {
  const payload = quote ? { pair: `${quote.base_currency}${quote.quote_currency}`, base_notional: quote.base_notional,
    settlement_date: quote.settlement_date, forward_rate: quote.forward_rate, direction: quote.direction } : null
  const isOption = quote?.shape === 'OPTION'
  const ccy = quote?.quote_currency || 'USD'
  const fmt = (v) => fmtMoney(v, ccy)

  // 'simple' shows settlement, SIMULATE and a line on what the run assumes; 'advanced' is the whole tab. Every input's
  // state lives here in both, so hiding an input never changes what SIMULATE sends.
  const [view, setView] = useXvaView()
  // model block
  const [volPct, setVolPct] = useState('')
  const [volMode, setVolMode] = useState('SURFACE') // SURFACE: term structure (and smile) along the paths; FLAT: one vol held
  const [paths, setPaths] = useState(2000)
  const [wwr, setWwr] = useState(HIDDEN_INPUT_DEFAULTS.wwr)
  // spread curves: the cells commit on blur, as on the rates tab
  const [spreads, setSpreads] = useState(defaultSpreads)
  const setSpread = (g, t, v) => setSpreads(s => ({ ...s, [g]: { ...s[g], [t]: v } }))
  // settlement
  const [settlement, setSettlement] = useState('UNCOLLATERALISED')
  const [imExchanged, setImExchanged] = useState(false)
  const [compareOnChain, setCompareOnChain] = useState(true)      // the saving on chain is shown by default

  // What the margin is held in: the firm's instruments once, the counterparty's schedule when one is selected.
  const [collateral, setCollateral] = useState(null)             // {posted, received, rail?, source: 'SCHEDULE'|'TICKET'}; null = cash
  const [instruments, setInstruments] = useState([])
  const [scheduleCollateral, setScheduleCollateral] = useState(null)
  useEffect(() => {
    ;(async () => {
      try {
        const session = await getSessionMaybe()
        const r = await fetch(API + '/api/collateral/instruments', { headers: { Authorization: 'Bearer ' + (session?.access_token || '') } })
        if (r.ok) { const j = await r.json(); setInstruments(j.instruments || []) }
      } catch { /* the selects stay on cash */ }
    })()
  }, [])
  useEffect(() => {
    if (!counterpartyId) { setScheduleCollateral(null); return }
    ;(async () => {
      try {
        const session = await getSessionMaybe()
        const r = await fetch(API + '/api/collateral/schedule/' + counterpartyId, { headers: { Authorization: 'Bearer ' + (session?.access_token || '') } })
        if (!r.ok) return
        const j = await r.json()
        if (j.schedule) {
          const sc = { posted: j.schedule.posted, received: j.schedule.received, rail: j.schedule.rail }
          setScheduleCollateral(sc)
          setCollateral({ ...sc, source: 'SCHEDULE' })
        } else { setScheduleCollateral(null) }
      } catch { /* no schedule: the ticket's own choice stands */ }
    })()
  }, [counterpartyId])
  // assumptions
  const [lgd, setLgd] = useState(HIDDEN_INPUT_DEFAULTS.lgd)
  const [fbaRatio, setFbaRatio] = useState(HIDDEN_INPUT_DEFAULTS.fbaRatio)
  const [hurdle, setHurdle] = useState(HIDDEN_INPUT_DEFAULTS.hurdle)
  const [simmIm, setSimmIm] = useState(HIDDEN_INPUT_DEFAULTS.simmIm)          // blank = SIMM-style weight on the spot delta, server-side
  const [capModel, setCapModel] = useState(HIDDEN_INPUT_DEFAULTS.capModel)
  // runs
  const [res, setRes] = useState(null)
  const [cmp, setCmp] = useState(null)               // the same run under the ON-CHAIN preset
  const [seed, setSeed] = useState(42)               // 42 repeats exactly; RE-ROLL draws a fresh one
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // chrome
  const [tooltip, setTooltip] = useState(null)
  const [highlightCurve, setHighlightCurve] = useState(null)
  const [expandedVa, setExpandedVa] = useState(null)
  const tip = (key, e) => setTooltip({ key, ...tipAt(e) })
  const untip = () => setTooltip(null)

  const run = async (useSeed = 42) => {
    if (!quote || !payload) return
    setSeed(useSeed)
    setBusy(true); setErr(null)
    try {
      const session = await getSessionMaybe()
      const common = {
        seed: useSeed, vol_mode: volMode, vol_pct: numOrNull(volPct), paths,
        ...spreadCurvePayload(spreads.cp, spreads.own, spreads.ftp),
        lgd: Number(lgd) / 100, own_lgd: Number(lgd) / 100, fba_ratio: Number(fbaRatio) / 100, hurdle_rate: Number(hurdle) / 100,
        capital_model: capModel, wwr_multiplier: wwr, simm_im_m: simmImValue(simmIm),
        csa: fxCsaBody(settlement, imExchanged),
        collateral: collateralBody(collateral),
      }
      const body = isOption
        ? { trade: buildTrade?.(), ...common }
        : { pair: payload.pair, base_notional: Number(payload.base_notional), settlement_date: payload.settlement_date,
            forward_rate: payload.forward_rate ?? null, direction: payload.direction || 'BUY', ...common }
      if (isOption && !body.trade) throw new Error('Price the option first')
      const post = async (b) => {
        const r = await fetch(`${API}/api/xva/${isOption ? 'currency-option' : 'currency'}`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
        const j = await r.json()
        if (!r.ok) throw new Error(j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : `xva ${r.status}`)
        return j
      }
      setRes(await post(body))
      // the same trade, the same seed, under atomic settlement: the difference is the collateral terms alone
      setCmp(compareOnChain && settlement !== 'ON_CHAIN' ? await post({ ...body, csa: fxCsaBody('ON_CHAIN', imExchanged) }) : null)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const xva = res?.xva
  const notionalQ = quoteNotional(quote)
  const vaRows = buildVaRows(xva, { kind: 'notional', notional: notionalQ })
  const cmpRows = onChainCompareRows(xva, cmp?.xva)
  const saving = onChainSaving(xva, cmp?.xva, notionalQ)
  const badge = volBadge(res?.params, payload?.pair)
  const styleWord = quote?.style ? quote.style.replace(/_/g, ' ').toLowerCase() : 'option'

  const incremental = (
    <IncrementalXva counterpartyId={counterpartyId} counterpartyName={counterpartyName} buildTrade={buildTrade}
      tradeId={tradeId} priced={!!quote} ccy={ccy} />
  )

  // The three pieces both views show; the simple view puts settlement first.
  const simulateButtons = (
    <SimulateButtons simulating={busy} hasResult={!!res} disabled={!quote} label={quote ? '▶ SIMULATE' : 'PRICE THE TICKET FIRST'}
      onSimulate={() => run(42)} onReroll={() => run(1 + Math.floor(Math.random() * 2147483000))} />
  )
  const simulateError = err && <div style={{fontSize:'0.75rem',color:'var(--red)',marginBottom:'6px'}}>✘ {err}</div>
  const settlementBlock = (
    <SettlementBlock settlement={settlement} setSettlement={setSettlement}
      imExchanged={imExchanged} setImExchanged={setImExchanged}
      compareOnChain={compareOnChain} setCompareOnChain={setCompareOnChain}
      tip={tip} untip={untip}
      collateral={collateral} setCollateral={setCollateral} instruments={instruments} scheduleCollateral={scheduleCollateral} />
  )

  return (
    <div className="tbw-no-drag" style={{ fontFamily: 'var(--sans)' }}>
      <div style={XVA_ROW}>

        {/* LEFT PANEL */}
        <div style={XVA_LEFT} data-testid="xva-left">

          <XvaViewToggle view={view} setView={setView} />

          {view === 'simple' ? (<>
            <CounterpartyLine name={counterpartyName} />
            {settlementBlock}
            <div style={{marginTop:'12px'}}>{simulateButtons}</div>
            {simulateError}
            <RunAssumes>
              {runAssumesLine({ paths, model: fxModelWords({ volPct, volMode, params: res?.params }), spreads,
                assumptions: { wwr, lgd, fbaRatio, hurdle, simmIm, capModel } })}
            </RunAssumes>
          </>) : (<>

          <div data-testid="xva-advanced" style={{display:'flex',flexDirection:'column',flexShrink:0}}>
          <SectionHeader>{isOption ? 'OPTION ON THE PATHS' : 'FORWARD MODEL'}</SectionHeader>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 100px', gap:'4px', marginBottom:'6px' }}>
            <TipLabel tipKey='fxVol' tip={tip} untip={untip} style={{ alignSelf:'center' }}>Vol % override</TipLabel>
            <input type='text' inputMode='decimal' value={volPct} onChange={e => setVolPct(e.target.value)}
              placeholder={res?.params?.vol_pct != null ? String(res.params.vol_pct) : 'surface'}
              style={{ ...INP, textAlign:'right', color: volPct ? 'var(--accent)' : 'var(--text-dim)', borderColor: volPct ? 'rgba(13,212,168,0.3)' : 'var(--border)' }} />
          </div>
          <div onMouseEnter={e => tip('fxVolMode', e)} onMouseLeave={untip} style={{ display:'flex', gap:'4px', marginBottom:'8px' }}>
            {VOL_MODES.map(([k, label]) => (
              <button key={k} onClick={() => setVolMode(k)} title={MODE_TITLE[k]}
                style={{ flex:1, padding:'4px 0', fontSize:'0.7rem', fontWeight:700, letterSpacing:'0.08em', fontFamily:'var(--mono)', cursor:'pointer', background: volMode === k ? 'rgba(13,212,168,0.06)' : 'transparent', borderRadius:'2px',
                  border: volMode === k ? '1px solid var(--accent)' : '1px solid var(--border)', color: volMode === k ? 'var(--accent)' : 'var(--text-dim)' }}>{label}</button>
            ))}
          </div>

          <PathsWwrSliders paths={paths} setPaths={setPaths} wwr={wwr} setWwr={setWwr} tip={tip} untip={untip} pathsTip='fxPaths' />

          {badge ? (
            <ModelBadge kind={badge.kind} tipKey='fxSurface' tip={tip} untip={untip}>{badge.text}</ModelBadge>
          ) : (
            <ModelBadge kind='muted'>{quote ? `Vol from the pair's surface at ${isOption ? "the option's expiry and strike" : "the forward's tenor"} — press SIMULATE.` : 'Price the ticket first.'}</ModelBadge>
          )}
          <div style={{ fontSize:'0.75rem', color:'var(--text-mute)', marginBottom:'8px', lineHeight:1.5 }}>
            {isOption
              ? <>Lognormal spot at the option's vol; on every path the {styleWord} is valued with its closed form, the credit engine's model: before expiry the holder's value with the time left (barriers and touches carry which paths have knocked, monitored at the grid points; an American as its European, a lower bound), after it the payoff fixed and discounted to settlement. Bought: one-sided exposure after the premium. Vol from the pair's surface at the option's expiry and strike; type a number to override.</>
              : <>Lognormal forward, exposure ±N·(F<sub>t</sub> − K)·DF. Vol is the pair's surface at the forward's tenor (ATM); type a number to override. A pair without a surface uses the demo default, and the run says so.</>}
          </div>
          </div>

          {simulateButtons}
          <SurfaceProof result={res} />
          {simulateError}

          <SpreadCurvesGrid spreads={spreads} onChange={setSpread} tip={tip} untip={untip} />

          {settlementBlock}

          <AssumptionsBlock lgd={lgd} setLgd={setLgd} fbaRatio={fbaRatio} setFbaRatio={setFbaRatio}
            hurdle={hurdle} setHurdle={setHurdle} simmIm={simmIm} setSimmIm={setSimmIm}
            capModel={capModel} setCapModel={setCapModel} note={FX_MVA_NOTE} simmTip='fxSimmIm' tip={tip} untip={untip} />
          </>)}
        </div>

        {/* RIGHT PANEL */}
        <div style={XVA_RIGHT}>
          <ExposureCanvas result={res} height='fill' highlight={highlightCurve} onHighlight={setHighlightCurve}
            style={{flex:'0 0 auto',height:XVA_CHART_HEIGHT,border:'none',borderBottom:'1px solid var(--border)',borderRadius:0}}>
            <RunReadout result={res} />
            <ChartReadout result={res} fmt={fmt}
              model={<>{res?.params?.style ? String(res.params.style).replace(/_/g, ' ') : 'lognormal forward'} · vol {Number(res?.params?.vol_pct).toFixed(2)}% · {res?.params?.vol_mode && /flat/i.test(res.params.vol_mode) ? 'flat' : /smile/i.test(res?.params?.vol_mode || '') ? 'term + smile' : 'term structure'} · {res?.steps} monthly steps · {ccy}</>} />
          </ExposureCanvas>

          <div style={{flexShrink:0}} data-testid="xva-outputs">
            <VaStrip rows={vaRows} fmt={fmt} expanded={expandedVa} setExpanded={setExpandedVa} onHighlight={setHighlightCurve} />
            <OnChainCompareRow rows={cmpRows} current={res} compare={cmp} fmt={fmt} saving={saving} />
            <VaFooter>
              ALL-IN = NPV + CVA + DVA + FVA + FBA + KVA + MVA + ColVA · Click any VA to expand · bp = VA / (notional × 1bp)
              {notionalQ ? <> · notional {fmt(notionalQ).replace(/^\+/, '')} {ccy}</> : null}
              {res && <> · seed {res.seed ?? seed}</>}
            </VaFooter>
          </div>
        </div>

        <FloatingTip tooltip={tooltip} onLeave={untip} />
      </div>

      {/* Incremental XVA: the counterparty's netting set with and without this trade */}
      <div style={{ borderTop:'1px solid var(--border)' }}>{incremental}</div>
    </div>
  )
}
