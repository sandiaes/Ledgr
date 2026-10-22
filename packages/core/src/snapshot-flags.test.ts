import { describe, expect, it } from 'vitest';
import { MissingValuationError } from './errors';
import { runFifo } from './fifo';
import { computeHoldings } from './holdings';
import { createCaFactorLookup, createFxLookup, createPriceLookup, type PriceRow } from './lookups';
import { createTradePriceLookup, splitAdjustPrices } from './prices';
import { buildSnapshot, type SnapshotInput } from './snapshot';
import { buy, d, expectDec, sell, subscribe } from './test-utils';
import type { Asset } from './types';

const assets: Asset[] = [
  { id: 'AAPL', assetType: 'stock', tradingCurrency: 'USD' },
  { id: 'VWCE', assetType: 'etf', tradingCurrency: 'EUR' },
  { id: 'CA', assetType: 'certificado_aforro', tradingCurrency: 'EUR' },
];

// Imported style: EUR at fx 1, month-level dates on the 1st.
const transactions = [
  buy('2024-01-01', 'AAPL', '10', '150'), //   1500
  buy('2024-01-01', 'VWCE', '20', '100'), //   2000
  subscribe('2024-01-01', 'CA', '1000', '1', { id: 'sub1' }),
  subscribe('2024-03-01', 'CA', '500', '1', { id: 'sub2' }),
  sell('2024-02-01', 'VWCE', '5', '110'), //   -550
];

const priceRows: PriceRow[] = [
  { assetId: 'AAPL', date: '2024-04-12', close: d('200'), currency: 'USD' },
  { assetId: 'VWCE', date: '2024-04-12', close: d('120'), currency: 'EUR' },
];

const base: SnapshotInput = {
  date: '2024-04-15', // Monday; last closes Friday 2024-04-12
  transactions,
  assets,
  prices: createPriceLookup(priceRows),
  fx: createFxLookup([{ currency: 'USD', date: '2024-04-12', rateToEur: d('0.8') }]),
  ca: {
    subscriptions: [
      { id: 'c1', seriesId: 'E', transactionId: 'sub1' },
      { id: 'c2', seriesId: 'E', transactionId: 'sub2' },
    ],
    factors: createCaFactorLookup([
      { subscriptionId: 'c1', month: '2024-04-01', factor: d('1.01') },
    ]),
  },
};

describe('buildSnapshot valuation flags', () => {
  it('values USD closes in EUR and flags each asset with its source and age', () => {
    // AAPL 10 * 200 USD * 0.8 = 1600; VWCE 15 * 120 = 1800
    // CA   1000 * 1.01 (factor) + 500 * 1 (no factor yet: subscription price) = 1510
    const s = buildSnapshot(base);
    expectDec(s.stockValueEur, '1600');
    expectDec(s.etfValueEur, '1800');
    expectDec(s.certificadoAforroValueEur, '1510');
    expectDec(s.totalValueEur, '4910');
    // net invested 1500 + 2000 + 1000 + 500 - 550
    expectDec(s.netContributionsEur, '4450');
    expect(s.valuationFlags).toEqual([
      { assetId: 'AAPL', source: 'price', asOf: '2024-04-12', ageDays: 3, stale: false },
      { assetId: 'CA', source: 'mixed', asOf: '2024-03-01', ageDays: 45, stale: true },
      { assetId: 'VWCE', source: 'price', asOf: '2024-04-12', ageDays: 3, stale: false },
    ]);
    expect(s.caValueSource).toBe('mixed');
    expect(s.caValueAsOf).toBe('2024-03-01');
    expect(s.caValueAgeDays).toBe(45);
    expect(s.caValueStale).toBe(true);
    expect(s.stale).toBe(true);
    expect(s.staleAssetCount).toBe(1);
  });

  it('marks CA value as from factor, N days old, and flags it only beyond 35 days', () => {
    const factors = createCaFactorLookup([
      { subscriptionId: 'c1', month: '2024-04-01', factor: d('1.01') },
      { subscriptionId: 'c2', month: '2024-04-01', factor: d('1.002') },
    ]);
    const ca = { ...base.ca!, factors };
    const fresh = buildSnapshot({ ...base, ca, date: '2024-05-06' }); // 35 days after 04-01
    expect(fresh.caValueSource).toBe('factor');
    expect(fresh.caValueAgeDays).toBe(35);
    expect(fresh.caValueStale).toBe(false);
    const old = buildSnapshot({ ...base, ca, date: '2024-05-07' });
    expect(old.caValueAgeDays).toBe(36);
    expect(old.caValueStale).toBe(true);
    expect(buildSnapshot({ ...base, ca, date: '2024-05-07', caMaxAgeDays: 40 }).caValueStale).toBe(
      false,
    );
  });

  it('before the first factor a unit is worth its subscription price', () => {
    const s = buildSnapshot({
      ...base,
      date: '2024-01-20',
      prices: createPriceLookup([
        { assetId: 'AAPL', date: '2024-01-19', close: d('150'), currency: 'USD' },
        { assetId: 'VWCE', date: '2024-01-19', close: d('100'), currency: 'EUR' },
      ]),
      fx: createFxLookup([{ currency: 'USD', date: '2024-01-19', rateToEur: d('0.9') }]),
    });
    expectDec(s.certificadoAforroValueEur, '1000');
    expect(s.caValueSource).toBe('subscription');
    expect(s.caValueAsOf).toBe('2024-01-01');
    expect(s.caValueAgeDays).toBe(19);
  });

  it('uses the last known price when newer ones are missing, and flags it after 3 days', () => {
    const s = buildSnapshot({ ...base, date: '2024-04-16' });
    expectDec(s.stockValueEur, '1600'); // still Friday's close
    const aapl = s.valuationFlags.find((f) => f.assetId === 'AAPL');
    expect(aapl).toEqual({
      assetId: 'AAPL',
      source: 'price',
      asOf: '2024-04-12',
      ageDays: 4,
      stale: true,
    });
    expect(s.staleAssetCount).toBe(3);
    const lenient = buildSnapshot({ ...base, date: '2024-04-16', staleAfterDays: 5 });
    expect(lenient.valuationFlags.find((f) => f.assetId === 'AAPL')?.stale).toBe(false);
  });

  it('with no price at all, values at the last trade price and flags it as trade', () => {
    const prices = createPriceLookup(priceRows.filter((r) => r.assetId !== 'VWCE'));
    expect(() => buildSnapshot({ ...base, prices })).toThrow(MissingValuationError);
    const s = buildSnapshot({
      ...base,
      prices,
      fallbackPrices: createTradePriceLookup(transactions),
    });
    expectDec(s.etfValueEur, '1650'); // 15 * 110 (the February sell)
    expect(s.valuationFlags.find((f) => f.assetId === 'VWCE')).toEqual({
      assetId: 'VWCE',
      source: 'trade',
      asOf: '2024-02-01',
      ageDays: 74,
      stale: true,
    });
  });

  it('still throws for a missing fx rate', () => {
    expect(() =>
      buildSnapshot({
        ...base,
        fx: createFxLookup([]),
        fallbackPrices: createTradePriceLookup(transactions),
      }),
    ).toThrow(MissingValuationError);
  });
});

