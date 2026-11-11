// scripts/build-methodology.mjs — the methodology document as the app's pages, made from the one LaTeX source.
//
//   node scripts/build-methodology.mjs            writes src/components/docs/methodology/methodology.json
//   node scripts/build-methodology.mjs --check    exits 1 when that file is not what the source now gives
//
// docs/methodology/rijeka_methodology.tex is the document; the PDF is its print and this JSON is its screen. The
// two cannot drift apart unseen: the JSON carries the hash of the source it was made from, and a test (and
// --check) fails when the source has moved on. The evidence beside each section is read from the model inventory
// (docs/model_inventory.md) the same way, so the page never says more than the inventory does.
//
// This is a reader of THIS document, not of LaTeX: it knows the commands the document uses and stops, naming the
// line, at one it does not know. A new construct in the source is a decision here, never a guess on the screen.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import katex from 'katex'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.RIJEKA_ROOT || path.resolve(HERE, '../..')
const SRC = path.join(ROOT, 'docs/methodology/rijeka_methodology.tex')
const INVENTORY = path.join(ROOT, 'docs/model_inventory.md')
const OUT = process.env.RIJEKA_METHODOLOGY_OUT || path.join(ROOT, 'frontend/src/components/docs/methodology/methodology.json')

const fail = (msg) => { throw new Error('build-methodology: ' + msg) }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ── maths ────────────────────────────────────────────────────────────────────────────────────────────
const MACROS = { '\\dd': '\\,\\mathrm{d}', '\\E': '\\mathbb{E}', '\\N': '\\mathcal{N}' }
function math(tex, display) {
  // a code name inside maths: typewriter, its underscores as written
  const src = tex.replace(/\\code\{([^{}]*)\}/g, (_, x) => '\\texttt{' + x.replace(/_/g, '\\_') + '}')
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: true, strict: 'ignore', output: 'html', macros: { ...MACROS } })
  } catch (e) { fail(`KaTeX cannot set: ${tex.slice(0, 120)} … (${e.message})`) }
}

