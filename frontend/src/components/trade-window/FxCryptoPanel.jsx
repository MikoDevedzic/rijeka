// FX and digital-asset leg of the NEW TRADE window: spot / forward / NDF on a
// currency pair or a crypto forward, priced on interest-rate parity by
// /api/currency/forward/price, and a European FX option (call or put on the
// base currency) priced by /api/currency/option/price: Garman–Kohlhagen on the
// same forward, the vol from the pair's ATM/RR/BF surface. The window owns the
// counterparty, book and footer buttons; it calls price() and payload() on this
// panel through a ref.
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
import { SHAPE_OF, DELTA_LABEL } from './fx-shape'
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
  // option terms (shape OPTION): call or put on the base, expiry, cash or physical, a vol override
  const option = shape === 'OPTION'
  const [optType, setOptType] = useState('CALL')
  const [expiry, setExpiry] = useState(plusMonths(3))
  const [optSettle, setOptSettle] = useState('')          // '' = two business days after expiry (the server fills it)
  const [cashSettled, setCashSettled] = useState(crypto)
  const [volOv, setVolOv] = useState('')
  // style (pricing/fx_exotic.py): EUROPEAN | AMERICAN | DIGITAL | BARRIER | DOUBLE_BARRIER | TOUCH
  const [style, setStyle] = useState('EUROPEAN')
  const [payout, setPayout] = useState('1000000')
  const [payoutCcy, setPayoutCcy] = useState('QUOTE')
  const [barrierType, setBarrierType] = useState('UP_OUT')
  const [barrier, setBarrier] = useState('')
  const [lowerB, setLowerB] = useState('')
  const [upperB, setUpperB] = useState('')
  const [rebate, setRebate] = useState('')
  const [touchType, setTouchType] = useState('ONE_TOUCH')
  const [payAtHit, setPayAtHit] = useState(false)
  const styleFields = () => {
    const f = { style }
    if (style === 'DIGITAL' || style === 'TOUCH') { f.payout = Number(payout); f.payout_currency = payoutCcy }
    if (style === 'BARRIER') { f.barrier_type = barrierType; f.barrier = Number(barrier); if (rebate !== '') f.rebate = Number(rebate) }
    if (style === 'DOUBLE_BARRIER') { f.barrier_type = barrierType.startsWith('KNOCK') ? barrierType : 'KNOCK_OUT'; f.lower = Number(lowerB); f.upper = Number(upperB) }
    if (style === 'TOUCH') { f.touch_type = touchType; f.pay_at_hit = payAtHit; if (touchType.startsWith('DOUBLE')) { f.lower = Number(lowerB); f.upper = Number(upperB) } else f.barrier = Number(barrier) }
    return f
  }

  useEffect(() => { setPair(crypto ? 'BTCUSD' : 'EURUSD'); setNotional(crypto ? 10 : 10_000_000); setCashSettled(crypto); setPayout(crypto ? '100000' : '1000000'); setQuote(null) }, [crypto])
  useEffect(() => { setQuote(null) }, [inst, pair, direction, notional, settlement, tenor, strike, spotOv, fundOv, optType, expiry, optSettle, cashSettled, volOv, style, payout, payoutCcy, barrierType, barrier, lowerB, upperB, rebate, touchType, payAtHit])
  useEffect(() => { if (style === 'DOUBLE_BARRIER') setBarrierType(b => b.startsWith('KNOCK') ? b : 'KNOCK_OUT'); if (style === 'BARRIER') setBarrierType(b => b.startsWith('KNOCK') ? 'UP_OUT' : b) }, [style])

  const load = async () => {
    try { const m = await call('/api/currency/pairs'); setPairs(m.pairs || []); setFeeds(m.feeds || null) } catch (e) { onError?.(e.message) }
  }
  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const cur = useMemo(() => pairs.find(p => p.pair === pair), [pairs, pair])
  const quoted = !!cur?.forward_curve && cur.forward_curve.in_use !== false      // the account prices on quoted points (not on IMPLIED)
  const list = pairs.filter(p => !!p.crypto === crypto)

  const snap = async () => {
    setBusy('snap')
    try { await call('/api/currency/spot/snap', { method: 'POST' }); await load() } catch (e) { onError?.(e.message) } finally { setBusy('') }
  }

  const price = async () => {
    setBusy('price'); setQuote(null)
    try {
      if (option) {
        const body = { pair, option_type: optType, base_notional: Number(notional), expiry_date: expiry, direction,
                       settlement_type: cashSettled ? 'NON_DELIVERABLE' : 'DELIVERABLE', ...styleFields() }
        if (optSettle) body.settlement_date = optSettle
        if (strike !== '') body.strike = Number(strike)
        if (spotOv !== '') body.spot = Number(spotOv)
        if (volOv !== '') body.vol_pct = Number(volOv)
        const q = await call('/api/currency/option/price', { method: 'POST', body: JSON.stringify(body) })
        setQuote(q); onPriced?.(q); return q
      }
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
    if (option && crypto) {
      // a digital-asset option: the CRYPTO_OPTION (NDO) record's fields (ISDA Digital Asset Derivatives
      // Definitions vocabulary) plus the style's terms; cash-settled against the settlement price source
      const premiumDate = quote.valuation_date
      return {
        asset_class: 'CRYPTO', instrument_type: 'CRYPTO_OPTION', structure: style,
        notional: Number(notional), notional_ccy: cur.base, maturity_date: quote.settlement_date, discount_curve_id: cur.quote_curve,
        terms: {
          direction, digital_asset: cur.base, notional_amount: String(notional), option_type: optType,
          exercise_style: style === 'AMERICAN' ? 'AMERICAN' : 'EUROPEAN',
          ...(style !== 'TOUCH' ? { strike_price: String(quote.strike), strike_currency: 'USD' } : {}),
          ...Object.fromEntries(Object.entries(styleFields()).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])),
          ...(style === 'BARRIER' || style === 'DOUBLE_BARRIER' || style === 'TOUCH' ? { barrier_monitoring: 'CONTINUOUS', barrier_determination_agent: null } : {}),
          expiration_date: quote.expiry_date, expiration_time: '08:00 UTC', valuation_date: quote.expiry_date, valuation_time: '08:00 UTC',
          settlement_date: quote.settlement_date, settlement_currency: 'USD', settlement_price_source: cur.fixing_default,
          premium_amount: String(Math.abs(Math.round(quote.npv * 100) / 100)), premium_currency: 'USD', premium_payment_date: premiumDate,
          vol_pct: quote.vol_pct, vol_tier: quote.vol_tier, automatic_exercise: true, calculation_agent: null,
          disruption_fallback: 'ISDA Digital Asset Derivatives Definitions fallbacks',
        },
      }
    }
    if (option) {
      // the option's terms as the canonical record names them (chain/canonical.py, FX_OPTION):
      // buyer and seller of the option, the strike, expiry and settlement, the premium as a cash flow.
      // The trade's structure is the style, so the blotter tells a digital from a barrier.
      const ndo = cashSettled
      const premiumDate = quote.valuation_date
      return {
        asset_class: 'FX', instrument_type: 'FX_OPTION', structure: style,
        notional: Number(notional), notional_ccy: cur.base, maturity_date: quote.settlement_date, discount_curve_id: cur.quote_curve,
        terms: {
          direction, currency_pair: pair, base_currency: cur.base, quote_currency: cur.quote,
          option_type: optType, exercise_style: style === 'AMERICAN' ? 'AMERICAN' : 'EUROPEAN',
          base_notional: String(notional), ...(style !== 'TOUCH' ? { strike: String(quote.strike), quote_notional: String(Number(notional) * quote.strike) } : {}),
          ...Object.fromEntries(Object.entries(styleFields()).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])),
          ...(style === 'BARRIER' || style === 'DOUBLE_BARRIER' || style === 'TOUCH' ? { barrier_monitoring: 'CONTINUOUS', barrier_determination_agent: null } : {}),
          expiry_date: quote.expiry_date, expiry_time: '10:00 New York', settlement_date: quote.settlement_date,
          settlement_type: ndo ? 'NON_DELIVERABLE' : 'DELIVERABLE',
          ...(ndo ? { settlement_currency: cur.quote, fixing_source: cur.fixing_default } : {}),
          premium_amount: String(Math.abs(Math.round(quote.npv * 100) / 100)), premium_currency: cur.quote, premium_payment_date: premiumDate,
          vol_pct: quote.vol_pct, vol_tier: quote.vol_tier, automatic_exercise: true, calculation_agent: null,
        },
      }
    }
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
  // The trade POST body as TradeWindow sends it, minus the parties, desk and book: what the
  // incremental XVA run values as the hypothetical trade (POST /api/xva/incremental).
  const bookBody = () => { const today = iso(new Date()); return { ...payload(), trade_date: today, effective_date: today } }
  useImperativeHandle(ref, () => ({ price, payload, bookBody, quote: () => quote, busy: () => busy }), [quote, busy, pair, notional, settlement, direction, strike, spotOv, fundOv, cur, inst, optType, expiry, optSettle, cashSettled, volOv, style, payout, payoutCcy, barrierType, barrier, lowerB, upperB, rebate, touchType, payAtHit])

  // ── render: the same sections, labels and cards as the rates ticket ──────────
  const dp = rateDp(pair)
  const qc = cur?.quote || 'USD'
  const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }
  const money = (v) => { if (v == null || isNaN(v)) return '—'; const n = Math.round(v); return (n > 0 ? '+' : n < 0 ? '−' : '') + (SYM[qc] ?? (qc + ' ')) + Math.abs(n).toLocaleString('en-US') }
  const sgn = (v) => v == null || isNaN(v) || Math.round(v) === 0 ? null : (v > 0 ? 'positive' : 'negative')
  const spot01 = (r) => r.spot01 ?? r.delta_quote_per_pct
  const ir01 = (r) => r.ir01 ?? (r.rho_base_per_bp + r.rho_quote_per_bp)
  const effDate = (() => { const d = new Date(); let n = crypto ? 0 : 2; while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n-- } return iso(d) })()
  const ndf = shape === 'NDF'
  const pct = (v, d = 2) => v == null || isNaN(v) ? '—' : `${(Number(v) * 100).toFixed(d)}%`
  // SHOW MATH: the formula behind each card, with this quote's own numbers (the Excel replication's Derivation sheet, live)
  const mathOf = (r) => {
    const F = fmt(r.forward, dp), K = fmt(r.strike, dp), S = fmt(r.spot, dp), T = fmt(r.t_expiry, 4), sig = fmt(r.vol_pct, 2)
    const gk = r.style === 'EUROPEAN' || !r.style
    return {
      npv: gk ? `DF_${qc}·[F·N(d₁) − K·N(d₂)]·N\nd₁ = [ln(F/K) + ½σ²T]/(σ√T) = ${fmt(r.d1, 4)} · d₂ = ${fmt(r.d2, 4)}\nF ${F} · K ${K} · σ ${sig}% · T ${T}y · DF ${fmt(r.df_quote, 6)}` : `${r.method}\nF ${F} · K ${K} · σ ${sig}% · T ${T}y`,
      delta: gk ? `Φ(d₁)·DF_${qc}·F/S·N = ${fmt(r.forward_delta * 100, 1)}% · ${fmt(r.df_quote, 4)} · ${F}/${S} · N` : `[NPV(S·1.01) − NPV(S·0.99)] / (0.02·S)`,
      spot01: `NPV(F·1.01) − NPV\nthe forward moves one for one with spot; the discounting does not`,
      vega: `NPV(σ + 1pt) − NPV\nrepriced at ${fmt(r.vol_pct + 1, 2)}%`,
      ir01: crypto ? `NPV(DF_${qc}·e^(−1bp·T), F·e^(+1bp·T)) − NPV\nthe ${qc} curve alone: the forward up by the carry, DF down` : `IR01 ${qc} + IR01 ${r.base_currency}\n+1bp on each curve, repriced`,
      fund01: `NPV(F·e^(−1bp·T)) − NPV\n+1bp on the funding rate: the forward down by the carry`,
      theta: `NPV(T − 1/365) − NPV\nsame spot, curves and vol, one calendar day later`,
    }
  }
  const optionDescriptor = { analytics: {
    metrics: (r) => { const m = mathOf(r); return [
      { label: 'OPTION NPV', value: money(r.npv), colorBy: sgn(r.npv), math: m.npv },
      { label: 'DELTA', value: `${fmt(r.delta_base_units, 0)} ${r.base_currency}`, colorBy: sgn(r.delta_base_units), math: m.delta },
      { label: DELTA_LABEL(crypto), value: money(r.spot01), colorBy: sgn(r.spot01), math: m.spot01 },
      { label: 'VEGA / 1pt', value: money(r.vega), colorBy: sgn(r.vega), math: m.vega },
      { label: crypto ? 'IR01 (DISC)' : 'IR01', value: money(r.ir01), colorBy: sgn(r.ir01), math: m.ir01 },
      ...(crypto ? [{ label: 'FUND01', value: money(r.fund01 ?? r.ir01_base), colorBy: sgn(r.fund01 ?? r.ir01_base), math: m.fund01 }] : []),
      { label: 'THETA', value: money(r.theta), colorBy: sgn(r.theta), math: m.theta },
    ] },
    breakdown: (r) => ({ kind: 'market', columns: ['ITEM', 'VALUE', 'NOTE'], rows: [
      ['SPOT', fmt(r.spot, dp), r.spot_source || ''],
      ['FORWARD TO SETTLEMENT', fmt(r.forward, dp), `${r.forward_mode === 'MARKET' && r.market_points != null ? 'quoted points' : 'implied from yields'}${r.forward_source ? ' · ' + r.forward_source : ''}`],
      ['STRIKE', fmt(r.strike, dp), strike === '' ? 'at the forward' : `${fmt((r.strike / r.forward - 1) * 100, 2)}% from the forward`],
      ['VOL', `${fmt(r.vol_pct, 3)}%`, `${r.vol_tier} · ${r.vol_source}${r.vol_marks ? ' · ' + r.vol_marks : r.vol_snapshot ? ' · ' + r.vol_snapshot : ''}`],
      ...(r.forward_delta != null ? [['FORWARD DELTA', pct(r.forward_delta, 1), `d1 ${fmt(r.d1, 4)} · d2 ${fmt(r.d2, 4)} · premium-excluded`]] : []),
      ...(r.intrinsic != null ? [['INTRINSIC / TIME VALUE', `${money(r.intrinsic * r.df_quote)} / ${money(r.time_value)}`, 'on the forward, discounted']] : []),
      ...(r.style && r.style !== 'EUROPEAN' ? [['STYLE', r.style.replace('_', ' '), [r.barrier_type, r.barrier && `barrier ${fmt(r.barrier, dp)}`, r.lower && `[${fmt(r.lower, dp)}, ${fmt(r.upper, dp)}]`, r.touch_type, r.payout && `pays ${fmt(r.payout, 0)} ${r.payout_currency === 'BASE' ? r.base_currency : qc}`, r.pay_at_hit ? 'paid at hit' : null, r.rebate ? `rebate ${r.rebate}` : null].filter(Boolean).join(' · ')]] : []),
      ['GAMMA', money(r.gamma_1pct), `change in ${DELTA_LABEL(crypto)} for a further +1% spot`],
      [crypto ? `IR01 ${qc} / FUND01` : `IR01 ${qc} / ${r.base_currency}`, `${money(r.ir01_disc)} / ${money(r.ir01_base)}`, crypto ? '+1 bp on the USD curve (IR01) / on the funding rate (FUND01)' : '+1 bp on each curve'],
      [`DF ${qc}`, fmt(r.df_quote, 6), `to settlement · T_exp ${fmt(r.t_expiry, 4)}y · T_settle ${fmt(r.t_settle, 4)}y`],
      ['MODEL', r.method || 'Garman–Kohlhagen', r.model || ''],
    ] }),
  } }
  const forwardDescriptor = { analytics: {
    metrics: (r) => [
      { label: 'NET NPV', value: money(r.npv), colorBy: sgn(r.npv), math: `±N·(F − K)·DF_${qc}\nF = S·DF_${r.base_currency}/DF_${qc} = ${fmt(r.forward, dp)} · K ${fmt(r.forward_rate, dp)} · DF ${fmt(r.df_quote, 6)}` },
      { label: DELTA_LABEL(crypto), value: money(spot01(r)), colorBy: sgn(spot01(r)), math: `N·S·DF_${r.base_currency}·1%\nexact: a forward is linear in spot` },
      { label: crypto ? 'IR01 (DISC)' : 'IR01', value: money(ir01(r)), colorBy: sgn(ir01(r)), math: crypto ? `−N·K·[DF_${qc}·e^(−1bp·T) − DF_${qc}]\nthe discounting curve alone` : `IR01 ${qc} + IR01 ${r.base_currency}\n−N·K·ΔDF_${qc} + N·S·ΔDF_${r.base_currency}` },
      ...(crypto ? [{ label: 'FUND01', value: money(r.fund01 ?? r.ir01_base ?? r.rho_base_per_bp), colorBy: sgn(r.fund01 ?? r.ir01_base ?? r.rho_base_per_bp), math: `N·S·[DF_${r.base_currency}·e^(−1bp·T) − DF_${r.base_currency}]\n+1bp on the funding rate` }]
                 : [{ label: 'IR01 DISC', value: money(r.ir01_disc ?? r.rho_quote_per_bp), colorBy: sgn(r.ir01_disc ?? r.rho_quote_per_bp), math: `−N·K·[DF_${qc}·e^(−1bp·T) − DF_${qc}]\nthe ${qc} curve alone` }]),
      { label: 'THETA', value: money(r.theta), colorBy: sgn(r.theta), math: `NPV one calendar day later, same market` },
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
  const descriptor = option ? optionDescriptor : forwardDescriptor

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
          <div><div className="tbw-lbl">{option ? 'SIDE' : 'DIRECTION'}</div>
            <div className="tbw-chip-row" style={{ gap: 4 }}>
              {['BUY', 'SELL'].map(d => (
                <button key={d} className={`tbw-chip ${direction === d ? 'is-on' : ''}`} onClick={() => setDirection(d)}>{d} {option ? 'OPTION' : (cur?.base || '')}</button>
              ))}
            </div>
          </div>
          {option ? (
            <div><div className="tbw-lbl">TYPE <span className="tbw-mut">· on {cur?.base || 'base'}</span></div>
              <div className="tbw-chip-row" style={{ gap: 4 }}>
                {['CALL', 'PUT'].map(d => (
                  <button key={d} className={`tbw-chip ${optType === d ? 'is-on' : ''}`} onClick={() => setOptType(d)}>{d}</button>
                ))}
              </div>
            </div>
          ) : (
            <div><div className="tbw-lbl">TENOR</div>
              <select value={shape === 'SPOT' ? 'SPOT' : tenor} disabled={shape === 'SPOT'} onChange={e => { setTenor(e.target.value); setSettlement(tenorDate(e.target.value)) }}>
                {shape === 'SPOT' && <option value="SPOT">SPOT</option>}{TENORS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          {option ? (
            <div><div className="tbw-lbl">EXPIRY <span className="tbw-mut">· {crypto ? '08:00 UTC' : '10:00 NY'}</span></div>
              <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} />
            </div>
          ) : (
            <div><div className="tbw-lbl">EFF DATE <span className="tbw-mut">· {crypto ? 'T+0' : 'SPOT T+2'}</span></div>
              <input type="date" value={effDate} readOnly />
            </div>
          )}
          {option ? (
            <div><div className="tbw-lbl">SETTLEMENT <span className="tbw-mut">· blank = expiry + {crypto ? '1 day' : '2bd'}</span></div>
              <input type="date" value={optSettle || quote?.settlement_date || ''} onChange={e => setOptSettle(e.target.value)} />
            </div>
          ) : (
            <div><div className="tbw-lbl">MAT DATE <span className="tbw-mut">· {shape === 'SPOT' ? 'VALUE' : ndf || crypto ? 'SETTLEMENT' : 'VALUE'}</span></div>
              <input type="date" value={shape === 'SPOT' ? (quote?.settlement_date || effDate) : settlement} disabled={shape === 'SPOT'} onChange={e => setSettlement(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {option && (
        <div className="tbw-sec">
          <div className="tbw-terms-header">
            <span className="tbw-lbl">OPTION TERMS</span>
            <span className="tbw-helper-badge">→ {direction === 'BUY' ? 'we hold' : 'we write'} the right to {optType === 'CALL' ? 'buy' : 'sell'} {cur?.base || 'base'} against {qc} · {cashSettled ? `cash-settled in ${qc}${crypto ? ' against ' + (cur?.fixing_default || 'the settlement price source') : ''}` : 'deliverable'}</span>
          </div>
          <div className="tbw-chip-row" style={{ gap: 4, marginBottom: 10 }}>
            {[['EUROPEAN', 'EUROPEAN'], ['AMERICAN', 'AMERICAN'], ['DIGITAL', 'DIGITAL'], ['BARRIER', 'BARRIER'], ['DOUBLE_BARRIER', 'DOUBLE BARRIER'], ['TOUCH', 'TOUCH']].map(([k, l]) => (
              <button key={k} className={`tbw-chip ${style === k ? 'is-on' : ''}`} onClick={() => setStyle(k)}>{l}</button>
            ))}
          </div>
          {style !== 'EUROPEAN' && style !== 'AMERICAN' && (
            <div className="tbw-grid-6" style={{ marginBottom: 10 }}>
              {(style === 'DIGITAL' || style === 'TOUCH') && (<>
                <div><div className="tbw-lbl">PAYOUT</div>
                  <input className="tbw-mono" type="text" inputMode="decimal" value={payout} onChange={e => setPayout(e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
                <div><div className="tbw-lbl">PAID IN</div>
                  <div className="tbw-chip-row" style={{ gap: 4 }}>
                    <button className={`tbw-chip ${payoutCcy === 'QUOTE' ? 'is-on' : ''}`} onClick={() => setPayoutCcy('QUOTE')}>{qc}</button>
                    <button className={`tbw-chip ${payoutCcy === 'BASE' ? 'is-on' : ''}`} onClick={() => setPayoutCcy('BASE')}>{cur?.base || 'BASE'}</button>
                  </div>
                </div>
              </>)}
              {style === 'BARRIER' && (<>
                <div><div className="tbw-lbl">BARRIER TYPE</div>
                  <select value={barrierType} onChange={e => setBarrierType(e.target.value)}>
                    {['UP_OUT', 'UP_IN', 'DOWN_OUT', 'DOWN_IN'].map(b => <option key={b} value={b}>{b.replace('_', '-AND-')}</option>)}
                  </select>
                </div>
                <div><div className="tbw-lbl">BARRIER <span className="tbw-mut">· {qc} per {cur?.base || 'base'}</span></div>
                  <input className="tbw-mono" type="text" inputMode="decimal" placeholder="level" value={barrier} onChange={e => setBarrier(e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
                <div><div className="tbw-lbl">REBATE <span className="tbw-mut">· {qc} per {cur?.base || 'base'}</span></div>
                  <input className="tbw-mono" type="text" inputMode="decimal" placeholder="0" value={rebate} onChange={e => setRebate(e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
              </>)}
              {style === 'DOUBLE_BARRIER' && (<>
                <div><div className="tbw-lbl">BARRIER TYPE</div>
                  <select value={barrierType} onChange={e => setBarrierType(e.target.value)}>
                    {['KNOCK_OUT', 'KNOCK_IN'].map(b => <option key={b} value={b}>{b.replace('_', '-')}</option>)}
                  </select>
                </div>
              </>)}
              {style === 'TOUCH' && (<>
                <div><div className="tbw-lbl">TOUCH TYPE</div>
                  <select value={touchType} onChange={e => setTouchType(e.target.value)}>
                    {['ONE_TOUCH', 'NO_TOUCH', 'DOUBLE_ONE_TOUCH', 'DOUBLE_NO_TOUCH'].map(b => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                {touchType === 'ONE_TOUCH' && (
                  <div><div className="tbw-lbl">PAID</div>
                    <div className="tbw-chip-row" style={{ gap: 4 }}>
                      <button className={`tbw-chip ${!payAtHit ? 'is-on' : ''}`} onClick={() => setPayAtHit(false)}>AT EXPIRY</button>
                      <button className={`tbw-chip ${payAtHit ? 'is-on' : ''}`} onClick={() => setPayAtHit(true)}>AT HIT</button>
                    </div>
                  </div>
                )}
              </>)}
              {((style === 'TOUCH' && !touchType.startsWith('DOUBLE'))) && (
                <div><div className="tbw-lbl">BARRIER <span className="tbw-mut">· {qc} per {cur?.base || 'base'}</span></div>
                  <input className="tbw-mono" type="text" inputMode="decimal" placeholder="level" value={barrier} onChange={e => setBarrier(e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
              )}
              {(style === 'DOUBLE_BARRIER' || (style === 'TOUCH' && touchType.startsWith('DOUBLE'))) && (<>
                <div><div className="tbw-lbl">LOWER</div>
                  <input className="tbw-mono" type="text" inputMode="decimal" placeholder="below spot" value={lowerB} onChange={e => setLowerB(e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
                <div><div className="tbw-lbl">UPPER</div>
                  <input className="tbw-mono" type="text" inputMode="decimal" placeholder="above spot" value={upperB} onChange={e => setUpperB(e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
              </>)}
            </div>
          )}
          <div className="tbw-grid-6">
            {style !== 'TOUCH' && (
              <div><div className="tbw-lbl">STRIKE <span className="tbw-mut">· {qc} per {cur?.base || 'base'}</span></div>
                <input className="tbw-mono" type="text" inputMode="decimal" placeholder="at the forward" value={strike} onChange={e => setStrike(e.target.value.replace(/[^0-9.]/g, ''))} />
              </div>
            )}
            <div><div className="tbw-lbl">VOL % <span className="tbw-mut">· {cur?.vol_surface ? (cur.vol_surface.label || `${cur.vol_surface.source} surface ${cur.vol_surface.valuation_date}`) : 'no surface: desk default'}</span></div>
              <input className="tbw-mono" type="text" inputMode="decimal" placeholder={cur?.vol_surface ? 'from the surface' : 'default level'} value={volOv} onChange={e => setVolOv(e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
            <div><div className="tbw-lbl">SETTLEMENT</div>
              <div className="tbw-chip-row" style={{ gap: 4 }}>
                {!crypto && <button className={`tbw-chip ${!cashSettled ? 'is-on' : ''}`} onClick={() => setCashSettled(false)}>DELIVER</button>}
                <button className={`tbw-chip ${cashSettled ? 'is-on' : ''}`} onClick={() => setCashSettled(true)}>{crypto ? `CASH ${qc} · NDO` : `CASH ${qc}`}</button>
              </div>
            </div>
            <div><div className="tbw-lbl">SPOT <span className="tbw-mut">· {cur?.spot_as_of || 'not snapped'}</span></div>
              <input className="tbw-mono" type="text" inputMode="decimal" placeholder={cur?.spot ? fmt(cur.spot, dp) : 'snap first'} value={spotOv} onChange={e => setSpotOv(e.target.value.replace(/[^0-9.]/g, ''))} />
            </div>
            <div><div className="tbw-lbl">{qc} DISCOUNTING</div>
              <input className="tbw-mono" value={cur?.quote_curve || '—'} readOnly />
            </div>
            <div><div className="tbw-lbl">MARKET DATA</div>
              <button className="tbw-chip" style={{ width: '100%' }} onClick={snap} disabled={!!busy}>{busy === 'snap' ? 'SNAPPING…' : '● SNAP SPOT'}</button>
            </div>
          </div>
          <div className="tbw-helper-text" style={{ marginTop: 10 }}>
            {style === 'EUROPEAN' ? (crypto ? 'Black-76, the funding rate as the carry' : 'Garman–Kohlhagen') : style === 'AMERICAN' ? 'Leisen–Reimer binomial tree, early exercise at every node' : style === 'DIGITAL' ? 'Reiner–Rubinstein cash-or-nothing / asset-or-nothing' : style === 'TOUCH' ? 'first-passage and survival probabilities, continuous monitoring' : 'survival-density integral, continuous monitoring'} on the forward to settlement · σ from the pair's ATM / 25Δ RR / 25Δ BF surface at the strike (Market data › FX › Volatility) · premium in {qc} on the trade date · ACT/365
          </div>
        </div>
      )}

      <div className="tbw-sec" style={option ? { display: 'none' } : undefined}>
        <div className="tbw-terms-header">
          <span className="tbw-lbl">FORWARD TERMS</span>
          <span className="tbw-helper-badge">→ {crypto ? `cash-settled in ${qc} · ${quoted ? `forward from ${cur.forward_curve.label || 'quoted points'}` : 'funding is a desk input'}` : ndf ? `non-deliverable · cash-settled in ${qc}` : shape === 'SPOT' ? 'spot · T+2 delivery' : 'deliverable · both principals exchange'}</span>
        </div>
        <div className="tbw-grid-6">
          <div><div className="tbw-lbl">{crypto ? 'PRICE K' : 'RATE K'} <span className="tbw-mut">· {qc} per {cur?.base || 'base'}</span></div>
            <input className="tbw-mono" type="text" inputMode="decimal" placeholder="at the fair forward" value={strike} onChange={e => setStrike(e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
          <div><div className="tbw-lbl">SPOT <span className="tbw-mut">· {cur?.spot_as_of || 'not snapped'}</span></div>
            <input className="tbw-mono" type="text" inputMode="decimal" placeholder={cur?.spot ? fmt(cur.spot, dp) : 'snap first'} value={spotOv} onChange={e => setSpotOv(e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
          {crypto ? (
            <div><div className="tbw-lbl">{cur?.base || 'ASSET'} FUNDING % <span className="tbw-mut">· {quoted ? 'overrides the quoted forward' : cur?.funding_pct != null ? `${cur.funding_pct}% saved` : '0% default'}</span></div>
              <input className="tbw-mono" type="text" inputMode="decimal" placeholder={quoted ? 'from the forward' : 'saved rate'} value={fundOv} onChange={e => setFundOv(e.target.value.replace(/[^0-9.-]/g, ''))} />
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
