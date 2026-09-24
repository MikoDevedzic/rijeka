import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { useChatStore, PROMETHEUS, selectUnreadTotal, audience } from '../../store/useChatStore'
import Markdown from '../common/Markdown'
import TradeCard, { TradePicker, WalletPanel } from './TradeCard'
import { broadcast, onBroadcast, popOutMessenger, focusMessengerWindow, MESSENGER_PATH } from '../../lib/windows'
import './Messenger.css'

// One messenger for the whole app: the private Prometheus conversation, your
// Rijeka support room, and rooms with people at your firm and others. It is
// mounted once above the routes, so it stays open as you move between tabs.

const GEOM_KEY = 'rijeka.messenger.geom'
const MIN_W = 340, MIN_H = 360, TWO_PANE = 640
const HIDDEN_ON = ['/login', '/signup', '/confirm', MESSENGER_PATH]
// The popped-out window says it's alive this often; silence for STALE_MS means it closed.
const HEARTBEAT_MS = 4000, STALE_MS = 11000

const STARTERS = [
  'Summarise my book by status and counterparty',
  'Which of my trades are confirmed on-chain, and do they still match what was signed?',
  'How does on-chain confirmation change MPoR and initial margin in the XVA?',
  'Walk me through how a vanilla SOFR swap is priced in Rijeka',
]
const ENGINEERING_ASK =
  'Show me the engineering behind that: how it is implemented, with file and line references.'

function loadGeom() {
  try { return JSON.parse(localStorage.getItem(GEOM_KEY)) || null } catch { return null }
}
function saveGeom(g) {
  try { localStorage.setItem(GEOM_KEY, JSON.stringify(g)) } catch { /* per-viewer convenience only */ }
}
function defaultGeom() {
  const w = Math.min(460, window.innerWidth - 32), h = Math.min(640, window.innerHeight - 140)
  return { x: window.innerWidth - w - 24, y: window.innerHeight - h - 88, w, h }
}
function clamp(g) {
  const w = Math.max(MIN_W, Math.min(g.w, window.innerWidth - 16))
  const h = Math.max(MIN_H, Math.min(g.h, window.innerHeight - 60))
  return { w, h, x: Math.max(8, Math.min(g.x, window.innerWidth - w - 8)), y: Math.max(52, Math.min(g.y, window.innerHeight - h - 8)) }
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' })
}

export default function Messenger() {
  const session = useAuthStore(s => s.session)
  const location = useLocation()
  const { open, expanded, toggle, init, poppedOut, setPoppedOut } = useChatStore()
  const unread = useChatStore(selectUnreadTotal)

  useEffect(() => { if (session) init() }, [session, init])

  // Track the popped-out messenger window, if there is one.
  useEffect(() => {
    let lastSeen = 0
    const off = onBroadcast(msg => {
      if (msg.type === 'messenger:here') { lastSeen = Date.now(); setPoppedOut(true); useChatStore.setState({ open: false }) }
      if (msg.type === 'messenger:gone') { lastSeen = 0; setPoppedOut(false) }
    })
    // "Put back" in the popped-out window reopens the box only in the window that opened it.
    const onDock = (e) => {
      if (e.origin === window.location.origin && e.data?.type === 'messenger:dock') {
        lastSeen = 0; setPoppedOut(false); useChatStore.setState({ open: true })
      }
    }
    window.addEventListener('message', onDock)
    broadcast({ type: 'messenger:ping' })
    const t = setInterval(() => { if (lastSeen && Date.now() - lastSeen > STALE_MS) { lastSeen = 0; setPoppedOut(false) } }, HEARTBEAT_MS)
    return () => { off(); clearInterval(t); window.removeEventListener('message', onDock) }
  }, [setPoppedOut])

  if (!session || HIDDEN_ON.includes(location.pathname)) return null
  const launch = () => {
    if (poppedOut && focusMessengerWindow()) return
    setPoppedOut(false)
    toggle()
  }
  // A full-screen window has its own close button; the launcher would sit on SEND.
  const covered = open && (expanded || window.innerWidth < 600)
  return (
    <>
      {open && !poppedOut && <MessengerWindow />}
      {!covered && (
        <button className={`ms-launcher${poppedOut ? ' out' : ''}`} onClick={launch}
                title={poppedOut ? 'Messenger is open in its own window — bring it forward' : 'Messages and Prometheus'}>
          ✦{unread > 0 && <span className="ms-launcher-badge">{unread}</span>}
        </button>
      )}
    </>
  )
}

