import { describe, expect, it } from 'vitest';
import { incomeByYear, incomeTotals } from './income';
import { buy, d, dividend, expectDec, interest, redeem, sell, subscribe } from './test-utils';

// 2023: buy 10 A @ 100 on 01-01 (cost 1000 all year); dividends 20 + 10 (fee 3 on one)
// 2024 (leap, 366 days): dividend 20 on 06-28; sell 5 on 07-01 (cost 1000 -> 500);
//                        cash interest 5 on 12-31; USD dividend 10 @ fx 0.9 = 9 on 12-01
// 2025: nothing to asOf 03-31
const transactions = [
  buy('2023-01-01', 'A', '10', '100'),
  dividend('2023-06-30', '20', { asset: 'A', fees: '3' }),
  dividend('2023-12-29', '10', { asset: 'A' }),
  dividend('2024-06-28', '20', { asset: 'A' }),
  sell('2024-07-01', 'A', '5', '110'),
  dividend('2024-12-01', '10', { asset: 'A', currency: 'USD', fx: '0.9' }),
  interest('2024-12-31', '5'),
];

describe('incomeTotals', () => {
  it('splits dividends and interest, gross and net of fees', () => {
    // dividends 20 + 10 + 20 + 9 = 59, interest 5, gross 64, fees 3, net 61
    const t = incomeTotals(transactions);
    expectDec(t.dividendsEur, '59');
    expectDec(t.interestEur, '5');
    expectDec(t.grossEur, '64');
    expectDec(t.feesEur, '3');
    expectDec(t.netEur, '61');
  });

  it('filters by asset and date', () => {
    expectDec(incomeTotals(transactions, { assetId: 'A' }).grossEur, '59');
    expectDec(incomeTotals(transactions, { asOf: '2023-12-31' }).grossEur, '30');
  });

  it('withholding tax: gross stays gross, net is what was received', () => {
    // 100 USD dividend at fx 0.9, 15 USD withheld, 1 USD fee:
    // gross 90, withheld 13.5, fees 0.9, net 90 - 13.5 - 0.9 = 75.6
    const t = incomeTotals([
      dividend('2024-01-01', '100', { currency: 'USD', fx: '0.9', withholding: '15', fees: '1' }),
    ]);
    expectDec(t.grossEur, '90');
    expectDec(t.withholdingTaxEur, '13.5');
    expectDec(t.feesEur, '0.9');
    expectDec(t.netEur, '75.6');
    expectDec(incomeTotals(transactions).withholdingTaxEur, '0');
  });

  it('dividends only', () => {
    const t = incomeTotals([dividend('2024-01-01', '7')]);
    expectDec(t.dividendsEur, '7');
    expectDec(t.interestEur, '0');
  });
});

describe('incomeByYear', () => {
  const years = incomeByYear(transactions, { asOf: '2025-03-31' });

  it('one row per calendar year to asOf', () => {
    expect(years.map((y) => y.year)).toEqual([2023, 2024, 2025]);
  });

  it('2023: cost 1000 all year -> yield on cost 30 / 1000 = 3%', () => {
    const y = years[0]!;
    expectDec(y.grossEur, '30');
    expectDec(y.netEur, '27');
    expectDec(y.averageCostBasisEur, '1000');
    expectDec(y.yieldOnCost, '0.03');
  });

  it('2024: time-weighted average cost basis across the sale', () => {
    // Jan 1 - Jun 30: 182 days at 1000 = 182000
    // Jul 1 - Dec 31: 184 days at  500 =  92000   (sale on 07-01, cost counted end of day)
    // average = 274000 / 366
    // gross = 20 + 9 + 5 = 34 -> yield = 34 / (274000/366)
    const y = years[1]!;
    const avg = d('274000').div(366);
    expectDec(y.dividendsEur, '29');
    expectDec(y.interestEur, '5');
    expectDec(y.averageCostBasisEur, avg);
    expectDec(y.yieldOnCost, d('34').div(avg));
  });

  it('current year runs to asOf', () => {
    // 2025-01-01 .. 03-31: 90 days at 500
    const y = years[2]!;
    expectDec(y.averageCostBasisEur, '500');
    expectDec(y.grossEur, '0');
    expectDec(y.yieldOnCost, '0');
  });

  it('per asset excludes cash interest', () => {
    const y = incomeByYear(transactions, { asOf: '2024-12-31', assetId: 'A' })[1]!;
    expectDec(y.grossEur, '29');
  });

  it('buying mid-year averages over the whole year', () => {
    // 2023 has 365 days; buy 1000 on 07-02 -> held 07-02..12-31 = 183 days
    // average = 1000 * 183 / 365; dividend 10 -> yield = 10 / that
    const [y] = incomeByYear(
      [buy('2023-07-02', 'A', '1', '1000'), dividend('2023-12-01', '10', { asset: 'A' })],
      { asOf: '2023-12-31' },
    );
    const avg = d('183000').div(365);
    expectDec(y!.averageCostBasisEur, avg);
    expectDec(y!.yieldOnCost, d('10').div(avg));
  });

  it('yield on cost uses gross income, before withholding', () => {
    // cost 1000 all of 2023; dividend 30 with 8.4 withheld -> yield 30 / 1000
    const [y] = incomeByYear(
      [buy('2023-01-01', 'A', '1', '1000'), dividend('2023-06-01', '30', { withholding: '8.4' })],
      { asOf: '2023-12-31' },
    );
    expectDec(y!.yieldOnCost, '0.03');
    expectDec(y!.netEur, '21.6');
  });

  it('dividends only: no cost basis -> yield null', () => {
    const [y] = incomeByYear([dividend('2024-03-01', '10')], { asOf: '2024-12-31' });
    expectDec(y!.grossEur, '10');
    expectDec(y!.averageCostBasisEur, '0');
    expect(y!.yieldOnCost).toBeNull();
  });

  it('handles redemptions linked to a CA subscription', () => {
    // 1000 units held 2023-01-01..06-30 (181 days), 400 redeemed on 07-01 -> 600 for 184 days
    // average = (1000*181 + 600*184) / 365; interest 0 -> yield 0
    const [y] = incomeByYear(
      [
        subscribe('2023-01-01', 'CA', '1000', '1', { id: 's1' }),
        redeem('2023-07-01', 'CA', '400', '1.01', { caSubscriptionId: 'ca1' }),
      ],
      { asOf: '2023-12-31', caSubscriptions: [{ id: 'ca1', transactionId: 's1' }] },
    );
    expectDec(y!.averageCostBasisEur, d('291400').div(365));
  });

  it('empty ledger -> no rows', () => {
    expect(incomeByYear([], { asOf: '2024-12-31' })).toEqual([]);
  });
});
