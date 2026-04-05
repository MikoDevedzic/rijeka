import { useAuthStore } from '../../store/useAuthStore'

export function useAiAccess() {
  const { profile } = useAuthStore()
  const role = profile?.role || 'viewer'
  return {
    hasAccess: role === 'trader' || role === 'admin',
    role,
    isAdmin: role === 'admin',
    isTrader: role === 'trader',
    isViewer: role === 'viewer',
  }
}

export default function AiGate({ children, fallback }) {
  const { hasAccess } = useAiAccess()
  if (hasAccess) return children

  return fallback || (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      height:'100%', gap:'1rem', padding:'3rem', textAlign:'center',
      fontFamily:"'IBM Plex Mono',var(--mono)",
    }}>
      <div style={{
        fontSize:'2.5rem', marginBottom:'0.5rem', opacity:0.6,
      }}>🔥</div>
      <div style={{
        fontSize:'0.8rem', fontWeight:700, letterSpacing:'0.15em', color:'var(--text)',
      }}>PROMETHEUS — TRADER ACCESS REQUIRED</div>
      <div style={{
        fontSize:'1.0625rem', color:'var(--text-dim)', lineHeight:1.7,
        maxWidth:'380px', letterSpacing:'0.04em',
      }}>
        PROMETHEUS derivatives intelligence is available on the Trader plan.
        Contact us to upgrade your account and unlock knowledge for everyone.
      </div>
      <a href="mailto:hello@rijeka.app?subject=Trader Access Request" style={{
        display:'inline-block', marginTop:'0.5rem',
        background:'linear-gradient(135deg, #7a2800, #c45200)', color:'#fff', textDecoration:'none',
        fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'1.0625rem', fontWeight:700,
        letterSpacing:'0.1em', padding:'0.6rem 1.5rem', borderRadius:2,
        transition:'opacity 0.15s',
      }}
      onMouseEnter={e=>e.target.style.opacity='0.85'}
      onMouseLeave={e=>e.target.style.opacity='1'}
      >
        REQUEST ACCESS → hello@rijeka.app
      </a>
      <div style={{ fontSize:'0.6rem', color:'var(--text-dim)', letterSpacing:'0.08em', marginTop:'0.25rem' }}>
        Current plan: VIEWER
      </div>
    </div>
  )
}
