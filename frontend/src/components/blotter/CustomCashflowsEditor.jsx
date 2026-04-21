// CustomCashflowsEditor.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Sprint 11 Day 2 — per-leg editor for user-entered custom cashflows.
//
// Mounted inside LegDetailsTab, below the PERIOD SCHEDULE section, one
// instance per leg (FIXED + FLOAT, or FLOAT-1 + FLOAT-2 for BASIS).
//
// State is controlled: parent passes `rows` + `setRows`. Internally only
// UI state (focused row, validation highlights) is local.
//
// Row shape sent to backend (matches schemas/custom_cashflows.py):
//   {
//     id:             string  (client-side UUID, used for React key)
//     type:           'COUPON'|'PRINCIPAL'|'FEE'|'REBATE'|'NOTIONAL_EXCHANGE'|'AMORTIZATION'
//     payment_date:   'YYYY-MM-DD'
//     accrual_start:  'YYYY-MM-DD' | null
//     accrual_end:    'YYYY-MM-DD' | null
//     amount:         number (signed, book perspective - negative = we pay)
//     currency:       string (defaults to leg.currency, v1 not user-editable)
//     notes:          string | ''
//   }
//
// Amber override highlighting is NOT used here - every row is "custom" by
// definition; there's no "original" value to compare against like in the
// PERIOD SCHEDULE editor.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { S, C } from './LegDetailsTab'

const ROW_TYPES = [
  'COUPON', 'PRINCIPAL', 'FEE', 'REBATE', 'NOTIONAL_EXCHANGE', 'AMORTIZATION',
]

// Friendlier display labels for the TYPE dropdown (tighter for narrow column).
const TYPE_LABEL = {
  COUPON:            'COUPON',
  PRINCIPAL:         'PRINCIPAL',
  FEE:               'FEE',
  REBATE:            'REBATE',
  NOTIONAL_EXCHANGE: 'NOTIONAL X',
  AMORTIZATION:      'AMORTIZE',
}

// Types that don't have accrual periods — greyed out when selected.
const TYPES_WITHOUT_ACCRUAL = new Set(['FEE', 'REBATE', 'NOTIONAL_EXCHANGE'])

function newRowId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return 'cf_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
  return 'cf_' + Math.random().toString(36).slice(2, 14)
}

function blankRow(ccy) {
  return {
    id:            newRowId(),
    type:          'FEE',
    payment_date:  '',
    accrual_start: '',
    accrual_end:   '',
    amount:        '',
    currency:      ccy || 'USD',
    notes:         '',
  }
}

// Parse a TSV line into a row. Column order matches the grid:
// TYPE | PAY DATE | ACCR START | ACCR END | AMOUNT | CCY | NOTES
function parsePasteLine(line, defaultCcy) {
  const cols = line.split('\t').map(c => c.trim())
  const rawType = (cols[0] || 'FEE').toUpperCase().replace(/\s+/g, '_')
  const type = ROW_TYPES.includes(rawType) ? rawType : 'FEE'
  return {
    id:            newRowId(),
    type,
    payment_date:  cols[1] || '',
    accrual_start: cols[2] || '',
    accrual_end:   cols[3] || '',
    amount:        cols[4] || '',
    currency:      (cols[5] || defaultCcy || 'USD').toUpperCase(),
    notes:         cols[6] || '',
  }
}

// Row-level validation. Returns a per-field error map (for red borders);
// does NOT block PRICE — backend skips bad rows gracefully. Cosmetic only.
function validateRow(row) {
  const errors = {}
  if (!row.payment_date) {
    errors.payment_date = 'required'
  } else if (isNaN(Date.parse(row.payment_date))) {
    errors.payment_date = 'invalid date'
  }
  const amt = parseFloat(row.amount)
  if (row.amount === '' || !isFinite(amt)) {
    errors.amount = 'required'
  } else if (amt === 0) {
    errors.amount = 'nonzero'
  }
  if (!TYPES_WITHOUT_ACCRUAL.has(row.type)
      && row.accrual_start && row.accrual_end
      && row.accrual_start > row.accrual_end) {
    errors.accrual_start = 'after accr end'
    errors.accrual_end   = 'before accr start'
  }
  return errors
}

// Per-field style for an input in the grid. Picks red border on error,
// otherwise the standard S.cell style. For greyed cells (non-accrual
// types), uses S.cellRo.
function inputStyle({ error, greyed, signValue }) {
  if (greyed) return S.cellRo
  if (error) {
    return {
      ...S.cell,
      border: '1px solid ' + C.red,
      color: C.red,
    }
  }
  if (signValue != null) {
    // Signed amount field — colour the text by sign.
    return {
      ...S.cell,
      color: signValue < 0 ? C.red : (signValue > 0 ? C.accent : C.text),
    }
  }
  return S.cell
}

