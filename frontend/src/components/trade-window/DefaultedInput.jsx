// A numeric field that has a default: it shows the number the price uses when nobody has typed one, in the
// normal text colour with a few muted words under it saying where the number comes from, and turns into an
// override (accent colour, "override", a control that puts the default back) once the user types. Text that
// cannot be read as a number is kept, in the warning colour, and says so. The states and the text are in
// defaulted-input.js; this is the input. NumberInput is the same reading for a field with no default.
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { fieldView, overrideFrom, groupForDisplay, INVALID_TAG } from './defaulted-input'
import { parseNumber } from './fx-ticket'

// `action` is a small control of the field's own, at the end of the line under it (SPOT's snap).
export default function DefaultedInput({ value, fallback, format, tag, onChange, testId, signed = false, dim = false, title, action = null }) {
  const input = useRef(null)
  const [focused, setFocused] = useState(false)
  const view = fieldView({ value, fallback, format, tag, signed })
  const typed = view.state === 'override' || view.state === 'invalid'
  // grouped for reading while the field is not being edited, as typed while it is
  const shown = focused || view.state === 'invalid' || view.state === 'empty' ? view.text : groupForDisplay(view.text)
  // Back on the default while the field has the focus (cleared by hand, or reset): the number is selected again,
  // so the next key replaces it and is not added to it.
  useEffect(() => {
    const el = input.current
    if (!typed && el && document.activeElement === el) el.select()
  }, [typed, view.text])
  return (
    <div className="tbw-fx-def">
      <input ref={input} className={`tbw-mono tbw-fx-def-input is-${view.state}${dim && !typed ? ' tbw-fx-dim' : ''}`}
             type="text" inputMode="decimal" data-testid={testId} data-state={view.state} aria-invalid={view.state === 'invalid' || undefined} value={shown} title={title}
             // Selected on focus: the text goes from its grouped to its typed writing in the same breath (flushSync), and
             // is selected after that, so a key or a paste that follows replaces the number instead of being added to it
             // (a selection made before the focus is lost when the text changes under it). Once more after the click
             // that gave the focus has placed its caret.
             onFocus={e => { const el = e.target; flushSync(() => setFocused(true)); el.select(); setTimeout(() => { if (document.activeElement === el) el.select() }, 0) }}
             onBlur={() => setFocused(false)}
             onChange={e => onChange(overrideFrom(e.target.value))} />
      {/* invalid: the words run on and the controls drop under them (styles.css), so neither hides the other */}
      <div className={`tbw-fx-tag${view.state === 'invalid' ? ' is-invalid' : ''}`} title={title || view.tag}>
        <span className={view.state === 'override' ? 'tbw-fx-tag-override' : view.state === 'invalid' ? 'tbw-fx-tag-invalid' : undefined}>{view.tag}</span>
        {typed && (
          <button type="button" className="tbw-fx-reset" aria-label="Back to the default" title="Back to the default" data-testid={testId ? `${testId}-reset` : undefined}
                  onClick={() => onChange('')}>↺</button>
        )}
        {action}
      </div>
    </div>
  )
}

// A numeric field with no default (notional, a barrier level, a payout): the text as typed, read by the same
// parser; text that cannot be read is kept, marked, and says so under the field. `tag` is a muted line for a
// field that has something to say when it can be read (the notional, grouped).
export function NumberInput({ value, onChange, signed = false, testId, placeholder, tag = null }) {
  const [focused, setFocused] = useState(false)
  const invalid = parseNumber(value == null ? '' : value, { signed }).state === 'invalid'
  const shown = focused || invalid ? value : groupForDisplay(value)
  return (
    <div className="tbw-fx-def">
      {/* selected on focus as the fields with a default are: the text goes to its typed writing first (flushSync), then
          is selected, so what follows replaces the number instead of being added to it */}
      <input className={`tbw-mono tbw-fx-def-input${invalid ? ' is-invalid' : ''}`} type="text" inputMode="decimal" data-testid={testId} data-state={invalid ? 'invalid' : 'ok'}
             aria-invalid={invalid || undefined} placeholder={placeholder} value={shown}
             onFocus={e => { const el = e.target; flushSync(() => setFocused(true)); el.select(); setTimeout(() => { if (document.activeElement === el) el.select() }, 0) }}
             onBlur={() => setFocused(false)}
             onChange={e => onChange(e.target.value)} />
      {/* the grouped read-back is for while the number is being typed ungrouped; at rest the field itself is grouped */}
      {(invalid || (tag && focused)) && (
        <div className="tbw-fx-tag" title={invalid ? INVALID_TAG : tag}><span className={invalid ? 'tbw-fx-tag-invalid' : undefined}>{invalid ? INVALID_TAG : tag}</span></div>
      )}
    </div>
  )
}
