// The sign-in scene cycles through four short pieces, each a true thing about
// the engine: the ATM vol surface, a bootstrap of today's par curve into
// zeros and discount factors, the confirmation pipeline with the live block,
// and the maths that runs underneath. Nine seconds each, cross-fade, dots to
// jump, pause on hover, static first scene under prefers-reduced-motion.
import { useEffect, useRef, useState } from 'react'
import VolSurface3D, { toGrid } from './VolSurface3D'

const DWELL_MS = 9000
const years = (t) => { const m = /^(\d+)(D|W|M|Y)$/.exec(t || ''); if (!m) return t === 'ON' ? 1 / 365 : null; const n = +m[1]; return { D: n / 365, W: n / 52, M: n / 12, Y: n }[m[2]] }
const FALLBACK_PAR = [['1Y', 3.76], ['2Y', 4.06], ['3Y', 4.10], ['5Y', 4.12], ['7Y', 4.21], ['10Y', 4.28], ['15Y', 4.42], ['20Y', 4.52], ['30Y', 4.48]].map(([tenor, rate]) => ({ tenor, rate }))

// ── Scene 2: bootstrap ────────────────────────────────────────────────────
// Annual-coupon bootstrap of par rates on integer years (linear in par rate
// between quoted tenors): DF_n = (1 - s_n Σ DF_k) / (1 + s_n); z = -ln DF / t.
export function bootstrap(quotes) {
  const q = (quotes || []).map(x => ({ t: years(x.tenor), r: Number(x.rate) })).filter(x => x.t != null && x.t >= 1 && !isNaN(x.r)).sort((a, b) => a.t - b.t)
  if (q.length < 3) return null
  const T = Math.round(q[q.length - 1].t)
  const par = []
  for (let n = 1; n <= T; n++) {
    let i = 0; while (i < q.length - 1 && q[i + 1].t < n) i++
    const a = q[i], b = q[Math.min(i + 1, q.length - 1)]
    par.push(a.t === b.t || n <= a.t ? a.r : n >= b.t ? b.r : a.r + (b.r - a.r) * (n - a.t) / (b.t - a.t))
  }
  const df = [], zero = []
  let acc = 0
  for (let n = 1; n <= T; n++) {
    const s = par[n - 1] / 100
    const d = (1 - s * acc) / (1 + s)
    df.push(d); acc += d; zero.push(-Math.log(d) / n * 100)
  }
  return { T, par, zero, df }
}

