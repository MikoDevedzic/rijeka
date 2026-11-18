// risk/RiskSettings.jsx — Configurations › MARKET RISK
//   /configurations/market-risk/limits   the firm's limits on any reported number (risk manager / admin write)
//   /configurations/market-risk/var      VaR settings and the risk-factor history
//   /configurations/market-risk/stress   the stress catalogue (read-only)
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSessionMaybe } from '../../lib/session'
import { curveRows, otherLimits, standardRows, parseSize, KIND_NAME } from './limits-page'
import { limitName } from './names'
import '../pnl/PnlPage.css'
import './RiskPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
async function api(path, opts = {}) {
  const s = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `${path} ${r.status}`)
  return j
}
const fmt = (n) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
const inp = { background: 'var(--panel)', border: '1px solid var(--fld-bd)', color: 'var(--text-hi)', fontFamily: 'var(--mono)', fontSize: '0.8rem', padding: '0.35rem 0.5rem', borderRadius: 2, width: '100%' }

export function LimitsPage() {
  const navigate = useNavigate()
  const [rep, setRep] = useState(null)
  const [meta, setMeta] = useState(null)
  const [form, setForm] = useState({ metric: 'VAR_99_1D', scope: 'ALL', scope_name: '', limit: '', warn_pct: 80, note: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => Promise.all([api('/api/risk/report'), api('/api/risk/metrics')]).then(([r, m]) => { setRep(r); setMeta(m) }).catch(e => setMsg(e.message))
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const add = async () => {
    setBusy(true); setMsg(null)
    try {
      await api('/api/risk/limits', { method: 'POST', body: JSON.stringify({ ...form, limit: Number(form.limit), warn_pct: Number(form.warn_pct), scope_name: form.scope === 'ALL' ? null : form.scope_name }) })
      setMsg('Limit set. It is evaluated on every book in the firm from the next report.'); setForm(f => ({ ...f, limit: '', note: '' })); await load()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  const remove = async (id) => { setBusy(true); try { await api(`/api/risk/limits/${id}`, { method: 'DELETE' }); await load() } catch (e) { setMsg(e.message) } finally { setBusy(false) } }
  // a curve's own limit, or a kind's standard size: one request, in which the API retires the one that stood there
  const put = async (metric, size, warn, said) => {
    setBusy(true); setMsg(null)
    try {
      await api('/api/risk/limits', { method: 'POST', body: JSON.stringify({ metric, scope: 'ALL', scope_name: null, limit: size, warn_pct: Number(warn) || 80, note: '' }) })
      setMsg(said); await load()
    } catch (e) { setMsg(e.message); await load().catch(() => {}) } finally { setBusy(false) }
  }
  const canWrite = rep?.can_write
  const scopeNames = form.scope === 'DESK' ? meta?.desks || [] : form.scope === 'BOOK' ? meta?.books || [] : []
  return (
    <div className="pnl">
      <div className="pnl-bar"><div className="pnl-title">RISK LIMITS <span className="pnl-sub">the firm's limits on any reported number · evaluated on every book</span></div>
        <div className="pnl-ctl"><button className="pnl-btn ghost" onClick={() => navigate('/risk')}>MARKET RISK →</button></div></div>
      {msg && <div className="pnl-toast">{msg}</div>}
      {!rep && !msg && <div className="pnl-empty">Loading…</div>}
      {rep && (<>
        <EveryCurve rep={rep} canWrite={canWrite} busy={busy} put={put} remove={remove} />
        <section className="pnl-panel">
          <header><span>OTHER LIMITS IN FORCE</span><span className="pnl-sub">VaR, stress, a tenor bucket, a desk or a book · utilisation on your book as of {rep.date}</span></header>
          <div className="rk-limits">
            {otherLimits(rep).map(l => (
              <div key={l.id} className={`rk-lim ${String(l.status).toLowerCase()}`} style={{ gridTemplateColumns: '1fr 10rem 9rem 7rem auto' }}>
                <span className="rk-lm" title={l.metric}>{limitName(l.metric, meta?.scenarios)}<small>{l.scope === 'ALL' ? 'book' : `${l.scope.toLowerCase()} ${l.scope_name}`} · warn at {l.warn_pct}% · set by {l.set_by || '—'}{l.note ? ` · ${l.note}` : ''}</small></span>
                <span className="rk-lbar"><i style={{ width: `${Math.min(100, l.utilisation_pct || 0)}%` }} /><s style={{ left: `${Math.min(100, l.warn_pct)}%` }} /></span>
                <span className="pnl-tv">{l.value == null ? '—' : fmt(l.value)} <small>/ {fmt(l.limit)}</small></span>
                <span className={`pnl-chip ${l.status === 'BREACH' ? 'red' : l.status === 'WARN' ? 'amber' : l.status === 'OK' ? 'ok' : ''}`}>{l.status === 'NA' ? 'N/A' : `${l.status} ${l.utilisation_pct != null ? `${l.utilisation_pct.toFixed(0)}%` : ''}`}</span>
                {canWrite ? <button className="pnl-btn ghost" disabled={busy} onClick={() => remove(l.id)}>REMOVE</button> : <span />}
              </div>
            ))}
            {!otherLimits(rep).length && <div className="pnl-empty">{rep.tables ? 'None set yet.' : 'Limits need the market risk tables: ask your administrator to apply the latest database migration.'}</div>}
          </div>
        </section>
        <section className="pnl-panel" style={{ maxWidth: 900 }}>
          <header><span>SET A LIMIT</span><span className="pnl-sub">{canWrite ? `your role: ${String(rep.role).toUpperCase()}` : 'needs the RISK or ADMIN role, or firm admin'}</span></header>
          <div className="pnl-cards" style={{ gridTemplateColumns: '2fr 1fr 1.4fr 1fr 1fr' }}>
            <label className="pnl-card"><span className="pnl-kl">METRIC</span>
              <select style={inp} value={form.metric} onChange={set('metric')}>{(meta?.metrics || []).map(m => <option key={m} value={m}>{limitName(m, meta?.scenarios)}</option>)}</select>
              <span className="pnl-note">{metricHelp(form.metric, meta)}</span></label>
            <label className="pnl-card"><span className="pnl-kl">SCOPE</span>
              <select style={inp} value={form.scope} onChange={set('scope')}><option value="ALL">BOOK TOTAL</option><option value="DESK">DESK</option><option value="BOOK">BOOK</option></select></label>
            <label className="pnl-card"><span className="pnl-kl">DESK / BOOK</span>
              <select style={inp} value={form.scope_name} onChange={set('scope_name')} disabled={form.scope === 'ALL'}><option value="">—</option>{scopeNames.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
            <label className="pnl-card"><span className="pnl-kl">LIMIT ({rep.reporting_ccy})</span><input style={inp} value={form.limit} onChange={set('limit')} placeholder="e.g. 250000" /></label>
            <label className="pnl-card"><span className="pnl-kl">WARN AT %</span><input style={inp} value={form.warn_pct} onChange={set('warn_pct')} /></label>
          </div>
          <input style={{ ...inp, marginTop: 6 }} value={form.note} onChange={set('note')} placeholder="Note for the record (why this limit, who asked)" />
          <div className="pnl-sign-btns"><button className="pnl-btn" disabled={busy || !canWrite || !form.limit} onClick={add}>SET LIMIT</button></div>
          <div className="pnl-foot">Limits apply to every book in the firm. VaR, expected shortfall and stress are book-level numbers: set them on BOOK TOTAL. Sensitivity and NPV limits can be set per desk or book. Utilisation is |value| / limit; a breach shows on the Market Risk page and in the home inbox after the daily run.</div>
        </section>
      </>)}
    </div>
  )
}

// A limit for every curve the book carries: its own, or the standard one for its kind. Typing a size and pressing SET
// gives the curve its own limit; STANDARD takes its own off again. Under it, the standard size of each kind.
function EveryCurve({ rep, canWrite, busy, put, remove }) {
  const rows = curveRows(rep), stds = standardRows(rep)
  const [typed, setTyped] = useState({})
  const val = (k) => typed[k] ?? ''
  const type = (k) => (e) => setTyped(t => ({ ...t, [k]: e.target.value }))
  const done = (k) => setTyped(t => ({ ...t, [k]: '' }))
  return (
    <section className="pnl-panel" data-testid="every-curve">
      <header><span>A LIMIT FOR EVERY CURVE</span><span className="pnl-sub">its own, or the standard one for its kind · one number on the size, long or short</span></header>
      <div className="pnl-foot rk-ehow">Every curve, asset, volatility surface and forward basis the book carries has a limit from its first trade. A STANDARD limit is a round figure to start from, not a view of what the desk should run: type a size and press SET to give a curve its own; STANDARD takes its own off again.</div>
      {!rows.length && <div className="pnl-empty">The book carries no risk on a curve yet. A curve's limit is here from its first trade.</div>}
      {rows.length > 0 && (
        <table className="rk-every">
          <thead><tr><th>CURVE</th><th className="r">POSITION</th><th className="r">LIMIT</th><th /><th>USED</th><th className="r">ITS OWN LIMIT</th><th /></tr></thead>
          <tbody>
            {rows.map(r => {
              const size = parseSize(val(r.metric))
              return (
                <tr key={r.metric} data-metric={r.metric} className={String(r.status).toLowerCase()}>
                  <td>{r.name} <small>{r.measure} · {r.unit}</small></td>
                  <td className="fig r">{r.value == null ? '—' : fmt(r.value)}</td>
                  <td className="fig r">{fmt(r.limit)}</td>
                  <td><span className={`pnl-chip ${r.standard ? 'rk-chip-std' : 'rk-chip-own'}`}>{r.standard ? 'STANDARD' : 'ITS OWN'}</span></td>
                  <td><span className="rk-ebar"><i style={{ width: `${Math.min(100, r.used || 0)}%` }} /><s style={{ left: `${Math.min(100, r.warn_pct)}%` }} /></span><b className="fig">{r.used == null ? '—' : `${Math.round(r.used)}%`}</b></td>
                  <td className="r"><input className="rk-ein" inputMode="decimal" aria-label={`A limit of its own for ${r.name} ${r.measure}`} placeholder={r.standard ? 'none' : fmt(r.limit)} value={val(r.metric)} onChange={type(r.metric)} disabled={!canWrite} /></td>
                  <td className="rk-eact">
                    <button className="pnl-btn" disabled={busy || !canWrite || !size} onClick={() => put(r.metric, size, r.warn_pct, `${r.name} ${r.measure} is limited at ${fmt(size)}.`).then(() => done(r.metric))}>SET</button>
                    {!r.standard && <button className="pnl-btn ghost" disabled={busy || !canWrite} onClick={() => remove(r.id)}>STANDARD</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="rk-std" data-testid="standard-sizes">
        <span className="pnl-kl">THE STANDARD SIZE OF EACH KIND</span>
        {stds.map(s => {
          const k = `STANDARD:${s.kind}`, size = parseSize(val(k))
          return (
            <label key={s.kind} data-kind={s.kind}>
              <span>{KIND_NAME[s.kind]} <small>{s.unit}</small></span>
              <b className="fig">{fmt(s.limit)}</b>
              <span className={`pnl-chip ${s.built_in ? 'rk-chip-std' : 'rk-chip-own'}`}>{s.built_in ? 'AS SHIPPED' : `SET BY ${String(s.set_by || 'THE FIRM').toUpperCase()}`}</span>
              <input className="rk-ein" inputMode="decimal" aria-label={`The standard size for ${KIND_NAME[s.kind]}`} placeholder={fmt(s.limit)} value={val(k)} onChange={type(k)} disabled={!canWrite} />
              <button className="pnl-btn" disabled={busy || !canWrite || !size} onClick={() => put(k, size, s.warn_pct, `The standard size is ${fmt(size)} for ${KIND_NAME[s.kind].toLowerCase()}.`).then(() => done(k))}>SET</button>
              {!s.built_in && <button className="pnl-btn ghost" disabled={busy || !canWrite} onClick={() => remove(s.id)}>AS SHIPPED</button>}
            </label>
          )
        })}
        <div className="pnl-foot">The sizes as shipped are round figures to start from, not a view of what a desk should run: set your own. A curve's own limit always takes the standard one's place. The share used is |position| / limit, in whole percent; a warning is raised from 80% of a size as shipped.</div>
      </div>
    </section>
  )
}

function metricHelp(m, meta) {
  if (!meta) return ''
  const h = meta.help || {}
  if (m.startsWith('IR01:')) return h['IR01:<curve>']
  if (m.startsWith('KR01:')) return h['KR01:<curve>:<bucket>']
  if (m.startsWith('SPOT01:')) return h['SPOT01:<asset>']
  if (m.startsWith('VEGA:')) return m.split(':').length > 2 ? h['VEGA:<surface>:<bucket>'] : h['VEGA:<surface>']
  if (m.startsWith('CRYBASIS01:')) return h['CRYBASIS01:<curve>']
  if (m.startsWith('STANDARD:')) return h['STANDARD:<kind>']
  if (m.startsWith('STRESS:')) return `${h['STRESS:<scenario>']}: ${(meta.scenarios || []).find(s => s.id === m.slice(7))?.name || ''}`
  if (m.startsWith('PFE_PEAK:')) return h['PFE_PEAK:<counterparty>']
  if (m.startsWith('PFE:')) return h['PFE:<counterparty>:<bucket>']
  if (m.startsWith('EPE:')) return h['EPE:<counterparty>']
  if (m.startsWith('CVA:')) return h['CVA:<counterparty>']
  if (m.startsWith('CE:')) return h['CE:<counterparty>']
  return h[m] || ''
}

function backfillSummary(r) {
  if (!r) return 'Backfill finished.'
  const list = (o) => Object.entries(o || {}).map(([k, v]) => `${k} ${v}`).join(', ')
  const kept = list(r.kept_own), replaced = list(r.replaced_own)
  return `Backfill finished, ${r.start} to ${r.end}. Rows written: ${list(r.written) || 'none'}.`
    + (kept ? ` Kept as they are, the desk's own rows: ${kept}.` : '')
    + (replaced ? ` The desk's own rows replaced: ${replaced}.` : '')
}

export function VarSettingsPage() {
  const navigate = useNavigate()
  const [s, setS] = useState(null)
  const [hist, setHist] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)          // the second step of REPLACE: nothing is replaced on one press
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const load = () => Promise.all([api('/api/risk/settings'), api('/api/risk/history')]).then(([a, b]) => { setS(a); setHist(b) }).catch(e => setMsg(e.message))
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setS(x => ({ ...x, [k]: e.target.value }))
  const save = async () => {
    setBusy(true); setMsg(null)
    try { await api('/api/risk/settings', { method: 'PUT', body: JSON.stringify({ confidence: Number(s.confidence), secondary_confidence: Number(s.secondary_confidence), horizon_days: Number(s.horizon_days), window_days: Number(s.window_days), min_observations: Number(s.min_observations), var_method: s.var_method, ccr_sampling: s.ccr_sampling, ccr_paths: Number(s.ccr_paths), ccr_drift: s.ccr_drift }) }); setMsg('Saved for the firm.'); await load() }
    catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  // The backfill runs in the background on the server: the page asks every few seconds until it has finished and
  // then says what was written and what was kept (it used to read the "started" answer as the result, and said nothing).
  const watch = async (before) => {
    for (let i = 0; i < 240 && alive.current; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const h = await api('/api/risk/history')
      if (!alive.current) return
      setHist(h)
      const b = h.backfill || {}
      if (!b.running && !b.queued && b.finished && b.finished !== before) { setMsg(b.error ? `Backfill failed: ${b.error}` : backfillSummary(b.result)); return }
    }
  }
  const backfill = async (replaceOwn = false) => {
    setBusy(true); setArmed(false); setMsg('Making the rates history from the generator and fetching spots from frankfurter and Coinbase… this takes a minute or two. The result appears here.')
    try {
      const before = hist?.backfill?.finished || null
      const j = await api(`/api/risk/history/backfill?years=2${replaceOwn ? '&replace_own=true' : ''}`, { method: 'POST' })
      if (j.started === false) setMsg(`Not started: ${j.reason || 'a backfill is already running'}.`)
      else await watch(before)
    }
    catch (e) { setMsg(e.message) } finally { if (alive.current) setBusy(false) }
  }
  const series = Object.entries(hist?.series || {})
  const own = series.filter(([, x]) => x.own > 0)
  const ownRows = own.reduce((n, [, x]) => n + x.own, 0)
  return (
    <div className="pnl">
      <div className="pnl-bar"><div className="pnl-title">VAR SETTINGS <span className="pnl-sub">historical simulation · the firm's parameters and methods</span></div>
        <div className="pnl-ctl"><button className="pnl-btn ghost" onClick={() => navigate('/risk')}>MARKET RISK →</button></div></div>
      {msg && <div className="pnl-toast">{msg}</div>}
      {s && (<>
        <section className="pnl-panel" style={{ maxWidth: 980 }}>
          <header><span>PARAMETERS</span><span className="pnl-sub">{s.stored ? `stored · updated by ${s.updated_by || '—'}` : 'defaults · not yet stored'}{s.can_write ? '' : ' · read-only for your role'}</span></header>
          <div className="pnl-cards" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
            {[['confidence', 'CONFIDENCE', '0.99'], ['secondary_confidence', 'SECONDARY', '0.95'], ['horizon_days', 'HORIZON (DAYS)', '1'], ['window_days', 'WINDOW (DAYS)', '730'], ['min_observations', 'MIN OBSERVATIONS', '60']].map(([k, l, ph]) => (
              <label key={k} className="pnl-card"><span className="pnl-kl">{l}</span><input style={inp} value={s[k] ?? ''} placeholder={ph} onChange={set(k)} disabled={!s.can_write} /></label>))}
          </div>
          <div className="rk-h" style={{ marginTop: '0.9rem' }}>METHODS</div>
          <div className="pnl-cards" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            <label className="pnl-card"><span className="pnl-kl">VAR METHOD</span>
              <select style={inp} value={s.var_method || 'FULL_REVAL'} onChange={set('var_method')} disabled={!s.can_write}>
                <option value="FULL_REVAL">Full revaluation</option><option value="LADDER">Ladder (linear)</option></select></label>
            <label className="pnl-card"><span className="pnl-kl">EXPOSURE SAMPLING</span>
              <select style={inp} value={s.ccr_sampling || 'HISTORICAL'} onChange={set('ccr_sampling')} disabled={!s.can_write}>
                <option value="HISTORICAL">Historical (blocks of observed changes)</option><option value="GAUSSIAN">Gaussian (correlated normal shocks)</option></select></label>
            <label className="pnl-card"><span className="pnl-kl">EXPOSURE PATHS</span><input style={inp} value={s.ccr_paths ?? ''} placeholder="2000" onChange={set('ccr_paths')} disabled={!s.can_write} /></label>
            <label className="pnl-card"><span className="pnl-kl">EXPOSURE DRIFT</span>
              <select style={inp} value={s.ccr_drift || 'zero'} onChange={set('ccr_drift')} disabled={!s.can_write}>
                <option value="zero">Zero (rates and spots stay put in expectation)</option><option value="historical">Historical (the window's drift)</option></select></label>
          </div>
          <div className="pnl-sign-btns"><button className="pnl-btn" disabled={busy || !s.can_write || !s.tables} onClick={save}>SAVE FOR THE FIRM</button></div>
          <div className="pnl-foot">VaR is the empirical loss quantile over the window; expected shortfall is the mean loss beyond it; the horizon scales by √t. <b>Full revaluation</b> reprices every live trade on each historical day's shifted market, so convexity and the curve shape inside a bucket are in the number; the ladder VaR is computed alongside as the linear comparison. <b>Ladder</b> applies the day's changes to the key-rate sensitivities: fast, linear in the factors. Exposure sampling drives the counterparty credit run: <b>historical</b> builds each monthly step from a block of observed daily changes, the same block for every factor, keeping the window's fat tails and co-movements; <b>Gaussian</b> draws correlated normal shocks. {!s.tables && <em>Settings need the market risk tables: ask your administrator to apply the latest database migration; the defaults apply until then.</em>}</div>
        </section>
        <section className="pnl-panel" style={{ maxWidth: 980 }}>
          <header><span>RISK-FACTOR HISTORY</span><span className="pnl-sub">synthetic rates history and public spots, stored on the template account, extended by the daily rebuild</span></header>
          <div className="rk-rows">
            {series.map(([cid, x]) => <div key={cid} className="rk-row" style={{ gridTemplateColumns: '12rem 1fr 1fr 1fr 1.6fr' }}><span className="rk-ref">{cid}</span><span className="pnl-tv">{x.observations} obs</span><span className="pnl-tv dim">{x.from}</span><span className="pnl-tv dim">{x.to}</span><span className="pnl-tv dim" data-own={cid}>{x.own > 0 ? `${x.own} entered by this desk` : ''}</span></div>)}
            {!series.length && <div className="pnl-empty">No history stored yet.</div>}
          </div>
          <div className="pnl-sign-btns"><button className="pnl-btn" disabled={busy || !s.can_write} onClick={() => backfill(false)}>BACKFILL TWO YEARS</button><span className="pnl-note">Every stored day of the rates history is made again by the synthetic generator (no publisher's data), except in a curve this desk has entered rows of its own for, which is left as it is. Spots are fetched from ECB reference FX rates (frankfurter) and Coinbase daily closes; a spot's existing days are kept.</span></div>
          {ownRows > 0 && (
            <div className="pnl-sign-btns" data-own-rows>
              {!armed
                ? <button className="pnl-btn ghost" disabled={busy || !s.can_write} onClick={() => setArmed(true)}>REPLACE THE DESK'S OWN RATES ROWS…</button>
                : <><button className="pnl-btn" disabled={busy || !s.can_write} onClick={() => backfill(true)}>REPLACE {ownRows} ROWS WITH THE SYNTHETIC MARKET</button><button className="pnl-btn ghost" disabled={busy} onClick={() => setArmed(false)}>CANCEL</button></>}
              <span className="pnl-note">{own.map(([cid, x]) => `${cid} ${x.own}`).join(', ')}: rows entered by hand, imported or snapped from a feed. A backfill keeps these curves as they are, so their history is not the synthetic market's. Replacing them writes the generator's curve over every stored day of the five rates curves; the entered rows are not kept anywhere.</span>
            </div>)}
        </section>
      </>)}
    </div>
  )
}

export function StressCatalogue() {
  const [rep, setRep] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { api('/api/risk/metrics').then(setRep).catch(e => setErr(e.message)) }, [])
  return (
    <div className="pnl">
      <div className="pnl-bar"><div className="pnl-title">STRESS SCENARIOS <span className="pnl-sub">the catalogue · full revaluation on the shifted market · read-only</span></div></div>
      {err && <div className="pnl-err">{err}</div>}
      <section className="pnl-panel" style={{ maxWidth: 900 }}>
        <header><span>CATALOGUE</span><span className="pnl-sub">{rep ? `${rep.scenarios.length} scenarios` : ''}</span></header>
        <div className="rk-rows">{(rep?.scenarios || []).map(s => <div key={s.id} className="rk-row" style={{ gridTemplateColumns: '14rem 1fr' }}><span className="rk-ref">{s.id}</span><span>{s.name}</span></div>)}</div>
        <div className="pnl-foot">Rates scenarios shift every curve's quotes in basis points, parallel or by tenor bucket; FX scenarios move the non-USD asset by a percentage (a USD-first quote moves the other way); digital assets likewise. Each scenario reprices every live trade in full. A limit can be set on any scenario's loss (STRESS:&lt;id&gt;). Editable scenarios are next.</div>
      </section>
    </div>
  )
}
