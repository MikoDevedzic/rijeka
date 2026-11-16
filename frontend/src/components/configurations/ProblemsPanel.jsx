// configurations/ProblemsPanel.jsx — what went wrong for the people using the desk, and for whom.
// The admin's view of GET /api/ops/problems (backend/health/): the same problem as one line, in the words the
// operator's alert uses, with how many accounts it hit and who they are. It names accounts, so it is the admin's;
// the panel under it (BROWSER ERRORS) is the older log in the API's memory, which every signed-in user may read
// and which names nobody.
import { useEffect, useState } from 'react'
import { headline, whoLine } from './problems-view'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const QUIET = { color: 'var(--text-mute)' }
const L = { textAlign: 'left' }
const COLS = 'minmax(280px, 2fr) 70px minmax(180px, 1.2fr) 124px'
const KIND = { browser: 'IN THE BROWSER', api: 'THE API ANSWERED AN ERROR', slow: 'A SLOW ANSWER' }
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—')

export default function ProblemsPanel({ role }) {
  const [b, setB] = useState(null)
  useEffect(() => {
    if (role !== 'admin') return undefined                 // it names accounts: the admin's alone
    let live = true
    const load = () => import('../../lib/session').then(({ getSessionMaybe }) => getSessionMaybe())
      .then(s => fetch(`${API}/api/ops/problems`, { headers: { Authorization: `Bearer ${s?.access_token}` } }))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`problems ${r.status}`))))
      .then(j => { if (live) setB(j) }).catch(() => { if (live) setB(x => x || { error: true }) })
    load()
    const t = setInterval(load, 60_000)
    return () => { live = false; clearInterval(t) }
  }, [role])
  if (role !== 'admin') return null
  const ok = b && !b.error
  return (
    <section className="pnl-panel" style={{ maxWidth: 980 }} data-testid="problems">
      <header><span>PROBLEMS PEOPLE HIT · LAST {ok ? b.hours : 24} HOURS</span><span className="pnl-sub" data-testid="problems-head">{ok ? headline(b) : b?.error ? 'not answered by this API' : 'reading…'}</span></header>
      {ok && b.recording && b.problems.length === 0 && !b.unread && <div className="pnl-empty">No browser reported a problem, and the API answered no request with an error or too slowly.</div>}
      {ok && b.problems.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <div className="rk-rows" style={{ minWidth: 700 }} data-testid="problems-rows">
            <div className="rk-row dim" style={{ gridTemplateColumns: COLS }}><span>WHAT</span><span>TIMES</span><span>WHO</span><span>LAST</span></div>
            {b.problems.map(p => (
              <div key={p.fingerprint} className="rk-row" style={{ gridTemplateColumns: COLS, alignItems: 'start' }}>
                <span className="rk-ref" style={{ overflowWrap: 'anywhere' }}>{p.line}<small>{KIND[p.kind] || p.kind}{p.source && p.kind === 'browser' ? ` · ${p.source}` : ''}{p.release && p.release !== 'dev' ? ` · ${String(p.release).slice(0, 7)}` : ''}</small></span>
                <span className="pnl-tv" style={L}>{p.count}</span>
                <span style={{ overflowWrap: 'anywhere', ...(p.accounts ? null : QUIET) }} data-testid="problems-who">{whoLine(p)}</span>
                <span className="pnl-tv" style={{ ...L, ...QUIET }}>{when(p.last)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {ok && <div className="pnl-foot">A problem is an error the app reported from someone's browser, a request the API answered with a server error, or one it took {b.slow_seconds} seconds or more to answer. The same fault is one line however many people hit it. The operator is told once of each new one, and again only after six hours; once a day there is a summary, also when there was nothing. Kept {b.keep_days} days.{b.dropped ? ` ${b.dropped} could not be kept since this API started.` : ''}</div>}
    </section>
  )
}
