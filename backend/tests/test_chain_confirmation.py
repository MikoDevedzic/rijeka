"""
On-chain confirmation: canonical record, EIP-712 signing, key resolution,
and — when Foundry's `anvil` is on PATH — a live round trip through the
deployed TradeConfirmationRegistry.
"""
import json
import os
import shutil
import socket
import subprocess
import time
from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from eth_account import Account

from chain.canonical import (
    canonical_payload, canonical_bytes, trade_hash, trade_hash_hex, normalise, _num_str,
    CANONICAL_SCHEMA_VERSION,
)
from chain.signing import (
    confirmation_typed_data, amendment_typed_data, termination_typed_data,
    sign, recover, eip712_digest,
)
from chain import keys as keymod


# ── Fixtures ─────────────────────────────────────────────────────────────────

def _trade(**over):
    t = dict(
        id=uuid4(), trade_ref="TRD-1", uti=None, asset_class="RATES", instrument_type="IR_SWAP",
        structure="VANILLA", notional=Decimal("10000000.00"), notional_ccy="USD",
        trade_date=date(2026, 9, 21), effective_date=date(2026, 9, 23), maturity_date=date(2031, 9, 23),
        terms={"fixed_rate": 0.0365, "custom_cashflows": []}, discount_curve_id="USD_SOFR", forecast_curve_id=None,
        status="PENDING", user_id=uuid4(), desk="RATES-NY", created_at=datetime.now(),
    )
    t.update(over); return t


def _legs():
    return [
        dict(leg_ref="FLOAT-1", leg_seq=2, leg_type="FLOAT", direction="RECEIVE", currency="USD",
             notional=Decimal("10000000"), notional_type="CONSTANT", notional_schedule=None,
             effective_date=date(2026, 9, 23), maturity_date=date(2031, 9, 23), first_period_start=None,
             last_period_end=None, day_count="ACT/360", payment_frequency="ANNUAL", reset_frequency="DAILY",
             bdc="MODIFIED_FOLLOWING", stub_type="SHORT_FRONT", payment_calendar="NEW_YORK", payment_lag=2,
             fixed_rate=Decimal("0"), fixed_rate_type=None, fixed_rate_schedule=None, spread=Decimal("0.0000"),
             spread_type=None, spread_schedule=None, forecast_curve_id="USD_SOFR", discount_curve_id="USD_SOFR",
             embedded_options=[], leverage=Decimal("1.0"), ois_compounding="COMPOUNDING", terms={},
             id=uuid4(), user_id=uuid4()),
        dict(leg_ref="FIXED-1", leg_seq=1, leg_type="FIXED", direction="PAY", currency="USD",
             notional=Decimal("10000000"), notional_type="CONSTANT", notional_schedule=None,
             effective_date=date(2026, 9, 23), maturity_date=date(2031, 9, 23), first_period_start=None,
             last_period_end=None, day_count="30/360", payment_frequency="SEMI_ANNUAL", reset_frequency=None,
             bdc="MODIFIED_FOLLOWING", stub_type="SHORT_FRONT", payment_calendar="NEW_YORK", payment_lag=2,
             fixed_rate=Decimal("0.036500"), fixed_rate_type="FIXED", fixed_rate_schedule=None, spread=None,
             spread_type=None, spread_schedule=None, forecast_curve_id=None, discount_curve_id="USD_SOFR",
             embedded_options=[], leverage=None, ois_compounding=None, terms={},
             id=uuid4(), user_id=uuid4()),
    ]


OWN = {"lei": "5493001KJTIIGC8Y1R12", "name": "Rijeka Capital LLC"}
CP  = {"lei": "549300E9PC51EN656011", "name": "Example Bank AG"}


# ── Canonical form ───────────────────────────────────────────────────────────

