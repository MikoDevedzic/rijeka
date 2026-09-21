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
