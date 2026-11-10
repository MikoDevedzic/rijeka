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
