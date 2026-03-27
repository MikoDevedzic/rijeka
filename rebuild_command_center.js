const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log('wrote:', rel);
}

// ── CommandCenter.jsx ─────────────────────────────────────────────────────────
write('components/CommandCenter.jsx', `import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import './CommandCenter.css'

const TILES = [
  // Row 1 — Trading core
  {
    id: 'blotter',
    label: 'BLOTTER',
    sub: 'Trade Entry · Lifecycle · Positions',
    sprint: 'LIVE',
    live: true,
    path: '/blotter',
    color: 'var(--accent)',
  },
  {
    id: 'pricer',
    label: 'PRICER',
    sub: 'IRS · CDS · FX · Swaption · XVA',
    sprint: 'SPRINT 3',
    live: false,
    color: 'var(--text-dim)',
  },
  {
    id: 'market-risk',
    label: 'MARKET RISK',
    sub: 'VaR · Stress · Greeks · FRTB ES',
    sprint: 'SPRINT 4',
    live: false,
    color: 'var(--text-dim)',
  },
  {
    id: 'pnl',
    label: 'PNL',
    sub: 'Attribution · Desk · Trader',
    sprint: 'SPRINT 4',
    live: false,
    color: 'var(--text-dim)',
  },

  // Row 2 — Middle office
  {
    id: 'credit',
    label: 'COUNTERPARTY CREDIT',
    sub: 'CVA · Exposure · Limits · IM',
    sprint: 'SPRINT 5',
    live: false,
    color: 'var(--text-dim)',
  },
  {
    id: 'collateral',
    label: 'COLLATERAL',
    sub: 'Margin Calls · CSA · Disputes',
    sprint: 'SPRINT 5',
    live: false,
    color: 'var(--text-dim)',
  },
  {
    id: 'confirmations',
    label: 'CONFIRMATIONS',
    sub: 'ISDA · Matching · Affirmation',
    sprint: 'SPRINT 6',
    live: false,
    color: 'var(--text-dim)',
  },
  {
    id: 'configurations',
    label: 'CONFIGURATIONS',
    sub: 'Curves · Entities · Counterparties',
    sprint: 'LIVE',
    live: true,
    path: '/configurations/market-data/curves',
    color: 'var(--blue)',
  },

  // Row 3 — Knowledge + information
  {
    id: 'methodology',
    label: 'METHODOLOGY',
    sub: 'Model Docs · Validation · Governance',
    sprint: 'SPRINT 6',
    live: false,
    color: 'var(--text-dim)',
  },
  {
    id: 'news',
    label: 'NEWS',
    sub: 'Market · Macro · Regulatory',
    sprint: 'SPRINT 3',
    live: false,
    color: 'var(--text-dim)',
  },
  {
    id: 'chat',
    label: 'CHAT',
    sub: 'Desk · Counterparty · AI Assist',
    sprint: 'SPRINT 6',
    live: false,
    color: 'var(--text-dim)',
  },
]

export default function CommandCenter() {
  const canvasRef = useRef(null)
  const navigate  = useNavigate()
  const user      = useAuthStore(s => s.user)

  // Matrix rain
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight

    const cols  = Math.floor(canvas.width / 20)
    const drops = Array(cols).fill(1)
    const chars = 'アイウエオカキクケコΣΔΨΩ∇∂∫∑0123456789ABCDEF'

    const draw = () => {
      ctx.fillStyle = 'rgba(6,10,14,0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#0ec9a020'
      ctx.font = '14px JetBrains Mono, monospace'
      drops.forEach((y, i) => {
        const ch = chars[Math.floor(Math.random() * chars.length)]
        ctx.fillText(ch, i * 20, y * 20)
        if (y * 20 > canvas.height && Math.random() > 0.975) drops[i] = 0
        drops[i]++
      })
    }

    const id = setInterval(draw, 50)
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    window.addEventListener('resize', resize)
    return () => { clearInterval(id); window.removeEventListener('resize', resize) }
  }, [])

  const handle = (tile) => {
    if (!tile.live) return
    navigate(tile.path)
  }

  const displayName = user?.email?.split('@')[0]?.toUpperCase() || 'TRADER'

  return (
    <div className="cc-root">
      <canvas ref={canvasRef} className="cc-canvas" />

      <div className="cc-bar">
        <span className="cc-logo">RIJEKA</span>
        <div className="cc-bar-right">
          <span className="cc-read-only">READ ONLY</span>
          <span className="cc-dot">·</span>
          <span className="cc-user">{displayName}</span>
          <button className="cc-exit" onClick={() => useAuthStore.getState().signOut()}>EXIT</button>
        </div>
      </div>

      <div className="cc-center">
        <div className="cc-hero">
          <h1 className="cc-title">R I J E K A</h1>
          <p className="cc-subtitle">RISK SYSTEM</p>
          <p className="cc-welcome">Welcome, {displayName}.</p>
        </div>

        <div className="cc-grid">
          {TILES.map(tile => (
            <div
              key={tile.id}
              className={\`cc-tile \${tile.live ? 'cc-tile-live' : 'cc-tile-locked'}\`}
              style={{ '--tile-color': tile.color }}
              onClick={() => handle(tile)}
            >
              <div className="cc-tile-label">{tile.label}</div>
              <div className="cc-tile-sub">{tile.sub}</div>
              <div className={\`cc-tile-sprint \${tile.live ? 'cc-sprint-live' : ''}\`}>
                {tile.sprint}
              </div>
            </div>
          ))}
          {/* empty cell to complete 4x3 grid */}
          <div className="cc-tile cc-tile-empty" />
        </div>

        <div className="cc-footer">
          EARLY ACCESS · READ ONLY · hello@rijeka.app
        </div>
      </div>
    </div>
  )
}
`);

