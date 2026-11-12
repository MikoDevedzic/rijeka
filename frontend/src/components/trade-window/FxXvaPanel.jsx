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
//
// The ticket prices itself after every change of its terms. While the quote here is the one
// before the last change (`stale`), SIMULATE and RE-ROLL wait: a run would take the old
// notional, date and strike. A result on screen belongs to the terms it was simulated for;
// when a new quote lands with other terms it is cleared (fx-requests.js xvaResultMatches).
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import ExposureCanvas from './ExposureCanvas'
import IncrementalXva from './IncrementalXva'
import { settledState } from './fx-scenario'
import { xvaTermsKey } from './fx-requests'
import {
  SectionHeader, TipLabel, PathsWwrSliders, ModelBadge, SimulateButtons, ProofExpander,
  SpreadCurvesGrid, SettlementBlock, AssumptionsBlock, RunReadout, ChartReadout,
  VaStrip, OnChainCompareRow, VaFooter, FloatingTip, XvaViewToggle, CounterpartyLine, RunAssumes,
} from './xva-shared.jsx'
import {
  INP, XVA_ROW, XVA_LEFT, XVA_RIGHT, XVA_BAND, XVA_CHART_HEIGHT, defaultSpreads, FX_MVA_NOTE, fmtMoney, tipAt, numOrNull, spreadCurvePayload, imUsdValue, imUsdProblem, CRYPTO_GROUPS,
  buildVaRows, onChainCompareRows, fxCsaBody, quoteNotional, volBadge, collateralBody, onChainSaving, useXvaView, runAssumesLine, fxModelWords, HIDDEN_INPUT_DEFAULTS, CREDIT_LINKS, wrongWayLine, regimesParts,
} from './xva-shared'
import { Note } from '../common/Note'

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
    ['MODEL', p.model || '—'],
  ]
  // a digital asset's vol regimes, in the run's own figures: each figure in mono, as the lines under the results set theirs
  const regimes = regimesParts(p.vol_regimes)
  if (regimes) rows.push(['REGIMES', regimes.map((x, i) => (typeof x === 'string' ? x : <span key={i} style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)', whiteSpace: 'nowrap' }}>{x.fig}</span>))])
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
              <span key={i} style={{fontSize:'0.75rem',fontFamily:'var(--mono)',color:'var(--accent)',background:'rgba(217,178,92,0.05)',
                border:'1px solid rgba(217,178,92,0.15)',borderRadius:'2px',padding:'1px 4px'}}>
                <span style={{color:'var(--text-mute)'}}>{i + 1}m </span>{Number(v).toFixed(2)}
              </span>
            ))}
          </div>
        </div>
      )}
    </ProofExpander>
  )
}

