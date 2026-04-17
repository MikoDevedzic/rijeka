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

// ─────────────────────────────────────────────────────────────────────────────
// CashflowsPanel (Patch 18)
// Full-tab content for the CASHFLOWS view. Reads from `result` (priced
// analytics). No backend calls. Handles swap/swaption (per-leg tables) and
// cap/floor/collar (caplet table).
// ─────────────────────────────────────────────────────────────────────────────

const CCY_CURVE_MAP = {
  USD: 'USD_SOFR', EUR: 'EUR_ESTR', GBP: 'GBP_SONIA',
  JPY: 'JPY_TONA', CHF: 'CHF_SARON', AUD: 'AUD_AONIA', CAD: 'CAD_CORRA',
}

function fmtDate(d) {
  if (!d) return '\u2014'
  // Input is 'YYYY-MM-DD' from backend — render as-is, compact
  return String(d)
}

function fmtN(v) {
  if (v == null) return '\u2014'
  return Math.round(Number(v)).toLocaleString('en-US')
}

function fmtPnl(v) {
  if (v == null) return '\u2014'
  const n = Number(v)
  const sign = n >= 0 ? '+' : '\u2212'
  return sign + '$' + Math.abs(Math.round(n)).toLocaleString('en-US')
}

function CashflowSummaryCard({ label, value, colorKey }) {
  return (
    <div style={{
      background: '#0C0C0C',
      border: '1px solid #1E1E1E',
      borderRadius: 2,
      padding: '6px 10px',
    }}>
      <div style={{
        fontSize: 10,
        color: '#666',
        letterSpacing: '0.08em',
        fontWeight: 600,
        marginBottom: 3,
      }}>{label}</div>
      <div style={{
        fontSize: 14,
        fontWeight: 700,
        fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
        color: colorKey === 'accent'  ? '#00D4A8'
             : colorKey === 'negative'? '#FF6B6B'
             : colorKey === 'blue'    ? '#4A9EFF'
             : colorKey === 'amber'   ? '#F5C842'
             : '#F0F0F0',
      }}>{value}</div>
    </div>
  )
}

function CapletTable({ result, ccy }) {
  const caplets = result.caplets || result.cap?.caplets || []
  const npv     = result.npv != null ? result.npv : result.net_npv
  const premiumPct = result.premium_pct != null ? result.premium_pct : result.net_pct
  const nCaps   = result.n_caplets || result.cap?.n_caplets || caplets.length
  const volBp   = result.vol_bp || result.cap_vol_bp || 0
  const volTier = result.vol_tier || result.cap_vol_tier || ''
  const atmFwd  = result.atm_forward_pct || 0

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6,
        marginBottom: 10,
      }}>
        <CashflowSummaryCard label="OPTION NPV"
          value={fmtPnl(npv)}
          colorKey={(npv || 0) >= 0 ? 'accent' : 'negative'} />
        <CashflowSummaryCard label="PREMIUM %"
          value={premiumPct != null ? premiumPct.toFixed(4) + '%' : '\u2014'}
          colorKey="accent" />
        <CashflowSummaryCard label="CAPLETS"
          value={nCaps + (volTier ? '' : '')}
          colorKey="blue" />
        <CashflowSummaryCard label="VOL (bp)"
          value={volBp.toFixed(1) + 'bp' + (volTier ? ' (' + volTier + ')' : '')}
          colorKey="amber" />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
          fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
        }}>
          <thead>
            <tr style={{ background: '#050505', borderBottom: '1px solid #1E1E1E' }}>
              {['#','PERIOD START','PERIOD END','FWD RATE','DF','\u03C4','VOL (bp)','PV'].map((h, i) => (
                <th key={h} style={{
                  padding: '5px 8px',
                  textAlign: i < 3 ? 'left' : 'right',
                  color: '#666',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {caplets.map((cl, i) => (
              <tr key={i} style={{
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
              }}>
                <td style={{ padding: '4px 8px', color: '#666' }}>{cl.period != null ? cl.period : i + 1}</td>
                <td style={{ padding: '4px 8px', color: '#888' }}>
                  {cl.start_date ? fmtDate(cl.start_date) : (cl.expiry_y || 0).toFixed(4) + 'Y'}
                </td>
                <td style={{ padding: '4px 8px', color: '#888' }}>
                  {cl.end_date ? fmtDate(cl.end_date) : '\u2014'}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: '#4A9EFF' }}>
                  {(cl.forward || 0).toFixed(4)}%
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: '#888' }}>
                  {(cl.df || 0).toFixed(5)}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: '#888' }}>
                  {(cl.tau || 0).toFixed(5)}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: '#F5C842', fontWeight: 600 }}>
                  {(cl.vol_bp || volBp || 0).toFixed(1)}
                </td>
                <td style={{
                  padding: '4px 8px',
                  textAlign: 'right',
                  color: (cl.pv || 0) >= 0 ? '#00D4A8' : '#FF6B6B',
                  fontWeight: 600,
                }}>{fmtPnl(cl.pv)}</td>
              </tr>
            ))}
            <tr style={{
              borderTop: '2px solid #1E1E1E',
              background: 'rgba(255,255,255,0.02)',
            }}>
              <td colSpan={7} style={{
                padding: '5px 8px',
                fontWeight: 700,
                color: '#888',
                letterSpacing: '0.08em',
              }}>TOTAL</td>
              <td style={{
                padding: '5px 8px',
                textAlign: 'right',
                fontWeight: 700,
                color: (npv || 0) >= 0 ? '#00D4A8' : '#FF6B6B',
              }}>{fmtPnl(npv)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{
        fontSize: 11,
        color: '#666',
        fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
        padding: '4px 0',
      }}>
        {CCY_CURVE_MAP[ccy] || 'USD_SOFR'} \u00B7 Bachelier Normal \u00B7 ATM fwd = {atmFwd.toFixed(4)}%
      </div>
    </>
  )
}

