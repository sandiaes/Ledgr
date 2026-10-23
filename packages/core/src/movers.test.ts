import { describe, expect, it } from 'vitest';
import { dayChange } from './daychange';
import { computeHoldings } from './holdings';
import { createFxLookup, createPriceLookup, type PriceRow } from './lookups';
import { topMovers, topPositions, type Mover } from './movers';
import { buy, d, expectDec } from './test-utils';
import type { Asset } from './types';

const ids = ['BIG', 'SMALL', 'LOSS', 'TINY', 'FLAT', 'NEW'];
const assets: Asset[] = ids.map((id) => ({ id, assetType: 'stock', tradingCurrency: 'EUR' }));
const T = '2024-06-10';
const Y = '2024-06-09';
const close = (assetId: string, date: string, value: string): PriceRow => ({
  assetId,
  date,
  close: d(value),
  currency: 'EUR',
});

//          units  cost   yesterday  today   day €   day %       unrealized € / %
// BIG       100  10000      104      105     +100   +0.96%        +500 /  +5%
// SMALL      10    100       12       15      +30   +25%           +50 / +50%
// LOSS       10    500       41       40      -10   -2.44%        -100 / -20%
// TINY        1     10        9        9        0                    -1 / -10%
// FLAT        1     10       10       10        0                     0
// NEW        10    100        -       11      +10   new            +10 / +10%  (bought today)
const transactions = [
  buy('2024-01-02', 'BIG', '100', '100'),
  buy('2024-01-02', 'SMALL', '10', '10'),
  buy('2024-01-02', 'LOSS', '10', '50'),
  buy('2024-01-02', 'TINY', '1', '10'),
  buy('2024-01-02', 'FLAT', '1', '10'),
  buy(T, 'NEW', '10', '10'),
];
const prices = createPriceLookup([
  close('BIG', Y, '104'),
  close('BIG', T, '105'),
  close('SMALL', Y, '12'),
  close('SMALL', T, '15'),
  close('LOSS', Y, '41'),
  close('LOSS', T, '40'),
  close('TINY', Y, '9'),
  close('FLAT', Y, '10'),
  close('NEW', T, '11'),
]);
const fx = createFxLookup([]);
const holdings = computeHoldings({ transactions, assets, asOf: T, prices, fx });
const day = dayChange({ transactions, assets, prices, fx, today: T });
const list = (ms: Mover[]) => ms.map((m) => m.assetId);

describe('topMovers', () => {
  it('by € impact (default), with the % beside it', () => {
    const m = topMovers({ day, holdings });
    expect(list(m.day.up)).toEqual(['BIG', 'SMALL', 'NEW']);
    expect(list(m.day.down)).toEqual(['LOSS']);
    expectDec(m.day.up[0]!.changeEur, '100');
    expectDec(m.day.up[0]!.changePct, d('100').div('10400'));
    expect([m.day.up[2]!.changePct, m.day.up[2]!.openedToday]).toEqual([null, true]);
    expect(list(m.total.up)).toEqual(['BIG', 'SMALL', 'NEW']);
    expect(list(m.total.down)).toEqual(['LOSS', 'TINY']);
    expectDec(m.total.down[0]!.changePct, '-0.2');
  });

  it('by %: a different order; positions opened today drop out of the day list', () => {
    const m = topMovers({ day, holdings, by: 'pct' });
    expect(list(m.day.up)).toEqual(['SMALL', 'BIG']);
    expect(list(m.total.up)).toEqual(['SMALL', 'NEW', 'BIG']);
    expect(list(m.total.down)).toEqual(['LOSS', 'TINY']);
  });

  it('limit, and ties go to the larger position', () => {
    expect(list(topMovers({ day, holdings, limit: 1 }).day.up)).toEqual(['BIG']);
    // A and B both +10 today; B is worth more
    const txs = [buy('2024-01-02', 'A', '1', '10'), buy('2024-01-02', 'B', '2', '10')];
    const tieAssets: Asset[] = ['A', 'B'].map((id) => ({
      id,
      assetType: 'stock',
      tradingCurrency: 'EUR',
    }));
    const p = createPriceLookup([
      close('A', Y, '10'),
      close('A', T, '20'),
      close('B', Y, '10'),
      close('B', T, '15'),
    ]);
    const h = computeHoldings({ transactions: txs, assets: tieAssets, asOf: T, prices: p, fx });
    const dc = dayChange({ transactions: txs, assets: tieAssets, prices: p, fx, today: T });
    expect(list(topMovers({ day: dc, holdings: h }).day.up)).toEqual(['B', 'A']);
  });
});

describe('topPositions', () => {
  it('largest first, with weight and unrealized € and %', () => {
    // values 10500, 400, 150, 110, 10, 9 -> total 11179
    const rows = topPositions(holdings);
    expect(rows.map((r) => [r.assetId, r.valueEur.toString()])).toEqual([
      ['BIG', '10500'],
      ['LOSS', '400'],
      ['SMALL', '150'],
      ['NEW', '110'],
      ['FLAT', '10'],
      ['TINY', '9'],
    ]);
    expectDec(rows[0]!.weight, d('10500').div('11179'));
    expectDec(rows[0]!.unrealizedEur, '500');
    expectDec(rows[0]!.unrealizedPct, '0.05');
    expect(topPositions(holdings, 2).map((r) => r.assetId)).toEqual(['BIG', 'LOSS']);
  });
});
