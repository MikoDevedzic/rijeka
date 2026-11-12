// The headlines as a page of their own (/news): what the home shows in a card on a monitor, the phone's NEWS tab
// shows whole. The same feed (GET /api/news/items), the same items, newest first.
import { useEffect, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import '../CommandCenter.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const ago = (iso) => { if (!iso) return ''; const h = (Date.now() - new Date(iso)) / 36e5; return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d` }

export default function NewsPage() {
  const [state, setState] = useState({ loading: true, items: [], error: '' })
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const session = await getSessionMaybe()
        const r = await fetch(`${API}/api/news/items?limit=40`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
        if (!r.ok) throw new Error(`the headlines did not load (${r.status})`)
        const items = await r.json()
        if (alive) setState({ loading: false, items: items || [], error: '' })
      } catch (e) { if (alive) setState({ loading: false, items: [], error: e.message }) }
    })()
    return () => { alive = false }
  }, [])
  return (
    <div className="np" data-testid="news-page">
      <h1 className="np-title">MARKET NEWS</h1>
      {state.error && <div className="np-note">{state.error}</div>}
      <ul className="dh-news np-list">
        {state.items.map(n => (
          <li key={n.url} className={n.summary ? 'has-summary' : ''}>
            <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a>
            {n.summary && <div className="dh-news-sum">
              {String(n.summary).split(/\n+/).map((p, i) => <p key={i} className={/^why it matters/i.test(p) ? 'why' : ''}>{p}</p>)}
              <span className="dh-news-basis">AI summary · {n.summary_basis === 'article' ? 'from the article' : 'from the feed blurb'}</span>
            </div>}
            <span className="dh-news-meta">{n.source} · {ago(n.published_at)}{n.tags?.[0] ? ` · ${n.tags[0]}` : ''}</span>
          </li>
        ))}
        {state.loading && <li className="dh-empty">Loading the headlines…</li>}
        {!state.loading && !state.error && !state.items.length && <li className="dh-empty">No headlines yet.</li>}
      </ul>
    </div>
  )
}
