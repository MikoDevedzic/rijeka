// How the system is built: the pieces as solids in space, light travelling along the joins the way a request goes,
// and a trade followed through them step by step. The facts are architecture-data.js (which restates
// docs/architecture.md); this file only draws them.
//
// The scene is a canvas (three.js, loaded when this page is first opened, as the app's other scenes are). The
// names are ordinary buttons set over it, placed each frame at the point of the piece they name, so they stay
// sharp, can be pressed and are read by a screen reader. Where a browser cannot draw the scene the page says so
// and the steps and the pieces are still there to read.
import { useEffect, useRef, useState } from 'react'
import { API } from '../../../lib/api'
import { loadThree, legacyRenderer, LEGACY_LIGHT } from '../../../lib/three'
import { KINDS, PIECES, JOINS, STEPS, healthCells } from './architecture-data'

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Builds the scene on `canvas`, with `labels` (id → element) placed over it. Returns { set(step, picked), destroy() }.
function makeStage(T, canvas, host, labels, tags, onPick) {
  const reduce = reducedMotion()
  const renderer = legacyRenderer(T, { canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  const scene = new T.Scene()
  scene.fog = new T.Fog(0x081714, 26, 60)
  const camera = new T.PerspectiveCamera(36, 2, 0.1, 140)
  const world = new T.Group(); scene.add(world)
  scene.add(new T.AmbientLight(0xe9e3d3, 0.8 * LEGACY_LIGHT))
  const sun = new T.DirectionalLight(0xffffff, 0.95 * LEGACY_LIGHT); sun.position.set(-7, 13, 9); scene.add(sun)
  const rim = new T.DirectionalLight(0x8fc1e6, 0.3 * LEGACY_LIGHT); rim.position.set(9, 5, -8); scene.add(rim)
  const grid = new T.GridHelper(72, 72, 0x2c4a41, 0x17332d); grid.position.y = -0.01; world.add(grid)

  // a soft dot of light, for what travels along a join
  const dot = document.createElement('canvas'); dot.width = dot.height = 64
  const g2 = dot.getContext('2d'), grad = g2.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)')
  g2.fillStyle = grad; g2.fillRect(0, 0, 64, 64)
  const glow = new T.CanvasTexture(dot)

  const hit = [], nodes = {}, trash = [glow]
  const keep = (x) => { trash.push(x); return x }
  for (const n of PIECES) {
    const kd = KINDS[n.kind], grp = new T.Group(); grp.position.set(n.p[0], 0, n.p[1]); world.add(grp)
    const body = keep(new T.MeshStandardMaterial({ color: kd.body, roughness: 0.7, metalness: 0.05, transparent: true, opacity: 0.96, emissiveIntensity: 0.3 }))
    const line = keep(new T.LineBasicMaterial({ color: kd.line, transparent: true }))
    const add = (geo, x, y, z, rx) => {
      keep(geo)
      const m = new T.Mesh(geo, body); m.position.set(x, y, z); if (rx) m.rotation.x = rx; m.userData.id = n.id; grp.add(m); hit.push(m)
      const e = new T.LineSegments(keep(new T.EdgesGeometry(geo, 30)), line); e.position.copy(m.position); e.rotation.copy(m.rotation); grp.add(e)
    }
    let r = 1.45
    if (n.shape === 'screen') {            // a screen on its stand: what a person looks at
      const k = n.small ? 0.8 : 1
      add(new T.BoxGeometry(3.0 * k, 1.8 * k, 0.14), 0, 1.3 * k, 0, -0.2); add(new T.BoxGeometry(0.16, 0.5 * k, 0.16), 0, 0.3 * k, 0.06); add(new T.BoxGeometry(1.3 * k, 0.1, 0.9 * k), 0, 0.05, 0.1)
      r = 2.0 * k
    } else if (n.shape === 'core') {       // the one process, with the scheduler riding on it
      add(new T.BoxGeometry(3.4, 1.9, 2.6), 0, 0.95, 0); add(new T.BoxGeometry(1.3, 0.5, 1.0), 0.85, 2.15, -0.55)
      r = 2.7
    } else if (n.shape === 'db') {         // three discs: a database
      for (const y of [0.21, 0.74, 1.27]) add(new T.CylinderGeometry(1.05, 1.05, 0.42, 48), 0, y, 0)
      r = 1.55
    } else if (n.shape === 'blocks') {     // a stack of blocks: the chain, with a light of its own
      [0.16, 0.58, 1.0, 1.42].forEach((y, i) => add(new T.BoxGeometry(2.3, 0.32, 1.5), i % 2 ? 0.1 : -0.1, y, 0))
      const lamp = new T.PointLight(0xd9b25c, 1.1 * LEGACY_LIGHT, 8, 1); lamp.position.set(0, 2.2, 0.6); grp.add(lamp)
      r = 1.85
    } else if (n.shape === 'token') {      // a token
      add(new T.CylinderGeometry(0.85, 0.85, 0.34, 40), 0, 0.4, 0); r = 1.3
    } else {                               // an outside service: a low hexagon, standing apart
      add(new T.CylinderGeometry(1.0, 1.0, 0.5, 6), 0, 0.25, 0)
    }
    const ringMat = keep(new T.MeshBasicMaterial({ color: kd.line, transparent: true, opacity: 0.55, side: T.DoubleSide }))
    const ring = new T.Mesh(keep(new T.RingGeometry(r, r + 0.045, 72)), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; grp.add(ring)
    nodes[n.id] = { n, kd, body, line, ringMat, top: new T.Vector3(n.p[0], n.h + 0.3, n.p[1]) }
  }
  const at = Object.fromEntries(PIECES.map(n => [n.id, n]))
  const edges = JOINS.map((e, i) => {
    const A = at[e.a], B = at[e.b]
    const p0 = new T.Vector3(A.p[0], A.cy, A.p[1]), p2 = new T.Vector3(B.p[0], B.cy, B.p[1])
    const mid = p0.clone().add(p2).multiplyScalar(0.5); mid.y = Math.max(p0.y, p2.y) + (e.lift || 0.8 + 0.07 * p0.distanceTo(p2))
    const curve = new T.QuadraticBezierCurve3(p0, mid, p2)
    const mat = keep(new T.MeshBasicMaterial({ color: 0x5f7165, transparent: true, opacity: 0.5, depthWrite: false }))
    world.add(new T.Mesh(keep(new T.TubeGeometry(curve, 48, 0.028, 6, false)), mat))
    const beads = [0, 1].map(() => { const s = new T.Sprite(keep(new T.SpriteMaterial({ map: glow, color: 0xf6f1e4, transparent: true, depthWrite: false, blending: T.AdditiveBlending }))); world.add(s); return s })
    return { id: e.id, gold: e.a === 'chain' || e.b === 'chain', curve, mat, beads, phase: (i * 0.37) % 1, on: false, dim: false, half: curve.getPoint(0.5) }
  })

  function set(stepNow, pickedNow) {
    const s = stepNow >= 0 ? STEPS[stepNow] : null
    for (const id of Object.keys(nodes)) {
      const o = nodes[id], on = !!s && s.pieces.includes(id), dim = !!s && !on
      o.body.color.setHex(on ? o.kd.lit : o.kd.body); o.body.opacity = dim ? 0.26 : 0.96
      o.body.emissive.setHex(on ? o.kd.body : 0x000000)
      o.line.color.setHex(id === pickedNow ? 0xffffff : o.kd.line); o.line.opacity = dim ? 0.32 : 1
      o.ringMat.opacity = dim ? 0.14 : on ? 1 : 0.55
    }
    for (const e of edges) {
      e.on = !!s && s.joins.includes(e.id); e.dim = !!s && !e.on
      e.mat.color.setHex(e.on ? (e.gold ? 0xd9b25c : 0xf6f1e4) : 0x5f7165); e.mat.opacity = e.on ? 1 : e.dim ? 0.1 : 0.5
    }
  }

  // turning: a drag across turns the scene; with a mouse, a drag up and down raises the eye. A press without a drag picks.
  let yaw = -0.1, eye = 16, down = null, raf = 0, W = 1, H = 1
  const ray = new T.Raycaster(), v = new T.Vector3()
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY, yaw, eye, moved: false }; canvas.classList.add('drag'); try { canvas.setPointerCapture(e.pointerId) } catch { /* not capturable: the drag still works over the canvas */ } }
  const onMove = (e) => {
    if (!down) return
    const dx = e.clientX - down.x, dy = e.clientY - down.y
    if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true
    yaw = Math.max(-1.15, Math.min(1.15, down.yaw + dx * 0.006))
    if (e.pointerType === 'mouse') eye = Math.max(8, Math.min(24, down.eye + dy * 0.04))
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

  const size = () => { W = host.clientWidth || 1; H = host.clientHeight || 1; renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix() }
  const ro = new ResizeObserver(size); ro.observe(host); size()
  const place = (el, vec, lift) => {
    if (!el) return
    v.copy(vec).applyMatrix4(world.matrixWorld).project(camera)
    el.style.transform = `translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%, ${lift})`
    el.style.zIndex = String(Math.round((1 - v.z) * 5000))
  }
  const frame = (ms) => {
    raf = requestAnimationFrame(frame)
    const t = reduce ? 0 : ms / 1000
    const k = Math.max(1, 1.9 / camera.aspect)                        // a narrow stage stands further back, so every piece stays in view
    scene.fog.near = 26 * k; scene.fog.far = 60 * k                     // and the haze stands back with it
    world.rotation.y = yaw + (reduce || down ? 0 : Math.sin(t * 0.22) * 0.1)
    camera.position.set(0.6, eye * k, 1.2 + 17 * k); camera.lookAt(0.6, 0.2, 1.3)
    world.updateMatrixWorld(true)
    for (const e of edges) e.beads.forEach((b, i) => {
      b.visible = !e.dim
      b.position.copy(e.curve.getPoint(reduce ? 0.5 : (t * (e.on ? 0.36 : 0.13) + e.phase + i * 0.5) % 1))
      b.scale.setScalar(e.on ? 0.62 : 0.26); b.material.color.setHex(e.on && e.gold ? 0xf1d488 : 0xf6f1e4); b.material.opacity = e.on ? 1 : 0.55
    })
    renderer.render(scene, camera)
    for (const id of Object.keys(nodes)) place(labels[id], nodes[id].top, '-100%')
    for (const e of edges) if (e.on) place(tags[e.id], e.half, '-50%')
    canvas.dataset.ready = 'true'
  }
  raf = requestAnimationFrame(frame)
  return {
    set,
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
  const [step, setStep] = useState(-1)                   // -1: the whole map
  const [picked, setPicked] = useState(null)
  const [touring, setTouring] = useState(false)
  const [scene, setScene] = useState('loading')          // loading | on | off (the browser cannot draw it)
  const [health, setHealth] = useState(undefined)        // undefined: asked; null: no answer
  const canvas = useRef(null), host = useRef(null), stage = useRef(null)
  const labels = useRef({}), tags = useRef({})

  useEffect(() => {
    let dead = false
    loadThree().then((T) => {
      if (dead || !canvas.current) return
      try {
        stage.current = makeStage(T, canvas.current, host.current, labels.current, tags.current, (id) => setPicked(p => (p === id ? null : id)))
        setScene('on')                                   // the effect below then gives it the step and the piece as they stand
      } catch { setScene('off') }
    }).catch(() => { if (!dead) setScene('off') })
    return () => { dead = true; if (stage.current) { stage.current.destroy(); stage.current = null } }
  }, [])
  useEffect(() => { if (stage.current) stage.current.set(step, picked) }, [step, picked, scene])

  // the walk through a trade: one step every few seconds, to the last, then it rests there
  useEffect(() => {
    if (!touring) return
    const id = setInterval(() => setStep(s => { if (s >= STEPS.length - 1) { setTouring(false); return s } return s + 1 }), 4200)
    return () => clearInterval(id)
  }, [touring])

  // the API's own account of itself: public, no sign-in, asked once when the page opens
  useEffect(() => {
    let dead = false
    fetch(`${API}/api/ops/health`).then(r => (r.ok ? r.json() : null)).then(j => { if (!dead) setHealth(j) }).catch(() => { if (!dead) setHealth(null) })
    return () => { dead = true }
  }, [])

  const s = step >= 0 ? STEPS[step] : null
  const piece = PIECES.find(n => n.id === picked) || null
  const go = (i) => { setTouring(false); setStep(i) }
  const cells = healthCells(health)

  return (
    <div className="mr-arch" data-testid="mr-architecture">
      <div className="mr-eyebrow"><span className="mr-lbl">THE SYSTEM</span></div>
      <h1 className="mr-title">How the system is built</h1>
      <p className="mr-module">One repository, three hosted pieces, one chain. Follow a trade through it, or press a piece to read what it does.</p>

      <div className="mr-steps" role="group" aria-label="The life of a trade">
        <button type="button" className="mr-step go" data-testid="mr-tour" onClick={() => { if (touring) { setTouring(false) } else { setStep(0); setTouring(true) } }}>{touring ? '■ STOP' : '▶ FOLLOW A TRADE'}</button>
        {STEPS.map((x, i) => <button key={x.k} type="button" className="mr-step" data-testid={`mr-step-${x.k}`} aria-pressed={i === step} onClick={() => go(i)}><span className="k">{x.k}</span>{x.name}</button>)}
        <button type="button" className="mr-step" data-testid="mr-step-all" aria-pressed={step === -1} onClick={() => go(-1)}>THE WHOLE MAP</button>
      </div>

      <div className="mr-stage" ref={host} data-testid="mr-stage" data-scene={scene}>
        <canvas ref={canvas} aria-label="The pieces of the system in space, and what joins them" />
        <div className="mr-labels">
          {PIECES.map(n => {
            const on = !!s && s.pieces.includes(n.id), dim = !!s && !on
            return (
              <button key={n.id} type="button" ref={el => { labels.current[n.id] = el }} data-testid={`mr-piece-${n.id}`} aria-pressed={picked === n.id}
                className={'mr-l3' + (on ? ' on' : '') + (dim ? ' dim' : '') + (picked === n.id ? ' sel' : '') + (scene === 'on' ? '' : ' flow')}
                style={{ '--c': KINDS[n.kind].css }} onClick={() => setPicked(p => (p === n.id ? null : n.id))}>
                <span className="nm">{n.name}</span><span className="sb">{n.sub}</span>
              </button>
            )
          })}
          {scene === 'on' && JOINS.map(e => (
            <span key={e.id} ref={el => { tags.current[e.id] = el }} className={'mr-e3' + (e.a === 'chain' || e.b === 'chain' ? ' gold' : '')} hidden={!(s && s.joins.includes(e.id) && e.says)}>{e.says}</span>
          ))}
        </div>
        {scene === 'on' && <span className="mr-hint">Drag to turn it. Press a piece to read what it does.</span>}
        {scene === 'off' && <span className="mr-hint" data-testid="mr-no-scene">This browser cannot draw the scene. The pieces are listed above and the steps still say what happens at each.</span>}
      </div>
      <div className="mr-key" aria-label="What each colour is">
        {Object.values(KINDS).map(k => <span key={k.name}><i style={{ background: k.css }} />{k.name}</span>)}
      </div>

      <div className="mr-side">
        <div className="mr-card" data-testid="mr-say" aria-live="polite">
          {s ? (<>
            <h3>{s.k} · {s.name}</h3><p>{s.say}</p>
            {s.routes && <p className="routes">{s.routes.map(r => <code key={r}>{r}</code>)}</p>}
          </>) : (<>
            <h3>THE WHOLE MAP</h3>
            <p>Every piece and every join. The app and the public site are static pages. The API is the only piece that writes to the database or to the chain.</p>
          </>)}
        </div>
        <div className="mr-card" data-testid="mr-piece">
          {piece ? (<><h3>{piece.name}</h3><p>{piece.note}</p></>) : (<><h3>A PIECE</h3><p className="quiet">Press a piece in the scene to read what it does.</p></>)}
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
        <p>A release reaches production only after the checks pass on the commit that ships, and the app is built from the commit the live API reports.</p>
      </div>
    </div>
  )
}
