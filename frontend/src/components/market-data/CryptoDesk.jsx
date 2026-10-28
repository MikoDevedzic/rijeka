// FX & CRYPTO — one desk for currency pairs and digital assets: spot and
// funding, a spot / forward / NDF pricer on interest-rate parity, booking,
// and the on-chain confirm / verify loop. EURUSD and BTCUSD sit in the same
// dropdown and go through the same formula and the same registry.
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const [entities, setEntities] = useState([])
  const [cps, setCps] = useState([])
  const [trades, setTrades] = useState([])
  const [funding, setFunding] = useState({})

  const [form, setForm] = useState({ pair: 'EURUSD', shape: 'FORWARD', notional: 10_000_000, settlement: plusMonths(3), direction: 'BUY', strike: '', spot: '', rate: '' })
  const [book, setBook] = useState({ own: '', cp: '' })
  const [quote, setQuote] = useState(null)

  const flash = (kind, text) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 7000) }
  const pairs = md?.pairs || []
  const pairOf = (p) => pairs.find(x => x.pair === p)
  const cur = pairOf(form.pair)
  const isCrypto = !!cur?.crypto

  const load = useCallback(async () => {
    const [m, e, c, t] = await Promise.all([
      call('/api/currency/pairs'), call('/api/legal-entities/'), call('/api/counterparties/'), call('/api/trades/'),
    ])
    setMd(m); setEntities(e || []); setCps(c || [])
    setTrades((t || []).filter(x => ['FX_SPOT', 'FX_FORWARD', 'NDF', 'CRYPTO_FORWARD'].includes(x.instrument_type)))
    const f = {}; (m?.pairs || []).filter(p => p.crypto).forEach(p => { f[p.base] = p.funding_pct ?? '' }); setFunding(f)
    setBook(b => ({ own: b.own || (e?.[0]?.id || ''), cp: b.cp || (c?.[0]?.id || '') }))
  }, [])
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
  const price = async () => {
    setBusy('price'); setQuote(null)
    try {
      const body = { pair: form.pair, shape: form.shape, base_notional: Number(form.notional), direction: form.direction }
      if (form.shape !== 'SPOT') body.settlement_date = form.settlement
      if (form.strike !== '') body.forward_rate = Number(form.strike)
      if (form.spot !== '') body.spot = Number(form.spot)
      if (form.rate !== '' && isCrypto) body.base_rate_pct = Number(form.rate)
      setQuote(await call('/api/currency/forward/price', { method: 'POST', body: JSON.stringify(body) }))
    } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const bookTrade = async () => {
    if (!quote) return flash('err', 'Price it first')
    if (!book.own || !book.cp) return flash('err', 'Pick your entity and a counterparty')
    setBusy('book')
    try {
      const K = form.strike !== '' ? Number(form.strike) : quote.forward
      const settle = quote.settlement_date
      const today = iso(new Date())
      let payload
      if (isCrypto) {
        payload = {
          asset_class: 'CRYPTO', instrument_type: 'CRYPTO_FORWARD', structure: 'VANILLA',
          notional: Number(form.notional), notional_ccy: cur.base, maturity_date: settle, desk: 'DIGITAL', book: 'CRYPTO',
          terms: {
            digital_asset: cur.base, notional_amount: String(form.notional), direction: form.direction,
            forward_price: String(K), price_currency: 'USD', valuation_date: settle, valuation_time: '16:00 London',
            settlement_date: settle, settlement_currency: 'USD', settlement_price_source: cur.fixing_default,
            calculation_agent: null, disruption_fallback: 'ISDA Digital Asset Derivatives Definitions fallbacks',
          },
        }
      } else {
        const ndf = form.shape === 'NDF'
        payload = {
          asset_class: 'FX', instrument_type: form.shape === 'SPOT' ? 'FX_SPOT' : ndf ? 'NDF' : 'FX_FORWARD', structure: 'VANILLA',
          notional: Number(form.notional), notional_ccy: cur.base, maturity_date: settle, desk: 'FX', book: 'G10',
          terms: {
            direction: form.direction, currency_pair: form.pair, base_currency: cur.base, quote_currency: cur.quote,
            base_notional: String(form.notional), forward_rate: String(K), value_date: settle,
            settlement_type: ndf ? 'NON_DELIVERABLE' : 'DELIVERABLE',
            ...(ndf ? { settlement_currency: 'USD', fixing_source: cur.fixing_default, fixing_date: settle } : {}),
            calculation_agent: null,
          },
        }
      }
      const t = await call('/api/trades/', { method: 'POST', body: JSON.stringify({
        ...payload, own_legal_entity_id: book.own, counterparty_id: book.cp,
        trade_date: today, effective_date: today, discount_curve_id: cur.quote_curve,
      }) })
      flash('ok', `Booked ${t.trade_ref}: ${form.direction} ${fmt(form.notional, 0)} ${cur.base} vs ${cur.quote} at ${fmt(K, rateDp(form.pair))}, settling ${settle}`)
      await load()
    } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }
  const confirm = async (t) => {
    setBusy('confirm' + t.id)
    try {
      const key = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
      await call(`/api/chain/confirm/${t.id}`, { method: 'POST', headers: { 'Idempotency-Key': key } })
      flash('ok', `${t.trade_ref} confirmed on Sepolia`); await load()
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
      const r = await call('/price', { method: 'POST', body: JSON.stringify({ trade_id: t.id, curves: [{ curve_id: t.discount_curve_id || 'USD_SOFR' }] }) })
      flash('ok', `${t.trade_ref}: NPV ${fmt(r.npv)} ${r.quote_currency} · fair ${fmt(r.forward, rateDp(r.pair))} · spot ${fmt(r.spot, rateDp(r.pair))} (${r.spot_source})`)
    } catch (e) { flash('err', e.message) } finally { setBusy('') }
  }

  const own = useMemo(() => entities.find(e => e.id === book.own), [entities, book.own])
  const pairLabel = (t) => t.terms?.currency_pair || (t.terms?.digital_asset ? `${t.terms.digital_asset}USD` : t.notional_ccy)

  return (
    <div className="cd">
      <div className="cd-head">
        <div>
          <div className="cd-eyebrow">FX &amp; CRYPTO · ONE MODEL</div>
          <h1>Currency pairs and digital assets, priced the same way</h1>
          <p>EURUSD and BTCUSD go through one formula: interest-rate parity, F = S·DF<sub>base</sub>/DF<sub>quote</sub>, NPV = ±N<sub>base</sub>·(F − K)·DF<sub>quote</sub>. Each currency discounts off its own OIS curve; a digital asset discounts at its funding rate. Spot, deliverable forward or NDF, then book, confirm on Sepolia, verify.</p>
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
                  <td className="cd-dim">{p.crypto ? `${p.base} funding ${p.funding_pct ?? 0}% · ${p.quote_curve}` : `${p.base_curve} / ${p.quote_curve}`}</td>
                  <td>{p.crypto && <span className="cd-fund"><input className="cd-inp sm" value={funding[p.base] ?? ''} placeholder="0.00" onChange={e => setFunding({ ...funding, [p.base]: e.target.value })} /><button className="cd-btn sm" onClick={() => saveFunding(p.base)} disabled={!!busy}>{busy === 'fund' + p.base ? '…' : 'SET'}</button></span>}</td>
                </tr>))}
            </tbody>
          </table>
          <div className="cd-note">FX: {md?.feeds?.fx || 'ECB reference rates (public)'} · Crypto: {md?.feeds?.crypto || 'Coinbase spot (public)'} · funding is a desk input (% p.a., continuous).</div>
        </section>

        <section className="cd-card">
          <h2>PRICE</h2>
          <div className="cd-form">
            <label>PAIR<select className="cd-inp" value={form.pair} onChange={e => setForm({ ...form, pair: e.target.value, notional: pairOf(e.target.value)?.crypto ? 10 : 10_000_000 })}>
              <optgroup label="FX">{pairs.filter(p => !p.crypto).map(p => <option key={p.pair}>{p.pair}</option>)}</optgroup>
              <optgroup label="Digital assets">{pairs.filter(p => p.crypto).map(p => <option key={p.pair}>{p.pair}</option>)}</optgroup>
            </select></label>
            <label>SHAPE<select className="cd-inp" value={form.shape} onChange={e => setForm({ ...form, shape: e.target.value })}>
              <option value="SPOT">SPOT</option><option value="FORWARD">FORWARD</option><option value="NDF">NDF</option></select></label>
            <label>DIRECTION ({cur?.base || 'BASE'})<select className="cd-inp" value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}><option>BUY</option><option>SELL</option></select></label>
            <label>NOTIONAL ({cur?.base || 'BASE'})<input className="cd-inp" type="number" min="0" step="any" value={form.notional} onChange={e => setForm({ ...form, notional: e.target.value })} /></label>
            <label>{form.shape === 'SPOT' ? 'VALUE DATE (T+2)' : 'SETTLEMENT'}<input className="cd-inp" type="date" value={form.settlement} disabled={form.shape === 'SPOT'} onChange={e => setForm({ ...form, settlement: e.target.value })} /></label>
            <label>RATE K ({cur?.quote || 'QUOTE'} PER {cur?.base || 'BASE'})<input className="cd-inp" type="number" step="any" placeholder="at the fair forward" value={form.strike} onChange={e => setForm({ ...form, strike: e.target.value })} /></label>
            <label>SPOT OVERRIDE<input className="cd-inp" type="number" step="any" placeholder={cur?.spot ? fmt(cur.spot, rateDp(form.pair)) : 'snap first'} value={form.spot} onChange={e => setForm({ ...form, spot: e.target.value })} /></label>
            {isCrypto && <label>FUNDING OVERRIDE %<input className="cd-inp" type="number" step="any" placeholder="saved rate" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} /></label>}
            <div className="cd-actions"><button className="cd-btn primary" onClick={price} disabled={!!busy}>{busy === 'price' ? 'PRICING…' : 'PRICE'}</button></div>
          </div>
          {quote && (
            <div className="cd-quote">
              <div><span>FAIR {quote.shape === 'SPOT' ? 'SPOT (T+2)' : 'FORWARD'}</span><b>{fmt(quote.forward, rateDp(quote.pair))}</b><i>{quote.shape === 'SPOT' ? '' : `${fmt(quote.forward_points, isCrypto ? 2 : 1)} ${isCrypto ? quote.quote_currency : 'pts'}`}</i></div>
              <div><span>NPV ({quote.quote_currency})</span><b className={quote.npv >= 0 ? 'pos' : 'neg'}>{fmt(quote.npv)}</b><i>settles {quote.settlement_date}</i></div>
              <div><span>SPOT</span><b>{fmt(quote.spot, rateDp(quote.pair))}</b><i>{quote.spot_source}</i></div>
              <div><span>IMPLIED CARRY</span><b>{fmt(quote.implied_carry * 100)}%</b><i>annualised</i></div>
              <div><span>DF<sub>{quote.quote_currency}</sub> / DF<sub>{quote.base_currency}</sub></span><b>{fmt(quote.df_quote, 5)} / {fmt(quote.df_base, 5)}</b><i>T = {fmt(quote.t, 4)}y · {quote.base_discounting}</i></div>
              <div><span>ZEROS {quote.quote_currency} / {quote.base_currency}</span><b>{fmt(quote.quote_rate * 100)}% / {fmt(quote.base_rate * 100)}%</b><i>continuous to T</i></div>
              <div><span>DELTA / +1% SPOT</span><b>{fmt(quote.delta_quote_per_pct)}</b><i>≈ {fmt(quote.delta_base_units, isCrypto ? 4 : 0)} {quote.base_currency}</i></div>
              <div><span>RHO {quote.base_currency} / {quote.quote_currency} (+1BP)</span><b>{fmt(quote.rho_base_per_bp)} / {fmt(quote.rho_quote_per_bp)}</b></div>
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
        <h2>FX &amp; CRYPTO TRADES IN THIS BOOK</h2>
        {trades.length === 0 ? <div className="cd-empty">Nothing yet. Price a pair above and book it; it appears here and in the blotter.</div> : (
          <table className="cd-table">
            <thead><tr><th>REF</th><th>TYPE</th><th>SIDE</th><th>PAIR</th><th>NOTIONAL</th><th>RATE</th><th>SETTLES</th><th>COUNTERPARTY</th><th>STATUS</th><th></th></tr></thead>
            <tbody>{trades.map(t => (
              <tr key={t.id}>
                <td className="cd-mono">{t.trade_ref}</td>
                <td className="cd-dim">{t.instrument_type}</td>
                <td>{t.terms?.direction || '—'}</td>
                <td className="cd-asset">{pairLabel(t)}</td>
                <td className="cd-num">{fmt(t.terms?.base_notional ?? t.terms?.notional_amount ?? t.notional, t.instrument_type === 'CRYPTO_FORWARD' ? 4 : 0)}</td>
                <td className="cd-num">{fmt(t.terms?.forward_rate ?? t.terms?.forward_price, rateDp(pairLabel(t)))}</td>
                <td className="cd-dim">{t.terms?.value_date || t.terms?.settlement_date || t.maturity_date}</td>
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
