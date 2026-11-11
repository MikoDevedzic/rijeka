// METHODOLOGY — the document read in place. A syllabus at the side; each section's text with its formulas, as the
// PDF has them; beside it, what stands behind the section (the model inventory's own rows and the Excel
// replications); and, in front of the nineteen sections, how the system is built.
//
// The text is not written here. scripts/build-methodology.mjs makes methodology/methodology.json from the one
// LaTeX source (docs/methodology/rijeka_methodology.tex) and from docs/model_inventory.md, and a test fails when
// that file is not what the sources now give: the page, the PDF and the inventory cannot drift apart unseen.
// The HTML in that file is ours, made at build time from our own source; nothing a user typed is ever in it.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import 'katex/dist/katex.min.css'
import { getSessionMaybe } from '../../lib/session'
import ValidationLog from './ValidationLog'
import { CvaLine, NdfCells } from './methodology/WorkedTables'
import './Docs.css'
import './methodology/methodology.css'

const Architecture = lazy(() => import('./methodology/Architecture'))
const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const PDF = '/methodology/rijeka_methodology.pdf'
const GITHUB = 'https://github.com/MikoDevedzic/rijeka/blob/main'

async function authed(path, opts = {}) {
  const s = await getSessionMaybe()
  return fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, ...(opts.headers || {}) } })
}

// The syllabus: the system first, then the document's sections under the headings a desk would look for them by,
// then the evidence that is not a section of the document (the workbooks, the findings log), then the document itself.
const GROUPS = [
  ['THE SYSTEM', ['architecture']],
  ['FOUNDATIONS', ['1', '2', '3']],
  ['RATES', ['4', '5', '6', '7', '8']],
  ['COUNTERPARTY RISK', ['9', '10', '15', '16']],
  ['FX AND DIGITAL ASSETS', ['12', '13']],
  ['RISK AND P&L', ['11', '14']],
  ['CONFIRMATION', ['17']],
  ['EVIDENCE', ['18', '19', 'replications', 'findings']],
  ['THE DOCUMENT', ['about']],
]
const EXTRA = { architecture: 'How the system is built', replications: 'Excel replications', findings: 'Findings log', about: 'Versions, references, PDF' }
const ORDER = GROUPS.flatMap(g => g[1])
const WORKED = { 10: CvaLine, 12: NdfCells }

const html = (h) => ({ __html: h })
const none = (h) => /^\s*(none|n\/a)\b/i.test(String(h).replace(/<[^>]+>/g, ''))
// the three marks beside a section in the syllabus: reference comparisons exist; an Excel replication exists;
// every model in it was compared with an outside source (else: an outside validator is still wanted)
function marks(ev) {
  if (!ev || !ev.length) return null
  return { ref: ev.some(r => !none(r.ref)), xls: ev.some(r => !none(r.xls)), ok: ev.every(r => r.ok) }
}
// the sections a product's workbook belongs to, from the API's own "3-4", "2 and 4", "12"
const sectionsOf = (p) => { const m = String(p.section || '').match(/\d+/g) || []; if (m.length === 2 && /-/.test(p.section)) { const out = []; for (let i = Number(m[0]); i <= Number(m[1]); i++) out.push(String(i)); return out } return m }

function Blocks({ blocks }) {
  return blocks.map((b, i) => {
    if (b.t === 'p') return <p key={i} className={b.cont ? 'cont' : undefined} dangerouslySetInnerHTML={html(b.html)} />
    if (b.t === 'eq') return <div key={i} className="mr-eq" dangerouslySetInnerHTML={html(b.html)} />
    if (b.t === 'h3') return <h3 key={i} id={b.id}><span className="n">{b.n}</span><span dangerouslySetInnerHTML={html(b.html)} /></h3>
    if (b.t === 'ul' || b.t === 'ol') { const L = b.t; return <L key={i}>{b.items.map((it, k) => <li key={k}><Blocks blocks={it} /></li>)}</L> }
    if (b.t === 'center') return <div key={i} className="mr-center">{b.lines.map((l, k) => <div key={k} dangerouslySetInnerHTML={html(l)} />)}</div>
    if (b.t === 'module') return <p key={i} className="mr-module" dangerouslySetInnerHTML={html(b.html)} />
    if (b.t === 'table') return (
      <div key={i} className={'mr-table' + (b.head ? ' data' : '')}><table>
        {b.head && <thead><tr>{b.head.map((c, k) => <th key={k} dangerouslySetInnerHTML={html(c)} />)}</tr></thead>}
        <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} dangerouslySetInnerHTML={html(c)} />)}</tr>)}</tbody>
      </table></div>
    )
    return null
  })
}

