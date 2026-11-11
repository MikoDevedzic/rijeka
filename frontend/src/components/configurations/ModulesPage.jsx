// configurations/ModulesPage.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// MODULES: which parts of the desk this firm runs. A switch hides the module's pages and
// tabs, skips its batches and relaxes its gates; it never deletes anything. Presets for
// the usual shapes of a firm; every change is an audit row. GET /api/modules; PUT for whoever may
// switch (an admin, or the owner of a sandbox workspace: can_edit in the answer). The route in App.jsx
// lets the same people in; nothing here looks at the role. A module the hosted demo holds back (on_request in
// the answer: on the hosted demo everything outside the launch set) is shown as available on request with the address to write to, and cannot be switched.
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
  const launch = useModulesStore(s => s.launch)
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
  // The preset whose switches these are. Where a module is held back several presets are the same map (Dealer,
  // Fund and Classroom without capital), so the one the firm chose wins over the first that matches.
  const presetOf = (mods) => {
    const same = Object.entries(view?.presets || {}).filter(([, p]) => Object.keys(p.modules).every(k => p.modules[k] === mods[k])).map(([k]) => k)
    return same.includes(view?.preset) ? view.preset : same[0] || 'CUSTOM'
  }
  const defs = view?.definitions || []
  const held = view?.on_request || []

  return (
    <div className="pnl">
      <div className="pnl-bar">
        <div className="pnl-title">MODULES <span className="pnl-sub">which parts of the desk this firm runs · a switch hides and un-gates, never deletes</span></div>
        <div className="pnl-ctl">
          {view && <span className={`pnl-chip ${view.writable ? 'ok' : 'red'}`}>{view.writable ? (view.source === 'firm' ? `PRESET ${view.preset || 'CUSTOM'}` : held.length ? 'DEFAULT · NOTHING CHOSEN' : 'DEFAULT · EVERYTHING ON') : 'MIGRATION PENDING'}</span>}
        </div>
      </div>
      {launch && <div className="pnl-empty" data-testid="modules-launch-note" style={{ padding: 0, maxWidth: 980 }}>{defs.some(d => !d.planned && !held.includes(d.key) && view?.modules?.[d.key] === false)
        ? 'This workspace is on the launch view. Switch a module on below and its pages appear; nothing is deleted when you switch one off. Choosing a full preset such as Dealer also brings back the full home page and the model inputs on the XVA tab.'
        : 'This workspace is on the launch view: book, value, the XVA charge and its saving on chain, confirm. The modules marked on request below are not part of this demo. Choosing a full preset such as Dealer brings back the full home page and the model inputs on the XVA tab.'}</div>}
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
            {!view.writable && <span className="pnl-note">apply docs/migrations/2026-11-04_firm_modules.sql to switch modules{held.length ? '' : '; until then every module is on'}</span>}
          </div>
        </section>

        <section className="pnl-panel" style={{ maxWidth: 980 }}>
          <header><span>SWITCHES</span><span className="pnl-sub">what each one hides, skips or un-gates</span></header>
          <div className="rk-rows">
            <div className="rk-row dim" style={{ gridTemplateColumns: '5rem 14rem 1fr' }}><span>STATE</span><span>MODULE</span><span>WHAT IT SWITCHES</span></div>
            {defs.map(d => {
              const on = draft?.[d.key] !== false
              if (held.includes(d.key)) return (
                <div key={d.key} className="rk-row" data-testid={`module-on-request-${d.key}`} style={{ gridTemplateColumns: '5rem 14rem 1fr' }}>
                  <span><span className="pnl-chip">OFF</span></span>
                  <span className="rk-ref">{d.label.toUpperCase()}<small className="pnl-note" style={{ display: 'inline' }}> · on request</small></span>
                  <span className="pnl-tv dim" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{d.effects}. Not part of this demo. To see it, write to <a href={`mailto:${view.contact}`} style={{ color: 'var(--accent)' }}>{view.contact}</a>.</span>
                </div>
              )
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
            {!(view.events || []).length && <div className="pnl-empty">{held.length ? 'No changes yet.' : 'No changes yet: every module is on.'}</div>}
          </div>
        </section>
      </>)}
    </div>
  )
}
