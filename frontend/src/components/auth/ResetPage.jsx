// auth/ResetPage.jsx — where the password-reset email lands. Supabase opens a recovery session
// from the link; the user sets a new password and goes to the desk.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import AuthScene, { Field, SubmitBtn } from './AuthScene'

export default function ResetPage() {
  const navigate = useNavigate()
  const session = useAuthStore(s => s.session)
  const loading = useAuthStore(s => s.loading)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [btnState, setBtnState] = useState('idle')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // the recovery link puts the session in the URL hash; the client picks it up and fires PASSWORD_RECOVERY / SIGNED_IN
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true) })
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true) })
    return () => subscription.unsubscribe()
  }, [])
  const submit = async (e) => {
    e.preventDefault(); setError('')
    if (pw.length < 8) return setError('Use at least 8 characters.')
    if (pw !== pw2) return setError('The two passwords differ.')
    setBtnState('loading')
    const { error: err } = await supabase.auth.updateUser({ password: pw })
    if (err) { setBtnState('idle'); setError(err.message); return }
    setBtnState('success')
    setTimeout(() => navigate('/command-center', { replace: true }), 600)
  }
  return (
    <AuthScene eyebrow="RESET PASSWORD">
      <h2 className="au-title">Choose a new password</h2>
      <p className="au-lead">{ready || session ? 'This link signed you in for the reset. Set the new password and you are back on the desk.' : loading ? 'Opening the reset link…' : 'This page expects the link from the reset email. If you arrived here without one, use Forgot password on the sign-in page.'}</p>
      <form onSubmit={submit} className="au-form">
        <Field label="New password"><input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 8 characters" required autoFocus autoComplete="new-password" /></Field>
        <Field label="Repeat it"><input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Same again" required autoComplete="new-password" /></Field>
        {error && <div className="au-error">{error}</div>}
        <SubmitBtn state={btnState} labels={{ idle: 'SET PASSWORD', loading: 'SAVING…', success: 'DONE ✓' }} />
      </form>
    </AuthScene>
  )
}
