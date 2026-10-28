// The frame around sign-in, sign-up and confirmation: the live desk on the
// left (a par curve drawing itself from today's public SOFR snapshot, the
// registry's pulse), the form on the right. It uses the same grid, glow,
// curve stroke and type as the boot sequence that follows, so the three
// screens read as one system rather than three designs.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './Auth.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

const years = (t) => {
  const m = /^(\d+)(D|W|M|Y)$/.exec(t || '')
  if (!m) return t === 'ON' ? 1 / 365 : null
  const n = +m[1]
  return { D: n / 365, W: n / 52, M: n / 12, Y: n }[m[2]]
}

// A plausible USD OIS shape, used only until the real snapshot arrives or when
// the API is unreachable; the page must never look broken on first paint.
const FALLBACK = [['ON', 3.65], ['3M', 3.72], ['1Y', 3.76], ['2Y', 4.06], ['3Y', 4.10], ['5Y', 4.12],
  ['7Y', 4.21], ['10Y', 4.28], ['20Y', 4.52], ['30Y', 4.48]].map(([tenor, rate]) => ({ tenor, rate }))

const W = 900, H = 240, X0 = Math.log(1 / 365), X1 = Math.log(30)
const xOf = (y) => (Math.log(Math.max(y, 1 / 365)) - X0) / (X1 - X0) * W

function pathOf(quotes) {
  const pts = quotes.map(q => ({ y: years(q.tenor), r: Number(q.rate), t: q.tenor }))
    .filter(p => p.y != null && !isNaN(p.r)).sort((a, b) => a.y - b.y)
  if (pts.length < 3) return null
  const lo = Math.min(...pts.map(p => p.r)) - 0.25, hi = Math.max(...pts.map(p => p.r)) + 0.25
  const yOf = (r) => (hi - r) / (hi - lo) * H
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.y).toFixed(1)},${yOf(p.r).toFixed(1)}`).join(' ')
  const area = `${d} L${xOf(pts[pts.length - 1].y).toFixed(1)},${H} L${xOf(pts[0].y).toFixed(1)},${H} Z`
  const placed = pts.map(p => ({ ...p, x: xOf(p.y), yy: yOf(p.r) }))
  return { d, area, pts: placed, last: placed[placed.length - 1] }
}

const fmtN = (n) => n == null ? '—' : Number(n).toLocaleString()

export default function AuthScene({ children, eyebrow }) {
  const [pulse, setPulse] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let dead = false
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 6000)
    fetch(`${API}/api/public/pulse`, { signal: ctl.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(b => { if (!dead) setPulse(b) })
      .catch(() => { if (!dead) setFailed(true) })
      .finally(() => clearTimeout(t))
    return () => { dead = true; ctl.abort() }
  }, [])

  const quotes = pulse?.curve?.quotes?.length >= 3 ? pulse.curve.quotes : FALLBACK
  const live = pulse?.curve?.quotes?.length >= 3
  const curve = pathOf(quotes)
  const ticks = ['ON', '1Y', '5Y', '10Y', '30Y']
  const chain = pulse?.chain || {}

  return (
    <div className="au-shell">
      <section className="au-scene" aria-hidden="true">
        <div className="au-scene-top">
          <div className="au-mark">RIJEKA</div>
          <div className="au-sub">OPEN-SOURCE DERIVATIVES DESK · PHASE 1 · RATES</div>
        </div>

        <div className="au-headline">
          <h1>Price it.<br />Confirm it on-chain.<br /><span>Verify it without us.</span></h1>
          <p>A trading desk you can read all the way down: pricing and XVA in Python, bilateral confirmation signed by both parties and anchored on Ethereum, and a verifier that trusts nothing of ours.</p>
        </div>

        <div className="au-chart">
          <div className="au-chart-hdr">
            <span>USD SOFR OIS · PAR CURVE</span>
            <span className={`au-live${live ? ' on' : ''}`}>
              <i />{live ? `SNAPSHOT ${pulse.curve.valuation_date}` : failed ? 'OFFLINE · ILLUSTRATIVE' : 'CONNECTING'}
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H + 28}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="auFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
                <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {curve && <>
              <path className="au-area" d={curve.area} fill="url(#auFill)" />
              <path className="au-line" d={curve.d} />
              {curve.pts.map(p => <circle key={p.t} className="au-dot" cx={p.x} cy={p.yy} r="3" />)}
              <text className="au-last" x={Math.min(curve.last.x, W - 70)} y={Math.max(14, curve.last.yy - 12)}>{curve.last.r.toFixed(3)}%</text>
            </>}
            {ticks.map(t => <text key={t} className="au-tick" x={xOf(years(t))} y={H + 22} textAnchor="middle">{t}</text>)}
          </svg>
        </div>

        <div className="au-pulse">
          <div><b>{fmtN(pulse?.curves)}</b><span>CURVES</span></div>
          <div><b>{fmtN(pulse?.confirmations)}</b><span>CONFIRMATIONS ANCHORED</span></div>
          <div><b>{chain.latest_block ? `#${fmtN(chain.latest_block)}` : '—'}</b><span>SEPOLIA · LATEST BLOCK</span></div>
          <div><b>{fmtN(pulse?.news_24h)}</b><span>HEADLINES · 24H</span></div>
        </div>

        <div className="au-foot">
          <a href="https://rijeka.app" target="_blank" rel="noopener noreferrer">rijeka.app</a>
          <a href="https://github.com/MikoDevedzic/rijeka" target="_blank" rel="noopener noreferrer">Source</a>
          <a href="/methodology/rijeka_methodology.pdf" target="_blank" rel="noopener noreferrer">Methodology</a>
          {chain.registry && <a href={`${chain.explorer || 'https://sepolia.etherscan.io'}/address/${chain.registry}`} target="_blank" rel="noopener noreferrer">Registry</a>}
        </div>
      </section>

      <section className="au-panel">
        <div className="au-card">
          {eyebrow && <div className="au-eyebrow">{eyebrow}</div>}
          {children}
        </div>
        <div className="au-legal">
          <Link to="/terms" target="_blank">Terms</Link> · <Link to="/privacy" target="_blank">Privacy</Link> · Hosted demo on the Sepolia testnet · not investment advice
        </div>
      </section>
    </div>
  )
}

export function Field({ label, children }) {
  return <label className="au-field"><span>{label}</span>{children}</label>
}

export function SubmitBtn({ state, labels }) {
  return (
    <button type="submit" className={`au-btn ${state}`} disabled={state !== 'idle'}>
      {labels[state]}
    </button>
  )
}