function SwapCashflowTables({ result, productKey, state }) {
  const legs   = result.legs || []
  const npv    = result.npv
  const ccy    = state.ccy || 'USD'
  const isSwpn = productKey === 'IR_SWAPTION'

  const fixedLeg = legs.find(l => l.leg_type === 'FIXED')
  const floatLeg = legs.find(l => l.leg_type === 'FLOAT')
  const fixedPeriods = fixedLeg ? (fixedLeg.cashflows || []).length : 0
  const floatPeriods = floatLeg ? (floatLeg.cashflows || []).length : 0

  return (
    <>
      {isSwpn && (
        <div style={{
          background: 'rgba(74,158,255,0.05)',
          border: '1px solid rgba(74,158,255,0.2)',
          borderRadius: 2,
          padding: '8px 12px',
          marginBottom: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{
              fontSize: 10, fontWeight: 700,
              letterSpacing: '0.12em', color: '#4A9EFF',
            }}>UNDERLYING FORWARD SWAP CASHFLOWS</span>
            <span style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 2,
              background: 'rgba(74,158,255,0.1)',
              border: '1px solid rgba(74,158,255,0.3)',
              color: '#4A9EFF',
            }}>
              {(state.swaptionExpiry || '1Y')}{'\u00D7'}{state.tenor || '5Y'}{' \u00B7 Physical Settlement'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#888' }}>
            {'On exercise, this swaption delivers into the swap schedule below. '}
            {'Effective date shifts forward by '}{state.swaptionExpiry || '1Y'}{' from today. '}
            {'Sum of PV column = forward swap NPV (\u2248 $0 at ATM strike).'}
          </div>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6,
        marginBottom: 10,
      }}>
        <CashflowSummaryCard label={isSwpn ? 'OPTION NPV' : 'NET NPV'}
          value={fmtPnl(npv)}
          colorKey={npv != null && npv >= 0 ? 'accent' : 'negative'} />
        <CashflowSummaryCard label={isSwpn ? 'FWD FIXED LEG PV' : 'FIXED LEG PV'}
          value={fixedLeg ? fmtPnl(fixedLeg.pv) : '\u2014'}
          colorKey="negative" />
        <CashflowSummaryCard label={isSwpn ? 'FWD FLOAT LEG PV' : 'FLOAT LEG PV'}
          value={floatLeg ? fmtPnl(floatLeg.pv) : '\u2014'}
          colorKey="accent" />
        <CashflowSummaryCard label="PERIODS"
          value={fixedPeriods + ' + ' + floatPeriods}
          colorKey="blue" />
      </div>

      {legs.map((leg, li) => (
        <div key={li} style={{ marginBottom: 14 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 0 4px',
            borderBottom: '1px solid #1E1E1E',
          }}>
            <span style={{
              fontSize: 11, fontWeight: 700,
              letterSpacing: '0.12em', color: '#888',
            }}>{leg.leg_type} LEG</span>
            <span style={{
              fontSize: 11, fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 2,
              background: leg.direction === 'PAY' ? 'rgba(255,107,107,0.10)' : 'rgba(0,212,168,0.10)',
              border: '1px solid ' + (leg.direction === 'PAY' ? '#FF6B6B' : '#00D4A8'),
              color: leg.direction === 'PAY' ? '#FF6B6B' : '#00D4A8',
            }}>{leg.direction === 'PAY' ? '\u2192 PAY' : '\u2190 RECEIVE'}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              minWidth: 680,
              fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
            }}>
              <thead>
                <tr style={{ background: '#050505', borderBottom: '1px solid #1E1E1E' }}>
                  {['PERIOD START','PERIOD END','PAY DATE','DCF','NOTIONAL',
                    leg.leg_type === 'FIXED' ? 'RATE' : 'FWD RATE',
                    'AMOUNT','DF','PV','ZR%'].map((h, i) => (
                    <th key={h} style={{
                      fontSize: 10,
                      color: '#666',
                      padding: '4px 6px',
                      textAlign: i < 3 ? 'left' : 'right',
                      fontWeight: 600,
                      letterSpacing: '0.07em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(leg.cashflows || []).map((cf, ci) => {
                  const pv = cf.pv != null
                    ? cf.pv
                    : (cf.amount * (cf.df || 1) * (leg.direction === 'PAY' ? -1 : 1))
                  const payShifted = cf.payment_date !== cf.period_end
                  return (
                    <tr key={ci} style={{ borderBottom: '1px solid #0E0E0E' }}>
                      <td style={{ fontSize: 11, padding: '5px 6px', color: '#888' }}>{fmtDate(cf.period_start)}</td>
                      <td style={{ fontSize: 11, padding: '5px 6px', color: '#888' }}>{fmtDate(cf.period_end)}</td>
                      <td style={{
                        fontSize: 11, padding: '5px 6px',
                        color: payShifted ? '#F5C842' : '#888',
                      }}>{fmtDate(cf.payment_date)}</td>
                      <td style={{ fontSize: 11, padding: '5px 6px', textAlign: 'right', color: '#4A9EFF' }}>
                        {cf.dcf != null ? cf.dcf.toFixed(5) : '\u2014'}
                      </td>
                      <td style={{ fontSize: 11, padding: '5px 6px', textAlign: 'right', color: '#888' }}>
                        {fmtN(cf.notional)}
                      </td>
                      <td style={{ fontSize: 11, padding: '5px 6px', textAlign: 'right', color: '#4A9EFF' }}>
                        {cf.rate != null ? (cf.rate * 100).toFixed(4) + '%' : '\u2014'}
                      </td>
                      <td style={{ fontSize: 11, padding: '5px 6px', textAlign: 'right', color: '#F0F0F0' }}>
                        {fmtN(cf.amount)}
                      </td>
                      <td style={{ fontSize: 11, padding: '5px 6px', textAlign: 'right', color: '#888' }}>
                        {cf.df != null ? cf.df.toFixed(5) : '\u2014'}
                      </td>
                      <td style={{
                        fontSize: 12, padding: '5px 6px', textAlign: 'right',
                        fontWeight: 600,
                        color: pv >= 0 ? '#00D4A8' : '#FF6B6B',
                      }}>{fmtPnl(pv)}</td>
                      <td style={{ fontSize: 11, padding: '5px 6px', textAlign: 'right', color: '#888' }}>
                        {cf.zero_rate != null ? (cf.zero_rate * 100).toFixed(3) : '\u2014'}
                      </td>
                    </tr>
                  )
                })}
                <tr style={{
                  borderTop: '2px solid #1E1E1E',
                  background: 'rgba(255,255,255,0.02)',
                }}>
                  <td colSpan={6} style={{
                    fontSize: 11, fontWeight: 700,
                    color: '#888',
                    padding: '5px 6px',
                    letterSpacing: '0.08em',
                  }}>TOTAL</td>
                  <td style={{
                    fontSize: 12, fontWeight: 700,
                    padding: '5px 6px',
                    textAlign: 'right',
                    color: '#F0F0F0',
                  }}>
                    {fmtN((leg.cashflows || []).reduce((s, cf) => s + (cf.amount || 0), 0))}
                  </td>
                  <td />
                  <td style={{
                    fontSize: 12, fontWeight: 700,
                    padding: '5px 6px',
                    textAlign: 'right',
                    color: leg.pv >= 0 ? '#00D4A8' : '#FF6B6B',
                  }}>{fmtPnl(leg.pv)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div style={{
        fontSize: 11,
        color: '#666',
        fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
        padding: '4px 0',
      }}>
        {CCY_CURVE_MAP[ccy] || 'USD_SOFR'}
        {result.curve_mode ? ' \u00B7 ' + result.curve_mode : ''}
        {result.valuation_date ? ' \u00B7 ' + result.valuation_date : ''}
        {' \u00B7 amber = pay date shifted by calendar'}
      </div>
    </>
  )
}

// Synthesize forward-swap cashflow rows from the /api/price/swaption response
// (Patch 19d). The backend already returns forward_rate, payment_dates, and
// coupon_dfs — we build the displayed legs directly from that.
function synthesizeSwaptionLegs(result, state) {
  const debug = result._debug || {}
  const paymentDates = debug.payment_dates || []
  const couponDfs    = debug.coupon_dfs    || []
  const pStart       = debug.P_start       || 1
  const fwdRate      = debug.forward_rate  != null ? debug.forward_rate
                     : (result.forward_rate || 0)
  const notional     = debug.notional      || Number(state.notional) || 10000000
  const isPayer      = debug.is_payer      != null ? debug.is_payer
                     : (state.direction === 'PAY')
  const payFreqY     = debug.pay_freq_y    || 1.0

  if (!paymentDates.length || !couponDfs.length) return []

  // Forward effective = day before first coupon's period start; approximate
  // by shifting first payment back by payFreqY years.
  const startDate = (() => {
    if (debug.start_date) return debug.start_date
    const d = new Date(paymentDates[0])
    d.setDate(d.getDate() - Math.round(payFreqY * 365.25))
    return d.toISOString().slice(0, 10)
  })()

  // Fixed leg: coupon at forward rate for each period. Direction follows
  // the swaption's is_payer flag (payer pays fixed).
  const fixedDir = isPayer ? 'PAY' : 'RECEIVE'
  const floatDir = isPayer ? 'RECEIVE' : 'PAY'

  const fixedCashflows = paymentDates.map((payDate, i) => {
    const periodStart = i === 0 ? startDate : paymentDates[i - 1]
    const periodEnd   = payDate
    const dcf         = payFreqY
    const amount      = notional * fwdRate * dcf
    const df          = couponDfs[i] || 1
    const pv          = amount * df * (fixedDir === 'PAY' ? -1 : 1)
    return {
      period_start: periodStart,
      period_end:   periodEnd,
      payment_date: payDate,
      dcf, notional,
      rate: fwdRate,
      amount, df, pv,
      zero_rate: null,
    }
  })

  const fixedTotalPv = fixedCashflows.reduce((s, cf) => s + cf.pv, 0)

  // Float leg: PV mirrors fixed leg (at ATM, |FIXED PV| = |FLOAT PV|).
  // Per-period forward rate is implied by coupon_dfs ratios.
  const floatCashflows = paymentDates.map((payDate, i) => {
    const periodStart = i === 0 ? startDate : paymentDates[i - 1]
    const periodEnd   = payDate
    const df          = couponDfs[i] || 1
    const dfPrev      = i === 0 ? pStart : (couponDfs[i - 1] || pStart)
    const dcf         = payFreqY
    const rate        = (dfPrev / df - 1) / dcf
    const amount      = notional * rate * dcf
    const pv          = amount * df * (floatDir === 'PAY' ? -1 : 1)
    return {
      period_start: periodStart,
      period_end:   periodEnd,
      payment_date: payDate,
      dcf, notional,
      rate,
      amount, df, pv,
      zero_rate: null,
    }
  })

  const floatTotalPv = floatCashflows.reduce((s, cf) => s + cf.pv, 0)

  return [
    { leg_ref: 'FIXED-1', leg_seq: 1, leg_type: 'FIXED',
      direction: fixedDir, currency: state.ccy || 'USD',
      notional, pv: fixedTotalPv, cashflows: fixedCashflows },
    { leg_ref: 'FLOAT-1', leg_seq: 2, leg_type: 'FLOAT',
      direction: floatDir, currency: state.ccy || 'USD',
      notional, pv: floatTotalPv, cashflows: floatCashflows },
  ]
}

export function CashflowsPanel({ result, productKey, state }) {
  if (!result) {
    return (
      <div style={{
        padding: '80px 40px',
        textAlign: 'center',
        color: '#555',
        fontSize: 12,
        letterSpacing: '0.08em',
        fontStyle: 'italic',
      }}>
        {'\u2014 price the trade first to view cashflow schedule \u2014'}
      </div>
    )
  }

  const isCapLike = productKey === 'RATES_CAP'
                 || productKey === 'RATES_FLOOR'
                 || productKey === 'RATES_COLLAR'
                 || result.caplets
                 || result.cap?.caplets

  // Swaption: synthesize legs from the response if backend didn't return any.
  const effectiveResult =
    (productKey === 'IR_SWAPTION' && !(result.legs && result.legs.length))
      ? { ...result, legs: synthesizeSwaptionLegs(result, state) }
      : result

  return (
    <div style={{ padding: '12px 16px' }}>
      {isCapLike
        ? <CapletTable result={effectiveResult} ccy={state.ccy || 'USD'} />
        : <SwapCashflowTables result={effectiveResult} productKey={productKey} state={state} />
      }
    </div>
  )
}
