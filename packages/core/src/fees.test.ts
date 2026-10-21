import { describe, expect, it } from 'vitest';
import { feeDragShare, feeSummary, xirrFeeDrag } from './fees';
import {
  buy,
  d,
  deposit,
  dividend,
  expectClose,
  expectDec,
  fee,
  redeem,
  sell,
  subscribe,
  withdraw,
} from './test-utils';

describe('feeSummary', () => {
  it('totals fees by category in EUR at trade-time fx', () => {
    // trading: 1 + 2 USD*0.5 + 3 + 0.5 = 5.5; income: 0.7; cash: 1 + 2 = 3; standalone: 4 + 0.1
    // total 5.5 + 0.7 + 3 + 4.1 = 13.3
    const s = feeSummary([
      buy('2024-01-01', 'A', '1', '10', { fees: '1' }),
      buy('2024-01-01', 'U', '1', '10', { fees: '2', currency: 'USD', fx: '0.5' }),
      sell('2024-01-02', 'A', '1', '10', { fees: '3' }),
      subscribe('2024-01-01', 'CA', '100', '1'),
      redeem('2024-02-01', 'CA', '100', '1', { fees: '0.5' }),
      dividend('2024-01-03', '10', { fees: '0.7' }),
      deposit('2024-01-01', '100', { fees: '1' }),
      withdraw('2024-01-04', '10', { fees: '2' }),
      fee('2024-01-05', '4', { fees: '0.1' }),
    ]);
    expectDec(s.tradingEur, '5.5');
    expectDec(s.incomeEur, '0.7');
    expectDec(s.cashEur, '3');
    expectDec(s.standaloneEur, '4.1');
    expectDec(s.totalEur, '13.3');
  });

  it('withholding tax is not a fee', () => {
    const s = feeSummary([dividend('2024-01-01', '10', { withholding: '2.8', fees: '0.5' })]);
    expectDec(s.incomeEur, '0.5');
    expectDec(s.totalEur, '0.5');
  });

  it('respects asOf', () => {
    const txs = [fee('2024-01-01', '1'), fee('2024-02-01', '1')];
    expectDec(feeSummary(txs, '2024-01-31').totalEur, '1');
  });
});

describe('feeDragShare', () => {
  it('fees / (net return + fees)', () => {
    // net 80, fees 20 -> 20 / 100
    expectDec(feeDragShare(d('20'), d('80')), '0.2');
    // no positive fee-free return -> null
    expect(feeDragShare(d('20'), d('-20'))).toBeNull();
    expect(feeDragShare(d('20'), d('-50'))).toBeNull();
  });
});

describe('xirrFeeDrag', () => {
  it('difference between fee-free and actual money-weighted return', () => {
    // buy 10 @ 100 + fee 10 on 2023-01-01; worth 1100 on 2024-01-01 (365 days)
    // with fees:    -1010 -> 1100  => 1100/1010 - 1
    // without fees: -1000 -> 1100  => 10%
    const r = xirrFeeDrag([buy('2023-01-01', 'A', '10', '100', { fees: '10' })], {
      asOf: '2024-01-01',
      terminalValueEur: d('1100'),
    });
    const withFees = d('1100').div('1010').minus(1);
    expectClose(r.withoutFees.ok ? r.withoutFees.rate : null, '0.1', '1e-12');
    expectClose(r.withFees.ok ? r.withFees.rate : null, withFees, '1e-12');
    expectClose(r.drag, d('0.1').minus(withFees), '1e-12');
  });

  it('null drag when no rate exists', () => {
    const r = xirrFeeDrag([], { asOf: '2024-01-01', terminalValueEur: d('0') });
    expect(r.drag).toBeNull();
  });
});
