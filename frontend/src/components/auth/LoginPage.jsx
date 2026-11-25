import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import { supabase } from '../../lib/supabase'
import AuthScene, { Field, SubmitBtn } from './AuthScene'
import { guestsTaken, guestsTakenLast, GUEST_HOME } from '../../lib/guest'

export default function LoginPage() {
  const { signIn } = useAuthStore()
  const enterAsGuest = useAuthStore(s => s.enterAsGuest)
  const navigate   = useNavigate()

  // The way in with no account, offered where the instance takes guests (lib/guest.js): asked once, shown when yes.
  const [guests, setGuests] = useState(guestsTakenLast)          // what the API last said, so the door is drawn once; the answer below corrects it
  const [entering, setEntering] = useState(false)
  useEffect(() => { let on = true; guestsTaken().then(y => { if (on) setGuests(y) }); return () => { on = false } }, [])
  const lookAround = async () => {
    setError(''); setNotice(''); setEntering(true)
    try { await enterAsGuest(); navigate(GUEST_HOME, { replace: true }) }
    catch (e) { setEntering(false); setError(e?.message || 'The guest desk is not available just now.') }
  }

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
    <AuthScene eyebrow="SIGN IN" mode="in">
      {guests && (
        <div className="au-guest" data-testid="guest-door">
          <button type="button" className="au-btn" data-action="guest-enter" disabled={entering} onClick={lookAround}>
            {entering ? 'OPENING THE GUEST DESK…' : 'PRICE A TRADE · NO ACCOUNT'}
          </button>
          <p className="au-alt">Price a swap, an option or a forward and see its XVA. Booking it asks for an account.</p>
          <div className="au-or"><span>or sign in</span></div>
        </div>
      )}
      <h2 className={'au-title' + (guests ? ' au-title-guest' : '')}>Enter the desk</h2>
      <p className="au-lead">Your blotter, market data and confirmations are private to your account.</p>
      <form onSubmit={handleSubmit} className={'au-form' + (guests ? ' au-form-second' : '')}>
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
    </AuthScene>
  )
}
