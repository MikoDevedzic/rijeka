// home/TraderHome.jsx — the desk's home on a monitor, as a trader reads it. Three bands, always in the same place:
//   where you stand (the limits on one rail)            | what needs you (the desk feed's actions)
//   the P&L statement | the risk, one stream per factor along the tenor it sits at | the factors and the limits
//   your trades                                         | what moved, rates, the week ahead, news, the brief
// Everything is read from endpoints that already exist (trader-home.js says which and what is worked out from
// them). A phone keeps the home it had (CommandCenter.jsx draws that one under 641px).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { productLabel } from '../../lib/labels'
import { RISK_FACTORS } from '../../lib/risk-factors'
import { T, alpha, MONO } from '../../theme'
import { useChatStore, selectUnreadTotal } from '../../store/useChatStore'
import PolicyPath from './PolicyPath'
import WeekAhead from './WeekAhead'
import BookBrief from './BookBrief'
import Fixings from '../risk/Fixings'
import { BUCKETS, BUCKET_LABEL, bucketReach, factors, lanes, peak, carry, limitMarks, standing, more, factorLimits, limitsOf, shownOn, against, scene, canLimit, columns, laneMarks, markFigure, laneFigures, figureAt, statement, moved, fmt0, signed, tone } from './trader-home'
import { useGet, useRisk } from './use-risk'
import { pressKey } from '../../lib/a11y'
import PageHeading from '../common/PageHeading'
import './TraderHome.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const REFRESH_MS = 60_000
const GUTTER = 46                     // px at the start of the lanes, kept for the totals' gauges where any factor has one
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
// a refusal for running too often is said in words (the risk report is four runs a minute an account)
const why429 = (e) => String(e) === '429' ? 'it has been run too often this minute' : e
const PNL_STATUS = { OPEN: ['OPEN', ''], TRADER_SIGNED: ['TRADER SIGNED', 'amber'], CONTROLLER_SIGNED: ['CONTROLLER SIGNED', 'amber'], FINAL: ['FINAL', 'ok'] }

const BEHIND = { book: 'It does not hold the trades booked or closed since', market: 'It is on the market data before the latest', older: null }

function useWidth(ref) {
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(ref.current); return () => ro.disconnect()
  }, [ref])
  return w
}

