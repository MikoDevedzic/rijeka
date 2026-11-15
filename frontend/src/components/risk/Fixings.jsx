// risk/Fixings.jsx — what fixes, day by day. On the Market risk page: a picture an index of the net notional that
// resets on each coming business day, the days as a table (what is received, what is paid, the net, and what one
// basis point on that day's fixing is worth), and the non-deliverable forwards that fix on a date. On the home
// (compact): what resets next. Read from the risk report's `fixings` (backend/risk/fixings.py); nothing is
// computed here.
import { useState } from 'react'
import { byDate, series, notCovered, any, mn, units, day, indexName } from './fixing-ladder'
import './Fixings.css'

const fmt = (n) => n == null || isNaN(n) ? '—' : Math.round(Math.abs(n)).toLocaleString('en-US')
// a figure under a hundred keeps a decimal: 1bp on one day's fixing of 10m is 2.8, not 3
const sgn = (n) => n == null || isNaN(n) ? '—' : Math.abs(n) < 0.05 ? '0' : `${n > 0 ? '+' : '−'}${Math.abs(n) < 100 ? Math.abs(n).toFixed(1) : fmt(n)}`
const tone = (n) => n > 0.5 ? 'pos' : n < -0.5 ? 'neg' : ''
const SHORT = 10                    // business days listed before SHOW ALL

// The net notional that resets on each listed day: a bar a day from the line at nought, up where the desk receives
// the fixing. The first bar is the next fixing; the scale's top is written beside it, and the dates under its ends.
function Bars({ s }) {
  const W = 6, H = 44, n = s.points.length
  return (
    <div className="fxg-pic">
      <svg className="fxg-bars" viewBox={`0 0 ${n * W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${indexName(s.index)}: net notional resetting on each of ${n} days, from ${day(s.points[0].date)} to ${day(s.points[n - 1].date)}; the largest is ${mn(s.top)}`}>
        <line x1="0" x2={n * W} y1={H / 2} y2={H / 2} className="fxg-zero" vectorEffect="non-scaling-stroke" />
        {s.points.map((p, i) => { const h = s.top ? Math.abs(p.net) / s.top * (H / 2 - 2) : 0; return <rect key={p.date} x={i * W + 1} y={p.net >= 0 ? H / 2 - h : H / 2} width={W - 2} height={Math.max(h, 0.5)} className={i === 0 ? 'now' : ''}><title>{`${day(p.date)} ${mn(p.net)}`}</title></rect> })}
      </svg>
      <span className="fxg-ax top">{mn(s.top)}</span><span className="fxg-ax mid">0</span><span className="fxg-ax bot">{mn(-s.top)}</span>
    </div>
  )
}

