import { describe, expect, it } from 'vitest';
import { externalCashFlows, investmentCashFlows } from './cashflows';
import { Decimal } from './decimal';
import {
  buy,
  d,
  deposit,
  dividend,
  expectClose,
  expectDec,
  fee,
  sell,
  withdraw,
} from './test-utils';
import { xirr, type CashFlow, type XirrResult } from './xirr';

const cf = (date: string, amount: string): CashFlow => ({ date, amount: d(amount) });
const rateOf = (r: XirrResult) => {
  if (!r.ok) throw new Error(`expected a rate, got ${r.reason}`);
  return r.rate;
};

describe('xirr', () => {
  it('+10% over exactly 365 days', () => {
    // -1000 on 2023-01-01, +1100 on 2024-01-01 (365 days): 1000 * 1.1^1 = 1100
    expectClose(rateOf(xirr([cf('2023-01-01', '-1000'), cf('2024-01-01', '1100')])), '0.1');
  });

  it('+10% a year over two years', () => {
    // 2021-01-01 -> 2023-01-01 is 730 days = 2 years; 1000 * 1.1^2 = 1210
    expectClose(rateOf(xirr([cf('2021-01-01', '-1000'), cf('2023-01-01', '1210')])), '0.1');
  });

  it('negative return: -10%', () => {
    expectClose(rateOf(xirr([cf('2023-01-01', '-1000'), cf('2024-01-01', '900')])), '-0.1');
  });

  it('matches the Excel XIRR documentation example (0.373362535)', () => {
    const r = xirr([
      cf('2008-01-01', '-10000'),
      cf('2008-03-01', '2750'),
      cf('2008-10-30', '4250'),
      cf('2009-02-15', '3250'),
      cf('2009-04-01', '2750'),
    ]);
    // Excel only promises 0.000001% accuracy; our root's NPV is ~1e-12 vs ~-9e-6 for
    // Excel's printed figure (checked independently in float arithmetic).
    expectClose(rateOf(r), '0.373362535', '1e-8');
    expectClose(rateOf(r), '0.3733625335188315', '1e-15');
    expect(r.ok && r.method).toBe('newton');
  });

  it('the rate it returns zeroes the NPV', () => {
    const flows = [
      cf('2020-01-15', '-5000'),
      cf('2020-07-01', '-2500'),
      cf('2021-03-10', '800'),
      cf('2022-12-31', '8000'),
    ];
    const r = rateOf(xirr(flows));
    const npv = flows.reduce((s, f) => {
      const t = new Decimal(Math.round((Date.parse(f.date) - Date.parse('2020-01-15')) / 864e5));
      return s.plus(f.amount.div(r.plus(1).pow(t.div(365))));
    }, d('0'));
    expectClose(npv, '0', '1e-20');
  });

  it('aggregates same-date flows and ignores order', () => {
    const r = xirr([
      cf('2024-01-01', '600'),
      cf('2023-01-01', '-400'),
      cf('2023-01-01', '-600'),
      cf('2024-01-01', '500'),
    ]);
    expectClose(rateOf(r), '0.1');
  });

  it('no sign change -> failure, not a number', () => {
    const allOut = xirr([cf('2023-01-01', '-1000'), cf('2024-01-01', '-5')]);
    expect(allOut).toMatchObject({ ok: false, reason: 'no-sign-change' });
    const allIn = xirr([cf('2023-01-01', '1000'), cf('2024-01-01', '5')]);
    expect(allIn).toMatchObject({ ok: false, reason: 'no-sign-change' });
    // Total loss: invested, ended at zero -> only outflows remain
    const wipedOut = xirr([cf('2023-01-01', '-1000'), cf('2024-01-01', '0')]);
    expect(wipedOut).toMatchObject({ ok: false, reason: 'no-sign-change' });
  });

  it('too short a period -> failure', () => {
    // Same-day flows net to a single flow: nothing to annualise.
    expect(xirr([cf('2024-01-01', '-1000'), cf('2024-01-01', '1001')])).toMatchObject({
      ok: false,
    });
    expect(
      xirr([cf('2024-01-01', '-1000'), cf('2024-01-02', '1001')], { minDays: 2 }),
    ).toMatchObject({ ok: false, reason: 'period-too-short' });
    expect(
      xirr([cf('2024-01-01', '-1000'), cf('2024-01-20', '1001')], { minDays: 30 }),
    ).toMatchObject({ ok: false, reason: 'period-too-short' });
  });

  it('no flows -> failure', () => {
    expect(xirr([])).toMatchObject({ ok: false, reason: 'no-flows' });
    expect(xirr([cf('2024-01-01', '0')])).toMatchObject({ ok: false, reason: 'no-flows' });
  });

  it('falls back to bisection when Newton leaves the domain', () => {
    // From guess 5: f(5) = -1000 + 1100/6 < 0, f'(5) = -1100/36, step -> 5 - 26.7 < -1
    const r = xirr([cf('2023-01-01', '-1000'), cf('2024-01-01', '1100')], { guess: d('5') });
    expect(r.ok && r.method).toBe('bisection');
    expectClose(rateOf(r), '0.1', '1e-13');
  });

  it('survives a guess outside the domain or beyond the search grid', () => {
    const flows = [cf('2023-01-01', '-1000'), cf('2024-01-01', '1100')];
    for (const guess of ['-1', '-5', '1e9']) {
      const r = xirr(flows, { guess: d(guess) });
      expect(r.ok && r.method).toBe('bisection');
      expectClose(rateOf(r), '0.1', '1e-13');
    }
  });

  it('near-total loss: -99.8% (Newton overshoots, bisection finds it)', () => {
    // -1000 -> +2 after one year: r = 2/1000 - 1 = -0.998
    const r = xirr([cf('2023-01-01', '-1000'), cf('2024-01-01', '2')]);
    expectClose(rateOf(r), '-0.998', '1e-13');
    expect(r.ok && r.method).toBe('bisection');
  });

  it('falls back when Newton is capped and still converges', () => {
    const r = xirr([cf('2023-01-01', '-1000'), cf('2024-01-01', '1100')], {
      guess: d('0.5'),
      maxNewtonIterations: 1,
    });
    expect(r.ok && r.method).toBe('bisection');
    expectClose(rateOf(r), '0.1', '1e-13');
  });

  it('very large return', () => {
    // 100x in one year -> 9900%
    expectClose(rateOf(xirr([cf('2023-01-01', '-1'), cf('2024-01-01', '100')])), '99', '1e-12');
  });

  it('reports no-root-found when the rate is beyond the search grid', () => {
    // 1e12x in one day -> astronomically large annual rate
    const r = xirr([cf('2024-01-01', '-1'), cf('2024-01-02', '1e12')], { guess: d('-0.5') });
    expect(r).toMatchObject({ ok: false, reason: 'no-root-found' });
  });

  it('zero return; exact zero NPV at a grid point is returned as is', () => {
    // -1000 -> +1000: r = 0, where (1+r)^t = 1 exactly. Newton skipped so the grid is used.
    const flows = [cf('2023-01-01', '-1000'), cf('2024-06-01', '1000')];
    expectClose(rateOf(xirr(flows)), '0', '1e-14');
    const r = xirr(flows, { maxNewtonIterations: 0 });
    expect(r).toMatchObject({ ok: true, method: 'bisection', iterations: 0 });
    expectDec(rateOf(r), '0');
  });
});

