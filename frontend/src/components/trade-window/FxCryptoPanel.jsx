// FX and digital-asset leg of the NEW TRADE window: spot / forward / NDF on a
// currency pair or a crypto forward, priced on interest-rate parity by
// /api/currency/forward/price. The window owns the counterparty, book and
// footer buttons; it calls price() and payload() on this panel through a ref.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { getSessionSafe } from '../../lib/session'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const CRYPTO_BASES = ['BTC', 'ETH', 'SOL']
const fmt = (n, d = 2) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
const rateDp = (pair) => !pair ? 2 : CRYPTO_BASES.includes(pair.slice(0, 3)) ? 2 : pair === 'USDJPY' ? 3 : 5
const iso = (d) => d.toISOString().slice(0, 10)
const plusMonths = (m) => { const d = new Date(); d.setMonth(d.getMonth() + m); return iso(d) }
export const SHAPE_OF = { FX_SPOT: 'SPOT', FX_FORWARD: 'FORWARD', NDF: 'NDF', CRYPTO_FORWARD: 'NDF' }

async function call(path, opts = {}) {
  const session = await getSessionSafe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.detail ? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)) : `${r.status}`)
  return body
}

const lbl = { fontSize: '0.75rem', letterSpacing: '0.1em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 3, fontFamily: 'var(--mono)' }
const inp = { width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border-hi)', borderRadius: 3, color: 'var(--text-hi)', fontFamily: 'var(--mono)', fontSize: '0.95rem', padding: '7px 9px', outline: 'none', boxSizing: 'border-box' }
const Fld = ({ label, flex = 1, children }) => <div style={{ flex, minWidth: 0 }}><div style={lbl}>{label}</div>{children}</div>
const Row = ({ children }) => <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>{children}</div>

const FxCryptoPanel = forwardRef(function FxCryptoPanel({ ac, inst, onPriced, onError }, ref) {
  const crypto = ac === 'CRYPTO'
  const shape = SHAPE_OF[inst] || 'FORWARD'
  const [pairs, setPairs] = useState([])
  const [feeds, setFeeds] = useState(null)
  const [pair, setPair] = useState(crypto ? 'BTCUSD' : 'EURUSD')
  const [notional, setNotional] = useState(crypto ? 10 : 10_000_000)
  const [settlement, setSettlement] = useState(plusMonths(3))
  const [direction, setDirection] = useState('BUY')
  const [strike, setStrike] = useState('')
  const [spotOv, setSpotOv] = useState('')
  const [fundOv, setFundOv] = useState('')
  const [quote, setQuote] = useState(null)
  const [busy, setBusy] = useState('')

  useEffect(() => { setPair(crypto ? 'BTCUSD' : 'EURUSD'); setNotional(crypto ? 10 : 10_000_000); setQuote(null) }, [crypto])
  useEffect(() => { setQuote(null) }, [inst, pair, direction, notional, settlement, strike, spotOv, fundOv])

  const load = async () => {
    try { const m = await call('/api/currency/pairs'); setPairs(m.pairs || []); setFeeds(m.feeds || null) } catch (e) { onError?.(e.message) }
  }
  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const cur = useMemo(() => pairs.find(p => p.pair === pair), [pairs, pair])
  const list = pairs.filter(p => !!p.crypto === crypto)

  const snap = async () => {
    setBusy('snap')
    try { await call('/api/currency/spot/snap', { method: 'POST' }); await load() } catch (e) { onError?.(e.message) } finally { setBusy('') }
  }

  const price = async () => {
    setBusy('price'); setQuote(null)
    try {
      const body = { pair, shape, base_notional: Number(notional), direction }
      if (shape !== 'SPOT') body.settlement_date = settlement
      if (strike !== '') body.forward_rate = Number(strike)
      if (spotOv !== '') body.spot = Number(spotOv)
      if (fundOv !== '' && crypto) body.base_rate_pct = Number(fundOv)
      const q = await call('/api/currency/forward/price', { method: 'POST', body: JSON.stringify(body) })
      setQuote(q); onPriced?.(q); return q
    } catch (e) { onError?.(e.message); return null } finally { setBusy('') }
  }

  // The trade POST body minus what the window owns (parties, dates, desk, book).
  const payload = () => {
    if (!quote || !cur) throw new Error('Price it first')
    const K = strike !== '' ? Number(strike) : quote.forward
    const settle = quote.settlement_date
    if (crypto) return {
      asset_class: 'CRYPTO', instrument_type: 'CRYPTO_FORWARD', structure: 'VANILLA',
      notional: Number(notional), notional_ccy: cur.base, maturity_date: settle, discount_curve_id: cur.quote_curve,
      terms: {
        digital_asset: cur.base, notional_amount: String(notional), direction, forward_price: String(K), price_currency: 'USD',
        valuation_date: settle, valuation_time: '16:00 London', settlement_date: settle, settlement_currency: 'USD',
        settlement_price_source: cur.fixing_default, calculation_agent: null,
        disruption_fallback: 'ISDA Digital Asset Derivatives Definitions fallbacks',
      },
    }
    const ndf = shape === 'NDF'
    return {
      asset_class: 'FX', instrument_type: inst, structure: 'VANILLA',
      notional: Number(notional), notional_ccy: cur.base, maturity_date: settle, discount_curve_id: cur.quote_curve,
      terms: {
        direction, currency_pair: pair, base_currency: cur.base, quote_currency: cur.quote,
        base_notional: String(notional), forward_rate: String(K), value_date: settle,
        settlement_type: ndf ? 'NON_DELIVERABLE' : 'DELIVERABLE',
        ...(ndf ? { settlement_currency: 'USD', fixing_source: cur.fixing_default, fixing_date: settle } : {}),
        calculation_agent: null,
      },
    }
  }
  useImperativeHandle(ref, () => ({ price, payload, quote: () => quote, busy: () => busy }), [quote, busy, pair, notional, settlement, direction, strike, spotOv, fundOv, cur, inst])

  const hdr = (t) => <div style={{ ...lbl, color: 'var(--accent)', margin: '12px 0 6px', fontSize: '0.72rem', letterSpacing: '0.18em' }}>{t}</div>

  return (
    <div>
      {hdr('PRIMARY ECONOMICS')}
      <Row>
        <Fld label='PAIR' flex={1.3}>
          <select style={inp} value={pair} onChange={e => setPair(e.target.value)}>
            {list.map(p => <option key={p.pair} value={p.pair}>{p.pair}</option>)}
          </select>
        </Fld>
        <Fld label={`NOTIONAL (${cur?.base || 'BASE'})`} flex={1.6}>
          <input style={{ ...inp, fontSize: '1.05rem', fontWeight: 700 }} type='number' min='0' step='any' value={notional} onChange={e => setNotional(e.target.value)} />
        </Fld>
        <Fld label={`DIRECTION (${cur?.base || 'BASE'})`} flex={1.4}>
          <div style={{ display: 'flex', gap: 5 }}>
            {['BUY', 'SELL'].map(d => <button key={d} onClick={() => setDirection(d)} style={{ flex: 1, padding: '7px 0', borderRadius: 3, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '0.8rem', letterSpacing: '0.08em', border: '1px solid ' + (direction === d ? (d === 'BUY' ? 'var(--accent)' : 'var(--red)') : 'var(--border-hi)'), background: direction === d ? (d === 'BUY' ? 'rgba(13,212,168,.15)' : 'rgba(224,80,64,.15)') : 'transparent', color: direction === d ? (d === 'BUY' ? 'var(--accent)' : 'var(--red)') : 'var(--text-dim)' }}>{d} {cur?.base || ''}</button>)}
          </div>
        </Fld>
        <Fld label={shape === 'SPOT' ? 'VALUE DATE' : 'SETTLEMENT'} flex={1.3}>
          <input style={{ ...inp, opacity: shape === 'SPOT' ? .6 : 1 }} type='date' value={shape === 'SPOT' ? (quote?.settlement_date || '') : settlement} disabled={shape === 'SPOT'} onChange={e => setSettlement(e.target.value)} placeholder='T+2' />
        </Fld>
      </Row>
      <Row>
        <Fld label={`RATE K (${cur?.quote || 'QUOTE'} PER ${cur?.base || 'BASE'})`} flex={1.3}>
          <input style={inp} type='number' step='any' placeholder='at the fair forward' value={strike} onChange={e => setStrike(e.target.value)} />
        </Fld>
        <Fld label={`SPOT ${cur?.spot_as_of ? '· ' + cur.spot_as_of : ''}`} flex={1.3}>
          <input style={inp} type='number' step='any' placeholder={cur?.spot ? fmt(cur.spot, rateDp(pair)) : 'snap first'} value={spotOv} onChange={e => setSpotOv(e.target.value)} />
        </Fld>
        {crypto
          ? <Fld label={`${cur?.base || 'ASSET'} FUNDING % ${cur?.funding_pct != null ? '· ' + cur.funding_pct + '% saved' : '· 0% default'}`} flex={1.3}><input style={inp} type='number' step='any' placeholder='saved rate' value={fundOv} onChange={e => setFundOv(e.target.value)} /></Fld>
          : <Fld label='DISCOUNTING' flex={1.3}><div style={{ ...inp, border: '1px solid var(--border)', color: cur?.base_curve_available ? 'var(--text)' : 'var(--amber)', fontSize: '0.78rem' }} title={cur?.base_fallback || ''}>{cur ? (cur.base_curve_available ? `${cur.base_curve} / ${cur.quote_curve}` : `${cur.base_fallback} / ${cur.quote_curve}`) : '—'}</div></Fld>}
        <Fld label='MARKET DATA' flex={1}>
          <button onClick={snap} disabled={!!busy} style={{ ...inp, cursor: 'pointer', color: 'var(--accent)', borderColor: 'var(--accent-dim)', textAlign: 'center', letterSpacing: '0.1em', fontSize: '0.78rem' }}>{busy === 'snap' ? 'SNAPPING…' : '● SNAP SPOT'}</button>
        </Fld>
      </Row>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', fontFamily: 'var(--mono)' }}>
        {crypto ? `Spot: ${feeds?.crypto || 'Coinbase (public)'} · funding is a desk input` : `Spot: ${feeds?.fx || 'ECB reference rates (public)'}`} · F = S·DF<sub>base</sub>/DF<sub>quote</sub> · NPV = ±N·(F − K)·DF<sub>quote</sub> · {shape}
      </div>

      {quote && (<>
        {hdr('ANALYTICS')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[
            [shape === 'SPOT' ? 'FAIR SPOT (T+2)' : 'FAIR FORWARD', fmt(quote.forward, rateDp(pair)), shape === 'SPOT' ? '' : `${fmt(quote.forward_points, crypto ? 2 : 1)} ${crypto ? quote.quote_currency : 'pts'}`],
            [`NPV (${quote.quote_currency})`, fmt(quote.npv), `settles ${quote.settlement_date}`, quote.npv >= 0 ? 'var(--green)' : 'var(--red)'],
            ['SPOT', fmt(quote.spot, rateDp(pair)), quote.spot_source],
            ['IMPLIED CARRY', `${fmt(quote.implied_carry * 100)}%`, 'annualised'],
            [`DF ${quote.quote_currency} / ${quote.base_currency}`, `${fmt(quote.df_quote, 5)} / ${fmt(quote.df_base, 5)}`, `T = ${fmt(quote.t, 4)}y · ${quote.base_discounting}`],
            [`ZEROS ${quote.quote_currency} / ${quote.base_currency}`, `${fmt(quote.quote_rate * 100)}% / ${fmt(quote.base_rate * 100)}%`, 'continuous to T'],
            ['DELTA / +1% SPOT', fmt(quote.delta_quote_per_pct), `≈ ${fmt(quote.delta_base_units, crypto ? 4 : 0)} ${quote.base_currency}`],
            [`RHO ${quote.base_currency} / ${quote.quote_currency} (+1BP)`, `${fmt(quote.rho_base_per_bp)} / ${fmt(quote.rho_quote_per_bp)}`, ''],
          ].map(([k, v, s, c], i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '7px 9px', background: 'var(--bg-deep)' }}>
              <div style={{ ...lbl, fontSize: '0.62rem', marginBottom: 2 }}>{k}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '1rem', color: c || 'var(--text-hi)' }}>{v}</div>
              {s && <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{s}</div>}
            </div>
          ))}
        </div>
      </>)}
    </div>
  )
})

export default FxCryptoPanel
