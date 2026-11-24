import { useNavigate, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from '../../store/useAuthStore'
import { useModulesStore } from '../../store/useModulesStore'
import RoleSwitch from './RoleSwitch'
import { useVisibleNav } from './useVisibleNav'
import { openAppWindow } from '../../lib/windows'
import './AppBar.css'
import '../guest/Guest.css'
import { Keycap } from '../common/Shortcuts'
import { shortcutForPath } from '../../lib/shortcuts'
import RijekaLogo from '../brand/RijekaLogo'

export default function AppBar() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const user      = useAuthStore(s => s.session?.user)
  const signOut   = useAuthStore(s => s.signOut)
  const demo      = useAuthStore(s => s.demo)
  const guest     = !!user?.is_guest                 // a visitor with no account (lib/guest.js): its own nav, and the way to an account
  const loadModules = useModulesStore(s => s.load)
  useEffect(() => { if (user) loadModules() }, [user, loadModules])
  const shown = useVisibleNav()          // the items this firm's modules leave, each with the page it opens (`to`)

  const displayName = user?.email?.split('@')[0]?.toUpperCase()
    || user?.user_metadata?.full_name?.toUpperCase()
    || 'TRADER'

  const isActive = (mod) =>
    mod.exact ? location.pathname === mod.path : location.pathname.startsWith(mod.path)

  return (
    <header className="ab-bar" style={{
      display:'flex', alignItems:'center', padding:'0 1.5rem',
      height:'var(--appbar-h)', background:'var(--bg-deep)',
      borderBottom:'1px solid var(--border)',
      flexShrink:0, gap:'1.5rem', zIndex:10,
    }}>
      <RijekaLogo onClick={()=>navigate(guest ? '/guest' : '/command-center')} />

      <div className="ab-desk" style={{width:'1px',height:'20px',background:'var(--border)',flexShrink:0}}/>

      <nav className="ab-desk" style={{display:'flex',alignItems:'stretch',height:'100%'}}>
        {shown.map(mod=>{
          // The active tab pops out exactly the page you're on; others open at their start.
          const target = isActive(mod) ? location.pathname + location.search : mod.to
          const popOut = () => openAppWindow(target, 'rijeka' + mod.path.replace(/\//g, '-'))
          return (
          <span key={mod.path} className="ab-nav">
          <button onClick={e => (e.metaKey || e.ctrlKey || e.shiftKey) ? popOut() : navigate(mod.to)}
                  aria-keyshortcuts={shortcutForPath(mod.path)?.key}
                  title={mod.label + (shortcutForPath(mod.path) ? ` (${shortcutForPath(mod.path).key})` : '') + ' — ⌘/Ctrl-click to open in its own window'} className={`ab-link${isActive(mod) ? ' is-on' : ''}`} aria-current={isActive(mod) ? 'page' : undefined}>{mod.label}{shortcutForPath(mod.path) && <Keycap id={shortcutForPath(mod.path).id} />}</button>
          <button className="ab-pop" onClick={popOut} title={'Open ' + mod.label + ' in its own window'}>⧉</button>
          </span>
        )})}
      </nav>

      <div style={{flex:1}}/>

      <div className="ab-right" style={{display:'flex',alignItems:'center',gap:'0.75rem',fontFamily:'var(--sans)',fontSize:'0.875rem',letterSpacing:'0.06em',flexShrink:0}}>
        {demo?.enabled && (
          <span title="Hosted demo on the Sepolia testnet. Your workspace was set up automatically: an own entity, RIJEKA DEMO BANK AG as counterparty (Rijeka holds its key, so solo confirmations are marked not bilateral) and a copy of the demo market data. Data may be reset."
                style={{color:'var(--amber)',border:'1px solid var(--amber-dim)',fontWeight:500,padding:'0.15rem 0.5rem',borderRadius:'var(--r-1)',cursor:'help'}}>DEMO · SEPOLIA</span>
        )}
        {demo?.enabled && <span style={{color:'var(--border)'}}>·</span>}
        {guest ? <>
          <span className="gst-tag" title="You are looking around with no account: you can price a trade, run its XVA and read. Booking, confirming on chain and the Excel need an account, which is free.">GUEST</span>
          <button className="gst-bar-go" data-action="guest-bar-signup" onClick={() => navigate('/signup')}>CREATE ACCOUNT</button>
          <button className="gst-bar-quiet" onClick={() => navigate('/login')}>SIGN IN</button>
        </> : <>
        <RoleSwitch />
        <span style={{color:'var(--border)'}}>·</span>
        <span style={{color:'var(--text-hi)',fontWeight:500}}>{displayName}</span>
        <button className="rj-btn" onClick={signOut} style={{
          background:'transparent', border:'1px solid var(--border)',
          color:'var(--text-dim)', fontFamily:'var(--sans)', fontSize:'0.8125rem',
          fontWeight:500, letterSpacing:'0.08em', padding:'0.3rem 0.7rem',
          cursor:'pointer', borderRadius:'var(--r-2)', transition:'all 0.15s',
        }}>EXIT</button>
        </>}
      </div>
    </header>
  )
}
