import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

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

const CSA_COLOR = {
  VM_ONLY: 'var(--accent)',
  VM_IM:   'var(--blue)',
  NO_CSA:  'var(--amber)'
}

const EMPTY = {
  legal_entity_id:'', name:'', isda_agreement:'',
  csa_type:'VM_ONLY', csa_currency:'USD', csa_threshold_m:'',
  csa_mta_k:'', discount_curve_id:'USD_SOFR', im_model:'SIMM'
}

const L = {
  display:'block', fontSize:'10px', fontFamily:"'IBM Plex Mono',var(--mono)",
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
      fontSize:'9px', fontFamily:"'IBM Plex Mono',var(--mono)", letterSpacing:'0.06em',
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
      fontSize:'11px', fontFamily:"'IBM Plex Mono',var(--mono)",
      color: dim ? 'var(--text-dim)' : 'var(--text)',
      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'
    }}>{children || '—'}</div>
  )
}

const COLS = '1fr 140px 80px 52px 120px 65px 108px'

export default function Counterparties() {
  const [cps,          setCps]          = useState([])
  const [les,          setLes]          = useState([])
  const [loading,      setLoading]      = useState(true)
  const [showAdd,      setShowAdd]      = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [form,         setForm]         = useState(EMPTY)
  const [saving,       setSaving]       = useState(false)
  const [editId,       setEditId]       = useState(null)
  const [editName,     setEditName]     = useState('')
  const editRef = useRef(null)

  useEffect(function() { load() }, [])

  // auto-map discount curve when CSA currency changes
  useEffect(function() {
    var mapped = CSA_DISCOUNT_MAP[form.csa_currency]
    if (mapped) {
      setForm(function(prev) { return Object.assign({}, prev, { discount_curve_id: mapped }) })
    }
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
    const { error } = await supabase.from('counterparties').insert({
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
      created_by:        user ? user.id : null
    })
    if (!error) {
      setShowAdd(false)
      setForm(EMPTY)
      await load()
    } else {
      alert('Save failed: ' + error.message)
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

  return (
    <div style={{ padding:'24px', maxWidth:'1400px' }}>

      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'flex-start',
          justifyContent:'space-between', marginBottom:'20px' }}>
        <div>
          <div style={{ fontSize:'10px', color:'var(--accent)', fontFamily:"'IBM Plex Mono',var(--mono)",
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
            setForm(EMPTY)
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
          <div style={{ fontSize:'11px', color:'var(--accent)', fontFamily:"'IBM Plex Mono',var(--mono)",
              letterSpacing:'0.08em', marginBottom:'16px' }}>
            NEW COUNTERPARTY
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
                <label style={L}>DISCOUNT CURVE <span style={{ opacity:.6, fontSize:'9px' }}>(auto-mapped)</span></label>
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

          </div>

          {!hasCSA && (
            <div style={{ marginTop:'12px', fontSize:'10px', fontFamily:"'IBM Plex Mono',var(--mono)",
                color:'var(--amber)', opacity:.7 }}>
              NO_CSA — CSA fields will be stored as null
            </div>
          )}

          <div style={{ marginTop:'16px' }}>
            <Btn size='lg' onClick={save} disabled={saving}>
              {saving ? 'SAVING...' : 'SAVE COUNTERPARTY'}
            </Btn>
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
            {['NAME','LEGAL ENTITY','CSA TYPE','CCY','DISCOUNT CURVE','IM MODEL','ACTIONS']
              .map(function(h) {
                return (
                  <div key={h} style={{ fontSize:'10px', fontFamily:"'IBM Plex Mono',var(--mono)",
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
                <Cell dim>{cp.im_model}</Cell>

                <div style={{ display:'flex', gap:'4px' }}>
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

      <div style={{ marginTop:'8px', fontSize:'10px', color:'var(--text-dim)',
          fontFamily:"'IBM Plex Mono',var(--mono)" }}>
        {active.length} ACTIVE
        {inactive.length > 0 ? ' · ' + inactive.length + ' INACTIVE' : ''}
        {cps.length > 0 ? ' · DOUBLE-CLICK NAME TO RENAME' : ''}
        {' · CSA CURRENCY → DISCOUNT CURVE AUTO-MAPPED'}
      </div>
    </div>
  )
}
