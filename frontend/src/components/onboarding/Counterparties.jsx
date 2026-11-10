import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useChatStore } from '../../store/useChatStore'
import { useModulesStore } from '../../store/useModulesStore'
import { getSessionMaybe } from '../../lib/session'
import { bodyFromForm, defaultForm, formFromSchedule, problems, rowFor, summary, total, EMPTY_SCHEDULE } from './collateral-schedule'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

const CSA_DISCOUNT_MAP = {
  USD: 'USD_SOFR',
  EUR: 'EUR_ESTR',
  GBP: 'GBP_SONIA',
  JPY: 'JPY_TONAR',
  CHF: 'CHF_SARON',
  AUD: 'AUD_AONIA',
  CAD: 'CAD_CORRA'
}
const CSA_CURRENCIES = ['USD','EUR','GBP','JPY','CHF','AUD','CAD']
const CSA_TYPES      = ['VM_ONLY','VM_IM','NO_CSA']
const IM_MODELS      = ['SIMM','GRID','SCHEDULE']
// capital attributes (pricing/capital.py, pricing/collateral.py); blank = the engine's defaults
const CP_TYPES       = ['', 'BANK','BROKER_DEALER','CORPORATE','FUND','SOVEREIGN','CRYPTO_NATIVE']
const RATINGS        = ['', 'AAA_AA','A','BBB','BB_B','BELOW_B','UNRATED']
const CVA_SECTORS    = ['', 'SOVEREIGN','LOCAL_GOVERNMENT','FINANCIAL','BASIC_MATERIALS','CONSUMER','TECHNOLOGY','HEALTH_UTILITIES','OTHER']

const CSA_COLOR = {
  VM_ONLY: 'var(--accent)',
  VM_IM:   'var(--blue)',
  NO_CSA:  'var(--amber)'
}

const EMPTY = {
  legal_entity_id:'', name:'', isda_agreement:'',
  csa_type:'VM_ONLY', csa_currency:'USD', csa_threshold_m:'',
  csa_mta_k:'', discount_curve_id:'USD_SOFR', im_model:'SIMM',
  counterparty_type:'', rating_bucket:'', cva_sector:'', umr_in_scope:false,
  netting_enforceable:true,
  margin_frequency_days:'', mpor_disputed:false
}

// The capital columns exist once docs/migrations/2026-11-04_counterparty_capital.sql is applied; before
// that the insert carries none of them so booking a counterparty keeps working.
function capitalFields(form) {
  var out = {}
  if (form.counterparty_type) out.counterparty_type = form.counterparty_type
  if (form.rating_bucket)     out.rating_bucket     = form.rating_bucket
  if (form.cva_sector)        out.cva_sector        = form.cva_sector
  if (form.umr_in_scope)      out.umr_in_scope      = true
  if (!form.netting_enforceable) out.netting_enforceable = false
  if (form.margin_frequency_days && parseInt(form.margin_frequency_days, 10) > 1) out.margin_frequency_days = parseInt(form.margin_frequency_days, 10)
  if (form.mpor_disputed) out.mpor_disputed = true
  return out
}

const L = {
  display:'block', fontSize:'12px', fontFamily:"'IBM Plex Mono',var(--mono)",
  color:'var(--text-dim)', letterSpacing:'0.08em', marginBottom:'4px'
}
const INP = {
  background:'var(--bg)', border:'1px solid var(--panel-3)',
  color:'var(--text)', fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'12px',
  padding:'5px 8px', borderRadius:'2px', outline:'none',
  width:'100%', boxSizing:'border-box'
}

function Btn({ color, size, onClick, disabled, children }) {
  const c = color || 'var(--accent)'
  const lg = size === 'lg'
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:'transparent',
      border:'1px solid ' + c,
      color: c,
      fontFamily:"'IBM Plex Mono',var(--mono)",
      fontSize: lg ? '12px' : '10px',
      padding: lg ? '6px 16px' : '3px 8px',
      borderRadius:'2px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      letterSpacing:'0.05em',
      opacity: disabled ? 0.5 : 1,
      whiteSpace:'nowrap'
    }}>{children}</button>
  )
}

function Badge({ color, children }) {
  return (
    <span style={{
      fontSize: '12px', fontFamily:"'IBM Plex Mono',var(--mono)", letterSpacing:'0.06em',
      padding:'2px 6px', borderRadius:'2px', whiteSpace:'nowrap',
      background:'color-mix(in srgb, ' + color + ' 14%, transparent)',
      color: color,
      border:'1px solid color-mix(in srgb, ' + color + ' 35%, transparent)'
    }}>{children}</span>
  )
}

