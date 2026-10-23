import { describe, expect, it } from 'vitest';
import { accountSummaries } from './accounts';
import { MissingValuationError } from './errors';
import { gainsSummary } from './gains';
import { computeHoldings } from './holdings';
import { createFxLookup, createPriceLookup } from './lookups';
import { buy, d, dividend, expectDec, fee, sell } from './test-utils';
import type { Asset } from './types';

const assets: Asset[] = [
  { id: 'A', assetType: 'etf', tradingCurrency: 'EUR' },
  { id: 'B', assetType: 'stock', tradingCurrency: 'EUR' },
];

// degiro: buy A 10 @ 100 = 1000; sell 4 @ 130 = 520 -> its own lot, cost 400, realized 120;
//         fee row 3
// ibkr:   buy A 5 @ 120 = 600; buy B 2 @ 50 = 100; dividend on A 10
// prices: A 110, B 60
//   degiro: A 6 units, cost 600, value 660, U +60;  R 120, I 0,  C 3 -> gain 177
//   ibkr:   A 5 units, cost 600, value 550, U -50;
//           B 2 units, cost 100, value 120, U +20;  R 0,   I 10, C 0 -> gain -20
//   total:  value 1330, R 120, U 30, I 10, C 3 -> gain 157 = 177 - 20
const transactions = [
  buy('2024-01-02', 'A', '10', '100', { account: 'degiro' }),
  buy('2024-02-01', 'A', '5', '120', { account: 'ibkr' }),
  buy('2024-02-01', 'B', '2', '50', { account: 'ibkr' }),
  sell('2024-03-01', 'A', '4', '130', { account: 'degiro' }),
  dividend('2024-04-01', '10', { asset: 'A', account: 'ibkr' }),
  fee('2024-05-01', '3', { account: 'degiro' }),
];
const asOf = '2024-06-30';
const prices = createPriceLookup([
  { assetId: 'A', date: asOf, close: d('110'), currency: 'EUR' },
  { assetId: 'B', date: asOf, close: d('60'), currency: 'EUR' },
]);
const fx = createFxLookup([]);
const holdings = computeHoldings({ transactions, assets, asOf, prices, fx });

describe('accountSummaries', () => {
  const rows = accountSummaries({ transactions, holdings, asOf });

  it('per broker: value, weight, cost, unrealized, realized, income, costs, gain', () => {
    expect(
      rows.map((r) => [
        r.accountId,
        r.valueEur.toString(),
        r.costBasisEur.toString(),
        r.unrealizedEur.toString(),
        r.realizedEur.toString(),
        r.incomeNetEur.toString(),
        r.otherCostsEur.toString(),
        r.totalGainEur.toString(),
      ]),
    ).toEqual([
      ['ibkr', '670', '700', '-30', '0', '10', '0', '-20'],
      ['degiro', '660', '600', '60', '120', '0', '3', '177'],
    ]);
    expectDec(rows[0]!.weight, d('670').div('1330'));
    expectDec(rows[1]!.weight, d('660').div('1330'));
  });

  it('total portfolio gain equals the sum over accounts', () => {
    const g = gainsSummary({ transactions, holdings, asOf });
    expectDec(g.totalReturnEur, '157');
    const pairs = [
      ['totalGainEur', 'totalReturnEur'],
      ['realizedEur', 'realizedEur'],
      ['unrealizedEur', 'unrealizedEur'],
      ['incomeNetEur', 'incomeNetEur'],
      ['otherCostsEur', 'otherCostsEur'],
    ] as const;
    for (const [account, portfolio] of pairs) {
      expectDec(
        rows.reduce((s, r) => s.plus(r[account]), d('0')),
        g[portfolio],
      );
    }
    expectDec(
      rows.reduce((s, r) => s.plus(r.weight!), d('0')),
      '1',
    );
  });

  it('an account with only realized gains is listed with zero value', () => {
    const txs = [
      buy('2024-01-01', 'B', '1', '50', { account: 'kraken' }),
      sell('2024-02-01', 'B', '1', '55', { account: 'kraken' }),
    ];
    const h = computeHoldings({ transactions: txs, assets, asOf, prices, fx });
    const [k, ...rest] = accountSummaries({ transactions: txs, holdings: h, asOf });
    expect(rest).toEqual([]);
    expect([k!.accountId, k!.valueEur.toString(), k!.realizedEur.toString(), k!.weight]).toEqual([
      'kraken',
      '0',
      '5',
      null,
    ]);
  });

  it('refuses unvalued holdings', () => {
    const h = computeHoldings({ transactions, assets, asOf, prices: createPriceLookup([]), fx });
    expect(() => accountSummaries({ transactions, holdings: h, asOf })).toThrow(
      MissingValuationError,
    );
  });
});
