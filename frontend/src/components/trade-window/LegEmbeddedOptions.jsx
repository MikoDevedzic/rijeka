// trade-window/LegEmbeddedOptions.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Sprint 13 Patch 4 — leg-level embedded-optionality UI per PRODUCT_TAXONOMY §1.11.
//
// Replaces the Sprint 12 cap/floor panel that was conditionally rendered only
// when `structure === 'CAPPED_FLOATER' || 'FLOORED_FLOATER'`. This component
// decouples optionality from trade structure: any FLOAT leg on any instrument
// may carry zero, one, or many embedded-option entries.
//
// Data shape (mirrors `trade_legs.embedded_options` DB column):
//   entries = [
//     { type: 'CAP'|'FLOOR', direction: 'BUY'|'SELL',
//       defaultStrike: '5.0' | '' }   // string in %, converted to decimal on payload
//   ]
// Multiple entries compose freely — collar = one CAP + one FLOOR.
//
// Props:
//   entries   — current array (empty = vanilla FLOAT leg, no optionality)
//   onChange  — (nextEntries: Array) => void
//   legLabel  — optional label for the container header (e.g. 'FLOAT LEG 1')
//
// The component is stateless — all state lives in the parent.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'

const TYPE_OPTIONS      = ['CAP', 'FLOOR']
const DIRECTION_OPTIONS = ['BUY', 'SELL']

// Default direction per type — CAP defaults to SELL (capped floater =
// book short the cap), FLOOR defaults to BUY (floored floater = book
// long the floor). Users can override via the BUY/SELL chips.
const DEFAULT_DIRECTION = { CAP: 'SELL', FLOOR: 'BUY' }

// Default strike per type — generic placeholders. User edits freely.
const DEFAULT_STRIKE_PCT = { CAP: '5.0', FLOOR: '2.5' }

function newEntry(type) {
  return {
    type,
    direction:     DEFAULT_DIRECTION[type],
    defaultStrike: DEFAULT_STRIKE_PCT[type],
  }
}

// Chip style for the BUY/SELL toggles. Amber for BUY (long option →
// positive optionality value), coral for SELL (short option → negative
// optionality value). Matches the trade-direction chip semantics used
// elsewhere in the shell.
function dirChipStyle(on, isSell) {
  return {
    padding: '6px 14px',
    fontSize: 11,
    letterSpacing: '0.06em',
    fontWeight: on ? 700 : 400,
    fontFamily: "'IBM Plex Mono', monospace",
    borderRadius: 2,
    cursor: 'pointer',
    border: '1px solid ' + (on ? (isSell ? '#FF6B6B' : '#00D4A8') : '#222'),
    background: on
      ? (isSell ? 'rgba(255,107,107,0.12)' : 'rgba(0,212,168,0.12)')
      : 'transparent',
    color: on ? (isSell ? '#FF6B6B' : '#00D4A8') : '#666',
    transition: 'all 0.1s',
  }
}

function typeChipStyle(on, typeColor) {
  return {
    padding: '6px 14px',
    fontSize: 11,
    letterSpacing: '0.06em',
    fontWeight: on ? 700 : 400,
    fontFamily: "'IBM Plex Mono', monospace",
    borderRadius: 2,
    cursor: 'pointer',
    border: '1px solid ' + (on ? typeColor : '#222'),
    background: on ? `${typeColor}1f` : 'transparent',
    color: on ? typeColor : '#666',
    transition: 'all 0.1s',
  }
}

// Type palette — CAP amber (#F5C842), FLOOR teal (#00D4A8). Matches
// DESIGN_TOKENS colour set; caps "upside" → warm, floors "support" → cool.
const TYPE_COLOR = { CAP: '#F5C842', FLOOR: '#00D4A8' }


