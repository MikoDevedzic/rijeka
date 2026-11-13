// On a phone, the app says what it is: a desk's screen, of which the phone shows a part. Once on the door (a visitor
// reads it before signing in) and once on the home, where it can be closed and stays closed on that phone.
// A monitor is never told: both return nothing above a phone's width.
import { useState } from 'react'
import { usePhone } from '../../lib/phone'

const CLOSED = 'rijeka.desk-note.closed'
const wasClosed = () => { try { return window.localStorage.getItem(CLOSED) === '1' } catch { return false } }      // a private window may have no storage
const remember = () => { try { window.localStorage.setItem(CLOSED, '1') } catch { /* it stays closed for this visit */ } }

const Monitor = () => (
  <svg className="dn-glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.5" /><path d="M5.5 14h5M8 11v3" />
  </svg>
)

export function DeskNoteDoor() {
  if (!usePhone()) return null
  return (
    <p className="dn dn-door" data-testid="desk-note-door">
      <Monitor /><span><b>Built for a monitor.</b> A phone shows the home, trades, a new trade, chat and news.</span>
    </p>
  )
}

export function DeskNoteHome() {
  const phone = usePhone()
  const [closed, setClosed] = useState(wasClosed)
  if (!phone || closed) return null
  return (
    <div className="dn dn-home" role="note" data-testid="desk-note-home">
      <Monitor />
      <span><b>This is the phone view.</b> Risk, P&amp;L, market data and the full ticket are on a monitor, at <b>app.rijeka.app</b>.</span>
      <button type="button" className="dn-close" aria-label="Close this note" onClick={() => { remember(); setClosed(true) }}>✕</button>
    </div>
  )
}
