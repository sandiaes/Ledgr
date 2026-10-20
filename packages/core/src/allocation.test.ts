import { describe, expect, it } from 'vitest';
import { allocation, concentration } from './allocation';
import { MissingValuationError } from './errors';
import { computeHoldings } from './holdings';
import { createFxLookup, createPriceLookup } from './lookups';
import { buy, d } from './test-utils';
import type { Asset } from './types';

const assets: Asset[] = [
  { id: 'A', assetType: 'stock', tradingCurrency: 'EUR' },
  { id: 'US', assetType: 'stock', tradingCurrency: 'USD' },
  { id: 'BTC', assetType: 'crypto', tradingCurrency: 'EUR' },
  { id: 'E', assetType: 'etf', tradingCurrency: 'EUR' },
];
const asOf = '2024-06-30';
const prices = createPriceLookup([
  { assetId: 'A', date: asOf, close: d('10'), currency: 'EUR' },
  { assetId: 'US', date: asOf, close: d('100'), currency: 'USD' },
  { assetId: 'BTC', date: asOf, close: d('50000'), currency: 'EUR' },
  { assetId: 'E', date: asOf, close: d('25'), currency: 'EUR' },
]);
const fx = createFxLookup([{ currency: 'USD', date: asOf, rateToEur: d('0.75') }]);

// Values (total 1000):
//   acc1  A   40 * 10            = 400
//   acc2  A   10 * 10            = 100
//   acc1  US   4 * 100 * 0.75    = 300
//   acc2  BTC 0.003 * 50000      = 150
//   acc2  E    2 * 25            =  50
const holdings = computeHoldings({
  transactions: [
    buy('2024-01-01', 'A', '40', '9', { account: 'acc1' }),
    buy('2024-01-01', 'A', '10', '9', { account: 'acc2' }),
    buy('2024-01-01', 'US', '4', '90', { account: 'acc1', currency: 'USD', fx: '0.8' }),
    buy('2024-01-01', 'BTC', '0.003', '40000', { account: 'acc2' }),
    buy('2024-01-01', 'E', '2', '20', { account: 'acc2' }),
  ],
  assets,
  asOf,
  prices,
  fx,
});

const table = (by: Parameters<typeof allocation>[1]) =>
  allocation(holdings, by).map((s) => [s.key, s.valueEur.toString(), s.weight.toString()]);

describe('allocation', () => {
  it('by asset type', () => {
    expect(table('assetType')).toEqual([
      ['stock', '800', '0.8'],
      ['crypto', '150', '0.15'],
      ['etf', '50', '0.05'],
    ]);
  });

  it('by asset, aggregated across accounts', () => {
    expect(table('asset')).toEqual([
      ['A', '500', '0.5'],
      ['US', '300', '0.3'],
      ['BTC', '150', '0.15'],
      ['E', '50', '0.05'],
    ]);
  });

  it('by account', () => {
    expect(table('account')).toEqual([
      ['acc1', '700', '0.7'],
      ['acc2', '300', '0.3'],
    ]);
  });

  it('by currency (trading currency of the asset)', () => {
    expect(table('currency')).toEqual([
      ['EUR', '700', '0.7'],
      ['USD', '300', '0.3'],
    ]);
  });

  it('no holdings -> empty; zero total -> zero weights; ties sort by key', () => {
    expect(allocation([], 'asset')).toEqual([]);
    const zero = computeHoldings({
      transactions: [buy('2024-01-01', 'E', '1', '1'), buy('2024-01-01', 'A', '1', '1')],
      assets,
      asOf,
      prices: createPriceLookup([
        { assetId: 'A', date: asOf, close: d('0'), currency: 'EUR' },
        { assetId: 'E', date: asOf, close: d('0'), currency: 'EUR' },
      ]),
      fx,
    });
    expect(allocation(zero, 'asset').map((s) => [s.key, s.weight.toString()])).toEqual([
      ['A', '0'],
      ['E', '0'],
    ]);
  });

  it('refuses holdings without a market value', () => {
    const unpriced = computeHoldings({
      transactions: [buy('2024-01-01', 'A', '1', '1')],
      assets,
      asOf,
      prices: createPriceLookup([]),
      fx,
    });
    expect(() => allocation(unpriced, 'asset')).toThrow(MissingValuationError);
  });
});

describe('concentration', () => {
  it('top N assets and their combined weight', () => {
    const c = concentration(holdings, 2);
    expect(c.top.map((s) => s.key)).toEqual(['A', 'US']);
    expect(c.topWeight.toString()).toBe('0.8');
  });

  it('N larger than the number of assets covers everything', () => {
    expect(concentration(holdings, 10).topWeight.toString()).toBe('1');
  });

  it('rejects a non-positive or fractional N', () => {
    expect(() => concentration(holdings, 0)).toThrow(RangeError);
    expect(() => concentration(holdings, 1.5)).toThrow(RangeError);
  });
});
