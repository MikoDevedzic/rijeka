// home/TraderHome.jsx — the desk's home on a monitor, as a trader reads it. Three bands, always in the same place:
//   where you stand (the limits on one rail)            | what needs you (the desk feed's actions)
//   the P&L statement | the risk, one stream per factor along the tenor it sits at | the factors and the limits
//   your trades                                         | what moved, rates, the week ahead, news, the brief
// Everything is read from endpoints that already exist (trader-home.js says which and what is worked out from
// them). A phone keeps the home it had (CommandCenter.jsx draws that one under 641px).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'
import { productLabel } from '../../lib/labels'
import { RISK_FACTORS } from '../../lib/risk-factors'
import { T, alpha, MONO } from '../../theme'
import { useChatStore, selectUnreadTotal } from '../../store/useChatStore'
import PolicyPath from './PolicyPath'
import WeekAhead from './WeekAhead'
import BookBrief from './BookBrief'
import { BUCKETS, BUCKET_LABEL, bucketReach, factors, lanes, heights, canDay, peak, limitMarks, standing, railLayout, RAIL_MAX, statement, moved, fmt0, signed, tone } from './trader-home'
import './TraderHome.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const REFRESH_MS = 60_000
const MODE_KEY = 'rijeka.home.height'
const NEEDS = 3                      // rows of the desk feed the home shows; the rest are a count
const FRAME_MS = 33                  // the streams' light moves at thirty frames a second: enough to read as water, half the work
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const fmtD = (iso) => iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtDay = (iso) => iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : ''
const fmtM = (n) => n == null ? '—' : Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(2)}bn` : Math.abs(n) >= 1e5 ? `${(n / 1e6).toFixed(1)}m` : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
const ago = (iso) => { if (!iso) return ''; const h = (Date.now() - new Date(iso)) / 36e5; return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d` }
const eth = (v) => v == null ? '—' : `${Number(v).toFixed(v < 0.1 ? 4 : 3)} ETH`
const short = (h) => h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '—'
const KIND = { COUNTERSIGN: ['SIGN', 'amber'], AWAITING: ['WAIT', ''], MATURITY: ['DUE', 'blue'], OFF_CHAIN: ['OFF-CHAIN', 'red'], WALLET: ['WALLET', 'amber'], NODE: ['NODE', 'red'], LIMIT: ['LIMIT', 'red'], LIMIT_WARN: ['LIMIT', 'amber'], BATCH: ['BATCH', 'amber'], CHAT: ['CHAT', ''] }
const PNL_STATUS = { OPEN: ['OPEN', ''], TRADER_SIGNED: ['TRADER SIGNED', 'amber'], CONTROLLER_SIGNED: ['CONTROLLER SIGNED', 'amber'], FINAL: ['FINAL', 'ok'] }

