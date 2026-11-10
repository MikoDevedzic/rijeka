// trade-window/seal-rings.js — what a hash gives the seal (Seal.jsx): a deterministic generator seeded by the
// text of the hash, and the three rings it yields. Pure, so it is tested (Seal.test.js).
export const TAU = Math.PI * 2

// a small deterministic generator seeded by the text of the hash
export function prng(seed) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return () => { h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// The rings a hash gives: lobes (k), a slower modulation (m), strands (n) and a phase each. Pure, so it is tested.
export function sealRings(hash) {
  const r = prng(String(hash || ''))
  return [
    { b: 0.79, a: 0.125, k: 12 + Math.floor(r() * 10), m: 3 + Math.floor(r() * 4), n: 7, ph: r() * TAU },
    { b: 0.50, a: 0.105, k: 8 + Math.floor(r() * 8),   m: 2 + Math.floor(r() * 4), n: 6, ph: r() * TAU },
    { b: 0.25, a: 0.085, k: 5 + Math.floor(r() * 6),   m: 2 + Math.floor(r() * 3), n: 5, ph: r() * TAU },
  ]
}
