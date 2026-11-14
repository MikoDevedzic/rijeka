// Chat alerts: which message alerts, and the settings as this browser keeps them.
import { describe, expect, it } from 'vitest'
import { DEFAULTS, TONES, VOLUMES, category, loadPrefs, savePrefs, score, shouldAlert } from './chatAlerts'

const box = (seed) => { const m = new Map(seed ? [['rijeka.chat.alerts', seed]] : []); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }
const ROOM = { id: 'r', kind: 'DIRECT' }, NEWS = { id: 'n', kind: 'NEWS' }
const from = (over = {}) => ({ id: 'm', sender_kind: 'USER', sender_user_id: 'them', ...over })

describe('chat alerts: the settings', () => {
  it('are the defaults where nothing is saved, and where what is saved cannot be read', () => {
    expect(loadPrefs(box())).toEqual(DEFAULTS)
    expect(loadPrefs(box('{not json'))).toEqual(DEFAULTS)
    expect(loadPrefs(box('"a string"'))).toEqual(DEFAULTS)
    expect(loadPrefs({ getItem: () => { throw new Error('blocked') } })).toEqual(DEFAULTS)
  })
  it('keep what was saved, and take the default for a value of the wrong kind or a sound that does not exist', () => {
    const b = box()
    savePrefs({ ...DEFAULTS, sound: false, tone: 'knock', volume: 'loud', news: true }, b)
    expect(loadPrefs(b)).toEqual({ ...DEFAULTS, sound: false, tone: 'knock', volume: 'loud', news: true })
    expect(loadPrefs(box(JSON.stringify({ sound: 'yes', tone: 'siren', volume: 11, blink: false, stray: 1 }))))
      .toEqual({ ...DEFAULTS, blink: false })
  })
  it('start with a sound, a blink and the tab title for people, Prometheus and trade events; news and desktop notifications are off', () => {
    expect(DEFAULTS).toMatchObject({ enabled: true, sound: true, blink: true, title: true, desktop: false, people: true, prometheus: true, events: true, news: false })
  })
  it('every sound offered is written down, and none can clip at the loudest setting', () => {
    for (const [id] of TONES) {
      const notes = score(id)
      expect(notes.length, id).toBeGreaterThan(0)
      for (const [at, freq, level, decay] of notes) {
        expect(at).toBeGreaterThanOrEqual(0); expect(freq).toBeGreaterThan(40); expect(freq).toBeLessThan(8000)
        expect(level).toBeGreaterThan(0); expect(level).toBeLessThanOrEqual(1); expect(decay).toBeGreaterThan(0)
      }
      expect(Math.max(...notes.map(n => n[0] + n[3])), `${id} is short`).toBeLessThan(1.6)
    }
    expect(VOLUMES.map(v => v[0])).toEqual(['quiet', 'normal', 'loud'])
  })
})

describe('chat alerts: which message alerts', () => {
  const ctx = (over = {}) => ({ meId: 'me', attending: false, prefs: DEFAULTS, ...over })
  it('sorts a message into people, Prometheus, trade events or news, and a join or a leave into nothing', () => {
    expect(category(from(), ROOM)).toBe('people')
    expect(category(from({ card: { type: 'trade' } }), ROOM)).toBe('people')
    expect(category(from({ sender_kind: 'PROMETHEUS', sender_user_id: null }), ROOM)).toBe('prometheus')
    expect(category(from({ sender_kind: 'SYSTEM', sender_user_id: null, card: { type: 'trade_event' } }), ROOM)).toBe('events')
    expect(category(from({ sender_kind: 'SYSTEM', sender_user_id: null }), ROOM)).toBe(null)
    expect(category(from({ sender_kind: 'SYSTEM', sender_user_id: null, card: { type: 'news' } }), NEWS)).toBe('news')
  })
  it('alerts for another person\'s message, and never for one\'s own', () => {
    expect(shouldAlert(from(), ROOM, ctx())).toBe(true)
    expect(shouldAlert(from({ sender_user_id: 'me' }), ROOM, ctx())).toBe(false)
  })
  it('does not alert for the conversation being looked at, a kind switched off, a join, or anything once alerts are off', () => {
    expect(shouldAlert(from(), ROOM, ctx({ attending: true }))).toBe(false)
    expect(shouldAlert(from(), ROOM, ctx({ prefs: { ...DEFAULTS, people: false } }))).toBe(false)
    expect(shouldAlert(from({ sender_kind: 'SYSTEM', sender_user_id: null }), ROOM, ctx())).toBe(false)
    expect(shouldAlert(from(), ROOM, ctx({ prefs: { ...DEFAULTS, enabled: false } }))).toBe(false)
    expect(shouldAlert(from(), null, ctx())).toBe(false)
  })
  it('leaves the news quiet until it is asked for', () => {
    const headline = from({ sender_kind: 'SYSTEM', sender_user_id: null, card: { type: 'news' } })
    expect(shouldAlert(headline, NEWS, ctx())).toBe(false)
    expect(shouldAlert(headline, NEWS, ctx({ prefs: { ...DEFAULTS, news: true } }))).toBe(true)
  })
})
