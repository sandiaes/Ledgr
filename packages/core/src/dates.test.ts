import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  assertIsoDate,
  compareDates,
  dayNumber,
  daysBetween,
  fromDayNumber,
  localDate,
  minDate,
  yearOf,
} from './dates';

describe('dates', () => {
  it('validates ISO dates strictly', () => {
    expect(() => assertIsoDate('2024-02-29')).not.toThrow();
    for (const bad of ['2023-02-29', '2024-13-01', '2024-00-10', '2024-1-1', '20240101', '']) {
      expect(() => assertIsoDate(bad)).toThrow(/Invalid ISO date/);
    }
  });

  it('counts days across leap years', () => {
    expect(daysBetween('2023-01-01', '2024-01-01')).toBe(365);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
    expect(daysBetween('2024-03-01', '2024-02-28')).toBe(-2);
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(fromDayNumber(dayNumber('2024-02-29'))).toBe('2024-02-29');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
  });

  it('adds months, clamping to month end', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2023-01-31', 1)).toBe('2023-02-28');
    expect(addMonths('2023-11-30', 3)).toBe('2024-02-29');
    expect(addMonths('2023-11-15', 14)).toBe('2025-01-15');
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(addMonths('2024-01-15', -13)).toBe('2022-12-15');
  });

  it('helpers', () => {
    expect(yearOf('2024-06-01')).toBe(2024);
    expect(compareDates('2024-01-01', '2024-01-02')).toBe(-1);
    expect(compareDates('2024-01-02', '2024-01-01')).toBe(1);
    expect(compareDates('2024-01-01', '2024-01-01')).toBe(0);
    expect(minDate('2024-01-02', '2024-01-01')).toBe('2024-01-01');
  });

  it('takes "today" in the owner time zone', () => {
    const at = (iso: string) => new Date(iso);
    expect(localDate(at('2026-07-01T23:30:00Z'), 'Europe/Lisbon')).toBe('2026-07-02');
    expect(localDate(at('2026-12-01T23:30:00Z'), 'Europe/Lisbon')).toBe('2026-12-01');
    expect(localDate(at('2026-12-31T23:59:59Z'), 'Europe/Lisbon')).toBe('2026-12-31');
  });
});
