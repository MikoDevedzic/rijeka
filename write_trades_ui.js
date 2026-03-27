const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend';

function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log('wrote:', rel);
}

// ─── useTradesStore.js ────────────────────────────────────────────────────────
write('src/store/useTradesStore.js', `import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const INIT_FILTERS = { status: 'ALL', assetClass: 'ALL', store: 'ALL', search: '' }

export const useTradesStore = create((set, get) => ({
  trades:  [],
  loading: false,
  error:   null,
  filters: { ...INIT_FILTERS },

  setFilter:    (k, v) => set(s => ({ filters: { ...s.filters, [k]: v } })),
  resetFilters: ()     => set({ filters: { ...INIT_FILTERS } }),

  fetchTrades: async () => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('trades')
      .select(\`*,
        counterparty:counterparties(id, name, csa_type),
        own_entity:legal_entities(id, name, short_name)\`)
      .order('trade_date',  { ascending: false })
      .order('created_at', { ascending: false })

    error
      ? set({ error: error.message, loading: false })
      : set({ trades: data || [],   loading: false })
  },

  addTrade: async (trade) => {
    const { data, error } = await supabase
      .from('trades')
      .insert([trade])
      .select(\`*,
        counterparty:counterparties(id, name, csa_type),
        own_entity:legal_entities(id, name, short_name)\`)
      .single()
    if (error) return { error }
    set(s => ({ trades: [data, ...s.trades] }))
    return { data }
  },

  updateTradeStatus: async (id, status) => {
    const { error } = await supabase.from('trades').update({ status }).eq('id', id)
    if (error) return { error }
    set(s => ({ trades: s.trades.map(t => t.id === id ? { ...t, status } : t) }))
    return {}
  },

  deleteTrade: async (id) => {
    const t = get().trades.find(x => x.id === id)
    if (!['PENDING','CANCELLED'].includes(t?.status))
      return { error: { message: 'Only PENDING or CANCELLED trades can be deleted' } }
    const { error } = await supabase.from('trades').delete().eq('id', id)
    if (error) return { error }
    set(s => ({ trades: s.trades.filter(x => x.id !== id) }))
    return {}
  },

  filteredTrades: () => {
    const { trades, filters } = get()
    return trades.filter(t => {
      if (filters.status    !== 'ALL' && t.status     !== filters.status)    return false
      if (filters.assetClass !== 'ALL' && t.asset_class !== filters.assetClass) return false
      if (filters.store     !== 'ALL' && t.store      !== filters.store)     return false
      if (filters.search) {
        const q = filters.search.toLowerCase()
        if (!( (t.trade_ref || '').toLowerCase().includes(q)
            || (t.counterparty?.name || '').toLowerCase().includes(q)
            || (t.desk || '').toLowerCase().includes(q)
            || (t.instrument_type || '').toLowerCase().includes(q) ))
          return false
      }
      return true
    })
  },
}))
`);

