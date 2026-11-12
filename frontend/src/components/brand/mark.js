// brand/mark.js — the Rijeka mark, drawn on a canvas.
//
// Rijeka means river. Simulated paths start apart (one desk's above in limestone, the other's below in blue),
// wander, meet and turn brass, and run as one line into an R inside a ring. The ring is left open where the river
// enters: a letter in a closed circle reads as the registered-trademark sign. With the name, that ringed R IS the
// name's first letter, so only IJEKA is set in type after it (docs/design.md, "The name").
//
// Each path is a Brownian bridge written as its sine series (Karhunen-Loeve). Every coefficient turns slowly
// between two Gaussian draws, so at any instant the path is a proper draw of the bridge and it changes smoothly:
// the river keeps re-simulating. Nothing here is a figure of the product: it is a drawing.
//
// Geometry is in the mark's own units: paths run from x0 to the meeting point at x = 112 on the line y = 70, the
// single line runs on to the R's stem at x = 160, the ring is centred at (167, 70) with radius 27.
import { T } from '../../theme'

export const MODES = 14
const MEET = 112, STEM = 160, RING_X = 167, RING_R = 27, GAP = 0.44
const clamp = (x) => Math.max(0, Math.min(1, x))
export const ease = (x) => 1 - Math.pow(1 - clamp(x), 3)

export function rng(seed) {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r())

/** n paths' coefficients from a seed: the same seed always gives the same river. */
export function field(seed, n) {
  const r = rng(seed), out = []
  for (let i = 0; i < n; i++) {
    const m = []
    for (let k = 1; k <= MODES; k++) m.push({ a: gauss(r), b: gauss(r), w: (0.25 + 0.55 * r()) / Math.sqrt(k), p: 2 * Math.PI * r() })
    out.push(m)
  }
  return out
}

/** The bridge at s in [0, 1] and time t: zero at both ends, whatever the time. */
export function bridge(modes, s, t, M = MODES) {
  let y = 0
  for (let k = 0; k < M; k++) {
    const m = modes[k], z = m.a * Math.cos(m.w * t + m.p) + m.b * Math.sin(m.w * t + m.p)
    y += z * Math.SQRT2 * Math.sin((k + 1) * Math.PI * s) / ((k + 1) * Math.PI)
  }
  return y
}

/** One run, by its age in ms: the paths grow, the line reaches the ring, the letter and its ring are drawn. */
export function phases(ms) {
  const t = ms / 1000
  return { progress: ease(t / 2.2), trunk: ease((t - 2.1) / 0.5), letter: clamp((t - 2.6) / 1.1), done: t > 3.8 }
}

/** The colours of the mark from the page's own tokens (index.css), so it follows the theme. Where a token is not
 * there yet the theme's own copy stands in (theme.js): Safari runs the app's script before the stylesheet has
 * applied, the tokens read as empty, and a gradient refuses an empty colour with an exception. Until 0.30.3 that
 * exception stopped the logo's loop at its first frame and the top bar had no logo in Safari. */
export function palette(el) {
  const cs = getComputedStyle(el || document.documentElement), v = (n, or) => cs.getPropertyValue(n).trim() || or
  return { line: v('--accent', T.accent), letter: v('--accent-hi', T.accentHi), pale: v('--text', T.text), blue: v('--blue', T.blue),
           sans: v('--sans', 'system-ui, sans-serif'), fromPage: !!cs.getPropertyValue('--accent').trim() }
}