// The messenger as its own browser window (route /messenger): drag it to any
// screen. It announces itself so the other windows hide their floating copy.
export function MessengerPage() {
  const session = useAuthStore(s => s.session)
  const init = useChatStore(s => s.init)
  const unread = useChatStore(selectUnreadTotal)
  const [width, setWidth] = useState(window.innerWidth)

  useEffect(() => { if (session) init() }, [session, init])
  useEffect(() => { document.title = (unread ? `(${unread}) ` : '') + 'Rijeka · Messages' }, [unread])
  useEffect(() => {
    const here = () => broadcast({ type: 'messenger:here' })
    here()
    const t = setInterval(here, HEARTBEAT_MS)
    const off = onBroadcast(msg => { if (msg.type === 'messenger:ping') here() })
    const gone = () => broadcast({ type: 'messenger:gone' })
    const onResize = () => setWidth(window.innerWidth)
    // Closing a window doesn't always deliver one of these; the heartbeat is the backstop.
    window.addEventListener('pagehide', gone)
    window.addEventListener('beforeunload', gone)
    window.addEventListener('resize', onResize)
    return () => {
      clearInterval(t); off(); gone()
      window.removeEventListener('pagehide', gone)
      window.removeEventListener('beforeunload', gone)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const dock = () => {
    try { window.opener?.postMessage({ type: 'messenger:dock' }, window.location.origin) } catch { /* opener gone */ }
    broadcast({ type: 'messenger:gone' })
    window.close()
  }
  return (
    <div className="ms-page">
      <header className="ms-titlebar">
        <span className="ms-brand">✦ RIJEKA</span>
        <span className="ms-sub">messages · Prometheus</span>
        <div className="ms-title-actions">
          {window.opener && <button className="ms-icon" onClick={dock} title="Put back into the main window">⇲</button>}
        </div>
      </header>
      <MessengerPanes width={width} />
    </div>
  )
}

function MessengerWindow() {
  const { close, compose, expanded, setExpanded } = useChatStore()
  const [geom, setGeom] = useState(() => clamp(loadGeom() || defaultGeom()))
  const [phone, setPhone] = useState(window.innerWidth < 600)
  const drag = useRef(null)

  useEffect(() => {
    const onResize = () => { setPhone(window.innerWidth < 600); setGeom(g => clamp(g)) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => { saveGeom(geom) }, [geom])

  // Pointer drag: move from the title bar, resize from the top-left corner.
  const start = (kind) => (e) => {
    if (expanded || phone || e.button !== 0 || e.target.closest('button')) return
    e.preventDefault()
    drag.current = { kind, sx: e.clientX, sy: e.clientY, g: geom }
    const move = (ev) => {
      const d = drag.current; if (!d) return
      const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy
      setGeom(clamp(d.kind === 'move'
        ? { ...d.g, x: d.g.x + dx, y: d.g.y + dy }
        : { x: d.g.x + dx, y: d.g.y + dy, w: d.g.w - dx, h: d.g.h - dy }))
    }
    const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const style = phone ? {} : expanded ? {} : { left: geom.x, top: geom.y, width: geom.w, height: geom.h }
  const width = phone ? window.innerWidth : expanded ? window.innerWidth - 32 : geom.w
  const popOut = () => { if (popOutMessenger()) useChatStore.setState({ open: false, expanded: false }) }

  return (
    <div className={`ms-window${expanded ? ' ms-expanded' : ''}${phone ? ' ms-phone' : ''}`} style={style}
         onKeyDown={e => e.key === 'Escape' && !compose && close()}>
      {!expanded && !phone && <div className="ms-resize" onPointerDown={start('resize')} title="Resize" />}
      <header className="ms-titlebar" onPointerDown={start('move')}>
        <span className="ms-brand">✦ RIJEKA</span>
        <span className="ms-sub">messages · Prometheus</span>
        <div className="ms-title-actions">
          {!phone && <button className="ms-icon" onClick={popOut} title="Open in its own window — drag it to another screen">⧉</button>}
          {!phone && <button className="ms-icon" onClick={() => setExpanded(!expanded)} title={expanded ? 'Restore' : 'Expand'}>{expanded ? '⤡' : '⤢'}</button>}
          <button className="ms-icon" onClick={close} title="Close">✕</button>
        </div>
      </header>
      <MessengerPanes width={width} />
    </div>
  )
}

// Conversation list + the open conversation; shared by the floating window
// and the popped-out window.
function MessengerPanes({ width }) {
  const { activeId, status, compose, setCompose } = useChatStore()
  const twoPane = width >= TWO_PANE
  const showList = twoPane || (!activeId && !compose)
  const showMain = twoPane || !!activeId || !!compose
  return (
      <div className={`ms-body${twoPane ? ' two' : ''}`}>
        {showList && <ConversationList onCompose={setCompose} />}
        {showMain && (
          <main className="ms-main">
            {compose ? <Compose compose={compose} onDone={() => setCompose(null)} />
              : activeId === PROMETHEUS ? <PrometheusThread back={!twoPane} />
              : activeId ? <RoomThread roomId={activeId} back={!twoPane} onInvite={() => setCompose({ mode: 'invite' })} />
              : <div className="ms-empty">{status === 'no-firm'
                  ? 'Ask Prometheus anything. Chat with other people needs your account to be part of a firm on Rijeka.'
                  : 'Pick a conversation, or start one with + NEW.'}</div>}
          </main>
        )}
      </div>
  )
}

// ── List ─────────────────────────────────────────────────────────────────────

function ConversationList({ onCompose }) {
  const { status, error, me, rooms, activeId, show, prom } = useChatStore()
  const lastProm = prom[prom.length - 1]
  const compliance = me?.role === 'COMPLIANCE'
  return (
    <nav className="ms-list">
      <div className="ms-list-head">
        <div>
          <div className="ms-firm">{me?.firm?.name || 'RIJEKA'}</div>
          <div className="ms-sub">{me ? me.display_name + (compliance ? ' · COMPLIANCE' : '') : ''}</div>
        </div>
        {status === 'ready' && !compliance && (
          <div className="ms-list-actions">
            {me?.role === 'ADMIN' && <button className="ms-link" onClick={() => onCompose({ mode: 'wallet' })}
                                             title="Your firm's signing wallet for trade confirmations">WALLET</button>}
            <button className="ms-btn" onClick={() => onCompose({ mode: 'direct' })}>+ NEW</button>
          </div>
        )}
      </div>
      <div className="ms-list-scroll">
        <button className={`ms-conv prom${activeId === PROMETHEUS ? ' active' : ''}`} onClick={() => { onCompose(null); show(PROMETHEUS) }}>
          <div className="ms-conv-top"><span className="ms-conv-title">✦ Prometheus</span><span className="ms-tag private">PRIVATE</span></div>
          <div className="ms-conv-preview">{lastProm ? lastProm.content.replace(/[*_`#>|]/g, '').slice(0, 80) : 'Your assistant. Sees your book; only you see this.'}</div>
        </button>
        {status === 'loading' && <div className="ms-note">Loading conversations…</div>}
        {status === 'error' && <div className="ms-note err">Chat unavailable: {error}</div>}
        {rooms.map(r => (
          <button key={r.id} className={`ms-conv${r.id === activeId ? ' active' : ''}${r.my_access === 'INVITED' ? ' invite' : ''}`}
                  onClick={() => { onCompose(null); show(r.id) }}>
            <div className="ms-conv-top">
              <span className={`ms-conv-title${r.kind === 'SUPPORT' ? ' support' : ''}`}>{r.kind === 'SUPPORT' ? '✦ ' : ''}{r.title}</span>
              <span className="ms-conv-time">{r.my_access === 'INVITED' ? '' : fmtTime(r.last_message_at)}</span>
            </div>
            <div className="ms-conv-bottom">
              <span className="ms-conv-preview">
                {r.my_access === 'INVITED' ? `Invite from ${r.invited_by || 'someone'}`
                  : r.last_message ? (r.last_message.sender_kind === 'USER' ? r.last_message.sender_name + ': ' : '') + r.last_message.body.replace(/[*_`#>|]/g, '').slice(0, 80)
                  : 'No messages yet'}
              </span>
              {r.my_access === 'INVITED' ? <span className="ms-tag invite">INVITE</span>
                : r.unread > 0 ? <span className="ms-badge">{r.unread}</span> : null}
            </div>
            {r.book_label && <div className="ms-conv-book">{r.book_label}</div>}
          </button>
        ))}
      </div>
    </nav>
  )
}

// ── Private Prometheus ───────────────────────────────────────────────────────

function PrometheusThread({ back }) {
  const { prom, promLoading, askPrometheus, clearPrometheus, show } = useChatStore()
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)
  useLayoutEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [prom.length, promLoading])

  const ask = (q) => { setDraft(''); askPrometheus(q) }
  return (
    <>
      <ThreadHead back={back} onBack={() => show(null)} title="✦ Prometheus" tag={<span className="ms-tag private">PRIVATE</span>}
                  line={audience(null)}
                  actions={prom.length > 0 && <button className="ms-link" onClick={clearPrometheus} disabled={promLoading}>NEW</button>} />
      <div className="ms-thread">
        <div className="ms-msg prometheus"><div className="ms-who">✦ PROMETHEUS</div>
          <div className="ms-bubble">I'm Prometheus, Rijeka's assistant. Here I can look up your trades and confirmations and read how
            Rijeka prices, margins and confirms them — then explain it. I'm read-only: I never book, amend or confirm anything.</div></div>
        {prom.length === 0 && <div className="ms-starters">{STARTERS.map(s => <button key={s} className="ms-starter" onClick={() => ask(s)}>{s}</button>)}</div>}
        {prom.map((m, i) => (
          <div key={i} className={`ms-msg ${m.role === 'user' ? 'mine' : 'prometheus'}${m.error ? ' error' : ''}`}>
            <div className="ms-who">{m.role === 'user' ? 'YOU' : '✦ PROMETHEUS'}</div>
            <div className="ms-bubble">{m.role === 'assistant' && !m.error ? <Markdown text={m.content} /> : m.content}</div>
            {m.checked?.length > 0 && <div className="ms-meta">Checked {m.checked.join(' · ')}</div>}
            <Sources sources={m.sources} />
            {i === prom.length - 1 && !promLoading && m.sources?.length > 0 && prom[i - 1]?.content !== ENGINEERING_ASK && (
              <button className="ms-deeper" onClick={() => ask(ENGINEERING_ASK)}>Show the engineering →</button>
            )}
          </div>
        ))}
        {promLoading && <Thinking />}
        <div ref={endRef} />
      </div>
      <Composer placeholder="Private — ask about your trades, a confirmation, or how Rijeka models something…"
                value={draft} onChange={setDraft} onSend={() => ask(draft)} busy={promLoading} />
    </>
  )
}

// ── Rooms ────────────────────────────────────────────────────────────────────

function RoomThread({ roomId, back, onInvite }) {
  const { rooms, messages, pending, me, show, send, accept, decline, leave, loadRoom } = useChatStore()
  const room = rooms.find(r => r.id === roomId)
  const list = messages[roomId]
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [people, setPeople] = useState(false)
  const [picking, setPicking] = useState(false)
  const endRef = useRef(null)
  const isPending = !!pending[roomId]
  const count = list?.length

  useEffect(() => { setErr(null); setPeople(false); setPicking(false); if (room && room.my_access !== 'INVITED') loadRoom(roomId).catch(e => setErr(e.message)) }, [roomId, room?.my_access]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [count, isPending])

  if (!room) return <div className="ms-empty">This conversation is no longer available.</div>

  const run = async (fn) => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const joined = room.my_access === 'JOINED'
  const tag = room.kind === 'SUPPORT' ? <span className="ms-tag rijeka">RIJEKA</span>
    : room.my_access === 'OBSERVER' ? <span className="ms-tag compliance">COMPLIANCE</span>
    : <span className="ms-tag shared">SHARED</span>

  return (
    <>
      <ThreadHead back={back} onBack={() => show(null)} title={room.kind === 'SUPPORT' ? '✦ ' + room.title : room.title} tag={tag}
                  line={audience(room, me)} book={room.book_label}
                  actions={<>
                    {room.kind !== 'SUPPORT' && <button className="ms-link" onClick={() => setPeople(p => !p)}>{room.members.length} PEOPLE</button>}
                    {joined && room.kind === 'GROUP' && <button className="ms-link" onClick={onInvite}>INVITE</button>}
                    {joined && room.kind !== 'SUPPORT' && <button className="ms-link danger" disabled={busy} onClick={() => run(() => leave(roomId))}>LEAVE</button>}
                  </>} />
      {people && (
        <div className="ms-people">
          {room.members.map(p => (
            <div key={p.user_id} className="ms-person">
              <span>{p.name}</span><span className="ms-sub">{p.firm_name}</span>
              {p.status === 'INVITED' && <span className="ms-tag invite">INVITED</span>}
            </div>
          ))}
        </div>
      )}

      {room.my_access === 'INVITED' ? (
        <div className="ms-invite">
          <div><b>{room.invited_by || 'Someone'}</b> invited you to <b>{room.title}</b>.</div>
          <div className="ms-sub">If you join, everyone in the room ({room.firms.join(', ')}) sees what you write.</div>
          {err && <div className="ms-note err">{err}</div>}
          <div className="ms-invite-actions">
            <button className="ms-btn" disabled={busy} onClick={() => run(() => accept(roomId))}>ACCEPT</button>
            <button className="ms-btn ghost" disabled={busy} onClick={() => run(() => decline(roomId))}>DECLINE</button>
          </div>
        </div>
      ) : (
        <>
          <div className="ms-thread">
            {!list && <div className="ms-note">Loading…</div>}
            {list?.map(m => <RoomMessage key={m.id} m={m} mine={m.sender_user_id === me?.user_id} />)}
            {isPending && <Thinking />}
            <div ref={endRef} />
          </div>
          {picking && <TradePicker roomId={roomId} onClose={() => setPicking(false)} />}
          {joined ? (
            <RoomComposer room={room} value={draft} onChange={setDraft} err={err} busy={busy}
                          onTrade={room.kind !== 'SUPPORT' && room.firms.length === 2 ? () => setPicking(p => !p) : null}
                          onSend={() => run(async () => { const b = draft.trim(); if (!b) return; await send(roomId, b); setDraft('') })} />
          ) : (
            <div className="ms-readonly">Compliance view — you can read this room but not post in it.</div>
          )}
        </>
      )}
    </>
  )
}

function RoomMessage({ m, mine }) {
  if (m.sender_kind === 'SYSTEM') return (
    <div className={`ms-system${m.card?.type === 'trade_event' ? ' event' : ''}`}>
      {m.body}
      {m.card?.explorer_tx && <> <a href={m.card.explorer_tx} target="_blank" rel="noopener noreferrer">transaction ↗</a></>}
      <span> · {fmtTime(m.created_at)}</span>
    </div>
  )
  if (m.card?.type === 'trade') return (
    <div className={`ms-msg${mine ? ' mine' : ''}`}>
      <div className="ms-who">{mine ? 'YOU' : `${m.sender_name} · ${m.sender_firm || ''}`}<span className="ms-time">{fmtTime(m.created_at)}</span></div>
      <TradeCard m={m} />
    </div>
  )
  const prom = m.sender_kind === 'PROMETHEUS'
  return (
    <div className={`ms-msg${mine ? ' mine' : ''}${prom ? ' prometheus' : ''}`}>
      <div className="ms-who">{prom ? '✦ PROMETHEUS' : mine ? 'YOU' : `${m.sender_name} · ${m.sender_firm || ''}`}<span className="ms-time">{fmtTime(m.created_at)}</span></div>
      <div className="ms-bubble">{prom ? <Markdown text={m.body} /> : m.body}</div>
      {prom && <Sources sources={m.card?.sources} />}
    </div>
  )
}

function RoomComposer({ room, value, onChange, onSend, err, busy, onTrade }) {
  const { me } = useChatStore()
  const ref = useRef(null)
  const [mention, setMention] = useState(null)       // { start } while "@pro…" is typed
  const offerMention = room.kind !== 'SUPPORT'         // support: Prometheus always answers

  const change = (e) => {
    const text = e.target.value
    onChange(text)
    const upto = text.slice(0, e.target.selectionStart)
    const m = offerMention && upto.match(/(^|\s)@(\w*)$/)
    setMention(m && 'prometheus'.startsWith(m[2].toLowerCase()) ? { start: upto.length - m[2].length - 1 } : null)
  }
  const insert = () => {
    const el = ref.current
    const caret = el?.selectionStart ?? value.length
    let next, pos
    if (mention) {
      const before = value.slice(0, mention.start) + '@prometheus '
      next = before + value.slice(caret).replace(/^\s+/, ''); pos = before.length
    } else {
      next = /(^|\s)@prometheus\b/i.test(value) ? value : '@prometheus ' + value; pos = next.length
    }
    onChange(next); setMention(null)
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos) })
  }
  const key = (e) => {
    if (mention && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); insert(); return }
    if (mention && e.key === 'Escape') { e.stopPropagation(); setMention(null); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
  }
  return (
    <div className="ms-compose">
      {err && <div className="ms-note err">{err}</div>}
      {mention && (
        <button className="ms-mention" onMouseDown={e => { e.preventDefault(); insert() }}>
          <span className="ms-mention-name">✦ @prometheus</span>
          <span className="ms-sub">methodology{room.firms.length === 2 ? ', and trades confirmed on-chain between these two firms' : ''}</span>
          <span className="ms-sub">↵</span>
        </button>
      )}
      <div className="ms-compose-row">
        <textarea ref={ref} rows={1} value={value} onChange={change} onKeyDown={key} onBlur={() => setMention(null)}
                  placeholder={composerHint(room, me)} />
        {onTrade && <button className="ms-trade" onClick={onTrade} title="Share one of your trades with them for confirmation">＋ TRADE</button>}
        {offerMention && <button className="ms-ask" onClick={insert} title="Ask Prometheus in this room">✦</button>}
        <button className="ms-send" onClick={onSend} disabled={busy || !value.trim()}>SEND</button>
      </div>
    </div>
  )
}

