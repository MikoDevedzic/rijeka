import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { getSessionSafe } from '../lib/session'
import { broadcast, onBroadcast } from '../lib/windows'
import { alert as raiseAlert, loadPrefs, savePrefs, shouldAlert, prime } from '../lib/chatAlerts'
import { report } from '../lib/errors'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

// The private Prometheus conversation is a pseudo-room: it never leaves
// this browser except as a request to /api/analyse.
export const PROMETHEUS = 'prometheus'
// messages in the order they were sent: by time, then by id where two share one
const byTime = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id))

// Writes go through the API (membership rules live there); new messages,
// invites and joins arrive through Supabase realtime under the same RLS.
// Never hang: supabase.auth.getSession() can wait forever on a browser lock
// (a token refresh, or another Rijeka window mid-refresh), so use the tool's
// safe getter; and give up on the request after REQUEST_TIMEOUT_MS so a
// card or panel can offer a retry instead of loading forever.
const REQUEST_TIMEOUT_MS = 20_000
// Prometheus reads before it answers: a question about the book is several look-ups, each a call to the model, and
// half a minute is ordinary (up to twelve rounds on the server, prometheus/agent.py). Given up on at twenty seconds,
// the answer was still being written and the panel said Rijeka had not answered.
export const PROMETHEUS_TIMEOUT_MS = 180_000
async function api(path, { timeoutMs = REQUEST_TIMEOUT_MS, ...opts } = {}) {
  const session = await getSessionSafe()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try {
    res = await fetch(API + path, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        'Authorization': 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    })
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? "Rijeka didn't answer in time. Try again." : "Couldn't reach Rijeka. Check your connection and try again.")
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Request failed (' + res.status + ')')
  return data
}
const chatApi = (path, opts) => api('/api/chat' + path, opts)
const post = (path, body) => chatApi(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })

// How long to show "Prometheus is looking into it" before giving up on a reply.
const PENDING_TIMEOUT_MS = 120_000