// `legs`: the further legs of a package (the DETAILS tab), or null: {count, ready, failed, key, bodies, quotes}. With legs the
// run is the whole package as one netting set (POST /api/xva/currency-package): every leg on the same paths.
export default function FxXvaPanel({ quote, counterpartyId, counterpartyName, buildTrade, tradeId, stale = false, legs = null, crypto = false, fees = [] }) {
  const pkg = legs && legs.count > 0 ? legs : null
  const pkgWaiting = !!pkg && !pkg.ready          // a leg is still being priced: the run waits for it
  // the terms a result was simulated for: the ticket's and, in a package, every leg's
  const runKey = quote ? xvaTermsKey(quote) + (pkg ? '|' + pkg.key : '') : null
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
  const [cpLink, setCpLink] = useState('1')        // wrong-way risk: the counterparty's default intensity × this when the asset halves
  const [ownLink, setOwnLink] = useState('1')      // and our own
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
  const [imUsd, setImUsd] = useState(HIDDEN_INPUT_DEFAULTS.imUsd)             // initial margin in dollars; blank = the engine's estimate
  const [cryptoGroup, setCryptoGroup] = useState('')                          // a digital asset's Basel group; '' = the engine's default
  // The margin typed and the group chosen are of one pair: another pair starts with neither (a size in another
  // currency, a group that was another asset's). State adjusted during the render, not in an effect.
  const pairNow = quote ? `${quote.base_currency}${quote.quote_currency}` : null
  const [pairSeen, setPairSeen] = useState(pairNow)
  if (pairNow && pairNow !== pairSeen) { setPairSeen(pairNow); if (pairSeen) { setImUsd(''); setCryptoGroup('') } }
  const [capModel, setCapModel] = useState(HIDDEN_INPUT_DEFAULTS.capModel)
  // runs
  const [res, setRes] = useState(null)
  const [cmp, setCmp] = useState(null)               // the same run under the ON-CHAIN preset
  const [resFor, setResFor] = useState(null)         // the terms the result on screen was simulated for (xvaTermsKey)
  const [seed, setSeed] = useState(42)               // 42 repeats exactly; RE-ROLL draws a fresh one
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // chrome
  const [tooltip, setTooltip] = useState(null)
  const [highlightCurve, setHighlightCurve] = useState(null)
  const [expandedVa, setExpandedVa] = useState(null)
  const tip = (key, e) => setTooltip({ key, ...tipAt(e) })
  const untip = () => setTooltip(null)

  // A result for other terms than the quote's is not shown as this trade's: once a new quote has landed (not while
  // the last one is still being repriced), a result simulated for different terms is cleared, and so is a run that
  // comes back after the terms it was started for have gone. State adjusted during the render, not in an effect.
  if ((res || cmp) && quote && !stale && resFor !== runKey) { setRes(null); setCmp(null); setResFor(null) }

  const run = async (useSeed = 42) => {
    if (!quote || !payload || stale || pkgWaiting) return
    const imBad = imUsdProblem(imUsd)
    if (imBad) { setErr(imBad); return }
    if (fees === null) { setErr('A fee on the TRADE tab is not complete: finish or remove it before simulating.'); return }
    const termsAtRun = runKey
    setSeed(useSeed)
    setBusy(true); setErr(null)
    try {
      const session = await getSessionMaybe()
      const common = {
        seed: useSeed, vol_mode: volMode, vol_pct: numOrNull(volPct), paths,
        ...spreadCurvePayload(spreads.cp, spreads.own, spreads.ftp),
        lgd: Number(lgd) / 100, own_lgd: Number(lgd) / 100, fba_ratio: Number(fbaRatio) / 100, hurdle_rate: Number(hurdle) / 100,
        capital_model: capModel, wwr_multiplier: wwr, im_usd: imUsdValue(imUsd), crypto_group: cryptoGroup || null,
        cp_hazard_if_halves: Number(cpLink) || 1, own_hazard_if_halves: Number(ownLink) || 1,
        csa: fxCsaBody(settlement, imExchanged),
        ...(fees && fees.length ? { fees } : {}),      // the trade's fees still to come are part of its value and its exposure
        collateral: collateralBody(collateral),
      }
      const body = pkg
        ? { trades: [buildTrade?.(), ...pkg.bodies], ...common }
        : isOption
        ? { trade: buildTrade?.(), ...common }
        : { pair: payload.pair, base_notional: Number(payload.base_notional), settlement_date: payload.settlement_date,
            forward_rate: payload.forward_rate ?? null, direction: payload.direction || 'BUY', ...common }
      if (pkg && !body.trades.every(Boolean)) throw new Error('Price every leg first')
      if (!pkg && isOption && !body.trade) throw new Error('Price the option first')
      const post = async (b) => {
        const r = await fetch(`${API}/api/xva/${pkg ? 'currency-package' : isOption ? 'currency-option' : 'currency'}`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
        const j = await r.json()
        if (!r.ok) throw new Error(j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : `xva ${r.status}`)
        return j
      }
      const first = await post(body)
      setResFor(termsAtRun); setRes(first)
      // the same trade, the same seed, under atomic settlement: the difference is the collateral terms alone
      setCmp(compareOnChain && settlement !== 'ON_CHAIN' ? await post({ ...body, csa: fxCsaBody('ON_CHAIN', imExchanged) }) : null)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const xva = res?.xva
  // bp against the notional: the ticket's, or in a package the sum of every leg's
  const notionalQ = pkg && pkg.ready ? [quote, ...pkg.quotes].reduce((a, q) => a + (quoteNotional(q) || 0), 0) : quoteNotional(quote)
  const nLegs = pkg ? pkg.count + 1 : 1
  const isDigital = !!crypto
  const ww = wrongWayLine(res)
  // what netting is worth: the package's peak expected exposure against its legs' peaks added up
  const legPeaks = res?.package && Array.isArray(res.legs) ? res.legs.reduce((a, l) => a + (Number(l.ee_gross_peak) || 0), 0) : null
  const netPeak = res?.package && Array.isArray(res.ee_gross) && res.ee_gross.length ? Math.max(...res.ee_gross.map(Number)) : null
  const vaRows = buildVaRows(xva, { kind: 'notional', notional: notionalQ })
  const cmpRows = onChainCompareRows(xva, cmp?.xva)
  const saving = onChainSaving(xva, cmp?.xva, notionalQ)
  const badge = volBadge(res?.params, payload?.pair)
  const styleWord = quote?.style ? quote.style.replace(/_/g, ' ').toLowerCase() : 'option'

  const incremental = (
    <IncrementalXva counterpartyId={counterpartyId} counterpartyName={counterpartyName} buildTrade={buildTrade}
      tradeId={tradeId} priced={!!quote && !pkgWaiting} ccy={ccy}
      buildTrades={pkg && pkg.ready ? () => [buildTrade?.(), ...pkg.bodies] : null} legs={nLegs} legsKey={pkg ? pkg.key : ''} />
  )

  // The three pieces both views show; the simple view puts settlement first.
  // a trade whose fixing date has been reached has no forward left: a run would simulate one that no longer exists
  const fixed = settledState(quote) != null
  const simulateButtons = (<>
    <SimulateButtons simulating={busy} hasResult={!!res} disabled={!quote || fixed || stale || pkgWaiting} label={quote ? (pkg ? `▶ SIMULATE ${nLegs} LEGS` : '▶ SIMULATE') : 'PRICE THE TICKET FIRST'}
      onSimulate={() => run(42)} onReroll={() => run(1 + Math.floor(Math.random() * 2147483000))} />
    {pkg && !!quote && <div data-testid="xva-package" data-legs={nLegs} style={{fontSize:'0.75rem',color:'var(--text-dim)',margin:'-6px 0 12px',lineHeight:1.5}}>
      {pkgWaiting ? (pkg.failed ? 'a leg has no price (see DETAILS): the package runs once every leg is priced' : 'a leg is being priced: SIMULATE waits for every leg') : <>The package of {nLegs} legs as one netting set: every leg on the same paths, netted before the charge is taken.</>}
    </div>}
    {stale && !!quote && <div data-testid="xva-stale-note" style={{fontSize:'0.75rem',color:'var(--text-mute)',margin:'-6px 0 12px',lineHeight:1.5}}>repricing: SIMULATE waits for the price of the terms as they now stand</div>}
    {fixed && <div data-testid="xva-fixed-note" style={{fontSize:'0.75rem',color:'var(--text-dim)',margin:'-6px 0 12px',lineHeight:1.5}}>This trade has fixed: there is no exposure left to simulate beyond the settlement amount.</div>}
  </>)
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
                assumptions: { wwr, lgd, fbaRatio, hurdle, imUsd, capModel, cpLink, ownLink, cryptoGroup } })}
            </RunAssumes>
          </>) : (<>

          <div data-testid="xva-advanced" style={{display:'flex',flexDirection:'column',flexShrink:0}}>
          <SectionHeader>{pkg ? 'PACKAGE ON THE PATHS' : isOption ? 'OPTION ON THE PATHS' : 'FORWARD MODEL'}<Note inline>
            {pkg
              ? <>Every leg on one set of paths: each forward of the pair is its own forward times one lognormal driver, so the legs move together and net path by path. A forward leg is marked ±N·(F<sub>t</sub> − K)·DF, an option leg is valued in its style's closed form, and a leg is nothing after it settles. Initial margin is on the net spot sensitivity of the legs; the capital add-on is the sum of the legs' add-ons (no offset between them). A vol typed here is used for every leg.</>
              : isOption
              ? <>Lognormal spot at the option's vol; on every path the {styleWord} is valued with its closed form, the credit engine's model: before expiry the holder's value with the time left (barriers and touches carry which paths have knocked, monitored at the grid points; an American as its European, a lower bound), after it the payoff fixed and discounted to settlement. Bought: one-sided exposure after the premium. Vol from the pair's surface at the option's expiry and strike; type a number to override.</>
              : <>Lognormal forward, exposure ±N·(F<sub>t</sub> − K)·DF. Vol is the pair's surface at the forward's tenor (ATM); type a number to override. A pair without a surface uses the demo default, and the run says so.</>}
          </Note></SectionHeader>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 100px', gap:'4px', marginBottom:'6px' }}>
            <TipLabel tipKey='fxVol' tip={tip} untip={untip} style={{ alignSelf:'center' }}>Vol % override</TipLabel>
            <input type='text' inputMode='decimal' value={volPct} onChange={e => setVolPct(e.target.value)}
              placeholder={res?.params?.vol_pct != null ? Number(res.params.vol_pct).toFixed(2) : 'surface'}
              style={{ ...INP, textAlign:'right', color: volPct ? 'var(--text-hi)' : 'var(--text-dim)', borderColor: volPct ? 'var(--border-hi)' : 'var(--border)' }} />
          </div>
          <div onMouseEnter={e => tip('fxVolMode', e)} onMouseLeave={untip} style={{ display:'flex', gap:'4px', marginBottom:'8px' }}>
            {VOL_MODES.map(([k, label]) => (
              <button className="rj-press" key={k} onClick={() => setVolMode(k)} title={MODE_TITLE[k]}
                style={{ flex:1, padding:'4px 0', fontSize:'0.7rem', fontWeight:700, letterSpacing:'0.08em', fontFamily:'var(--mono)', cursor:'pointer', background: volMode === k ? 'rgba(217,178,92,0.06)' : 'transparent', borderRadius:'2px',
                  border: volMode === k ? '1px solid var(--border-glow)' : '1px solid var(--border)', color: volMode === k ? 'var(--text-hi)' : 'var(--text-dim)' }}>{label}</button>
            ))}
          </div>

          <PathsWwrSliders paths={paths} setPaths={setPaths} wwr={wwr} setWwr={setWwr} tip={tip} untip={untip} pathsTip='fxPaths' multiplier={false} />

          <div data-testid="xva-credit-link" style={{ marginBottom: '10px' }}>
            <SectionHeader>CREDIT AND {quote?.base_currency || 'THE ASSET'}<Note inline>
              Wrong-way risk. A party's default intensity is tied to {quote?.base_currency || 'the asset'} on every path: the multiple chosen when it halves against its forward, one over it when it doubles, and solved date by date so the credit curve above is repriced exactly (Hull and White, 2012). A counterparty that is long the asset (a miner, a long-biased fund) worsens as it falls, so being owed money when it has fallen is the wrong way and the charge rises; being owed when it has risen is the right way and it falls. The multiple is the desk's judgement of the counterparty; independent is the calculation without it.
            </Note></SectionHeader>
            {[['Counterparty', cpLink, setCpLink, 'xva-link-cp'], ['Our own', ownLink, setOwnLink, 'xva-link-own']].map(([label, v, set, id]) => (
              <div key={id} style={{ display: 'grid', gridTemplateColumns: '1fr 170px', gap: '4px', marginBottom: '4px', alignItems: 'center' }}>
                <label htmlFor={id} style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{label}</label>
                <select id={id} data-testid={id} value={v} onChange={e => set(e.target.value)}
                  style={{ ...INP, color: v === '1' ? 'var(--text-dim)' : 'var(--text-hi)', borderColor: v === '1' ? 'var(--border)' : 'var(--border-hi)' }}>
                  {CREDIT_LINKS.map(([k, words]) => <option key={k} value={k}>{words}</option>)}
                </select>
              </div>
            ))}
          </div>

          {badge ? (
            <ModelBadge kind={badge.kind} tipKey='fxSurface' tip={tip} untip={untip}>{badge.text}</ModelBadge>
          ) : (
            <ModelBadge kind='muted'>{quote ? `Vol from the pair's surface at ${isOption ? "the option's expiry and strike" : "the forward's tenor"} — press SIMULATE.` : 'Price the ticket first.'}</ModelBadge>
          )}
          </div>

          {simulateButtons}
          <SurfaceProof result={res} />
          {simulateError}

          {settlementBlock}
          </>)}
        </div>

        {/* RIGHT PANEL */}
        <div style={XVA_RIGHT}>
          <ExposureCanvas result={res} height='fill' highlight={highlightCurve} onHighlight={setHighlightCurve}
            style={{flex:'0 0 auto',height:XVA_CHART_HEIGHT,border:'none',borderBottom:'1px solid var(--border)',borderRadius:0}}>
            <RunReadout result={res} />
            <ChartReadout result={res} fmt={fmt}
              model={<>{res?.package ? `${res.legs?.length} legs, one netting set` : res?.params?.style ? String(res.params.style).replace(/_/g, ' ') : 'lognormal forward'} · vol {Number(res?.params?.vol_pct).toFixed(2)}% · {res?.params?.vol_mode && /flat/i.test(res.params.vol_mode) ? 'flat' : /smile/i.test(res?.params?.vol_mode || '') ? 'term + smile' : 'term structure'} · {res?.steps} monthly steps · {ccy}</>} />
          </ExposureCanvas>

          <div style={{flexShrink:0,overflowX:'auto'}} data-testid="xva-outputs">
            <VaStrip rows={vaRows} fmt={fmt} expanded={expandedVa} setExpanded={setExpandedVa} onHighlight={setHighlightCurve} runLabel={res?.csa?.preset ? String(res.csa.preset).replace('_', '-') : 'THIS RUN'} also={cmpRows.map(r => r.oc)} />
            <OnChainCompareRow rows={cmpRows} current={res} compare={cmp} fmt={fmt} saving={saving} />
            <VaFooter>
              ALL-IN = NPV + CVA + DVA + FVA + FBA + KVA + MVA + ColVA · Click any VA to expand · bp = VA / (notional × 1bp)
              {notionalQ ? <> · notional {fmt(notionalQ).replace(/^\+/, '')} {ccy}</> : null}
              {res && <> · seed {res.seed ?? seed}</>}
            </VaFooter>
            {res?.capital && (
              <div data-testid="xva-basis" style={{ padding: '6px 16px 2px', fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                <div data-testid="xva-capital-basis"><span style={{ fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)' }}>CAPITAL</span>{' '}{res.capital.basis}</div>
                <div data-testid="xva-im-basis" data-im={Math.round(Number(res.capital.im_0) || 0)}><span style={{ fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)' }}>INITIAL MARGIN</span>{' '}
                  {res.capital.im_basis === 'none' ? 'none exchanged under this settlement'
                    : <><span style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>{fmt(res.capital.im_0).replace(/^\+/, '')}</span> at the first date · {res.capital.im_basis}</>}
                  {res.capital.im_basis !== 'none' && <Note inline>{res.capital.im_note}</Note>}
                </div>
              </div>
            )}
            {ww?.cp && (
              <div data-testid="xva-wwr" data-cva={Math.round(ww.cp.cva)} data-independent={Math.round(ww.cp.independent)} style={{ padding: '6px 16px 2px', fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                <span style={{ fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)' }}>{ww.cp.wrong ? 'WRONG-WAY RISK' : 'RIGHT-WAY RISK'}</span>
                {' '}CVA <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>{fmt(ww.cp.cva)}</span> with the counterparty's credit tied to {quote?.base_currency || 'the asset'} (× {ww.cp.k} when it halves),
                {' '}<span style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>{fmt(ww.cp.independent)}</span> if independent
              </div>
            )}
            {ww?.own && (
              <div data-testid="xva-wwr-own" data-dva={Math.round(ww.own.dva)} data-independent={Math.round(ww.own.independent)} style={{ padding: '6px 16px 2px', fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                <span style={{ fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)' }}>OUR OWN CREDIT</span>
                {' '}DVA <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>{fmt(ww.own.dva)}</span> with our credit tied to {quote?.base_currency || 'the asset'} (× {ww.own.k} when it halves),
                {' '}<span style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>{fmt(ww.own.independent)}</span> if independent
              </div>
            )}
            {legPeaks != null && netPeak != null && legPeaks > 0 && (
              <div data-testid="xva-netting" data-net={Math.round(netPeak)} data-gross={Math.round(legPeaks)} style={{ padding: '6px 16px 10px', fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                <span style={{ fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)' }}>NETTING</span>
                {' '}peak expected exposure <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>{fmt(netPeak).replace(/^\+/, '')}</span> as one set,
                {' '}<span style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>{fmt(legPeaks).replace(/^\+/, '')}</span> leg by leg
              </div>
            )}
          </div>
          {view !== 'simple' && (
            <div style={XVA_BAND} data-testid="xva-assumptions">
              <div><SpreadCurvesGrid spreads={spreads} onChange={setSpread} tip={tip} untip={untip} /></div>
              <div><AssumptionsBlock lgd={lgd} setLgd={setLgd} fbaRatio={fbaRatio} setFbaRatio={setFbaRatio} hurdle={hurdle} setHurdle={setHurdle} imUsd={imUsd} setImUsd={setImUsd} capModel={capModel} setCapModel={setCapModel} note={FX_MVA_NOTE} tip={tip} untip={untip} imCcy={ccy}>
                {res?.capital?.crypto_group != null || isDigital ? (<>
                  <label htmlFor="xva-crypto-group" style={{ alignSelf: 'center', fontSize: '0.75rem', color: 'var(--text-dim)', gridColumn: '1' }}>Basel group</label>
                  <select id="xva-crypto-group" data-testid="xva-crypto-group" value={cryptoGroup} onChange={e => setCryptoGroup(e.target.value)} style={{ ...INP, cursor: 'pointer', gridColumn: '2 / span 3' }}
                    title="SCO60: a Group 2a cryptoasset (a regulated derivative or ETF, USD 10bn of market capitalisation, USD 50m a day, a year of prices, shown to the supervisor) takes SA-CCR with a 32 % factor; anything else is Group 2b, 50 % of each trade's notional">
                    {CRYPTO_GROUPS.map(([k, words]) => <option key={k || 'default'} value={k}>{words}</option>)}
                  </select>
                </>) : null}
              </AssumptionsBlock></div>
            </div>
          )}
        </div>

        <FloatingTip tooltip={tooltip} onLeave={untip} />
      </div>

      {/* Incremental XVA: the counterparty's netting set with and without this trade */}
      <div style={{ borderTop:'1px solid var(--border)' }}>{incremental}</div>
    </div>
  )
}
