import { useEffect } from 'react'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'

export default function AuthGuard() {
  const { session, loading } = useAuthStore()
  const navigate  = useNavigate()
  const location  = useLocation()

  useEffect(() => {
    if (!loading && !session) {
      navigate('/login', { state: { from: location.pathname }, replace: true })
    }
  }, [session, loading, navigate, location])

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg)',
        fontFamily:"'IBM Plex Mono',var(--mono)", color: 'var(--accent)', fontSize: '13px',
        letterSpacing: '0.1em'
      }}>
        INITIALISING...
      </div>
    )
  }

  if (!session) return null

  return <Outlet />
}
