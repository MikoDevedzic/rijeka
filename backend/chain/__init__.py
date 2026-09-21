"""
Rijeka — on-chain trade confirmation.

canonical.py    canonical trade record (schema v1) and its keccak256 hash
signing.py      EIP-712 typed data + signatures matching TradeConfirmationRegistry.sol
attestation.py  AttestationBackend: EVM (web3) or Null (off-chain only)
keys.py         party key resolution (dev: derived from a seed; prod: HSM / signer)
"""
