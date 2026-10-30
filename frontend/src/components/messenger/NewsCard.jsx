// A headline posted by the NEWS room: source, title (the link), Rijeka's own
// summary when there is one, tags, time. The original is always the link.
import './NewsCard.css'

const TAG_CLASS = { RATES: 'rates', CREDIT: 'credit', FX: 'fx', REGULATION: 'reg', CRYPTO: 'crypto', DERIVATIVES: 'deriv' }

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso), now = Date.now(), h = (now - d.getTime()) / 36e5
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`
  if (h < 24) return `${Math.round(h)}h ago`
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

export default function NewsCard({ card }) {
  let host = ''
  try { host = new URL(card.url).hostname.replace(/^www\./, '') } catch { /* ignore: malformed URL, host stays empty */ }
  return (
    <div className="nc">
      <div className="nc-top">
        <span className="nc-source">{card.source}</span>
        <span className="nc-time">{when(card.published_at)}</span>
      </div>
      <a className="nc-title" href={card.url} target="_blank" rel="noopener noreferrer">{card.title} ↗</a>
      {card.summary && (
        <div className="nc-summary">
          {String(card.summary).split(/\n+/).map((p, i) => <p key={i}>{p}</p>)}
          <div className="nc-summary-meta">
            <span>AI SUMMARY · {card.summary_basis === 'article' ? 'FROM THE ARTICLE' : 'FROM THE FEED BLURB'}</span>
            <a href={card.url} target="_blank" rel="noopener noreferrer">READ THE ORIGINAL ↗</a>
          </div>
        </div>
      )}
      <div className="nc-bottom">
        {(card.tags || []).map(t => <span key={t} className={`nc-tag ${TAG_CLASS[t] || ''}`}>{t}</span>)}
        <span className="nc-host">{host}</span>
      </div>
    </div>
  )
}
