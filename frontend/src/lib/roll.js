// lib/roll.js — the arithmetic behind a figure that rolls to its new value (components/common/Roll.jsx). A figure
// on screen is text ("+$4,669", "−$2,986", "10,743", "3.480%", "0 USD"): this reads the number in it and writes any
// number in between in the same dress (the same sign style, symbol, grouping, decimals and unit), so the roll
// never shows a figure the app would not have printed. The last frame is always the text itself.
const RX = /^([^0-9]*?)(\d[\d,]*)(\.\d+)?(.*)$/s

// { prefix, value, decimals, grouped, suffix, negative } or null when the text holds no number ("—", "pricing…").
export function parseFigure(text) {
  const m = typeof text === 'string' ? text.match(RX) : null
  if (!m) return null
  const [, prefix, int, frac = '', suffix] = m
  // one number, or it does not roll: "12.3 / 15.6" would roll its first half, and a figure grouped with points
  // ("1.234.567", a browser that writes decimals with a comma) would be read as 1.234
  if (/\d/.test(suffix)) return null
  const negative = /[-−]/.test(prefix)
  const value = Number(int.replace(/,/g, '') + frac)
  if (!Number.isFinite(value)) return null
  return { prefix, value, decimals: frac ? frac.length - 1 : 0, grouped: int.includes(',') || int.length <= 3, suffix, negative }
}

// The magnitude `v` written as `like` is written.
export function formatLike(v, like) {
  const n = Math.abs(v)
  const body = like.grouped
    ? n.toLocaleString('en-US', { minimumFractionDigits: like.decimals, maximumFractionDigits: like.decimals })
    : n.toFixed(like.decimals)
  // a frame that rounds to nothing carries no sign, as everywhere else in the app
  const prefix = Number(body.replace(/,/g, '')) === 0 ? like.prefix.replace(/[+\-−]/g, '') : like.prefix
  return prefix + body + like.suffix
}

// Where a roll to `text` starts from, given what was shown before: the old magnitude when both are numbers of the
// same sign, zero otherwise (a first price, a figure that crossed zero). null when `text` is not a number or did
// not change: nothing rolls.
export function rollFrom(prev, text) {
  const to = parseFigure(text)
  if (!to || prev === text) return null
  const from = parseFigure(prev)
  const start = from && from.negative === to.negative ? from.value : 0
  if (start === to.value) return null
  return { start, to }
}

// +1, −1 or 0: whether the signed number went up or down (0 when there was no number before). It tints the flash.
export function direction(prev, text) {
  const a = parseFigure(prev), b = parseFigure(text)
  if (!a || !b) return 0
  const x = a.negative ? -a.value : a.value, y = b.negative ? -b.value : b.value
  return y > x ? 1 : y < x ? -1 : 0
}

// eased position at time fraction k (0..1): fast at first, settling at the end
export const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 4)