export default function LegEmbeddedOptions({ entries = [], onChange, legLabel = '' }) {

  const addEntry = (type) => {
    onChange([...(entries || []), newEntry(type)])
  }

  const removeEntry = (idx) => {
    const next = entries.slice()
    next.splice(idx, 1)
    onChange(next)
  }

  const patchEntry = (idx, patch) => {
    const next = entries.slice()
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }

  // ── Styles (inline so this component stays drop-in, no CSS edit) ─────────
  const rootStyle = {
    marginTop: 8,
    padding: '12px 14px',
    border: '1px solid #1a1a1a',
    borderRadius: 3,
    background: 'rgba(255,255,255,0.015)',
  }

  const headerStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: entries.length ? 10 : 0,
  }

  const headerLabelStyle = {
    fontSize: 10,
    letterSpacing: '0.12em',
    color: '#999',
    fontFamily: "'IBM Plex Mono', monospace",
  }

  const addBtnStyle = {
    padding: '4px 12px',
    fontSize: 10,
    letterSpacing: '0.08em',
    fontFamily: "'IBM Plex Mono', monospace",
    border: '1px dashed #3a3a3a',
    background: 'transparent',
    color: '#999',
    borderRadius: 2,
    cursor: 'pointer',
  }

  const addMenuStyle = {
    display: 'flex',
    gap: 6,
    marginLeft: 'auto',
  }

  const entryCardStyle = {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto auto auto',
    gap: 12,
    alignItems: 'center',
    padding: '8px 12px',
    marginTop: 6,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid #1f1f1f',
    borderRadius: 2,
  }

  const strikeInputStyle = {
    width: 80,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: '#F5C842',
    background: 'transparent',
    border: '1px solid #2a2a2a',
    borderRadius: 2,
    padding: '4px 6px',
    textAlign: 'right',
  }

  const labelStyle = {
    fontSize: 9,
    color: '#666',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontFamily: "'IBM Plex Mono', monospace",
    marginRight: 4,
  }

  const removeBtnStyle = {
    background: 'transparent',
    border: '1px solid #2a2a2a',
    color: '#888',
    width: 20, height: 20,
    fontSize: 11,
    borderRadius: 2,
    cursor: 'pointer',
    padding: 0,
    lineHeight: '18px',
  }

  return (
    <div style={rootStyle} className="tbw-no-drag">
      <div style={headerStyle}>
        <span style={headerLabelStyle}>
          {legLabel ? `${legLabel} — EMBEDDED OPTIONALITY` : 'EMBEDDED OPTIONALITY'}
        </span>
        {entries.length === 0 && (
          <span style={{ fontSize: 10, color: '#555', fontStyle: 'italic' }}>
            none — plain float leg
          </span>
        )}
        <div style={addMenuStyle}>
          {TYPE_OPTIONS.map(t => (
            <button
              key={t}
              type="button"
              style={addBtnStyle}
              onClick={() => addEntry(t)}
              title={`Add an embedded ${t.toLowerCase()} to this leg`}
            >
              + {t}
            </button>
          ))}
        </div>
      </div>

      {entries.map((entry, idx) => {
        const t       = entry.type
        const dir     = entry.direction
        const strike  = entry.defaultStrike ?? ''
        const color   = TYPE_COLOR[t] || '#999'
        const hint    = getHint(t, dir)
        return (
          <div key={idx} style={entryCardStyle}>
            {/* Type chip (CAP / FLOOR) — read-only display, type is chosen at ADD time */}
            <div style={typeChipStyle(true, color)}>
              {t}
            </div>

            {/* Strike */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Strike %</span>
              <input
                style={strikeInputStyle}
                value={strike}
                onChange={e => patchEntry(idx, { defaultStrike: e.target.value })}
                placeholder={DEFAULT_STRIKE_PCT[t]}
              />
            </div>

            {/* Direction chips */}
            <div style={{ display: 'flex', gap: 4 }}>
              {DIRECTION_OPTIONS.map(d => (
                <button
                  key={d}
                  type="button"
                  style={dirChipStyle(dir === d, d === 'SELL')}
                  onClick={() => patchEntry(idx, { direction: d })}
                >
                  {d}
                </button>
              ))}
            </div>

            {/* Hint */}
            <div style={{ fontSize: 10, color: '#666', minWidth: 160 }}>
              {hint}
            </div>

            {/* Remove */}
            <button
              type="button"
              style={removeBtnStyle}
              onClick={() => removeEntry(idx)}
              title="Remove this entry"
            >
              ×
            </button>
          </div>
        )
      })}

      {entries.length > 0 && (
        <div style={{
          fontSize: 10,
          color: '#555',
          marginTop: 10,
          lineHeight: 1.5,
          fontStyle: 'italic',
        }}>
          Flat strike applied to all caplets/floorlets. For per-period
          step-up schedules, edit on the DETAILS tab.
        </div>
      )}
    </div>
  )
}


// ── Hints ────────────────────────────────────────────────────────────────────
// Short narrative per (type, direction) combination. These are UI-only —
// the sign-of-value of an embedded option is governed by cap_floor.py's
// pricer regardless of leg direction. The hint just helps the trader
// sanity-check intent.

function getHint(type, direction) {
  if (type === 'CAP') {
    return direction === 'SELL'
      ? '· receiver short cap (standard capped floater)'
      : '· long cap hedge'
  }
  if (type === 'FLOOR') {
    return direction === 'BUY'
      ? '· receiver long floor (standard floored floater)'
      : '· short floor'
  }
  return ''
}
