// The rooms are a list or they are left alone: an answer that could not be read is not the rooms.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/session', () => ({ getSessionSafe: async () => ({ access_token: 't' }) }))
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/windows', () => ({ broadcast: () => {}, onBroadcast: () => () => {} }))

const { useChatStore, selectUnreadTotal } = await import('./useChatStore')
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
