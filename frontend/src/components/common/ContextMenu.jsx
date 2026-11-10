// common/ContextMenu.jsx — the desk's own right-click menu. A caller keeps `{ x, y, items }` in its state (set from an
// onContextMenu handler that calls preventDefault) and renders <ContextMenu> while it is set. An item is
// { label, hint, onSelect, disabled } or { separator: true } or { heading }. The menu is drawn at the pointer,
// kept inside the browser's window, and goes on a choice, a click anywhere else, Escape, a scroll or a resize.
// The keyboard works it: the arrows move, Home and End jump, Enter or Space chooses.
//
// It is only ever put on things that have actions of their own (a row of the blotter): text fields and links keep
// the browser's menu, with its paste and its "open in a new tab".
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function ContextMenu({ x, y, items, onClose, label = 'Actions' }) {
  const ref = useRef(null)
  const [at, setAt] = useState({ left: x, top: y })
  const usable = items.map((it, i) => (it.separator || it.heading || it.disabled ? -1 : i)).filter(i => i >= 0)
  const [active, setActive] = useState(usable[0] ?? -1)

  // inside the window: moved left or up by what would hang over the edge
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAt({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) })
    el.focus()
  }, [x, y])

  useEffect(() => {
    const away = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const gone = () => onClose()
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('scroll', gone, true)
    window.addEventListener('resize', gone)
    window.addEventListener('blur', gone)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      window.removeEventListener('scroll', gone, true)
      window.removeEventListener('resize', gone)
      window.removeEventListener('blur', gone)
    }
  }, [onClose])

  // nothing to offer (what it was opened on has gone): closed, not left to come back later
  const empty = usable.length === 0
  useEffect(() => { if (empty) onClose() }, [empty, onClose])

  const choose = (it) => { if (!it || it.disabled) return; onClose(); it.onSelect?.() }
  const onKey = (e) => {
    const k = usable.indexOf(active)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(usable[(k + 1) % usable.length]) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(usable[(k - 1 + usable.length) % usable.length]) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(usable[0]) }
    else if (e.key === 'End') { e.preventDefault(); setActive(usable[usable.length - 1]) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); choose(items[active]) }
    else if (e.key === 'Tab') { e.preventDefault(); onClose() }
  }

  if (empty) return null
  return createPortal(
    <div ref={ref} className="rj-menu" role="menu" aria-label={label} tabIndex={-1} data-testid="context-menu" data-no-shortcuts
         style={{ left: at.left, top: at.top }} onKeyDown={onKey} onContextMenu={e => e.preventDefault()}>
      {items.map((it, i) => it.separator ? <div key={i} className="rj-menu-sep" role="separator" />
        : it.heading ? <div key={i} className="rj-menu-head">{it.heading}</div>
        : (
          <button key={i} type="button" role="menuitem" tabIndex={-1} disabled={it.disabled} className={`rj-menu-item${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => !it.disabled && setActive(i)} onClick={() => choose(it)}>
            <span>{it.label}</span>{it.hint && <span className="rj-menu-hint">{it.hint}</span>}
          </button>
        ))}
    </div>, document.body)
}