function BootstrapScene({ quotes, active }) {
  const ref = useRef(null)
  const data = bootstrap(quotes?.length >= 3 ? quotes : FALLBACK_PAR)
  useEffect(() => {
    const cv = ref.current; if (!cv || !data) return
    const ctx = cv.getContext('2d')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf = 0, alive = true, t0 = performance.now()
    const resize = () => { const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr) }
    resize(); const ro = new ResizeObserver(resize); ro.observe(cv)
    const { T, par, zero, df } = data
    const lo = Math.min(...par, ...zero) - 0.25, hi = Math.max(...par, ...zero) + 0.25
    const draw = (now) => {
      if (!alive) return
      const W = cv.width, H = cv.height, dpr = Math.min(2, window.devicePixelRatio || 1)
      const el = reduce ? 9 : (now - t0) / 1000
      const L = 44 * dpr, R = W - 46 * dpr, TOP = 18 * dpr, BOT = H - 26 * dpr
      const X = n => L + (Math.log(n) / Math.log(T)) * (R - L)
      const Y = r => TOP + (hi - r) / (hi - lo) * (BOT - TOP)
      const YD = d => TOP + (1 - d) / (1 - Math.min(...df) + 0.02) * (BOT - TOP)
      ctx.clearRect(0, 0, W, H)
      ctx.font = `${10 * dpr}px "JetBrains Mono", monospace`; ctx.fillStyle = 'rgba(95,108,123,0.9)'; ctx.textAlign = 'center'
      for (const n of [1, 2, 5, 10, 20, 30]) if (n <= T) ctx.fillText(`${n}Y`, X(n), H - 8 * dpr)
      ctx.textAlign = 'right'; for (const r of [lo + 0.25, (lo + hi) / 2, hi - 0.25]) ctx.fillText(`${r.toFixed(2)}%`, L - 6 * dpr, Y(r) + 3 * dpr)
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = dpr
      for (const n of [1, 2, 5, 10, 20, 30]) if (n <= T) { ctx.beginPath(); ctx.moveTo(X(n), TOP); ctx.lineTo(X(n), BOT); ctx.stroke() }
      const line = (vals, yf, color, from, to, glow) => {
        const k = Math.max(0, Math.min(1, (el - from) / (to - from)))
        if (k <= 0) return
        const nPts = Math.max(2, Math.round(1 + (T - 1) * k))
        ctx.strokeStyle = color; ctx.lineWidth = 2 * dpr; ctx.lineJoin = 'round'
        ctx.shadowColor = glow; ctx.shadowBlur = 10 * dpr
        ctx.beginPath()
        for (let n = 1; n <= nPts; n++) { const x = X(n), y = yf(vals[n - 1]); n === 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }
        ctx.stroke(); ctx.shadowBlur = 0
        if (k >= 1) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(T), yf(vals[T - 1]), 3 * dpr, 0, Math.PI * 2); ctx.fill() }
        return k
      }
      const label = (txt, x, y, color, on) => { if (!on) return; ctx.font = `${10.5 * dpr}px "JetBrains Mono", monospace`; ctx.textAlign = 'left'; ctx.fillStyle = color; ctx.fillText(txt, x, y) }
      const kp = line(par, Y, '#0dd4a8', 0.3, 2.6, 'rgba(13,212,168,0.6)')
      const kz = line(zero, Y, '#4a9ad4', 2.9, 5.2, 'rgba(74,154,212,0.6)')
      const kd = line(df, YD, '#f0a020', 5.5, 7.8, 'rgba(240,160,32,0.5)')
      label(`PAR ${par[T - 1].toFixed(3)}%`, L + 8 * dpr, Y(par[T - 1]) - 8 * dpr, '#0dd4a8', kp >= 1)
      label(`ZERO ${zero[T - 1].toFixed(3)}%`, L + 8 * dpr, Y(zero[T - 1]) + 16 * dpr, '#4a9ad4', kz >= 1)
      label(`DF(${T}Y) ${df[T - 1].toFixed(4)}`, R - 150 * dpr, YD(df[T - 1]) - 8 * dpr, '#f0a020', kd >= 1)
      if (el < 9 && !reduce) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect() }
  }, [data?.T, active])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null
  return <canvas ref={ref} className="au-vol" aria-hidden="true" />
}

// ── Scene 3: the confirmation pipeline ────────────────────────────────────
const HEX = '0123456789abcdef'
function AnchorScene({ chain, confirmations }) {
  const [hash, setHash] = useState('')
  useEffect(() => {
    let i = 0
    const iv = setInterval(() => {
      i++
      setHash(h => '0x' + Array.from({ length: 24 }, (_, k) => k < i ? (h[k + 2] && i > 30 ? h[k + 2] : HEX[Math.floor(Math.random() * 16)]) : HEX[Math.floor(Math.random() * 16)]).join(''))
      if (i > 40) clearInterval(iv)
    }, 60)
    return () => clearInterval(iv)
  }, [])
  const steps = [
    ['TRADE', 'canonical record', 'schema v2 · UTI'],
    ['keccak256', 'trade hash', hash || '0x…'],
    ['A · B', 'EIP-712 signatures', 'both parties sign'],
    ['REGISTRY', chain?.chain_id === 11155111 ? 'Sepolia' : 'Ethereum', chain?.latest_block ? `block #${Number(chain.latest_block).toLocaleString()}` : 'anchored'],
  ]
  return (
    <div className="au-anchor">
      <div className="au-anchor-row">
        {steps.map(([k, t, d], i) => (
          <div className="au-anchor-step" key={k} style={{ animationDelay: `${0.2 + i * 0.9}s` }}>
            <div className="au-anchor-node"><span>{k}</span></div>
            <div className="au-anchor-t">{t}</div>
            <div className="au-anchor-d">{d}</div>
            {i < steps.length - 1 && <i className="au-anchor-link" style={{ animationDelay: `${0.6 + i * 0.9}s` }} />}
          </div>
        ))}
      </div>
      <div className="au-anchor-foot">
        <span>{confirmations != null ? `${confirmations} confirmations carry an on-chain hash` : 'bilateral · immutable · verifiable by anyone'}</span>
        {chain?.registry && <span className="mono">{chain.registry.slice(0, 8)}…{chain.registry.slice(-6)}</span>}
      </div>
    </div>
  )
}

