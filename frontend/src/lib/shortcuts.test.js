import { describe, it, expect } from 'vitest'
import { SHORTCUTS, matchShortcut, keyLabel, ariaKey, shortcutForPath, activeTicket, runTicketShortcut, shortcutsOff } from './shortcuts'

const key = (k, o = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...o })

// a ticket as the listener sees it: a window element with buttons found by selector
function ticket(name, clicks, o = {}) {
  const btn = (what, b = {}) => ({ disabled: false, offsetParent: {}, classList: { contains: (c) => c === 'is-active' && !!b.active }, click: () => clicks.push(`${name}:${what}`), ...b })
  const els = {
    '[data-action="price"]': btn('price'),
    '[data-action="book"]': btn('book', { disabled: !!o.bookDisabled }),
    '.tbw-tab[data-tab="XVA"]': o.noXva ? null : btn('xva-tab', { active: !!o.onXva }),
    '.tbw-tab[data-tab="◆ CONFIRM"]': o.noConfirm ? null : btn('confirm-tab'),
  }
  const sims = [btn('sim-hidden', { offsetParent: null }), btn('sim', { disabled: !!o.simDisabled })]
  const inside = o.inside || []
  return { name, contains: (el) => inside.includes(el), querySelector: (q) => els[q] ?? null, querySelectorAll: (q) => q === '[data-action="simulate"]' ? sims : [] }
}
const page = (wins, activeElement = null) => ({ activeElement, querySelectorAll: (q) => q === '.tbw-window' ? wins : [], querySelector: () => null })

