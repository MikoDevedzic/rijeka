// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/TradeConfirmationRegistry.sol";

/// Deploy with:
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --private-key $DEPLOYER_KEY
/// Prints the registry address; put it in backend/.env as RIJEKA_CHAIN_REGISTRY.
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        TradeConfirmationRegistry reg = new TradeConfirmationRegistry();
        vm.stopBroadcast();
        console2.log("TradeConfirmationRegistry deployed at", address(reg));
    }
}