// ── the source, without comments ─────────────────────────────────────────────────────────────────────
function load() {
  const raw = fs.readFileSync(SRC, 'utf8')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  const version = (/\\fancyhead\[R\]\{.*?v(\d+\.\d+)/.exec(raw) || [])[1] || fail('no version in the header')
  const a = raw.indexOf('\\begin{document}'), b = raw.indexOf('\\end{document}')
  if (a < 0 || b < 0) fail('no document')
  let body = raw.slice(a + '\\begin{document}'.length, b)
  body = body.split('\n').filter(l => !l.trimStart().startsWith('%')).join('\n').replace(/(?<!\\)%.*$/gm, '')
  // the two wrappers that only tune the print
  // the reference table's wrapper only tunes the print (smaller type, less air between columns)
  const wrapped = '{\\small\\setlength{\\tabcolsep}{4pt}\n\\begin{longtable}'
  if (!body.includes(wrapped) || !body.includes('\\end{longtable}}')) fail('the reference table is not wrapped as this reader expects')
  body = body.replace(wrapped, '\\begin{longtable}').replace('\\end{longtable}}', '\\end{longtable}')
  return { raw, hash, version, body }
}

// a balanced {...} starting at text[i] === '{': [content, index after the closing brace]
function group(text, i) {
  if (text[i] !== '{') fail(`a { was expected at: ${text.slice(i, i + 40)}`)
  let depth = 0
  for (let k = i; k < text.length; k++) {
    const c = text[k]
    if (c === '\\') { k++; continue }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return [text.slice(i + 1, k), k + 1]
  }
  fail(`an unclosed { at: ${text.slice(i, i + 60)}`)
}

// ── numbering: sections, subsections and equations as LaTeX numbers them, so §12 and (20) are the PDF's ───
function number(body) {
  const labels = {}
  let sec = 0, sub = 0, eq = 0
  const re = /\\section\{|\\subsection\{|\\begin\{(equation|align)\}([\s\S]*?)\\end\{\1\}|\\label\{([^}]*)\}/g
  let m, last = null                                   // what a bare \label names: the heading before it
  while ((m = re.exec(body))) {
    if (m[0] === '\\section{') { sec++; sub = 0; last = String(sec) }
    else if (m[0] === '\\subsection{') { sub++; last = `${sec}.${sub}` }
    else if (m[1]) {
      const rows = m[1] === 'align' ? m[2].split(/\\\\/).filter(r => r.trim()) : [m[2]]
      for (const r of rows) {
        if (/\\(notag|nonumber)\b/.test(r)) continue
        eq++
        for (const l of r.matchAll(/\\label\{([^}]*)\}/g)) labels[l[1]] = { eq: eq }
      }
    } else if (m[3] && last && !(m[3] in labels)) labels[m[3]] = { sec: last }
  }
  return labels
}

// ── inline text → HTML ───────────────────────────────────────────────────────────────────────────────
const DROP = new Set(['noindent', 'par', 'nopagebreak', 'raggedright', 'small', 'large', 'LARGE', 'bfseries', 'arraybackslash', 'centering'])
const LITERAL = { '%': '%', '&': '&amp;', '$': '$', '#': '#', '_': '_', '{': '{', '}': '}', ',': ' ', ' ': ' ', ';': ' ', '!': '', '\\': '<br>' }
function inline(text, ctx) {
  let out = '', i = 0
  const n = text.length
  const secLink = (label) => {
    const l = ctx.labels[label] || fail(`an unknown label: ${label}`)
    if (l.eq) return String(l.eq)
    const top = l.sec.split('.')[0]
    return `<a href="/methodology/${top}" data-sec="s${top}"${l.sec.includes('.') ? ` data-sub="${l.sec}"` : ''}>${l.sec}</a>`
  }
  while (i < n) {
    const c = text[i]
    if (c === '$') {
      const j = text.indexOf('$', i + 1)
      if (j < 0) fail(`an unclosed $ in: ${text.slice(i, i + 60)}`)
      out += math(text.slice(i + 1, j), false); i = j + 1
    } else if (c === '\\') {
      const lit = LITERAL[text[i + 1]]
      if (lit !== undefined && !/[A-Za-z]/.test(text[i + 1])) { out += lit; i += 2; continue }
      const m = /^\\([A-Za-z]+)\*?/.exec(text.slice(i)) || fail(`a stray backslash at: ${text.slice(i, i + 30)}`)
      const cmd = m[1]; i += m[0].length
      const arg = () => { const [g, k] = group(text, i); i = k; return g }
      if (cmd === 'code' || cmd === 'texttt') out += `<code>${esc(arg())}</code>`
      else if (cmd === 'textbf') out += `<b>${inline(arg(), ctx)}</b>`
      else if (cmd === 'emph') out += `<em>${inline(arg(), ctx)}</em>`
      else if (cmd === 'textsc') out += `<span class="sc">${inline(arg(), ctx)}</span>`
      else if (cmd === 'href') { const url = arg(); out += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inline(arg(), ctx)}</a>` }
      else if (cmd === 'S') {                               // §: before a reference, or before a number written out
        if (text.startsWith('\\ref{', i)) { i += 4; out += '§' + secLink(arg()) } else out += '§'
      }
      else if (cmd === 'ref') out += secLink(arg())
      else if (cmd === 'eqref') out += `(${secLink(arg())})`
      else if (cmd === 'label') arg()
      else if (cmd === 'color') { arg() }
      else if (cmd === 'vspace') { arg() }
      else if (cmd === 'euro') out += '€'
      else if (cmd === 'newline') out += '<br>'
      else if (DROP.has(cmd)) { if (text[i] === ' ') i++ }
      else fail(`a command this reader does not know: \\${cmd} (near: ${text.slice(Math.max(0, i - 50), i + 30).replace(/\n/g, ' ')})`)
    } else if (c === '{') { const [g, k] = group(text, i); out += inline(g, ctx); i = k }
    else if (c === '}') fail(`a stray } in: ${text.slice(Math.max(0, i - 40), i + 20)}`)
    else if (c === '~') { out += ' '; i++ }
    else if (c === '-' && text.startsWith('---', i)) { out += '—'; i += 3 }
    else if (c === '-' && text.startsWith('--', i)) { out += '–'; i += 2 }
    else if (c === '`' && text[i + 1] === '`') { out += '“'; i += 2 }
    else if (c === "'" && text[i + 1] === "'") { out += '”'; i += 2 }
    else if (c === '`') { out += '‘'; i++ }
    else if (c === "'") { out += '’'; i++ }
    else { out += esc(c); i++ }
  }
  return out.replace(/[ \t\n]+/g, ' ').trim()
}

// ── blocks: paragraphs, displays, lists, tables ─────────────────────────────────────────────────────
// the end of the environment that begins at `from` (just after its \begin{name}), allowing the same name inside
function envEnd(text, name, from) {
  const re = new RegExp(`\\\\(begin|end)\\{${name}\\}`, 'g'); re.lastIndex = from
  let depth = 1, m
  while ((m = re.exec(text))) { depth += m[1] === 'begin' ? 1 : -1; if (!depth) return [m.index, re.lastIndex] }
  fail(`\\begin{${name}} is not closed`)
}
function cells(row) { return row.split(/(?<!\\)&/).map(c => c.trim()) }
function table(inner, ctx) {
  const rows = inner.replace(/\\(toprule|midrule|bottomrule|endhead|endfirsthead|endfoot|endlastfoot)\b/g, '').split(/\\\\/).map(r => r.trim()).filter(Boolean)
  return rows.map(r => cells(r).map(c => inline(c, ctx)))
}
function blocks(text, ctx) {
  const out = []
  let i = 0, glued = false                               // glued: the text carries on from a display, in the same sentence
  const para = (chunk) => {
    const parts = chunk.split(/\n\s*\n/)
    parts.forEach((p, k) => {
      const t = p.trim()
      if (!t) { if (k > 0) glued = false; return }
      const mod = /^\{\\raggedright\s+\\emph\{([\s\S]*)\}\\par\}\\nopagebreak$/.exec(t)
      if (mod) out.push({ t: 'module', html: inline(mod[1], ctx) })
      else out.push({ t: 'p', html: inline(t, ctx), ...(k === 0 && glued ? { cont: true } : {}) })
      glued = false
    })
  }
  const re = /\\begin\{(equation|align|itemize|enumerate|tabularx|longtable|center)\}|\\subsection\{/g
  let m
  while ((m = re.exec(text))) {
    const before = text.slice(i, m.index)
    const endsPara = !before.trim() || /\n\s*\n\s*$/.test(before)       // nothing before it (a heading), or a paragraph ended
    para(before)
    if (m[0] === '\\subsection{') {
      const [title, k] = group(text, m.index + '\\subsection'.length)
      ctx.sub++
      out.push({ t: 'h3', n: `${ctx.sec}.${ctx.sub}`, id: `s${ctx.sec}-${ctx.sub}`, html: inline(title, ctx) })
      i = k; re.lastIndex = k; glued = false
      continue
    }
    const name = m[1], [a, b] = envEnd(text, name, re.lastIndex)
    let inner = text.slice(re.lastIndex, a)
    if (name === 'equation' || name === 'align') {
      const strip = (s) => s.replace(/\\label\{[^}]*\}/g, '').trim()
      if (name === 'equation') { ctx.eq++; out.push({ t: 'eq', html: math(`${strip(inner)}\\tag{${ctx.eq}}`, true), ...(endsPara ? {} : { cont: true }) }) }
      else {
        const rows = inner.split(/\\\\/).filter(r => r.trim()).map(r => (/\\(notag|nonumber)\b/.test(r) ? strip(r) : `${strip(r)}\\tag{${++ctx.eq}}`))
        out.push({ t: 'eq', html: math(`\\begin{align}${rows.join('\\\\')}\\end{align}`, true), ...(endsPara ? {} : { cont: true }) })
      }
      glued = true
    } else if (name === 'itemize' || name === 'enumerate') {
      inner = inner.replace(/^\s*\[[^\]]*\]/, '')
      const items = inner.split(/\\item\b/).slice(1).map(x => blocks(x, ctx))
      out.push({ t: name === 'itemize' ? 'ul' : 'ol', items })
      glued = false
    } else if (name === 'tabularx' || name === 'longtable') {
      let k = 0
      if (name === 'tabularx') { const [, k1] = group(inner, inner.indexOf('{')); k = k1 }
      const [, k2] = group(inner, inner.indexOf('{', k))
      const rows = table(inner.slice(k2), ctx)
      const headed = /\\endhead/.test(inner)
      out.push({ t: 'table', head: headed ? rows[0] : null, rows: headed ? rows.slice(1) : rows })
      glued = false
    } else if (name === 'center') {
      out.push({ t: 'center', lines: inner.split(/\\\\(?:\[[^\]]*\])?/).map(l => l.trim()).filter(Boolean).map(l => inline(l, ctx)) })
      glued = false
    }
    i = b; re.lastIndex = b
  }
  para(text.slice(i))
  return out
}

