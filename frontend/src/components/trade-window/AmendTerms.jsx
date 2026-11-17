// trade-window/AmendTerms.jsx
// AMEND, on the CONFIRM tab of a booked trade: the terms the trade has that can be changed, each with its value now
// and a field for the new one. A confirmed trade is amended (both parties sign where its record is on a chain); a
// pending one is corrected, since the other side has agreed nothing yet. The API says which terms there are and
// works out everything that changes (backend/chain/amendment.py); the helpers and their rules are in amend-terms.js.
import { useState } from 'react'
import { canAmend, amendProblem, amendBody, amendDone, amendWords, fmtTerm } from './amend-terms'
import Figures from './Figures'

export default function AmendTerms({ trade, pkg = null, terminated = false, busy = false, error = '', done = null, onLoad, onSubmit }) {
  const [open, setOpen] = useState(false)
  const [can, setCan] = useState(null)             // the API's answer: { kind, anchored, terms, why_not }
  const [loadErr, setLoadErr] = useState('')
  const [typed, setTyped] = useState({})
  const [reason, setReason] = useState('')
  const said = amendDone(done)
  if (!canAmend(trade, { pkg, terminated }) || !onSubmit || !onLoad) {
    return said ? <div className="tbw-mut" data-testid="amend-done" style={{ marginTop: 12, maxWidth: 520 }}><Figures text={said} /></div> : null
  }
  const words = amendWords(can?.kind || (trade.status === 'PENDING' ? 'CORRECTION' : 'AMENDMENT'))
  const show = async () => {
    setOpen(true); setLoadErr(''); setCan(null); setTyped({}); setReason('')
    try { setCan(await onLoad(trade.id)) } catch (e) { setLoadErr(e.message || String(e)) }
  }
  const offered = can?.terms || []
  const problem = can ? amendProblem(offered, typed) : null
  const touched = Object.values(typed).some(v => String(v || '').trim() !== '')
  const submit = async () => {
    if (!can || problem || busy) return
    const ok = await onSubmit(amendBody(offered, typed, reason))
    if (ok) setOpen(false)
  }
  return (
    <div data-testid="amend-terms" style={{ marginTop: 12, maxWidth: 520 }}>
      {/* what the amendment that reopened this ticket did: above the control, where it is read first */}
      {said && <div className="tbw-mut" data-testid="amend-done" style={{ marginBottom: 8, color: 'var(--text)' }}><Figures text={said} /></div>}
      {!open ? (
        <button className="tbw-btn" data-testid="amend-open" onClick={show}>{words.open}</button>
      ) : (
        <div style={{ padding: 12, background: 'var(--bg)', border: '1px solid var(--border-hi)', borderRadius: 'var(--r-2)' }}>
          <div className="tbw-lbl">{words.title}</div>
          {!can && !loadErr && <div className="tbw-mut" style={{ marginTop: 6 }}>Reading the trade's terms…</div>}
          {loadErr && <div className="tbw-error" data-testid="amend-load-error" style={{ marginTop: 8 }}>{loadErr}</div>}
          {can && (
            <>
              <div className="tbw-mut" data-testid="amend-what" style={{ lineHeight: 1.5, margin: '6px 0 10px' }}>
                {can.kind === 'CORRECTION'
                  ? 'This trade is pending: the counterparty has agreed nothing yet, so this puts the booking right and is recorded as a correction. No signature is claimed.'
                  : can.anchored
                    ? 'The trade stays, on the terms set here. The signed record is replaced on-chain by the amended one, with a signature from each party. When the counterparty signs for themselves this needs their signature; Rijeka signs both only if it holds their key.'
                    : 'The trade stays, on the terms set here. This trade has no record anchored on a chain: the booking is changed and the event says so.'}
                {' '}The trade keeps its reference and its UTI.
              </div>
              {can.why_not && <div className="tbw-mut" data-testid="amend-why-not" style={{ color: 'var(--amber)' }}>{can.why_not}</div>}
              {!can.why_not && offered.length === 0 && <div className="tbw-mut" data-testid="amend-why-not" style={{ color: 'var(--amber)' }}>This trade has no term that can be amended here yet.</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, alignItems: 'start' }}>
                {offered.map(t => (
                  <label key={t.key} data-testid={`amend-term-${t.key}`}>
                    <div className="tbw-lbl">{t.label}{t.unit ? ` · ${t.unit}` : ''}</div>
                    <input className="tbw-mono" data-testid={`amend-${t.key}`} inputMode="decimal" value={typed[t.key] ?? ''} disabled={busy || !!t.why_not}
                           onChange={e => setTyped(v => ({ ...v, [t.key]: e.target.value }))} placeholder={t.why_not ? 'not here yet' : fmtTerm(t.now)} style={{ width: '100%' }} />
                    <div className="tbw-mut" style={{ marginTop: 4 }}>
                      now <span className="tbw-mono" style={{ color: 'var(--text)' }}>{fmtTerm(t.now)}</span>{t.unit ? ` ${t.unit}` : ''}
                      {t.why_not ? <span data-testid={`amend-why-${t.key}`}> · {t.why_not}</span> : t.note ? <span> · {t.note}</span> : null}
                    </div>
                  </label>
                ))}
              </div>
              {offered.length > 0 && (
                <label style={{ display: 'block', marginTop: 10 }}>
                  <div className="tbw-lbl">REASON · OPTIONAL</div>
                  <input data-testid="amend-reason" value={reason} maxLength={200} disabled={busy} onChange={e => setReason(e.target.value)}
                         placeholder="kept with the event" style={{ width: '100%' }} />
                </label>
              )}
              <div className="tbw-mut" style={{ marginTop: 8 }}>Dates, schedules and a cap or floor's strike are not amended here yet.</div>
              {touched && problem && <div className="tbw-mut" data-testid="amend-problem" style={{ marginTop: 8, color: 'var(--amber)' }}>{problem}</div>}
            </>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="tbw-btn" onClick={() => setOpen(false)} disabled={busy}>Dismiss</button>
            <button className="tbw-btn tbw-btn-cancel" data-testid="amend-submit" onClick={submit} disabled={busy || !can || !!problem}>
              {busy ? (can?.anchored ? '⏳ SIGNING & ANCHORING…' : '⏳ CHANGING…') : words.submit}
            </button>
          </div>
        </div>
      )}
      {error && <div className="tbw-error" data-testid="amend-error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
