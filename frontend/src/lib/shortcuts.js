// lib/shortcuts.js — the desk's function keys. One table, read by the listener (components/common/Shortcuts.jsx)
// and by every button that shows its key (Keycap), so a key and its label cannot drift apart.
//
//   F1 Home · F2 Blotter · F3 New trade · F4 Price · F5 XVA (again: simulate) · F6 Confirm · F8 Methodology
//   Ctrl/⌘ + Enter books the open ticket: a chord, because booking writes a trade.
//
// A page key (F1, F2, F3, F8) always acts. A ticket key (F4, F5, F6, the chord) acts only when a ticket is open
// and its button is there and enabled; otherwise the key is left to the browser (F5 reloads, as anywhere).
// F7 is kept for the inspector on a figure, which is not built yet.
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

// The open ticket a key acts on: the one that holds the focus, else the one opened last (it is drawn on top).
export function activeTicket(doc = document) {
  const all = [...doc.querySelectorAll('.tbw-window')]
  return all.find(w => w.contains(doc.activeElement)) || all[all.length - 1] || null
}

// A ticket key presses the ticket's own button, so it does exactly what the click does and nothing when the
// button is missing (a module switched off) or disabled (pricing in flight, nothing to book). Returns whether a
// button was pressed: only then is the key taken from the browser.
const press = (el) => { if (!el || el.disabled) return false; el.click(); return true }
export function runTicketShortcut(id, doc = document) {
  const win = activeTicket(doc)
  if (!win) return false
  const tab = (name) => win.querySelector(`.tbw-tab[data-tab="${name}"]`)
  if (id === 'price') return press(win.querySelector('[data-action="price"]'))
  if (id === 'book') return press(win.querySelector('[data-action="book"]'))
  if (id === 'confirm') return press(tab('◆ CONFIRM'))
  if (id === 'xva') {
    const t = tab('XVA')
    if (!t) return false
    if (!t.classList.contains('is-active')) return press(t)
    // already on the tab: the key runs it (the visible SIMULATE of this ticket: rates and currency tickets each have one)
    const sim = [...win.querySelectorAll('[data-action="simulate"]')].find(b => b.offsetParent !== null)
    return press(sim) || true
  }
  return false
}
