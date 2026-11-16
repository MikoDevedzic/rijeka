// The Problems panel's words: who a problem hit, and what the header says of the state of the alarm.
import { describe, it, expect } from 'vitest'
import { headline, whoLine } from './problems-view'

describe('problems-view', () => {
  it('names who was hit, counts those it cannot name, and says when nobody was signed in', () => {
    expect(whoLine({ emails: ['one@example.com', 'two@example.com'], accounts: 2, anonymous: 0 })).toBe('one@example.com, two@example.com')
    expect(whoLine({ emails: ['one@example.com'], accounts: 3, anonymous: 2 })).toBe('one@example.com, 2 more accounts, 2 not signed in')
    expect(whoLine({ emails: [], accounts: 1, anonymous: 1 })).toBe('1 more account, a visitor not signed in')
    expect(whoLine({ emails: [], accounts: 0, anonymous: 0 })).toBe('—'); expect(whoLine({})).toBe('—')
  })
  it('says in the header whether problems are kept and how the operator is told', () => {
    expect(headline({ recording: false, problems: [] })).toBe('not kept: the health table is not applied, and nobody is alerted')
    expect(headline({ recording: true, unread: true, problems: [] })).toBe('not read just now: reload to ask again')
    expect(headline({ recording: true, problems: [], occurrences: 0, mail: false })).toBe('none · the operator is told in the support room')
    expect(headline({ recording: true, problems: [{}], occurrences: 1, mail: true })).toBe('1 problem · 1 occurrence · the operator is told in the support room and by mail')
    expect(headline({ recording: true, problems: [{}, {}], occurrences: 7, mail: false })).toBe('2 problems · 7 occurrences · the operator is told in the support room')
    expect(headline(null)).toBe('')
  })
})