// ── CommandCenter.css ─────────────────────────────────────────────────────────
write('components/CommandCenter.css', `/* ── Command Center ── */

.cc-root {
  position: relative;
  width: 100vw;
  height: 100vh;
  background: var(--bg-deep);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.cc-canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0.6;
}

/* Top bar */
.cc-bar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 2rem;
  border-bottom: 1px solid var(--border);
  background: rgba(6,10,14,0.7);
  backdrop-filter: blur(4px);
}
.cc-logo {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--accent);
}
.cc-bar-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
}
.cc-read-only { color: var(--amber); font-weight: 700; }
.cc-dot       { color: var(--text-dim); }
.cc-user      { color: var(--accent); font-weight: 700; }
.cc-exit {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 0.3rem 0.75rem;
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.15s;
}
.cc-exit:hover { border-color: var(--text); color: var(--text); }

/* Center layout */
.cc-center {
  position: relative;
  z-index: 2;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 2rem;
  gap: 1.5rem;
}

/* Hero */
.cc-hero {
  text-align: center;
}
.cc-title {
  font-size: clamp(2rem, 6vw, 4rem);
  font-weight: 900;
  letter-spacing: 0.3em;
  color: var(--accent);
  margin: 0;
  text-shadow: 0 0 40px rgba(14,201,160,0.3);
}
.cc-subtitle {
  font-size: 0.75rem;
  letter-spacing: 0.3em;
  color: var(--text-dim);
  margin: 0.25rem 0 0;
}
.cc-welcome {
  font-size: 0.8rem;
  font-style: italic;
  color: var(--text);
  margin: 0.5rem 0 0;
  opacity: 0.7;
}

/* Grid — 4 columns */
.cc-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
  width: 100%;
  max-width: 1100px;
}

/* Tiles */
.cc-tile {
  background: rgba(11,18,25,0.85);
  border: 1px solid var(--border);
  padding: 1rem 1.25rem;
  border-radius: 3px;
  backdrop-filter: blur(4px);
  transition: all 0.2s;
  min-height: 90px;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  position: relative;
  overflow: hidden;
}
.cc-tile::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 3px;
  height: 100%;
  background: var(--tile-color, var(--border));
  opacity: 0.6;
  transition: opacity 0.2s;
}
.cc-tile-live {
  cursor: pointer;
  border-color: color-mix(in srgb, var(--tile-color) 25%, var(--border));
}
.cc-tile-live:hover {
  background: rgba(11,18,25,0.95);
  border-color: var(--tile-color);
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}
.cc-tile-live:hover::before { opacity: 1; }
.cc-tile-locked { opacity: 0.45; cursor: default; }
.cc-tile-empty  { background: transparent; border-color: transparent; cursor: default; }
.cc-tile-empty::before { display: none; }

.cc-tile-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--tile-color, var(--text));
}
.cc-tile-sub {
  font-size: 0.62rem;
  color: var(--text-dim);
  letter-spacing: 0.04em;
  line-height: 1.4;
  flex: 1;
}
.cc-tile-sprint {
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text-dim);
  margin-top: 0.25rem;
}
.cc-sprint-live {
  color: var(--tile-color);
  opacity: 0.8;
}

/* Footer */
.cc-footer {
  font-size: 0.6rem;
  letter-spacing: 0.15em;
  color: var(--text-dim);
  opacity: 0.5;
  text-align: center;
}

@media (max-width: 900px) {
  .cc-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 500px) {
  .cc-grid { grid-template-columns: 1fr; }
}
`);

