// guest/GuestAsk.jsx — the one question a guest is asked, wherever they reached for something an account has
// (store/useGuestStore `ask`). Mounted once, over everything, the ticket included.
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGuestStore } from '../../store/useGuestStore'
import './Guest.css'

const WORDS = {
  book:  { title: 'Create an account to book this trade', body: 'A booked trade lives in a blotter of your own, where you can confirm it on chain and come back to it. An account is free and takes an email and a password. You will fill the ticket in again after you sign in: a guest’s ticket is not kept.' },
  excel: { title: 'Create an account to download the Excel', body: 'The workbook reproduces each number with formulas you can read. It is built for an account; an account is free and takes an email and a password.' },
  other: { title: 'This needs an account', body: 'A guest can price a trade and read. To book, confirm or export, create an account: it is free and takes an email and a password.' },
}

export default function GuestAsk() {
  const asked = useGuestStore(s => s.asked)
  const close = useGuestStore(s => s.close)
  const navigate = useNavigate()
  const go = useRef(null)

  useEffect(() => {
    if (!asked) return
    go.current?.focus()
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [asked, close])

  if (!asked) return null
  const w = WORDS[asked] || WORDS.other
  return (
    <div className="gst-veil" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="gst-ask" role="dialog" aria-modal="true" aria-labelledby="gst-ask-title" data-testid="guest-ask" data-asked={asked}>
        <h2 id="gst-ask-title">{w.title}</h2>
        <p>{w.body}</p>
        <div className="gst-actions">
          <button type="button" className="gst-quiet" data-action="guest-ask-stay" onClick={close}>KEEP LOOKING</button>
          <button type="button" className="gst-go" data-action="guest-ask-signup" ref={go} onClick={() => { close(); navigate('/signup') }}>CREATE AN ACCOUNT</button>
        </div>
      </div>
    </div>
  )
}