const cubic = (a, b, d, e, n = 20) => {
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    out.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * d[0] + t * t * t * e[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * d[1] + t * t * t * e[1]])
  }
  return out
}
// The letter as strokes, in the order a pen would make them (stem, bowl, leg), and the ring from the gap round to
// the gap. They are drawn apart: the letter is the name's, the ring is the seal, and a seal can wait for the chain.
const LETTER = [
  { w: 3.6, pts: [[STEM, 84], [STEM, 57]] },
  { w: 3.6, pts: [[STEM, 57], [167, 57], ...cubic([167, 57], [178, 57], [178, 70], [167, 70]), [STEM, 70]] },
  { w: 3.6, pts: [[166, 70], [177, 84]] },
]
const RING = [{ w: 2.6, pts: Array.from({ length: 73 }, (_, i) => { const a = Math.PI + GAP + (2 * Math.PI - 2 * GAP) * i / 72; return [RING_X + RING_R * Math.cos(a), 70 + RING_R * Math.sin(a)] }) }]
const lengthOf = (strokes) => strokes.reduce((sum, st) => {
  st.len = 0
  for (let i = 1; i < st.pts.length; i++) st.len += Math.hypot(st.pts[i][0] - st.pts[i - 1][0], st.pts[i][1] - st.pts[i - 1][1])
  return sum + st.len
}, 0)
const LETTER_LEN = lengthOf(LETTER), RING_LEN = lengthOf(RING)
/** One progress for both, by length: how much of the letter, then how much of the ring. */
export const letterThenRing = (p) => {
  const drawn = clamp(p) * (LETTER_LEN + RING_LEN)
  return { letter: clamp(drawn / LETTER_LEN), ring: clamp((drawn - LETTER_LEN) / RING_LEN) }
}

function strokes(c, X, Y, sc, list, total, frac, colour) {
  let left = total * clamp(frac)
  c.strokeStyle = colour
  for (const st of list) {
    if (left <= 0) break
    c.lineWidth = Math.max(1.1, st.w * sc)
    c.beginPath(); c.moveTo(X(st.pts[0][0]), Y(st.pts[0][1]))
    for (let i = 1; i < st.pts.length && left > 0; i++) {
      const a = st.pts[i - 1], b = st.pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]), f = Math.min(1, left / d)
      c.lineTo(X(a[0] + (b[0] - a[0]) * f), Y(a[1] + (b[1] - a[1]) * f)); left -= d
    }
    c.stroke()
  }
}

/**
 * The mark in a box of w by h pixels.
 *   f         the field (see field())            t        time in seconds (0 and unchanging = still)
 *   pal       palette()                           spread   how far apart the paths start, in units (46)
 *   x0        where the paths start (18)          box      the unit height the drawing is fitted to (140)
 *   progress  how much of each path is drawn      trunk    how much of the single line
 *   letter    how much of the R, and of its ring unless `ring` says otherwise
 *   ring      how much of the ring alone (a seal that waits)  ghost  0..1: the R and ring as a faint outline, waiting
 *   alpha     of the whole                        minw     the least width of a path, in pixels
 *   amin      how faint the outermost path is (0.4)  mono  every path in the line's colour (one-colour uses)
 * Returns the scale used (pixels per unit) and the left edge, so a caller can set type beside it.
 */
