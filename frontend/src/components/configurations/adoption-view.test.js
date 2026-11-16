// The Adoption panel's words and figures.
import { describe, it, expect } from 'vitest'
import { day, eventLabel, headline, kept, share, span, stepLabel, stepSays, week } from './adoption-view'

describe('adoption-view', () => {
  it('names each step and each kind of activity in words', () => {
    expect(stepLabel('returned')).toBe('CAME BACK'); expect(stepSays('returned')).toMatch(/later day/)
    expect(stepLabel('xva')).toBe('RAN XVA'); expect(stepLabel('other')).toBe('OTHER')
    expect(eventLabel('priced', 'crypto')).toBe('PRICED · crypto'); expect(eventLabel('pnl', '')).toBe('P&L')
    expect(eventLabel('market_data', 'currency')).toBe('MARKET DATA SAVED · currency'); expect(eventLabel('new_kind', '')).toBe('NEW KIND')
  })
  it('writes a share, a span of time and a day', () => {
    expect(share(2 / 3)).toBe('67%'); expect(share(1)).toBe('100%'); expect(share(null)).toBe('—'); expect(share(undefined)).toBe('—')
    expect(span(0.2)).toBe('12 min'); expect(span(3)).toBe('3.0 h'); expect(span(25.5)).toBe('26 h'); expect(span(72)).toBe('3.0 d'); expect(span(null)).toBe('—')
    expect(day('2026-11-16')).toBe('16 Nov 2026'); expect(day('2026-09-28')).toBe('28 Sep 2026'); expect(day(null)).toBe('—'); expect(day('soon')).toBe('—'); expect(week('2026-11-16')).toBe('w/c 16 Nov')
  })
  it('says in the header what is recorded', () => {
    expect(headline({ accounts: 1, recording: true, tracking_since: '2026-11-16' })).toBe('1 account · activity recorded since 16 Nov 2026')
    expect(headline({ accounts: 12, recording: false })).toBe('12 accounts · bookings and confirmations only: the activity table is not applied')
    expect(headline(null)).toBe('')
  })
  it('a cohort cell is a count and its share, and blank for a week that has not begun', () => {
    expect(kept(3, 4)).toBe('3 · 75%'); expect(kept(0, 4)).toBe('0 · 0%'); expect(kept(0, 0)).toBe(''); expect(kept(null, 4)).toBe('')
  })
})
