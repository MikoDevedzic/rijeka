// When the picture of a confirmation shows, and what it says (Vera, 11 November 2026: it ran over a terminated
// trade, over a cancelled one, and over the next trade booked in the same ticket).
import { describe, expect, it } from 'vitest'

import { confirmCaption, confirmPhase } from './confirm-phase'

describe('the picture of a confirmation', () => {
  it('shows nothing until a confirmation is asked for on this trade', () => {
    expect(confirmPhase({ status: 'PENDING' })).toBe(null)
    expect(confirmPhase({ status: 'CONFIRMED' })).toBe(null)          // confirmed earlier, or by the other side
    expect(confirmPhase()).toBe(null)
  })
  it('runs while it is in progress, whatever else is true', () => {
    expect(confirmPhase({ busy: true, status: 'PENDING' })).toBe('running')
    expect(confirmPhase({ busy: true, started: true, status: 'PENDING', failed: true })).toBe('running')     // a retry
  })
  it('completes when the trade is confirmed', () => {
    expect(confirmPhase({ started: true, status: 'CONFIRMED' })).toBe('done')
  })
  it('says failed only on a failure, and waits (still) in the gap between signing and the transaction being seen', () => {
    expect(confirmPhase({ started: true, status: 'PENDING', failed: true })).toBe('failed')
    expect(confirmPhase({ started: true, status: 'PENDING' })).toBe('waiting')
  })
  it('never runs over a trade that is not being confirmed', () => {
    for (const status of ['CANCELLED', 'TERMINATED', 'LIVE', 'MATURED', undefined]) {
      expect(confirmPhase({ started: true, status }), String(status)).toBe(null)
      expect(confirmPhase({ started: true, status, failed: true }), String(status)).toBe(null)
    }
  })
  it('says confirmed on chain only for a record that is anchored', () => {
    expect(confirmCaption('done', true)).toBe('CONFIRMED ON CHAIN')
    expect(confirmCaption('done', false)).toBe('CONFIRMED · NOT ANCHORED')
    expect(confirmCaption('running')).toBe('SIGNING AND ANCHORING')
    expect(confirmCaption('failed')).toBe('NOT CONFIRMED')
    expect(confirmCaption('waiting')).toBe('')
    expect(confirmCaption(null)).toBe('')
  })
})
