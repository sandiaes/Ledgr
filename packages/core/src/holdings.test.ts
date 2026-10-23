import { describe, expect, it } from 'vitest';
import { InsufficientHoldingsError, LedgerError } from './errors';
import { computeHoldings } from './holdings';
import { createFxLookup, createPriceLookup } from './lookups';
import { buy, d, expectDec, sell, transfer } from './test-utils';
import type { Asset } from './types';

const assets: Asset[] = [
  { id: 'A', assetType: 'stock', tradingCurrency: 'EUR' },
  { id: 'US', assetType: 'stock', tradingCurrency: 'USD' },
  { id: 'BTC', assetType: 'crypto', tradingCurrency: 'EUR' },
  { id: 'Z', assetType: 'etf', tradingCurrency: 'EUR' },
  { id: 'XE', assetType: 'etf', tradingCurrency: 'USD' },
];

const transactions = [
  buy('2024-01-10', 'A', '10', '100', { fees: '5' }),
  sell('2024-03-01', 'A', '4', '120', { fees: '2' }),
  buy('2024-01-15', 'US', '10', '100', { fees: '1', currency: 'USD', fx: '0.9' }),
  buy('2024-02-01', 'BTC', '0.05', '40000', { fees: '2', account: 'acc2' }),
  buy('2024-02-01', 'Z', '1', '50'),
  sell('2024-04-01', 'Z', '1', '55'),
];

const prices = createPriceLookup([
  { assetId: 'A', date: '2024-06-28', close: d('110'), currency: 'EUR' },
  { assetId: 'US', date: '2024-06-28', close: d('120'), currency: 'USD' },
  { assetId: 'BTC', date: '2024-06-30', close: d('60000'), currency: 'EUR' },
]);
const fx = createFxLookup([
  { currency: 'USD', date: '2024-01-15', rateToEur: d('0.9') },
  { currency: 'USD', date: '2024-06-28', rateToEur: d('0.92') },
]);

