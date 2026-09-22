import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChatStore } from '../../store/useChatStore'
import Markdown from '../common/Markdown'
import './ChatPage.css'

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' })
}

function preview(m) {
  if (!m) return 'No messages yet'
  const who = m.sender_kind === 'USER' ? m.sender_name + ': ' : m.sender_kind === 'PROMETHEUS' ? 'Prometheus: ' : ''
  return who + m.body.replace(/[*_`#>]/g, '').slice(0, 90)
}

export default function ChatPage() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const { status, error, me, rooms, init, openRoom } = useChatStore()
  const [picker, setPicker] = useState(false)

  useEffect(() => { init() }, [init])

  // Land on the first room (the support room) when none is selected.
  useEffect(() => {
    if (status === 'ready' && !roomId && rooms.length && window.innerWidth > 720) {
      navigate('/chat/' + rooms[0].id, { replace: true })
    }
  }, [status, roomId, rooms, navigate])

  useEffect(() => {
    if (status === 'ready') openRoom(roomId || null)
    return () => { useChatStore.setState({ activeRoomId: null }) }
  }, [status, roomId, openRoom])

  if (status === 'loading' || status === 'idle') return <div className="ch-empty">Loading chat…</div>
  if (status === 'error') return <div className="ch-empty">Chat is unavailable: {error}</div>
  if (status === 'no-firm') return (
    <div className="ch-empty">
      <div className="ch-empty-title">Your account isn't part of a firm yet</div>
      <div>Chat on Rijeka is between firms. Ask a Rijeka admin to add you to your firm.</div>
    </div>
  )

  const room = rooms.find(r => r.id === roomId)

  return (
    <div className={`ch-root${roomId ? ' ch-has-room' : ''}`}>
      <aside className="ch-side">
        <div className="ch-side-head">
          <div>
            <div className="ch-firm">{me.firm.name}</div>
            <div className="ch-sub">{me.display_name}</div>
          </div>
          <button className="ch-btn" onClick={() => setPicker(true)}>+ NEW</button>
        </div>
        <div className="ch-rooms">
          {rooms.map(r => (
            <button key={r.id} className={`ch-room${r.id === roomId ? ' active' : ''}`}
                    onClick={() => navigate('/chat/' + r.id)}>
              <div className="ch-room-top">
                <span className={`ch-room-title${r.kind === 'SUPPORT' ? ' support' : ''}`}>
                  {r.kind === 'SUPPORT' ? '✦ ' : ''}{r.title}
                </span>
                <span className="ch-room-time">{fmtTime(r.last_message_at)}</span>
              </div>
              <div className="ch-room-bottom">
                <span className="ch-room-preview">{preview(r.last_message)}</span>
                {r.unread > 0 && <span className="ch-badge">{r.unread}</span>}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="ch-main">
        {room ? <Thread room={room} onBack={() => navigate('/chat')} />
              : <div className="ch-empty">Pick a conversation, or start one with + NEW.</div>}
      </section>

      {picker && <FirmPicker onClose={() => setPicker(false)}
                             onPick={async id => { setPicker(false); navigate('/chat/' + await useChatStore.getState().openWith({ firmId: id })) }} />}
    </div>
  )
}

function Thread({ room, onBack }) {
  const { messages, pending, send, userId } = useChatStore()
  const list = messages[room.id]
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState(null)
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const isPending = !!pending[room.id]
  const count = list?.length
  const [mention, setMention] = useState(null)   // { start } while "@pro…" is being typed
  const shared = room.kind !== 'SUPPORT'          // support rooms: Prometheus always answers

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [count, isPending])
  useEffect(() => { inputRef.current?.focus(); setErr(null) }, [room.id])

  const submit = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true); setErr(null)
    try { await send(room.id, body); setDraft('') }
    catch (e) { setErr(e.message) }
    finally { setSending(false) }
  }

  // Offer @prometheus while the word under the caret is a prefix of it.
  const onChange = e => {
    const text = e.target.value
    setDraft(text)
    const upto = text.slice(0, e.target.selectionStart)
    const m = shared && upto.match(/(^|\s)@(\w*)$/)
    setMention(m && 'prometheus'.startsWith(m[2].toLowerCase()) ? { start: upto.length - m[2].length - 1 } : null)
  }

  const insertMention = () => {
    const el = inputRef.current
    const caret = el?.selectionStart ?? draft.length
    const start = mention ? mention.start : 0
    const before = draft.slice(0, start), after = draft.slice(mention ? caret : 0)
    const next = mention ? before + '@prometheus ' + after.replace(/^\s+/, '')
      : (/(^|\s)@prometheus\b/i.test(draft) ? draft : '@prometheus ' + draft)
    setDraft(next)
    setMention(null)
    const pos = mention ? (before + '@prometheus ').length : next.length
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos) })
  }

  const onKey = e => {
    if (mention && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); insertMention(); return }
    if (mention && e.key === 'Escape') { setMention(null); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  return (
    <>
      <header className="ch-thread-head">
        <button className="ch-back" onClick={onBack}>‹</button>
        <div>
          <div className="ch-thread-title">{room.kind === 'SUPPORT' ? '✦ Rijeka Support' : room.title}</div>
          <div className="ch-sub">
            {room.kind === 'SUPPORT'
              ? 'Prometheus answers first · a Rijeka specialist can join'
              : 'Shared with ' + room.title + ' · @prometheus sees methodology and your on-chain confirmations with them'}
          </div>
        </div>
      </header>

      <div className="ch-thread">
        {!list && <div className="ch-sub">Loading…</div>}
        {list?.map(m => <Message key={m.id} m={m} mine={m.sender_user_id === userId} />)}
        {isPending && (
          <div className="ch-msg prometheus"><div className="ch-who">✦ PROMETHEUS</div>
            <div className="ch-bubble ch-thinking">looking into it…</div></div>
        )}
        <div ref={endRef} />
      </div>

      <div className="ch-compose">
        {err && <div className="ch-err">{err}</div>}
        {mention && (
          <button className="ch-mention" onMouseDown={e => { e.preventDefault(); insertMention() }}>
            <span className="ch-mention-name">✦ @prometheus</span>
            <span className="ch-sub">Rijeka's assistant: methodology, and the trades confirmed on-chain between your firms</span>
            <span className="ch-mention-key">↵</span>
          </button>
        )}
        <div className="ch-compose-row">
          <textarea ref={inputRef} rows={1} value={draft} onChange={onChange} onKeyDown={onKey}
                    onBlur={() => setMention(null)}
                    placeholder={shared ? `Message ${room.title} — type @ to ask Prometheus` : 'Ask Rijeka anything…'} />
          {shared && (
            <button className="ch-ask" onClick={insertMention} title="Ask Prometheus in this room">✦ ASK</button>
          )}
          <button className="ch-send" onClick={submit} disabled={sending || !draft.trim()}>SEND</button>
        </div>
      </div>
    </>
  )
}

function Message({ m, mine }) {
  if (m.sender_kind === 'SYSTEM') {
    return <div className="ch-system">{m.body}<span> · {fmtTime(m.created_at)}</span></div>
  }
  const prom = m.sender_kind === 'PROMETHEUS'
  return (
    <div className={`ch-msg${mine ? ' mine' : ''}${prom ? ' prometheus' : ''}`}>
      <div className="ch-who">
        {prom ? '✦ PROMETHEUS' : mine ? 'YOU' : `${m.sender_name} · ${m.sender_firm || ''}`}
        <span className="ch-time">{fmtTime(m.created_at)}</span>
      </div>
      <div className="ch-bubble">{prom ? <Markdown text={m.body} /> : m.body}</div>
      {prom && m.card?.sources?.length > 0 && (
        <div className="ch-sources">
          <span>Source</span>
          {m.card.sources.map(s => (
            <a key={s.path} href={s.url} target="_blank" rel="noopener noreferrer" title={s.path}>
              {s.path.split('/').slice(-2).join('/')}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function FirmPicker({ onClose, onPick }) {
  const me = useChatStore(s => s.me)
  const [firms, setFirms] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState(null)

  useEffect(() => {
    useChatStore.getState().firms().then(setFirms).catch(e => setErr(e.message))
  }, [])

  const shown = (firms || [])
    .filter(f => f.kind !== 'PLATFORM' && f.id !== me.firm.id)
    .filter(f => !q || f.name.toLowerCase().includes(q.toLowerCase()) || f.leis.some(l => l.includes(q.toUpperCase())))

  return (
    <div className="ch-overlay" onClick={onClose}>
      <div className="ch-picker" onClick={e => e.stopPropagation()}>
        <div className="ch-picker-head">
          <span>START A CHAT WITH A FIRM</span>
          <button className="ch-back" onClick={onClose}>✕</button>
        </div>
        <input autoFocus placeholder="Search by name or LEI" value={q} onChange={e => setQ(e.target.value)}
               onKeyDown={e => e.key === 'Escape' && onClose()} />
        {err && <div className="ch-err">{err}</div>}
        {!firms && !err && <div className="ch-sub">Loading…</div>}
        <div className="ch-picker-list">
          {shown.map(f => (
            <button key={f.id} className="ch-picker-item" onClick={() => onPick(f.id)}>
              <span>{f.name}</span>
              <span className={`ch-net${f.on_network ? ' on' : ''}`}>{f.on_network ? 'ON RIJEKA' : 'NOT JOINED YET'}</span>
            </button>
          ))}
          {firms && !shown.length && <div className="ch-sub">No firms match.</div>}
        </div>
      </div>
    </div>
  )
}
