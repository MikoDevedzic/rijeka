// The rooms are a list or they are left alone: an answer that could not be read is not the rooms.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The realtime client as the store uses it, and as realtime-js 2.100 behaves: a channel takes handlers and a status
// callback; asking for a name it already has returns that same channel (which does not join again); a removed
// channel keeps its name until its leaving is acknowledged, a moment later, and then says CLOSED.
const sb = vi.hoisted(() => {
  const chans = [], byTopic = new Map()
  const supabase = {
    channel: (topic) => {
      if (byTopic.has(topic)) return byTopic.get(topic)
      const c = { topic, handlers: [], joins: 0, on(_e, _f, h) { c.handlers.push(h); return c }, subscribe(cb) { c.cb = cb; c.joins += 1; return c } }
      byTopic.set(topic, c); chans.push(c); return c
    },
    removeChannel: (c) => { c.removed = true; return new Promise(r => setTimeout(() => { byTopic.delete(c.topic); c.cb?.('CLOSED'); r('ok') }, 100)) },
  }
  return { chans, byTopic, supabase, raised: vi.fn(), reported: vi.fn() }
})
vi.mock('../lib/session', () => ({ getSessionSafe: async () => ({ access_token: 't' }) }))
vi.mock('../lib/supabase', () => ({ supabase: sb.supabase }))
vi.mock('../lib/windows', () => ({ broadcast: () => {}, onBroadcast: () => () => {} }))
vi.mock('../lib/errors', () => ({ report: (...a) => sb.reported(...a) }))
vi.mock('../lib/chatAlerts', async (orig) => ({ ...(await orig()), alert: (...a) => sb.raised(...a), prime: () => {} }))

const { useChatStore, selectUnreadTotal, PROMETHEUS_TIMEOUT_MS } = await import('./useChatStore')
const ROOMS = [{ id: 'a', my_access: 'JOINED', unread: 2 }, { id: 'b', my_access: 'INVITED', unread: 0 }]

describe('chat rooms: an answer that is not a list', () => {
  afterEach(() => { vi.unstubAllGlobals(); useChatStore.setState({ rooms: [] }) })

  it('a list becomes the rooms, and the unread count is read from it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ROOMS }))
    await useChatStore.getState().refreshRooms()
    expect(useChatStore.getState().rooms).toEqual(ROOMS)
    expect(selectUnreadTotal(useChatStore.getState())).toBe(3)             // two unread and one invitation
  })
  it('a 200 whose body cannot be read leaves the rooms as they were, and nothing that reads them throws', async () => {
    useChatStore.setState({ rooms: ROOMS })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new TypeError('body stream cut off') } }))
    await useChatStore.getState().refreshRooms()
    expect(useChatStore.getState().rooms).toEqual(ROOMS)
    expect(selectUnreadTotal(useChatStore.getState())).toBe(3)
  })
  it('a store that somehow holds something else still counts nothing, without throwing', () => {
    expect(selectUnreadTotal({ rooms: {} })).toBe(0)
    expect(selectUnreadTotal({ rooms: null })).toBe(0)
  })
})

