import { useEffect } from 'react'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { GUEST_HOME, guestMayOpen } from '../../lib/guest'

export default function AuthGuard() {
  const { session, loading } = useAuthStore()
  const navigate  = useNavigate()
  const location  = useLocation()

  // a guest (lib/guest.js) has three places: its own page, the methodology and the roadmap; any other is an account's
  const guestAstray = !!session?.is_guest && !guestMayOpen(location.pathname)

  useEffect(() => {
    if (!loading && !session) {
      navigate('/login', { state: { from: location.pathname }, replace: true })
    } else if (!loading && guestAstray) {
      navigate(GUEST_HOME, { replace: true })
    }
  }, [session, loading, navigate, location, guestAstray])

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg)',
        fontFamily: 'var(--mono)', color: 'var(--accent)', fontSize: '13px',
        letterSpacing: '0.1em'
      }}>
        INITIALISING...
      </div>
    )
  }

  if (!session || guestAstray) return null

  return <Outlet />
}
