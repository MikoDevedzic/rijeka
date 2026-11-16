// The Problems panel's words: who a problem hit, what kind it is, and whom the alarm reaches.
import { describe, it, expect } from 'vitest'
import { headline, kindLine, toldLine, when, whoLine } from './problems-view'

describe('problems-view', () => {
  it('names who was hit, counts those it cannot name, and says when nobody was signed in', () => {
    expect(whoLine({ emails: ['one@example.com', 'two@example.com'], accounts: 2, anonymous: 0 })).toBe('one@example.com, two@example.com')
    expect(whoLine({ emails: ['one@example.com'], accounts: 3, anonymous: 2 })).toBe('one@example.com, 2 more accounts, 2 not signed in')
    expect(whoLine({ emails: [], accounts: 1, anonymous: 1 })).toBe('1 more account, a visitor not signed in')
    expect(whoLine({ emails: [], accounts: 0, anonymous: 0 })).toBe('—'); expect(whoLine({})).toBe('—')
  })
  it('says what kind of problem it is, where it was reported from, and when it does not ring', () => {
    expect(kindLine({ kind: 'browser', source: 'boundary-load', release: '063bb5f4b8bf', rings: true })).toBe('in the browser · boundary-load · 063bb5f')
    expect(kindLine({ kind: 'api', source: 'POST', release: null, rings: true })).toBe('the API answered an error')
    expect(kindLine({ kind: 'api', source: 'POST', rings: false })).toBe('the API answered an error · kept, does not ring')
    expect(kindLine({ kind: 'browser', source: 'net-chat-send', release: 'dev', rings: false })).toBe('in the browser · net-chat-send · kept, does not ring')
    expect(kindLine({ kind: 'slow' })).toBe('a slow answer')
  })
  it('says in the header how many, or why there is none to give', () => {
    expect(headline({ recording: false, problems: [] })).toBe('not kept: the health table is not applied, and nobody is alerted')
    expect(headline({ recording: true, unread: true, problems: [] })).toBe('not read just now: reload to ask again')
    expect(headline({ recording: true, problems: [], occurrences: 0 })).toBe('none')
    expect(headline({ recording: true, problems: [{}], occurrences: 1 })).toBe('1 problem · 1 occurrence')
    expect(headline({ recording: true, problems: [{}, {}], occurrences: 2000, truncated: true })).toBe('2 problems · 2000 occurrences · the newest only')
    expect(headline(null)).toBe('')
  })
  it('says whom the alarm reaches, and says so loudly when it reaches nobody', () => {
    expect(toldLine({ recording: true, rooms: 1, mail: false })).toEqual({ silent: false, text: "The operator is told by a message in the admin's support room." })
    expect(toldLine({ recording: true, rooms: 2, mail: true })).toEqual({ silent: false, text: "The operator is told by a message in 2 admins' support rooms and a mail." })
    expect(toldLine({ recording: true, rooms: 0, mail: true })).toEqual({ silent: false, text: 'The operator is told by a mail.' })
    const nobody = toldLine({ recording: true, rooms: 0, mail: false })
    expect(nobody.silent).toBe(true); expect(nobody.text).toMatch(/^NOBODY IS TOLD/)
    expect(toldLine({ recording: false })).toEqual({ silent: false, text: '' }); expect(toldLine(null)).toEqual({ silent: false, text: '' })
  })
  it('writes a moment as the page\'s other panels do', () => {
    expect(when('2026-11-16T14:31:00+00:00', 'en-GB')).toMatch(/^16 Nov,? \d\d:31$/); expect(when(null)).toBe('—'); expect(when('soon')).toBe('—')
  })
})
