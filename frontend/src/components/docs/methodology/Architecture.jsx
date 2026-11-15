// How the system is built: the app a trader uses in the middle, the API behind it, each piece standing on the host
// it runs on, light travelling along the joins the way a request goes, and three things followed step by step: a
// trade, a change to the code past its gates and checks, and what the scheduler does by itself. The facts are
// architecture-data.js (which restates docs/architecture.md); this file only draws them.
//
// The scene is a canvas (three.js, loaded when this page is first opened, as the app's other scenes are). The
// names are ordinary buttons set over it, placed each frame at the point of the piece they name, so they stay
// sharp, can be pressed and are read by a screen reader. Where a browser cannot draw the scene the page says so
// and the steps and the pieces are still there to read.
import { useEffect, useRef, useState } from 'react'
import { API } from '../../../lib/api'
import { loadThree, legacyRenderer, LEGACY_LIGHT } from '../../../lib/three'
import { KINDS, HOSTS, CHECKS, PIECES, JOINS, STORIES, healthCells } from './architecture-data'

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const shade = (h, k) => (Math.round(((h >> 16) & 255) * k) << 16) | (Math.round(((h >> 8) & 255) * k) << 8) | Math.round((h & 255) * k)
// a piece's colours: its kind's, or its own (a reviewer, a check)
const tone = (n) => n.line != null ? { line: n.line, body: shade(n.line, 0.3), lit: shade(n.line, 0.5), css: n.css } : { ...KINDS[n.kind] }
const AT = Object.fromEntries(PIECES.map(n => [n.id, n]))
const HOME = [0.1, -2.4], HOME_DIST = 33, HOME_PITCH = 0.68       // where the eye rests for the whole map
const ANCHORS = ['app', 'api', 'pg', 'chain']                      // the names a narrow screen keeps on the whole map
const FOV = 34, TAN = Math.tan((FOV / 2) * Math.PI / 180)
const TOUR_MS = 6500                                               // long enough for a change to pass the gates