// ─── Trades.css ────────────────────────────────────────────────────────────────
write('src/components/trades/Trades.css', `/* ── Trades Blotter ── */

.trades-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1.5rem 2rem;
  gap: 0.75rem;
  overflow: hidden;
}

/* Header */
.trades-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.trades-title { display: flex; align-items: baseline; gap: 0.75rem; }
.trades-title h2 {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text);
  margin: 0;
}
.trades-count {
  font-size: 0.7rem;
  color: var(--text-dim);
  letter-spacing: 0.08em;
}
.btn-add-trade {
  background: var(--accent);
  color: var(--bg-deep);
  border: none;
  padding: 0.45rem 1.1rem;
  font-family: var(--mono);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  cursor: pointer;
  border-radius: 2px;
  transition: opacity 0.15s;
}
.btn-add-trade:hover { opacity: 0.85; }

/* Summary bar */
.summary-bar {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 0.6rem 1.25rem;
  border-radius: 3px;
  flex-shrink: 0;
}
.summary-stat { display: flex; flex-direction: column; align-items: flex-start; gap: 0.1rem; }
.summary-val {
  font-size: 1.1rem;
  font-weight: 700;
  font-family: var(--mono);
  color: var(--text);
  line-height: 1;
}
.summary-lbl {
  font-size: 0.6rem;
  color: var(--text-dim);
  letter-spacing: 0.1em;
}
.summary-divider {
  width: 1px;
  height: 28px;
  background: var(--border);
}

/* Filter bar */
.trades-filters {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex-shrink: 0;
}
.filter-search {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.72rem;
  padding: 0.45rem 0.75rem;
  border-radius: 2px;
  width: 340px;
  letter-spacing: 0.04em;
  outline: none;
  transition: border-color 0.15s;
}
.filter-search:focus { border-color: var(--accent); }
.filter-search::placeholder { color: var(--text-dim); }
.filter-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.chip {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 0.25rem 0.65rem;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.15s;
}
.chip:hover { border-color: var(--text-dim); color: var(--text); }
.chip-active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

/* Main area — grid + side panel */
.trades-main {
  display: flex;
  gap: 0;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
.trades-main.with-panel .trades-grid-wrapper {
  flex: 1;
  min-width: 0;
}

/* Grid */
.trades-grid-wrapper {
  flex: 1;
  overflow: auto;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--panel);
}
.trades-loading,
.trades-error {
  padding: 3rem;
  text-align: center;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  color: var(--text-dim);
}
.trades-error { color: var(--red); }

.trades-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.72rem;
  font-family: var(--mono);
}
.trades-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--panel-2);
}
.trades-table th {
  padding: 0.6rem 0.8rem;
  text-align: left;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  user-select: none;
}
.th-sortable { cursor: pointer; }
.th-sortable:hover { color: var(--text); }
.th-active { color: var(--accent); }

.trade-row {
  cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  transition: background 0.1s;
}
.trade-row:hover { background: var(--panel-2); }
.trade-row.selected { background: color-mix(in srgb, var(--accent) 6%, transparent); }
.trade-row td {
  padding: 0.5rem 0.8rem;
  white-space: nowrap;
  color: var(--text);
}

.td-ref   { font-weight: 600; color: var(--text) !important; letter-spacing: 0.04em; }
.td-instrument { color: var(--text-dim) !important; }
.td-cp    { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.td-notional { text-align: right; font-variant-numeric: tabular-nums; }
.td-tenor  { color: var(--text-dim) !important; }
.td-date  { color: var(--text-dim) !important; font-size: 0.68rem; }
.ccy      { font-size: 0.65rem; opacity: 0.6; margin-left: 0.25rem; }

.badge {
  display: inline-block;
  padding: 0.15rem 0.45rem;
  border-radius: 2px;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  border: 1px solid;
}
.status-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  margin-right: 0.4rem;
  vertical-align: middle;
}
.status-label {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  vertical-align: middle;
}
.store-badge {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
}
.empty-row {
  text-align: center;
  padding: 4rem !important;
  color: var(--text-dim);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
}

/* ── Side panel shared ── */
.trade-detail-panel,
.add-panel {
  width: 360px;
  min-width: 360px;
  border-left: 1px solid var(--border);
  background: var(--panel);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Detail panel */
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
  flex-shrink: 0;
}
.detail-ref {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.06em;
}
.detail-sub {
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  margin-top: 0.15rem;
}
.detail-close {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0;
  line-height: 1;
  transition: color 0.15s;
}
.detail-close:hover { color: var(--text); }

.detail-section {
  padding: 0.85rem 1.25rem;
  border-bottom: 1px solid var(--border);
  overflow-y: auto;
}
.detail-section:last-child { border-bottom: none; }
.detail-section-title {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--text-dim);
  margin-bottom: 0.6rem;
}
.detail-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem 1rem;
}
.detail-grid-2 > div { display: flex; flex-direction: column; gap: 0.1rem; }
.dl {
  font-size: 0.58rem;
  color: var(--text-dim);
  letter-spacing: 0.1em;
}
.dv {
  font-size: 0.72rem;
  color: var(--text);
  font-weight: 600;
  word-break: break-all;
}
.detail-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.act-btn {
  border: 1px solid;
  background: transparent;
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 0.35rem 0.75rem;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.15s;
}
.act-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.act-live   { border-color: var(--accent); color: var(--accent); }
.act-live:hover:not(:disabled)   { background: color-mix(in srgb, var(--accent) 15%, transparent); }
.act-mat    { border-color: var(--text-dim); color: var(--text-dim); }
.act-mat:hover:not(:disabled)    { border-color: var(--text); color: var(--text); }
.act-cancel { border-color: var(--red); color: var(--red); }
.act-cancel:hover:not(:disabled) { background: color-mix(in srgb, var(--red) 12%, transparent); }

/* Add panel */
.add-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--accent);
  flex-shrink: 0;
}
.add-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.add-panel-footer {
  display: flex;
  gap: 0.6rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border);
  background: var(--panel-2);
  flex-shrink: 0;
}
.btn-cancel {
  flex: 1;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 0.5rem;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-cancel:hover { border-color: var(--text-dim); color: var(--text); }
.btn-confirm {
  flex: 2;
  background: var(--accent);
  border: none;
  color: var(--bg-deep);
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 0.5rem;
  border-radius: 2px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-confirm:hover:not(:disabled) { opacity: 0.85; }
.btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; }

/* Form elements */
.form-section-title {
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--accent);
  margin-top: 0.5rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}
.form-field { display: flex; flex-direction: column; gap: 0.25rem; }
.form-field label {
  font-size: 0.58rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--text-dim);
}
.form-field input,
.form-field select {
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.7rem;
  padding: 0.35rem 0.5rem;
  border-radius: 2px;
  outline: none;
  transition: border-color 0.15s;
  width: 100%;
  box-sizing: border-box;
}
.form-field input:focus,
.form-field select:focus { border-color: var(--accent); }
.form-field input::placeholder { color: var(--text-dim); opacity: 0.6; }
.form-field select option { background: var(--panel-3); }

.form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; }

.form-divider {
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text-dim);
  border-top: 1px solid var(--border);
  padding-top: 0.4rem;
  margin-top: 0.2rem;
}
.terms-form { display: flex; flex-direction: column; gap: 0.5rem; }

.chip-row { display: flex; gap: 0.35rem; flex-wrap: wrap; }

.form-error {
  font-size: 0.68rem;
  color: var(--red);
  letter-spacing: 0.06em;
  padding: 0.4rem 0.6rem;
  background: color-mix(in srgb, var(--red) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
  border-radius: 2px;
}
`);

