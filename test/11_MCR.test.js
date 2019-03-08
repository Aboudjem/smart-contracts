const MCR = artifacts.require('MCR');
const Pool1 = artifacts.require('Pool1Mock');
const PoolData = artifacts.require('PoolData');
const DAI = artifacts.require('MockDAI');
const NXMToken = artifacts.require('NXMToken');
const MemberRoles = artifacts.require('MemberRoles');
const NXMaster = artifacts.require('NXMaster');

const { assertRevert } = require('./utils/assertRevert');
const { advanceBlock } = require('./utils/advanceToBlock');
const { ether } = require('./utils/ether');
const { increaseTimeTo, duration } = require('./utils/increaseTime');
const { latestTime } = require('./utils/latestTime');

const CA_ETH = '0x45544800';
const CA_DAI = '0x44414900';

let mcr;
let pd;
let tk;
let p1;
let mr;
let nxms;
let balance_DAI;
let balance_ETH;

const BigNumber = web3.BigNumber;
require('chai')
  .use(require('chai-bignumber')(BigNumber))
  .should();

contract('MCR', function([owner, notOwner]) {
  before(async function() {
    await advanceBlock();
    mcr = await MCR.deployed();
    tk = await NXMToken.deployed();
    p1 = await Pool1.deployed();
    pd = await PoolData.deployed();
    cad = await DAI.deployed();
    nxms = await NXMaster.deployed();
    mr = await MemberRoles.at(await nxms.getLatestAddress('0x4d52'));
  });

  describe('Initial MCR cap test cases', function() {
    it('11.1 post mcr before launch should not affect initialMCRCap', async function() {
      let cap = await pd.capReached();
      await mcr.addMCRData(
        18000,
        100 * 1e18,
        2 * 1e18,
        ['0x455448', '0x444149'],
        [100, 65407],
        20181011
      );
      (await pd.capReached()).should.be.bignumber.equal(cap);
    });
    describe('After launch', function() {
      before(async function() {
        await mr.addMembersBeforeLaunch([], []);
        (await mr.launched()).should.be.equal(true);
      });

      it('11.2 After launch cap should not be set until it reached 100 for 1st time', async function() {
        await mcr.addMCRData(
          1800,
          100 * 1e18,
          2 * 1e18,
          ['0x455448', '0x444149'],
          [100, 65407],
          20181011
        );
        (await pd.capReached()).should.be.bignumber.equal(0);
      });

      it('11.3 After launch cap should be set to 2 if not reached 100% for 1st time till 30 days', async function() {
        let time = await latestTime();
        time = time + (await duration.days(30));
        await increaseTimeTo(time);
        await mcr.addMCRData(
          1800,
          100 * 1e18,
          2 * 1e18,
          ['0x455448', '0x444149'],
          [100, 65407],
          20181011
        );
        (await pd.capReached()).should.be.bignumber.equal(2);
      });

      it('11.4 After launch cap should not be set to 2 if reached 100% for 1st time on 30th day', async function() {
        await mcr.addMCRData(
          18000,
          100 * 1e18,
          2 * 1e18,
          ['0x455448', '0x444149'],
          [100, 65407],
          20181011
        );
        (await pd.capReached()).should.be.bignumber.equal(1);
      });
    });
  });

  describe('Calculation of V(tp) and MCR(tp)', function() {
    let cal_vtp;
    let cal_mcrtp;

    before(async function() {
      await mcr.addMCRData(
        18000,
        100 * 1e18,
        2 * 1e18,
        ['0x455448', '0x444149'],
        [100, 15517],
        20190103
      );
      await cad.transfer(p1.address, ether(600));
      balance_DAI = await cad.balanceOf(p1.address);
      balance_ETH = await web3.eth.getBalance(p1.address);
      balance_ETH = balance_ETH.plus(await p1.getInvestmentAssetBalance());
    });

    it('11.5 should return correct V(tp) price', async function() {
      const price_dai = await pd.getCAAvgRate(CA_DAI);
      cal_vtp = balance_DAI.mul(100).div(price_dai);
      cal_vtp = cal_vtp.plus(balance_ETH);
      cal_vtp
        .toFixed(0)
        .should.be.bignumber.equal((await mcr.calVtpAndMCRtp())[0]);
    });

    it('11.6 should return correct MCR(tp) price', async function() {
      const lastMCR = await pd.getLastMCR();
      cal_mcrtp = cal_vtp.mul(lastMCR[0]).div(lastMCR[2]);
      cal_mcrtp
        .toFixed(0)
        .should.be.bignumber.equal((await mcr.calVtpAndMCRtp())[1]);
    });
  });

  describe('Token Price Calculation', function() {
    let tp_eth;
    let tp_dai;

    before(async function() {
      const tpd = await pd.getTokenPriceDetails(CA_ETH);
      const tc = (await tk.totalSupply()).div(1e18);
      const sf = tpd[0].div(1e5);
      const C = tpd[1];
      const Curr3DaysAvg = tpd[2];
      const mcrtp = (await mcr.calVtpAndMCRtp())[1];
      const mcrtpSquare = mcrtp.times(mcrtp).div(1e8);
      const mcrEth = (await pd.getLastMCREther()).div(1e18);
      const tp = sf.plus(
        mcrEth
          .div(C)
          .times(mcrtpSquare)
          .times(mcrtpSquare)
      );
      tp_eth = tp.times(Curr3DaysAvg.div(100));
      tp_dai = tp.times((await pd.getCAAvgRate(CA_DAI)).div(100));
    });
    it('11.7 should return correct Token price in ETH', async function() {
      tp_eth
        .toFixed(4)
        .should.be.bignumber.equal(
          (await mcr.calculateTokenPrice(CA_ETH)).div(1e18).toFixed(4)
        );
    });
    it('11.8 should return correct Token price in DAI', async function() {
      tp_dai
        .toFixed(4)
        .should.be.bignumber.equal(
          (await mcr.calculateTokenPrice(CA_DAI)).div(1e18).toFixed(4)
        );
    });
  });
  describe('if owner/internal contract address', function() {
    describe('Change MCRTime', function() {
      it('11.9 should be able to change MCRTime', async function() {
        await mcr.changeMCRTime(1, { from: owner });
        (await pd.mcrTime()).should.be.bignumber.equal(1);
      });
    });
    describe('Change Scaling Factor', function() {
      it('11.10 should be able to change Scaling Factor', async function() {
        await mcr.changeA(1, { from: owner });
      });
    });
    describe('Add new MCR Data', function() {
      it('11.11 should be able to add MCR data', async function() {
        await mcr.addMCRData(
          18000,
          100 * 1e18,
          2 * 1e18,
          ['0x455448', '0x444149'],
          [100, 65407],
          20181011,
          { from: owner }
        );
      });
    });

    describe('Adds MCR Data for last failed attempt', function() {
      it('11.12 should be able to add MCR data', async function() {
        await mcr.addLastMCRData(20181009, { from: owner });
        await mcr.addLastMCRData(20181011, { from: owner });
        await mcr.addLastMCRData(20181012, { from: owner });
      });
    });
  });

  describe('Misc', function() {
    it('11.13 should be able to change MCRTime', async function() {
      await assertRevert(mcr.changeMCRTime(1, { from: notOwner }));
    });
    it('11.14 should be able to get all Sum Assurance', async function() {
      // await mcr.getAllSumAssurance();
      await pd.updateCAAvgRate('0x44414900', 0, { from: owner });
      // await mcr.getAllSumAssurance();
    });
    it('11.15 should not be able to change master address', async function() {
      await assertRevert(
        mcr.changeMasterAddress(mcr.address, { from: notOwner })
      );
    });
    it('11.16 should not be able to add currency', async function() {
      await assertRevert(mcr.addCurrency('0x4c4f4c', { from: notOwner }));
    });
  });
});
