import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import AuthScene from './AuthScene'

export default function ConfirmPage() {
  const { session, profile, loading, fetchProfile, clearNewSignup } = useAuthStore()
  const navigate  = useNavigate()
  const didFetch  = useRef(false)

  const [displayHandle, setDisplayHandle] = useState('')
  const [handleDone, setHandleDone]       = useState(false)
  const [showBtn, setShowBtn]             = useState(false)
  const [lit, setLit]                     = useState(false)

  useEffect(() => {
    if (!didFetch.current && session && !profile) {
      didFetch.current = true
      fetchProfile(session.user.id)
    }
  }, [session, profile, fetchProfile])

  // Typewriter for the handle, then the glow, then the button
  useEffect(() => {
    if (!profile) return
    const target = profile.trader_id
    let i = 0
    const iv = setInterval(() => {
      i++
      setDisplayHandle(target.slice(0, i))
      if (i >= target.length) {
        clearInterval(iv)
        setHandleDone(true)
        setTimeout(() => setLit(true), 200)
        setTimeout(() => setShowBtn(true), 800)
      }
    }, 55)
    return () => clearInterval(iv)
  }, [profile])

  useEffect(() => {
    if (!loading && !session) navigate('/login', { replace: true })
  }, [loading, session, navigate])

  const handleEnter = () => { clearNewSignup(); navigate('/command-center', { replace: true }) }

  return (
    <AuthScene eyebrow="IDENTITY CONFIRMED">
      <h2 className="au-title">Welcome to the river.</h2>
      <p className="au-lead">Your desk is provisioned: an entity of your own, a demo counterparty, and today's public market data.</p>
      <div className={`au-reveal${lit ? ' lit' : ''}`}>
        <span>YOUR TRADER HANDLE</span>
        <b>{displayHandle}{!handleDone && <i className="caret">_</i>}</b>
        <small>PERMANENT · YOURS</small>
      </div>
      {loading || !profile
        ? <p className="au-alt">Loading your profile…</p>
        : showBtn && <button onClick={handleEnter} className="au-btn idle">ENTER THE DESK →</button>}
    </AuthScene>
  )
}
