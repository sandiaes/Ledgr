import { describe, expect, it } from 'vitest';
import { d, expectClose, expectDec } from './test-utils';
import { twr, type ValuePoint } from './twr';

const p = (date: string, value: string, flow?: string): ValuePoint => ({
  date,
  value: d(value),
  ...(flow ? { flow: d(flow) } : {}),
});

describe('twr', () => {
  it('chains daily returns and strips out a deposit', () => {
    // day 1: 1000 -> 1100                      r1 = +10%
    // day 2: deposit 500, ends 1650            r2 = (1650 - 500)/1100 - 1 = 1150/1100 - 1
    // day 3: 1650 -> 1485                      r3 = -10%
    // cumulative = 1.1 * 1150/1100 * 0.9 - 1 = 1.15 * 0.9 - 1 = 0.035
    const r = twr([
      p('2024-01-01', '1000'),
      p('2024-01-02', '1100'),
      p('2024-01-03', '1650', '500'),
      p('2024-01-04', '1485'),
    ]);
    expectDec(r.periods[0]!.return, '0.1');
    expectDec(r.periods[1]!.return, d('1150').div('1100').minus(1));
    expectDec(r.periods[2]!.return, '-0.1');
    expectClose(r.cumulative, '0.035', '1e-45');
    expect(r.days).toBe(3);
    expect(r.annualized).toBeNull();
  });

  it('a withdrawal does not count as a loss', () => {
    // day 1: grows to 1050, then 500 withdrawn at end of day, value 550
    //        r = (550 - (-500))/1000 - 1 = 5%
    const r = twr([p('2024-01-01', '1000'), p('2024-01-02', '550', '-500')]);
    expectDec(r.cumulative, '0.05');
  });

  it('starts from zero on the first deposit', () => {
    // period into the first deposit is skipped; then 1000 -> 1050 = +5%
    const r = twr([p('2024-01-01', '0'), p('2024-01-02', '1000', '1000'), p('2024-01-03', '1050')]);
    expect(r.periods).toHaveLength(1);
    expectDec(r.cumulative, '0.05');
  });

  it('can close out to zero and restart', () => {
    // d2: 1000 -> 1100 (+10%)
    // d3: withdraw 1100 at end, value 0 -> r = (0 + 1100)/1100 - 1 = 0
    // d4: still 0, no flow -> skipped
    // d5: deposit 200 -> skipped (from zero)
    // d6: 200 -> 190 (-5%)
    // cumulative = 1.1 * 1 * 0.95 - 1 = 0.045
    const r = twr([
      p('2024-01-01', '1000'),
      p('2024-01-02', '1100'),
      p('2024-01-03', '0', '-1100'),
      p('2024-01-04', '0'),
      p('2024-01-05', '200', '200'),
      p('2024-01-06', '190'),
    ]);
    expectDec(r.cumulative, '0.045');
  });

  it('annualizes from 365 days', () => {
    // 2021-01-01 -> 2023-01-01 = 730 days; 1000 -> 1210 = +21% -> sqrt(1.21) - 1 = 10%
    const r = twr([p('2021-01-01', '1000'), p('2023-01-01', '1210')]);
    expectDec(r.cumulative, '0.21');
    expectClose(r.annualized, '0.1', '1e-40');
  });

  it('negative returns and total loss', () => {
    const loss = twr([p('2023-01-01', '1000'), p('2024-01-01', '700')]);
    expectDec(loss.cumulative, '-0.3');
    expectClose(loss.annualized, '-0.3', '1e-40');
    const wiped = twr([p('2023-01-01', '1000'), p('2024-06-01', '0')]);
    expectDec(wiped.cumulative, '-1');
    expectDec(wiped.annualized, '-1');
  });

  it('sorts input; trivial series', () => {
    const r = twr([p('2024-01-03', '121'), p('2024-01-01', '100'), p('2024-01-02', '110')]);
    expectClose(r.cumulative, '0.21', '1e-45');
    expectDec(twr([p('2024-01-01', '100')]).cumulative, '0');
    expect(twr([]).days).toBe(0);
  });

  it('rejects inconsistent series', () => {
    expect(() => twr([p('2024-01-01', '0'), p('2024-01-02', '10')])).toThrow(/from zero/);
    expect(() => twr([p('2024-01-01', '-5'), p('2024-01-02', '10')])).toThrow(/Negative/);
    expect(() => twr([p('2024-01-01', '1'), p('2024-01-01', '2')])).toThrow(/Duplicate/);
    expect(() => twr([p('2024-1-1', '1')])).toThrow(/Invalid/);
  });
});
