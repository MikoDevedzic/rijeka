// FX & DIGITAL ASSETS — the same shell as Rate curves: a sidebar of pairs
// grouped by market, a detail pane with header, pills and inner tabs. Each
// pair shows its spot, its forward-point curve by tenor (editable, with the
// parity points and the basis beside every quoted point), and its
// conventions. Points are saved as {PAIR}_FWD snapshots: manual, Bloomberg
// snap, or import, like any rates curve.
import { useCallback, useEffect, useState } from 'react'
import { sourceKind, sourceShort, sourceWord, isVenue, pricedFromWords, baseRateWords } from './fx-source'
import useMarketDataStore from '../../store/useMarketDataStore'
import { InnerTabs, InnerBody, ParamGrid, SectionLabel, DescBox } from './_DetailShared'
import RateCurveCanvas from './RateCurveCanvas'
import FixingsPanel from './FixingsPanel'
import { getSessionMaybe } from '../../lib/session'
import { T as THEME } from '../../theme'
import { surfaceTenors } from '../trade-window/fx-vol'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const FLAG = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CHF: '🇨🇭', AUD: '🇦🇺', CAD: '🇨🇦', BTC: '₿', ETH: 'Ξ', SOL: '◎' }
const NAME = { EURUSD: 'Euro / US dollar', GBPUSD: 'Sterling / US dollar', AUDUSD: 'Australian dollar / US dollar', USDJPY: 'US dollar / Japanese yen',
  USDCHF: 'US dollar / Swiss franc', USDCAD: 'US dollar / Canadian dollar', BTCUSD: 'Bitcoin / US dollar', ETHUSD: 'Ether / US dollar', SOLUSD: 'Solana / US dollar' }
const GROUPS = [
  { key: 'G10', flag: '🌐', label: 'G10 FX', pairs: ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDJPY', 'USDCHF', 'USDCAD'] },
  { key: 'DA', flag: '⛓', label: 'DIGITAL ASSETS', pairs: ['BTCUSD', 'ETHUSD', 'SOLUSD'] },
]
// the forwards page's tenors, to ten years since 0.22.0 (pricing/forward_points.py TENOR_DAYS)
const TENOR_DAYS = { '1W': 7, '2W': 14, '1M': 30, '2M': 61, '3M': 91, '6M': 182, '9M': 273, '1Y': 365, '18M': 547, '2Y': 730, '3Y': 1095, '4Y': 1460, '5Y': 1825, '7Y': 2555, '10Y': 3650 }
const CRYPTO = ['BTC', 'ETH', 'SOL']
const dp = (pair) => CRYPTO.includes(pair.slice(0, 3)) ? 2 : pair === 'USDJPY' ? 3 : 5
const fmt = (n, d = 2) => n == null || isNaN(n) ? '—' : (Number(Number(n).toFixed(d)) === 0 ? 0 : Number(n)).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
// saved points as the page shows them: at least the pair's decimals for points (two for a digital asset, one for pips),
// and every decimal that was saved, so a figure is never rounded by being looked at
const shownPoints = (v, crypto) => { const s = String(v); const d = (s.split('.')[1] || '').length; return Number(v).toFixed(Math.max(d, crypto ? 2 : 1)) }
const iso = (d) => d.toISOString().slice(0, 10)

async function call(path, opts = {}) {
  const session = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
  const body = await r.json().catch(() => ({}))
  // the status goes with the error: a caller may need to tell a 409 (the instance cannot do it yet) from a refused entry
  if (!r.ok) throw Object.assign(new Error(body?.detail ? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)) : `${r.status}`), { status: r.status })
  return body
}

// One word in the cell (the whole source wrapped to four lines and stretched every row); the whole source on hover.
function SourceBadge({ src }) {
  const map = { BLOOMBERG: 'p-blue', IMPORT: 'p-purple', MANUAL: 'p-dim', FEED: 'p-green', PARITY: 'p-amber' }
  const kind = src === 'PARITY' ? 'PARITY' : sourceKind(src)
  return <span className={`pill ${map[kind] || 'p-dim'}`} style={{ whiteSpace: 'nowrap' }} title={src || ''}>{kind}</span>
}

