// The switches are asked for again when the API could not answer, and only then (store RETRY_MS).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/session', () => ({ getSessionMaybe: async () => ({ access_token: 't' }) }))

const { useModulesStore } = await import('./useModulesStore')
const answer = (status, body = {}) => ({ ok: status < 400, status, json: async () => body })
const HELD = { modules: { CAPITAL: false }, on_request: ['CAPITAL'], can_edit: true, view: 'full' }

describe('module switches: a read the API could not answer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('is asked again after a 5xx, and the answer then applies', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer(502)).mockResolvedValue(answer(200, HELD))
    vi.stubGlobal('fetch', fetch)
    await useModulesStore.getState().load()
    expect(useModulesStore.getState().loaded).toBe(true)                 // nobody waits on a failed read
    expect(useModulesStore.getState().modules.CAPITAL).toBe(true)        // and until it answers every module is on
    await vi.advanceTimersByTimeAsync(2999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(useModulesStore.getState().modules.CAPITAL).toBe(false)
    expect(useModulesStore.getState().onRequest).toEqual(['CAPITAL'])
    expect(useModulesStore.getState().modules.XVA).toBe(true)            // a module the answer does not name is on
    await vi.advanceTimersByTimeAsync(120000)
    expect(fetch).toHaveBeenCalledTimes(2)                               // an answer ends it
  })

  it('is not asked again after a refusal', async () => {
    const fetch = vi.fn().mockResolvedValue(answer(403))
    vi.stubGlobal('fetch', fetch)
    await useModulesStore.getState().load()
    await vi.advanceTimersByTimeAsync(120000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('is asked three more times when there is no answer at all (3, 10 and 30 seconds), then left', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetch)
    await useModulesStore.getState().load()
    for (const [ms, calls] of [[3000, 2], [10000, 3], [30000, 4], [600000, 4]]) {
      await vi.advanceTimersByTimeAsync(ms)
      expect(fetch).toHaveBeenCalledTimes(calls)
    }
    expect(useModulesStore.getState().loaded).toBe(true)
  })
})
