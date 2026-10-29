// home/PolicyPath.jsx — what the curve says the overnight rate will be, month
// by month, for the currency chosen, with the Fed's SEP medians (the dot
// plot's year-end medians) overlaid for USD. Reads /api/public/policy-path,
// which is built from the public-source demo curves, so it says "indicative".
import { useEffect, useMemo, useRef, useState } from 'react'

const CCYS = ['USD', 'EUR', 'GBP', 'CHF', 'JPY']
const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

function useSize(ref) {
  const [s, setS] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setS({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(ref.current); return () => ro.disconnect()
  }, [ref])
  return s
}

const fmtMon = iso => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
const fmtD = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : ''
const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() - a.getDate()) / 30

export default function PolicyPath({ onCurves }) {
  const [ccy, setCcy] = useState('USD')
  const [data, setData] = useState({})          // ccy -> body; absent while loading
  useEffect(() => {
    if (data[ccy]) return
    let alive = true
    fetch(`${API}/api/public/policy-path?ccy=${ccy}`).then(r => r.json())
      .then(b => alive && setData(d => ({ ...d, [ccy]: b })))
      .catch(() => alive && setData(d => ({ ...d, [ccy]: { ccy, path: [], error: true } })))
    return () => { alive = false }
  }, [ccy])   // eslint-disable-line react-hooks/exhaustive-deps
  const d = data[ccy]
  const loading = !d
  const cum = d?.cumulative_bp || {}
  const c12 = cum['12M']
  return (
    <section className="dh-card dh-curve">
      <header>
        <span>POLICY PATH · {d?.bank ? d.bank.toUpperCase() : ccy} · MARKET-IMPLIED</span>
        <span className="dh-sub">
          {d?.fixing != null && <>{d.fixing_name} <b>{Number(d.fixing).toFixed(3)}%</b></>}
          {c12 != null && <> · 12M <b style={{ color: c12 > 0 ? 'var(--red)' : c12 < 0 ? 'var(--blue)' : 'var(--text)' }}>{c12 > 0 ? '+' : ''}{Math.round(c12)}bp</b> priced</>}
          <button className="dh-link" onClick={onCurves}>CURVES →</button>
        </span>
      </header>
      <div className="dh-ccys" role="tablist">
        {CCYS.map(c => <button key={c} role="tab" aria-selected={c === ccy} className={`dh-ccy${c === ccy ? ' on' : ''}`} onClick={() => setCcy(c)}>{c}</button>)}
      </div>
      <PathChart d={d} loading={loading && !d} />
      <Meetings d={d} />
      <div className="dh-caption">
        {d?.as_of ? <>From the public-source demo curve of {fmtD(d.as_of)} · indicative, not a forecast</> : 'Indicative, from public-source demo curves'}
        {d?.dots?.as_of && <> · Fed dots: SEP medians of {fmtD(d.dots.as_of)}</>}
      </div>
    </section>
  )
}