class TestCanonical:

    def test_number_rendering(self):
        assert _num_str(Decimal("10000000.00")) == "10000000"
        assert _num_str(0.0365) == "0.0365"
        assert _num_str(Decimal("0.036500")) == "0.0365"
        assert _num_str(1e7) == "10000000"
        assert _num_str(Decimal("-0.0")) == "0"
        assert _num_str(2) == "2"
        assert _num_str(Decimal("1.5E+3")) == "1500"
        with pytest.raises(ValueError):
            _num_str(float("nan"))

    def test_normalise_types(self):
        out = normalise({"d": date(2026, 1, 2), "n": Decimal("1.10"), "b": True, "x": None,
                         "l": [1, 2.50], "u": uuid4()})
        assert out["d"] == "2026-01-02" and out["n"] == "1.1" and out["b"] is True
        assert out["x"] is None and out["l"] == ["1", "2.5"] and isinstance(out["u"], str)

    def test_only_economic_fields(self):
        p = canonical_payload(_trade(), _legs(), OWN, CP)
        assert set(p["trade"]) == {
            "trade_ref", "uti", "asset_class", "instrument_type", "structure", "notional", "notional_ccy",
            "trade_date", "effective_date", "maturity_date", "terms", "discount_curve_id", "forecast_curve_id"}
        for leg in p["legs"]:
            assert "id" not in leg and "user_id" not in leg
        assert "status" not in p["trade"] and "desk" not in p["trade"] and "created_at" not in p["trade"]
        assert p["schema_version"] == CANONICAL_SCHEMA_VERSION

    def test_legs_ordered_by_seq_not_input(self):
        p = canonical_payload(_trade(), _legs(), OWN, CP)
        assert [l["leg_seq"] for l in p["legs"]] == ["1", "2"]
        p2 = canonical_payload(_trade(), list(reversed(_legs())), OWN, CP)
        assert trade_hash(p) == trade_hash(p2)

    def test_hash_is_deterministic_and_ignores_non_economic_changes(self):
        h1 = trade_hash(canonical_payload(_trade(), _legs(), OWN, CP))
        h2 = trade_hash(canonical_payload(_trade(id=uuid4(), status="CONFIRMED", desk="OTHER"), _legs(), OWN, CP))
        assert h1 == h2 and len(h1) == 32

    def test_hash_changes_on_any_economic_change(self):
        base = trade_hash(canonical_payload(_trade(), _legs(), OWN, CP))
        assert trade_hash(canonical_payload(_trade(notional=Decimal("10000001")), _legs(), OWN, CP)) != base
        legs = _legs(); legs[1]["fixed_rate"] = Decimal("0.0366")
        assert trade_hash(canonical_payload(_trade(), legs, OWN, CP)) != base
        assert trade_hash(canonical_payload(_trade(), _legs(), OWN, {"lei": "X", "name": "Other"})) != base
        assert trade_hash(canonical_payload(_trade(maturity_date=date(2031, 9, 24)), _legs(), OWN, CP)) != base

    def test_bytes_are_compact_sorted_json(self):
        b = canonical_bytes(canonical_payload(_trade(), _legs(), OWN, CP))
        s = b.decode()
        assert " " not in s.replace("Rijeka Capital LLC", "").replace("Example Bank AG", "")
        obj = json.loads(s)
        assert list(obj.keys()) == sorted(obj.keys())
        assert s.startswith('{"legs":[')

    def test_orm_like_objects_supported(self):
        class Row:  # attribute access, like SQLAlchemy rows
            def __init__(self, d): self.__dict__.update(d)
        t = Row(_trade()); legs = [Row(l) for l in _legs()]
        assert trade_hash(canonical_payload(t, legs, OWN, CP)) == trade_hash(canonical_payload(_trade(), _legs(), OWN, CP))

    def test_known_vector(self):
        """Pin the hash of a fixed record so any serialisation change is caught."""
        t = _trade(id=None, user_id=None, created_at=None)
        p = canonical_payload(t, _legs(), OWN, CP)
        assert trade_hash_hex(p) == "0x" + trade_hash(p).hex()
        # regenerate this constant deliberately if the schema version changes
        assert trade_hash_hex(p) == KNOWN_V1_HASH


