import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { install as installErrorReporting } from './lib/errors'

// Uncaught errors are also reported to the operator (lib/errors.js): a blank page
// nobody tells us about is the one failure mode that stays invisible.
installErrorReporting()

// A blank page tells nobody anything. Errors that escape React (module
// evaluation, auth bootstrap, unhandled promises) or an app that never mounts
// render a readable card with the message, so the problem can be reported.
const root = document.getElementById('root')

function showFatal(title, detail) {
  if (root.querySelector('[data-fatal]')) return
  const box = document.createElement('div')
  box.setAttribute('data-fatal', '1')
  box.setAttribute('role', 'alert')
  box.style.cssText = 'min-height:100vh;display:flex;align-items:center;justify-content:center;background:#07090C;color:#DCE3EA;font-family:Space Grotesk,system-ui,sans-serif;padding:24px'
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  box.innerHTML =
    '<div style="max-width:560px;width:100%;border:1px solid #26303C;border-radius:8px;padding:28px;background:#0C1015">' +
    '<div style="font-size:11px;letter-spacing:.18em;color:#f0a020;margin-bottom:10px">RIJEKA · COULD NOT START</div>' +
    '<div style="font-size:16px;font-weight:600;color:#F4F7FA;margin-bottom:8px">' + esc(title) + '</div>' +
    '<div style="font-size:13px;color:#8B98A8;line-height:1.5;margin-bottom:14px">Nothing was changed by this. Reload to try again; if it repeats, send the text below to miko@rijeka.app.</div>' +
    '<pre style="white-space:pre-wrap;word-break:break-word;font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;color:#DCE3EA;background:#07090C;border:1px solid #1A222C;border-radius:4px;padding:10px;max-height:40vh;overflow:auto">' + esc(detail) + '</pre>' +
    '<div style="display:flex;gap:8px;margin-top:14px">' +
    '<button onclick="location.reload()" style="background:#0dd4a8;color:#04120E;border:0;border-radius:3px;padding:8px 14px;font-weight:700;letter-spacing:.08em;cursor:pointer">RELOAD</button>' +
    '<button onclick="try{sessionStorage.clear();localStorage.clear()}catch(e){};location.href=\'/login\'" style="background:#11171E;color:#DCE3EA;border:1px solid #26303C;border-radius:3px;padding:8px 14px;letter-spacing:.08em;cursor:pointer">SIGN OUT &amp; RELOAD</button>' +
    '</div></div>'
  root.replaceChildren(box)
}

window.addEventListener('error', (e) => {
  const err = e.error || e.message
  showFatal('The desk hit an error while loading', (err && err.stack) || String(err) + (e.filename ? `\n${e.filename}:${e.lineno}` : ''))
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  showFatal('The desk hit an error while loading', (r && r.stack) || String(r))
})
setTimeout(() => {
  if (!root.childElementCount) showFatal('The desk did not start', 'Nothing rendered within 8 seconds. Check the connection to app.rijeka.app and reload.')
}, 8000)

try {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
} catch (err) {
  showFatal('The desk could not mount', (err && err.stack) || String(err))
}
