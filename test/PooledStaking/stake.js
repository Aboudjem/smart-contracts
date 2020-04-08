const { expectRevert, ether } = require('@openzeppelin/test-helpers');
const { assert } = require('chai');

const accounts = require('../utils/accounts');
const setup = require('../utils/setup');
const { ParamType } = require('../utils/constants');

const {
  nonMembers: [nonMember],
  members: [memberOne, memberTwo],
  // advisoryBoardMembers: [advisoryBoardMember],
  // internalContracts: [internalContract],
  governanceContracts: [governanceContract],
} = accounts;

const firstContract = '0x0000000000000000000000000000000000000001';
const secondContract = '0x0000000000000000000000000000000000000002';
const thirdContract = '0x0000000000000000000000000000000000000003';

async function fundAndApprove (token, staking, amount, member) {
  const maxLeverage = '2';
  await staking.updateParameter(ParamType.MAX_LEVERAGE, maxLeverage, { from: governanceContract });

  await token.transfer(member, amount); // fund member account from default address
  await token.approve(staking.address, amount, { from: member });
}

describe('stake', function () {

  beforeEach(setup);

  it('should revert when called by non members', async function () {
    const { master, staking } = this;

    assert.strictEqual(await master.isMember(nonMember), false);

    await expectRevert(
      staking.stake(ether('1'), [firstContract], [1], { from: nonMember }),
      'Caller is not a member',
    );
  });

  it('should revert when allocating to fewer contracts', async function () {

    const { staking, token } = this;
    const amount = ether('1');

    await fundAndApprove(token, staking, amount, memberOne);
    staking.stake(amount, [firstContract, secondContract], [1, 1], { from: memberOne });

    await expectRevert(
      staking.stake(amount, [thirdContract], [1], { from: memberOne }),
      'Allocating to fewer contracts is not allowed',
    );
  });

  it('should revert when contracts and allocations arrays lengths differ', async function () {

    const { staking } = this;

    await expectRevert(
      staking.stake(ether('7'), [firstContract, secondContract], [1], { from: memberOne }),
      'Contracts and allocations arrays should have the same length',
    );
  });

  it('should prevent allocating less than MIN_STAKE', async function () {

    const { staking, token } = this;
    const amount = ether('1');
    const minStake = 20;

    await staking.updateParameter(ParamType.MIN_STAKE, minStake, { from: governanceContract });
    await fundAndApprove(token, staking, amount, memberOne);

    await expectRevert(
      staking.stake(amount, [firstContract], [1], { from: memberOne }),
      'Allocation minimum not met',
    );
  });

  it('should prevent allocating more than staked on a contract', async function () {

    const { staking, token } = this;
    const amount = ether('1');

    await fundAndApprove(token, staking, amount, memberOne);

    await expectRevert(
      staking.stake(amount, [firstContract], [ether('2')], { from: memberOne }),
      'Cannot allocate more than staked',
    );
  });

  it('should revert when contracts order has been changed', async function () {

    const { staking, token } = this;
    const stakeAmount = ether('1');
    const totalAmount = ether('2');

    await fundAndApprove(token, staking, totalAmount, memberOne);
    await staking.stake(stakeAmount, [firstContract, secondContract], [1, 1], { from: memberOne });

    await expectRevert(
      staking.stake(stakeAmount, [secondContract, firstContract], [1, 1], { from: memberOne }),
      'Unexpected contract order',
    );
  });

  it('should revert when new allocation is less than previous one', async function () {

    const { staking, token } = this;
    const stakeAmount = ether('1');
    const totalAmount = ether('2');

    await fundAndApprove(token, staking, totalAmount, memberOne);
    await staking.stake(stakeAmount, [firstContract], [10], { from: memberOne });

    await expectRevert(
      staking.stake(stakeAmount, [firstContract], [9], { from: memberOne }),
      'New allocation is less than previous allocation',
    );
  });

  it('should revert when total allocation exceeds maximum allowed', async function () {

    const { staking, token } = this;
    const amount = ether('1');

    await fundAndApprove(token, staking, amount, memberOne); // MAX_LEVERAGE = 2

    await expectRevert(
      staking.stake(
        amount,
        [firstContract, secondContract, thirdContract],
        [ether('1'), ether('1'), ether('1')],
        { from: memberOne },
      ),
      'Total allocation exceeds maximum allowed',
    );
  });

  it('should revert when staking without allowance', async function () {

    const { staking, token } = this;
    const stakeAmount = ether('1');

    await token.transfer(memberOne, stakeAmount);

    await expectRevert(
      staking.stake(stakeAmount, [firstContract], [1], { from: memberOne }),
      'ERC20: transfer amount exceeds allowance.',
    );
  });

  it('should add the staked amount to the total user stake', async function () {

    const { staking, token } = this;
    const { staked: stakedBefore } = await staking.stakers(memberOne, { from: memberOne });
    const stakeAmount = ether('1');
    const totalAmount = ether('2');

    assert(stakedBefore.eqn(0), 'initial amount should be 0');

    await fundAndApprove(token, staking, totalAmount, memberOne);

    // stake 1 nxm
    await staking.stake(stakeAmount, [firstContract], [1], { from: memberOne });

    // check first stake
    const { staked: firstAmount } = await staking.stakers(memberOne, { from: memberOne });
    assert(firstAmount.eq(stakeAmount), 'amount should be equal to staked amount');

    // stake 1 nxm
    await staking.stake(stakeAmount, [firstContract], [1], { from: memberOne });

    // check final stake
    const { staked: finalAmount } = await staking.stakers(memberOne, { from: memberOne });
    assert(totalAmount.eq(finalAmount), 'final amount should be equal to total staked amount');
  });

  it('should properly move tokens from each member to the PooledStaking contract', async function () {

    const { staking, token } = this;
    let expectedBalance = ether('0');

    // fund accounts
    await fundAndApprove(token, staking, ether('10'), memberOne);
    await fundAndApprove(token, staking, ether('10'), memberTwo);

    const stakes = [
      { amount: ether('1'), contracts: [firstContract], allocations: [1], from: memberOne },
      { amount: ether('2'), contracts: [firstContract, secondContract], allocations: [1, 2], from: memberOne },
      { amount: ether('3'), contracts: [firstContract], allocations: [3], from: memberTwo },
      { amount: ether('4'), contracts: [firstContract, secondContract], allocations: [3, 4], from: memberTwo },
    ];

    for (const stake of stakes) {
      const { amount, contracts, allocations, from } = stake;

      await staking.stake(amount, contracts, allocations, { from });

      expectedBalance = expectedBalance.add(amount);
      const currentBalance = await token.balanceOf(staking.address);

      assert(
        currentBalance.eq(expectedBalance),
        `staking contract balance should be ${expectedBalance.toString()}`,
      );
    }

    const memberOneBalance = await token.balanceOf(memberOne);
    const memberTwoBalance = await token.balanceOf(memberTwo);

    const memberOneExpectedBalance = ether('10').sub(ether('1')).sub(ether('2'));
    const memberTwoExpectedBalance = ether('10').sub(ether('3')).sub(ether('4'));

    assert(memberOneBalance.eq(memberOneExpectedBalance), 'memberOne balance should be decreased accordingly');
    assert(memberTwoBalance.eq(memberTwoExpectedBalance), 'memberTwo balance should be decreased accordingly');
  });

  it('should properly increase staked amounts for each contract', async function () {
    const { staking, token } = this;

    // fund accounts
    await fundAndApprove(token, staking, ether('10'), memberOne);
    await fundAndApprove(token, staking, ether('10'), memberTwo);

    const stakes = [
      { amount: ether('1'), contracts: [firstContract], allocations: [ether('1')], from: memberOne },
      { amount: ether('2'), contracts: [firstContract, secondContract], allocations: [ether('1'), ether('2')], from: memberOne },
      { amount: ether('3'), contracts: [firstContract], allocations: [ether('3')], from: memberTwo },
      { amount: ether('4'), contracts: [firstContract, secondContract], allocations: [ether('3'), ether('4')], from: memberTwo },
    ];

    const allExpectedAmounts = [
      { [firstContract]: ether('1'), [secondContract]: ether('0') },
      { [firstContract]: ether('1'), [secondContract]: ether('2') },
      { [firstContract]: ether('4'), [secondContract]: ether('2') },
      { [firstContract]: ether('4'), [secondContract]: ether('6') },
    ];

    for (let i = 0; i < stakes.length; i++) {
      const { amount, contracts, allocations, from } = stakes[i];
      const expectedAmounts = allExpectedAmounts[i];

      await staking.stake(amount, contracts, allocations, { from });

      for (const contract of Object.keys(expectedAmounts)) {
        // returns the staked value instead of the whole struct
        // because the struct contains only one primitive
        const actualAmount = await staking.contracts(contract);
        const expectedAmount = expectedAmounts[contract];

        assert(
          actualAmount.eq(expectedAmount),
          `staked amount for ${contract} expected to be ${expectedAmount.toString()}, got ${actualAmount.toString()}`,
        );
      }
    }
  });

});
