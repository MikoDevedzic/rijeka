// home/DeskGlobe.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// The desk globe. A slowly turning Earth drawn as a dot grid (Natural Earth
// 110m land, public domain, precomputed in land-dots.json), lit by the real
// sun so the terminator moves across it during the day; the five desks glow
// when their session is open; every live trade is an arc from our entity's
// home city to the counterparty's, with a pulse travelling along it; and
// above the planet an orbital ring is the registry: one satellite per anchored
// confirmation, launched from the desk when it lands.
//
// Plain canvas 2D, no library. Literal colours only — canvas cannot read
// CSS variables. Drag to turn it; it resumes on its own.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react'
import DOTS from './land-dots.json'

const DESKS = [
  { city: 'SYDNEY',    tz: 'Australia/Sydney', lat: -33.87, lon: 151.21 },
  { city: 'TOKYO',     tz: 'Asia/Tokyo',       lat: 35.68,  lon: 139.69 },
  { city: 'FRANKFURT', tz: 'Europe/Berlin',    lat: 50.11,  lon: 8.68 },
  { city: 'LONDON',    tz: 'Europe/London',    lat: 51.51,  lon: -0.13 },
  { city: 'NEW YORK',  tz: 'America/New_York', lat: 40.71,  lon: -74.01 },
]
const ACCENT = '#0dd4a8', AMBER = '#f0a020', BLUE = '#4a9ad4', DIM = '#8B98A8', MUTE = '#5F6C7B', HI = '#F4F7FA'
const TILT = 24 * Math.PI / 180            // camera latitude
const SPIN = 0.02                          // radians per second: one turn in about five minutes
const RING = 1.42                          // orbit radius, in globe radii
const RING_TILT = 0.30                     // how flat the orbit looks (0 = edge-on line)
const RAD = Math.PI / 180

