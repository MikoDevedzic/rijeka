import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'
import AuthScene, { Field, SubmitBtn } from './AuthScene'

export default function LoginPage() {
  const { signIn } = useAuthStore()
  const navigate   = useNavigate()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [btnState, setBtnState] = useState('idle') // idle | loading | success

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBtnState('loading')
    const { error: err } = await signIn(email, password)
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
        {error && <div className="au-error">{error}</div>}
        <SubmitBtn state={btnState} labels={{ idle: 'ENTER SYSTEM', loading: 'AUTHENTICATING…', success: 'ACCESS GRANTED ✓' }} />
      </form>
      <p className="au-alt">No account? <Link to="/signup">Create a demo account</Link></p>
    </AuthScene>
  )
}
