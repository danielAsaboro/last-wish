// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LastWishVault is ReentrancyGuard {
    enum Status {
        ACTIVE,
        PENDING,
        VETOED,
        READY,
        SETTLED
    }

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_BENEFICIARIES = 10;
    uint256 public constant MIN_DEMO_TIMING = 60;
    uint256 public constant MIN_STANDARD_TIMING = 1 days;
    uint256 public constant MAX_POLICY_TIMING = 10 * 365 days;

    address public immutable owner;
    bool public immutable testnetDemo;
    uint256 public immutable deployedAtBlock;
    address public guardian;
    uint256 public heartbeatInterval;
    uint256 public gracePeriod;
    uint256 public lastHeartbeat;
    uint256 public pendingAt;
    uint256 public settledAt;
    uint256 public policyVersion;
    bool public vetoed;
    bool public settled;

    address[] private _beneficiaries;
    mapping(address => uint16) public shareBps;
    mapping(address => uint256) public claimable;

    error OnlyOwner();
    error OnlyGuardian();
    error ZeroAddress();
    error InvalidBeneficiaryCount();
    error InvalidShareTotal();
    error DuplicateBeneficiary();
    error RoleOverlap();
    error UnsafeTiming();
    error ModeImmutable();
    error HeartbeatStillActive();
    error HeartbeatExpired();
    error NotActive();
    error NotPending();
    error GracePeriodActive();
    error SettlementVetoed();
    error AlreadySettled();
    error NothingToClaim();
    error TransferFailed();
    error PolicyVersionMismatch();

    event Deposit(address indexed sender, uint256 amount);
    event Heartbeat(address indexed owner, uint256 indexed policyVersion, uint256 timestamp);
    event PolicyUpdated(uint256 indexed policyVersion, address indexed guardian, address indexed actor);
    event SettlementOpened(uint256 indexed policyVersion, uint256 pendingAt, address indexed caller);
    event SettlementVetoedByGuardian(uint256 indexed policyVersion, address indexed guardian);
    event SettlementFinalized(uint256 indexed policyVersion, uint256 balance, address indexed caller);
    event Withdrawal(address indexed recipient, uint256 amount, address indexed actor);
    event Claimed(address indexed beneficiary, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(
        address owner_,
        address guardian_,
        address[] memory beneficiaries_,
        uint16[] memory shares_,
        uint256 heartbeatInterval_,
        uint256 gracePeriod_,
        bool testnetDemo_
    ) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        testnetDemo = testnetDemo_;
        deployedAtBlock = block.number;
        policyVersion = 1;
        _setPolicy(guardian_, beneficiaries_, shares_, heartbeatInterval_, gracePeriod_);
        lastHeartbeat = block.timestamp;
    }

    receive() external payable {
        if (settled) revert AlreadySettled();
        emit Deposit(msg.sender, msg.value);
    }

    function beneficiaryCount() external view returns (uint256) {
        return _beneficiaries.length;
    }

    function beneficiaryAt(uint256 index) external view returns (address) {
        return _beneficiaries[index];
    }

    function status() public view returns (Status) {
        if (settled) return Status.SETTLED;
        if (vetoed) return Status.VETOED;
        if (pendingAt != 0) {
            if (block.timestamp >= pendingAt + gracePeriod) return Status.READY;
            return Status.PENDING;
        }
        return Status.ACTIVE;
    }

    function canOpenSettlement() external view returns (bool) {
        return !settled && !vetoed && pendingAt == 0 && block.timestamp >= lastHeartbeat + heartbeatInterval;
    }

    function canFinalizeSettlement() external view returns (bool) {
        return !settled && !vetoed && pendingAt != 0 && block.timestamp >= pendingAt + gracePeriod;
    }

    function canOpenSettlementForPolicy(uint256 expectedPolicyVersion) external view returns (bool) {
        return expectedPolicyVersion == policyVersion && !settled && !vetoed && pendingAt == 0
            && block.timestamp >= lastHeartbeat + heartbeatInterval;
    }

    function canFinalizeSettlementForPolicy(uint256 expectedPolicyVersion) external view returns (bool) {
        return expectedPolicyVersion == policyVersion && !settled && !vetoed && pendingAt != 0
            && block.timestamp >= pendingAt + gracePeriod;
    }

    function heartbeat() external onlyOwner {
        if (settled) revert AlreadySettled();
        lastHeartbeat = block.timestamp;
        pendingAt = 0;
        vetoed = false;
        emit Heartbeat(msg.sender, policyVersion, block.timestamp);
    }

    function updatePolicy(
        address guardian_,
        address[] calldata beneficiaries_,
        uint16[] calldata shares_,
        uint256 heartbeatInterval_,
        uint256 gracePeriod_,
        bool testnetDemo_
    ) external onlyOwner {
        if (status() != Status.ACTIVE) revert NotActive();
        if (testnetDemo_ != testnetDemo) revert ModeImmutable();
        _clearPolicy();
        _setPolicy(guardian_, beneficiaries_, shares_, heartbeatInterval_, gracePeriod_);
        unchecked {
            ++policyVersion;
        }
        lastHeartbeat = block.timestamp;
        emit PolicyUpdated(policyVersion, guardian_, msg.sender);
        emit Heartbeat(msg.sender, policyVersion, block.timestamp);
    }

    function withdraw(address payable recipient, uint256 amount) external onlyOwner nonReentrant {
        if (status() != Status.ACTIVE) revert NotActive();
        if (block.timestamp >= lastHeartbeat + heartbeatInterval) revert HeartbeatExpired();
        if (recipient == address(0)) revert ZeroAddress();
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit Withdrawal(recipient, amount, msg.sender);
    }

    function openSettlement() external {
        _openSettlement();
    }

    function openSettlementForPolicy(uint256 expectedPolicyVersion) external {
        if (expectedPolicyVersion != policyVersion) revert PolicyVersionMismatch();
        _openSettlement();
    }

    function _openSettlement() internal {
        if (settled) revert AlreadySettled();
        if (pendingAt != 0 || vetoed) revert NotActive();
        if (block.timestamp < lastHeartbeat + heartbeatInterval) revert HeartbeatStillActive();
        pendingAt = block.timestamp;
        emit SettlementOpened(policyVersion, block.timestamp, msg.sender);
    }

    function vetoSettlement() external {
        if (msg.sender != guardian) revert OnlyGuardian();
        if (status() != Status.PENDING) revert NotPending();
        vetoed = true;
        emit SettlementVetoedByGuardian(policyVersion, msg.sender);
    }

    function finalizeSettlement() external {
        _finalizeSettlement();
    }

    function finalizeSettlementForPolicy(uint256 expectedPolicyVersion) external {
        if (expectedPolicyVersion != policyVersion) revert PolicyVersionMismatch();
        _finalizeSettlement();
    }

    function _finalizeSettlement() internal {
        if (settled) revert AlreadySettled();
        if (vetoed) revert SettlementVetoed();
        if (pendingAt == 0) revert NotPending();
        if (block.timestamp < pendingAt + gracePeriod) revert GracePeriodActive();

        settled = true;
        settledAt = block.timestamp;
        uint256 balance = address(this).balance;
        uint256 allocated;
        uint256 length = _beneficiaries.length;
        for (uint256 i; i < length; ++i) {
            address beneficiary = _beneficiaries[i];
            uint256 amount = i + 1 == length ? balance - allocated : balance * shareBps[beneficiary] / BASIS_POINTS;
            claimable[beneficiary] = amount;
            allocated += amount;
        }
        emit SettlementFinalized(policyVersion, balance, msg.sender);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }

    function _setPolicy(
        address guardian_,
        address[] memory beneficiaries_,
        uint16[] memory shares_,
        uint256 heartbeatInterval_,
        uint256 gracePeriod_
    ) internal {
        if (guardian_ == address(0)) revert ZeroAddress();
        if (guardian_ == owner) revert RoleOverlap();
        uint256 length = beneficiaries_.length;
        if (length == 0 || length > MAX_BENEFICIARIES || length != shares_.length) revert InvalidBeneficiaryCount();
        uint256 minimum = testnetDemo ? MIN_DEMO_TIMING : MIN_STANDARD_TIMING;
        if (
            heartbeatInterval_ < minimum || gracePeriod_ < minimum || heartbeatInterval_ > MAX_POLICY_TIMING
                || gracePeriod_ > MAX_POLICY_TIMING
        ) revert UnsafeTiming();

        uint256 total;
        for (uint256 i; i < length; ++i) {
            address beneficiary = beneficiaries_[i];
            if (beneficiary == address(0)) revert ZeroAddress();
            if (beneficiary == owner || beneficiary == guardian_) revert RoleOverlap();
            if (shareBps[beneficiary] != 0) revert DuplicateBeneficiary();
            uint16 share = shares_[i];
            if (share == 0) revert InvalidShareTotal();
            shareBps[beneficiary] = share;
            _beneficiaries.push(beneficiary);
            total += share;
        }
        if (total != BASIS_POINTS) revert InvalidShareTotal();
        guardian = guardian_;
        heartbeatInterval = heartbeatInterval_;
        gracePeriod = gracePeriod_;
    }

    function _clearPolicy() internal {
        uint256 length = _beneficiaries.length;
        for (uint256 i; i < length; ++i) {
            delete shareBps[_beneficiaries[i]];
        }
        delete _beneficiaries;
    }
}
