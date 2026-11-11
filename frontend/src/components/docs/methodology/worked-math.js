// The two tables worked on the methodology's pages: one formula each, with inputs a reader can type over, so the
// arithmetic can be followed. They are NOT the engine: round sample inputs, a flat rate where the engine reads a
// curve, a flat exposure where the engine simulates one. Each table says so. The formulas are the document's own
// (§12: the digital-asset forward; §10: the first line of the waterfall).

// A number as typed: digits, an optional en-US thousands grouping, an optional decimal part, an optional % at
// the end. Anything else (a decimal comma, letters, an empty box) is not a number, and nothing is computed from it.
export function readNumber(text) {
  const s = String(text ?? '').trim().replace(/%$/, '').trim()
  if (!/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s)) return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

// §12, a digital-asset forward against USD, with one flat USD rate standing in for the curve's discount factor:
//   T = days / 365,  P = exp(−r_USD·T),  F = S·exp(−r_c·T) / P,  NPV = (F − K)·N·P,  CRY01 = 1 % of spot's worth of forward value
// Rates in % a year. Null unless spot, days, notional and the agreed price are above zero and both rates are numbers.
export function ndf({ S, rq, rc, days, N, K } = {}) {
  if (![S, rq, rc, days, N, K].every(Number.isFinite) || !(S > 0 && days > 0 && N > 0 && K > 0)) return null
  const T = days / 365, P = Math.exp(-rq / 100 * T)
  const F = S * Math.exp(-rc / 100 * T) / P
  return { T, P, F, npv: (F - K) * N * P, cry01: 0.01 * S * Math.exp(-rc / 100 * T) * N }
}

// §10, the first line of the waterfall with the exposure held flat:
//   h = s / LGD,  Q(t) = exp(−h·t),  CVA = LGD · Σ_i EE · (Q(t_{i−1}) − Q(t_i)) · exp(−r·t_i), monthly
// Spread in basis points, LGD and the rate in %. Null unless the exposure, the spread, the LGD (at most 100 %)
// and the years (at most 30) are above zero and the rate is a number.
export function cvaLine({ ee, s, lgd, yrs, r } = {}) {
  if (![ee, s, lgd, yrs, r].every(Number.isFinite) || !(ee > 0 && s > 0 && lgd > 0 && lgd <= 100 && yrs > 0 && yrs <= 30)) return null
  const h = s / 10000 / (lgd / 100), n = Math.round(yrs * 12)
  let sum = 0
  for (let i = 1; i <= n; i++) sum += ee * (Math.exp(-h * (i - 1) / 12) - Math.exp(-h * i / 12)) * Math.exp(-r / 100 * i / 12)
  return { h, pd: 1 - Math.exp(-h * yrs), cva: lgd / 100 * sum }
}