// ── Scene 4: the maths underneath ─────────────────────────────────────────
function MathScene() {
  const rows = [
    ['BACHELIER', <>V = N·τ·[ (F − K)·Φ(d) + σ<sub>N</sub>√T·φ(d) ],&nbsp; d = (F − K) / (σ<sub>N</sub>√T)</>],
    ['SABR', <>σ<sub>N</sub>(K) ≈ α·(FK)<sup>β/2</sup>·z/x(z)·[ 1 + (…)·T ],&nbsp; z = (ν/α)·(FK)<sup>(1−β)/2</sup>·ln(F/K)</>],
    ['HULL–WHITE', <>dr<sub>t</sub> = ( θ(t) − a·r<sub>t</sub> ) dt + σ dW<sub>t</sub></>],
    ['XVA', <>CVA = (1 − R) ∫<sub>0</sub><sup>T</sup> EE(t) dPD(t),&nbsp; FVA = ∫ (EPE − ENE)·s<sub>F</sub>·DF dt</>],
    ['ANCHOR', <>h = keccak256(canonical(trade)),&nbsp; sig<sub>A</sub>, sig<sub>B</sub> = EIP-712(h)</>],
  ]
  return (
    <div className="au-math">
      {rows.map(([k, eq], i) => (
        <div className="au-math-row" key={k} style={{ animationDelay: `${0.25 + i * 0.75}s` }}>
          <span className="au-math-k">{k}</span>
          <span className="au-math-eq">{eq}</span>
        </div>
      ))}
    </div>
  )
}

// ── Carousel ──────────────────────────────────────────────────────────────
export default function Scenes({ pulse, failed }) {
  const grid = toGrid(pulse?.vol?.quotes)
  const chain = pulse?.chain || {}
  const liveLabel = (date) => date ? `SNAPSHOT ${date}` : failed ? 'OFFLINE · ILLUSTRATIVE' : 'CONNECTING'
  const scenes = [
    { k: 'surface', title: 'USD SWAPTION · ATM NORMAL VOL · EXPIRY × TENOR', live: !!grid, chip: liveLabel(pulse?.vol?.valuation_date),
      el: (on) => <VolSurface3D grid={grid} key={on} /> },
    { k: 'bootstrap', title: 'USD SOFR OIS · PAR → ZERO → DISCOUNT FACTORS', live: pulse?.curve?.quotes?.length >= 3, chip: liveLabel(pulse?.curve?.valuation_date),
      el: (on) => <BootstrapScene quotes={pulse?.curve?.quotes} active={on} key={on} /> },
    { k: 'anchor', title: 'BILATERAL CONFIRMATION · HASH · SIGN · ANCHOR', live: !!chain.latest_block, chip: chain.latest_block ? 'SEPOLIA · LIVE' : failed ? 'OFFLINE' : 'CONNECTING',
      el: (on) => <AnchorScene chain={chain} confirmations={pulse?.confirmations} key={on} /> },
    { k: 'math', title: 'WHAT RUNS UNDERNEATH', live: true, chip: 'OPEN SOURCE · APACHE-2.0',
      el: (on) => <MathScene key={on} /> },
  ]
  const [i, setI] = useState(0)
  const [hover, setHover] = useState(false)
  const [tick, setTick] = useState(0)        // remounts the active scene so its intro replays
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  useEffect(() => {
    if (reduce || hover) return
    const id = setTimeout(() => { setI(n => (n + 1) % scenes.length); setTick(t => t + 1) }, DWELL_MS)
    return () => clearTimeout(id)
  }, [i, hover, reduce, scenes.length])
  const s = scenes[i]
  return (
    <div className="au-chart" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="au-chart-hdr">
        <span>{s.title}</span>
        <span className={`au-live${s.live ? ' on' : ''}`}><i />{s.chip}</span>
      </div>
      <div className="au-stage" key={`${s.k}-${tick}`}>{s.el(tick)}</div>
      <div className="au-dots" role="tablist" aria-label="scenes">
        {scenes.map((x, n) => (
          <button key={x.k} role="tab" aria-selected={n === i} className={n === i ? 'on' : ''} onClick={() => { setI(n); setTick(t => t + 1) }}>
            <i style={n === i && !hover && !reduce ? { animationDuration: `${DWELL_MS}ms` } : undefined} /><span>{x.k.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
