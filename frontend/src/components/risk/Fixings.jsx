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

function Bars({ s }) {
  const W = 6, H = 44, n = s.points.length
  return (
    <svg className="fxg-bars" viewBox={`0 0 ${n * W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${indexName(s.index)}: net notional resetting on each of ${n} days`}>
      <line x1="0" x2={n * W} y1={H / 2} y2={H / 2} className="fxg-zero" vectorEffect="non-scaling-stroke" />
      {s.points.map((p, i) => { const h = s.top ? Math.abs(p.net) / s.top * (H / 2 - 2) : 0; return <rect key={p.date} x={i * W + 1} y={p.net >= 0 ? H / 2 - h : H / 2} width={W - 2} height={Math.max(h, 0.5)} className={i === 0 ? 'now' : ''}><title>{`${day(p.date)} ${mn(p.net)}`}</title></rect> })}
    </svg>
  )
}

export default function Fixings({ fx, compact = false, onOpen }) {
  const [all, setAll] = useState(false)
  if (!fx) return <div className="fxg-none">The fixings are part of the risk report from 0.38.0: they are here from the next report.</div>
  if (!any(fx)) return <div className="fxg-none">Nothing in the book fixes in the next {fx.horizon_days || 92} days.{notCovered(fx) ? ` Not listed: ${notCovered(fx)} (an option on a fixing is a delta, not a notional).` : ''}</div>
  const ss = series(fx), days = byDate(fx, compact ? 5 : all ? 0 : SHORT), total = byDate(fx).length
  const settles = compact ? (fx.settlements || []).slice(0, 3) : fx.settlements || []
  return (
    <div className={`fxg${compact ? ' compact' : ''}`} data-testid="fixings">
      {!compact && <div className="fxg-idx">
        {ss.map(s => (
          <div key={s.index} className="fxg-ix" data-index={s.index}>
            <div className="fxg-ixh"><span className="rf-mark" style={{ background: 'var(--rf-ir)' }} /><b>{indexName(s.index)}</b><small>net resetting, {s.points.length} business days · above the line the desk receives the fixing</small></div>
            <Bars s={s} />
            <div className="fxg-ixf"><span>{day(s.points[0].date)}</span><span>largest <b className={`fig ${tone(s.points.reduce((a, p) => Math.abs(p.net) > Math.abs(a) ? p.net : a, 0))}`}>{mn(s.points.reduce((a, p) => Math.abs(p.net) > Math.abs(a) ? p.net : a, 0))}</b> · 1bp on every fixing listed <b className={`fig ${tone(s.f01)}`}>{sgn(s.f01)}</b></span><span>{day(s.points[s.points.length - 1].date)}</span></div>
          </div>
        ))}
      </div>}
      <table className="fxg-t">
        <thead><tr><th>FIXING</th><th>INDEX</th>{!compact && <><th className="r">RECEIVE</th><th className="r">PAY</th></>}<th className="r">NET RESETTING</th><th className="r">FIXING 01</th>{!compact && <th className="r">TRADES</th>}</tr></thead>
        <tbody>
          {days.map(d => d.rows.map((r, i) => (
            <tr key={`${d.date}${r.index}`} className={i === 0 ? 'first' : ''}>
              <td className="fig">{i === 0 ? <>{day(d.date)}{r.days > 1 && <small> counts {r.days} days</small>}</> : ''}</td>
              <td>{indexName(r.index)}</td>
              {!compact && <><td className="fig r">{mn(r.receive_usd)}</td><td className="fig r">{mn(r.pay_usd)}</td></>}
              <td className={`fig r ${tone(r.net_usd)}`}>{mn(r.net_usd)}</td>
              <td className={`fig r ${tone(r.fixing01_usd)}`}>{sgn(r.fixing01_usd)}</td>
              {!compact && <td className="fig r">{r.trades}</td>}
            </tr>
          )))}
        </tbody>
      </table>
      {!compact && total > SHORT && <button className="pnl-btn ghost fxg-more" onClick={() => setAll(a => !a)}>{all ? `THE NEXT ${SHORT} DAYS` : `ALL ${total} DAYS`}</button>}
      {settles.length > 0 && <>
        <div className="fxg-h">SETTLEMENT FIXINGS <small>a non-deliverable forward is settled against one published price</small></div>
        <table className="fxg-t">
          <thead><tr><th>FIXING</th><th>PAIR</th>{!compact && <th>SOURCE</th>}<th className="r">NET THAT FIXES</th><th className="r">1% ON THE FIXING</th>{!compact && <th className="r">TRADES</th>}</tr></thead>
          <tbody>
            {settles.map(s => (
              <tr key={`${s.date}${s.pair}${s.source}`} className="first">
                <td className="fig">{day(s.date)}{s.note && <small className="fxg-warn" title={s.note}> {compact ? 'check the date' : s.note}</small>}</td><td>{s.pair}</td>{!compact && <td>{s.source || '—'}</td>}
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
        : <div className="pnl-foot">NET RESETTING is the notional whose floating rate is set by that day's fixing, in USD: + where the desk receives the floating rate. Every floating period is compounded from an overnight index, so it resets on every business day it runs over; a Friday's fixing counts for three days. FIXING 01 is what one basis point on that one fixing is worth: notional × the period's accrual a day × the days it counts for × the discount factor to the payment × 1bp.{notCovered(fx) ? ` Not listed: ${notCovered(fx)} (an option on a fixing is a delta, not a notional), and option expiries.` : ''}{(fx.problems || []).length ? ` ${fx.problems.length} trade${fx.problems.length > 1 ? 's' : ''} could not be read.` : ''}</div>}
    </div>
  )
}
