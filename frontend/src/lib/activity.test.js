// What the browser says a person did: a page opened, PRICE pressed. Signed in only, and never an error of the desk's.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { _forgetForTests, priced, say, signedIn, viewed } from './activity'

const sent = []
const send = async (url, init) => { sent.push({ url, ...init, body: JSON.parse(init.body) }); return { ok: true } }
beforeEach(() => { sent.length = 0; _forgetForTests() })

describe('activity', () => {
  it('says a page was opened, once for the same page in a row, and again for another account', () => {
    expect(viewed('/blotter', 'u1', { token: 't', send })).toBe(true)
    expect(viewed('/blotter', 'u1', { token: 't', send })).toBe(false)
    expect(viewed('/risk', 'u1', { token: 't', send })).toBe(true)
    expect(viewed('/risk', 'u2', { token: 't', send })).toBe(true)
    expect(sent.map(s => s.body)).toEqual([{ event: 'view', route: '/blotter' }, { event: 'view', route: '/risk' }, { event: 'view', route: '/risk' }])
    expect(sent[0].url).toMatch(/\/api\/me\/activity$/); expect(sent[0].method).toBe('POST'); expect(sent[0].headers.Authorization).toBe('Bearer t')
  })
  it('says nothing without an account or a session', () => {
    expect(viewed('/blotter', '', { token: 't', send })).toBe(false)
    expect(viewed('', 'u1', { token: 't', send })).toBe(false)
    expect(say('view', { route: '/blotter' }, { token: '', send })).toBe(false)
    expect(sent).toEqual([])
  })
  it('says PRICE was pressed, with the ticket\'s asset class in the list\'s own word', () => {
    expect(priced('CRYPTO', { token: 't', send })).toBe(true); expect(priced('RATES', { token: 't', send })).toBe(true)
    expect(sent.map(s => s.body)).toEqual([{ event: 'priced', detail: 'crypto' }, { event: 'priced', detail: 'rates' }])
  })
  it('uses the session the shell told it of, and nothing after a sign-out', () => {
    expect(priced('FX', { send })).toBe(false)                              // no session yet
    signedIn('abc'); expect(priced('FX', { send })).toBe(true); expect(sent[0].headers.Authorization).toBe('Bearer abc')
    signedIn(null); expect(priced('FX', { send })).toBe(false); expect(sent).toHaveLength(1)
  })
  it('never throws, whatever the network does', async () => {
    expect(say('view', { route: '/blotter' }, { token: 't', send: () => { throw new Error('down') } })).toBe(false)
    expect(say('view', { route: '/blotter' }, { token: 't', send: async () => { throw new Error('down') } })).toBe(true)
    expect(say('view', { route: '/blotter' }, { token: 't', send: null })).toBe(false)
    await Promise.resolve()
  })
})

// A guest (lib/guest.js) is not an account. One thing is said for a guest, with the guest's own pass: PRICE pressed.
describe('a guest', () => {
  it('says that PRICE was pressed, with the pass as it is now, and nothing else', async () => {
    const kept = new Map()
    globalThis.sessionStorage = { getItem: k => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: k => kept.delete(k) }
    kept.set('rijeka.guest', JSON.stringify({ token: 'pass-now', expires_at: Math.floor(Date.now() / 1000) + 1800 }))
    vi.resetModules()
    const a = await import('./activity')
    const sent = []
    const send = vi.fn(async (url, init) => { sent.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) }); return { ok: true } })
    a.signedIn('an-older-pass-the-shell-was-told')
    expect(a.viewed('/guest', 'guest', { send })).toBe(false)
    expect(a.say('view', { route: '/methodology' }, { send })).toBe(false)
    expect(a.priced('RATES', { send })).toBe(true)
    expect(sent).toEqual([{ url: expect.stringMatching(/\/api\/me\/activity$/), auth: 'Bearer pass-now', body: { event: 'priced', detail: 'rates' } }])
    kept.clear(); vi.resetModules()
    delete globalThis.sessionStorage
  })
})
