import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { T, rgb, alpha } from './theme'

const css = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'index.css'), 'utf8')
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
const token = (name) => (root.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1]?.trim()
const kebab = (k) => k.replace(/[A-Z0-9]/g, c => '-' + c.toLowerCase())

describe('theme.js mirrors the stylesheet', () => {
  it('has the value index.css has for every token it names', () => {
    for (const [k, v] of Object.entries(T)) expect(token(kebab(k)), `--${kebab(k)}`).toBe(v)
  })
  it('the rgb triplets in the stylesheet are the hexes they stand for', () => {
    for (const [name, hex] of [['accent', T.accent], ['accent-hi', T.accentHi], ['up', T.up], ['down', T.down], ['amber', T.amber], ['blue', T.blue]]) expect(token(`${name}-rgb`)).toBe(rgb(hex))
  })
  it('writes a tint the way a canvas reads it', () => {
    expect(alpha('#d9b25c', 0.5)).toBe('rgb(217 178 92 / 0.5)')
  })
})