export default function TraderHome({ d, demo, modules, canEdit, onRequest = [], navigate, strip, path, chainEmpty, footer }) {
  const riskOn = modules.MARKET_RISK !== false, pnlOn = modules.PNL !== false
  const trades = useMemo(() => d.trades || [], [d.trades])
  const risk = useRisk(riskOn && trades.length > 0, trades, d.sofr?.valuation_date, !d.loading)
  const pnl = useGet('/api/pnl/summary', { on: pnlOn && trades.length > 0 })
  const life = useGet('/api/desk/lifecycle', { every: REFRESH_MS })
  const unread = useChatStore(selectUnreadTotal)
  const rep = risk.data
  const list = useMemo(() => factors(rep, trades), [rep, trades])
  const marks = useMemo(() => limitMarks(rep?.limits, rep?.scenarios, list, rep?.ladder?.npv_usd), [rep, list])
  const fl = useMemo(() => factorLimits(rep?.limits), [rep])          // the limits that stand on a factor the picture draws
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
    <div className="dh th" data-testid="trader-home" role="main">
      <PageHeading />
      {strip}

      <section className="th-st">
        <div className="th-stand" data-testid="th-stand">
          {!trades.length && !d.loading
            ? <><div className="th-words"><span className="th-w mute"><i />No trades yet</span></div><p className="th-tight">Book one from the blotter. Its price, its risk by tenor, its XVA and its confirmation all follow from it, and this page fills in.</p></>
            : <>
                <div className="th-words">
                  {riskOn && rep ? stand.words.map(([c, t]) => <span key={t} className={`th-w ${c}`}><i />{t}</span>)
                    : <>{pending > 0 && <span className="th-w hollow"><i />{pending} to confirm</span>}<span className="th-w dim"><i />{trades.length} trade{trades.length === 1 ? '' : 's'}</span>{confirmed > 0 && <span className="th-w sealed"><i />{confirmed} confirmed</span>}</>}
                </div>
                {riskOn && rep && <p className="th-tight">{stand.tight || (rep.can_write ? 'A limit on a 01, on VaR or on a stress loss is set under Configurations, Market risk, Limits; it is then shown here, beside its factor and on its stream.' : 'Limits are set by your risk manager; they are then drawn here.')}{stand.standardOnly ? ' Every curve is at the standard limit for its kind until it is given its own.' : ''}{rep.date ? ` Risk as of ${fmtD(rep.date)}.` : ''}{rep.can_write && <> <button className="dh-link" data-testid="th-set-limits" onClick={() => navigate('/configurations/market-risk/limits')}>{marks.length ? 'LIMITS →' : 'SET LIMITS →'}</button></>}</p>}
                {riskOn && risk.loading && <p className="th-tight">Measuring the book…</p>}
                {riskOn && rep && risk.behind === 'running' && <p className="th-tight th-behind" data-testid="th-behind">Measuring the book again: this is the report as it was stored.</p>}
                {riskOn && rep && BEHIND[risk.behind] && <p className="th-tight th-behind warn" data-testid="th-behind">{BEHIND[risk.behind]}, and could not be run again just now ({why429(risk.liveErr)}). The Risk page runs it.</p>}
                {riskOn && !rep && risk.err && <p className="th-tight">The risk report could not be read ({why429(risk.err)}).</p>}
                {!riskOn && <p className="th-tight">Limits and risk by tenor are part of Market risk, which is {off('MARKET_RISK')} for this desk.</p>}
              </>}
          {path}
        </div>
        <div className="th-needs" data-testid="th-needs">
          <div className="th-k">NEEDS YOU <b className={actions.length ? 'on' : ''}>{life.data || unread ? actions.length : '…'}</b></div>
          {life.err && !life.data && <div className="lf-empty">Could not load the desk feed ({life.err}).</div>}
          {life.data && !actions.length && <div className="lf-empty">Nothing is waiting for you.</div>}
          <ul className="lf-list">
            {actions.slice(0, NEEDS).map((a, i) => {
              const [chip, tn] = KIND[a.kind] || [a.kind, '']
              return (
                <li key={i} className={a.href || a.chat ? 'go' : ''} onClick={() => go(a)}
                    {...(a.href || a.chat ? { tabIndex: 0, role: 'button', onKeyDown: pressKey(() => go(a)) } : {})}>
                  <span className={`lf-chip ${tn}`}>{chip}</span>
                  <span className="lf-t"><b>{a.title}</b><small>{a.detail}</small></span>
                  <span className="lf-when">{a.since ? ago(a.since) : ''}</span>
                </li>
              )
            })}
          </ul>
          {actions.length > NEEDS && <div className="th-note" data-testid="th-more">{more(actions.slice(NEEDS))}</div>}
        </div>
      </section>

      <section className="th-hero">
        <Statement on={pnlOn} off={off('PNL')} st={pnl} rep={riskOn ? rep : null} trades={trades} pending={pending} confirmed={confirmed} navigate={navigate} />
        <Streams on={riskOn} off={off('MARKET_RISK')} st={risk} list={list} fl={fl} any={trades.length > 0} />
        <Factors on={riskOn} rep={rep} list={list} marks={marks} fl={fl} any={trades.length > 0} navigate={navigate} />
      </section>

      <section className="th-two">
        <div className="th-panel" data-testid="th-trades">
          <div className="th-hd"><span className="th-k">YOUR TRADES</span><span className="th-links"><button className="dh-link" onClick={() => navigate('/configurations/market-data/crypto')}>FX · CRYPTO CURVES →</button><button className="dh-link" onClick={() => navigate('/blotter')}>OPEN BLOTTER →</button></span></div>
          {trades.length > 0
            ? <table className="th-t">
                <thead><tr><th>TRADE</th><th>WHAT</th><th className="r">NOTIONAL</th><th className="r">MATURITY</th><th className="r">STATUS</th></tr></thead>
                <tbody>
                  {trades.slice(0, 7).map(t => (
                    <tr key={t.id} tabIndex={0} onClick={() => navigate('/blotter')} onKeyDown={e => { if (e.key === 'Enter') navigate('/blotter') }}>
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
        <Tabs pnlOn={pnlOn} pnl={pnl} fixings={riskOn ? rep?.fixings : null} fixOn={riskOn && trades.length > 0} fixLoading={risk.loading || risk.behind === 'running'} news={d.news || []} loading={d.loading} hasTrades={trades.length > 0} life={life} explorer={explorer} demo={demo} chainEmpty={chainEmpty} navigate={navigate} />
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

function Statement({ on, off, st, rep, trades, pending, confirmed, navigate }) {
  const s = st.data
  const rows = statement(s)
  const theta = carry(rep)
  const gross = Object.entries(trades.reduce((m, t) => { const c = t.notional_ccy || 'USD'; m[c] = (m[c] || 0) + Number(t.notional || 0); return m }, {}))
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
        {theta != null && <div className="th-mark"><span>ONE DAY&apos;S CARRY</span><b className={`fig ${tone(theta)}`}>{signed(theta)}</b></div>}
        {s?.problems > 0 && <div className="th-note">{s.problems} trade{s.problems > 1 ? 's' : ''} not explained · see the P&amp;L page</div>}
        {trades.length > 0 && <button className="dh-link th-more" onClick={() => navigate('/pnl')}>ATTRIBUTION AND SIGN-OFF →</button>}
      </> : <>
        <div className="th-hd"><span className="th-k">YOUR BOOK · USD</span></div>
        <div className={`th-big ${tone(rep?.ladder?.npv_usd)}`}>{rep ? signed(rep.ladder?.npv_usd) : '—'}</div>
        <div className="th-split"><span>THE BOOK&apos;S MARK{rep?.date ? ` ON ${fmtDay(rep.date).toUpperCase()}` : ''}</span></div>
        <div className="th-note">P&amp;L is {off} for this desk.</div>
      </>}
      <div className="th-count">
        <span><b>{trades.length}</b> TRADES</span><span><b>{pending}</b> PENDING</span><span><b>{confirmed}</b> CONFIRMED</span>
        {gross.length > 0 && <span className="th-gross">GROSS {gross.map(([c, n]) => <b key={c}>{c} {fmtM(n)}</b>)}</span>}
      </div>
    </div>
  )
}

// The picture: one stream for each risk factor, along the tenor bucket the risk sits in: a box for each bucket, as
// tall as what it carries and with its figure, joined by the stream's line. Above its line the book is long that
// factor, below it short; where there is no risk the line is bare.
function Streams({ on, off, st, list, fl, any }) {
  const { drawn, rest } = useMemo(() => lanes(list), [list])
  // One scale: the sensitivity itself, each factor to its own, so a box's figure is in the unit of the figure
  // beside the factor's name and a part of it. (Until 0.40.0 a switch offered two more: the share of a limit, and
  // USD on a usual day. What a usual day moves a box by is in the tip; a limit is the ruled line and the gauge.)
  const mode = 'raw', lim = canLimit(drawn, fl)
  const empty = on && !st.loading && !st.err && drawn.length === 0
  // for the note under the picture: whether a stream is on a scale of its own, and whether a tenor was left without a column
  const sc = useMemo(() => scene(drawn, mode, fl), [drawn, mode, fl])
  const left = useMemo(() => { const cols = columns(drawn); return drawn.some((f, k) => laneMarks(f, sc[k], cols).left > 0) }, [drawn, sc])
  return (
    <div className="th-pic" data-testid="th-river">
      <div className="th-hd">
        <div><span className="th-k">WHERE YOUR RISK SITS</span>
          <div className="th-sub">{!on ? 'part of Market risk' : 'the sensitivity at each quoted tenor · each factor to its own scale'}</div></div>
      </div>
      {!on && <div className="th-blank">Risk by tenor is part of Market risk, which is {off} for this desk.</div>}
      {on && !any && <div className="th-blank">No risk yet. Book a trade and its risk is drawn here, one stream for each factor.</div>}
      {on && any && st.loading && <div className="th-blank">Measuring the book…</div>}
      {on && any && st.err && !st.data && <div className="th-blank">The risk report could not be read ({why429(st.err)}). The Risk page can run it again.</div>}
      {on && any && empty && <div className="th-blank">The book carries no risk the ladder measures on {fmtD(st.data?.date)}.</div>}
      {on && drawn.length > 0 && <River drawn={drawn} mode={mode} fl={fl} asOf={st.data?.date} />}
      {on && drawn.length > 0 && <div className="th-note">A box is what the book carries at one quoted tenor of a curve, with its sensitivity written at it, in the unit beside the factor's name. The line joins the boxes. A spot delta has no tenor of its own: it is one box across the bucket its trade matures in.{left ? ' A tenor carrying under 3% of its factor\'s largest has no column here, so a lane\'s boxes can come to less than the figure beside its name; the Risk page lists every one.' : ''}{lim ? ' A ruled line across a bucket is that bucket\'s limit, above the stream\'s line for a long position and below it for a short one, ending in the share used. A limit on a factor\'s total is the gauge at the start of its lane.' : ''}{rest.length ? ` Not drawn, smaller: ${rest.map(f => `${f.name} ${f.measure}`).join(', ')}.` : ''}</div>}
    </div>
  )
}

// What the tip says of a bucket's limit: its own, or that the limit is on the factor's total.
function tipLimit(ag, i) {
  const p = ag?.per[i]
  if (p) return <em className={p.state}> {Math.round(Math.abs(p.u) * 100)}% of {fmt0(p.limit)}</em>
  return ag?.total ? <em> its limit is on the total</em> : null
}

// The lanes' names on the left, the drawing on the right, the tip under the pointer. Mounted only when there is a
// factor to draw, so the box it measures is there from its first frame.
//
// Along the picture, nearest first: a column for each quoted tenor some factor carries materially, grouped by the
// four buckets (trader-home.js columns). In its lane a factor has a box in the column of each tenor it carries; a
// factor with no tenor of its own (a spot delta, a flat curve) has one box across the bucket it is placed in.
function River({ drawn, mode, fl, asOf }) {
  const box = useRef(null), cv = useRef(null), tip = useRef(null), at = useRef({ x: 0, y: 0 }), w = useWidth(box)
  const hotRef = useRef(-1), redraw = useRef(null)
  const hs = useMemo(() => scene(drawn, mode, fl), [drawn, mode, fl])
  const cols = useMemo(() => columns(drawn), [drawn])
  const laid = useMemo(() => drawn.map((f, k) => laneMarks(f, hs[k], cols).marks.map(m => ({ ...m, full: markFigure(f, m, mode), short: markFigure(f, m, mode, true) }))), [drawn, hs, cols, mode])
  const [hot, setHot] = useState(-1)
  const reach = useMemo(() => bucketReach(asOf), [asOf])
  const ticks = cols.slots.some(s => s.tenor != null)                // a row of tenors over the buckets' names
  const AXIS = ticks ? 56 : 40, n = drawn.length
  const gut = hs.some(h => h.total) ? GUTTER : 0          // room at the lanes' start for the gauge of a limit on a total, and its figure
  const height = Math.max(300, Math.min(700, n * 96)) + AXIS          // a lane of 96px: a box of a third of it either side of the line, and room past the tallest for its figure
  // where each column starts: every column of a bucket is as wide as the others', and a bucket is at least two
  // columns wide, so that its name has room under it
  const edges = useMemo(() => {
    const units = cols.groups.map(g => Math.max(2, g.to - g.from)), all = units.reduce((a, b) => a + b, 0), out = []
    let x = gut
    cols.groups.forEach((g, gi) => { const each = (w - gut) / all * units[gi] / (g.to - g.from); for (let k = g.from; k < g.to; k++) { out.push(x); x += each } })
    out.push(w)
    return out
  }, [cols, w, gut])

  useEffect(() => {
    const c = cv.current
    if (!c || !w) return undefined
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = w, H = height
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
    const g = c.getContext('2d')
    const css = getComputedStyle(document.documentElement)
    const colours = drawn.map(f => css.getPropertyValue(RISK_FACTORS[f.factor].token).trim() || T.textDim)
    const top = 6, bottom = H - AXIS, lane = (bottom - top) / n, amp = lane / 3          // a third, so the figure of a lane's tallest box is written past it and still in its own lane
    const gx0 = (i) => edges[cols.groups[i].from], gx1 = (i) => edges[cols.groups[i].to]
    // a mark's box, about the middle of the columns it stands in. A point's is four fifths of the narrowest column,
    // so every point's box is as wide as every other's; a bucket drawn whole is four fifths of the bucket.
    const unit = Math.min(...cols.slots.map((_, k) => edges[k + 1] - edges[k]))
    const boxOf = (m) => { const x0 = edges[m.from], span = edges[m.to] - x0, bw = Math.min((m.tenor ? unit : span) * 0.8, 260); return { x: x0 + span / 2 - bw / 2, w: bw, cx: x0 + span / 2, span } }
    // the stream's line: nothing at either edge, each box's height at its middle, the line's own level in a bucket
    // the factor does not carry; a cosine between them, so the line never rises past a box's own figure
    const nodes = (ms) => {
      const pts = ms.map(m => [boxOf(m).cx, m.h])
      cols.groups.forEach(gr => { if (!ms.some(m => m.i === gr.i)) pts.push([(gx0(gr.i) + gx1(gr.i)) / 2, 0]) })
      return [[gut, 0], ...pts.sort((a, b) => a[0] - b[0]), [W, 0]]
    }
    const yAt = (nd, x) => { let k = 0; while (k < nd.length - 2 && x > nd[k + 1][0]) k++; const [x0, y0] = nd[k], [x1, y1] = nd[k + 1], u = Math.max(0, Math.min(1, (x - x0) / (x1 - x0 || 1))); return y0 + (y1 - y0) * (1 - Math.cos(Math.PI * u)) / 2 }
    const xs = []; for (let x = gut; x <= W; x += 4) xs.push(x)
    const shape = drawn.map((f, k) => { const base = top + lane * (k + 0.5), nd = nodes(laid[k]); return { base, ys: xs.map(x => base - yAt(nd, x) * amp) } })
    const still = reduced()
    let raf = 0, last = -FRAME_MS
    const draw = (ms) => {
      if (!still) raf = requestAnimationFrame(draw)
      if (!still && ms - last < FRAME_MS) return
      last = ms
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.globalAlpha = 1; g.setLineDash([]); g.shadowBlur = 0; g.globalCompositeOperation = 'source-over'
      g.textAlign = 'center'; g.textBaseline = 'alphabetic'
      const hot = hotRef.current, wide = (t) => g.measureText(t).width
      if (hot >= 0 && hot < cols.slots.length) { g.fillStyle = alpha(T.text, 0.035); g.fillRect(edges[hot], top, edges[hot + 1] - edges[hot], bottom - top) }
      // the axis: each column's tenor, then the bucket the columns belong to and the year it reaches
      g.font = `11px ${MONO}`
      if (ticks) cols.slots.forEach((sl, k) => {
        if (!sl.tenor || wide(sl.tenor) > edges[k + 1] - edges[k] - 2) return
        g.fillStyle = k === hot ? T.textHi : T.text; g.fillText(sl.tenor, (edges[k] + edges[k + 1]) / 2, bottom + 16)
      })
      cols.groups.forEach((gr, gi) => {
        const x0 = gx0(gr.i), x1 = gx1(gr.i), room = x1 - x0 - 6, y = bottom + (ticks ? 34 : 18), lit = hot >= gr.from && hot < gr.to
        if (gi || gut) { g.strokeStyle = alpha(T.border, 0.7); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, top); g.lineTo(x0, bottom + 4); g.stroke() }
        const name = wide(BUCKET_LABEL[BUCKETS[gr.i]]) <= room ? BUCKET_LABEL[BUCKETS[gr.i]] : BUCKETS[gr.i]          // a narrow bucket takes its short name
        g.fillStyle = lit ? T.textHi : T.textDim; g.fillText(name, (x0 + x1) / 2, y)
        if (wide(reach[gr.i]) <= room) { g.fillStyle = T.textMute; g.fillText(reach[gr.i], (x0 + x1) / 2, y + 15) }
      })
      // which way is which, said once: above a stream's line the book is long, below it short
      g.font = `10px ${MONO}`; g.textAlign = 'right'; g.fillStyle = T.textMute
      g.fillText('LONG ▲', W - 4, top + 10); g.fillText('SHORT ▼', W - 4, top + lane - 5); g.textAlign = 'center'
      drawn.forEach((f, k) => {
        const { base, ys } = shape[k], c = colours[k], own = hs[k].own || hs[k].none, ms = laid[k]
        const tall = (m) => Math.max(2, Math.abs(m.h) * amp), side = (m) => (m.h || m.x) >= 0 ? 1 : -1
        const boxes = ms.map(boxOf)
        // the stream's line is drawn where the stream stands off its base and no box does: it joins the boxes and
        // does not run through one (or through the figure in it)
        const boxed = (x) => boxes.some(b => x > b.x && x < b.x + b.w)
        const live = (i) => Math.abs(ys[i] - base) > 1.2 && !boxed(xs[i])
        // which figures are written, and where: figureAt (in its own lane, clear of the bucket's limit line where
        // it can be) and laneFigures (the largest boxes first; one that would run into another figure or another
        // box is left to the tip). Worked out before the limit lines are drawn: a figure that has to stand on a
        // line is given a break in it.
        g.font = `500 12.5px ${MONO}`
        const items = ms.map((m, j) => {
          const b = boxes[j], line = hs[k].bank[m.i], hgt = tall(m), sd = side(m)
          const at = figureAt({ side: sd, base, tall: hgt, line: line == null ? null : line * amp, half: lane / 2 })
          return { cx: b.cx, y: Math.max(top + 10, Math.min(bottom - 3, at.y)), inside: at.inside, onLine: !!at.onLine, i: m.i, sd, box: [b.x, sd > 0 ? base - hgt : base, b.x + b.w, sd > 0 ? base : base + hgt], full: m.full, short: m.short, size: m.h }
        })
        const figs = laneFigures(items, wide, { x0: gut + 2, x1: W - 2 })
        const breaks = (i, sd) => figs.map((fg, j) => fg && items[j].onLine && items[j].i === i && items[j].sd === sd ? [fg.x - 4, fg.x + fg.w + 4] : null).filter(Boolean)
        g.strokeStyle = alpha(c, 0.28); g.lineWidth = 1; g.beginPath(); g.moveTo(0, base); g.lineTo(W, base); g.stroke()
        // a bucket's own limit: a ruled line across the bucket's columns above the stream's line and one below,
        // hatched on the far side. On the side the position is on, the line ends in the share of the limit used, in
        // the colour of its state.
        g.font = `500 11px ${MONO}`
        hs[k].bank.forEach((b, i) => {
          if (b == null) return
          const t = hs[k].tags[i], pct = t ? `${Math.round(Math.abs(t.u) * 100)}%` : '', on = t ? (t.u < 0 ? -1 : 1) : 0
          for (const sd of [1, -1]) {
            // the line in pieces, either side of a figure that stands on it; the share is then left to the tip and to
            // the gauge beside the factor (a figure and a share do not both fit on a bucket's line)
            const cuts = breaks(i, sd).sort((p, q) => p[0] - q[0]), parts = []
            const y = base - sd * b * amp, x0 = gx0(i) + 5, said = pct && sd === on && !cuts.length, x1 = gx1(i) - 5 - (said ? wide(pct) + 5 : 0)
            let from = x0
            for (const [l, r] of cuts) { if (l - from >= 12) parts.push([from, Math.min(l, x1)]); from = Math.max(from, r) }          // a piece under 12px would read as a stray mark
            if (x1 - from >= 12) parts.push([from, x1])
            for (const [l, r] of parts) {
              g.strokeStyle = alpha(T.textHi, 0.6); g.lineWidth = 1; g.beginPath(); g.moveTo(l, y); g.lineTo(r, y); g.stroke()
              g.strokeStyle = alpha(T.textMute, 0.45)
              for (let x = l; x < r - 4; x += 7) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y - sd * 4); g.stroke() }
            }
            if (said) { g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = t.state === 'BREACH' ? T.down : t.state === 'WARN' ? T.amber : T.textDim; g.fillText(pct, gx1(i) - 5, y - sd * 2); g.textAlign = 'center'; g.textBaseline = 'alphabetic' }
          }
        })
        // the total against the total's limit: a gauge at the lane's start, the limit a tick at either end
        const tot = hs[k].total
        if (tot) {
          const far = amp * 0.85, gx = 6, u = Math.max(-1.18, Math.min(1.18, tot.u)), col = tot.state === 'BREACH' ? T.down : tot.state === 'WARN' ? T.amber : T.textDim
          g.strokeStyle = alpha(T.borderHi, 0.9); g.lineWidth = 1; g.beginPath(); g.moveTo(gx, base - far); g.lineTo(gx, base + far); g.stroke()
          g.strokeStyle = alpha(T.textHi, 0.8); g.lineWidth = 1.5
          for (const sd of [1, -1]) { g.beginPath(); g.moveTo(gx - 4, base - sd * far); g.lineTo(gx + 4, base - sd * far); g.stroke() }
          g.fillStyle = col; g.fillRect(gx - 2, Math.min(base, base - u * far), 4, Math.abs(u * far))
          g.font = `500 11px ${MONO}`; g.textAlign = 'left'; g.fillText(`${Math.round(Math.abs(tot.u) * 100)}%`, gx + 7, tot.u < 0 ? base + 13 : base - 5); g.textAlign = 'center'          // in the gutter beside the gauge, on the side the position is on
        }
        const edge = () => { g.beginPath(); let pen = false; xs.forEach((x, i) => { if (!live(i)) { pen = false; return } pen ? g.lineTo(x, ys[i]) : g.moveTo(x, ys[i]); pen = true }) }
        // the stream's line, between the boxes: it joins them, and the boxes say how much
        g.strokeStyle = c; g.globalAlpha = own ? 0.35 : 0.5; g.lineWidth = 1.2; edge(); g.stroke()
        if (!still && !own) {                               // light running along the line, toward the far tenors
          g.globalCompositeOperation = 'lighter'; g.strokeStyle = T.textHi; g.globalAlpha = 0.5; g.lineWidth = 1.6
          g.setLineDash([16, 120]); g.lineDashOffset = -ms * 0.035 - k * 37; edge(); g.stroke(); g.setLineDash([]); g.globalCompositeOperation = 'source-over'
        }
        g.globalAlpha = 1
        // a box for each mark, as tall as what it carries on the lane's scale, on the side of the line the stream is
        // on: above it long, below it short (a stream on a scale of its own has dashed boxes)
        ms.forEach((m, j) => {
          const b = boxes[j], hgt = tall(m), y = side(m) > 0 ? base - hgt : base, lit = hot >= m.from && hot < m.to
          g.fillStyle = alpha(c, lit ? 0.36 : 0.24); g.fillRect(b.x, y, b.w, hgt)
          g.strokeStyle = alpha(c, 0.85); g.lineWidth = 1; g.setLineDash(own ? [4, 3] : [])
          g.strokeRect(b.x + 0.5, y + 0.5, Math.max(1, b.w - 1), Math.max(1, hgt - 1)); g.setLineDash([])
        })
        // at each box, what it carries (laid out above, before the limit lines)
        g.font = `500 12.5px ${MONO}`; g.textAlign = 'left'
        figs.forEach((fg, j) => { if (fg) { g.fillStyle = T.textHi; g.fillText(fg.fig, fg.x, items[j].y) } })
        g.textAlign = 'center'
      })
    }
    raf = requestAnimationFrame(draw)
    redraw.current = still ? () => draw(0) : null          // moving, the next frame reads the column; still, it is drawn when it changes
    return () => { cancelAnimationFrame(raf); redraw.current = null }
  }, [drawn, hs, laid, cols, edges, ticks, w, height, n, reach, gut, AXIS])
  useEffect(() => { hotRef.current = hot; redraw.current?.() }, [hot])

  // The tip follows the pointer by its own style, not by a render: only entering another column draws the page again.
  // (it is kept inside the picture: where it is wider than what is left of the drawing it reaches back over the lanes' names, not over the column beside)
  const place = () => { const t = tip.current; if (t) { t.style.left = `${Math.min(at.current.x, (box.current?.clientWidth || 0) - t.offsetWidth - 2)}px`; t.style.top = `${at.current.y}px` } }
  useLayoutEffect(place)
  const move = (e) => {
    const r = box.current.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top
    let i = 0; while (i < cols.slots.length - 1 && x >= edges[i + 1]) i++
    at.current = { x: x + 16, y: Math.max(4, Math.min(y - 24, r.height - AXIS - 22 * (n + 1))) }
    place()
    if (i !== hot) setHot(i)
  }
  const sl = hot >= 0 ? cols.slots[hot] : null
  // what each factor carries in the column under the pointer: its point there, or the bucket it is drawn whole in
  const under = sl ? drawn.map((f, k) => ({ f, k, m: laid[k].find(m => hot >= m.from && hot < m.to) })).filter(x => x.m) : []

  return (
    <div className="th-river">
      <div className="th-lanes" style={{ height: height - AXIS }}>
        {drawn.map((f, k) => (
          <div key={f.key} className="th-lane" data-factor={f.key}>
            <span className="th-lane-n"><span className="rf-mark" style={{ background: `var(${RISK_FACTORS[f.factor].token})` }} />{f.name} · {f.measure}</span>
            <span className="th-lane-v"><b className={`fig ${tone(f.total)}`}>{signed(f.total)}</b> {f.unit}{hs[k].own && <em className="th-lane-own"> · own scale</em>}{hs[k].none && <em className="th-lane-own"> · no limit</em>}</span>
          </div>
        ))}
      </div>
      <div className="th-cv" ref={box} style={{ height }} onMouseMove={move} onMouseLeave={() => setHot(-1)}>
        <canvas ref={cv} style={{ height }} role="img" aria-label={`Risk by factor and quoted tenor: ${drawn.map((f, k) => `${f.name} ${f.measure} ${signed(f.total)} ${f.unit}${laid[k].some(m => m.tenor) ? ` (${laid[k].filter(m => m.tenor).map(m => `${m.tenor} ${signed(m.x)}`).join(', ')})` : ''}`).join('; ')}`} />
        {sl && (
          <div className="th-tip" ref={tip}>
            <div className="th-tip-h">{sl.tenor ? `${sl.tenor} · ` : ''}{BUCKET_LABEL[BUCKETS[sl.i]]} · {reach[sl.i]}</div>
            {under.map(({ f, k, m }) => (
              <div key={f.key}><span><span className="rf-mark" style={{ background: `var(${RISK_FACTORS[f.factor].token})` }} />{f.name} {f.measure}</span>
                <span><b className={`fig ${tone(m.x)}`}>{signed(m.x)}</b>{m.day != null ? <em> ≈ {fmt0(m.day)} a day</em> : null}
                  {m.tenor ? (hs[k].against?.per[m.i] ? <em> · its bucket</em> : null) : (sl.tenor ? <em> · across the bucket</em> : null)}{tipLimit(hs[k].against, m.i)}</span></div>
            ))}
            {!under.length && <div><span className="mute">{sl.tenor ? 'no risk at this tenor' : 'no risk in this bucket'}</span></div>}
          </div>
        )}
      </div>
    </div>
  )
}

