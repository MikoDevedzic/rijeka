import { useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import './CommandCenter.css'

const NAV = [
  { label: 'HOME',           path: '/command-center' },
  { label: 'BLOTTER',        path: '/blotter' },
  { label: 'PRICER',         path: '/pricer' },
  { label: 'CONFIGURATIONS', path: '/configurations/market-data/curves' },
]

const TILES = [
  { id:'blotter',       label:'BLOTTER',            sub:'Trade Entry · Lifecycle · Positions',    sprint:'LIVE',     live:true,  path:'/blotter',                           color:'var(--accent)' },
  { id:'pricer',        label:'PRICER',              sub:'IRS · CDS · FX · Swaption · XVA',       sprint:'LIVE',     live:true,  path:'/pricer',                            color:'var(--accent)' },
  { id:'market-risk',   label:'MARKET RISK',         sub:'VaR · Stress · Greeks · FRTB ES',       sprint:'SPRINT 5', live:false, color:'var(--text-dim)' },
  { id:'pnl',           label:'PNL',                 sub:'Attribution · Desk · Trader · IPV',     sprint:'SPRINT 5', live:false, color:'var(--text-dim)' },
  { id:'credit',        label:'COUNTERPARTY CREDIT', sub:'CVA · Exposure · Limits · IM',          sprint:'SPRINT 5', live:false, color:'var(--text-dim)' },
  { id:'collateral',    label:'COLLATERAL',          sub:'Margin Calls · CSA · Disputes',         sprint:'SPRINT 5', live:false, color:'var(--text-dim)' },
  { id:'confirmations', label:'⬡ CONFIRMATIONS',    sub:'Cashflow Hash · On-Chain · EMIR',        sprint:'SPRINT 6', live:false, color:'var(--chain)' },
  { id:'configurations',label:'CONFIGURATIONS',      sub:'Curves · Entities · Counterparties',    sprint:'LIVE',     live:true,  path:'/configurations/market-data/curves', color:'var(--blue)' },
  { id:'methodology',   label:'METHODOLOGY',         sub:'Model Docs · Validation · Governance',  sprint:'SPRINT 6', live:false, color:'var(--text-dim)' },
  { id:'news',          label:'NEWS',                sub:'Market · Macro · Regulatory',           sprint:'SPRINT 3', live:false, color:'var(--text-dim)' },
  { id:'chat',          label:'CHAT',                sub:'Desk · Counterparty · AI Assist',       sprint:'SPRINT 3', live:false, color:'var(--text-dim)' },
]

export default function CommandCenter() {
  const canvasRef = useRef(null)
  const navigate  = useNavigate()
  const location  = useLocation()
  const session   = useAuthStore(s => s.session)
  const profile   = useAuthStore(s => s.profile)

  const displayName = profile?.handle
    || session?.user?.user_metadata?.handle
    || session?.user?.email?.split('@')[0]?.toUpperCase()
    || 'TRADER'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
    const cols  = Math.floor(canvas.width / 20)
    const drops = Array(cols).fill(1)
    const chars = 'アイウエオカキクケコΣΔΨΩ∇∂∫∑IR01SOFRNPVCVA0123456789ABCDEF'

    const draw = () => {
      ctx.fillStyle = 'rgba(7,11,15,0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#0dd4a818'
      ctx.font = '14px JetBrains Mono, monospace'
      drops.forEach((y, i) => {
        ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * 20, y * 20)
        if (y * 20 > canvas.height && Math.random() > 0.975) drops[i] = 0
        drops[i]++
      })
    }

    const id     = setInterval(draw, 50)
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    window.addEventListener('resize', resize)
    return () => { clearInterval(id); window.removeEventListener('resize', resize) }
  }, [])

  return (
    <div className="cc-root">
      <canvas ref={canvasRef} className="cc-canvas" />

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
              className={`cc-tile ${tile.live ? 'cc-tile-live' : 'cc-tile-locked'}`}
              style={{ '--tile-color': tile.color }}
              onClick={() => tile.live && tile.path && navigate(tile.path)}
            >
              <div className="cc-tile-label">{tile.label}</div>
              <div className="cc-tile-sub">{tile.sub}</div>
              <div className={`cc-tile-sprint ${tile.live ? 'cc-sprint-live' : ''}`}>
                {tile.sprint}
              </div>
            </div>
          ))}
          <div className="cc-tile cc-tile-empty" />
        </div>

        <div className="cc-footer">EARLY ACCESS · READ ONLY · hello@rijeka.app</div>
      </div>
    </div>
  )
}
