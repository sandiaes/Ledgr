import { describe, expect, it } from 'vitest';
import { MissingValuationError } from './errors';
import { computeHoldings } from './holdings';
import { createFxLookup, createPriceLookup, type PriceRow } from './lookups';
import { assetTransactions, positionDetail, priceSeries } from './positions';
import type { StoredPriceRow } from './prices';
import { buy, d, dividend, expectDec, fee, sell, transfer } from './test-utils';
import type { Asset, Transaction } from './types';

const T = '2025-06-10';
const assets: Asset[] = [{ id: 'X', assetType: 'stock', tradingCurrency: 'EUR' }];
const at = (close: string) =>
  createPriceLookup([{ assetId: 'X', date: '2025-06-09', close: d(close), currency: 'EUR' }]);

function holdingOf(transactions: Transaction[], close: string | null) {
  const [h] = computeHoldings({
    transactions,
    assets,
    asOf: T,
    prices: close ? at(close) : createPriceLookup([]),
    fx: createFxLookup([]),
  });
  if (!h) throw new Error('no holding');
  return h;
}

describe('positionDetail', () => {
  // By hand: buy 10 @ 10 at A, 10 @ 12 at B, sell 10 @ 15 at A (A's own lot: realized 50),
  // buy 5 @ 14 at A; dividend 3 at B. Close 20: A 5 units (cost 70, value 100, U 30),
  // B 10 units (cost 120, value 200, U 80).
  const ledger = [
    buy('2025-01-02', 'X', '10', '10', { id: 'b1', account: 'A' }),
    buy('2025-02-03', 'X', '10', '12', { id: 'b2', account: 'B' }),
    sell('2025-03-03', 'X', '10', '15', { id: 's1', account: 'A' }),
    buy('2025-04-01', 'X', '5', '14', { id: 'b3', account: 'A' }),
    dividend('2025-05-02', '3', { asset: 'X', account: 'B' }),
  ];

  it('gives the figures, the split by broker and the open lots (hand example)', () => {
    const p = positionDetail({
      transactions: ledger,
      holding: holdingOf(ledger, '20'),
      asOf: T,
      portfolioValueEur: d('600'),
    });
    expectDec(p.units, '15');
    expectDec(p.costBasisEur, '190');
    expectDec(p.averageCostEur, d('190').div(15));
    expectDec(p.valueEur, '300');
    expectDec(p.weight, '0.5');
    expectDec(p.unrealizedEur, '110');
    expectDec(p.unrealizedPct, d('110').div(190));
    expectDec(p.realizedEur, '50');
    expectDec(p.incomeEur, '3');
    expect(p.dayChange).toBeNull();
    expect(p.price).toEqual({ close: d('20'), currency: 'EUR', date: '2025-06-09' });
    expect(p.certificados).toEqual([]);

    expect(p.accounts.map((a) => a.accountId)).toEqual(['A', 'B']);
    const [a, b] = p.accounts;
    expectDec(a?.units, '5');
    expectDec(a?.costBasisEur, '70');
    expectDec(a?.valueEur, '100');
    expectDec(a?.unrealizedEur, '30');
    expectDec(a?.realizedEur, '50');
    expectDec(b?.units, '10');
    expectDec(b?.valueEur, '200');
    expectDec(b?.realizedEur, '0');

    expect(p.lots.map((l) => [l.lotId, l.accountId, l.acquiredOn])).toEqual([
      ['b2', 'B', '2025-02-03'],
      ['b3', 'A', '2025-04-01'],
    ]);
    expectDec(p.lots[0]?.unitCostEur, '12');
    expectDec(p.lots[1]?.costEur, '70');
  });

  it('broker lines and lots add up to the position', () => {
    const p = positionDetail({
      transactions: ledger,
      holding: holdingOf(ledger, '19.333333333333333333'),
      asOf: T,
      portfolioValueEur: d('1000'),
    });
    const sum = (pick: (l: (typeof p.accounts)[number]) => ReturnType<typeof d>) =>
      p.accounts.reduce((s, l) => s.plus(pick(l)), d('0'));
    expectDec(
      sum((l) => l.units),
      p.units,
    );
    expectDec(
      sum((l) => l.costBasisEur),
      p.costBasisEur,
    );
    expectDec(
      sum((l) => l.valueEur),
      p.valueEur,
    );
    expectDec(
      sum((l) => l.unrealizedEur),
      p.unrealizedEur,
    );
    expectDec(
      sum((l) => l.realizedEur),
      p.realizedEur,
    );
    expectDec(
      p.lots.reduce((s, l) => s.plus(l.units), d('0')),
      p.units,
    );
    expectDec(
      p.lots.reduce((s, l) => s.plus(l.costEur), d('0')),
      p.costBasisEur,
    );
  });

  it('lists an account that sold out of the asset with its realized gain only', () => {
    const rows = [
      buy('2025-01-02', 'X', '10', '10', { account: 'A' }),
      buy('2025-02-03', 'X', '4', '10', { account: 'B' }),
      sell('2025-03-03', 'X', '4', '9', { account: 'B' }),
    ];
    const p = positionDetail({
      transactions: rows,
      holding: holdingOf(rows, '11'),
      asOf: T,
      portfolioValueEur: d('0'),
    });
    expect(p.weight).toBeNull();
    const b = p.accounts.find((a) => a.accountId === 'B');
    expectDec(b?.units, '0');
    expectDec(b?.valueEur, '0');
    expectDec(b?.realizedEur, '-4');
  });

  it('refuses an unvalued holding', () => {
    const rows = [buy('2025-01-02', 'X', '1', '10')];
    expect(() =>
      positionDetail({
        transactions: rows,
        holding: holdingOf(rows, null),
        asOf: T,
        portfolioValueEur: d('0'),
      }),
    ).toThrow(MissingValuationError);
  });
});

