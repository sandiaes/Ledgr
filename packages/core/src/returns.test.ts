import { describe, expect, it } from 'vitest';
import { investmentCashFlows } from './cashflows';
import { Decimal } from './decimal';
import {
  twrSteps,
  bestWorstMonth,
  monthlyReturns,
  periodReturns,
  valueSeries,
  yearlyReturns,
  type CalendarReturn,
  type ValueSnapshot,
} from './returns';
import { buy, d, dividend, expectClose, expectDec } from './test-utils';
import type { Transaction } from './types';
import { xirr } from './xirr';

const snap = (date: string, value: string, netInvested: string): ValueSnapshot => ({
  date,
  valueEur: d(value),
  netInvestedEur: d(netInvested),
});

const byPeriod = (rows: ReturnType<typeof periodReturns>) =>
  Object.fromEntries(rows.map((r) => [r.period, r]));

describe('periodReturns', () => {
  // Buy 1,000 on 2022-06-01; worth 1,500 on 2022-12-31 and 2,000 on 2023-06-01 (T).
  const transactions = [buy('2022-06-01', 'A', '10', '100')];
  const snapshots = [snap('2022-06-01', '1000', '1000'), snap('2022-12-31', '1500', '1000')];
  const input = { transactions, snapshots, today: '2023-06-01', valueTodayEur: d('2000') };
  const r = byPeriod(periodReturns(input));

  it('since start, one year doubling: XIRR and TWR are 100%, annualized', () => {
    const s = r.sinceStart!;
    expect([s.start, s.fromStart, s.days]).toEqual(['2022-05-31', true, 365]);
    if (!s.xirr.ok || !s.twr.ok) throw new Error('expected rates');
    expectClose(s.xirr.annualRate, '1', '1e-12');
    expect(s.xirr.annualized).toBe(true);
    expectClose(s.xirr.displayRate, '1', '1e-12');
    // 0 -> 1,000 (first buy, start-of-day rule: 0%), -> 1,500 (+50%), -> 2,000 (+33.3%)
    expectClose(s.twr.cumulative, '1', '1e-40');
    expectClose(s.twr.annualized, '1', '1e-40');
  });

  it('since start XIRR is exactly xirr(investmentCashFlows(...))', () => {
    const direct = xirr(
      investmentCashFlows(transactions, { asOf: '2023-06-01', terminalValueEur: d('2000') }),
    );
    const s = r.sinceStart!;
    if (!direct.ok || !s.xirr.ok) throw new Error('expected rates');
    expectDec(s.xirr.annualRate, direct.rate);
  });

  it('YTD: from the 31 December snapshot, shorter than a year so not annualized', () => {
    // 1,500 -> 2,000 over 152 days: period return 1/3 for both
    const y = r.ytd!;
    expect([y.start, y.fromStart, y.days]).toEqual(['2022-12-31', false, 152]);
    if (!y.xirr.ok || !y.twr.ok) throw new Error('expected rates');
    expect(y.xirr.annualized).toBe(false);
    expectClose(y.xirr.displayRate, d('1').div(3), '1e-12');
    expectClose(
      y.xirr.annualRate,
      new Decimal(4).div(3).pow(new Decimal(365).div(152)).minus(1),
      '1e-12',
    );
    expectClose(y.twr.cumulative, d('1').div(3), '1e-40');
    expect(y.twr.annualized).toBeNull();
  });

  it('1Y: from the snapshot a year ago', () => {
    const y = r['1y']!;
    expect([y.start, y.fromStart]).toEqual(['2022-06-01', false]);
    if (!y.xirr.ok || !y.twr.ok) throw new Error('expected rates');
    expectClose(y.xirr.annualRate, '1', '1e-12');
    expectClose(y.twr.cumulative, '1', '1e-40');
  });

  it('half a year up 10%: shows the 10% period rate; the annual rate is about 21%', () => {
    // 1,000 on 2022-12-31 -> 1,100 on 2023-07-02 (183 days)
    const half = byPeriod(
      periodReturns({
        transactions: [buy('2022-01-03', 'A', '10', '100')],
        snapshots: [snap('2022-12-31', '1000', '1000')],
        today: '2023-07-02',
        valueTodayEur: d('1100'),
      }),
    ).ytd!;
    if (!half.xirr.ok) throw new Error('expected a rate');
    expect(half.days).toBe(183);
    expectClose(half.xirr.displayRate, '0.1', '1e-12');
    expectClose(
      half.xirr.annualRate,
      new Decimal('1.1').pow(new Decimal(365).div(183)).minus(1),
      '1e-12',
    );
    expectClose(half.xirr.annualRate, '0.21', '0.001');
  });

  it('a missing start snapshot gives a reason instead of a rate', () => {
    const y = byPeriod(periodReturns({ ...input, snapshots: [snapshots[0]!] })).ytd!;
    expect(y.xirr).toMatchObject({ ok: false, reason: 'snapshot-missing' });
    expect(y.twr).toMatchObject({ ok: false, reason: 'snapshot-missing' });
  });

  it('a portfolio started this year: YTD is effectively since start', () => {
    const y = byPeriod(
      periodReturns({
        transactions: [buy('2023-03-01', 'A', '10', '100')],
        snapshots: [snap('2023-03-01', '1000', '1000')],
        today: '2023-06-01',
        valueTodayEur: d('1100'),
      }),
    ).ytd!;
    expect(y.fromStart).toBe(true);
    if (!y.twr.ok) throw new Error('expected a rate');
    expectClose(y.twr.cumulative, '0.1', '1e-40');
  });

  it('no ledger rows: no-flows', () => {
    const [s] = periodReturns({
      transactions: [],
      snapshots: [],
      today: '2023-06-01',
      valueTodayEur: d('0'),
    });
    expect(s!.xirr).toMatchObject({ ok: false, reason: 'no-flows' });
  });
});

