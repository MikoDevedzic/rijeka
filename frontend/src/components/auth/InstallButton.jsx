// "Add to Home Screen", on the door, on a phone. Where the browser can install the app itself (Android) the button
// asks it to. An iPhone does not let a page do that, so the button shows the two taps instead: Share, then Add to
// Home Screen. Once the app is running from its icon the button is not shown.
import { useEffect, useState } from 'react'
import { usePhone, standalone } from '../../lib/phone'

export default function InstallButton() {
  const phone = usePhone()
  const [prompt, setPrompt] = useState(null)        // Android's own install prompt, when it offers one
  const [sheet, setSheet] = useState(false)
  const [installed, setInstalled] = useState(standalone)
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
    const key = (e) => { if (e.key === 'Escape') setSheet(false) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [sheet])
  if (!phone || installed) return null
  const press = async () => {
    if (!prompt) { setSheet(true); return }
    prompt.prompt()
    try { await prompt.userChoice } catch { /* dismissed */ }
    setPrompt(null)
  }
  const ios = /iphone|ipad|ipod/i.test(window.navigator?.userAgent || '')
  return (
    <>
      <button type="button" className="au-install" data-testid="add-to-home" onClick={press}>
        <img src="/favicon.svg" alt="" width="20" height="20" />ADD TO HOME SCREEN
      </button>
      {sheet && (
        <div className="au-sheet" role="dialog" aria-modal="true" aria-label="Add Rijeka to your home screen" onClick={() => setSheet(false)}>
          <div onClick={e => e.stopPropagation()}>
            <div className="au-sheet-icon"><img src="/apple-touch-icon.png" alt="" width="58" height="58" /><div><b>Rijeka</b><span>opens full screen, like an app</span></div></div>
            <ol>
              {ios
                ? <><li>Tap <b>Share</b> in Safari's bar.</li><li>Choose <b>Add to Home Screen</b>.</li></>
                : <><li>Open your browser's menu.</li><li>Choose <b>Add to Home screen</b> or <b>Install app</b>.</li></>}
              <li>Open <b>Rijeka</b> from its icon.</li>
            </ol>
            <button type="button" className="au-install" onClick={() => setSheet(false)}>GOT IT</button>
          </div>
        </div>
      )}
    </>
  )
}
