// The front door (rijeka.app opens here) and the frame around sign-in, sign-up
// and confirmation: the live desk on the
// left (a par curve drawing itself from today's public SOFR snapshot, the
// registry's pulse), the form on the right. It uses the same grid, glow,
// curve stroke and type as the boot sequence that follows, so the three
// screens read as one system rather than three designs.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './Auth.css'
import Scenes from './Scenes'
import RijekaLogo from '../brand/RijekaLogo'

// The public site: how it works, the verifier, the tools, working with us. Its first page is /about: rijeka.app
// itself opens this door (0.31.1), so a link to the bare address would only come back here.
export const SITE_URL = 'https://rijeka.app/about'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

const fmtN = (n) => n == null ? '—' : Number(n).toLocaleString()

// `mode`: 'in' or 'up' on the two pages a visitor chooses between (the switch at the top of the card); none on the
// pages that follow an email link.
export default function AuthScene({ children, eyebrow, mode }) {
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

  const chain = pulse?.chain || {}

  return (
    <div className="au-shell" data-no-shortcuts>
      <section className="au-scene">
        <div className="au-scene-top">
          <div className="au-mark"><RijekaLogo height={30} title="Rijeka" /></div>
          <div className="au-sub">WHERE THE TRADING DESK MEETS THE CHAIN</div>
          <div className="au-phase"><i />PHASE 1 · RATES, FX & CRYPTO FORWARDS AND OPTIONS LIVE · CREDIT, EQUITY, COMMODITY NEXT</div>
        </div>

        <div className="au-headline">
          <h1>Price it.{' '}<br />See what it costs.{' '}<br /><span>Confirm it on chain.</span></h1>
          <p>An open-source derivatives desk for both worlds: the models and bilateral confirmations trading desks run on, the open code and on-chain record crypto expects. Rates, credit, FX, equities, commodities and crypto, free for everyone.</p>
        </div>

        <div className="au-explore">
          <a className="au-explore-btn" href={SITE_URL} aria-label="Explore Rijeka: the public site">EXPLORE<span className="au-explore-long"> RIJEKA</span> →</a>
          <span>HOW IT WORKS · VERIFY · TOOLS · WORK WITH US</span>
        </div>

        {/* a drawing of the desk at work, with nothing in it to read or press */}
        <div className="au-scenes" aria-hidden="true"><Scenes pulse={pulse} failed={failed} /></div>

        <div className="au-pulse">
          <div><b>{fmtN(pulse?.curves)}</b><span>CURVES</span></div>
          <div><b>{fmtN(pulse?.confirmations)}</b><span>CONFIRMATIONS ANCHORED</span></div>
          <div><b>{chain.latest_block ? `#${fmtN(chain.latest_block)}` : '—'}</b><span>SEPOLIA · LATEST BLOCK</span></div>
          <div><b>{fmtN(pulse?.news_24h)}</b><span>HEADLINES · 24H</span></div>
        </div>

        <div className="au-foot">
          <a href="https://github.com/MikoDevedzic/rijeka" target="_blank" rel="noopener noreferrer">Source</a>
          <a href="/methodology/rijeka_methodology.pdf" target="_blank" rel="noopener noreferrer">Methodology</a>
          {chain.registry && <a href={`${chain.explorer || 'https://sepolia.etherscan.io'}/address/${chain.registry}`} target="_blank" rel="noopener noreferrer">Registry</a>}
        </div>
      </section>

      <section className="au-panel">
        <div className="au-card">
          {mode && (
            <nav className="au-seg" aria-label="Sign in or create a desk">
              <Link to="/login" aria-current={mode === 'in' ? 'page' : undefined}>SIGN IN</Link>
              <Link to="/signup" aria-current={mode === 'up' ? 'page' : undefined}>CREATE A DESK</Link>
            </nav>
          )}
          {eyebrow && !mode && <div className="au-eyebrow">{eyebrow}</div>}
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
