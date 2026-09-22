import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

// Writes go through the API (membership rules live there); new messages
// arrive through Supabase realtime, which applies the same RLS as reads.
async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const res = await fetch(API + '/api/chat' + path, {
    ...opts,
    headers: {
      'Authorization': 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Chat error ' + res.status)
  return data
}

// How long to show "Prometheus is looking into it" before giving up on a reply.
const PENDING_TIMEOUT_MS = 120_000

export const useChatStore = create((set, get) => ({
  status:   'idle',      // idle | loading | ready | no-firm | error
  error:    null,
  me:       null,        // { firm, role, display_name }
  userId:   null,
  rooms:    [],
  messages: {},          // roomId -> [message]
  activeRoomId: null,
  pending:  {},          // roomId -> true while Prometheus is answering
  channel:  null,

  init: async () => {
    if (get().status !== 'idle') return
    set({ status: 'loading' })
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const me = await api('/me')
      if (!me.firm) { set({ status: 'no-firm', me }); return }
      set({ me, userId: session?.user?.id || null })
      await get().refreshRooms()
      get().subscribe()
      set({ status: 'ready' })
    } catch (e) {
      set({ status: 'error', error: e.message })
    }
  },

  reset: () => {
    get().channel?.unsubscribe()
    set({ status: 'idle', error: null, me: null, userId: null, rooms: [], messages: {}, activeRoomId: null, pending: {}, channel: null })
  },

  refreshRooms: async () => {
    const rooms = await api('/rooms')
    set({ rooms })
  },

  subscribe: () => {
    if (get().channel) return
    const channel = supabase
      .channel('chat-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        payload => get().receive(payload.new))
      .subscribe()
    set({ channel })
  },

  // One path for every new message, whether it came from realtime or from
  // our own POST response; dedupe by id.
  receive: (m) => {
    const { messages, rooms, activeRoomId, userId, pending } = get()
    const list = messages[m.room_id]
    if (list && list.some(x => x.id === m.id)) return
    const mine = !!m.sender_user_id && m.sender_user_id === userId
    const room = rooms.find(r => r.id === m.room_id)
    if (!room) { get().refreshRooms(); return }
    const isActive = m.room_id === activeRoomId
    const nextRooms = rooms.map(r => r.id !== m.room_id ? r : {
      ...r,
      last_message: m,
      last_message_at: m.created_at,
      unread: isActive || mine ? r.unread : r.unread + 1,
    }).sort(roomOrder)
    const nextPending = (m.sender_kind === 'PROMETHEUS' || m.sender_kind === 'SYSTEM') && pending[m.room_id]
      ? { ...pending, [m.room_id]: false } : pending
    set({
      rooms: nextRooms,
      messages: list ? { ...messages, [m.room_id]: [...list, m] } : messages,
      pending: nextPending,
    })
    if (isActive && !mine) get().markRead(m.room_id)
  },

  openRoom: async (roomId) => {
    set({ activeRoomId: roomId })
    if (!roomId) return
    if (!get().messages[roomId]) {
      const list = await api(`/rooms/${roomId}/messages`)
      set(s => ({ messages: { ...s.messages, [roomId]: list } }))
    }
    get().markRead(roomId)
  },

  // Get-or-create a room with another firm, by firm id or a counterparty LEI.
  openWith: async ({ firmId, lei }) => {
    const r = await api('/rooms', { method: 'POST', body: JSON.stringify(firmId ? { firm_id: firmId } : { lei }) })
    if (!get().rooms.some(x => x.id === r.id)) await get().refreshRooms()
    return r.id
  },

  send: async (roomId, body) => {
    const r = await api(`/rooms/${roomId}/messages`, { method: 'POST', body: JSON.stringify({ body }) })
    get().receive(r.message)
    if (r.prometheus_pending) {
      set(s => ({ pending: { ...s.pending, [roomId]: true } }))
      setTimeout(() => set(s => ({ pending: { ...s.pending, [roomId]: false } })), PENDING_TIMEOUT_MS)
    }
  },

  markRead: async (roomId) => {
    set(s => ({ rooms: s.rooms.map(r => r.id === roomId ? { ...r, unread: 0 } : r) }))
    try { await api(`/rooms/${roomId}/read`, { method: 'POST' }) } catch { /* best effort */ }
  },

  firms: async () => api('/firms'),
}))

// Support room pinned first, then most recent activity.
function roomOrder(a, b) {
  if ((a.kind === 'SUPPORT') !== (b.kind === 'SUPPORT')) return a.kind === 'SUPPORT' ? -1 : 1
  return (b.last_message_at || '').localeCompare(a.last_message_at || '')
}

export const selectUnreadTotal = s => s.rooms.reduce((n, r) => n + (r.unread || 0), 0)
