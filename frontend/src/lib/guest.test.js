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
    const asked = globalThis.fetch = vi.fn(async () => answer({ token: 'pass-1', expires_at: now() + 1800 }))      // (the tab then watches its own requests: the spy is kept by name)
    const s = await guest.enterAsGuest()
    expect(asked).toHaveBeenCalledWith(expect.stringMatching(/\/api\/public\/guest$/), { method: 'POST' })
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
    const first = globalThis.fetch = vi.fn(async () => answer({ token: 'pass-1', expires_at: now() + 1800 }))
    await guest.enterAsGuest()
    expect((await guest.freshGuestSession()).access_token).toBe('pass-1')
    expect(first).toHaveBeenCalledTimes(1)
    store.set('rijeka.guest', JSON.stringify({ token: 'pass-old', expires_at: now() + 30 })); vi.resetModules()
    const g = await import('./guest')
    const second = globalThis.fetch = vi.fn(async () => answer({ token: 'pass-2', expires_at: now() + 1800 }))
    const [a, b] = await Promise.all([g.freshGuestSession(), g.freshGuestSession()])
    expect(a.access_token).toBe('pass-2'); expect(b.access_token).toBe('pass-2')
    expect(second).toHaveBeenCalledTimes(1)
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

describe('a pass that ended with the API that signed it (a restart)', () => {
  const API = 'http://localhost:8000'
  const setUp = async (answers) => {
    const calls = []
    const target = { fetch: vi.fn(async (url, init) => {
      calls.push({ url, auth: new Headers(init?.headers || {}).get('Authorization') })
      if (String(url).endsWith('/api/public/guest')) return answer({ token: 'pass-2', expires_at: now() + 1800 })
      return answers.shift()
    }) }
    store.set('rijeka.guest', JSON.stringify({ token: 'pass-1', expires_at: now() + 1800 })); vi.resetModules()
    const g = await import('./guest')
    globalThis.fetch = (...a) => target.fetch(...a)
    g.isGuest(); g.watchForAnEndedPass(target)
    return { g, target, calls }
  }

  it('a guest\'s call answered 401 takes one new pass and is sent once more', async () => {
    const { target, calls } = await setUp([answer({ detail: 'Invalid token' }, false, 401), answer({ npv: 1 })])
    const r = await target.fetch(API + '/price/preview', { method: 'POST', headers: { Authorization: 'Bearer pass-1' }, body: '{}' })
    expect(r.ok).toBe(true)
    expect(calls.map(c => [c.url.replace(API, ''), c.auth])).toEqual([['/price/preview', 'Bearer pass-1'], ['/api/public/guest', null], ['/price/preview', 'Bearer pass-2']])
  })

  it('once: a second refusal is the answer', async () => {
    const { target, calls } = await setUp([answer({}, false, 401), answer({}, false, 401)])
    const r = await target.fetch(API + '/price/preview', { method: 'POST', headers: { Authorization: 'Bearer pass-1' }, body: '{}' })
    expect(r.status).toBe(401)
    expect(calls.length).toBe(3)
  })

  it('anything else is left as it is: another refusal, another host, another token, a body that cannot be sent twice', async () => {
    for (const [url, init, res] of [
      [API + '/api/book/trade', { headers: { Authorization: 'Bearer pass-1' } }, answer({}, false, 403)],
      ['https://elsewhere.example/x', { headers: { Authorization: 'Bearer pass-1' } }, answer({}, false, 401)],
      [API + '/api/modules', { headers: { Authorization: 'Bearer an-account-token' } }, answer({}, false, 401)],
      [API + '/api/modules', {}, answer({}, false, 401)],
      [API + '/price/preview', { method: 'POST', headers: { Authorization: 'Bearer pass-1' }, body: new Blob(['x']) }, answer({}, false, 401)],
    ]) {
      const { target, calls } = await setUp([res])
      const r = await target.fetch(url, init)
      expect(r.status, url).toBe(res.status)
      expect(calls.length, url).toBe(1)
    }
  })

  it('no new pass to be had: the refusal stands', async () => {
    const calls = []
    const target = { fetch: vi.fn(async (url) => { calls.push(url); return answer({ detail: 'no' }, false, String(url).endsWith('/api/public/guest') ? 503 : 401) }) }
    store.set('rijeka.guest', JSON.stringify({ token: 'pass-1', expires_at: now() + 1800 })); vi.resetModules()
    const g = await import('./guest')
    globalThis.fetch = (...a) => target.fetch(...a)
    g.isGuest(); g.watchForAnEndedPass(target)
    const r = await target.fetch(API + '/api/modules', { headers: { Authorization: 'Bearer pass-1' } })
    expect(r.status).toBe(401)
    expect(calls.length).toBe(2)
  })

  it('the instance stopped taking guests, or its guest desk is gone: the tab is nobody\'s and goes back to the door', async () => {
    for (const status of [404, 503]) {
      const went = []
      const target = { location: { assign: to => went.push(to) }, fetch: vi.fn(async (url) => answer({ detail: 'no' }, false, String(url).endsWith('/api/public/guest') ? status : 401)) }
      store.set('rijeka.guest', JSON.stringify({ token: 'pass-1', expires_at: now() + 1800 })); vi.resetModules()
      const g = await import('./guest')
      globalThis.fetch = (...a) => target.fetch(...a)
      g.isGuest(); g.watchForAnEndedPass(target)
      const r = await target.fetch(API + '/api/modules', { headers: { Authorization: 'Bearer pass-1' } })
      expect(r.status).toBe(401)
      expect(g.isGuest(), String(status)).toBe(false)
      expect(went).toEqual(['/login'])
    }
  })

  it('an address that only begins like the API\'s is not the API', async () => {
    const { target, calls } = await setUp([answer({}, false, 401)])
    await target.fetch(API + '.elsewhere.example/api/modules', { headers: { Authorization: 'Bearer pass-1' } })
    expect(calls.length).toBe(1)
  })
})

describe('what the door last knew', () => {
  it('is kept for the next visit\'s first paint, and an unanswered question does not change it', async () => {
    const kept = new Map()
    globalThis.localStorage = { getItem: k => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)) }
    expect(guest.guestsTakenLast()).toBe(false)
    globalThis.fetch = vi.fn(async () => answer({ enabled: true }))
    expect(await guest.guestsTaken()).toBe(true)
    expect(guest.guestsTakenLast()).toBe(true)
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') })
    expect(await guest.guestsTaken()).toBe(true)
    globalThis.fetch = vi.fn(async () => answer({ enabled: false }))
    expect(await guest.guestsTaken()).toBe(false)
    expect(guest.guestsTakenLast()).toBe(false)
    delete globalThis.localStorage
  })
})