// Behind the live stream: what a window missed while its socket was down is fetched, once, without counting it twice.
describe('chat catches up on what the live stream did not deliver', () => {
  const ME = { user_id: 'me' }
  const m = (id, over = {}) => ({ id, room_id: 'a', sender_user_id: 'them', sender_kind: 'USER', body: id, created_at: `2026-11-13T12:0${id.slice(-1)}:00Z`, ...over })
  const serve = (rooms, messages) => vi.fn(async (url, init) => ({ ok: true, status: 200,
    json: async () => (String(url).endsWith('/rooms') ? rooms : String(url).includes('/messages') ? messages : init?.method === 'POST' ? {} : {}) }))
  afterEach(() => { vi.unstubAllGlobals(); useChatStore.setState({ rooms: [], messages: {}, pending: {}, activeId: null, open: false, status: 'idle', me: null, _catching: false }) })

  it('adds the messages it does not have, in order, takes the unread count from the server, and clears a wait for Prometheus', async () => {
    useChatStore.setState({ status: 'ready', me: ME, activeId: 'a', open: false, rooms: [{ id: 'a', my_access: 'JOINED', unread: 0 }],
      messages: { a: [m('m1'), m('m2', { sender_user_id: 'me' })] }, pending: { a: true } })
    const fetch = serve([{ id: 'a', my_access: 'JOINED', unread: 2 }], [m('m1'), m('m2', { sender_user_id: 'me' }), m('m3'), m('m4', { sender_kind: 'PROMETHEUS', sender_user_id: null })])
    vi.stubGlobal('fetch', fetch)
    await useChatStore.getState().catchUp()
    const s = useChatStore.getState()
    expect(s.messages.a.map(x => x.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(s.rooms[0].unread, 'the server\'s count, not the server\'s plus one for each message fetched').toBe(2)
    expect(s.pending.a).toBe(false)
    await useChatStore.getState().catchUp()
    expect(useChatStore.getState().messages.a).toHaveLength(4)                // a second pass adds nothing
  })
  it('marks the room read when its window is open, and fetches no messages for a room it has not loaded', async () => {
    useChatStore.setState({ status: 'ready', me: ME, activeId: 'a', open: true, rooms: [{ id: 'a', my_access: 'JOINED', unread: 1 }], messages: { a: [m('m1')] } })
    const fetch = serve([{ id: 'a', my_access: 'JOINED', unread: 1 }], [m('m1'), m('m2')])
    vi.stubGlobal('fetch', fetch)
    await useChatStore.getState().catchUp()
    expect(fetch.mock.calls.some(([url, init]) => String(url).includes('/rooms/a/read') || (init?.method === 'POST' && String(url).includes('/rooms/a'))), 'the room is marked read').toBe(true)
    useChatStore.setState({ activeId: 'b', messages: {} })
    fetch.mockClear()
    await useChatStore.getState().catchUp()
    expect(fetch.mock.calls.map(([url]) => String(url)).filter(u => u.includes('/messages'))).toEqual([])
  })
  it('puts a missed message where it belongs, not after one that arrived later', async () => {
    useChatStore.setState({ status: 'ready', me: ME, activeId: 'a', rooms: [{ id: 'a', my_access: 'JOINED', unread: 0 }], messages: { a: [m('m3'), m('m5')] } })      // m4 was missed, m5 came by the socket
    vi.stubGlobal('fetch', serve([{ id: 'a', my_access: 'JOINED', unread: 0 }], [m('m3'), m('m4'), m('m5')]))
    await useChatStore.getState().catchUp()
    expect(useChatStore.getState().messages.a.map(x => x.id)).toEqual(['m3', 'm4', 'm5'])
  })
  it('fetches the room that waits for Prometheus although another is open, and keeps a count that changed while the rooms were fetched', async () => {
    useChatStore.setState({ status: 'ready', me: ME, activeId: 'b', open: true, rooms: [{ id: 'a', my_access: 'JOINED', unread: 0 }, { id: 'b', my_access: 'JOINED', unread: 0 }],
      messages: { a: [m('m1')], b: [] }, pending: { a: true } })
    const answer = m('m2', { sender_kind: 'PROMETHEUS', sender_user_id: null })
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: true, status: 200, json: async () => {
      if (String(url).endsWith('/rooms')) { useChatStore.getState().receive(m('m9', { room_id: 'a' })); return [{ id: 'a', my_access: 'JOINED', unread: 0 }, { id: 'b', my_access: 'JOINED', unread: 0 }] }
      return String(url).includes('/rooms/a/messages') ? [m('m1'), answer, m('m9', { room_id: 'a' })] : []
    } })))
    await useChatStore.getState().catchUp()
    const s = useChatStore.getState()
    expect(s.messages.a.map(x => x.id)).toEqual(['m1', 'm2', 'm9'])
    expect(s.pending.a).toBe(false)
    expect(s.rooms.find(r => r.id === 'a').unread, 'the message that arrived during the fetch is still counted').toBe(1)
  })
  it('does nothing before the chat is ready, and a failed fetch leaves what it has', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await useChatStore.getState().catchUp()
    expect(fetch).not.toHaveBeenCalled()
    useChatStore.setState({ status: 'ready', me: ME, activeId: 'a', rooms: [{ id: 'a', my_access: 'JOINED', unread: 0 }], messages: { a: [m('m1')] } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await useChatStore.getState().catchUp()
    expect(useChatStore.getState().messages.a).toHaveLength(1)
    expect(useChatStore.getState()._catching).toBe(false)
  })
})

