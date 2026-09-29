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

from functools import partial

from chain.canonical import (
    canonical_payload as _canonical_payload, canonical_bytes, trade_hash, trade_hash_hex, normalise, _num_str,
    CANONICAL_SCHEMA_VERSION,
)

# The v1 tests below pin the frozen v1 serialisation (and its known hash).
# Schema v2 has its own class further down.
canonical_payload = partial(_canonical_payload, version=1)
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
        assert p["schema_version"] == 1

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


# ── Canonical form, schema v2: one record for both parties ──────────────────

def _mirror(legs):
    """The same trade as the counterparty books it: every direction flipped."""
    flip = {"PAY": "RECEIVE", "RECEIVE": "PAY", "BUY": "SELL", "SELL": "BUY"}
    out = []
    for i, l in enumerate(legs):
        l = dict(l, direction=flip[l["direction"]], leg_ref=f"THEIR-{i}", leg_seq=10 + i,
                 discount_curve_id="EUR_ESTR",   # their valuation choice, not a term
                 embedded_options=[dict(o, direction=flip[o["direction"]]) for o in (l.get("embedded_options") or [])])
        cfs = (l.get("terms") or {}).get("custom_cashflows")
        if cfs:
            l["terms"] = {"custom_cashflows": [dict(c, amount=-c["amount"], id="their-row", notes="theirs") for c in cfs]}
        out.append(l)
    return out


class TestCanonicalV2:
    v2 = staticmethod(partial(_canonical_payload, version=2))
    UTI = "5493001KJTIIGC8Y1R12" + "A" * 32

    def _pair(self, legs=None):
        legs = legs or _legs()
        ours = self.v2(_trade(uti=self.UTI), legs, OWN, CP)
        theirs = self.v2(_trade(uti=self.UTI, trade_ref="CB-SWP-0042", terms={"direction": "RECEIVE"},
                                discount_curve_id="EUR_ESTR"), list(reversed(_mirror(legs))), CP, OWN)
        return ours, theirs

    def test_current_version_is_2(self):
        assert CANONICAL_SCHEMA_VERSION == 2
        assert _canonical_payload(_trade(), _legs(), OWN, CP)["schema_version"] == 2

    def test_both_sides_bookings_hash_identically(self):
        ours, theirs = self._pair()
        assert ours == theirs and trade_hash(ours) == trade_hash(theirs)

    def test_legs_name_payer_and_receiver_by_lei(self):
        p, _ = self._pair()
        fixed = next(l for l in p["legs"] if l["leg_type"] == "FIXED")
        flt = next(l for l in p["legs"] if l["leg_type"] == "FLOAT")
        assert (fixed["payer"], fixed["receiver"]) == (OWN["lei"], CP["lei"])
        assert (flt["payer"], flt["receiver"]) == (CP["lei"], OWN["lei"])
        assert "direction" not in fixed and flt["index"] == "USD_SOFR"

    def test_only_shared_terms(self):
        p, _ = self._pair()
        assert set(p) == {"schema", "schema_version", "uti", "parties", "trade", "legs"}
        assert set(p["trade"]) == {"asset_class", "instrument_type", "structure", "notional", "notional_ccy",
                                   "trade_date", "effective_date", "maturity_date"}
        assert p["parties"] == sorted([OWN["lei"], CP["lei"]])
        for leg in p["legs"]:
            assert not {"leg_ref", "leg_seq", "discount_curve_id", "direction", "terms", "id", "user_id"} & set(leg)

    def test_options_and_custom_cashflows_are_party_neutral(self):
        legs = _legs()
        legs[0]["embedded_options"] = [{"type": "CAP", "direction": "SELL", "default_strike": Decimal("0.05"), "strike_schedule": []},
                                       {"type": "FLOOR", "direction": "BUY", "default_strike": Decimal("0.01"), "strike_schedule": []}]
        legs[0]["terms"] = {"custom_cashflows": [{"id": "x", "type": "FEE", "payment_date": "2026-09-25", "accrual_start": None,
                                                   "accrual_end": None, "amount": -25000, "currency": "USD", "notes": "ours"}]}
        ours, theirs = self._pair(legs)
        assert ours == theirs
        flt = next(l for l in ours["legs"] if l["leg_type"] == "FLOAT")
        cap = next(o for o in flt["embedded_options"] if o["type"] == "CAP")
        assert (cap["buyer"], cap["seller"]) == (CP["lei"], OWN["lei"])     # we SELL the cap
        fee = flt["custom_cashflows"][0]
        assert (fee["payer"], fee["receiver"], fee["amount"]) == (OWN["lei"], CP["lei"], "25000")
        assert "id" not in fee and "notes" not in fee

    def test_any_term_change_or_different_uti_breaks_equality(self):
        ours, _ = self._pair()
        legs = _mirror(_legs()); legs[1]["fixed_rate"] = Decimal("0.0366")
        assert trade_hash(self.v2(_trade(uti=self.UTI), list(reversed(legs)), CP, OWN)) != trade_hash(ours)
        assert trade_hash(self.v2(_trade(uti="OTHER"), _legs(), OWN, CP)) != trade_hash(ours)
        same_dir = self.v2(_trade(uti=self.UTI), _legs(), CP, OWN)          # both think they pay fixed
        assert trade_hash(same_dir) != trade_hash(ours)

    def test_needs_both_leis_and_known_directions(self):
        with pytest.raises(ValueError):
            self.v2(_trade(), _legs(), {"lei": None, "name": "x"}, CP)
        legs = _legs(); legs[0]["direction"] = "SIDEWAYS"
        with pytest.raises(ValueError):
            self.v2(_trade(), legs, OWN, CP)

    def test_known_vector_v2(self):
        p = self.v2(_trade(uti=self.UTI, id=None, user_id=None, created_at=None), _legs(), OWN, CP)
        assert trade_hash_hex(p) == KNOWN_V2_HASH