describe('valueSeries', () => {
  const snapshots = [
    snap('2024-02-27', '90', '80'),
    snap('2024-02-28', '95', '80'),
    snap('2024-02-29', '100', '80'),
    snap('2024-03-15', '110', '90'),
  ];
  const today = snap('2024-03-31', '120', '90');

  it('1M on 31 March starts on 29 February (28 in a common year)', () => {
    const s = valueSeries(snapshots, today, '1M');
    expect(s.from).toBe('2024-02-29');
    expect(s.points.map((p) => p.date)).toEqual(['2024-02-29', '2024-03-15', '2024-03-31']);
    expectDec(s.valueChangeEur, '20');
    expectDec(s.netInvestedChangeEur, '10');
    expect(valueSeries([], snap('2023-03-31', '1', '1'), '1M').from).toBe('2023-02-28');
  });

  it('All starts at the first snapshot; YTD on 31 December', () => {
    expect(valueSeries(snapshots, today, 'All').points).toHaveLength(5);
    expect(valueSeries(snapshots, today, 'YTD').from).toBe('2023-12-31');
    expect(valueSeries(snapshots, today, '1Y').from).toBe('2023-03-31');
    expect(valueSeries(snapshots, today, '3M').from).toBe('2023-12-31');
  });
});

describe('monthlyReturns and yearlyReturns', () => {
  // Jan: buy 10 @ 100 = 1,000 (imported, month-level), worth 1,100 on 31 Jan    -> +10%
  // Feb: buy 5 @ 110 = 550 on the 15th, worth 1,650 that day; 1,500 on 29 Feb
  //      (1,650 - 550) / 1,100 = 0%, then 1,500 / 1,650 - 1                     -> -1/11
  // Mar: dividend 30 on the 10th (no snapshot that day: added to the next point);
  //      worth 1,800 on 31 Mar: (1,800 + 30) / 1,500 - 1                          -> +22%
  // Apr: MTD to 10 Apr, still 1,800                                              -> 0%
  // 2024 YTD: 1.1 x 10/11 x 1.22 x 1 - 1                                         -> +22%
  const transactions: Transaction[] = [
    { ...buy('2024-01-01', 'A', '10', '100'), tradeDatePrecision: 'month' },
    buy('2024-02-15', 'A', '5', '110'),
    dividend('2024-03-10', '30', { asset: 'A' }),
  ];
  const snapshots = [
    snap('2024-01-31', '1100', '1000'),
    snap('2024-02-15', '1650', '1550'),
    snap('2024-02-29', '1500', '1550'),
    snap('2024-03-31', '1800', '1550'),
  ];
  const input = { transactions, snapshots, today: '2024-04-10', valueTodayEur: d('1800') };
  const months = monthlyReturns(input);
  const row = (period: string) => months.find((m) => m.period === period)!;

  it('one row per month, newest first, MTD on top', () => {
    expect(months.map((m) => [m.period, m.start, m.end, m.current])).toEqual([
      ['2024-04', '2024-03-31', '2024-04-10', true],
      ['2024-03', '2024-02-29', '2024-03-31', false],
      ['2024-02', '2024-01-31', '2024-02-29', false],
      ['2024-01', '2023-12-31', '2024-01-31', false],
    ]);
  });

  it('return, contributions, market gain and income by hand', () => {
    const fig = (m: CalendarReturn) => [
      m.contributionsEur.toString(),
      m.marketGainEur!.toString(),
      m.incomeEur.toString(),
      m.startValueEur!.toString(),
      m.endValueEur!.toString(),
    ];
    expectDec(row('2024-01').return, '0.1');
    expect(fig(row('2024-01'))).toEqual(['1000', '100', '0', '0', '1100']);
    expectClose(row('2024-02').return, d('-1').div(11), '1e-45');
    expect(fig(row('2024-02'))).toEqual(['550', '-150', '0', '1100', '1500']);
    expectDec(row('2024-03').return, '0.22');
    expect(fig(row('2024-03'))).toEqual(['0', '300', '30', '1500', '1800']);
    expectDec(row('2024-04').return, '0');
  });

  it('marks months with month-level imported rows as approximate', () => {
    expect(months.map((m) => m.approximate)).toEqual([false, false, false, true]);
  });

  it('the yearly return is the product of the monthly ones', () => {
    const [year] = yearlyReturns(input);
    expect([year!.period, year!.start, year!.end, year!.current]).toEqual([
      '2024',
      '2023-12-31',
      '2024-04-10',
      true,
    ]);
    const product = months.reduce((g, m) => g.times(m.return!.plus(1)), d('1')).minus(1);
    expectClose(year!.return, product, '1e-45');
    expectClose(year!.return, '0.22', '1e-45');
    expectDec(year!.contributionsEur, '1550');
    expectDec(year!.incomeEur, '30');
  });

  it('best and worst month: completed months only, MTD excluded', () => {
    const { best, worst } = bestWorstMonth(months);
    expect([best!.period, worst!.period]).toEqual(['2024-03', '2024-02']);
  });

  it('ties go to the earlier month', () => {
    const m = (period: string, r: string, current = false) =>
      ({ period, return: d(r), current }) as CalendarReturn;
    const { best, worst } = bestWorstMonth([
      m('2024-04', '0.5', true),
      m('2024-03', '0.1'),
      m('2024-02', '0.1'),
      m('2024-01', '-0.1'),
      m('2023-12', '-0.1'),
    ]);
    expect([best!.period, worst!.period]).toEqual(['2024-02', '2023-12']);
  });

  it('a missing month-end snapshot is reported, not guessed', () => {
    const gap = monthlyReturns({
      ...input,
      snapshots: snapshots.filter((s) => s.date !== '2024-02-29'),
    });
    const feb = gap.find((m) => m.period === '2024-02')!;
    const mar = gap.find((m) => m.period === '2024-03')!;
    expect([feb.return, feb.missing, feb.marketGainEur]).toEqual([null, 'snapshot-missing', null]);
    expect([mar.return, mar.missing]).toEqual([null, 'snapshot-missing']);
  });
});

