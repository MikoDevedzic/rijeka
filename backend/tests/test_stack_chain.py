"""stack/chain.py: the stack's own chain is a local test node and nothing else."""
import shutil
import socket
import subprocess

import pytest

from stack import chain


@pytest.mark.parametrize("rpc", ["http://127.0.0.1:8546", "http://localhost:8546", "http://[::1]:8546"])
def test_a_node_on_this_machine_is_local(rpc):
    assert chain.local(rpc)


@pytest.mark.parametrize("rpc", [
    "https://ethereum-sepolia-rpc.publicnode.com", "http://example.com:8545", "https://127.0.0.1:8546",
    "http://127.0.0.1.example.com:8546", "http://user@example.com:8546", "ws://127.0.0.1:8546", "", "127.0.0.1:8546",
])
def test_anything_else_is_not(rpc):
    assert not chain.local(rpc)


def test_deploy_refuses_a_node_that_is_not_local_before_it_connects():
    with pytest.raises(SystemExit) as e:
        chain.deploy("https://ethereum-sepolia-rpc.publicnode.com")
    assert "refusing" in str(e.value)


def test_deploy_says_when_no_node_answers():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    with pytest.raises(SystemExit) as e:
        chain.deploy(f"http://127.0.0.1:{port}", wait_s=0.5)
    assert "no node answers" in str(e.value)


ANVIL = shutil.which("anvil")


def _anvil(*args):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    proc = subprocess.Popen([ANVIL, "--port", str(port), "--silent", *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return proc, f"http://127.0.0.1:{port}"


@pytest.mark.skipif(not ANVIL, reason="anvil not installed (Foundry)")
def test_deploy_puts_the_registry_on_a_local_test_chain():
    from web3 import Web3
    proc, rpc = _anvil()
    try:
        address = chain.deploy(rpc)
        assert len(Web3(Web3.HTTPProvider(rpc)).eth.get_code(address)) > 0
    finally:
        proc.terminate(); proc.wait(timeout=5)


@pytest.mark.skipif(not ANVIL, reason="anvil not installed (Foundry)")
def test_deploy_refuses_a_local_node_with_another_chain_id():
    proc, rpc = _anvil("--chain-id", "11155111")      # a local fork of a real chain is still not the stack's chain
    try:
        with pytest.raises(SystemExit) as e:
            chain.deploy(rpc)
        assert "only a local test chain" in str(e.value)
    finally:
        proc.terminate(); proc.wait(timeout=5)
