import { describe, it, expect } from 'vitest'
import { limitStanding, positions } from './states'

describe('what a Risk screen says when it does not know', () => {
  it('says NO LIMITS SET, in no colour, where nothing was tested', () => {
    expect(limitStanding([], 0, 0)).toEqual({ text: 'NO LIMITS SET', tone: '' })
    expect(limitStanding(undefined)).toEqual({ text: 'NO LIMITS SET', tone: '' })
    expect(limitStanding([{ id: 1 }], 0, 0)).toEqual({ text: 'WITHIN LIMITS', tone: 'ok' })
    expect(limitStanding([{ id: 1 }], 0, 2)).toEqual({ text: '2 WARNINGS', tone: 'amber' })
    expect(limitStanding([{ id: 1 }], 1, 2)).toEqual({ text: '1 BREACH', tone: 'red' })
    expect(limitStanding([{ id: 1 }, { id: 2 }], 2)).toEqual({ text: '2 BREACHES', tone: 'red' })
  })
  it('knows a position only from a stored run, and that no CSA means no margin', () => {
    const run = { csa_type: 'VM_IM', has_run: true }, none = { csa_type: 'VM', has_run: false }, bare = { csa_type: 'NO_CSA', has_run: false }
    expect(positions([none])).toEqual({ csa: 1, missing: 1, known: false })                 // nothing known: a dash, not $0
    expect(positions([none, bare])).toEqual({ csa: 1, missing: 1, known: false })
    expect(positions([run, none])).toEqual({ csa: 2, missing: 1, known: true })             // a total, less one
    expect(positions([run])).toEqual({ csa: 1, missing: 0, known: true })
    expect(positions([bare])).toEqual({ csa: 0, missing: 0, known: true })                  // no margin is exchanged: zero is true
    expect(positions([])).toEqual({ csa: 0, missing: 0, known: true })
    expect(positions(undefined)).toEqual({ csa: 0, missing: 0, known: true })
  })
})
