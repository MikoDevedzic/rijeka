import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789∂∇∫±√∞αβγδ'

export default function ConfirmPage() {
  const { session, profile, loading, fetchProfile, clearNewSignup } = useAuthStore()
  const navigate  = useNavigate()
  const didFetch  = useRef(false)
  const canvasRef = useRef(null)

  const [displayHandle, setDisplayHandle] = useState('')
  const [handleDone, setHandleDone]       = useState(false)
  const [showBtn, setShowBtn]             = useState(false)
  const [pulse, setPulse]                 = useState(false)

  useEffect(() => {
    if (!didFetch.current && session && !profile) {
      didFetch.current = true
      fetchProfile(session.user.id)
    }
  }, [session, profile, fetchProfile])

  // Typewriter for handle, then pulse, then button
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
        setTimeout(() => setPulse(true), 200)
        setTimeout(() => setShowBtn(true), 800)
      }
    }, 55)
    return () => clearInterval(iv)
  }, [profile])

  // Rain
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let w = canvas.width = window.innerWidth
    let h = canvas.height = window.innerHeight
    const onResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight }
    window.addEventListener('resize', onResize)
    const fs = 12, cols = Math.floor(w / fs)
    const drops = Array.from({ length: cols }, () => Math.random() * -80)
    const iv = setInterval(() => {
      ctx.fillStyle = 'rgba(3,6,10,0.15)'
      ctx.fillRect(0, 0, w, h)
      drops.forEach((y, i) => {
        if (y < 0) { drops[i] += 0.4; return }
        ctx.fillStyle = `rgba(14,201,160,${0.07 + Math.random() * 0.1})`
        ctx.font = `${fs}px "JetBrains Mono",monospace`
        ctx.fillText(CHARS[Math.floor(Math.random() * CHARS.length)], i * fs, y * fs)
        drops[i] += 0.5
        if (drops[i] * fs > h && Math.random() > 0.975) drops[i] = -Math.random() * 30
      })
    }, 50)
    return () => { clearInterval(iv); window.removeEventListener('resize', onResize) }
  }, [])

  if (!loading && !session) { navigate('/login', { replace: true }); return null }

  const handleEnter = () => { clearNewSignup(); navigate('/command-center', { replace: true }) }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#03060a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"JetBrains Mono",monospace' }}>
      <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'radial-gradient(ellipse at center, rgba(3,6,10,0.5) 0%, rgba(3,6,10,0.92) 70%)' }} />

      <div style={{ position: 'relative', zIndex: 2, maxWidth: '480px', width: '100%', padding: '0 1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0' }}>

        <div style={{ fontSize: '11px', letterSpacing: '0.2em', color: 'rgba(14,201,160,0.4)', textTransform: 'uppercase', marginBottom: '2rem', animation: 'fadein 0.6s ease forwards' }}>
          Identity confirmed
        </div>

        <div style={{ fontSize: '13px', color: '#7da8c0', fontStyle: 'italic', marginBottom: '2.5rem', opacity: 0.8, animation: 'fadein 0.8s ease forwards' }}>
          Welcome to the river.
        </div>

        {/* The big handle reveal */}
        <div style={{
          background: 'rgba(6,10,14,0.95)',
          border: `1px solid ${pulse ? 'rgba(14,201,160,0.6)' : 'rgba(14,201,160,0.2)'}`,
          padding: '2rem 3rem',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
          width: '100%', boxSizing: 'border-box',
          boxShadow: pulse ? '0 0 40px rgba(14,201,160,0.2), 0 0 80px rgba(14,201,160,0.08)' : 'none',
          transition: 'box-shadow 0.6s, border-color 0.6s',
          marginBottom: '2rem', backdropFilter: 'blur(20px)',
          animation: 'cardin 0.5s ease forwards'
        }}>
          <span style={{ fontSize: '9px', letterSpacing: '0.2em', color: 'rgba(90,112,128,0.6)', textTransform: 'uppercase' }}>YOUR TRADER HANDLE</span>
          <span style={{
            fontSize: 'clamp(1.6rem, 5vw, 2.4rem)', fontWeight: 700, color: '#0ec9a0',
            letterSpacing: '0.1em', minHeight: '1.3em', textAlign: 'center',
            textShadow: pulse ? '0 0 30px rgba(14,201,160,0.7), 0 0 60px rgba(14,201,160,0.3)' : '0 0 10px rgba(14,201,160,0.2)',
            transition: 'text-shadow 0.6s'
          }}>
            {displayHandle}
            {!handleDone && <span style={{ animation: 'blink 0.5s infinite' }}>_</span>}
          </span>
          <span style={{ fontSize: '9px', color: 'rgba(90,112,128,0.4)', letterSpacing: '0.1em' }}>PERMANENT · IMMUTABLE · YOURS</span>
        </div>

        {loading || !profile ? (
          <span style={{ fontSize: '10px', color: 'rgba(14,201,160,0.4)', letterSpacing: '0.1em' }}>LOADING PROFILE...</span>
        ) : (
          <>
            {showBtn && (
              <button onClick={handleEnter} style={{
                background: '#0ec9a0', color: '#03060a', border: 'none',
                fontFamily: '"JetBrains Mono",monospace', fontSize: '11px', fontWeight: 700,
                letterSpacing: '0.2em', padding: '0.9rem 2.5rem', cursor: 'pointer',
                transition: 'all 0.2s', animation: 'fadein 0.4s ease forwards',
                boxShadow: '0 0 20px rgba(14,201,160,0.3)'
              }}
              onMouseEnter={e => { e.target.style.boxShadow='0 0 40px rgba(14,201,160,0.5)'; e.target.style.transform='scale(1.02)' }}
              onMouseLeave={e => { e.target.style.boxShadow='0 0 20px rgba(14,201,160,0.3)'; e.target.style.transform='scale(1)' }}>
                ENTER THE SYSTEM →
              </button>
            )}
            <p style={{ fontSize: '9px', color: 'rgba(90,112,128,0.3)', marginTop: '1.5rem', textAlign: 'center', letterSpacing: '0.08em' }}>
              Early access · read-only · <a href="mailto:miko@rijeka.app" style={{ color: 'inherit' }}>miko@rijeka.app</a>
            </p>
          </>
        )}
      </div>

      <style>{`
        @keyframes cardin{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadein{from{opacity:0}to{opacity:1}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
      `}</style>
    </div>
  )
}
