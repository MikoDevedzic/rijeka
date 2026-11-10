// lib/notes.js — whether the ticket's notes are written out or behind their marks (components/common/Note.jsx),
// remembered in this browser and the same for every ticket; and where a note's bubble goes.
import { useSyncExternalStore } from 'react'

const KEY = 'rj.notes'
let on = false
try { on = window.localStorage.getItem(KEY) === '1' } catch { /* a private window: off, and not remembered */ }
const listeners = new Set()
const paint = () => { if (typeof document !== 'undefined') document.documentElement.dataset.notes = on ? 'on' : 'off' }
paint()

export function setNotesOn(value) {
  on = !!value
  try { window.localStorage.setItem(KEY, on ? '1' : '0') } catch { /* not remembered */ }
  paint()
  listeners.forEach(f => f())
}
const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f) }
export const notesOn = () => on
export function useNotesOn() { return useSyncExternalStore(subscribe, () => on, () => false) }

// Where the bubble goes: under the mark, kept inside the window of the browser; above it when there is no room below.
export function bubblePlace(mark, bubble, view) {
  const W = 320, gap = 6
  const left = Math.max(8, Math.min(mark.left, view.width - W - 8))
  const below = mark.bottom + gap
  const top = below + bubble.height > view.height - 8 && mark.top - gap - bubble.height > 8 ? mark.top - gap - bubble.height : below
  return { left: Math.round(left), top: Math.round(top) }
}

