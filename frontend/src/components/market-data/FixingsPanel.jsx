// The Fixings tab of a digital-asset pair (Market data › FX · Crypto): the prices cash-settled trades settle on,
// per settlement price source, for the last 30 days, and the form a desk uses to enter the fixing of a source
// the feed does not store. The table is read from GET /api/currency/fixings/{pair}; the form posts to
// POST /api/currency/fixings. The pure parts (order, the origin word, the form's check) are in fixings.js.
//
// The page mounts every tab's panel at once and hides the inactive ones, so this one reads nothing until its
// tab is opened (`active`).
import { useCallback, useEffect, useState } from 'react'
import { DescBox, SectionLabel } from './_DetailShared'
import { sortFixings, originWord, originPill, deskSources, checkFixing, saveErrorText } from './fixings'

const DAYS = 30
const fmt = (n, d = 2) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
const utcToday = () => new Date().toISOString().slice(0, 10)
const ORIGIN_TITLE = { FEED: 'stored by the feed', MANUAL: 'entered by a desk', SPOT: 'a stored spot price, not a fixing' }

const thL = { fontSize: '0.78rem', color: 'var(--text-dim)', letterSpacing: '.08em', padding: '4px 10px 6px 0', borderBottom: '1px solid var(--border)', textAlign: 'left' }
const thR = { ...thL, textAlign: 'right' }
const td = { fontSize: '0.875rem', color: 'var(--text)', padding: '5px 10px 5px 0', borderBottom: '1px solid var(--panel-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }
const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

export default function FixingsPanel({ p, call, flash, active, decimals = 2 }) {
  const pair = p.pair
  const [data, setData] = useState(null)        // the API's answer: {pair, stored, sources, fixings}
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [source, setSource] = useState('')      // '' = the first of the desk's sources
  const [date, setDate] = useState(utcToday)
  const [value, setValue] = useState('')

  const read = useCallback(() => call(`/api/currency/fixings/${pair}?days=${DAYS}`), [call, pair])

  useEffect(() => {
    if (!active) return
    let dead = false
    read().then(d => { if (!dead) { setData(d); setError('') } }).catch(e => { if (!dead) setError(e.message) })
    return () => { dead = true }
  }, [active, read])

  const sources = data?.sources || p.fixing_sources || []
  const desk = deskSources(sources)
  const picked = desk.some(s => s.source === source) ? source : (desk[0]?.source || '')
  const rows = sortFixings(data?.fixings)

  const save = async () => {
    const today = utcToday()
    const check = checkFixing({ pair, source: picked, date, value }, today)
    if (!check.ok) return flash('err', check.error)
    setBusy(true)
    try {
      await call('/api/currency/fixings', { method: 'POST', body: JSON.stringify(check.body) })
      flash('ok', `${pair} fixing saved`)
      setValue('')
      try { setData(await read()); setError('') } catch (e) { setError(e.message) }
    } catch (e) { flash('err', saveErrorText(e)) } finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 1040 }}>
      <DescBox>
        A fixing is the price a cash-settled trade settles on: the value its settlement price source publishes on the trade's valuation date.
        A trade settles only on the source it names, never on another source's price. Until that fixing is stored, an expired trade is valued on the stored spot of the day and marked provisional.
        {sources.length > 0 && <> {pair} settles on {sources.length === 1 ? 'one source' : `${sources.length} sources`}: {sources.map((s, i) => (
          <span key={s.source}>{i ? '; ' : ''}<b>{s.source}</b>{s.time ? ` (${s.time})` : ''}, {s.auto ? 'stored automatically each day' : 'entered by your desk'}</span>
        ))}.</>}
      </DescBox>

      {desk.length > 0 && (<>
        <SectionLabel sub="a source your desk supplies; a second entry for the same date and source replaces the first">ENTER A FIXING</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
          <label style={{ display: 'block' }}><span className="lbl">SOURCE</span>
            <select className="inp" data-testid="fixing-source" style={{ width: 240 }} value={picked} onChange={e => setSource(e.target.value)}>
              {desk.map(s => <option key={s.source} value={s.source}>{s.time ? `${s.source} · ${s.time}` : s.source}</option>)}
            </select>
          </label>
          {/* the day is the UTC day, as the API counts it: the default, and the last date offered */}
          <label style={{ display: 'block' }}><span className="lbl">DATE (UTC)</span>
            <input className="inp" data-testid="fixing-date" type="date" style={{ width: 150 }} value={date} max={utcToday()} onChange={e => setDate(e.target.value)} />
          </label>
          <label style={{ display: 'block' }}><span className="lbl">VALUE · {p.quote} per 1 {p.base}</span>
            <input className="inp" data-testid="fixing-value" type="text" inputMode="decimal" style={{ width: 170, textAlign: 'right' }} placeholder={p.spot != null ? `e.g. ${fmt(p.spot, decimals)}` : 'value'} value={value}
                   onChange={e => setValue(e.target.value.replace(/[^0-9.,]/g, ''))} onKeyDown={e => { if (e.key === 'Enter' && !busy) save() }} />
          </label>
          <button className="btn primary" data-testid="fixing-save" onClick={save} disabled={busy || !value}>{busy ? 'SAVING…' : 'SAVE FIXING'}</button>
        </div>
      </>)}

      <SectionLabel sub={`newest first · ${p.quote} per 1 ${p.base}`}>LAST {DAYS} DAYS</SectionLabel>
      {data && data.stored === false && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--amber)', margin: '0 0 8px' }}>Fixings are not stored on this instance yet; these are stored spot prices.</div>
      )}
      {error && <div style={{ fontSize: '0.8125rem', color: 'var(--red)', margin: '0 0 8px' }}>Fixings could not be read: {error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <div data-testid="fixings-table" style={{ display: 'grid', gridTemplateColumns: '110px minmax(180px, 1fr) 130px 150px 90px', minWidth: 660 }}>
          <div style={thL}>DATE</div><div style={thL}>SOURCE</div><div style={thL}>TIME</div><div style={thR}>VALUE</div><div style={thL}>ORIGIN</div>
          {rows.map((r, i) => {
            const word = originWord(r); const k = `${r.date}|${r.source}|${i}`
            return [
              <div key={k + 'a'} style={{ ...td, color: 'var(--accent)' }}>{r.date}</div>,
              <div key={k + 'b'} style={td} title={r.source || ''}>{r.source || '—'}</div>,
              <div key={k + 'c'} style={{ ...td, color: 'var(--text-dim)' }}>{r.time || '—'}</div>,
              <div key={k + 'd'} style={{ ...tdR, color: 'var(--text-hi)' }}>{fmt(r.value, decimals)}</div>,
              <div key={k + 'e'} style={td}><span className={`pill ${originPill(word)}`} style={{ whiteSpace: 'nowrap' }} title={r.own && word === 'MANUAL' ? 'entered by your desk' : ORIGIN_TITLE[word]}>{word}</span></div>,
            ]
          })}
        </div>
      </div>
      {!rows.length && !error && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', padding: '8px 0' }}>{data ? `No fixing is stored for ${pair} in the last ${DAYS} days.` : 'Reading the fixings…'}</div>
      )}
    </div>
  )
}
