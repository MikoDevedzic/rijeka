// The worked tables under §10 and §12 (worked-math.js has the arithmetic and says what they are not).
import { useState } from 'react'
import { cvaLine, ndf, readNumber } from './worked-math'

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—')
const tone = (x) => (x > 0.005 ? ' pos' : x < -0.005 ? ' neg' : '')

// rows: [key, what it is, decimals shown]; start: the sample values; rates: the keys read as a rate (no comma at all).
// Returns [texts, set, values (null where unreadable), reset].
function useInputs(rows, start, rates) {
  const first = () => Object.fromEntries(rows.map(([k, , d]) => [k, fmt(start[k], d)]))
  const [text, setText] = useState(first)
  const values = Object.fromEntries(rows.map(([k]) => [k, readNumber(text[k], { grouped: !rates.includes(k) })]))
  return [text, (k, v) => setText(t => ({ ...t, [k]: v })), values, () => setText(first())]
}
function InputRow({ id, addr, what, text, bad, onChange }) {
  return (
    <tr>
      {addr !== undefined && <td className="addr">{addr}</td>}
      <td>{what}</td><td className="f">an input: type over it</td>
      <td className="v"><input id={id} data-testid={id} inputMode="decimal" aria-label={what} aria-invalid={bad ? 'true' : 'false'} value={text} onChange={e => onChange(e.target.value)} /></td>
    </tr>
  )
}

const NDF_ROWS = [['S', 'Spot, USD per BTC', 2, 'B2'], ['rq', 'USD rate, % a year', 2, 'B3'], ['rc', 'BTC funding rate, % a year', 2, 'B4'], ['days', 'Days to settlement', 0, 'B5'], ['N', 'Notional, BTC', 2, 'B6'], ['K', 'Forward price agreed, USD', 2, 'B7']]
const NDF_START = { S: 100000, rq: 4, rc: 3, days: 91, N: 10, K: 100300 }
export function NdfCells() {
  const [text, set, v, reset] = useInputs(NDF_ROWS, NDF_START, ['rq', 'rc'])
  const r = ndf(v)
  const bad = (k) => v[k] == null || (k !== 'rq' && k !== 'rc' && !(v[k] > 0))
  const out = (id, x, d, coloured) => <td className={'v' + (r && coloured ? tone(x) : '')} data-testid={id} data-value={r ? x : ''}>{r ? fmt(x, d) : '—'}</td>
  return (
    <div className="mr-wb" data-testid="mr-worked-ndf">
      <div className="mr-wb-head"><span className="mr-lbl">EXCEL REPLICATION · CRYPTO NDF · THE KEY CELLS</span><span className="mr-tag amber">SAMPLE INPUTS, NOT TODAY'S MARKET</span>
        <button type="button" className="mr-btn" onClick={reset}>RESET</button></div>
      <div className="mr-wb-scroll"><table>
        <thead><tr><th>CELL</th><th>WHAT IT IS</th><th>FORMULA</th><th className="r">VALUE</th></tr></thead>
        <tbody>
          {NDF_ROWS.map(([k, what, , addr]) => <InputRow key={k} id={`mr-ndf-${k}`} addr={addr} what={what} text={text[k]} bad={bad(k)} onChange={x => set(k, x)} />)}
          <tr><td className="addr">B8</td><td>Time, years</td><td className="f">=B5/365</td>{out('mr-ndf-T', r?.T, 4)}</tr>
          <tr><td className="addr">B9</td><td>USD discount factor</td><td className="f">=EXP(-B3%*B8)</td>{out('mr-ndf-P', r?.P, 6)}</tr>
          <tr><td className="addr">B10</td><td>Fair forward</td><td className="f">=B2*EXP(-B4%*B8)/B9</td>{out('mr-ndf-F', r?.F, 2)}</tr>
          <tr className="out"><td className="addr">B11</td><td>NPV, USD</td><td className="f">=(B10-B7)*B6*B9</td>{out('mr-ndf-npv', r?.npv, 0, true)}</tr>
          <tr className="out"><td className="addr">B12</td><td>CRY01, USD per 1 % of spot</td><td className="f">=0.01*B2*EXP(-B4%*B8)*B6</td>{out('mr-ndf-cry01', r?.cry01, 0)}</tr>
        </tbody>
      </table></div>
      <div className="mr-wb-foot">Change an input and every cell below it reprices, as in the workbook. The workbook itself (Excel replications, in the syllabus) is built from your latest market data and carries the engine's own NPV beside the formula's; here one flat USD rate stands in for the curve's discount factor.</div>
    </div>
  )
}

const CVA_ROWS = [['ee', 'Expected exposure, USD, held flat', 0], ['s', 'Counterparty spread, basis points', 0], ['lgd', 'Loss given default, %', 0], ['yrs', 'Years', 0], ['r', 'Discount rate, % a year', 2]]
const CVA_START = { ee: 250000, s: 150, lgd: 60, yrs: 2, r: 4 }
export function CvaLine() {
  const [text, set, v, reset] = useInputs(CVA_ROWS, CVA_START, ['lgd', 'r', 'yrs'])
  const r = cvaLine(v)
  const bad = (k) => v[k] == null || (k !== 'r' && !(v[k] > 0)) || (k === 'lgd' && v[k] > 100) || (k === 'yrs' && v[k] > 30)
  const out = (id, x, d) => <td className="v" data-testid={id} data-value={r ? x : ''}>{r ? fmt(x, d) : '—'}</td>
  return (
    <div className="mr-wb" data-testid="mr-worked-cva">
      <div className="mr-wb-head"><span className="mr-lbl">THE FIRST LINE OF THE WATERFALL, WORKED</span><span className="mr-tag amber">ONE LINE WITH A FLAT EXPOSURE, NOT THE ENGINE'S RUN</span>
        <button type="button" className="mr-btn" onClick={reset}>RESET</button></div>
      <div className="mr-wb-scroll"><table>
        <thead><tr><th>WHAT IT IS</th><th>HOW IT IS GOT</th><th className="r">VALUE</th></tr></thead>
        <tbody>
          {CVA_ROWS.map(([k, what]) => <InputRow key={k} id={`mr-cva-${k}`} what={what} text={text[k]} bad={bad(k)} onChange={x => set(k, x)} />)}
          <tr><td>Hazard rate, % a year</td><td className="f">h = s / LGD</td>{out('mr-cva-h', r ? r.h * 100 : NaN, 2)}</tr>
          <tr><td>Chance of default over {r ? `${r.months} ${r.months === 1 ? 'month' : 'months'}` : 'the life'}, %</td><td className="f">1 − e^(−h·T)</td>{out('mr-cva-pd', r ? r.pd * 100 : NaN, 2)}</tr>
          <tr className="out"><td>CVA, USD</td><td className="f">LGD · Σ EE · ΔQ · D, monthly</td>{out('mr-cva-out', r?.cva, 0)}</tr>
        </tbody>
      </table></div>
      <div className="mr-wb-foot">A flat exposure is the simplification. The engine's exposure is a profile from the simulation in §9, different at every date and smaller under a CSA; the sum is the same sum.</div>
    </div>
  )
}
