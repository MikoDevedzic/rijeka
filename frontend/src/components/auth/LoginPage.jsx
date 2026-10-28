import '../docs/Docs.css'
import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789∂∇∫±√∞αβγδ'

export default function LoginPage() {
  const { signIn } = useAuthStore()
  const navigate   = useNavigate()
  const canvasRef  = useRef(null)

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [btnState, setBtnState] = useState('idle') // idle | loading | success

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
        ctx.fillStyle = `rgba(14,201,160,${0.08 + Math.random() * 0.12})`
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
    setLoading(true)
    setBtnState('loading')
    const { error: err } = await signIn(email, password)
    setLoading(false)
    if (err) {
      setBtnState('idle')
      if (err.message.includes('Invalid login')) setError('Invalid email or password.')
      else if (err.message.includes('Email not confirmed')) setError('Please confirm your email first.')
      else setError(err.message)
      return
    }
    setBtnState('success')
    setTimeout(() => navigate('/command-center', { replace: true }), 600)
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#03060a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 0 }} />
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'radial-gradient(ellipse at center, rgba(3,6,10,0.6) 0%, rgba(3,6,10,0.92) 70%)' }} />

      <div style={{
        position: 'relative', zIndex: 2, width: '100%', maxWidth: '400px', padding: '0 1.5rem'
      }}>
        {/* Card */}
        <div style={{
          background: 'rgba(11,18,25,0.92)',
          border: '1px solid rgba(14,201,160,0.2)',
          padding: '2.5rem 2rem',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 0 60px rgba(14,201,160,0.05), 0 20px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          animation: 'cardin 0.4s ease forwards'
        }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '0.28em', color: '#0ec9a0', marginBottom: '0.25rem', fontFamily: '"JetBrains Mono",monospace', textShadow: '0 0 30px rgba(14,201,160,0.4)' }}>
            RIJEKA
          </div>
          <div style={{ fontSize: '9px', letterSpacing: '0.18em', color: 'rgba(14,201,160,0.35)', textTransform: 'uppercase', marginBottom: '2rem', fontFamily: '"JetBrains Mono",monospace' }}>
            Open-source derivatives risk
          </div>

          <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.9rem', marginBottom: '1.25rem' }}>
            <Field label="EMAIL">
              <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
            </Field>
            <Field label="PASSWORD">
              <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required />
            </Field>

            {error && (
              <div style={{ fontSize: '10px', color: '#d95040', border: '1px solid rgba(217,80,64,0.3)', padding: '0.5rem 0.75rem', background: 'rgba(217,80,64,0.06)', fontFamily: '"JetBrains Mono",monospace', animation: 'shakein 0.3s ease' }}>
                {error}
              </div>
            )}

            <SubmitBtn state={btnState} labels={{ idle: 'ENTER SYSTEM', loading: 'AUTHENTICATING...', success: 'ACCESS GRANTED ✓' }} />
          </form>
          <p className="auth-consent"><a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> · <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy</a> · Hosted demo on the Sepolia testnet · not investment advice</p>

          <p style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '10px', color: 'rgba(90,112,128,0.7)', textAlign: 'center', margin: 0 }}>
            No account? <Link to="/signup" style={{ color: '#0ec9a0', textDecoration: 'none' }}>Create a demo account</Link>
          </p>
          <p style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '10px', color: 'rgba(90,112,128,0.35)', textAlign: 'center', margin: '0.4rem 0 0' }}>
            <a href="mailto:miko@rijeka.app" style={{ color: 'inherit', textDecoration: 'none' }}>miko@rijeka.app</a>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes cardin { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        @keyframes shakein { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
        @keyframes sweep { from{width:0;opacity:0} 30%{opacity:1} to{width:100%;opacity:0} }
        input:-webkit-autofill { -webkit-box-shadow:0 0 0 100px #060a0e inset !important; -webkit-text-fill-color:#7da8c0 !important; }
      `}</style>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <span style={{ fontSize: '9px', letterSpacing: '0.14em', color: 'rgba(90,112,128,0.8)', fontFamily: '"JetBrains Mono",monospace', textTransform: 'uppercase' }}>{label}</span>
      {children}
    </div>
  )
}

function SubmitBtn({ state, labels }) {
  const colors = { idle: '#0ec9a0', loading: '#0ec9a0', success: '#1dc87a' }
  return (
    <button type="submit" disabled={state !== 'idle'} style={{
      background: state === 'success' ? 'rgba(29,200,122,0.15)' : '#0ec9a0',
      color: state === 'success' ? '#1dc87a' : '#03060a',
      border: state === 'success' ? '1px solid #1dc87a' : 'none',
      fontFamily: '"JetBrains Mono",monospace', fontSize: '10px', fontWeight: 700,
      letterSpacing: '0.18em', padding: '0.8rem 1rem', cursor: state === 'idle' ? 'pointer' : 'not-allowed',
      width: '100%', marginTop: '0.25rem', transition: 'all 0.3s',
      opacity: state === 'loading' ? 0.7 : 1,
      position: 'relative', overflow: 'hidden'
    }}>
      {labels[state]}
    </button>
  )
}

const inputStyle = {
  background: 'rgba(3,6,10,0.8)', border: '1px solid rgba(25,36,51,0.8)',
  color: '#7da8c0', fontFamily: '"JetBrains Mono",monospace', fontSize: '12px',
  padding: '0.65rem 0.75rem', outline: 'none', width: '100%', boxSizing: 'border-box',
  transition: 'border-color 0.15s',
}
