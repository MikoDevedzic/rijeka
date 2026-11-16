// lib/a11y.js — the few things every screen needs for someone who does not use a mouse or does not see the page:
// a heading that says which page this is, a name on every field, and Enter or Space doing what a click does on a
// thing that is pressed but is not a button (a table row, a list item).
import { useEffect, useId, useRef } from 'react'

// The page's name, by the address. A page that draws a heading of its own (the methodology, the legal pages, the
// sign-in) is not in this list and gets none from here.
const PAGES = [['/command-center', 'Home'], ['/blotter', 'Blotter'], ['/pnl', 'P&L'], ['/risk', 'Risk'], ['/configurations', 'Configurations'], ['/news', 'News']]
export const pageName = (pathname) => (PAGES.find(([p]) => pathname === p || pathname.startsWith(p + '/')) || [])[1] || null

// A field's caption stands over it as text. This ties the two: every input, select and textarea inside the wrapper
// that has no name of its own is named by the caption. `ref` goes on the wrapper, `id` on the caption.
export function useFieldLabel() {
  const ref = useRef(null)
  const id = useId()
  useEffect(() => {
    ref.current?.querySelectorAll('input, select, textarea').forEach(el => {
      if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.closest('label')) el.setAttribute('aria-labelledby', id)
    })
  })
  return [ref, id]
}

// onKeyDown for a row or an item that is pressed: Enter or Space on the thing itself (not on a control inside it).
export const pressKey = (fn) => (e) => {
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e) }
}