describe('the private Prometheus conversation waits for its answer', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); useChatStore.setState({ prom: [], promLoading: false }) })
  // a request that answers only when told to, and rejects as fetch does when its signal aborts
  const slow = () => {
    let answer
    const fetch = vi.fn((url, init) => new Promise((resolve, reject) => {
      answer = () => resolve({ ok: true, status: 200, json: async () => ({ content: [{ text: 'Yes: the hash matches.' }], tools_used: [], sources: [] }) })
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    return { fetch, answer: () => answer() }
  }

  it('is still waiting after the twenty seconds every other request is given, and shows the answer when it comes', async () => {
    vi.useFakeTimers()
    const s = slow(); vi.stubGlobal('fetch', s.fetch)
    const asked = useChatStore.getState().askPrometheus('Is the forward I just confirmed still what was signed?')
    await vi.advanceTimersByTimeAsync(45_000)
    expect(useChatStore.getState().promLoading).toBe(true)
    expect(useChatStore.getState().prom).toHaveLength(1)
    s.answer(); await asked
    const last = useChatStore.getState().prom.at(-1)
    expect(last).toMatchObject({ role: 'assistant', content: 'Yes: the hash matches.' })
    expect(last.error).toBeUndefined()
    expect(useChatStore.getState().promLoading).toBe(false)
  })

  it('gives up at its own limit, and says so', async () => {
    vi.useFakeTimers()
    const s = slow(); vi.stubGlobal('fetch', s.fetch)
    const asked = useChatStore.getState().askPrometheus('Summarise my book')
    await vi.advanceTimersByTimeAsync(PROMETHEUS_TIMEOUT_MS + 1)
    await asked
    expect(useChatStore.getState().prom.at(-1)).toMatchObject({ role: 'assistant', error: true, content: "Rijeka didn't answer in time. Try again." })
    expect(useChatStore.getState().promLoading).toBe(false)
  })

  it('leaves every other chat request at twenty seconds', async () => {
    vi.useFakeTimers()
    const s = slow(); vi.stubGlobal('fetch', s.fetch)
    const people = useChatStore.getState().people({ q: 'x' }).catch(e => e)
    await vi.advanceTimersByTimeAsync(20_001)
    expect((await people).message).toBe("Rijeka didn't answer in time. Try again.")
  })
})

// ── 0.34.0: the sender's own message at once, a stream that is rebuilt and tested, a light fetch, and alerts ──
const ME = { user_id: 'me', display_name: 'Me', firm: { name: 'Firm' } }
const ROOM = { id: 'a', kind: 'DIRECT', title: 'Them · Other', my_access: 'JOINED', unread: 0 }
const msg = (id, over = {}) => ({ id, room_id: 'a', sender_user_id: 'them', sender_kind: 'USER', sender_name: 'Them', body: id, created_at: `2026-11-14T12:00:0${id.slice(-1)}Z`, ...over })
const reset = () => {
  const s = useChatStore.getState()
  clearTimeout(s._rejoin)
  sb.chans.length = 0; sb.byTopic.clear(); sb.raised.mockClear(); sb.reported.mockClear()
  useChatStore.setState({ rooms: [], messages: {}, pending: {}, activeId: null, open: false, status: 'idle', me: null, _catching: false, channel: null,
    stream: 'connecting', _gen: s._gen + 1, _retries: 0, _rejoin: null, _liveSince: 0, _distrust: false, _fetchedAt: {}, _roomsAt: 0, delivered: { stream: 0, fetch: 0 }, alertAt: 0 })
}
const ready = (over = {}) => useChatStore.setState({ status: 'ready', me: ME, rooms: [ROOM], messages: { a: [] }, ...over })
const ok = (body) => ({ ok: true, status: 200, json: async () => body })

describe('a message is on the sender\'s screen as it is sent', () => {
  beforeEach(() => reset())
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); reset() })

  it('shows it before the server answers, marked as on its way, and the server\'s copy takes its place', async () => {
    ready()
    let answer
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { answer = r })))
    const sent = useChatStore.getState().send('a', 'hello')
    const shown = useChatStore.getState().messages.a
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ body: 'hello', sending: true, sender_user_id: 'me' })
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    answer(ok({ message: msg('m1', { sender_user_id: 'me', body: 'hello' }), prometheus_pending: false }))
    await sent
    const after = useChatStore.getState()
    expect(after.messages.a.map(m => [m.id, !!m.sending])).toEqual([['m1', false]])
    expect(after.rooms[0].last_message.id).toBe('m1')
    expect(sb.raised, 'one\'s own message alerts nobody').not.toHaveBeenCalled()
  })
  it('takes it back and throws when it could not be sent, and does not double it when the stream brought it first', async () => {
    ready()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(useChatStore.getState().send('a', 'lost')).rejects.toThrow(/reach Rijeka/)
    expect(useChatStore.getState().messages.a).toEqual([])

    let answer
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { answer = r })))
    const sent = useChatStore.getState().send('a', 'twice?')
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    const real = msg('m2', { sender_user_id: 'me', body: 'twice?' })
    useChatStore.getState().receive(real, 'stream')                          // the stream is faster than the POST's answer
    expect(useChatStore.getState().messages.a.map(m => m.id), 'the stream\'s copy stands where the copy on its way stood: one message, not two').toEqual(['m2'])
    answer(ok({ message: real, prometheus_pending: false }))
    await sent
    expect(useChatStore.getState().messages.a.map(m => m.id)).toEqual(['m2'])
  })
  it('keeps its place when another person\'s message arrives while it is being sent, and the room\'s row shows the later of the two', async () => {
    ready()
    let answer
    vi.stubGlobal('fetch', vi.fn((url, init) => (init?.method === 'POST' && String(url).endsWith('/messages') ? new Promise(r => { answer = r }) : Promise.resolve(ok({})))))
    const sent = useChatStore.getState().send('a', 'mine first')
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    useChatStore.getState().receive(msg('m9', { created_at: '2026-11-14T12:00:09Z' }), 'stream')
    answer(ok({ message: msg('m3', { sender_user_id: 'me', body: 'mine first', created_at: '2026-11-14T12:00:03Z' }) }))
    await sent
    const s = useChatStore.getState()
    expect(s.messages.a.map(m => m.id)).toEqual(['m3', 'm9'])
    expect(s.rooms[0].last_message.id, 'not set back to the earlier message').toBe('m9')
  })
  it('sends two messages typed quickly in the order they were typed', async () => {
    ready()
    const order = [], answers = []
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise(r => { order.push(JSON.parse(init.body).body); answers.push(r) })))
    const one = useChatStore.getState().send('a', 'first'), two = useChatStore.getState().send('a', 'second')
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    expect(order, 'the second waits for the first').toEqual(['first'])
    answers[0](ok({ message: msg('m1', { sender_user_id: 'me' }) }))
    await vi.waitFor(() => expect(answers).toHaveLength(2))
    answers[1](ok({ message: msg('m2', { sender_user_id: 'me' }) }))
    await Promise.all([one, two])
    expect(order).toEqual(['first', 'second'])
    expect(useChatStore.getState().messages.a.map(m => m.id)).toEqual(['m1', 'm2'])
  })
})

