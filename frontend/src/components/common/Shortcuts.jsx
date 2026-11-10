// common/Shortcuts.jsx — the listener for the desk's function keys (lib/shortcuts.js), mounted once inside the
// router, and the keycap a button shows. Signed out, no key is taken.
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import useBookingStore from '../../store/useBookingStore'
import { matchShortcut, runTicketShortcut, keyLabel } from '../../lib/shortcuts'

export default function Shortcuts() {
  const navigate = useNavigate()
  const signedIn = useAuthStore(s => !!s.session)
  useEffect(() => {
    if (!signedIn) return
    const onKey = (e) => {
      const s = matchShortcut(e)
      if (!s) return
      let taken = false
      if (s.scope === 'ticket') taken = runTicketShortcut(s.id)
      else if (s.id === 'new-trade') { useBookingStore.getState().open(); taken = true }
      else if (s.path) { navigate(s.path); taken = true }
      if (taken) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [signedIn, navigate])
  return null
}

// The key printed on its button. Hidden from assistive technology and from a button's accessible name (the
// button carries aria-keyshortcuts instead), so a button is still found and announced by its own words.
export function Keycap({ id, style }) {
  const k = keyLabel(id)
  return k ? <kbd className="kc" aria-hidden="true" style={style}>{k}</kbd> : null
}
