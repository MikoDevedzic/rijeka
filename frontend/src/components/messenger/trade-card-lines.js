// messenger/trade-card-lines.js — the lines a trade card writes for an option on a rate, apart from the component so they can be tested.
function num(n) {
  const x = Number(n)
  return Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n
}

// An option on a rate (record v3): who bought it, what it is, and which way its premium goes. A cap, a floor and a
// collar are the options written on their leg, read from either record version.
export const CAP_LIKE = new Set(['IR_CAP', 'IR_FLOOR', 'IR_COLLAR'])
export function optionLines(s) {
  const out = [], o = s?.option, f = o?.fields || {}
  const premium = o && f.premium_amount != null
    ? `premium ${f.premium_currency || ''} ${num(f.premium_amount)}, ${o.premium === 'PAY' ? 'you pay' : 'you receive'}${f.premium_payment_date ? ` on ${f.premium_payment_date}` : ''}`.replace('  ', ' ')
    : null
  if (o?.type === 'SWAPTION') {
    const pct = Number.isFinite(Number(f.strike)) ? `${(Number(f.strike) * 100).toFixed(6).replace(/\.?0+$/, '')}%` : f.strike
    const style = String(f.exercise_style || '').toLowerCase()
    out.push({ lead: `${o.you === 'BUY' ? 'You buy' : 'You sell'} a ${style ? `${style.charAt(0).toUpperCase()}${style.slice(1)} ` : ''}${f.right === 'RECEIVER' ? 'receiver' : 'payer'} swaption`,
      rest: [`expiry ${f.expiry_date}`, `strike ${pct}`, premium || 'no premium in the record'].filter(Boolean).join(' · ') })
  }
  for (const e of s?.embedded || []) {
    out.push({ lead: `${e.you === 'BUY' ? 'You buy' : 'You sell'} the ${String(e.type || 'option').toLowerCase()}${e.strike ? `, strike ${e.strike}` : ''}`, rest: '' })
  }
  if (o && o.type !== 'SWAPTION') out.push({ lead: 'Premium', rest: premium ? premium.replace(/^premium /, '') : 'none in the record' })
  return out
}
