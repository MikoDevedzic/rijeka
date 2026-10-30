// FX and digital-asset leg of the NEW TRADE window: spot / forward / NDF on a
// currency pair or a crypto forward, priced on interest-rate parity by
// /api/currency/forward/price. The window owns the counterparty, book and
// footer buttons; it calls price() and payload() on this panel through a ref.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { getSessionSafe } from '../../lib/session'
import { AnalyticsBlock } from './sections'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const CRYPTO_BASES = ['BTC', 'ETH', 'SOL']
const fmt = (n, d = 2) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
const rateDp = (pair) => !pair ? 2 : CRYPTO_BASES.includes(pair.slice(0, 3)) ? 2 : pair === 'USDJPY' ? 3 : 5
const iso = (d) => d.toISOString().slice(0, 10)
const TENORS = ['1W', '2W', '1M', '2M', '3M', '6M', '9M', '1Y', '18M', '2Y']
const tenorDate = (t) => { const d = new Date(); const n = parseInt(t); if (t.endsWith('W')) d.setDate(d.getDate() + 7 * n); else if (t.endsWith('M')) d.setMonth(d.getMonth() + n); else d.setFullYear(d.getFullYear() + n); return iso(d) }
const fmtAmt = (v, crypto) => { const n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? '' : n.toLocaleString('en-US', { maximumFractionDigits: crypto ? 8 : 0 }) }
const parseAmt = (v) => { const n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? '' : n }
import { SHAPE_OF } from './fx-shape'
const plusMonths = (m) => { const d = new Date(); d.setMonth(d.getMonth() + m); return iso(d) }

async function call(path, opts = {}) {
  const session = await getSessionSafe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.detail ? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)) : `${r.status}`)
  return body
}

