import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore, previewTraderId } from '../../store/useAuthStore'
import { supabase } from '../../lib/supabase'
import AuthScene, { Field, SubmitBtn } from './AuthScene'

export default function SignupPage() {
  const { signUp } = useAuthStore()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState('')
  const [done,     setDone]     = useState(false)
  const [notice,   setNotice]   = useState('')
  const [displayHandle, setDisplayHandle] = useState('')
  const [btnState, setBtnState] = useState('idle')

  const traderId = previewTraderId(email)

  // Typewriter for the handle preview
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
  }, [email])   // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return }
    setBtnState('loading')
    const { data, error: err } = await signUp(email, password)
    if (err) {
      setBtnState('idle')
      const m = String(err.message || '')
      setError(/rate limit/i.test(m)
        ? 'Too many sign-ups in the last hour from this site. Wait a few minutes and try again, or sign in if you already have an account.'
        : m)
      return
    }
    setBtnState('success')
    // With email confirmation switched off the session arrives at once: straight to the desk,
    // which provisions the workspace on first load.
    if (data?.session) { setTimeout(() => { window.location.href = '/' }, 400); return }
    setTimeout(() => setDone(true), 400)
  }

  const resend = async () => {
    setNotice('')
    const { error: err } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin + '/confirm' } })
    setNotice(err ? err.message : 'Sent again. Give it a few minutes and check the spam folder.')
  }

  if (done) {
    return (
      <AuthScene eyebrow="ONE MORE STEP">
        <div className="au-check">✦</div>
        <h2 className="au-title" style={{ textAlign: 'center' }}>Check your email</h2>
        <p className="au-lead" style={{ textAlign: 'center' }}>We sent a confirmation link to <b style={{ color: 'var(--text-hi)' }}>{email}</b>. Open it and your desk is provisioned on the spot.</p>
        {traderId && (
          <div className="au-handle"><span>YOUR HANDLE</span><b>{traderId}</b></div>
        )}
        <p className="au-alt">It can take a few minutes. Nothing after that? Check spam, then <button type="button" className="au-inline" onClick={resend}>send it again</button>.</p>
        {notice && <div className="au-notice">{notice}</div>}
        <p className="au-alt"><Link to="/login">← Back to sign in</Link></p>
      </AuthScene>
    )
  }

  return (
    <AuthScene eyebrow="CREATE A DEMO ACCOUNT">
      <h2 className="au-title">Get a desk in a minute</h2>
      <p className="au-lead">You get your own entity, a demo counterparty that countersigns, and a copy of today's public market data. Nothing to install.</p>
      <form onSubmit={handleSubmit} className="au-form">
        <Field label="Email">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus autoComplete="email" />
        </Field>
        {email.includes('@') && (
          <div className="au-handle">
            <span>YOUR HANDLE</span>
            <b>{displayHandle}{displayHandle.length < traderId.length && <i className="caret">_</i>}</b>
          </div>
        )}
        <Field label="Password">
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" required autoComplete="new-password" />
        </Field>
        <Field label="Confirm password">
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat password" required autoComplete="new-password" />
        </Field>
        {error && <div className="au-error">{error}</div>}
        <SubmitBtn state={btnState} labels={{ idle: 'CREATE ACCOUNT', loading: 'CREATING…', success: 'CONFIRMED ✓' }} />
      </form>
      <p className="au-alt" style={{ fontSize: 11 }}>By creating an account you agree to the <Link to="/terms" target="_blank">Terms of Service</Link> and the <Link to="/privacy" target="_blank">Privacy Notice</Link>.</p>
      <p className="au-alt">Already have an account? <Link to="/login">Sign in</Link></p>
    </AuthScene>
  )
}