export default function FxWorkspace() {
  const [md, setMd] = useState(null)
  const [sel, setSel] = useState('EURUSD')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState({ G10: true, DA: true })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState('')
  const [bbg, setBbg] = useState(null)
  const { setInnerTab } = useMarketDataStore()

  const flash = (kind, text) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 7000) }
  const load = useCallback(async () => {
    const m = await call('/api/currency/pairs'); setMd(m)
    if (bbg === null) { try { const st = await call('/api/bloomberg/status'); setBbg({ available: !!st?.connected, error: st?.error || '' }) } catch { setBbg({ available: false }) } }
  }, [bbg])
  // load() writes state only after its awaits; the lint rule cannot see past the call and flags it anyway.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(e => flash('err', e.message)) }, [load])
  useEffect(() => { setInnerTab('points') }, [sel])   // eslint-disable-line react-hooks/exhaustive-deps

  const pairs = md?.pairs || []
  const cur = pairs.find(p => p.pair === sel)
  const flt = search.toUpperCase()
  const visible = (p) => (filter === 'all' || (filter === 'CRYPTO') === !!p.crypto) && (!flt || p.pair.includes(flt) || (NAME[p.pair] || '').toUpperCase().includes(flt))

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div className="crv-sidebar">
        <div className="sb-top">
          <div className="sb-search"><input type="text" placeholder="Search pairs…" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="sb-filters">
            {['all', 'FX', 'CRYPTO'].map(f => <button key={f} className={`sf${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'FX' ? 'FX' : 'Digital'}</button>)}
          </div>
        </div>
        <div className="sb-stats">{pairs.filter(visible).length} pairs · forwards {md?.forward_mode === 'IMPLIED' ? 'implied from yields' : 'off quoted points'}</div>
        <div className="sb-list">
          {GROUPS.map(g => {
            const items = g.pairs.map(k => pairs.find(p => p.pair === k)).filter(Boolean).filter(visible)
            if (!items.length) return null
            return (
              <div key={g.key} className={`ccy-group${open[g.key] ? ' open' : ''}`}>
                <div className="ccy-hdr" onClick={() => setOpen(o => ({ ...o, [g.key]: !o[g.key] }))}>
                  <span className="ccy-flag">{g.flag}</span><span className="ccy-lbl">{g.label}</span><span className="ccy-count">{items.length}</span><span className="ccy-chevron">▶</span>
                </div>
                <div className="ccy-items">
                  {items.map(p => (
                    <div key={p.pair} className={`crv-item${sel === p.pair ? ' sel' : ''}`} style={{ borderLeftColor: sel === p.pair ? 'var(--accent)' : 'transparent' }} onClick={() => setSel(p.pair)}>
                      <span className={`type-badge ${p.forward_curve ? (p.crypto ? 'tb-funding' : 'tb-ois') : 'tb-basis'}`}>{p.forward_curve ? 'FWD' : 'SPOT'}</span>
                      <div className="ci-body"><div className="ci-name">{p.pair}</div><div className="ci-sub">{p.forward_curve ? `${sourceWord(p.forward_curve)} · ${p.forward_curve.tenors.length} tenors` : p.crypto ? `${baseRateWords(p, md?.forward_mode)} · no forward curve` : 'no forward curve'}</div></div>
                      <div className={`ci-val ${p.crypto ? 'am' : 'ac'}`}>{fmt(p.spot, dp(p.pair))}</div>
                    </div>))}
                </div>
              </div>)
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {msg && <div style={{ margin: '8px 14px 0', padding: '7px 10px', borderRadius: 4, fontSize: '12px', border: '1px solid', color: msg.kind === 'ok' ? 'var(--up)' : 'var(--red)', borderColor: msg.kind === 'ok' ? 'var(--border-hi)' : 'rgba(240,130,140,.4)', background: msg.kind === 'ok' ? 'transparent' : 'rgba(240,130,140,.08)' }}>{msg.text}</div>}
        {cur ? <PairDetail p={cur} md={md} reload={load} flash={flash} busy={busy} setBusy={setBusy} bbg={bbg} />
             : <div className="empty-state"><div className="empty-icon">⟨/⟩</div><div className="empty-title">Select a pair</div><div className="empty-sub">{pairs.length} pairs — 6 G10 · 3 digital assets</div></div>}
      </div>
    </div>
  )
}

// Outright forward by tenor: the quoted curve (spot + points) as a line, what the pricer implies where nothing is
// quoted (beyond the last tenor that is on) dashed from the last quote, and parity behind both.
function FxForwardChart({ p, tenors, pts, off, parity }) {
  const yrs = t => (TENOR_DAYS[t] || 0) / 365
  const isOn = t => !isNaN(parseFloat(pts[t])) && !off[t]
  const quoted = tenors.map(t => (p.spot != null && isOn(t) ? { t: yrs(t), v: p.spot + parseFloat(pts[t]) * p.pip } : null)).filter(Boolean)
  const lastOn = quoted.length ? quoted[quoted.length - 1] : null
  const implied = tenors.map(t => (!isOn(t) && parity[t]?.forward != null && (!lastOn || yrs(t) > lastOn.t) ? { t: yrs(t), v: parity[t].forward } : null)).filter(Boolean)
  const par = tenors.map(t => parity[t]?.implied_forward != null ? { t: yrs(t), v: parity[t].implied_forward } : null).filter(Boolean)
  if (p.spot == null || quoted.length + par.length < 2) return null
  const series = []
  if (quoted.length >= 1) series.push({ label: 'QUOTED', color: THEME.accent, points: [{ t: 0, v: p.spot }, ...quoted] })
  if (quoted.length >= 1 && implied.length >= 1) series.push({ label: 'IMPLIED', color: THEME.amber, dash: [2, 3], points: [lastOn, ...implied] })
  if (par.length >= 1) series.push({ label: 'PARITY', color: THEME.blue, dash: [5, 3], points: [{ t: 0, v: p.spot }, ...par] })
  return (
    <div style={{ margin: '8px 0 12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 2, padding: 8 }}>
      <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 5 }}>
        {p.pair} · OUTRIGHT FORWARD BY TENOR{p.crypto ? ' (USD)' : ''}
      </div>
      <RateCurveCanvas series={series} unit="" decimals={dp(p.pair)} height={170} />
    </div>
  )
}

function PairDetail({ p, md, reload, flash, busy, setBusy, bbg }) {
  const pair = p.pair
  const [pts, setPts] = useState({})
  const [off, setOff] = useState({})           // tenor -> true: its points are kept on the row and not used as a quote
  const [parity, setParity] = useState({})     // tenor -> the pricer's answer at that tenor: parity, the forward it uses, how it reached it
  const [spotIn, setSpotIn] = useState('')
  const [askFeed, setAskFeed] = useState(false)     // the second step of USE THE FEED'S FORWARDS
  const [fund, setFund] = useState('')
  const [flat, setFlat] = useState('')
  const innerTab = useMarketDataStore(s => s.innerTab)
  // option vols: ATM / 25Δ risk reversal / 25Δ butterfly by tenor, in vol points. The rows are the standard eight
  // tenors and every tenor the stored surface has (a venue's digital-asset surface also quotes 2W and 3W), in time
  // order. The save sends every row with an ATM, and the saved snapshot holds only what is sent, so a stored tenor
  // left off the grid would be dropped by a save without the user having touched it.
  const VOL_TENORS = surfaceTenors(p.vol_surface?.tenors)
  const [vols, setVols] = useState({})
  useEffect(() => { setVols(p.vol_surface?.grid ? JSON.parse(JSON.stringify(p.vol_surface.grid)) : {}) }, [pair, p.vol_surface?.valuation_date])   // eslint-disable-line react-hooks/exhaustive-deps
  const setVol = (tn, k, v) => setVols(g => ({ ...g, [tn]: { ...(g[tn] || {}), [k]: v } }))
  const saveVols = async () => {
    const grid = {}
    for (const tn of VOL_TENORS) {
      const row = vols[tn] || {}; const atm = parseFloat(row.ATM)
      if (isNaN(atm)) continue
      grid[tn] = { ATM: atm }
      for (const k of ['RR25', 'BF25']) { const n = parseFloat(row[k]); if (!isNaN(n)) grid[tn][k] = n }
    }
    if (Object.keys(grid).length < 2) return flash('err', 'Enter an ATM vol at two tenors or more')
    setBusy('vols')
    try { await call('/api/currency/vol-surface', { method: 'POST', body: JSON.stringify({ pair, grid, source: 'MANUAL' }) }); flash('ok', `${pair} vol surface saved`); await reload() }
    catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const tenors = md?.forward_tenors || Object.keys(TENOR_DAYS)

  const savedCurve = JSON.stringify([p.forward_points || null, p.forward_points_off || null])     // what the pricer's answers below were made on
  useEffect(() => {
    setPts(Object.fromEntries(Object.entries({ ...(p.forward_points || {}), ...(p.forward_points_off || {}) }).map(([t, v]) => [t, shownPoints(v, p.crypto)])))
    setOff(Object.fromEntries(Object.keys(p.forward_points_off || {}).map(t => [t, true])))
  }, [pair, savedCurve])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSpotIn(''); setAskFeed(false); setFund(p.funding_pct ?? ''); setFlat(p.base_flat_pct ?? '') }, [pair, p.forward_curve?.valuation_date, p.spot_as_of])   // eslint-disable-line react-hooks/exhaustive-deps

  // parity points per tenor from the pricer (one call per tenor, in parallel)
  useEffect(() => {
    let dead = false
    if (!p.spot) { setParity({}); return }
    const today = new Date()
    Promise.all(tenors.map(async t => {
      const d = new Date(today); d.setDate(d.getDate() + TENOR_DAYS[t])
      try { const q = await call('/api/currency/forward/price', { method: 'POST', body: JSON.stringify({ pair, base_notional: 1, settlement_date: iso(d) }) }); return [t, q] }
      catch { return [t, null] }
    })).then(rows => { if (!dead) setParity(Object.fromEntries(rows)) })
    return () => { dead = true }
  }, [pair, p.spot, p.forward_curve?.valuation_date, md?.forward_mode, savedCurve])   // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (source = 'MANUAL', points = pts, spot) => {
    const clean = {}; Object.entries(points).forEach(([t, v]) => { const n = parseFloat(v); if (!isNaN(n)) clean[t] = n })
    const offNow = Object.keys(clean).filter(t => off[t])
    if (Object.keys(clean).length - offNow.length < 2) return flash('err', 'Enter points for at least two tenors, and leave at least two switched on')
    setBusy('save')
    try { await call('/api/currency/forward-curve', { method: 'POST', body: JSON.stringify({ pair, points: clean, off: offNow, source, ...(spot ? { spot } : {}) }) }); flash('ok', `${pair} forward curve saved (${source})${offNow.length ? `, ${offNow.join(', ')} switched off` : ''}`); await reload() }
    catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const snapBbg = async () => {
    setBusy('bbg')
    try {
      const tk = await call(`/bloomberg/tickers/${pair}_FWD`)
      const tickers = Object.entries(tk.tickers || {}).map(([tenor, ticker]) => ({ tenor, ticker }))
      const r = await call('/api/bloomberg/snap', { method: 'POST', body: JSON.stringify({ curve_id: `${pair}_FWD`, snap_date: iso(new Date()), tickers, mode: 'live' }) })
      const got = {}; let spot
      ;(r.quotes || []).forEach(q => { if (q.tenor === 'SPOT') spot = q.rate; else if (q.rate != null) got[q.tenor] = q.rate })
      setPts(got); await save('BLOOMBERG', got, spot)
    } catch (e) { flash('err', e.message); setBusy('') }
  }
  const snapSpot = async () => {
    setBusy('spot')
    try { const r = await call('/api/currency/spot/snap', { method: 'POST' }); flash('ok', `Spot refreshed for ${r.saved} pairs from the public feeds`); await reload() }
    catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const setMode = async (mode) => {
    setBusy('mode')
    try { await call('/api/currency/forward-mode', { method: 'POST', body: JSON.stringify({ mode }) }); await reload() } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const saveFunding = async () => {
    const v = parseFloat(fund); if (isNaN(v)) return flash('err', `Enter the ${p.base} rate in % p.a.`)
    setBusy('fund')
    try { await call('/api/crypto/funding', { method: 'POST', body: JSON.stringify({ digital_asset: p.base, rate_pct: v }) }); flash('ok', `${p.base} rate set to ${v} %`); await reload() } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const saveFlat = async () => {
    const v = parseFloat(flat); if (isNaN(v)) return flash('err', 'Enter a flat rate in % p.a.')
    setBusy('flat')
    try { await call('/api/currency/flat', { method: 'POST', body: JSON.stringify({ currency: p.base, rate_pct: v }) }); flash('ok', `${p.base} fallback rate set to ${v}%`); await reload() } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  // A digital-asset pair whose forward points are this account's own entry, not a feed's: the way back to the feed.
  const ownPoints = p.crypto && p.forward_curve && !String(p.forward_curve.source || '').startsWith('DEMO')
  const backToFeed = async () => {
    setBusy('feed')
    try {
      const r = await call('/api/currency/forward-curve/use-feed', { method: 'POST', body: JSON.stringify({ pair }) })
      flash('ok', r.handed_back ? `${pair} is back on the feed. The venue's forwards replace your saved points at the next refresh, within ten minutes` : `${pair} was already on the feed`)
      setAskFeed(false); await reload()
    } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const saveSpotManual = async () => {
    const v = parseFloat(spotIn); if (isNaN(v) || v <= 0) return flash('err', 'Enter a spot')
    const clean = {}; Object.entries(pts).forEach(([t, x]) => { const n = parseFloat(x); if (!isNaN(n)) clean[t] = n })
    if (Object.keys(clean).length < 2) { Object.assign(clean, { '1M': 0, '3M': 0 }) }
    const src = String(p.forward_curve?.source || 'MANUAL').toUpperCase()
    if (!['MANUAL', 'BLOOMBERG', 'IMPORT'].includes(src)) {
      // the points come from a feed: the desk's spot is saved on its own, and the feed's points are not re-saved as the desk's
      setBusy('save')
      try { await call('/api/currency/forward-curve', { method: 'POST', body: JSON.stringify({ pair, points: {}, source: 'MANUAL', spot: v }) }); flash('ok', `${pair} desk spot saved`); await reload() }
      catch (e) { flash('err', e.message) } finally { setBusy('') }
      return
    }
    await save(src, clean, v)
  }

  // a tab's count is said for what it is (a bare "8" beside Volatility read as anything)
  const withTenors = (label, n) => (n != null ? `${label} · ${n} ${n === 1 ? 'tenor' : 'tenors'}` : label)
  const tabs = [{ id: 'points', label: withTenors(p.crypto ? 'Forward points (USD)' : 'Forward points', p.forward_curve?.tenors?.length) },
                { id: 'vols', label: withTenors('Volatility', p.vol_surface?.tenors?.length) },
                { id: 'spot', label: p.crypto ? `Spot & ${p.base} rate` : 'Spot' }, { id: 'conv', label: 'Conventions' }]
  // Fixings: digital assets only, and only when the API lists the pair's settlement sources (an older API has no fixings route)
  const hasFixings = !!p.crypto && Array.isArray(p.fixing_sources)
  if (hasFixings) tabs.splice(3, 0, { id: 'fixings', label: 'Fixings' })
  const mode = md?.forward_mode || 'MARKET'
  const thL = { fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '.08em', padding: '4px 6px 6px 0', borderBottom: '1px solid var(--border)', textAlign: 'left' }
  const thR = { ...thL, textAlign: 'right' }
  // a cell of the tables below: a figure, a tenor or a count, set as every figure is (index.css, "Figures")
  const td = { fontFamily: 'var(--mono)', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: 'var(--text)', padding: '5px 6px 5px 0', borderBottom: '1px solid var(--panel-2)' }
  const tdR = { ...td, textAlign: 'right' }

  const volsPanel = (
    <div>
      <DescBox>
        Option vols as the market quotes them, in vol points per year: the at-the-money vol, the 25-delta risk reversal (σ<sub>25Δ call</sub> − σ<sub>25Δ put</sub>) and the 25-delta butterfly ((σ<sub>25Δ call</sub> + σ<sub>25Δ put</sub>)/2 − ATM).
        The pricer builds the smile at a strike from these three with a quadratic in the call's forward delta (Malz) and interpolates each quote linearly in time; the ticket shows which tier it used.
        {p.vol_surface ? <> Saved surface: <b>{p.vol_surface.source}</b> · {p.vol_surface.valuation_date} · {p.vol_surface.tenors.length} tenors.</> : <> No surface saved: options price off a flat desk default and say so.</>}
      </DescBox>
      <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 1fr 1fr 1fr', minWidth: 560 }}>
        <div style={thL}>TENOR</div><div style={thR}>ATM %</div><div style={thR}>RR 25Δ</div><div style={thR}>BF 25Δ</div><div style={thR}>σ 25Δ PUT</div><div style={thR}>σ 25Δ CALL</div>
        {VOL_TENORS.map(tn => {
          const row = vols[tn] || {}; const atm = parseFloat(row.ATM); const rr = parseFloat(row.RR25) || 0; const bf = parseFloat(row.BF25) || 0
          const ok = !isNaN(atm)
          return [
            <div key={tn + 'a'} style={td}>{tn}</div>,
            <div key={tn + 'b'} style={tdR}><input className="inp" inputMode="decimal" style={{ width: 70, textAlign: 'right' }} value={row.ATM ?? ''} onChange={e => setVol(tn, 'ATM', e.target.value)} placeholder="—" /></div>,
            <div key={tn + 'c'} style={tdR}><input className="inp" inputMode="decimal" style={{ width: 70, textAlign: 'right' }} value={row.RR25 ?? ''} onChange={e => setVol(tn, 'RR25', e.target.value)} placeholder="0" /></div>,
            <div key={tn + 'd'} style={tdR}><input className="inp" inputMode="decimal" style={{ width: 70, textAlign: 'right' }} value={row.BF25 ?? ''} onChange={e => setVol(tn, 'BF25', e.target.value)} placeholder="0" /></div>,
            <div key={tn + 'e'} style={{ ...tdR, color: 'var(--text-dim)' }}>{ok ? fmt(atm + bf - rr / 2, 2) : '—'}</div>,
            <div key={tn + 'f'} style={{ ...tdR, color: 'var(--text-dim)' }}>{ok ? fmt(atm + bf + rr / 2, 2) : '—'}</div>,
          ]
        })}
      </div>
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn primary" onClick={saveVols} disabled={!!busy}>{busy === 'vols' ? 'SAVING…' : '▶ SAVE TO DB (MANUAL)'}</button>
        <span className="lbl" style={{ margin: 0 }}>Saved as {pair}_VOL; the daily demo build writes a synthetic surface for the G10 pairs and says so.</span>
      </div>
    </div>
  )

  const pointsPanel = (
    <div style={{ maxWidth: 1040 }}>
      <DescBox>
        {p.crypto ? 'Forward points in USD per unit (pip 1): the outright at a tenor is spot + points, i.e. the futures or forward price for that expiry.' : `Forward points in pips, Bloomberg convention: the outright at a tenor is spot + points × ${p.pip}.`} The parity column is what {p.crypto ? `USD SOFR and the saved ${p.base} rate imply` : 'the two OIS curves imply'}
        ({p.crypto ? `saved ${p.base} rate ${p.funding_pct ?? 0} %` : p.base_curve_available ? p.base_curve : p.base_fallback} / {p.quote_curve}); the basis is quoted minus parity{p.crypto ? ', the futures basis' : ', the cross-currency basis'}. Forwards are priced
        <b> {mode === 'MARKET' ? 'off these quoted points' : 'from yields (parity)'}</b> for every pair in this account.
        {' '}<button className="btn" style={{ marginLeft: 8 }} disabled={!!busy} onClick={() => setMode(mode === 'MARKET' ? 'IMPLIED' : 'MARKET')}>{mode === 'MARKET' ? 'SWITCH TO IMPLIED FROM YIELDS' : 'SWITCH TO QUOTED POINTS'}</button>
      </DescBox>
      <FxForwardChart p={p} tenors={tenors} pts={pts} off={off} parity={parity} />
      <div data-testid="fwd-table" style={{ display: 'grid', gridTemplateColumns: '40px 56px 56px 1fr 1fr 1fr 1fr 1fr 118px', minWidth: 720 }}>
        <div style={thL} title="Switch a tenor off to keep its points on the row without pricing on them">USE</div><div style={thL}>TENOR</div><div style={thR}>DAYS</div><div style={thR}>{p.crypto ? `POINTS (${p.quote})` : 'POINTS (PIPS)'}</div><div style={thR}>OUTRIGHT</div><div style={thR}>PARITY PTS</div><div style={thR}>PARITY FWD</div><div style={thR}>BASIS</div><div style={{ ...thL, paddingLeft: 12 }}>SRC</div>
        {tenors.map(t => {
          const q = parity[t]; const v = pts[t]; const n = parseFloat(v)
          const typed = !isNaN(n), on = typed && !off[t]
          // what is saved for this tenor, and whether the row on screen is that: the pricer's answers below were made
          // on the saved curve, so a row that was changed shows its own points and says it is not saved yet
          const savedOn = p.forward_points?.[t], savedOff = p.forward_points_off?.[t]
          const dirty = typed ? (on ? Number(savedOn) !== n : Number(savedOff) !== n) : (savedOn != null || savedOff != null)
          // a tenor the feed filled beyond its venue's last listed expiry prices as a pillar and is not a quote
          const fed = on && !dirty && (p.forward_points_extrapolated || []).includes(t)
          const quoted = on && !fed
          const outright = p.spot != null && on ? p.spot + n * p.pip : null
          // where nothing is quoted the row shows what the pricer uses there, dimmed and named
          const used = !on && !dirty && q && q.forward != null ? q : null
          const kind = dirty ? 'NOT SAVED' : quoted ? 'QUOTED' : fed ? 'IMPLIED' : (used?.forward_kind || null)
          const how = dirty ? 'changed on this page and not saved: save to see what the pricer uses here'
            : fed ? "the feed's last listed basis held flat as a rate: nothing is listed this far out" : (used?.forward_method || '')
          return [
            <div key={t + 'u'} style={td}><input type="checkbox" className="tog" data-testid={`fwd-use-${t}`} aria-label={`Price on the ${t} point`} checked={on} disabled={!typed}
              onChange={() => setOff(o => ({ ...o, [t]: !o[t] }))} /></div>,
            <div key={t + 'a'} style={td}>{t}</div>,
            <div key={t + 'b'} style={{ ...tdR, color: 'var(--text-dim)' }}>{TENOR_DAYS[t]}</div>,
            <div key={t + 'c'} style={tdR}><input className={`qi${typed && !on ? ' is-off' : ''}`} inputMode="decimal" aria-label={`${t} points`} style={{ width: 84 }} value={v ?? ''}
              placeholder={used ? fmt(used.forward_points, p.crypto ? 2 : 1) : '—'} onChange={e => setPts({ ...pts, [t]: e.target.value })} /></div>,
            <div key={t + 'd'} data-testid={`fwd-outright-${t}`} data-kind={kind || ''} title={how || undefined}
              style={{ ...tdR, color: on ? 'var(--text-hi)' : 'var(--text-dim)', fontStyle: on ? 'normal' : 'italic' }}>{outright != null ? fmt(outright, dp(pair)) : used ? fmt(used.forward, dp(pair)) : '—'}</div>,
            <div key={t + 'e'} style={{ ...tdR, color: 'var(--text-dim)' }}>{q ? fmt(q.implied_points, 1) : '…'}</div>,
            <div key={t + 'f'} style={{ ...tdR, color: 'var(--text-dim)' }}>{q ? fmt(q.implied_forward, dp(pair)) : '…'}</div>,
            <div key={t + 'g'} style={{ ...tdR, color: q && on ? (n - q.implied_points >= 0 ? 'var(--up)' : 'var(--down)') : 'var(--text-mute)' }}>{q && on ? fmt(n - q.implied_points, 1) : '—'}</div>,
            <div key={t + 'h'} style={{ ...td, paddingLeft: 12 }} data-testid={`fwd-src-${t}`}>
              {quoted && !dirty ? <SourceBadge src={p.forward_curve?.source || 'MANUAL'} />
                : kind ? <span className={`pill ${kind === 'IMPLIED' ? 'p-amber' : 'p-dim'}`} style={{ whiteSpace: 'nowrap' }} title={how}>{kind}</span>
                  : <span className="pill p-dim" style={{ whiteSpace: 'nowrap' }}>…</span>}
            </div>,
          ]
        })}
      </div>
      {/* how the rows that are not quotes were reached: the method the pricer names at the longest tenor. Kept clear
          of the help button at the corner of the page. */}
      {(() => {
        const far = [...tenors].reverse().map(t => parity[t]).find(q => q && q.forward_kind === 'IMPLIED' && q.forward_method)
        if (!far) return null
        return (
          <div data-testid="fwd-implied-note" style={{ marginTop: 8, paddingRight: 72, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Italics: not a quote, but what the pricer uses there on the saved curve. Beyond the quoted tenors: {far.forward_method}.
            {p.crypto ? ' Nothing trades that far out on a digital asset: the forward there is a model\'s.' : ''} A tenor switched off keeps its points and is priced like any unquoted date.
          </div>
        )
      })()}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <button className="btn" title="Types parity into every tenor. Saved, each becomes this account's own quote (MANUAL), the long tenors too."
          onClick={() => { const q = {}; tenors.forEach(t => { if (parity[t]) q[t] = parity[t].implied_points.toFixed(2) }); setPts(q); setOff({}); flash('ok', 'Every tenor filled with parity. Saving makes each one this account\'s own quote.') }} disabled={!Object.keys(parity).length}>FILL FROM PARITY</button>
        <button className="btn" onClick={snapBbg} disabled={!!busy || !bbg?.available} title={bbg?.available ? 'Spot and points from the Bloomberg Desktop API (self-host)' : 'Self-host only: no Bloomberg Desktop API on this server (self-host only)'}>{busy === 'bbg' ? 'SNAPPING…' : '▶ SNAP BLOOMBERG'}</button>
        <button className="btn primary" onClick={() => save('MANUAL')} disabled={!!busy}>{busy === 'save' ? 'SAVING…' : '▶ SAVE TO DB (MANUAL)'}</button>
      </div>
      {ownPoints && (
        <div data-testid="use-feed" style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-dim)' }}>
            {pair} prices on forward points saved in this account ({p.forward_curve.source}, {p.forward_curve.valuation_date}), not on the venue's forwards, which refresh every ten minutes.
          </span>
          {askFeed
            ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px' }}>Hand {pair} back to the feed? Your saved points stay in the history; the venue's forwards replace them from the next refresh.</span>
                <button className="btn" onClick={() => setAskFeed(false)} disabled={!!busy}>KEEP MINE</button>
                <button className="btn primary" onClick={backToFeed} disabled={!!busy}>{busy === 'feed' ? 'SWITCHING…' : 'USE THE FEED'}</button>
              </span>
            : <button className="btn" onClick={() => setAskFeed(true)} disabled={!!busy}>USE THE FEED'S FORWARDS</button>}
        </div>
      )}
    </div>
  )

  const spotPanel = (
    <div>
      <ParamGrid cols={3} items={[
        { label: 'SPOT', value: fmt(p.spot, dp(pair)), cls: 'ac' }, { label: 'AS OF', value: p.spot_as_of || '—' }, { label: 'SOURCE', value: p.spot_source || '—' },
        { label: 'FEED', value: p.crypto ? (md?.feeds?.crypto || 'Coinbase (public)') : (md?.feeds?.fx || 'ECB reference rates (public)') },
        { label: 'PIP', value: String(p.pip) }, { label: 'QUOTE', value: `${p.quote} per 1 ${p.base}` },
      ]} />
      <SectionLabel sub="public feeds for every pair; a desk value overrides it">REFRESH OR SET SPOT</SectionLabel>
      <div className="row">
        <button className="btn" onClick={snapSpot} disabled={!!busy}>{busy === 'spot' ? 'SNAPPING…' : '● SNAP SPOT FROM FEEDS'}</button>
        <input className="inp" style={{ width: 140 }} placeholder={`desk spot, e.g. ${fmt(p.spot, dp(pair))}`} value={spotIn} onChange={e => setSpotIn(e.target.value)} />
        <button className="btn" onClick={saveSpotManual} disabled={!!busy || !spotIn}>SAVE DESK SPOT</button>
      </div>
      {p.crypto && (<>
        {/* one name with the ticket's IMPLIED <BASE> RATE: the saved rate carries spot to the forward where no points are in use */}
        <SectionLabel sub={`lending or staking yield, continuous, % p.a.; the ${p.base} rate in the forward where no points are in use`}>SAVED {p.base} RATE</SectionLabel>
        <div className="row"><input className="inp" style={{ width: 120 }} value={fund} onChange={e => setFund(e.target.value)} placeholder="0.00" /><button className="btn" onClick={saveFunding} disabled={!!busy}>SET</button><span className="lbl" style={{ margin: 0 }}>{p.funding_as_of ? `as of ${p.funding_as_of}` : 'not set · 0% used'}</span></div>
      </>)}
    </div>
  )

  const convPanel = (
    <div>
      <ParamGrid cols={2} items={p.crypto ? [
        { label: 'PRODUCT', value: 'Non-deliverable forward (ISDA Digital Asset Derivatives Definitions)' }, { label: 'SETTLEMENT', value: 'USD cash, against the settlement price source' },
        { label: 'SETTLEMENT PRICE SOURCE', value: p.fixing_default }, { label: 'MODEL', value: 'quoted: F = S + points; parity: F = S·e^(−r_base·T) / DF_USD(T); NPV = ±N·(F − K)·DF_USD(T)' },
        { label: 'USD DISCOUNTING', value: p.quote_curve, cls: 'ac' }, { label: 'BASE DISCOUNTING', value: `${baseRateWords(p, mode)} (continuous)`, cls: 'am' },
      ] : [
        { label: 'PRODUCTS', value: 'FX spot (T+2), deliverable forward, NDF' }, { label: 'NDF FIXING (DEFAULT)', value: p.fixing_default },
        { label: 'QUOTE DISCOUNTING', value: p.quote_curve, cls: 'ac' }, { label: 'BASE DISCOUNTING', value: p.base_curve_available ? `${p.base_curve} (loaded)` : `${p.base_fallback}`, cls: p.base_curve_available ? 'ac' : 'am' },
        { label: 'FORWARD SOURCE (ACCOUNT)', value: mode === 'MARKET' ? 'quoted points, basis vs parity reported' : 'implied from the two OIS curves' }, { label: 'INTERPOLATION', value: 'points linear in days between tenors; flat beyond the last' },
        { label: 'PIP', value: String(p.pip) }, { label: 'DAY COUNT', value: 'ACT/365 for T' },
      ]} />
      {!p.crypto && !p.base_curve_available && (<>
        <SectionLabel sub="used only while this account has no OIS curve for the base currency">{p.base} FALLBACK RATE</SectionLabel>
        <div className="row"><input className="inp" style={{ width: 120 }} value={flat} onChange={e => setFlat(e.target.value)} placeholder="% p.a." /><button className="btn" onClick={saveFlat} disabled={!!busy}>SET</button><span className="lbl" style={{ margin: 0 }}>Load {p.base_curve} under Rate curves to stop using it.</span></div>
      </>)}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="crv-hdr">
        <div className="crv-hdr-row">
          <div className="crv-flag-lg">{FLAG[p.base]}{!p.crypto && <span style={{ fontSize: 14, marginLeft: 2 }}>{FLAG[p.quote]}</span>}</div>
          <div className="crv-hdr-info">
            <div className="crv-hdr-name">{pair}</div>
            <div className="crv-hdr-sub">{NAME[pair]} · {p.quote} per 1 {p.base} · {p.crypto ? 'digital asset' : 'G10'}</div>
          </div>
          <div className="crv-rate-block">
            <div className="crv-rate-val" style={{ color: 'var(--text-hi)' }}>{fmt(p.spot, dp(pair))}</div>
            <div className="crv-rate-lbl">spot · {p.spot_as_of || 'no snapshot'}</div>
          </div>
        </div>
        <div className="crv-pills">
          <span className={`pill ${p.crypto ? 'p-amber' : 'p-green'}`}>{p.crypto ? 'NDF' : 'FX SPOT · FWD · NDF'}</span>
          <span className="pill p-blue">{p.quote_curve}</span>
          <span className={`pill ${p.crypto ? 'p-amber' : p.base_curve_available ? 'p-blue' : 'p-amber'}`}>{p.crypto ? baseRateWords(p, mode) : p.base_curve_available ? p.base_curve : `${p.base} flat (no curve)`}</span>
          <span className={`pill ${p.forward_curve ? 'p-purple' : 'p-dim'}`} title={p.forward_curve?.source || ''}>{p.forward_curve ? (isVenue(p.forward_curve) ? `${sourceShort(p.forward_curve)} points` : `${sourceShort(p.forward_curve)} points · ${p.forward_curve.valuation_date}`) : 'no forward curve'}</span>
          {/* what the forwards are priced from, read with the curve pill before it: a pair with no points prices from parity in either mode */}
          <span className="pill p-dim">{pricedFromWords(mode, p.forward_curve, !!p.crypto)}</span>
          <span className="pill p-dim">pip {p.pip}</span>
        </div>
      </div>
      <InnerTabs tabs={tabs} />
      <InnerBody tabs={tabs} panels={{ points: pointsPanel, vols: volsPanel, spot: spotPanel, conv: convPanel,
                                    ...(hasFixings ? { fixings: <FixingsPanel key={pair} p={p} call={call} flash={flash} active={innerTab === 'fixings'} decimals={dp(pair)} /> } : {}) }} />
    </div>
  )
}
