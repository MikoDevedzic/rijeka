// lib/shortcuts.js — the desk's function keys. One table, read by the listener (components/common/Shortcuts.jsx)
// and by every button that shows its key (Keycap), so a key and its label cannot drift apart.
//
//   F1 Home · F2 Blotter · F3 New trade · F4 Price · F5 XVA (again: simulate) · F6 Confirm · F8 Methodology
//   Ctrl/⌘ + Enter books the open ticket: a chord, because booking writes a trade.
//
// A page key (F1, F2, F3, F8) always acts on the desk. A ticket key (F4, F5, F6) acts on the open ticket (see
// activeTicket for which) and is taken from the browser whenever one is open; with none open it is left to the
// browser (F5 reloads, as anywhere). The chord books only the ticket that holds the focus. No key acts in a window
// that is not the desk (shortcutsOff). F7 is kept for the inspector on a figure, which is not built yet.
export const SHORTCUTS = [
  { id: 'home',        key: 'F1', label: 'Home',        scope: 'page',   path: '/command-center' },
  { id: 'blotter',     key: 'F2', label: 'Blotter',     scope: 'page',   path: '/blotter' },
  { id: 'new-trade',   key: 'F3', label: 'New trade',   scope: 'page' },
  { id: 'price',       key: 'F4', label: 'Price',       scope: 'ticket' },
  { id: 'xva',         key: 'F5', label: 'XVA',         scope: 'ticket' },
  { id: 'confirm',     key: 'F6', label: 'Confirm',     scope: 'ticket' },
  { id: 'methodology', key: 'F8', label: 'Methodology', scope: 'page',   path: '/methodology' },
  { id: 'book',        key: 'Enter', chord: true, label: 'Book trade', scope: 'ticket' },
]
const BY_ID = Object.fromEntries(SHORTCUTS.map(s => [s.id, s]))
const BY_PATH = Object.fromEntries(SHORTCUTS.filter(s => s.path).map(s => [s.path, s]))

// What a keydown asks for, or null. A function key counts only on its own (Ctrl+F5 stays the browser's hard
// reload, Alt+F4 the window's); the chord is Ctrl or ⌘ with Enter and nothing else. A held key does not repeat.
export function matchShortcut(e) {
  if (!e || e.repeat || e.isComposing) return null
  const mod = !!(e.ctrlKey || e.metaKey)
  if (e.altKey || e.shiftKey) return null
  for (const s of SHORTCUTS) {
    if (s.key !== e.key) continue
    if (s.chord ? mod : !mod) return s
  }
  return null
}

// The key as it is printed on a button: "F4", or the chord for this machine ("⌘↵" on a Mac, "Ctrl ↵" elsewhere).
export function keyLabel(id, mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')) {
  const s = BY_ID[id]
  if (!s) return ''
  return s.chord ? (mac ? '⌘↵' : 'Ctrl ↵') : s.key
}
export const shortcutForPath = (path) => BY_PATH[path] || null

// What a button carries in aria-keyshortcuts, from the same table as its keycap.
export const ariaKey = (id) => { const s = BY_ID[id]; return !s ? undefined : s.chord ? 'Control+Enter Meta+Enter' : s.key }

// Which open ticket a key acts on. Tickets are drawn in the order they were opened and none is raised, so "the
// one the user means" is: the ticket holding the focus; else the one they last touched (a click or a focus inside
// it), unless a ticket has been opened since, which is then the one in front; else the newest. `touched` is kept by
// the listener ({ el, at } and the time the newest ticket was opened).
export function activeTicket(doc = document, touched = null) {
  const all = [...doc.querySelectorAll('.tbw-window')]
  if (!all.length) return null
  const focused = all.find(w => w.contains(doc.activeElement))
  if (focused) return focused
  if (touched?.el && all.includes(touched.el) && touched.at > (touched.openedAt || 0)) return touched.el
  return all[all.length - 1]
}

// A ticket key presses the ticket's own button, so it does exactly what the click does, and nothing when the
// button is missing (a module switched off) or disabled (pricing in flight, nothing to book).
// Returns { pressed, taken }. A function key is taken from the browser whenever a ticket is open, pressed or
// not: F5 must never reload the page from under an open ticket. The booking chord is different in two ways,
// because it writes a trade: it acts only on the ticket that holds the focus (never on one behind the messenger
// or under another window while the user types elsewhere), and it is taken only when it booked, so Ctrl+Enter
// still means what it meant to the field it was typed in.
const press = (el) => { if (!el || el.disabled) return false; el.click(); return true }
export function runTicketShortcut(id, doc = document, touched = null) {
  if (id === 'book') {
    const win = [...doc.querySelectorAll('.tbw-window')].find(w => w.contains(doc.activeElement))
    const pressed = !!win && press(win.querySelector('[data-action="book"]'))
    return { pressed, taken: pressed }
  }
  const win = activeTicket(doc, touched)
  if (!win) return { pressed: false, taken: false }
  const tab = (name) => win.querySelector(`.tbw-tab[data-tab="${name}"]`)
  let pressed = false
  if (id === 'price') pressed = press(win.querySelector('[data-action="price"]'))
  else if (id === 'confirm') pressed = press(tab('◆ CONFIRM'))
  else if (id === 'xva') {
    const t = tab('XVA')
    if (t && !t.classList.contains('is-active')) pressed = press(t)
    // already on the tab: the key runs it (the visible SIMULATE of this ticket)
    else if (t) pressed = press([...win.querySelectorAll('[data-action="simulate"]')].find(b => b.offsetParent !== null))
  }
  return { pressed, taken: true }
}

// Where the keys are off altogether: a window or page that is not the desk (the messenger's own window, the
// legal pages, the sign-in page) and the boot screen, each marked data-no-shortcuts.
export const shortcutsOff = (doc = document) => !!doc.querySelector('[data-no-shortcuts]')
