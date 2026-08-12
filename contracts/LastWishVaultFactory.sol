// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LastWishVault} from "./LastWishVault.sol";

contract LastWishVaultFactory {
    mapping(address => address[]) private _vaults;
    mapping(address => address) public vaultOf;

    error VaultAlreadyExists();

    event VaultCreated(address indexed owner, address indexed vault, bool testnetDemo);

    function createVault(
        address guardian,
        address[] calldata beneficiaries,
        uint16[] calldata shares,
        uint256 heartbeatInterval,
        uint256 gracePeriod,
        bool testnetDemo
    ) external returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert VaultAlreadyExists();
        vault = address(
            new LastWishVault(msg.sender, guardian, beneficiaries, shares, heartbeatInterval, gracePeriod, testnetDemo)
        );
        vaultOf[msg.sender] = vault;
        _vaults[msg.sender].push(vault);
        emit VaultCreated(msg.sender, vault, testnetDemo);
    }

    function vaultCount(address owner) external view returns (uint256) {
        return _vaults[owner].length;
    }

    function vaultAt(address owner, uint256 index) external view returns (address) {
        return _vaults[owner][index];
    }
}
