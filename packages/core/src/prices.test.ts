import { describe, expect, it } from 'vitest';
import {
  ageInDays,
  createTradePriceLookup,
  holdingPeriods,
  isStale,
  priceFetchRange,
  rateToEurFromEcbQuote,
  splitAdjustPrices,
  type StoredPriceRow,
  withLiveQuotes,
} from './prices';
import { buy, d, deposit, expectDec, redeem, sell, subscribe, transfer } from './test-utils';

const row = (date: string, close: string, splitFactor: string | null = null): StoredPriceRow => ({
  assetId: 'AMZN',
  date,
  close: d(close),
  currency: 'USD',
  splitFactor: splitFactor ? d(splitFactor) : null,
});

describe('splitAdjustPrices', () => {
  it('divides closes before a split by its factor; the split day is already post-split', () => {
    // AMZN 20:1 effective 2022-06-06
    const out = splitAdjustPrices([
      row('2022-06-03', '2447'),
      row('2022-06-06', '124.79', '20'),
      row('2022-06-07', '123'),
    ]);
    const byDate = new Map(out.map((r) => [r.date, r]));
    expectDec(byDate.get('2022-06-03')?.close, '122.35');
    expectDec(byDate.get('2022-06-06')?.close, '124.79');
    expectDec(byDate.get('2022-06-07')?.close, '123');
    expect(byDate.get('2022-06-03')?.currency).toBe('USD');
  });

  it('compounds several splits, reverse splits included, and keeps assets apart', () => {
    const out = splitAdjustPrices([
      row('2021-01-04', '300'),
      row('2022-01-03', '10', '0.01'), // 1:100 reverse split: earlier closes x 100
      row('2023-01-03', '5', '2'), // 2:1
      { ...row('2021-01-04', '50'), assetId: 'MSFT' },
    ]);
    const amzn = new Map(out.filter((r) => r.assetId === 'AMZN').map((r) => [r.date, r.close]));
    expectDec(amzn.get('2021-01-04'), '15000'); // 300 / (0.01 * 2)
    expectDec(amzn.get('2022-01-03'), '5'); // 10 / 2
    expectDec(amzn.get('2023-01-03'), '5');
    expectDec(out.find((r) => r.assetId === 'MSFT')?.close, '50');
  });

  it('is deterministic whatever the input order', () => {
    const rows = [
      row('2022-06-07', '123'),
      row('2022-06-03', '2447'),
      row('2022-06-06', '124.79', '20'),
    ];
    const a = splitAdjustPrices(rows)
      .map((r) => `${r.date}:${r.close.toString()}`)
      .sort();
    const b = splitAdjustPrices([...rows].reverse())
      .map((r) => `${r.date}:${r.close.toString()}`)
      .sort();
    expect(a).toEqual(b);
  });
});

describe('rateToEurFromEcbQuote (USD to EUR)', () => {
  it('inverts the ECB quote and rounds half-even to 18 decimals', () => {
    expectDec(rateToEurFromEcbQuote(d('1.25')), '0.8');
    expectDec(rateToEurFromEcbQuote(d('1.0856')), '0.921149594694178335');
    expectDec(rateToEurFromEcbQuote(d('3')), '0.333333333333333333');
  });

  it('converts a USD close to EUR', () => {
    const rate = rateToEurFromEcbQuote(d('1.25'));
    expectDec(d('200').times(rate), '160');
  });

  it('refuses a zero or negative quote', () => {
    expect(() => rateToEurFromEcbQuote(d('0'))).toThrow(RangeError);
  });
});

describe('staleness', () => {
  it('is stale only when strictly older than the limit (calendar days)', () => {
    expect(ageInDays('2024-04-12', '2024-04-15')).toBe(3); // Friday -> Monday
    expect(isStale(3, 3)).toBe(false);
    expect(isStale(4, 3)).toBe(true);
    expect(ageInDays('2024-04-15', '2024-04-15')).toBe(0);
  });
});

