import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { RATES_CURVES } from '../../data/ratesCurves'
import useMarketDataStore from '../../store/useMarketDataStore'

const SECTIONS = [
  {
    id: 'market-data',
    label: 'MARKET DATA',
    roles: ['viewer','trader','admin'],
    items: [{ label:'RATES CURVES', path:'/configurations/market-data/curves' }],
  },
  {
    id: 'infrastructure',
    label: 'INFRASTRUCTURE',
    roles: ['viewer','trader','admin'],
    items: [{ label:'ORG HIERARCHY', path:'/configurations/org-hierarchy' }],
  },
  {
    id: 'onboarding',
    label: 'ONBOARDING',
    roles: ['viewer','trader','admin'],
    items: [
      { label:'LEGAL ENTITIES',  path:'/configurations/legal-entities' },
      { label:'COUNTERPARTIES',  path:'/configurations/counterparties' },
    ],
  },
  {
    id: 'admin',
    label: 'ADMIN',
    roles: ['admin'],
    items: [{ label:'USERS', path:'/configurations/users' }],
  },
]

// Curves with Bloomberg tickers — skip FUNDING, XCCY, DKK
const SNAPABLE_IDS = RATES_CURVES
  .filter(c =>
    c.curve_class !== 'FUNDING' &&
    c.curve_class !== 'XCCY' &&
    c.id !== 'DKK_DESTR' &&
    c.instruments?.some(i => i.ticker?.includes('BGN Curncy') || i.ticker?.includes('Index'))
  )
  .map(c => c.id)

function SnapAllButton({ role }) {
  const [snap, setSnap] = useState(null)
  const { curves, updateQuote } = useMarketDataStore()

  if (!['trader','admin'].includes(role)) return null

  const isRunning = snap?.status === 'running'

  const runSnap = async (e) => {
    e.stopPropagation()
    if (isRunning) return
    setSnap({ status: 'running', done: 0, total: SNAPABLE_IDS.length, current: SNAPABLE_IDS[0] })

    try {
      const { supabase } = await import('../../lib/supabase.js')
      const { data: { session: sess } } = await supabase.auth.getSession()
      if (!sess) { setSnap({ status: 'error', msg: 'Not authenticated' }); return }

      const today = new Date().toISOString().slice(0, 10)
      const failed = []

      for (let i = 0; i < SNAPABLE_IDS.length; i++) {
        const curveId = SNAPABLE_IDS[i]
        setSnap({ status: 'running', done: i, total: SNAPABLE_IDS.length, current: curveId })

        try {
          const tickRes = await fetch('/api/bloomberg/tickers/' + curveId, {
            headers: { Authorization: 'Bearer ' + sess.access_token },
          })
          if (!tickRes.ok) throw new Error('tickers failed')
          const { tickers = {} } = await tickRes.json()

          const tickerList = Object.entries(tickers)
            .filter(([, t]) => t?.includes('BGN Curncy') || t?.includes('Index'))
            .map(([tenor, ticker]) => ({ tenor, ticker }))

          if (!tickerList.length) continue

          const snapRes = await fetch('/api/bloomberg/snap', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + sess.access_token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ curve_id: curveId, snap_date: today, tickers: tickerList, mode: 'live' }),
          })
          const snapData = await snapRes.json()
          if (!snapRes.ok) throw new Error(snapData.detail || 'snap failed')

          // Update store
          const curve = curves.find(c => c.id === curveId)
          if (curve && snapData.quotes?.length) {
            snapData.quotes.forEach(q => {
              const idx = curve.instruments.findIndex(i => i.tenor === q.tenor)
              if (idx !== -1) updateQuote(curveId, idx, String(q.rate))
            })
          }
        } catch (_) {
          failed.push(curveId)
        }

        await new Promise(r => setTimeout(r, 300))
      }

      setSnap({ status: 'done', done: SNAPABLE_IDS.length, total: SNAPABLE_IDS.length, failed, date: today })
      setTimeout(() => setSnap(null), 8000)
    } catch (e) {
      setSnap({ status: 'error', msg: e.message })
      setTimeout(() => setSnap(null), 5000)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <button
        onClick={runSnap}
        disabled={isRunning}
        style={{
          fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.08em',
          padding: '2px 6px', borderRadius: '2px',
          cursor: isRunning ? 'default' : 'pointer',
          fontFamily:"'IBM Plex Mono',var(--mono)", background: 'transparent',
          border: `1px solid ${isRunning ? 'var(--border)' : 'var(--accent)'}`,
          color: isRunning ? 'var(--text-dim)' : 'var(--accent)',
          opacity: isRunning ? 0.6 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {isRunning
          ? `${snap.done + 1}/${snap.total}`
          : '▶ SNAP'}
      </button>
      {snap && (
        <div style={{
          fontSize: '0.8125rem', fontFamily:"'IBM Plex Mono',var(--mono)", lineHeight: 1.4,
          paddingLeft: '1rem', paddingRight: '0.5rem',
          color: snap.status === 'done' ? 'var(--accent)'
               : snap.status === 'error' ? 'var(--red)'
               : 'var(--blue)',
        }}>
          {snap.status === 'running' && snap.current?.replace(/_/g, ' ')}
          {snap.status === 'done' && `✓ ${snap.total - snap.failed.length}/${snap.total} · ${snap.date}`}
          {snap.status === 'error' && `✗ ${snap.msg}`}
        </div>
      )}
    </div>
  )
}

export default function CfgNav() {
  const { profile } = useAuthStore()
  const [collapsed, setCollapsed] = useState({})
  const toggle = id => setCollapsed(s => ({ ...s, [id]: !s[id] }))
  const role = profile?.role || 'viewer'

  return (
    <nav style={{ width:'200px', minWidth:'200px', background:'var(--panel)', borderRight:'1px solid var(--border)', overflowY:'auto', padding:'1rem 0' }}>
      {SECTIONS.filter(s => s.roles.includes(role)).map(sec => {
        const isOpen = !collapsed[sec.id]
        return (
          <div key={sec.id} style={{ marginBottom:'0.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.45rem 1rem' }}>
              <button onClick={() => toggle(sec.id)} style={{
                flex: 1, background:'none', border:'none',
                display:'flex', alignItems:'center',
                justifyContent:'space-between', cursor:'pointer',
                fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'0.9375rem', fontWeight:700,
                letterSpacing:'0.14em', padding: 0,
                color: sec.id==='admin' ? 'var(--amber)' : 'var(--text-dim)',
              }}>
                <span>{sec.label}</span>
                <span style={{ fontSize:'0.55rem', opacity:0.6, marginRight:'6px' }}>{isOpen ? '▾' : '▸'}</span>
              </button>
              {sec.id === 'market-data' && isOpen && (
                <SnapAllButton role={role} />
              )}
            </div>
            {isOpen && sec.items.map(item => (
              <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
                display:'block', padding:'0.35rem 1rem 0.35rem 1.5rem',
                fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'1.0625rem', letterSpacing:'0.06em',
                color: isActive ? 'var(--accent)' : 'var(--text)',
                textDecoration:'none',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                background: isActive ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
                transition:'all 0.12s',
              })}>
                {item.label}
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )
}