describe('computeHoldings', () => {
  const holdings = computeHoldings({ transactions, assets, asOf: '2024-06-30', prices, fx });
  const byAsset = (id: string) => holdings.find((h) => h.assetId === id)!;

  it('omits fully sold positions (zero holdings)', () => {
    expect(holdings.map((h) => h.assetId)).toEqual(['A', 'BTC', 'US']);
  });

  it('EUR stock: quantity, cost basis, average cost, value, unrealized', () => {
    // 6 left of 10 bought for 1005 -> cost 603, avg 100.5
    // value 6 * 110 = 660, unrealized 57
    const a = byAsset('A');
    expectDec(a.quantity, '6');
    expectDec(a.costBasisEur, '603');
    expectDec(a.averageCostEur, '100.5');
    expectDec(a.marketValueEur, '660');
    expectDec(a.unrealizedGainEur, '57');
    expect(a.valuation).toMatchObject({ kind: 'price' });
  });

  it('USD stock: cost at trade-date fx, value at the latest fx', () => {
    // cost (10*100 + 1) USD * 0.90 = 900.9 EUR, avg 90.09
    // value 10 * 120 USD * 0.92 = 1104 EUR, unrealized 203.1
    const us = byAsset('US');
    expectDec(us.costBasisEur, '900.9');
    expectDec(us.averageCostEur, '90.09');
    expectDec(us.marketValueEur, '1104');
    expectDec(us.unrealizedGainEur, '203.1');
    expect(us.currency).toBe('USD');
    if (us.valuation.kind !== 'price') throw new Error('expected price valuation');
    expectDec(us.valuation.fxRateToEur, '0.92');
  });

  it('crypto in another account', () => {
    // 0.05 * 60000 = 3000; cost 2002; unrealized 998
    const btc = byAsset('BTC');
    expect(btc.accounts.map((a) => [a.accountId, a.quantity.toString()])).toEqual([
      ['acc2', '0.05'],
    ]);
    expectDec(btc.marketValueEur, '3000');
    expectDec(btc.unrealizedGainEur, '998');
  });

  it('one holding per asset across accounts, split exactly by account (2 brokers x 2 lots)', () => {
    // acc1: 2024-01-01 6 @ 10 = 60, 2024-02-01 2 @ 12 = 24
    // acc2: 2024-01-02 4 @ 15 = 60, 2024-02-02 2 @ 9 = 18
    // acc2 sells 5 @ 12 -> its own lots only: 4 @ 15 + 1 @ 9 = 69 (acc1's older lot untouched)
    // left: acc1 8 units, cost 84; acc2 1 unit, cost 9; total 9 units, cost 93
    // price 11: acc1 88 (U +4), acc2 11 (U +2); total 99 (U +6)
    const [h, ...rest] = computeHoldings({
      transactions: [
        buy('2024-01-01', 'A', '6', '10', { account: 'acc1' }),
        buy('2024-01-02', 'A', '4', '15', { account: 'acc2' }),
        buy('2024-02-01', 'A', '2', '12', { account: 'acc1' }),
        buy('2024-02-02', 'A', '2', '9', { account: 'acc2' }),
        sell('2024-03-01', 'A', '5', '12', { account: 'acc2' }),
      ],
      assets,
      asOf: '2024-06-30',
      prices: createPriceLookup([
        { assetId: 'A', date: '2024-06-30', close: d('11'), currency: 'EUR' },
      ]),
      fx,
    });
    expect(rest).toEqual([]);
    expectDec(h!.quantity, '9');
    expectDec(h!.costBasisEur, '93');
    expectDec(h!.marketValueEur, '99');
    expectDec(h!.unrealizedGainEur, '6');
    expect(
      h!.accounts.map((a) => [
        a.accountId,
        a.quantity.toString(),
        a.costBasisEur.toString(),
        a.marketValueEur!.toString(),
        a.unrealizedGainEur!.toString(),
        a.lots.length,
      ]),
    ).toEqual([
      ['acc1', '8', '84', '88', '4', 2],
      ['acc2', '1', '9', '11', '2', 1],
    ]);
  });

  it('transfers move lots with their cost to the receiving account', () => {
    // exchange buys 1 BTC @ 40000 + 10 fee = 40010
    // transfer 0.4 to wallet (2 EUR fee: a cost, not part of the cost basis): the moved part
    //   costs 40010 * 0.4 = 16004, the exchange keeps 0.6 at 24006
    // wallet sells 0.1 @ 50000: cost 16004 * 0.1 / 0.4 = 4001; wallet keeps 0.3 at 12003
    // value 0.9 * 60000 = 54000 = exchange 36000 (U 11994) + wallet 18000 (U 5997)
    const [h] = computeHoldings({
      transactions: [
        buy('2024-01-01', 'BTC', '1', '40000', { fees: '10', account: 'ex' }),
        transfer('2024-02-01', 'BTC', '0.4', 'wal', { fees: '2', account: 'ex' }),
        sell('2024-03-01', 'BTC', '0.1', '50000', { account: 'wal' }),
      ],
      assets,
      asOf: '2024-06-30',
      prices: createPriceLookup([
        { assetId: 'BTC', date: '2024-06-30', close: d('60000'), currency: 'EUR' },
      ]),
      fx,
    });
    expectDec(h!.quantity, '0.9');
    expectDec(h!.costBasisEur, '36009');
    expect(
      h!.accounts.map((a) => [
        a.accountId,
        a.quantity.toString(),
        a.costBasisEur.toString(),
        a.marketValueEur!.toString(),
        a.unrealizedGainEur!.toString(),
      ]),
    ).toEqual([
      ['ex', '0.6', '24006', '36000', '11994'],
      ['wal', '0.3', '12003', '18000', '5997'],
    ]);
  });

  it('same-day buy, transfer and sell work in any row order', () => {
    const [h] = computeHoldings({
      transactions: [
        sell('2024-01-01', 'BTC', '0.5', '1', { account: 'wal' }),
        transfer('2024-01-01', 'BTC', '1', 'wal', { account: 'ex' }),
        buy('2024-01-01', 'BTC', '1', '1', { account: 'ex' }),
      ],
      assets,
      asOf: '2024-01-01',
      prices: createPriceLookup([]),
      fx,
    });
    expect(h!.accounts.map((a) => [a.accountId, a.quantity.toString()])).toEqual([['wal', '0.5']]);
  });

  it('a transfer of more than the sending account holds throws', () => {
    // 2 held over both accounts, but acc1 only has 1
    const txs = [
      buy('2024-01-01', 'A', '1', '10', { account: 'acc1' }),
      buy('2024-01-01', 'A', '1', '10', { account: 'acc2' }),
      transfer('2024-01-02', 'A', '1.5', 'acc2', { id: 't1', account: 'acc1' }),
    ];
    const run = () =>
      computeHoldings({ transactions: txs, assets, asOf: '2024-06-30', prices, fx });
    expect(run).toThrow(InsufficientHoldingsError);
    expect(run).toThrow(/Transfer of 1.5 units exceeds the 1 held of asset A in account acc1/);
  });

  it('an account that sold everything it held drops out of the split', () => {
    const [h] = computeHoldings({
      transactions: [
        buy('2024-01-01', 'A', '5', '10', { account: 'acc1' }),
        buy('2024-01-02', 'A', '5', '10', { account: 'acc2' }),
        sell('2024-03-01', 'A', '5', '12', { account: 'acc2' }),
      ],
      assets,
      asOf: '2024-06-30',
      prices: createPriceLookup([]),
      fx,
    });
    expect(h!.accounts.map((a) => [a.accountId, a.quantity.toString(), a.marketValueEur])).toEqual([
      ['acc1', '5', null],
    ]);
  });

  it('uses the price currency, not the trading currency, for conversion', () => {
    // USD-traded ETF quoted in EUR on its price source: no fx needed
    const [h] = computeHoldings({
      transactions: [buy('2024-01-01', 'XE', '2', '10', { currency: 'USD', fx: '0.9' })],
      assets,
      asOf: '2024-06-30',
      prices: createPriceLookup([
        { assetId: 'XE', date: '2024-06-30', close: d('10'), currency: 'EUR' },
      ]),
      fx: createFxLookup([]),
    });
    expectDec(h!.marketValueEur, '20');
    expectDec(h!.costBasisEur, '18');
  });

  it('flags a missing price or fx rate instead of guessing', () => {
    const missing = computeHoldings({
      transactions,
      assets,
      asOf: '2024-06-30',
      prices: createPriceLookup([
        { assetId: 'US', date: '2024-06-28', close: d('120'), currency: 'USD' },
      ]),
      fx: createFxLookup([]),
    });
    const a = missing.find((h) => h.assetId === 'A')!;
    const us = missing.find((h) => h.assetId === 'US')!;
    expect(a.valuation).toEqual({ kind: 'missing', reason: 'price' });
    expect(a.marketValueEur).toBeNull();
    expect(a.unrealizedGainEur).toBeNull();
    expect(us.valuation).toEqual({ kind: 'missing', reason: 'fx' });
    expectDec(us.costBasisEur, '900.9');
  });

  it('values as of a past date with only what was known then', () => {
    // On 2024-02-15: A still 10 units (sell is 03-01), no A price yet
    const early = computeHoldings({ transactions, assets, asOf: '2024-02-15', prices, fx });
    const a = early.find((h) => h.assetId === 'A')!;
    expectDec(a.quantity, '10');
    expect(a.marketValueEur).toBeNull();
  });

  it('empty ledger -> no holdings; unknown asset -> error', () => {
    expect(computeHoldings({ transactions: [], assets, asOf: '2024-01-01', prices, fx })).toEqual(
      [],
    );
    expect(() =>
      computeHoldings({
        transactions: [buy('2024-01-01', 'NOPE', '1', '1')],
        assets,
        asOf: '2024-01-01',
        prices,
        fx,
      }),
    ).toThrow(LedgerError);
  });
});
