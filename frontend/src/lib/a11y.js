// lib/a11y.js — the few things every screen needs for someone who does not use a mouse or does not see the page:
// a heading that says which page this is, a name on every field, and Enter or Space doing what a click does on a
// thing that is pressed but is not a button (a table row, a list item).
import { useEffect, useId, useRef } from 'react'

// The page's name, by the address, for a page that draws no first heading of its own. The ones that do (the
// methodology, the roadmap, the legal pages, the sign-in, the news, the two record pages under Configurations, a new
// firm's first home) are left out here: a page has one first heading. The journey `pages.spec.js` holds every page
// it opens to exactly one.
const PAGES = [['/command-center', 'Home'], ['/blotter', 'Blotter'], ['/pnl', 'P&L'], ['/risk', 'Risk'], ['/configurations', 'Configurations']]
const OWN = ['/configurations/legal-entities', '/configurations/counterparties']
export const pageName = (pathname) => (OWN.some(p => pathname === p || pathname.startsWith(p + '/')) ? null
  : (PAGES.find(([p]) => pathname === p || pathname.startsWith(p + '/')) || [])[1] || null)

// A field's caption stands over it as text. This ties the two: every input, select and textarea inside the wrapper
// that has no name of its own is named by the caption; where the caption stands over several controls (a pair of
// dates, a rate and its switch) each is named by the caption and what tells it from the others (its own tooltip or
// placeholder, else its place). A control that appears later, when a block opens or a leg is added, is named when
// it appears. `ref` goes on the wrapper, `id` on the caption.
export function nameFields(wrapper, captionId) {
  if (!wrapper) return
  const open = [...wrapper.querySelectorAll('input:not([type=hidden]), select, textarea')]
    .filter(el => !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.closest('label') && !(el.id && wrapper.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`)))
  if (open.length === 1) { open[0].setAttribute('aria-labelledby', captionId); return }
  const caption = (wrapper.ownerDocument.getElementById(captionId)?.textContent || '').replace(/\s+/g, ' ').trim()
  open.forEach((el, i) => el.setAttribute('aria-label', `${caption} · ${el.getAttribute('title') || el.getAttribute('placeholder') || i + 1}`.trim()))
}
export function useFieldLabel() {
  const ref = useRef(null)
  const id = useId()
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    nameFields(el, id)
    if (typeof MutationObserver !== 'function') return undefined
    const mo = new MutationObserver(() => nameFields(el, id))       // children that mount later; setting a name is not a child change, so this does not call itself
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [id])
  return [ref, id]
}

// onKeyDown for a row or an item that is pressed: Enter or Space on the thing itself (not on a control inside it),
// with no modifier held (Ctrl+Enter is the ticket's BOOK, and belongs to it).
export const pressKey = (fn) => (e) => {
  if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e) }
}
