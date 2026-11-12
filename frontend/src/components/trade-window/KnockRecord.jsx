// trade-window/KnockRecord.jsx
// BARRIER, on the CONFIRM tab of a booked digital-asset barrier or touch option: what the desk has recorded, and
// the control that records it. A fixing cannot say whether a level traded on the way, so the desk says so: the day
// it traded, or, once the option has expired, that it never did. The settlement and the valuation read it. The
// helpers are in knock.js; the rule is the API's.
import { useState } from 'react'
import { canRecordKnock, knockLine, knockProblem, knockBody, knockLastDay, hasExpired } from './knock'

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function KnockRecord({ trade, busy = false, error = '', onSubmit }) {
  const [open, setOpen] = useState(false)
  const [on, setOn] = useState(todayIso())
  const [level, setLevel] = useState('')
  if (!canRecordKnock(trade) || !onSubmit) return null
  const today = todayIso(), recorded = trade.terms?.knocked != null
  const problem = knockProblem({ on, level, trade, today })
  const send = async (body) => { if (!busy && await onSubmit(body)) setOpen(false) }
  return (
    <div data-testid="knock-record" style={{ marginTop: 12, maxWidth: 520 }}>
      <div className="tbw-lbl">BARRIER</div>
      <div className={`tbw-mut${trade.terms?.knocked === true ? ' tbw-mono' : ''}`} data-testid="knock-line" style={{ color: recorded ? 'var(--text)' : undefined, marginBottom: 8 }}>{knockLine(trade.terms)}</div>
      {!open ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="tbw-btn" data-testid="knock-open" onClick={() => setOpen(true)} disabled={busy}>◆ RECORD A TOUCH</button>
          {hasExpired(trade, today) && trade.terms?.knocked == null && (
            <button className="tbw-btn" data-testid="knock-never" onClick={() => send({ knocked: false })} disabled={busy}>NEVER TOUCHED</button>
          )}
          {recorded && <button className="tbw-btn" data-testid="knock-clear" onClick={() => send({ knocked: null })} disabled={busy}>TAKE THE RECORD OFF</button>}
        </div>
      ) : (
        <div style={{ padding: 12, background: 'var(--bg)', border: '1px solid var(--border-hi)', borderRadius: 'var(--r-2)' }}>
          <div className="tbw-mut" style={{ lineHeight: 1.5, marginBottom: 10 }}>
            The day the level traded. A knock-out is then over, a knock-in becomes the plain option, a touch is decided; the trade is valued and settled on that.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, alignItems: 'start' }}>
            <label>
              <div className="tbw-lbl">TOUCHED ON</div>
              <input type="date" data-testid="knock-date" value={on} min={trade.trade_date || undefined} max={knockLastDay(trade, today)} disabled={busy}
                     onChange={e => setOn(e.target.value)} style={{ width: '100%' }} />
            </label>
            <label>
              <div className="tbw-lbl">LEVEL SEEN · OPTIONAL</div>
              <input className="tbw-mono" data-testid="knock-level" inputMode="decimal" value={level} disabled={busy}
                     onChange={e => setLevel(e.target.value)} placeholder="not kept" style={{ width: '100%' }} />
            </label>
          </div>
          {problem && <div className="tbw-mut" data-testid="knock-problem" style={{ marginTop: 8, color: 'var(--amber)' }}>{problem}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="tbw-btn" onClick={() => setOpen(false)} disabled={busy}>Dismiss</button>
            <button className="tbw-btn tbw-btn-cancel" data-testid="knock-submit" onClick={() => send(knockBody({ on, level }))} disabled={busy || !!problem}>
              {busy ? '⏳ RECORDING…' : '✓ RECORD THE TOUCH'}
            </button>
          </div>
        </div>
      )}
      {error && <div className="tbw-error" data-testid="knock-error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
