// The methodology's pages are the LaTeX source's, and the evidence beside them the model inventory's: this test
// runs the builder and holds the committed file to what the two sources give today. When it fails, the source or
// the inventory moved on: run `npm run methodology` in frontend/ and commit the file with the change.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { build } from '../../../../scripts/build-methodology.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const committed = JSON.parse(fs.readFileSync(path.resolve(HERE, 'methodology.json'), 'utf8'))
const built = build()

describe('the methodology in the app', () => {
  it('is made from the source as it stands: run `npm run methodology` after changing the .tex or the inventory', () => {
    expect(committed.source).toBe(built.source)
    expect(JSON.stringify(committed)).toBe(JSON.stringify(built))
  })
  it('has the document\'s nineteen sections, numbered as the PDF numbers them, each with text', () => {
    expect(built.sections.map(s => s.n)).toEqual(Array.from({ length: 19 }, (_, i) => String(i + 1)))
    for (const s of built.sections) expect(s.blocks.length, `§${s.n}`).toBeGreaterThan(0)
    expect(built.sections[9].title).toBe('The XVA waterfall')
    expect(built.sections[16].blocks.filter(b => b.t === 'h3').map(b => b.n)).toEqual(['17.1', '17.2', '17.3', '17.4', '17.5'])
  })
  it('numbers the displays as the PDF does, and leaves no LaTeX on the page', () => {
    const text = JSON.stringify(built.sections)
    // read off the PDF (v1.12, and §12 again at v1.13): the waterfall's four lines are (14) to (17), wrong-way risk (18) and (19), the
    // parity forward of §12 is (20) and the digital-asset forward (21)
    const tags = (sec) => built.sections[sec - 1].blocks.filter(b => b.t === 'eq').flatMap(b => [...b.html.matchAll(/<span class="mord">\(<\/span><span class="mord"><span class="mord">(\d+)<\/span>/g)].map(m => Number(m[1])))
    expect(tags(10)).toEqual([14, 15, 16, 17, 18, 19])
    expect(tags(12)).toEqual([20, 21, 22, 23])      // v1.13: the forward beyond the last quote is (21)
    // prose with the maths taken out: no backslash command, no stray brace or dollar
    // the text with each formula taken out whole (a formula's own spans nest: counted, not guessed)
    const strip = (h) => {
      let out = '', i = 0
      for (;;) {
        const a = h.indexOf('<span class="katex">', i)
        if (a < 0) return out + h.slice(i)
        out += h.slice(i, a) + ' '
        let depth = 0, k = a
        const tag = /<(\/?)span\b[^>]*>/g; tag.lastIndex = a
        for (let m; (m = tag.exec(h));) { depth += m[1] ? -1 : 1; k = tag.lastIndex; if (!depth) break }
        i = k
      }
    }
    // every piece of text the page shows: paragraphs, list items, table cells, headings, the history, the references
    const all = []
    const walk = (x) => { if (typeof x === 'string') all.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (k !== 't' && k !== 'id' && k !== 'n' && k !== 'evidence') walk(v) } }
    walk(built.sections); walk(built.history); walk(built.references); walk(built.howto)
    expect(all.length).toBeGreaterThan(600)
    for (const h of all) {
      if (h.includes('class="katex-display"')) continue          // a display is all maths
      const prose = strip(h).replace(/<code>[\s\S]*?<\/code>/g, ' ').replace(/<[^>]+>/g, ' ')
      expect(prose, prose.slice(0, 80)).not.toMatch(/\\[A-Za-z]+|[{}]/)          // (a dollar sign is the document's own: "$3 on a $10m"; an unclosed one stops the build)
    }
    // a reference in the text is a link with an address
    expect(JSON.stringify(built.sections)).toMatch(/<a href=\\"\/methodology\/13\\" data-sec=\\"s13\\">/)
    expect(text).not.toContain('??')
  })
  it('puts every row of the model inventory beside a section the document has', () => {
    const rows = built.sections.reduce((n, s) => n + s.evidence.length, 0)
    const inventory = fs.readFileSync(path.resolve(HERE, '../../../../../docs/model_inventory.md'), 'utf8').split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Model |')).length
    expect(rows).toBe(inventory)
    for (const s of built.sections) for (const r of s.evidence) expect(typeof r.ok).toBe('boolean')
  })
})
