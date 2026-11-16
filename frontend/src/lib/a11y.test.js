import { describe, it, expect, vi } from 'vitest'
import { pageName, pressKey } from './a11y'

describe('a page says which page it is', () => {
  it('by its address, pages under it too', () => {
    expect(pageName('/command-center')).toBe('Home')
    expect(pageName('/blotter')).toBe('Blotter')
    expect(pageName('/risk/limits')).toBe('Risk')
    expect(pageName('/pnl')).toBe('P&L')
    expect(pageName('/configurations/market-data/curves')).toBe('Configurations')
  })
  it('a page with a heading of its own, or one it does not know, gets none', () => {
    for (const p of ['/methodology', '/methodology/fx-options', '/login', '/terms', '/blotterx', '/', '/news', '/roadmap', '/configurations/counterparties', '/configurations/legal-entities']) expect(pageName(p)).toBe(null)
  })
})

describe('Enter or Space does what a click does, on the thing itself', () => {
  const ev = (key, same = true) => { const t = {}; return { key, target: t, currentTarget: same ? t : {}, preventDefault: vi.fn() } }
  it('fires on Enter and on Space and stops the page scrolling', () => {
    const fn = vi.fn(), on = pressKey(fn)
    const a = ev('Enter'), b = ev(' ')
    on(a); on(b)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(a.preventDefault).toHaveBeenCalled(); expect(b.preventDefault).toHaveBeenCalled()
  })
  it('not on another key, and not for a key pressed in a control inside it (a row\'s checkbox)', () => {
    const fn = vi.fn(), on = pressKey(fn)
    on(ev('a')); on(ev('Tab')); on(ev('Enter', false)); on(ev(' ', false))
    on({ ...ev('Enter'), ctrlKey: true }); on({ ...ev('Enter'), metaKey: true }); on({ ...ev(' '), altKey: true })        // Ctrl+Enter is the ticket's BOOK
    expect(fn).not.toHaveBeenCalled()
  })
})
