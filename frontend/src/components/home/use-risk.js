// How the home reads the risk report, in one place: the stored report at once and, where that is not the book as it
// stands (trader-home.js staleness), the live one, asked for once a visit. The trader's home on a monitor and the
// home's strip on a phone both read it here, so that the two show the same report on the same book.
import { useEffect, useRef, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import { staleness } from './trader-home'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

// One read of an endpoint: { data, err, loading }. `every` asks again on that beat and when the window is looked at.
export async function read(path) {
  const s = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${s?.access_token}` } })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}
export function useGet(path, { on = true, every = 0 } = {}) {
  const [st, setSt] = useState({ data: null, err: null })
  useEffect(() => {
    if (!on) return undefined
    let alive = true
    const load = async () => {
      try { const j = await read(path); if (alive) setSt({ data: j, err: null }) }
      catch (e) { if (alive) setSt(p => ({ data: p.data, err: e.message || 'no answer' })) }
    }
    load()
    if (!every) return () => { alive = false }
    const id = setInterval(load, every)
    window.addEventListener('focus', load)
    return () => { alive = false; clearInterval(id); window.removeEventListener('focus', load) }
  }, [path, on, every])
  // loading is worked out, not kept: a read that is switched on later is loading from its first frame (Vera, 14 Nov 2026:
  // kept as state it was false until the answer, and the page said "no risk" while the report was on its way)
  return on ? { ...st, loading: st.data == null && st.err == null } : { data: null, err: null, loading: false }
}

// The risk report: the stored one at once, and where that is not the book as it stands (trader-home.js staleness: a
// trade booked or closed since, later market data, a report stored before it carried the moves) the live one, asked
// for once a visit. `behind` says why the report shown is still the stored one: 'running' while the live one is
// on its way, the reason when it could not be had.
export function useRisk(on, trades, marketDate, known) {
  const stored = useGet('/api/risk/report', { on })
  const [live, setLive] = useState({ data: null, err: null })
  const asked = useRef(false), here = useRef(true)
  useEffect(() => { here.current = true; return () => { here.current = false } }, [])
  // a report this browser has just had run is as fresh as one can be: it is not asked for again on the next visit,
  // whatever the rule above makes of it (a rule that disagreed with the engine would otherwise run it on every visit)
  const fresh = stored.data?.generated_at && stored.data.generated_at === ran()
  const why = on && known && !fresh ? staleness(stored.data, trades, marketDate) : null
  useEffect(() => {
    if (!why || asked.current) return
    asked.current = true
    read('/api/risk/report?live=1').then(j => { ran(j?.generated_at); if (here.current) setLive({ data: j, err: null }) }, e => { if (here.current) setLive({ data: null, err: e.message || 'no answer' }) })
  }, [why])
  const behind = !why || live.data ? null : live.err ? why : 'running'
  return { data: live.data || stored.data, err: stored.err, loading: stored.loading, behind, liveErr: live.err }
}
const RAN_KEY = 'rijeka.home.risk.ran'
function ran(at) { try { if (at) sessionStorage.setItem(RAN_KEY, at); return sessionStorage.getItem(RAN_KEY) } catch { return null } }