describe('the live stream is rebuilt when it is lost, and is not trusted while it is silent', () => {
  beforeEach(() => reset())
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); reset() })

  it('a channel that errors is replaced after a wait, and what the replaced one says afterwards is ignored', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ok([])))
    ready()
    useChatStore.getState().subscribe()
    const first = sb.chans[0]
    first.cb('SUBSCRIBED')
    expect(useChatStore.getState().stream).toBe('live')
    first.cb('CHANNEL_ERROR')
    expect(useChatStore.getState().stream).toBe('down')
    await vi.advanceTimersByTimeAsync(2050)
    expect(first.removed, 'the dead channel is removed').toBe(true)
    expect(sb.chans, 'and a new one is built at once, under a name of its own: the old name is still taken while the old channel leaves').toHaveLength(2)
    expect(sb.chans[1]).not.toBe(first)
    expect(sb.chans[1].topic).not.toBe(first.topic)
    expect(sb.chans[1].joins).toBe(1)
    await vi.advanceTimersByTimeAsync(200)                                   // the old channel's leaving is acknowledged: it says CLOSED
    expect(useChatStore.getState().stream, 'its CLOSED is not taken for the new channel\'s').toBe('down')
    sb.chans[1].cb('SUBSCRIBED')
    expect(useChatStore.getState().stream).toBe('live')
    first.cb('CHANNEL_ERROR')
    expect(useChatStore.getState().stream, 'a replaced channel has nothing more to say').toBe('live')
  })
  it('a channel that joins again by itself is left alone', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ok([])))
    ready()
    useChatStore.getState().subscribe()
    sb.chans[0].cb('SUBSCRIBED'); sb.chans[0].cb('TIMED_OUT'); sb.chans[0].cb('SUBSCRIBED')
    await vi.advanceTimersByTimeAsync(40_000)
    expect(sb.chans).toHaveLength(1)
    expect(useChatStore.getState().stream).toBe('live')
  })
  it('a message sent that the stream does not echo says the stream is silent: the operator is told, the channel rebuilt, and it is live again only when it delivers', async () => {
    vi.useFakeTimers()
    const store = new Map()
    vi.stubGlobal('localStorage', { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) })
    vi.stubGlobal('fetch', vi.fn(async (url, init) => ok(init?.method === 'POST' && String(url).endsWith('/messages') ? { message: msg('m1', { sender_user_id: 'me' }) } : String(url).endsWith('/rooms') ? [ROOM] : [])))
    ready()
    useChatStore.getState().subscribe()
    sb.chans[0].cb('SUBSCRIBED')
    await useChatStore.getState().send('a', 'anyone?')
    await vi.advanceTimersByTimeAsync(7000)
    expect(useChatStore.getState().stream, 'not before the wait is over').toBe('live')
    await vi.advanceTimersByTimeAsync(1500)
    expect(useChatStore.getState().stream).toBe('silent')
    expect(sb.reported).toHaveBeenCalledTimes(1)
    expect(sb.chans, 'the channel is built again').toHaveLength(2)
    sb.chans[1].cb('SUBSCRIBED')
    expect(useChatStore.getState().stream, 'joining again proves nothing').toBe('silent')
    sb.chans[1].handlers[0]({ new: msg('m2') })
    expect(useChatStore.getState().stream).toBe('live')
    expect(useChatStore.getState().delivered.stream).toBe(1)
  })
  it('a message the stream echoes in time leaves it trusted', async () => {
    vi.useFakeTimers()
    const mine = msg('m1', { sender_user_id: 'me' })
    vi.stubGlobal('fetch', vi.fn(async (url, init) => ok(init?.method === 'POST' && String(url).endsWith('/messages') ? { message: mine } : String(url).endsWith('/rooms') ? [ROOM] : [])))
    ready()
    useChatStore.getState().subscribe()
    sb.chans[0].cb('SUBSCRIBED')
    await useChatStore.getState().send('a', 'echo')
    sb.chans[0].handlers[0]({ new: mine })
    await vi.advanceTimersByTimeAsync(9000)
    expect(useChatStore.getState().stream).toBe('live')
    expect(sb.chans).toHaveLength(1)
    expect(sb.reported).not.toHaveBeenCalled()
  })
  it('a machine that slept through the wait proves nothing about the stream', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (url, init) => ok(init?.method === 'POST' && String(url).endsWith('/messages') ? { message: msg('m1', { sender_user_id: 'me' }) } : String(url).endsWith('/rooms') ? [ROOM] : [])))
    ready()
    useChatStore.getState().subscribe()
    sb.chans[0].cb('SUBSCRIBED')
    await useChatStore.getState().send('a', 'then the lid closed')
    vi.setSystemTime(Date.now() + 3_600_000)                                // an hour passes with the timers frozen
    await vi.advanceTimersByTimeAsync(9000)
    expect(useChatStore.getState().stream).toBe('live')
    expect(sb.chans).toHaveLength(1)
    expect(sb.reported).not.toHaveBeenCalled()
  })
})

