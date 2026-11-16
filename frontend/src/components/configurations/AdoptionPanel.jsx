// configurations/AdoptionPanel.jsx — who came, who used it, who came back and what they used, per account.
// The admin's view of GET /api/ops/adoption (backend/activity/): the funnel, the last eight weeks, each week's
// new accounts one to three weeks on, what was used in the last 28 days, and each account's own row. What each
// word means is in backend/activity/adoption.py and in the note under the panel. Bookings and confirmations come
// from the trading tables; the rest is counted from the day the activity table was applied.
import { useEffect, useState } from 'react'
import { usePhone } from '../../lib/phone'
import { day, eventLabel, headline, kept, share, span, stepLabel, stepSays, unreadSays, week } from './adoption-view'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const QUIET = { color: 'var(--text-mute)' }           // a quiet cell keeps its place on a narrow page (the dim class hides its cell)
const L = { textAlign: 'left' }
const WEEKS = '120px repeat(3, minmax(90px, 1fr))'
const COHORTS = '120px 100px repeat(3, minmax(110px, 1fr))'
const FEATURES = 'minmax(220px, 1fr) 110px 110px'
const ROWS = 'minmax(150px, 1.5fr) minmax(90px, 1fr) 92px 92px 92px 60px 60px 60px 52px 84px'      // 782px and its gaps: inside the 980px panel
const num = (v) => <span className="pnl-tv" style={{ ...L, ...(v ? null : QUIET) }}>{v || '·'}</span>
const cut = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

export default function AdoptionPanel({ role }) {
  const [a, setA] = useState(null)
  const phone = usePhone()
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
        {unreadSays(a) && <div className="pnl-err" data-testid="adoption-unread">{unreadSays(a)}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 10 }} data-testid="adoption-funnel">
          {a.funnel.map(f => (
            <div key={f.step} className="pnl-card" title={stepSays(f.step)}>
              <div className="pnl-card-l">{stepLabel(f.step)}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="pnl-card-b" style={{ fontSize: 16 }}>{f.accounts}</span>
                {f.step !== 'created' && <span className="pnl-tv" style={{ ...L, ...QUIET }}>{share(f.share)}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="pnl-foot">Of every account, how many ever did each thing. From sign-up to the first booked trade:{' '}
          <b style={{ fontFamily: 'var(--mono)', fontWeight: 500, color: 'var(--text)' }}>{span(a.first_trade.median_hours)}</b> at the median
          {a.first_trade.accounts ? ` (${a.first_trade.accounts} account${a.first_trade.accounts === 1 ? '' : 's'})` : ''}.</div>

        <div className="rk-rows" data-testid="adoption-weeks">
          <div className="rk-row dim" style={{ gridTemplateColumns: WEEKS }}><span>WEEK</span><span>CREATED</span><span>ACTIVE</span><span title="Of the active accounts, those first active in an earlier week">RETURNING</span></div>
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
          <div className="rk-row dim" style={{ gridTemplateColumns: FEATURES }}><span>USED · LAST {a.feature_days} DAYS</span><span>ACCOUNTS</span><span title="A day counts once for an account, however many times that day">DAYS</span></div>
          {a.features.length === 0 && <div className="pnl-empty">Nothing in the last {a.feature_days} days.</div>}
          {a.features.map(f => (
            <div key={`${f.event}|${f.detail}`} className="rk-row" style={{ gridTemplateColumns: FEATURES }}>
              <span className="rk-ref">{eventLabel(f.event, f.detail)}</span>{num(f.accounts)}{num(f.days)}
            </div>
          ))}
        </div>

        {phone ? (
          // a phone is not pushed sideways: each account is its own two lines
          <div className="rk-rows" data-testid="adoption-rows">
            {a.rows.length === 0 && <div className="pnl-empty">No account has signed up yet.</div>}
            {a.rows.map((r, i) => (
              <div key={`${i}|${r.email}`} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', minWidth: 0 }}>
                <span className="rk-ref" title={r.email} style={cut}>{r.email}</span>
                <span className="pnl-tv" style={{ ...L, ...QUIET, whiteSpace: 'normal', display: 'block' }}>
                  {r.firm || 'no firm'} · created {day(r.created)} · last {r.last_active ? day(r.last_active) : 'never'} · {r.days_active} days of {a.feature_days} · priced {r.priced_days} d · booked {r.booked} · XVA {r.xva_days} d · confirmed {r.confirmed}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div className="rk-rows" style={{ minWidth: 870 }} data-testid="adoption-rows">
              <div className="rk-row dim" style={{ gridTemplateColumns: ROWS }}><span>ACCOUNT</span><span>FIRM</span><span>CREATED</span><span>FIRST ACTIVE</span><span>LAST ACTIVE</span><span>DAYS / {a.feature_days}</span>
                <span title="Days on which it pressed PRICE">PRICED D</span><span title="Trades it booked">BOOKED</span><span title="Days on which it ran XVA">XVA D</span><span title="Trades it confirmed">CONFIRMED</span></div>
              {a.rows.length === 0 && <div className="pnl-empty">No account has signed up yet.</div>}
              {a.rows.map((r, i) => (
                <div key={`${i}|${r.email}`} className="rk-row" style={{ gridTemplateColumns: ROWS }}>
                  <span className="rk-ref" title={r.email} style={cut}>{r.email}</span>
                  <span title={r.firm} style={{ ...cut, ...(r.firm ? null : QUIET) }}>{r.firm || '—'}</span>
                  <span className="pnl-tv" style={L}>{day(r.created)}</span>
                  <span className="pnl-tv" style={{ ...L, ...(r.first_active ? null : QUIET) }}>{r.first_active ? day(r.first_active) : 'never'}</span>
                  <span className="pnl-tv" style={{ ...L, ...(r.last_active ? null : QUIET) }}>{r.last_active ? day(r.last_active) : 'never'}</span>
                  {num(r.days_active)}{num(r.priced_days)}{num(r.booked)}{num(r.xva_days)}{num(r.confirmed)}
                </div>
              ))}
            </div>
          </div>
        )}
        {a.rows_total > a.rows.length && <div className="pnl-foot">The {a.rows.length} most recently active of {a.rows_total} accounts.</div>}
        <div className="pnl-foot">{a.note}{a.dropped ? ` ${a.dropped} counter${a.dropped === 1 ? '' : 's'} could not be written since this API started.` : ''}</div>
      </>)}
    </section>
  )
}