describe('createTradePriceLookup', () => {
  it('uses the latest trade on or before the date, in EUR at the row rate', () => {
    const lookup = createTradePriceLookup([
      buy('2024-01-02', 'A', '10', '100', { currency: 'USD', fx: '0.9' }),
      buy('2024-02-01', 'A', '1', '110', { currency: 'USD', fx: '0.95' }),
      sell('2024-02-01', 'A', '1', '120', { currency: 'USD', fx: '0.95' }), // last of the day
      deposit('2024-03-01', '100'),
    ]);
    expect(lookup('A', '2024-01-01')).toBeNull();
    const jan = lookup('A', '2024-01-31');
    expectDec(jan?.close, '90');
    expect(jan?.currency).toBe('EUR');
    expect(jan?.date).toBe('2024-01-02');
    expectDec(lookup('A', '2024-06-01')?.close, '114');
    expect(lookup('B', '2024-06-01')).toBeNull();
  });
});

describe('holdingPeriods', () => {
  it('opens on the first buy and closes on the sale that empties the position', () => {
    const periods = holdingPeriods([
      buy('2021-01-01', 'A', '10', '1'),
      sell('2021-06-01', 'A', '4', '1'),
      sell('2021-09-01', 'A', '6', '1'),
      buy('2022-03-01', 'A', '1', '1'),
      buy('2021-02-01', 'B', '5', '1'),
    ]);
    expect(periods).toEqual([
      { assetId: 'A', from: '2021-01-01', to: '2021-09-01' },
      { assetId: 'B', from: '2021-02-01', to: null },
      { assetId: 'A', from: '2022-03-01', to: null },
    ]);
  });

  it('ignores transfers, counts certificados, and merges a same-day sell and rebuy', () => {
    const periods = holdingPeriods([
      buy('2021-01-01', 'A', '10', '1'),
      transfer('2021-02-01', 'A', '10', 'acc2'),
      sell('2021-03-01', 'A', '10', '1', { account: 'acc2' }),
      buy('2021-03-01', 'A', '2', '1'), // acquisitions come first within a day
      subscribe('2021-01-01', 'CA', '100', '1', { id: 's1' }),
      redeem('2021-05-01', 'CA', '100', '1'),
    ]);
    expect(periods).toEqual([
      { assetId: 'A', from: '2021-01-01', to: null },
      { assetId: 'CA', from: '2021-01-01', to: '2021-05-01' },
    ]);
  });

  it('respects asOf', () => {
    const periods = holdingPeriods(
      [buy('2021-01-01', 'A', '1', '1'), sell('2021-09-01', 'A', '1', '1')],
      '2021-06-30',
    );
    expect(periods).toEqual([{ assetId: 'A', from: '2021-01-01', to: null }]);
  });
});

describe('priceFetchRange', () => {
  it('starts 14 days before the period and ends at its close or the cut-off', () => {
    expect(
      priceFetchRange({ assetId: 'A', from: '2021-01-01', to: '2021-09-01' }, '2026-10-21'),
    ).toEqual({
      from: '2020-12-18',
      to: '2021-09-01',
    });
    expect(priceFetchRange({ assetId: 'A', from: '2021-01-01', to: null }, '2026-10-21')).toEqual({
      from: '2020-12-18',
      to: '2026-10-21',
    });
    expect(
      priceFetchRange({ assetId: 'A', from: '2026-11-01', to: null }, '2026-10-01'),
    ).toBeNull();
  });
});

describe('withLiveQuotes', () => {
  it('adds quotes for days without a close; the close wins on its day; never future days', () => {
    const close = (date: string, c: string) => ({
      assetId: 'A',
      date,
      close: d(c),
      currency: 'USD',
    });
    const out = withLiveQuotes(
      [close('2024-04-11', '100'), close('2024-04-12', '101')],
      [
        close('2024-04-12', '101.5'),
        { ...close('2024-04-15', '103'), assetId: 'B' },
        close('2024-04-16', '999'),
      ],
      '2024-04-15',
    );
    const key = (r: { assetId: string; date: string; close: { toString(): string } }) =>
      `${r.assetId}|${r.date}|${r.close.toString()}`;
    expect(out.map(key).sort()).toEqual([
      'A|2024-04-11|100',
      'A|2024-04-12|101',
      'B|2024-04-15|103',
    ]);
  });
});