// ── App.jsx — add /blotter route ──────────────────────────────────────────────
write('App.jsx', `import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/useAuthStore'

import AuthGuard        from './components/auth/AuthGuard'
import LoginPage        from './components/auth/LoginPage'
import SignupPage       from './components/auth/SignupPage'
import ConfirmPage      from './components/auth/ConfirmPage'
import CommandCenter    from './components/CommandCenter'
import AppBar           from './components/layout/AppBar'
import CfgNav           from './components/layout/CfgNav'

import CurvesWorkspace  from './components/market-data/CurvesWorkspace'
import OrgHierarchy     from './components/org/OrgHierarchy'
import LegalEntities    from './components/onboarding/LegalEntities'
import Counterparties   from './components/onboarding/Counterparties'
import Trades           from './components/trades/Trades'

function ConfigLayout() {
  return (
    <div style={{ display:'flex', height:'100vh', flexDirection:'column' }}>
      <AppBar />
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        <CfgNav />
        <main style={{ flex:1, overflow:'auto', background:'var(--bg)' }}>
          <AuthGuard />
        </main>
      </div>
    </div>
  )
}

function BlotterLayout() {
  return (
    <div style={{ display:'flex', height:'100vh', flexDirection:'column' }}>
      <AppBar />
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        <main style={{ flex:1, overflow:'auto', background:'var(--bg)' }}>
          <AuthGuard />
        </main>
      </div>
    </div>
  )
}

export default function App() {
  const { initAuth, loading } = useAuthStore()

  useEffect(() => { initAuth() }, [])

  if (loading) {
    return (
      <div style={{
        height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
        background:'var(--bg)', color:'var(--accent)',
        fontFamily:'var(--mono)', fontSize:'0.75rem', letterSpacing:'0.15em',
      }}>
        INITIALISING...
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login"   element={<LoginPage />} />
        <Route path="/signup"  element={<SignupPage />} />
        <Route path="/confirm" element={<ConfirmPage />} />

        {/* Protected */}
        <Route element={<AuthGuard />}>
          <Route path="/command-center" element={<CommandCenter />} />

          {/* Blotter — full width, no side nav */}
          <Route element={<BlotterLayout />}>
            <Route path="/blotter" element={<Trades />} />
          </Route>

          {/* Configurations — with side nav */}
          <Route element={<ConfigLayout />}>
            <Route path="/configurations">
              <Route index element={<Navigate to="market-data/curves" replace />} />
              <Route path="market-data/curves" element={<CurvesWorkspace />} />
              <Route path="org-hierarchy"      element={<OrgHierarchy />} />
              <Route path="legal-entities"     element={<LegalEntities />} />
              <Route path="counterparties"     element={<Counterparties />} />
            </Route>
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/command-center" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
`);

// ── CfgNav.jsx — remove Blotter section ──────────────────────────────────────
write('components/layout/CfgNav.jsx', `import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

const SECTIONS = [
  {
    id: 'market-data',
    label: 'MARKET DATA',
    items: [
      { label: 'RATES CURVES', path: '/configurations/market-data/curves' },
    ],
  },
  {
    id: 'infrastructure',
    label: 'INFRASTRUCTURE',
    items: [
      { label: 'ORG HIERARCHY', path: '/configurations/org-hierarchy' },
    ],
  },
  {
    id: 'onboarding',
    label: 'ONBOARDING',
    items: [
      { label: 'LEGAL ENTITIES',  path: '/configurations/legal-entities' },
      { label: 'COUNTERPARTIES',  path: '/configurations/counterparties' },
    ],
  },
]

export default function CfgNav() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState({})
  const toggle = (id) => setCollapsed(s => ({ ...s, [id]: !s[id] }))

  return (
    <nav style={{
      width: '200px',
      minWidth: '200px',
      background: 'var(--panel)',
      borderRight: '1px solid var(--border)',
      overflowY: 'auto',
      padding: '1rem 0',
    }}>
      {SECTIONS.map(sec => {
        const isOpen = !collapsed[sec.id]
        return (
          <div key={sec.id} style={{ marginBottom: '0.25rem' }}>
            <button
              onClick={() => toggle(sec.id)}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                padding: '0.45rem 1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                fontFamily: 'var(--mono)',
                fontSize: '0.58rem',
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: 'var(--text-dim)',
              }}
            >
              <span>{sec.label}</span>
              <span style={{ fontSize: '0.55rem', opacity: 0.6 }}>{isOpen ? '▾' : '▸'}</span>
            </button>

            {isOpen && sec.items.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                style={({ isActive }) => ({
                  display: 'block',
                  padding: '0.35rem 1rem 0.35rem 1.5rem',
                  fontFamily: 'var(--mono)',
                  fontSize: '0.68rem',
                  letterSpacing: '0.06em',
                  color: isActive ? 'var(--accent)' : 'var(--text)',
                  textDecoration: 'none',
                  borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  background: isActive
                    ? 'color-mix(in srgb, var(--accent) 6%, transparent)'
                    : 'transparent',
                  transition: 'all 0.12s',
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )
}
`);

console.log('\n✅  Command Center rebuild complete.');
console.log('Changes:');
console.log('  CommandCenter.jsx — 11 tiles, correct order, sprint labels');
console.log('  CommandCenter.css — full rewrite, 4-col grid, left accent bar');
console.log('  App.jsx           — /blotter route added, BlotterLayout (no side nav)');
console.log('  CfgNav.jsx        — Blotter section removed');
