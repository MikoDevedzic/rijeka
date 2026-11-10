// lib/risk-factors.js — one colour per risk factor, the same on every product, and the colour an asset class
// takes from the factor it mainly carries. The point is to be read without being told: the IR01 on a swap, on an
// option and on a digital-asset forward is the same blue because it is the same risk, and it adds across the book.
// A crypto forward is lilac (its spot) and carries a blue IR01 beside it.
//
// The colour marks the factor's NAME (a small square before the label). The figure itself keeps the colour of its
// sign (docs/design.md): two meanings, two places. The tokens are --rf-* in index.css.
export const RISK_FACTORS = {
  ir:    { name: 'Interest rates',     token: '--rf-ir',    adds: 'the same risk on every product that discounts or projects on a curve: the sensitivity to one curve adds across swaps, options and forwards alike (measure by measure, curve by curve)' },
  fx:    { name: 'FX spot',            token: '--rf-fx',    adds: 'adds across every trade on the same currency pair' },
  cry:   { name: 'Digital-asset spot', token: '--rf-cry',   adds: 'adds across every trade on the same asset: forwards and the delta of options' },
  basis: { name: 'Forward basis',      token: '--rf-basis', adds: 'the carry between spot and forward: adds across forwards and options on the same asset' },
  vol:   { name: 'Volatility',         token: '--rf-vol',   adds: 'adds across options on the same surface' },
  time:  { name: 'Time',               token: '--rf-time',  adds: 'one day\'s passage: adds across the whole book' },
}

// The asset class a ticket or a blotter row belongs to, in the colour of the factor it mainly carries.
export const ASSET_FACTOR = { RATES: 'ir', FX: 'fx', CRYPTO: 'cry' }

// The words of a label, whether it is a string or an element with a unit after the name ("IR01 · 1 bp").
export function labelText(node) {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(labelText).join('')
  return labelText(node.props?.children)
}

// Which factor a sensitivity's label names, or null (a value such as NPV or a premium is not a sensitivity; a
// bare DELTA in units of the asset is left unmarked, its money twin CRY01 or FX01 carries the mark).
// The basis is tested before the spot it contains (CRYBASIS01 before CRY01), and a curve-specific IR01
// ("USD IR01", "IR01 DISC") is still IR01.
const RULES = [
  [/CRYBASIS01|BASIS01/, 'basis'],
  [/\bVEGA\b|VOL01/, 'vol'],
  [/\bTHETA\b/, 'time'],
  [/CRY01/, 'cry'],
  [/FX01/, 'fx'],
  [/IR01|PV01|DV01|\bRHO\b/, 'ir'],
]
export function riskFactorOf(label) {
  const t = labelText(label).toUpperCase()
  for (const [rx, key] of RULES) if (rx.test(t)) return key
  return null
}