describe('snapshot determinism', () => {
  it('gives identical output for identical inputs, whatever the row order', () => {
    const a = buildSnapshot(base);
    const b = buildSnapshot({
      ...base,
      prices: createPriceLookup([...priceRows].reverse()),
    });
    const text = (s: object) => JSON.stringify(s, (_k, v: unknown) => (v === undefined ? null : v));
    expect(text(a)).toBe(text(b));
    expect(text(buildSnapshot(base))).toBe(text(a));
  });

  it('values post-split units with split-adjusted closes', () => {
    // Ledger in post-split units (20 bought "at 100" after restating a 20:1 split).
    const txs = [buy('2022-05-02', 'AAPL', '20', '100')];
    const prices = createPriceLookup(
      splitAdjustPrices([
        {
          assetId: 'AAPL',
          date: '2022-05-31',
          close: d('2400'),
          currency: 'USD',
          splitFactor: null,
        },
        {
          assetId: 'AAPL',
          date: '2022-06-06',
          close: d('125'),
          currency: 'USD',
          splitFactor: d('20'),
        },
      ]),
    );
    const fx = createFxLookup([{ currency: 'USD', date: '2022-05-31', rateToEur: d('1') }]);
    const before = buildSnapshot({ ...base, transactions: txs, prices, fx, date: '2022-06-01' });
    const after = buildSnapshot({ ...base, transactions: txs, prices, fx, date: '2022-06-06' });
    expectDec(before.stockValueEur, '2400'); // 20 * 2400 / 20
    expectDec(after.stockValueEur, '2500'); // 20 * 125
  });
});

describe('holdings and FIFO are unchanged by valuation', () => {
  it('fallbacks, flags and split adjustment never change units, lots or cost', () => {
    const plain = computeHoldings({ ...base, asOf: base.date });
    const s = buildSnapshot({ ...base, fallbackPrices: createTradePriceLookup(transactions) });
    const again = computeHoldings({ ...base, asOf: base.date });
    expect(again.map((h) => [h.assetId, h.quantity.toString(), h.costBasisEur.toString()])).toEqual(
      plain.map((h) => [h.assetId, h.quantity.toString(), h.costBasisEur.toString()]),
    );
    expectDec(s.totalCostBasisEur, '4500'); // 1500 + 15 * 100 + 1500
    const fifo = runFifo(transactions, { asOf: base.date });
    const lots = (
      list: { lotId: string; quantity: { toString(): string }; costEur: { toString(): string } }[],
    ) => list.map((l) => `${l.lotId}:${l.quantity.toString()}:${l.costEur.toString()}`).sort();
    expect(lots(fifo.openLots)).toEqual(lots(plain.flatMap((h) => h.lots)));
    expect(fifo.disposals).toHaveLength(1);
    expectDec(fifo.disposals[0]?.gainEur, '50'); // 5 * (110 - 100)
  });
});
