import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const OIS_CURVES = [
  'USD_SOFR','EUR_ESTR','GBP_SONIA','JPY_TONAR','CHF_SARON',
  'AUD_AONIA','CAD_CORRA','SGD_SORA','HKD_HONIA','NOK_NOWA',
  'SEK_STIBOR_OIS','DKK_CIBOR_OIS','NZD_NZOCR',
  'MXN_TIIE_OIS','BRL_CDI','ZAR_ZARONIA','INR_MIBOROIS','CNY_SHIBOR_OIS'
]

const CURRENCIES = [
  'USD','EUR','GBP','JPY','CHF','AUD','CAD',
  'SGD','HKD','NOK','SEK','DKK','NZD','MXN','BRL','ZAR','INR','CNY'
]

const EMPTY = {
  lei:'', name:'', short_name:'', home_currency:'USD',
  jurisdiction:'US', regulatory_regime:'', simm_version:'v2.6',
  im_threshold_m:'', ois_curve_id:'', is_own_entity:false
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

const COLS = '150px 1fr 90px 55px 64px 56px 56px 108px'

export default function LegalEntities() {
  const [rows,         setRows]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [showAdd,      setShowAdd]      = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [form,         setForm]         = useState(EMPTY)
  const [saving,       setSaving]       = useState(false)
  const [editId,       setEditId]       = useState(null)
  const [editName,     setEditName]     = useState('')
  const editRef = useRef(null)

  useEffect(function() { load() }, [])
  useEffect(function() { if (editRef.current) editRef.current.focus() }, [editId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('legal_entities').select('*')
      .order('is_own_entity', { ascending: false })
      .order('name')
    setRows(data || [])
    setLoading(false)
  }

  function f(patch) {
    setForm(function(prev) { return Object.assign({}, prev, patch) })
  }

  async function save() {
    if (!form.lei.trim() || !form.name.trim()) {
      alert('LEI and Name are required.')
      return
    }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('legal_entities').insert({
      lei:               form.lei.trim().toUpperCase(),
      name:              form.name.trim().toUpperCase(),
      short_name:        form.short_name.trim().toUpperCase() || null,
      home_currency:     form.home_currency,
      jurisdiction:      form.jurisdiction.trim().toUpperCase(),
      regulatory_regime: form.regulatory_regime
        ? form.regulatory_regime.split(',').map(function(s) {
            return s.trim().toUpperCase()
          }).filter(Boolean)
        : [],
      simm_version:      form.simm_version || 'v2.6',
      im_threshold_m:    form.im_threshold_m ? parseFloat(form.im_threshold_m) : null,
      ois_curve_id:      form.ois_curve_id   || null,
      is_own_entity:     form.is_own_entity,
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
    const n = editName.trim().toUpperCase()
    setEditId(null)
    if (!n) return
    await supabase.from('legal_entities').update({ name: n }).eq('id', id)
    await load()
  }

  async function toggle(id, val) {
    await supabase.from('legal_entities').update({ is_active: val }).eq('id', id)
    await load()
  }

  async function hardDelete(id) {
    if (!window.confirm('Permanently delete this legal entity? This cannot be undone.')) return
    await supabase.from('legal_entities').delete().eq('id', id)
    await load()
  }

  const active   = rows.filter(function(e) { return e.is_active })
  const inactive = rows.filter(function(e) { return !e.is_active })
  const visible  = showInactive ? rows : active

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
            LEGAL ENTITIES
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
            {showAdd ? '✕ CANCEL' : '+ ADD ENTITY'}
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
            NEW LEGAL ENTITY
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px' }}>

            <div>
              <label style={L}>LEI *</label>
              <input style={INP} value={form.lei}
                placeholder="5493001RKX8CS1BEYF67"
                onChange={function(e) { f({ lei: e.target.value }) }} />
            </div>
            <div>
              <label style={L}>NAME *</label>
              <input style={INP} value={form.name}
                placeholder="JP MORGAN CHASE & CO"
                onChange={function(e) { f({ name: e.target.value }) }} />
            </div>
            <div>
              <label style={L}>SHORT NAME</label>
              <input style={INP} value={form.short_name}
                placeholder="JPMC"
                onChange={function(e) { f({ short_name: e.target.value }) }} />
            </div>

            <div>
              <label style={L}>HOME CURRENCY</label>
              <select style={Object.assign({}, INP, { cursor:'pointer' })}
                value={form.home_currency}
                onChange={function(e) { f({ home_currency: e.target.value }) }}>
                {CURRENCIES.map(function(c) { return <option key={c}>{c}</option> })}
              </select>
            </div>
            <div>
              <label style={L}>JURISDICTION</label>
              <input style={INP} value={form.jurisdiction}
                placeholder="US"
                onChange={function(e) { f({ jurisdiction: e.target.value.toUpperCase() }) }} />
            </div>
            <div>
              <label style={L}>
                REGULATORY REGIME
                <span style={{ opacity:0.6, fontSize:'9px', marginLeft:'4px' }}>(comma-sep)</span>
              </label>
              <input style={INP} value={form.regulatory_regime}
                placeholder="EMIR, DODD-FRANK, MIFID2"
                onChange={function(e) { f({ regulatory_regime: e.target.value }) }} />
            </div>

            <div>
              <label style={L}>SIMM VERSION</label>
              <input style={INP} value={form.simm_version}
                onChange={function(e) { f({ simm_version: e.target.value }) }} />
            </div>
            <div>
              <label style={L}>IM THRESHOLD (M)</label>
              <input style={INP} type="number" step="0.01" value={form.im_threshold_m}
                placeholder="50.00"
                onChange={function(e) { f({ im_threshold_m: e.target.value }) }} />
            </div>
            <div>
              <label style={L}>OIS DISCOUNT CURVE</label>
              <select style={Object.assign({}, INP, { cursor:'pointer' })}
                value={form.ois_curve_id}
                onChange={function(e) { f({ ois_curve_id: e.target.value }) }}>
                <option value="">— NONE —</option>
                {OIS_CURVES.map(function(c) { return <option key={c}>{c}</option> })}
              </select>
            </div>

          </div>

          <div style={{ display:'flex', alignItems:'center', gap:'20px', marginTop:'16px' }}>
            <label style={{
              display:'flex', alignItems:'center', gap:'8px',
              fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'12px',
              color:'var(--text-dim)', cursor:'pointer'
            }}>
              <input type="checkbox" checked={form.is_own_entity}
                onChange={function(e) { f({ is_own_entity: e.target.checked }) }}
                style={{ accentColor:'var(--accent)' }} />
              OWN ENTITY (self)
            </label>
            <Btn size='lg' onClick={save} disabled={saving}>
              {saving ? 'SAVING...' : 'SAVE ENTITY'}
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
          NO LEGAL ENTITIES — CLICK + ADD ENTITY
        </div>
      ) : (
        <div style={{ border:'1px solid var(--panel-3)', borderRadius:'4px', overflow:'hidden' }}>

          {/* Header */}
          <div style={{ display:'grid', gridTemplateColumns:COLS,
              padding:'8px 12px', gap:'8px', background:'var(--panel-2)',
              borderBottom:'1px solid var(--panel-3)' }}>
            {['LEI','NAME','SHORT','CCY','JURIS','SIMM','TYPE','ACTIONS'].map(function(h) {
              return (
                <div key={h} style={{ fontSize:'10px', fontFamily:"'IBM Plex Mono',var(--mono)",
                    color:'var(--text-dim)', letterSpacing:'0.08em' }}>{h}</div>
              )
            })}
          </div>

          {/* Rows */}
          {visible.map(function(e) {
            var leftColor = e.is_own_entity ? 'var(--accent)' : 'var(--blue)'
            return (
              <div key={e.id} style={{
                display:'grid', gridTemplateColumns:COLS,
                padding:'10px 12px', gap:'8px', alignItems:'center',
                borderLeft:'2px solid ' + leftColor,
                borderBottom:'1px solid var(--panel-3)',
                background: e.is_active ? 'var(--panel)' : 'transparent',
                opacity: e.is_active ? 1 : 0.48
              }}>

                <Cell dim>{e.lei}</Cell>

                {editId === e.id
                  ? <input ref={editRef}
                      style={Object.assign({}, INP, { fontSize:'12px' })}
                      value={editName}
                      onChange={function(ev) { setEditName(ev.target.value) }}
                      onBlur={function() { commitRename(e.id) }}
                      onKeyDown={function(ev) {
                        if (ev.key === 'Enter')  commitRename(e.id)
                        if (ev.key === 'Escape') setEditId(null)
                      }} />
                  : <div
                      style={{ fontSize:'12px', fontFamily:"'IBM Plex Mono',var(--mono)",
                          color:'var(--text)', cursor:'pointer',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                      onDoubleClick={function() {
                        setEditId(e.id)
                        setEditName(e.name)
                      }}
                      title="Double-click to rename">
                      {e.name}
                    </div>
                }

                <Cell dim>{e.short_name}</Cell>
                <Cell>{e.home_currency}</Cell>
                <Cell dim>{e.jurisdiction}</Cell>
                <Cell dim>{e.simm_version}</Cell>

                <div>
                  <Badge color={e.is_own_entity ? 'var(--accent)' : 'var(--blue)'}>
                    {e.is_own_entity ? 'OWN' : 'CPTY'}
                  </Badge>
                </div>

                <div style={{ display:'flex', gap:'4px' }}>
                  {e.is_active
                    ? <Btn color='var(--red)'
                        onClick={function() { toggle(e.id, false) }}>
                        DEACT
                      </Btn>
                    : <>
                        <Btn color='var(--accent)'
                          onClick={function() { toggle(e.id, true) }}>
                          REACT
                        </Btn>
                        <Btn color='var(--red)'
                          onClick={function() { hardDelete(e.id) }}>
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
        {rows.length > 0 ? ' · DOUBLE-CLICK NAME TO RENAME' : ''}
      </div>
    </div>
  )
}