describe('assetTransactions', () => {
  it("lists the asset's rows newest first with their EUR totals", () => {
    const rows: Transaction[] = [
      {
        ...buy('2025-01-01', 'X', '10', '10', { id: 'b', fees: '1' }),
        tradeDatePrecision: 'month',
      },
      sell('2025-02-03', 'X', '4', '12', { id: 's', fees: '2', currency: 'USD', fx: '0.5' }),
      dividend('2025-03-03', '5', { id: 'v', asset: 'X', withholding: '1', fees: '0.5' }),
      transfer('2025-04-01', 'X', '2', 'B', { id: 't', fees: '0.25' }),
      fee('2025-04-02', '9', { id: 'other' }),
      buy('2025-05-01', 'Y', '1', '1', { id: 'y' }),
    ];
    const list = assetTransactions(rows, 'X');
    expect(list.map((r) => r.id)).toEqual(['t', 'v', 's', 'b']);
    const [t, v, s, b] = list;
    expectDec(b?.totalEur, '101');
    expect(b?.monthOnly).toBe(true);
    expectDec(s?.totalEur, '23'); // (48 - 2) x 0.5
    expectDec(s?.feesEur, '1');
    expect(s?.currency).toBe('USD');
    expectDec(v?.totalEur, '3.5');
    expectDec(t?.totalEur, '0.25');
    expect(t?.transferToAccountId).toBe('B');
    expect(t?.monthOnly).toBe(false);
  });

  it('stops at asOf', () => {
    const rows = [buy('2025-01-01', 'X', '1', '1'), buy('2025-07-01', 'X', '1', '1')];
    expect(assetTransactions(rows, 'X', T)).toHaveLength(1);
  });
});

describe('priceSeries', () => {
  const row = (
    date: string,
    close: string,
    extra: Partial<StoredPriceRow> = {},
  ): StoredPriceRow => ({
    assetId: 'X',
    date,
    close: d(close),
    currency: 'EUR',
    splitFactor: null,
    ...extra,
  });
  const prices = [
    row('2025-04-30', '200'),
    row('2025-05-08', '210'), // Thursday before 1M's start (Sat 10 May)
    row('2025-05-12', '110', { splitFactor: d('2') }), // 2:1 split, already post-split
    row('2025-06-09', '120'),
    row('2025-06-09', '999', { currency: 'USD' }),
    row('2025-06-09', '5', { assetId: 'Y' }),
  ];
  const quote: PriceRow = { assetId: 'X', date: T, close: d('126'), currency: 'EUR' };

  it('starts at the last close on or before the range start, split-adjusted, with today', () => {
    const s = priceSeries({
      assetId: 'X',
      currency: 'EUR',
      prices,
      liveQuotes: [quote],
      today: T,
      range: '1M',
    });
    expect(s.from).toBe('2025-05-10');
    expect(s.points.map((p) => [p.date, p.close.toString()])).toEqual([
      ['2025-05-08', '105'],
      ['2025-05-12', '110'],
      ['2025-06-09', '120'],
      [T, '126'],
    ]);
    expectDec(s.change, '21');
    expectDec(s.changePct, '0.2');
    expect(s.chart).toEqual(s.points);
  });

  it("'All' starts at the first close; one point has no change", () => {
    const all = priceSeries({ assetId: 'X', currency: 'EUR', prices, today: T, range: 'All' });
    expect(all.points[0]?.date).toBe('2025-04-30');
    expectDec(all.points[0]?.close, '100');
    const one = priceSeries({
      assetId: 'X',
      currency: 'EUR',
      prices: [row('2025-06-09', '120')],
      today: T,
      range: '1Y',
    });
    expect(one.points).toHaveLength(1);
    expect(one.change).toBeNull();
    expect(one.changePct).toBeNull();
  });

  it('is empty without prices', () => {
    const s = priceSeries({ assetId: 'X', currency: 'EUR', prices: [], today: T, range: '3M' });
    expect(s.points).toEqual([]);
    expect(s.change).toBeNull();
  });
});
