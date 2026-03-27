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
      fontFamily:'var(--mono)',
    }}>
      <div style={{
        fontSize:'2rem', marginBottom:'0.5rem', opacity:0.4,
      }}>⚔</div>
      <div style={{
        fontSize:'0.8rem', fontWeight:700, letterSpacing:'0.15em', color:'var(--text)',
      }}>KRATOS — TRADER ACCESS REQUIRED</div>
      <div style={{
        fontSize:'0.68rem', color:'var(--text-dim)', lineHeight:1.7,
        maxWidth:'380px', letterSpacing:'0.04em',
      }}>
        KRATOS derivatives intelligence is available on the Trader plan.
        Contact us to upgrade your account and unlock battle-tested analysis.
      </div>
      <a href="mailto:hello@rijeka.app?subject=Trader Access Request" style={{
        display:'inline-block', marginTop:'0.5rem',
        background:'var(--purple)', color:'#fff', textDecoration:'none',
        fontFamily:'var(--mono)', fontSize:'0.68rem', fontWeight:700,
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
