// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {LastWishVaultFactory} from "../contracts/LastWishVaultFactory.sol";

contract DeployLastWish is Script {
    function run() external returns (LastWishVaultFactory factory) {
        vm.startBroadcast();
        factory = new LastWishVaultFactory();
        vm.stopBroadcast();
    }
}
