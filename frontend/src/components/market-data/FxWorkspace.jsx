// FX & DIGITAL ASSETS — the same shell as Rate curves: a sidebar of pairs
// grouped by market, a detail pane with header, pills and inner tabs. Each
// pair shows its spot, its forward-point curve by tenor (editable, with the
// parity points and the basis beside every quoted point), and its
// conventions. Points are saved as {PAIR}_FWD snapshots: manual, Bloomberg
// snap, or import, like any rates curve.
import { useCallback, useEffect, useMemo, useState } from 'react'
import useMarketDataStore from '../../store/useMarketDataStore'
import { InnerTabs, InnerBody, ParamGrid, SectionLabel, DescBox } from './_DetailShared'
import RateCurveCanvas from './RateCurveCanvas'
import { getSessionMaybe } from '../../lib/session'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const FLAG = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CHF: '🇨🇭', AUD: '🇦🇺', CAD: '🇨🇦', BTC: '₿', ETH: 'Ξ', SOL: '◎' }
const NAME = { EURUSD: 'Euro / US dollar', GBPUSD: 'Sterling / US dollar', AUDUSD: 'Australian dollar / US dollar', USDJPY: 'US dollar / Japanese yen',
  USDCHF: 'US dollar / Swiss franc', USDCAD: 'US dollar / Canadian dollar', BTCUSD: 'Bitcoin / US dollar', ETHUSD: 'Ether / US dollar', SOLUSD: 'Solana / US dollar' }
const GROUPS = [
  { key: 'G10', flag: '🌐', label: 'G10 FX', pairs: ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDJPY', 'USDCHF', 'USDCAD'] },
  { key: 'DA', flag: '⛓', label: 'DIGITAL ASSETS', pairs: ['BTCUSD', 'ETHUSD', 'SOLUSD'] },
]
const TENOR_DAYS = { '1W': 7, '2W': 14, '1M': 30, '2M': 61, '3M': 91, '6M': 182, '9M': 273, '1Y': 365, '2Y': 730 }
const CRYPTO = ['BTC', 'ETH', 'SOL']
const dp = (pair) => CRYPTO.includes(pair.slice(0, 3)) ? 2 : pair === 'USDJPY' ? 3 : 5
const fmt = (n, d = 2) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
const iso = (d) => d.toISOString().slice(0, 10)

async function call(path, opts = {}) {
  const session = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.detail ? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)) : `${r.status}`)
  return body
}

function SourceBadge({ src }) {
  const map = { BLOOMBERG: 'p-blue', IMPORT: 'p-purple', MANUAL: 'p-dim', FEED: 'p-green', PARITY: 'p-amber' }
  return <span className={`pill ${map[src] || 'p-dim'}`}>{src || '—'}</span>
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
    if (bbg === null) { try { const st = await call('/bloomberg/status'); setBbg({ available: !!st?.connected, error: st?.error || '' }) } catch { setBbg({ available: false }) } }
  }, [bbg])
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
                    <div key={p.pair} className={`crv-item${sel === p.pair ? ' sel' : ''}`} style={{ borderLeftColor: sel === p.pair ? (p.crypto ? 'var(--chain)' : 'var(--accent)') : 'transparent' }} onClick={() => setSel(p.pair)}>
                      <span className={`type-badge ${p.forward_curve ? (p.crypto ? 'tb-funding' : 'tb-ois') : 'tb-basis'}`}>{p.forward_curve ? 'FWD' : 'SPOT'}</span>
                      <div className="ci-body"><div className="ci-name">{p.pair}</div><div className="ci-sub">{p.forward_curve ? `${p.forward_curve.source} · ${p.forward_curve.tenors.length} tenors` : p.crypto ? `funding ${p.funding_pct ?? 0}% · no forward curve` : 'no forward curve'}</div></div>
                      <div className={`ci-val ${p.crypto ? 'am' : 'ac'}`}>{fmt(p.spot, dp(p.pair))}</div>
                    </div>))}
                </div>
              </div>)
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {msg && <div style={{ margin: '8px 14px 0', padding: '7px 10px', borderRadius: 4, fontSize: '0.84rem', border: '1px solid', color: msg.kind === 'ok' ? 'var(--accent)' : 'var(--red)', borderColor: msg.kind === 'ok' ? 'var(--accent-dim)' : 'rgba(224,80,64,.4)', background: msg.kind === 'ok' ? 'var(--accent-glow)' : 'rgba(224,80,64,.08)' }}>{msg.text}</div>}
        {cur ? <PairDetail p={cur} md={md} reload={load} flash={flash} busy={busy} setBusy={setBusy} bbg={bbg} />
             : <div className="empty-state"><div className="empty-icon">⟨/⟩</div><div className="empty-title">Select a pair</div><div className="empty-sub">{pairs.length} pairs — 6 G10 · 3 digital assets</div></div>}
      </div>
    </div>
  )
}

