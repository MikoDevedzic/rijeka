// trade-window/knock.test.js
// The helpers behind the ticket's BARRIER block. Run: npm test.
import { describe, it, expect } from 'vitest'
import { canRecordKnock, knockLine, knockParts, knockProblem, knockBody, knockLastDay, hasExpired } from './knock'

const trade = (over = {}, terms = {}) => ({ instrument_type: 'CRYPTO_OPTION', status: 'CONFIRMED', trade_date: '2026-11-02',
  terms: { style: 'BARRIER', expiration_date: '2027-02-02', ...terms }, ...over })

describe('which trades take a record', () => {
  it('a booked digital-asset option with a barrier or a touch level, still open', () => {
    expect(canRecordKnock(trade())).toBe(true)
    for (const style of ['DOUBLE_BARRIER', 'TOUCH']) expect(canRecordKnock(trade({}, { style }))).toBe(true)
    expect(canRecordKnock(trade({ status: 'PENDING' }))).toBe(true)
  })
  it('not a plain option, another product, or a closed trade', () => {
    for (const style of ['EUROPEAN', 'AMERICAN', 'DIGITAL', undefined]) expect(canRecordKnock(trade({}, { style }))).toBe(false)
    for (const instrument_type of ['FX_OPTION', 'CRYPTO_FORWARD', 'IR_SWAP']) expect(canRecordKnock(trade({ instrument_type }))).toBe(false)
    for (const status of ['TERMINATED', 'CANCELLED', 'MATURED']) expect(canRecordKnock(trade({ status }))).toBe(false)
    expect(canRecordKnock(null)).toBe(false)
  })
})

describe('what the record says and what may be typed', () => {
  it('says what is recorded', () => {
    expect(knockLine({})).toMatch(/Nothing recorded/)
    expect(knockLine({ knocked: true, knock_date: '2026-11-10', knock_level: 151200.5 })).toBe('Touched on 2026-11-10 at 151,200.5')
    expect(knockLine({ knocked: true, knock_date: '2026-11-10' })).toBe('Touched on 2026-11-10')
    expect(knockLine({ knocked: false })).toBe('Never touched, as the desk said at expiry')
    // only the figures are marked for the mono face
    expect(knockParts({ knocked: true, knock_date: '2026-11-10', knock_level: 151200.5 })).toEqual([['Touched on ', false], ['2026-11-10', true], [' at ', false], ['151,200.5', true]])
  })
  it('dates a touch between the trade date and the earlier of today and the expiry', () => {
    const today = '2026-11-12'
    expect(knockProblem({ on: '2026-11-10', level: '', trade: trade(), today })).toBeNull()
    expect(knockProblem({ on: '', level: '', trade: trade(), today })).toMatch(/Enter the date/)
    expect(knockProblem({ on: '2026-11-01', level: '', trade: trade(), today })).toMatch(/before the trade date/)
    expect(knockProblem({ on: '2026-11-13', level: '', trade: trade(), today })).toMatch(/cannot be after 2026-11-12/)
    expect(knockProblem({ on: '2027-02-03', level: '', trade: trade(), today: '2027-03-01' })).toMatch(/cannot be after 2027-02-02/)
    expect(knockProblem({ on: '2026-11-10', level: '-4', trade: trade(), today })).toMatch(/positive price/)
    expect(knockLastDay(trade(), today)).toBe(today)
    expect(knockLastDay(trade(), '2027-03-01')).toBe('2027-02-02')
    expect(hasExpired(trade(), today)).toBe(false)
    expect(hasExpired(trade(), '2027-02-02')).toBe(true)
  })
  it('sends the date, and the level only when one was typed', () => {
    expect(knockBody({ on: '2026-11-10', level: '' })).toEqual({ knocked: true, on: '2026-11-10' })
    expect(knockBody({ on: '2026-11-10', level: '151,200.5' })).toEqual({ knocked: true, on: '2026-11-10', level: 151200.5 })
  })
})
