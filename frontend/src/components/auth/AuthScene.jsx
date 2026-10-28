// The frame around sign-in, sign-up and confirmation: the live desk on the
// left (a par curve drawing itself from today's public SOFR snapshot, the
// registry's pulse), the form on the right. It uses the same grid, glow,
// curve stroke and type as the boot sequence that follows, so the three
// screens read as one system rather than three designs.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './Auth.css'
import VolSurface3D, { toGrid } from './VolSurface3D'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

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

  const grid = toGrid(pulse?.vol?.quotes)
  const live = !!grid
  const chain = pulse?.chain || {}
  const sofr = pulse?.curve?.quotes?.find(q => q.tenor === 'ON')?.rate
  const s10 = pulse?.curve?.quotes?.find(q => q.tenor === '10Y')?.rate

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
            <span>USD SWAPTION · ATM NORMAL VOL · EXPIRY × TENOR</span>
            <span className={`au-live${live ? ' on' : ''}`}>
              <i />{live ? `SNAPSHOT ${pulse.vol.valuation_date}` : failed ? 'OFFLINE · ILLUSTRATIVE' : 'CONNECTING'}
            </span>
          </div>
          <VolSurface3D grid={grid} />
          {sofr != null && <div className="au-strip">
            <span>SOFR <b>{Number(sofr).toFixed(3)}%</b></span>
            {s10 != null && <span>10Y OIS <b>{Number(s10).toFixed(3)}%</b></span>}
            <span>SOURCE <b>PUBLIC SNAPSHOT</b></span>
          </div>}
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
