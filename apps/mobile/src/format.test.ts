import { dec } from '@ledgr/core';
import {
  formatAmount,
  formatDate,
  formatDateTime,
  formatEur,
  formatPct,
  formatPeriod,
  formatTime,
  formatUnits,
} from './format';

const NBSP = '\u00A0';

describe('pt-PT amounts', () => {
  it('groups thousands with a dot from 4 digits and uses a decimal comma', () => {
    expect(formatEur(dec('0'))).toBe(`0,00${NBSP}€`);
    expect(formatEur(dec('999'))).toBe(`999,00${NBSP}€`);
    expect(formatEur(dec('1000'))).toBe(`1.000,00${NBSP}€`);
    expect(formatEur(dec('1250.5'))).toBe(`1.250,50${NBSP}€`);
    expect(formatEur(dec('14250.5'))).toBe(`14.250,50${NBSP}€`);
    expect(formatEur(dec('1234567.89'))).toBe(`1.234.567,89${NBSP}€`);
  });

  it('puts the currency after the amount behind a no-break space, others by code', () => {
    expect(formatEur(dec('1'))).toMatch(/^1,00\u00A0€$/);
    expect(formatAmount(dec('412.37'), 'USD')).toBe(`412,37${NBSP}USD`);
    expect(formatAmount(dec('4'), 'CHF')).toBe(`4,00${NBSP}CHF`);
    expect(formatAmount(dec('1.10482'), 'EUR', { dp: 5 })).toBe(`1,10482${NBSP}€`);
    expect(formatAmount(dec('12.3'), 'GBP', { dp: 0 })).toBe(`12${NBSP}GBP`);
  });

  it('uses the real minus sign and an explicit plus, and no sign on zero', () => {
    expect(formatEur(dec('-1000'), { sign: true })).toBe(`−1.000,00${NBSP}€`);
    expect(formatEur(dec('-1000'))).toBe(`−1.000,00${NBSP}€`);
    expect(formatEur(dec('85.1'), { sign: true })).toBe(`+85,10${NBSP}€`);
    expect(formatEur(dec('85.1'))).toBe(`85,10${NBSP}€`);
    expect(formatEur(dec('0'), { sign: true })).toBe(`0,00${NBSP}€`);
    // Rounds to zero: no sign either way.
    expect(formatEur(dec('-0.004'), { sign: true })).toBe(`0,00${NBSP}€`);
  });

  it('rounds half up on the digits, never through a float', () => {
    expect(formatEur(dec('0.005'))).toBe(`0,01${NBSP}€`);
    expect(formatEur(dec('1.005'))).toBe(`1,01${NBSP}€`);
    expect(formatEur(dec('-1.005'))).toBe(`−1,01${NBSP}€`);
    expect(formatEur(dec('2.675'))).toBe(`2,68${NBSP}€`);
    expect(formatEur(dec('0.1').plus('0.2'))).toBe(`0,30${NBSP}€`);
  });
});

describe('pt-PT units and percentages', () => {
  it('units: up to 8 decimals, trailing zeros dropped, grouped', () => {
    expect(formatUnits(dec('1000'))).toBe('1.000');
    expect(formatUnits(dec('2.5'))).toBe('2,5');
    expect(formatUnits(dec('0.123456789'))).toBe('0,12345679');
    expect(formatUnits(dec('1234567.5'))).toBe('1.234.567,5');
    expect(formatUnits(dec('-3'))).toBe('−3');
    expect(formatUnits(dec('0'))).toBe('0');
  });

  it('percent: comma, no space, sign only when asked', () => {
    expect(formatPct(dec('0.0123'))).toBe('1,23%');
    expect(formatPct(dec('0.0123'), { sign: true })).toBe('+1,23%');
    expect(formatPct(dec('-0.0123'), { sign: true })).toBe('−1,23%');
    expect(formatPct(dec('0'), { sign: true })).toBe('0,00%');
    expect(formatPct(dec('-0.00001'), { sign: true })).toBe('0,00%');
    expect(formatPct(dec('12.3456'))).toBe('1234,56%');
    expect(formatPct(null)).toBe('—');
  });
});

describe('pt-PT dates and times', () => {
  it('dd/mm within the current year, dd/mm/yyyy otherwise', () => {
    expect(formatDate('2026-10-24', '2026')).toBe('24/10');
    expect(formatDate('2025-01-02', '2026')).toBe('02/01/2025');
    expect(formatDate('2026-10-24')).toBe('24/10/2026');
  });

  it('keeps English month names where a month is named', () => {
    expect(formatPeriod('2026-10')).toBe('Oct 2026');
    expect(formatPeriod('2026')).toBe('2026');
  });

  it('times are 24 hours', () => {
    const at = new Date(2026, 9, 24, 14, 5).getTime();
    expect(formatTime(at)).toBe('14:05');
    expect(formatTime(new Date(2026, 9, 24, 0, 7).getTime())).toBe('00:07');
    expect(formatDateTime(at, '2026')).toBe('24/10 14:05');
    expect(formatDateTime(at, '2027')).toBe('24/10/2026 14:05');
  });
});