// What the curve prices for the next decisions: the forward overnight rate between
// consecutive meetings, the step against the window before, and the running total.
const fmtMeet = iso => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toUpperCase()
const bp = v => v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}`
const tone = v => v > 4 ? 'hike' : v < -4 ? 'cut' : ''
function Meetings({ d }) {
  const m = d?.meetings || []
  if (!m.length) return null
  return (
    <div className="pm" aria-label="Meeting-dated pricing">
      <div className="pm-h"><span>NEXT DECISIONS · BP PRICED</span><span>{d.bank?.toUpperCase()} · STEP 25BP</span></div>
      <div className="pm-row">
        {m.map(x => (
          <div key={x.date} className={`pm-cell ${tone(x.move_bp)}`} title={`${x.date}: ${x.implied_rate.toFixed(3)}% implied after the decision · ${x.steps > 0 ? '+' : ''}${x.steps} of a 25bp step · ${bp(x.cumulative_bp)}bp cumulative`}>
            <span className="pm-date">{fmtMeet(x.date)}</span>
            <b className="pm-bp">{bp(x.move_bp)}</b>
            <span className="pm-sub">{x.implied_rate.toFixed(2)}% · Σ {bp(x.cumulative_bp)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PathChart({ d, loading }) {
  const ref = useRef(null); const { w: W, h } = useSize(ref); const H = Math.max(262, Math.floor(h) || 0)
  const [hov, setHov] = useState(null)
  const model = useMemo(() => {
    if (!d?.path?.length) return null
    const t0 = new Date((d.as_of || d.path[0].date) + 'T00:00:00')
    const pts = d.path.map(p => ({ m: monthsBetween(t0, new Date(p.date + 'T00:00:00')), r: p.rate, date: p.date }))
    if (d.fixing != null) pts.unshift({ m: 0, r: d.fixing, date: d.as_of, fixing: true })
    const dots = (d.dots?.medians || []).filter(x => /^\d{4}$/.test(x.label))
      .map(x => ({ m: monthsBetween(t0, new Date(`${x.label}-12-31T00:00:00`)), r: x.rate, label: x.label }))
      .filter(x => x.m > 0)
    const lr = (d.dots?.medians || []).find(x => /longer/i.test(x.label))
    const maxM = Math.max(24, ...dots.map(x => x.m + 1))
    const rs = [...pts.map(p => p.r), ...dots.map(x => x.r), ...(lr ? [lr.rate] : [])]
    let lo = Math.min(...rs), hi = Math.max(...rs); const pad = Math.max(0.15, (hi - lo) * 0.2); lo -= pad; hi += pad
    return { pts, dots, lr, maxM, lo, hi }
  }, [d])
  if (!model) return <div ref={ref} className="dh-plot dh-plot-empty">{loading ? 'Loading path…' : d?.fixing != null ? `${d.fixing_name} ${Number(d.fixing).toFixed(3)}% · no term structure for ${d.ccy} yet` : 'No curve for this currency yet.'}</div>
  const { pts, dots, lr, maxM, lo, hi } = model
  const padL = 46, padR = 20, padT = 20, padB = 28
  const X = m => padL + (m / maxM) * (W - padL - padR)
  const Y = r => padT + (hi - r) / (hi - lo) * (H - padT - padB)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.m).toFixed(1)},${Y(p.r).toFixed(1)}`).join(' ')
  const area = `${path} L${X(pts[pts.length - 1].m).toFixed(1)},${H - padB} L${X(pts[0].m).toFixed(1)},${H - padB} Z`
  const step = (hi - lo) > 2 ? 0.5 : 0.25
  const ticks = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(+v.toFixed(2))
  const xt = []; for (let m = 0; m <= maxM; m += 6) xt.push(m)
  const onMove = e => {
    const bx = e.currentTarget.getBoundingClientRect(); const mx = e.clientX - bx.left
    let best = null, bd = 1e9; pts.forEach(p => { const dd = Math.abs(X(p.m) - mx); if (dd < bd) { bd = dd; best = p } }); setHov(best)
  }
  return (
    <div ref={ref} className="dh-plot">
      {W > 0 && (
        <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHov(null)}>
          <defs>
            <linearGradient id="ppArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.2" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient>
          </defs>
          {ticks.map(v => <g key={v}><line x1={padL} x2={W - padR} y1={Y(v)} y2={Y(v)} className="dh-grid-line" /><text x={padL - 8} y={Y(v) + 3} className="dh-ax" textAnchor="end">{v.toFixed(2)}%</text></g>)}
          {xt.map(m => { const dte = pts[0]?.date ? new Date(pts[0].date + 'T00:00:00') : new Date(); dte.setMonth(dte.getMonth() + m)
            return <text key={m} x={X(m)} y={H - 10} className="dh-ax" textAnchor="middle">{m === 0 ? 'NOW' : fmtMon(dte.toISOString().slice(0, 10)).toUpperCase()}</text> })}
          {lr && <g><line x1={padL} x2={W - padR} y1={Y(lr.rate)} y2={Y(lr.rate)} className="pp-lr" /><text x={W - padR} y={Y(lr.rate) - 5} className="dh-ax pp-lr-t" textAnchor="end">LONGER RUN {lr.rate.toFixed(2)}%</text></g>}
          <path d={area} fill="url(#ppArea)" />
          <path d={path} className="dh-line" />
          {pts.filter((p, i) => p.fixing || i % 6 === 0 || i === pts.length - 1).map(p => (
            <g key={p.date}><circle cx={X(p.m)} cy={Y(p.r)} r={3.5} className="dh-marker" /><text x={X(p.m)} y={Y(p.r) - 10} className="dh-val" textAnchor="middle">{p.r.toFixed(2)}</text></g>
          ))}
          {dots.map(x => (
            <g key={x.label}>
              <circle cx={X(x.m)} cy={Y(x.r)} r={5.5} className="pp-dot" />
              <text x={X(x.m)} y={Y(x.r) + 17} className="dh-ax pp-dot-t" textAnchor="middle">FED {x.label} {x.r.toFixed(1)}</text>
            </g>
          ))}
          {hov && <g><line x1={X(hov.m)} x2={X(hov.m)} y1={padT} y2={H - padB} className="dh-cross" /><circle cx={X(hov.m)} cy={Y(hov.r)} r={5} className="dh-marker" /></g>}
        </svg>
      )}
      {hov && <div className="dh-tip" style={{ left: Math.min(W - 150, X(hov.m) + 10), top: Y(hov.r) - 46 }}><b>{hov.fixing ? 'FIXING' : fmtMon(hov.date).toUpperCase()}</b> {hov.r.toFixed(3)}%</div>}
    </div>
  )
}
