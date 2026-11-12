// FEES: the known payments entered with a trade (fees.js, backend/pricing/fees.py). Any number of rows: a type, PAY or
// RECEIVE, an amount in the trade's currency and a date. An option's premium is a row; a premium in instalments is
// several. Under the rows: what the fees are worth today (POST /api/price/fees, on the currency's curve) and the
// trade's value net of them. The same rows go into the booking's terms and into the XVA run.
import { useEffect, useMemo, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import { FEE_TYPES, MAX_FEES, feeRow, feeProblem, feeIsBlank, cleanFees, feesSummary, amountShown } from './fees'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const money = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : (Number(v) < 0 ? '−' : Number(v) > 0 ? '+' : '') + Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const tone = (v) => (Number(v) < 0 ? 'var(--red)' : Number(v) > 0 ? 'var(--green)' : 'var(--text-hi)')

export default function FeesBlock({ rows, onChange, currency = 'USD', npv = null, valuationDate = null, premium = null, disabled = false }) {
  const fees = useMemo(() => cleanFees(rows, currency), [rows, currency])
  // the API's answer, kept with the fees it was for: { key, pv: { pv, fees: [{ df, pv, paid }] } } or { key, error }.
  // An answer for other fees than the ones on screen is not shown.
  const [answer, setAnswer] = useState(null)
  const key = fees && fees.length ? JSON.stringify([fees, currency, valuationDate]) : null
  useEffect(() => {
    if (!key) return undefined
    const timer = setTimeout(async () => {
      try {
        const session = await getSessionMaybe()
        const r = await fetch(`${API}/api/price/fees`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fees, currency, ...(valuationDate ? { valuation_date: valuationDate } : {}) }) })
        const body = await r.json().catch(() => ({}))
        setAnswer(r.ok ? { key, pv: body } : { key, error: typeof body.detail === 'string' ? body.detail : 'the fees could not be valued' })
      } catch { setAnswer({ key, error: 'the fees could not be valued' }) }
    }, 350)
    return () => clearTimeout(timer)
  }, [key])      // eslint-disable-line react-hooks/exhaustive-deps
  const pv = answer && answer.key === key ? (answer.pv || null) : null
  const error = answer && answer.key === key ? (answer.error || '') : ''

  // where each complete row sits in the list that was sent, to read its own line of the answer
  const place = useMemo(() => { const m = {}; let k = 0; for (const r of rows) { if (!feeIsBlank(r) && !feeProblem(r, currency)) { m[r.id] = k; k += 1 } } return m }, [rows, currency])
  // every change is made on the rows as they are when it lands, not as they were when the row was drawn: leaving the
  // amount (which rewrites it with its thousands) and typing the date arrive together
  const set = (id, patch) => onChange(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  const add = (seed) => onChange(prev => [...prev, feeRow({ ...seed, currency })])
  const remove = (id) => onChange(prev => prev.filter(r => r.id !== id))
  const net = pv && npv != null && Number.isFinite(Number(npv)) ? Number(npv) + Number(pv.pv) : null
  // the premium the model prices, offered as a row when the trade is an option and has no PREMIUM fee yet
  const offer = premium && Number(premium.amount) > 0 && !rows.some(r => r.type === 'PREMIUM') ? premium : null

  return (
    <div className={`tbw-sec ${rows.length ? '' : 'tbw-sec-line'}`} data-testid="fees-block">
      {/* with no fee yet the block is one line: its name, the buttons that add one, and "none entered" */}
      <div className="tbw-sec-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="tbw-lbl" style={{ marginBottom: 0 }}>FEES</span>
        {!disabled && rows.length < MAX_FEES && (
          <button type="button" className="tbw-chip tbw-chip-sm" data-testid="fee-add" onClick={() => add({ type: rows.length ? 'OTHER' : (premium ? 'PREMIUM' : 'UPFRONT'), direction: premium?.direction || 'PAY', date: premium?.date || '' })}>+ ADD FEE</button>
        )}
        {!disabled && offer && (
          <button type="button" className="tbw-chip tbw-chip-sm" data-testid="fee-premium" title="A PREMIUM row at the price the model gives, to change as agreed"
                  onClick={() => add({ type: 'PREMIUM', direction: offer.direction, amount: amountShown((Math.round(offer.amount * 100) / 100).toFixed(2)), date: offer.date || '' })}>+ MODEL PREMIUM</button>
        )}
        <span className="tbw-helper-text" data-testid="fees-summary" style={{ marginLeft: 'auto' }}>
          {fees == null ? 'finish or remove the incomplete row' : feesSummary(fees, currency) + (fees.length ? ' · face value' : '')}
        </span>
      </div>
      {rows.length > 0 && (
        <table style={{ borderCollapse: 'collapse', marginBottom: 8 }}>
          <thead>
            <tr>
              {['TYPE', 'WE', `AMOUNT ${currency}`, 'DATE', 'VALUE TODAY', ''].map((h, i) => (
                <th key={i} className="tbw-lbl" style={{ textAlign: i === 2 || i === 4 ? 'right' : 'left', padding: '0 8px 6px 0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const problem = feeProblem(r, currency)
              const valued = !problem && pv && fees ? pv.fees?.[place[r.id]] : null
              return (
                <tr key={r.id} data-testid="fee-row" className="rj-row">
                  <td style={{ padding: '3px 8px 3px 0', width: 150 }}>
                    <select aria-label={`Fee ${i + 1} type`} value={r.type} disabled={disabled} onChange={e => set(r.id, { type: e.target.value })}>
                      {FEE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '3px 8px 3px 0', width: 170, whiteSpace: 'nowrap' }}>
                    {['PAY', 'RECEIVE'].map(d => (
                      <button key={d} type="button" disabled={disabled} aria-pressed={r.direction === d} aria-label={`Fee ${i + 1}: we ${d.toLowerCase()}`}
                              className={`tbw-chip ${d === 'PAY' ? 'tbw-chip-dir-pay' : 'tbw-chip-dir-rec'} ${r.direction === d ? 'is-on' : ''}`} style={{ marginRight: 4 }} onClick={() => set(r.id, { direction: d })}>{d}</button>
                    ))}
                  </td>
                  <td style={{ padding: '3px 8px 3px 0', width: 190 }}>
                    <input aria-label={`Fee ${i + 1} amount`} className="tbw-mono" style={{ textAlign: 'right', width: '100%' }} inputMode="decimal" placeholder="0.00"
                           value={r.amount} disabled={disabled} onChange={e => set(r.id, { amount: e.target.value })}
                           onBlur={e => { const shown = amountShown(e.target.value); if (shown !== e.target.value) set(r.id, { amount: shown }) }} />
                  </td>
                  <td style={{ padding: '3px 8px 3px 0', width: 160 }}>
                    <input aria-label={`Fee ${i + 1} date`} type="date" value={r.date} disabled={disabled} onChange={e => set(r.id, { date: e.target.value })} />
                  </td>
                  <td className="tbw-mono" data-testid="fee-pv" style={{ padding: '3px 8px 3px 0', textAlign: 'right', width: 150, color: valued ? tone(valued.pv) : 'var(--text-dim)' }}
                      title={problem || (valued?.paid ? 'dated before the valuation date: paid' : valued ? `discount factor ${Number(valued.df).toFixed(6)}` : '')}>
                    {problem ? <span style={{ color: 'var(--amber)', fontFamily: 'var(--sans)' }}>{problem}</span> : valued ? (valued.paid ? 'paid' : money(valued.pv)) : '—'}
                  </td>
                  <td style={{ width: 34, textAlign: 'right' }}>
                    {!disabled && <button type="button" className="tbw-chip tbw-chip-sm" aria-label={`Remove fee ${i + 1}`} onClick={() => remove(r.id)}>×</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {error && <span className="tbw-helper-text" style={{ color: 'var(--amber)' }}>{error}</span>}
        {pv && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 18, alignItems: 'baseline' }}>
            <span><span className="tbw-lbl">PV OF FEES {currency}</span>{' '}<span className="tbw-mono" data-testid="fees-pv" style={{ color: tone(pv.pv) }}>{money(pv.pv)}</span></span>
            {net != null && <span><span className="tbw-lbl">VALUE NET OF FEES {currency}</span>{' '}<span className="tbw-mono" data-testid="fees-net" style={{ color: tone(net) }}>{money(net)}</span></span>}
          </span>
        )}
      </div>
    </div>
  )
}
