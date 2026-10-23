import { describe, expect, it } from 'vitest';
import { dailyFlows, flowEur } from './cashflows';
import { dayChange } from './daychange';
import { MissingValuationError } from './errors';
import { createFxLookup, createPriceLookup, type PriceRow } from './lookups';
import { buy, d, deposit, dividend, expectDec, fee, interest, sell, transfer } from './test-utils';
import type { Asset } from './types';

const assets: Asset[] = [
  { id: 'R', assetType: 'etf', tradingCurrency: 'EUR' },
  { id: 'X', assetType: 'stock', tradingCurrency: 'EUR' },
];
const T = '2024-06-10';
const Y = '2024-06-09';
const fx = createFxLookup([]);
const close = (assetId: string, date: string, value: string): PriceRow => ({
  assetId,
  date,
  close: d(value),
  currency: 'EUR',
});

describe('flowEur and dailyFlows', () => {
  it('F per row: buys +cost, sells -proceeds, income -net, fee rows +amount, deposits none', () => {
    expectDec(flowEur(buy(T, 'R', '2', '10', { fees: '1' })), '21');
    expectDec(flowEur(sell(T, 'R', '2', '10', { fees: '1' })), '-19');
    expectDec(flowEur(dividend(T, '5', { asset: 'R', withholding: '1' })), '-4');
    expectDec(flowEur(interest(T, '2')), '-2');
    expectDec(flowEur(fee(T, '3')), '3');
    expectDec(flowEur(transfer(T, 'R', '1', 'acc2', { fees: '0.5' })), '0.5');
    expect(flowEur(transfer(T, 'R', '1', 'acc2'))).toBeNull();
    expect(flowEur(deposit(T, '100'))).toBeNull();
  });

  it('sums each day, oldest first, within (after, asOf]', () => {
    const txs = [
      buy('2024-01-02', 'R', '1', '100'),
      dividend('2024-01-02', '3', { asset: 'R' }),
      buy('2024-01-01', 'X', '1', '50'),
      deposit('2024-01-03', '1000'),
      sell('2024-01-04', 'X', '1', '60'),
    ];
    expect(dailyFlows(txs).map((f) => [f.date, f.flowEur.toString()])).toEqual([
      ['2024-01-01', '50'],
      ['2024-01-02', '97'],
      ['2024-01-04', '-60'],
    ]);
    expect(dailyFlows(txs, { after: '2024-01-01', asOf: '2024-01-03' }).map((f) => f.date)).toEqual(
      ['2024-01-02'],
    );
    expect(dailyFlows(txs, { assetId: 'X' }).map((f) => f.flowEur.toString())).toEqual([
      '50',
      '-60',
    ]);
  });
});

describe('dayChange', () => {
  it('excludes a contribution made today (docs/kpis.md §2 example: 60, 0.60%)', () => {
    // V(Y) = 100 x 100 = 10,000. Today: buy X for 1,000, X worth 1,010; R up 50.
    // V(T) = 100 x 100.5 + 10 x 101 = 11,060; F(T) = 1,000; D = 60; % = 60 / 10,000
    const day = dayChange({
      transactions: [buy('2024-05-01', 'R', '100', '90'), buy(T, 'X', '10', '100')],
      assets,
      prices: createPriceLookup([
        close('R', Y, '100'),
        close('R', T, '100.5'),
        close('X', T, '101'),
      ]),
      fx,
      today: T,
    });
    expectDec(day.valueYesterdayEur, '10000');
    expectDec(day.valueTodayEur, '11060');
    expectDec(day.flowTodayEur, '1000');
    expectDec(day.changeEur, '60');
    expectDec(day.changePct, '0.006');
    const [r, x] = day.assets;
    expect([r!.assetId, r!.changeEur.toString(), r!.changePct!.toString()]).toEqual([
      'R',
      '50',
      '0.005',
    ]);
    // opened today: "new", no %
    expect([x!.assetId, x!.changeEur.toString(), x!.changePct, x!.openedToday]).toEqual([
      'X',
      '10',
      null,
      true,
    ]);
  });

  it('a same-day buy adds to a position held yesterday without counting as change', () => {
    // R: 10 held yesterday at 100 (V 1000); today buy 5 @ 102, close 101:
    // V(T) = 15 x 101 = 1515; F = 510; D = 1515 - 1000 - 510 = 5 (= 10 x 1 - 5 x 1)
    const day = dayChange({
      transactions: [buy('2024-05-01', 'R', '10', '90'), buy(T, 'R', '5', '102')],
      assets,
      prices: createPriceLookup([close('R', Y, '100'), close('R', T, '101')]),
      fx,
      today: T,
    });
    expectDec(day.changeEur, '5');
    expectDec(day.changePct, '0.005');
    expect(day.assets[0]!.openedToday).toBe(false);
  });

  it('a sale today: the proceeds leave through F(T)', () => {
    // 10 R at 100 yesterday (1000); today sell 4 @ 102 (F = -408), close 101 -> V 606
    // D = 606 - 1000 + 408 = 14 (10 units up 1, and 4 of them sold 1 above the close)
    const day = dayChange({
      transactions: [buy('2024-05-01', 'R', '10', '90'), sell(T, 'R', '4', '102')],
      assets,
      prices: createPriceLookup([close('R', Y, '100'), close('R', T, '101')]),
      fx,
      today: T,
    });
    expectDec(day.flowTodayEur, '-408');
    expectDec(day.changeEur, '14');
    expectDec(day.changePct, '0.014');
  });

  it('a position sold out today is listed as not held', () => {
    const day = dayChange({
      transactions: [buy('2024-05-01', 'R', '10', '90'), sell(T, 'R', '10', '102')],
      assets,
      prices: createPriceLookup([close('R', Y, '100'), close('R', T, '101')]),
      fx,
      today: T,
    });
    // D = 0 - 1000 + 1020 = 20
    expect([day.assets[0]!.held, day.assets[0]!.changeEur.toString()]).toEqual([false, '20']);
    expectDec(day.valueTodayEur, '0');
  });

  it('V(Y) = 0: the first buy is today, no %', () => {
    const day = dayChange({
      transactions: [buy(T, 'R', '10', '100')],
      assets,
      prices: createPriceLookup([close('R', T, '101')]),
      fx,
      today: T,
    });
    expectDec(day.changeEur, '10');
    expect(day.changePct).toBeNull();
  });

  it('a dividend recorded today counts as change; a deposit does not', () => {
    const day = dayChange({
      transactions: [
        buy('2024-05-01', 'R', '10', '90'),
        dividend(T, '5', { asset: 'R' }),
        deposit(T, '1000'),
      ],
      assets,
      prices: createPriceLookup([close('R', Y, '100')]),
      fx,
      today: T,
    });
    expectDec(day.changeEur, '5');
    expectDec(day.assets[0]!.changeEur, '5');
  });

  it('refuses a holding without a value on either day', () => {
    expect(() =>
      dayChange({
        transactions: [buy('2024-05-01', 'R', '10', '90')],
        assets,
        prices: createPriceLookup([close('R', T, '101')]),
        fx,
        today: T,
      }),
    ).toThrow(MissingValuationError);
  });
});