// ─── Trades.jsx ───────────────────────────────────────────────────────────────
write('src/components/trades/Trades.jsx', `import { useState, useEffect } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import { supabase } from '../../lib/supabase'
import './Trades.css'

// ── Constants ──────────────────────────────────────────────────────────────────

const ASSET_CLASSES = ['RATES', 'FX', 'CREDIT', 'EQUITY', 'COMMODITY']

const INSTRUMENT_TYPES = {
  RATES:     ['IR_SWAP', 'OIS_SWAP', 'XCCY_SWAP', 'FRA', 'IR_CAP', 'IR_FLOOR', 'IR_SWAPTION'],
  FX:        ['FX_FORWARD', 'FX_SWAP', 'FX_OPTION', 'FX_NDF'],
  CREDIT:    ['CDS', 'CDS_INDEX', 'TOTAL_RETURN_SWAP'],
  EQUITY:    ['EQUITY_OPTION', 'EQUITY_SWAP', 'VARIANCE_SWAP'],
  COMMODITY: ['COMMODITY_SWAP', 'COMMODITY_OPTION'],
}

const STATUS_META = {
  PENDING:    { color: 'var(--amber)',  label: 'PENDING'    },
  LIVE:       { color: 'var(--accent)', label: 'LIVE'       },
  MATURED:    { color: '#4a5568',       label: 'MATURED'    },
  CANCELLED:  { color: 'var(--red)',    label: 'CANCELLED'  },
  TERMINATED: { color: 'var(--red)',    label: 'TERMINATED' },
}

const AC_META = {
  RATES:     { color: 'var(--accent)', abbr: 'RTS' },
  FX:        { color: 'var(--blue)',   abbr: 'FX'  },
  CREDIT:    { color: 'var(--amber)',  abbr: 'CRD' },
  EQUITY:    { color: 'var(--purple)', abbr: 'EQT' },
  COMMODITY: { color: 'var(--red)',    abbr: 'CMD' },
}

const STORE_META = {
  WORKING:    { color: 'var(--accent)', label: 'W' },
  PRODUCTION: { color: 'var(--blue)',   label: 'P' },
  HISTORY:    { color: '#4a5568',       label: 'H' },
}

const FLOAT_INDICES = [
  'USD_SOFR','USD_LIBOR_3M','EUR_EURIBOR_3M','EUR_EURIBOR_6M',
  'GBP_SONIA','JPY_TONAR','CHF_SARON','CAD_CORRA','AUD_AONIA',
]
const CURRENCIES = ['USD','EUR','GBP','JPY','CHF','CAD','AUD','NOK','SEK','DKK','SGD','HKD']
const DAY_COUNTS = ['ACT/360','ACT/365','ACT/ACT','30/360','30E/360']
const FREQUENCIES = ['MONTHLY','QUARTERLY','SEMI-ANNUAL','ANNUAL']

// ── Default terms per instrument ───────────────────────────────────────────────

function defaultTerms(it) {
  if (['IR_SWAP','OIS_SWAP'].includes(it)) return {
    pay_receive: 'PAY', fixed_rate: '', fixed_day_count: 'ACT/360',
    fixed_frequency: 'SEMI-ANNUAL', float_index: 'USD_SOFR',
    float_spread: '0', float_day_count: 'ACT/360', float_frequency: 'QUARTERLY',
  }
  if (['FX_FORWARD','FX_NDF'].includes(it)) return {
    buy_currency: 'EUR', sell_currency: 'USD',
    buy_notional: '', sell_notional: '', fx_rate: '', settlement_type: 'PHYSICAL',
  }
  if (it === 'FX_SWAP') return {
    near_buy_currency: 'EUR', near_sell_currency: 'USD',
    near_fx_rate: '', far_fx_rate: '', near_date: '',
  }
  if (it === 'XCCY_SWAP') return {
    pay_currency: 'EUR', receive_currency: 'USD',
    pay_index: 'EUR_EURIBOR_3M', receive_index: 'USD_SOFR',
    pay_spread: '0', receive_spread: '0',
  }
  if (it === 'CDS') return {
    reference_entity: '', protection_buy_sell: 'BUY',
    cds_spread_bps: '', recovery_rate: '0.40', seniority: 'SENIOR_UNSECURED',
  }
  return {}
}

// ── Terms form ─────────────────────────────────────────────────────────────────

function TermsForm({ it, terms, onChange }) {
  const s = (k, v) => onChange({ ...terms, [k]: v })
  if (!it) return null

  if (['IR_SWAP','OIS_SWAP'].includes(it)) return (
    <div className="terms-form">
      <div className="form-row-2">
        <div className="form-field">
          <label>PAY / RECEIVE</label>
          <select value={terms.pay_receive||'PAY'} onChange={e=>s('pay_receive',e.target.value)}>
            <option>PAY</option><option>RECEIVE</option>
          </select>
        </div>
        <div className="form-field">
          <label>FIXED RATE</label>
          <input placeholder="0.0425" value={terms.fixed_rate||''} onChange={e=>s('fixed_rate',e.target.value)}/>
        </div>
      </div>
      <div className="form-row-2">
        <div className="form-field">
          <label>FIXED DAY COUNT</label>
          <select value={terms.fixed_day_count||'ACT/360'} onChange={e=>s('fixed_day_count',e.target.value)}>
            {DAY_COUNTS.map(d=><option key={d}>{d}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>FIXED FREQ</label>
          <select value={terms.fixed_frequency||'SEMI-ANNUAL'} onChange={e=>s('fixed_frequency',e.target.value)}>
            {FREQUENCIES.map(f=><option key={f}>{f}</option>)}
          </select>
        </div>
      </div>
      <div className="form-divider">FLOATING LEG</div>
      <div className="form-row-2">
        <div className="form-field">
          <label>FLOAT INDEX</label>
          <select value={terms.float_index||'USD_SOFR'} onChange={e=>s('float_index',e.target.value)}>
            {FLOAT_INDICES.map(i=><option key={i}>{i}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>SPREAD (bps)</label>
          <input placeholder="0" value={terms.float_spread||''} onChange={e=>s('float_spread',e.target.value)}/>
        </div>
      </div>
      <div className="form-row-2">
        <div className="form-field">
          <label>FLOAT DAY COUNT</label>
          <select value={terms.float_day_count||'ACT/360'} onChange={e=>s('float_day_count',e.target.value)}>
            {DAY_COUNTS.map(d=><option key={d}>{d}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>FLOAT FREQ</label>
          <select value={terms.float_frequency||'QUARTERLY'} onChange={e=>s('float_frequency',e.target.value)}>
            {FREQUENCIES.map(f=><option key={f}>{f}</option>)}
          </select>
        </div>
      </div>
    </div>
  )

  if (['FX_FORWARD','FX_NDF'].includes(it)) return (
    <div className="terms-form">
      <div className="form-row-2">
        <div className="form-field"><label>BUY CURRENCY</label>
          <select value={terms.buy_currency||'EUR'} onChange={e=>s('buy_currency',e.target.value)}>
            {CURRENCIES.map(c=><option key={c}>{c}</option>)}
          </select></div>
        <div className="form-field"><label>BUY NOTIONAL</label>
          <input placeholder="10,000,000" value={terms.buy_notional||''} onChange={e=>s('buy_notional',e.target.value)}/></div>
      </div>
      <div className="form-row-2">
        <div className="form-field"><label>SELL CURRENCY</label>
          <select value={terms.sell_currency||'USD'} onChange={e=>s('sell_currency',e.target.value)}>
            {CURRENCIES.map(c=><option key={c}>{c}</option>)}
          </select></div>
        <div className="form-field"><label>SELL NOTIONAL</label>
          <input placeholder="10,850,000" value={terms.sell_notional||''} onChange={e=>s('sell_notional',e.target.value)}/></div>
      </div>
      <div className="form-row-2">
        <div className="form-field"><label>FX RATE</label>
          <input placeholder="1.0850" value={terms.fx_rate||''} onChange={e=>s('fx_rate',e.target.value)}/></div>
        <div className="form-field"><label>SETTLEMENT</label>
          <select value={terms.settlement_type||'PHYSICAL'} onChange={e=>s('settlement_type',e.target.value)}>
            <option>PHYSICAL</option><option>CASH</option>
          </select></div>
      </div>
    </div>
  )

  if (it === 'XCCY_SWAP') return (
    <div className="terms-form">
      <div className="form-divider">PAY LEG</div>
      <div className="form-row-2">
        <div className="form-field"><label>PAY CURRENCY</label>
          <select value={terms.pay_currency||'EUR'} onChange={e=>s('pay_currency',e.target.value)}>
            {CURRENCIES.map(c=><option key={c}>{c}</option>)}
          </select></div>
        <div className="form-field"><label>PAY INDEX</label>
          <select value={terms.pay_index||'EUR_EURIBOR_3M'} onChange={e=>s('pay_index',e.target.value)}>
            {FLOAT_INDICES.map(i=><option key={i}>{i}</option>)}
          </select></div>
      </div>
      <div className="form-divider">RECEIVE LEG</div>
      <div className="form-row-2">
        <div className="form-field"><label>RECEIVE CURRENCY</label>
          <select value={terms.receive_currency||'USD'} onChange={e=>s('receive_currency',e.target.value)}>
            {CURRENCIES.map(c=><option key={c}>{c}</option>)}
          </select></div>
        <div className="form-field"><label>RECEIVE INDEX</label>
          <select value={terms.receive_index||'USD_SOFR'} onChange={e=>s('receive_index',e.target.value)}>
            {FLOAT_INDICES.map(i=><option key={i}>{i}</option>)}
          </select></div>
      </div>
    </div>
  )

  if (it === 'CDS') return (
    <div className="terms-form">
      <div className="form-field"><label>REFERENCE ENTITY</label>
        <input placeholder="APPLE INC" value={terms.reference_entity||''} onChange={e=>s('reference_entity',e.target.value)}/></div>
      <div className="form-row-2">
        <div className="form-field"><label>PROTECTION</label>
          <select value={terms.protection_buy_sell||'BUY'} onChange={e=>s('protection_buy_sell',e.target.value)}>
            <option>BUY</option><option>SELL</option>
          </select></div>
        <div className="form-field"><label>SPREAD (bps)</label>
          <input placeholder="120" value={terms.cds_spread_bps||''} onChange={e=>s('cds_spread_bps',e.target.value)}/></div>
      </div>
      <div className="form-row-2">
        <div className="form-field"><label>RECOVERY RATE</label>
          <input placeholder="0.40" value={terms.recovery_rate||''} onChange={e=>s('recovery_rate',e.target.value)}/></div>
        <div className="form-field"><label>SENIORITY</label>
          <select value={terms.seniority||'SENIOR_UNSECURED'} onChange={e=>s('seniority',e.target.value)}>
            <option value="SENIOR_UNSECURED">SENIOR UNSECURED</option>
            <option value="SUBORDINATED">SUBORDINATED</option>
          </select></div>
      </div>
    </div>
  )

  return (
    <div className="terms-form">
      <p style={{color:'var(--text-dim)',fontSize:'0.72rem'}}>
        Generic — no specific form for {it}
      </p>
    </div>
  )
}

// ── Format helpers ─────────────────────────────────────────────────────────────

function fmtN(n) {
  if (!n) return '—'
  if (n >= 1e9) return \`\${(n/1e9).toFixed(1)}B\`
  if (n >= 1e6) return \`\${(n/1e6).toFixed(0)}M\`
  if (n >= 1e3) return \`\${(n/1e3).toFixed(0)}K\`
  return String(n)
}

function fmtD(d) { return d ? d.substring(0,10) : '—' }

function tenor(t) {
  if (!t.effective_date || !t.maturity_date) return '—'
  const yrs = (new Date(t.maturity_date) - new Date(t.effective_date)) / (365.25*864e5)
  if (yrs >= 1) return \`\${yrs.toFixed(1)}Y\`
  return \`\${Math.round(yrs*12)}M\`
}

// ── Trade row ──────────────────────────────────────────────────────────────────

function TradeRow({ trade: t, selected, onSelect }) {
  const ac = AC_META[t.asset_class] || { color:'#fff', abbr: t.asset_class }
  const st = STATUS_META[t.status]  || { color:'#fff', label: t.status }
  const sr = STORE_META[t.store]    || { color:'#fff', label: t.store }
  return (
    <tr className={\`trade-row \${selected?'selected':''}\`}
        style={{ borderLeft: \`3px solid \${ac.color}\` }}
        onClick={() => onSelect(t)}>
      <td className="td-ref">{t.trade_ref}</td>
      <td><span className="badge" style={{color:ac.color, borderColor:ac.color+'40'}}>{ac.abbr}</span></td>
      <td className="td-instrument">{t.instrument_type}</td>
      <td className="td-cp">{t.counterparty?.name || '—'}</td>
      <td className="td-notional">{fmtN(t.notional)}<span className="ccy">{t.notional_ccy}</span></td>
      <td className="td-tenor">{tenor(t)}</td>
      <td className="td-date">{fmtD(t.trade_date)}</td>
      <td className="td-date">{fmtD(t.maturity_date)}</td>
      <td>
        <span className="status-dot" style={{background:st.color}}/>
        <span className="status-label" style={{color:st.color}}>{st.label}</span>
      </td>
      <td><span className="store-badge" style={{color:sr.color}}>{sr.label}</span></td>
    </tr>
  )
}

// ── Trade detail ───────────────────────────────────────────────────────────────

function TradeDetail({ trade: t, onClose, onStatusUpdate }) {
  const [busy, setBusy] = useState(false)
  if (!t) return null
  const ac = AC_META[t.asset_class] || {}
  const terms = t.terms || {}

  const upd = async (status) => {
    setBusy(true)
    await onStatusUpdate(t.id, status)
    setBusy(false)
  }

  return (
    <div className="trade-detail-panel">
      <div className="detail-header">
        <div>
          <div className="detail-ref">{t.trade_ref}</div>
          <div className="detail-sub" style={{color:ac.color}}>
            {t.instrument_type} · {t.asset_class}
          </div>
        </div>
        <button className="detail-close" onClick={onClose}>✕</button>
      </div>

      <div className="detail-section" style={{overflowY:'auto',flex:1}}>
        <div className="detail-grid-2">
          <div><span className="dl">COUNTERPARTY</span><span className="dv">{t.counterparty?.name||'—'}</span></div>
          <div><span className="dl">OWN ENTITY</span><span className="dv">{t.own_entity?.short_name||'—'}</span></div>
          <div><span className="dl">NOTIONAL</span><span className="dv">{t.notional?.toLocaleString()} {t.notional_ccy}</span></div>
          <div><span className="dl">TENOR</span><span className="dv">{tenor(t)}</span></div>
          <div><span className="dl">TRADE DATE</span><span className="dv">{fmtD(t.trade_date)}</span></div>
          <div><span className="dl">EFFECTIVE</span><span className="dv">{fmtD(t.effective_date)}</span></div>
          <div><span className="dl">MATURITY</span><span className="dv">{fmtD(t.maturity_date)}</span></div>
          <div><span className="dl">STORE</span><span className="dv">{t.store}</span></div>
          {t.desk && <div><span className="dl">DESK</span><span className="dv">{t.desk}</span></div>}
          {t.book && <div><span className="dl">BOOK</span><span className="dv">{t.book}</span></div>}
          {t.discount_curve_id && <div><span className="dl">DISCOUNT CURVE</span><span className="dv">{t.discount_curve_id}</span></div>}
          {t.forecast_curve_id && <div><span className="dl">FORECAST CURVE</span><span className="dv">{t.forecast_curve_id}</span></div>}
        </div>

        {Object.keys(terms).length > 0 && <>
          <div className="detail-section-title" style={{marginTop:'0.75rem'}}>ECONOMIC TERMS</div>
          <div className="detail-grid-2">
            {Object.entries(terms).map(([k,v]) => (
              <div key={k}>
                <span className="dl">{k.replace(/_/g,' ').toUpperCase()}</span>
                <span className="dv">{v?.toString()||'—'}</span>
              </div>
            ))}
          </div>
        </>}

        <div className="detail-section-title" style={{marginTop:'0.75rem'}}>LIFECYCLE</div>
        <div className="detail-actions">
          {t.status==='PENDING' && <button className="act-btn act-live" onClick={()=>upd('LIVE')} disabled={busy}>ACTIVATE</button>}
          {t.status==='LIVE'    && <button className="act-btn act-mat"  onClick={()=>upd('MATURED')} disabled={busy}>MATURE</button>}
          {['PENDING','LIVE'].includes(t.status) &&
            <button className="act-btn act-cancel" onClick={()=>upd('CANCELLED')} disabled={busy}>CANCEL</button>}
          {!['PENDING','LIVE'].includes(t.status) &&
            <span style={{fontSize:'0.65rem',color:'var(--text-dim)'}}>No actions available for {t.status}</span>}
        </div>
      </div>
    </div>
  )
}

// ── Add trade panel ────────────────────────────────────────────────────────────

function AddPanel({ cps, les, onAdd, onClose }) {
  const today = new Date().toISOString().substring(0,10)
  const [f, setF] = useState({
    trade_ref: \`TRD-\${Date.now().toString().slice(-8)}\`,
    asset_class: 'RATES', instrument_type: 'IR_SWAP',
    notional: '', notional_ccy: 'USD',
    trade_date: today, effective_date: today, maturity_date: '',
    counterparty_id: '', own_legal_entity_id: '',
    discount_curve_id: '', forecast_curve_id: '',
    desk: '', book: '', store: 'WORKING',
    terms: defaultTerms('IR_SWAP'),
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')

  const set = (k,v) => setF(x => ({...x,[k]:v}))

  const setAC = (ac) => {
    const it = INSTRUMENT_TYPES[ac]?.[0] || ''
    setF(x => ({...x, asset_class:ac, instrument_type:it, terms:defaultTerms(it)}))
  }
  const setIT = (it) => setF(x => ({...x, instrument_type:it, terms:defaultTerms(it)}))

  const submit = async () => {
    if (!f.trade_ref)    return setErr('Trade ref required')
    if (!f.maturity_date) return setErr('Maturity date required')
    if (!f.notional)     return setErr('Notional required')
    setErr(''); setBusy(true)

    const payload = {
      ...f,
      notional: parseFloat(f.notional.replace(/,/g,'')),
      status: 'PENDING',
    }
    ;['counterparty_id','own_legal_entity_id','discount_curve_id','forecast_curve_id','desk','book']
      .forEach(k => { if (!payload[k]) delete payload[k] })

    const res = await onAdd(payload)
    setBusy(false)
    if (res?.error) return setErr(res.error.message)
    onClose()
  }

  const ownLEs = les.filter(e => e.is_own_entity && e.is_active)

  return (
    <div className="add-panel">
      <div className="add-panel-header">
        <span>NEW TRADE</span>
        <button className="detail-close" onClick={onClose}>✕</button>
      </div>

      <div className="add-panel-body">
        <div className="form-section-title">IDENTIFICATION</div>
        <div className="form-row-2">
          <div className="form-field">
            <label>TRADE REF *</label>
            <input value={f.trade_ref} onChange={e=>set('trade_ref',e.target.value)}/>
          </div>
          <div className="form-field">
            <label>STORE</label>
            <select value={f.store} onChange={e=>set('store',e.target.value)}>
              <option>WORKING</option><option>PRODUCTION</option>
            </select>
          </div>
        </div>

        <div className="form-section-title">CLASSIFICATION</div>
        <div className="form-field">
          <label>ASSET CLASS</label>
          <div className="chip-row">
            {ASSET_CLASSES.map(ac=>(
              <button key={ac}
                className={\`chip \${f.asset_class===ac?'chip-active':''}\`}
                style={f.asset_class===ac&&AC_META[ac]?{borderColor:AC_META[ac].color,color:AC_META[ac].color}:{}}
                onClick={()=>setAC(ac)}>{ac}</button>
            ))}
          </div>
        </div>
        <div className="form-field">
          <label>INSTRUMENT TYPE</label>
          <select value={f.instrument_type} onChange={e=>setIT(e.target.value)}>
            {(INSTRUMENT_TYPES[f.asset_class]||[]).map(it=><option key={it}>{it}</option>)}
          </select>
        </div>

        <div className="form-section-title">ENTITIES</div>
        <div className="form-row-2">
          <div className="form-field">
            <label>OWN ENTITY</label>
            <select value={f.own_legal_entity_id} onChange={e=>set('own_legal_entity_id',e.target.value)}>
              <option value="">— select —</option>
              {ownLEs.map(e=><option key={e.id} value={e.id}>{e.short_name||e.name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label>COUNTERPARTY</label>
            <select value={f.counterparty_id} onChange={e=>set('counterparty_id',e.target.value)}>
              <option value="">— select —</option>
              {cps.filter(c=>c.is_active).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="form-section-title">ECONOMICS</div>
        <div className="form-row-2">
          <div className="form-field">
            <label>NOTIONAL *</label>
            <input placeholder="10,000,000" value={f.notional} onChange={e=>set('notional',e.target.value)}/>
          </div>
          <div className="form-field">
            <label>CURRENCY</label>
            <select value={f.notional_ccy} onChange={e=>set('notional_ccy',e.target.value)}>
              {CURRENCIES.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row-3">
          <div className="form-field">
            <label>TRADE DATE</label>
            <input type="date" value={f.trade_date} onChange={e=>set('trade_date',e.target.value)}/>
          </div>
          <div className="form-field">
            <label>EFFECTIVE DATE</label>
            <input type="date" value={f.effective_date} onChange={e=>set('effective_date',e.target.value)}/>
          </div>
          <div className="form-field">
            <label>MATURITY DATE *</label>
            <input type="date" value={f.maturity_date} onChange={e=>set('maturity_date',e.target.value)}/>
          </div>
        </div>

        <div className="form-section-title">INSTRUMENT TERMS</div>
        <TermsForm it={f.instrument_type} terms={f.terms} onChange={t=>set('terms',t)}/>

        <div className="form-section-title">PORTFOLIO</div>
        <div className="form-row-2">
          <div className="form-field">
            <label>DESK</label>
            <input placeholder="RATES TRADING" value={f.desk} onChange={e=>set('desk',e.target.value)}/>
          </div>
          <div className="form-field">
            <label>BOOK</label>
            <input placeholder="G10 RATES" value={f.book} onChange={e=>set('book',e.target.value)}/>
          </div>
        </div>

        {err && <div className="form-error">{err}</div>}
      </div>

      <div className="add-panel-footer">
        <button className="btn-cancel" onClick={onClose}>CANCEL</button>
        <button className="btn-confirm" onClick={submit} disabled={busy}>
          {busy ? 'BOOKING...' : 'BOOK TRADE'}
        </button>
      </div>
    </div>
  )
}

// ── Summary bar ────────────────────────────────────────────────────────────────

function SummaryBar({ trades }) {
  const live    = trades.filter(t=>t.status==='LIVE').length
  const pending = trades.filter(t=>t.status==='PENDING').length

  const byCCY = {}
  trades.filter(t=>t.status==='LIVE'&&t.notional&&t.notional_ccy).forEach(t=>{
    byCCY[t.notional_ccy] = (byCCY[t.notional_ccy]||0) + Number(t.notional)
  })
  const top = Object.entries(byCCY).sort(([,a],[,b])=>b-a).slice(0,3)

  return (
    <div className="summary-bar">
      <div className="summary-stat">
        <span className="summary-val">{trades.length}</span>
        <span className="summary-lbl">TOTAL</span>
      </div>
      <div className="summary-divider"/>
      <div className="summary-stat">
        <span className="summary-val" style={{color:'var(--accent)'}}>{live}</span>
        <span className="summary-lbl">LIVE</span>
      </div>
      <div className="summary-divider"/>
      <div className="summary-stat">
        <span className="summary-val" style={{color:'var(--amber)'}}>{pending}</span>
        <span className="summary-lbl">PENDING</span>
      </div>
      {top.map(([ccy,n])=>(
        <><div className="summary-divider" key={ccy+'-div'}/>
        <div className="summary-stat" key={ccy}>
          <span className="summary-val">
            {fmtN(n)}<span style={{fontSize:'0.62rem',opacity:0.55,marginLeft:'0.25rem'}}>{ccy}</span>
          </span>
          <span className="summary-lbl">LIVE NOTIONAL</span>
        </div></>
      ))}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function Trades() {
  const {
    trades, loading, error,
    filters, setFilter,
    fetchTrades, addTrade, updateTradeStatus,
    filteredTrades,
  } = useTradesStore()

  const [cps, setCps] = useState([])
  const [les, setLes] = useState([])
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd]   = useState(false)
  const [sortCol, setSortCol]   = useState('trade_date')
  const [sortDir, setSortDir]   = useState('desc')

  useEffect(() => {
    fetchTrades()
    supabase.from('counterparties').select('*').then(({data})=>setCps(data||[]))
    supabase.from('legal_entities').select('*').then(({data})=>setLes(data||[]))
  }, [])

  const toggleSort = (col) => {
    if (sortCol===col) setSortDir(d=>d==='asc'?'desc':'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const displayed = filteredTrades().slice().sort((a,b) => {
    const av = a[sortCol]??'', bv = b[sortCol]??''
    const c = av<bv?-1:av>bv?1:0
    return sortDir==='asc'?c:-c
  })

  const SH = ({col,label}) => (
    <th className={\`th-sortable \${sortCol===col?'th-active':''}\`} onClick={()=>toggleSort(col)}>
      {label} {sortCol===col?(sortDir==='asc'?'↑':'↓'):''}
    </th>
  )

  return (
    <div className="trades-workspace">
      <div className="trades-header">
        <div className="trades-title">
          <h2>TRADE BLOTTER</h2>
          <span className="trades-count">{displayed.length} of {trades.length} trades</span>
        </div>
        <button className="btn-add-trade" onClick={()=>{setShowAdd(true);setSelected(null)}}>
          + BOOK TRADE
        </button>
      </div>

      <SummaryBar trades={trades}/>

      <div className="trades-filters">
        <input className="filter-search"
          placeholder="SEARCH — ref, counterparty, desk, instrument..."
          value={filters.search}
          onChange={e=>setFilter('search',e.target.value)}/>
        <div className="filter-chips">
          {['ALL','PENDING','LIVE','MATURED','CANCELLED'].map(s=>(
            <button key={s}
              className={\`chip \${filters.status===s?'chip-active':''}\`}
              style={filters.status===s&&STATUS_META[s]?{borderColor:STATUS_META[s].color,color:STATUS_META[s].color}:{}}
              onClick={()=>setFilter('status',s)}>{s}</button>
          ))}
        </div>
        <div className="filter-chips">
          {['ALL',...ASSET_CLASSES].map(ac=>(
            <button key={ac}
              className={\`chip \${filters.assetClass===ac?'chip-active':''}\`}
              style={filters.assetClass===ac&&AC_META[ac]?{borderColor:AC_META[ac].color,color:AC_META[ac].color}:{}}
              onClick={()=>setFilter('assetClass',ac)}>{ac==='ALL'?'ALL CLASSES':ac}</button>
          ))}
        </div>
        <div className="filter-chips">
          {['ALL','WORKING','PRODUCTION','HISTORY'].map(s=>(
            <button key={s}
              className={\`chip \${filters.store===s?'chip-active':''}\`}
              onClick={()=>setFilter('store',s)}>{s==='ALL'?'ALL STORES':s}</button>
          ))}
        </div>
      </div>

      <div className={\`trades-main \${selected||showAdd?'with-panel':''}\`}>
        <div className="trades-grid-wrapper">
          {loading && <div className="trades-loading">LOADING BLOTTER...</div>}
          {error   && <div className="trades-error">{error}</div>}
          {!loading && !error && (
            <table className="trades-table">
              <thead>
                <tr>
                  <SH col="trade_ref"      label="REF"/>
                  <th>CLASS</th>
                  <SH col="instrument_type" label="INSTRUMENT"/>
                  <th>COUNTERPARTY</th>
                  <SH col="notional"       label="NOTIONAL"/>
                  <th>TENOR</th>
                  <SH col="trade_date"     label="TRADE DATE"/>
                  <SH col="maturity_date"  label="MATURITY"/>
                  <SH col="status"         label="STATUS"/>
                  <th>STORE</th>
                </tr>
              </thead>
              <tbody>
                {displayed.length===0
                  ? <tr><td colSpan={10} className="empty-row">
                      {trades.length===0
                        ? 'NO TRADES — CLICK + BOOK TRADE TO BEGIN'
                        : 'NO TRADES MATCH CURRENT FILTERS'}
                    </td></tr>
                  : displayed.map(t=>(
                    <TradeRow key={t.id} trade={t}
                      selected={selected?.id===t.id}
                      onSelect={t=>{setSelected(t);setShowAdd(false)}}/>
                  ))
                }
              </tbody>
            </table>
          )}
        </div>

        {selected && !showAdd && (
          <TradeDetail trade={selected} onClose={()=>setSelected(null)}
            onStatusUpdate={async (id,status)=>{
              await updateTradeStatus(id,status)
              setSelected(p=>p?{...p,status}:null)
            }}/>
        )}
        {showAdd && (
          <AddPanel cps={cps} les={les} onAdd={addTrade}
            onClose={()=>setShowAdd(false)}/>
        )}
      </div>
    </div>
  )
}
`);