function Factors({ on, rep, list, marks, fl, any, navigate }) {
  if (!on) return <aside className="th-side" data-testid="th-factors"><div className="th-k">YOUR RISK BY FACTOR</div><div className="lf-empty">Shown with Market risk.</div></aside>
  const pk = list.map(peak), top = Math.max(0, ...pk.map(p => p?.usd || 0))
  const v = rep?.var || {}
  const conf = v.confidence != null ? `${Math.round(v.confidence * 1000) / 10}%` : ''
  const on_ = shownOn(list, fl), others = marks.filter(m => !on_.has(m.id))          // a limit drawn on its factor above is not listed again
  return (
    <aside className="th-side" data-testid="th-factors">
      <div><div className="th-k">YOUR RISK BY FACTOR</div><div className="th-sub">{canLimit(list, fl) ? 'against its limit, where it has one' : 'its sensitivity, and its largest bucket on a usual day'}</div></div>
      {list.length === 0 && <div className="lf-empty">{rep || !any ? 'Nothing to measure yet.' : '…'}</div>}
      {list.map((f, i) => {
        const hd = against(f, limitsOf(f, fl))?.head
        return (
          <div key={f.key} className="th-row" data-factor={f.key}>
            <span className="th-row-n"><span className="rf-mark" style={{ background: `var(${RISK_FACTORS[f.factor].token})` }} />{f.name} <small>{f.measure}</small></span>
            <b className={`fig ${tone(f.total)}`}>{signed(f.total)}</b>
            {hd
              // against its limit: flat in the middle, the limit at a fifth from either end, the position from the middle out
              ? <span className="th-gauge" data-testid="th-gauge"><i className={hd.state} style={{ [hd.pos < 0 ? 'right' : 'left']: '50%', width: `${Math.min(50, Math.abs(hd.u) * 40)}%` }} /><em style={{ left: '10%' }} /><em style={{ left: '90%' }} /></span>
              : <span className="th-bar"><i style={{ width: `${top && pk[i] ? Math.max(2, pk[i].usd / top * 100) : 0}%`, background: `var(${RISK_FACTORS[f.factor].token})` }} /></span>}
            {hd
              ? <small className="th-row-d th-row-l"><span><b className={`fig ${hd.state}`}>{Math.round(Math.abs(hd.u) * 100)}%</b> of {fmt0(hd.limit)}{hd.standard ? ', the standard' : ''}{hd.bucket ? ` · ${BUCKET_LABEL[hd.bucket]}` : ''} · {hd.pos < 0 ? 'short' : 'long'}</span><span>{hd.room >= 0 ? <><b className="fig">{fmt0(hd.room)}</b> of room</> : <><b className="fig BREACH">{fmt0(-hd.room)}</b> past it</>}</span></small>
              : <small className="th-row-d">{pk[i] ? <>≈ <b className="fig">{fmt0(pk[i].usd)}</b> a day · {BUCKET_LABEL[pk[i].bucket]}</> : 'no usual move is measured for it'}</small>}
          </div>
        )
      })}
      {rep && <div className="th-tot" data-testid="th-var">
        <span>VaR {conf} · 1 day</span><b className="fig">{v.var_1d != null && v.enough !== false ? fmt0(v.var_1d) : '—'}</b>
        {v.enough === false && <small>{v.observations ?? 0} days of history: too few for a VaR</small>}
      </div>}
      {others.length > 0 && <>
        <div className="th-k th-k2">{others.length < marks.length ? 'OTHER LIMITS' : 'LIMITS'}</div>
        <div className="th-lims" data-testid="th-limits">
          {others.slice(0, 5).map(m => (
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

function Tabs({ pnlOn, pnl, fixings, fixOn, fixLoading, news, loading, hasTrades, life, explorer, demo, chainEmpty, navigate }) {
  const mv = moved(pnl.data)
  // what fixes next is first: it is what is hedged day to day. The tab is there from the first frame for a book
  // with risk to measure, so it is not put in front of a reader who has begun on another when the report arrives
  const tabs = [fixOn && ['fix', 'FIXINGS'], pnlOn && hasTrades && ['moved', 'WHAT MOVED'], ['chain', 'ON CHAIN'], ['rates', 'RATES'], ['week', 'WEEK AHEAD'], ['news', 'NEWS'], hasTrades && ['brief', 'BRIEF']].filter(Boolean)
  const [tab, setTab] = useState(null)
  const cur = tabs.some(t => t[0] === tab) ? tab : tabs[0][0]
  const s = pnl.data, anchors = life.data?.anchors || []
  return (
    <div className="th-panel" data-testid="th-tabs">
      <div className="tbw-tabs th-tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={cur === k} className={`tbw-tab${cur === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="th-tabbody" role="tabpanel" data-tab={cur}>
        {cur === 'fix' && <>
          <div className="th-sub">what resets next · net notional by index, and 1bp on that day&apos;s fixing · USD</div>
          <Fixings fx={fixings} compact loading={fixLoading} onOpen={() => navigate('/risk')} />
        </>}
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
        {cur === 'chain' && <>
          <div className="th-hd"><span className="th-sub">your latest confirmations, each with its proof</span>{anchors.length > 0 && <a className="dh-link" href="https://rijeka.app/verify" target="_blank" rel="noopener noreferrer">REGISTER ↗</a>}</div>
          {life.err && !life.data && <div className="lf-empty">Could not load the desk feed ({life.err}).</div>}
          {life.data && !anchors.length && <>
            {chainEmpty}
            <div className="dh-text">Both parties sign the canonical record; the registry keeps the hash and both addresses. Anyone can recompute and recover them without asking Rijeka.</div>
          </>}
          <ul className="lf-list anchors" data-testid="th-anchors">
            {anchors.slice(0, 6).map((a, i) => (
              <li key={a.tx_hash || i}>
                <span className={`lf-chip ${a.anchored ? (a.bilateral ? 'ok' : '') : 'red'}`}>{a.anchored ? (a.bilateral ? 'BILATERAL' : 'ANCHORED') : 'OFF-CHAIN'}</span>
                <span className="lf-t"><b>{a.trade_ref}</b><small>{[a.product, a.counterparty].filter(Boolean).join(' · ')}{a.block_number ? ` · block ${Number(a.block_number).toLocaleString()}` : ''}</small></span>
                <span className="lf-when">{a.explorer_tx || a.tx_hash ? <a href={a.explorer_tx || `${explorer}/tx/${a.tx_hash}`} target="_blank" rel="noopener noreferrer">PROOF ↗</a> : ago(a.confirmed_at)}</span>
              </li>
            ))}
          </ul>
          {demo?.enabled && <div className="th-note">Demo: Rijeka holds {demo.counterparty?.name || 'the demo bank'}&apos;s key, so a confirmation you make alone is marked ANCHORED, not BILATERAL.</div>}
        </>}
        {cur === 'rates' && <PolicyPath onCurves={() => navigate('/configurations/market-data/curves')} />}
        {cur === 'week' && <WeekAhead />}
        {cur === 'news' && <>
          <ul className="dh-news th-news">
            {news.map(n => (
              <li key={n.url} className={n.summary ? 'has-summary' : ''}>
                <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a>
                {n.summary && <div className="dh-news-sum">
                  {String(n.summary).split(/\n+/).map((p, i) => <p key={i} className={/^why it matters/i.test(p) ? 'why' : ''}>{p}</p>)}
                  <span className="dh-news-basis">AI summary · {n.summary_basis === 'article' ? 'from the article' : 'from the feed blurb'}</span>
                </div>}
                <span className="dh-news-meta">{n.source} · {ago(n.published_at)}{n.tags?.[0] ? ` · ${n.tags[0]}` : ''}</span>
              </li>
            ))}
            {!loading && !news.length && <li className="dh-empty">No headlines yet.</li>}
          </ul>
          <button className="dh-link th-more" onClick={() => navigate('/messenger')}>OPEN THE NEWS ROOM →</button>
        </>}
        {cur === 'brief' && <BookBrief onSheet={() => {}} />}
      </div>
    </div>
  )
}
