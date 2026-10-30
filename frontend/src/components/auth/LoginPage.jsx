import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { supabase } from '../../lib/supabase'
import AuthScene, { Field, SubmitBtn } from './AuthScene'

export default function LoginPage() {
  const { signIn } = useAuthStore()
  const navigate   = useNavigate()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [notice,   setNotice]   = useState('')
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [btnState, setBtnState] = useState('idle') // idle | loading | success

  // Self-service for the two things that otherwise need us: a lost password, a confirmation
  // email that never arrived. Both go through Supabase and land on this app's own pages.
  const needEmail = () => { if (!email) { setError('Enter your email above first.'); return false } return true }
  const forgot = async () => {
    setError(''); setNotice('')
    if (!needEmail()) return
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset' })
    if (err) setError(err.message); else setNotice(`Password reset sent to ${email}. Check spam or quarantine if it does not arrive within a minute.`)
  }
  const resend = async () => {
    setError(''); setNotice('')
    if (!needEmail()) return
    const { error: err } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin + '/confirm' } })
    if (err) setError(err.message); else setNotice(`Confirmation email sent again to ${email}. Corporate filters sometimes quarantine it; it comes from Supabase on behalf of Rijeka.`)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBtnState('loading')
    const { error: err } = await signIn(email, password)
    if (err) {
      setBtnState('idle')
      if (err.message.includes('Invalid login')) setError('Invalid email or password.')
      else if (err.message.includes('Email not confirmed')) { setError('Please confirm your email first.'); setUnconfirmed(true) }
      else setError(err.message)
      return
    }
    setBtnState('success')
    setTimeout(() => navigate('/command-center', { replace: true }), 600)
  }

  return (
    <AuthScene eyebrow="SIGN IN">
      <h2 className="au-title">Enter the desk</h2>
      <p className="au-lead">Your blotter, market data and confirmations are private to your account.</p>
      <form onSubmit={handleSubmit} className="au-form">
        <Field label="Email">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus autoComplete="email" />
        </Field>
        <Field label="Password">
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required autoComplete="current-password" />
        </Field>
        {error && <div className="au-error">{error}{unconfirmed && <> <button type="button" className="au-inline" onClick={resend}>Resend the confirmation email</button></>}</div>}
        {notice && <div className="au-notice">{notice}</div>}
        <SubmitBtn state={btnState} labels={{ idle: 'ENTER SYSTEM', loading: 'AUTHENTICATING…', success: 'ACCESS GRANTED ✓' }} />
      </form>
      <p className="au-alt"><button type="button" className="au-inline" onClick={forgot}>Forgot password?</button> · <button type="button" className="au-inline" onClick={resend}>Resend confirmation email</button></p>
      <p className="au-alt">No account? <Link to="/signup">Create a demo account</Link></p>
    </AuthScene>
  )
}
