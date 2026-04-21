import { useState, useEffect } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import { useTabStore } from '../../store/useTabStore'
import useBookingStore from '../../store/useBookingStore'
import './BlotterShell.css'

const AC = {
  RATES:     { c: 'var(--accent)', a: 'RTS' },
  FX:        { c: 'var(--blue)',   a: 'FX'  },
  CREDIT:    { c: 'var(--coral)',  a: 'CRD' },
  EQUITY:    { c: 'var(--purple)', a: 'EQT' },
  COMMODITY: { c: 'var(--amber)',  a: 'CMD' },
}
const ST = {
  PENDING:    { c: 'var(--text-dim)', l: 'PENDING'    },
  LIVE:       { c: 'var(--accent)',   l: 'LIVE'       },
  MATURED:    { c: 'var(--text-dim)', l: 'MATURED'    },
  CANCELLED:  { c: 'var(--text-dim)', l: 'CANCELLED'  },
  TERMINATED: { c: 'var(--red)',      l: 'TERMINATED' },
}
const SR = {
  WORKING:    { c: 'var(--text-dim)', l: 'WORKING'    },
  PRODUCTION: { c: 'var(--accent)',   l: 'PRODUCTION' },
  HISTORY:    { c: 'var(--text-dim)', l: 'HISTORY'    },
}

