// trade-window/sections.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Section primitives. Each is a small, presentation-only component. The
// TradeWindow shell composes them in a fixed vertical sequence. Product
// descriptors feed data in via props — never via context or registry reach-in.
//
// Styling uses Rijeka's Pure Black theme with CSS variables so the old and new
// systems can coexist during the strangler-fig migration.
//
// File is consolidated (9 components in one file) to reduce import surface
// during Sprint 10. If any section grows beyond ~80 lines, extract it to
// sections/<name>.jsx at that point.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react'

const TABS = ['TRADE','DETAILS','CASHFLOWS','XVA','CURVE SCENARIO','◆ CONFIRM']

// ── TabBar ─────────────────────────────────────────────────────────────────

export function TabBar({ active = 'TRADE', onTab = () => {} }) {
  return (
    <div className="tbw-tabbar">
      {TABS.map(t => (
        <button key={t} className={`tbw-tab ${t === active ? 'is-active' : ''}`}
                onClick={() => onTab(t)}>{t}</button>
      ))}
    </div>
  )
}

// ── InstrumentSelector (asset class + product + optional structure chips) ──

export function InstrumentSelector({
  assetClasses, activeAssetClass, onAssetClassChange,
  products, activeProductKey, onProductChange,
  structures, activeStructure, onStructureChange,
}) {
  return (
    <div className="tbw-sec">
      <div className="tbw-lbl">INSTRUMENT</div>

      <div className="tbw-chip-row">
        {assetClasses.map(c => (
          <button key={c}
                  className={`tbw-chip ${c === activeAssetClass ? 'is-on' : ''}`}
                  onClick={() => onAssetClassChange?.(c)}>
            {c}
          </button>
        ))}
      </div>

      <div className="tbw-chip-row">
        {products.map(p => (
          <button key={p.key}
                  className={`tbw-chip ${p.key === activeProductKey ? 'is-on' : ''}`}
                  disabled={p.live === false}
                  onClick={() => onProductChange(p.key)}>
            {p.label.toUpperCase()}{p.live === false ? ' SOON' : ''}
          </button>
        ))}
      </div>

      {structures.length > 0 && (
        <div className="tbw-chip-row">
          {structures.map(s => (
            <button key={s.key}
                    className={`tbw-chip ${s.key === activeStructure ? 'is-on' : ''}`}
                    disabled={s.live === false}
                    onClick={() => onStructureChange(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CounterpartyBlock (identical across every product) ─────────────────────

export function CounterpartyBlock({ state = {}, onChange = () => {} }) {
  return (
    <div className="tbw-sec">
      <div className="tbw-lbl">COUNTERPARTY + BOOK</div>
      <div className="tbw-grid-6">
        <Field label="OWN ENTITY">
          <select defaultValue="RIJEKA"><option>RIJEKA</option></select>
        </Field>
        <Field label="COUNTERPARTY">
          <select defaultValue=""><option value="">— select —</option></select>
        </Field>
        <Field label="TRADE DATE">
          <input type="date" defaultValue={new Date().toISOString().slice(0,10)} />
        </Field>
        <Field label="DESK"><select><option>—</option></select></Field>
        <Field label="BOOK"><select><option>—</option></select></Field>
      </div>
    </div>
  )
}

// ── PrimaryEconomics (universal: notional/ccy/direction/tenor/dates) ───────

export function PrimaryEconomics({
  state, direction, directionLabels,
  onDirectionChange, onChange,
}) {
  return (
    <div className="tbw-sec">
      <div className="tbw-lbl">PRIMARY ECONOMICS</div>
      <div className="tbw-grid-6">
        <Field label="NOTIONAL">
          <input className="tbw-mono" value={state.notional?.toLocaleString() ?? ''}
                 onChange={e => onChange({ notional: parseNum(e.target.value) })} />
        </Field>
        <Field label="CCY">
          <select value={state.ccy} onChange={e => onChange({ ccy: e.target.value })}>
            {['USD','EUR','GBP','JPY','CHF','AUD','CAD'].map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="DIRECTION">
          <div className="tbw-chip-row" style={{ gap: 4 }}>
            <button className={`tbw-chip tbw-chip-dir-pay ${direction === 'PAY' ? 'is-on' : ''}`}
                    onClick={() => onDirectionChange('PAY')}>
              {directionLabels.pay}
            </button>
            <button className={`tbw-chip ${direction === 'RECEIVE' ? 'is-on' : ''}`}
                    onClick={() => onDirectionChange('RECEIVE')}>
              {directionLabels.receive}
            </button>
          </div>
        </Field>
        <Field label="TENOR">
          <select value={state.tenor} onChange={e => onChange({ tenor: e.target.value })}>
            {['1M','3M','6M','1Y','2Y','3Y','5Y','7Y','10Y','15Y','20Y','30Y']
              .map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="EFF DATE">
          <input type="date" value={state.effDate || ''}
                 onChange={e => onChange({ effDate: e.target.value })} />
        </Field>
        <Field label="MAT DATE">
          <input type="date" value={state.matDate || ''}
                 onChange={e => onChange({ matDate: e.target.value })} />
        </Field>
      </div>
    </div>
  )
}

// ── ProductTerms (dispatches to descriptor.terms.Component) ─────────────────

export function ProductTerms({ descriptor, state, update }) {
  if (!descriptor?.terms?.Component) return null
  const helper = descriptor.terms.helper ? descriptor.terms.helper(state) : null
  const Body   = descriptor.terms.Component
  return (
    <div className="tbw-sec">
      <div className="tbw-terms-header">
        <span className="tbw-lbl">{descriptor.terms.title}</span>
        {helper && (
          <span className="tbw-helper-badge"
                style={{ borderColor: helper.color, color: helper.color }}>
            {helper.text}
          </span>
        )}
      </div>
      <Body state={state} update={update} />
      {descriptor.terms.footerText && (
        <div className="tbw-terms-footer">{descriptor.terms.footerText}</div>
      )}
    </div>
  )
}

// ── OptionFeeBlock (shown only when descriptor.optionFee !== null) ──────────

export function OptionFeeBlock({ spec, state, update }) {
  const [mode, setMode] = useState('BP')
  return (
    <div className="tbw-sec">
      <div className="tbw-sec-header">
        <span className="tbw-lbl">OPTION FEE</span>
        <span className="tbw-helper-text">no premium entered</span>
      </div>
      <div className="tbw-grid" style={{ gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
        <Field label="PREMIUM AMOUNT">
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="tbw-mono tbw-amber" value={state.premium ?? '0.00'}
                   onChange={e => update({ premium: e.target.value })} style={{ flex: 1 }} />
            {spec.premiumInBpOrDollar && (
              <>
                <button className={`tbw-chip ${mode === 'BP' ? 'is-on-amber' : ''}`}
                        onClick={() => setMode('BP')}>BP</button>
                <button className={`tbw-chip ${mode === 'DOLLAR' ? 'is-on-amber' : ''}`}
                        onClick={() => setMode('DOLLAR')}>$</button>
              </>
            )}
          </div>
        </Field>
        <Field label="SETTLE DATE">
          <input type="date" value={state.settleDate ?? ''}
                 onChange={e => update({ settleDate: e.target.value })} />
        </Field>
        <div className="tbw-helper-text" style={{ alignSelf: 'center' }}>
          {spec.multiPaymentAllowed
            ? 'Multi-payment schedule available in DETAILS tab'
            : 'Single premium payment'}
        </div>
      </div>
    </div>
  )
}

// ── AnalyticsBlock (metrics grid + collapsible breakdown table) ─────────────

export function AnalyticsBlock({ descriptor, result, pricing, error, state }) {
  const [open, setOpen] = useState(true)

  if (error) {
    return (
      <div className="tbw-sec">
        <div className="tbw-lbl">ANALYTICS</div>
        <div className="tbw-error">{error}</div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="tbw-sec">
        <div className="tbw-lbl">ANALYTICS <span className="tbw-mut">
          · {pricing ? 'pricing…' : 'price to load'}
        </span></div>
      </div>
    )
  }

  const metrics   = descriptor.analytics.metrics(result) || []
  const breakdown = descriptor.analytics.breakdown(result)

  return (
    <div className="tbw-sec">
      <div className="tbw-sec-header">
        <span className="tbw-lbl">
          ANALYTICS <span className="tbw-mut" style={{ marginLeft: 6 }}>
            {result.curve_id || ''} · {result.valuation_date || ''}
          </span>
        </span>
      </div>

      <div className="tbw-metrics-grid">
        {metrics.map((m, i) => (
          <MetricCard key={i} {...m} />
        ))}
      </div>

      {breakdown && (
        <div className="tbw-breakdown-wrap">
          <button className="tbw-breakdown-toggle" onClick={() => setOpen(o => !o)}>
            {open ? '▾' : '▸'} BREAKDOWN ({breakdown.kind.toUpperCase()})
          </button>
          {open && (
            <table className="tbw-breakdown-table">
              <thead>
                <tr>{breakdown.columns.map(c => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {breakdown.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}
                          dangerouslySetInnerHTML={
                            typeof cell === 'string' && cell.includes('<')
                              ? { __html: cell } : undefined
                          }>
                        {typeof cell === 'string' && cell.includes('<') ? undefined : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── XVASummary (universal, simple link to XVA tab) ──────────────────────────

export function XVASummary({ result }) {
  return (
    <div className="tbw-sec">
      <div className="tbw-sec-header">
        <div>
          <div className="tbw-lbl">XVA</div>
          <div className="tbw-mut">CVA · DVA · FVA · FBA · KVA · MVA · All-In rate</div>
        </div>
        <div className="tbw-mut">→ SIMULATE in XVA tab</div>
      </div>
    </div>
  )
}

// ── TradeFooter (sticky: metric chips + STRUCTURE + PRICE + BOOK) ───────────

export function TradeFooter({
  descriptor, result, state, pricing, onPrice, onBook, onCancel,
}) {
  const metrics = result ? (descriptor.footer.metrics(result, state) || []) : []
  const structLabel = descriptor.footer.structureLabel(state)

  return (
    <div className="tbw-footer">
      <div className="tbw-footer-metrics">
        {metrics.map((m, i) => (
          <div key={i} className="tbw-footer-metric">
            <div className="tbw-lbl" style={{ fontSize: 9, marginBottom: 2 }}>{m.label}</div>
            <div className={`tbw-mono tbw-${m.colorBy || 'default'}`}
                 style={{ fontSize: 13, fontWeight: 500 }}>
              {m.value ?? '—'}
            </div>
          </div>
        ))}
      </div>

      <div className="tbw-footer-actions">
        <div className="tbw-struct-label">
          STRUCTURE <span className="tbw-struct-value">{structLabel}</span>
        </div>
        <button className="tbw-btn tbw-btn-cancel" onClick={onCancel}>CANCEL</button>
        <button className="tbw-btn tbw-btn-price" disabled={pricing} onClick={onPrice}>
          {pricing ? '⏳ PRICING…' : '▶ PRICE'}
        </button>
        <button className="tbw-btn tbw-btn-book" disabled={!result} onClick={onBook}>
          ▶ BOOK TRADE
        </button>
      </div>
    </div>
  )
}

// ── Shared primitives ───────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div>
      <div className="tbw-lbl">{label}</div>
      {children}
    </div>
  )
}

function MetricCard({ label, value, colorBy }) {
  return (
    <div className="tbw-metric-card">
      <div className="tbw-lbl" style={{ marginBottom: 6 }}>{label}</div>
      <div className={`tbw-mono tbw-${colorBy || 'default'}`}
           style={{ fontSize: 16, fontWeight: 500 }}>
        {value ?? '—'}
      </div>
    </div>
  )
}

function parseNum(s) {
  const n = Number(String(s).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
