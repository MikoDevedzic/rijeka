import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { broadcast, onBroadcast } from '../lib/windows'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

// The private Prometheus conversation is a pseudo-room: it never leaves
// this browser except as a request to /api/analyse.
export const PROMETHEUS = 'prometheus'

// Writes go through the API (membership rules live there); new messages,
// invites and joins arrive through Supabase realtime under the same RLS.
async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Authorization': 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Request failed (' + res.status + ')')
  return data
}
const chatApi = (path, opts) => api('/api/chat' + path, opts)
const post = (path, body) => chatApi(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })

// How long to show "Prometheus is looking into it" before giving up on a reply.
const PENDING_TIMEOUT_MS = 120_000

export const useChatStore = create((set, get) => ({
  // ── Messenger window ──
  open:     false,
  expanded: false,       // window fills the screen (demos, long threads)
  activeId: null,        // PROMETHEUS | roomId | null (the list)
  compose:  null,        // null | { mode: 'direct'|'group'|'invite', q? }: the new-chat/invite screen
  poppedOut: false,      // the messenger is open in its own window (see lib/windows.js)

  // ── Network ──
  status:   'idle',      // idle | loading | ready | no-firm | error
  error:    null,
  me:       null,        // { user_id, role, display_name, firm }
  rooms:    [],
  messages: {},          // roomId -> [message]
  pending:  {},          // roomId -> true while Prometheus is answering in a room
  channel:  null,

  // ── Private Prometheus ──
  prom:        [],       // [{ role, content, checked?, sources?, error? }]
  promLoading: false,

  init: async () => {
    if (get().status !== 'idle') return
    set({ status: 'loading' })
    get().listen()
    try {
      const me = await chatApi('/me')
      if (!me.firm) { set({ status: 'no-firm', me: null }); return }
      set({ me })
      await get().refreshRooms()
      get().subscribe()
      set({ status: 'ready' })
    } catch (e) {
      set({ status: 'error', error: e.message })
    }
  },

  // Keep this window in step with Rijeka's other windows: read state, and
  // the private Prometheus conversation (in memory only, never stored).
  listen: () => {
    if (get().unlisten) return
    const unlisten = onBroadcast(msg => {
      if (msg.type === 'chat:read') {
        set(s => ({ rooms: s.rooms.map(r => r.id === msg.roomId ? { ...r, unread: 0 } : r) }))
      } else if (msg.type === 'prom:state' && !get().promLoading) {
        set({ prom: msg.prom })
      } else if (msg.type === 'prom:request' && get().prom.length) {
        broadcast({ type: 'prom:state', prom: get().prom })
      }
    })
    set({ unlisten })
    broadcast({ type: 'prom:request' })
  },
  unlisten: null,

  refreshRooms: async () => {
    const rooms = await chatApi('/rooms')
    set({ rooms })
  },

  subscribe: () => {
    if (get().channel) return
    const channel = supabase
      .channel('chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        payload => get().receive(payload.new))
      // Invites, joins and leaves change the room list.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_room_members' },
        () => get().refreshRooms().catch(() => {}))
      .subscribe()
    set({ channel })
  },

  // One path for every new message, from realtime or our own POST; dedupe by id.
  receive: (m) => {
    const { messages, rooms, activeId, open, me, pending } = get()
    const list = messages[m.room_id]
    if (list && list.some(x => x.id === m.id)) return
    const room = rooms.find(r => r.id === m.room_id)
    if (!room) { get().refreshRooms().catch(() => {}); return }
    const mine = !!m.sender_user_id && m.sender_user_id === me?.user_id
    const watching = open && activeId === m.room_id
    set({
      rooms: rooms.map(r => r.id !== m.room_id ? r : {
        ...r, last_message: m, last_message_at: m.created_at,
        unread: watching || mine ? r.unread : r.unread + 1,
      }).sort(roomOrder),
      messages: list ? { ...messages, [m.room_id]: [...list, m] } : messages,
      pending: (m.sender_kind === 'PROMETHEUS' || m.sender_kind === 'SYSTEM') && pending[m.room_id]
        ? { ...pending, [m.room_id]: false } : pending,
    })
    if (watching && !mine) get().markRead(m.room_id)
  },

  // ── Window ──
  toggle: () => set(s => ({ open: !s.open })),
  setCompose: (compose) => set({ compose }),
  setExpanded: (expanded) => set({ expanded }),
  close:  () => set({ open: false }),
  // Open the messenger on a conversation (or the list).
  show: async (id = null) => {
    set({ open: true, activeId: id })
    if (id && id !== PROMETHEUS) await get().loadRoom(id)
  },

  loadRoom: async (roomId) => {
    const room = get().rooms.find(r => r.id === roomId)
    if (room && room.my_access === 'INVITED') return
    if (!get().messages[roomId]) {
      const list = await chatApi(`/rooms/${roomId}/messages`)
      set(s => ({ messages: { ...s.messages, [roomId]: list } }))
    }
    get().markRead(roomId)
  },

  // ── Rooms ──
  send: async (roomId, body) => {
    const r = await post(`/rooms/${roomId}/messages`, { body })
    get().receive(r.message)
    if (r.prometheus_pending) {
      set(s => ({ pending: { ...s.pending, [roomId]: true } }))
      setTimeout(() => set(s => ({ pending: { ...s.pending, [roomId]: false } })), PENDING_TIMEOUT_MS)
    }
  },

  markRead: async (roomId) => {
    set(s => ({ rooms: s.rooms.map(r => r.id === roomId ? { ...r, unread: 0 } : r) }))
    broadcast({ type: 'chat:read', roomId })
    try { await post(`/rooms/${roomId}/read`) } catch { /* best effort */ }
  },

  openDirect: async (userId) => {
    const r = await post('/rooms/direct', { user_id: userId })
    await get().refreshRooms()
    await get().show(r.id)
    return r.id
  },

  openGroup: async ({ name, memberIds, bookNodeId }) => {
    const r = await post('/rooms/group', { name, member_ids: memberIds, book_node_id: bookNodeId || null })
    await get().refreshRooms()
    await get().show(r.id)
    return r.id
  },

  invite: async (roomId, userIds) => { await post(`/rooms/${roomId}/invite`, { user_ids: userIds }); await get().refreshRooms() },
  accept: async (roomId) => {
    await post(`/rooms/${roomId}/accept`)
    await get().refreshRooms()
    set(s => { const m = { ...s.messages }; delete m[roomId]; return { messages: m } })
    await get().loadRoom(roomId)
  },
  decline: async (roomId) => { await post(`/rooms/${roomId}/decline`); await get().refreshRooms(); set({ activeId: null }) },
  leave:   async (roomId) => { await post(`/rooms/${roomId}/leave`);   await get().refreshRooms(); set({ activeId: null }) },

  people: (params = {}) => chatApi('/people?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v))),
  books:  () => chatApi('/books'),

  // From a counterparty row: the person at that firm, or a picker if several.
  chatWithLei: async (lei) => {
    const people = await get().people({ lei })
    if (!people.length) throw new Error('Nobody from that firm is on Rijeka yet.')
    if (people.length === 1) return get().openDirect(people[0].user_id)
    set({ open: true, activeId: null, compose: { mode: 'direct', q: people[0].firm_name } })
  },

  // ── Private Prometheus ──
  askPrometheus: async (text) => {
    const q = text.trim()
    if (!q || get().promLoading) return
    const next = [...get().prom, { role: 'user', content: q }]
    set({ prom: next, promLoading: true })
    try {
      const data = await api('/api/analyse/', {
        method: 'POST',
        // Error bubbles are UI only; never sent back as assistant turns.
        body: JSON.stringify({ messages: next.filter(m => !m.error).map(m => ({ role: m.role, content: m.content })) }),
      })
      const checked = [...new Set((data.tools_used || []).map(t => CHECKED[t.tool]).filter(Boolean))]
      set({ prom: [...next, { role: 'assistant', content: data.content?.[0]?.text || 'No response.', checked, sources: data.sources || [] }] })
    } catch (e) {
      set({ prom: [...next, { role: 'assistant', content: e.message, error: true }] })
    } finally {
      set({ promLoading: false })
      broadcast({ type: 'prom:state', prom: get().prom })
    }
  },
  clearPrometheus: () => { set({ prom: [] }); broadcast({ type: 'prom:state', prom: [] }) },
  setPoppedOut: (poppedOut) => set({ poppedOut }),
}))

// Plain-English names for data lookups, shown under a private answer.
const CHECKED = {
  list_trades: 'your trades',
  get_trade: 'trade detail',
  get_confirmation: 'on-chain confirmation',
  list_parties: 'your counterparties',
}

// Invites first, then your own support room, then most recent activity.
function roomOrder(a, b) {
  const rank = r => r.my_access === 'INVITED' ? 0 : (r.kind === 'SUPPORT' && r.my_access !== 'OBSERVER') ? 1 : 2
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  return (b.last_message_at || '').localeCompare(a.last_message_at || '')
}

export const selectUnreadTotal = s =>
  s.rooms.reduce((n, r) => n + (r.my_access === 'INVITED' ? 1 : r.unread || 0), 0)

// Who can read a conversation, in words, for headers and the composer.
export function audience(room, me) {
  if (!room) return 'Private — only you and Prometheus. Prometheus can see your book here.'
  if (room.my_access === 'OBSERVER') return 'Compliance view — read-only.'
  if (room.kind === 'SUPPORT') return 'Visible to you and Rijeka.'
  const others = room.firms.filter(f => f !== me?.firm?.name)
  return others.length ? 'Visible to ' + room.firms.join(', ') + '.' : 'Visible to ' + (me?.firm?.name || 'your firm') + ' only.'
}
