"""stack/chain.py — a chain of the stack's own, for the journeys that confirm on one (frontend/e2e/chain).

Deploys the committed registry (chain/TradeConfirmationRegistry.json) to a local test node (Foundry's anvil) and
prints the three settings the API reads to use it:

    anvil --port 8546 &
    eval "$(python -m stack.chain --rpc http://127.0.0.1:8546)"

It refuses anything but a node on this machine with anvil's chain id. The key below is anvil's published first
account: it is printed in anvil's own start-up text, holds nothing on any real chain, and is never to be sent to one.
"""
import argparse
import json
import os
import shlex
import sys
import time
from urllib.parse import urlparse

ANVIL_CHAIN_ID = 31337
ANVIL_FIRST_ACCOUNT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ARTIFACT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "chain", "TradeConfirmationRegistry.json")
LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")


def local(rpc: str) -> bool:
    """http://<this machine>:<port> and nothing more: no name before an @, no path, no query, nothing after a #."""
    try:
        u = urlparse(rpc)
        port = u.port
    except ValueError:                   # a port that is not a number
        return False
    return (u.scheme == "http" and (u.hostname or "") in LOCAL_HOSTS and port is not None
            and u.username is None and u.password is None and u.path in ("", "/") and not u.params and not u.query and not u.fragment)


def deploy(rpc: str, wait_s: float = 15.0) -> str:
    """The registry's address on the node at `rpc`, after deploying it there."""
    if not local(rpc):
        raise SystemExit(f"refusing {rpc}: the stack's chain is a node on this machine")
    from web3 import Web3
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 10}))
    until = time.time() + wait_s
    while not w3.is_connected():
        if time.time() > until:
            raise SystemExit(f"no node answers at {rpc}")
        time.sleep(0.2)
    if w3.eth.chain_id != ANVIL_CHAIN_ID:
        raise SystemExit(f"refusing chain {w3.eth.chain_id} at {rpc}: only a local test chain ({ANVIL_CHAIN_ID})")
    with open(ARTIFACT) as f:
        art = json.load(f)
    deployer = w3.eth.account.from_key(ANVIL_FIRST_ACCOUNT_KEY)
    registry = w3.eth.contract(abi=art["abi"], bytecode=art["bytecode"])
    tx = registry.constructor().build_transaction({"from": deployer.address, "chainId": ANVIL_CHAIN_ID,
                                                   "nonce": w3.eth.get_transaction_count(deployer.address)})
    receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(deployer.sign_transaction(tx).raw_transaction))
    if receipt.status != 1 or not receipt.contractAddress:
        raise SystemExit("the registry was not deployed")
    return receipt.contractAddress


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--rpc", required=True, help="the local node, e.g. http://127.0.0.1:8546")
    a = p.parse_args(argv)
    address = deploy(a.rpc)
    # what this prints is given to `eval`: every value is quoted for the shell, whatever it holds
    print("export " + " ".join(f"{k}={shlex.quote(v)}" for k, v in (
        ("RIJEKA_CHAIN_RPC", a.rpc), ("RIJEKA_CHAIN_REGISTRY", address), ("RIJEKA_CHAIN_RELAYER_KEY", ANVIL_FIRST_ACCOUNT_KEY))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