# Pinned 2026-09-21 for schema v1. Regenerate ONLY with a schema version bump.
KNOWN_V1_HASH = "0x8b0f5519707bc86cb18fb62e60d119b9ee7eab2b1198e350fb5c2247302868d2"


# ── EIP-712 ──────────────────────────────────────────────────────────────────

REG = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
A = Account.from_key("0x" + "11" * 32)
B = Account.from_key("0x" + "22" * 32)
H = trade_hash(canonical_payload(_trade(), _legs(), OWN, CP))


class TestSigning:

    def test_sign_recover_roundtrip(self):
        td = confirmation_typed_data(31337, REG, H, B.address)
        sig = sign(td, A.key)
        assert len(sig) == 65 and sig[-1] in (27, 28)
        assert recover(td, sig) == A.address

    def test_signature_bound_to_counterparty_and_hash_and_chain(self):
        sig = sign(confirmation_typed_data(31337, REG, H, B.address), A.key)
        assert recover(confirmation_typed_data(31337, REG, H, A.address), sig) != A.address
        assert recover(confirmation_typed_data(31337, REG, b"\x01" * 32, B.address), sig) != A.address
        assert recover(confirmation_typed_data(1, REG, H, B.address), sig) != A.address
        assert recover(confirmation_typed_data(31337, "0x" + "ee" * 20, H, B.address), sig) != A.address

    def test_amend_and_terminate_types(self):
        for td in (amendment_typed_data(31337, REG, H, b"\x02" * 32, B.address),
                   termination_typed_data(31337, REG, H, B.address)):
            assert recover(td, sign(td, B.key)) == B.address

    def test_digest_is_eip712(self):
        """0x1901 || domainSeparator || structHash, computed independently."""
        from eth_utils import keccak
        from eth_abi import encode
        dom = keccak(encode(["bytes32", "bytes32", "bytes32", "uint256", "address"], [
            keccak(text="EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak(text="Rijeka Trade Confirmation"), keccak(text="1"), 31337, REG]))
        st = keccak(encode(["bytes32", "bytes32", "address"], [
            keccak(text="TradeConfirmation(bytes32 tradeHash,address counterparty)"), H, B.address]))
        expected = keccak(b"\x19\x01" + dom + st)
        assert eip712_digest(confirmation_typed_data(31337, REG, H, B.address)) == expected


# ── Keys ─────────────────────────────────────────────────────────────────────

class TestKeys:

    def test_env_key(self, monkeypatch):
        monkeypatch.setenv("RIJEKA_CHAIN_KEY_5493001KJTIIGC8Y1R12", A.key.hex())
        k = keymod.resolve(OWN)
        assert k.address == A.address and k.source == "env"

    def test_dev_seed_is_deterministic_and_distinct(self, monkeypatch):
        monkeypatch.delenv("RIJEKA_CHAIN_KEY_5493001KJTIIGC8Y1R12", raising=False)
        monkeypatch.setenv("RIJEKA_CHAIN_DEV_SEED", "demo")
        k1 = keymod.resolve(OWN); k2 = keymod.resolve(OWN); kc = keymod.resolve(CP)
        assert k1.address == k2.address and k1.source == "dev"
        assert k1.address != kc.address
        monkeypatch.setenv("RIJEKA_CHAIN_DEV_SEED", "other")
        assert keymod.resolve(OWN).address != k1.address

    def test_missing_key_raises(self, monkeypatch):
        monkeypatch.delenv("RIJEKA_CHAIN_DEV_SEED", raising=False)
        monkeypatch.delenv("RIJEKA_CHAIN_KEY_5493001KJTIIGC8Y1R12", raising=False)
        with pytest.raises(LookupError):
            keymod.resolve(OWN)

    def test_entity_without_lei_gets_stable_pseudo_lei(self, monkeypatch):
        monkeypatch.setenv("RIJEKA_CHAIN_DEV_SEED", "demo")
        k = keymod.resolve({"lei": None, "name": "Example Bank AG"})
        assert k.lei.startswith("NOLEI-") and keymod.resolve({"lei": None, "name": "Example Bank AG"}).address == k.address


# ── Live chain (anvil) ───────────────────────────────────────────────────────

ANVIL = shutil.which("anvil")
FORGE = shutil.which("forge")
ARTIFACT = os.path.join(os.path.dirname(__file__), "..", "chain", "TradeConfirmationRegistry.json")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); return s.getsockname()[1]


@pytest.fixture(scope="module")
def anvil():
    if not ANVIL:
        pytest.skip("anvil not installed (Foundry)")
    art = json.load(open(ARTIFACT))
    if not art.get("abi") or art.get("bytecode") in (None, "0x"):
        pytest.skip("contract artifact not built — run `forge build` in chain/ and copy the artifact")
    port = _free_port()
    proc = subprocess.Popen([ANVIL, "--port", str(port), "--silent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    try:
        from web3 import Web3
        w3 = Web3(Web3.HTTPProvider(url))
        for _ in range(50):
            if w3.is_connected(): break
            time.sleep(0.1)
        deployer = w3.eth.account.from_key("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
        c = w3.eth.contract(abi=art["abi"], bytecode=art["bytecode"])
        tx = c.constructor().build_transaction({"from": deployer.address, "nonce": w3.eth.get_transaction_count(deployer.address), "chainId": w3.eth.chain_id})
        h = w3.eth.send_raw_transaction(deployer.sign_transaction(tx).raw_transaction)
        addr = w3.eth.wait_for_transaction_receipt(h).contractAddress
        yield {"url": url, "registry": addr, "relayer": deployer.key.hex(), "w3": w3}
    finally:
        proc.terminate(); proc.wait(timeout=5)


class TestLiveChain:

    def test_confirm_roundtrip_and_python_digest_matches_contract(self, anvil, monkeypatch):
        monkeypatch.setenv("RIJEKA_CHAIN_RPC", anvil["url"])
        monkeypatch.setenv("RIJEKA_CHAIN_REGISTRY", anvil["registry"])
        monkeypatch.setenv("RIJEKA_CHAIN_RELAYER_KEY", anvil["relayer"])
        from chain.attestation import get_backend
        be = get_backend(refresh=True)
        assert be.anchored and be.chain_id == 31337

        # Python's EIP-712 digest must equal the contract's confirmationDigest()
        td_a = confirmation_typed_data(be.chain_id, be.registry, H, B.address)
        assert be.confirmation_digest(H, B.address) == eip712_digest(td_a)

        td_b = confirmation_typed_data(be.chain_id, be.registry, H, A.address)
        rcpt = be.confirm(H, A.address, B.address, sign(td_a, A.key), sign(td_b, B.key))
        assert rcpt.anchored and rcpt.tx_hash and rcpt.block_number > 0

        rec = be.get(H)
        assert rec.status == "Confirmed" and rec.party_a == A.address and rec.party_b == B.address
        assert be.get(b"\x09" * 32) is None

    def test_wrong_signer_reverts(self, anvil, monkeypatch):
        monkeypatch.setenv("RIJEKA_CHAIN_RPC", anvil["url"])
        monkeypatch.setenv("RIJEKA_CHAIN_REGISTRY", anvil["registry"])
        monkeypatch.setenv("RIJEKA_CHAIN_RELAYER_KEY", anvil["relayer"])
        from chain.attestation import get_backend
        be = get_backend(refresh=True)
        h2 = b"\x07" * 32
        X = Account.from_key("0x" + "33" * 32)
        td_x = confirmation_typed_data(be.chain_id, be.registry, h2, B.address)
        td_b = confirmation_typed_data(be.chain_id, be.registry, h2, A.address)
        with pytest.raises(Exception):
            be.confirm(h2, A.address, B.address, sign(td_x, X.key), sign(td_b, B.key))
        assert be.get(h2) is None


# ── Bilateral flow: request -> counterparty signs -> countersign ─────────────

class TestBilateralExchange:
    """
    The real flow: we hold only the counterparty's ADDRESS, never their key.
    Their signature is produced by them, over their own booking, and we verify
    it before anything is submitted.
    """

    CP = Account.from_key("0x" + "5c" * 32)

    def _setup(self, monkeypatch):
        monkeypatch.setenv("RIJEKA_CHAIN_DEV_SEED", "bilateral-test")
        monkeypatch.setenv("RIJEKA_CHAIN_KEY_" + CP["lei"], "")      # no key for them
        monkeypatch.delenv("RIJEKA_CHAIN_KEY_" + CP["lei"], raising=False)
        monkeypatch.setenv("RIJEKA_CHAIN_KEY_" + CP["lei"] + "_ADDRESS", self.CP.address)
        return keymod.resolve(OWN), keymod.resolve(CP)

    def test_we_do_not_hold_the_counterparty_key(self, monkeypatch):
        k_own, k_cp = self._setup(monkeypatch)
        assert k_own.private_key is not None and k_own.source == "dev"
        assert k_cp.private_key is None and k_cp.source == "address-only"
        assert k_cp.address == self.CP.address

    def test_full_exchange(self, monkeypatch):
        k_own, k_cp = self._setup(monkeypatch)
        payload = canonical_payload(_trade(), _legs(), OWN, CP)
        h = trade_hash(payload)

        # our half
        td_own = confirmation_typed_data(31337, REG, h, k_cp.address)
        sig_own = sign(td_own, k_own.private_key)

        # their half — signed with a key we never see, bound to OUR address
        td_cp = confirmation_typed_data(31337, REG, h, k_own.address)
        sig_cp = sign(td_cp, self.CP.key)

        # our verification before submitting
        assert recover(td_cp, sig_cp) == k_cp.address
        assert recover(td_own, sig_own) == k_own.address
        assert len(sig_cp) == 65

    def test_rejects_signature_from_an_unregistered_key(self, monkeypatch):
        k_own, k_cp = self._setup(monkeypatch)
        h = trade_hash(canonical_payload(_trade(), _legs(), OWN, CP))
        impostor = Account.from_key("0x" + "99" * 32)
        td_cp = confirmation_typed_data(31337, REG, h, k_own.address)
        assert recover(td_cp, sign(td_cp, impostor.key)) != k_cp.address

    def test_rejects_signature_over_different_terms(self, monkeypatch):
        k_own, k_cp = self._setup(monkeypatch)
        h1 = trade_hash(canonical_payload(_trade(), _legs(), OWN, CP))
        legs = _legs(); legs[1]["fixed_rate"] = Decimal("0.0366")
        h2 = trade_hash(canonical_payload(_trade(), legs, OWN, CP))
        assert h1 != h2
        # they sign the amended terms; we check against the original
        sig = sign(confirmation_typed_data(31337, REG, h2, k_own.address), self.CP.key)
        assert recover(confirmation_typed_data(31337, REG, h1, k_own.address), sig) != k_cp.address

    def test_countersignature_is_not_reusable_for_another_counterparty(self, monkeypatch):
        k_own, k_cp = self._setup(monkeypatch)
        h = trade_hash(canonical_payload(_trade(), _legs(), OWN, CP))
        other = Account.from_key("0x" + "77" * 32)
        # signed against OUR address; must not validate as if bound to someone else
        sig = sign(confirmation_typed_data(31337, REG, h, k_own.address), self.CP.key)
        assert recover(confirmation_typed_data(31337, REG, h, other.address), sig) != k_cp.address


class TestCountersignCLI:
    """The counterparty-side reference tool: chain/tools/countersign.py."""

    TOOL = os.path.join(os.path.dirname(__file__), "..", "..", "chain", "tools", "countersign.py")

    def _request(self, tmp_path, cp_addr, h, payload, own_addr, own_sig_hex):
        req = {
            "format": "rijeka-confirmation-request", "format_version": 1,
            "trade_ref": "TRD-CLI-TEST", "trade_id": "00000000-0000-0000-0000-000000000001",
            "canonical": payload, "trade_hash": "0x" + h.hex(),
            "eip712": {"name": "Rijeka Trade Confirmation", "version": "1",
                       "chain_id": 31337, "verifying_contract": REG},
            "from": {"lei": OWN["lei"], "name": OWN["name"], "address": own_addr, "signature": own_sig_hex},
            "to": {"lei": CP["lei"], "name": CP["name"], "address": cp_addr,
                   "digest_to_sign": "0x" + eip712_digest(
                       confirmation_typed_data(31337, REG, h, own_addr)).hex(),
                   "can_sign_locally": False},
        }
        p = tmp_path / "request.json"; p.write_text(json.dumps(req)); return p

    def _run(self, args):
        import sys as _s
        return subprocess.run([_s.executable, self.TOOL] + args, capture_output=True, text=True)

    def test_signs_and_output_verifies(self, tmp_path):
        payload = canonical_payload(_trade(), _legs(), OWN, CP)
        h = trade_hash(payload)
        cp = Account.from_key("0x" + "3a" * 32)
        own_sig = sign(confirmation_typed_data(31337, REG, h, cp.address), A.key)
        req = self._request(tmp_path, cp.address, h, payload, A.address, "0x" + own_sig.hex())
        kf = tmp_path / "k"; kf.write_text("0x" + cp.key.hex())
        out = tmp_path / "sig.json"
        r = self._run([str(req), "--key-file", str(kf), "--out", str(out), "--yes"])
        assert r.returncode == 0, r.stdout + r.stderr
        assert "internally consistent" in r.stdout
        sig = json.loads(out.read_text())
        assert sig["address"] == cp.address
        assert recover(confirmation_typed_data(31337, REG, h, A.address),
                       bytes.fromhex(sig["signature"][2:])) == cp.address

    def test_refuses_when_own_booking_disagrees(self, tmp_path):
        payload = canonical_payload(_trade(), _legs(), OWN, CP)
        h = trade_hash(payload)
        cp = Account.from_key("0x" + "3a" * 32)
        own_sig = sign(confirmation_typed_data(31337, REG, h, cp.address), A.key)
        req = self._request(tmp_path, cp.address, h, payload, A.address, "0x" + own_sig.hex())
        kf = tmp_path / "k"; kf.write_text("0x" + cp.key.hex())
        r = self._run([str(req), "--key-file", str(kf), "--yes",
                       "--expect-hash", "0x" + ("11" * 32)])
        assert r.returncode == 2
        assert "disagree" in (r.stdout + r.stderr)

    def test_refuses_a_tampered_request(self, tmp_path):
        payload = canonical_payload(_trade(), _legs(), OWN, CP)
        h = trade_hash(payload)
        cp = Account.from_key("0x" + "3a" * 32)
        own_sig = sign(confirmation_typed_data(31337, REG, h, cp.address), A.key)
        req = self._request(tmp_path, cp.address, h, payload, A.address, "0x" + own_sig.hex())
        d = json.loads(req.read_text())
        d["canonical"]["legs"][0]["fixed_rate"] = "0.0999"      # terms changed, hash not
        req.write_text(json.dumps(d))
        kf = tmp_path / "k"; kf.write_text("0x" + cp.key.hex())
        r = self._run([str(req), "--key-file", str(kf), "--yes"])
        assert r.returncode == 2
        assert "does not match" in (r.stdout + r.stderr)

    def test_refuses_the_wrong_key(self, tmp_path):
        payload = canonical_payload(_trade(), _legs(), OWN, CP)
        h = trade_hash(payload)
        cp = Account.from_key("0x" + "3a" * 32)
        own_sig = sign(confirmation_typed_data(31337, REG, h, cp.address), A.key)
        req = self._request(tmp_path, cp.address, h, payload, A.address, "0x" + own_sig.hex())
        kf = tmp_path / "k"; kf.write_text("0x" + ("4b" * 32))   # someone else's key
        r = self._run([str(req), "--key-file", str(kf), "--yes"])
        assert r.returncode == 2
        assert "addressed to" in (r.stdout + r.stderr)
