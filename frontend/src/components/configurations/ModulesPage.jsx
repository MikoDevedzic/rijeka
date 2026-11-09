// configurations/ModulesPage.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// MODULES: which parts of the desk this firm runs. A switch hides the module's pages and
// tabs, skips its batches and relaxes its gates; it never deletes anything. Presets for
// the usual shapes of a firm; every change is an audit row. GET /api/modules; PUT for whoever may
// switch (an admin, or the owner of a sandbox workspace: can_edit in the answer). The route in App.jsx
// lets the same people in; nothing here looks at the role.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import { useModulesStore } from '../../store/useModulesStore'
import '../pnl/PnlPage.css'
import '../risk/RiskPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const fmtT = (iso) => iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

async function api(path, opts = {}) {
  const s = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `${path} ${r.status}`)
  return j
}

export default function ModulesPage() {
  const apply = useModulesStore(s => s.apply)
  const preset = useModulesStore(s => s.preset)
  const [view, setView] = useState(null)
  const [draft, setDraft] = useState(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    try { const j = await api('/api/modules'); setView(j); setDraft(j.modules); apply(j) } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (body) => {
    setBusy(true); setErr(null)
    try { const j = await api('/api/modules', { method: 'PUT', body: JSON.stringify({ ...body, note: note || null }) }); setView(j); setDraft(j.modules); apply(j); setNote('') }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const dirty = !!(view && draft && Object.keys(draft).some(k => draft[k] !== view.modules[k]))
  const presetOf = (mods) => Object.entries(view?.presets || {}).find(([, p]) => Object.keys(p.modules).every(k => p.modules[k] === mods[k]))?.[0] || 'CUSTOM'
  const defs = view?.definitions || []

  return (
    <div className="pnl">
      <div className="pnl-bar">
        <div className="pnl-title">MODULES <span className="pnl-sub">which parts of the desk this firm runs · a switch hides and un-gates, never deletes</span></div>
        <div className="pnl-ctl">
          {view && <span className={`pnl-chip ${view.writable ? 'ok' : 'red'}`}>{view.writable ? (view.source === 'firm' ? `PRESET ${view.preset || 'CUSTOM'}` : 'DEFAULT · EVERYTHING ON') : 'MIGRATION PENDING'}</span>}
        </div>
      </div>
      {preset === 'LAUNCH' && <div className="pnl-empty" style={{ padding: 0, maxWidth: 980 }}>This workspace is on the launch set. Switch a module on below and its pages appear; nothing is deleted when you switch one off.</div>}
      {err && <div className="pnl-err">{err}</div>}
      {!view && !err && <div className="pnl-empty">Loading…</div>}
      {view && (<>
        <section className="pnl-panel" style={{ maxWidth: 980 }}>
          <header><span>PRESETS</span><span className="pnl-sub">the usual shapes of a firm; pick one, then adjust below</span></header>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 14px' }}>
            {Object.entries(view.presets).map(([k, p]) => (
              <button key={k} className="pnl-btn ghost" disabled={busy || !view.writable} onClick={() => save({ preset: k })} title={p.desc}
                style={presetOf(view.modules) === k ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>{p.label.toUpperCase()}</button>
            ))}
            {!view.writable && <span className="pnl-note">apply docs/migrations/2026-11-04_firm_modules.sql to switch modules; until then every module is on</span>}
          </div>
        </section>

        <section className="pnl-panel" style={{ maxWidth: 980 }}>
          <header><span>SWITCHES</span><span className="pnl-sub">what each one hides, skips or un-gates</span></header>
          <div className="rk-rows">
            <div className="rk-row dim" style={{ gridTemplateColumns: '5rem 14rem 1fr' }}><span>STATE</span><span>MODULE</span><span>WHAT IT SWITCHES</span></div>
            {defs.map(d => {
              const on = draft?.[d.key] !== false
              return (
                <div key={d.key} className="rk-row" style={{ gridTemplateColumns: '5rem 14rem 1fr', opacity: d.planned ? 0.55 : 1 }}>
                  <span>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: d.planned || !view.writable ? 'default' : 'pointer' }}>
                      <input type="checkbox" checked={on} disabled={d.planned || !view.writable || busy} onChange={e => setDraft({ ...draft, [d.key]: e.target.checked })} aria-label={`${d.label} on`} />
                      <span className={`pnl-chip ${on ? 'ok' : ''}`}>{on ? 'ON' : 'OFF'}</span>
                    </label>
                  </span>
                  <span className="rk-ref">{d.label.toUpperCase()}{d.planned ? <small className="pnl-note"> · planned</small> : null}</span>
                  <span className="pnl-tv dim" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{d.effects}</span>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px' }}>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="reason (goes in the audit row)" style={{ flex: '1 1 240px', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 2, fontFamily: 'var(--mono)', fontSize: 12 }} />
            <button className="pnl-btn" disabled={!dirty || busy || !view.writable} onClick={() => save({ modules: draft })}>{busy ? 'SAVING…' : 'SAVE SWITCHES'}</button>
            <button className="pnl-btn ghost" disabled={!dirty || busy} onClick={() => setDraft(view.modules)}>REVERT</button>
          </div>
        </section>

        <section className="pnl-panel" style={{ maxWidth: 980 }}>
          <header><span>CHANGES</span><span className="pnl-sub">who switched what, and when</span></header>
          <div className="rk-rows">
            {(view.events || []).map((e, i) => (
              <div key={i} className="rk-row" style={{ gridTemplateColumns: '9rem 14rem 1fr' }}>
                <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{fmtT(e.at)}</span>
                <span className="rk-ref">{(e.email || e.user_id?.slice(0, 8) || '').toUpperCase()}</span>
                <span className="pnl-tv dim" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{e.preset}{e.changed?.length ? ` · ${e.changed.map(k => `${k} ${e.after[k] ? 'on' : 'off'}`).join(', ')}` : ' · no change'}{e.note ? ` · ${e.note}` : ''}</span>
              </div>
            ))}
            {!(view.events || []).length && <div className="pnl-empty">No changes yet: every module is on.</div>}
          </div>
        </section>
      </>)}
    </div>
  )
}