export default function CustomCashflowsEditor({ ccy, rows, setRows }) {
  const [confirmingClear, setConfirmingClear] = useState(false)

  const safeRows = rows || []

  const addRow = () => setRows(prev => [...(prev || []), blankRow(ccy)])

  const deleteRow = (id) => setRows(prev => (prev || []).filter(r => r.id !== id))

  const updateRow = (id, patch) => setRows(prev => (prev || []).map(r => {
    if (r.id !== id) return r
    const next = { ...r, ...patch }
    // If type switched to accrual-less, clear accrual cells automatically.
    if (patch.type && TYPES_WITHOUT_ACCRUAL.has(patch.type)) {
      next.accrual_start = ''
      next.accrual_end   = ''
    }
    return next
  }))

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const parsed = text.trim().split('\n')
        .map(line => parsePasteLine(line, ccy))
        .filter(r => r.payment_date || r.amount)  // skip empty lines
      if (parsed.length) setRows(prev => [...(prev || []), ...parsed])
    } catch (e) {
      // navigator.clipboard may fail on non-HTTPS or denied permission.
      // Stay silent - existing PERIOD SCHEDULE paste handler does the same.
    }
  }

  const handleClear = () => {
    if (confirmingClear) {
      setRows([])
      setConfirmingClear(false)
    } else {
      setConfirmingClear(true)
      setTimeout(() => setConfirmingClear(false), 3000)
    }
  }

  return (
    <div>
      <div style={S.secTitle}>CUSTOM CASHFLOWS</div>
      <div style={S.secHint}>
        Add bespoke fees, rebates, principal exchanges, or custom coupons.
        Signed amount: negative = we pay, positive = we receive.
      </div>
      <div style={S.toolbar}>
        <button style={S.toolBtn()} onClick={addRow}>+ ADD ROW</button>
        <button style={S.toolBtn()} onClick={handlePaste}>PASTE</button>
        {safeRows.length > 0 && (
          <button
            style={S.toolBtn(confirmingClear ? C.red : C.amber)}
            onClick={handleClear}
          >
            {confirmingClear
              ? `CONFIRM CLEAR ${safeRows.length} ROW${safeRows.length === 1 ? '' : 'S'}`
              : 'CLEAR'}
          </button>
        )}
      </div>

      <table style={S.tbl}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: '14%' }}>TYPE</th>
            <th style={{ ...S.th, width: '16%' }}>PAY DATE</th>
            <th style={{ ...S.th, width: '16%' }}>ACCR START</th>
            <th style={{ ...S.th, width: '16%' }}>ACCR END</th>
            <th style={{ ...S.th, width: '24%' }}>AMOUNT</th>
            <th style={{ ...S.th, width: '8%'  }}>CCY</th>
            <th style={{ ...S.th, width: '6%'  }}></th>
          </tr>
        </thead>
        <tbody>
          {safeRows.length === 0 && (
            <tr><td colSpan={7} style={S.td}>
              <div style={S.emptyRow}>
                No custom cashflows. Click + ADD ROW to add a fee, rebate, or principal exchange.
              </div>
            </td></tr>
          )}

          {safeRows.map(row => {
            const errors = validateRow(row)
            const greyedAccrual = TYPES_WITHOUT_ACCRUAL.has(row.type)
            const amtNum = parseFloat(row.amount)
            const amtSign = isFinite(amtNum) ? amtNum : null

            return (
              <tr key={row.id}>
                {/* TYPE */}
                <td style={S.td}>
                  <select
                    style={S.cell}
                    value={row.type}
                    onChange={e => updateRow(row.id, { type: e.target.value })}
                  >
                    {ROW_TYPES.map(t => (
                      <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                    ))}
                  </select>
                </td>

                {/* PAY DATE */}
                <td style={S.td}>
                  <input
                    type='date'
                    style={inputStyle({ error: errors.payment_date })}
                    value={row.payment_date}
                    onChange={e => updateRow(row.id, { payment_date: e.target.value })}
                  />
                </td>

                {/* ACCR START */}
                <td style={S.td}>
                  <input
                    type='date'
                    style={inputStyle({
                      error: errors.accrual_start,
                      greyed: greyedAccrual,
                    })}
                    value={greyedAccrual ? '' : row.accrual_start}
                    readOnly={greyedAccrual}
                    onChange={e => updateRow(row.id, { accrual_start: e.target.value })}
                  />
                </td>

                {/* ACCR END */}
                <td style={S.td}>
                  <input
                    type='date'
                    style={inputStyle({
                      error: errors.accrual_end,
                      greyed: greyedAccrual,
                    })}
                    value={greyedAccrual ? '' : row.accrual_end}
                    readOnly={greyedAccrual}
                    onChange={e => updateRow(row.id, { accrual_end: e.target.value })}
                  />
                </td>

                {/* AMOUNT */}
                <td style={S.td}>
                  <input
                    type='number'
                    step='any'
                    placeholder='signed amount'
                    style={inputStyle({ error: errors.amount, signValue: amtSign })}
                    value={row.amount}
                    onChange={e => updateRow(row.id, { amount: e.target.value })}
                  />
                </td>

                {/* CCY (readonly, locked to leg) */}
                <td style={S.td}>
                  <div style={S.cellRo}>{row.currency}</div>
                </td>

                {/* × delete */}
                <td style={{ ...S.td, textAlign: 'center' }}>
                  <button style={S.del} onClick={() => deleteRow(row.id)}>x</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {safeRows.length > 0 && (
        <div style={S.hintBox}>
          Type <b>FEE / REBATE / NOTIONAL_EXCHANGE</b> skips accrual dates.
          Red border = invalid, will be skipped by pricer. Hit PRICE to see PV contribution.
        </div>
      )}
    </div>
  )
}
