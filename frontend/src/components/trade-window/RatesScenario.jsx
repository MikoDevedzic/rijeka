// trade-window/RatesScenario.jsx — the CURVE SCENARIO tab of a rates ticket (a swap, a cap, a floor, a collar, a
// swaption), in the one shape every product's scenario tab has (docs/design.md, "The scenario tab"; a currency
// trade's is FxTabs.jsx `ScenarioBody`): at the left the curves the price was built on, each a button with its risk
// factor's mark and what has been done to it, then the selected curve's flat shock and its points; at the right the
// selected curve's chart, the result as one table (factors across, TOTAL the column that stands out), the scenario's
// value, and one ladder for the selected curve.
//
// A volatility surface is one of the curves, and is moved exactly as a rate curve is: flat, point by point, or by
// dragging a point on its chart (ScenarioCurve.jsx draws both).
//
// Every figure is the pricing engine's own: the ticket's request (products/rates.js `buildPayload`) is sent again
// with the scenario's shifts, which the server applies to the quotes it builds the curve from and to the vol the
// trade is priced at (rates-scenario.js). With nothing shocked the request is the ticket's, field for field, and the
// value is the ticket's value. Nothing is saved.
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { Note } from '../common/Note'
import { PLOT_TITLE, RESULT_FIG, XVA_ROW, XVA_LEFT, XVA_RIGHT } from './xva-shared'
import ScenarioCurve, { CurveLegend } from './ScenarioCurve'
import { CURVE_BOUND_BP, KIND, LADDER, NO_SHOCK, VOL_BOUND_BP, capSmile, capTerm, curveIds, curvePoints, curveQuotes, figures, hasVol, horizon, isBermudan, isShocked, shockAtPoint, shockAtTime,
  shockSaid, spread, swaptionAcross, swaptionTerm, wanted, withFlat, withOwn } from './rates-scenario'