// One read of an endpoint: { data, err, loading }. `every` asks again on that beat and when the window is looked at.
function useGet(path, { on = true, every = 0 } = {}) {
  const [st, setSt] = useState({ data: null, err: null, loading: on })
  useEffect(() => {
    if (!on) return undefined
    let alive = true
    const load = async () => {
      try {
        const s = await getSessionMaybe()
        const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${s?.access_token}` } })
        if (!r.ok) throw new Error(String(r.status))
        const j = await r.json()
        if (alive) setSt({ data: j, err: null, loading: false })
      } catch (e) { if (alive) setSt(p => ({ data: p.data, err: e.message || 'no answer', loading: false })) }
    }
    load()
    if (!every) return () => { alive = false }
    const id = setInterval(load, every)
    window.addEventListener('focus', load)
    return () => { alive = false; clearInterval(id); window.removeEventListener('focus', load) }
  }, [path, on, every])
  return on ? st : { data: null, err: null, loading: false }
}

function useWidth(ref) {
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(ref.current); return () => ro.disconnect()
  }, [ref])
  return w
}

export default function TraderHome({ d, modules, canEdit, onRequest = [], navigate, strip, path, footer }) {
  const riskOn = modules.MARKET_RISK !== false, pnlOn = modules.PNL !== false
  const trades = useMemo(() => d.trades || [], [d.trades])
  const risk = useGet('/api/risk/report', { on: riskOn && trades.length > 0 })
  const pnl = useGet('/api/pnl/summary', { on: pnlOn && trades.length > 0 })
  const life = useGet('/api/desk/lifecycle', { every: REFRESH_MS })
  const unread = useChatStore(selectUnreadTotal)
  const rep = risk.data
  const list = useMemo(() => factors(rep, trades), [rep, trades])
  const marks = useMemo(() => limitMarks(rep?.limits, rep?.scenarios), [rep])
  const pending = trades.filter(t => t.status === 'PENDING').length, confirmed = trades.filter(t => t.status === 'CONFIRMED').length
  const stand = standing(marks, pending)
  const actions = useMemo(() => {
    const a = [...(life.data?.actions || [])]
    if (unread > 0) a.push({ kind: 'CHAT', title: `${unread} unread message${unread > 1 ? 's' : ''} in chat`, detail: 'OPEN THE MESSENGER', chat: true })
    return a
  }, [life.data, unread])
  const go = (a) => {
    if (a.chat) { if (!useChatStore.getState().open) useChatStore.getState().toggle(); return }
    if (!a.href) return
    a.href.startsWith('http') ? window.open(a.href, '_blank', 'noopener') : navigate(a.href)
  }
  const chain = life.data?.chain
  const explorer = chain?.explorer || 'https://sepolia.etherscan.io'
  const off = (key) => onRequest.includes(key) ? 'on request' : canEdit ? 'switched off' : "switched off by your firm's admin"

  return (
    <div className="dh th" data-testid="trader-home">
      {strip}

      <section className="th-st">
        <div className="th-stand" data-testid="th-stand">
          {!trades.length && !d.loading
            ? <><div className="th-words"><span className="th-w mute"><i />No trades yet</span></div><p className="th-tight">Book one from the blotter. Its price, its risk by tenor, its XVA and its confirmation all follow from it, and this page fills in.</p>{path}</>
            : <>
                <div className="th-words">
                  {riskOn && rep ? stand.words.map(([c, t]) => <span key={t} className={`th-w ${c}`}><i />{t}</span>)
                    : <>{pending > 0 && <span className="th-w hollow"><i />{pending} to confirm</span>}<span className="th-w dim"><i />{trades.length} trade{trades.length === 1 ? '' : 's'}</span>{confirmed > 0 && <span className="th-w sealed"><i />{confirmed} confirmed</span>}</>}
                </div>
                {riskOn && rep && <p className="th-tight">{stand.tight || (rep.can_write ? 'A limit on VaR, a 01 or a stress loss is set on the Risk page; it is then drawn here.' : 'Limits are set by your risk manager; they are then drawn here.')}{rep.date ? ` Risk as of ${fmtD(rep.date)}.` : ''}</p>}
                {riskOn && risk.loading && <p className="th-tight">Measuring the book…</p>}
                {riskOn && !rep && risk.err && <p className="th-tight">The risk report could not be read ({risk.err}).</p>}
                {!riskOn && <p className="th-tight">Limits and risk by tenor are part of Market risk, which is {off('MARKET_RISK')} for this desk.</p>}
                {marks.length > 0 && <Rail marks={marks} />}
              </>}
        </div>
        <div className="th-needs" data-testid="th-needs">
          <div className="th-k">NEEDS YOU <b className={actions.length ? 'on' : ''}>{life.data || unread ? actions.length : '…'}</b></div>
          {life.err && !life.data && <div className="lf-empty">Could not load the desk feed ({life.err}).</div>}
          {life.data && !actions.length && <div className="lf-empty">Nothing is waiting for you.</div>}
          <ul className="lf-list">
            {actions.slice(0, NEEDS).map((a, i) => {
              const [chip, tn] = KIND[a.kind] || [a.kind, '']
              return (
                <li key={i} className={a.href || a.chat ? 'go' : ''} onClick={() => go(a)}>
                  <span className={`lf-chip ${tn}`}>{chip}</span>
                  <span className="lf-t"><b>{a.title}</b><small>{a.detail}</small></span>
                  <span className="lf-when">{a.since ? ago(a.since) : ''}</span>
                </li>
              )
            })}
          </ul>
          {actions.length > NEEDS && <div className="th-note">and {actions.length - NEEDS} more on the blotter</div>}
        </div>
      </section>

      <section className="th-hero">
        <Statement on={pnlOn} off={off('PNL')} st={pnl} rep={rep} trades={trades} pending={pending} confirmed={confirmed} navigate={navigate} />
        <Streams on={riskOn} off={off('MARKET_RISK')} st={risk} list={list} any={trades.length > 0} />
        <Factors on={riskOn} rep={rep} list={list} marks={marks} any={trades.length > 0} navigate={navigate} />
      </section>

      <section className="th-two">
        <div className="th-panel" data-testid="th-trades">
          <div className="th-hd"><span className="th-k">YOUR TRADES</span><button className="dh-link" onClick={() => navigate('/blotter')}>OPEN BLOTTER →</button></div>
          {trades.length > 0
            ? <table className="th-t">
                <thead><tr><th>TRADE</th><th>WHAT</th><th className="r">NOTIONAL</th><th className="r">MATURITY</th><th className="r">STATUS</th></tr></thead>
                <tbody>
                  {trades.slice(0, 7).map(t => (
                    <tr key={t.id} onClick={() => navigate('/blotter')}>
                      <td className="fig">{t.trade_ref}</td>
                      <td>{productLabel(t.instrument_type)}</td>
                      <td className="fig r">{t.notional_ccy} {fmtM(t.notional)}</td>
                      <td className="fig r">{fmtD(t.maturity_date)}</td>
                      <td className="r"><span className={`dh-st ${String(t.status).toLowerCase()}`}>{t.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            : <div className="lf-empty">{d.loading ? 'Reading the book…' : 'No trades yet. Book one from the blotter.'}</div>}
          {trades.length > 7 && <div className="th-note">the latest 7 of {trades.length}</div>}
        </div>
        <Tabs pnlOn={pnlOn} pnl={pnl} news={d.news || []} loading={d.loading} hasTrades={trades.length > 0} navigate={navigate} />
      </section>

      <div className="th-chain" data-testid="th-chain">
        {chain?.anchored
          ? <><span><i className={`lf-beat${chain.reachable === false ? ' bad' : ''}`} />{chain.network}{chain.latest_block ? ` #${Number(chain.latest_block).toLocaleString()}` : ''}</span>
              <span>{life.data?.counts?.anchored ?? 0} ANCHORED</span>
              {chain.relayer && <span className={chain.relayer.low ? 'warn' : ''} title={chain.relayer.address || ''}>RELAYER {eth(chain.relayer.balance_eth)}</span>}
              {chain.registry && <a href={`${explorer}/address/${chain.registry}`} target="_blank" rel="noopener noreferrer">REGISTRY {short(chain.registry)} ↗</a>}</>
          : <span>{life.data ? 'OFF-CHAIN' : ''}</span>}
        <a href="https://rijeka.app/verify" target="_blank" rel="noopener noreferrer">VERIFIER ↗</a>
      </div>
      {footer}
    </div>
  )
}

// The limits on one rail: a mark for each, placed by how much of it is used. The hatched end is past the limit.
function Rail({ marks }) {
  const ref = useRef(null), w = useWidth(ref)
  const lay = useMemo(() => railLayout(marks, w || 0), [marks, w])
  const LH = 17
  return (
    <div className="th-rail" ref={ref} data-testid="th-rail">
      {w > 0 && <div className="th-rl-labs" style={{ height: lay.lanes * LH + 2 }}>
        {lay.marks.map(m => (
          <span key={m.id}>
            <span className={`th-rl-lab ${m.status}`} style={{ left: m.cx, top: (lay.lanes - 1 - m.lane) * LH }}>{m.text}</span>
            <i className="th-rl-stem" style={{ left: m.x, top: (lay.lanes - 1 - m.lane) * LH + 14, height: m.lane * LH + 7 }} />
          </span>
        ))}
      </div>}
      <div className="th-rl-track">
        <i className="th-rl-zone" />
        {marks.map(m => <i key={m.id} className={`th-rl-m ${m.kind} ${m.status}`} style={{ left: `${Math.min(Math.max(m.u, 0), RAIL_MAX) / RAIL_MAX * 100}%` }} title={`${m.name}: ${m.pct}% of its limit`} />)}
      </div>
      <div className="th-rl-ticks"><span style={{ left: 0 }}>0</span><span style={{ left: '40%' }}>50%</span><span style={{ left: '80%' }}>100% · THE LIMIT</span></div>
    </div>
  )
}

function Statement({ on, off, st, rep, trades, pending, confirmed, navigate }) {
  const s = st.data
  const rows = statement(s)
  const [label, tn] = PNL_STATUS[s?.status] || PNL_STATUS.OPEN
  return (
    <div className="th-lead" data-testid="th-pnl">
      {on ? <>
        <div className="th-hd"><span className="th-k">P&amp;L · {s?.reporting_ccy || 'USD'}{s?.date ? ` · ${fmtDay(s.date)}${s.prev_date ? ` VS ${fmtDay(s.prev_date)}` : ''}`.toUpperCase() : ''}</span>{s && <i className={`lf-chip ${tn}`}>{label}</i>}</div>
        <div className={`th-big ${tone(s?.dod)}`}>{s ? signed(s.dod) : st.err || !trades.length ? '—' : '…'}</div>
        {s && <div className="th-split"><span>TODAY · {rows.some(r => r[0] === 'After XVA') ? 'BEFORE XVA' : 'CLEAN'}</span></div>}
        {st.err && !s && <div className="th-note">P&amp;L unavailable ({st.err})</div>}
        {!s && !st.err && trades.length > 0 && <div className="th-note">Marking the book…</div>}
        {!trades.length && <div className="th-note">The day&apos;s P&amp;L is here once there is a trade to mark.</div>}
        {rows.length > 0 && <table className="th-t th-stmt">
          <thead><tr><th /><th className="r">TODAY</th><th className="r">MTD</th><th className="r">YTD</th></tr></thead>
          <tbody>{rows.map(([l, a, b, c, kind]) => <tr key={l} className={kind || ''}><td>{l}</td>{[a, b, c].map((x, i) => <td key={i} className={`fig r ${tone(x)}`}>{signed(x)}</td>)}</tr>)}</tbody>
        </table>}
        {rep?.ladder?.npv_usd != null && <div className="th-mark"><span>THE BOOK&apos;S MARK{rep.date ? ` · ${fmtDay(rep.date).toUpperCase()}` : ''}</span><b className={`fig ${tone(rep.ladder.npv_usd)}`}>{signed(rep.ladder.npv_usd)}</b></div>}
        {s?.problems > 0 && <div className="th-note">{s.problems} trade{s.problems > 1 ? 's' : ''} not explained · see the P&amp;L page</div>}
        {trades.length > 0 && <button className="dh-link th-more" onClick={() => navigate('/pnl')}>ATTRIBUTION AND SIGN-OFF →</button>}
      </> : <>
        <div className="th-hd"><span className="th-k">YOUR BOOK · USD</span></div>
        <div className={`th-big ${tone(rep?.ladder?.npv_usd)}`}>{rep ? signed(rep.ladder?.npv_usd) : '—'}</div>
        <div className="th-split"><span>THE BOOK&apos;S MARK{rep?.date ? ` ON ${fmtDay(rep.date).toUpperCase()}` : ''}</span></div>
        <div className="th-note">P&amp;L is {off} for this desk.</div>
      </>}
      <div className="th-count"><span><b>{trades.length}</b> TRADES</span><span><b>{pending}</b> PENDING</span><span><b>{confirmed}</b> CONFIRMED</span></div>
    </div>
  )
}

// The picture: one stream for each risk factor, along the tenor bucket the risk sits in. Above its line the book is
// long that factor, below it short; where there is no risk the line is bare.
function Streams({ on, off, st, list, any }) {
  const day = canDay(list)
  const [want, setWant] = useState(() => { try { return localStorage.getItem(MODE_KEY) === 'raw' ? 'raw' : 'day' } catch { return 'day' } })
  const mode = day ? want : 'raw'
  const pick = (m) => { setWant(m); try { localStorage.setItem(MODE_KEY, m) } catch { /* the choice then lasts for this visit */ } }
  const { drawn, rest } = useMemo(() => lanes(list), [list])
  const empty = on && !st.loading && !st.err && drawn.length === 0
  return (
    <div className="th-pic" data-testid="th-river">
      <div className="th-hd">
        <div><span className="th-k">WHERE YOUR RISK SITS</span>
          <div className="th-sub">{!on ? 'part of Market risk' : mode === 'day' ? 'height is USD for a usual day in that factor · one scale for all' : 'height is the sensitivity itself · each stream to its own scale'}</div></div>
        {on && day && <div className="tbw-tabs th-seg" role="group" aria-label="What a stream's height means" data-testid="th-mode">
          <button className={`tbw-tab${mode === 'day' ? ' is-active' : ''}`} aria-pressed={mode === 'day'} onClick={() => pick('day')}>A USUAL DAY</button>
          <button className={`tbw-tab${mode === 'raw' ? ' is-active' : ''}`} aria-pressed={mode === 'raw'} onClick={() => pick('raw')}>PER 01</button>
        </div>}
      </div>
      {!on && <div className="th-blank">Risk by tenor is part of Market risk, which is {off} for this desk.</div>}
      {on && !any && <div className="th-blank">No risk yet. Book a trade and its risk is drawn here, one stream for each factor.</div>}
      {on && any && st.loading && <div className="th-blank">Measuring the book…</div>}
      {on && any && st.err && !st.data && <div className="th-blank">The risk report could not be read ({st.err}). The Risk page can run it again.</div>}
      {on && any && empty && <div className="th-blank">The book carries no risk the ladder measures on {fmtD(st.data?.date)}.</div>}
      {on && drawn.length > 0 && <River drawn={drawn} mode={mode} asOf={st.data?.date} />}
      {on && drawn.length > 0 && <div className="th-note">A spot delta has no tenor of its own: it is drawn at the maturity of the trade that carries it.{rest.length ? ` Not drawn, smaller: ${rest.map(f => `${f.name} ${f.measure}`).join(', ')}.` : ''}</div>}
    </div>
  )
}

// The lanes' names on the left, the drawing on the right, the tip under the pointer. Mounted only when there is a
// factor to draw, so the box it measures is there from its first frame.
function River({ drawn, mode, asOf }) {
  const box = useRef(null), cv = useRef(null), tip = useRef(null), at = useRef({ x: 0, y: 0 }), w = useWidth(box)
  const hs = useMemo(() => heights(drawn, mode), [drawn, mode])
  const [hot, setHot] = useState(-1)
  const reach = useMemo(() => bucketReach(asOf), [asOf])
  const AXIS = 40, n = drawn.length
  const height = Math.max(300, Math.min(460, n * 92)) + AXIS

  useEffect(() => {
    const c = cv.current
    if (!c || !w) return undefined
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = w, H = height
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
    const g = c.getContext('2d')
    const css = getComputedStyle(document.documentElement)
    const cols = drawn.map(f => css.getPropertyValue(RISK_FACTORS[f.factor].token).trim() || T.textDim)
    const top = 6, bottom = H - AXIS, lane = (bottom - top) / n, amp = lane * 0.44, colW = W / BUCKETS.length
    // six nodes across: nothing at either edge, the bucket's height at its middle; a cosine between them, so the
    // line never rises past a bucket's own figure
    const nodes = (h) => [[0, 0], ...h.map((v, i) => [colW * (i + 0.5), v]), [W, 0]]
    const yAt = (nd, x) => { let k = 0; while (k < nd.length - 2 && x > nd[k + 1][0]) k++; const [x0, y0] = nd[k], [x1, y1] = nd[k + 1], u = Math.max(0, Math.min(1, (x - x0) / (x1 - x0 || 1))); return y0 + (y1 - y0) * (1 - Math.cos(Math.PI * u)) / 2 }
    const xs = []; for (let x = 0; x <= W; x += 4) xs.push(x)
    const shape = drawn.map((f, k) => { const base = top + lane * (k + 0.5), nd = nodes(hs[k].h); return { base, ys: xs.map(x => base - yAt(nd, x) * amp) } })
    const still = reduced()
    let raf = 0, last = -FRAME_MS
    const draw = (ms) => {
      if (!still) raf = requestAnimationFrame(draw)
      if (!still && ms - last < FRAME_MS) return
      last = ms
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.globalAlpha = 1; g.setLineDash([]); g.shadowBlur = 0; g.globalCompositeOperation = 'source-over'
      g.textAlign = 'center'; g.textBaseline = 'alphabetic'
      if (hot >= 0) { g.fillStyle = alpha(T.text, 0.035); g.fillRect(colW * hot, top, colW, bottom - top) }
      BUCKETS.forEach((b, i) => {
        if (i) { g.strokeStyle = alpha(T.border, 0.7); g.lineWidth = 1; g.beginPath(); g.moveTo(colW * i, top); g.lineTo(colW * i, bottom + 4); g.stroke() }
        g.font = `11px ${MONO}`; g.fillStyle = i === hot ? T.textHi : T.textDim; g.fillText(BUCKET_LABEL[b], colW * (i + 0.5), bottom + 18)
        g.fillStyle = T.textMute; g.fillText(reach[i], colW * (i + 0.5), bottom + 33)
      })
      drawn.forEach((f, k) => {
        const { base, ys } = shape[k], c = cols[k], own = hs[k].own, live = (i) => Math.abs(ys[i] - base) > 1.2
        g.strokeStyle = alpha(c, 0.28); g.lineWidth = 1; g.beginPath(); g.moveTo(0, base); g.lineTo(W, base); g.stroke()
        const grad = g.createLinearGradient(0, base - amp, 0, base + amp)
        grad.addColorStop(0, alpha(c, 0.4)); grad.addColorStop(0.5, alpha(c, 0)); grad.addColorStop(1, alpha(c, 0.4))
        g.beginPath(); g.moveTo(xs[0], base); xs.forEach((x, i) => g.lineTo(x, ys[i])); g.lineTo(xs[xs.length - 1], base); g.closePath(); g.fillStyle = grad; g.fill()
        g.lineWidth = 1; g.strokeStyle = c
        for (let j = 1; j < 9; j++) {                      // the strands: each a fraction of the way from the line to the edge
          const fr = j / 9; g.globalAlpha = 0.07 + 0.22 * fr * fr; g.beginPath(); let pen = false
          xs.forEach((x, i) => { if (!live(i)) { pen = false; return } const y = base - (base - ys[i]) * fr + (still ? 0 : Math.sin(x * 0.02 + j * 1.7 + ms * 0.0007) * 0.8 * (1 - fr)); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true })
          g.stroke()
        }
        const edge = () => { g.beginPath(); let pen = false; xs.forEach((x, i) => { if (!live(i)) { pen = false; return } pen ? g.lineTo(x, ys[i]) : g.moveTo(x, ys[i]); pen = true }) }
        g.globalAlpha = 1; g.lineWidth = 1.8; g.setLineDash(own ? [5, 4] : []); g.shadowColor = c; g.shadowBlur = own ? 0 : 14; edge(); g.stroke(); g.shadowBlur = 0; g.setLineDash([])
        if (!still && !own) {                               // light running along the edge, toward the far tenors
          g.globalCompositeOperation = 'lighter'; g.strokeStyle = T.textHi; g.globalAlpha = 0.5; g.lineWidth = 1.6
          g.setLineDash([16, 120]); g.lineDashOffset = -ms * 0.035 - k * 37; edge(); g.stroke(); g.setLineDash([]); g.globalCompositeOperation = 'source-over'
        }
        g.globalAlpha = 1
      })
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [drawn, hs, w, height, hot, n, reach])

  // The tip follows the pointer by its own style, not by a render: only entering another bucket draws the page again.
  const place = () => { if (tip.current) { tip.current.style.left = `${at.current.x}px`; tip.current.style.top = `${at.current.y}px` } }
  useLayoutEffect(place)
  const move = (e) => {
    const r = box.current.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top
    const i = Math.max(0, Math.min(BUCKETS.length - 1, Math.floor(x / (r.width / BUCKETS.length))))
    at.current = { x: Math.max(0, Math.min(x + 16, r.width - 300)), y: Math.max(4, Math.min(y - 24, r.height - AXIS - 22 * (n + 1))) }
    place()
    if (i !== hot) setHot(i)
  }

  return (
    <div className="th-river">
      <div className="th-lanes" style={{ height: height - AXIS }}>
        {drawn.map((f, k) => (
          <div key={f.key} className="th-lane" data-factor={f.key}>
            <span className="th-lane-n"><span className="rf-mark" style={{ background: `var(${RISK_FACTORS[f.factor].token})` }} />{f.name} · {f.measure}</span>
            <span className="th-lane-v"><b className={`fig ${tone(f.total)}`}>{signed(f.total)}</b> {f.unit}</span>
            {hs[k].own && <span className="th-lane-own">no history of its moves: drawn to its own scale</span>}
          </div>
        ))}
      </div>
      <div className="th-cv" ref={box} style={{ height }} onMouseMove={move} onMouseLeave={() => setHot(-1)}>
        <canvas ref={cv} style={{ height }} role="img" aria-label={`Risk by factor and tenor bucket: ${drawn.map(f => `${f.name} ${f.measure} ${signed(f.total)} ${f.unit}`).join('; ')}`} />
        {hot >= 0 && (
          <div className="th-tip" ref={tip}>
            <div className="th-tip-h">{BUCKET_LABEL[BUCKETS[hot]]} · {reach[hot]}</div>
            {drawn.filter(f => Math.abs(f.v[hot]) >= 0.5).map(f => (
              <div key={f.key}><span><span className="rf-mark" style={{ background: `var(${RISK_FACTORS[f.factor].token})` }} />{f.name} {f.measure}</span>
                <span><b className={`fig ${tone(f.v[hot])}`}>{signed(f.v[hot])}</b>{f.day?.[hot] != null && mode === 'day' ? <em> ≈ {fmt0(f.day[hot])} a day</em> : null}</span></div>
            ))}
            {!drawn.some(f => Math.abs(f.v[hot]) >= 0.5) && <div><span className="mute">no risk in this bucket</span></div>}
          </div>
        )}
      </div>
    </div>
  )
}

function Factors({ on, rep, list, marks, any, navigate }) {
  if (!on) return <aside className="th-side" data-testid="th-factors"><div className="th-k">YOUR RISK BY FACTOR</div><div className="lf-empty">Shown with Market risk.</div></aside>
  const pk = list.map(peak), top = Math.max(0, ...pk.map(p => p?.usd || 0))
  const v = rep?.var || {}
  const conf = v.confidence != null ? `${Math.round(v.confidence * 1000) / 10}%` : ''
  return (
    <aside className="th-side" data-testid="th-factors">
      <div><div className="th-k">YOUR RISK BY FACTOR</div><div className="th-sub">its sensitivity, and its largest bucket on a usual day</div></div>
      {list.length === 0 && <div className="lf-empty">{rep || !any ? 'Nothing to measure yet.' : '…'}</div>}
      {list.map((f, i) => (
        <div key={f.key} className="th-row">
          <span className="th-row-n"><span className="rf-mark" style={{ background: `var(${RISK_FACTORS[f.factor].token})` }} />{f.name} <small>{f.measure}</small></span>
          <b className={`fig ${tone(f.total)}`}>{signed(f.total)}</b>
          <span className="th-bar"><i style={{ width: `${top && pk[i] ? Math.max(2, pk[i].usd / top * 100) : 0}%`, background: `var(${RISK_FACTORS[f.factor].token})` }} /></span>
          <small className="th-row-d">{pk[i] ? `≈ ${fmt0(pk[i].usd)} a day · ${BUCKET_LABEL[pk[i].bucket]}` : 'no history of its moves'}</small>
        </div>
      ))}
      {rep && <div className="th-tot" data-testid="th-var">
        <span>VaR {conf} · 1 day</span><b className="fig">{v.var_1d != null && v.enough !== false ? fmt0(v.var_1d) : '—'}</b>
        {v.enough === false && <small>{v.observations ?? 0} days of history: too few for a VaR</small>}
      </div>}
      {marks.length > 0 && <>
        <div className="th-k th-k2">LIMITS</div>
        <div className="th-lims" data-testid="th-limits">
          {marks.slice(0, 5).map(m => (
            <div key={m.id} className="th-lim">
              <span>{m.name}</span><span className={`th-use ${m.status}`}><i style={{ width: `${Math.min(100, m.u * 100)}%` }} /></span><b className={`fig ${m.status}`}>{m.pct}%</b>
            </div>
          ))}
        </div>
      </>}
      <button className="dh-link th-more" onClick={() => navigate('/risk')}>THE RISK PAGE →</button>
    </aside>
  )
}

function Tabs({ pnlOn, pnl, news, loading, hasTrades, navigate }) {
  const mv = moved(pnl.data)
  const tabs = [pnlOn && hasTrades && ['moved', 'WHAT MOVED'], ['rates', 'RATES'], ['week', 'WEEK AHEAD'], ['news', 'NEWS'], hasTrades && ['brief', 'BRIEF']].filter(Boolean)
  const [tab, setTab] = useState(null)
  const cur = tabs.some(t => t[0] === tab) ? tab : tabs[0][0]
  const s = pnl.data
  return (
    <div className="th-panel" data-testid="th-tabs">
      <div className="tbw-tabs th-tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={cur === k} className={`tbw-tab${cur === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="th-tabbody" role="tabpanel" data-tab={cur}>
        {cur === 'moved' && (
          !s ? <div className="lf-empty">{pnl.err ? `P&L unavailable (${pnl.err})` : 'Marking the book…'}</div>
          : <>
              <div className="th-sub">the day&apos;s P&amp;L by what moved it{s.date ? ` · ${fmtDay(s.date)}` : ''} · USD</div>
              {mv.any ? <div className="th-moved">
                {mv.rows.map(r => (
                  <div key={r.key} className="th-mv">
                    <span>{r.label}</span>
                    <span className="th-mv-bar"><i className={tone(r.usd)} style={{ width: `${r.share * 50}%` }} /></span>
                    <b className={`fig ${tone(r.usd)}`}>{signed(r.usd)}</b>
                  </div>
                ))}
                <div className="th-mv sum"><span>THE DAY</span><span /><b className={`fig ${tone(s.dod)}`}>{signed(s.dod)}</b></div>
              </div> : <div className="lf-empty">Nothing moved the book between the two dates.</div>}
            </>
        )}
        {cur === 'rates' && <PolicyPath onCurves={() => navigate('/configurations/market-data/curves')} />}
        {cur === 'week' && <WeekAhead />}
        {cur === 'news' && (
          <ul className="dh-news th-news">
            {news.map(n => (
              <li key={n.url}><a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a><span className="dh-news-meta">{n.source} · {ago(n.published_at)}{n.tags?.[0] ? ` · ${n.tags[0]}` : ''}</span></li>
            ))}
            {!loading && !news.length && <li className="dh-empty">No headlines yet.</li>}
          </ul>
        )}
        {cur === 'brief' && <BookBrief onSheet={() => {}} />}
        {cur === 'news' && <button className="dh-link th-more" onClick={() => navigate('/messenger')}>OPEN THE NEWS ROOM →</button>}
      </div>
    </div>
  )
}