# Pinned 2026-09-24 for schema v2. Regenerate ONLY with a schema version bump.
KNOWN_V2_HASH = "0x8f2cf6868674a75e0c1fa56e2c449fe97e4c0d466e0d64e1043b308a9a289d76"


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


# ── Lifecycle: amend / terminate ─────────────────────────────────────────────

from unittest.mock import MagicMock
from fastapi import HTTPException as _HTTPExc
from chain import lifecycle
from chain.signing import amendment_typed_data, termination_typed_data


class TestLifecycleHelpers:

    def test_is_terminated(self):
        assert not lifecycle.is_terminated(None)
        assert not lifecycle.is_terminated({"trade_hash": "0x01"})
        assert lifecycle.is_terminated({"trade_hash": "0x01", "terminated": True})

    def test_refuse_offchain_mutation_passes_when_not_anchored(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.first.return_value = None
        t = MagicMock(); t.id = uuid4(); t.trade_ref = "TRD-X"
        lifecycle.refuse_offchain_mutation(db, t, "Editing")   # no raise

    def test_refuse_offchain_mutation_409_when_anchored(self):
        db = MagicMock()
        ev = MagicMock(); ev.payload = {"attestation": {"trade_hash": "0x" + "ab" * 32,
                                                        "anchor": {"anchored": True, "block_number": 7}}}
        db.query.return_value.filter.return_value.order_by.return_value.first.return_value = ev
        t = MagicMock(); t.id = uuid4(); t.trade_ref = "TRD-X"
        with pytest.raises(_HTTPExc) as ei:
            lifecycle.refuse_offchain_mutation(db, t, "Editing leg FIXED-1")
        assert ei.value.status_code == 409
        assert "confirmed on-chain" in ei.value.detail and "/api/chain/amend/" in ei.value.detail

    def test_off_chain_attestation_does_not_block(self):
        db = MagicMock()
        ev = MagicMock(); ev.payload = {"attestation": {"trade_hash": "0x01", "anchor": {"anchored": False}}}
        db.query.return_value.filter.return_value.order_by.return_value.first.return_value = ev
        t = MagicMock(); t.id = uuid4(); t.trade_ref = "TRD-X"
        lifecycle.refuse_offchain_mutation(db, t, "Editing")   # signed-but-unanchored is not frozen


class TestApplyChanges:
    """_apply_changes: only signed economic terms may change, with type coercion."""

    def _rows(self):
        from api.routes.chain import _apply_changes
        t = MagicMock(); t.id = uuid4()
        l1 = MagicMock(); l1.id = uuid4(); l1.leg_ref = "FIXED-1"
        l2 = MagicMock(); l2.id = uuid4(); l2.leg_ref = "FLOAT-1"
        return _apply_changes, MagicMock(), t, [l1, l2]

    def test_coerces_dates_and_decimals(self):
        apply, db, t, legs = self._rows()
        apply(db, t, legs, {"trade": {"maturity_date": "2032-09-24", "notional": 12000000},
                            "legs": [{"id": str(legs[0].id), "fixed_rate": "0.041", "payment_lag": "3"}]})
        assert t.maturity_date == date(2032, 9, 24) and t.notional == Decimal("12000000")
        assert legs[0].fixed_rate == Decimal("0.041") and legs[0].payment_lag == 3
        db.flush.assert_called_once()

    def test_refuses_non_economic_trade_field(self):
        apply, db, t, legs = self._rows()
        with pytest.raises(_HTTPExc) as ei:
            apply(db, t, legs, {"trade": {"status": "CANCELLED"}})
        assert ei.value.status_code == 422 and "not an economic" in ei.value.detail

    def test_refuses_non_economic_leg_field_and_unknown_leg(self):
        apply, db, t, legs = self._rows()
        with pytest.raises(_HTTPExc):
            apply(db, t, legs, {"legs": [{"id": str(legs[0].id), "leg_ref": "X"}]})
        with pytest.raises(_HTTPExc) as ei:
            apply(db, t, legs, {"legs": [{"id": str(uuid4()), "fixed_rate": "0.04"}]})
        assert "not on this trade" in ei.value.detail

    def test_refuses_empty_changes(self):
        apply, db, t, legs = self._rows()
        with pytest.raises(_HTTPExc):
            apply(db, t, legs, {})


class TestLifecycleSignatures:
    """Amend/terminate signatures are bound to the pair of hashes and the counterparty."""

    def test_amendment_bound_to_both_hashes_and_counterparty(self):
        h1, h2 = b"\x01" * 32, b"\x02" * 32
        sig = sign(amendment_typed_data(31337, REG, h1, h2, B.address), A.key)
        assert recover(amendment_typed_data(31337, REG, h1, h2, B.address), sig) == A.address
        assert recover(amendment_typed_data(31337, REG, h2, h1, B.address), sig) != A.address   # swapped
        assert recover(amendment_typed_data(31337, REG, h1, b"\x03" * 32, B.address), sig) != A.address
        assert recover(amendment_typed_data(31337, REG, h1, h2, A.address), sig) != A.address
        # a confirmation signature can never be replayed as an amendment
        conf = sign(confirmation_typed_data(31337, REG, h1, B.address), A.key)
        assert recover(amendment_typed_data(31337, REG, h1, h2, B.address), conf) != A.address

    def test_termination_bound_to_hash_and_counterparty(self):
        h = b"\x05" * 32
        sig = sign(termination_typed_data(31337, REG, h, B.address), A.key)
        assert recover(termination_typed_data(31337, REG, h, B.address), sig) == A.address
        assert recover(termination_typed_data(31337, REG, b"\x06" * 32, B.address), sig) != A.address
        assert recover(confirmation_typed_data(31337, REG, h, B.address), sig) != A.address


class TestLiveLifecycle:
    """amend / terminate through the EVM backend against a deployed registry."""

    def _be(self, anvil, monkeypatch):
        monkeypatch.setenv("RIJEKA_CHAIN_RPC", anvil["url"])
        monkeypatch.setenv("RIJEKA_CHAIN_REGISTRY", anvil["registry"])
        monkeypatch.setenv("RIJEKA_CHAIN_RELAYER_KEY", anvil["relayer"])
        from chain.attestation import get_backend
        return get_backend(refresh=True)

    def _confirm(self, be, h):
        sa = sign(confirmation_typed_data(be.chain_id, be.registry, h, B.address), A.key)
        sb = sign(confirmation_typed_data(be.chain_id, be.registry, h, A.address), B.key)
        return be.confirm(h, A.address, B.address, sa, sb)

    def test_amend_supersedes_and_links(self, anvil, monkeypatch):
        be = self._be(anvil, monkeypatch)
        h1, h2 = b"\x41" * 32, b"\x42" * 32
        self._confirm(be, h1)
        # digests match the contract
        assert be.amendment_digest(h1, h2, B.address) == eip712_digest(amendment_typed_data(be.chain_id, be.registry, h1, h2, B.address))
        sa = sign(amendment_typed_data(be.chain_id, be.registry, h1, h2, B.address), A.key)
        sb = sign(amendment_typed_data(be.chain_id, be.registry, h1, h2, A.address), B.key)
        r = be.amend(h1, h2, sa, sb)
        assert r.anchored and r.block_number > 0
        old, new = be.get(h1), be.get(h2)
        assert old.status == "Superseded"
        assert new.status == "Confirmed" and new.prev_hash == "0x" + h1.hex()
        assert new.party_a == A.address and new.party_b == B.address

    def test_amend_rejects_wrong_signer_and_unconfirmed_prev(self, anvil, monkeypatch):
        be = self._be(anvil, monkeypatch)
        h1, h2 = b"\x51" * 32, b"\x52" * 32
        self._confirm(be, h1)
        X = Account.from_key("0x" + "44" * 32)
        sa = sign(amendment_typed_data(be.chain_id, be.registry, h1, h2, B.address), A.key)
        sx = sign(amendment_typed_data(be.chain_id, be.registry, h1, h2, A.address), X.key)
        with pytest.raises(Exception):
            be.amend(h1, h2, sa, sx)
        assert be.get(h2) is None and be.get(h1).status == "Confirmed"
        # amending a hash that was never confirmed
        sb = sign(amendment_typed_data(be.chain_id, be.registry, b"\x53" * 32, h2, A.address), B.key)
        sa2 = sign(amendment_typed_data(be.chain_id, be.registry, b"\x53" * 32, h2, B.address), A.key)
        with pytest.raises(Exception):
            be.amend(b"\x53" * 32, h2, sa2, sb)

    def test_terminate(self, anvil, monkeypatch):
        be = self._be(anvil, monkeypatch)
        h = b"\x61" * 32
        self._confirm(be, h)
        assert be.termination_digest(h, B.address) == eip712_digest(termination_typed_data(be.chain_id, be.registry, h, B.address))
        sa = sign(termination_typed_data(be.chain_id, be.registry, h, B.address), A.key)
        sb = sign(termination_typed_data(be.chain_id, be.registry, h, A.address), B.key)
        r = be.terminate(h, sa, sb)
        assert r.anchored
        assert be.get(h).status == "Terminated"
        # cannot amend or terminate a terminated record
        h2 = b"\x62" * 32
        sa2 = sign(amendment_typed_data(be.chain_id, be.registry, h, h2, B.address), A.key)
        sb2 = sign(amendment_typed_data(be.chain_id, be.registry, h, h2, A.address), B.key)
        with pytest.raises(Exception):
            be.amend(h, h2, sa2, sb2)


class TestCountersignCLILifecycle:
    """The counterparty tool signs amendment and termination requests too."""

    TOOL = os.path.join(os.path.dirname(__file__), "..", "..", "chain", "tools", "countersign.py")

    def _run(self, args):
        import sys as _s
        return subprocess.run([_s.executable, self.TOOL] + args, capture_output=True, text=True)

    def test_amendment_request(self, tmp_path):
        cp = Account.from_key("0x" + "3a" * 32)
        p_old = canonical_payload(_trade(), _legs(), OWN, CP); h1 = trade_hash(p_old)
        legs = _legs(); legs[1]["fixed_rate"] = Decimal("0.0370")
        p_new = canonical_payload(_trade(), legs, OWN, CP); h2 = trade_hash(p_new)
        req = {"format": "rijeka-amendment-request", "format_version": 1, "trade_id": "t", "trade_ref": "TRD-A",
               "changes": {"legs": [{"id": "x", "fixed_rate": "0.0370"}]},
               "prev_hash": "0x" + h1.hex(), "new_hash": "0x" + h2.hex(), "canonical": p_new,
               "eip712": {"name": "Rijeka Trade Confirmation", "version": "1", "chain_id": 31337, "verifying_contract": REG},
               "from": {"lei": OWN["lei"], "name": OWN["name"], "address": A.address,
                        "signature": "0x" + sign(amendment_typed_data(31337, REG, h1, h2, cp.address), A.key).hex()},
               "to": {"lei": CP["lei"], "name": CP["name"], "address": cp.address,
                      "digest_to_sign": "0x" + eip712_digest(amendment_typed_data(31337, REG, h1, h2, A.address)).hex()}}
        rp = tmp_path / "amend.json"; rp.write_text(json.dumps(req))
        kf = tmp_path / "k"; kf.write_text("0x" + cp.key.hex())
        out = tmp_path / "sig.json"
        r = self._run([str(rp), "--key-file", str(kf), "--out", str(out), "--yes"])
        assert r.returncode == 0, r.stdout + r.stderr
        assert "AMEND" in r.stdout and "supersedes" in r.stdout
        sig = json.loads(out.read_text())
        assert sig["format"] == "rijeka-amendment-countersignature" and sig["prev_hash"] == "0x" + h1.hex()
        assert recover(amendment_typed_data(31337, REG, h1, h2, A.address), bytes.fromhex(sig["signature"][2:])) == cp.address

    def test_termination_request(self, tmp_path):
        cp = Account.from_key("0x" + "3a" * 32)
        h = trade_hash(canonical_payload(_trade(), _legs(), OWN, CP))
        req = {"format": "rijeka-termination-request", "format_version": 1, "trade_id": "t", "trade_ref": "TRD-T",
               "trade_hash": "0x" + h.hex(),
               "eip712": {"name": "Rijeka Trade Confirmation", "version": "1", "chain_id": 31337, "verifying_contract": REG},
               "from": {"lei": OWN["lei"], "name": OWN["name"], "address": A.address,
                        "signature": "0x" + sign(termination_typed_data(31337, REG, h, cp.address), A.key).hex()},
               "to": {"lei": CP["lei"], "name": CP["name"], "address": cp.address,
                      "digest_to_sign": "0x" + eip712_digest(termination_typed_data(31337, REG, h, A.address)).hex()}}
        rp = tmp_path / "term.json"; rp.write_text(json.dumps(req))
        kf = tmp_path / "k"; kf.write_text("0x" + cp.key.hex())
        out = tmp_path / "sig.json"
        r = self._run([str(rp), "--key-file", str(kf), "--out", str(out), "--yes"])
        assert r.returncode == 0, r.stdout + r.stderr
        assert "TERMINATE" in r.stdout
        sig = json.loads(out.read_text())
        assert recover(termination_typed_data(31337, REG, h, A.address), bytes.fromhex(sig["signature"][2:])) == cp.address


# ── Digital-asset products in schema v2 (ISDA Digital Asset Derivatives vocabulary) ──

def _ndo(**over):
    terms = dict(direction="BUY", digital_asset="BTC", notional_amount="10", option_type="CALL",
                 exercise_style="EUROPEAN", strike_price="75000", strike_currency="USD",
                 expiration_date="2026-12-26", expiration_time="08:00 UTC",
                 valuation_date="2026-12-26", valuation_time="16:00 London", settlement_date="2026-12-28",
                 settlement_currency="USD", settlement_price_source="CME CF BRR",
                 premium_amount="42000", premium_currency="USD", premium_payment_date="2026-10-01",
                 automatic_exercise=True, calculation_agent=None, disruption_fallback=None)
    terms.update(over.pop("terms", {}))
    t = dict(uti="254900OPPU84GM83MG36" + "B" * 32, asset_class="CRYPTO", instrument_type="CRYPTO_OPTION",
             structure="EUROPEAN", notional=Decimal("10"), notional_ccy="BTC",
             trade_date=date(2026, 9, 29), effective_date=date(2026, 9, 29), maturity_date=date(2026, 12, 28),
             terms=terms, trade_ref="TRD-NDO-1", id=uuid4(), user_id=uuid4(), desk="DIGITAL")
    t.update(over); return t


def _ndf(**over):
    terms = dict(direction="BUY", digital_asset="ETH", notional_amount="250", forward_price="4100.50",
                 price_currency="USD", valuation_date="2026-11-27", valuation_time="16:00 London",
                 settlement_date="2026-11-30", settlement_currency="USD", settlement_price_source="CME CF ETHUSD_RR",
                 calculation_agent=None, disruption_fallback=None)
    terms.update(over.pop("terms", {}))
    t = dict(uti="254900OPPU84GM83MG36" + "C" * 32, asset_class="CRYPTO", instrument_type="CRYPTO_FORWARD",
             structure="NDF", notional=Decimal("250"), notional_ccy="ETH",
             trade_date=date(2026, 9, 29), effective_date=date(2026, 9, 29), maturity_date=date(2026, 11, 30),
             terms=terms, trade_ref="TRD-NDF-1", id=uuid4(), user_id=uuid4())
    t.update(over); return t


def _their_side(t):
    """The counterparty's booking of the same trade: their ref, opposite direction, same terms."""
    flip = {"BUY": "SELL", "SELL": "BUY", "LONG": "SHORT", "SHORT": "LONG"}
    return dict(t, trade_ref="CB-DA-77", id=uuid4(), user_id=uuid4(), desk="OTC",
                terms=dict(t["terms"], direction=flip[t["terms"]["direction"]]))


class TestCanonicalCrypto:
    v2 = staticmethod(partial(_canonical_payload, version=2))

    def test_option_shape_and_parties(self):
        p = self.v2(_ndo(), [], OWN, CP)
        assert set(p) == {"schema", "schema_version", "uti", "parties", "trade", "product"}
        assert p["schema_version"] == 2 and p["parties"] == sorted([OWN["lei"], CP["lei"]])
        pr = p["product"]
        assert pr["product"] == "NDO" and (pr["buyer"], pr["seller"]) == (OWN["lei"], CP["lei"])
        assert pr["option_type"] == "CALL" and pr["strike_price"] == "75000" and pr["notional_amount"] == "10"
        assert pr["settlement_price_source"] == "CME CF BRR" and pr["settlement_currency"] == "USD"
        assert "direction" not in pr and "legs" not in p

    def test_forward_shape(self):
        p = self.v2(_ndf(), [], OWN, CP)
        pr = p["product"]
        assert pr["product"] == "NDF" and pr["forward_price"] == "4100.5" and pr["digital_asset"] == "ETH"
        assert (pr["buyer"], pr["seller"]) == (OWN["lei"], CP["lei"])
        assert "option_type" not in pr and "strike_price" not in pr

    @pytest.mark.parametrize("mk", [_ndo, _ndf])
    def test_both_sides_hash_identically(self, mk):
        ours = self.v2(mk(), [], OWN, CP)
        theirs = self.v2(_their_side(mk()), [], CP, OWN)
        assert ours == theirs and trade_hash(ours) == trade_hash(theirs)

    def test_case_and_number_normalisation(self):
        a = self.v2(_ndo(terms={"digital_asset": "btc", "option_type": "call", "settlement_currency": "usd",
                                "strike_price": "75000.00", "premium_amount": Decimal("42000.0")}), [], OWN, CP)
        b = self.v2(_ndo(), [], OWN, CP)
        assert a == b

    def test_any_economic_change_breaks_equality(self):
        base = trade_hash(self.v2(_ndo(), [], OWN, CP))
        for k, v in [("strike_price", "75001"), ("option_type", "PUT"), ("settlement_price_source", "Coinbase BTC-USD"),
                     ("valuation_time", "08:00 UTC"), ("premium_amount", "42001"), ("settlement_currency", "USDC")]:
            assert trade_hash(self.v2(_ndo(terms={k: v}), [], OWN, CP)) != base, k
        # same direction on both sides = both think they bought
        assert trade_hash(self.v2(_ndo(), [], CP, OWN)) != base

    def test_missing_required_terms_refused(self):
        with pytest.raises(ValueError, match="settlement_price_source"):
            self.v2(_ndo(terms={"settlement_price_source": None}), [], OWN, CP)
        with pytest.raises(ValueError, match="forward_price"):
            self.v2(_ndf(terms={"forward_price": ""}), [], OWN, CP)
        with pytest.raises(ValueError, match="option_type"):
            self.v2(_ndo(terms={"option_type": "STRADDLE"}), [], OWN, CP)
        with pytest.raises(ValueError, match="positive"):
            self.v2(_ndo(terms={"notional_amount": "0"}), [], OWN, CP)
        with pytest.raises(ValueError):
            self.v2(_ndo(terms={"direction": "PAY"}), [], OWN, CP)   # options are bought/sold

    def test_irs_v2_pin_unchanged(self):
        """Adding the product branch must not move a single IRS byte."""
        p = _canonical_payload(_trade(uti=TestCanonicalV2.UTI, id=None, user_id=None, created_at=None),
                               _legs(), OWN, CP, version=2)
        assert trade_hash_hex(p) == KNOWN_V2_HASH

    def test_known_vectors(self):
        assert trade_hash_hex(self.v2(_ndo(id=None, user_id=None), [], OWN, CP)) == KNOWN_NDO_HASH
        assert trade_hash_hex(self.v2(_ndf(id=None, user_id=None), [], OWN, CP)) == KNOWN_NDF_HASH


# Pinned 2026-09-29 for the v2 digital-asset products. Regenerate ONLY with a schema version bump.
KNOWN_NDO_HASH = "0x20cfaa4ab98d72dc4facc57f922e31bbd38bd608816f39adf3b9e5a6b69ad4e8"
KNOWN_NDF_HASH = "0xec102df431dbae43982432e4226db72544126d0c586264832686677de5fb766a"