const lbl = { fontSize: '0.75rem', letterSpacing: '0.1em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 3, fontFamily: 'var(--mono)' }
const Fld = ({ label, flex = 1, children }) => <div style={{ flex, minWidth: 0 }}><div style={lbl}>{label}</div>{children}</div>
const Row = ({ children }) => <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>{children}</div>

const FxCryptoPanel = forwardRef(function FxCryptoPanel({ ac, inst, onPriced, onError }, ref) {
  const crypto = ac === 'CRYPTO'
  const shape = SHAPE_OF[inst] || 'FORWARD'
  const [pairs, setPairs] = useState([])
  const [feeds, setFeeds] = useState(null)
  const [pair, setPair] = useState(crypto ? 'BTCUSD' : 'EURUSD')
  const [notional, setNotional] = useState(crypto ? 10 : 10_000_000)
  const [tenor, setTenor] = useState('3M')
  const [settlement, setSettlement] = useState(plusMonths(3))
  const [direction, setDirection] = useState('BUY')
  const [strike, setStrike] = useState('')
  const [spotOv, setSpotOv] = useState('')
  const [fundOv, setFundOv] = useState('')
  const [quote, setQuote] = useState(null)
  const [busy, setBusy] = useState('')

  useEffect(() => { setPair(crypto ? 'BTCUSD' : 'EURUSD'); setNotional(crypto ? 10 : 10_000_000); setQuote(null) }, [crypto])
  useEffect(() => { setQuote(null) }, [inst, pair, direction, notional, settlement, tenor, strike, spotOv, fundOv])

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

  // ── render: the same sections, labels and cards as the rates ticket ──────────
  const dp = rateDp(pair)
  const qc = cur?.quote || 'USD'
  const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }
  const money = (v) => v == null || isNaN(v) ? '—' : (v >= 0 ? '+' : '−') + (SYM[qc] ?? (qc + ' ')) + Math.abs(Math.round(v)).toLocaleString('en-US')
  const sgn = (v) => v == null || isNaN(v) ? null : (v >= 0 ? 'positive' : 'negative')
  const spot01 = (r) => r.spot01 ?? r.delta_quote_per_pct
  const ir01 = (r) => r.ir01 ?? (r.rho_base_per_bp + r.rho_quote_per_bp)
  const effDate = (() => { const d = new Date(); let n = crypto ? 0 : 2; while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n-- } return iso(d) })()
  const ndf = shape === 'NDF'
  const descriptor = { analytics: {
    metrics: (r) => [
      { label: 'NET NPV', value: money(r.npv), colorBy: sgn(r.npv) },
      { label: `${crypto ? r.base_currency : 'FX'}01`, value: money(spot01(r)), colorBy: sgn(spot01(r)) },
      { label: 'IR01', value: money(ir01(r)), colorBy: sgn(ir01(r)) },
      { label: 'IR01 DISC', value: money(r.ir01_disc ?? r.rho_quote_per_bp), colorBy: sgn(r.ir01_disc ?? r.rho_quote_per_bp) },
      { label: 'THETA', value: money(r.theta), colorBy: sgn(r.theta) },
    ],
    breakdown: (r) => ({ kind: 'market', columns: ['ITEM', 'VALUE', 'NOTE'], rows: [
      ['SPOT', fmt(r.spot, dp), r.spot_source || ''],
      ['FAIR FORWARD', fmt(r.forward, dp), `${fmt(r.forward_points, crypto ? 2 : 1)} ${crypto ? qc : 'pts'} · ${r.forward_mode === 'MARKET' && r.market_points != null ? 'quoted points' : crypto ? 'implied from funding' : 'implied from yields'}${r.forward_source ? ' · ' + r.forward_source : ''}`],
      ['PARITY FORWARD', fmt(r.implied_forward, dp), r.basis_points != null ? `basis ${fmt(r.basis_points, crypto ? 2 : 1)} ${crypto ? qc : 'pts'} vs quoted` : 'no quoted points'],
      [`DF ${qc} / ${r.base_currency}`, `${fmt(r.df_quote, 5)} / ${fmt(r.df_base, 5)}`, `T = ${fmt(r.t, 4)}y · ${r.base_discounting || ''}`],
      [`ZEROS ${qc} / ${r.base_currency}`, `${fmt(r.quote_rate * 100)}% / ${fmt(r.base_rate * 100)}%`, 'continuous to T'],
      ['IMPLIED CARRY', `${fmt(r.implied_carry * 100)}%`, 'annualised'],
      [crypto ? 'FUND01' : `IR01 BASE (${r.base_currency})`, money(r.ir01_base ?? r.rho_base_per_bp), crypto ? '+1 bp on the funding rate' : `+1 bp on the ${r.base_currency} curve`],
      ['MODEL', crypto ? 'F = S·e^(−r·T) / DF_quote' : 'F = S·DF_base / DF_quote', `NPV = ±N·(F − K)·DF_quote · ACT/365 · ${ndf || crypto ? 'cash-settled' : 'deliverable'}`],
    ] }),
  } }

  return (
    <>
      <div className="tbw-sec">
        <div className="tbw-lbl">PRIMARY ECONOMICS</div>
        <div className="tbw-grid-6">
          <div><div className="tbw-lbl">PAIR</div>
            <select value={pair} onChange={e => setPair(e.target.value)}>
              {list.map(p => <option key={p.pair} value={p.pair}>{p.pair}</option>)}
            </select>
          </div>
          <div><div className="tbw-lbl">NOTIONAL · {cur?.base || 'BASE'}</div>
            <input className="tbw-mono" type="text" inputMode="decimal" value={fmtAmt(notional, crypto)} placeholder={crypto ? '10' : '10,000,000'}
                   onChange={e => { const v = parseAmt(e.target.value); if (v !== '') setNotional(v); else if (e.target.value === '') setNotional('') }} />
          </div>
          <div><div className="tbw-lbl">DIRECTION</div>
            <div className="tbw-chip-row" style={{ gap: 4 }}>
              {['BUY', 'SELL'].map(d => (
                <button key={d} className={`tbw-chip ${direction === d ? 'is-on' : ''}`} onClick={() => setDirection(d)}>{d} {cur?.base || ''}</button>
              ))}
            </div>
          </div>
          <div><div className="tbw-lbl">TENOR</div>
            <select value={shape === 'SPOT' ? 'SPOT' : tenor} disabled={shape === 'SPOT'} onChange={e => { setTenor(e.target.value); setSettlement(tenorDate(e.target.value)) }}>
              {shape === 'SPOT' && <option value="SPOT">SPOT</option>}{TENORS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><div className="tbw-lbl">EFF DATE <span className="tbw-mut">· {crypto ? 'T+0' : 'SPOT T+2'}</span></div>
            <input type="date" value={effDate} readOnly />
          </div>
          <div><div className="tbw-lbl">MAT DATE <span className="tbw-mut">· {shape === 'SPOT' ? 'VALUE' : ndf || crypto ? 'SETTLEMENT' : 'VALUE'}</span></div>
            <input type="date" value={shape === 'SPOT' ? (quote?.settlement_date || effDate) : settlement} disabled={shape === 'SPOT'} onChange={e => setSettlement(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="tbw-sec">
        <div className="tbw-terms-header">
          <span className="tbw-lbl">FORWARD TERMS</span>
          <span className="tbw-helper-badge">→ {crypto ? `cash-settled in ${qc} · funding is a desk input` : ndf ? `non-deliverable · cash-settled in ${qc}` : shape === 'SPOT' ? 'spot · T+2 delivery' : 'deliverable · both principals exchange'}</span>
        </div>
        <div className="tbw-grid-6">
          <div><div className="tbw-lbl">{crypto ? 'PRICE K' : 'RATE K'} <span className="tbw-mut">· {qc} per {cur?.base || 'base'}</span></div>
            <input className="tbw-mono" type="text" inputMode="decimal" placeholder="at the fair forward" value={strike} onChange={e => setStrike(e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
          <div><div className="tbw-lbl">SPOT <span className="tbw-mut">· {cur?.spot_as_of || 'not snapped'}</span></div>
            <input className="tbw-mono" type="text" inputMode="decimal" placeholder={cur?.spot ? fmt(cur.spot, dp) : 'snap first'} value={spotOv} onChange={e => setSpotOv(e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
          {crypto ? (
            <div><div className="tbw-lbl">{cur?.base || 'ASSET'} FUNDING % <span className="tbw-mut">· {cur?.funding_pct != null ? `${cur.funding_pct}% saved` : '0% default'}</span></div>
              <input className="tbw-mono" type="text" inputMode="decimal" placeholder="saved rate" value={fundOv} onChange={e => setFundOv(e.target.value.replace(/[^0-9.-]/g, ''))} />
            </div>
          ) : (
            <div><div className="tbw-lbl">{cur?.base || 'BASE'} DISCOUNTING</div>
              <input className="tbw-mono" value={cur?.base_curve_available ? cur.base_curve : `${cur?.base_fallback || 'flat policy rate'}`} readOnly style={{ color: cur?.base_curve_available ? 'var(--text)' : 'var(--amber)' }} />
            </div>
          )}
          <div><div className="tbw-lbl">{qc} DISCOUNTING</div>
            <input className="tbw-mono" value={cur?.quote_curve || '—'} readOnly />
          </div>
          <div><div className="tbw-lbl">MARKET DATA</div>
            <button className="tbw-chip" style={{ width: '100%' }} onClick={snap} disabled={!!busy}>{busy === 'snap' ? 'SNAPPING…' : '● SNAP SPOT'}</button>
          </div>
        </div>
        <div className="tbw-helper-text" style={{ marginTop: 10 }}>
          {crypto ? `Spot: ${feeds?.crypto || 'Coinbase (public)'}` : `Spot: ${feeds?.fx || 'ECB reference rates (public)'}`} · F = S·DF<sub>base</sub>/DF<sub>quote</sub> or S + quoted points · NPV = ±N·(F − K)·DF<sub>quote</sub> · ACT/365
        </div>
      </div>

      <AnalyticsBlock descriptor={descriptor} result={quote ? { ...quote, curve_id: cur?.quote_curve } : null} pricing={busy === 'price'} />
    </>
  )
})

export default FxCryptoPanel
