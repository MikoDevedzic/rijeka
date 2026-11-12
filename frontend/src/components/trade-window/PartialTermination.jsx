// trade-window/PartialTermination.jsx
// PARTIALLY TERMINATE, on the CONFIRM tab of a booked trade: the notional that remains and, if one was agreed, the
// fee for the unwind. The trade stays; the API reduces the booking (the trade, its legs and the notional its signed
// record carries) and, when the record is anchored, supersedes it on-chain with both signatures. The helpers and
// their rules are in partial-termination.js.
import { useState } from 'react'
import { canPartiallyTerminate, partialProblem, partialBody, partialDone, fmtNotional } from './partial-termination'

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function PartialTermination({ trade, pkg = null, terminated = false, anchored = false, busy = false, error = '', done = null, onSubmit }) {
  const [open, setOpen] = useState(false)
  const [remaining, setRemaining] = useState('')
  const [feeDirection, setFeeDirection] = useState('PAY')
  const [feeAmount, setFeeAmount] = useState('')
  const [feeDate, setFeeDate] = useState(todayIso())
  if (!canPartiallyTerminate(trade, { pkg, terminated }) || !onSubmit) {
    return done ? <div className="tbw-mut" data-testid="partial-done" style={{ marginTop: 12, maxWidth: 520 }}>{partialDone(done)}</div> : null
  }
  const form = { current: trade.notional, remaining, feeDirection, feeAmount, feeDate, today: todayIso() }
  const problem = partialProblem(form)
  const submit = async () => {
    if (problem || busy) return
    const ok = await onSubmit(partialBody(form))
    if (ok) { setOpen(false); setRemaining(''); setFeeAmount('') }
  }
  return (
    <div data-testid="partial-termination" style={{ marginTop: 12, maxWidth: 520 }}>
      {/* what the reduction that reopened this ticket did: above the control, where it is read first */}
      {done && <div className="tbw-mut" data-testid="partial-done" style={{ marginBottom: 8, color: 'var(--text)' }}>{partialDone(done)}</div>}
      {!open ? (
        <button className="tbw-btn" data-testid="partial-open" onClick={() => setOpen(true)}>◆ PARTIALLY TERMINATE</button>
      ) : (
        <div style={{ padding: 12, background: 'var(--bg)', border: '1px solid var(--border-hi)', borderRadius: 'var(--r-2)' }}>
          <div className="tbw-lbl">PARTIAL TERMINATION</div>
          <div className="tbw-mut" style={{ lineHeight: 1.5, margin: '6px 0 10px' }}>
            The trade stays, on the notional that remains.{' '}
            {anchored
              ? 'The signed record is replaced on-chain by the reduced one, with a signature from each party. When the counterparty signs for themselves this needs their signature; Rijeka signs both only if it holds their key.'
              : 'This trade has no record anchored on a chain: the booking is reduced and the event says so.'}
            {' '}A fee is recorded with the trade as an UNWIND fee.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, alignItems: 'start' }}>
            <label style={{ gridColumn: 'span 2' }}>
              <div className="tbw-lbl">NOTIONAL THAT REMAINS</div>
              <input className="tbw-mono" data-testid="partial-remaining" inputMode="decimal" value={remaining} disabled={busy}
                     onChange={e => setRemaining(e.target.value)} placeholder={fmtNotional(Number(trade.notional) / 2)} style={{ width: '100%' }} />
              <div className="tbw-mut" data-testid="partial-now" style={{ marginTop: 4 }}>
                now <span className="tbw-mono" style={{ color: 'var(--text)' }}>{fmtNotional(trade.notional)}</span> {trade.notional_ccy || ''}
              </div>
            </label>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="tbw-lbl">UNWIND FEE · OPTIONAL</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['PAY', 'RECEIVE'].map(d => (
                  <button key={d} type="button" data-testid={`partial-fee-${d.toLowerCase()}`} disabled={busy}
                          className={`tbw-chip ${d === 'PAY' ? 'tbw-chip-dir-pay' : 'tbw-chip-dir-rec'}${feeDirection === d ? ' is-on' : ''}`}
                          onClick={() => setFeeDirection(d)}>{d}</button>
                ))}
              </div>
            </div>
            <label style={{ gridColumn: 'span 2' }}>
              <div className="tbw-lbl">FEE AMOUNT</div>
              <input className="tbw-mono" data-testid="partial-fee-amount" inputMode="decimal" value={feeAmount} disabled={busy}
                     onChange={e => setFeeAmount(e.target.value)} placeholder="none" style={{ width: '100%' }} />
            </label>
            <label style={{ gridColumn: 'span 2' }}>
              <div className="tbw-lbl">FEE PAID ON</div>
              <input type="date" data-testid="partial-fee-date" value={feeDate} min={todayIso()} disabled={busy}
                     onChange={e => setFeeDate(e.target.value)} style={{ width: '100%' }} />
            </label>
          </div>
          {remaining !== '' && problem && <div className="tbw-mut" data-testid="partial-problem" style={{ marginTop: 8, color: 'var(--amber)' }}>{problem}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="tbw-btn" onClick={() => setOpen(false)} disabled={busy}>Dismiss</button>
            <button className="tbw-btn tbw-btn-cancel" data-testid="partial-submit" onClick={submit} disabled={busy || !!problem}>
              {busy ? (anchored ? '⏳ SIGNING & ANCHORING…' : '⏳ REDUCING…') : '✓ REDUCE THE TRADE'}
            </button>
          </div>
        </div>
      )}
      {error && <div className="tbw-error" data-testid="partial-error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
