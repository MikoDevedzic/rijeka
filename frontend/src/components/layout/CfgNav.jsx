import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { RATES_CURVES } from '../../data/ratesCurves'
import useMarketDataStore from '../../store/useMarketDataStore'
import useXVAStore        from '../../store/useXVAStore'
import {
  SWAPTION_EXPIRIES, SWAPTION_TENORS,
  OTM_STRIKE_OFFSETS, OTM_SNAP_TENORS,
  EXPIRY_YEARS, TENOR_YEARS,
  otmTicker,
} from '../../data/swaptionVols'

const NAV = [
  {
    id: 'market-data',
    label: 'MARKET DATA',
    roles: ['viewer','trader','admin'],
    snapAll: true,
    children: [
      {
        id: 'rates',
        label: 'RATES',
        children: [
          { label: 'RATE CURVES',        path: '/configurations/market-data/curves',        live: true  },
          { label: 'SWAPTION VOL ATM',   path: '/configurations/market-data/swvol',         live: true  },
          { label: 'CAP/FLOOR VOL',      path: '/configurations/market-data/capfloor',      live: true  },
        ],
      },
      {
        id: 'fx',
        label: 'FX',
        children: [
          { label: 'FX VOL SURFACE',     path: '/configurations/market-data/fx-vol',        live: false, sprint: '7'  },
        ],
      },
      {
        id: 'credit-md',
        label: 'CREDIT',
        children: [
          { label: 'CDS SPREADS',        path: '/configurations/market-data/cds',           live: false, sprint: '7'  },
        ],
      },
      {
        id: 'commodity-md',
        label: 'COMMODITY',
        children: [
          { label: 'COMMODITY CURVES',   path: '/configurations/market-data/commodity',     live: false, sprint: '8'  },
        ],
      },
    ],
  },
  {
    id: 'xva-parameters',
    label: 'XVA PARAMETERS',
    roles: ['viewer','trader','admin'],
    children: [
      {
        id: 'xva-rates',
        label: 'RATES',
        children: [
          { label: 'HW1F CALIBRATION',   path: '/configurations/xva-parameters/hw1f',      live: true  },
        ],
      },
      {
        id: 'xva-fx',
        label: 'FX',
        children: [
          { label: 'GBM CALIBRATION',    path: '/configurations/xva-parameters/gbm',       live: false, sprint: '7'  },
        ],
      },
      {
        id: 'xva-commodity',
        label: 'COMMODITY',
        children: [
          { label: 'VOL CALIBRATION',    path: '/configurations/xva-parameters/commodity',  live: false, sprint: '8'  },
        ],
      },
      {
        id: 'xva-credit',
        label: 'CREDIT',
        children: [
          { label: 'SPREAD CALIBRATION', path: '/configurations/xva-parameters/credit',    live: false, sprint: '7'  },
        ],
      },
    ],
  },
  {
    id: 'market-risk-parameters',
    label: 'MARKET RISK PARAMS',
    roles: ['viewer','trader','admin'],
    sprint: '5',
    children: [
      {
        id: 'mr-rates',
        label: 'RATES',
        children: [
          { label: 'SHOCK SIZES',        path: '/configurations/market-risk/rates',         live: false, sprint: '5'  },
        ],
      },
      {
        id: 'mr-settings',
        label: 'SETTINGS',
        children: [
          { label: 'VAR SETTINGS',       path: '/configurations/market-risk/var',           live: false, sprint: '5'  },
        ],
      },
    ],
  },
  {
    id: 'ccr-parameters',
    label: 'CCR PARAMETERS',
    roles: ['viewer','trader','admin'],
    sprint: '6',
    children: [
      {
        id: 'ccr-saccr',
        label: 'SA-CCR',
        children: [
          { label: 'SUPERVISORY FACTORS',path: '/configurations/ccr/sa-ccr',               live: false, sprint: '6'  },
        ],
      },
      {
        id: 'ccr-simm',
        label: 'SIMM',
        children: [
          { label: 'RISK WEIGHTS',       path: '/configurations/ccr/simm',                 live: false, sprint: '6B' },
        ],
      },
    ],
  },
  {
    id: 'infrastructure',
    label: 'INFRASTRUCTURE',
    roles: ['viewer','trader','admin'],
    children: [
      {
        id: 'infra-items',
        label: null,
        children: [
          { label: 'ORG HIERARCHY',      path: '/configurations/org-hierarchy',             live: true  },
          { label: 'LEGAL ENTITIES',     path: '/configurations/legal-entities',            live: true  },
          { label: 'COUNTERPARTIES',     path: '/configurations/counterparties',            live: true  },
        ],
      },
    ],
  },
  {
    id: 'admin',
    label: 'ADMIN',
    roles: ['admin'],
    children: [
      {
        id: 'admin-items',
        label: null,
        children: [
          { label: 'USERS',              path: '/configurations/users',                     live: true  },
        ],
      },
    ],
  },
]

