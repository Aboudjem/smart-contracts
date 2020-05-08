const { ether, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { assert } = require('chai');

const accounts = require('../utils/accounts');
const setup = require('../utils/setup');
const { ParamType } = require('../utils/constants');

const {
  members: [memberOne],
  internalContracts: [internalContract],
  nonInternalContracts: [nonInternal],
  governanceContracts: [governanceContract],
} = accounts;

const firstContract = '0x0000000000000000000000000000000000000001';

async function fundAndStake (token, staking, amount, contract, member) {
  await staking.updateParameter(ParamType.MAX_LEVERAGE, ether('2'), { from: governanceContract });

  await token.transfer(member, amount); // fund member account from default address

  await token.approve(staking.address, amount, { from: member });
  await staking.stake(amount, [contract], [amount], { from: member });
}

async function setLockTime (staking, lockTime) {
  return staking.updateParameter(ParamType.DEALLOCATE_LOCK_TIME, lockTime, { from: governanceContract });
}

describe('pushBurn', function () {

  beforeEach(setup);

  it('should revert when called by non internal contract', async function () {

    const { master, staking } = this;

    assert.strictEqual(await master.isInternal(nonInternal), false);

    await expectRevert(
      staking.pushBurn(firstContract, ether('1'), { from: nonInternal }),
      'Caller is not an internal contract',
    );
  });

  it('should revert when called with pending burns', async function () {

    const { token, staking } = this;

    // Set parameters
    await setLockTime(staking, 90 * 24 * 3600); // 90 days

    // Fund account and stake 10
    await fundAndStake(token, staking, ether('10'), firstContract, memberOne);

    // First Burn
    await staking.pushBurn(firstContract, ether('5'), { from: internalContract });
    const { amount: firstAmount, contractAddress: firstAddress } = await staking.burns(1);
    assert(firstAmount.eq(ether('5')), `Expected burned contract to be ${ether('5')}, found ${firstAmount}`);
    assert(firstAddress === firstContract, `Expected burned contract to be ${firstContract}, found ${firstAddress}`);

    await expectRevert(
      staking.pushBurn(firstContract, ether('1'), { from: internalContract }),
      'Unable to execute request with unprocessed burns',
    );
  });

  it('should revert when called with pending deallocations', async function () {

    const { token, staking } = this;

    // Set parameters
    await setLockTime(staking, 90 * 24 * 3600); // 90 days

    // Fund account and stake; DEALLOCATE_LOCK_TIME = 90 days
    await fundAndStake(token, staking, ether('10'), firstContract, memberOne);

    // Request deallocation due in 90 days
    await staking.requestDeallocation([firstContract], [ether('3')], 0, { from: memberOne });

    // No deallocations that were already due, should be able to push burn
    await staking.pushBurn(firstContract, ether('1'), { from: internalContract });

    // 1 hour passes
    await time.increase(3600);
    // Process the burn we pushed earlier
    await staking.processPendingActions();
    // 90 days pass
    await time.increase(90 * 24 * 3600);

    // One deallocation due, can't push a burn
    await expectRevert(
      staking.pushBurn(firstContract, ether('2'), { from: internalContract }),
      'Unable to execute request with unprocessed deallocations',
    );
  });

  it('should revert when burn amount exceeds total amount staked on contract', async function () {

    const { token, staking } = this;

    // Set parameters
    await setLockTime(staking, 90 * 24 * 3600); // 90 days

    // Fund account and stake 10
    await fundAndStake(token, staking, ether('10'), firstContract, memberOne);

    // Burn 15
    await expectRevert(
      staking.pushBurn(firstContract, ether('15'), { from: internalContract }),
      'Burn amount should not exceed total amount staked on contract',
    );
  });


  it('should update the burned amount for the given contract', async function () {

    const { token, staking } = this;

    // Set parameters
    await setLockTime(staking, 90 * 24 * 3600); // 90 days

    // Fund account and stake 10
    await fundAndStake(token, staking, ether('10'), firstContract, memberOne);

    // Burn 3
    const burnAmount = ether('3');
    await staking.pushBurn(firstContract, burnAmount, { from: internalContract });

    // Expect contract.burned to be 3
    const { burned: actualBurned } = await staking.contracts(firstContract);
    assert(actualBurned.eq(burnAmount), `Expected burned amount ${burnAmount}, found ${actualBurned}`);

  });

  it('should burn the correct amount of tokens', async function () {

    const { token, staking } = this;

    // Set parameters
    await setLockTime(staking, 90 * 24 * 3600); // 90 days

    // Fund account and stake 10
    const stakeAmount = ether('10');
    await fundAndStake(token, staking, stakeAmount, firstContract, memberOne);

    // Push a burn of 6
    const burnAmount = ether('6');
    await staking.pushBurn(firstContract, burnAmount, { from: internalContract });

    const expectedBalance = stakeAmount.sub(burnAmount);
    const currentBalance = await token.balanceOf(staking.address);
    assert(
      currentBalance.eq(expectedBalance),
      `staking contract balance should be ${expectedBalance}, found ${currentBalance}`,
    );
  });

  it('should set firstBurn correctly', async function () {

    const { token, staking } = this;

    // Set parameters
    await setLockTime(staking, 90 * 24 * 3600); // 90 days

    // Fund account and stake 10
    await fundAndStake(token, staking, ether('10'), firstContract, memberOne);

    let firstBurn = await staking.firstBurn();
    assert(firstBurn.eqn(0), `Expected firstBurn to be 0, found ${firstBurn}`);

    // Push first burn
    await staking.pushBurn(firstContract, ether('2'), { from: internalContract });
    firstBurn = await staking.firstBurn();
    assert(firstBurn.eqn(1), `Expected firstBurn to be 1, found ${firstBurn}`);

    await staking.processPendingActions();

    // Push second burn
    await staking.pushBurn(firstContract, ether('4'), { from: internalContract });
    firstBurn = await staking.firstBurn();
    assert(firstBurn.eqn(2), `Expected firstBurn to be 2, found ${firstBurn}`);
  });

  it('should set lastBurnId correctly', async function () {

    const { token, staking } = this;

    // Set parameters
    await setLockTime(staking, 90 * 24 * 3600); // 90 days

    // Fund account and stake 10
    await fundAndStake(token, staking, ether('10'), firstContract, memberOne);
    let lastBurnId = await staking.lastBurnId();
    assert(lastBurnId.eqn(0), `Expected lastBurnId to be 0, found ${lastBurnId}`);

    // Push first burn
    await staking.pushBurn(firstContract, ether('5'), { from: internalContract });
    lastBurnId = await staking.lastBurnId();
    assert(lastBurnId.eqn(1), `Expected lastBurnId to be 1, found ${lastBurnId}`);

    await staking.processPendingActions();

    // Push second burn
    await staking.pushBurn(firstContract, ether('1'), { from: internalContract });
    lastBurnId = await staking.lastBurnId();
    assert(lastBurnId.eqn(2), `Expected lastBurnId to be 2, found ${lastBurnId}`);
  });

  it('should update burns mapping correctly', async function () {

    const { token, staking } = this;

    // Set parameters
    await setLockTime(staking, 90 * 24 * 3600); // 90 days

    // Fund account and stake 10
    await fundAndStake(token, staking, ether('10'), firstContract, memberOne);

    // Push first burn
    const firstBurnAmount = ether('2');
    await staking.pushBurn(firstContract, firstBurnAmount, { from: internalContract });

    // Check the Burn has been pushed to the burns mapping
    const { amount, burnedAt, contractAddress } = await staking.burns(1);
    const now = await time.latest();
    assert(
      amount.eq(firstBurnAmount),
      `Expected firstburned amount to be ${firstBurnAmount}, found ${amount}`,
    );
    assert.equal(
      contractAddress,
      firstContract,
      `Expected burned contract to be ${firstContract}, found ${contractAddress}`,
    );
    assert(
      burnedAt.eq(now),
      `Expected burned contract to be ${now}, found ${burnedAt}`,
    );
  });

  it('should emit Burned event', async function () {

    const { token, staking } = this;

    // Set parameters
    await setLockTime(staking, 90 * 24 * 3600); // 90 days

    // Fund account and stake 10
    await fundAndStake(token, staking, ether('10'), firstContract, memberOne);

    // Push burn
    const burnAmount = ether('2');
    const burn = await staking.pushBurn(firstContract, burnAmount, { from: internalContract });

    expectEvent(burn, 'Burned', {
      contractAddress: firstContract,
      amount: burnAmount,
    });
  });
});