// Short "who reads this" for the message box; the thread header has the full list.
function composerHint(room, me) {
  if (room.kind === 'SUPPORT') return 'To Rijeka Support…'
  const others = room.firms.filter(f => f !== me?.firm?.name)
  return (others.length ? 'To ' + others.join(', ') : 'To your colleagues') + ' · @ for Prometheus'
}

// ── Compose: new direct chat, new group, invite ──────────────────────────────

function Compose({ compose, onDone }) {
  const { activeId, rooms, openDirect, openGroup, invite, people: fetchPeople, books: fetchBooks } = useChatStore()
  const [mode, setMode] = useState(compose.mode)
  const [q, setQ] = useState(compose.q || '')
  const [people, setPeople] = useState(null)
  const [books, setBooks] = useState([])
  const [picked, setPicked] = useState([])
  const [name, setName] = useState('')
  const [book, setBook] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const room = mode === 'invite' ? rooms.find(r => r.id === activeId) : null
  const isWallet = mode === 'wallet'

  useEffect(() => { if (!isWallet) fetchPeople().then(setPeople).catch(e => setErr(e.message)) }, [fetchPeople, isWallet])
  useEffect(() => { if (mode === 'group') fetchBooks().then(setBooks).catch(() => {}) }, [mode, fetchBooks])

  const inRoom = new Set((room?.members || []).map(m => m.user_id))
  const shown = (people || []).filter(p => !inRoom.has(p.user_id))
    .filter(p => !q || (p.name + ' ' + p.firm_name).toLowerCase().includes(q.toLowerCase()))
  const multi = mode !== 'direct'
  const toggle = (id) => setPicked(ps => ps.includes(id) ? ps.filter(x => x !== id) : [...ps, id])
  const firmsPicked = [...new Set((people || []).filter(p => picked.includes(p.user_id)).map(p => p.firm_name))]

  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); onDone() } catch (e) { setErr(e.message) } finally { setBusy(false) } }

  if (isWallet) return (
    <div className="ms-compose-panel">
      <div className="ms-thread-head">
        <div className="ms-head-main"><div className="ms-head-title">Signing wallet</div>
          <div className="ms-sub">Used to countersign trades shared with your firm</div></div>
        <button className="ms-icon" onClick={onDone} title="Close">✕</button>
      </div>
      <WalletPanel />
    </div>
  )

  return (
    <div className="ms-compose-panel" key={compose.q || compose.mode}>
      <div className="ms-thread-head">
        <div className="ms-head-main">
          <div className="ms-head-title">{mode === 'invite' ? `Invite to ${room?.title || 'room'}` : 'New conversation'}</div>
          {mode !== 'invite' && (
            <div className="ms-seg">
              <button className={mode === 'direct' ? 'on' : ''} onClick={() => { setMode('direct'); setPicked([]) }}>PERSON</button>
              <button className={mode === 'group' ? 'on' : ''} onClick={() => setMode('group')}>GROUP</button>
            </div>
          )}
        </div>
        <button className="ms-icon" onClick={onDone} title="Cancel">✕</button>
      </div>

      <div className="ms-compose-body">
        {mode === 'group' && (
          <>
            <label className="ms-label">ROOM NAME
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. USD Rates · Confluence" autoFocus />
            </label>
            <label className="ms-label">DESK / BOOK <span className="ms-sub">optional — Prometheus then only uses confirmations from it</span>
              <select value={book} onChange={e => setBook(e.target.value)}>
                <option value="">None</option>
                {books.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </label>
          </>
        )}
        <label className="ms-label">{mode === 'direct' ? 'CHAT WITH' : 'PEOPLE'}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or firm" autoFocus={mode !== 'group'} />
        </label>
        {!people && !err && <div className="ms-note">Loading people…</div>}
        <div className="ms-pick-list">
          {shown.map(p => (
            <button key={p.user_id} className={`ms-pick${picked.includes(p.user_id) ? ' on' : ''}`} disabled={busy}
                    onClick={() => multi ? toggle(p.user_id) : run(() => openDirect(p.user_id))}>
              {multi && <span className="ms-check">{picked.includes(p.user_id) ? '■' : '□'}</span>}
              <span className="ms-pick-name">{p.name}</span>
              <span className="ms-sub">{p.firm_name}</span>
              {!p.same_firm && <span className="ms-tag invite">INVITE</span>}
            </button>
          ))}
          {people && !shown.length && <div className="ms-note">Nobody matches.</div>}
        </div>
        {err && <div className="ms-note err">{err}</div>}
        {multi && (
          <div className="ms-compose-foot">
            <span className="ms-sub">
              {picked.length ? `${picked.length} selected${firmsPicked.length ? ' · ' + firmsPicked.join(', ') : ''}. People at other firms get an invite to accept.` : 'Pick people from your firm or others.'}
            </span>
            {mode === 'group'
              ? <button className="ms-btn" disabled={busy || !name.trim()}
                        onClick={() => run(() => openGroup({ name: name.trim(), memberIds: picked, bookNodeId: book }))}>CREATE</button>
              : <button className="ms-btn" disabled={busy || !picked.length}
                        onClick={() => run(() => invite(activeId, picked))}>INVITE</button>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function ThreadHead({ back, onBack, title, tag, line, book, actions }) {
  return (
    <div className="ms-thread-head">
      {back && <button className="ms-icon" onClick={onBack} title="Back">‹</button>}
      <div className="ms-head-main">
        <div className="ms-head-title">{title} {tag}</div>
        <div className="ms-sub">{line}{book ? <span className="ms-book"> · {book}</span> : null}</div>
      </div>
      <div className="ms-head-actions">{actions}</div>
    </div>
  )
}

function Composer({ placeholder, value, onChange, onSend, busy }) {
  const key = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (value.trim()) onSend() } }
  return (
    <div className="ms-compose">
      <div className="ms-compose-row">
        <textarea rows={1} value={value} onChange={e => onChange(e.target.value)} onKeyDown={key} placeholder={placeholder} />
        <button className="ms-send" onClick={onSend} disabled={busy || !value.trim()}>SEND</button>
      </div>
    </div>
  )
}

function Sources({ sources }) {
  if (!sources?.length) return null
  return (
    <div className="ms-meta ms-sources">
      <span>Source</span>
      {sources.map(s => (
        <a key={s.path} href={s.url} target="_blank" rel="noopener noreferrer" title={s.path}>{s.path.split('/').slice(-2).join('/')}</a>
      ))}
    </div>
  )
}

function Thinking() {
  return <div className="ms-msg prometheus"><div className="ms-who">✦ PROMETHEUS</div><div className="ms-bubble ms-thinking">looking into it…</div></div>
}
