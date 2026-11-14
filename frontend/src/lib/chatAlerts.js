// lib/chatAlerts.js
// ────────────────────────────────────────────────────────────────────────────────────
// What tells a person a chat message arrived: a sound, the messenger button blinking, the browser tab's title
// flashing, and (if they switch it on) a desktop notification. The owner, 14 November 2026: "we also need alert
// system when you get message on there. maybe play sound or just blink...something unique. also there needs to
// bet settings for it when people can turn it off or set up setting chat alerts to how they want."
//
// The settings are this browser's (localStorage): a sound is a matter of the machine a person sits at, and
// nothing about it is the firm's or the server's. The sounds are made here with the browser's own audio; no file
// is loaded. A desktop notification names the sender and the room and never carries the message's text.
// Nothing in this file can throw into the app.
// ────────────────────────────────────────────────────────────────────────────────────
const KEY = 'rijeka.chat.alerts'

export const DEFAULTS = Object.freeze({
  enabled: true,
  sound: true, tone: 'chime', volume: 'normal',      // the owner's choice of the four, by ear (14 November 2026)
  blink: true, title: true, desktop: false,
  people: true, prometheus: true, events: true, news: false,
})
export const TONES = [['chime', 'CHIME'], ['bell', "SHIP'S BELL"], ['ping', 'PING'], ['knock', 'KNOCK']]
export const VOLUMES = [['quiet', 'QUIET'], ['normal', 'NORMAL'], ['loud', 'LOUD']]
const GAIN = { quiet: 0.18, normal: 0.42, loud: 0.85 }

/** The saved settings over the defaults; anything unreadable or of the wrong kind is the default. */
export function loadPrefs(store = globalThis.localStorage) {
  let saved = null
  try { saved = JSON.parse(store?.getItem(KEY) || 'null') } catch { /* unreadable: the defaults */ }
  const out = { ...DEFAULTS }
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === typeof DEFAULTS[k]) out[k] = saved[k]
  }
  if (!TONES.some(([id]) => id === out.tone)) out.tone = DEFAULTS.tone
  if (!(out.volume in GAIN)) out.volume = DEFAULTS.volume
  return out
}
export function savePrefs(prefs, store = globalThis.localStorage) {
  try { store?.setItem(KEY, JSON.stringify(prefs)) } catch { /* a private window: the settings last the visit */ }
}

/** Which of the four kinds a message is, or null for one that never alerts (a join, a leave). */
export function category(m, room) {
  if (room?.kind === 'NEWS') return 'news'
  if (m?.sender_kind === 'PROMETHEUS') return 'prometheus'
  if (m?.sender_kind === 'SYSTEM') return m.card?.type === 'trade_event' ? 'events' : null
  return 'people'
}

/** Does this message alert? Never one's own, never one in the conversation being looked at, never a kind switched off. */
export function shouldAlert(m, room, { meId, attending, prefs }) {
  if (!prefs?.enabled || !m || !room) return false
  if (m.sender_user_id && m.sender_user_id === meId) return false
  if (attending) return false
  const kind = category(m, room)
  return !!kind && !!prefs[kind]
}

// ── Sound ────────────────────────────────────────────────────────────────────
// Each tone is a list of partials: [start s, frequency Hz, level, seconds to die away, wave]. The bell is struck
// twice, as a ship's bell is.
const strike = (t, f) => [[t, f * 0.5, 0.18, 1.1], [t, f, 1, 0.9], [t, f * 1.2, 0.42, 0.7], [t, f * 1.5, 0.26, 0.55],
  [t, f * 2, 0.5, 0.45], [t, f * 2.5, 0.16, 0.3], [t, f * 3, 0.1, 0.22]]
const SCORE = {
  bell:  [...strike(0, 1244.5), ...strike(0.24, 1244.5)],
  chime: [[0, 659.3, 1, 0.5, 'triangle'], [0, 1318.5, 0.2, 0.3], [0.16, 987.8, 1, 0.7, 'triangle'], [0.16, 1975.5, 0.2, 0.4]],
  ping:  [[0, 1568, 1, 0.38], [0, 3136, 0.22, 0.16]],
  knock: [[0, 174.6, 1, 0.1, 'triangle'], [0, 87.3, 0.7, 0.14], [0.17, 164.8, 1, 0.1, 'triangle'], [0.17, 82.4, 0.7, 0.14]],
}
export const score = (tone) => SCORE[tone] || SCORE[DEFAULTS.tone]