// Outright forward by tenor: the quoted curve (spot + points) against parity.
function FxForwardChart({ p, tenors, pts, parity }) {
  const yrs = t => (TENOR_DAYS[t] || 0) / 365
  const quoted = tenors.map(t => { const n = parseFloat(pts[t]); return p.spot != null && !isNaN(n) ? { t: yrs(t), v: p.spot + n * p.pip } : null }).filter(Boolean)
  const par = tenors.map(t => parity[t]?.implied_forward != null ? { t: yrs(t), v: parity[t].implied_forward } : null).filter(Boolean)
  if (p.spot == null || quoted.length + par.length < 2) return null
  const series = []
  if (quoted.length >= 1) series.push({ label: 'QUOTED', color: '#0dd4a8', points: [{ t: 0, v: p.spot }, ...quoted] })
  if (par.length >= 1) series.push({ label: 'PARITY', color: '#4a9ad4', dash: [5, 3], points: [{ t: 0, v: p.spot }, ...par] })
  return (
    <div style={{ margin: '8px 0 12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 2, padding: 8 }}>
      <div style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 5 }}>
        {p.pair} · OUTRIGHT FORWARD BY TENOR{p.crypto ? ' (USD)' : ''}
      </div>
      <RateCurveCanvas series={series} unit="" decimals={dp(p.pair)} height={170} />
    </div>
  )
}

