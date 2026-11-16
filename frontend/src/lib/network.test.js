import { describe, it, expect } from 'vitest'
import { isDemoLei, networkOf } from './network'

describe('the chain a server anchors on, said one way', () => {
  it('names Sepolia as what it is, Ethereum as Ethereum, and none as none', () => {
    expect(networkOf({ anchored: true, chain_id: 11155111, registry: '0xabc' })).toMatchObject({ known: true, anchored: true, name: 'Sepolia', where: "on Sepolia, Ethereum's test network", testnet: true })
    expect(networkOf({ anchored: true, chain_id: 1 })).toMatchObject({ anchored: true, name: 'Ethereum', where: 'on Ethereum', testnet: false })
    expect(networkOf({ anchored: true, chain_id: 31337 })).toMatchObject({ name: 'local test chain', where: 'on a local test chain' })
    expect(networkOf({ anchored: true, chain_id: 8453 })).toMatchObject({ name: 'chain 8453', where: 'on chain 8453' })
    expect(networkOf({ anchored: false, chain_id: null })).toEqual({ known: true, anchored: false, name: null, where: null })
    expect(networkOf({ anchored: false, chain_id: 11155111 })).toMatchObject({ anchored: false, where: null })      // a chain named and not in use
  })
  it('does not call a chain it has not been told of by a name', () => {
    expect(networkOf(null)).toEqual({ known: false, anchored: null, name: null, where: 'on chain' })
    expect(networkOf(undefined).where).toBe('on chain')
  })
  it('knows a demo entity by its LEI', () => {
    expect(isDemoLei('DEMO0000RIJEKABANK01')).toBe(true)
    expect(isDemoLei('demo0000000a00004000')).toBe(true)
    expect(isDemoLei('5493001KJTIIGC8Y1R12')).toBe(false)
    expect(isDemoLei(null)).toBe(false)
  })
})