const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})` }
const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3)

// Session state per desk from the local clock (same rule as WorldClock).
function deskState(tz, now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(now)
  const get = t => parts.find(p => p.type === t)?.value || ''
  const mins = (Number(get('hour')) % 24) * 60 + Number(get('minute'))
  const weekday = !['Sat', 'Sun'].includes(get('weekday'))
  return weekday && mins >= 480 && mins < 1020 ? 'open' : weekday && mins >= 420 && mins < 480 ? 'soon' : 'closed'
}

// Sub-solar point: declination from the day of year, longitude from UTC time.
function sunVector(now) {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0)
  const doy = (now - start) / 864e5
  const decl = -23.44 * RAD * Math.cos(2 * Math.PI * (doy + 10) / 365.25)
  const utc = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600
  const lon = (12 - utc) * 15 * RAD
  return [Math.cos(decl) * Math.cos(lon), Math.cos(decl) * Math.sin(lon), Math.sin(decl)]
}

const toVec = (lat, lon) => { const p = lat * RAD, l = lon * RAD; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)] }

export default function DeskGlobe({ arcs = [], home, anchors = [], chain, reducedMotion = false, height = 300 }) {
  const ref = useRef(null)
  const data = useRef({ arcs, home, anchors, chain })
  const born = useRef(new Map())                        // tx/trade key -> time the satellite launched
  useEffect(() => { data.current = { arcs, home, anchors, chain } }, [arcs, home, anchors, chain])

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'ui-monospace, monospace'
    let W = 0, H = 0, dpr = 1, raf = 0, last = 0, alive = true
    let userLon = 0, dragging = null, pausedUntil = 0
    const t0 = performance.now()

    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect()
      W = Math.max(200, r.width); H = height; dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement); resize()

    // pointer: drag turns the globe, and pauses the spin for a few seconds
    const down = (e) => { dragging = { x: e.clientX, lon: userLon }; canvas.setPointerCapture?.(e.pointerId) }
    const move = (e) => { if (!dragging) return; userLon = dragging.lon + (e.clientX - dragging.x) * 0.6 * RAD; pausedUntil = performance.now() + 4000 }
    const up = () => { dragging = null }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up)

    let spinLon = 0, lastT = t0
    const frame = (now) => {
      if (!alive) return
      raf = requestAnimationFrame(frame)
      if (now - last < 33) return                       // ~30 fps is plenty for a desk ornament
      last = now
      if (!reducedMotion && !dragging && now > pausedUntil) spinLon += SPIN * (now - lastT) / 1000
      lastT = now
      draw(now)
    }

    const draw = (now) => {
      const { arcs, home, anchors, chain } = data.current
      const date = new Date()
      const sun = sunVector(date)
      const cx = W / 2, cy = H / 2 + 6
      const R = Math.min(W / 2 / RING, (H / 2 - 10) / (1 + 0.04)) * 0.98
      const lon0 = spinLon + userLon + (home ? -home.lon * RAD : 74 * RAD) + 0.6   // start with home facing us, slightly left
      const cT = Math.cos(TILT), sT = Math.sin(TILT), cL = Math.cos(lon0), sL = Math.sin(lon0)
      // earth-frame vector -> view: rotate by lon0 about the pole, tilt the camera, project orthographically
      const proj = (v) => {
        const xe = v[0] * cL + v[1] * sL, ye = -v[0] * sL + v[1] * cL, ze = v[2]
        const x = ye, y = ze * cT - xe * sT, z = ze * sT + xe * cT
        return { sx: cx + R * x, sy: cy - R * y, z, r2: x * x + y * y }
      }
      const visible = (p) => p.z > 0 || p.r2 > 1          // behind the centre plane but outside the disc is still visible

      ctx.clearRect(0, 0, W, H)

      // ── orbit ring, back half ─────────────────────────────────────────
      const ringPt = (th) => ({ sx: cx + R * RING * Math.cos(th), sy: cy - R * RING * Math.sin(th) * RING_TILT, front: Math.sin(th) < 0 })
      const ringArc = (front) => {
        ctx.beginPath()
        for (let i = 0; i <= 180; i++) { const th = (front ? Math.PI : 0) + Math.PI * i / 180; const p = ringPt(th); i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy) }
        ctx.strokeStyle = hexA(ACCENT, front ? 0.28 : 0.10); ctx.lineWidth = 1; ctx.stroke()
      }
      ringArc(false)

      // ── sphere ────────────────────────────────────────────────────────
      const sunV = proj(sun)
      const g = ctx.createRadialGradient(cx + sunV.sx * 0 + (sunV.sx - cx) * 0.35, cy + (sunV.sy - cy) * 0.35, R * 0.1, cx, cy, R)
      g.addColorStop(0, '#0f1721'); g.addColorStop(0.7, '#0a0f15'); g.addColorStop(1, '#070a0e')
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill()
      // atmosphere
      ctx.save(); ctx.shadowColor = hexA(ACCENT, 0.35); ctx.shadowBlur = 18
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.strokeStyle = hexA(ACCENT, 0.22); ctx.lineWidth = 1; ctx.stroke(); ctx.restore()

      // ── land dots, lit by the sun ─────────────────────────────────────
      const buckets = [[], [], [], [], [], []]          // 3 day shades + 3 night shades, batched
      for (let i = 0; i < DOTS.length; i += 2) {
        const lat = DOTS[i] / 100, lon = DOTS[i + 1] / 100
        const v = toVec(lat, lon)
        const p = proj(v); if (p.z <= 0) continue
        const day = v[0] * sun[0] + v[1] * sun[1] + v[2] * sun[2]
        const lit = Math.min(1, Math.max(0, (day + 0.08) / 0.3))
        const depth = 0.45 + 0.55 * p.z
        const k = Math.min(2, Math.floor(depth * 3))
        buckets[(lit > 0.5 ? 0 : 3) + k].push(p.sx, p.sy, 0.75 + 0.55 * p.z + 0.25 * lit)
      }
      buckets.forEach((b, bi) => {
        if (!b.length) return
        const dayside = bi < 3, lvl = (bi % 3 + 1) / 3
        ctx.fillStyle = dayside ? `rgba(190,214,222,${0.28 + 0.6 * lvl})` : `rgba(96,118,140,${0.14 + 0.32 * lvl})`
        ctx.beginPath()
        for (let i = 0; i < b.length; i += 3) { ctx.moveTo(b[i] + b[i + 2], b[i + 1]); ctx.arc(b[i], b[i + 1], b[i + 2], 0, Math.PI * 2) }
        ctx.fill()
      })

      // ── desks ─────────────────────────────────────────────────────────
      ctx.font = `600 9px ${mono}`; ctx.textBaseline = 'middle'
      const pulse = (now % 2200) / 2200
      DESKS.forEach(d => {
        const p = proj(toVec(d.lat, d.lon)); if (p.z <= 0.02) return
        const st = deskState(d.tz, date)
        const col = st === 'open' ? ACCENT : st === 'soon' ? AMBER : MUTE
        if (st === 'open') { ctx.beginPath(); ctx.arc(p.sx, p.sy, 3 + 9 * pulse, 0, Math.PI * 2); ctx.strokeStyle = hexA(col, 0.5 * (1 - pulse)); ctx.lineWidth = 1; ctx.stroke() }
        ctx.beginPath(); ctx.arc(p.sx, p.sy, st === 'closed' ? 1.8 : 2.6, 0, Math.PI * 2); ctx.fillStyle = hexA(col, 0.4 + 0.6 * p.z); ctx.fill()
        if (st !== 'closed' && p.z > 0.25 && d.city !== home?.city) { ctx.fillStyle = hexA(col, 0.9); ctx.textAlign = 'left'; ctx.fillText(d.city, p.sx + 7, p.sy) }
      })

      // ── the book: arcs home → counterparty ────────────────────────────
      const homeP = home ? proj(toVec(home.lat, home.lon)) : null
      const arcPath = (a, b) => {                         // great circle, lifted
        const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
        const om = Math.acos(dot) || 1e-6, so = Math.sin(om) || 1e-6, lift = 0.10 + 0.28 * om / Math.PI
        const pts = []
        for (let i = 0; i <= 48; i++) {
          const t = i / 48, wa = Math.sin((1 - t) * om) / so, wb = Math.sin(t * om) / so, s = 1 + lift * Math.sin(Math.PI * t)
          pts.push(proj([(wa * a[0] + wb * b[0]) * s, (wa * a[1] + wb * b[1]) * s, (wa * a[2] + wb * b[2]) * s]))
        }
        return pts
      }
      if (home) {
        const hv = toVec(home.lat, home.lon)
        arcs.forEach((arc, idx) => {
          let to = arc.to || home
          if (Math.abs(to.lat - home.lat) < 0.5 && Math.abs(to.lon - home.lon) < 0.5) to = { lat: home.lat + 7, lon: home.lon + 12 }   // same city: a short local hop
          const pts = arcPath(hv, toVec(to.lat, to.lon))
          const col = arc.status === 'PENDING' ? AMBER : arc.status === 'LIVE' ? BLUE : ACCENT
          ctx.setLineDash(arc.status === 'PENDING' ? [3, 4] : [])
          ctx.lineWidth = 1.1
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i]; if (!visible(a) || !visible(b)) continue
            ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy)
            ctx.strokeStyle = hexA(col, 0.18 + 0.5 * Math.max(0, Math.min(1, (b.z + 0.3)))); ctx.stroke()
          }
          ctx.setLineDash([])
          // a light travelling along the arc, slower when the trade is still pending
          const speed = arc.status === 'PENDING' ? 5200 : 3200
          const head = ((now + idx * 977) % speed) / speed
          for (let k = 0; k < 7; k++) {
            const t = head - k * 0.018; if (t < 0) break
            const p = pts[Math.round(t * 48)]; if (!visible(p)) continue
            ctx.beginPath(); ctx.arc(p.sx, p.sy, 2.2 - k * 0.25, 0, Math.PI * 2); ctx.fillStyle = hexA(col, (1 - k / 7) * 0.95); ctx.fill()
          }
          const end = pts[pts.length - 1]
          if (visible(end)) { ctx.beginPath(); ctx.arc(end.sx, end.sy, 2.4, 0, Math.PI * 2); ctx.fillStyle = hexA(col, 0.9); ctx.fill() }
        })
        // home: our entity
        if (homeP && homeP.z > 0) {
          ctx.save(); ctx.translate(homeP.sx, homeP.sy); ctx.rotate(Math.PI / 4)
          ctx.fillStyle = HI; ctx.fillRect(-3, -3, 6, 6); ctx.strokeStyle = hexA(ACCENT, 0.9); ctx.lineWidth = 1.2; ctx.strokeRect(-5, -5, 10, 10); ctx.restore()
          ctx.fillStyle = hexA(HI, 0.9); ctx.textAlign = 'left'; ctx.fillText(home.city, homeP.sx + 9, homeP.sy - 9)
        }
      }

      // ── orbit ring, front half, with one satellite per anchor ─────────
      ringArc(true)
      const n = Math.max(anchors.length, 1)
      anchors.forEach((a, i) => {
        const key = a.tx_hash || a.trade_ref || String(i)
        if (!born.current.has(key)) born.current.set(key, now + (reducedMotion ? 0 : i * 260))
        const b = born.current.get(key); if (now < b) return
        const k = reducedMotion ? 1 : ease((now - b) / 1400)
        const th = -0.9 + (i / n) * Math.PI * 2 + (reducedMotion ? 0 : now / 40000)
        const rp = ringPt(th)
        const from = homeP && visible(homeP) ? homeP : { sx: cx, sy: cy + R }
        const sx = from.sx + (rp.sx - from.sx) * k, sy = from.sy + (rp.sy - from.sy) * k
        const bright = i === 0 ? 1 : 0.65
        ctx.save(); ctx.shadowColor = hexA(ACCENT, 0.9); ctx.shadowBlur = k < 1 ? 14 : 6 + 4 * bright
        ctx.fillStyle = hexA(k < 1 || rp.front ? ACCENT : '#2a7a66', rp.front || k < 1 ? bright : 0.45)
        ctx.fillRect(sx - 2, sy - 2, 4, 4); ctx.restore()
        if (k < 1) {                                        // launch trail
          for (let q = 1; q <= 6; q++) { const kk = Math.max(0, k - q * 0.05); const tx = from.sx + (rp.sx - from.sx) * kk, ty = from.sy + (rp.sy - from.sy) * kk
            ctx.beginPath(); ctx.arc(tx, ty, 1.6 - q * 0.2, 0, Math.PI * 2); ctx.fillStyle = hexA(ACCENT, 0.6 * (1 - q / 6)); ctx.fill() }
        }
      })
      // the chain's heartbeat on the ring
      if (chain?.anchored) {
        const beat = 0.5 + 0.5 * Math.sin(now / 900)
        const p = ringPt(-Math.PI / 2 + 0.001)
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 2 + beat, 0, Math.PI * 2); ctx.fillStyle = hexA(chain.reachable === false ? AMBER : ACCENT, 0.5 + 0.5 * beat); ctx.fill()
        ctx.font = `500 9px ${mono}`; ctx.textAlign = 'center'; ctx.fillStyle = hexA(DIM, 0.95)
        ctx.fillText(`${chain.network || 'CHAIN'}${chain.latest_block ? ` · #${Number(chain.latest_block).toLocaleString()}` : ''}${anchors.length ? ` · ${anchors.length} IN ORBIT` : ''}`, cx, H - 7)
      }
    }

    const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0 } else if (!raf && alive) { last = 0; lastT = performance.now(); raf = requestAnimationFrame(frame) } }
    document.addEventListener('visibilitychange', onVis)
    raf = requestAnimationFrame(frame)
    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up)
    }
  }, [height, reducedMotion])

  return <div className="dg-wrap" style={{ height }}><canvas ref={ref} className="dg-canvas" aria-label="Desk globe: sessions, book and confirmations" /></div>
}