function fmt(n) {
  if (!n && n !== 0) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function fmtD(d) { return d ? d.substring(0, 10) : '—' }
function tenor(t) {
  if (!t.effective_date || !t.maturity_date) return '—'
  const y = (new Date(t.maturity_date) - new Date(t.effective_date)) / (365.25 * 864e5)
  return y >= 1 ? `${y.toFixed(1)}Y` : `${Math.round(y * 12)}M`
}

const ASSET_CLASSES = ['RATES', 'FX', 'CREDIT', 'EQUITY', 'COMMODITY']
const STATUSES      = ['PENDING', 'LIVE', 'MATURED', 'CANCELLED']
const STORES        = ['WORKING', 'PRODUCTION', 'HISTORY']

export default function BlotterShell() {
  const { trades, loading, error, fetchTrades, filters, setFilter, filteredTrades } = useTradesStore()
  const [sortCol, setSortCol]        = useState('trade_date')
  const [sortDir, setSortDir]        = useState('desc')
  const [selectedIds, setSelectedIds] = useState(new Set())

  useEffect(() => { fetchTrades() }, [])

  const sort = col => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const rows = filteredTrades().slice().sort((a, b) => {
    const av = a[sortCol] ?? '', bv = b[sortCol] ?? ''
    const c = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? c : -c
  })

  const live    = trades.filter(t => t.status === 'LIVE').length
  const pending = trades.filter(t => t.status === 'PENDING').length

  const TH = ({ col, label }) => (
    <th className={sortCol === col ? 'th-sort' : ''} onClick={() => sort(col)}>
      {label}{sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div className="bl-root">

      {/* ── LEFT RAIL ── */}
      <div className="bl-left">
        <div className="bl-left-header">
          <div className="bl-left-title">BLOTTER</div>
          <div className="bl-left-sub">Trade · Lifecycle · Positions</div>
        </div>

        <div className="bl-section-lbl">STATUS</div>
        {['ALL', ...STATUSES].map(s => (
          <button
            key={s}
            className={`bl-filter-btn ${filters.status === s || (!filters.status && s === 'ALL') ? 'active' : ''}`}
            onClick={() => setFilter('status', s === 'ALL' ? '' : s)}
          >
            {s === 'ALL' ? 'ALL STATUS' : s}
            {s !== 'ALL' && ST[s] && (
              <span className="bl-filter-dot" style={{ background: ST[s].c }} />
            )}
          </button>
        ))}

        <div className="bl-section-lbl" style={{ marginTop: '1rem' }}>ASSET CLASS</div>
        {['ALL', ...ASSET_CLASSES].map(ac => (
          <button
            key={ac}
            className={`bl-filter-btn ${filters.assetClass === ac || (!filters.assetClass && ac === 'ALL') ? 'active' : ''}`}
            onClick={() => setFilter('assetClass', ac === 'ALL' ? '' : ac)}
          >
            {ac === 'ALL' ? 'ALL CLASSES' : ac}
            {ac !== 'ALL' && AC[ac] && (
              <span className="bl-filter-dot" style={{ background: AC[ac].c }} />
            )}
          </button>
        ))}

        <div className="bl-section-lbl" style={{ marginTop: '1rem' }}>STORE</div>
        {['ALL', ...STORES].map(s => (
          <button
            key={s}
            className={`bl-filter-btn ${filters.store === s || (!filters.store && s === 'ALL') ? 'active' : ''}`}
            onClick={() => setFilter('store', s === 'ALL' ? '' : s)}
          >
            {s === 'ALL' ? 'ALL STORES' : s}
          </button>
        ))}

        <div className="bl-left-spacer" />

        <div className="bl-summary-block">
          <div className="bl-sum-row">
            <span className="bl-sum-lbl">TOTAL</span>
            <span className="bl-sum-val">{trades.length}</span>
          </div>
          <div className="bl-sum-row">
            <span className="bl-sum-lbl">LIVE</span>
            <span className="bl-sum-val" style={{ color: 'var(--accent)' }}>{live}</span>
          </div>
          <div className="bl-sum-row">
            <span className="bl-sum-lbl">PENDING</span>
            <span className="bl-sum-val" style={{ color: 'var(--text-dim)' }}>{pending}</span>
          </div>
        </div>

        <button className="bl-new-trade-btn" onClick={() => useBookingStore.getState().open()}>
          + NEW TRADE
        </button>
        {selectedIds.size > 0 && (
          <button
            className="bl-new-trade-btn"
            style={{marginTop:'6px',background:'rgba(74,154,212,0.12)',borderColor:'var(--blue)',color:'var(--blue)'}}
            onClick={() => {
              const selected = rows.filter(r => selectedIds.has(r.id))
              selected.forEach(t => useBookingStore.getState().open(t))
              setSelectedIds(new Set())
            }}
          >
            ▶ OPEN {selectedIds.size} TRADE{selectedIds.size > 1 ? 'S' : ''}
          </button>
        )}
      </div>

      {/* ── CENTRE GRID ── */}
      <div className="bl-centre">
        <div className="bl-centre-header">
          <input
            className="bl-search"
            placeholder="Search — ref, counterparty, instrument..."
            value={filters.search || ''}
            onChange={e => setFilter('search', e.target.value)}
          />
          <span className="bl-count">{rows.length} of {trades.length}</span>
        </div>

        <div className="bl-grid">
          {loading && <div className="bl-state">LOADING...</div>}
          {error   && <div className="bl-state bl-state-err">{error}</div>}
          {!loading && !error && (
            <table className="bl-table">
              <thead>
                <tr>
                  <th style={{width:'32px',padding:'0 8px'}}>
                    <input type='checkbox'
                      style={{cursor:'pointer',accentColor:'var(--accent)'}}
                      checked={selectedIds.size > 0 && rows.every(r => selectedIds.has(r.id))}
                      onChange={e => {
                        if (e.target.checked) setSelectedIds(new Set(rows.map(r => r.id)))
                        else setSelectedIds(new Set())
                      }}
                    />
                  </th>
                  <TH col="trade_ref"    label="REF" />
                  <th>CLASS</th>
                  <TH col="instrument_type" label="INSTRUMENT" />
                  <th>STRUCTURE</th>
                  <th>COUNTERPARTY</th>
                  <TH col="notional" label="NOTIONAL" />
                  <th>TENOR</th>
                  <TH col="trade_date"   label="DATE" />
                  <TH col="status"       label="STATUS" />
                  <th>STORE</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10} className="bl-empty">
                    {trades.length === 0 ? 'NO TRADES — CLICK + NEW TRADE TO BEGIN' : 'NO TRADES MATCH FILTERS'}
                  </td></tr>
                ) : rows.map(t => {
                  const ac = AC[t.asset_class] || { c: 'var(--text-dim)', a: t.asset_class }
                  const st = ST[t.status]      || { c: 'var(--text-dim)', l: t.status }
                  const sr = SR[t.store]        || { c: 'var(--text-dim)', l: t.store }
                  const isChecked = selectedIds.has(t.id)
                  return (
                    <tr
                      key={t.id}
                      className={`bl-row ${isChecked ? 'bl-row-selected' : ''}`}
                      style={{ borderLeft: `2px solid ${ac.c}` }}
                      onClick={() => useBookingStore.getState().open(t)}
                    >
                      <td style={{width:'32px',padding:'0 8px'}} onClick={e=>e.stopPropagation()}>
                        <input type='checkbox'
                          style={{cursor:'pointer',accentColor:'var(--accent)'}}
                          checked={isChecked}
                          onChange={e => {
                            const next = new Set(selectedIds)
                            if (e.target.checked) next.add(t.id)
                            else next.delete(t.id)
                            setSelectedIds(next)
                          }}
                        />
                      </td>
                      <td className="bl-td-ref">{t.trade_ref}</td>
                      <td>
                        <span className="bl-ac-badge" style={{ color: ac.c, borderColor: ac.c + '40' }}>
                          {ac.a}
                        </span>
                      </td>
                      <td className="bl-td-dim">{t.instrument_type}</td>
                      <td>
                        {t.structure
                          ? <span className="bl-structure-badge">{t.structure.replace(/_/g, ' ')}</span>
                          : <span className="bl-td-dim" style={{ opacity: 0.3 }}>—</span>
                        }
                      </td>
                      <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.counterparty?.name || '—'}
                      </td>
                      <td className="bl-td-num">
                        {fmt(t.notional)} <span className="bl-ccy">{t.notional_ccy}</span>
                      </td>
                      <td className="bl-td-dim">{tenor(t)}</td>
                      <td className="bl-td-dim bl-td-sm">{fmtD(t.trade_date)}</td>
                      <td>
                        <span className="bl-status-dot" style={{ background: st.c }} />
                        <span className="bl-status-txt" style={{ color: st.c }}>{st.l}</span>
                      </td>
                      <td>
                        <span className="bl-store-txt" style={{ color: sr.c }}>{sr.l}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Right panel removed — trades open as floating windows */}

      {/* TradeBookingWindow now rendered at App root — persists across navigation */}
    </div>
  )
}

// ── Trade summary panel ───────────────────────────────────────────────────────
function TradePanel({ trade: t, onClose }) {
  const ac = AC[t.asset_class] || { c: 'var(--text-dim)', a: t.asset_class }
  const st = ST[t.status]      || { c: 'var(--text-dim)', l: t.status }
  const sr = SR[t.store]        || { c: 'var(--text-dim)', l: t.store }

  function Row({ label, value, color }) {
    return (
      <div className="tp-row">
        <span className="tp-lbl">{label}</span>
        <span className="tp-val" style={color ? { color } : {}}>{value || '—'}</span>
      </div>
    )
  }

  return (
    <div className="tp-root">
      <div className="tp-header" style={{ borderTop: `2px solid ${ac.c}` }}>
        <div className="tp-ref">{t.trade_ref}</div>
        <div className="tp-badges">
          <span className="bl-ac-badge" style={{ color: ac.c, borderColor: ac.c + '40' }}>{ac.a}</span>
          <span className="bl-status-dot" style={{ background: st.c }} />
          <span className="bl-status-txt" style={{ color: st.c }}>{st.l}</span>
        </div>
        <button className="tp-close" onClick={onClose}>✕</button>
      </div>

      <div className="tp-body">
        <div className="tp-section-lbl">TRADE</div>
        <Row label="INSTRUMENT"   value={t.instrument_type} />
        <Row label="STRUCTURE"    value={t.structure?.replace(/_/g, ' ')} />
        <Row label="COUNTERPARTY" value={t.counterparty?.name} />
        <Row label="STORE"        value={sr.l} color={sr.c} />

        <div className="tp-section-lbl">ECONOMICS</div>
        <Row label="NOTIONAL"  value={`${Number(t.notional || 0).toLocaleString()} ${t.notional_ccy || ''}`} />
        <Row label="TENOR"     value={(() => {
          if (!t.effective_date || !t.maturity_date) return '—'
          const y = (new Date(t.maturity_date) - new Date(t.effective_date)) / (365.25 * 864e5)
          return y >= 1 ? `${y.toFixed(1)}Y` : `${Math.round(y * 12)}M`
        })()} />
        <Row label="TRADE DATE"    value={t.trade_date?.substring(0, 10)} />
        <Row label="EFFECTIVE"     value={t.effective_date?.substring(0, 10)} />
        <Row label="MATURITY"      value={t.maturity_date?.substring(0, 10)} />

        <div className="tp-section-lbl">DESK</div>
        <Row label="DESK"   value={t.desk} />
        <Row label="BOOK"   value={t.book} />
        <Row label="TRADER" value={t.created_by_name || t.created_by?.substring(0, 8)} />

        <div className="tp-action-row">
          <button
            className="tp-action-btn"
            onClick={() => window.location.href = `/pricer?trade=${t.id}`}
          >
            ▶ PRICE IN PRICER
          </button>
        </div>
      </div>
    </div>
  )
}