let ctx = null
function audio() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}
/** A browser plays nothing until the page has been pressed once: wake the audio on the first press or key. */
export function prime() {
  if (typeof window === 'undefined' || prime.done) return
  prime.done = true
  const wake = () => { try { audio() } catch { /* no audio here */ } }
  window.addEventListener('pointerdown', wake, { once: true, capture: true })
  window.addEventListener('keydown', wake, { once: true, capture: true })
}

export function playTone(tone, volume = 'normal') {
  try {
    const ac = audio()
    if (!ac) return false
    const notes = score(tone)
    const t0 = ac.currentTime + 0.02
    const master = ac.createGain()
    // the partials of one strike sound together: scale so that their sum cannot clip
    const loudest = Math.max(...[...new Set(notes.map(n => n[0]))].map(t => notes.filter(n => n[0] === t).reduce((a, n) => a + n[2], 0)))
    master.gain.value = (GAIN[volume] ?? GAIN.normal) / Math.max(1, loudest * 1.4)     // 1.4: a second strike sounds over the first's tail
    master.connect(ac.destination)
    for (const [at, freq, level, decay, wave] of notes) {
      const osc = ac.createOscillator(), g = ac.createGain()
      osc.type = wave || 'sine'
      osc.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t0 + at)
      g.gain.exponentialRampToValueAtTime(level, t0 + at + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + decay)
      osc.connect(g); g.connect(master)
      osc.start(t0 + at); osc.stop(t0 + at + decay + 0.05)
    }
    return true
  } catch { return false }
}

// ── The tab's title ──────────────────────────────────────────────────────────
const FLASH = '● New message · Rijeka'
let flashing = null
const away = () => typeof document !== 'undefined' && (document.visibilityState !== 'visible' || !document.hasFocus())
/** While the page is not being looked at, its tab says a message arrived; it stops when the page is looked at. */
export function flashTitle() {
  if (typeof document === 'undefined' || flashing || !away()) return
  let base = document.title, on = false
  const stop = () => {
    clearInterval(flashing.timer)
    window.removeEventListener('focus', seen); document.removeEventListener('visibilitychange', seen)
    if (document.title === FLASH) document.title = base
    flashing = null
  }
  const seen = () => { if (!away()) stop() }
  const timer = setInterval(() => {
    if (document.title !== FLASH) base = document.title            // a page that set its own title keeps it
    on = !on
    document.title = on ? FLASH : base
  }, 1000)
  flashing = { timer }
  window.addEventListener('focus', seen); document.addEventListener('visibilitychange', seen)
}

// ── Desktop notification ─────────────────────────────────────────────────────
export const desktopState = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)   // default | granted | denied | unsupported
export async function askDesktop() {
  try { return typeof Notification === 'undefined' ? 'unsupported' : await Notification.requestPermission() } catch { return 'denied' }
}
function desktop(who, where, roomId, onOpen) {
  try {
    if (desktopState() !== 'granted' || !away()) return
    const n = new Notification(`Rijeka · ${who}`, { body: where, tag: `rijeka-chat-${roomId}`, silent: true })
    n.onclick = () => { try { window.focus(); onOpen?.(); n.close() } catch { /* the window is gone */ } }
  } catch { /* a browser that refuses: the other alerts stand */ }
}

// ── One alert ────────────────────────────────────────────────────────────────
// Several Rijeka windows may be open (tabs, the messenger in a window of its own) and each hears of the message.
// The sound and the notification are made by one of them: the first to take the lock, which it holds for a moment,
// so a burst of messages is also one sound.
const HOLD_MS = 1200
let last = 0
async function once(fn) {
  const locks = globalThis.navigator?.locks
  if (!locks?.request) {
    if (Date.now() - last < HOLD_MS) return
    last = Date.now(); fn(); return
  }
  try {
    await locks.request('rijeka-chat-alert', { ifAvailable: true }, async (lock) => {
      if (!lock) return
      fn()
      await new Promise(r => setTimeout(r, HOLD_MS))
    })
  } catch { /* no lock to be had: stay quiet rather than ring in every window */ }
}

/** Make the alert the settings ask for. `who` and `where` are the sender's name and the room's title. */
export function alert(prefs, { who, where, roomId, onOpen } = {}) {
  try {
    if (!prefs?.enabled) return
    if (prefs.title) flashTitle()
    if (prefs.sound || prefs.desktop) once(() => {
      if (prefs.sound) playTone(prefs.tone, prefs.volume)
      if (prefs.desktop) desktop(who || 'New message', where || '', roomId, onOpen)
    })
  } catch { /* an alert must never break the chat */ }
}
