// pnl/IpvPage.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// INDEPENDENT PRICE VERIFICATION: the market data the book is priced on, by risk ladder.
// One row per input the trades in scope read; verify by pillar (a curve, a spot, a funding
// level) or by surface point (expiry × tenor, tenor × ATM/RR/BF); an override is a
// market-data event with a reason and carries its first-order P&L; APPLY revalues the book
// for the second order; the controller signs flash → official. GET/POST /api/ipv/* (backend/ipv).
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSessionMaybe } from '../../lib/session'
import PnlNav from './PnlNav'
import { KIND_LABEL, PILLAR_COLOR, STATE_COLOR, counts, errorMessage, fmtQuote, fmtShift, fmtSigned, fxGrid, inputRows, pillarRows, sensLabel, surfaceGrid, waterfall } from './ipv-page'
import './PnlPage.css'
import '../risk/RiskPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const fmtD = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtT = (iso) => iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const mono = { fontFamily: 'var(--mono)' }

async function api(path, opts = {}) {
  const s = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(errorMessage(r.status, j))
  return j
}

export default function IpvPage() {
  const navigate = useNavigate()
  const [run, setRun] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState(null)
  const [scope, setScope] = useState({ level: 'GLOBAL', name: '' })
  const [sel, setSel] = useState(null)              // the input whose pillars are open
  const [drafts, setDrafts] = useState({})          // pillar key → typed override
  const [reason, setReason] = useState('')
  const timer = useRef(null)
  const q = () => `level=${scope.level}${scope.name ? `&name=${encodeURIComponent(scope.name)}` : ''}`
  const body = (extra = {}) => ({ level: scope.level, name: scope.name || null, ...extra })

  const load = async () => {
    setBusy(true); setErr(null)
    try { const j = await api(`/api/ipv/run?${q()}`); setRun(j); setJob(j.job || null); if (!sel && j.inputs?.length) setSel(j.inputs[0].curve_id) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { load() }, [scope.level, scope.name])  // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    try { const j = await api('/api/ipv/run', { method: 'POST', body: JSON.stringify(body()) }); setJob(j.job || { running: true }); poll() } catch (e) { setErr(e.message) }
  }
  const poll = () => {
    clearInterval(timer.current)
    timer.current = setInterval(async () => {
      try { const s = await api('/api/ipv/run/status'); setJob(s.job); if (s.job && !s.job.running) { clearInterval(timer.current); load() } } catch { clearInterval(timer.current) }
    }, 3000)
  }
  useEffect(() => () => clearInterval(timer.current), [])
  const act = async (path, extra, method = 'POST') => {
    setBusy(true); setErr(null)
    try { const j = await api(path, { method, body: JSON.stringify(body(extra)) }); setRun(j); setDrafts({}); setReason('') } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const override = (curve_id, key, value) => {
    if (!reason.trim()) { setErr('an override needs a reason'); return }
    act('/api/ipv/override', { curve_id, pillar: key, value: Number(value), reason: reason.trim() }, 'PUT')
  }
  const withdraw = async (id) => {
    setBusy(true); setErr(null)
    try { const j = await api(`/api/ipv/override/${id}?${q()}`, { method: 'DELETE' }); setRun(j) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const rows = inputRows(run)
  const c = counts(run)
  const input = (run?.inputs || []).find(i => i.curve_id === sel) || (run?.inputs || [])[0]
  const wf = waterfall(run)
  const signed = run?.status === 'SIGNED'
  const gate = run?.gate || []

  return (
    <div className="pnl rk-page">
      <PnlNav />
      <div className="pnl-bar">
        <div className="pnl-title">INDEPENDENT PRICE VERIFICATION <span className="pnl-sub">the market data the book is priced on, by risk ladder · overrides carry their P&L · flash → official</span></div>
        <div className="pnl-ctl">
          <label className="pnl-note">scope
            <select value={scope.level} onChange={e => { setScope({ level: e.target.value, name: '' }); setSel(null) }} style={{ marginLeft: 6 }}>
              <option value="GLOBAL">GLOBAL</option><option value="DESK">DESK</option><option value="BOOK">BOOK</option>
            </select>
            {scope.level !== 'GLOBAL' && <input value={scope.name} placeholder={scope.level === 'DESK' ? 'desk name' : 'book name'} onChange={e => setScope({ ...scope, name: e.target.value })} style={{ width: 110, marginLeft: 6 }} />}
          </label>
          {run?.date && <span className="pnl-note">{fmtD(run.date)}{run.flash_from_store ? ' · stored day' : ''}</span>}
          {run && <span className={`pnl-chip ${signed ? 'ok' : c.pending ? 'amber' : 'ok'}`}>{signed ? 'OFFICIAL · SIGNED' : run.inputs?.length ? `IPV IN PROGRESS · ${c.settled}/${c.inputs}` : 'NO RUN'}</span>}
          <button className="pnl-btn" onClick={start} disabled={busy || job?.running}>{job?.running ? `RUNNING… ${job.done}/${job.total} ${job.current || ''}` : run?.inputs?.length ? 'RERUN' : 'RUN IPV'}</button>
          <button className="pnl-btn ghost" onClick={() => navigate('/configurations/pnl/ipv-tolerances')}>TOLERANCES →</button>
        </div>
      </div>
      {err && <div className="pnl-err">{err}</div>}
      {job?.error && <div className="pnl-err">Last run failed: {job.error}</div>}
      {run && run.tables === false && <div className="pnl-err">IPV needs docs/migrations/2026-11-05_ipv.sql applied first.</div>}
      {!run && !err && <div className="pnl-empty">Loading…</div>}
      {run && !run.inputs?.length && <div className="pnl-empty">{run.note || 'No run yet.'}</div>}
      {run?.inputs?.length > 0 && (<>
        <div className="pnl-cards" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
          <Card label="FLASH P&L" big={fmtSigned(run.flash_usd)} sub="the traders' marks, before IPV and XVA" />
          <Card label="IPV ADJUSTMENT" big={fmtSigned((run.first_order_usd || 0) + (run.applied_at ? (run.second_order_usd || 0) : 0))} sub={run.applied_at ? 'first order + second order (applied)' : 'first order · APPLY for the second order'} />
          <Card label="XVA RESERVE CHANGE" big={fmtSigned(run.xva_usd)} sub="the netted components, day on day" />
          <Card label="OFFICIAL P&L" big={fmtSigned(run.official_usd)} sub={signed ? `signed ${fmtT(run.signed_at)} · ${run.signed_name || ''}` : 'flash + IPV + XVA · unsigned'} accent />
          <Card label="INPUTS" big={`${c.settled} / ${c.inputs}`} sub={`${c.review} beyond tolerance · ${c.overridden} overridden · ${c.unvalued} unvalued trade${c.unvalued === 1 ? '' : 's'}`} />
        </div>

        <section className="pnl-panel">
          <header><span>MARKET DATA INPUTS THE BOOK DEPENDS ON</span><span className="pnl-sub">one row per curve, surface, spot or funding level the trades in scope read · click a row to verify its pillars</span></header>
          <div className="pnl-tree">
            <div className="pnl-tr head" style={{ gridTemplateColumns: '14rem 5rem 11rem 11rem 13rem 8rem 8rem' }}>
              <span className="pnl-tn">INPUT</span><span className="pnl-tv">TRADES</span><span className="pnl-tv">SENSITIVITY</span><span className="pnl-tv dim" style={{ textAlign: 'left' }}>DESK MARK</span><span className="pnl-tv dim" style={{ textAlign: 'left' }}>INDEPENDENT</span><span className="pnl-tv" style={{ textAlign: 'left' }}>STATE</span><span className="pnl-tv">IPV IMPACT</span>
            </div>
            {rows.map(r => (
              <div key={r.curve_id} className={`pnl-tr d1 trade${input && input.curve_id === r.curve_id ? ' on' : ''}`} style={{ gridTemplateColumns: '14rem 5rem 11rem 11rem 13rem 8rem 8rem' }} onClick={() => setSel(r.curve_id)}>
                <span className="pnl-tn" style={{ paddingLeft: 8 }}>{r.curve_id}<small>{r.kindLabel} · {r.pillars} pillar{r.pillars === 1 ? '' : 's'}{r.review ? ` · ${r.review} beyond tolerance` : ''}{r.overridden ? ` · ${r.overridden} overridden` : ''}</small></span>
                <span className="pnl-tv">{r.trades}</span>
                <span className="pnl-tv">{r.sens}</span>
                <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{r.desk}</span>
                <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{r.independent}</span>
                <span className="pnl-tv" style={{ textAlign: 'left', color: STATE_COLOR[r.state] }}>{r.state}{r.decision ? <small className="pnl-note"> · {r.decision.by}</small> : null}</span>
                <span className="pnl-tv" style={{ color: r.impact < -0.5 ? 'var(--down)' : r.impact > 0.5 ? 'var(--up)' : 'var(--text-mute)' }}>{r.impact ? fmtSigned(r.impact) : '—'}</span>
              </div>
            ))}
          </div>
          {run.unvalued?.length > 0 && <div className="pnl-err" style={{ marginTop: 6 }}>Not valued, blocking the sign-off: {run.unvalued.map(u => `${u.trade_ref} (${u.reason})`).join(' · ')}</div>}
        </section>

        <div className="pnl-grid">
          {input && (
            <section className="pnl-panel">
              <header><span>{input.curve_id} · VERIFY {input.kind === 'SWAPTION_VOL' || input.kind === 'FX_VOL' ? 'BY SURFACE POINT' : 'BY PILLAR'}</span>
                <span className="pnl-sub">{KIND_LABEL[input.kind]} · {sensLabel(input.kind)} per pillar at this scope · type an override and give a reason · tolerance per pillar</span></header>
              {input.unladdered && <div className="pnl-note" style={{ padding: '8px 14px' }}>{input.note || 'nothing to ladder for this input'}</div>}
              {input.kind === 'SWAPTION_VOL' ? <SurfaceGrid input={input} drafts={drafts} setDrafts={setDrafts} onOverride={override} signed={signed} />
                : input.kind === 'FX_VOL' ? <FxGrid input={input} drafts={drafts} setDrafts={setDrafts} onOverride={override} signed={signed} />
                : <PillarTable input={input} drafts={drafts} setDrafts={setDrafts} onOverride={override} onWithdraw={withdraw} signed={signed} />}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '10px 14px' }}>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="reason for an override or a waiver (goes in the audit trail)" disabled={signed}
                  style={{ flex: '1 1 260px', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 2, ...mono, fontSize: 12 }} />
                <button className="pnl-btn ghost" disabled={busy || signed} onClick={() => act('/api/ipv/inputs/approve', { curve_id: input.curve_id, reason: reason.trim() })}>APPROVE AS MARKED</button>
                <button className="pnl-btn ghost" disabled={busy || signed} onClick={() => act('/api/ipv/inputs/waive', { curve_id: input.curve_id, reason: reason.trim() })}>WAIVE</button>
              </div>
              <div className="pnl-note" style={{ padding: '0 14px 10px', lineHeight: 1.6 }}>
                · the independent column is a controller's upload or a self-host's second feed; without one the input needs APPROVE AS MARKED or a WAIVER<br />
                · impact is first order (the pillar's sensitivity × the shift); APPLY reprices the book on the overrides and shows the residual as second order<br />
                · an input whose pillars are all immaterial at their tolerance passes as WAIVED on its own
              </div>
            </section>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="pnl-panel">
              <header><span>FLASH → OFFICIAL · {run.scope_key}</span><span className="pnl-sub">the gate: every input settled, every trade valued</span></header>
              <div className="pnl-tree">
                {wf.map(w => (
                  <div key={w.key} className="pnl-tr d1" style={{ gridTemplateColumns: '1fr 8rem', fontWeight: w.kind === 'level' ? 700 : 400 }}>
                    <span className="pnl-tn" style={{ color: w.key === 'OFFICIAL' ? 'var(--accent)' : undefined }}>{w.label}<small>{w.sub}</small></span>
                    <span className="pnl-tv" style={{ color: w.value == null ? 'var(--text-mute)' : w.kind === 'level' ? (w.key === 'OFFICIAL' ? 'var(--accent)' : 'var(--text)') : w.value < 0 ? 'var(--down)' : w.value > 0 ? 'var(--up)' : 'var(--text-mute)' }}>{w.value == null ? '—' : fmtSigned(w.value)}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 14px', alignItems: 'center' }}>
                <button className="pnl-btn ghost" disabled={busy || signed} onClick={() => act('/api/ipv/apply', {})}>APPLY OVERRIDES</button>
                <button className="pnl-btn" disabled={busy || signed || gate.length > 0} title={gate.length ? gate.join(' · ') : 'sign the official P&L'} onClick={() => act('/api/ipv/signoff', { comment: reason.trim() })}>{signed ? 'SIGNED' : 'SIGN OFF OFFICIAL P&L'}</button>
              </div>
              {gate.length > 0 && !signed && <div className="pnl-note" style={{ padding: '0 14px 10px' }}>blocked: {gate.join(' · ')}</div>}
            </section>
            <section className="pnl-panel">
              <header><span>AUDIT TRAIL</span><span className="pnl-sub">overrides and decisions on this date and scope</span></header>
              <div className="pnl-tree">
                {(run.overrides || []).map(o => (
                  <div key={o.id} className="pnl-tr d1" style={{ gridTemplateColumns: '7rem 1fr' }}>
                    <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{fmtT(o.at)}</span>
                    <span className="pnl-tn" style={{ whiteSpace: 'normal' }}>{o.author_name} · {o.curve_id} {o.pillar} {o.desk_value != null ? fmtQuote(o.desk_value) : ''} → {fmtQuote(o.override_value)} · {o.reason}</span>
                  </div>
                ))}
                {(run.inputs || []).filter(i => i.decision).map(i => (
                  <div key={i.curve_id} className="pnl-tr d1" style={{ gridTemplateColumns: '7rem 1fr' }}>
                    <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{fmtT(i.decision.at)}</span>
                    <span className="pnl-tn" style={{ whiteSpace: 'normal' }}>{i.decision.by} · {i.curve_id} {i.decision.state.toLowerCase()}{i.decision.reason ? ` · ${i.decision.reason}` : ''}</span>
                  </div>
                ))}
                {!(run.overrides || []).length && !(run.inputs || []).some(i => i.decision) && <div className="pnl-empty">Nothing yet.</div>}
              </div>
            </section>
          </div>
        </div>
      </>)}
    </div>
  )
}

function Card({ label, big, sub, accent }) {
  return (
    <div className="pnl-card" style={accent ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="pnl-card-l" style={accent ? { color: 'var(--accent)' } : undefined}>{label}</div>
      <div className="pnl-card-b" style={accent ? { color: 'var(--accent)' } : undefined}>{big}</div>
      <div className="pnl-card-s">{sub}</div>
    </div>
  )
}

function OverrideCell({ p, input, drafts, setDrafts, onOverride, signed, small }) {
  const v = drafts[p.key] ?? (p.override != null ? String(p.override) : '')
  return (
    <input aria-label={`override ${p.key}`} value={v} placeholder="—" disabled={signed}
      onChange={e => setDrafts({ ...drafts, [p.key]: e.target.value })}
      onKeyDown={e => { if (e.key === 'Enter' && v !== '' && !isNaN(Number(v))) onOverride(input.curve_id, p.key, v) }}
      onBlur={() => { if (v !== '' && !isNaN(Number(v)) && Number(v) !== p.override) onOverride(input.curve_id, p.key, v) }}
      style={{ width: small ? 64 : 80, textAlign: 'right', background: 'var(--bg)', color: 'var(--amber)', border: '1px solid var(--border)', borderRadius: 2, padding: '2px 5px', ...mono, fontSize: small ? 11 : 12 }} />
  )
}

function PillarTable({ input, drafts, setDrafts, onOverride, onWithdraw, signed }) {
  const rows = pillarRows(input)
  const g = '5rem 6rem 6rem 6rem 5rem 8rem 8rem 5rem 7rem'
  return (
    <div className="pnl-tree">
      <div className="pnl-tr head" style={{ gridTemplateColumns: g }}>
        <span className="pnl-tn">PILLAR</span><span className="pnl-tv">DESK</span><span className="pnl-tv">INDEP.</span><span className="pnl-tv">OVERRIDE</span><span className="pnl-tv">SHIFT</span><span className="pnl-tv">{sensLabel(input.kind)}</span><span className="pnl-tv">IMPACT</span><span className="pnl-tv">TOL</span><span className="pnl-tv" style={{ textAlign: 'left' }}>STATUS</span>
      </div>
      {rows.map(p => (
        <div key={p.key} className="pnl-tr d1" style={{ gridTemplateColumns: g, alignItems: 'center' }}>
          <span className="pnl-tn" style={{ paddingLeft: 8 }}>{p.key}</span>
          <span className="pnl-tv">{fmtQuote(p.desk, input.kind)}</span>
          <span className="pnl-tv dim">{p.independent == null ? '—' : fmtQuote(p.independent, input.kind)}{p.gap != null ? <small> {fmtShift(p.gap, input.unit)}</small> : null}</span>
          <span className="pnl-tv" style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, alignItems: 'center' }}>
            <OverrideCell p={p} input={input} drafts={drafts} setDrafts={setDrafts} onOverride={onOverride} signed={signed} />
            {p.overrideId && !signed && <button className="pnl-btn ghost" style={{ padding: '1px 5px', fontSize: 10 }} title="withdraw the override" onClick={() => onWithdraw(p.overrideId)}>✕</button>}
          </span>
          <span className="pnl-tv" style={{ color: p.shift == null ? 'var(--text-mute)' : 'var(--amber)' }}>{p.shift == null ? '—' : fmtShift(p.shift, input.unit)}</span>
          <span className="pnl-tv dim">{fmtSigned(p.sensitivity)}</span>
          <span className="pnl-tv" style={{ color: p.impact < -0.5 ? 'var(--red)' : p.impact > 0.5 ? 'var(--up)' : 'var(--text-mute)' }}>{p.impact ? fmtSigned(p.impact) : '—'}</span>
          <span className="pnl-tv dim" title={p.tolSource}>{p.tol}{p.material ? '' : ' ·'}</span>
          <span className="pnl-tv" style={{ textAlign: 'left', color: PILLAR_COLOR[p.status], fontSize: 10 }}>{p.status}{p.material ? '' : <small className="pnl-note"> immaterial</small>}</span>
        </div>
      ))}
    </div>
  )
}

function Cell({ c, input, drafts, setDrafts, onOverride, signed }) {
  if (!c) return <div style={{ padding: 6, color: 'var(--text-mute)', ...mono, fontSize: 11 }}>—</div>
  const bg = c.status === 'OVERRIDDEN' ? 'rgba(224,179,65,0.08)' : c.status === 'REVIEW' ? 'rgba(240,130,140,0.08)' : 'var(--bg)'
  return (
    <div style={{ background: bg, border: `1px solid ${PILLAR_COLOR[c.status] || 'var(--border)'}`, borderRadius: 2, padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 2, ...mono }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{fmtQuote(c.desk, input.kind)}</span><span style={{ color: PILLAR_COLOR[c.status], fontSize: 10 }}>{c.gap != null ? fmtShift(c.gap, input.unit) : c.status === 'UNVERIFIED' ? 'no indep.' : ''}</span></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)' }}><span>vega {fmtSigned(c.sensitivity)}</span><span style={{ color: c.impact ? (c.impact < 0 ? 'var(--down)' : 'var(--up)') : 'var(--text-mute)' }}>{c.impact ? fmtSigned(c.impact) : ''}</span></div>
      <OverrideCell p={c} input={input} drafts={drafts} setDrafts={setDrafts} onOverride={onOverride} signed={signed} small />
    </div>
  )
}

function SurfaceGrid({ input, drafts, setDrafts, onOverride, signed }) {
  const g = surfaceGrid(input)
  return (
    <div style={{ padding: '6px 14px', overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `5rem repeat(${Math.max(g.tenors.length, 1)}, minmax(7rem, 1fr))`, gap: 6, ...mono, fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 4 }}>
        <span>EXPIRY ↓ TENOR →</span>{g.tenors.map(t => <span key={t} style={{ textAlign: 'center' }}>{t}</span>)}
      </div>
      {g.expiries.map(e => (
        <div key={e} style={{ display: 'grid', gridTemplateColumns: `5rem repeat(${Math.max(g.tenors.length, 1)}, minmax(7rem, 1fr))`, gap: 6, marginBottom: 6, alignItems: 'stretch' }}>
          <span style={{ ...mono, fontSize: 12, color: 'var(--text-dim)', alignSelf: 'center' }}>{e}</span>
          {g.tenors.map(t => <Cell key={t} c={g.cell(e, t)} input={input} drafts={drafts} setDrafts={setDrafts} onOverride={onOverride} signed={signed} />)}
        </div>
      ))}
    </div>
  )
}

function FxGrid({ input, drafts, setDrafts, onOverride, signed }) {
  const g = fxGrid(input)
  return (
    <div style={{ padding: '6px 14px', overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `5rem repeat(${Math.max(g.types.length, 1)}, minmax(7rem, 1fr))`, gap: 6, ...mono, fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 4 }}>
        <span>TENOR ↓</span>{g.types.map(t => <span key={t} style={{ textAlign: 'center' }}>{t}</span>)}
      </div>
      {g.tenors.map(tn => (
        <div key={tn} style={{ display: 'grid', gridTemplateColumns: `5rem repeat(${Math.max(g.types.length, 1)}, minmax(7rem, 1fr))`, gap: 6, marginBottom: 6, alignItems: 'stretch' }}>
          <span style={{ ...mono, fontSize: 12, color: 'var(--text-dim)', alignSelf: 'center' }}>{tn}</span>
          {g.types.map(t => <Cell key={t} c={g.cell(tn, t)} input={input} drafts={drafts} setDrafts={setDrafts} onOverride={onOverride} signed={signed} />)}
        </div>
      ))}
    </div>
  )
}