// A figure that rounds to nothing at the precision it is shown at is nothing: no sign, no colour (as on FxTabs.jsx).
const shown = (n, d = 0) => { const r = Number(n); return Math.abs(r) < 0.5 * 10 ** -d ? 0 : r }
const fmt = (n, d = 0) => n == null || isNaN(n) ? '—' : shown(n, d).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
const tone = (n, d = 0) => { if (n == null || isNaN(n)) return 'var(--text-dim)'; const r = shown(n, d); return r > 0 ? 'var(--green)' : r < 0 ? 'var(--red)' : 'var(--text)' }
const signedChange = (n, d = 0) => (n == null || isNaN(n) ? '—' : `${shown(n, d) > 0 ? '+' : ''}${fmt(n, d)}`)
const plus = (v, d = 0) => `${v > 0 ? '+' : ''}${Number(Number(v).toFixed(d))}`
const secHdr = { fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text-hi)', fontFamily: 'var(--sans)', lineHeight: 1.2, margin: '16px 0 10px' }
const lbl = { fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-mute)', fontFamily: 'var(--sans)', fontWeight: 500 }
const inputBox = { background: 'var(--bg)', color: 'var(--text-hi)', border: '1px solid var(--fld-bd)', borderRadius: 'var(--r-2)', padding: '5px 7px', fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right', width: '100%' }
const setBox = { borderColor: 'var(--accent-dim)', boxShadow: 'inset 0 -2px 0 var(--accent)' }
const typedNumber = (text) => { const t = String(text).replace('−', '-').trim(); if (t === '') return 0; const m = /^([+-]?)\s*(\d+(?:\.\d*)?|\.\d+)\s*(bp)?$/i.exec(t); return m ? Number(m[2]) * (m[1] === '-' ? -1 : 1) : null }
const WAIT_MS = 250                    // a drag settles before the engine is asked
const KEPT = 400                       // answers kept, by request

function Tile({ label, value, color, sub: note, testId, raw }) {
  return (
    <div style={{ position: 'relative', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-3)', padding: '9px 12px', minWidth: 0 }}>
      <div style={{ ...lbl, marginBottom: 4 }}>{label}</div>
      <div data-testid={testId} data-value={raw ?? ''} style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: color || 'var(--text-hi)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {note && <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</div>}
    </div>
  )
}

// A curve's saved quotes, read when the tab is opened and each time it is opened again: market data saved since is then
// what is shown, and an answer that failed is asked for again (nothing is kept between openings).
const snapshot = (id) => apiFetch(`/api/market-data/snapshots/${id}/latest`).then(r => (r.ok ? r.json() : null)).then(j => (j?.exists ? j : null)).catch(() => null)

// `payload`: the request the ticket's price on screen answers (TradeWindow.jsx handlePrice), so the scenario's request
// with nothing shocked is that request. `curves`: the curve list the ticket sends with a pricing request, to tell
// whether the form has been changed since (`stale`). `booked`: the ticket is a stored trade, whose own value is its
// revaluation as booked; the scenario is of its terms as the ticket shows them.
export default function RatesScenario({ product, productKey, state, result, payload = null, active, curves, booked = false }) {
  const kind = KIND[productKey], option = hasVol(productKey), bermudan = isBermudan(productKey, payload)
  const ccy = state?.ccy || 'USD'
  const form = useMemo(() => { try { const p = product?.pricing?.buildPayload?.(state); return p ? JSON.stringify({ ...p, curves }) : null } catch { return null } }, [product, state, curves])
  const stale = !!(payload && form && form !== JSON.stringify(payload))
  const endpoint = typeof product?.pricing?.endpoint === 'function' ? product.pricing.endpoint(state) : product?.pricing?.endpoint
  const ids = useMemo(() => curveIds(payload), [payload])
  const idKey = ids.join(','), swvolId = kind === 'swaption' && !bermudan ? `${ccy}_SWVOL_ATM` : null          // a Bermudan's vol is the tree's σ: no surface is read for it
  const hz = useMemo(() => horizon(productKey, payload), [productKey, payload])

  // the saved quotes of each curve the trade is priced on, and of the swaption surface
  const [snaps, setSnaps] = useState({})
  useEffect(() => {
    if (!active) return undefined
    let on = true
    for (const id of [...ids, swvolId].filter(Boolean)) snapshot(id).then(s => { if (on) setSnaps(x => ({ ...x, [id]: s })) })
    return () => { on = false }
  }, [idKey, swvolId, active])   // eslint-disable-line react-hooks/exhaustive-deps

  // the scenario: a shock per curve and one for the vol; another product, currency or set of curves starts clean
  const scope = `${productKey}|${ccy}|${idKey}`
  const [held, setHeld] = useState({ scope, shocks: {}, sel: null })
  const shocks = held.scope === scope ? held.shocks : {}
  const setShock = (key, next) => setHeld(h => ({ scope, sel: h.scope === scope ? h.sel : null, shocks: { ...(h.scope === scope ? h.shocks : {}), [key]: next } }))

  const volPts = useMemo(() => (bermudan ? [] : kind === 'swaption' ? swaptionTerm(snaps[swvolId]?.quotes, hz.tenor).points : option ? capTerm(result?.surface_rows) : []), [bermudan, kind, option, snaps, swvolId, hz.tenor, result])
  const factors = useMemo(() => [
    ...ids.map(id => ({ key: id, kind: 'curve', name: id.replace(/_/g, ' '), color: 'var(--rf-ir)', unit: 'bp', bound: CURVE_BOUND_BP, slide: 200, step: 5, d: 0,
      sub: snaps[id] ? `saved ${snaps[id].valuation_date}` : snaps[id] === undefined ? 'reading the saved quotes…' : 'no quotes read: flat only',
      points: curvePoints(snaps[id]?.quotes, hz.through), quotes: curveQuotes(snaps[id]?.quotes) })),
    ...(option ? [{ key: 'vol', kind: 'vol', name: bermudan ? `${ccy} HULL-WHITE σ` : `${ccy} ${kind === 'swaption' ? 'SWAPTION' : 'CAP'} VOL`, color: 'var(--rf-vol)', unit: 'bp', bound: VOL_BOUND_BP, slide: 30, step: 0.5, d: 1,
      sub: bermudan ? 'the tree\'s own vol · one number' : volPts.length ? 'normal vol · at the money' : 'no surface read: flat only',
      points: volPts }] : []),
  ], [ids, snaps, hz.through, hz.tenor, option, bermudan, kind, ccy, volPts, swvolId])
  const cur = factors.find(f => f.key === held.sel && held.scope === scope) || factors[0]
  const volF = factors.find(f => f.kind === 'vol')
  const volAt = (shock) => (volF ? shockAtTime(shock, volF.points, hz.expiry) : 0)

  // ── the engine's prices: the market, each shocked curve alone, all together, the ladder ──
  // (a curve's shock goes to the engine on every quote the curve is built from: the shown points' own, the others' on the line between them)
  const sent = useMemo(() => Object.fromEntries(factors.map(f => [f.key, f.kind === 'curve' ? spread(shocks[f.key], f.points, f.quotes) : shocks[f.key] || NO_SHOCK])), [factors, shocks])
  const want = useMemo(() => (payload && cur ? wanted(productKey, payload, factors, sent, cur.key, volAt) : { bodies: {}, same: {} }), [payload, productKey, factors, sent, cur?.key])   // eslint-disable-line react-hooks/exhaustive-deps
  const [answers, setAnswers] = useState(() => new Map())          // request → the engine's answer, kept while the ticket is open
  const wantKey = JSON.stringify(want.bodies)
  const ready = !!(active && result && endpoint && payload)
  const busy = ready && Object.values(want.bodies).some(b => !answers.has(JSON.stringify(b)))          // a price asked for and not yet answered
  useEffect(() => {
    if (!ready) return undefined
    const todo = Object.values(want.bodies).map(b => JSON.stringify(b)).filter(j => !answers.has(j))
    if (!todo.length) return undefined
    const stop = new AbortController()
    const timer = setTimeout(async () => {
      const got = []
      await Promise.all([...new Set(todo)].map(async (j) => {
        try {
          const r = await apiFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: j, signal: stop.signal })
          const body = await r.json().catch(() => ({}))
          got.push([j, r.ok ? { figs: figures(productKey, body) } : { error: typeof body.detail === 'string' ? body.detail : `the engine answered ${r.status}` }])
        } catch (e) { if (e?.name !== 'AbortError') got.push([j, { error: e?.message || 'the engine could not be reached' }]) }
      }))
      if (stop.signal.aborted) return
      setAnswers(was => { const next = new Map([...was, ...got]); for (const k of [...next.keys()].slice(0, Math.max(0, next.size - KEPT))) next.delete(k); return next })
    }, WAIT_MS)
    return () => { clearTimeout(timer); stop.abort() }
  }, [ready, wantKey, endpoint, productKey])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!kind) return null
  if (!result || !payload) {
    return <div className="tbw-no-drag" data-testid="scn-unpriced" style={{ padding: '36px 24px', color: 'var(--text-dim)', fontSize: 12.5, fontFamily: 'var(--sans)' }}>Price the ticket first: a scenario starts from its price, and moves the curves that price was built on.</div>
  }
  const cell = (k) => answers.get(JSON.stringify(want.bodies[want.same[k] ?? k]))
  const figs = (k) => cell(k)?.figs || null
  const market = figs('market'), all = figs('all')
  const error = Object.keys({ ...want.bodies, ...want.same }).map(k => cell(k)?.error).find(Boolean)
  const dOf = (f) => (isShocked(shocks[f.key]) ? (figs(`only:${f.key}`) && market ? figs(`only:${f.key}`).npv - market.npv : null) : 0)
  const total = market && all ? all.npv - market.npv : null
  const parts = factors.map(dOf)
  const cross = total == null || parts.some(p => p == null) ? null : total - parts.reduce((a, b) => a + b, 0)
  // the ticket's own risk figures times the shock: IR01 a bp for a curve moved flat, vega a bp for the vol at the trade
  const first = (f) => {
    const s = shocks[f.key] || NO_SHOCK
    if (!market || !isShocked(s)) return 0
    if (f.kind === 'vol') return market.vega == null ? null : market.vega * volAt(s)
    return Object.values(s.own || {}).some(Number) || factors.filter(x => x.kind === 'curve').length > 1 || market.ir01 == null ? null : market.ir01 * s.flat
  }
  const firsts = factors.map(first), firstTotal = firsts.some(v => v == null) ? null : firsts.reduce((a, b) => a + b, 0)
  const volShift = volF ? volAt(shocks.vol || NO_SHOCK) : 0
  // (before the market's answer is back: a European swaption's typed vol, or with none typed the vol its price read off the surface; a Bermudan's σ as the ticket's own price reports it, never the surface's)
  const tradeVol = market?.vol ?? (bermudan ? (Number.isFinite(Number(result?.vol_bp)) ? Number(result.vol_bp) : null) : kind === 'swaption' ? (payload.vol_bp != null ? Number(payload.vol_bp) : (Number.isFinite(Number(result?.vol_bp)) ? Number(result.vol_bp) : null)) : null)

  // ── the left column ──
  const shock = shocks[cur.key] || NO_SHOCK
  const commit = (e, apply, was, show) => { const v = typedNumber(e.target.value); e.target.value = show(v == null ? was : apply(v)) }
  const onEnter = (e) => { if (e.key === 'Enter') e.target.blur() }
  const setFlat = (v) => { const next = withFlat(shock, v, cur.bound); setShock(cur.key, next); return next.flat }
  const setOwn = (id, v) => { const next = withOwn(shock, id, v, cur.bound); setShock(cur.key, next); return next.own[id] || 0 }
  const reset = () => setHeld({ scope, sel: cur.key, shocks: {} })
  const curveBtn = (c) => (
    <button className="rj-press" key={c.key} type="button" data-testid={`scn-curve-${c.kind === 'vol' ? 'vol' : c.key}`} aria-pressed={c.key === cur.key} onClick={() => setHeld(h => ({ scope, shocks: h.scope === scope ? h.shocks : {}, sel: c.key }))}
      style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 8, alignItems: 'center', width: '100%', padding: '8px 10px', marginBottom: 6, textAlign: 'left', cursor: 'pointer',
        borderRadius: 'var(--r-2)', border: `1px solid ${c.key === cur.key ? 'var(--border-glow)' : 'var(--border)'}`, background: c.key === cur.key ? 'var(--panel-3)' : 'transparent',
        color: c.key === cur.key ? 'var(--text-hi)' : 'var(--text-dim)', fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 500, letterSpacing: '0.04em' }}>
      <span className="rf-mark" style={{ background: c.color, margin: 0 }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 400, letterSpacing: 0, color: 'var(--text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sub}</span>
      </span>
      <span data-testid={`scn-says-${c.kind === 'vol' ? 'vol' : c.key}`} style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 400, letterSpacing: 0, color: isShocked(shocks[c.key]) ? 'var(--text-hi)' : 'var(--text-mute)', whiteSpace: 'nowrap' }}>{shockSaid(shocks[c.key], ` ${c.unit}`)}</span>
    </button>
  )
  const left = (
    <div style={XVA_LEFT} data-testid="scn-left">
      <div style={{ ...secHdr, marginTop: 4 }}>CURVES THAT PRICE THIS TRADE<Note inline>Every market input the price was built from, each in the colour of its risk factor. Select one to shock it flat, point by point, or by dragging on the chart.</Note></div>
      {factors.map(curveBtn)}
      <div style={secHdr}>FLAT SHOCK · {cur.kind === 'vol' ? (bermudan ? 'BP OF THE MODEL\'S σ' : 'BP OF NORMAL VOL') : 'BASIS POINTS'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 84px', gap: 10, alignItems: 'center' }}>
        <input type="range" data-testid="scn-flat" aria-label={`Flat shock, ${cur.name}`} min={-cur.slide} max={cur.slide} step={cur.step} value={Math.max(-cur.slide, Math.min(cur.slide, shock.flat))}
          onChange={e => setFlat(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--text)' }} />
        <input key={`${cur.key}:${shock.flat}`} type="text" inputMode="decimal" data-testid="scn-flat-value" aria-label={`Flat shock value, ${cur.name}`} defaultValue={`${plus(shock.flat, 2)}${cur.unit}`}
          onBlur={e => commit(e, setFlat, shock.flat, v => `${plus(v, 2)}${cur.unit}`)} onKeyDown={onEnter} style={{ ...inputBox, ...(shock.flat ? setBox : null) }} />
      </div>
      {cur.points.length > 0 && (<>
        <div style={secHdr}>POINT BY POINT<Note inline>{cur.kind === 'vol' ? 'Type a shock on one expiry of the surface, or drag it on the chart. The trade sees the vol at its own expiry: between two points the shock is read on the line between them.' : 'Type a shock on one tenor, or drag it on the chart. A quote between two of these tenors takes the shock on the line between them; the curve is built again from the moved quotes and the trade repriced on it.'}</Note></div>
        <table data-testid="scn-points" style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr>{[cur.kind === 'vol' ? (kind === 'swaption' ? 'EXPIRY' : 'MATURITY') : 'TENOR', 'MARKET', 'SHOCK BP', 'SCENARIO'].map((h, i) => <th key={h} style={{ ...lbl, textAlign: i ? 'right' : 'left', padding: '4px 4px 6px', borderBottom: '1px solid var(--border-hi)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>{cur.points.map(p => { const own = Number(shock.own?.[p.id]) || 0, dp = cur.kind === 'vol' ? 1 : 4, scen = p.v + shockAtPoint(shock, p) / (cur.kind === 'vol' ? 1 : 100); return (
            <tr key={p.id} data-testid={`scn-point-${p.id}`} data-market={p.v} data-scenario={scen}>
              <td style={{ fontSize: 12.5, color: 'var(--text-dim)', padding: '3px 4px', borderBottom: '1px solid var(--border)' }}>{p.label}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right', padding: '3px 4px', borderBottom: '1px solid var(--border)' }}>{p.v.toFixed(dp)}</td>
              <td style={{ padding: '3px 4px', borderBottom: '1px solid var(--border)', width: 84 }}>
                <input key={`${cur.key}:${p.id}:${own}`} type="text" inputMode="decimal" data-point={p.id} aria-label={`Shock at ${p.label}`} placeholder="—" defaultValue={own ? plus(own, 2) : ''}
                  onBlur={e => commit(e, v => setOwn(p.id, v), own, v => (v ? plus(v, 2) : ''))} onKeyDown={onEnter} style={{ ...inputBox, ...(own ? setBox : null) }} />
              </td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right', padding: '3px 4px', borderBottom: '1px solid var(--border)', color: 'var(--text-hi)' }}>{scen.toFixed(dp)}</td>
            </tr>) })}</tbody>
        </table>
      </>)}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="tbw-btn" style={{ flex: 1, padding: '7px 10px' }} data-testid="scn-reset-curve" onClick={() => setShock(cur.key, NO_SHOCK)}>RESET CURVE</button>
        <button type="button" className="tbw-btn" style={{ flex: 1, padding: '7px 10px' }} data-testid="scn-reset" onClick={reset}>RESET ALL</button>
      </div>
    </div>
  )

  // ── the right column: the selected curve, the result, the scenario's value, the ladder ──
  const isVol = cur.kind === 'vol'
  const chartTitle = isVol ? (bermudan ? `HULL-WHITE σ · ${ccy}` : `VOL SURFACE · ${ccy} ${kind === 'swaption' ? 'SWAPTIONS' : 'CAPS AND FLOORS'}`) : `${cur.name} · QUOTED RATE % A YEAR`
  const chartSays = isVol && bermudan
    ? 'The volatility of the short rate in the Hull-White model the tree is built on, from the stored calibration: one number, in basis points. A shock moves it flat and the tree is built again; the vega beside it is the value of one basis point of it. The swaption surface is not moved: that would mean calibrating the model again.'
    : isVol
    ? `The surface as it is saved: normal vol in basis points, at the money, by ${kind === 'swaption' ? 'expiry' : 'maturity'}. Drag a point up or down to shock it; the trade is repriced at the vol it priced at, moved by the shock at its own ${kind === 'swaption' ? 'expiry' : 'maturity'}.`
    : `The curve's quotes at its main tenors, up to the trade's last date and the two after it; those beyond cannot reach this trade. Drag one up or down to shock it: the quotes around it follow on the line to the next tenor, the curve is built again and the trade repriced on it.`
  const volNow = tradeVol == null ? null : tradeVol + volShift
  const dotOf = (t, label = true) => (volNow == null || !Number.isFinite(t) ? null : { t, v: volNow, label: label ? `${volNow.toFixed(1)} bp` : '' })
  const second = !isVol || bermudan ? null : kind === 'swaption' ? swaptionAcross(snaps[swvolId]?.quotes, hz.expiry) : { points: capSmile(result?.surface_rows, hz.expiry), expiry: null }
  // where the trade itself stands on the second chart: a cap's or a floor's strike less the at-the-money rate, a
  // swaption's own swap tenor (a collar has two strikes, and is not marked)
  // the strike the price struck (a blank one is at the money: the answer has it, the request does not)
  const strikeOf = kind === 'cap' ? (result?.cap_rate ?? payload.cap_rate) : kind === 'floor' ? (result?.floor_rate ?? payload.floor_rate) : null
  const own2 = kind === 'swaption' ? { t: hz.tenor, label: 'THE SWAP' }
    : strikeOf != null && Number.isFinite(Number(result?.atm_forward)) ? { t: (Number(strikeOf) - Number(result.atm_forward)) * 1e4, label: 'THE STRIKE' } : null
  const noPoints = <div data-testid="scn-no-points" style={{ padding: isVol && bermudan ? '4px 0 10px' : '36px 0', color: 'var(--text-dim)', fontSize: 12.5, lineHeight: 1.5 }}>{isVol && bermudan ? `A Bermudan is priced on the Hull-White tree. Its vol is the model's σ, one number${tradeVol == null ? '' : ` (${tradeVol.toFixed(1)} bp at the market${volShift ? `, ${(tradeVol + volShift).toFixed(1)} bp under this scenario` : ''})`}: there is no curve of it to draw, and it is shocked flat, on the left. The swaption surface is not moved.` : isVol ? `No vol surface could be read for ${ccy}: the vol the trade priced at is shocked flat.` : `No saved quotes could be read for ${cur.name}: the curve is shocked flat.`}</div>
  const legend = (
    <CurveLegend testId="scn-legend" items={[
      { mark: 'dash', color: 'var(--text-dim)', text: isShocked(shock) ? (isVol ? 'ATM AT THE MARKET' : 'AT THE MARKET') : (isVol ? 'ATM' : 'THE QUOTES') },
      isShocked(shock) && { mark: 'line', color: cur.color, text: 'SHOCKED' },
      isVol && volNow != null && { mark: 'dot', color: 'var(--amber)', text: 'THE VOL THIS TRADE PRICED AT' },
    ]} />
  )
  const term = cur.points.length
    ? <ScenarioCurve points={cur.points} own={shock.own} flat={shock.flat} shockAt={(p) => shockAtPoint(shock, p)} onPoint={(id, v) => setOwn(id, v)} color={cur.color}
        scale={isVol ? 1 : 100} bound={cur.bound} step={isVol ? 0.5 : 1} decimals={isVol ? 1 : 2} width={isVol && second?.points.length ? 460 : 880} height={isVol ? 220 : 250}
        mark={Number.isFinite(isVol ? hz.expiry : hz.through) ? { t: isVol ? hz.expiry : hz.through, label: isVol ? (kind === 'swaption' ? 'EXPIRES' : 'MATURES') : 'MATURES' } : null}
        dot={isVol ? dotOf(hz.expiry) : null} testId="scn-chart" ariaLabel={isVol ? 'The vol surface by expiry: market against scenario' : 'The curve\'s quoted rates: market against scenario'} />
    : noPoints
  const selected = isVol && second?.points.length ? (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '12px 20px' }}>
      <div style={{ minWidth: 0 }}><div style={PLOT_TITLE}>TERM STRUCTURE</div>{term}{legend}</div>
      <div style={{ minWidth: 0 }}>
        <div style={PLOT_TITLE}>{kind === 'swaption' ? `ACROSS SWAP TENORS · EXPIRY ${second.expiry}` : 'SMILE AT MATURITY · STRIKE − ATM, BP'}</div>
        <ScenarioCurve points={second.points} own={{}} flat={volShift} shockAt={() => volShift} onPoint={() => {}} disabled color={cur.color} scale={1} bound={cur.bound} decimals={1} width={460} height={220}
          mark={own2} dot={own2 ? dotOf(own2.t, false) : null} testId="scn-chart-second" ariaLabel="The vol surface at the trade's expiry: market against scenario" />
        <CurveLegend items={[{ mark: 'dash', color: 'var(--text-dim)', text: volShift ? 'AT THE MARKET' : (kind === 'swaption' ? 'ATM' : 'THE SMILE') }, volShift ? { mark: 'line', color: cur.color, text: 'SHOCKED' } : null,
          own2 && volNow != null ? { mark: 'dot', color: 'var(--amber)', text: 'THIS TRADE' } : null]} />
      </div>
    </div>
  ) : <div style={{ minWidth: 0 }}>{term}{cur.points.length > 0 && legend}</div>

  const cols = `150px repeat(${factors.length + (factors.length > 1 ? 2 : 1)}, minmax(0, 1fr))`
  const rRow = { display: 'grid', gridTemplateColumns: cols, alignItems: 'stretch', padding: '0 12px 0 16px', minWidth: 520 }
  const rName = { ...lbl, padding: '8px 8px 7px 0', whiteSpace: 'nowrap' }
  const rCell = { fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '7px 6px', whiteSpace: 'nowrap', fontSize: RESULT_FIG, fontWeight: 500 }
  const rSmall = { ...rCell, fontSize: 12, fontWeight: 400, color: 'var(--text-dim)', padding: '0 6px 7px' }
  const rTot = { background: 'var(--panel)', boxShadow: 'inset 1px 0 0 var(--border-hi)' }
  const money = (v, key, style = rCell) => <div key={key} data-cell={key} data-value={v ?? ''} style={{ ...style, ...(style === rCell ? { color: tone(v) } : null), ...(key === 'total' ? { ...rTot, ...(style === rCell ? { fontWeight: 600 } : null) } : null) }}>{v == null ? '—' : signedChange(v)}</div>
  const results = (
    <div data-testid="scn-results" className="ph-flip" style={{ overflowX: 'auto', borderTop: '1px solid var(--border)', background: 'var(--bg)', '--ph-n': factors.length + 3 }}>
      <div style={{ ...rRow, background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
        <div style={rName} />
        {factors.map(c => <div key={c.key} style={{ ...rCell, ...lbl, fontSize: 11 }}><span className="rf-mark" style={{ background: c.color }} />{c.kind === 'vol' ? 'VOL' : factors.filter(x => x.kind === 'curve').length > 1 ? c.name : `${ccy} CURVE`}</div>)}
        {factors.length > 1 && <div style={{ ...rCell, ...lbl, fontSize: 11 }}>CROSS<Note inline>What is left when the shocks act together: the total less each shock taken alone.</Note></div>}
        <div style={{ ...rCell, ...lbl, fontSize: 11, fontWeight: 600, color: 'var(--text-hi)', ...rTot }}>TOTAL</div>
      </div>
      <div style={{ ...rRow, paddingTop: 7 }} data-testid="scn-shock">
        <div style={{ ...rName, padding: '0 8px 7px 0' }}>SHOCK</div>
        {factors.map(c => <div key={c.key} style={rSmall}>{c.kind === 'vol' && isShocked(shocks.vol) ? `${plus(volShift, 2)} bp ${bermudan ? 'of σ' : 'at the trade'}` : shockSaid(shocks[c.key], ` ${c.unit}`)}</div>)}
        {factors.length > 1 && <div style={rSmall}>—</div>}<div style={{ ...rSmall, ...rTot }}>—</div>
      </div>
      <div style={rRow} data-testid="scn-change">
        <div style={rName}>CHANGE IN NPV · {ccy}</div>
        {factors.map((c, i) => money(parts[i], c.kind === 'vol' ? 'vol' : c.key))}
        {factors.length > 1 && money(cross, 'cross')}{money(total, 'total')}
      </div>
      <div style={rRow} data-testid="scn-first">
        <div style={{ ...rName, padding: '0 8px 7px 0' }}>SENSITIVITY × SHOCK<Note inline>IR01 × the curve's flat shock{option ? (bermudan ? ', VEGA × the shock of the model\'s σ' : ', VEGA × the vol shock at the trade') : ''}: the ticket's own risk figures, to first order. The line above is the engine's price on the curve built again from the moved quotes. The two differ by the trade's curvature, by the discounting, which the ticket's IR01 holds still, and because a quote moved a basis point is not a zero rate moved a basis point. A curve shocked point by point has no single figure to multiply, and shows a dash.</Note></div>
        {factors.map((c, i) => money(firsts[i], c.kind === 'vol' ? 'vol' : c.key, rSmall))}
        {factors.length > 1 && <div style={rSmall}>—</div>}{money(firstTotal, 'total', rSmall)}
      </div>
    </div>
  )

  const xs = LADDER[cur.kind]
  const lad = xs.map(x => ({ x, r: figs(x ? `ladder:${x}` : 'all') }))
  const lRow = { display: 'grid', gridTemplateColumns: `150px repeat(${lad.length}, minmax(0, 1fr))`, padding: '0 12px 0 16px', minWidth: 760 }
  const lCell = { fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right', padding: '6px 6px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
  const mid = (x) => (x === 0 ? { background: 'var(--panel)' } : null)
  const ladderBlock = (
    <div data-testid="scn-ladder" style={{ overflowX: 'auto', paddingBottom: 12, background: 'var(--bg)' }}>
      <div style={{ ...secHdr, margin: '12px 16px 8px' }}>LADDER · {cur.name}<Note inline>Each column is this curve moved flat by that much, on top of the scenario, with every other shock held. The middle column is the scenario itself.</Note></div>
      <div className="ph-flip" style={{ '--ph-n': lad.length + 1 }}>
        <div style={{ ...lRow, background: 'var(--panel)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ ...lbl, padding: '7px 0' }}>SHIFT</div>
          {lad.map(({ x, r }) => x === 0
            ? <div key={x} data-testid="scn-ladder-base" data-npv={r?.npv ?? ''} style={{ ...lCell, ...lbl, fontSize: 11, color: 'var(--text-hi)', ...mid(x) }}>scenario</div>
            : <div key={x} style={{ ...lCell, ...lbl, fontSize: 11 }}>{plus(x, 2)}bp</div>)}
        </div>
        <div style={lRow}><div style={{ ...lbl, padding: '7px 0' }}>NPV · {ccy}</div>{lad.map(({ x, r }) => <div key={x} data-ladder={x} data-npv={r?.npv ?? ''} style={{ ...lCell, color: tone(r?.npv), ...mid(x) }}>{fmt(r?.npv)}</div>)}</div>
        <div style={lRow}><div style={{ ...lbl, padding: '7px 0' }}>CHANGE</div>{lad.map(({ x, r }) => <div key={x} style={{ ...lCell, color: x === 0 ? 'var(--text-mute)' : tone(r?.npv == null || !all ? null : r.npv - all.npv), ...mid(x) }}>{x === 0 || r?.npv == null || !all ? '—' : signedChange(r.npv - all.npv)}</div>)}</div>
      </div>
    </div>
  )

  return (
    <div className="tbw-no-drag" style={{ fontFamily: 'var(--sans)' }} data-testid="scn-tab" data-busy={busy ? 'true' : 'false'}>
      <div className="xva-row" style={XVA_ROW}>
        {left}
        <div style={XVA_RIGHT}>
          <div style={{ padding: '10px 16px 6px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ ...secHdr, margin: 0 }}>{chartTitle}</span><Note inline>{chartSays}</Note>
              <span data-testid="scn-engine" style={{ fontSize: 11, color: 'var(--text-dim)', border: '1px solid var(--border-hi)', borderRadius: 'var(--r-1)', padding: '1px 7px', letterSpacing: '0.06em' }}>{busy ? 'REPRICING…' : 'FULL REVALUATION'}</span>
              <Note inline testId="scn-banner">Scenario: every figure is the pricing engine's own on the moved market, the same engine that prices the ticket. {booked ? 'A booked trade\'s scenario is of its terms as the ticket shows them, priced afresh; the value in the footer is the trade revalued as booked, and the two may differ.' : 'With nothing shocked it is the ticket\'s value.'} Nothing is saved.</Note>
            </div>
            {stale && <div data-testid="scn-stale" style={{ fontSize: 12, color: 'var(--amber)', padding: '0 0 6px' }}>The terms have changed since the ticket was priced: this is the scenario of the terms as priced. Price the ticket again.</div>}
            {selected}
            {error && <div data-testid="scn-error" style={{ fontSize: 12, color: 'var(--amber)', padding: '4px 0 6px' }}>The engine could not price this scenario: {error}</div>}
          </div>
          {results}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${option ? 4 : 3}, minmax(0, 1fr))`, gap: 8, padding: '10px 16px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
            <Tile label={`NPV · ${ccy}`} value={fmt(all?.npv)} color={tone(all?.npv)} sub={`at the market ${fmt(market?.npv)}`} testId="scn-npv" raw={all?.npv} />
            <Tile label={`CHANGE · ${ccy}`} value={signedChange(total)} color={tone(total)} testId="scn-change-total" raw={total} />
            <Tile label="IR01 · A BP" value={signedChange(all?.ir01)} sub={market?.ir01 == null ? undefined : `at the market ${signedChange(market.ir01)}`} testId="scn-ir01" raw={all?.ir01} />
            {option && <Tile label={bermudan ? 'σ · BP' : 'VOL · BP'} value={tradeVol == null ? '—' : (tradeVol + volShift).toFixed(1)} sub={tradeVol == null ? 'each leg at its own strike' : `at the market ${tradeVol.toFixed(1)}`} testId="scn-vol" raw={tradeVol == null ? '' : tradeVol + volShift} />}
          </div>
          {ladderBlock}
        </div>
      </div>
    </div>
  )
}