describe('twrSteps', () => {
  // Buy 1,000 on 2022-06-01 (worth 1,000 that evening), 1,500 on 2022-12-31; buy 500 more on
  // 2023-03-01 (worth 2,100 that evening); 2,000 on T = 2023-06-01.
  const transactions = [buy('2022-06-01', 'A', '10', '100'), buy('2023-03-01', 'A', '5', '100')];
  const snapshots = [
    snap('2022-06-01', '1000', '1000'),
    snap('2022-12-31', '1500', '1000'),
    snap('2023-03-01', '2100', '1500'),
  ];
  const input = { transactions, snapshots, today: '2023-06-01', valueTodayEur: d('2000') };

  it('lists each step with its flow; the product is the period TWR', () => {
    const steps = twrSteps(input, 'sinceStart')!;
    expect(steps.map((s) => [s.from, s.date, s.fromZero, s.flowEur.toString()])).toEqual([
      ['2022-05-31', '2022-06-01', true, '1000'],
      ['2022-06-01', '2022-12-31', false, '0'],
      ['2022-12-31', '2023-03-01', false, '500'],
      ['2023-03-01', '2023-06-01', false, '0'],
    ]);
    expectDec(steps[2]!.return, d('1600').div('1500').minus(1)); // (2,100 - 500) / 1,500 - 1
    const product = steps.reduce((g, s) => g.times(s.return.plus(1)), d('1')).minus(1);
    const twr = byPeriod(periodReturns(input)).sinceStart!.twr;
    if (!twr.ok) throw new Error('expected a TWR');
    expectDec(product, twr.cumulative);
  });

  it('is null without rows or without the start snapshot', () => {
    expect(twrSteps({ ...input, transactions: [] }, 'sinceStart')).toBeNull();
    expect(twrSteps({ ...input, snapshots: [] }, 'ytd')).toBeNull();
  });
});
