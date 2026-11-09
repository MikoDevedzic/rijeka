// trade-window/defaulted-input.js — what a field that has a default shows (DefaultedInput.jsx).
//
// A field such as SPOT or VOL % prices on a number the user did not type unless they type one. A placeholder is
// grey and vanishes on focus, so the field read as empty. The field shows the number instead:
//   default   no override, and the number the price uses is known: that number, with a few words saying where it is from
//   override  the user typed a number: their text, tagged "override", with a control that puts the default back
//   invalid   the user typed something that cannot be read as a number ("1,08", "1.2.3"): their text, kept and
//             marked, with the same control; nothing is priced or booked on it
//   empty     no override and no number yet (not priced, not snapped): a dash and the same few words
// What the user types is kept as typed and read by parseNumber (fx-ticket.js): the field never rewrites it into
// a number it did not mean.
import { parseNumber, NOT_A_NUMBER } from './fx-ticket'

export const DASH = '—'
export const OVERRIDE_TAG = 'override'
export const INVALID_TAG = NOT_A_NUMBER

// { state, text, tag } for the input and the line under it. `value` is the override as typed ('' = none),
// `fallback` the number used without one (null = not known yet), `format` how that number is written into the
// field (formatInput: a point, no grouping, whatever the browser's locale), `signed` whether it takes a minus.
export function fieldView({ value, fallback, format, tag, signed = false }) {
  const typed = parseNumber(value == null ? '' : value, { signed })
  if (typed.state === 'invalid') return { state: 'invalid', text: String(value), tag: INVALID_TAG }
  if (typed.state === 'ok') return { state: 'override', text: String(value), tag: OVERRIDE_TAG }
  const n = fallback == null || fallback === '' ? NaN : Number(fallback)
  if (Number.isFinite(n)) return { state: 'default', text: format ? format(n) : String(n), tag: tag || '' }
  return { state: 'empty', text: DASH, tag: tag || '' }
}

// What a keystroke leaves in the field: the text as typed. Only the dash the empty field shows is taken out of
// it (a key typed beside the dash is the key alone), and text that is nothing but spaces is no override.
export function overrideFrom(raw) {
  const text = String(raw ?? '').split(DASH).join('')
  return text.trim() === '' ? '' : text
}

// How a readable number is shown while its field does not have the focus: grouped as en-US groups, the decimals
// exactly as written ("108250.00" reads "108,250.00"; "1.08345" is unchanged). While the field has the focus it
// shows the text as typed, so nothing moves under the caret; parseNumber reads both writings as the same number.
// Text that is not a plain number (the dash, something unreadable) is returned as it is.
export function groupForDisplay(text) {
  const m = /^(\s*)(-?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d*)?(\s*)$/.exec(String(text ?? ''))
  if (!m) return String(text ?? '')
  const whole = m[3].replace(/,/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${m[2]}${whole}${m[4] || ''}`
}
