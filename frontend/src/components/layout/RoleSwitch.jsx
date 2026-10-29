// layout/RoleSwitch.jsx — the role chip in the top bar. On the hosted demo every workspace is
// its own firm, so the person at the desk picks the hat: TRADER books, CONTROLLER signs the
// day, RISK sets limits, MANAGEMENT (CFO) sees every book, SOLO DESK does all of it (admin).
// In a firm deployment the admin assigns roles on the Users page and this is a plain label.
import { useEffect, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const LABEL = { viewer: 'READ ONLY', trader: 'TRADER', controller: 'CONTROLLER', risk: 'RISK', management: 'MANAGEMENT · CFO', admin: 'SOLO DESK · ALL ROLES' }
const HELP = {
  trader: 'Books and confirms trades; signs the day first.', controller: 'P&L controller or desk CFO: signs the day after the trader; cannot book.',
  risk: 'Market risk manager: sets limits and VaR settings; cannot book.', management: 'Sees every book in the firm, P&L and sign-off state; cannot book.',
  admin: 'One person runs the desk: books, signs, sets limits. For a one-person shop or a demo.',
}
const DISCLOSURE = 'Roles are the firm\'s. On the hosted demo your workspace is its own firm, so you pick the hat you are wearing; a firm\'s admin assigns roles on Configurations › Admin › Users. Whether one signature or two finalise a day is the firm\'s sign-off policy (Configurations › P&L & Control › Conventions): two-person for a desk with a controller, single for a one-person shop or where the CFO is also the control function.'

export default function RoleSwitch({ className, style }) {
  const user = useAuthStore(s => s.session?.user)
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const s = await getSessionMaybe()
        const r = await fetch(`${API}/api/me/role`, { headers: { Authorization: `Bearer ${s?.access_token}` } })
        if (r.ok && alive) setInfo(await r.json())
      } catch { /* label falls back to the token's role */ }
    })()
    return () => { alive = false }
  }, [])
  const role = (info?.role || user?.user_metadata?.role || 'viewer').toLowerCase()
  const label = LABEL[role] || role.toUpperCase()
  const change = async (next) => {
    if (!next || next === role) return
    setBusy(true)
    try {
      const s = await getSessionMaybe()
      const r = await fetch(`${API}/api/me/role`, { method: 'PUT', headers: { Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: next }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(typeof j.detail === 'string' ? j.detail : `role ${r.status}`) }
      await supabase.auth.refreshSession()            // the token carries the role the pricers check
      window.location.reload()
    } catch (e) { alert(e.message); setBusy(false) }
  }
  if (!info?.self_service) return <span className={className} style={{ color: role === 'viewer' ? 'var(--amber)' : 'var(--text-dim)', fontWeight: 700, ...style }} title={DISCLOSURE}>{label}</span>
  return (
    <select value={role} disabled={busy} onChange={e => change(e.target.value)} title={`${HELP[role] || ''}\n\n${DISCLOSURE}`} className={className}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: role === 'viewer' ? 'var(--amber)' : 'var(--text-dim)', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 700, letterSpacing: 'inherit', padding: '0.1rem 0.3rem', borderRadius: 2, cursor: 'pointer', ...style }}>
      {role === 'viewer' && <option value="viewer">READ ONLY</option>}
      {(info.roles || []).map(r => <option key={r} value={r}>{LABEL[r]}</option>)}
    </select>
  )
}
