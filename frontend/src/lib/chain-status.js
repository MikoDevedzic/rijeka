// lib/chain-status.js — asks the API once a page load which chain it anchors on, and gives a screen the words for it
// (lib/network.js).
import { useEffect, useState } from 'react'
import { getSessionMaybe } from './session'
import { networkOf } from './network'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

let asked = null
// One request a page load, shared by every screen that words the chain; a failure is asked again next time.
export function chainStatus() {
  if (!asked) {
    asked = (async () => {
      const s = await getSessionMaybe()
      const r = await fetch(`${API}/api/chain/status`, { headers: { Authorization: `Bearer ${s?.access_token}` } })
      if (!r.ok) throw new Error(`chain status ${r.status}`)
      return r.json()
    })().catch(e => { asked = null; throw e })
  }
  return asked
}
export function useNetwork() {
  const [status, setStatus] = useState(null)
  useEffect(() => { let on = true; chainStatus().then(s => { if (on) setStatus(s) }).catch(() => {}); return () => { on = false } }, [])
  return networkOf(status)
}