function Cell({ children, dim }) {
  return (
    <div style={{
      fontSize: '12px', fontFamily:"'IBM Plex Mono',var(--mono)",
      color: dim ? 'var(--text-dim)' : 'var(--text)',
      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'
    }}>{children || '—'}</div>
  )
}

const COLS = '1fr 130px 80px 48px 110px 1fr 200px'
const SCHED_COLS = '9rem 10rem 6rem 5rem 2.2rem 2.2rem 6rem 6rem 6.5rem 1.5rem'

export default function Counterparties() {
  const capitalOn = useModulesStore(s => s.modules.CAPITAL !== false)
  const [chatErr,      setChatErr]      = useState(null)
  const [cps,          setCps]          = useState([])
  const [les,          setLes]          = useState([])
  const [loading,      setLoading]      = useState(true)
  const [showAdd,      setShowAdd]      = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [form,         setForm]         = useState(EMPTY)
  const [saving,       setSaving]       = useState(false)
  const [editId,       setEditId]       = useState(null)
  const [editName,     setEditName]     = useState('')
  const [editCp,       setEditCp]       = useState(null)      // the counterparty whose terms the form edits (null = a new one)
  const editRef = useRef(null)
  const [instruments,  setInstruments]  = useState([])      // the firm's collateral instruments (seed plus its own rows)
  const [schedules,    setSchedules]    = useState({})      // {counterparty id: the schedule in force}, for the list
  const [sched,        setSched]        = useState(EMPTY_SCHEDULE)   // the editor's schedule for the counterparty in the form
  const [schedMsg,     setSchedMsg]     = useState(null)

  useEffect(function() { load() }, [])

  // auto-map discount curve when CSA currency changes
  useEffect(function() {
    var mapped = CSA_DISCOUNT_MAP[form.csa_currency]
    if (mapped) {
      setForm(function(prev) { return Object.assign({}, prev, { discount_curve_id: mapped }) })
    }
    if (!editCp) setSched(defaultForm(form.csa_currency, instruments))   // a new counterparty: the default schedule follows the CSA currency
  }, [form.csa_currency])

  useEffect(function() { if (editRef.current) editRef.current.focus() }, [editId])

  async function load() {
    setLoading(true)
    var [cpRes, leRes] = await Promise.all([
      supabase.from('counterparties')
        .select('*, legal_entity:legal_entity_id(name, short_name, lei)')
        .order('name'),
      supabase.from('legal_entities')
        .select('id, name, short_name')
        .eq('is_active', true)
        .order('name')
    ])
    setCps(cpRes.data || [])
    setLes(leRes.data || [])
    setLoading(false)
    try {
      var session = await getSessionMaybe()
      var h = { Authorization: 'Bearer ' + (session ? session.access_token : '') }
      var [ri, rs] = await Promise.all([fetch(API + '/api/collateral/instruments', { headers: h }), fetch(API + '/api/collateral/schedules', { headers: h })])
      if (ri.ok) { var ji = await ri.json(); setInstruments(ji.instruments || []) }
      if (rs.ok) { var js = await rs.json(); setSchedules(js.schedules || {}) }
    } catch (e) { setSchedMsg('collateral instruments: ' + e.message) }
  }

  // The schedule travels after the record: a new version for this counterparty, the record's class fields follow it.
  async function saveSchedule(cpId) {
    if (form.csa_type === 'NO_CSA' || !sched.rows.length) return
    try {
      var session = await getSessionMaybe()
      var r = await fetch(API + '/api/collateral/schedule/' + cpId, { method: 'PUT',
        headers: { Authorization: 'Bearer ' + (session ? session.access_token : ''), 'Content-Type': 'application/json' }, body: JSON.stringify(bodyFromForm(sched)) })
      var j = await r.json().catch(function() { return {} })
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'schedule not saved (' + r.status + ')')
      setSchedMsg(null)
    } catch (e) {
      setSchedMsg('terms saved; the collateral schedule was not: ' + e.message)
    }
  }

  function f(patch) {
    setForm(function(prev) { return Object.assign({}, prev, patch) })
  }

  async function save() {
    if (!form.name.trim()) {
      alert('Name is required.')
      return
    }
    setSaving(true)
    var hasCSA = form.csa_type !== 'NO_CSA'
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { alert('Not signed in — reload and sign in again.'); setSaving(false); return }
    const { data: created, error } = await supabase.from('counterparties').insert({
      legal_entity_id:   form.legal_entity_id || null,
      name:              form.name.trim().toUpperCase(),
      isda_agreement:    form.isda_agreement.trim() || null,
      csa_type:          form.csa_type,
      csa_currency:      hasCSA ? form.csa_currency : null,
      csa_threshold_m:   hasCSA && form.csa_threshold_m
        ? parseFloat(form.csa_threshold_m) : null,
      csa_mta_k:         hasCSA && form.csa_mta_k
        ? parseFloat(form.csa_mta_k) : null,
      discount_curve_id: hasCSA ? (form.discount_curve_id || null) : null,
      im_model:          form.im_model,
      ...capitalFields(form),
      created_by:        user ? user.id : null,
      // Tenancy key — see LegalEntities.save(). RLS WITH CHECK requires it.
      user_id:           user ? user.id : null
    }).select('id').single()
    if (!error) {
      if (created && created.id) await saveSchedule(created.id)
      setShowAdd(false)
      setForm(EMPTY)
      await load()
    } else {
      alert('Save failed: ' + error.message)
    }
    setSaving(false)
  }

  function formFrom(cp) {
    return Object.assign({}, EMPTY, {
      legal_entity_id: cp.legal_entity_id || '', name: cp.name || '', isda_agreement: cp.isda_agreement || '',
      csa_type: cp.csa_type || 'NO_CSA', csa_currency: cp.csa_currency || 'USD',
      csa_threshold_m: cp.csa_threshold_m != null ? String(cp.csa_threshold_m) : '', csa_mta_k: cp.csa_mta_k != null ? String(cp.csa_mta_k) : '',
      discount_curve_id: cp.discount_curve_id || 'USD_SOFR', im_model: cp.im_model || 'SIMM',
      counterparty_type: cp.counterparty_type || '', rating_bucket: cp.rating_bucket || '', cva_sector: cp.cva_sector || '',
      umr_in_scope: !!cp.umr_in_scope,
      netting_enforceable: cp.netting_enforceable !== false,
      margin_frequency_days: cp.margin_frequency_days ? String(cp.margin_frequency_days) : '', mpor_disputed: !!cp.mpor_disputed
    })
  }

  async function startEdit(cp) {
    setEditCp(cp)
    setForm(formFrom(cp))
    setShowAdd(true)
    setSched(defaultForm(cp.csa_currency || 'USD', instruments))
    try {
      var session = await getSessionMaybe()
      var r = await fetch(API + '/api/collateral/schedule/' + cp.id, { headers: { Authorization: 'Bearer ' + (session ? session.access_token : '') } })
      if (r.ok) { var j = await r.json(); if (j.schedule) setSched(formFromSchedule(j.schedule)) }
    } catch { /* the default stays */ }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveEdit() {
    setSaving(true)
    var hasCSA = form.csa_type !== 'NO_CSA'
    var body = {
      name: form.name.trim().toUpperCase(),
      isda_agreement: form.isda_agreement.trim() || null,
      csa_type: form.csa_type,
      csa_currency: hasCSA ? form.csa_currency : null,
      csa_threshold_m: hasCSA && form.csa_threshold_m !== '' ? parseFloat(form.csa_threshold_m) : (hasCSA ? null : null),
      csa_mta_k: hasCSA && form.csa_mta_k !== '' ? parseFloat(form.csa_mta_k) : null,
      discount_curve_id: hasCSA ? (form.discount_curve_id || null) : null,
      im_model: form.im_model,
      // the capital attributes travel explicitly so a cleared field is cleared, not kept
      counterparty_type: form.counterparty_type || null, rating_bucket: form.rating_bucket || null, cva_sector: form.cva_sector || null,
      umr_in_scope: !!form.umr_in_scope, netting_enforceable: !!form.netting_enforceable,
      margin_frequency_days: form.margin_frequency_days ? parseInt(form.margin_frequency_days, 10) : 1, mpor_disputed: !!form.mpor_disputed
    }
    try {
      var session = await getSessionMaybe()
      var r = await fetch(API + '/api/counterparties/' + editCp.id, { method: 'PUT',
        headers: { Authorization: 'Bearer ' + (session ? session.access_token : ''), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      var j = await r.json().catch(function() { return {} })
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'save failed (' + r.status + ')')
      await saveSchedule(editCp.id)
      setShowAdd(false); setEditCp(null); setForm(EMPTY)
      await load()
    } catch (e) {
      alert('Save failed: ' + e.message)
    }
    setSaving(false)
  }

  async function commitRename(id) {
    var n = editName.trim().toUpperCase()
    setEditId(null)
    if (!n) return
    await supabase.from('counterparties').update({ name: n }).eq('id', id)
    await load()
  }

  async function toggle(id, val) {
    await supabase.from('counterparties').update({ is_active: val }).eq('id', id)
    await load()
  }

  async function hardDelete(id) {
    if (!window.confirm('Permanently delete this counterparty? This cannot be undone.')) return
    await supabase.from('counterparties').delete().eq('id', id)
    await load()
  }

  var active   = cps.filter(function(c) { return c.is_active })
  var inactive = cps.filter(function(c) { return !c.is_active })
  var visible  = showInactive ? cps : active

  var hasCSA = form.csa_type !== 'NO_CSA'


  // Open the messenger on a chat with the person at the firm that claims
  // this LEI (or a picker, when that firm has several people on Rijeka).
  async function openChat(cp) {
    setChatErr(null)
    try {
      await useChatStore.getState().chatWithLei(cp.legal_entity.lei)
    } catch (e) {
      setChatErr(cp.name + ': ' + e.message)
    }
  }

  return (
    <div style={{ padding:'24px', maxWidth:'1400px' }}>

      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'flex-start',
          justifyContent:'space-between', marginBottom:'20px' }}>
        <div>
          <div style={{ fontSize:'12px', color:'var(--accent)', fontFamily:"'IBM Plex Mono',var(--mono)",
              letterSpacing:'0.1em', marginBottom:'4px' }}>
            CONFIGURATIONS / ONBOARDING
          </div>
          <h1 style={{ fontSize:'20px', color:'var(--text)', fontFamily:"'IBM Plex Mono',var(--mono)",
              fontWeight:400, margin:0 }}>
            COUNTERPARTIES
          </h1>
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center', paddingTop:'4px' }}>
          {inactive.length > 0 && (
            <Btn color='var(--amber)'
              onClick={function() { setShowInactive(function(s) { return !s }) }}>
              {showInactive
                ? '▲ HIDE INACTIVE'
                : '▼ INACTIVE (' + inactive.length + ')'}
            </Btn>
          )}
          <Btn onClick={function() {
            setShowAdd(function(s) { return !s })
            setEditCp(null)
            setForm(EMPTY)
            setSched(defaultForm('USD', instruments))
          }}>
            {showAdd ? '✕ CANCEL' : '+ ADD COUNTERPARTY'}
          </Btn>
        </div>
      </div>

      {/* ── Add Form ── */}
      {showAdd && (
        <div style={{
          border:'1px dashed var(--accent)', borderRadius:'4px',
          padding:'20px', marginBottom:'20px', background:'var(--panel)'
        }}>
          <div style={{ fontSize: '12px', color:'var(--accent)', fontFamily:"'IBM Plex Mono',var(--mono)",
              letterSpacing:'0.08em', marginBottom:'16px' }}>
            {editCp ? 'EDIT TERMS · ' + editCp.name : 'NEW COUNTERPARTY'}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px' }}>

            <div>
              <label style={L}>NAME *</label>
              <input style={INP} value={form.name}
                placeholder="GOLDMAN SACHS INTL"
                onChange={function(e) { f({ name: e.target.value }) }} />
            </div>
            <div>
              <label style={L}>LEGAL ENTITY</label>
              <select style={Object.assign({}, INP, { cursor:'pointer' })}
                value={form.legal_entity_id}
                onChange={function(e) { f({ legal_entity_id: e.target.value }) }}>
                <option value="">— NONE —</option>
                {les.map(function(le) {
                  return (
                    <option key={le.id} value={le.id}>
                      {le.short_name ? le.short_name + ' — ' : ''}{le.name}
                    </option>
                  )
                })}
              </select>
            </div>
            <div>
              <label style={L}>ISDA AGREEMENT</label>
              <input style={INP} value={form.isda_agreement}
                placeholder="ISDA 2002 MASTER"
                onChange={function(e) { f({ isda_agreement: e.target.value }) }} />
            </div>

            <div>
              <label style={L}>CSA TYPE</label>
              <select style={Object.assign({}, INP, { cursor:'pointer' })}
                value={form.csa_type}
                onChange={function(e) { f({ csa_type: e.target.value }) }}>
                {CSA_TYPES.map(function(t) { return <option key={t}>{t}</option> })}
              </select>
            </div>

            {hasCSA && <>
              <div>
                <label style={L}>CSA CURRENCY</label>
                <select style={Object.assign({}, INP, { cursor:'pointer' })}
                  value={form.csa_currency}
                  onChange={function(e) { f({ csa_currency: e.target.value }) }}>
                  {CSA_CURRENCIES.map(function(c) { return <option key={c}>{c}</option> })}
                </select>
              </div>
              <div>
                <label style={L}>DISCOUNT CURVE <span style={{ opacity:.6, fontSize: '12px' }}>(auto-mapped)</span></label>
                <input style={INP} value={form.discount_curve_id}
                  onChange={function(e) { f({ discount_curve_id: e.target.value }) }} />
              </div>
              <div>
                <label style={L}>CSA THRESHOLD (M)</label>
                <input style={INP} type="number" step="0.01"
                  value={form.csa_threshold_m} placeholder="50.00"
                  onChange={function(e) { f({ csa_threshold_m: e.target.value }) }} />
              </div>
              <div>
                <label style={L}>CSA MTA (K)</label>
                <input style={INP} type="number" step="0.001"
                  value={form.csa_mta_k} placeholder="0.500"
                  onChange={function(e) { f({ csa_mta_k: e.target.value }) }} />
              </div>
            </>}

            <div>
              <label style={L}>IM MODEL</label>
              <select style={Object.assign({}, INP, { cursor:'pointer' })}
                value={form.im_model}
                onChange={function(e) { f({ im_model: e.target.value }) }}>
                {IM_MODELS.map(function(m) { return <option key={m}>{m}</option> })}
              </select>
            </div>

            <div>
              <label style={L}>TYPE <span style={{ opacity:.6 }}>(CRE20 risk weight)</span></label>
              <select style={Object.assign({}, INP, { cursor:'pointer' })}
                value={form.counterparty_type}
                onChange={function(e) { f({ counterparty_type: e.target.value }) }}>
                {CP_TYPES.map(function(t) { return <option key={t} value={t}>{t || '— DEFAULT (CORPORATE) —'}</option> })}
              </select>
            </div>
            <div>
              <label style={L}>RATING BUCKET</label>
              <select style={Object.assign({}, INP, { cursor:'pointer' })}
                value={form.rating_bucket}
                onChange={function(e) { f({ rating_bucket: e.target.value }) }}>
                {RATINGS.map(function(t) { return <option key={t} value={t}>{t || '— DEFAULT (UNRATED) —'}</option> })}
              </select>
            </div>
            <div>
              <label style={L}>CVA SECTOR <span style={{ opacity:.6 }}>(MAR50.16)</span></label>
              <select style={Object.assign({}, INP, { cursor:'pointer' })}
                value={form.cva_sector}
                onChange={function(e) { f({ cva_sector: e.target.value }) }}>
                {CVA_SECTORS.map(function(t) { return <option key={t} value={t}>{t || '— BY TYPE —'}</option> })}
              </select>
            </div>
            <div>
              <label style={L}>CLOSE-OUT NETTING · UMR</label>
              <div style={{ display:'flex', gap:'12px', alignItems:'center', fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'11px', color:'var(--text-dim)' }}>
                <label style={{ display:'flex', gap:'4px', alignItems:'center', cursor:'pointer' }}>
                  <input type="checkbox" checked={form.netting_enforceable} onChange={function(e) { f({ netting_enforceable: e.target.checked }) }} /> ENFORCEABLE
                </label>
                <label style={{ display:'flex', gap:'4px', alignItems:'center', cursor:'pointer' }}>
                  <input type="checkbox" checked={form.umr_in_scope} onChange={function(e) { f({ umr_in_scope: e.target.checked }) }} /> UMR IN SCOPE
                </label>
              </div>
            </div>
            <div>
              <label style={L}>MARGIN FREQUENCY <span style={{ opacity:.6 }}>(business days; MPoR 9 + N, CRE52.50)</span></label>
              <div style={{ display:'flex', gap:'12px', alignItems:'center' }}>
                <input style={Object.assign({}, INP, { width:'70px' })} type="number" min="1" max="60" step="1" placeholder="1"
                  value={form.margin_frequency_days}
                  onChange={function(e) { f({ margin_frequency_days: e.target.value }) }} />
                <label style={{ display:'flex', gap:'4px', alignItems:'center', cursor:'pointer', fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'11px', color:'var(--text-dim)' }}>
                  <input type="checkbox" checked={form.mpor_disputed} onChange={function(e) { f({ mpor_disputed: e.target.checked }) }} /> DISPUTED (floor doubled, CRE52.51)
                </label>
              </div>
            </div>

            {hasCSA && (
              <div style={{ gridColumn:'1 / span 3', borderTop:'1px solid var(--panel-3)', paddingTop:'12px' }}>
                <label style={L}>COLLATERAL SCHEDULE <span style={{ opacity:.6 }}>(the CSA's eligible-collateral annex: what is admitted, what is posted and received, the rail · instruments under Configurations → Collateral)</span></label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'8px' }}>
                  {instruments.filter(function(i) { return i.active !== false }).map(function(i) {
                    var on = sched.rows.some(function(r) { return r.instrument === i.code })
                    return (
                      <button key={i.code} type="button" title={i.name + ' · ' + i.cls + (i.yield_today_bp != null ? ' · ' + Math.round(i.yield_today_bp) + ' bp' : '')}
                        onClick={function() { setSched(function(p) { return Object.assign({}, p, { rows: on ? p.rows.filter(function(r) { return r.instrument !== i.code }) : p.rows.concat([rowFor(i.code)]) }) }) }}
                        style={{ background: on ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent', border:'1px solid ' + (on ? 'var(--accent)' : 'var(--panel-3)'),
                          color: on ? 'var(--accent)' : 'var(--text-dim)', fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'10px', padding:'3px 8px', borderRadius:'2px', cursor:'pointer', letterSpacing:'0.05em' }}>
                        {i.code}
                      </button>
                    )
                  })}
                  {!instruments.length && <span style={{ fontSize:'11px', color:'var(--text-dim)', fontFamily:"'IBM Plex Mono',var(--mono)" }}>no instruments loaded</span>}
                </div>
                {sched.rows.length > 0 && (
                  <div style={{ border:'1px solid var(--panel-3)', borderRadius:'2px', overflow:'hidden' }}>
                    <div style={{ display:'grid', gridTemplateColumns:SCHED_COLS, gap:'6px', padding:'5px 8px', background:'var(--panel-2)', fontSize:'10px', letterSpacing:'0.08em', color:'var(--text-dim)', fontFamily:"'IBM Plex Mono',var(--mono)" }}>
                      <span>INSTRUMENT</span><span>CLASS</span><span>RAIL</span><span style={{ textAlign:'right' }}>YIELD</span><span>VM</span><span>IM</span><span>HAIRCUT %</span><span>POSTED %</span><span>RECEIVED %</span><span />
                    </div>
                    {sched.rows.map(function(r, idx) {
                      var inst = instruments.find(function(i) { return i.code === r.instrument }) || {}
                      var set = function(patch) { setSched(function(p) { return Object.assign({}, p, { rows: p.rows.map(function(x, k) { return k === idx ? Object.assign({}, x, patch) : x }) }) }) }
                      return (
                        <div key={r.instrument} style={{ display:'grid', gridTemplateColumns:SCHED_COLS, gap:'6px', padding:'4px 8px', alignItems:'center', borderTop:'1px solid var(--panel-3)', fontSize:'11px', fontFamily:"'IBM Plex Mono',var(--mono)" }}>
                          <span style={{ color:'var(--text)' }}>{r.instrument}</span>
                          <span style={{ color:'var(--text-dim)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={inst.class_label}>{inst.cls || '—'}</span>
                          <span style={{ color: inst.rail === 'on_chain' ? 'var(--accent)' : 'var(--text-dim)' }}>{inst.rail === 'on_chain' ? 'ON CHAIN' : 'BILATERAL'}</span>
                          <span style={{ textAlign:'right', color:'var(--text-dim)' }}>{inst.yield_today_bp != null ? Math.round(inst.yield_today_bp) + ' bp' : '—'}</span>
                          <input type="checkbox" checked={r.vm} onChange={function(e) { set({ vm: e.target.checked }) }} aria-label="admitted for VM" />
                          <input type="checkbox" checked={r.im} onChange={function(e) { set({ im: e.target.checked }) }} aria-label="admitted for IM" />
                          <input style={Object.assign({}, INP, { padding:'3px 6px' })} inputMode="decimal" placeholder={inst.csa_haircut_pct != null ? String(inst.csa_haircut_pct) : 'CRE22.49'} value={r.csa_haircut_pct} onChange={function(e) { set({ csa_haircut_pct: e.target.value }) }} />
                          <input style={Object.assign({}, INP, { padding:'3px 6px' })} inputMode="decimal" placeholder="0" value={r.posted} onChange={function(e) { set({ posted: e.target.value }) }} />
                          <input style={Object.assign({}, INP, { padding:'3px 6px' })} inputMode="decimal" placeholder="0" value={r.received} onChange={function(e) { set({ received: e.target.value }) }} />
                          <button type="button" onClick={function() { setSched(function(p) { return Object.assign({}, p, { rows: p.rows.filter(function(x) { return x.instrument !== r.instrument }) }) }) }}
                            style={{ background:'transparent', border:'none', color:'var(--text-dim)', cursor:'pointer', fontSize:'11px' }} title="remove from the schedule">✕</button>
                        </div>
                      )
                    })}
                    <div style={{ display:'grid', gridTemplateColumns:SCHED_COLS, gap:'6px', padding:'4px 8px', borderTop:'1px solid var(--panel-3)', fontSize:'10px', color:'var(--text-dim)', fontFamily:"'IBM Plex Mono',var(--mono)" }}>
                      <span style={{ gridColumn:'1 / span 7' }}>weights are normalised on save; blank haircut = the class's CRE22.49 row</span>
                      <span>Σ {Math.round(total(sched, 'posted'))}</span><span>Σ {Math.round(total(sched, 'received'))}</span><span />
                    </div>
                  </div>
                )}
                <div style={{ display:'flex', gap:'16px', alignItems:'center', marginTop:'8px', flexWrap:'wrap' }}>
                  <label style={{ display:'flex', gap:'6px', alignItems:'center', fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'11px', color:'var(--text-dim)' }}>
                    RAIL
                    <select style={Object.assign({}, INP, { width:'140px', cursor:'pointer' })} value={sched.rail} onChange={function(e) { setSched(function(p) { return Object.assign({}, p, { rail: e.target.value }) }) }}>
                      <option value="bilateral">BILATERAL</option>
                      <option value="on_chain">ON CHAIN (atomic settlement, 5bd MPoR)</option>
                    </select>
                  </label>
                  <input style={Object.assign({}, INP, { flex:'1 1 240px' })} placeholder="note (the annex reference, the legal findings)" value={sched.note} onChange={function(e) { setSched(function(p) { return Object.assign({}, p, { note: e.target.value }) }) }} />
                </div>
                {problems(sched).map(function(m) { return <div key={m} style={{ marginTop:'4px', fontSize:'11px', color:'var(--amber)', fontFamily:"'IBM Plex Mono',var(--mono)" }}>{m}</div> })}
              </div>
            )}

          </div>

          {!hasCSA && (
            <div style={{ marginTop:'12px', fontSize:'12px', fontFamily:"'IBM Plex Mono',var(--mono)",
                color:'var(--amber)', opacity:.7 }}>
              NO_CSA — CSA fields will be stored as null
            </div>
          )}

          <div style={{ marginTop:'16px' }}>
            <Btn size='lg' onClick={editCp ? saveEdit : save} disabled={saving || (hasCSA && sched.rows.length > 0 && problems(sched).length > 0)}>
              {saving ? 'SAVING...' : editCp ? 'SAVE TERMS' : 'SAVE COUNTERPARTY'}
            </Btn>
            {editCp && <span style={{ marginLeft:'12px', fontSize:'11px', color:'var(--text-dim)', fontFamily:"'IBM Plex Mono',var(--mono)" }}>
              {capitalOn ? "the CSA terms and the collateral schedule feed the credit report, the ticket's XVA and CAPITAL tabs and Risk → CAPITAL"
                         : "the CSA terms and the collateral schedule feed the credit report and the ticket's XVA tab"}
            </span>}
          </div>
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div style={{ color:'var(--text-dim)', fontFamily:"'IBM Plex Mono',var(--mono)",
            fontSize:'12px', padding:'60px 0', textAlign:'center' }}>
          LOADING...
        </div>
      ) : visible.length === 0 ? (
        <div style={{ color:'var(--text-dim)', fontFamily:"'IBM Plex Mono',var(--mono)",
            fontSize:'12px', padding:'60px 0', textAlign:'center' }}>
          NO COUNTERPARTIES — CLICK + ADD COUNTERPARTY
        </div>
      ) : (
        <div style={{ border:'1px solid var(--panel-3)', borderRadius:'4px', overflow:'hidden' }}>

          {/* Header */}
          <div style={{ display:'grid', gridTemplateColumns:COLS,
              padding:'8px 12px', gap:'8px', background:'var(--panel-2)',
              borderBottom:'1px solid var(--panel-3)' }}>
            {['NAME','LEGAL ENTITY','CSA TYPE','CCY','DISCOUNT CURVE','IM · TYPE · TERMS','ACTIONS']
              .map(function(h) {
                return (
                  <div key={h} style={{ fontSize:'12px', fontFamily:"'IBM Plex Mono',var(--mono)",
                      color:'var(--text-dim)', letterSpacing:'0.08em' }}>{h}</div>
                )
              })}
          </div>

          {/* Rows */}
          {visible.map(function(cp) {
            var csaColor = CSA_COLOR[cp.csa_type] || 'var(--text-dim)'
            var leLabel  = cp.legal_entity
              ? (cp.legal_entity.short_name || cp.legal_entity.name)
              : null
            return (
              <div key={cp.id} style={{
                display:'grid', gridTemplateColumns:COLS,
                padding:'10px 12px', gap:'8px', alignItems:'center',
                borderLeft:'2px solid ' + csaColor,
                borderBottom:'1px solid var(--panel-3)',
                background: cp.is_active ? 'var(--panel)' : 'transparent',
                opacity: cp.is_active ? 1 : 0.48
              }}>

                {editId === cp.id
                  ? <input ref={editRef}
                      style={Object.assign({}, INP, { fontSize:'12px' })}
                      value={editName}
                      onChange={function(ev) { setEditName(ev.target.value) }}
                      onBlur={function() { commitRename(cp.id) }}
                      onKeyDown={function(ev) {
                        if (ev.key === 'Enter')  commitRename(cp.id)
                        if (ev.key === 'Escape') setEditId(null)
                      }} />
                  : <div
                      style={{ fontSize:'12px', fontFamily:"'IBM Plex Mono',var(--mono)",
                          color:'var(--text)', cursor:'pointer',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                      onDoubleClick={function() {
                        setEditId(cp.id)
                        setEditName(cp.name)
                      }}
                      title="Double-click to rename">
                      {cp.name}
                    </div>
                }

                <Cell dim>{leLabel}</Cell>

                <div>
                  <Badge color={csaColor}>{cp.csa_type}</Badge>
                </div>

                <Cell dim>{cp.csa_currency}</Cell>
                <Cell dim>{cp.discount_curve_id}</Cell>
                <Cell dim>{cp.im_model}{cp.counterparty_type ? ' · ' + cp.counterparty_type + (cp.rating_bucket ? ' ' + cp.rating_bucket : '') : ''}{cp.csa_type && cp.csa_type !== 'NO_CSA' ? ' · thr ' + (cp.csa_threshold_m != null ? cp.csa_threshold_m + 'm' : '0') + ' · mta ' + (cp.csa_mta_k != null ? cp.csa_mta_k + 'k' : '0') + (cp.margin_frequency_days > 1 ? ' · every ' + cp.margin_frequency_days + 'bd' : '') + (cp.mpor_disputed ? ' · disputed' : '') : ''}{schedules[cp.id] ? ' · ' + summary(schedules[cp.id]) : ''}</Cell>

                <div style={{ display:'flex', gap:'4px' }}>
                  {cp.is_active && (
                    <Btn color='var(--text-dim)' onClick={function() { startEdit(cp) }}>EDIT</Btn>
                  )}
                  {cp.is_active && cp.legal_entity?.lei && (
                    <Btn color='var(--accent)' onClick={function() { openChat(cp) }}>CHAT</Btn>
                  )}
                  {cp.is_active
                    ? <Btn color='var(--red)'
                        onClick={function() { toggle(cp.id, false) }}>
                        DEACT
                      </Btn>
                    : <>
                        <Btn color='var(--accent)'
                          onClick={function() { toggle(cp.id, true) }}>
                          REACT
                        </Btn>
                        <Btn color='var(--red)'
                          onClick={function() { hardDelete(cp.id) }}>
                          DEL
                        </Btn>
                      </>
                  }
                </div>
              </div>
            )
          })}
        </div>
      )}

      {schedMsg && (
        <div style={{ marginTop:'8px', fontSize:'12px', color:'var(--amber)', fontFamily:"'IBM Plex Mono',var(--mono)" }}>{schedMsg}</div>
      )}
      {chatErr && (
        <div style={{ marginTop:'8px', fontSize:'12px', color:'var(--amber)',
            fontFamily:"'IBM Plex Mono',var(--mono)" }}>{chatErr}</div>
      )}
      <div style={{ marginTop:'8px', fontSize:'12px', color:'var(--text-dim)',
          fontFamily:"'IBM Plex Mono',var(--mono)" }}>
        {active.length} ACTIVE
        {inactive.length > 0 ? ' · ' + inactive.length + ' INACTIVE' : ''}
        {cps.length > 0 ? ' · DOUBLE-CLICK NAME TO RENAME' : ''}
        {' · CSA CURRENCY → DISCOUNT CURVE AUTO-MAPPED'}
      </div>
    </div>
  )
}
