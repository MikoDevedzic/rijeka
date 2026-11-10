import { describe, it, expect } from 'vitest'
import { bodyFromForm, defaultForm, formFromSchedule, problems, rowFor, summary, termsFeed, total } from './collateral-schedule'

const SEED = [{ code: 'USD_CASH' }, { code: 'UST_BILL' }, { code: 'USDC' }, { code: 'EUR_CASH' }, { code: 'BUND' }]

describe('collateral schedule helpers', () => {
  it('round-trips a server schedule through the form', () => {
    const s = { eligible: [{ instrument: 'USD_CASH', vm: true, im: true }, { instrument: 'UST_BILL', csa_haircut_pct: 1 }, { instrument: 'USDC', im: false }],
      posted: { UST_BILL: 0.6, USDC: 0.4 }, received: { USD_CASH: 1 }, rail: 'on_chain', note: 'annex' }
    const f = formFromSchedule(s)
    expect(f.rows.map(r => r.instrument)).toEqual(['USD_CASH', 'UST_BILL', 'USDC'])
    expect(f.rows[1].csa_haircut_pct).toBe('1')
    expect(f.rows[1].posted).toBe('60')
    expect(f.rows[2].im).toBe(false)
    expect(f.rail).toBe('on_chain')
    const b = bodyFromForm(f)
    expect(b.eligible[2]).toEqual({ instrument: 'USDC', vm: true, im: false, csa_haircut_pct: null, limit_pct: null })
    expect(b.posted).toEqual({ UST_BILL: 60, USDC: 40 })
    expect(b.received).toEqual({ USD_CASH: 100 })
    expect(b.rail).toBe('on_chain')
    expect(b.note).toBe('annex')
  })
  it('defaults a new counterparty to cash and government paper of the CSA currency', () => {
    const f = defaultForm('EUR', SEED)
    expect(f.rows.map(r => r.instrument)).toEqual(['EUR_CASH', 'BUND'])
    expect(f.rows[0].posted).toBe('100')
    expect(defaultForm('JPY', SEED).rows[0].instrument).toBe('USD_CASH')
    expect(defaultForm('USD', []).rows).toEqual([])
  })
  it('names what stops a save', () => {
    expect(problems({ rows: [] })).toEqual(['admit at least one instrument'])
    const bad = { rows: [{ ...rowFor('USDC'), vm: false, posted: '40' }, { ...rowFor('UST_BILL'), csa_haircut_pct: '150' }, { ...rowFor('USD_CASH'), received: '-1' }] }
    expect(problems(bad)).toEqual(['USDC: posted or received but not admitted for VM', 'UST_BILL: haircut must be between 0 and 100', 'USD_CASH: weights must be non-negative'])
    expect(problems({ rows: [{ ...rowFor('USD_CASH'), posted: '100' }] })).toEqual([])
  })
  it('totals and summarises', () => {
    const f = { rows: [{ ...rowFor('UST_BILL'), posted: '60' }, { ...rowFor('USDC'), posted: '40', received: 'x' }] }
    expect(total(f, 'posted')).toBe(100)
    expect(total(f, 'received')).toBe(0)
    expect(summary({ posted: { USDC: 0.4, UST_BILL: 0.6 }, rail: 'on_chain' })).toBe('UST_BILL 60 · USDC 40 → on chain')
    expect(summary(null)).toBeNull()
  })
})

describe('what a counterparty\'s terms feed', () => {
  it('names only the pages the reader has', () => {
    expect(termsFeed({})).toBe("the CSA terms and the collateral schedule feed the credit report, the ticket's XVA tab, the ticket's CAPITAL tab and Risk → CAPITAL")
    // a demo user: capital held back
    expect(termsFeed({ CAPITAL: false })).toBe("the CSA terms and the collateral schedule feed the credit report and the ticket's XVA tab")
    // a launch workspace: no credit report either
    expect(termsFeed({ CAPITAL: false, COUNTERPARTY_CREDIT: false })).toBe("the CSA terms and the collateral schedule feed the ticket's XVA tab")
    expect(termsFeed({ CAPITAL: false, COUNTERPARTY_CREDIT: false, XVA: false })).toBe('')
  })
})
