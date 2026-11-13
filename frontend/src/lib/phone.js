// A phone: a screen too narrow for the desk as it is laid out for a monitor. The phone view (0.32.0) is the home,
// the trades, the trade window, chat and news; everything else stays on a larger screen. One query, used by the
// stylesheet (layout/Phone.css, the same 640px) and by the few components whose structure differs.
import { useEffect, useState } from 'react'

export const PHONE_QUERY = '(max-width: 640px)'
const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null)

export const isPhone = () => !!query()?.matches

export function usePhone() {
  const [phone, setPhone] = useState(isPhone)
  useEffect(() => {
    const q = query()
    if (!q) return undefined
    const on = () => setPhone(q.matches)
    on()
    q.addEventListener?.('change', on)
    return () => q.removeEventListener?.('change', on)
  }, [])
  return phone
}

// Running from its icon on a home screen, with no browser bar (the manifest's "standalone"; Safari's own flag).
export const standalone = () => typeof window !== 'undefined'
  && ((typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) || window.navigator?.standalone === true)

// An iPhone enlarges the page when a field with type under 16px takes the focus, and leaves it enlarged: sign in on
// the door and the desk behind it opens zoomed past the screen's edges. A viewport that says "no larger than 1" stops
// that enlargement there and nowhere else (an iPhone still lets two fingers zoom). Other phones do not enlarge on
// focus, and for them the same words would take pinch-zoom away, so they are left alone.
export const isIos = (ua = '', platform = '', touchPoints = 0) => /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1)
export const viewportOnIos = (content = '') => (/maximum-scale/.test(content) ? content : `${content}${content ? ', ' : ''}maximum-scale=1`)
export function keepScaleOnFocus() {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return false
  if (!isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)) return false
  const meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return false
  meta.setAttribute('content', viewportOnIos(meta.getAttribute('content') || ''))
  return true
}

// On a phone a wide table is read downwards: each row a block, each cell under its column's heading (Phone.css,
// table[data-stack]). The heading's words are written onto the cell here, since a stylesheet cannot reach them.
// A table of four columns or fewer fits and stays a table; one that says data-stack="no" is left alone.
export const STACK_FROM = 5
const said = (th) => { const c = th.cloneNode(true); c.querySelectorAll('.rj-note, .kc').forEach(n => n.remove()); return (c.textContent || '').replace(/\s+/g, ' ').trim() }
export function labelTables(root) {
  for (const table of root.querySelectorAll('table')) {
    if (table.dataset.stack === 'no') continue
    const heads = [...table.querySelectorAll(':scope > thead > tr:last-child > th')]
    const names = []
    for (const h of heads) { const n = said(h); for (let i = 0; i < (h.colSpan || 1); i++) names.push(n) }
    if (names.length < STACK_FROM) continue
    if (!table.dataset.stack) table.dataset.stack = 'yes'
    for (const tr of table.querySelectorAll(':scope > tbody > tr, :scope > tfoot > tr')) {
      let at = 0
      for (const cell of tr.children) {
        const n = names[at] || ''
        if (cell.dataset.label !== n && !cell.hasAttribute('data-label-own')) cell.dataset.label = n
        at += cell.colSpan || 1
      }
    }
  }
}
export function useStackedTables(ref, on) {
  useEffect(() => {
    const el = ref.current
    if (!on || !el || typeof MutationObserver === 'undefined') return undefined
    let frame = 0
    const run = () => { frame = 0; labelTables(el) }
    run()
    const seen = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(run) })      // rows come and go; the labels are attributes, which are not watched
    seen.observe(el, { childList: true, subtree: true })
    return () => { seen.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [ref, on])
}