// ─── App.jsx ──────────────────────────────────────────────────────────────────
write('src/App.jsx', `import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/useAuthStore'

import AuthGuard        from './components/auth/AuthGuard'
import LoginPage        from './components/auth/LoginPage'
import SignupPage       from './components/auth/SignupPage'
import ConfirmPage      from './components/auth/ConfirmPage'
import CommandCenter    from './components/CommandCenter'
import AppBar           from './components/layout/AppBar'
import CfgNav           from './components/layout/CfgNav'
import StubPage         from './components/layout/StubPage'

import CurvesWorkspace  from './components/market-data/CurvesWorkspace'
import OrgHierarchy     from './components/org/OrgHierarchy'
import LegalEntities    from './components/onboarding/LegalEntities'
import Counterparties   from './components/onboarding/Counterparties'
import Trades           from './components/trades/Trades'

function ConfigLayout() {
  return (
    <div style={{ display:'flex', height:'100vh', flexDirection:'column' }}>
      <AppBar />
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        <CfgNav />
        <main style={{ flex:1, overflow:'auto', background:'var(--bg)' }}>
          <AuthGuard />
        </main>
      </div>
    </div>
  )
}

export default function App() {
  const { initAuth, loading } = useAuthStore()

  useEffect(() => { initAuth() }, [])

  if (loading) {
    return (
      <div style={{
        height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
        background:'var(--bg)', color:'var(--accent)',
        fontFamily:'var(--mono)', fontSize:'0.75rem', letterSpacing:'0.15em',
      }}>
        INITIALISING...
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login"   element={<LoginPage />} />
        <Route path="/signup"  element={<SignupPage />} />
        <Route path="/confirm" element={<ConfirmPage />} />

        {/* Protected */}
        <Route element={<AuthGuard />}>
          <Route path="/command-center" element={<CommandCenter />} />
          <Route element={<ConfigLayout />}>
            <Route path="/configurations">
              <Route index element={<Navigate to="market-data/curves" replace />} />
              <Route path="market-data/curves" element={<CurvesWorkspace />} />
              <Route path="org-hierarchy"      element={<OrgHierarchy />} />
              <Route path="legal-entities"     element={<LegalEntities />} />
              <Route path="counterparties"     element={<Counterparties />} />
              <Route path="blotter"            element={<Trades />} />
            </Route>
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/command-center" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
`);

