// The user's own browser wallet (MetaMask or any EIP-1193 provider).
// Rijeka never sees the key: the wallet signs, we send only the signature.

export function hasWallet() {
  return typeof window !== 'undefined' && !!window.ethereum
}

function provider() {
  if (!hasWallet()) throw new Error('No browser wallet found. Install MetaMask, or sign with your own tool below.')
  return window.ethereum
}

function friendly(e) {
  if (e?.code === 4001) return new Error('You declined the request in your wallet.')
  if (e?.code === -32002) return new Error('Your wallet already has a request open — check the wallet window.')
  return new Error(e?.message || String(e))
}

export async function connect() {
  try {
    const accounts = await provider().request({ method: 'eth_requestAccounts' })
    if (!accounts?.length) throw new Error('The wallet returned no account.')
    return accounts[0]
  } catch (e) { throw friendly(e) }
}

// eth_signTypedData_v4 refuses to sign for a chain other than the active one.
export async function ensureChain(chainId) {
  const want = '0x' + Number(chainId).toString(16)
  const have = await provider().request({ method: 'eth_chainId' })
  if (have?.toLowerCase() === want) return
  try {
    await provider().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] })
  } catch (e) {
    if (e?.code === 4902) throw new Error(`Add chain ${chainId} to your wallet (Sepolia is 11155111), then try again.`)
    throw friendly(e)
  }
}

export async function signTypedData(address, typedData) {
  try {
    return await provider().request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typedData)] })
  } catch (e) { throw friendly(e) }
}

export async function personalSign(address, message) {
  const hex = '0x' + Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, '0')).join('')
  try {
    return await provider().request({ method: 'personal_sign', params: [hex, address] })
  } catch (e) { throw friendly(e) }
}

export const sameAddress = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
export const shortAddress = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : ''
