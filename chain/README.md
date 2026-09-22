# Rijeka on-chain trade confirmation

`TradeConfirmationRegistry.sol` records bilateral, EIP-712-signed confirmations of
OTC derivative trades on Ethereum. Only a `keccak256` of the canonical off-chain
trade record goes on-chain, plus who signed and when. See the contract header.

## Toolchain
[Foundry](https://book.getfoundry.sh): `forge`, `anvil`, `cast`.

```bash
forge install foundry-rs/forge-std --no-commit   # first time only
forge build
forge test -vv
```

## Local chain
```bash
anvil                                              # 31337, funded dev accounts
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```
Set in `backend/.env`:
```
RIJEKA_CHAIN_RPC=http://127.0.0.1:8545
RIJEKA_CHAIN_REGISTRY=<address printed above>
RIJEKA_CHAIN_RELAYER_KEY=<a funded key; anvil account 0 in dev>
```

## Networks
Same bytecode everywhere: Anvil (dev) → Sepolia (demo) → Ethereum mainnet (production).
The relayer key on mainnet is production infrastructure — HSM / signer service, never a file.

## ABI for the backend
`forge build` writes `out/TradeConfirmationRegistry.sol/TradeConfirmationRegistry.json`.
`backend/chain/abi.py` loads ABI + bytecode from a committed copy at
`backend/chain/TradeConfirmationRegistry.json`; regenerate it after any contract change:
```bash
python -c "import json;a=json.load(open('out/TradeConfirmationRegistry.sol/TradeConfirmationRegistry.json'));json.dump({'abi':a['abi'],'bytecode':a['bytecode']['object']},open('../backend/chain/TradeConfirmationRegistry.json','w'))"
```

## Independent verification

`verify/index.html` is a self-contained page that checks a confirmation without
contacting Rijeka. It recomputes the canonical hash in the browser, recovers both
EIP-712 signatures locally, and reads the registry from a public Ethereum node.
Save the file and it keeps working offline apart from the one RPC call.

Feed it the proof pack from `GET /api/chain/proof/{trade_id}` (the CONFIRM tab has
a `↓ PROOF PACK` button). The pack contains the canonical record, the hash, both
signatures and the registry address — nothing else is needed.

The JavaScript canonicalisation is byte-identical to the Python one; the pinned
vector in `backend/tests/test_chain_confirmation.py::test_known_vector` and a
2,303-byte live trade both round-trip exactly.

### Deployments

| Network | Registry | Source |
|---|---|---|
| Sepolia | `0x920AE5AC65f72CB58af5bD3eF48168d9151dEd6e` | verified on Sourcify (exact match) |

## Bilateral confirmation

A real confirmation needs the counterparty's signature to come from *their*
system. Rijeka holds only their address:

```
RIJEKA_CHAIN_KEY_<THEIR_LEI>_ADDRESS=0x...     # we know who they are
                                               # we hold no key for them
```

With that set, `POST /api/chain/confirm` refuses (correctly — we cannot sign for
them) and points at the two-step flow:

1. `GET /api/chain/request/{trade_id}` — our half: the canonical record, the
   hash, our signature, and the exact digest they must sign. Deterministic;
   nothing stored, nothing anchored.
2. They run `tools/countersign.py request.json --expect-hash <hash from THEIR
   booking>`. It recomputes the hash from the terms, refuses if their own
   booking disagrees, prints the economics, and signs. No Rijeka dependency —
   `eth-account` and `eth-utils` only.
3. `POST /api/chain/countersign/{trade_id}` with `{address, signature}`. We
   verify it recovers to the address registered for their legal entity before
   a transaction is built, then anchor.

Either party may relay: the contract accepts a validly-signed pair from anyone,
so step 3 can equally be them calling `confirm()` themselves.

`--expect-hash` is where the value is. A mismatch there is a confirmation break
found at the point of confirmation, not in a reconciliation days later.