export default function Fixings({ fx, compact = false, loading = false, onOpen }) {
  const [all, setAll] = useState(false)
  if (!fx) return <div className="fxg-none">{loading ? 'Measuring the book…' : 'The fixings are part of the risk report from 0.38.0: they are here from the next report.'}</div>
  if (!any(fx)) return <div className="fxg-none">Nothing in the book fixes in the next {fx.horizon_days || 92} days.{notCovered(fx) ? ` Not listed: ${notCovered(fx)} (an option on a fixing is a delta, not a notional).` : ''}</div>
  const ss = series(fx), days = byDate(fx, compact ? 5 : all ? 0 : SHORT), total = byDate(fx).length
  const many = ss.length > 1          // with one index its name is said once, not on every row
  const largest = (x) => x.points.reduce((a, p) => Math.abs(p.net) > Math.abs(a) ? p.net : a, 0)
  const flat = (n) => Math.abs(n) < 0.5 ? '—' : mn(n)
  const settles = compact ? (fx.settlements || []).slice(0, 3) : fx.settlements || []
  // both tables on one set of columns, so the second stands under the first
  const cols = compact ? <colgroup><col style={{ width: '38%' }} /><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /><col style={{ width: '18%' }} /></colgroup>
    : <colgroup><col style={{ width: '22%' }} /><col style={{ width: '16%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '16%' }} /><col style={{ width: '14%' }} /><col style={{ width: '8%' }} /></colgroup>
  return (
    <div className={`fxg${compact ? ' compact' : ''}`} data-testid="fixings">
      {!compact && <div className="fxg-idx">
        {ss.map(s => (
          <div key={s.index} className="fxg-ix" data-index={s.index}>
            <div className="fxg-ixh"><span className="rf-mark" style={{ background: 'var(--rf-ir)' }} /><b>{indexName(s.index)}</b><small>net resetting · {s.points.length} business days</small></div>
            <Bars s={s} />
            <div className="fxg-ixf"><span>NEXT · {day(s.points[0].date)}</span><span>largest <b className={`fig ${tone(largest(s))}`}>{mn(largest(s))}</b> · 1bp on every fixing listed <b className={`fig ${tone(s.f01)}`}>{sgn(s.f01)}</b></span><span>{day(s.points[s.points.length - 1].date)}</span></div>
          </div>
        ))}
      </div>}
      <table className="fxg-t">
        {cols}
        <thead><tr><th>FIXING</th><th>INDEX</th>{!compact && <><th className="r">RECEIVE</th><th className="r">PAY</th></>}<th className="r">NET RESETTING</th><th className="r">FIXING 01</th>{!compact && <th className="r">TRADES</th>}</tr></thead>
        <tbody>
          {days.map(d => d.rows.map((r, i) => (
            <tr key={`${d.date}${r.index}`} className={i === 0 ? 'first' : ''}>
              <td className="fig">{i === 0 ? <>{day(d.date)}{r.days > 1 && <small> counts {r.days} days</small>}</> : ''}</td>
              <td className={many || d === days[0] ? '' : 'fxg-same'}>{indexName(r.index)}</td>
              {!compact && <><td className="fig r">{flat(r.receive_usd)}</td><td className="fig r">{flat(r.pay_usd)}</td></>}
              <td className={`fig r ${tone(r.net_usd)}`}>{mn(r.net_usd)}</td>
              <td className={`fig r ${tone(r.fixing01_usd)}`}>{sgn(r.fixing01_usd)}</td>
              {!compact && <td className="fig r">{r.trades}</td>}
            </tr>
          )))}
        </tbody>
      </table>
      {!compact && total > SHORT && <button className="pnl-btn ghost fxg-more" onClick={() => setAll(a => !a)}>{all ? `FIRST ${SHORT} DAYS` : `ALL ${total} DAYS`}</button>}
      {settles.length > 0 && <>
        <div className="fxg-h">SETTLEMENT FIXINGS <small>a non-deliverable forward is settled against one published price</small></div>
        <table className="fxg-t">
          {cols}
          <thead><tr><th>FIXING</th><th>PAIR</th>{!compact && <th colSpan={2}>SOURCE</th>}<th className="r">NET THAT FIXES</th><th className="r">1% ON THE FIXING</th>{!compact && <th className="r">TRADES</th>}</tr></thead>
          <tbody>
            {settles.map(s => (
              <tr key={`${s.date}${s.pair}${s.source}`} className="first">
                <td className="fig">{day(s.date)}{s.note && <small className="fxg-warn" title="The trade names no fixing date, so its settlement date stands in; or a currency's fixing falls on a weekend, when none is published."> {s.note}</small>}</td><td>{s.pair}</td>{!compact && <td colSpan={2}>{s.source || '—'}</td>}
                <td className={`fig r ${tone(s.net_units)}`}>{units(s.net_units, s.unit)}</td>
                <td className={`fig r ${tone(s.spot01_usd)}`}>{sgn(s.spot01_usd)}</td>
                {!compact && <td className="fig r">{s.trades}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </>}
      {compact
        ? <button className="dh-link fxg-open" onClick={onOpen}>EVERY FIXING, ON THE RISK PAGE →</button>
        : <div className="fxg-foot">NET RESETTING is the notional whose floating rate is set by that day's fixing, in USD: + (above the line) where the desk receives it. A floating period resets on every business day it runs over, and a Friday's fixing counts for three days. FIXING 01 is what one basis point on that one fixing is worth, with its compounding; the method is in the methodology under market risk.{notCovered(fx) ? ` Not listed: ${notCovered(fx)} (an option on a fixing is a delta, not a notional), and option expiries.` : ''}{fx.embedded_options ? ` ${fx.embedded_options} floating leg${fx.embedded_options > 1 ? 's carry' : ' carries'} a cap or a floor and ${fx.embedded_options > 1 ? 'are' : 'is'} listed as the plain reset.` : ''}{(fx.problems || []).length ? <b className="fxg-bad"> {fx.problems.length} trade{fx.problems.length > 1 ? 's' : ''} could not be read: {fx.problems.slice(0, 3).map(p => p.trade_ref).filter(Boolean).join(', ')}.</b> : null}</div>}
    </div>
  )
}
