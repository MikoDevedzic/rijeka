// layout/visible-nav.test.js — the top-level navigation under the firm's module switches (useVisibleNav.js). Run: npm test.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/session', () => ({ getSessionMaybe: async () => null }))   // the store's only import that needs a browser

const { visibleNav } = await import('./useVisibleNav')
const { MODULE_KEYS } = await import('../../store/useModulesStore')

const ALL = Object.fromEntries(MODULE_KEYS.map(k => [k, true]))
const off = (...keys) => ({ ...ALL, ...Object.fromEntries(keys.map(k => [k, false])) })
const to = (nav, label) => nav.find(n => n.label === label)?.to

describe('visibleNav', () => {
  it('shows every item, each opening its own page, when every module is on', () => {
    const nav = visibleNav(ALL)
    expect(nav.map(n => n.label)).toEqual(['HOME', 'BLOTTER', 'P&L', 'RISK', 'CONFIGURATIONS', 'METHODOLOGY', 'ROADMAP'])
    expect(nav.every(n => n.to === n.path)).toBe(true)
  })

  it('treats a module the answer does not mention as on', () => {
    expect(visibleNav({}).map(n => n.label)).toContain('RISK')
  })

  it('hides P&L and RISK on the launch set', () => {
    const nav = visibleNav(off('PNL', 'MARKET_RISK', 'COUNTERPARTY_CREDIT', 'CAPITAL', 'COLLATERAL', 'XVA_RESERVES', 'IPV'))
    expect(nav.map(n => n.label)).toEqual(['HOME', 'BLOTTER', 'CONFIGURATIONS', 'METHODOLOGY', 'ROADMAP'])
  })

  it('sends RISK to the first risk page whose module is on', () => {
    expect(to(visibleNav(off('MARKET_RISK')), 'RISK')).toBe('/risk/ccr')
    expect(to(visibleNav(off('MARKET_RISK', 'COUNTERPARTY_CREDIT')), 'RISK')).toBe('/risk/capital')
    expect(to(visibleNav(off('MARKET_RISK', 'COUNTERPARTY_CREDIT', 'CAPITAL')), 'RISK')).toBe('/risk/collateral')
  })

  it('keeps RISK for a firm that runs collateral alone', () => {
    const nav = visibleNav(off('MARKET_RISK', 'COUNTERPARTY_CREDIT', 'CAPITAL'))
    expect(nav.map(n => n.label)).toContain('RISK')
  })

  it('hides P&L when the P&L module is off, whatever its sub-modules say', () => {
    expect(visibleNav(off('PNL')).map(n => n.label)).not.toContain('P&L')
  })
})
