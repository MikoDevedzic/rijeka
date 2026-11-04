// risk/regimes-report.js — the stored regimes run, its background run and the polling, shared by Risk → CAPITAL and
// Risk → COLLATERAL (RegimesReport.jsx renders it); the fetch helper and the date formats.
import { useEffect, useRef, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import { errorMessage } from './capital-page'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
export const fmtD = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtT = (iso) => iso ? new Date(iso).toLocaleString() : ''
const COLOR = { BASELINE: 'var(--text-dim)', CURRENT: 'var(--accent)', FORWARD: 'var(--blue)' }

export async function api(path, opts = {}) {
  const s = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(errorMessage(r.status, j))
  return j
}

// The stored regimes run, the background run and its polling: one hook for both pages.
export function useCapitalPortfolio() {
  const [rep, setRep] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState(null)
  const timer = useRef(null)
  const load = async () => {
    setBusy(true); setErr(null)
    try { const j = await api('/api/capital/portfolio'); setRep(j); setJob(j.job || null) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const poll = () => {
    clearInterval(timer.current)
    timer.current = setInterval(async () => {
      try { const s = await api('/api/capital/portfolio/status'); setJob(s.job); if (s.job && !s.job.running) { clearInterval(timer.current); load() } } catch { clearInterval(timer.current) }
    }, 3000)
  }
  const run = async (hurdle, yieldBp) => {
    try {
      const body = { hurdle: Number(hurdle) / 100, yield_bp: yieldBp === '' || yieldBp == null ? null : Number(yieldBp) }
      const j = await api('/api/capital/portfolio', { method: 'POST', body: JSON.stringify(body) })
      setJob(j.job || { running: true }); poll()
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => () => clearInterval(timer.current), [])
  return { rep, err, busy, job, load, run }
}

