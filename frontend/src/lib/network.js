// lib/network.js — the chain a server anchors confirmations on, said the same way wherever it is said (no React, no
// request: lib/chain-status.js asks the API and gives a screen this).
// GET /api/chain/status gives { anchored, chain_id, registry }. The registry is on Sepolia, Ethereum's test network,
// on the hosted demo; a self-host may run it on Ethereum, on another chain, or on none (signatures are then kept
// and nothing is anchored). The copy of a screen names the one it is, never "Ethereum" in one sentence and
// "Sepolia" in the next.
import { chainName } from './wallet'

const TESTNETS = new Set([11155111, 17000, 5])

// What to call it: `name` for a sentence's noun (Sepolia), `short` for a label with little room, `where` for the end
// of a sentence ("on Sepolia, Ethereum's test network"). Not yet known (no answer, or the request failed) is not the
// same as none configured: until the answer is in, a sentence names no chain at all (`where` is empty).
export function networkOf(status) {
  if (!status) return { known: false, anchored: null, name: null, short: null, where: '' }
  if (!status.anchored || !status.chain_id) return { known: true, anchored: false, name: null, short: null, where: null }
  const id = Number(status.chain_id), name = chainName(id), local = id === 31337
  const where = TESTNETS.has(id) ? `on ${name}, Ethereum's test network` : local ? 'on a local test chain' : `on ${name}`
  return { known: true, anchored: true, name, short: local ? 'local' : name, where, testnet: TESTNETS.has(id) }
}

// An LEI that begins DEMO is a demo entity's: the server's demo key signs for it (backend/api/routes/chain.py).
export const isDemoLei = (lei) => /^DEMO/.test(String(lei || '').toUpperCase())
