import { useState, useRef, useEffect } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { supabase } from '../lib/supabase'
import './PrometheusPanel.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

const GREETING =
  "I'm Prometheus, Rijeka's assistant. I can look up your trades and confirmations, " +
  'and read how Rijeka prices, margins and confirms them — then explain it. ' +
  "I'm read-only: I never book, amend or confirm anything."

const STARTERS = [
  'Summarise my book by status and counterparty',
  'Which of my trades are confirmed on-chain, and do they still match what was signed?',
  'How does on-chain confirmation change MPoR and initial margin in the XVA?',
  'Walk me through how a vanilla SOFR swap is priced in Rijeka',
]

// Plain-English names for data lookups, shown under an answer.
const CHECKED = {
  list_trades: 'your trades',
  get_trade: 'trade detail',
  get_confirmation: 'on-chain confirmation',
  list_parties: 'your counterparties',
}

const ENGINEERING_ASK =
  'Show me the engineering behind that: how it is implemented, with file and line references.'

marked.setOptions({ gfm: true, breaks: true })
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

function Markdown({ text }) {
  const html = DOMPurify.sanitize(marked.parse(text || ''))
  return <div className="pm-md" dangerouslySetInnerHTML={{ __html: html }} />
}

export default function PrometheusPanel() {
  const [open, setOpen]         = useState(false)
  const [wide, setWide]         = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const messagesEndRef          = useRef(null)
  const inputRef                = useRef(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      inputRef.current?.focus()
    }
  }, [open, messages])

  const ask = async (raw) => {
    const text = raw.trim()
    if (!text || loading) return
    setInput('')
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      // Error bubbles are UI only; never send them back as assistant turns.
      const apiMessages = next
        .filter(m => !m.error)
        .map(m => ({ role: m.role, content: m.content }))
      const res = await fetch(API + '/api/analyse/', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(typeof err.detail === 'string' ? err.detail : 'API error ' + res.status)
      }
      const data = await res.json()
      const reply = data.content?.[0]?.text || 'No response.'
      const checked = [...new Set((data.tools_used || []).map(t => CHECKED[t.tool]).filter(Boolean))]
      setMessages([...next, { role: 'assistant', content: reply, checked, sources: data.sources || [] }])
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: e.message, error: true }])
    } finally {
      setLoading(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <>
      {open && (
        <div className={`pm-panel${wide ? ' pm-wide' : ''}`}>
          <div className="pm-panel-header">
            <span className="pm-title">✦ PROMETHEUS</span>
            <span className="pm-badge">READ-ONLY</span>
            <div className="pm-actions">
              {messages.length > 0 && (
                <button className="pm-icon" onClick={() => setMessages([])} disabled={loading} title="New conversation">NEW</button>
              )}
              <button className="pm-icon pm-icon-glyph" onClick={() => setWide(w => !w)} title={wide ? 'Shrink' : 'Expand'}>
                {wide ? '⤡' : '⤢'}
              </button>
              <button className="pm-icon pm-icon-glyph" onClick={() => setOpen(false)} title="Close">✕</button>
            </div>
          </div>

          <div className="pm-messages">
            <div className="pm-msg pm-msg-assistant">
              <div className="pm-msg-who">✦ PROMETHEUS</div>
              <div className="pm-msg-body">{GREETING}</div>
            </div>

            {messages.length === 0 && (
              <div className="pm-starters">
                {STARTERS.map(s => (
                  <button key={s} className="pm-starter" onClick={() => ask(s)}>{s}</button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`pm-msg pm-msg-${m.role}${m.error ? ' pm-msg-error' : ''}`}>
                <div className="pm-msg-who">{m.role === 'user' ? 'YOU' : '✦ PROMETHEUS'}</div>
                <div className="pm-msg-body">
                  {m.role === 'assistant' && !m.error ? <Markdown text={m.content} /> : m.content}
                </div>
                {m.checked?.length > 0 && (
                  <div className="pm-meta">Checked {m.checked.join(' · ')}</div>
                )}
                {m.sources?.length > 0 && (
                  <div className="pm-meta pm-sources">
                    <span>Source</span>
                    {m.sources.map(src => (
                      <a key={src.path} href={src.url} target="_blank" rel="noopener noreferrer" title={src.path}>
                        {src.path.split('/').slice(-2).join('/')}
                      </a>
                    ))}
                  </div>
                )}
                {i === messages.length - 1 && !loading && m.sources?.length > 0 &&
                  messages[i - 1]?.content !== ENGINEERING_ASK && (
                  <button className="pm-deeper" onClick={() => ask(ENGINEERING_ASK)}>Show the engineering →</button>
                )}
              </div>
            ))}

            {loading && (
              <div className="pm-msg pm-msg-assistant">
                <div className="pm-msg-who">✦ PROMETHEUS</div>
                <div className="pm-msg-body pm-thinking">looking into it…</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="pm-input-row">
            <textarea
              ref={inputRef}
              className="pm-input"
              placeholder="Ask about a trade, a confirmation, or how Rijeka models something…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
            />
            <button className="pm-send" onClick={() => ask(input)} disabled={loading || !input.trim()}>SEND</button>
          </div>
        </div>
      )}

      <button className="pm-fab" onClick={() => setOpen(o => !o)} title="Ask Prometheus">✦</button>
    </>
  )
}
