import { useState, useEffect } from 'react'
import { useTradesStore, shortUti } from '../../store/useTradesStore'
import useBookingStore from '../../store/useBookingStore'
import { productLabel } from '../../lib/labels'
import './BlotterShell.css'
import { Keycap } from '../common/Shortcuts'

const TH = ({ col, label, sortCol, sortDir, onSort }) => (
  <th className={sortCol === col ? 'th-sort' : ''} onClick={() => onSort(col)}>
    {label}{sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
  </th>
)

const AC = {
  RATES:     { a: 'RTS' },
  FX:        { a: 'FX'  },
  CREDIT:    { a: 'CRD' },
  EQUITY:    { a: 'EQT' },
  COMMODITY: { a: 'CMD' },
  CRYPTO:    { a: 'CRY' },
}
// A status takes a colour only when it says something: brass is sealed on chain, green is running; a trade still
// waiting has a hollow dot, one that is over is faint.
const ST = {
  PENDING:    { c: 'var(--text-dim)',   l: 'PENDING',   hollow: true },
  CONFIRMED:  { c: 'var(--accent)',     l: 'CONFIRMED'  },
  LIVE:       { c: 'var(--up)',         l: 'LIVE'       },
  MATURED:    { c: 'var(--text-faint)', l: 'MATURED'    },
  CANCELLED:  { c: 'var(--text-faint)', l: 'CANCELLED'  },
  TERMINATED: { c: 'var(--text-faint)', l: 'TERMINATED' },
}
const SR = {
  WORKING:    { l: 'WORKING'    },
  PRODUCTION: { l: 'PRODUCTION' },
  HISTORY:    { l: 'HISTORY'    },
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

const ASSET_CLASSES = ['RATES', 'FX', 'CRYPTO', 'CREDIT', 'EQUITY', 'COMMODITY']
const STATUSES      = ['PENDING', 'LIVE', 'MATURED', 'CANCELLED']
const STORES        = ['WORKING', 'PRODUCTION', 'HISTORY']

export default function BlotterShell() {
  const { trades, theirRefs, loading, error, fetchTrades, startLive, filters, setFilter, filteredTrades } = useTradesStore()
  const [sortCol, setSortCol]        = useState('trade_date')
  const [sortDir, setSortDir]        = useState('desc')
  const [selectedIds, setSelectedIds] = useState(new Set())

  useEffect(() => { fetchTrades(); return startLive() }, [])   // live while the blotter is on screen

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
              <span className="bl-filter-dot" style={ST[s].hollow ? { border: `1px solid ${ST[s].c}`, boxSizing: 'border-box' } : { background: ST[s].c }} />
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
            <span className="bl-sum-val" style={{ color: live ? 'var(--up)' : undefined }}>{live}</span>
          </div>
          <div className="bl-sum-row">
            <span className="bl-sum-lbl">PENDING</span>
            <span className="bl-sum-val">{pending}</span>
          </div>
        </div>

        <button className="bl-new-trade-btn" aria-keyshortcuts="F3" onClick={() => useBookingStore.getState().open()}>
          + NEW TRADE<Keycap id="new-trade" />
        </button>
        {selectedIds.size > 0 && (
          <button
            className="bl-new-trade-btn"
            style={{marginTop:'6px',background:'rgba(143,193,230,0.12)',borderColor:'var(--blue)',color:'var(--blue)'}}
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
            placeholder="Search — ref, their ref, UTI, counterparty, instrument..."
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
              {/* widths for what each column holds; the counterparty takes what is left */}
              <colgroup>
                {[30, 114, 60, 124, 92, null, 82, 118, 62, 92, 108, 88, 100].map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}
              </colgroup>
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
                  <TH col="trade_ref"    label="REF" sortCol={sortCol} sortDir={sortDir} onSort={sort} />
                  <th>CLASS</th>
                  <TH col="instrument_type" label="INSTRUMENT" sortCol={sortCol} sortDir={sortDir} onSort={sort} />
                  <th>STRUCTURE</th>
                  <th>COUNTERPARTY</th>
                  <th title="The counterparty's own trade ref for this trade">THEIR REF</th>
                  <TH col="notional" label="NOTIONAL" sortCol={sortCol} sortDir={sortDir} onSort={sort} />
                  <th>TENOR</th>
                  <TH col="trade_date"   label="DATE" sortCol={sortCol} sortDir={sortDir} onSort={sort} />
                  <TH col="status"       label="STATUS" sortCol={sortCol} sortDir={sortDir} onSort={sort} />
                  <th>STORE</th>
                  <th title="Unique Transaction Identifier: the same on both parties' bookings">UTI</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={13} className="bl-empty">
                    {trades.length === 0 ? 'NO TRADES — CLICK + NEW TRADE TO BEGIN' : 'NO TRADES MATCH FILTERS'}
                  </td></tr>
                ) : rows.map(t => {
                  const ac = AC[t.asset_class] || { a: t.asset_class }
                  const st = ST[t.status]      || { c: 'var(--text-dim)', l: t.status }
                  const sr = SR[t.store]        || { l: t.store }
                  const isChecked = selectedIds.has(t.id)
                  return (
                    <tr
                      key={t.id}
                      className={`bl-row ${isChecked ? 'bl-row-selected' : ''}`}
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
                        <span className="bl-ac-badge">
                          {ac.a}
                        </span>
                      </td>
                      <td className="bl-td-dim">{productLabel(t.instrument_type)}</td>
                      <td>
                        {t.structure
                          ? <span className="bl-structure-badge">{t.structure.replace(/_/g, ' ')}</span>
                          : <span className="bl-td-dim" style={{ opacity: 0.3 }}>—</span>
                        }
                      </td>
                      <td>
                        {t.counterparty?.name || '—'}
                      </td>
                      <td className={theirRefs[t.id] ? '' : 'bl-td-dim'} title={theirRefs[t.id] ? `${theirRefs[t.id].firm}'s ref` : ''}>
                        {theirRefs[t.id]?.trade_ref || '—'}
                      </td>
                      <td className="bl-td-num">
                        {fmt(t.notional)} <span className="bl-ccy">{t.notional_ccy}</span>
                      </td>
                      <td className="bl-td-dim">{tenor(t)}</td>
                      <td className="bl-td-dim bl-td-sm">{fmtD(t.trade_date)}</td>
                      <td>
                        <span className="bl-status-dot" style={st.hollow ? { border: `1px solid ${st.c}` } : { background: st.c }} />
                        <span className="bl-status-txt" style={{ color: st.c }}>{st.l}</span>
                      </td>
                      <td>
                        <span className="bl-store-txt">{sr.l}</span>
                      </td>
                      <td className="bl-td-dim bl-td-sm" title={t.uti || ''}>{shortUti(t.uti)}</td>
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
