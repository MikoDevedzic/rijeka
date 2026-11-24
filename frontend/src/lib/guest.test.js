// lib/guest.test.js — a guest's pass in the browser (lib/guest.js): where a guest may be, the pass kept for the tab
// and given in a session's shape, a renewal before it runs out, and leaving. Run: npm test.
import { beforeEach, describe, it, expect, vi } from 'vitest'

const store = new Map()
globalThis.sessionStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
const now = () => Math.floor(Date.now() / 1000)
const answer = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

let guest
beforeEach(async () => {
  store.clear(); vi.resetModules(); vi.restoreAllMocks()
  guest = await import('./guest')
})

describe('where a guest may be', () => {
  it('its own page and the two documents, and nowhere else', () => {
    for (const p of ['/guest', '/methodology', '/methodology/xva', '/roadmap']) expect(guest.guestMayOpen(p), p).toBe(true)
    for (const p of ['/', '/blotter', '/command-center', '/configurations/users', '/ticket', '/messenger', '/guestx', '/methodologyx', '/roadmap/x', '/pnl'])
      expect(guest.guestMayOpen(p), p).toBe(false)
  })
})

describe('the pass', () => {
  it('nobody is a guest until a pass is taken; then the tab is, with the pass as its session', async () => {
    expect(guest.isGuest()).toBe(false)
    expect(guest.guestSession()).toBe(null)
    globalThis.fetch = vi.fn(async () => answer({ token: 'pass-1', expires_at: now() + 1800 }))
    const s = await guest.enterAsGuest()
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/public\/guest$/), { method: 'POST' })
    expect(s).toMatchObject({ access_token: 'pass-1', is_guest: true, user: { id: 'guest', email: null, is_guest: true } })
    expect(guest.isGuest()).toBe(true)
    vi.resetModules()                                              // the page is loaded again: the tab is still a guest's
    const again = await import('./guest')
    expect(again.isGuest()).toBe(true)
    expect(again.guestSession().access_token).toBe('pass-1')
  })

  it('a refusal says why and leaves nobody a guest', async () => {
    globalThis.fetch = vi.fn(async () => answer({ detail: 'Too many guest sessions; the next is taken in 40 s.' }, false, 429))
    await expect(guest.enterAsGuest()).rejects.toMatchObject({ message: expect.stringContaining('Too many guest sessions'), status: 429 })
    expect(guest.isGuest()).toBe(false)
  })

  it('a pass with time on it is used as it is; one about to end is renewed first, once', async () => {
    globalThis.fetch = vi.fn(async () => answer({ token: 'pass-1', expires_at: now() + 1800 }))
    await guest.enterAsGuest()
    expect((await guest.freshGuestSession()).access_token).toBe('pass-1')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    store.set('rijeka.guest', JSON.stringify({ token: 'pass-old', expires_at: now() + 30 })); vi.resetModules()
    const g = await import('./guest')
    globalThis.fetch = vi.fn(async () => answer({ token: 'pass-2', expires_at: now() + 1800 }))
    const [a, b] = await Promise.all([g.freshGuestSession(), g.freshGuestSession()])
    expect(a.access_token).toBe('pass-2'); expect(b.access_token).toBe('pass-2')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('a renewal that fails leaves the old pass for as long as it lasts', async () => {
    store.set('rijeka.guest', JSON.stringify({ token: 'pass-old', expires_at: now() + 30 })); vi.resetModules()
    const g = await import('./guest')
    globalThis.fetch = vi.fn(async () => answer({ detail: 'no' }, false, 503))
    expect((await g.freshGuestSession()).access_token).toBe('pass-old')
  })

  it('leaving ends it; something that is not a pass in the tab is nobody', async () => {
    globalThis.fetch = vi.fn(async () => answer({ token: 'pass-1', expires_at: now() + 1800 }))
    await guest.enterAsGuest(); guest.leaveGuest()
    expect(guest.isGuest()).toBe(false); expect(store.has('rijeka.guest')).toBe(false)
    for (const junk of ['{', '{"token":"x"}', 'null', '"a string"']) {
      store.set('rijeka.guest', junk); vi.resetModules()
      expect((await import('./guest')).isGuest(), junk).toBe(false)
    }
  })

  it('whether guests are taken is the API\'s answer, and no answer is no', async () => {
    globalThis.fetch = vi.fn(async () => answer({ enabled: true }))
    expect(await guest.guestsTaken()).toBe(true)
    globalThis.fetch = vi.fn(async () => answer({ enabled: false }))
    expect(await guest.guestsTaken()).toBe(false)
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') })
    expect(await guest.guestsTaken()).toBe(false)
  })
})
