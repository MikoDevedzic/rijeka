// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  TradeConfirmationRegistry
/// @notice Bilateral, cryptographically signed confirmation of OTC derivative
///         trades, anchored on Ethereum.
///
///         Nothing economic goes on-chain. A trade is identified by the
///         keccak256 of its canonical off-chain representation (Rijeka
///         canonical JSON v1 today; ISDA CDM later — the schema version is
///         inside the hashed payload). Both parties sign that hash under
///         EIP-712; anyone may submit the pair. The registry records who
///         signed and when, and links lifecycle events (amend, terminate)
///         to the hash they supersede.
///
///         This is the load-bearing primitive behind the margin-period-of-risk
///         argument: from the block the confirmation lands in, both parties
///         hold an identical, immutable record of the terms, so there is no
///         confirmation dispute to double the MPoR.
///
///         Deliberately dependency-free (no OpenZeppelin) so the bytecode is
///         auditable in one file and deploys unchanged on Anvil, Sepolia,
///         mainnet or a permissioned EVM.
contract TradeConfirmationRegistry {

    // ── Types ────────────────────────────────────────────────────────────

    enum Status { None, Confirmed, Superseded, Terminated }

    struct Confirmation {
        address partyA;
        address partyB;
        uint64  confirmedAt;     // block timestamp
        uint64  blockNumber;
        bytes32 prevHash;        // hash this record amends (0x0 for new trades)
        Status  status;
    }

    // ── Storage ──────────────────────────────────────────────────────────

    mapping(bytes32 => Confirmation) private _confirmations;

    // ── EIP-712 ──────────────────────────────────────────────────────────

    bytes32 private constant _EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant _CONFIRM_TYPEHASH =
        keccak256("TradeConfirmation(bytes32 tradeHash,address counterparty)");
    bytes32 private constant _AMEND_TYPEHASH =
        keccak256("TradeAmendment(bytes32 prevHash,bytes32 newHash,address counterparty)");
    bytes32 private constant _TERMINATE_TYPEHASH =
        keccak256("TradeTermination(bytes32 tradeHash,address counterparty)");

    string public constant NAME    = "Rijeka Trade Confirmation";
    string public constant VERSION = "1";

    bytes32 public immutable DOMAIN_SEPARATOR;

    // ── Events ───────────────────────────────────────────────────────────

    event Confirmed (bytes32 indexed tradeHash, address indexed partyA, address indexed partyB, uint64 confirmedAt);
    event Amended   (bytes32 indexed prevHash,  bytes32 indexed newHash, address partyA, address partyB, uint64 confirmedAt);
    event Terminated(bytes32 indexed tradeHash, address partyA, address partyB, uint64 terminatedAt);

    // ── Errors ───────────────────────────────────────────────────────────

    error AlreadyRecorded(bytes32 tradeHash);
    error NotConfirmed(bytes32 tradeHash);
    error SameParty();
    error ZeroAddress();
    error ZeroHash();
    error BadSignature(address expected, address recovered);
    error InvalidSignatureLength();
    error InvalidSignatureS();

    constructor() {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            _EIP712_DOMAIN_TYPEHASH,
            keccak256(bytes(NAME)),
            keccak256(bytes(VERSION)),
            block.chainid,
            address(this)
        ));
    }

    // ── Views ────────────────────────────────────────────────────────────

    function getConfirmation(bytes32 tradeHash) external view returns (Confirmation memory) {
        return _confirmations[tradeHash];
    }

    function isConfirmed(bytes32 tradeHash) external view returns (bool) {
        return _confirmations[tradeHash].status == Status.Confirmed;
    }

    /// @notice Digest a party must sign to confirm `tradeHash` against `counterparty`.
    function confirmationDigest(bytes32 tradeHash, address counterparty) public view returns (bytes32) {
        return _typedDataHash(keccak256(abi.encode(_CONFIRM_TYPEHASH, tradeHash, counterparty)));
    }

    function amendmentDigest(bytes32 prevHash, bytes32 newHash, address counterparty) public view returns (bytes32) {
        return _typedDataHash(keccak256(abi.encode(_AMEND_TYPEHASH, prevHash, newHash, counterparty)));
    }

    function terminationDigest(bytes32 tradeHash, address counterparty) public view returns (bytes32) {
        return _typedDataHash(keccak256(abi.encode(_TERMINATE_TYPEHASH, tradeHash, counterparty)));
    }

    // ── Mutations ────────────────────────────────────────────────────────

    /// @notice Record a new trade confirmation. Each party signs
    ///         TradeConfirmation(tradeHash, <the other party>), which binds
    ///         the signature to this counterparty pairing.
    function confirm(
        bytes32 tradeHash,
        address partyA,
        address partyB,
        bytes calldata sigA,
        bytes calldata sigB
    ) external {
        _checkParties(tradeHash, partyA, partyB);
        if (_confirmations[tradeHash].status != Status.None) revert AlreadyRecorded(tradeHash);

        _requireSigner(partyA, confirmationDigest(tradeHash, partyB), sigA);
        _requireSigner(partyB, confirmationDigest(tradeHash, partyA), sigB);

        _record(tradeHash, partyA, partyB, bytes32(0));
        emit Confirmed(tradeHash, partyA, partyB, uint64(block.timestamp));
    }

    /// @notice Supersede a confirmed trade with amended terms. Parties must
    ///         be the same pair that confirmed `prevHash`.
    function amend(
        bytes32 prevHash,
        bytes32 newHash,
        bytes calldata sigA,
        bytes calldata sigB
    ) external {
        Confirmation storage prev = _confirmations[prevHash];
        if (prev.status != Status.Confirmed) revert NotConfirmed(prevHash);
        if (newHash == bytes32(0)) revert ZeroHash();
        if (_confirmations[newHash].status != Status.None) revert AlreadyRecorded(newHash);

        address a = prev.partyA;
        address b = prev.partyB;
        _requireSigner(a, amendmentDigest(prevHash, newHash, b), sigA);
        _requireSigner(b, amendmentDigest(prevHash, newHash, a), sigB);

        prev.status = Status.Superseded;
        _record(newHash, a, b, prevHash);
        emit Amended(prevHash, newHash, a, b, uint64(block.timestamp));
    }

    /// @notice Terminate a confirmed trade.
    function terminate(
        bytes32 tradeHash,
        bytes calldata sigA,
        bytes calldata sigB
    ) external {
        Confirmation storage c = _confirmations[tradeHash];
        if (c.status != Status.Confirmed) revert NotConfirmed(tradeHash);

        address a = c.partyA;
        address b = c.partyB;
        _requireSigner(a, terminationDigest(tradeHash, b), sigA);
        _requireSigner(b, terminationDigest(tradeHash, a), sigB);

        c.status = Status.Terminated;
        emit Terminated(tradeHash, a, b, uint64(block.timestamp));
    }

    // ── Internals ────────────────────────────────────────────────────────

    function _checkParties(bytes32 tradeHash, address a, address b) private pure {
        if (tradeHash == bytes32(0)) revert ZeroHash();
        if (a == address(0) || b == address(0)) revert ZeroAddress();
        if (a == b) revert SameParty();
    }

    function _record(bytes32 h, address a, address b, bytes32 prev) private {
        _confirmations[h] = Confirmation({
            partyA:      a,
            partyB:      b,
            confirmedAt: uint64(block.timestamp),
            blockNumber: uint64(block.number),
            prevHash:    prev,
            status:      Status.Confirmed
        });
    }

    function _typedDataHash(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _requireSigner(address expected, bytes32 digest, bytes calldata sig) private pure {
        address recovered = _recover(digest, sig);
        if (recovered != expected) revert BadSignature(expected, recovered);
    }

    /// @dev ECDSA recovery with the low-s malleability check (EIP-2).
    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) revert InvalidSignatureLength();
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert InvalidSignatureS();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature(address(0), signer);
        return signer;
    }
}
