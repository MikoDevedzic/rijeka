import { useEffect, useMemo, useRef, useState } from 'react'
import { getSessionMaybe } from '../lib/session'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import './CommandCenter.css'

const NAV = [
  { label: 'HOME',           path: '/command-center' },
  { label: 'BLOTTER',        path: '/blotter' },
  { label: 'CONFIGURATIONS', path: '/configurations/market-data/curves' },
  { label: 'METHODOLOGY',    path: '/methodology' },
  { label: 'ROADMAP',        path: '/roadmap' },
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
// The state of the world on sign-in, drawn from real data: the par curve, the
// vol surface, the book, the confirmation chain, the headlines. Everything is
// read from endpoints that already exist; nothing is computed here but pixels.

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
const years = (t) => { const m = /^(\d+)(D|W|M|Y)$/.exec(t); if (!m) return t === 'ON' ? 1 / 365 : null; const n = +m[1]; return { D: n / 365, W: n / 52, M: n / 12, Y: n }[m[2]] }

function useSize(ref) {
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current); return () => ro.disconnect()
  }, [ref])
  return w
}

function useCountUp(target, ms = 700) {
  const [v, setV] = useState(0)
  useEffect(() => {
    const n = Number(target) || 0; if (!n) { setV(0); return }
    const t0 = performance.now(); let raf
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); setV(Math.round(n * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

const BOOT_KEY = 'rijeka.booted'
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function DeskHome({ demo, navigate }) {
  const session = useAuthStore(s => s.session)
  const uid = session?.user?.id
  const [d, setD] = useState({ loading: true })
  const [steps, setSteps] = useState({})            // key -> { ok, detail }
  const [booting, setBooting] = useState(() => {
    if (reducedMotion()) return false
    try { return sessionStorage.getItem(BOOT_KEY) !== uid } catch { return true }
  })
  useEffect(() => {
    let alive = true
    const mark = (k, ok, detail) => alive && setSteps(st => ({ ...st, [k]: { ok, detail } }))
    const step = (k, p, detail) => p.then(v => { mark(k, true, detail(v)); return v }).catch(e => { mark(k, false, e.message); return null })
    Promise.all([
      step('sofr',   get('/api/market-data/snapshots/USD_SOFR/latest'),      v => v?.exists ? `${fmtD(v.valuation_date)} · ${v.quotes?.length || 0} points` : 'no snapshot'),
      step('vol',    get('/api/market-data/snapshots/USD_SWVOL_ATM/latest'), v => v?.exists ? `${v.quotes?.length || 0} points` : 'no snapshot'),
      step('trades', get('/api/trades/'),                                     v => `${v?.length || 0} trades · ${(v || []).filter(t => t.status === 'CONFIRMED').length} confirmed`),
      step('chain',  get('/api/chain/status'),                                v => v?.anchored ? `${v.chain_id === 11155111 ? 'Sepolia' : 'chain ' + v.chain_id} · ${v.registry?.slice(0, 8)}…${v.registry?.slice(-4)}` : 'off-chain'),
      step('news',   get('/api/news/items?limit=12'),                         v => `${v?.length || 0} headlines`),
    ]).then(([sofr, vol, trades, chain, news]) => {
      if (!alive) return
      setD({ loading: false, sofr, vol, trades: trades || [], chain, news: news || [] })
    })
    return () => { alive = false }
  }, [])
  const endBoot = () => { try { sessionStorage.setItem(BOOT_KEY, uid) } catch {}; setBooting(false) }
  if (booting) return <BootScreen steps={steps} ready={!d.loading} sofr={d.sofr} name={traderName(session)} role={(session?.user?.user_metadata?.role || 'viewer').toUpperCase()} onDone={endBoot} />

  const trades = d.trades || []
  const by = s => trades.filter(t => t.status === s).length
  const confirmed = by('CONFIRMED'), pending = by('PENDING')
  const notional = trades.reduce((m, t) => { const c = t.notional_ccy || 'USD'; m[c] = (m[c] || 0) + Number(t.notional || 0); return m }, {})
  const asOf = d.sofr?.valuation_date
  const stale = daysOld(asOf)
  const showPath = !d.loading && confirmed === 0
  const r2 = quote(d.sofr, '2Y'), r10 = quote(d.sofr, '10Y'), r5 = quote(d.sofr, '5Y'), r30 = quote(d.sofr, '30Y')

  return (
    <div className="dh">
      <div className="dh-strip">
        <span className="dh-strip-k">USD SOFR</span>
        {['ON', '2Y', '5Y', '10Y', '30Y'].map(t => <span key={t} className="dh-q"><b>{t}</b>{d.sofr?.exists ? fmtN(quote(d.sofr, t), 3) : '—'}</span>)}
        <span className="dh-sep" />
        <span className="dh-strip-k">ATM VOL</span>
        {[['1Y5Y', '1Yx5Y'], ['5Y5Y', '5Yx5Y'], ['5Y9Y', '5Yx9Y']].map(([l, k]) => <span key={k} className="dh-q"><b>{l}</b>{d.vol?.exists ? `${fmtN(quote(d.vol, k), 1)}bp` : '—'}</span>)}
        <span className="dh-strip-right">
          {asOf ? <span className={`dh-asof${stale > 7 ? ' stale' : ''}`}><i className="dh-dot" />SNAPSHOT · {fmtD(asOf)}{stale > 7 ? ` · ${stale}D OLD` : ''}</span>
                : d.loading ? <span className="dh-asof">LOADING…</span> : <span className="dh-asof stale">NO CURVES LOADED</span>}
        </span>
      </div>

      {showPath && (
        <div className="dh-path">
          <span className="dh-path-k">START HERE</span>
          <Step n="1" done={trades.length > 0} text={`Book a swap${demo?.counterparty ? ` against ${demo.counterparty.name}` : ''}, an FX forward or a BTC forward`} onClick={() => navigate('/blotter')} />
          <Step n="2" done={confirmed > 0} text="Confirm it on Sepolia from the trade's CONFIRM tab" onClick={() => navigate('/blotter')} />
          <Step n="3" done={false} text="Verify the proof pack, trusting nothing of ours" href="https://rijeka.app/verify" />
        </div>
      )}

      <div className="dh-hero">
        <section className="dh-card dh-curve">
          <header>
            <span>USD SOFR OIS · PAR CURVE</span>
            <span className="dh-sub">
              {r2 != null && r10 != null && <>2s10s <b>{fmtN((r10 - r2) * 100, 0)}bp</b></>}
              {r5 != null && r30 != null && <> · 5s30s <b>{fmtN((r30 - r5) * 100, 0)}bp</b></>}
              <button className="dh-link" onClick={() => navigate('/configurations/market-data/curves')}>CURVES →</button>
            </span>
          </header>
          <CurveChart snap={d.sofr} loading={d.loading} />
        </section>
        <section className="dh-card dh-vol">
          <header><span>USD SWAPTION · ATM NORMAL VOL (bp)</span><button className="dh-link" onClick={() => navigate('/configurations/market-data/swvol')}>SURFACE →</button></header>
          <VolSurface snap={d.vol} loading={d.loading} />
        </section>
      </div>

      <div className="dh-grid">
        <section className="dh-card">
          <header><span>YOUR BOOK</span><span><button className="dh-link" onClick={() => navigate('/configurations/market-data/crypto')}>FX · CRYPTO DATA →</button> <button className="dh-link" onClick={() => navigate('/blotter')}>OPEN BLOTTER →</button></span></header>
          <div className="dh-kpis">
            <Kpi label="TRADES" value={trades.length} loading={d.loading} />
            <Kpi label="PENDING" value={pending} tone={pending ? 'amber' : ''} loading={d.loading} />
            <Kpi label="CONFIRMED" value={confirmed} tone={confirmed ? 'accent' : ''} loading={d.loading} />
            <div className="dh-kpi"><span className="dh-kpi-l">GROSS NOTIONAL</span><span className="dh-kpi-v small">{d.loading ? '…' : Object.entries(notional).map(([c, n]) => `${c} ${fmtM(n)}`).join(' · ') || '—'}</span></div>
          </div>
          <Ladder trades={trades} />
          <ul className="dh-list">
            {trades.slice(0, 4).map(t => (
              <li key={t.id} onClick={() => navigate('/blotter')}>
                <span className="dh-ref">{t.trade_ref}</span>
                <span className="dh-mid">{(t.instrument_type || '').replace('_', ' ')} · {t.notional_ccy} {fmtM(t.notional)} · {fmtD(t.maturity_date)}</span>
                <span className={`dh-st ${String(t.status).toLowerCase()}`}>{t.status}</span>
              </li>
            ))}
            {!d.loading && !trades.length && <li className="dh-empty">No trades yet. Book one from the blotter; pricing, cashflows, XVA and confirmation all follow from it.</li>}
          </ul>
        </section>

        <section className="dh-card">
          <header><span>ON-CHAIN CONFIRMATIONS</span><a className="dh-link" href="https://rijeka.app/verify" target="_blank" rel="noopener noreferrer">VERIFIER ↗</a></header>
          <div className="dh-kpis">
            <Kpi label="NETWORK" text={d.chain?.anchored ? (d.chain.chain_id === 11155111 ? 'SEPOLIA' : d.chain.chain_id === 1 ? 'ETHEREUM' : `CHAIN ${d.chain.chain_id}`) : d.loading ? '…' : 'OFF-CHAIN'} tone={d.chain?.anchored ? 'accent' : ''} />
            <Kpi label="CONFIRMED" value={confirmed} loading={d.loading} />
            <Kpi label="RECORD" text={`v${d.chain?.schema_version || 2}`} />
          </div>
          <ChainDiagram />
          <div className="dh-text">
            Both parties sign the canonical record; the registry keeps the hash and both addresses. Anyone can recompute and recover them without asking Rijeka.
            {d.chain?.registry && <> Registry <a href={`https://sepolia.etherscan.io/address/${d.chain.registry}`} target="_blank" rel="noopener noreferrer">{d.chain.registry.slice(0, 8)}…{d.chain.registry.slice(-4)} ↗</a>.</>}
            {demo?.enabled && <> Demo: Rijeka holds {demo.counterparty?.name || 'the demo bank'}'s key, so solo confirmations are marked <em>not bilateral</em>.</>}
          </div>
        </section>

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

      <div className="cc-footer">{demo?.enabled ? 'HOSTED DEMO · SEPOLIA TESTNET · DATA MAY BE RESET' : 'EARLY ACCESS'} · RATES ONLY IN PHASE 1 · <a href="/terms" target="_blank" rel="noopener noreferrer">TERMS</a> · <a href="/privacy" target="_blank" rel="noopener noreferrer">PRIVACY</a> · miko@rijeka.app</div>
    </div>
  )
}

function Kpi({ label, value, text, tone = '', loading }) {
  const n = useCountUp(value)
  return <div className={`dh-kpi ${tone}`}><span className="dh-kpi-l">{label}</span><span className="dh-kpi-v">{text != null ? text : loading ? '…' : n}</span></div>
}

function Step({ n, done, text, onClick, href }) {
  const inner = <><span className={`dh-step-n${done ? ' done' : ''}`}>{done ? '✓' : n}</span><span>{text}</span></>
  return href ? <a className="dh-step" href={href} target="_blank" rel="noopener noreferrer">{inner}</a>
              : <button className="dh-step" onClick={onClick}>{inner}</button>
}

// ── Par curve ───────────────────────────────────────────────────────────────
const LABELLED = new Set(['ON', '3M', '1Y', '2Y', '5Y', '10Y', '20Y', '30Y'])

function CurveChart({ snap, loading }) {
  const ref = useRef(null); const W = useSize(ref); const H = 300
  const [hov, setHov] = useState(null)
  const pts = useMemo(() => (snap?.quotes || []).filter(q => q.enabled !== false && years(q.tenor) != null && q.rate != null)
    .map(q => ({ t: q.tenor, y: years(q.tenor), r: Number(q.rate) })).sort((a, b) => a.y - b.y), [snap])
  if (!pts.length) return <div ref={ref} className="dh-plot dh-plot-empty">{loading ? 'Loading curve…' : 'No USD SOFR snapshot loaded. Load one under Configurations → Market data.'}</div>
  const padL = 44, padR = 24, padT = 22, padB = 28
  const x0 = Math.log(1 / 365), x1 = Math.log(Math.max(30, pts[pts.length - 1].y))
  const X = y => padL + (Math.log(Math.max(y, 1 / 365)) - x0) / (x1 - x0) * (W - padL - padR)
  const rs = pts.map(p => p.r); let lo = Math.min(...rs), hi = Math.max(...rs); const pad = Math.max(0.1, (hi - lo) * 0.25); lo -= pad; hi += pad
  const Y = r => padT + (hi - r) / (hi - lo) * (H - padT - padB)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.y).toFixed(1)},${Y(p.r).toFixed(1)}`).join(' ')
  const area = `${path} L${X(pts[pts.length - 1].y).toFixed(1)},${H - padB} L${X(pts[0].y).toFixed(1)},${H - padB} Z`
  const ticks = []; for (let v = Math.ceil(lo * 4) / 4; v <= hi; v += 0.25) ticks.push(+v.toFixed(2))
  const onMove = e => { const bx = e.currentTarget.getBoundingClientRect(); const mx = e.clientX - bx.left; let best = null, bd = 1e9; pts.forEach(p => { const dd = Math.abs(X(p.y) - mx); if (dd < bd) { bd = dd; best = p } }); setHov(best) }
  return (
    <div ref={ref} className="dh-plot">
      {W > 0 && (
        <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHov(null)}>
          <defs>
            <linearGradient id="dhArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient>
            <filter id="dhGlow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {ticks.map(v => <g key={v}><line x1={padL} x2={W - padR} y1={Y(v)} y2={Y(v)} className="dh-grid-line" /><text x={padL - 8} y={Y(v) + 3} className="dh-ax" textAnchor="end">{v.toFixed(2)}</text></g>)}
          {pts.filter(p => LABELLED.has(p.t)).map(p => <text key={p.t} x={X(p.y)} y={H - 10} className="dh-ax" textAnchor="middle">{p.t}</text>)}
          <path d={area} fill="url(#dhArea)" />
          <path d={path} className="dh-line" filter="url(#dhGlow)" />
          {pts.filter(p => LABELLED.has(p.t)).map(p => (
            <g key={p.t}>
              <circle cx={X(p.y)} cy={Y(p.r)} r={6} className="dh-ring" />
              <circle cx={X(p.y)} cy={Y(p.r)} r={4} className="dh-marker" />
              <text x={X(p.y)} y={Y(p.r) - 11} className="dh-val" textAnchor="middle">{p.r.toFixed(3)}</text>
            </g>
          ))}
          {hov && <g>
            <line x1={X(hov.y)} x2={X(hov.y)} y1={padT} y2={H - padB} className="dh-cross" />
            <circle cx={X(hov.y)} cy={Y(hov.r)} r={7} className="dh-ring" /><circle cx={X(hov.y)} cy={Y(hov.r)} r={5} className="dh-marker" />
          </g>}
        </svg>
      )}
      {hov && <div className="dh-tip" style={{ left: Math.min(W - 120, X(hov.y) + 10), top: Y(hov.r) - 46 }}><b>{hov.t}</b> {hov.r.toFixed(4)}%</div>}
    </div>
  )
}

// ── Vol surface ─────────────────────────────────────────────────────────────
function VolSurface({ snap, loading }) {
  const [hov, setHov] = useState(null)
  const grid = useMemo(() => {
    const cells = (snap?.quotes || []).map(q => { const m = /^(\d+)Yx(\d+)Y$/.exec(q.tenor || ''); return m && q.rate != null ? { e: +m[1], t: +m[2], v: Number(q.rate) } : null }).filter(Boolean)
    const es = [...new Set(cells.map(c => c.e))].sort((a, b) => a - b), ts = [...new Set(cells.map(c => c.t))].sort((a, b) => a - b)
    const vs = cells.map(c => c.v); return { cells, es, ts, lo: Math.min(...vs), hi: Math.max(...vs) }
  }, [snap])
  if (!grid.cells.length) return <div className="dh-plot dh-plot-empty">{loading ? 'Loading surface…' : 'No swaption vol snapshot loaded.'}</div>
  const at = (e, t) => grid.cells.find(c => c.e === e && c.t === t)
  const alpha = v => 0.10 + 0.78 * ((v - grid.lo) / Math.max(1e-9, grid.hi - grid.lo))
  return (
    <div className="dh-vs" style={{ '--cols': grid.ts.length }}>
      <div className="dh-vs-corner">EXP \ TENOR</div>
      {grid.ts.map(t => <div key={'h' + t} className="dh-vs-h">{t}Y</div>)}
      {grid.es.map(e => [
        <div key={'r' + e} className="dh-vs-h">{e}Y</div>,
        ...grid.ts.map(t => { const c = at(e, t); return (
          <div key={e + 'x' + t} className="dh-vs-c" style={c ? { background: `color-mix(in srgb, var(--accent) ${Math.round(alpha(c.v) * 100)}%, var(--panel))`, color: alpha(c.v) > 0.5 ? 'var(--bg)' : 'var(--text)' } : undefined}
               onMouseEnter={() => c && setHov(c)} onMouseLeave={() => setHov(null)} title={c ? `${e}Yx${t}Y · ${c.v.toFixed(1)}bp` : ''}>
            {c ? c.v.toFixed(0) : ''}
          </div>) })
      ])}
      <div className="dh-vs-foot">{hov ? <><b>{hov.e}Yx{hov.t}Y</b> {hov.v.toFixed(1)}bp normal</> : <>{grid.lo.toFixed(0)}–{grid.hi.toFixed(0)}bp · darker is higher · hover a cell</>}</div>
    </div>
  )
}

// ── Maturity ladder ─────────────────────────────────────────────────────────
function Ladder({ trades }) {
  const ref = useRef(null); const W = useSize(ref)
  const buckets = useMemo(() => {
    const m = new Map()
    trades.forEach(t => { if (!t.maturity_date) return; const y = new Date(t.maturity_date).getFullYear(); m.set(y, (m.get(y) || 0) + Number(t.notional || 0)) })
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [trades])
  const H = 64, top = Math.max(...buckets.map(b => b[1])) || 1, n = buckets.length || 1, slot = W / n, bw = Math.min(24, slot * 0.6)
  return (
    <div ref={ref} className="dh-ladder" style={buckets.length ? undefined : { height: 0, overflow: 'hidden' }}>
      <span className="dh-kpi-l">NOTIONAL BY MATURITY YEAR</span>
      {W > 0 && buckets.length > 0 && <svg width={W} height={H}>
        {buckets.map(([y, v], i) => { const h = Math.max(2, (v / top) * (H - 22)); const x = i * slot + (slot - bw) / 2; return (
          <g key={y}><title>{y}: {fmtM(v)}</title>
            <path d={`M${x},${H - 14} v${-(h - 4)} a4,4 0 0 1 4,-4 h${bw - 8} a4,4 0 0 1 4,4 v${h - 4} z`} className="dh-bar" />
            <text x={x + bw / 2} y={H - 2} className="dh-ax" textAnchor="middle">{String(y).slice(2)}</text>
          </g>) })}
      </svg>}
    </div>
  )
}

// ── Confirmation chain (diagram, not a chart) ───────────────────────────────
function ChainDiagram() {
  const ref = useRef(null); const W = useSize(ref); const H = 96
  if (!W) return <div ref={ref} className="dh-chain" />
  const n = 4, cx = i => 36 + i * ((W - 72) / (n - 1))
  const nodes = [['TRADE', 'canonical record'], ['keccak256', 'trade hash'], ['A · B', 'EIP-712 signatures'], ['REGISTRY', 'Ethereum']]
  return (
    <div ref={ref} className="dh-chain">
      <svg width={W} height={H}>
        <defs><filter id="dhGlow2"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        {nodes.slice(0, -1).map((_, i) => <line key={i} x1={cx(i) + 16} x2={cx(i + 1) - 16} y1={34} y2={34} className="dh-flow" />)}
        {nodes.map(([a, b], i) => (
          <g key={a}>
            {i === n - 1 ? <rect x={cx(i) - 14} y={20} width={28} height={28} rx={3} className="dh-node block" filter="url(#dhGlow2)" />
                         : <circle cx={cx(i)} cy={34} r={i === 2 ? 13 : 11} className={`dh-node${i === 2 ? ' sig' : ''}`} filter="url(#dhGlow2)" />}
            <text x={cx(i)} y={70} className="dh-node-l" textAnchor="middle">{a}</text>
            <text x={cx(i)} y={84} className="dh-ax" textAnchor="middle">{b}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}


// ── Boot sequence ────────────────────────────────────────────────────────────
// Plays once per sign-in. Every line is a real fetch ticking as it returns —
// the loading screen *is* the data load — then the desk fades in and the
// curve draws itself. Click, Enter or Esc skips. Not shown under
// prefers-reduced-motion.

const traderName = (session) => (session?.user?.email?.split('@')[0] || 'trader').toUpperCase()
const BOOT_STEPS = [
  ['identity', 'IDENTITY'],
  ['chain',    'REGISTRY'],
  ['sofr',     'USD SOFR CURVE'],
  ['vol',      'SWAPTION SURFACE'],
  ['trades',   'YOUR BOOK'],
  ['news',     'MARKET NEWS'],
]
const MIN_MS = 2600

function BootScreen({ steps, ready, sofr, name, role, onDone }) {
  const [t0] = useState(() => performance.now())
  const [leaving, setLeaving] = useState(false)
  const [shown, setShown] = useState(0)                  // lines revealed so far (paced)
  const all = { identity: { ok: true, detail: `${name} · ${role}` }, ...steps }
  const h = new Date().getHours()
  const greet = h < 5 ? 'GOOD NIGHT' : h < 12 ? 'GOOD MORNING' : h < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING'

  // pace the reveal so lines appear one after another even when fetches are instant
  useEffect(() => {
    if (shown >= BOOT_STEPS.length) return
    const k = BOOT_STEPS[shown][0]
    if (!all[k]) return                                    // wait for that fetch
    const id = setTimeout(() => setShown(n => n + 1), shown === 0 ? 250 : 220)
    return () => clearTimeout(id)
  }, [shown, steps])   // eslint-disable-line react-hooks/exhaustive-deps

  const finish = () => { if (leaving) return; setLeaving(true); setTimeout(onDone, 650) }
  useEffect(() => {
    if (!(ready && shown >= BOOT_STEPS.length)) return
    const wait = Math.max(0, MIN_MS - (performance.now() - t0))
    const id = setTimeout(finish, wait + 500)
    return () => clearTimeout(id)
  }, [ready, shown])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = e => { if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') finish() }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  })   // eslint-disable-line react-hooks/exhaustive-deps

  const pts = (sofr?.quotes || []).filter(q => q.enabled !== false && years(q.tenor) != null && q.rate != null)
    .map(q => ({ y: years(q.tenor), r: Number(q.rate) })).sort((a, b) => a.y - b.y)
  let curve = null
  if (pts.length > 2) {
    const W = 900, H = 260, x0 = Math.log(1 / 365), x1 = Math.log(30)
    const lo = Math.min(...pts.map(p => p.r)) - 0.2, hi = Math.max(...pts.map(p => p.r)) + 0.2
    const X = y => (Math.log(Math.max(y, 1 / 365)) - x0) / (x1 - x0) * W, Y = r => (hi - r) / (hi - lo) * H
    curve = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.y).toFixed(1)},${Y(p.r).toFixed(1)}`).join(' ')
  }
  const done = Object.values(all).filter(x => x?.ok).length

  return (
    <div className={`boot${leaving ? ' leaving' : ''}`} onClick={finish} role="status" aria-live="polite">
      <svg className="boot-curve" viewBox="0 0 900 260" preserveAspectRatio="none">
        {curve && <path d={curve} />}
      </svg>
      <div className="boot-box">
        <div className="boot-greet">{greet}, {name.split('.')[0]}</div>
        <div className="boot-mark">R I J E K A</div>
        <div className="boot-sub">WHERE THE TRADING DESK MEETS THE CHAIN · PHASE 1 · RATES, FX & CRYPTO FORWARDS LIVE</div>
        <ol className="boot-steps">
          {BOOT_STEPS.slice(0, shown).map(([k, label]) => {
            const st = all[k]
            return <li key={k} className={st?.ok ? 'ok' : 'fail'}><span className="boot-tick">{st?.ok ? '✓' : '×'}</span><span className="boot-label">{label}</span><span className="boot-detail">{st?.detail}</span></li>
          })}
          {shown < BOOT_STEPS.length && <li className="pending"><span className="boot-tick boot-spin" /><span className="boot-label">{BOOT_STEPS[shown][1]}</span><span className="boot-detail">connecting…</span></li>}
        </ol>
        <div className="boot-bar"><i style={{ width: `${Math.round(100 * Math.min(shown, done) / BOOT_STEPS.length)}%` }} /></div>
        <div className="boot-hint">{ready && shown >= BOOT_STEPS.length ? 'ENTERING THE DESK' : 'PRESS ENTER TO SKIP'}</div>
      </div>
    </div>
  )
}
