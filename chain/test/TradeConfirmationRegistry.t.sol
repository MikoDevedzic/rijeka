// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TradeConfirmationRegistry.sol";

contract TradeConfirmationRegistryTest is Test {
    TradeConfirmationRegistry reg;

    uint256 constant PK_A = 0xA11CE;
    uint256 constant PK_B = 0xB0B;
    uint256 constant PK_X = 0xBAD;
    address A; address B; address X;

    bytes32 constant H1 = keccak256("trade-1 canonical json v1");
    bytes32 constant H2 = keccak256("trade-1 amended canonical json v1");

    function setUp() public {
        reg = new TradeConfirmationRegistry();
        A = vm.addr(PK_A);
        B = vm.addr(PK_B);
        X = vm.addr(PK_X);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _confirmSigs(bytes32 h) internal view returns (bytes memory sa, bytes memory sb) {
        sa = _sign(PK_A, reg.confirmationDigest(h, B));
        sb = _sign(PK_B, reg.confirmationDigest(h, A));
    }

    // ── confirm ────────────────────────────────────────────────────────

    function test_confirm_records_both_parties() public {
        (bytes memory sa, bytes memory sb) = _confirmSigs(H1);
        vm.warp(1_800_000_000);
        vm.expectEmit(true, true, true, true);
        emit TradeConfirmationRegistry.Confirmed(H1, A, B, uint64(1_800_000_000));
        reg.confirm(H1, A, B, sa, sb);

        TradeConfirmationRegistry.Confirmation memory c = reg.getConfirmation(H1);
        assertEq(c.partyA, A);
        assertEq(c.partyB, B);
        assertEq(c.confirmedAt, 1_800_000_000);
        assertEq(uint8(c.status), uint8(TradeConfirmationRegistry.Status.Confirmed));
        assertEq(c.prevHash, bytes32(0));
        assertTrue(reg.isConfirmed(H1));
    }

    function test_anyone_can_relay() public {
        (bytes memory sa, bytes memory sb) = _confirmSigs(H1);
        vm.prank(X);                       // relayer is not a party
        reg.confirm(H1, A, B, sa, sb);
        assertTrue(reg.isConfirmed(H1));
    }

    function test_rejects_wrong_signer() public {
        bytes memory sa = _sign(PK_X, reg.confirmationDigest(H1, B));   // X signs as A
        bytes memory sb = _sign(PK_B, reg.confirmationDigest(H1, A));
        vm.expectRevert(abi.encodeWithSelector(TradeConfirmationRegistry.BadSignature.selector, A, X));
        reg.confirm(H1, A, B, sa, sb);
    }

    function test_signature_is_bound_to_counterparty() public {
        // A signs a confirmation of H1 against X, not B — must not be usable for (A, B)
        bytes memory sa = _sign(PK_A, reg.confirmationDigest(H1, X));
        bytes memory sb = _sign(PK_B, reg.confirmationDigest(H1, A));
        vm.expectRevert();
        reg.confirm(H1, A, B, sa, sb);
    }

    function test_signature_is_bound_to_hash() public {
        bytes memory sa = _sign(PK_A, reg.confirmationDigest(H2, B));   // signed a different trade
        bytes memory sb = _sign(PK_B, reg.confirmationDigest(H1, A));
        vm.expectRevert();
        reg.confirm(H1, A, B, sa, sb);
    }

    function test_rejects_double_confirmation() public {
        (bytes memory sa, bytes memory sb) = _confirmSigs(H1);
        reg.confirm(H1, A, B, sa, sb);
        vm.expectRevert(abi.encodeWithSelector(TradeConfirmationRegistry.AlreadyRecorded.selector, H1));
        reg.confirm(H1, A, B, sa, sb);
    }

    function test_rejects_same_party_zero_address_zero_hash() public {
        (bytes memory sa, bytes memory sb) = _confirmSigs(H1);
        vm.expectRevert(TradeConfirmationRegistry.SameParty.selector);
        reg.confirm(H1, A, A, sa, sa);
        vm.expectRevert(TradeConfirmationRegistry.ZeroAddress.selector);
        reg.confirm(H1, address(0), B, sa, sb);
        vm.expectRevert(TradeConfirmationRegistry.ZeroHash.selector);
        reg.confirm(bytes32(0), A, B, sa, sb);
    }

    function test_rejects_bad_signature_length() public {
        (, bytes memory sb) = _confirmSigs(H1);
        vm.expectRevert(TradeConfirmationRegistry.InvalidSignatureLength.selector);
        reg.confirm(H1, A, B, hex"deadbeef", sb);
    }

    function test_rejects_high_s_malleated_signature() public {
        (bytes memory sa, bytes memory sb) = _confirmSigs(H1);
        // Malleate sa: s' = n - s, v' = v ^ 1
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(sa, 32))
            s := mload(add(sa, 64))
            v := byte(0, mload(add(sa, 96)))
        }
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 s2 = bytes32(n - uint256(s));
        uint8 v2 = v == 27 ? 28 : 27;
        bytes memory bad = abi.encodePacked(r, s2, v2);
        vm.expectRevert(TradeConfirmationRegistry.InvalidSignatureS.selector);
        reg.confirm(H1, A, B, bad, sb);
    }

    // ── amend ──────────────────────────────────────────────────────────

    function test_amend_supersedes_and_links() public {
        (bytes memory sa, bytes memory sb) = _confirmSigs(H1);
        reg.confirm(H1, A, B, sa, sb);

        bytes memory aa = _sign(PK_A, reg.amendmentDigest(H1, H2, B));
        bytes memory ab = _sign(PK_B, reg.amendmentDigest(H1, H2, A));
        reg.amend(H1, H2, aa, ab);

        assertEq(uint8(reg.getConfirmation(H1).status), uint8(TradeConfirmationRegistry.Status.Superseded));
        TradeConfirmationRegistry.Confirmation memory c2 = reg.getConfirmation(H2);
        assertEq(uint8(c2.status), uint8(TradeConfirmationRegistry.Status.Confirmed));
        assertEq(c2.prevHash, H1);
        assertEq(c2.partyA, A);
        assertEq(c2.partyB, B);
        assertFalse(reg.isConfirmed(H1));
        assertTrue(reg.isConfirmed(H2));
    }

    function test_amend_requires_confirmed_prev() public {
        bytes memory aa = _sign(PK_A, reg.amendmentDigest(H1, H2, B));
        bytes memory ab = _sign(PK_B, reg.amendmentDigest(H1, H2, A));
        vm.expectRevert(abi.encodeWithSelector(TradeConfirmationRegistry.NotConfirmed.selector, H1));
        reg.amend(H1, H2, aa, ab);
    }

    function test_cannot_amend_twice_from_same_prev() public {
        (bytes memory sa, bytes memory sb) = _confirmSigs(H1);
        reg.confirm(H1, A, B, sa, sb);
        bytes memory aa = _sign(PK_A, reg.amendmentDigest(H1, H2, B));
        bytes memory ab = _sign(PK_B, reg.amendmentDigest(H1, H2, A));
        reg.amend(H1, H2, aa, ab);
        bytes32 H3 = keccak256("another amendment");
        bytes memory a3 = _sign(PK_A, reg.amendmentDigest(H1, H3, B));
        bytes memory b3 = _sign(PK_B, reg.amendmentDigest(H1, H3, A));
        vm.expectRevert(abi.encodeWithSelector(TradeConfirmationRegistry.NotConfirmed.selector, H1));
        reg.amend(H1, H3, a3, b3);
    }

    // ── terminate ──────────────────────────────────────────────────────

    function test_terminate() public {
        (bytes memory sa, bytes memory sb) = _confirmSigs(H1);
        reg.confirm(H1, A, B, sa, sb);
        bytes memory ta = _sign(PK_A, reg.terminationDigest(H1, B));
        bytes memory tb = _sign(PK_B, reg.terminationDigest(H1, A));
        reg.terminate(H1, ta, tb);
        assertEq(uint8(reg.getConfirmation(H1).status), uint8(TradeConfirmationRegistry.Status.Terminated));
        assertFalse(reg.isConfirmed(H1));
    }

    function test_terminate_requires_confirmed() public {
        bytes memory ta = _sign(PK_A, reg.terminationDigest(H1, B));
        bytes memory tb = _sign(PK_B, reg.terminationDigest(H1, A));
        vm.expectRevert(abi.encodeWithSelector(TradeConfirmationRegistry.NotConfirmed.selector, H1));
        reg.terminate(H1, ta, tb);
    }

    // ── EIP-712 domain ─────────────────────────────────────────────────

    function test_domain_separator_binds_chain_and_contract() public view {
        bytes32 expected = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("Rijeka Trade Confirmation")),
            keccak256(bytes("1")),
            block.chainid,
            address(reg)
        ));
        assertEq(reg.DOMAIN_SEPARATOR(), expected);
    }

    // ── fuzz ───────────────────────────────────────────────────────────

    function testFuzz_confirm_any_hash(bytes32 h) public {
        vm.assume(h != bytes32(0));
        bytes memory sa = _sign(PK_A, reg.confirmationDigest(h, B));
        bytes memory sb = _sign(PK_B, reg.confirmationDigest(h, A));
        reg.confirm(h, A, B, sa, sb);
        assertTrue(reg.isConfirmed(h));
    }
}
