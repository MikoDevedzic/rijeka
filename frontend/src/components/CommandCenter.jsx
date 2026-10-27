import { useEffect, useState } from 'react'
import { getSessionMaybe } from '../lib/session'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import './CommandCenter.css'

const NAV = [
  { label: 'HOME',           path: '/command-center' },
  { label: 'BLOTTER',        path: '/blotter' },
  { label: 'CONFIGURATIONS', path: '/configurations/market-data/curves' },
]

export default function CommandCenter() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const session   = useAuthStore(s => s.session)
  const profile   = useAuthStore(s => s.profile)
  const demo      = useAuthStore(s => s.demo)
  const role      = (session?.user?.user_metadata?.role || 'viewer').toUpperCase()

  const displayName = profile?.handle
    || session?.user?.user_metadata?.handle
    || session?.user?.email?.split('@')[0]?.toUpperCase()
    || 'TRADER'

  return (
    <div className="cc-root">
      <div className="cc-bar">
        <span className="cc-logo">RIJEKA</span>
        <nav className="cc-nav">
          {NAV.map(n => (
            <button
              key={n.path}
              className={`cc-nav-btn${location.pathname === n.path ? ' active' : ''}`}
              onClick={() => navigate(n.path)}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="cc-bar-right">
          {demo?.enabled && (
            <span className="cc-read-only" title="Hosted demo on the Sepolia testnet. Your workspace was set up automatically: an own entity, RIJEKA DEMO BANK AG as counterparty (Rijeka holds its key, so solo confirmations are marked not bilateral) and a copy of the demo market data. Data may be reset."
                  style={{color:'var(--bg)',background:'var(--amber)',padding:'0.1rem 0.45rem',borderRadius:'2px',cursor:'help'}}>DEMO · SEPOLIA</span>
          )}
          <span className="cc-read-only" style={role !== 'VIEWER' ? {color:'var(--text-dim)'} : undefined}>{role === 'VIEWER' ? 'READ ONLY' : role}</span>
          <span className="cc-dot">·</span>
          <span className="cc-user">{displayName}</span>
          <button className="cc-exit" onClick={() => useAuthStore.getState().signOut()}>EXIT</button>
        </div>
      </div>

      <DeskHome demo={demo} navigate={navigate} />
    </div>
  )
}


// ── Desk home ────────────────────────────────────────────────────────────────
// The state of the world on sign-in: market, your book, confirmations, news.
// Everything is read from endpoints that already exist; nothing is computed here.

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

async function get(path) {
  const session = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
  if (!r.ok) throw new Error(`${path} ${r.status}`)
  return r.json()
}

const fmtN = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })
const fmtM = (n) => n == null ? '—' : Math.abs(n) >= 1e9 ? `${fmtN(n / 1e9, 2)}bn` : `${fmtN(n / 1e6, 1)}m`
const fmtD = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const ago = (iso) => { if (!iso) return ''; const h = (Date.now() - new Date(iso)) / 36e5; return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d` }
const quote = (snap, tenor) => snap?.quotes?.find(q => q.tenor === tenor && q.enabled !== false)?.rate
const daysOld = (iso) => iso ? Math.floor((Date.now() - new Date(iso)) / 864e5) : null

function DeskHome({ demo, navigate }) {
  const [d, setD] = useState({ loading: true })
  useEffect(() => {
    let alive = true
    Promise.allSettled([
      get('/api/market-data/snapshots/USD_SOFR/latest'),
      get('/api/market-data/snapshots/USD_SWVOL_ATM/latest'),
      get('/api/trades/'),
      get('/api/chain/status'),
      get('/api/news/items?limit=9'),
    ]).then(([sofr, vol, trades, chain, news]) => {
      if (!alive) return
      const v = r => r.status === 'fulfilled' ? r.value : null
      setD({ loading: false, sofr: v(sofr), vol: v(vol), trades: v(trades) || [], chain: v(chain), news: v(news) || [] })
    })
    return () => { alive = false }
  }, [])

  const trades = d.trades || []
  const by = s => trades.filter(t => t.status === s).length
  const confirmed = by('CONFIRMED')
  const notional = trades.reduce((m, t) => { const c = t.notional_ccy || 'USD'; m[c] = (m[c] || 0) + Number(t.notional || 0); return m }, {})
  const recent = trades.slice(0, 4)
  const asOf = d.sofr?.valuation_date
  const stale = daysOld(asOf)
  const showPath = !d.loading && confirmed === 0

  return (
    <div className="dh">
      {/* market strip */}
      <div className="dh-strip">
        <span className="dh-strip-k">USD SOFR</span>
        {['ON', '2Y', '5Y', '10Y', '30Y'].map(t => <span key={t} className="dh-q"><b>{t}</b>{d.sofr?.exists ? fmtN(quote(d.sofr, t), 3) : '—'}</span>)}
        <span className="dh-sep" />
        <span className="dh-strip-k">ATM VOL</span>
        {[['1Y5Y', '1Yx5Y'], ['5Y5Y', '5Yx5Y'], ['5Y10Y', '5Yx9Y']].map(([l, k]) => <span key={k} className="dh-q"><b>{l === '5Y10Y' ? '5Y9Y' : l}</b>{d.vol?.exists ? `${fmtN(quote(d.vol, k), 1)}bp` : '—'}</span>)}
        <span className="dh-strip-right">
          {asOf ? <span className={`dh-asof${stale > 7 ? ' stale' : ''}`}>SNAPSHOT · {fmtD(asOf)}{stale > 7 ? ` · ${stale}D OLD` : ''}</span>
                : d.loading ? <span className="dh-asof">LOADING…</span> : <span className="dh-asof stale">NO CURVES LOADED</span>}
        </span>
      </div>

      {showPath && (
        <div className="dh-path">
          <span className="dh-path-k">START HERE</span>
          <Step n="1" done={trades.length > 0} text={`Book a swap${demo?.counterparty ? ` against ${demo.counterparty.name}` : ''}`} onClick={() => navigate('/blotter')} />
          <Step n="2" done={confirmed > 0} text="Confirm it on Sepolia from the trade's CONFIRM tab" onClick={() => navigate('/blotter')} />
          <Step n="3" done={false} text="Verify the proof pack, trusting nothing of ours" href="https://rijeka.app/verify" />
        </div>
      )}

      <div className="dh-grid">
        {/* book */}
        <section className="dh-card">
          <header><span>YOUR BOOK</span><button className="dh-link" onClick={() => navigate('/blotter')}>OPEN BLOTTER →</button></header>
          <div className="dh-kpis">
            <Kpi label="TRADES" value={d.loading ? '…' : trades.length} />
            <Kpi label="PENDING" value={d.loading ? '…' : by('PENDING')} tone={by('PENDING') ? 'amber' : ''} />
            <Kpi label="CONFIRMED" value={d.loading ? '…' : confirmed} tone={confirmed ? 'accent' : ''} />
            <Kpi label="GROSS NOTIONAL" value={d.loading ? '…' : Object.entries(notional).map(([c, n]) => `${c} ${fmtM(n)}`).join(' · ') || '—'} small />
          </div>
          <ul className="dh-list">
            {recent.map(t => (
              <li key={t.id} onClick={() => navigate('/blotter')}>
                <span className="dh-ref">{t.trade_ref}</span>
                <span className="dh-mid">{(t.instrument_type || '').replace('_', ' ')} · {t.notional_ccy} {fmtM(t.notional)} · {fmtD(t.maturity_date)}</span>
                <span className={`dh-st ${String(t.status).toLowerCase()}`}>{t.status}</span>
              </li>
            ))}
            {!d.loading && !recent.length && <li className="dh-empty">No trades yet. Book one from the blotter; the pricer, cashflows, XVA and confirmation all follow from it.</li>}
          </ul>
        </section>

        {/* confirmations */}
        <section className="dh-card">
          <header><span>ON-CHAIN CONFIRMATIONS</span><a className="dh-link" href="https://rijeka.app/verify" target="_blank" rel="noopener noreferrer">VERIFIER ↗</a></header>
          <div className="dh-kpis">
            <Kpi label="NETWORK" value={d.chain?.anchored ? (d.chain.chain_id === 11155111 ? 'SEPOLIA' : d.chain.chain_id === 1 ? 'ETHEREUM' : `CHAIN ${d.chain.chain_id}`) : d.loading ? '…' : 'OFF-CHAIN'} tone={d.chain?.anchored ? 'accent' : ''} />
            <Kpi label="CONFIRMED" value={d.loading ? '…' : confirmed} />
            <Kpi label="RECORD" value={`v${d.chain?.schema_version || 2}`} />
          </div>
          <div className="dh-text">
            Both parties sign the canonical trade record (EIP-712); the registry stores the hash and both addresses. Anyone can recompute the hash and recover the signatures without asking Rijeka.
            {d.chain?.registry && <> Registry <a href={`https://sepolia.etherscan.io/address/${d.chain.registry}`} target="_blank" rel="noopener noreferrer">{d.chain.registry.slice(0, 10)}…{d.chain.registry.slice(-6)} ↗</a>, source verified on Sourcify.</>}
            {demo?.enabled && <> On this demo Rijeka holds {demo.counterparty?.name || 'the demo bank'}'s key, so solo confirmations are marked <em>not bilateral</em>; a real counterparty countersigns with its own wallet from the trade card.</>}
          </div>
        </section>

        {/* news */}
        <section className="dh-card">
          <header><span>MARKET NEWS</span><button className="dh-link" onClick={() => navigate('/messenger')}>OPEN ROOM →</button></header>
          <ul className="dh-news">
            {(d.news || []).map(n => (
              <li key={n.url}>
                <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a>
                <span className="dh-news-meta">{n.source} · {ago(n.published_at)}{n.tags?.[0] ? ` · ${n.tags[0]}` : ''}</span>
              </li>
            ))}
            {!d.loading && !(d.news || []).length && <li className="dh-empty">No headlines yet.</li>}
          </ul>
        </section>
      </div>

      <div className="dh-modules">
        {[['BLOTTER', '/blotter'], ['PRICER', '/pricer'], ['CURVES', '/configurations/market-data/curves'], ['SWAPTION VOL', '/configurations/market-data/swvol'], ['ENTITIES', '/configurations/legal-entities'], ['COUNTERPARTIES', '/configurations/counterparties'], ['XVA PARAMETERS', '/configurations/xva-parameters/hw1f'], ['MESSENGER', '/messenger']]
          .map(([l, p]) => <button key={p} onClick={() => navigate(p)}>{l}</button>)}
        <span className="dh-modules-note">Rates only in Phase 1 · FX, credit and equity follow</span>
      </div>

      <div className="cc-footer">{demo?.enabled ? 'HOSTED DEMO · SEPOLIA TESTNET · DATA MAY BE RESET' : 'EARLY ACCESS'} · hello@rijeka.app</div>
    </div>
  )
}

function Kpi({ label, value, tone = '', small = false }) {
  return <div className={`dh-kpi ${tone}`}><span className="dh-kpi-l">{label}</span><span className={`dh-kpi-v${small ? ' small' : ''}`}>{value}</span></div>
}

function Step({ n, done, text, onClick, href }) {
  const inner = <><span className={`dh-step-n${done ? ' done' : ''}`}>{done ? '✓' : n}</span><span>{text}</span></>
  return href ? <a className="dh-step" href={href} target="_blank" rel="noopener noreferrer">{inner}</a>
              : <button className="dh-step" onClick={onClick}>{inner}</button>
}
