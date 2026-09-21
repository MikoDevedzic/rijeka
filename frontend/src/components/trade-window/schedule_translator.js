// trade-window/schedule_translator.js
// ─────────────────────────────────────────────────────────────────────
// Sprint 12 item 6 — single source of truth for the
// frontend-state -> backend-payload translation of leg schedules.
//
// DETAILS tab (LegDetailsTab.jsx::deriveSchedules) emits already-sparse
// arrays of changed-rows. This module converts them to the shape the
// backend resolvers expect (pricing/ir_swap.py::_resolve_step_up_rate /
// _resolve_spread_schedule / _resolve_notional_schedule).
//
// Three transforms happen at this seam:
//
//   - rate:     percent string -> decimal float  (4.5 -> 0.045)
//   - spread:   bp string + key rename -> decimal + 'spread' key
//                                          (5.0 + 'spread_bps' -> 0.0005 + 'spread')
//   - notional: parsed string -> raw float       (10000000)
//
// All three return null on empty/no-edits, which lets the backend resolver
// short-circuit to the flat fixed_rate / spread / notional. This guarantees
// vanilla pricing remains byte-identical to pre-Sprint-12 behavior when no
// DETAILS edits are made.
//
// Imported by:
//   - products/rates.js::IR_SWAP.buildPayload (price_preview path)
//   - booking.js::buildLegs (atomic booking path)
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert UI rate-schedule rows to backend payload shape.
 * @param {Array<{date: string, rate: string|number}>} uiRows
 * @returns {Array<{date: string, rate: number}>|null}  null if empty
 */
export function toRateSchedule(uiRows) {
  const out = (uiRows || [])
    .filter(r => r && r.date)
    .map(r => {
      const v = parseFloat(r.rate)
      return isFinite(v) ? { date: r.date, rate: v / 100 } : null
    })
    .filter(Boolean)
  return out.length > 0 ? out : null
}

/**
 * Convert UI notional-schedule rows to backend payload shape.
 * @param {Array<{date: string, notional: string|number}>} uiRows
 * @returns {Array<{date: string, notional: number}>|null}  null if empty
 */
export function toNotionalSchedule(uiRows) {
  const out = (uiRows || [])
    .filter(r => r && r.date)
    .map(r => {
      const v = parseFloat(r.notional)
      return isFinite(v) ? { date: r.date, notional: v } : null
    })
    .filter(Boolean)
  return out.length > 0 ? out : null
}

/**
 * Convert UI spread-schedule rows to backend payload shape.
 * Renames 'spread_bps' (UI) to 'spread' (backend) and converts bp -> decimal.
 * @param {Array<{date: string, spread_bps: string|number}>} uiRows
 * @returns {Array<{date: string, spread: number}>|null}  null if empty
 */
export function toSpreadSchedule(uiRows) {
  const out = (uiRows || [])
    .filter(r => r && r.date)
    .map(r => {
      const v = parseFloat(r.spread_bps)
      return isFinite(v) ? { date: r.date, spread: v / 10000 } : null
    })
    .filter(Boolean)
  return out.length > 0 ? out : null
}
