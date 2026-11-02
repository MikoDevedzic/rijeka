// A slim bar at the top of the desk when a newer build is live than the one this tab is running.
// Reloading is the user's choice: open windows are lost with it.
import { useEffect, useState } from 'react'
import { watchVersion } from '../../lib/version'

export default function NewVersionBar() {
  const [live, setLive] = useState(null)
  useEffect(() => watchVersion(setLive), [])
  if (!live) return null
  return (
    <div role="status" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
      padding: '6px 12px', background: 'var(--amber, #f0a020)', color: '#04120E',
      fontFamily: "'IBM Plex Mono',var(--mono)", fontSize: '0.8125rem', letterSpacing: '0.12em', fontWeight: 700,
    }}>
      <span>A NEWER VERSION OF THE DESK IS LIVE · {String(live).slice(0, 7)}</span>
      <button type="button" onClick={() => window.location.reload()} style={{
        background: '#04120E', color: 'var(--amber, #f0a020)', border: 0, borderRadius: 2,
        padding: '3px 10px', fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', fontWeight: 700, cursor: 'pointer',
      }}>RELOAD</button>
      <button type="button" onClick={() => setLive(null)} title="Keep this version for now" style={{
        background: 'transparent', color: '#04120E', border: '1px solid rgba(4,18,14,.5)', borderRadius: 2,
        padding: '3px 8px', fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', cursor: 'pointer',
      }}>LATER</button>
    </div>
  )
}