// ── the evidence beside a section: the inventory's own rows, each under the section the document gives it ───
// A row is matched by how its first cell begins. A row that matches nothing stops the build: a new model is
// placed here on purpose. `ok`: compared with an outside source; otherwise an outside validator is still wanted.
const PLACES = [
  ['OIS curve bootstrap', 's2'], ['Schedules, day counts, fixings', 's3'], ['Tenor, spot and expiry dates', 's12'], ['IRS, OIS, basis swaps', 's4'],
  ['Key-rate ladder', 's14'], ['SA-CCR by asset class', 's16'], ['European swaption', 's5'], ['β=0 SABR surface', 's5'], ['Caps, floors, collars', 's6'],
  ['Bermudan swaption', 's7'], ['HW1F calibration', 's8'], ['Exposure, CSA, margin period of risk', 's9'], ['XVA waterfall', 's10'], ['P&L attribution', 's11'],
  ['FX spot, forwards, NDFs', 's12'], ['Crypto NDF', 's12'], ['Digital-asset vol surface and forward points', 's13'], ['Settlement of digital-asset forwards', 's13'],
  ['Scenario tab in the browser', 's13'], ['FX option, European', 's13'], ['FX option styles', 's13'], ['Crypto options', 's13'],
  ['Market risk: full-revaluation VaR', 's14'], ['Counterparty credit: real-world paths', 's15'], ['Initial margin:', 's9'], ['Capital add-on of a currency', 's9'],
  ['XVA of a package', 's10'], ['Wrong-way risk', 's10'], ['Canonical record, EIP-712, registry', 's17'], ['Package record', 's17'],
]
function md(s) {                                           // the inventory's own light markup
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
}
function evidence(sections) {
  const rows = fs.readFileSync(INVENTORY, 'utf8').split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Model |') && !l.startsWith('|---'))
  const by = {}
  for (const r of rows) {
    const c = r.slice(1, r.lastIndexOf('|')).split(' | ').map(x => x.trim())
    if (c.length < 7) fail(`an inventory row with ${c.length} cells: ${r.slice(0, 80)}`)
    const place = PLACES.find(([head]) => c[0].startsWith(head)) || fail(`the inventory has a model this reader has not been told where to put: ${c[0].slice(0, 80)}`)
    if (!sections.some(s => s.id === place[1])) fail(`${place[0]} is placed in ${place[1]}, which the document does not have`)
    // the inventory names the section too: the two say the same, or one of them is out of date
    if ((/^(\d+)/.exec(c[2]) || [])[1] !== place[1].slice(1)) fail(`the inventory puts "${c[0].slice(0, 50)}" in §${c[2]}, this reader in §${place[1].slice(1)}`)
    const wanted = /validator wanted|no external audit|none yet|^none/i.test(c[5])
    ;(by[place[1]] ||= []).push({ model: md(c[0]), module: md(c[1]), ref: md(c[3]), xls: md(c[4]), val: md(c[5]), open: md(c[6]), ok: !wanted })
  }
  return by
}

