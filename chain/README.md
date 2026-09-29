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

## The canonical record: schema v2

`--expect-hash` only works if both parties' bookings of the same trade produce
the same bytes. Schema v1 (2026-09-21) could not: it carried the booker's trade
reference and was written from the booker's side (PAY/RECEIVE). Schema v2
(2026-09-24, `backend/chain/canonical.py`) is one record for both parties:

- keyed by the **UTI** (the booking entity's LEI + 32 characters, issued when
  the trade is first sent or confirmed), not either firm's reference;
- `parties` is the two **LEIs, sorted**; names are left out, the LEI identifies;
- each leg names its **payer and receiver** LEI; embedded options their **buyer
  and seller**; custom cashflows their payer and receiver with an unsigned amount;
- legs are ordered by content, so neither side's leg numbering enters;
- left out as not contract terms: leg refs, the booker's discount curve, and the
  trade-level `terms` blob (the booker's-view copy of the legs).

So each party can rebuild the hash from **its own** booking. New confirmations
are signed under v2. A confirmation is always re-derived under the
`schema_version` in its attestation, so v1 confirmations stay verifiable
unchanged. Both versions have a pinned test vector in
`backend/tests/test_chain_confirmation.py`.

## Amend and terminate — the signed record follows the trade

Once a confirmation is anchored, the terms are what both parties signed.
Changing the booking off-chain would leave the registry pointing at a record
the booking no longer hashes to, so the row-mutating routes (`PUT /api/trades`,
`PUT /api/trade-legs/leg`, and the generic `POST /api/trade-events` for
AMENDED / TERMINATED / NOVATED / CONFIRMED) refuse with 409 on an anchored
trade (`backend/chain/lifecycle.py`). Economics then change only through:

| | Request (stateless, our half) | Apply (needs both signatures) |
|---|---|---|
| Amend | `POST /api/chain/amend-request/{id}` `{changes}` | `POST /api/chain/amend/{id}` `{changes, address?, signature?}` |
| Terminate | `GET /api/chain/terminate-request/{id}` | `POST /api/chain/terminate/{id}` `{address?, signature?}` |

`changes` is the AMENDED event contract (`{"trade": {...}, "legs": [{"id": ..., ...}]}`),
restricted to the economic terms in the canonical record. The request applies it
in a savepoint, computes the new hash, and rolls back — deterministic, so the
apply re-derives the identical hash. Both parties sign
`TradeAmendment(prevHash, newHash, counterparty)`; the registry marks the old
record **Superseded** and the new one **Confirmed** with `prevHash` as its
parent. Termination signs `TradeTermination(hash, counterparty)` → **Terminated**.

The apply route mutates the rows and appends the AMENDED / TERMINATED event in
one transaction, with the audit `post_state` projected from the event stream
including the new event. Its attestation carries `prev_hash`; `/verify` and the
standalone verifier report the lineage. `tools/countersign.py` signs all three
request formats. Migration 013 makes `(user_id, uti)` unique so a mirror booking
can never attach to the wrong record.

## Digital-asset products: NDO / NDF (schema v2)

`CRYPTO_OPTION` (a non-deliverable option) and `CRYPTO_FORWARD` (a non-deliverable
forward) on BTC/ETH are carried in schema v2 as one `product` block instead of
legs. Field names follow the vocabulary of the ISDA Digital Asset Derivatives
Definitions (2023): the trade is cash-settled in `settlement_currency` against
the `settlement_price_source` on `valuation_date` at `valuation_time`; the
notional is an amount of the digital asset; `buyer` and `seller` are LEIs, so
the seller's booking (direction flipped) hashes identically to the buyer's.

Terms live in `trade.terms` (JSON) and arrive as strings, so numbers are
normalised (`"4100.50"` ≡ `"4100.5"`) and enumerations upper-cased before
hashing. Required terms are refused when missing — both parties must state
the price source, valuation and settlement dates, and settlement currency, or
there is nothing unambiguous to sign. The IR_SWAP path and its pinned vector
are unchanged; NDO and NDF have their own pins in
`backend/tests/test_chain_confirmation.py::TestCanonicalCrypto`.

```
CRYPTO_OPTION  digital_asset, notional_amount, option_type (CALL|PUT), exercise_style,
               strike_price, strike_currency, expiration_date, expiration_time,
               valuation_date, valuation_time, settlement_date, settlement_currency,
               settlement_price_source, premium_amount, premium_currency,
               premium_payment_date, automatic_exercise, calculation_agent, disruption_fallback
CRYPTO_FORWARD digital_asset, notional_amount, forward_price, price_currency,
               valuation_date, valuation_time, settlement_date, settlement_currency,
               settlement_price_source, calculation_agent, disruption_fallback
```

## Telegram channel adapter

Crypto OTC desks agree and confirm bilateral trades in Telegram groups. A Rijeka
room can mirror its trade cards and confirmation events into the one group the
two firms already use, each with a link back to review the terms from your own
side and countersign with your firm's wallet. **Telegram is transport only**:
the record, hash, signatures and registry entry live in Rijeka and on-chain; if
the bot is down or the group is deleted, every confirmation still stands.

Only trade cards and lifecycle events are mirrored. The bot never reads the
group's conversation into Rijeka and never posts free-text chat outward.

Setup, once:
1. Create a bot with @BotFather; put its token in `backend/.env` as
   `TELEGRAM_BOT_TOKEN`, choose a long random `TELEGRAM_WEBHOOK_SECRET`, set
   `RIJEKA_PUBLIC_URL`.
2. Register the webhook (public HTTPS is required — Render, or a tunnel for dev):
   ```bash
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=$RIJEKA_PUBLIC_API/api/telegram/webhook/$TELEGRAM_WEBHOOK_SECRET" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" -d 'allowed_updates=["message"]'
   ```
   The webhook checks both the path secret and Telegram's
   `X-Telegram-Bot-Api-Secret-Token` header.

Per room: a JOINED member calls `POST /api/telegram/rooms/{room_id}/link-code`,
adds the bot to the Telegram group, and posts `/link CODE` there (codes are
one-time, 10 minutes). From then on `chat._post` enqueues each trade card /
event and `chain/telegram.py` delivers it **after the transaction commits**, in a
background thread, best effort. `/unlink` in the group, or `DELETE
/api/telegram/rooms/{room_id}`, stops it. Migration 014 holds the bindings;
clients cannot read those tables.
