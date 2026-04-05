import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../store/useAuthStore'
import { supabase } from '../lib/supabase'
import './ChatStrip.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

const SYSTEM = 'You are PROMETHEUS, the AI intelligence layer of Rijeka — an institutional derivatives risk platform. You are a concise, expert risk analyst. Answer questions about trades, Greeks (IR01, IR01_DISC, THETA), XVA (CVA, DVA, FVA, ColVA, MVA, KVA), market data, and risk management. Be direct and precise. Use professional derivatives terminology.'

const NEWS = [
  { tag: 'RATES', tagClass: 'rates', headline: 'Fed holds rates steady at 5.25–5.50%; dot plot signals one cut in 2025', meta: 'Reuters · 2h ago' },
  { tag: 'MACRO', tagClass: 'macro', headline: 'US CPI prints 2.8% YoY, below consensus 2.9%; core unchanged at 3.1%', meta: 'Bloomberg · 4h ago' },
  { tag: 'RATES', tagClass: 'rates', headline: 'SOFR fixing 5.310% · €STR 3.400% · SONIA 4.950%', meta: 'DTCC / ECB · today' },
  { tag: 'CREDIT', tagClass: 'credit', headline: 'IG spreads tighten 3bp on positive earnings; HY flat; CDS indices rally', meta: 'Markit · 5h ago' },
  { tag: 'REG', tagClass: 'reg', headline: 'ISDA publishes updated SIMM 2.8 methodology; effective December 2025', meta: 'ISDA · 1d ago' },
  { tag: 'FX', tagClass: 'fx', headline: 'EUR/USD 1.0842 · GBP/USD 1.2634 · USD/JPY 149.82', meta: 'WM/Reuters · today' },
  { tag: 'MACRO', tagClass: 'macro', headline: 'ECB minutes: governing council split on timing of next cut; July meeting live', meta: 'ECB · 1d ago' },
  { tag: 'RATES', tagClass: 'rates', headline: '10Y UST 4.24% (-3bp) · 10Y Bund 2.38% (-2bp) · 2s10s UST -18bp', meta: 'Bloomberg · 3h ago' },
  { tag: 'REG', tagClass: 'reg', headline: 'CFTC proposes amendments to swap dealer capital requirements under CFTC 25-39', meta: 'CFTC · 2d ago' },
  { tag: 'CREDIT', tagClass: 'credit', headline: 'GSI 5Y CDS 45bp · JPMCB 5Y CDS 38bp · Barclays 5Y CDS 62bp', meta: 'Markit · today' },
]

export default function ChatStrip() {
  const [open, setOpen]         = useState(false)
  const [tab, setTab]           = useState('chat')
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '✦ PROMETHEUS online. Ask me about your trades, Greeks, or market data.' }
  ])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [hasNew, setHasNew]     = useState(false)
  const messagesEndRef          = useRef(null)

  useEffect(() => {
    if (open) {
      setHasNew(false)
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }, [open, messages])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setLoading(true)

    try {
      // Always get fresh token from Supabase
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const apiMessages = next
        .filter((m, i) => !(i === 0 && m.role === 'assistant'))
        .map(m => ({ role: m.role, content: m.content }))

      const res = await fetch(API + '/api/analyse/', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system: SYSTEM,
          messages: apiMessages,
        }),
      })

      if (!res.ok) throw new Error('API error ' + res.status)
      const data = await res.json()
      const reply = data.content?.[0]?.text || data.response || data.message || 'No response.'
      setMessages([...next, { role: 'assistant', content: reply }])
      if (!open) setHasNew(true)
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: '✗ ' + e.message }])
    } finally {
      setLoading(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className="cs-root">
      <div className={`cs-panel${open ? ' open' : ''}`}>
        <div className="cs-header">
          <button className={`cs-htab${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>
            ✦ CHAT
          </button>
          <button className={`cs-htab${tab === 'news' ? ' active' : ''}`} onClick={() => setTab('news')}>
            NEWS
          </button>
          <button className="cs-close" onClick={() => setOpen(false)}>✕</button>
        </div>

        {tab === 'chat' && (
          <div className="cs-chat">
            <div className="cs-messages">
              {messages.map((m, i) => (
                <div key={i} className={`cs-msg ${m.role}`}>
                  <div className="cs-msg-who">{m.role === 'user' ? 'YOU' : '✦ PROMETHEUS'}</div>
                  <div className="cs-msg-body">{m.content}</div>
                </div>
              ))}
              {loading && (
                <div className="cs-msg assistant">
                  <div className="cs-msg-who">✦ PROMETHEUS</div>
                  <div className="cs-msg-body thinking">thinking...</div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="cs-input-row">
              <textarea
                className="cs-input"
                placeholder="Ask PROMETHEUS..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKey}
                rows={1}
              />
              <button className="cs-send" onClick={send} disabled={loading || !input.trim()}>
                SEND
              </button>
            </div>
          </div>
        )}

        {tab === 'news' && (
          <div className="cs-news">
            {NEWS.map((n, i) => (
              <div key={i} className="cs-news-item">
                <div className={`cs-news-tag ${n.tagClass}`}>{n.tag}</div>
                <div className="cs-news-headline">{n.headline}</div>
                <div className="cs-news-meta">{n.meta}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cs-tab" onClick={() => setOpen(o => !o)}>
        <div className={`cs-tab-dot${hasNew ? ' visible' : ''}`} />
        <div className="cs-tab-label">✦ CHAT · NEWS</div>
      </div>
    </div>
  )
}