function Evidence({ section, products, busy, onExport }) {
  const ev = section.evidence
  const books = (products || []).filter(p => p.replication === 'xlsx' && sectionsOf(p).includes(section.n))
  if (!ev.length && !books.length) return null
  const m = marks(ev)
  return (
    <aside className="mr-evidence" data-testid="mr-evidence" aria-label="What stands behind this section">
      <h3>WHAT STANDS BEHIND THIS</h3>
      {m && <div className="ev"><span className={'mr-status ' + (m.ok ? 'ok' : 'want')} data-testid="mr-status">{m.ok ? 'CHECKED AGAINST AN OUTSIDE SOURCE' : 'AN OUTSIDE VALIDATOR IS WANTED'}</span>
        <p className="quiet">From the model inventory, row by row. {ev.length > 1 ? `${ev.length} models are described in this section.` : ''}</p></div>}
      {ev.map((r, i) => (
        <details key={i} className="ev" open={i === 0} data-testid="mr-model">
          <summary><i className={'mr-dot ' + (r.ok ? 'on' : 'want')} /><span dangerouslySetInnerHTML={html(r.model)} /></summary>
          <dl>
            <dt>Reference comparisons</dt><dd dangerouslySetInnerHTML={html(r.ref)} />
            <dt>Excel replication</dt><dd dangerouslySetInnerHTML={html(r.xls)} />
            <dt>Independent validation</dt><dd dangerouslySetInnerHTML={html(r.val)} />
            <dt>Open</dt><dd dangerouslySetInnerHTML={html(r.open)} />
          </dl>
        </details>
      ))}
      {books.length > 0 && <div className="ev">
        <div className="mr-lbl">THE WORKBOOKS FOR THIS SECTION</div>
        <p className="quiet">Built on request from your latest market data, with the engine's value beside each formula.</p>
        {books.map(p => <button key={p.id} type="button" className="mr-btn block" data-testid={`mr-export-${p.id}`} disabled={busy === p.id} onClick={() => onExport(p)}>{busy === p.id ? 'BUILDING…' : `⬇ ${p.name}`}</button>)}
      </div>}
    </aside>
  )
}

