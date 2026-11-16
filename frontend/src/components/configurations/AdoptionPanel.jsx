// configurations/AdoptionPanel.jsx — who came, who came back and what they used, per account.
// The admin's view of GET /api/ops/adoption (backend/activity/): the funnel, the last eight weeks, each week's
// new accounts one to three weeks on, what was used in the last 28 days, and each account's own row. Bookings and
// confirmations come from the trading tables; the rest is counted from the day the activity table was applied.
import { useEffect, useState } from 'react'
import { day, eventLabel, headline, kept, share, span, stepLabel, stepSays, week } from './adoption-view'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const QUIET = { color: 'var(--text-mute)' }           // a quiet cell keeps its place on a narrow page (the dim class hides its cell)
const L = { textAlign: 'left' }
const WEEKS = '120px repeat(3, minmax(90px, 1fr))'
const COHORTS = '120px 100px repeat(3, minmax(110px, 1fr))'
const FEATURES = 'minmax(220px, 1fr) 110px 110px'
const ROWS = 'minmax(160px, 1.6fr) minmax(100px, 1fr) 96px 96px 76px 64px 64px 56px 88px'      // 800px and its gaps: inside the 980px panel
const num = (v) => <span className="pnl-tv" style={{ ...L, ...(v ? null : QUIET) }}>{v || '·'}</span>

export default function AdoptionPanel({ role }) {
  const [a, setA] = useState(null)
  useEffect(() => {
    if (role !== 'admin') return undefined                 // the figures are the admin's: do not ask for a 403
    let live = true
    import('../../lib/session').then(({ getSessionMaybe }) => getSessionMaybe())
      .then(s => fetch(`${API}/api/ops/adoption`, { headers: { Authorization: `Bearer ${s?.access_token}` } }))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`adoption ${r.status}`))))
      .then(j => { if (live) setA(j) }).catch(() => { if (live) setA({ error: true }) })
    return () => { live = false }
  }, [role])
  if (role !== 'admin') return null
  const ok = a && !a.error
  return (
    <section className="pnl-panel" style={{ maxWidth: 980 }} data-testid="adoption">
      <header><span>ADOPTION</span><span className="pnl-sub" data-testid="adoption-head">{ok ? headline(a) : a?.error ? 'not answered by this API' : 'reading…'}</span></header>
      {ok && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }} data-testid="adoption-funnel">
          {a.funnel.map(f => (
            <div key={f.step} title={stepSays(f.step)} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-2)', padding: '8px 10px' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)' }}>{stepLabel(f.step)}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 16, color: 'var(--text-hi)' }}>{f.accounts}</span>
                {f.step !== 'created' && <span className="pnl-tv" style={{ ...L, ...QUIET }}>{share(f.share)}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="pnl-foot">Of every account, how many did each thing at least once. From sign-up to the first booked trade:{' '}
          <b style={{ fontFamily: 'var(--mono)', fontWeight: 500, color: 'var(--text)' }}>{span(a.first_trade.median_hours)}</b> at the median
          {a.first_trade.accounts ? ` (${a.first_trade.accounts} account${a.first_trade.accounts === 1 ? '' : 's'})` : ''}.</div>

        <div className="rk-rows" data-testid="adoption-weeks">
          <div className="rk-row dim" style={{ gridTemplateColumns: WEEKS }}><span>WEEK</span><span>CREATED</span><span>ACTIVE</span><span>OF THEM, FROM AN EARLIER WEEK</span></div>
          {a.weeks.slice().reverse().map(w => (
            <div key={w.week} className="rk-row" style={{ gridTemplateColumns: WEEKS }}>
              <span className="rk-ref">{week(w.week)}</span>{num(w.created)}{num(w.active)}{num(w.returning)}
            </div>
          ))}
        </div>

        <div className="rk-rows" data-testid="adoption-cohorts">
          <div className="rk-row dim" style={{ gridTemplateColumns: COHORTS }}><span>CREATED IN</span><span>ACCOUNTS</span><span>ACTIVE 1 WEEK ON</span><span>2 WEEKS ON</span><span>3 WEEKS ON</span></div>
          {a.cohorts.slice().reverse().map(c => (
            <div key={c.week} className="rk-row" style={{ gridTemplateColumns: COHORTS }}>
              <span className="rk-ref">{week(c.week)}</span>{num(c.accounts)}
              {c.active_after.map((n, i) => <span key={i} className="pnl-tv" style={{ ...L, ...(n ? null : QUIET) }}>{kept(n, c.accounts)}</span>)}
            </div>
          ))}
        </div>

        <div className="rk-rows" data-testid="adoption-features">
          <div className="rk-row dim" style={{ gridTemplateColumns: FEATURES }}><span>USED · LAST {a.feature_days} DAYS</span><span>ACCOUNTS</span><span>TIMES</span></div>
          {a.features.length === 0 && <div className="pnl-empty">Nothing but sign-ins in the last {a.feature_days} days.</div>}
          {a.features.map(f => (
            <div key={`${f.event}|${f.detail}`} className="rk-row" style={{ gridTemplateColumns: FEATURES }}>
              <span className="rk-ref">{eventLabel(f.event, f.detail)}</span>{num(f.accounts)}{num(f.times)}
            </div>
          ))}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div className="rk-rows" style={{ minWidth: 880 }} data-testid="adoption-rows">
            <div className="rk-row dim" style={{ gridTemplateColumns: ROWS }}><span>ACCOUNT</span><span>FIRM</span><span>CREATED</span><span>LAST ACTIVE</span><span>DAYS / {a.feature_days}</span><span>PRICED</span><span>BOOKED</span><span>XVA</span><span>CONFIRMED</span></div>
            {a.rows.length === 0 && <div className="pnl-empty">No account has signed up yet.</div>}
            {a.rows.map(r => (
              <div key={r.email} className="rk-row" style={{ gridTemplateColumns: ROWS }}>
                <span className="rk-ref" title={r.email} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.email}</span>
                <span title={r.firm} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(r.firm ? null : QUIET) }}>{r.firm || '—'}</span>
                <span className="pnl-tv" style={L}>{day(r.created)}</span>
                <span className="pnl-tv" style={{ ...L, ...(r.last_active ? null : QUIET) }}>{r.last_active ? day(r.last_active) : 'never'}</span>
                {num(r.days_active)}{num(r.priced)}{num(r.booked)}{num(r.xva)}{num(r.confirmed)}
              </div>
            ))}
          </div>
        </div>
        {a.rows_total > a.rows.length && <div className="pnl-foot">The {a.rows.length} most recently active of {a.rows_total} accounts.</div>}
        <div className="pnl-foot">{a.note}</div>
      </>)}
    </section>
  )
}
