import { describe, expect, it } from 'vitest';
import { dec, safeDiv, sum } from './decimal';
import { createCaFactorLookup, createFxLookup, createPriceLookup } from './lookups';
import { d, expectDec } from './test-utils';

describe('createPriceLookup', () => {
  const prices = createPriceLookup([
    { assetId: 'A', date: '2024-01-05', close: d('12'), currency: 'EUR' },
    { assetId: 'A', date: '2024-01-01', close: d('10'), currency: 'EUR' },
    { assetId: 'A', date: '2024-01-03', close: d('11'), currency: 'EUR' },
    { assetId: 'B', date: '2024-01-02', close: d('99'), currency: 'USD' },
  ]);

  it('returns the latest close on or before the date', () => {
    expect(prices('A', '2023-12-31')).toBeNull();
    expectDec(prices('A', '2024-01-01')!.close, '10');
    expectDec(prices('A', '2024-01-02')!.close, '10');
    expectDec(prices('A', '2024-01-04')!.close, '11');
    expect(prices('A', '2030-01-01')).toMatchObject({ date: '2024-01-05', currency: 'EUR' });
    expect(prices('B', '2024-01-02')!.currency).toBe('USD');
    expect(prices('C', '2024-01-02')).toBeNull();
  });

  it('rejects duplicate dates and bad dates', () => {
    const row = { assetId: 'A', date: '2024-01-01', close: d('1'), currency: 'EUR' };
    expect(() => createPriceLookup([row, row])).toThrow(/Duplicate/);
    expect(() => createPriceLookup([{ ...row, date: '2024-1-1' }])).toThrow(/Invalid/);
  });
});

describe('createFxLookup', () => {
  const fx = createFxLookup([
    { currency: 'USD', date: '2024-01-01', rateToEur: d('0.9') },
    { currency: 'USD', date: '2024-02-01', rateToEur: d('0.92') },
  ]);

  it('EUR is always 1; others on or before the date', () => {
    expectDec(fx('EUR', '1999-01-01'), '1');
    expect(fx('USD', '2023-12-31')).toBeNull();
    expectDec(fx('USD', '2024-01-31'), '0.9');
    expectDec(fx('USD', '2024-06-01'), '0.92');
    expect(fx('GBP', '2024-06-01')).toBeNull();
  });
});

describe('decimal helpers', () => {
  it('dec rejects non-finite input; sum and safeDiv', () => {
    expectDec(dec('1.5'), '1.5');
    expect(() => dec('Infinity')).toThrow(/finite/);
    expect(() => dec('NaN')).toThrow(/finite/);
    expectDec(sum([d('0.1'), d('0.2')]), '0.3');
    expect(safeDiv(d('1'), d('0'))).toBeNull();
    expectDec(safeDiv(d('1'), d('4')), '0.25');
  });
});

describe('createCaFactorLookup', () => {
  const factors = createCaFactorLookup([
    { subscriptionId: 's1', month: '2024-03-01', factor: d('1.02') },
    { subscriptionId: 's1', month: '2024-01-01', factor: d('1.01') },
    { subscriptionId: 's2', month: '2024-02-01', factor: d('1.5') },
  ]);

  it('returns the latest factor whose month is on or before the date, per subscription', () => {
    expect(factors('s1', '2023-12-31')).toBeNull();
    expectDec(factors('s1', '2024-01-01')!.factor, '1.01');
    expectDec(factors('s1', '2024-02-29')!.factor, '1.01');
    expectDec(factors('s1', '2024-03-01')!.factor, '1.02');
    expect(factors('s1', '2030-01-01')).toMatchObject({ month: '2024-03-01' });
    expectDec(factors('s2', '2024-02-01')!.factor, '1.5');
    expect(factors('nope', '2024-03-01')).toBeNull();
  });

  it('rejects a month that is not the 1st, a factor <= 0 and two factors for one month', () => {
    const f = (month: string, factor = '1') => ({ subscriptionId: 's', month, factor: d(factor) });
    expect(() => createCaFactorLookup([f('2024-01-15')])).toThrow(/not a 1st/);
    expect(() => createCaFactorLookup([f('2024-13-01')])).toThrow(RangeError);
    expect(() => createCaFactorLookup([f('2024-01-01', '0')])).toThrow(/> 0/);
    expect(() => createCaFactorLookup([f('2024-01-01'), f('2024-01-01', '2')])).toThrow(
      /Duplicate/,
    );
  });
});
