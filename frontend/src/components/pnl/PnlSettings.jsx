// pnl/PnlSettings.jsx — Configurations › P&L & CONTROL
//   /configurations/pnl/defaults     the desk and book the ticket starts on (per trader)
//   /configurations/pnl/conventions  the firm's P&L policy as the engine applies it (read-only)
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSessionMaybe } from '../../lib/session'
import './PnlPage.css'
import '../risk/RiskPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
async function api(path, opts = {}) {
  const s = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `${path} ${r.status}`)
  return j
}
const sel = { background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text-hi)', fontFamily: 'var(--mono)', fontSize: '0.82rem', padding: '0.35rem 0.5rem', borderRadius: 2, marginTop: 4 }

export function BookingDefaults() {
  const navigate = useNavigate()
  const [d, setD] = useState(null)
  const [desk, setDesk] = useState('')
  const [book, setBook] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('/api/me/booking-defaults').then(j => { setD(j); setDesk(j.default_desk || ''); setBook(j.default_book || '') }).catch(e => setMsg(e.message)) }, [])
  const save = async () => {
    setBusy(true); setMsg(null)
    try { const j = await api('/api/me/booking-defaults', { method: 'PUT', body: JSON.stringify({ default_desk: desk || null, default_book: book || null }) }); setD(j); setMsg('Saved. New tickets start on this desk and book.') }
    catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="pnl">
      <div className="pnl-bar"><div className="pnl-title">BOOKING DEFAULTS <span className="pnl-sub">where your tickets start</span></div></div>
      <section className="pnl-panel" style={{ maxWidth: 720 }}>
        <header><span>DEFAULT DESK AND BOOK</span><button className="pnl-btn ghost" onClick={() => navigate('/configurations/org-hierarchy')}>ORG HIERARCHY →</button></header>
        <p className="pnl-foot">A trade booked without a desk and book rolls up as UNASSIGNED on the P&amp;L report. The ticket starts on the pair chosen here; it can still be changed per trade. Desks and books come from your org hierarchy.</p>
        {!d && !msg && <div className="pnl-empty">Loading…</div>}
        {d && (
          <div className="pnl-cards" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="pnl-card"><span className="pnl-kl">DESK</span>
              <select value={desk} onChange={e => setDesk(e.target.value)} style={sel}><option value="">— none —</option>{d.desks.map(x => <option key={x} value={x}>{x}</option>)}</select>
              {!d.desks.length && <span className="pnl-note">No desks yet: add one in the org hierarchy.</span>}
            </label>
            <label className="pnl-card"><span className="pnl-kl">BOOK</span>
              <select value={book} onChange={e => setBook(e.target.value)} style={sel}><option value="">— none —</option>{d.books.map(x => <option key={x} value={x}>{x}</option>)}</select>
              {!d.books.length && <span className="pnl-note">No books yet: add one under a desk.</span>}
            </label>
          </div>
        )}
        <div className="pnl-sign-btns"><button className="pnl-btn" disabled={busy || !d} onClick={save}>{busy ? 'SAVING…' : 'SAVE DEFAULTS'}</button>{d && <span className="pnl-note">Your role: {String(d.role).toUpperCase()}</span>}</div>
        {msg && <div className="pnl-toast">{msg}</div>}
      </section>
    </div>
  )
}

const Row = ({ k, v }) => <div className="pnl-xr" style={{ gridTemplateColumns: '14rem 1fr' }}><span className="pnl-kl">{k}</span><span>{Array.isArray(v) ? v.join(' → ') : String(v)}</span></div>