function PairDetail({ p, md, reload, flash, busy, setBusy, bbg }) {
  const pair = p.pair
  const [pts, setPts] = useState({})
  const [parity, setParity] = useState({})     // tenor -> {implied_points, forward, implied_forward, basis_points}
  const [spotIn, setSpotIn] = useState('')
  const [fund, setFund] = useState('')
  const [flat, setFlat] = useState('')
  const tenors = md?.forward_tenors || Object.keys(TENOR_DAYS)

  useEffect(() => { setPts(p.forward_points ? { ...p.forward_points } : {}); setSpotIn(''); setFund(p.funding_pct ?? ''); setFlat(p.base_flat_pct ?? '') }, [pair, p.forward_curve?.valuation_date, p.spot_as_of])   // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [pair, p.spot, p.forward_curve?.valuation_date, md?.forward_mode])   // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (source = 'MANUAL', points = pts, spot) => {
    const clean = {}; Object.entries(points).forEach(([t, v]) => { const n = parseFloat(v); if (!isNaN(n)) clean[t] = n })
    if (Object.keys(clean).length < 2) return flash('err', 'Enter points for at least two tenors')
    setBusy('save')
    try { await call('/api/currency/forward-curve', { method: 'POST', body: JSON.stringify({ pair, points: clean, source, ...(spot ? { spot } : {}) }) }); flash('ok', `${pair} forward curve saved (${source})`); await reload() }
    catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const snapBbg = async () => {
    setBusy('bbg')
    try {
      const tk = await call(`/bloomberg/tickers/${pair}_FWD`)
      const tickers = Object.entries(tk.tickers || {}).map(([tenor, ticker]) => ({ tenor, ticker }))
      const r = await call('/bloomberg/snap', { method: 'POST', body: JSON.stringify({ curve_id: `${pair}_FWD`, snap_date: iso(new Date()), tickers, mode: 'live' }) })
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
    const v = parseFloat(fund); if (isNaN(v)) return flash('err', 'Enter a funding rate in % p.a.')
    setBusy('fund')
    try { await call('/api/crypto/funding', { method: 'POST', body: JSON.stringify({ digital_asset: p.base, rate_pct: v }) }); flash('ok', `${p.base} funding set to ${v}%`); await reload() } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const saveFlat = async () => {
    const v = parseFloat(flat); if (isNaN(v)) return flash('err', 'Enter a flat rate in % p.a.')
    setBusy('flat')
    try { await call('/api/currency/flat', { method: 'POST', body: JSON.stringify({ currency: p.base, rate_pct: v }) }); flash('ok', `${p.base} fallback rate set to ${v}%`); await reload() } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const saveSpotManual = async () => {
    const v = parseFloat(spotIn); if (isNaN(v) || v <= 0) return flash('err', 'Enter a spot')
    const clean = {}; Object.entries(pts).forEach(([t, x]) => { const n = parseFloat(x); if (!isNaN(n)) clean[t] = n })
    if (Object.keys(clean).length < 2) { Object.assign(clean, { '1M': 0, '3M': 0 }) }
    await save(p.forward_curve?.source || 'MANUAL', clean, v)
  }

  const tabs = [{ id: 'points', label: p.crypto ? 'Forward points (USD)' : 'Forward points', badge: p.forward_curve?.tenors?.length },
                { id: 'spot', label: p.crypto ? 'Spot & funding' : 'Spot' }, { id: 'conv', label: 'Conventions' }]
  const mode = md?.forward_mode || 'MARKET'
  const thL = { fontSize: '0.78rem', color: 'var(--text-dim)', letterSpacing: '.08em', padding: '4px 6px 6px 0', borderBottom: '1px solid var(--border)', textAlign: 'left' }
  const thR = { ...thL, textAlign: 'right' }
  const td = { fontSize: '0.875rem', color: 'var(--text)', padding: '5px 6px 5px 0', borderBottom: '1px solid var(--panel-2)' }
  const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

  const pointsPanel = (
    <div>
      <DescBox>
        {p.crypto ? 'Forward points in USD per unit (pip 1): the outright at a tenor is spot + points, i.e. the futures or forward price for that expiry.' : `Forward points in pips, Bloomberg convention: the outright at a tenor is spot + points × ${p.pip}.`} The parity column is what {p.crypto ? 'USD SOFR and the funding rate imply' : 'the two OIS curves imply'}
        ({p.crypto ? `${p.base} funding ${p.funding_pct ?? 0}%` : p.base_curve_available ? p.base_curve : p.base_fallback} / {p.quote_curve}); the basis is quoted minus parity{p.crypto ? ', the futures basis' : ', the cross-currency basis'}. Forwards are priced
        <b> {mode === 'MARKET' ? 'off these quoted points' : 'from yields (parity)'}</b> for every pair in this account.
        {' '}<button className="btn" style={{ marginLeft: 8 }} disabled={!!busy} onClick={() => setMode(mode === 'MARKET' ? 'IMPLIED' : 'MARKET')}>{mode === 'MARKET' ? 'SWITCH TO IMPLIED FROM YIELDS' : 'SWITCH TO QUOTED POINTS'}</button>
      </DescBox>
      <FxForwardChart p={p} tenors={tenors} pts={pts} parity={parity} />
      <div style={{ display: 'grid', gridTemplateColumns: '70px 60px 1fr 1fr 1fr 1fr 1fr 90px', minWidth: 620 }}>
        <div style={thL}>TENOR</div><div style={thR}>DAYS</div><div style={thR}>POINTS (PIPS)</div><div style={thR}>OUTRIGHT</div><div style={thR}>PARITY PTS</div><div style={thR}>PARITY FWD</div><div style={thR}>BASIS</div><div style={thL}>SRC</div>
        {tenors.map(t => {
          const q = parity[t]; const v = pts[t]; const n = parseFloat(v)
          const outright = p.spot != null && !isNaN(n) ? p.spot + n * p.pip : null
          return [
            <div key={t + 'a'} style={{ ...td, color: 'var(--accent)' }}>{t}</div>,
            <div key={t + 'b'} style={{ ...tdR, color: 'var(--text-dim)' }}>{TENOR_DAYS[t]}</div>,
            <div key={t + 'c'} style={tdR}><input className="qi" style={{ width: 76 }} value={v ?? ''} placeholder="—" onChange={e => setPts({ ...pts, [t]: e.target.value })} /></div>,
            <div key={t + 'd'} style={{ ...tdR, color: 'var(--text-hi)' }}>{outright != null ? fmt(outright, dp(pair)) : '—'}</div>,
            <div key={t + 'e'} style={{ ...tdR, color: 'var(--blue)' }}>{q ? fmt(q.implied_points, 1) : '…'}</div>,
            <div key={t + 'f'} style={{ ...tdR, color: 'var(--blue)' }}>{q ? fmt(q.implied_forward, dp(pair)) : '…'}</div>,
            <div key={t + 'g'} style={{ ...tdR, color: q && !isNaN(n) ? (n - q.implied_points >= 0 ? 'var(--amber)' : 'var(--red)') : 'var(--text-mute)' }}>{q && !isNaN(n) ? fmt(n - q.implied_points, 1) : '—'}</div>,
            <div key={t + 'h'} style={td}><SourceBadge src={!isNaN(n) ? (p.forward_curve?.source || 'MANUAL') : 'PARITY'} /></div>,
          ]
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <button className="btn" onClick={() => { const q = {}; tenors.forEach(t => { if (parity[t]) q[t] = parity[t].implied_points.toFixed(2) }); setPts(q) }} disabled={!Object.keys(parity).length}>FILL FROM PARITY</button>
        <button className="btn" onClick={snapBbg} disabled={!!busy || !bbg?.available} title={bbg?.available ? 'Spot and points from the Bloomberg Desktop API (self-host)' : 'Self-host only: no Bloomberg Desktop API on this server (self-host only)'}>{busy === 'bbg' ? 'SNAPPING…' : '▶ SNAP BLOOMBERG'}</button>
        <button className="btn primary" onClick={() => save('MANUAL')} disabled={!!busy}>{busy === 'save' ? 'SAVING…' : '▶ SAVE TO DB (MANUAL)'}</button>
      </div>
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
        <SectionLabel sub="lending or staking yield, continuous, % p.a.; the base-currency rate in the forward">{p.base} FUNDING</SectionLabel>
        <div className="row"><input className="inp" style={{ width: 120 }} value={fund} onChange={e => setFund(e.target.value)} placeholder="0.00" /><button className="btn" onClick={saveFunding} disabled={!!busy}>SET</button><span className="lbl" style={{ margin: 0 }}>{p.funding_as_of ? `as of ${p.funding_as_of}` : 'not set · 0% used'}</span></div>
      </>)}
    </div>
  )

  const convPanel = (
    <div>
      <ParamGrid cols={2} items={p.crypto ? [
        { label: 'PRODUCT', value: 'Non-deliverable forward (ISDA Digital Asset Derivatives Definitions)' }, { label: 'SETTLEMENT', value: 'USD cash, against the settlement price source' },
        { label: 'SETTLEMENT PRICE SOURCE', value: p.fixing_default }, { label: 'MODEL', value: 'quoted: F = S + points; parity: F = S·e^(−r_funding·T) / DF_USD(T); NPV = ±N·(F − K)·DF_USD(T)' },
        { label: 'USD DISCOUNTING', value: p.quote_curve, cls: 'ac' }, { label: 'BASE DISCOUNTING', value: `${p.base} funding ${p.funding_pct ?? 0}% (continuous)`, cls: 'am' },
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
            <div className="crv-rate-val" style={{ color: p.crypto ? 'var(--chain)' : 'var(--accent)' }}>{fmt(p.spot, dp(pair))}</div>
            <div className="crv-rate-lbl">spot · {p.spot_as_of || 'no snapshot'}</div>
          </div>
        </div>
        <div className="crv-pills">
          <span className={`pill ${p.crypto ? 'p-amber' : 'p-green'}`}>{p.crypto ? 'NDF' : 'FX SPOT · FWD · NDF'}</span>
          <span className="pill p-blue">{p.quote_curve}</span>
          <span className={`pill ${p.crypto ? 'p-amber' : p.base_curve_available ? 'p-blue' : 'p-amber'}`}>{p.crypto ? `${p.base} funding ${p.funding_pct ?? 0}%` : p.base_curve_available ? p.base_curve : `${p.base} flat (no curve)`}</span>
          <span className={`pill ${p.forward_curve ? 'p-purple' : 'p-dim'}`}>{p.forward_curve ? `${p.forward_curve.source} points · ${p.forward_curve.valuation_date}` : 'no forward curve'}</span>
          <span className="pill p-dim">{mode === 'MARKET' ? 'quoted points' : 'implied from yields'}</span>
          <span className="pill p-dim">pip {p.pip}</span>
        </div>
      </div>
      <InnerTabs tabs={tabs} />
      <InnerBody tabs={tabs} panels={{ points: pointsPanel, spot: spotPanel, conv: convPanel }} />
    </div>
  )
}
