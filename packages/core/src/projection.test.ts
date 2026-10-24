import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { periodReturns } from './returns';
import { assetScope } from './scope';
import {
  averageMonthlyNetPurchases,
  parseProjectionForm,
  projectGrowth,
  projectMonthByMonth,
  projectionDefaults,
  returnOutsideWarningRange,
  type ProjectionForm,
  type ProjectionInput,
} from './projection';
import { buy, d, dividend, expectClose, expectDec, redeem, sell, subscribe } from './test-utils';
import type { Asset } from './types';
import { buildProjection, type PortfolioInput, type ProjectionView } from './views';

const input = (over: Partial<ProjectionInput> = {}): ProjectionInput => ({
  startingValue: d('10000'),
  years: 10,
  extraMonths: 0,
  annualReturn: d('0.07'),
  monthlyContribution: d('0'),
  ...over,
});

// a = 1.01^12 - 1, so the monthly rate is exactly 1%.
const A_ONE_PERCENT_MONTHLY = d('0.126825030131969720661201');

describe('projectGrowth: closed form', () => {
  it('10,000 at 7% for 10 years with no contributions is 10,000 x 1.07^10', () => {
    const p = projectGrowth(input());
    expectDec(p.endingValue, d('10000').times(d('1.07').pow(10)));
    expect(p.endingValue.toFixed(2)).toBe('19671.51'); // 19,671.5135...
    expect(p.months).toBe(120);
    expectDec(p.totalContributed, '10000');
    expect(p.totalGrowth.toFixed(2)).toBe('9671.51');
    // share = 1 - 10,000 / ending value
    expectClose(p.growthShare, d('1').minus(d('10000').div(p.endingValue)), '1e-40');
    expect(p.growthShare?.times(100).toFixed(2)).toBe('49.17');
    expect(p.endingValueReal).toBeNull();
  });

  it('the monthly rate compounds twelve months to the annual rate', () => {
    const p = projectGrowth(input({ annualReturn: A_ONE_PERCENT_MONTHLY }));
    expectClose(p.monthlyRate, '0.01', '1e-40');
    expectClose(d('1').plus(p.monthlyRate).pow(12), d('1').plus(A_ONE_PERCENT_MONTHLY), '1e-40');
    // 7% a year is 0.5654%, not 7% / 12 = 0.5833%.
    expect(projectGrowth(input()).monthlyRate.times(100).toFixed(4)).toBe('0.5654');
  });

  it('a zero rate adds the contributions to the starting value, for either timing', () => {
    for (const timing of ['end', 'start'] as const) {
      const p = projectGrowth(
        input({
          annualReturn: d('0'),
          startingValue: d('1000'),
          monthlyContribution: d('100'),
          years: 1,
          timing,
        }),
      );
      expectDec(p.monthlyRate, '0');
      expectDec(p.endingValue, '2200');
      expectDec(p.totalContributed, '2200');
      expectDec(p.totalGrowth, '0');
      expectDec(p.growthShare, '0');
    }
  });

  it('zero contributions: only the starting value grows', () => {
    const p = projectGrowth(
      input({ monthlyContribution: d('0'), years: 1, startingValue: d('500') }),
    );
    expectDec(p.endingValue, d('500').times('1.07'));
    expectDec(p.totalContributed, '500');
  });

  it('only contributions, from nothing: 100 a month for 12 months at 0% is 1,200', () => {
    const p = projectGrowth(
      input({
        startingValue: d('0'),
        annualReturn: d('0'),
        monthlyContribution: d('100'),
        years: 1,
      }),
    );
    expectDec(p.endingValue, '1200');
    expectDec(p.totalContributed, '1200');
  });

  it('a negative rate shrinks the balance: -10% for 2 years is x 0.9^2', () => {
    const p = projectGrowth(input({ startingValue: d('1000'), annualReturn: d('-0.1'), years: 2 }));
    expectDec(p.endingValue, '810');
    expectDec(p.totalGrowth, '-190');
    expectDec(p.growthShare, d('-190').div('810'));
    expect(p.monthlyRate.isNegative()).toBe(true);
    expect(p.rows.map((r) => r.balance.toString())).toEqual(['900', '810']);
  });

  it('a negative rate with contributions follows the same recursion', () => {
    const i = input({
      annualReturn: d('-0.05'),
      monthlyContribution: d('250'),
      years: 3,
      extraMonths: 5,
    });
    const series = projectMonthByMonth(i);
    expectClose(projectGrowth(i).endingValue, series[series.length - 1] as Decimal, '1e-30');
  });

  it('zero years and zero months: the balance stays the starting value, no rows', () => {
    const p = projectGrowth(
      input({ years: 0, monthlyContribution: d('100'), startingValue: d('500') }),
    );
    expect(p.months).toBe(0);
    expectDec(p.endingValue, '500');
    expectDec(p.totalContributed, '500');
    expectDec(p.totalGrowth, '0');
    expectDec(p.growthShare, '0');
    expect(p.rows).toEqual([]);
  });

  it('an empty projection has no growth share', () => {
    const p = projectGrowth(input({ startingValue: d('0'), years: 5 }));
    expectDec(p.endingValue, '0');
    expect(p.growthShare).toBeNull();
  });

  it('end of month vs start of month, 100 a month at 1% a month from nothing', () => {
    const base = {
      startingValue: d('0'),
      annualReturn: A_ONE_PERCENT_MONTHLY,
      monthlyContribution: d('100'),
    };
    // end:   100, then 100 x 1.01 + 100 = 201
    // start: (0 + 100) x 1.01 = 101, then (101 + 100) x 1.01 = 203.01
    const end = projectMonthByMonth(input({ ...base, years: 0, extraMonths: 2, timing: 'end' }));
    expect(end.map((b) => b.toDecimalPlaces(10).toString())).toEqual(['0', '100', '201']);
    const start = projectMonthByMonth(
      input({ ...base, years: 0, extraMonths: 2, timing: 'start' }),
    );
    expect(start.map((b) => b.toDecimalPlaces(10).toString())).toEqual(['0', '101', '203.01']);

    const closedEnd = projectGrowth(input({ ...base, years: 0, extraMonths: 2 }));
    const closedStart = projectGrowth(
      input({ ...base, years: 0, extraMonths: 2, timing: 'start' }),
    );
    expectClose(closedEnd.endingValue, '201', '1e-40');
    expectClose(closedStart.endingValue, '203.01', '1e-40');
    // The start-of-month balance is always the end-of-month balance x (1 + i).
    expectClose(closedStart.endingValue, closedEnd.endingValue.times('1.01'), '1e-40');
  });

  it("inflation: 1,000 at 0% for 2 years at 10% inflation is 1,000 / 1.21 in today's money", () => {
    const p = projectGrowth(
      input({ startingValue: d('1000'), annualReturn: d('0'), years: 2, inflation: d('0.1') }),
    );
    expectDec(p.endingValue, '1000');
    expectClose(p.endingValueReal, d('1000').div('1.21'), '1e-40');
    expect(p.endingValueReal?.toFixed(2)).toBe('826.45');
    // zero inflation: no "today's money" figure
    expect(projectGrowth(input({ inflation: d('0') })).endingValueReal).toBeNull();
  });

  it('inflation uses the exact timeline, extra months included', () => {
    const p = projectGrowth(
      input({
        startingValue: d('1000'),
        annualReturn: d('0'),
        years: 1,
        extraMonths: 6,
        inflation: d('0.21'),
      }),
    );
    // 1.21^(18/12) = 1.1^3 = 1.331
    expectClose(p.endingValueReal, d('1000').div('1.331'), '1e-40');
  });

  it('long horizons: 60 years and the 100 year maximum', () => {
    const sixty = projectGrowth(
      input({ startingValue: d('1000'), years: 60, monthlyContribution: d('0') }),
    );
    expectDec(sixty.endingValue, d('1000').times(d('1.07').pow(60)));
    expect(sixty.rows).toHaveLength(60);
    const flat = projectGrowth(
      input({
        annualReturn: d('0'),
        startingValue: d('0'),
        monthlyContribution: d('50'),
        years: 100,
      }),
    );
    expectDec(flat.endingValue, '60000');
    expect(flat.months).toBe(1200);
    expect(() => projectGrowth(input({ years: 100, extraMonths: 1 }))).toThrow(RangeError);
  });

  it('year-by-year rows: every 12 months, then a part year for the extra months', () => {
    const p = projectGrowth(
      input({
        startingValue: d('1000'),
        annualReturn: d('0'),
        monthlyContribution: d('10'),
        years: 2,
        extraMonths: 3,
      }),
    );
    expect(p.rows.map((r) => [r.months, r.years, r.partYear])).toEqual([
      [12, 1, false],
      [24, 2, false],
      [27, 2, true],
    ]);
    expect(p.rows.map((r) => r.balance.toString())).toEqual(['1120', '1240', '1270']);
    expect(p.rows.map((r) => r.contributed.toString())).toEqual(['1120', '1240', '1270']);
    expect(p.rows.map((r) => r.growth.toString())).toEqual(['0', '0', '0']);
    expectDec(p.rows[2]?.balance, p.endingValue);
  });

  it('each row equals the month-by-month balance at that month', () => {
    const i = input({ monthlyContribution: d('300'), years: 5, extraMonths: 7, timing: 'start' });
    const series = projectMonthByMonth(i);
    for (const r of projectGrowth(i).rows) {
      expectClose(r.balance, series[r.months] as Decimal, '1e-30');
      expectDec(r.growth, r.balance.minus(r.contributed));
    }
  });

  it('refuses inputs that make no sense', () => {
    expect(() => projectGrowth(input({ startingValue: d('-1') }))).toThrow(RangeError);
    expect(() => projectGrowth(input({ monthlyContribution: d('-1') }))).toThrow(RangeError);
    expect(() => projectGrowth(input({ annualReturn: d('-1') }))).toThrow(RangeError);
    expect(() => projectGrowth(input({ annualReturn: d('-2') }))).toThrow(RangeError);
    expect(() => projectGrowth(input({ inflation: d('-0.01') }))).toThrow(RangeError);
    expect(() => projectGrowth(input({ years: -1 }))).toThrow(RangeError);
    expect(() => projectGrowth(input({ years: 1.5 }))).toThrow(RangeError);
    expect(() => projectGrowth(input({ extraMonths: 12 }))).toThrow(RangeError);
    expect(() => projectGrowth(input({ extraMonths: -1 }))).toThrow(RangeError);
  });

  it('property: the final month-by-month balance equals the closed form', () => {
    fc.assert(
      fc.property(
        fc.record({
          startCents: fc.integer({ min: 0, max: 100_000_000_00 }),
          contributionCents: fc.integer({ min: 0, max: 1_000_000_00 }),
          rateBp: fc.integer({ min: -5000, max: 10_000 }), // -50% .. +100%
          years: fc.integer({ min: 0, max: 60 }),
          extraMonths: fc.integer({ min: 0, max: 11 }),
          timing: fc.constantFrom('end', 'start'),
        }),
        (r) => {
          const i: ProjectionInput = {
            startingValue: new Decimal(r.startCents).div(100),
            monthlyContribution: new Decimal(r.contributionCents).div(100),
            annualReturn: new Decimal(r.rateBp).div(10_000),
            years: r.years,
            extraMonths: r.extraMonths,
            timing: r.timing as 'end' | 'start',
          };
          const series = projectMonthByMonth(i);
          const closed = projectGrowth(i);
          expect(series).toHaveLength(closed.months + 1);
          const last = series[series.length - 1] as Decimal;
          const tolerance = new Decimal('1e-30').times(Decimal.max(1, last.abs()));
          expect(last.minus(closed.endingValue).abs().lte(tolerance)).toBe(true);
          // rows too, and growth identities
          for (const row of closed.rows) {
            const s = series[row.months] as Decimal;
            expect(
              s
                .minus(row.balance)
                .abs()
                .lte(new Decimal('1e-30').times(Decimal.max(1, s))),
            ).toBe(true);
          }
          expect(closed.totalGrowth.eq(closed.endingValue.minus(closed.totalContributed))).toBe(
            true,
          );
          expect(closed.endingValue.isNegative()).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('averageMonthlyNetPurchases', () => {
  const T = '2026-10-24';

  it('is net buys minus sells over the last 12 months, divided by 12', () => {
    const p = averageMonthlyNetPurchases(
      [
        buy('2024-01-01', 'A', '1', '9999'), // before the window
        buy('2025-12-01', 'A', '60', '100'), // +6,000
        sell('2026-02-01', 'A', '12', '100'), // -1,200
        buy('2026-10-24', 'A', '1', '200', { fees: '10' }), // +210 (today counts, fees in)
        dividend('2026-05-01', '500', { asset: 'A' }), // income is not a purchase
      ],
      T,
    );
    expectDec(p.averageEur, d('5010').div(12)); // 417.50
    expect(p.averageEur.toFixed(2)).toBe('417.50');
    expect(p.months).toBe(12);
    expect(p.from).toBe('2025-10-24');
    expect(p.to).toBe(T);
    expectDec(p.contributionEur, p.averageEur);
  });

  it('the window is (today - 12 months, today]: its first day is out, the next is in', () => {
    const rows = [buy('2024-01-01', 'A', '1', '1')];
    const out = averageMonthlyNetPurchases([...rows, buy('2025-10-24', 'A', '12', '100')], T);
    expectDec(out.averageEur, d('1').div(12).times(0)); // only the 1 EUR row is before, 0 inside
    const inside = averageMonthlyNetPurchases([...rows, buy('2025-10-25', 'A', '12', '100')], T);
    expectDec(inside.averageEur, '100'); // 1,200 / 12
  });

  it('a history shorter than a year divides by its whole months, at least 1', () => {
    const three = averageMonthlyNetPurchases([buy('2026-07-24', 'A', '3', '100')], T);
    expect(three.months).toBe(3);
    expectDec(three.averageEur, '100'); // 300 / 3
    const days = averageMonthlyNetPurchases([buy('2026-10-20', 'A', '1', '50')], T);
    expect(days.months).toBe(1);
    expectDec(days.averageEur, '50');
    const eleven = averageMonthlyNetPurchases([buy('2025-11-24', 'A', '11', '100')], T);
    expect(eleven.months).toBe(11);
    expectDec(eleven.averageEur, '100');
  });

  it('a net seller averages below 0, but the default contribution is 0', () => {
    const p = averageMonthlyNetPurchases(
      [buy('2024-01-01', 'A', '100', '100'), sell('2026-01-01', 'A', '12', '100')],
      T,
    );
    expectDec(p.averageEur, '-100');
    expectDec(p.contributionEur, '0');
  });

  it('subscriptions and redemptions count like buys and sells', () => {
    const p = averageMonthlyNetPurchases(
      [
        buy('2024-01-01', 'A', '1', '1'),
        subscribe('2026-03-01', 'CA', '2400', '1'),
        redeem('2026-04-01', 'CA', '1200', '1'),
      ],
      T,
    );
    expectDec(p.averageEur, '100'); // 1,200 / 12
  });

  it('follows the asset scope: certificados can be left out', () => {
    const assets: Asset[] = [
      { id: 'A', assetType: 'etf', tradingCurrency: 'EUR' },
      { id: 'CA', assetType: 'certificado_aforro', tradingCurrency: 'EUR' },
    ];
    const rows = [
      buy('2024-01-01', 'A', '1', '1'),
      buy('2026-03-01', 'A', '6', '100'), // 600
      subscribe('2026-04-01', 'CA', '1200', '1'), // 1,200
    ];
    expectDec(averageMonthlyNetPurchases(rows, T).averageEur, '150'); // 1,800 / 12
    const scope = assetScope({ assets, excludeTypes: ['certificado_aforro'] });
    expectDec(averageMonthlyNetPurchases(rows, T, scope).averageEur, '50'); // 600 / 12
  });

  it('nothing in scope: 0', () => {
    const p = averageMonthlyNetPurchases([], T);
    expectDec(p.averageEur, '0');
    expectDec(p.contributionEur, '0');
  });
});

describe('projectionDefaults and buildProjection', () => {
  const T = '2026-10-24';
  const assets: Asset[] = [
    { id: 'A', assetType: 'etf', tradingCurrency: 'EUR' },
    { id: 'CA1', assetType: 'certificado_aforro', tradingCurrency: 'EUR' },
  ];
  // A: 10 @ 100 on 2025-10-24 (365 days before T), quote 110 today -> 1,000 -> 1,100: +10%.
  // CA1: 1,000 units @ 1 the same day, factor 1.05 -> 1,050: +5%.
  // Together 2,000 -> 2,150: XIRR and TWR 7.5% (one dated flow, 365 days).
  const portfolio = (over: Partial<PortfolioInput> = {}): PortfolioInput => ({
    today: T,
    transactions: [
      buy('2025-10-24', 'A', '10', '100'),
      subscribe('2025-10-24', 'CA1', '1000', '1', { id: 'ca-sub' }),
    ],
    assets,
    prices: [],
    liveQuotes: [{ assetId: 'A', date: T, close: d('110'), currency: 'EUR' }],
    fx: [],
    ca: {
      subscriptions: [{ id: 's1', seriesId: 'E', transactionId: 'ca-sub' }],
      factors: [{ subscriptionId: 's1', month: '2026-10-01', factor: d('1.05') }],
    },
    snapshots: [],
    ...over,
  });
  const view = (i: PortfolioInput) => {
    const v = buildProjection(i);
    expect(v.status).toBe('ok');
    return v as ProjectionView;
  };

  it('starts from the value now, XIRR since start and the average purchases', () => {
    const v = view(portfolio());
    expect(v.excludeTypes).toEqual([]);
    const x = v.defaults;
    expectDec(x.startingValueEur, '2150');
    expect(x.defaultSource).toBe('xirr');
    expectClose(x.xirr?.rate, '0.075', '1e-9');
    expectClose(x.twr?.rate, '0.075', '1e-9');
    expect(x.xirr).toMatchObject({ from: '2025-10-24', to: T, days: 365, shortHistory: false });
    expectDec(x.purchases.averageEur, '0'); // both buys are on the window's first day: out
  });

  it('without certificados every default is recomputed for the portfolio left', () => {
    const v = view(portfolio({ excludeTypes: ['certificado_aforro'] }));
    expect(v.excludeTypes).toEqual(['certificado_aforro']);
    expectDec(v.defaults.startingValueEur, '1100');
    expectClose(v.defaults.xirr?.rate, '0.1', '1e-9');
    expectClose(v.defaults.twr?.rate, '0.1', '1e-9');
  });

  it('falls back from XIRR to annualized TWR, then to nothing', () => {
    const returns = periodReturns({
      transactions: portfolio().transactions,
      snapshots: [],
      today: T,
      valueTodayEur: d('2150'),
    });
    const base = { transactions: portfolio().transactions, today: T, valueTodayEur: d('2150') };
    const sinceStart = returns[0];
    if (!sinceStart) throw new Error('no period');
    const failedXirr = { ok: false, reason: 'no-sign-change', message: 'x' } as const;
    const noXirr = projectionDefaults({
      ...base,
      returns: [{ ...sinceStart, xirr: failedXirr }],
    });
    expect(noXirr.xirr).toBeNull();
    expect(noXirr.defaultSource).toBe('twr');
    const short = projectionDefaults({
      ...base,
      returns: [
        {
          ...sinceStart,
          xirr: failedXirr,
          twr: { ok: true, cumulative: d('0.02'), annualized: null },
        },
      ],
    });
    expect(short.twr).toBeNull();
    expect(short.defaultSource).toBeNull();
    expect(projectionDefaults({ ...base, returns: [] }).defaultSource).toBeNull();
  });

  it('a history under a year is flagged as short', () => {
    const v = view(
      portfolio({
        transactions: [buy('2026-07-24', 'A', '10', '100')],
        excludeTypes: ['certificado_aforro'],
      }),
    );
    expect(v.defaults.xirr).toMatchObject({ days: 92, shortHistory: true, from: '2026-07-24' });
    expect(v.defaults.twr).toBeNull(); // annualized TWR needs a year
    expect(v.defaults.purchases.months).toBe(3);
  });
});

describe('returnOutsideWarningRange', () => {
  it('warns outside -20% .. +30%, not on the edges', () => {
    expect(returnOutsideWarningRange(d('-0.2'))).toBe(false);
    expect(returnOutsideWarningRange(d('0.3'))).toBe(false);
    expect(returnOutsideWarningRange(d('-0.2001'))).toBe(true);
    expect(returnOutsideWarningRange(d('0.3001'))).toBe(true);
    expect(returnOutsideWarningRange(d('0.07'))).toBe(false);
  });
});

describe('parseProjectionForm', () => {
  const form = (over: Partial<ProjectionForm> = {}): ProjectionForm => ({
    startingValue: '10000',
    years: '10',
    extraMonths: '',
    annualReturnPct: '7',
    monthlyContribution: '0',
    inflationPct: '',
    timing: 'end',
    ...over,
  });
  const errorsOf = (over: Partial<ProjectionForm>) => {
    const r = parseProjectionForm(form(over));
    return r.ok ? null : r.errors;
  };

  it('turns typed text into a projection input (percent -> fraction)', () => {
    const r = parseProjectionForm(
      form({
        startingValue: '1 000'.replace(' ', ''),
        annualReturnPct: '7,5',
        inflationPct: '2',
        extraMonths: '3',
        timing: 'start',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectDec(r.input.startingValue, '1000');
    expectDec(r.input.annualReturn, '0.075');
    expectDec(r.input.inflation, '0.02');
    expect([r.input.years, r.input.extraMonths, r.input.timing]).toEqual([10, 3, 'start']);
    expect(projectGrowth(r.input).months).toBe(123);
  });

  it('blank extra months and inflation are 0; zero contribution and zero years are valid', () => {
    const r = parseProjectionForm(form({ years: '0', monthlyContribution: '0' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect([r.input.extraMonths, r.input.inflation?.toString()]).toEqual([0, '0']);
  });

  it('refuses empty required fields, text, negatives and over-large values, per field', () => {
    expect(errorsOf({ startingValue: '' })).toEqual({ startingValue: 'empty' });
    expect(errorsOf({ startingValue: 'abc' })).toEqual({ startingValue: 'not_a_number' });
    expect(errorsOf({ startingValue: '-1' })).toEqual({ startingValue: 'negative' });
    expect(errorsOf({ startingValue: '1000000001' })).toEqual({ startingValue: 'too_large' });
    expect(errorsOf({ monthlyContribution: '-5' })).toEqual({ monthlyContribution: 'negative' });
    expect(errorsOf({ monthlyContribution: '10000001' })).toEqual({
      monthlyContribution: 'too_large',
    });
    expect(errorsOf({ years: '' })).toEqual({ years: 'empty' });
    expect(errorsOf({ years: '2.5' })).toEqual({ years: 'not_whole' });
    expect(errorsOf({ years: '-2' })).toEqual({ years: 'negative' });
    expect(errorsOf({ years: '61' })).toEqual({ years: 'too_large' });
    expect(errorsOf({ extraMonths: '12' })).toEqual({ extraMonths: 'too_large' });
    expect(errorsOf({ annualReturnPct: '' })).toEqual({ annualReturn: 'empty' });
    expect(errorsOf({ annualReturnPct: '-50.01' })).toEqual({ annualReturn: 'too_small' });
    expect(errorsOf({ annualReturnPct: '100.01' })).toEqual({ annualReturn: 'too_large' });
    expect(errorsOf({ inflationPct: '-1' })).toEqual({ inflation: 'negative' });
    expect(errorsOf({ inflationPct: '50.5' })).toEqual({ inflation: 'too_large' });
    expect(errorsOf({ years: 'x', annualReturnPct: 'y' })).toEqual({
      years: 'not_a_number',
      annualReturn: 'not_a_number',
    });
  });

  it('accepts the edges of the limits', () => {
    expect(
      errorsOf({
        annualReturnPct: '-50',
        startingValue: '1000000000',
        years: '60',
        extraMonths: '11',
      }),
    ).toBeNull();
    expect(
      errorsOf({ annualReturnPct: '100', inflationPct: '50', monthlyContribution: '10000000' }),
    ).toBeNull();
  });
});