export function drawMark(c, w, h, o) {
  const box = o.box || 140, x0 = o.x0 == null ? 18 : o.x0, spread = o.spread == null ? 46 : o.spread, right = o.right || 198
  // the drawing spans x0 - 4 .. right units across and is fitted to `box` units of height, centred on the line y = 70
  const left = x0 - 4, U = right - left, sc = Math.min(w / U, h / box), ox = (w - U * sc) / 2 - left * sc, oy = h / 2 - 70 * sc
  const X = (x) => ox + x * sc, Y = (y) => oy + y * sc
  const n = o.f.length, K = 72, upto = clamp(o.progress == null ? 1 : o.progress), A = o.alpha == null ? 1 : o.alpha, pal = o.pal, t = o.t || 0
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round'
  const last = Math.round(K * upto), amin = o.amin == null ? 0.4 : o.amin      // the outer paths are fainter; less so when the mark is small
  for (let i = 0; i < n && last > 0; i++) {
    const off = n === 1 ? 0 : (i - (n - 1) / 2) / ((n - 1) / 2)
    c.beginPath()
    for (let k = 0; k <= last; k++) {
      const s = k / K, y = 70 + off * spread * Math.pow(1 - s, 1.7) + (spread / 46) * 17 * bridge(o.f[i], s, t)
      if (k) c.lineTo(X(x0 + (MEET - x0) * s), Y(y)); else c.moveTo(X(x0), Y(y))
    }
    // Brass is what is sealed (docs/design.md): a path is its side's colour until it nears the meeting point.
    const side = o.mono ? pal.line : off < -0.01 ? pal.pale : off > 0.01 ? pal.blue : pal.line
    const g = c.createLinearGradient(X(x0), 0, X(MEET), 0)
    g.addColorStop(0, side); g.addColorStop(0.62, side); g.addColorStop(1, pal.line)
    c.strokeStyle = g; c.lineWidth = Math.max(o.minw || 0.8, 1.6 * sc); c.globalAlpha = A * (amin + (1 - amin) * (1 - Math.abs(off))); c.stroke()
  }
  c.globalAlpha = A
  const trunk = o.trunk == null ? 1 : o.trunk
  const both = letterThenRing(o.letter == null ? 1 : o.letter), lt = o.ring == null ? both.letter : clamp(o.letter == null ? 1 : o.letter), rg = o.ring == null ? both.ring : clamp(o.ring)
  // while the letter is not drawn the line stops at the ring's gap; it runs on to the stem as the letter is drawn
  const reach = (RING_X - RING_R) + (STEM - (RING_X - RING_R)) * clamp(lt * 3)
  if (trunk > 0) { c.beginPath(); c.moveTo(X(MEET), Y(70)); c.lineTo(X(MEET + (reach - MEET) * trunk), Y(70)); c.strokeStyle = pal.line; c.lineWidth = Math.max(1.4, 3.6 * sc); c.stroke() }
  if (o.ghost > 0) { c.globalAlpha = A * 0.16 * o.ghost; strokes(c, X, Y, sc, LETTER, LETTER_LEN, 1, pal.letter); strokes(c, X, Y, sc, RING, RING_LEN, 1, pal.letter); c.globalAlpha = A }
  if (lt > 0) strokes(c, X, Y, sc, LETTER, LETTER_LEN, lt, pal.letter)
  if (rg > 0) strokes(c, X, Y, sc, RING, RING_LEN, rg, pal.letter)
  c.restore()
  return { sc, ox, oy }
}

const REST = 'IJEKA'
/** Where the type sits in the lockup, in units: the river, the ringed R, then IJEKA in the app's face. `right` is its right edge. */
export function lockupUnits(c, o) {
  const font = 27 / 0.7, gap = font * 0.32
  c.save(); c.font = `600 100px ${o.pal.sans}`
  const adv = [...REST].map((ch) => c.measureText(ch).width / 100 * font)
  c.restore()
  const x0 = o.x0 == null ? 18 : o.x0, textX = RING_X + RING_R + gap * 0.9, textW = adv.reduce((a, b) => a + b, 0) + gap * (REST.length - 1)
  return { font, gap, adv, x0, textX, right: textX + textW + 4 }
}

/** The logo: the river running into the ringed R that begins the name. Same options as drawMark. */
export function drawLockup(c, w, h, o) {
  const u = lockupUnits(c, o)
  const { sc, ox, oy } = drawMark(c, w, h, { ...o, right: u.right })
  c.save(); c.globalAlpha = (o.alpha == null ? 1 : o.alpha) * (o.word == null ? 1 : o.word)
  c.fillStyle = o.pal.letter; c.font = `600 ${u.font * sc}px ${o.pal.sans}`; c.textBaseline = 'alphabetic'; c.textAlign = 'left'
  let x = u.textX
  ;[...REST].forEach((ch, i) => { c.fillText(ch, ox + x * sc, oy + 84 * sc); x += u.adv[i] + u.gap })
  c.restore()
  return { sc, units: u.right - (u.x0 - 4) }
}

/** Size a canvas for the screen's pixel density and clear it. Returns its 2D context and its size in CSS pixels. */
export function fit(cv) {
  const d = Math.min(window.devicePixelRatio || 1, 3), w = cv.clientWidth, h = cv.clientHeight
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d) }
  const c = cv.getContext('2d')
  c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h)
  return { c, w, h }
}

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
/** A seed from any text (a trade's id): the same text always draws the same river. */
export function seedOf(text) {
  let h = 2166136261
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  return h || 1
}
/** The seed of the fixed, official drawing. */
export const OFFICIAL_SEED = 20261111
