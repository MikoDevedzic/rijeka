import { describe, it, expect } from 'vitest'
import { SHORTCUTS, matchShortcut, keyLabel, shortcutForPath, runTicketShortcut } from './shortcuts'

const key = (k, o = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...o })

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
    expect(matchShortcut(key('F9'))).toBeNull()
    expect(matchShortcut(key('a'))).toBeNull()
    expect(matchShortcut(null)).toBeNull()
  })
  it('booking is a chord: Enter alone is never a shortcut', () => {
    expect(matchShortcut(key('Enter'))).toBeNull()
    expect(matchShortcut(key('Enter', { ctrlKey: true }))?.id).toBe('book')
    expect(matchShortcut(key('Enter', { metaKey: true }))?.id).toBe('book')
    expect(matchShortcut(key('Enter', { ctrlKey: true, shiftKey: true }))).toBeNull()
  })
  it('prints the key for the machine, and knows the page a key opens', () => {
    expect(keyLabel('price')).toBe('F4')
    expect(keyLabel('book', true)).toBe('⌘↵'); expect(keyLabel('book', false)).toBe('Ctrl ↵')
    expect(keyLabel('nope')).toBe('')
    expect(shortcutForPath('/blotter')?.key).toBe('F2'); expect(shortcutForPath('/risk')).toBeNull()
  })
  it('a ticket key presses the ticket\'s own button, and is left to the browser when there is none', () => {
    const clicks = []
    const btn = (name, o = {}) => ({ disabled: false, offsetParent: {}, classList: { contains: (c) => c === 'is-active' && !!o.active }, click: () => clicks.push(name), ...o })
    const els = { '[data-action="price"]': btn('price'), '[data-action="book"]': btn('book', { disabled: true }),
      '.tbw-tab[data-tab="XVA"]': btn('xva-tab'), '.tbw-tab[data-tab="◆ CONFIRM"]': null }
    const sims = [btn('sim-hidden', { offsetParent: null }), btn('sim')]
    const win = { contains: () => false, querySelector: (q) => els[q] ?? null, querySelectorAll: (q) => q === '[data-action="simulate"]' ? sims : [] }
    const doc = { activeElement: null, querySelectorAll: () => [win] }
    expect(runTicketShortcut('price', doc)).toBe(true)
    expect(runTicketShortcut('book', doc)).toBe(false)                 // disabled: not pressed, the key is not taken
    expect(runTicketShortcut('confirm', doc)).toBe(false)              // the tab is not there (module off)
    expect(runTicketShortcut('xva', doc)).toBe(true)                   // opens the tab
    els['.tbw-tab[data-tab="XVA"]'] = btn('xva-tab', { active: true })
    expect(runTicketShortcut('xva', doc)).toBe(true)                   // on the tab already: runs the visible SIMULATE
    expect(clicks).toEqual(['price', 'xva-tab', 'sim'])
    expect(runTicketShortcut('price', { activeElement: null, querySelectorAll: () => [] })).toBe(false)      // no ticket open
  })
})
