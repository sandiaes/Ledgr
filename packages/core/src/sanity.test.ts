import { describe, expect, it } from 'vitest';
import { netInvestedEur } from './gains';
import { computeHoldings } from './holdings';
import { createFxLookup, createPriceLookup } from './lookups';
import { sanityReport } from './sanity';
import {
  buy,
  d,
  deposit,
  dividend,
  expectDec,
  fee,
  redeem,
  sell,
  subscribe,
  transfer,
} from './test-utils';
import type { Asset } from './types';

describe('netInvestedEur', () => {
  it('counts buys and subscriptions minus sells and redemptions, nothing else', () => {
    const txs = [
      deposit('2024-01-01', '9999'),
      buy('2024-01-02', 'A', '10', '100', { fees: '2' }), //               +1002
      buy('2024-01-02', 'U', '10', '50', { currency: 'USD', fx: '0.9' }), // +450
      subscribe('2024-01-03', 'CA', '1000', '1', { id: 's1' }), //          +1000
      sell('2024-02-01', 'A', '5', '120', { fees: '1' }), //               -599
      redeem('2024-03-01', 'CA', '100', '1.01'), //                         -101
      dividend('2024-03-02', '7', { asset: 'A' }),
      fee('2024-03-03', '3'),
      transfer('2024-03-04', 'A', '5', 'acc2', { fees: '1' }),
      buy('2024-05-01', 'A', '1', '100'), // after asOf
    ];
    expectDec(netInvestedEur(txs, '2024-04-30'), '1752');
    expectDec(netInvestedEur(txs, '2023-12-31'), '0');
  });
});

describe('sanityReport', () => {
  const assets: Asset[] = [
    { id: 'OK', assetType: 'stock', tradingCurrency: 'USD' },
    { id: 'SPLIT', assetType: 'stock', tradingCurrency: 'USD' },
    { id: 'UP', assetType: 'crypto', tradingCurrency: 'EUR' },
  ];
  const holdings = computeHoldings({
    transactions: [
      buy('2024-01-02', 'OK', '10', '100'),
      buy('2024-01-02', 'SPLIT', '1', '2000'), // units never restated after a 20:1 split
      buy('2024-01-02', 'UP', '1', '100'),
    ],
    assets,
    asOf: '2024-06-28',
    prices: createPriceLookup([
      { assetId: 'OK', date: '2024-06-28', close: d('125'), currency: 'USD' },
      { assetId: 'SPLIT', date: '2024-06-28', close: d('110'), currency: 'USD' },
      { assetId: 'UP', date: '2024-06-28', close: d('501'), currency: 'EUR' },
    ]),
    fx: createFxLookup([{ currency: 'USD', date: '2024-06-28', rateToEur: d('0.8') }]),
  });

  it('flags value/cost ratios above 5x or below 0.2x', () => {
    const r = sanityReport(holdings);
    const byId = new Map(r.rows.map((row) => [row.assetId, row]));
    expectDec(byId.get('OK')?.ratio, '1'); // 10 * 125 * 0.8 / 1000
    expect(byId.get('OK')?.outlier).toBeNull();
    expectDec(byId.get('SPLIT')?.ratio, '0.044');
    expect(byId.get('SPLIT')?.outlier).toBe('low');
    expectDec(byId.get('UP')?.ratio, '5.01');
    expect(byId.get('UP')?.outlier).toBe('high');
    expect(byId.get('OK')?.price?.currency).toBe('USD');
    expect(r.outliers).toBe(2);
    expect(r.unvalued).toBe(0);
    expectDec(r.totalValueEur, '1589'); // 1000 + 88 + 501
    expectDec(r.totalCostBasisEur, '3100');
  });

  it('takes custom limits', () => {
    expect(sanityReport(holdings, { high: '6', low: '0.01' }).outliers).toBe(0);
  });
});