// Builds the scene on `canvas`. `els`: the elements placed over it each frame ({ pieces, hosts, tags, check }).
// Returns { set(step, picked), zoom(by), destroy() }.
function makeStage(T, canvas, host, els, onPick) {
  const renderer = legacyRenderer(T, { canvas, antialias: true, alpha: true })
  try { return buildStage(T, renderer, canvas, host, els, onPick) }
  catch (e) { renderer.dispose(); throw e }               // nothing half-built is left holding the canvas
}
function buildStage(T, renderer, canvas, host, els, onPick) {
  const reduce = reducedMotion()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  const scene = new T.Scene()
  scene.fog = new T.Fog(0x081714, 40, 100)
  const camera = new T.PerspectiveCamera(FOV, 2, 0.1, 220)
  scene.add(new T.AmbientLight(0xe9e3d3, 0.7 * LEGACY_LIGHT))
  const sun = new T.DirectionalLight(0xffffff, 0.85 * LEGACY_LIGHT); sun.position.set(-8, 15, 10); scene.add(sun)
  const rim = new T.DirectionalLight(0x8fc1e6, 0.35 * LEGACY_LIGHT); rim.position.set(10, 6, -9); scene.add(rim)
  const trash = []
  const keep = (x) => { trash.push(x); return x }
  const grid = new T.GridHelper(110, 110, 0x24413a, 0x122a25); grid.position.y = -0.02; scene.add(grid); keep(grid.geometry); keep(grid.material)

  // light, drawn once and used everywhere: a soft dot, a pool for the floor, a beam that fades at both ends
  const paint = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d')); return keep(new T.CanvasTexture(c)) }
  const glow = paint(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64) })
  const pool = paint(256, 256, (g) => { const r = g.createRadialGradient(128, 128, 0, 128, 128, 128); r.addColorStop(0, 'rgba(127,211,204,0.3)'); r.addColorStop(0.5, 'rgba(127,211,204,0.08)'); r.addColorStop(1, 'rgba(127,211,204,0)'); g.fillStyle = r; g.fillRect(0, 0, 256, 256) })
  const rise = paint(4, 128, (g) => { const r = g.createLinearGradient(0, 0, 0, 128); r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.55, 'rgba(255,255,255,0.2)'); r.addColorStop(0.86, 'rgba(255,255,255,0.7)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 4, 128) })
  const lit = (color, opacity) => ({ color, transparent: true, opacity, depthWrite: false, blending: T.AdditiveBlending })

  const floor = new T.Mesh(keep(new T.CircleGeometry(30, 64)), keep(new T.MeshBasicMaterial({ map: pool, ...lit(0xffffff, 1) }))); floor.rotation.x = -Math.PI / 2; floor.position.set(-1, -0.01, -1.5); scene.add(floor)
  // dust in the air, so that turning the scene has depth to it
  const dust = [0, 1].map((k) => {
    const pos = new Float32Array(360 * 3)
    for (let i = 0; i < 360; i++) { pos[i * 3] = (Math.random() - 0.5) * 60; pos[i * 3 + 1] = 0.4 + Math.random() * 14; pos[i * 3 + 2] = (Math.random() - 0.5) * 46 }
    const geo = keep(new T.BufferGeometry()); geo.setAttribute('position', new T.BufferAttribute(pos, 3))
    const pts = new T.Points(geo, keep(new T.PointsMaterial({ size: k ? 0.16 : 0.1, map: glow, ...lit(k ? 0xf1d488 : 0xa9d9cf, k ? 0.3 : 0.45) }))); scene.add(pts); return pts
  })

  // what a host runs stands on a slab of its own
  const hostAt = {}, slabs = []
  for (const h of HOSTS) {
    const geo = keep(new T.BoxGeometry(h.w, 0.12, h.d))
    const slab = new T.Mesh(geo, keep(new T.MeshStandardMaterial({ color: 0x0f2a25, roughness: 0.85, transparent: true, opacity: 0.92 }))); slab.position.set(h.x, 0, h.z); scene.add(slab)
    const edgeMat = keep(new T.LineBasicMaterial({ color: 0x5f8f80, transparent: true, opacity: 0.9 }))
    const edge = new T.LineSegments(keep(new T.EdgesGeometry(geo)), edgeMat); edge.position.copy(slab.position); scene.add(edge)
    hostAt[h.id] = h.side ? new T.Vector3(h.x - h.w / 2 - 0.3, 0.1, h.z + 1.2) : new T.Vector3(h.x - h.w / 2 + 0.15, 0.1, h.z + h.d / 2 + 0.5)
    slabs.push({ h, edgeMat })
  }
  const inHost = (n, h) => Math.abs(n.p[0] - h.x) <= h.w / 2 && Math.abs(n.p[1] - h.z) <= h.d / 2

  const hit = [], nodes = {}
  PIECES.forEach((n, idx) => {
    const tn = tone(n), grp = new T.Group(); grp.position.set(n.p[0], 0.07, n.p[1]); scene.add(grp)
    const body = keep(new T.MeshStandardMaterial({ color: tn.body, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.96, emissive: 0x000000, emissiveIntensity: 0.35 }))
    const line = keep(new T.LineBasicMaterial({ color: tn.line, transparent: true }))
    const o = { n, tn, grp, body, line, seed: idx * 1.7, on: false, dim: false, passed: false }
    const add = (geo, x, y, z, rx) => {
      keep(geo)
      const m = new T.Mesh(geo, body); m.position.set(x, y, z); if (rx) m.rotation.x = rx; m.userData.id = n.id; grp.add(m); hit.push(m)
      const e = new T.LineSegments(keep(new T.EdgesGeometry(geo, 30)), line); e.position.copy(m.position); e.rotation.copy(m.rotation); grp.add(e)
      return m
    }
    let r = 1.3
    if (n.shape === 'screen') {            // a screen on its stand: what a person looks at
      const k = n.big ? 1.25 : 1
      add(new T.BoxGeometry(3.0 * k, 1.8 * k, 0.14), 0, 1.3 * k, 0, -0.2); add(new T.BoxGeometry(0.16, 0.5 * k, 0.16), 0, 0.3 * k, 0.06); add(new T.BoxGeometry(1.3 * k, 0.1, 0.9 * k), 0, 0.05, 0.1)
      r = 2.0 * k
    } else if (n.shape === 'files') {      // a stack of sheets: files that are handed out, not run
      const k = n.small ? 0.78 : 1
      ;[0.1, 0.34, 0.58, 0.82].slice(0, n.small ? 3 : 4).forEach((y, i) => add(new T.BoxGeometry(1.7 * k, 0.16, 1.2 * k), i % 2 ? 0.08 : -0.08, y, 0))
      r = 1.25 * k
    } else if (n.shape === 'core') {       // the one process, with the scheduler riding on it
      add(new T.BoxGeometry(3.4, 1.9, 2.6), 0, 0.95, 0); o.sched = add(new T.BoxGeometry(1.1, 0.5, 1.1), 0.85, 2.15, -0.55)
      r = 2.6
    } else if (n.shape === 'db') {         // three discs: a database
      o.discs = [0.21, 0.74, 1.27].map(y => add(new T.CylinderGeometry(1.05, 1.05, 0.42, 48), 0, y, 0))
      r = 1.5
    } else if (n.shape === 'blocks') {     // a stack of blocks: the chain, with a light of its own, and the block being added
      [0.16, 0.58, 1.0, 1.42].forEach((y, i) => add(new T.BoxGeometry(2.3, 0.32, 1.5), i % 2 ? 0.1 : -0.1, y, 0))
      const lamp = new T.PointLight(0xd9b25c, 1.1 * LEGACY_LIGHT, 8, 1); lamp.position.set(0, 2.2, 0.6); grp.add(lamp)
      o.drop = new T.Mesh(keep(new T.BoxGeometry(2.3, 0.32, 1.5)), keep(new T.MeshStandardMaterial({ color: 0xd9b25c, emissive: 0xf1d488, emissiveIntensity: 0.9, transparent: true, opacity: 0 }))); o.drop.visible = false; grp.add(o.drop)
      r = 1.85
    } else if (n.shape === 'token') {      // a token
      add(new T.CylinderGeometry(0.85, 0.85, 0.34, 40), 0, 0.4, 0); r = 1.25
    } else if (n.shape === 'node') {       // a branch of the repository
      add(new T.BoxGeometry(1.1, 0.7, 0.9), 0, 0.42, 0); r = 0.95
    } else if (n.shape === 'checks') {     // six lamps, each a check of its own, lit one after the other
      o.lamps = CHECKS.map((c, i) => {
        const m = keep(new T.MeshStandardMaterial({ color: shade(c.line, 0.2), emissive: shade(c.line, c.tint), emissiveIntensity: 0, roughness: 0.4 }))
        const geo = keep(new T.BoxGeometry(0.24, 0.95, 0.5)), mesh = new T.Mesh(geo, m); mesh.position.set(-0.75 + i * 0.3, 0.52, 0); mesh.userData.id = n.id; grp.add(mesh); hit.push(mesh)
        const em = keep(new T.LineBasicMaterial({ color: c.line, transparent: true })), e = new T.LineSegments(keep(new T.EdgesGeometry(geo)), em); e.position.copy(mesh.position); grp.add(e)
        return { m, em, col: c.line, tint: c.tint }
      })
      r = 1.25
    } else if (n.shape === 'agent') {      // a reviewer: a body, a head lit in its own colour, a ring that turns about it
      add(new T.CylinderGeometry(0.15, 0.3, 0.72, 20), 0, 0.38, 0)
      o.orbMat = keep(new T.MeshStandardMaterial({ color: shade(tn.line, 0.6), emissive: tn.line, emissiveIntensity: 0.2, roughness: 0.4, transparent: true }))      // lit, it keeps its colour: it does not wash to white
      o.orb = new T.Mesh(keep(new T.SphereGeometry(0.24, 24, 16)), o.orbMat); o.orb.position.y = 1.14; o.orb.userData.id = n.id; grp.add(o.orb); hit.push(o.orb)
      o.orbit = new T.Mesh(keep(new T.TorusGeometry(0.43, 0.02, 8, 48)), keep(new T.MeshBasicMaterial({ color: tn.line, transparent: true, opacity: 0.6 }))); o.orbit.position.y = 1.14; grp.add(o.orbit)
      r = 0.5
    } else {                               // an outside service: a low hexagon, standing apart, turning slowly
      add(new T.CylinderGeometry(1.0, 1.0, 0.5, 6), 0, 0.25, 0); o.spin = true
    }
    o.ringMat = keep(new T.MeshBasicMaterial({ color: tn.line, transparent: true, opacity: 0.4, side: T.DoubleSide }))
    const ring = new T.Mesh(keep(new T.RingGeometry(r, r + 0.045, 64)), o.ringMat); ring.rotation.x = -Math.PI / 2; ring.position.set(n.p[0], 0.09, n.p[1]); scene.add(ring)
    if (!n.agent) {                        // a column of light over a piece the step uses
      o.beam = new T.Mesh(keep(new T.CylinderGeometry(r * 0.5, r * 0.62, 8, 28, 1, true)), keep(new T.MeshBasicMaterial({ map: rise, side: T.DoubleSide, ...lit(tn.line, 0) })))
      o.beam.position.set(n.p[0], 4.05, n.p[1]); o.beam.visible = false; scene.add(o.beam)
    }
    o.top = new T.Vector3(n.p[0], n.h + 0.35, n.p[1])
    nodes[n.id] = o
  })

  const edges = JOINS.map((e, i) => {
    const A = AT[e.a], B = AT[e.b]
    const p0 = new T.Vector3(A.p[0], A.cy, A.p[1]), p2 = new T.Vector3(B.p[0], B.cy, B.p[1])
    let curve
    if (e.flat) { p0.set(A.p[0] + 0.6, 0.5, A.p[1] + 0.55); p2.set(B.p[0] - 0.9, 0.5, A.p[1] + 0.55); curve = new T.LineCurve3(p0, p2) }
    else { const mid = p0.clone().add(p2).multiplyScalar(0.5); mid.y = Math.max(p0.y, p2.y) + (e.lift || 0.8 + 0.07 * p0.distanceTo(p2)); curve = new T.QuadraticBezierCurve3(p0, mid, p2) }
    const col = e.a === 'chain' || e.b === 'chain' ? 0xf1d488 : e.flat ? 0xf6f1e4 : tone(A).line     // a line in use takes the colour of the piece that asks
    const mat = keep(new T.MeshBasicMaterial({ color: 0x5f7165, transparent: true, opacity: 0.45, depthWrite: false }))
    scene.add(new T.Mesh(keep(new T.TubeGeometry(curve, 56, 0.03, 6, false)), mat))
    const aura = keep(new T.MeshBasicMaterial(lit(col, 0))); scene.add(new T.Mesh(keep(new T.TubeGeometry(curve, 56, 0.13, 8, false)), aura))
    const beads = [0, 1, 2, 3, 4, 5, 6].map(() => { const s = new T.Sprite(keep(new T.SpriteMaterial({ map: glow, ...lit(col, 1) }))); s.visible = false; scene.add(s); return s })
    return { id: e.id, flat: !!e.flat, col, curve, mat, aura, beads, phase: (i * 0.37) % 1, on: false, dim: false, half: curve.getPoint(e.at ?? 0.5) }
  })
  const gateEdge = edges.find(e => e.flat), chainEdge = edges.find(e => e.id === 'api_chain')

  // where the eye goes: to the pieces of the step being told, and back to the whole when no step is
  const goalT = new T.Vector3(HOME[0], 0, HOME[1]), tgt = goalT.clone()
  let cur = null, spanX = 0, spanZ = 0, curD = reduce ? HOME_DIST : HOME_DIST * 2.1, zoom = 1, yaw = -0.16, pitch = HOME_PITCH, goalP = HOME_PITCH, turned = false
  function set(s, pickedNow) {
    if (s !== cur) stepAt = null                                          // a step's own clock starts when the step does
    cur = s; widths.clear()
    for (const id of Object.keys(nodes)) {
      const o = nodes[id], on = !!s && s.pieces.includes(id)
      o.on = on; o.passed = !!s && !!s.passed && o.n.gate != null; o.dim = !!s && !on && !o.passed
      o.body.color.setHex(on ? o.tn.lit : o.tn.body); o.body.opacity = o.dim ? 0.22 : 0.96
      o.body.emissive.setHex(on ? o.tn.body : 0x000000)
      o.line.color.setHex(id === pickedNow ? 0xffffff : o.tn.line); o.line.opacity = o.dim ? 0.28 : 1
      o.ringMat.opacity = o.dim ? 0.1 : 0.4
    }
    for (const e of edges) {
      e.on = !!s && s.joins.includes(e.id); e.dim = !!s && !e.on
      e.mat.color.setHex(e.on ? e.col : 0x5f7165); e.mat.opacity = e.on ? 1 : e.dim ? 0.07 : 0.45
      e.aura.opacity = e.on ? 0.2 : 0
    }
    for (const sl of slabs) sl.edgeMat.color.setHex(s && s.pieces.some(id => inHost(AT[id], sl.h)) ? 0xbfe9dc : 0x5f8f80)
    if (!s) { goalT.set(HOME[0], 0, HOME[1]); goalP = HOME_PITCH; return }
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9
    for (const id of s.pieces) { const p = AT[id].p; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]) }
    goalT.set((x0 + x1) / 2, 0, (z0 + z1) / 2 - 0.6)
    spanX = x1 - x0; spanZ = z1 - z0; goalP = 0.6
  }

  // turning: a drag across turns the scene; with a mouse, a drag up and down raises the eye. A press without a drag picks.
  let down = null, raf = 0, W = 1, H = 1
  const ray = new T.Raycaster(), v = new T.Vector3()
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false }; canvas.classList.add('drag'); try { canvas.setPointerCapture(e.pointerId) } catch { /* not capturable: the drag still works */ } }
  const onMove = (e) => {
    if (!down) return
    const dx = e.clientX - down.x, dy = e.clientY - down.y
    if (Math.abs(dx) + Math.abs(dy) > 4) { down.moved = true; turned = true }
    yaw = down.yaw - dx * 0.006
    if (e.pointerType === 'mouse') pitch = Math.max(0.2, Math.min(1.38, down.pitch + dy * 0.005))
  }
  const onUp = (e) => {
    if (!down) return
    const was = down; down = null; canvas.classList.remove('drag')
    if (was.moved || e.type === 'pointercancel') return
    const box = canvas.getBoundingClientRect()
    ray.setFromCamera({ x: ((e.clientX - box.left) / box.width) * 2 - 1, y: -((e.clientY - box.top) / box.height) * 2 + 1 }, camera)
    const got = ray.intersectObjects(hit, false)[0]
    if (got) onPick(got.object.userData.id)
  }
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp)

  const widths = new Map()                                              // a name's width, measured once until the names change
  const size = () => {
    W = host.clientWidth || 1; H = host.clientHeight || 1; renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix()
    widths.clear()
    // eight reviewers stand in one row: their names are set at two heights, and at four where the stage is narrow
    for (const id of Object.keys(nodes)) { const n = nodes[id].n; if (n.gate != null) nodes[id].top.y = (W < 560 ? 1.6 + (n.gate % 4) * 0.5 : n.h) + 0.35 }
  }
  const ro = new ResizeObserver(size); ro.observe(host); size()
  const place = (el, vec, lift, ax = '-50%') => {
    if (!el || el.hidden) return
    v.copy(vec).project(camera)
    let x = (v.x * 0.5 + 0.5) * W
    if (ax === '-50%' && x >= 0 && x <= W) {                            // a name over a piece that is in view stays inside the stage
      let w = widths.get(el); if (w == null) { w = el.offsetWidth; widths.set(el, w) }
      if (w < W - 8) x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x))
    }
    el.style.transform = `translate(${x.toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * H).toFixed(1)}px) translate(${ax}, ${lift})`
    el.style.zIndex = String(Math.round((1 - v.z) * 5000))
  }
  const ease = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3)
  const ciTop = nodes.ci.top.clone().add(new T.Vector3(0, 0.9, 0))
  let checkShown = -2, t0 = null, stepAt = null
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => widths.clear()).catch(() => {})      // a name measured before its face loaded is measured again
  const frame = (ms) => {
    raf = requestAnimationFrame(frame)
    if (document.hidden) return                                         // a tab nobody is looking at draws nothing
    if (t0 == null) t0 = ms
    const t = reduce ? 0 : (ms - t0) / 1000
    // how far the eye stands: for the whole map, further back on a narrow stage so every piece stays in view; for a
    // step, as near as keeps its pieces inside the stage's width and its depth inside the height
    const want = (cur ? Math.max(16, Math.min(60, Math.max((spanX / 2 + 2.4) / (TAN * camera.aspect), spanZ * 1.2 + 14))) : HOME_DIST * Math.max(1, 1.75 / camera.aspect)) * zoom
    if (reduce) { tgt.copy(goalT); curD = want; if (!turned) pitch = goalP }
    else { tgt.lerp(goalT, 0.04); curD += (want - curD) * 0.04; if (!turned) pitch += (goalP - pitch) * 0.03 }
    scene.fog.near = curD * 1.05; scene.fog.far = curD * 2.7            // the haze stands back with the eye
    const sweep = reduce ? 0 : (1 - ease(t / 3.2)) * -1.25 + (down ? 0 : Math.sin(t * 0.11) * 0.1)     // the scene turns in as the page opens, then sways
    camera.position.set(tgt.x + curD * Math.sin(yaw + sweep) * Math.cos(pitch), curD * Math.sin(pitch), tgt.z + curD * Math.cos(yaw + sweep) * Math.cos(pitch))
    camera.lookAt(tgt)
    dust[0].rotation.y = t * 0.012; dust[1].rotation.y = -t * 0.008; dust[1].position.y = Math.sin(t * 0.2) * 0.4

    // the change, travelling past the gates; the six checks, lit one after the other
    if (stepAt == null) stepAt = t
    const ts = t - stepAt                                               // since this step began: a change sets out from the branch, the first check is the first lit
    const run = cur && cur.gates ? (reduce ? 1 : Math.min(1, (ts * 0.19) % 1.25)) : null
    const packetX = run != null ? gateEdge.curve.getPoint(run).x : null
    const seq = cur && cur.checks ? (reduce ? 6 : Math.floor((ts * 1.25) % 8)) : null
    const lampsLit = !cur ? -1 : seq != null ? Math.min(6, seq) : cur.checked ? 6 : 0

    for (const id of Object.keys(nodes)) {
      const o = nodes[id], pulse = 0.5 + 0.5 * Math.sin(t * 2.6 + o.seed)
      if (o.n.agent) {
        const done = !!cur && (o.n.gate != null && packetX != null ? o.n.p[0] <= packetX + 0.1 : o.passed || (o.on && !cur.gates))
        o.orbMat.emissiveIntensity = done ? 0.5 + 0.12 * pulse : o.dim ? 0.05 : 0.2; o.orbMat.opacity = o.dim ? 0.3 : 1
        o.orbit.material.opacity = done ? 1 : o.dim ? 0.12 : 0.6
        o.orb.position.y = 1.14 + Math.sin(t * 1.7 + o.seed) * 0.06
        o.orbit.rotation.x = 1.15 + Math.sin(t * 0.7 + o.seed) * 0.35; o.orbit.rotation.y = t * (done ? 2.6 : 0.8) + o.seed
        const el = els.pieces[id]; if (el) el.classList.toggle('pass', done)
        continue
      }
      o.beam.visible = o.on; o.beam.material.opacity = o.on ? 0.2 + 0.12 * pulse : 0
      if (o.spin) o.grp.rotation.y = t * 0.25 + o.seed
      if (o.sched) o.sched.rotation.y = t * 0.6
      if (id === 'api') o.body.emissiveIntensity = o.on ? 0.45 + 0.35 * pulse : 0.35
      if (o.discs) o.discs.forEach((d, i) => { d.position.y = [0.21, 0.74, 1.27][i] + (o.on ? Math.sin(t * 2.2 + i * 0.9) * 0.05 : 0) })
      if (o.lamps) {
        o.lamps.forEach((l, i) => {
          const onL = lampsLit >= 0 && i < lampsLit, soft = lampsLit < 0
          l.m.emissiveIntensity = onL ? 0.55 : soft ? 0.16 : 0.03; l.m.color.setHex(shade(l.col, onL ? l.tint : soft ? 0.4 : 0.2))
          l.em.opacity = o.dim && !onL ? 0.3 : 1
        })
        const now = seq != null && lampsLit > 0 ? Math.min(5, lampsLit - 1) : -1
        if (now !== checkShown && els.check) {
          checkShown = now; els.check.hidden = now < 0
          if (now >= 0) { els.check.textContent = '✓ ' + CHECKS[now].name + (lampsLit === 6 ? ' · all six' : ''); els.check.style.setProperty('--c', CHECKS[now].css) }
          widths.delete(els.check)                                      // its words changed, and so did its width
        }
      }
      if (o.drop) {                                                     // a block coming down onto the chain while a hash is anchored
        const live = chainEdge.on && !reduce, ph = (t * 0.3) % 1
        o.drop.visible = live
        if (live) { o.drop.position.set(0.1, 1.84 + (1 - ease(ph * 1.7)) * 3.4, 0); o.drop.material.opacity = Math.min(1, ph * 4) * (ph > 0.86 ? (1 - ph) / 0.14 : 1) }
      }
    }
    for (const e of edges) {
      const live = e.on || !cur
      e.beads.forEach((s, i) => {
        s.visible = live && !reduce && (e.on || i < 3)
        if (!s.visible) return
        let u, sz
        if (e.flat && run != null) { u = run - i * 0.012; sz = 0.85 * (1 - i / 9) }
        else if (e.on) { u = (t * 0.2 + e.phase + i / 7) % 1; sz = 0.5 }           // a steady stream along a line in use
        else { u = (t * 0.07 + e.phase + i / 3) % 1; sz = 0.26 }
        if (u < 0) { s.visible = false; return }
        s.position.copy(e.curve.getPoint(Math.min(1, u))); s.scale.set(sz, sz, sz)
        s.material.opacity = e.on ? (e.flat && run != null ? 1 - i * 0.11 : 0.95) : 0.4
      })
    }
    renderer.render(scene, camera)
    for (const h of HOSTS) place(els.hosts[h.id], hostAt[h.id], h.side ? '-50%' : '0', h.side ? '-100%' : '0')
    for (const id of Object.keys(nodes)) place(els.pieces[id], nodes[id].top, '-100%')
    for (const e of edges) if (e.on) place(els.tags[e.id], e.half, '-50%')
    place(els.check, ciTop, '-100%')
    canvas.dataset.ready = 'true'
  }
  raf = requestAnimationFrame(frame)
  return {
    set,
    zoom(by) { zoom = Math.max(0.45, Math.min(2.0, zoom * by)) },
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp)
      for (const x of trash) x.dispose()
      renderer.dispose()
    },
  }
}

