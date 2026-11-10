// common/Shortcuts.jsx — the listener for the desk's function keys (lib/shortcuts.js), mounted once inside the
// router, and the keycap a button shows. Signed out, no key is taken.
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import useBookingStore from '../../store/useBookingStore'
import { matchShortcut, runTicketShortcut, shortcutsOff, keyLabel } from '../../lib/shortcuts'

export default function Shortcuts() {
  const navigate = useNavigate()
  const go = useRef(navigate)
  useEffect(() => { go.current = navigate })      // the listener is registered once per sign-in: what was touched outlives a change of page
  const signedIn = useAuthStore(s => !!s.session)
  useEffect(() => {
    if (!signedIn) return
    // which ticket the user last touched, and when the newest one was opened (lib/shortcuts.js activeTicket)
    const touched = { el: null, at: 0, openedAt: 0 }
    const touch = (e) => { const w = e.target?.closest?.('.tbw-window'); if (w) { touched.el = w; touched.at = performance.now() } }
    let count = useBookingStore.getState().windows.length
    const unsubscribe = useBookingStore.subscribe(st => { if (st.windows.length > count) touched.openedAt = performance.now(); count = st.windows.length })
    const onKey = (e) => {
      const s = matchShortcut(e)
      if (!s || shortcutsOff()) return
      let taken = false
      if (s.scope === 'ticket') taken = runTicketShortcut(s.id, document, touched).taken
      else if (s.id === 'new-trade') {
        document.activeElement?.blur?.()          // the focus does not stay in a field of the ticket about to be covered
        useBookingStore.getState().open(); taken = true
      } else if (s.path) { go.current(s.path); taken = true }
      if (taken) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', touch, true)
    document.addEventListener('focusin', touch, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', touch, true)
      document.removeEventListener('focusin', touch, true)
      unsubscribe()
    }
  }, [signedIn])
  return null
}

// The key printed on its button. Hidden from assistive technology and from a button's accessible name (the
// button carries aria-keyshortcuts instead), so a button is still found and announced by its own words.
export function Keycap({ id, style }) {
  const k = keyLabel(id)
  return k ? <kbd className="kc" aria-hidden="true" style={style}>{k}</kbd> : null
}