export default function Methodology() {
  const { section } = useParams()
  const navigate = useNavigate()
  const [doc, setDoc] = useState(null)
  const [docErr, setDocErr] = useState(null)
  const [products, setProducts] = useState(null)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)                   // a workbook that could not be built: said where it was asked for
  const [listErr, setListErr] = useState(null)           // the list of workbooks that could not be read: said where the list is shown
  const top = useRef(null), anchor = useRef(null), shown = useRef(null)
  const id = ORDER.includes(section) ? section : 'architecture'

  useEffect(() => {
    let dead = false
    import('./methodology/methodology.json').then(m => { if (!dead) setDoc(m.default || m) }).catch(e => { if (!dead) setDocErr(e.message || 'the document could not be loaded') })
    authed('/api/methodology/products')
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || `HTTP ${r.status}`); return r.json() })
      .then(p => { if (!dead) setProducts(p) })
      .catch(e => { if (!dead) setListErr(`Could not load the list of workbooks: ${e.message}`) })
    return () => { dead = true }
  }, [])
  // a new section starts at its top; a link to a subsection goes on to it once the section is drawn
  // (the page as it first opens is left where the browser put it: its own bar stays in view)
  useEffect(() => {
    const to = anchor.current && document.getElementById(anchor.current)
    if (doc) anchor.current = null                        // used once: a later Back does not land on it again
    const first = shown.current === null
    if (!to && (first || shown.current === id)) { shown.current = id; return }
    shown.current = id
    const el = to || top.current
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' })
  }, [id, doc])

  const download = async (p) => {
    setBusy(p.id); setErr(null)
    try {
      const r = await authed(`/api/methodology/${p.id}/replication.xlsx`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || `HTTP ${r.status}`)
      const blob = await r.blob()
      const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || `rijeka_${p.id}_replication.xlsx`
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name })
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  const byN = Object.fromEntries((doc?.sections || []).map(s => [s.n, s]))
  const titleOf = (x) => (EXTRA[x] ? EXTRA[x] : byN[x] ? <span dangerouslySetInnerHTML={html(byN[x].title)} /> : `Section ${x}`)
  const plain = (x) => (EXTRA[x] || (byN[x] ? byN[x].title.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&') : `Section ${x}`))
  const go = (x, sub) => { setErr(null); anchor.current = sub || null; if (x === id) { const el = sub && document.getElementById(sub); if (el) el.scrollIntoView({ block: 'start' }) } else navigate(x === 'architecture' ? '/methodology' : `/methodology/${x}`) }
  // a "§12" inside the text goes to that section
  const onProse = (e) => {
    const a = e.target.closest && e.target.closest('a[data-sec]')
    if (!a) return
    e.preventDefault()
    const n = a.dataset.sec.slice(1), sub = a.dataset.sub ? `s${a.dataset.sub.replace('.', '-')}` : null
    go(n, sub)
  }
  const sec = byN[id] || null
  const i = ORDER.indexOf(id), prev = ORDER[i - 1], next = ORDER[i + 1]
  const Worked = sec ? WORKED[sec.n] : null
  const groups = products ? [...new Set(products.map(p => p.group))] : []

  return (
    <div className="mr" data-testid="mr">
      <header className="mr-bar">
        <span className="mr-name">METHODOLOGY</span>
        {doc && <span className="mr-tag" data-testid="mr-version">v{doc.version}</span>}
        <span className="mr-sp" />
        <a className="mr-btn" href={PDF} target="_blank" rel="noopener noreferrer">OPEN PDF ↗</a>
        <a className="mr-btn" href={`${GITHUB}/docs/methodology/rijeka_methodology.tex`} target="_blank" rel="noopener noreferrer">LATEX SOURCE ↗</a>
      </header>
      <div className="mr-frame">
        <nav className="mr-rail" aria-label="Syllabus" data-testid="mr-syllabus">
          {GROUPS.map(([g, ids]) => (
            <div key={g}>
              <h2>{g}</h2>
              {ids.map(x => {
                const m = byN[x] ? marks(byN[x].evidence) : null
                return (
                  <div key={x}>
                    <button type="button" className="mr-item" data-testid={`mr-go-${x}`} aria-current={x === id ? 'true' : undefined} onClick={() => go(x)}>
                      <span className="n">{EXTRA[x] ? '·' : x}</span><span>{titleOf(x)}</span>
                      {m && <span className="mr-dots" aria-hidden="true"><i className={'mr-dot' + (m.ref ? ' on' : '')} /><i className={'mr-dot' + (m.xls ? ' on' : '')} /><i className={'mr-dot ' + (m.ok ? 'on' : 'want')} /></span>}
                    </button>
                    {x === id && sec && sec.blocks.filter(b => b.t === 'h3').map(b => (
                      <button key={b.id} type="button" className="mr-sub" onClick={() => go(x, b.id)}><span className="n">{b.n}</span><span dangerouslySetInnerHTML={html(b.html)} /></button>
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
          <div className="mr-legend">
            <span className="mr-lbl">THE THREE MARKS</span>
            <span><i className="mr-dot on" /> reference comparisons exist</span>
            <span><i className="mr-dot on" /> an Excel replication exists</span>
            <span><i className="mr-dot on" /> checked against an outside source</span>
            <span><i className="mr-dot want" /> an outside validator is wanted</span>
          </div>
        </nav>

        <main className="mr-main" ref={top}>
          <select className="mr-pick" aria-label="Section" value={id} onChange={e => go(e.target.value)}>
            {GROUPS.map(([g, ids]) => <optgroup key={g} label={g}>{ids.map(x => <option key={x} value={x}>{EXTRA[x] ? '' : `§${x}  `}{plain(x)}</option>)}</optgroup>)}
          </select>
          {err && <div className="doc-err" data-testid="mr-err">{err}</div>}
          {listErr && (sec || id === 'replications') && <div className="doc-err" data-testid="mr-list-err">{listErr}</div>}

          {id === 'architecture' && <Suspense fallback={<div className="doc-note">Loading…</div>}><Architecture /></Suspense>}

          {sec && (
            <div className={'mr-sheet' + (sec.evidence.length || (products || []).some(p => p.replication === 'xlsx' && sectionsOf(p).includes(sec.n)) ? '' : ' wide')}>
              <article data-testid="mr-section" data-section={sec.n} onClick={onProse}>
                <div className="mr-eyebrow"><span className="mr-lbl">SECTION {sec.n}</span></div>
                <h1 className="mr-title" dangerouslySetInnerHTML={html(sec.title)} />
                {sec.module && <p className="mr-module" dangerouslySetInnerHTML={html(sec.module)} />}
                <div className="mr-prose"><Blocks blocks={sec.blocks} /></div>
                {Worked && <div className="mr-prose"><h3>Worked on this page</h3><Worked /></div>}
              </article>
              <Evidence section={sec} products={products} busy={busy} onExport={download} />
            </div>
          )}
          {!sec && !EXTRA[id] && !docErr && <div className="doc-note">Loading…</div>}
          {docErr && !EXTRA[id] && <div className="doc-err">The document could not be loaded ({docErr}). The PDF is the same text: OPEN PDF, above.</div>}

          {id === 'replications' && (
            <div data-testid="mr-replications">
              <div className="mr-eyebrow"><span className="mr-lbl">EVIDENCE</span></div>
              <h1 className="mr-title">Excel replications</h1>
              <p className="mr-lead">No black boxes. For each product: the model, the default trade, and an Excel workbook that rebuilds that trade with live formulas from <b>your</b> latest market data, beside the value Rijeka's engine produced. Change a yellow cell and it reprices. The curve's discount factors come from Rijeka's bootstrap as values; everything after that is a formula you can read.</p>
              {!products && !listErr && <div className="doc-note">Loading…</div>}
              {groups.map(g => (
                <section key={g} className="doc-group">
                  <h2>{g.toUpperCase()}</h2>
                  <div className="doc-cards">
                    {products.filter(p => p.group === g).map(p => (
                      <article key={p.id} className="doc-card">
                        <h3>{p.name}</h3>
                        <div className="doc-row"><span>DEFAULT TRADE</span><p>{p.default}</p></div>
                        <div className="doc-row"><span>FORMULA</span><p className="doc-formula">{p.formula}</p></div>
                        <div className="doc-actions">
                          {p.replication === 'xlsx' && <button className="doc-btn" disabled={busy === p.id} onClick={() => download(p)}>{busy === p.id ? 'BUILDING…' : '⬇ EXPORT EXCEL REPLICATION'}</button>}
                          {p.replication === 'xlsx-static' && <a className="doc-btn" href={p.doc} target="_blank" rel="noopener noreferrer">⬇ TRACE WORKBOOK</a>}
                          {p.replication === 'doc' && <a className="doc-btn" href={`${GITHUB}${p.doc}`} target="_blank" rel="noopener noreferrer">VALIDATION REPORT ↗</a>}
                          {p.replication === 'verifier' && <a className="doc-btn" href={p.doc} target="_blank" rel="noopener noreferrer">OPEN THE VERIFIER ↗</a>}
                          {sectionsOf(p).length > 0 && <button type="button" className="doc-link" onClick={() => go(sectionsOf(p)[0])}>§{p.section} OF THE DOCUMENT</button>}
                          <a className="doc-link" style={{ marginLeft: sectionsOf(p).length ? '0.6rem' : 'auto' }} href="https://github.com/MikoDevedzic/rijeka/tree/main/backend/pricing" target="_blank" rel="noopener noreferrer">SOURCE ↗</a>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {id === 'findings' && (
            <div data-testid="mr-findings">
              <div className="mr-eyebrow"><span className="mr-lbl">EVIDENCE</span></div>
              <h1 className="mr-title">Findings log</h1>
              <ValidationLog />
            </div>
          )}

          {id === 'about' && (
            <div className="mr-prose" data-testid="mr-about" onClick={onProse}>
              <div className="mr-eyebrow"><span className="mr-lbl">THE DOCUMENT</span></div>
              <h1 className="mr-title">Versions, references, PDF</h1>
              {doc && <p><b>How to read this document.</b> <span dangerouslySetInnerHTML={html(doc.howto)} /></p>}
              <p className="mr-actions">
                <a className="mr-btn" href={PDF} target="_blank" rel="noopener noreferrer">OPEN PDF ↗</a>
                <a className="mr-btn" href={PDF} download="rijeka_methodology.pdf">⬇ DOWNLOAD PDF</a>
                <a className="mr-btn" href={`${GITHUB}/docs/methodology/rijeka_methodology.tex`} target="_blank" rel="noopener noreferrer">LATEX SOURCE ↗</a>
                <a className="mr-btn" href={`${GITHUB}/docs/model_inventory.md`} target="_blank" rel="noopener noreferrer">MODEL INVENTORY ↗</a>
              </p>
              <p className="quiet">These pages and the PDF are made from the same LaTeX source, and the evidence beside each section from the model inventory; a test fails when either has moved on without the other.</p>
              {doc && <><h3>Version history</h3><ul>{doc.history.map((h, k) => <li key={k} dangerouslySetInnerHTML={html(h)} />)}</ul>
                <h3>References</h3><ul>{doc.references.map((h, k) => <li key={k} dangerouslySetInnerHTML={html(h)} />)}</ul></>}
              <p className="quiet">What is validated against what: <code>docs/VALIDATION.md</code>; the one-table view: <code>docs/model_inventory.md</code>; the April 2026 Bloomberg comparison is kept in <code>model_validation/</code>. Engine and standard: Apache-2.0. Platform: Business Source License 1.1.</p>
            </div>
          )}

          <div className="mr-pager">
            {prev ? <button type="button" className="mr-btn" data-testid="mr-prev" onClick={() => go(prev)}>← {EXTRA[prev] ? '' : `§${prev} `}{plain(prev)}</button> : <span />}
            {next ? <button type="button" className="mr-btn" data-testid="mr-next" onClick={() => go(next)}>{EXTRA[next] ? '' : `§${next} `}{plain(next)} →</button> : <span />}
          </div>
        </main>
      </div>
    </div>
  )
}
