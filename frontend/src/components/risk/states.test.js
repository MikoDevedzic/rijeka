import { describe, it, expect } from 'vitest'
import { limitStanding, positionOf, positions } from './states'

describe('what a Risk screen says when it does not know', () => {
  it('says WITHIN LIMITS only where a limit was tested', () => {
    const ok = { status: 'OK' }, na = { status: 'NA' }
    expect(limitStanding([], 0, 0)).toEqual({ text: 'NO LIMITS SET', tone: '' })
    expect(limitStanding(undefined)).toEqual({ text: 'NO LIMITS SET', tone: '' })
    expect(limitStanding([na, na])).toEqual({ text: 'NO LIMIT TESTED', tone: '' })       // set, and none could be given a value
    expect(limitStanding([na, ok])).toEqual({ text: 'WITHIN LIMITS', tone: 'ok' })
    expect(limitStanding([ok], 0, 2)).toEqual({ text: '2 WARNINGS', tone: 'amber' })
    expect(limitStanding([ok], 1, 2)).toEqual({ text: '1 BREACH', tone: 'red' })
    expect(limitStanding([], 2)).toEqual({ text: '2 BREACHES', tone: 'red' })
  })
  const run = { csa_type: 'VM_IM', has_run: true, trades: 3 }, absent = { csa_type: 'VM', has_run: false, trades: null }
  const failed = { csa_type: 'VM', has_run: false, trades: 2 }, bare = { csa_type: 'NO_CSA', has_run: false, trades: null }
  it('knows one counterparty\'s margin from the stored run, and says which kind of not knowing it is', () => {
    expect(positionOf(bare, false)).toBe('none')
    expect(positionOf(run, true)).toBe('run')
    expect(positionOf(absent, false)).toBe('unrun')        // nothing stored: not known
    expect(positionOf(absent, true)).toBe('flat')          // a run is stored and it is not in it: no live trade, nothing margined
    expect(positionOf(failed, true)).toBe('failed')        // in the run, not simulated: not known
    expect(positionOf({ csa_type: 'none' }, true)).toBe('none')
  })
  it('totals: a dash where nothing is known, a figure that says what it leaves out, a true zero', () => {
    expect(positions([absent], false)).toEqual({ csa: 1, missing: 1, known: false, why: 'no credit run is stored: positions not known' })
    expect(positions([absent, bare], false)).toMatchObject({ csa: 1, missing: 1, known: false })
    expect(positions([absent], true)).toEqual({ csa: 1, missing: 0, known: true, why: null })            // no trades with it: zero is true
    expect(positions([run, absent], true)).toEqual({ csa: 2, missing: 0, known: true, why: null })
    expect(positions([run, failed], true)).toEqual({ csa: 2, missing: 1, known: true, why: '1 of 2 with a CSA could not be simulated in the stored run: not in the totals' })
    expect(positions([failed], true)).toEqual({ csa: 1, missing: 1, known: false, why: '1 of 1 with a CSA could not be simulated in the stored run' })
    expect(positions([run], true)).toMatchObject({ missing: 0, known: true, why: null })
    expect(positions([bare], false)).toEqual({ csa: 0, missing: 0, known: true, why: null })             // no margin is exchanged: zero is true
    expect(positions([], false)).toMatchObject({ csa: 0, known: true })
    expect(positions(undefined)).toMatchObject({ csa: 0, known: true })
  })
})
