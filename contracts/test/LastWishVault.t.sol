// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {LastWishVault} from "../LastWishVault.sol";
import {LastWishVaultFactory} from "../LastWishVaultFactory.sol";

contract LastWishVaultTest is Test {
    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal beneficiaryA = makeAddr("beneficiary-a");
    address internal beneficiaryB = makeAddr("beneficiary-b");
    address internal observer = makeAddr("observer");
    LastWishVault internal vault;

    function setUp() public {
        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = beneficiaryA;
        beneficiaries[1] = beneficiaryB;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 6_000;
        shares[1] = 4_000;
        vault = new LastWishVault(owner, guardian, beneficiaries, shares, 1 hours, 1 hours, true);
        vm.deal(address(vault), 1 ether + 1 wei);
    }

    function testConstructorRejectsInvalidPolicy() public {
        address[] memory duplicate = new address[](2);
        duplicate[0] = beneficiaryA;
        duplicate[1] = beneficiaryA;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 5_000;
        shares[1] = 5_000;

        vm.expectRevert(LastWishVault.DuplicateBeneficiary.selector);
        new LastWishVault(owner, guardian, duplicate, shares, 1 hours, 1 hours, true);

        duplicate[1] = beneficiaryB;
        shares[1] = 4_999;
        vm.expectRevert(LastWishVault.InvalidShareTotal.selector);
        new LastWishVault(owner, guardian, duplicate, shares, 1 hours, 1 hours, true);

        vm.expectRevert(LastWishVault.UnsafeTiming.selector);
        new LastWishVault(owner, guardian, duplicate, shares, 59, 1 hours, true);

        shares[1] = 5_000;
        vm.expectRevert(LastWishVault.UnsafeTiming.selector);
        new LastWishVault(owner, guardian, duplicate, shares, 10 * 365 days + 1, 1 hours, true);
    }

    function testRecordsItsDeploymentBlockForBoundedAuditIndexing() public view {
        assertEq(vault.deployedAtBlock(), block.number);
    }

    function testConstructorRejectsOverlappingOwnerGuardianAndBeneficiaryRoles() public {
        (address[] memory beneficiaries, uint16[] memory shares) = _policy();

        vm.expectRevert(LastWishVault.RoleOverlap.selector);
        new LastWishVault(owner, owner, beneficiaries, shares, 1 hours, 1 hours, true);

        beneficiaries[0] = owner;
        vm.expectRevert(LastWishVault.RoleOverlap.selector);
        new LastWishVault(owner, guardian, beneficiaries, shares, 1 hours, 1 hours, true);

        beneficiaries[0] = guardian;
        vm.expectRevert(LastWishVault.RoleOverlap.selector);
        new LastWishVault(owner, guardian, beneficiaries, shares, 1 hours, 1 hours, true);
    }

    function testConstructorBoundsBeneficiaryCountToKeepFinalizationExecutable() public {
        address[] memory beneficiaries = new address[](11);
        uint16[] memory shares = new uint16[](11);
        for (uint256 i; i < 11; ++i) {
            beneficiaries[i] = makeAddr(string.concat("beneficiary-", vm.toString(i)));
            shares[i] = i == 10 ? 910 : 909;
        }

        vm.expectRevert(LastWishVault.InvalidBeneficiaryCount.selector);
        new LastWishVault(owner, guardian, beneficiaries, shares, 1 hours, 1 hours, true);
    }

    function testNormalVaultRejectsDemoTiming() public {
        (address[] memory beneficiaries, uint16[] memory shares) = _policy();
        vm.expectRevert(LastWishVault.UnsafeTiming.selector);
        new LastWishVault(owner, guardian, beneficiaries, shares, 1 hours, 1 hours, false);
    }

    function testHeartbeatAuthorizationAndExactOpeningBoundary() public {
        uint256 startedAt = vault.lastHeartbeat();
        assertFalse(vault.canOpenSettlement());
        vm.prank(observer);
        vm.expectRevert(LastWishVault.OnlyOwner.selector);
        vault.heartbeat();

        vm.warp(startedAt + 1 hours - 1);
        vm.expectRevert(LastWishVault.HeartbeatStillActive.selector);
        vault.openSettlement();

        vm.warp(startedAt + 1 hours);
        assertTrue(vault.canOpenSettlement());
        vm.prank(observer);
        vault.openSettlement();
        assertEq(uint8(vault.status()), uint8(LastWishVault.Status.PENDING));
        assertFalse(vault.canOpenSettlement());
    }

    function testOwnerHeartbeatAndGuardianVetoReactivateSafely() public {
        vm.warp(vault.lastHeartbeat() + 1 hours);
        vm.prank(observer);
        vault.openSettlement();

        vm.prank(owner);
        vault.heartbeat();
        assertEq(uint8(vault.status()), uint8(LastWishVault.Status.ACTIVE));

        vm.warp(vault.lastHeartbeat() + 1 hours);
        vault.openSettlement();
        vm.prank(owner);
        vm.expectRevert(LastWishVault.OnlyGuardian.selector);
        vault.vetoSettlement();
        vm.prank(guardian);
        vault.vetoSettlement();
        assertEq(uint8(vault.status()), uint8(LastWishVault.Status.VETOED));

        vm.prank(owner);
        vault.heartbeat();
        assertEq(uint8(vault.status()), uint8(LastWishVault.Status.ACTIVE));
    }

    function testFinalizeIsTimeGatedPermissionlessAndConservesBalance() public {
        vm.warp(vault.lastHeartbeat() + 1 hours);
        vault.openSettlement();
        uint256 pendingAt = vault.pendingAt();
        vm.warp(pendingAt + 1 hours - 1);
        assertFalse(vault.canFinalizeSettlement());
        vm.expectRevert(LastWishVault.GracePeriodActive.selector);
        vault.finalizeSettlement();

        vm.warp(pendingAt + 1 hours);
        assertTrue(vault.canFinalizeSettlement());
        vm.prank(observer);
        vault.finalizeSettlement();
        assertFalse(vault.canFinalizeSettlement());
        assertEq(uint8(vault.status()), uint8(LastWishVault.Status.SETTLED));
        assertEq(vault.claimable(beneficiaryA), 600000000000000000);
        assertEq(vault.claimable(beneficiaryB), 400000000000000001);
        assertEq(vault.claimable(beneficiaryA) + vault.claimable(beneficiaryB), 1 ether + 1 wei);

        vm.expectRevert(LastWishVault.AlreadySettled.selector);
        vault.finalizeSettlement();
    }

    function testWithdrawOnlyWhileActiveAndClaimsExactlyOnce() public {
        vm.prank(observer);
        vm.expectRevert(LastWishVault.OnlyOwner.selector);
        vault.withdraw(payable(observer), 1 wei);

        vm.warp(vault.lastHeartbeat() + 1 hours);
        vault.openSettlement();
        vm.prank(owner);
        vm.expectRevert(LastWishVault.NotActive.selector);
        vault.withdraw(payable(owner), 1 wei);

        vm.warp(vault.pendingAt() + 1 hours);
        vault.finalizeSettlement();
        uint256 beforeBalance = beneficiaryA.balance;
        vm.prank(beneficiaryA);
        vault.claim();
        assertEq(beneficiaryA.balance - beforeBalance, 600000000000000000);
        vm.prank(beneficiaryA);
        vm.expectRevert(LastWishVault.NothingToClaim.selector);
        vault.claim();

        (bool success,) = address(vault).call{value: 1 wei}("");
        assertFalse(success);
    }

    function testRejectsWithdrawalAfterHeartbeatExpiryBeforeKeeperOpensSettlement() public {
        vm.warp(vault.lastHeartbeat() + 1 hours);
        vm.prank(owner);
        vm.expectRevert(LastWishVault.HeartbeatExpired.selector);
        vault.withdraw(payable(owner), 1 wei);
    }

    function testGuardianCannotVetoAfterGracePeriodEnds() public {
        vm.warp(vault.lastHeartbeat() + 1 hours);
        vault.openSettlement();
        vm.warp(vault.pendingAt() + 1 hours);
        vm.prank(guardian);
        vm.expectRevert(LastWishVault.NotPending.selector);
        vault.vetoSettlement();
    }

    function testUpdatePolicyValidatesAndResetsHeartbeat() public {
        (address[] memory beneficiaries, uint16[] memory shares) = _policy();
        shares[0] = 7_000;
        shares[1] = 3_000;
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(owner);
        vault.updatePolicy(guardian, beneficiaries, shares, 2 hours, 3 hours, true);
        assertEq(vault.policyVersion(), 2);
        assertEq(vault.lastHeartbeat(), block.timestamp);
        assertEq(vault.shareBps(beneficiaryA), 7_000);
    }

    function testKeeperCallsAreBoundToTheExpectedPolicyVersion() public {
        uint256 originalVersion = vault.policyVersion();
        (address[] memory beneficiaries, uint16[] memory shares) = _policy();
        vm.prank(owner);
        vault.updatePolicy(guardian, beneficiaries, shares, 1 hours, 1 hours, true);

        vm.warp(vault.lastHeartbeat() + 1 hours);
        assertFalse(vault.canOpenSettlementForPolicy(originalVersion));
        assertTrue(vault.canOpenSettlementForPolicy(vault.policyVersion()));
        vm.expectRevert(LastWishVault.PolicyVersionMismatch.selector);
        vault.openSettlementForPolicy(originalVersion);
        vault.openSettlementForPolicy(vault.policyVersion());

        vm.warp(vault.pendingAt() + 1 hours);
        assertFalse(vault.canFinalizeSettlementForPolicy(originalVersion));
        vm.expectRevert(LastWishVault.PolicyVersionMismatch.selector);
        vault.finalizeSettlementForPolicy(originalVersion);
        vault.finalizeSettlementForPolicy(vault.policyVersion());
        assertTrue(vault.settled());
    }

    function testFactoryTracksVaultsByOwner() public {
        LastWishVaultFactory factory = new LastWishVaultFactory();
        (address[] memory beneficiaries, uint16[] memory shares) = _policy();
        vm.prank(owner);
        address created = factory.createVault(guardian, beneficiaries, shares, 1 days, 1 days, false);
        assertEq(LastWishVault(payable(created)).owner(), owner);
        assertEq(factory.vaultCount(owner), 1);
        assertEq(factory.vaultAt(owner, 0), created);
        assertEq(factory.vaultOf(owner), created);

        vm.prank(owner);
        vm.expectRevert(LastWishVaultFactory.VaultAlreadyExists.selector);
        factory.createVault(guardian, beneficiaries, shares, 1 days, 1 days, false);
    }

    function _policy() internal view returns (address[] memory beneficiaries, uint16[] memory shares) {
        beneficiaries = new address[](2);
        beneficiaries[0] = beneficiaryA;
        beneficiaries[1] = beneficiaryB;
        shares = new uint16[](2);
        shares[0] = 6_000;
        shares[1] = 4_000;
    }
}
