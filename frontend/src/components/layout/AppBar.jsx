import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'

const MODULES = [
  { label: 'HOME',           path: '/command-center', exact: true  },
  { label: 'BLOTTER',        path: '/blotter',        exact: false },
  { label: 'PRICER',         path: '/pricer',         exact: false },
  { label: 'CONFIGURATIONS', path: '/configurations', exact: false },
]

export default function AppBar() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const user      = useAuthStore(s => s.user)
  const signOut   = useAuthStore(s => s.signOut)

  const displayName = user?.email?.split('@')[0]?.toUpperCase()
    || user?.user_metadata?.full_name?.toUpperCase()
    || 'TRADER'

  const isActive = (mod) =>
    mod.exact ? location.pathname === mod.path : location.pathname.startsWith(mod.path)

  return (
    <header style={{
      display:'flex', alignItems:'center', padding:'0 1.5rem',
      height:'44px', background:'var(--bg-deep)',
      borderBottom:'1px solid var(--border)',
      flexShrink:0, gap:'1.5rem', zIndex:10,
    }}>
      <div onClick={()=>navigate('/command-center')} style={{
        fontFamily:'var(--mono)', fontSize:'0.85rem', fontWeight:900,
        letterSpacing:'0.2em', color:'var(--accent)', cursor:'pointer', flexShrink:0,
      }}>RIJEKA</div>

      <div style={{width:'1px',height:'20px',background:'var(--border)',flexShrink:0}}/>

      <nav style={{display:'flex',alignItems:'stretch',height:'100%'}}>
        {MODULES.map(mod=>(
          <button key={mod.path} onClick={()=>navigate(mod.path)} style={{
            background:'none', border:'none',
            borderBottom: isActive(mod)?'2px solid var(--accent)':'2px solid transparent',
            color: isActive(mod)?'var(--accent)':'var(--text-dim)',
            fontFamily:'var(--mono)', fontSize:'0.62rem', fontWeight:700,
            letterSpacing:'0.1em', padding:'0 0.85rem', cursor:'pointer',
            transition:'all 0.12s', height:'100%',
            display:'flex', alignItems:'center',
          }}>{mod.label}</button>
        ))}
      </nav>

      <div style={{flex:1}}/>

      <div style={{display:'flex',alignItems:'center',gap:'0.75rem',fontFamily:'var(--mono)',fontSize:'0.65rem',letterSpacing:'0.08em',flexShrink:0}}>
        <span style={{color:'var(--amber)',fontWeight:700}}>READ ONLY</span>
        <span style={{color:'var(--border)'}}>·</span>
        <span style={{color:'var(--accent)',fontWeight:700}}>{displayName}</span>
        <button onClick={signOut} style={{
          background:'transparent', border:'1px solid var(--border)',
          color:'var(--text-dim)', fontFamily:'var(--mono)', fontSize:'0.62rem',
          fontWeight:700, letterSpacing:'0.1em', padding:'0.25rem 0.65rem',
          cursor:'pointer', borderRadius:'2px', transition:'all 0.15s',
        }}>EXIT</button>
      </div>
    </header>
  )
}
