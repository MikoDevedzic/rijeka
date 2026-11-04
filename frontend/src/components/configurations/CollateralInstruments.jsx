// configurations/CollateralInstruments.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// COLLATERAL INSTRUMENTS: what the firm can post or receive. The public seed (cash, government
// paper, stablecoins, generic tokenised fund and bill claims, cryptoassets) with the firm's own
// rows over it: a named fund, a sovereign token, an issuer's stablecoin, a yield override, a
// deactivation. Each instrument's class decides the rules (recognition, haircut, IM eligibility,
// HQLA); the instrument carries the economics (currency, issuer, rail, yield source, a negotiated
// haircut). GET/POST/DELETE /api/collateral/instruments.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import '../pnl/PnlPage.css'
import '../risk/RiskPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

async function api(path, opts = {}) {
  const s = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `${path} ${r.status}`)
  return j
}

const EMPTY = { code: '', name: '', cls: 'FUND_SHARES_TOKENISED', currency: 'USD', issuer: '', rail: 'on_chain', yield_kind: 'FIXED', yield_ref: '', yield_bp: '',
  chain_id: '', token_address: '', csa_haircut_pct: '', active: true, note: '' }
const CURVES = ['USD_SOFR', 'EUR_ESTR', 'GBP_SONIA', 'JPY_TONAR', 'CHF_SARON', 'AUD_AONIA', 'CAD_CORRA']
const inp = { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', borderRadius: 2, fontFamily: 'var(--mono)', fontSize: 12, width: '100%', boxSizing: 'border-box' }
const lbl = { display: 'block', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 3 }
const fmtBp = (v) => v == null ? '—' : `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(0)} bp`
const GRID = '7rem 1fr 11rem 4rem 7rem 5.5rem 9rem 6rem 7rem'

export default function CollateralInstruments() {
  const [view, setView] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const load = async () => { try { setView(await api('/api/collateral/instruments')) } catch (e) { setErr(e.message) } }
  useEffect(() => { load() }, [])
  const f = (patch) => setForm(p => ({ ...p, ...patch }))

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const body = { ...form, yield_bp: form.yield_bp === '' ? 0 : Number(form.yield_bp), chain_id: form.chain_id === '' ? null : Number(form.chain_id),
        csa_haircut_pct: form.csa_haircut_pct === '' ? null : Number(form.csa_haircut_pct), yield_ref: form.yield_kind === 'CURVE' ? form.yield_ref || 'USD_SOFR' : null,
        issuer: form.issuer || null, token_address: form.token_address || null, note: form.note || null }
      setView(await api('/api/collateral/instruments', { method: 'POST', body: JSON.stringify(body) }))
      setForm(EMPTY); setOpen(false)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const edit = (i) => {
    setForm({ code: i.code, name: i.name, cls: i.cls, currency: i.currency, issuer: i.issuer === '—' ? '' : (i.issuer || ''), rail: i.rail, yield_kind: i.yield_kind,
      yield_ref: i.yield_ref || '', yield_bp: i.yield_bp != null ? String(i.yield_bp) : '', chain_id: i.chain_id != null ? String(i.chain_id) : '',
      token_address: i.token_address || '', csa_haircut_pct: i.csa_haircut_pct != null ? String(i.csa_haircut_pct) : '', active: i.active !== false, note: i.note || '' })
    setOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const remove = async (code) => {
    if (!window.confirm(`Remove the firm's row ${code}? A seed entry returns to its seed values.`)) return
    setBusy(true); setErr(null)
    try { setView(await api(`/api/collateral/instruments/${code}`, { method: 'DELETE' })) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const rows = view?.instruments || []
  const classes = view?.classes || []
  const cls = classes.find(c => c.code === form.cls)

  return (
    <div className="pnl">
      <div className="pnl-bar">
        <div className="pnl-title">COLLATERAL INSTRUMENTS <span className="pnl-sub">what the firm can post or receive · the class sets the rules, the instrument the economics</span></div>
        <div className="pnl-ctl">
          {view && <span className={`pnl-chip ${view.writable ? 'ok' : 'amber'}`}>{view.writable ? `${rows.filter(r => r.firm).length} FIRM ROWS · ${rows.length} IN ALL` : 'MIGRATION PENDING · SEED ONLY'}</span>}
          {view?.asof && <span className="pnl-chip">YIELDS AS OF {view.asof}</span>}
          <button className="pnl-btn" disabled={!view?.writable} onClick={() => { setForm(EMPTY); setOpen(o => !o) }}>{open ? 'CLOSE' : '+ INSTRUMENT'}</button>
        </div>
      </div>
      {err && <div className="pnl-err">{err}</div>}
      {!view && !err && <div className="pnl-empty">Loading…</div>}

      {view && open && (
        <section className="pnl-panel" style={{ maxWidth: 1100 }}>
          <header><span>{rows.some(r => r.code === form.code) ? `EDIT · ${form.code}` : 'NEW INSTRUMENT'}</span><span className="pnl-sub">a firm row with a seed's code replaces that seed entry for this firm</span></header>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <div><label style={lbl}>CODE *</label><input style={inp} value={form.code} onChange={e => f({ code: e.target.value.toUpperCase() })} placeholder="MY_FUND" /></div>
            <div><label style={lbl}>NAME</label><input style={inp} value={form.name} onChange={e => f({ name: e.target.value })} placeholder="The fund's legal name" /></div>
            <div><label style={lbl}>CLASS <span style={{ opacity: .6 }}>(the rulebook)</span></label>
              <select style={inp} value={form.cls} onChange={e => f({ cls: e.target.value })}>{classes.map(c => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}</select></div>
            <div><label style={lbl}>CURRENCY</label><input style={inp} value={form.currency} onChange={e => f({ currency: e.target.value.toUpperCase() })} /></div>
            <div><label style={lbl}>ISSUER</label><input style={inp} value={form.issuer} onChange={e => f({ issuer: e.target.value })} /></div>
            <div><label style={lbl}>RAIL</label><select style={inp} value={form.rail} onChange={e => f({ rail: e.target.value })}><option value="bilateral">bilateral</option><option value="on_chain">on chain</option></select></div>
            <div><label style={lbl}>YIELD SOURCE</label>
              <select style={inp} value={form.yield_kind} onChange={e => f({ yield_kind: e.target.value })}><option value="CURVE">a curve's short rate + spread</option><option value="FIXED">a fixed rate</option><option value="NONE">none</option></select></div>
            {form.yield_kind === 'CURVE' && <div><label style={lbl}>CURVE</label><select style={inp} value={form.yield_ref || 'USD_SOFR'} onChange={e => f({ yield_ref: e.target.value })}>{CURVES.map(c => <option key={c}>{c}</option>)}</select></div>}
            {form.yield_kind !== 'NONE' && <div><label style={lbl}>{form.yield_kind === 'CURVE' ? 'SPREAD (bp)' : 'YIELD (bp)'}</label><input style={inp} inputMode="decimal" value={form.yield_bp} onChange={e => f({ yield_bp: e.target.value })} placeholder="0" /></div>}
            <div><label style={lbl}>CSA HAIRCUT % <span style={{ opacity: .6 }}>(blank = CRE22.49 row)</span></label><input style={inp} inputMode="decimal" value={form.csa_haircut_pct} onChange={e => f({ csa_haircut_pct: e.target.value })} /></div>
            {form.rail === 'on_chain' && <>
              <div><label style={lbl}>CHAIN ID</label><input style={inp} inputMode="numeric" value={form.chain_id} onChange={e => f({ chain_id: e.target.value.replace(/[^0-9]/g, '') })} placeholder="1" /></div>
              <div style={{ gridColumn: 'span 2' }}><label style={lbl}>TOKEN ADDRESS</label><input style={inp} value={form.token_address} onChange={e => f({ token_address: e.target.value })} placeholder="0x…" /></div>
            </>}
            <div style={{ gridColumn: 'span 3' }}><label style={lbl}>NOTE <span style={{ opacity: .6 }}>(the legal findings, the fund's prospectus, the source of the yield)</span></label><input style={inp} value={form.note} onChange={e => f({ note: e.target.value })} /></div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <label style={{ ...lbl, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 6, cursor: 'pointer' }}><input type="checkbox" checked={form.active} onChange={e => f({ active: e.target.checked })} /> ACTIVE</label>
            </div>
          </div>
          {cls && <div className="pnl-note" style={{ marginTop: 4 }}>
            {cls.code}: {cls.crm === 'NOT_RECOGNISED' ? 'not recognised as credit-risk mitigation' : cls.crm === 'LOOK_THROUGH' ? 'recognised by look-through' : 'recognised'} ·
            IM {cls.im_eligible.toLowerCase()} · VM {cls.vm_eligible.toLowerCase()} · HQLA {cls.hqla.length ? cls.hqla.join(' / ') : 'none'} ·
            haircut row {Object.entries(cls.haircuts_pct).map(([k, v]) => `${k} ${v}%`).join(', ')} · {cls.sources?.crm}
          </div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button className="pnl-btn" disabled={busy || !form.code} onClick={save}>{busy ? 'SAVING…' : 'SAVE INSTRUMENT'}</button>
            <button className="pnl-btn ghost" disabled={busy} onClick={() => { setForm(EMPTY); setOpen(false) }}>CANCEL</button>
          </div>
        </section>
      )}

      {view && (
        <section className="pnl-panel" style={{ maxWidth: 1400 }}>
          <header><span>INSTRUMENTS</span><span className="pnl-sub">yield today from the account's latest market; a seed entry edited here becomes a firm row</span></header>
          <div className="rk-rows">
            <div className="rk-row dim" style={{ gridTemplateColumns: GRID }}>
              <span>CODE</span><span>NAME · ISSUER</span><span>CLASS</span><span>CCY</span><span>RAIL</span><span className="pnl-tv dim">YIELD</span><span>YIELD SOURCE</span><span className="pnl-tv dim">HAIRCUT</span><span />
            </div>
            {rows.map(i => (
              <div key={i.code} className="rk-row" style={{ gridTemplateColumns: GRID, opacity: i.active ? 1 : 0.45 }}>
                <span className="rk-ref">{i.code}<small>{i.firm ? 'FIRM' : 'SEED'}{i.active ? '' : ' · OFF'}</small></span>
                <span className="pnl-tv dim" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{i.name}{i.issuer && i.issuer !== '—' ? ` · ${i.issuer}` : ''}{i.token_address ? <small style={{ display: 'block', color: 'var(--text-mute)' }}>{i.chain_id != null ? `chain ${i.chain_id} · ` : ''}{i.token_address}</small> : null}</span>
                <span className="pnl-tv dim" style={{ textAlign: 'left' }} title={`${i.crm} · IM ${i.im_eligible} · HQLA ${i.hqla.join('/') || 'none'}`}>{i.cls}</span>
                <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{i.currency}</span>
                <span className={`pnl-chip ${i.rail === 'on_chain' ? 'ok' : ''}`} style={{ justifySelf: 'start' }}>{i.rail === 'on_chain' ? 'ON CHAIN' : 'BILATERAL'}</span>
                <span className="pnl-tv">{fmtBp(i.yield_today_bp)}</span>
                <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{i.yield_kind === 'CURVE' ? `${i.yield_ref} ${i.yield_bp >= 0 ? '+' : '−'} ${Math.abs(i.yield_bp)} bp` : i.yield_kind === 'FIXED' ? 'fixed' : 'none'}</span>
                <span className="pnl-tv dim">{i.csa_haircut_pct != null ? `${i.csa_haircut_pct} %` : 'CRE22.49'}</span>
                <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button className="pnl-btn ghost" style={{ padding: '2px 6px' }} disabled={!view.writable || busy} onClick={() => edit(i)}>EDIT</button>
                  {i.firm && <button className="pnl-btn ghost" style={{ padding: '2px 6px', color: 'var(--red)' }} disabled={busy} onClick={() => remove(i.code)}>DEL</button>}
                </span>
              </div>
            ))}
          </div>
          {!view.writable && <div className="pnl-note">apply docs/migrations/2026-11-05_collateral.sql to add the firm's own instruments; the seed is served meanwhile</div>}
        </section>
      )}
    </div>
  )
}
