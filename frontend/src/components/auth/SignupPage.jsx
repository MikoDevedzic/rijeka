import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore, previewTraderId } from '../../store/useAuthStore'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789∂∇∫±√∞αβγδ'

export default function SignupPage() {
  const { signUp } = useAuthStore()
  const canvasRef  = useRef(null)

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [done,     setDone]     = useState(false)
  const [displayHandle, setDisplayHandle] = useState('')
  const [btnState, setBtnState] = useState('idle')

  const traderId = previewTraderId(email)

  // Typewriter effect for handle preview
  useEffect(() => {
    if (!traderId) { setDisplayHandle(''); return }
    let i = 0
    setDisplayHandle('')
    const iv = setInterval(() => {
      i++
      setDisplayHandle(traderId.slice(0, i))
      if (i >= traderId.length) clearInterval(iv)
    }, 40)
    return () => clearInterval(iv)
  }, [email])

  // Rain background
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let w = canvas.width = window.innerWidth
    let h = canvas.height = window.innerHeight
    const onResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight }
    window.addEventListener('resize', onResize)
    const fs = 12
    const cols = Math.floor(w / fs)
    const drops = Array.from({ length: cols }, () => Math.random() * -80)
    const interval = setInterval(() => {
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
    return () => { clearInterval(interval); window.removeEventListener('resize', onResize) }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return }
    setBtnState('loading')
    setLoading(true)
    const { error: err } = await signUp(email, password)
    setLoading(false)
    if (err) { setBtnState('idle'); setError(err.message); return }
    setBtnState('success')
    setTimeout(() => setDone(true), 400)
  }

  if (done) {
    return (
      <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#03060a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"JetBrains Mono",monospace' }}>
        <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 0 }} />
        <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'radial-gradient(ellipse at center, rgba(3,6,10,0.6) 0%, rgba(3,6,10,0.92) 70%)' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: '400px', width: '100%', padding: '0 1.5rem' }}>
          <div style={{ background: 'rgba(11,18,25,0.92)', border: '1px solid rgba(14,201,160,0.2)', padding: '2.5rem 2rem', backdropFilter: 'blur(20px)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', animation: 'cardin 0.4s ease forwards' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '0.28em', color: '#0ec9a0', textShadow: '0 0 30px rgba(14,201,160,0.4)' }}>RIJEKA</div>
            <div style={{ fontSize: '2rem', color: '#0ec9a0', animation: 'pulse 1s ease' }}>✦</div>
            <div style={{ fontSize: '12px', color: '#c8d4dc', textAlign: 'center', lineHeight: 1.7 }}>
              Check your email<br/>
              <span style={{ color: '#0ec9a0' }}>{email}</span>
            </div>
            {traderId && (
              <div style={{ background: 'rgba(3,6,10,0.8)', border: '1px solid rgba(14,201,160,0.3)', borderLeft: '3px solid #0ec9a0', padding: '0.75rem 1rem', width: '100%', boxSizing: 'border-box', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '9px', letterSpacing: '0.12em', color: 'rgba(90,112,128,0.7)' }}>YOUR HANDLE</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#0ec9a0', letterSpacing: '0.06em', textShadow: '0 0 20px rgba(14,201,160,0.5)' }}>{traderId}</span>
              </div>
            )}
            <Link to="/login" style={{ fontSize: '10px', color: '#0ec9a0', textDecoration: 'none', opacity: 0.6, marginTop: '0.5rem' }}>← Back to login</Link>
          </div>
        </div>
        <style>{`@keyframes cardin{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.3)}}`}</style>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#03060a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'radial-gradient(ellipse at center, rgba(3,6,10,0.6) 0%, rgba(3,6,10,0.92) 70%)' }} />

      <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: '400px', padding: '0 1.5rem' }}>
        <div style={{
          background: 'rgba(11,18,25,0.92)', border: '1px solid rgba(14,201,160,0.2)',
          padding: '2.5rem 2rem', backdropFilter: 'blur(20px)',
          boxShadow: '0 0 60px rgba(14,201,160,0.05), 0 20px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          animation: 'cardin 0.4s ease forwards', fontFamily: '"JetBrains Mono",monospace'
        }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '0.28em', color: '#0ec9a0', marginBottom: '0.25rem', textShadow: '0 0 30px rgba(14,201,160,0.4)' }}>RIJEKA</div>
          <div style={{ fontSize: '9px', letterSpacing: '0.18em', color: 'rgba(14,201,160,0.35)', textTransform: 'uppercase', marginBottom: '2rem' }}>Open-source derivatives risk</div>

          <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.9rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={{ fontSize: '9px', letterSpacing: '0.14em', color: 'rgba(90,112,128,0.8)', textTransform: 'uppercase' }}>EMAIL</span>
              <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
            </div>

            {/* Live handle preview with typewriter */}
            {email.includes('@') && (
              <div style={{
                background: 'rgba(3,6,10,0.9)', border: '1px solid rgba(14,201,160,0.4)',
                borderLeft: '3px solid #0ec9a0', padding: '0.6rem 0.75rem',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                animation: 'slidein 0.2s ease forwards'
              }}>
                <span style={{ fontSize: '9px', letterSpacing: '0.12em', color: 'rgba(90,112,128,0.6)' }}>YOUR HANDLE</span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#0ec9a0', letterSpacing: '0.06em', textShadow: '0 0 15px rgba(14,201,160,0.6)' }}>
                  {displayHandle}
                  {displayHandle.length < traderId.length && <span style={{ animation: 'blink 0.5s infinite' }}>_</span>}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={{ fontSize: '9px', letterSpacing: '0.14em', color: 'rgba(90,112,128,0.8)', textTransform: 'uppercase' }}>PASSWORD</span>
              <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" required />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={{ fontSize: '9px', letterSpacing: '0.14em', color: 'rgba(90,112,128,0.8)', textTransform: 'uppercase' }}>CONFIRM PASSWORD</span>
              <input style={inputStyle} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat password" required />
            </div>

            {error && <div style={{ fontSize: '10px', color: '#d95040', border: '1px solid rgba(217,80,64,0.3)', padding: '0.5rem 0.75rem', background: 'rgba(217,80,64,0.06)', animation: 'shakein 0.3s ease' }}>{error}</div>}

            <button type="submit" disabled={btnState !== 'idle'} style={{
              background: btnState === 'success' ? 'rgba(29,200,122,0.15)' : '#0ec9a0',
              color: btnState === 'success' ? '#1dc87a' : '#03060a',
              border: btnState === 'success' ? '1px solid #1dc87a' : 'none',
              fontFamily: '"JetBrains Mono",monospace', fontSize: '10px', fontWeight: 700,
              letterSpacing: '0.18em', padding: '0.8rem 1rem',
              cursor: btnState === 'idle' ? 'pointer' : 'not-allowed',
              width: '100%', marginTop: '0.25rem', transition: 'all 0.3s',
              opacity: btnState === 'loading' ? 0.7 : 1
            }}>
              {btnState === 'idle' ? 'REQUEST ACCESS' : btnState === 'loading' ? 'CREATING ACCOUNT...' : 'CONFIRMED ✓'}
            </button>
          </form>

          <p style={{ fontSize: '10px', color: 'rgba(90,112,128,0.7)', textAlign: 'center', margin: 0 }}>
            Already have an account? <Link to="/login" style={{ color: '#0ec9a0', textDecoration: 'none' }}>Sign in</Link>
          </p>
          <p style={{ fontSize: '10px', color: 'rgba(90,112,128,0.35)', textAlign: 'center', margin: '0.4rem 0 0' }}>
            <a href="mailto:miko@rijeka.app" style={{ color: 'inherit', textDecoration: 'none' }}>miko@rijeka.app</a>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes cardin{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shakein{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
        @keyframes slidein{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        input:-webkit-autofill{-webkit-box-shadow:0 0 0 100px #060a0e inset !important;-webkit-text-fill-color:#7da8c0 !important;}
      `}</style>
    </div>
  )
}

const inputStyle = {
  background: 'rgba(3,6,10,0.8)', border: '1px solid rgba(25,36,51,0.8)',
  color: '#7da8c0', fontFamily: '"JetBrains Mono",monospace', fontSize: '12px',
  padding: '0.65rem 0.75rem', outline: 'none', width: '100%', boxSizing: 'border-box',
  transition: 'border-color 0.15s',
}