describe('the desk\'s function keys', () => {
  it('one key per action, and the keys the mockup promised', () => {
    const plain = SHORTCUTS.filter(s => !s.chord)
    expect(new Set(plain.map(s => s.key)).size).toBe(plain.length)
    expect(Object.fromEntries(plain.map(s => [s.key, s.id]))).toEqual({ F1: 'home', F2: 'blotter', F3: 'new-trade', F4: 'price', F5: 'xva', F6: 'confirm', F8: 'methodology' })
    expect(SHORTCUTS.some(s => s.key === 'F7')).toBe(false)          // kept for the inspector
  })

  it('a function key counts only on its own', () => {
    expect(matchShortcut(key('F4'))?.id).toBe('price')
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) expect(matchShortcut(key('F5', mod)), JSON.stringify(mod)).toBeNull()
    expect(matchShortcut(key('F4', { repeat: true }))).toBeNull()      // a held key prices once
    expect(matchShortcut(key('F4', { isComposing: true }))).toBeNull()
    expect(matchShortcut(key('F9'))).toBeNull()
    expect(matchShortcut(key('a'))).toBeNull()
    expect(matchShortcut(null)).toBeNull()
  })

  it('booking is a chord: Enter alone is never a shortcut', () => {
    expect(matchShortcut(key('Enter'))).toBeNull()
    expect(matchShortcut(key('Enter', { ctrlKey: true }))?.id).toBe('book')
    expect(matchShortcut(key('Enter', { metaKey: true }))?.id).toBe('book')
    expect(matchShortcut(key('Enter', { ctrlKey: true, shiftKey: true }))).toBeNull()
    expect(matchShortcut(key('Enter', { ctrlKey: true, repeat: true }))).toBeNull()
  })

  it('prints the key for the machine, says it to assistive technology, and knows the page a key opens', () => {
    expect(keyLabel('price')).toBe('F4')
    expect(keyLabel('book', true)).toBe('⌘↵'); expect(keyLabel('book', false)).toBe('Ctrl ↵')
    expect(keyLabel('nope')).toBe('')
    expect(ariaKey('price')).toBe('F4'); expect(ariaKey('xva')).toBe('F5'); expect(ariaKey('new-trade')).toBe('F3')
    expect(ariaKey('book')).toBe('Control+Enter Meta+Enter'); expect(ariaKey(undefined)).toBeUndefined()
    expect(shortcutForPath('/blotter')?.key).toBe('F2'); expect(shortcutForPath('/risk')).toBeNull()
  })

  it('which ticket a key means: the focused one, else the one last touched unless a newer one has opened, else the newest', () => {
    const field = {}, clicks = []
    const a = ticket('a', clicks, { inside: [field] }), b = ticket('b', clicks)
    expect(activeTicket(page([]))).toBeNull()
    expect(activeTicket(page([a, b]))).toBe(b)                                              // nothing touched: the newest, which is in front
    expect(activeTicket(page([a, b], field))).toBe(a)                                       // the focus wins
    expect(activeTicket(page([a, b]), { el: a, at: 20, openedAt: 10 })).toBe(a)             // touched after the newest opened
    expect(activeTicket(page([a, b]), { el: a, at: 5, openedAt: 10 })).toBe(b)              // a ticket opened since: that one
    expect(activeTicket(page([b]), { el: a, at: 20, openedAt: 10 })).toBe(b)                // the touched ticket has been closed
  })

  it('a ticket key presses the ticket\'s own button; with a ticket open it is always taken from the browser', () => {
    const clicks = []
    const t = ticket('t', clicks, { noConfirm: true })
    expect(runTicketShortcut('price', page([t]))).toEqual({ pressed: true, taken: true })
    expect(runTicketShortcut('confirm', page([t]))).toEqual({ pressed: false, taken: true })     // no CONFIRM tab (module off): nothing pressed, no browser action either
    expect(runTicketShortcut('xva', page([t]))).toEqual({ pressed: true, taken: true })          // opens the tab
    const onTab = ticket('t', clicks, { onXva: true })
    expect(runTicketShortcut('xva', page([onTab]))).toEqual({ pressed: true, taken: true })      // on the tab already: the visible SIMULATE
    const busy = ticket('t', clicks, { onXva: true, simDisabled: true })
    expect(runTicketShortcut('xva', page([busy]))).toEqual({ pressed: false, taken: true })      // a run in flight: F5 still does not reload the page
    const noXva = ticket('t', clicks, { noXva: true })
    expect(runTicketShortcut('xva', page([noXva]))).toEqual({ pressed: false, taken: true })     // XVA switched off: the open ticket is not lost to a reload
    expect(clicks).toEqual(['t:price', 't:xva-tab', 't:sim'])
    expect(runTicketShortcut('price', page([]))).toEqual({ pressed: false, taken: false })       // no ticket: the key is the browser's
    expect(runTicketShortcut('xva', page([]))).toEqual({ pressed: false, taken: false })
  })

  it('the chord books only the ticket that holds the focus, and is taken only when it booked', () => {
    const clicks = [], field = {}, elsewhere = {}
    const a = ticket('a', clicks, { inside: [field] }), b = ticket('b', clicks)
    expect(runTicketShortcut('book', page([a, b], elsewhere))).toEqual({ pressed: false, taken: false })      // typing in the messenger: not a booking, and the chord is left to that field
    expect(runTicketShortcut('book', page([a, b], null))).toEqual({ pressed: false, taken: false })           // nothing focused: not a booking
    expect(runTicketShortcut('book', page([a, b]), { el: b, at: 9, openedAt: 1 })).toEqual({ pressed: false, taken: false })      // a touched ticket is not a focused one
    expect(clicks).toEqual([])
    expect(runTicketShortcut('book', page([a, b], field))).toEqual({ pressed: true, taken: true })            // the focus is in ticket a: a is booked, though b is in front
    expect(clicks).toEqual(['a:book'])
    const done = ticket('d', clicks, { inside: [field], bookDisabled: true })
    expect(runTicketShortcut('book', page([done], field))).toEqual({ pressed: false, taken: false })          // booked already, or nothing priced
  })

  it('no key acts in a window that is not the desk', () => {
    expect(shortcutsOff({ querySelector: (q) => q === '[data-no-shortcuts]' ? {} : null })).toBe(true)
    expect(shortcutsOff({ querySelector: () => null })).toBe(false)
  })
})
