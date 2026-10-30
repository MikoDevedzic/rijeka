// Sparse swaption quotes -> full {exps, tens, z} grid for VolSurface3D. Kept out of the
// component module so Fast Refresh keeps working there.
const parse = (t) => { const m = /^(\d+)Yx(\d+)Y$/.exec(t || ''); return m ? [+m[1], +m[2]] : null }

// Build a full grid {exps, tens, z[e][t]} from sparse quotes; holes take the nearest filled cell.
export function toGrid(quotes) {
  const cells = (quotes || []).map(q => { const p = parse(q.tenor); return p && q.rate != null ? { e: p[0], t: p[1], v: Number(q.rate) } : null }).filter(Boolean)
  if (cells.length < 6) return null
  const exps = [...new Set(cells.map(c => c.e))].sort((a, b) => a - b)
  const tens = [...new Set(cells.map(c => c.t))].sort((a, b) => a - b)
  if (exps.length < 2 || tens.length < 2) return null
  const z = exps.map(e => tens.map(t => {
    const hit = cells.find(c => c.e === e && c.t === t)
    if (hit) return hit.v
    let best = null, bd = Infinity
    for (const c of cells) { const d = Math.abs(Math.log(c.e / e)) + Math.abs(Math.log(c.t / t)); if (d < bd) { bd = d; best = c.v } }
    return best
  }))
  return { exps, tens, z }
}