export function PnlConventions() {
  const [c, setC] = useState(null)
  const [err, setErr] = useState(null)
  const [pol, setPol] = useState(null)
  const [msg, setMsg] = useState(null)
  const load = () => Promise.all([api('/api/pnl/conventions'), api('/api/pnl/policy')]).then(([a, b]) => { setC(a); setPol(b) }).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const setPolicy = async (p) => { try { await api('/api/pnl/policy', { method: 'PUT', body: JSON.stringify({ signoff_policy: p }) }); setMsg(`Sign-off policy set to ${p.replace('_', '-')} for the firm.`); await load() } catch (e) { setMsg(e.message) } }
  return (
    <div className="pnl">
      <div className="pnl-bar"><div className="pnl-title">P&amp;L CONVENTIONS <span className="pnl-sub">the policy as the engine applies it · read-only</span></div></div>
      {err && <div className="pnl-err">{err}</div>}
      {!c && !err && <div className="pnl-empty">Loading…</div>}
      {c && (<>
        <div className="pnl-grid">
          <section className="pnl-panel">
            <header><span>ATTRIBUTION</span><span className="pnl-sub">{c.attribution.method}</span></header>
            <Row k="STEP ORDER" v={c.attribution.order} />
            <Row k="TENOR BUCKETS" v={c.attribution.tenor_buckets} />
            <Row k="CURVE ORDER" v={c.attribution.curve_order} />
            <Row k="FX STEPS" v={c.attribution.fx_steps} />
            <Row k="RESIDUAL" v={c.attribution.residual} />
            <Row k="NEW TRADE" v={c.trading.new_trade} />
            <Row k="UNWIND" v={c.trading.unwind} />
          </section>
          <section className="pnl-panel">
            <header><span>MARKS AND MONEY</span><span className="pnl-sub">{c.reporting_ccy}</span></header>
            <Row k="MARKS" v={c.marks.source} />
            <Row k="MARKET DATES" v={c.marks.market_dates} />
            <Row k="FX CONVERSION" v={c.marks.fx_conversion} />
            <Row k="REPORTING CCY" v={c.reporting_ccy} />
            <Row k="END OF DAY" v={c.end_of_day.when} />
            <Row k="STORES" v={c.end_of_day.stores} />
            <Row k="RERUN" v={c.end_of_day.rerun} />
          </section>
        </div>
        <section className="pnl-panel">
          <header><span>SIGN-OFF AND ROLES</span><span className="pnl-sub">your role: {String(c.your_role).toUpperCase()}{c.you_may_sign_as_controller ? ' · may sign as controller' : ''}{c.you_may_see_the_firm ? ' · sees the firm' : ''}</span></header>
          <Row k="ORDER" v={c.sign_off.order} />
          <Row k="TRADER" v={c.sign_off.trader} />
          <Row k="CONTROLLER ROLES" v={c.sign_off.controller_roles.map(x => x.toUpperCase())} />
          <Row k="MANAGEMENT ROLES" v={c.sign_off.management_roles.map(x => x.toUpperCase())} />
          <Row k="FIRM ROLES THAT QUALIFY" v={c.sign_off.firm_roles_that_qualify} />
          <Row k="FINAL" v={c.sign_off.final} />
          {pol && (
            <div className="pnl-cards" style={{ gridTemplateColumns: '1fr 1fr', maxWidth: 720 }}>
              {[['TWO_PERSON', 'TWO-PERSON', 'The trader signs, then a different person with the controller, CFO or admin role. The desk has a control function.'],
                ['SINGLE', 'SINGLE', 'One signature finalises the day. A one-person desk, or a shop where the CFO is also risk and control.']].map(([k, l, d]) => (
                <button key={k} className="pnl-card" disabled={!pol.can_write} onClick={() => setPolicy(k)} style={{ textAlign: 'left', cursor: pol.can_write ? 'pointer' : 'default', borderColor: pol.signoff_policy === k ? 'var(--accent)' : 'var(--border)' }}>
                  <span className="pnl-kl">{l}{pol.signoff_policy === k ? ' · IN FORCE' : ''}</span><span className="rk-sub" style={{ color: 'var(--text)' }}>{d}</span>
                </button>))}
            </div>
          )}
          {msg && <div className="pnl-toast">{msg}</div>}
          <div className="pnl-foot">{c.policy_note} Roles are set by an admin on Configurations › Admin › Users; on the demo, from the role chip in the top bar. Controller, risk and management roles cannot book trades: the person who signs the day is not the person who traded it, unless the firm's policy says one person does both.
            {!c.history_tables && <> <em>History tables are not applied on this server ({c.migration}); sign-off is disabled until they are.</em></>}</div>
        </section>
      </>)}
    </div>
  )
}
