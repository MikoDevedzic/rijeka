// MARKET DATA · FX & DIGITAL ASSETS — spot per pair, the funding rate of each
// digital asset, and the flat rate a currency falls back to without an OIS
// curve. Pricing and booking live in NEW TRADE (trade-window/FxCryptoPanel).
import { useCallback, useEffect, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import './CryptoDesk.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const fmt = (n, d = 2) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
const CRYPTO_BASES = ['BTC', 'ETH', 'SOL']
const rateDp = (pair) => !pair ? 2 : CRYPTO_BASES.includes(pair.slice(0, 3)) ? 2 : pair === 'USDJPY' ? 3 : 5
const iso = (d) => d.toISOString().slice(0, 10)
const plusMonths = (m) => { const d = new Date(); d.setMonth(d.getMonth() + m); return iso(d) }

async function call(path, opts = {}) {
  const session = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.detail ? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)) : `${r.status}`)
  return body
}

export default function CryptoDesk() {
  const [md, setMd] = useState(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [funding, setFunding] = useState({})
  const [flat, setFlat] = useState({})
  const [fwdPair, setFwdPair] = useState('EURUSD')
  const [fwdPts, setFwdPts] = useState({})
  const [bbg, setBbg] = useState(null)   // {available, error}

  const flash = (kind, text) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 7000) }
  const pairs = md?.pairs || []

  const load = useCallback(async () => {
    const m = await call('/api/currency/pairs')
    setMd(m)
    const sel = (m?.pairs || []).find(p => p.pair === fwdPair)
    setFwdPts(sel?.forward_points ? { ...sel.forward_points } : {})
    if (bbg === null) { try { const st = await call('/bloomberg/status'); setBbg({ available: !!(st?.connected ?? st?.available ?? st?.ok), detail: st?.error || '' }) } catch { setBbg({ available: false }) } }
    const f = {}; (m?.pairs || []).filter(p => p.crypto).forEach(p => { f[p.base] = p.funding_pct ?? '' }); setFunding(f)
  }, [fwdPair])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load().catch(e => flash('err', e.message)) }, [load])

  const snap = async () => {
    setBusy('snap')
    try { const r = await call('/api/currency/spot/snap', { method: 'POST' }); flash('ok', `Spot saved for ${r.saved} pairs · ${Object.entries(r.prices).slice(0, 4).map(([k, v]) => `${k} ${fmt(v, rateDp(k))}`).join(' · ')} …`); await load() }
    catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const saveFunding = async (asset) => {
    const v = parseFloat(funding[asset]); if (isNaN(v)) return flash('err', 'Enter a funding rate in % p.a.')
    setBusy('fund' + asset)
    try { await call('/api/crypto/funding', { method: 'POST', body: JSON.stringify({ digital_asset: asset, rate_pct: v }) }); flash('ok', `${asset} funding set to ${v}% p.a.`); await load() }
    catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const setMode = async (mode) => {
    setBusy('mode')
    try { await call('/api/currency/forward-mode', { method: 'POST', body: JSON.stringify({ mode }) }); flash('ok', mode === 'MARKET' ? 'Forwards priced off quoted points (market)' : 'Forwards implied from the two OIS curves (parity)'); await load() }
    catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const saveFwd = async (source = 'MANUAL', spot) => {
    const points = {}; Object.entries(fwdPts).forEach(([t, v]) => { const n = parseFloat(v); if (!isNaN(n)) points[t] = n })
    if (Object.keys(points).length < 2) return flash('err', 'Enter points for at least two tenors')
    setBusy('fwd')
    try { await call('/api/currency/forward-curve', { method: 'POST', body: JSON.stringify({ pair: fwdPair, points, source, ...(spot ? { spot } : {}) }) }); flash('ok', `${fwdPair} forward curve saved (${source})`); await load() }
    catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const snapFwdBloomberg = async () => {
    setBusy('bbg')
    try {
      const tk = await call(`/bloomberg/tickers/${fwdPair}_FWD`)
      const tickers = Object.entries(tk.tickers || {}).map(([tenor, ticker]) => ({ tenor, ticker }))
      const r = await call('/bloomberg/snap', { method: 'POST', body: JSON.stringify({ curve_id: `${fwdPair}_FWD`, snap_date: new Date().toISOString().slice(0, 10), tickers, mode: 'live' }) })
      const got = {}; let spot
      ;(r.quotes || r.prices || []).forEach(q => { const t = q.tenor ?? q.t; const v = q.rate ?? q.price ?? q.value; if (t === 'SPOT') spot = v; else if (v != null) got[t] = v })
      if (Object.keys(got).length < 2) throw new Error('Bloomberg returned fewer than two tenors')
      setFwdPts(got)
      await call('/api/currency/forward-curve', { method: 'POST', body: JSON.stringify({ pair: fwdPair, points: got, source: 'BLOOMBERG', ...(spot ? { spot } : {}) }) })
      flash('ok', `${fwdPair} forward curve snapped from Bloomberg`); await load()
    } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const saveFlat = async (ccy) => {
    const v = parseFloat(flat[ccy]); if (isNaN(v)) return flash('err', 'Enter a flat rate in % p.a.')
    setBusy('flat' + ccy)
    try { await call('/api/currency/flat', { method: 'POST', body: JSON.stringify({ currency: ccy, rate_pct: v }) }); flash('ok', `${ccy} flat rate set to ${v}% p.a.`); await load() }
    catch (e) { flash('err', e.message) } finally { setBusy('') }
  }

  return (
    <div className="cd">
      <div className="cd-head">
        <div>
          <div className="cd-eyebrow">MARKET DATA · FX &amp; DIGITAL ASSETS</div>
          <h1>Spot, funding and flat rates</h1>
          <p>The inputs behind every FX and crypto price: spot per pair from public feeds, the funding rate of each digital asset, and the flat rate a currency falls back to when it has no OIS curve. Pricing and booking happen in NEW TRADE under FX and CRYPTO.</p>
        </div>
        <button className="cd-btn primary" onClick={snap} disabled={!!busy}>{busy === 'snap' ? 'SNAPPING…' : '● SNAP SPOT'}</button>
      </div>
      {msg && <div className={`cd-msg ${msg.kind}`}>{msg.text}</div>}

      <div className="cd-grid">
        <section className="cd-card">
          <h2>MARKET DATA</h2>
          <table className="cd-table">
            <thead><tr><th>PAIR</th><th>SPOT</th><th>AS OF</th><th>DISCOUNTING</th><th></th></tr></thead>
            <tbody>
              {pairs.map(p => (
                <tr key={p.pair}>
                  <td className="cd-asset">{p.pair}</td>
                  <td className="cd-num">{fmt(p.spot, rateDp(p.pair))}</td>
                  <td className="cd-dim">{p.spot_as_of || 'no snapshot'}</td>
                  <td className="cd-dim">{p.crypto ? `${p.base} funding ${p.funding_pct ?? 0}% · ${p.quote_curve}` : p.base_curve_available ? `${p.base_curve} / ${p.quote_curve}` : <span title="No OIS curve for this currency in your account; a flat rate is used and every quote says so."><span style={{ color: 'var(--amber)' }}>{p.base_fallback}</span> / {p.quote_curve}</span>}</td>
                  <td>{p.crypto && <span className="cd-fund"><input className="cd-inp sm" value={funding[p.base] ?? ''} placeholder="0.00" onChange={e => setFunding({ ...funding, [p.base]: e.target.value })} /><button className="cd-btn sm" onClick={() => saveFunding(p.base)} disabled={!!busy}>{busy === 'fund' + p.base ? '…' : 'SET'}</button></span>}</td>
                </tr>))}
            </tbody>
          </table>
          <div className="cd-note">FX: {md?.feeds?.fx || 'ECB reference rates (public)'} · Crypto: {md?.feeds?.crypto || 'Coinbase spot (public)'} · funding is a desk input (% p.a., continuous). <span style={{ color: 'var(--amber)' }}>Amber</span> = no OIS curve loaded for that currency, so it discounts flat at a policy rate until you load one under Rate curves.</div>
        </section>

        <section className="cd-card">
          <h2>FX FORWARD CURVES</h2>
          <div className="cd-form" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 10 }}>
            <label>PAIR<select className="cd-inp" value={fwdPair} onChange={e => setFwdPair(e.target.value)}>{pairs.filter(p => !p.crypto).map(p => <option key={p.pair}>{p.pair}</option>)}</select></label>
            <label>FORWARD SOURCE (ALL PAIRS)<div style={{ display: 'flex', gap: 6 }}>
              {['MARKET', 'IMPLIED'].map(m => <button key={m} className={`cd-btn sm ${md?.forward_mode === m ? 'primary' : ''}`} onClick={() => setMode(m)} disabled={!!busy} title={m === 'MARKET' ? 'Outright = spot + quoted points; basis reported against parity' : 'Parity on the two OIS curves; basis zero'}>{m === 'MARKET' ? 'QUOTED POINTS' : 'IMPLIED FROM YIELDS'}</button>)}
            </div></label>
            <label>LOADED CURVE<div className="cd-dim" style={{ paddingTop: 8 }}>{(() => { const p = pairs.find(x => x.pair === fwdPair); return p?.forward_curve ? `${p.forward_curve.source} · ${p.forward_curve.valuation_date} · ${p.forward_curve.tenors.length} tenors` : 'none · forwards implied from yields for this pair' })()}</div></label>
          </div>
          <table className="cd-table">
            <thead><tr><th>TENOR</th>{(md?.forward_tenors || []).map(t => <th key={t}>{t}</th>)}</tr></thead>
            <tbody><tr><td className="cd-dim">POINTS (PIPS)</td>{(md?.forward_tenors || []).map(t => <td key={t}><input className="cd-inp sm" style={{ width: 70 }} value={fwdPts[t] ?? ''} placeholder="—" onChange={e => setFwdPts({ ...fwdPts, [t]: e.target.value })} /></td>)}</tr></tbody>
          </table>
          <div className="cd-actions" style={{ marginTop: 10, gap: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="cd-btn" onClick={snapFwdBloomberg} disabled={!!busy || !bbg?.available} title={bbg?.available ? 'Spot and forward points from the Bloomberg Desktop API (self-hosted desks)' : 'Bloomberg Desktop API not connected on this server (self-host only)'}>{busy === 'bbg' ? 'SNAPPING…' : '● SNAP FROM BLOOMBERG'}</button>
            <button className="cd-btn primary" onClick={() => saveFwd('MANUAL')} disabled={!!busy}>{busy === 'fwd' ? 'SAVING…' : 'SAVE POINTS (MANUAL)'}</button>
          </div>
          <div className="cd-note">Forward points in pips, Bloomberg convention (EUR1M Curncy etc.). The outright at a date is spot plus the points interpolated in time; the gap to parity is the cross-currency basis and is shown on every quote. Demo accounts carry illustrative MANUAL curves.</div>
        </section>

        <section className="cd-card">
          <h2>FX DISCOUNTING CURVES</h2>
          <p className="cd-note" style={{ marginTop: 0 }}>An FX forward discounts each side on its own OIS curve from Rate curves: USD on SOFR, EUR on €STR, and so on. A currency whose curve is not loaded in this account (demo accounts receive public-source data only) is discounted flat at the rate below until one is; every quote that falls back says so.</p>
          <table className="cd-table">
            <thead><tr><th>CURRENCY</th><th>OIS CURVE</th><th>LOADED IN THIS ACCOUNT</th><th>FALLBACK % P.A.</th><th></th></tr></thead>
            <tbody>
              {[...new Map(pairs.filter(p => !p.crypto).map(p => [p.base, p])).values()].map(p => (
                <tr key={p.base}>
                  <td className="cd-asset">{p.base}</td>
                  <td className="cd-dim">{p.base_curve}</td>
                  <td className="cd-dim">{p.base_curve_available ? <span style={{ color: 'var(--accent)' }}>yes · discounts on {p.base_curve}</span> : <span style={{ color: 'var(--amber)' }}>no · {p.base_fallback}</span>}</td>
                  <td><input className="cd-inp sm" value={flat[p.base] ?? ''} placeholder={p.base_flat_pct ?? ''} onChange={e => setFlat({ ...flat, [p.base]: e.target.value })} /></td>
                  <td><button className="cd-btn sm" onClick={() => saveFlat(p.base)} disabled={!!busy}>{busy === 'flat' + p.base ? '…' : 'SET'}</button></td>
                </tr>))}
            </tbody>
          </table>
        </section>
      </div>

    </div>
  )
}