export default function Architecture() {
  const [story, setStory] = useState(0)                  // which of STORIES is being followed
  const [step, setStep] = useState(-1)                   // -1: the whole map
  const [picked, setPicked] = useState(null)
  const [touring, setTouring] = useState(false)
  const [scene, setScene] = useState('loading')          // loading | on | off (the browser cannot draw it)
  const [health, setHealth] = useState(undefined)        // undefined: asked; null: no answer
  const canvas = useRef(null), host = useRef(null), stage = useRef(null)
  const els = useRef({ pieces: {}, hosts: {}, tags: {}, check: null })
  const st = STORIES[story], s = step >= 0 ? st.steps[step] : null

  useEffect(() => {
    let dead = false
    loadThree().then((T) => {
      if (dead || !canvas.current) return
      try {
        stage.current = makeStage(T, canvas.current, host.current, els.current, (id) => setPicked(p => (p === id ? null : id)))
        setScene('on')                                   // the effect below then gives it the step and the piece as they stand
      } catch { setScene('off') }
    }).catch(() => { if (!dead) setScene('off') })
    return () => { dead = true; if (stage.current) { stage.current.destroy(); stage.current = null } }
  }, [])
  useEffect(() => { if (stage.current) stage.current.set(s, picked) }, [s, picked, scene])

  // the walk through a story: one step every few seconds, to the last, then it rests there
  const last = st.steps.length - 1
  useEffect(() => {
    if (!touring) return
    const id = setInterval(() => setStep(x => Math.min(x + 1, last)), TOUR_MS)
    return () => clearInterval(id)
  }, [touring, last])
  const atLast = touring && step >= last
  useEffect(() => {
    if (!atLast) return
    const id = setTimeout(() => setTouring(false), TOUR_MS)            // the last step is read like the others, then the walk rests
    return () => clearTimeout(id)
  }, [atLast])

  // the API's own account of itself: public, no sign-in, asked once when the page opens
  useEffect(() => {
    let dead = false
    fetch(`${API}/api/ops/health`).then(r => (r.ok ? r.json() : null)).then(j => { if (!dead) setHealth(j) }).catch(() => { if (!dead) setHealth(null) })
    return () => { dead = true }
  }, [])

  const piece = PIECES.find(n => n.id === picked) || null
  const go = (i) => { setTouring(false); setStep(i) }
  const follow = (i) => { setTouring(false); setStory(i); setStep(0) }
  const cells = healthCells(health)

  return (
    <div className="mr-arch" data-testid="mr-architecture">
      <div className="mr-eyebrow"><span className="mr-lbl">THE SYSTEM</span></div>
      <h1 className="mr-title">How the system is built</h1>
      <p className="mr-module">The app a trader uses, the API behind it, and the host each piece runs on. Follow a trade, a change to the code or the clock through it, or press a piece to read what it does.</p>

      <div className="mr-steps mr-stories" role="group" aria-label="What to follow">
        {STORIES.map((x, i) => <button key={x.id} type="button" className="mr-step" data-testid={`mr-story-${x.id}`} aria-pressed={i === story} onClick={() => follow(i)}>{x.name}</button>)}
        <span className="mr-lede">{st.lede}</span>
      </div>
      <div className="mr-steps" role="group" aria-label={st.name}>
        <button type="button" className="mr-step go" data-testid="mr-tour" onClick={() => { if (touring) { setTouring(false) } else { setStep(0); setTouring(true) } }}>{touring ? '■ STOP' : `▶ ${st.follow}`}</button>
        {st.steps.map((x, i) => <button key={x.k} type="button" className="mr-step" data-testid={`mr-step-${x.k}`} aria-pressed={i === step} onClick={() => go(i)}><span className="k">{i + 1}</span>{x.name}</button>)}
        <button type="button" className="mr-step" data-testid="mr-step-all" aria-pressed={step === -1} onClick={() => go(-1)}>THE WHOLE MAP</button>
      </div>

      <div className="mr-stage" ref={host} data-testid="mr-stage" data-scene={scene} data-step={s ? s.k : 'all'}>
        <canvas ref={canvas} aria-label="The pieces of the system in space, the hosts they run on, and what joins them" />
        <div className="mr-labels">
          {scene === 'on' && HOSTS.map(h => <span key={h.id} ref={el => { els.current.hosts[h.id] = el }} className="mr-h3">{h.name}</span>)}
          {PIECES.map(n => {
            const on = !!s && s.pieces.includes(n.id), dim = !!s && !on && !(s.passed && n.gate != null)
            return (
              <button key={n.id} type="button" ref={el => { els.current.pieces[n.id] = el }} data-testid={`mr-piece-${n.id}`} aria-pressed={picked === n.id}
                aria-label={n.agent || n.plain ? `${n.name}: ${n.sub}` : undefined}
                className={'mr-l3' + (n.agent ? ' ag' : '') + (n.plain ? ' pl' : '') + (n.big ? ' hero' : '') + (ANCHORS.includes(n.id) ? ' anc' : '') + (on ? ' on' : '') + (dim ? ' dim' : '') + (picked === n.id ? ' sel' : '') + (scene === 'on' ? '' : ' flow')}
                style={{ '--c': n.css || KINDS[n.kind].css }} onClick={() => setPicked(p => (p === n.id ? null : n.id))}>
                <span className="nm">{n.name}</span>{!n.agent && !n.plain && <span className="sb">{n.sub}</span>}
              </button>
            )
          })}
          {scene === 'on' && JOINS.map(e => (
            <span key={e.id} ref={el => { els.current.tags[e.id] = el }} className={'mr-e3' + (e.a === 'chain' || e.b === 'chain' ? ' gold' : '')} hidden={!(s && s.joins.includes(e.id) && e.says)}>{e.says}</span>
          ))}
          {scene === 'on' && <span ref={el => { els.current.check = el }} className="mr-e3 mr-ck" data-testid="mr-check" hidden />}
        </div>
        {scene === 'on' && (
          <div className="mr-zoom" role="group" aria-label="How close the scene is">
            <button type="button" className="mr-step" data-testid="mr-zoom-in" aria-label="Closer" onClick={() => stage.current && stage.current.zoom(0.8)}>+</button>
            <button type="button" className="mr-step" data-testid="mr-zoom-out" aria-label="Further" onClick={() => stage.current && stage.current.zoom(1.25)}>−</button>
          </div>
        )}
        {scene === 'on' && <span className="mr-hint">Drag to turn it. Press a piece to read what it does.</span>}
        {scene === 'off' && <span className="mr-hint" data-testid="mr-no-scene">This browser cannot draw the scene. The pieces are listed above and the steps still say what happens at each.</span>}
      </div>
      <div className="mr-key" aria-label="What each colour is">
        {Object.values(KINDS).map(k => <span key={k.name}><i style={{ background: k.css }} />{k.name}</span>)}
        <span className="more">EACH REVIEWER HAS A COLOUR OF ITS OWN</span>
      </div>

      <div className="mr-side">
        <div className="mr-card" data-testid="mr-say" aria-live="polite">
          {s ? (<>
            <h3>{step + 1} · {s.name}</h3><p>{s.say}</p>
            {s.routes && <p className="routes">{s.routes.map(r => <code key={r}>{r}</code>)}</p>}
          </>) : (<>
            <h3>THE WHOLE MAP</h3>
            <p>Every piece and every join. The app runs in the trader's browser; it and the public site are static files. Trades, their legs and their events are written by the API alone, and so is everything on the chain. A firm's own reference data (its hierarchy, legal entities and counterparties) the app writes straight to the database, under row-level security.</p>
          </>)}
        </div>
        <div className="mr-card" data-testid="mr-piece">
          {piece ? (<><h3>{piece.name}{piece.agent ? ` · ${piece.sub.toUpperCase()}` : ''}</h3><p>{piece.note}</p></>) : (<><h3>A PIECE</h3><p className="quiet">Press a piece in the scene to read what it does.</p></>)}
        </div>
      </div>

      <div className="mr-live" data-testid="mr-health" data-state={health === undefined ? 'asking' : cells.length ? 'answered' : 'silent'}>
        {cells.map(c => <div key={c.label}><div className="mr-lbl">{c.label}</div><div className={'v' + (c.state ? ' ' + c.state : '')}>{c.value}</div></div>)}
        {health !== undefined && !cells.length && <div className="none">The API did not answer on <code>GET /api/ops/health</code> just now. Nothing is shown in its place.</div>}
      </div>
      <p className="mr-fine">The API's own answer on <code>GET /api/ops/health</code>, read when this page opened. A green mark means the batch ran within its rule, not that every source behind it answered; an amber one means it is late.</p>
      <div className="mr-prose">
        <h3>What runs where, plainly</h3>
        <p>There is one API process. Monte Carlo and full-revaluation VaR run inside the request and are rate-limited per account; a larger book moves them to a worker without changing the engines.</p>
        <p>The hosted demo prices on public-source market data rebuilt daily and, for digital assets, on a venue's option marks refreshed every ten minutes. Rates and G10 FX vol surfaces are synthetic, scaled by realised vol, and labelled as such. A self-hosted desk loads its own data and switches the feeds off.</p>
        <p>A release reaches production only after the checks pass on the commit that ships, and the app is built from a commit the live API is already on, or one that leaves the API as it is.</p>
      </div>
    </div>
  )
}