// ─── CfgNav.jsx ───────────────────────────────────────────────────────────────
write('src/components/layout/CfgNav.jsx', `import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

const SECTIONS = [
  {
    id: 'market-data',
    label: 'MARKET DATA',
    items: [
      { label: 'RATES CURVES', path: '/configurations/market-data/curves' },
    ],
  },
  {
    id: 'infrastructure',
    label: 'INFRASTRUCTURE',
    items: [
      { label: 'ORG HIERARCHY', path: '/configurations/org-hierarchy' },
    ],
  },
  {
    id: 'onboarding',
    label: 'ONBOARDING',
    items: [
      { label: 'LEGAL ENTITIES',  path: '/configurations/legal-entities' },
      { label: 'COUNTERPARTIES',  path: '/configurations/counterparties' },
    ],
  },
  {
    id: 'blotter',
    label: 'BLOTTER',
    items: [
      { label: 'TRADE BLOTTER', path: '/configurations/blotter' },
    ],
  },
]

export default function CfgNav() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState({})

  const toggle = (id) => setCollapsed(s => ({ ...s, [id]: !s[id] }))

  return (
    <nav style={{
      width: '200px',
      minWidth: '200px',
      background: 'var(--panel)',
      borderRight: '1px solid var(--border)',
      overflowY: 'auto',
      padding: '1rem 0',
    }}>
      {SECTIONS.map(sec => {
        const isOpen = !collapsed[sec.id]
        const active = sec.items.some(i => location.pathname === i.path)
        return (
          <div key={sec.id} style={{ marginBottom: '0.25rem' }}>
            <button
              onClick={() => toggle(sec.id)}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                padding: '0.45rem 1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                fontFamily: 'var(--mono)',
                fontSize: '0.6rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                color: active ? 'var(--accent)' : 'var(--text-dim)',
                transition: 'color 0.15s',
              }}
            >
              <span>{sec.label}</span>
              <span style={{ fontSize: '0.55rem', opacity: 0.6 }}>{isOpen ? '▾' : '▸'}</span>
            </button>

            {isOpen && sec.items.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                style={({ isActive }) => ({
                  display: 'block',
                  padding: '0.35rem 1rem 0.35rem 1.5rem',
                  fontFamily: 'var(--mono)',
                  fontSize: '0.68rem',
                  letterSpacing: '0.06em',
                  color: isActive ? 'var(--accent)' : 'var(--text)',
                  textDecoration: 'none',
                  borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  background: isActive
                    ? 'color-mix(in srgb, var(--accent) 6%, transparent)'
                    : 'transparent',
                  transition: 'all 0.12s',
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )
}
`);

console.log('\n✅  Trades UI complete. Files written:');
console.log('  src/store/useTradesStore.js');
console.log('  src/components/trades/Trades.css');
console.log('  src/components/trades/Trades.jsx');
console.log('  src/App.jsx');
console.log('  src/components/layout/CfgNav.jsx');
console.log('\nRemember to run the Supabase SQL migration (script 3) before testing the blotter.');
