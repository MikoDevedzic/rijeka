// "Add to Home Screen", on the door, on a phone. Where the browser can install the app itself (Android) the button
// asks it to. An iPhone does not let a page do that, so the button shows the taps instead, and shows the ones this
// browser has (lib/phone.js installWay): Safari has kept its Share button in three places. Once the app is running
// from its icon the button is not shown.
//
// On a monitor the same button reads "Open as an app" (the owner, 14 November 2026: "i want user to feel like they
// actualy entered seperate system and not just some website"). Installed, Rijeka opens in a window of its own with no
// address bar and its own icon. Chrome and Edge are asked to do it; where they have not offered, and in Safari on a
// Mac, the button shows the browser's own menu steps (lib/phone.js desktopInstallWay). A browser with no way to do
// it (Firefox) is shown no button. An iPad, which is wider than a phone, is shown the phone's button and taps.
import { useEffect, useRef, useState } from 'react'
import { usePhone, standalone, installWay, desktopInstallWay, isIos } from '../../lib/phone'

// the glyphs as Safari draws them, beside the words that name them (so they are not read out twice)
const Glyph = ({ children }) => (
  <svg className="au-glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const ShareGlyph = () => <Glyph><path d="M8 9.5v-8M5.2 4 8 1.5 10.8 4M5 6.5H3.5v8h9v-8H11" /></Glyph>
const AddGlyph = () => <Glyph><rect x="2" y="2" width="12" height="12" rx="3" /><path d="M8 5v6M5 8h6" /></Glyph>
// the three dots have no word on Safari's screen, so this glyph carries its own name for a reader
const DotsGlyph = () => (
  <svg className="au-glyph" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="the three dots" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3.5 8h.01M8 8h.01M12.5 8h.01" /></svg>
)

const share = <span className="au-nb"><b>Share</b> <ShareGlyph /></span>            // a glyph stays on its word's line
const inBar = <>If the bar shows {share}, tap that instead.</>
// the first step and the line under the list, by the way this browser has; the steps after Share are the same everywhere.
// They name the address bar and the bar, not Safari: a browser that sends Safari's user agent reads the same sheet.
const WAYS = {
  'safari-27': { first: <>Press and hold the <b>address bar</b>, then tap {share}.</>, note: inBar },
  'safari-26': { first: <>Tap <DotsGlyph /> beside the address bar, then {share}.</>, note: inBar },
  safari: { first: <>Tap {share} in the browser's bar.</> },
  'other-browser': { first: <>Open your browser's {share} menu.</>, note: <>Not listed? Open <b>app.rijeka.app</b> in Safari and press this button.</> },
}

// the steps on a monitor, by browser, in the browser's own words; `note` is the line under them
const DESK = {
  chrome: {
    steps: [<>Open the browser's menu (three dots, top right).</>, <>Choose <b>Cast, save, and share</b>.</>, <>Choose <b>Install page as app…</b></>, <>Press <b>Install</b>. Rijeka opens in its own window.</>],
    note: <>If the address bar shows an install button at its right end, press that instead. If the menu has no such line, this browser cannot install apps; Chrome and Edge can.</>,
  },
  edge: {
    steps: [<>Open the browser's menu (three dots, top right).</>, <>Choose <b>Apps</b>.</>, <>Choose <b>Install this site as an app</b>.</>, <>Press <b>Install</b>. Rijeka opens in its own window.</>],
    note: <>If the address bar shows an install button at its right end, press that instead.</>,
  },
  'safari-mac': {
    steps: [<>In the menu bar, open <b>File</b>.</>, <>Choose <b>Add to Dock…</b></>, <>Press <b>Add</b>.</>, <>Open <b>Rijeka</b> from the Dock.</>],
    note: <>Add to Dock is also behind the <b>Share</b> button in Safari's toolbar.</>,
  },
}

export default function InstallButton() {
  const phone = usePhone()
  const [prompt, setPrompt] = useState(null)        // Android's own install prompt, when it offers one
  const [sheet, setSheet] = useState(false)
  const [installed, setInstalled] = useState(standalone)
  const opener = useRef(null)
  const close = () => { setSheet(false); opener.current?.focus() }      // focus goes back to the button that opened the sheet
  useEffect(() => {
    const offer = (e) => { e.preventDefault(); setPrompt(e) }
    const done = () => { setInstalled(true); setSheet(false) }
    window.addEventListener('beforeinstallprompt', offer)
    window.addEventListener('appinstalled', done)
    return () => { window.removeEventListener('beforeinstallprompt', offer); window.removeEventListener('appinstalled', done) }
  }, [])
  // Escape closes the sheet, as a tap outside it does
  useEffect(() => {
    if (!sheet) return undefined
    const key = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [sheet])
  const nav = window.navigator || {}
  const about = [nav.userAgent || '', nav.platform || '', nav.maxTouchPoints || 0]
  // a monitor's browser that can give the app a window of its own; an iPad is wider than a phone and is not one
  const desk = !phone && !isIos(...about) ? desktopInstallWay(...about) : null
  if (installed || (!phone && !isIos(...about) && !desk)) return null
  const press = async () => {
    if (!prompt) { setSheet(true); return }
    prompt.prompt()
    try { await prompt.userChoice } catch { /* dismissed */ }
    setPrompt(null)
  }
  if (desk) {
    const how = DESK[desk]
    return (
      <>
        <div className="au-install-desk">
          <button type="button" className="au-install" data-testid="open-as-app" ref={opener} onClick={press}>
            <img src="/favicon.svg" alt="" width="20" height="20" />OPEN AS AN APP
          </button>
          <small>Its own window and its own icon, with no browser around it.</small>
        </div>
        {sheet && (
          <div className="au-sheet" role="dialog" aria-modal="true" aria-label="Open Rijeka as an app" data-way={desk} onClick={close}>
            <div onClick={e => e.stopPropagation()}>
              <div className="au-sheet-icon"><img src="/apple-touch-icon.png" alt="" width="58" height="58" /><div><b>Rijeka</b><span>opens in its own window, from its own icon</span></div></div>
              <ol>{how.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
              <p className="au-sheet-note">{how.note}</p>
              <button type="button" className="au-install" autoFocus onClick={close}>GOT IT</button>
            </div>
          </div>
        )}
      </>
    )
  }
  const way = installWay(...about)
  const taps = WAYS[way]
  return (
    <>
      <button type="button" className="au-install" data-testid="add-to-home" ref={opener} onClick={press}>
        <img src="/favicon.svg" alt="" width="20" height="20" />ADD TO HOME SCREEN
      </button>
      {sheet && (
        <div className="au-sheet" role="dialog" aria-modal="true" aria-label="Add Rijeka to your home screen" data-way={way} onClick={close}>
          <div onClick={e => e.stopPropagation()}>
            <div className="au-sheet-icon"><img src="/apple-touch-icon.png" alt="" width="58" height="58" /><div><b>Rijeka</b><span>opens full screen, like an app</span></div></div>
            {way === 'in-app' && <p className="au-sheet-lead">This page is inside another app, which cannot add it.</p>}
            {way === 'in-app'
              ? <ol><li>Open <b>app.rijeka.app</b> in Safari.</li><li>Tap <b>Add to Home Screen</b> there.</li></ol>
              : taps
                ? <ol><li>{taps.first}</li><li>Scroll down and tap <span className="au-nb"><b>Add to Home Screen</b> <AddGlyph /></span>.</li><li>Tap <b>Add</b>.</li><li>Open <b>Rijeka</b> from its icon.</li></ol>
                /* Android's own words: Chrome writes "Add to Home screen" */
                : <ol><li>Open your browser's menu.</li><li>Choose <b>Add to Home screen</b> or <b>Install app</b>.</li><li>Open <b>Rijeka</b> from its icon.</li></ol>}
            {taps?.note && <p className="au-sheet-note">{taps.note}</p>}
            <button type="button" className="au-install" autoFocus onClick={close}>GOT IT</button>
          </div>
        </div>
      )}
    </>
  )
}