// The live stream is trusted while it delivers. A message this window learned of another way (its own POST, a
// fetch) while the stream was joined is expected on the stream within ECHO_MS; one that does not come says the
// stream is joined and silent, and the chat fetches instead until the stream delivers again.
const ECHO_MS = 8000
// A fetch between catch-ups asks for messages newer than the last one held, less OVERLAP_MS; a catch-up on the
// tick, less CATCH_OVERLAP_MS. The whole room (its latest 200) is read when the stream joins, when the page comes
// back into view or online, and when a room is opened again: the moments a message in the middle can have been missed.
const OVERLAP_MS = 30_000, CATCH_OVERLAP_MS = 5 * 60_000
const streamed = new Set()    // ids the stream delivered
const alerted = new Set()     // ids (and invitations) that already raised an alert
const sending = {}            // roomId -> the last POST, so two messages sent quickly arrive in the order typed
let tmpSeq = 0
// The operator hears of a stream that is joined and silent (Configurations › System, browser errors): once a day
// from a browser, so that one sleeping laptop does not fill the log.
function reportSilentOnce() {
  try {
    const day = new Date().toISOString().slice(0, 10)
    if (localStorage.getItem('rijeka.chat.silent-reported') === day) return
    localStorage.setItem('rijeka.chat.silent-reported', day)
  } catch { return }
  report('chat: the live stream is joined and not delivering; messages are fetched instead', 'chat')
}
const keep = (setOfIds, id) => { setOfIds.add(id); if (setOfIds.size > 600) for (const x of [...setOfIds].slice(0, 300)) setOfIds.delete(x) }
const attendingNow = () => typeof document === 'undefined' || (document.visibilityState === 'visible' && document.hasFocus())
// Several Rijeka windows may be open (tabs, the messenger in a window of its own). The one in which a conversation
// is being looked at says so, so that the same person's other windows do not ring for a message its reader is
// already reading. The mark names the person: two people signed in to one browser (the owner trying both of his
// accounts side by side, 14 November 2026) share its storage, and the sender's window, which is looking at the
// room, silenced the alert in the receiver's.
const ATTEND_KEY = 'rijeka.chat.attending', ATTEND_MS = 6000
const windowId = Math.random().toString(36).slice(2)
function markAttending(roomId, userId) {
  try {
    if (roomId) localStorage.setItem(ATTEND_KEY, JSON.stringify({ roomId, at: Date.now(), by: windowId, user: userId || null }))
    else if (JSON.parse(localStorage.getItem(ATTEND_KEY) || 'null')?.by === windowId) localStorage.removeItem(ATTEND_KEY)
  } catch { /* no storage: each window answers for itself */ }
}
function attendedElsewhere(roomId, userId) {
  try {
    const a = JSON.parse(localStorage.getItem(ATTEND_KEY) || 'null')
    return !!a && a.by !== windowId && !!userId && a.user === userId && a.roomId === roomId && Date.now() - a.at < ATTEND_MS
  } catch { return false }
}

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
  cardVersion: {},       // tradeId -> n, bumped when that trade changes (cards refetch)
  channel:  null,
  stream:   'connecting',  // connecting | live | silent (joined, not delivering) | down
  delivered: { stream: 0, fetch: 0 },     // messages from other people, by the way they reached this window
  alerts:   loadPrefs(),   // this browser's alert settings (lib/chatAlerts.js)
  alertAt:  0,             // when the messenger button last began to blink; 0 once the messenger is looked at

  // ── Private Prometheus ──
  prom:        [],       // [{ role, content, checked?, sources?, error? }]
  promLoading: false,

  init: async () => {
    if (get().status !== 'idle') return
    set({ status: 'loading' })
    get().listen()
    prime()
    try {
      const me = await chatApi('/me')
      if (!me.firm) { set({ status: 'no-firm', me: null }); return }
      set({ me })
      await get().refreshRooms()
      get().subscribe()
      set({ status: 'ready' })
      get().watch()
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
        set(s => ({ alertAt: 0, rooms: s.rooms.map(r => r.id === msg.roomId ? { ...r, unread: 0 } : r) }))      // read in another window: this one stops blinking
      } else if (msg.type === 'chat:alerts') {
        set({ alerts: loadPrefs() })
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
    // Only a list is the rooms. A 200 whose body could not be read comes back from `api` as {} (a request cut off
    // while its body was arriving); taken as the rooms, it crashed every page that shows the unread count
    // ("rooms.reduce is not a function", caught by the page's boundary). The rooms it has stay until a list arrives.
    if (Array.isArray(rooms)) get().takeRooms(rooms)
  },

  // The rooms as the server holds them. What they show that this window had not seen alerts: an invitation, or a
  // newer last message in a room whose messages this window does not fetch (the stream would have brought it).
  takeRooms: (rooms) => {
    const before = get().rooms, ready = get().status === 'ready', listedAt = get()._roomsAt, me = get().me
    set({ rooms, _roomsAt: Date.now() })
    if (!ready) return                                   // the first list is where the chat stands, not news
    for (const r of rooms) {
      const was = before.find(x => x.id === r.id)
      if (r.my_access === 'INVITED' && was?.my_access !== 'INVITED') get().notify({ id: `invite:${r.id}`, sender_kind: 'USER', sender_name: r.invited_by }, r)
      else if (r.last_message && r.last_message.id !== was?.last_message?.id && (r.unread || 0) > (was?.unread || 0)) {
        // it appeared between two lists, both read while the stream was joined: it was the stream's to bring
        if (listedAt && get()._liveSince && get()._liveSince < listedAt && r.last_message.sender_user_id !== me?.user_id) get().expectOnStream(r.last_message.id)
        get().notify(r.last_message, r)
      }
    }
  },
  _roomsAt: 0,

  // ── Alerts ──
  setAlerts: (patch) => {
    const alerts = { ...get().alerts, ...patch }
    set({ alerts })
    savePrefs(alerts)
    broadcast({ type: 'chat:alerts' })
  },
  // Says which conversation, if any, is being looked at in this window (see ATTEND_KEY).
  attend: () => {
    const { open, activeId } = get()
    markAttending(open && activeId && activeId !== PROMETHEUS && attendingNow() ? activeId : null, get().me?.user_id)
  },
  // One alert for a message, whichever way it reached this window, and never twice.
  notify: (m, room) => {
    if (!m?.id || alerted.has(m.id)) return
    keep(alerted, m.id)
    const { alerts, me, open, activeId } = get()
    const attending = (open && activeId === room?.id && attendingNow()) || attendedElsewhere(room?.id, me?.user_id)
    if (!shouldAlert(m, room, { meId: me?.user_id, attending, prefs: alerts })) return
    if (alerts.blink) set({ alertAt: Date.now() })
    raiseAlert(alerts, { who: m.sender_kind === 'PROMETHEUS' ? 'Prometheus' : m.sender_name || 'Rijeka', where: room.title || '', roomId: room.id,
      onOpen: () => get().show(room.id) })
  },

  subscribe: () => {
    if (get().channel) return
    const gen = get()._gen + 1
    // A name of its own each time. The client hands back the channel it already has under a name, and a removed
    // channel keeps its name until the server has acknowledged its leaving: a second 'chat' built in that moment
    // would be the one being removed, which never joins again and never says so.
    const channel = supabase
      .channel(`chat-${gen}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        payload => get().receive(payload.new, 'stream'))
      // Invites, joins and leaves change the room list.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_room_members' },
        () => get().refreshRooms().catch(() => {}))
      .subscribe((status) => {
        if (get()._gen !== gen) return                                   // a channel that was replaced has nothing more to say
        if (status === 'SUBSCRIBED') {                                   // joined, or joined again: what was sent while it was not is fetched
          clearTimeout(get()._rejoin)
          set({ stream: get()._distrust ? 'silent' : 'live', _liveSince: Date.now(), _retries: 0, _rejoin: null })
          get().catchUp(true)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          get().streamLost()
        }
      })
    set({ channel, _gen: gen })
  },
  _gen: 0, _retries: 0, _rejoin: null, _liveSince: 0, _distrust: false, _fetchedAt: {},

  // A channel that errored, timed out or closed was left as it was, and a window whose channel had died heard
  // nothing until it was reloaded. It is built again, a little later each time it fails (2 s to 30 s).
  streamLost: () => {
    set({ stream: 'down' })
    if (get()._rejoin) return
    const wait = Math.min(30_000, 2000 * 2 ** get()._retries)
    set({ _rejoin: setTimeout(() => { set({ _rejoin: null, _retries: get()._retries + 1 }); get().resubscribe() }, wait) })
  },
  resubscribe: () => {
    const old = get().channel
    set({ channel: null, _gen: get()._gen + 1 })
    try { if (old) Promise.resolve(supabase.removeChannel(old)).catch(() => {}) } catch { /* already gone */ }
    get().subscribe()
  },
  // A message the stream should have delivered: if it has not within ECHO_MS, the stream is joined and silent.
  expectOnStream: (id) => {
    if (get().stream !== 'live') return
    const gen = get()._gen, asked = Date.now()
    setTimeout(() => {
      if (get()._gen !== gen || get().stream !== 'live' || streamed.has(id)) return
      if (Date.now() - asked > ECHO_MS * 2) return       // the machine slept through the wait: nothing is proved
      set({ stream: 'silent', _distrust: true })
      reportSilentOnce()
      get().resubscribe()
    }, ECHO_MS)
  },

  // Behind the live stream. Realtime tells a window nothing while its socket is down and replays nothing when it is
  // back: a phone that slept, a laptop that changed network or a socket that never joined left the other person's
  // messages, and Prometheus's answer, unseen until the page was reloaded (the owner, 13 November 2026: "when i send
  // him message he has to refresh to get the messages", "i asked prometheus soemthing in chat and it didnt return me
  // answer"). So what was missed is fetched: when the socket joins, when the page comes back into view or online,
  // and on a slow tick while the page is in view (faster while the chat is open, fastest while an answer is awaited).
  catchUp: async (whole = false) => {
    if (get().status !== 'ready' || get()._catching) return
    set({ _catching: true })
    try {
      // the rooms, their last message and their unread counts as the server holds them; not taken where a message
      // arrived or a room was read while the answer was on its way (the answer is then the older of the two)
      const seen = get()._touched
      const rooms = await chatApi('/rooms')
      if (Array.isArray(rooms) && get()._touched === seen) get().takeRooms(rooms)
      // the open room, and any room that waits for Prometheus: the messages this window does not have, in time order
      const { activeId, messages, pending } = get()
      const wanted = [...new Set([activeId, ...Object.keys(pending).filter(id => pending[id])])].filter(id => id && id !== PROMETHEUS && messages[id])
      for (const roomId of wanted) await get().fetchRoom(roomId, whole ? 0 : CATCH_OVERLAP_MS)
    } catch { /* the next tick tries again */ } finally { set({ _catching: false }) }
  },

  // Between catch-ups, while the stream is not delivering: only the open room, and only what is newer than the
  // last message held (one small request, where a catch-up reads every room).
  quick: async () => {
    const { status, activeId, messages, _catching } = get()
    if (status !== 'ready' || _catching || !activeId || activeId === PROMETHEUS || !messages[activeId]) return
    set({ _catching: true })
    try { await get().fetchRoom(activeId, OVERLAP_MS) } catch { /* the next tick tries again */ } finally { set({ _catching: false }) }
  },

  // The messages of one room that this window does not have. With `overlap` (ms) only those sent after the last
  // one held, less the overlap, are asked for; with 0 the room's latest 200.
  fetchRoom: async (roomId, overlap = 0) => {
    const held = (get().messages[roomId] || []).filter(m => !m.sending)
    const lastAt = held.length ? Date.parse(held[held.length - 1].created_at) : NaN
    const after = overlap && Number.isFinite(lastAt) ? `?after=${encodeURIComponent(new Date(lastAt - overlap).toISOString())}` : ''
    const asked = Date.now(), before = get()._fetchedAt[roomId] || 0
    const list = await chatApi(`/rooms/${roomId}/messages${after}`)
    if (!Array.isArray(list)) return
    set(s => ({ _fetchedAt: { ...s._fetchedAt, [roomId]: asked } }))
    const have = new Set((get().messages[roomId] || []).map(m => m.id))
    const fresh = list.filter(m => !have.has(m.id))
    if (!fresh.length) return
    const answered = fresh.some(m => m.sender_kind === 'PROMETHEUS' || m.sender_kind === 'SYSTEM')
    set(s => ({
      messages: { ...s.messages, [roomId]: [...(s.messages[roomId] || []), ...fresh].sort(byTime) },
      pending: answered && s.pending[roomId] ? { ...s.pending, [roomId]: false } : s.pending,
    }))
    const me = get().me, room = get().rooms.find(r => r.id === roomId)
    const theirs = fresh.filter(m => m.sender_user_id !== me?.user_id)
    for (const m of fresh) if (m.card?.type === 'trade_event') get().bumpCard(m.card.trade_id)
    if (theirs.length) {
      set(s => ({ delivered: { ...s.delivered, fetch: s.delivered.fetch + theirs.filter(m => !streamed.has(m.id)).length } }))
      // a message that appeared between two fetches, both made while the stream was joined, was the stream's to bring
      if (before && get()._liveSince && get()._liveSince < before) for (const m of theirs) get().expectOnStream(m.id)
      if (room) for (const m of theirs) get().notify(m, room)
      if (get().open && get().activeId === roomId) get().markRead(roomId)
    }
  },
  _catching: false,
  _touched: 0,           // counts the times this window changed its rooms itself (a message received, a room read)

  watch: () => {
    if (get()._unwatch || typeof document === 'undefined') return
    const seen = () => { get().attend(); if (document.visibilityState === 'visible') get().catchUp(true) }
    const left = () => get().attend()
    document.addEventListener('visibilitychange', seen)
    window.addEventListener('focus', seen)
    window.addEventListener('blur', left)
    window.addEventListener('online', seen)
    let n = 0
    const tick = setInterval(() => {
      n += 1
      const s = get()
      s.attend()
      const fetching = s.stream !== 'live'
      // A page that is not in view is told by the stream alone; where the stream is not delivering it still
      // fetches, every 24 s, or a message would wait unannounced until the page was looked at again.
      if (document.visibilityState !== 'visible') { if (fetching && n % 6 === 0) s.catchUp(); return }
      const awaiting = Object.values(s.pending).some(Boolean)
      // every 4 s while an answer is awaited, 12 s while the chat is open or the stream is not delivering, 48 s otherwise;
      // and between those, while the stream is not delivering, the open room's new messages every 4 s
      if (awaiting || ((s.open || fetching) && n % 3 === 0) || n % 12 === 0) s.catchUp()
      else if (fetching && s.open) s.quick()
    }, 4000)
    set({ _unwatch: () => { clearInterval(tick); document.removeEventListener('visibilitychange', seen); window.removeEventListener('focus', seen); window.removeEventListener('blur', left); window.removeEventListener('online', seen); set({ _unwatch: null }) } })
  },
  _unwatch: null,

  // One path for every new message, from realtime or our own POST; dedupe by id.
  receive: (m, via) => {
    set(s => ({ _touched: s._touched + 1 }))
    if (via === 'stream') {                              // the stream delivers: it is trusted again
      keep(streamed, m.id)
      if (get()._distrust || get().stream !== 'live') set({ _distrust: false, stream: 'live' })
    }
    const { messages, rooms, activeId, open, me, pending } = get()
    const list = messages[m.room_id]
    const known = !!list && list.some(x => x.id === m.id)
    if (known && via !== 'post') return                  // the POST's answer for a message already here still tells the room's row
    const room = rooms.find(r => r.id === m.room_id)
    if (!room) { get().refreshRooms().catch(() => {}); return }
    const mine = !!m.sender_user_id && m.sender_user_id === me?.user_id
    const watching = open && activeId === m.room_id
    if (via === 'stream' && !mine) set(s => ({ delivered: { ...s.delivered, stream: s.delivered.stream + 1 } }))
    // one's own message, brought by the stream before its POST answered, takes the place of the copy on its way
    const onItsWay = mine && !known && list ? list.findIndex(x => x.sending && x.body === m.body) : -1
    const next = !list || known ? list : onItsWay >= 0 ? list.map((x, i) => i === onItsWay ? m : x) : [...list, m]
    const newer = (r) => !r.last_message_at || !(Date.parse(m.created_at) < Date.parse(r.last_message_at))
    set({
      rooms: rooms.map(r => r.id !== m.room_id || (known && !newer(r)) ? r : {
        ...r, ...(newer(r) ? { last_message: m, last_message_at: m.created_at } : {}),
        unread: watching || mine || known ? r.unread : r.unread + 1,
      }).sort(roomOrder),
      messages: list ? { ...messages, [m.room_id]: next } : messages,
      pending: (m.sender_kind === 'PROMETHEUS' || m.sender_kind === 'SYSTEM') && pending[m.room_id]
        ? { ...pending, [m.room_id]: false } : pending,
    })
    if (known) return
    if (m.card?.type === 'trade_event') get().bumpCard(m.card.trade_id)
    if (!mine) get().notify(m, room)
    if (watching && !mine) get().markRead(m.room_id)
  },

  // ── Window ──
  toggle: () => set(s => ({ open: !s.open, alertAt: 0 })),
  setCompose: (compose) => set({ compose }),
  setExpanded: (expanded) => set({ expanded }),
  close:  () => set({ open: false }),
  // Open the messenger on a conversation (or the list).
  show: async (id = null) => {
    set({ open: true, activeId: id, alertAt: 0 })
    get().attend()
    if (id && id !== PROMETHEUS) await get().loadRoom(id)
  },

  loadRoom: async (roomId) => {
    const room = get().rooms.find(r => r.id === roomId)
    if (room && room.my_access === 'INVITED') return
    if (!get().messages[roomId]) {
      const list = await chatApi(`/rooms/${roomId}/messages`)
      set(s => ({ messages: { ...s.messages, [roomId]: list } }))
    } else {
      get().catchUp(true)                              // a room opened again shows what arrived while it was closed
    }
    get().markRead(roomId)
  },

  // ── Rooms ──
  // The message is on the sender's screen as it is sent, marked as on its way; the server's copy takes its place
  // when the POST answers, and it is taken back (and the error thrown to the composer) if the POST fails.
  send: async (roomId, body) => {
    const me = get().me
    const tmp = { id: `tmp-${++tmpSeq}`, room_id: roomId, sender_kind: 'USER', sender_user_id: me?.user_id || null, sender_name: me?.display_name,
      sender_firm: me?.firm?.name || null, body, card: null, created_at: new Date().toISOString(), sending: true }
    const without = (s) => (s.messages[roomId] ? { messages: { ...s.messages, [roomId]: s.messages[roomId].filter(x => x.id !== tmp.id) } } : {})
    set(s => (s.messages[roomId] ? { messages: { ...s.messages, [roomId]: [...s.messages[roomId], tmp] } } : {}))
    const turn = (sending[roomId] || Promise.resolve()).catch(() => {}).then(() => post(`/rooms/${roomId}/messages`, { body }))
    sending[roomId] = turn
    let r
    try { r = await turn } catch (e) { set(without); throw e }
    // the server's copy where the copy on its way stood (or where the stream already put it), not after whatever arrived since
    set(s => {
      const list = s.messages[roomId]
      if (!list) return {}
      const here = list.some(x => x.id === r.message.id)
      return { messages: { ...s.messages, [roomId]: here ? list.filter(x => x.id !== tmp.id) : list.map(x => x.id === tmp.id ? r.message : x) } }
    })
    get().receive(r.message, 'post')
    get().expectOnStream(r.message.id)
    if (r.prometheus_pending) {
      set(s => ({ pending: { ...s.pending, [roomId]: true } }))
      setTimeout(() => set(s => ({ pending: { ...s.pending, [roomId]: false } })), PENDING_TIMEOUT_MS)
    }
  },

  markRead: async (roomId) => {
    set(s => ({ _touched: s._touched + 1, alertAt: 0, rooms: s.rooms.map(r => r.id === roomId ? { ...r, unread: 0 } : r) }))
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

  // ── Trade cards ──
  shareableTrades: (roomId) => chatApi(`/rooms/${roomId}/shareable-trades`),
  shareTrade: async (roomId, tradeId) => {
    const r = await post(`/rooms/${roomId}/trades`, { trade_id: tradeId })
    get().receive(r.message)
    return r   // already_shared: the card was in this room already; nothing new was posted
  },
  cardState: (messageId) => chatApi(`/cards/${messageId}`),
  // From the trade window: where a trade can go for countersignature, and send it there.
  tradeSendStatus: (tradeId) => chatApi(`/trades/${tradeId}/send-status`),
  sendTrade: async (tradeId) => {
    const r = await post(`/trades/${tradeId}/send`)
    await get().refreshRooms()
    await get().show(r.room_id)
    return r
  },
  countersign: async (messageId, body) => {
    const r = await post(`/cards/${messageId}/countersign`, body)
    refreshBlotter()   // the booking, when it was made; the realtime stream covers the rest
    return r
  },
  // Book a confirmed trade into your own blotter (your side of it).
  bookMirror: async (messageId) => {
    const r = await post(`/cards/${messageId}/book-mirror`)
    refreshBlotter()
    return r
  },
  bumpCard: (tradeId) => set(s => ({ cardVersion: { ...s.cardVersion, [tradeId]: (s.cardVersion[tradeId] || 0) + 1 } })),

  // ── Your firm's signing wallet ──
  signer: () => chatApi('/signer'),
  signerChallenge: (address) => post('/signer/challenge', { address }),
  registerSigner: (body) => post('/signer', body),

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
        timeoutMs: PROMETHEUS_TIMEOUT_MS,
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

// A booking from a confirmation lands in the blotter: reload it if it is loaded.
function refreshBlotter() {
  import('./useTradesStore').then(m => m.useTradesStore.getState().fetchTrades?.({ quiet: true })).catch(() => {})
}

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
  (Array.isArray(s.rooms) ? s.rooms : []).reduce((n, r) => n + (r.my_access === 'INVITED' ? 1 : r.unread || 0), 0)

// Who can read a conversation, in words, for headers and the composer.
export function audience(room, me) {
  if (!room) return 'Private — only you and Prometheus. Prometheus can see your book here.'
  if (room.my_access === 'OBSERVER') return 'Compliance view — read-only.'
  if (room.kind === 'SUPPORT') return 'Visible to you and Rijeka.'
  const others = room.firms.filter(f => f !== me?.firm?.name)
  return others.length ? 'Visible to ' + room.firms.join(', ') + '.' : 'Visible to ' + (me?.firm?.name || 'your firm') + ' only.'
}
