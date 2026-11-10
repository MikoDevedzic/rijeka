import { describe, it, expect } from 'vitest'
import { rowMenu } from './row-menu'

const t = { id: 'a', trade_ref: 'TRD-1', uti: 'UTI-0000000000000000000009', status: 'PENDING', asset_class: 'CRYPTO', counterparty: { name: 'RIJEKA DEMO BANK AG' } }
const labels = (items) => items.filter(i => i.label).map(i => i.label)

describe('the right-click menu of a blotter row', () => {
  it('opens, copies, narrows and ticks; nothing on it changes a trade', () => {
    const did = []
    const does = { open: (ts) => did.push(['open', ts.map(x => x.id)]), copy: (s) => did.push(['copy', s]), filter: (k, v) => did.push(['filter', k, v]), toggle: (id) => did.push(['toggle', id]), clear: () => did.push(['clear']) }
    const items = rowMenu(t, { filters: { status: 'ALL', assetClass: 'ALL', store: 'ALL', search: '' } }, does)
    expect(labels(items)).toEqual(['Open', 'Copy reference', 'Copy UTI', 'RIJEKA DEMO BANK AG', 'CRYPTO', 'PENDING', 'Show every trade again', 'Tick this trade'])
    for (const word of ['confirm', 'terminate', 'cancel', 'delete', 'book']) expect(labels(items).join(' ').toLowerCase()).not.toContain(word)
    items.filter(i => i.onSelect && !i.disabled).forEach(i => i.onSelect())
    expect(did).toEqual([['open', ['a']], ['copy', 'TRD-1'], ['copy', t.uti], ['filter', 'search', 'RIJEKA DEMO BANK AG'], ['filter', 'assetClass', 'CRYPTO'], ['filter', 'status', 'PENDING'], ['toggle', 'a']])
  })
  it('what a trade does not have is greyed, not hidden; their reference shows only when there is one', () => {
    const bare = rowMenu({ id: 'b', trade_ref: 'TRD-2', status: 'LIVE', asset_class: 'FX' }, {}, {})
    expect(bare.find(i => i.label === 'Copy UTI')).toMatchObject({ disabled: true, hint: 'none yet' })
    expect(bare.find(i => i.label === 'This counterparty')).toMatchObject({ disabled: true })
    expect(labels(bare)).not.toContain('Copy their reference')
    expect(labels(rowMenu(t, { theirRef: 'THEIR-7' }, {}))).toContain('Copy their reference')
  })
  it('offers the ticked trades together when the row is one of several ticked, and every trade again when the blotter is narrowed', () => {
    const many = rowMenu(t, { selected: [t, { id: 'c' }, { id: 'd' }], filters: { status: 'PENDING' } }, {})
    expect(labels(many)).toContain('Open the 3 ticked trades'); expect(labels(many)).toContain('Untick this trade')
    expect(many.find(i => i.label === 'Show every trade again').disabled).toBe(false)
    expect(labels(rowMenu(t, { selected: [{ id: 'c' }, { id: 'd' }] }, {}))).not.toContain('Open the 2 ticked trades')   // this row is not one of them
    expect(rowMenu(null)).toEqual([])
  })
})