describe('while the stream is not delivering, the open room is asked only for what is new', () => {
  beforeEach(() => reset())
  afterEach(() => { vi.unstubAllGlobals(); reset() })

  it('asks for the messages after the last one held, adds them once, and counts them as fetched', async () => {
    ready({ activeId: 'a', messages: { a: [msg('m1'), msg('m2', { sender_user_id: 'me' })] }, stream: 'silent' })
    const fetch = vi.fn(async () => ok([msg('m2', { sender_user_id: 'me' }), msg('m3')]))
    vi.stubGlobal('fetch', fetch)
    await useChatStore.getState().quick()
    const url = String(fetch.mock.calls[0][0])
    expect(url).toContain('/rooms/a/messages?after=')
    expect(decodeURIComponent(url.split('after=')[1]), 'thirty seconds before the last message held').toBe('2026-11-14T11:59:32.000Z')
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/rooms')), 'the rooms are not read').toBe(false)
    expect(useChatStore.getState().messages.a.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(useChatStore.getState().delivered.fetch).toBe(1)
    await useChatStore.getState().quick()
    expect(useChatStore.getState().messages.a).toHaveLength(3)
    expect(useChatStore.getState().delivered.fetch).toBe(1)
  })
  it('a catch-up on the tick asks for the last five minutes, and one made when the stream joins or the page is looked at again reads the whole room', async () => {
    ready({ activeId: 'a', messages: { a: [msg('m1')] }, stream: 'silent' })
    const fetch = vi.fn(async (url) => ok(String(url).endsWith('/rooms') ? [ROOM] : []))
    vi.stubGlobal('fetch', fetch)
    await useChatStore.getState().catchUp()
    const light = fetch.mock.calls.map(([u]) => String(u)).find(u => u.includes('/messages'))
    expect(decodeURIComponent(light.split('after=')[1])).toBe('2026-11-14T11:55:01.000Z')
    fetch.mockClear()
    await useChatStore.getState().catchUp(true)
    expect(fetch.mock.calls.map(([u]) => String(u)).find(u => u.includes('/messages'))).toMatch(/\/rooms\/a\/messages$/)
  })
  it('does nothing with no room open, or in a room it has not loaded', async () => {
    const fetch = vi.fn(async () => ok([])); vi.stubGlobal('fetch', fetch)
    ready({ activeId: null })
    await useChatStore.getState().quick()
    ready({ activeId: 'b' })
    await useChatStore.getState().quick()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('a message alerts once, whichever way it arrived', () => {
  beforeEach(() => reset())
  afterEach(() => { vi.unstubAllGlobals(); reset() })

  it('alerts for another person\'s message from the stream, blinks the button, and does not alert again when a fetch returns it', async () => {
    ready({ messages: {} })
    useChatStore.getState().receive(msg('n1'), 'stream')
    expect(sb.raised).toHaveBeenCalledTimes(1)
    expect(sb.raised.mock.calls[0][1]).toMatchObject({ who: 'Them', where: 'Them · Other', roomId: 'a' })
    expect(useChatStore.getState().alertAt).toBeGreaterThan(0)
    useChatStore.getState().takeRooms([{ ...ROOM, unread: 5, last_message: msg('n1') }])
    expect(sb.raised).toHaveBeenCalledTimes(1)
    await useChatStore.getState().show(null)
    expect(useChatStore.getState().alertAt, 'looking at the messenger stops the blink').toBe(0)
  })
  it('alerts for a room whose newer last message the rooms list shows, and for an invitation; the first list is not news', () => {
    useChatStore.setState({ status: 'loading', me: ME, rooms: [] })
    useChatStore.getState().takeRooms([{ ...ROOM, unread: 3, last_message: msg('n2') }])
    expect(sb.raised, 'where the chat stands when it loads').not.toHaveBeenCalled()
    useChatStore.setState({ status: 'ready' })
    useChatStore.getState().takeRooms([{ ...ROOM, unread: 4, last_message: msg('n3') }, { id: 'i', kind: 'GROUP', title: 'Desk', my_access: 'INVITED', invited_by: 'Ana' }])
    expect(sb.raised).toHaveBeenCalledTimes(2)
    expect(sb.raised.mock.calls.map(c => c[1].roomId).sort()).toEqual(['a', 'i'])
    useChatStore.getState().takeRooms([{ ...ROOM, unread: 0, last_message: msg('n3') }, { id: 'i', kind: 'GROUP', title: 'Desk', my_access: 'INVITED', invited_by: 'Ana' }])
    expect(sb.raised, 'the same list again is not news').toHaveBeenCalledTimes(2)
  })
  it('is silenced by the same person looking at the room in another window, and not by another person signed in to the same browser', () => {
    const store = new Map()
    vi.stubGlobal('localStorage', { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) })
    const looking = (user) => store.set('rijeka.chat.attending', JSON.stringify({ roomId: 'a', at: Date.now(), by: 'another-window', user }))
    ready({ messages: {} })
    looking('them')                                                          // the sender's own window, in this browser, is looking at the room
    useChatStore.getState().receive(msg('p1'), 'stream')
    expect(sb.raised, 'the receiver is still told').toHaveBeenCalledTimes(1)
    looking('me')                                                            // my own second window is looking at it
    useChatStore.getState().receive(msg('p2'), 'stream')
    expect(sb.raised).toHaveBeenCalledTimes(1)
    store.set('rijeka.chat.attending', JSON.stringify({ roomId: 'a', at: Date.now() - 60_000, by: 'another-window', user: 'me' }))
    useChatStore.getState().receive(msg('p3'), 'stream')
    expect(sb.raised, 'a window that stopped looking a minute ago silences nothing').toHaveBeenCalledTimes(2)
  })
  it('does not alert for the conversation being looked at, nor once alerts are switched off', () => {
    ready({ open: true, activeId: 'a' })
    vi.stubGlobal('fetch', vi.fn(async () => ok({})))
    useChatStore.getState().receive(msg('n4'), 'stream')
    expect(sb.raised).not.toHaveBeenCalled()
    useChatStore.setState({ open: false, alerts: { ...useChatStore.getState().alerts, enabled: false } })
    useChatStore.getState().receive(msg('n5'), 'stream')
    expect(sb.raised).not.toHaveBeenCalled()
    expect(useChatStore.getState().alertAt).toBe(0)
    useChatStore.setState({ alerts: { ...useChatStore.getState().alerts, enabled: true } })
  })
})