describe('cash flow builders', () => {
  const txs = [
    deposit('2023-01-01', '2000'),
    buy('2023-01-01', 'A', '10', '100', { fees: '1' }),
    dividend('2023-06-01', '20', { asset: 'A', fees: '2' }),
    sell('2023-09-01', 'A', '5', '110', { fees: '1' }),
    fee('2023-10-01', '3', { asset: 'A' }),
    withdraw('2023-12-01', '100'),
    buy('2023-05-01', 'B', '1', '50'),
  ];

  it('investmentCashFlows: trades, income and fee rows; terminal value last', () => {
    const flows = investmentCashFlows(txs, { asOf: '2024-01-01', terminalValueEur: d('600') });
    expect(flows.map((f) => [f.date, f.amount.toString()])).toEqual([
      ['2023-01-01', '-1001'],
      ['2023-05-01', '-50'],
      ['2023-06-01', '18'],
      ['2023-09-01', '549'],
      ['2023-10-01', '-3'],
      ['2024-01-01', '600'],
    ]);
  });

  it('investmentCashFlows: per asset and without fees', () => {
    const flows = investmentCashFlows(txs, {
      asOf: '2024-01-01',
      terminalValueEur: d('600'),
      assetId: 'A',
      excludeFees: true,
    });
    expect(flows.map((f) => f.amount.toString())).toEqual(['-1000', '20', '550', '600']);
  });

  it('externalCashFlows: deposits out, withdrawals in, total value last', () => {
    const flows = externalCashFlows(txs, { asOf: '2024-01-01', terminalValueEur: d('2100') });
    expect(flows.map((f) => [f.date, f.amount.toString()])).toEqual([
      ['2023-01-01', '-2000'],
      ['2023-12-01', '100'],
      ['2024-01-01', '2100'],
    ]);
  });
});
