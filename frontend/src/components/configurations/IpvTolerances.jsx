// configurations/IpvTolerances.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// IPV TOLERANCES: the firm's rules. A rule matches an input by glob (USD_SOFR, *_VOL, *) and
// a pillar by glob (10Y, 1Yx5Y, 1Y|RR25, *); the most specific rule wins; the tolerance is in
// the input's unit and the materiality threshold is the first-order P&L below which an input
// passes as waived. Defaults apply where the firm has no rule. GET/POST/DELETE /api/ipv/tolerances.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import '../pnl/PnlPage.css'
import '../risk/RiskPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const UNIT_LABEL = { bp: 'bp (rates, funding)', vol_bp: 'bp of normal vol (swaptions)', vol_pt: 'vol points (FX)', pct: '% of spot' }

async function api(path, opts = {}) {
  const s = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `${path} ${r.status}`)
  return j
}

const EMPTY = { input_pattern: '', pillar_pattern: '*', tol: '', unit: 'bp', materiality_usd: '1000', note: '' }

export default function IpvTolerances() {
  const [view, setView] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = async () => { try { setView(await api('/api/ipv/tolerances')) } catch (e) { setErr(e.message) } }
  useEffect(() => { load() }, [])
  const add = async () => {
    setBusy(true); setErr(null)
    try {
      const j = await api('/api/ipv/tolerances', { method: 'POST', body: JSON.stringify({ ...form, tol: Number(form.tol), materiality_usd: Number(form.materiality_usd || 0) }) })
      setView(v => ({ ...v, rules: j.rules })); setForm(EMPTY)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const remove = async (id) => {
    setBusy(true); setErr(null)
    try { const j = await api(`/api/ipv/tolerances/${id}`, { method: 'DELETE' }); setView(v => ({ ...v, rules: j.rules })) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const inp = { background: 'var(--bg)', border: '1px solid var(--fld-bd)', color: 'var(--text)', padding: '6px 8px', borderRadius: 2, fontFamily: 'var(--mono)', fontSize: 12 }
  return (
    <div className="pnl">
      <div className="pnl-bar">
        <div className="pnl-title">IPV TOLERANCES <span className="pnl-sub">how far an independent mark may sit from the desk's, and below what P&L an input is immaterial</span></div>
        <div className="pnl-ctl">{view && <span className={`pnl-chip ${view.tables ? 'ok' : 'red'}`}>{view.tables ? `${view.rules.length} RULE${view.rules.length === 1 ? '' : 'S'}` : 'MIGRATION PENDING'}</span>}</div>
      </div>
      {err && <div className="pnl-err">{err}</div>}
      {view && (<>
        <section className="pnl-panel" style={{ maxWidth: 1100 }}>
          <header><span>RULES</span><span className="pnl-sub">the most specific rule wins: an exact input before a pattern, an exact pillar before *</span></header>
          <div className="rk-rows">
            <div className="rk-row dim" style={{ gridTemplateColumns: '10rem 8rem 6rem 12rem 9rem 1fr 4rem' }}><span>INPUT</span><span>PILLAR</span><span>TOL</span><span>UNIT</span><span>MATERIALITY $</span><span>NOTE</span><span></span></div>
            {view.rules.map(r => (
              <div key={r.id} className="rk-row" style={{ gridTemplateColumns: '10rem 8rem 6rem 12rem 9rem 1fr 4rem' }}>
                <span className="rk-ref">{r.input_pattern}</span><span className="rk-ref">{r.pillar_pattern}</span><span>{r.tol}</span><span className="pnl-tv dim" style={{ textAlign: 'left' }}>{UNIT_LABEL[r.unit] || r.unit}</span>
                <span>{Number(r.materiality_usd).toLocaleString()}</span><span className="pnl-tv dim" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{r.note}{r.set_by_name ? ` · ${r.set_by_name}` : ''}</span>
                <span><button className="pnl-btn ghost" style={{ padding: '2px 6px', fontSize: 10 }} disabled={busy} onClick={() => remove(r.id)}>✕</button></span>
              </div>
            ))}
            {!view.rules.length && <div className="pnl-empty">No rules: the defaults apply ({Object.entries(view.defaults).map(([k, v]) => `${k} ${v}`).join(' · ')}; materiality {view.default_materiality_usd.toLocaleString()} $).</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '10rem 8rem 6rem 12rem 9rem 1fr 8rem', gap: 8, padding: '10px 14px', alignItems: 'center' }}>
            <input style={inp} placeholder="USD_SOFR or *_VOL" value={form.input_pattern} onChange={e => setForm({ ...form, input_pattern: e.target.value })} aria-label="input pattern" />
            <input style={inp} placeholder="* or 10Y" value={form.pillar_pattern} onChange={e => setForm({ ...form, pillar_pattern: e.target.value })} aria-label="pillar pattern" />
            <input style={inp} placeholder="1.0" value={form.tol} onChange={e => setForm({ ...form, tol: e.target.value })} aria-label="tolerance" />
            <select style={inp} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} aria-label="unit">{view.units.map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select>
            <input style={inp} placeholder="1000" value={form.materiality_usd} onChange={e => setForm({ ...form, materiality_usd: e.target.value })} aria-label="materiality" />
            <input style={inp} placeholder="note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} aria-label="note" />
            <button className="pnl-btn" disabled={busy || !form.input_pattern.trim() || !(Number(form.tol) > 0) || !view.tables} onClick={add}>ADD RULE</button>
          </div>
        </section>
      </>)}
    </div>
  )
}