// ── Snap All button ───────────────────────────────────────────────────────────
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
  const { curves, updateQuote, saveSnapshot } = useMarketDataStore()
  const { grid, updateVol } = useXVAStore()
  if (!['trader','admin'].includes(role)) return null
  const isRunning = snap?.status === 'running'

  const runSnap = async (e) => {
    e.stopPropagation()
    if (isRunning) return

    const STEPS = ['RATE CURVES', 'SWVOL ATM', 'SWVOL OTM', 'CAP/FLOOR']
    setSnap({ status:'running', step:'RATE CURVES', stepIdx:0, total:STEPS.length })

    try {
      const { supabase } = await import('../../lib/supabase.js')
      const { data:{ session:sess } } = await supabase.auth.getSession()
      if (!sess) { setSnap({ status:'error', msg:'Not authenticated' }); return }
      const h = { Authorization:'Bearer '+sess.access_token, 'Content-Type':'application/json' }
      const today = new Date(new Date().getTime() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)
      const errors = []

      // ── Step 1: Rate curves ──────────────────────────────────────────────
      setSnap({ status:'running', step:'RATE CURVES', stepIdx:0, total:STEPS.length })
      for (const curveId of SNAPABLE_IDS) {
        try {
          const tickRes = await fetch('/api/bloomberg/tickers/'+curveId, { headers:h })
          if (!tickRes.ok) continue
          const { tickers={} } = await tickRes.json()
          const tickerList = Object.entries(tickers)
            .filter(([,t]) => t?.includes('BGN Curncy') || t?.includes('Index'))
            .map(([tenor,ticker]) => ({ tenor, ticker }))
          if (!tickerList.length) continue
          const snapRes = await fetch('/api/bloomberg/snap', {
            method:'POST', headers:h,
            body:JSON.stringify({ curve_id:curveId, snap_date:today, tickers:tickerList, mode:'live' }),
          })
          const snapData = await snapRes.json()
          if (!snapRes.ok) { errors.push(curveId); continue }
          const curve = curves.find(c => c.id===curveId)
          if (curve && snapData.quotes?.length) {
            snapData.quotes.forEach(q => {
              const idx = curve.instruments.findIndex(i => i.tenor===q.tenor)
              if (idx!==-1) updateQuote(curveId, idx, String(q.rate))
            })
          }
        } catch(_) { errors.push(curveId) }
        await new Promise(r => setTimeout(r,200))
      }

      // ── Step 2: Swaption ATM ─────────────────────────────────────────────
      setSnap({ status:'running', step:'SWVOL ATM', stepIdx:1, total:STEPS.length })
      const atmVols = {}
      try {
        const atmTickers = grid.flatMap(row =>
          row.cells.map(c => ({ expiry:row.expiry, tenor:c.tenor, ticker:c.ticker }))
        )
        const atmRes = await fetch('/api/bloomberg/snap-swvol', {
          method:'POST', headers:h,
          body:JSON.stringify({ snap_date:today, tickers:atmTickers }),
        })
        const atmData = await atmRes.json()
        if (atmRes.ok) {
          atmData.quotes?.forEach(q => {
            updateVol(q.expiry, q.tenor, q.vol_bp)
            atmVols[`${q.expiry}|${q.tenor}`] = q.vol_bp
          })
          await saveSnapshot(today, 'BLOOMBERG')
        } else {
          errors.push('swvol-atm')
        }
      } catch(_) { errors.push('swvol-atm') }

      // ── Step 3: Swaption OTM + SABR ──────────────────────────────────────
      setSnap({ status:'running', step:'SWVOL OTM', stepIdx:2, total:STEPS.length })
      try {
        const otmTickers = []
        SWAPTION_EXPIRIES.forEach(exp => {
          OTM_SNAP_TENORS.forEach(ten => {
            const atm = atmVols[`${exp}|${ten}`] ||
              grid.find(r => r.expiry===exp)?.cells?.find(c => c.tenor===ten)?.vol_bp
            if (!atm) return
            OTM_STRIKE_OFFSETS.forEach(off => {
              const ticker = otmTicker(off, exp, ten)
              if (ticker) otmTickers.push({ expiry:exp, tenor:ten, offset_bp:off, ticker })
            })
          })
        })
        const otmRes = await fetch('/api/bloomberg/snap-otm-vol', {
          method:'POST', headers:h,
          body:JSON.stringify({ snap_date:today, tickers:otmTickers }),
        })
        const otmData = await otmRes.json()
        if (otmRes.ok && otmData.quotes?.length) {
          const otmByKey = {}
          otmData.quotes.forEach(q => {
            if (!otmByKey[q.expiry]) otmByKey[q.expiry] = {}
            if (!otmByKey[q.expiry][q.tenor]) otmByKey[q.expiry][q.tenor] = {}
            otmByKey[q.expiry][q.tenor][String(q.offset_bp)] = q.abs_vol_bp
          })
          const cells = []
          SWAPTION_EXPIRIES.forEach(exp => {
            OTM_SNAP_TENORS.forEach(ten => {
              const atm = atmVols[`${exp}|${ten}`]
              if (!atm) return
              const offs = otmByKey[exp]?.[ten] || {}
              const toSpread = v => v != null ? v - atm : null
              cells.push({
                expiry_label:exp, tenor_label:ten,
                expiry_y:EXPIRY_YEARS[exp], tenor_y:TENOR_YEARS[ten],
                atm_vol_bp:atm,
                spread_m200:toSpread(offs['-200']), spread_m100:toSpread(offs['-100']),
                spread_m50:toSpread(offs['-50']),   spread_m25:toSpread(offs['-25']),
                spread_p25:toSpread(offs['25']),    spread_p50:toSpread(offs['50']),
                spread_p100:toSpread(offs['100']),  spread_p200:toSpread(offs['200']),
                source:'BLOOMBERG',
              })
            })
          })
          const skewRes = await fetch('/api/market-data/vol-skew', {
            method:'POST', headers:h,
            body:JSON.stringify({ valuation_date:today, cells }),
          })
          if (!skewRes.ok) errors.push('swvol-otm-save')
        }
      } catch(_) { errors.push('swvol-otm') }

      // ── Step 4: Cap/floor surface ─────────────────────────────────────────
      setSnap({ status:'running', step:'CAP/FLOOR', stepIdx:3, total:STEPS.length })
      try {
        const capRes = await fetch('/api/bloomberg/cap-vol/snap', {
          method:'POST', headers:h,
          body:JSON.stringify({ valuation_date:today }),
        })
        if (!capRes.ok) errors.push('cap-floor')
      } catch(_) { errors.push('cap-floor') }

      setSnap({ status:'done', errors, date:today })
      setTimeout(() => setSnap(null), 10000)

    } catch(e) {
      setSnap({ status:'error', msg:e.message })
      setTimeout(() => setSnap(null), 5000)
    }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
      <button
        onClick={runSnap}
        disabled={isRunning}
        style={{
          fontSize:'0.8125rem', fontWeight:700, letterSpacing:'0.08em',
          padding:'2px 6px', borderRadius:'2px',
          cursor: isRunning ? 'default' : 'pointer',
          fontFamily:"'IBM Plex Mono',var(--mono)", background:'transparent',
          border:`1px solid ${isRunning ? 'var(--border)' : 'var(--accent)'}`,
          color: isRunning ? 'var(--text-dim)' : 'var(--accent)',
          opacity: isRunning ? 0.6 : 1,
          whiteSpace:'nowrap',
        }}
      >
        {isRunning ? snap.step : '\u25B6 SNAP'}
      </button>
      {snap && (
        <div style={{
          fontSize:'0.8125rem', fontFamily:"'IBM Plex Mono',var(--mono)", lineHeight:1.4,
          paddingLeft:'1rem', paddingRight:'0.5rem',
          color: snap.status==='done' ? 'var(--accent)'
               : snap.status==='error' ? 'var(--red)'
               : 'var(--blue)',
        }}>
          {snap.status==='running' && `${snap.stepIdx+1}/${snap.total} ${snap.step}`}
          {snap.status==='done' && `\u2713 ${snap.date}${snap.errors?.length ? ' \u00B7 '+snap.errors.length+' errors' : ''}`}
          {snap.status==='error' && `\u2717 ${snap.msg}`}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  nav: {
    width:'220px', minWidth:'220px',
    background:'var(--panel)',
    borderRight:'1px solid var(--border)',
    overflowY:'auto',
    padding:'0.75rem 0',
    scrollbarWidth:'thin',
  },
  sectionWrap: { marginBottom:'0.125rem' },
  sectionBtn: {
    width:'100%', background:'none', border:'none',
    display:'flex', alignItems:'center', justifyContent:'space-between',
    cursor:'pointer',
    fontFamily:"'IBM Plex Mono',var(--mono)",
    fontSize:'0.8125rem', fontWeight:700, letterSpacing:'0.12em',
    padding:'0.45rem 0.75rem 0.45rem 1rem',
    color:'var(--text-dim)',
  },
  sectionBtnAdmin: { color:'var(--amber)' },
  sectionSprint: {
    fontSize:'0.6875rem', letterSpacing:'0.06em',
    color:'var(--text-dim)', opacity:0.4,
    fontWeight:400, marginLeft:'6px',
  },
  groupWrap: { marginBottom:'0.125rem' },
  groupLabel: {
    display:'block',
    fontFamily:"'IBM Plex Mono',var(--mono)",
    fontSize:'0.75rem', fontWeight:600, letterSpacing:'0.10em',
    color:'#2A2A2A',
    padding:'0.3rem 1rem 0.2rem 1.5rem',
  },
  navLink: (isActive, live) => ({
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'0.3rem 0.75rem 0.3rem 2rem',
    fontFamily:"'IBM Plex Mono',var(--mono)",
    fontSize:'0.875rem', letterSpacing:'0.05em',
    color: !live ? '#333' : isActive ? 'var(--accent)' : 'var(--text)',
    textDecoration:'none',
    borderLeft: isActive && live ? '2px solid var(--accent)' : '2px solid transparent',
    background: isActive && live ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
    cursor: live ? 'pointer' : 'default',
    pointerEvents: live ? 'auto' : 'none',
    transition:'all 0.12s',
  }),
  sprintBadge: {
    fontSize:'0.625rem', letterSpacing:'0.06em',
    color:'#1E1E1E', fontWeight:600,
  },
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CfgNav() {
  const { profile } = useAuthStore()
  const role = profile?.role || 'viewer'
  const [collapsed, setCollapsed] = useState({})
  const toggle = id => setCollapsed(s => ({ ...s, [id]: !s[id] }))

  return (
    <nav style={S.nav}>
      {NAV.filter(sec => sec.roles.includes(role)).map(sec => {
        const isOpen = !collapsed[sec.id]
        return (
          <div key={sec.id} style={S.sectionWrap}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 0.75rem 0 0' }}>
              <button
                onClick={() => toggle(sec.id)}
                style={{ ...S.sectionBtn, ...(sec.id==='admin' ? S.sectionBtnAdmin : {}) }}
              >
                <span style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                  {sec.label}
                  {sec.sprint && <span style={S.sectionSprint}>SPRINT {sec.sprint}</span>}
                </span>
                <span style={{ fontSize:'0.5rem', opacity:0.5 }}>{isOpen ? '\u25DB' : '\u25D9'}</span>
              </button>
              {sec.snapAll && isOpen && <SnapAllButton role={role} />}
            </div>
            {isOpen && sec.children.map(group => (
              <div key={group.id} style={S.groupWrap}>
                {group.label && (
                  <span style={S.groupLabel}>{group.label}</span>
                )}
                {group.children.map(item => (
                  <NavLink
                    key={item.path}
                    to={item.live ? item.path : '#'}
                    style={({ isActive }) => S.navLink(isActive && item.live, item.live)}
                    onClick={e => { if (!item.live) e.preventDefault() }}
                  >
                    <span>{item.label}</span>
                    {!item.live && item.sprint && (
                      <span style={S.sprintBadge}>{item.sprint}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            ))}
          </div>
        )
      })}
    </nav>
  )
}