// ── the document ─────────────────────────────────────────────────────────────────────────────────────
export function build() {
  const { hash, version, body } = load()
  const labels = number(body)
  const first = body.search(/\\section\{/)
  const front = body.slice(0, first)
  const ctx = { labels, sec: 0, sub: 0, eq: 0 }
  const howto = /\\noindent\\textbf\{How to read this document\.\}([\s\S]*?)\n\s*\n/.exec(front) || fail('no "How to read this document"')
  const hist = /\\section\*\{Version history\}[\s\S]*?\\begin\{itemize\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{itemize\}/.exec(front) || fail('no version history')
  const history = hist[1].split(/\\item\b/).slice(1).map(x => inline(x, ctx))
  const sections = []
  // the references close the document: a list of its own, not a numbered section
  const refAt = body.indexOf('\\section*{References}')
  if (refAt < 0) fail('no references')
  const refList = /\\begin\{itemize\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{itemize\}/.exec(body.slice(refAt)) || fail('the references are not a list')
  const references = refList[1].split(/\\item\b/).slice(1).map(x => inline(x, ctx))
  const parts = body.slice(first, refAt).split(/\\section\{/).slice(1)
  for (const part of parts) {
    const [title, k] = group('{' + part, 0)
    ctx.sec++; ctx.sub = 0
    const bl = blocks(part.slice(k - 1).replace(/^\s*\\label\{[^}]*\}/, ''), ctx)
    const module = bl[0] && bl[0].t === 'module' ? bl.shift().html : null
    sections.push({ id: `s${ctx.sec}`, n: String(ctx.sec), title: inline(title, ctx), module, blocks: bl })
  }
  const ev = evidence(sections)
  for (const s of sections) s.evidence = ev[s.id] || []
  return { version, source: hash, howto: inline(howto[1], ctx), history, sections, references }
}

const main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (main) {
  const doc = JSON.stringify(build())
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
    if (have !== doc) { console.error('methodology.json is not what the source now gives: run `node scripts/build-methodology.mjs`'); process.exit(1) }
    console.log('methodology.json is the source\'s')
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, doc)
    const d = JSON.parse(doc)
    console.log(`v${d.version}: ${d.sections.length} sections, ${d.sections.reduce((a, s) => a + s.blocks.length, 0)} blocks, ${(doc.length / 1024).toFixed(0)} KB`)
  }
}
