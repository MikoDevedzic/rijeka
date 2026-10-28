// DIGITAL ASSETS — spot and funding for BTC / ETH / SOL, a non-deliverable
// forward pricer, booking of a CRYPTO_FORWARD trade, and the on-chain
// confirm / verify loop for the crypto trades in this account. The whole
// crypto path lives on this page so it does not depend on the rates trade
// window.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import './CryptoDesk.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const ASSETS = ['BTC', 'ETH', 'SOL']
const SOURCES = { BTC: 'CME CF BRR', ETH: 'CME CF ETHUSD_RR', SOL: 'Coinbase SOL-USD' }
const fmt = (n, d = 2) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
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
  const [entities, setEntities] = useState([])
  const [cps, setCps] = useState([])
  const [trades, setTrades] = useState([])

  const [form, setForm] = useState({ asset: 'BTC', notional: 10, settlement: plusMonths(3), direction: 'BUY', strike: '', spot: '', rate: '' })
  const [book, setBook] = useState({ own: '', cp: '' })
  const [quote, setQuote] = useState(null)
  const [funding, setFunding] = useState({ BTC: '', ETH: '', SOL: '' })

  const flash = (kind, text) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 6000) }

  const load = useCallback(async () => {
    const [m, e, c, t] = await Promise.all([
      call('/api/crypto/spot'), call('/api/legal-entities/'), call('/api/counterparties/'), call('/api/trades/'),
    ])
    setMd(m); setEntities(e || []); setCps(c || [])
    setTrades((t || []).filter(x => x.instrument_type === 'CRYPTO_FORWARD'))
    const f = {}; (m?.assets || []).forEach(a => { f[a.asset] = a.funding_pct ?? '' }); setFunding(f)
    setBook(b => ({ own: b.own || (e?.[0]?.id || ''), cp: b.cp || (c?.[0]?.id || '') }))
  }, [])
  useEffect(() => { load().catch(e => flash('err', e.message)) }, [load])

  const snap = async () => {
    setBusy('snap')
    try { const r = await call('/api/crypto/spot/snap', { method: 'POST' }); flash('ok', `Spot saved: ${Object.entries(r.prices).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')}`); await load() }
    catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const saveFunding = async (asset) => {
    const v = parseFloat(funding[asset]); if (isNaN(v)) return flash('err', 'Enter a funding rate in % p.a.')
    setBusy('fund' + asset)
    try { await call('/api/crypto/funding', { method: 'POST', body: JSON.stringify({ digital_asset: asset, rate_pct: v }) }); flash('ok', `${asset} funding set to ${v}% p.a.`); await load() }
    catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const price = async () => {
    setBusy('price'); setQuote(null)
    try {
      const body = { digital_asset: form.asset, notional_amount: Number(form.notional), settlement_date: form.settlement, direction: form.direction }
      if (form.strike !== '') body.forward_price = Number(form.strike)
      if (form.spot !== '') body.spot = Number(form.spot)
      if (form.rate !== '') body.asset_rate_pct = Number(form.rate)
      setQuote(await call('/api/crypto/forward/price', { method: 'POST', body: JSON.stringify(body) }))
    } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const bookTrade = async () => {
    if (!quote) return flash('err', 'Price it first')
    if (!book.own || !book.cp) return flash('err', 'Pick your entity and a counterparty')
    setBusy('book')
    try {
      const K = form.strike !== '' ? Number(form.strike) : quote.forward
      const t = await call('/api/trades/', { method: 'POST', body: JSON.stringify({
        asset_class: 'CRYPTO', instrument_type: 'CRYPTO_FORWARD', structure: 'VANILLA',
        own_legal_entity_id: book.own, counterparty_id: book.cp,
        notional: Number(form.notional), notional_ccy: form.asset,
        trade_date: iso(new Date()), effective_date: iso(new Date()), maturity_date: form.settlement,
        discount_curve_id: 'USD_SOFR', desk: 'DIGITAL', book: 'CRYPTO',
        terms: {
          digital_asset: form.asset, notional_amount: String(form.notional), direction: form.direction,
          forward_price: String(K), price_currency: 'USD',
          valuation_date: form.settlement, valuation_time: '16:00 London', settlement_date: form.settlement,
          settlement_currency: 'USD', settlement_price_source: SOURCES[form.asset],
          calculation_agent: null, disruption_fallback: 'ISDA Digital Asset Derivatives Definitions fallbacks',
        },
      }) })
      flash('ok', `Booked ${t.trade_ref}: ${form.direction} ${form.notional} ${form.asset} forward at ${fmt(K)} USD, settling ${form.settlement}`)
      await load()
    } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const confirm = async (t) => {
    setBusy('confirm' + t.id)
    try {
      const key = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
      const r = await call(`/api/chain/confirm/${t.id}`, { method: 'POST', headers: { 'Idempotency-Key': key } })
      flash('ok', `${t.trade_ref} confirmed on Sepolia${r?.attestation?.block_number ? ` · block ${r.attestation.block_number}` : ''}`)
      await load()
    } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const verify = async (t) => {
    setBusy('verify' + t.id)
    try {
      const r = await call(`/api/chain/verify/${t.id}`, { method: 'POST' })
      flash(r.hash_matches && r.on_chain_confirmed ? 'ok' : 'err',
        `${t.trade_ref}: hash ${r.hash_matches ? 'matches' : 'DIFFERS'} · signatures ${r.signatures_valid_for_current_state ? 'valid' : 'INVALID'} · on-chain ${r.on_chain_confirmed ? `confirmed (block ${r.on_chain?.block_number})` : 'not found'}`)
    } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const priceBooked = async (t) => {
    setBusy('px' + t.id)
    try {
      const r = await call('/price', { method: 'POST', body: JSON.stringify({ trade_id: t.id, curves: [{ curve_id: 'USD_SOFR' }] }) })
      flash('ok', `${t.trade_ref}: NPV ${fmt(r.npv)} USD · fair forward ${fmt(r.forward)} · spot ${fmt(r.spot)} (${r.spot_source})`)
    } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }

  const spotOf = (a) => md?.assets?.find(x => x.asset === a)
  const own = useMemo(() => entities.find(e => e.id === book.own), [entities, book.own])

  return (
    <div className="cd">
      <div className="cd-head">
        <div>
          <div className="cd-eyebrow">DIGITAL ASSETS · PHASE 1 PREVIEW</div>
          <h1>Spot, funding and non-deliverable forwards</h1>
          <p>Spot comes from a public exchange feed and is saved as a snapshot like any curve. The forward is cash-and-carry off your USD SOFR curve: F = S·e<sup>(r<sub>USD</sub> − r<sub>asset</sub>)T</sup>, NPV = ±N·(F − K)·DF<sub>USD</sub>. Book it, confirm it on Sepolia, verify it, the same way as a swap.</p>
        </div>
        <button className="cd-btn primary" onClick={snap} disabled={!!busy}>{busy === 'snap' ? 'SNAPPING…' : '● SNAP SPOT'}</button>
      </div>
      {msg && <div className={`cd-msg ${msg.kind}`}>{msg.text}</div>}

      <div className="cd-grid">
        <section className="cd-card">
          <h2>MARKET DATA</h2>
          <table className="cd-table">
            <thead><tr><th>ASSET</th><th>SPOT (USD)</th><th>AS OF</th><th>FUNDING % P.A.</th><th></th></tr></thead>
            <tbody>
              {ASSETS.map(a => { const s = spotOf(a); return (
                <tr key={a}>
                  <td className="cd-asset">{a}</td>
                  <td className="cd-num">{fmt(s?.spot)}</td>
                  <td className="cd-dim">{s?.spot_as_of || 'no snapshot'}</td>
                  <td><input className="cd-inp sm" value={funding[a] ?? ''} placeholder="0.00" onChange={e => setFunding({ ...funding, [a]: e.target.value })} /></td>
                  <td><button className="cd-btn sm" onClick={() => saveFunding(a)} disabled={!!busy}>{busy === 'fund' + a ? '…' : 'SET'}</button></td>
                </tr>) })}
            </tbody>
          </table>
          <div className="cd-note">{md?.feed || 'Coinbase spot (public)'} · funding is a desk input (lending or staking yield, continuous); 0% until set.</div>
        </section>

        <section className="cd-card">
          <h2>PRICE A FORWARD</h2>
          <div className="cd-form">
            <label>ASSET<select className="cd-inp" value={form.asset} onChange={e => setForm({ ...form, asset: e.target.value })}>{ASSETS.map(a => <option key={a}>{a}</option>)}</select></label>
            <label>DIRECTION<select className="cd-inp" value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}><option>BUY</option><option>SELL</option></select></label>
            <label>NOTIONAL ({form.asset})<input className="cd-inp" type="number" min="0" step="any" value={form.notional} onChange={e => setForm({ ...form, notional: e.target.value })} /></label>
            <label>SETTLEMENT<input className="cd-inp" type="date" value={form.settlement} onChange={e => setForm({ ...form, settlement: e.target.value })} /></label>
            <label>FORWARD PRICE K<input className="cd-inp" type="number" step="any" placeholder="at the fair forward" value={form.strike} onChange={e => setForm({ ...form, strike: e.target.value })} /></label>
            <label>SPOT OVERRIDE<input className="cd-inp" type="number" step="any" placeholder={spotOf(form.asset)?.spot ? fmt(spotOf(form.asset).spot) : 'snap first'} value={form.spot} onChange={e => setForm({ ...form, spot: e.target.value })} /></label>
            <label>FUNDING OVERRIDE %<input className="cd-inp" type="number" step="any" placeholder="saved rate" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} /></label>
            <div className="cd-actions"><button className="cd-btn primary" onClick={price} disabled={!!busy}>{busy === 'price' ? 'PRICING…' : 'PRICE'}</button></div>
          </div>
          {quote && (
            <div className="cd-quote">
              <div><span>FAIR FORWARD</span><b>{fmt(quote.forward)}</b></div>
              <div><span>NPV (USD)</span><b className={quote.npv >= 0 ? 'pos' : 'neg'}>{fmt(quote.npv)}</b></div>
              <div><span>SPOT</span><b>{fmt(quote.spot)}</b><i>{quote.spot_source}</i></div>
              <div><span>IMPLIED BASIS</span><b>{fmt(quote.implied_basis * 100)}%</b><i>annualised</i></div>
              <div><span>DF<sub>USD</sub>(T)</span><b>{fmt(quote.df_usd, 6)}</b><i>T = {fmt(quote.t, 4)}y{quote.usd_curve_snapshot ? ` · snap ${quote.usd_curve_snapshot}` : ''}</i></div>
              <div><span>FUNDING</span><b>{fmt(quote.asset_rate_pct)}%</b><i>{quote.asset_rate_source}</i></div>
              <div><span>DELTA / +1% SPOT</span><b>{fmt(quote.delta_usd_per_pct)}</b><i>≈ {fmt(quote.delta_asset_units, 4)} {form.asset}</i></div>
              <div><span>RHO USD / +1BP</span><b>{fmt(quote.rho_usd_per_bp)}</b></div>
            </div>
          )}
          <div className="cd-book">
            <label>OWN ENTITY<select className="cd-inp" value={book.own} onChange={e => setBook({ ...book, own: e.target.value })}>{entities.map(e => <option key={e.id} value={e.id}>{e.name}{e.lei ? ` · ${e.lei}` : ''}</option>)}</select></label>
            <label>COUNTERPARTY<select className="cd-inp" value={book.cp} onChange={e => setBook({ ...book, cp: e.target.value })}>{cps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <button className="cd-btn amber" onClick={bookTrade} disabled={!!busy || !quote}>{busy === 'book' ? 'BOOKING…' : 'BOOK AS TRADE'}</button>
          </div>
          {own && !own.lei && <div className="cd-note warn">Your entity has no LEI; the on-chain record needs one. Set it under Legal entities.</div>}
        </section>
      </div>

      <section className="cd-card">
        <h2>CRYPTO FORWARDS IN THIS BOOK</h2>
        {trades.length === 0 ? <div className="cd-empty">No crypto forwards yet. Price one above and book it; it appears here and in the blotter.</div> : (
          <table className="cd-table">
            <thead><tr><th>REF</th><th>SIDE</th><th>ASSET</th><th>NOTIONAL</th><th>K (USD)</th><th>SETTLES</th><th>COUNTERPARTY</th><th>STATUS</th><th></th></tr></thead>
            <tbody>{trades.map(t => (
              <tr key={t.id}>
                <td className="cd-mono">{t.trade_ref}</td>
                <td>{t.terms?.direction || '—'}</td>
                <td className="cd-asset">{t.terms?.digital_asset || t.notional_ccy}</td>
                <td className="cd-num">{fmt(t.terms?.notional_amount ?? t.notional, 4)}</td>
                <td className="cd-num">{fmt(t.terms?.forward_price)}</td>
                <td className="cd-dim">{t.terms?.settlement_date || t.maturity_date}</td>
                <td className="cd-dim">{t.counterparty?.name || '—'}</td>
                <td><span className={`cd-status ${String(t.status).toLowerCase()}`}>{t.status}</span></td>
                <td className="cd-row-actions">
                  <button className="cd-btn sm" onClick={() => priceBooked(t)} disabled={!!busy}>PRICE</button>
                  {t.status !== 'CONFIRMED' && <button className="cd-btn sm amber" onClick={() => confirm(t)} disabled={!!busy}>{busy === 'confirm' + t.id ? 'SIGNING…' : 'CONFIRM ON SEPOLIA'}</button>}
                  {t.status === 'CONFIRMED' && <button className="cd-btn sm" onClick={() => verify(t)} disabled={!!busy}>{busy === 'verify' + t.id ? '…' : 'VERIFY'}</button>}
                </td>
              </tr>))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
