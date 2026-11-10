// common/Note.jsx — an explanation that stays off the page until it is asked for. A figure's note (where the
// number is from, what a leg means, why a row is what it is) is a small mark beside it; the note itself shows
// when the mark is hovered, focused or tapped. One switch (NotesToggle, on the ticket's tab bar) writes every
// note out in place instead, for learning the screen, for a picture, or for a screen with no pointer.
//
// The note's text is always in the page (hidden, then shown), so a reader that takes the text of a panel still
// gets it. The switch is remembered in this browser and is the same for every ticket.
import { useId, useRef } from 'react'
import { bubblePlace, notesOn, setNotesOn, useNotesOn } from '../../lib/notes'

// `inline`: the note belongs in a line of text (after a leg's name); written out, it stays in the line.
// `corner`: the mark sits in the top right corner of the nearest positioned box (a tile); written out, the note
// is a line where it stands in the markup.
// `markOnly`: with NOTES on this note is written out somewhere with more room (a line under a table), so here it goes.
export function Note({ children, inline = false, corner = false, markOnly = false, testId }) {
  const body = useRef(null)
  const id = useId()
  if (children == null || children === false || children === '') return null
  const place = (e) => {
    const b = body.current, mark = e.currentTarget.firstElementChild
    if (!b || !mark || notesOn()) return
    // measured while shown: the handler runs after the hover or the focus has taken effect
    const p = bubblePlace(mark.getBoundingClientRect(), { height: b.offsetHeight || 60 }, { width: window.innerWidth, height: window.innerHeight })
    b.style.left = `${p.left}px`; b.style.top = `${p.top}px`
  }
  return (
    <span className={`rj-note${inline ? ' rj-note-inline' : ''}${corner ? ' rj-note-corner' : ''}${markOnly ? ' rj-note-off' : ''}`} tabIndex={0}
          role="img" aria-label="note" aria-describedby={id} onMouseEnter={place} onFocus={place} data-testid={testId}>
      <span className="rj-note-mark" aria-hidden="true">i</span>
      <span className="rj-note-body" id={id} ref={body} role="note">{children}</span>
    </span>
  )
}

// The switch: every note written out, or every note behind its mark.
export function NotesToggle() {
  const shown = useNotesOn()
  return (
    <button type="button" className={`tbw-notes-toggle${shown ? ' is-on' : ''}`} aria-pressed={shown} data-testid="notes-toggle"
            title={shown ? 'Notes are written out beside each figure. Press to put them back behind their marks.' : 'Each figure\'s note is behind the small mark beside it. Press to write them all out.'}
            onClick={() => setNotesOn(!shown)}>
      <span className="rj-note-mark" aria-hidden="true">i</span>NOTES
    </button>
  )
}
