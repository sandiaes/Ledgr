import { describe, expect, it } from 'vitest';
import { bestWorstMonth, monthlyReturns, yearlyReturns } from './returns';
import {
  d,
  buy,
  dividend,
  expectClose,
  expectDec,
  fee,
  interest,
  sell,
  subscribe,
  transfer,
} from './test-utils';
import type { FxRow, PriceRow } from './lookups';
import type { StoredPriceRow } from './prices';
import type { ValueSnapshot } from './returns';
import { reconcile } from './sanity';
import { computeHoldings } from './holdings';
import { createFxLookup, createPriceLookup } from './lookups';
import type { Asset } from './types';
import { thinSeries } from './series';
import {
  buildAllocation,
  buildDashboard,
  buildPerformance,
  buildPositions,
  type AllocationView,
  type DashboardInput,
  type DashboardView,
  type PerformanceView,
  type PortfolioTotals,
  type PositionsView,
} from './views';

const T = '2025-06-10';
const assets: Asset[] = [
  { id: 'A', assetType: 'etf', tradingCurrency: 'EUR' },
  { id: 'B', assetType: 'stock', tradingCurrency: 'USD' },
  { id: 'C', assetType: 'stock', tradingCurrency: 'EUR' },
];
const close = (assetId: string, date: string, value: string, currency = 'EUR'): StoredPriceRow => ({
  assetId,
  date,
  close: d(value),
  currency,
  splitFactor: null,
});
const quote = (assetId: string, date: string, value: string, currency = 'EUR'): PriceRow => ({
  assetId,
  date,
  close: d(value),
  currency,
});
const usd = (date: string, rate: string): FxRow => ({ currency: 'USD', date, rateToEur: d(rate) });
const snap = (date: string, value: string, ni: string): ValueSnapshot => ({
  date,
  valueEur: d(value),
  netInvestedEur: d(ni),
});

// By hand (EUR):
//   A: buy 10 @ 100, sell 4 @ 110 (realized 40), dividend 5; 6 held, close 120 yesterday,
//      live quote 125 today -> V_A(T) 750, V_A(Y) 720, cost 600.
//   B: buy 5 @ 20 USD at fx 0.9 (cost 90); last close 25 USD on Friday 6 June, 4 days old
//      (stale) -> 5 x 25 x 0.9 = 112.5 on both days.
//   C: buy 2 @ 50, no price at all -> valued at its trade price ("price pending"): 100.
//   V(T) = 962.5, V(Y) = 932.5, F(T) = 0 -> D = 30.  NI = 1000 + 90 - 440 + 100 = 750.
//   Cost basis 790, U = 172.5, R = 40, I = 5, G = 217.5.  V - NI = 212.5 = R + U.
function input(over: Partial<DashboardInput> = {}): DashboardInput {
  return {
    today: T,
    transactions: [
      buy('2025-01-02', 'A', '10', '100'),
      buy('2025-03-03', 'B', '5', '20', { currency: 'USD', fx: '0.9' }),
      sell('2025-05-02', 'A', '4', '110'),
      dividend('2025-05-15', '5', { asset: 'A' }),
      buy('2025-06-01', 'C', '2', '50'),
    ],
    assets,
    prices: [close('A', '2025-06-06', '118'), close('A', '2025-06-09', '120')].concat(
      close('B', '2025-06-06', '25', 'USD'),
    ),
    liveQuotes: [quote('A', T, '125'), quote('B', T, '99', 'EUR')],
    fx: [usd('2025-06-06', '0.9')],
    ca: { subscriptions: [], factors: [] },
    snapshots: [snap('2025-04-30', '1100', '1090'), snap('2025-05-30', '900', '650')],
    ...over,
  };
}

const ok = (i: DashboardInput) => {
  const view = buildDashboard(i);
  expect(view.status).toBe('ok');
  return view as DashboardView;
};

describe('buildDashboard', () => {
  it('composes the header, gain and freshness figures (hand example)', () => {
    const v = ok(input());
    expect(v.empty).toBe(false);
    expectDec(v.totalValueEur, '962.5');
    expectDec(v.dayChange.changeEur, '30');
    expectDec(v.dayChange.changePct, d('30').div('932.5'));
    expectDec(v.netInvestedEur, '750');
    expectDec(v.costBasisEur, '790');
    expectDec(v.gains.realizedEur, '40');
    expectDec(v.gains.unrealizedEur, '172.5');
    expectDec(v.gains.incomeNetEur, '5');
    expectDec(v.gains.otherCostsEur, '0');
    expectDec(v.gains.totalReturnEur, '217.5');
    expectDec(v.unrealizedPct, d('172.5').div('790'));
    expect(v.reconcile).toEqual({ ok: true, issues: [] });

    expect(v.freshness.newestPriceDate).toBe(T);
    expect(v.freshness.stalePrices.map((f) => [f.assetId, f.asOf, f.ageDays])).toEqual([
      ['B', '2025-06-06', 4],
    ]);
    expect(v.freshness.pendingPrices.map((f) => f.assetId)).toEqual(['C']);
    expect(v.freshness.caFactor).toBeNull();
  });

  it('ignores a live quote in another currency than the listing', () => {
    // B's EUR quote of 99 would make B worth 495; it is skipped, B stays at its close.
    const v = ok(input());
    expect(v.allocation.map((s) => [s.key, s.valueEur.toString()])).toEqual([
      ['etf', '750'],
      ['stock', '212.5'],
    ]);
  });

  it('ranks movers by € and by %, leaving zero changes out', () => {
    const v = ok(input());
    expect(v.movers.eur.day.up.map((m) => [m.assetId, m.changeEur.toString()])).toEqual([
      ['A', '30'],
    ]);
    expect(v.movers.eur.day.down).toEqual([]);
    expect(v.movers.eur.total.up.map((m) => [m.assetId, m.changeEur.toString()])).toEqual([
      ['A', '150'],
      ['B', '22.5'],
    ]);
    // By %: A 150 / 600 and B 22.5 / 90 are both 25%; the tie goes to the larger value, A.
    expect(v.movers.pct.total.up.map((m) => m.assetId)).toEqual(['A', 'B']);
  });

  it('builds every chart range with today appended', () => {
    const v = ok(input());
    expect(v.series['1M'].points.map((p) => p.date)).toEqual(['2025-05-30', T]);
    expectDec(v.series['1M'].valueChangeEur, '62.5');
    expectDec(v.series['1M'].netInvestedChangeEur, '100');
    expect(v.series.All.points.map((p) => p.date)).toEqual(['2025-04-30', '2025-05-30', T]);
    expect(v.series.All.chart).toEqual(v.series.All.points);
    expect(Object.keys(v.series)).toEqual(['1M', '3M', 'YTD', '1Y', 'All']);
  });

  it('gives each chart range its return: market gain and TWR (docs/kpis.md §4.1)', () => {
    const v = ok(input());
    // 1M: from the 30 May snapshot (900, NI 650). Market gain (962.5 - 900) - (750 - 650) =
    // -37.5; TWR (962.5 - 100 bought on 1 Jun) / 900 - 1 = -1/24.
    const month = v.series['1M'].periodReturn;
    expect([month.start, month.end]).toEqual(['2025-05-30', T]);
    expectDec(month.marketGainEur, '-37.5');
    if (!month.twr.ok) throw new Error('expected a TWR');
    expectClose(month.twr.cumulative, d('-1').div(24), '1e-40');
    // All: from the day before the first row; gain V - NI = R + U = 212.5, TWR = Since start.
    const all = v.series.All.periodReturn;
    expect(all.start).toBe('2025-01-01');
    expectDec(all.marketGainEur, '212.5');
    const sinceStart = v.returns[0]!.twr;
    if (!all.twr.ok || !sinceStart.ok) throw new Error('expected a TWR');
    expectDec(all.twr.cumulative, sinceStart.cumulative);
    expectDec(all.marketGainEur, v.gains.realizedEur.plus(v.gains.unrealizedEur));
  });

  it('gives the three return periods, all from the start here', () => {
    const v = ok(input());
    expect(v.returns.map((r) => [r.period, r.fromStart])).toEqual([
      ['sinceStart', true],
      ['ytd', true],
      ['1y', true],
    ]);
    expect(v.returns.every((r) => r.xirr.ok && r.twr.ok)).toBe(true);
  });

  it('reports a currency without an FX rate instead of a wrong total', () => {
    const v = buildDashboard(input({ fx: [] }));
    expect(v).toEqual({
      status: 'unvalued',
      today: T,
      date: T,
      assetIds: ['B'],
      currencies: ['USD'],
    });
    // A rate from today only: yesterday has no value.
    const y = buildDashboard(input({ fx: [usd(T, '0.9')] }));
    expect(y.status === 'unvalued' && [y.date, y.currencies]).toEqual(['2025-06-09', ['USD']]);
  });

  it('shows the empty state only for a ledger with no rows', () => {
    const v = ok(input({ transactions: [], prices: [], liveQuotes: [], snapshots: [] }));
    expect(v.empty).toBe(true);
    expectDec(v.totalValueEur, '0');
    expect(v.dayChange.changePct).toBeNull();
    expect(v.allocation).toEqual([]);
  });

  it('flags a value-now total that differs from the app', () => {
    const same = ok(input({ reference: { totalValueEur: d('962.5'), costBasisEur: d('790') } }));
    expect(same.reconcile.ok).toBe(true);
    const older = ok(input({ reference: { totalValueEur: d('962.5'), costBasisEur: d('780') } }));
    expect(older.reconcile.issues).toEqual([{ check: 'value-now-cost' }]);
  });
});

describe('reconcile', () => {
  const txs = [
    buy('2025-01-02', 'A', '10', '100', { account: 'x' }),
    buy('2025-02-03', 'A', '5', '80', { account: 'y' }),
  ];
  const holdings = computeHoldings({
    transactions: txs,
    assets,
    asOf: T,
    prices: createPriceLookup([quote('A', T, '90')]),
    fx: createFxLookup([]),
  });
  // V = 1350, NI = 1400, U = -50, R = 0.

  it('passes when V - NI = R + U and the accounts add up', () => {
    const r = reconcile({
      holdings,
      gains: { realizedEur: d('0'), unrealizedEur: d('-50') },
      netInvestedEur: d('1400'),
    });
    expect(r).toEqual({ ok: true, issues: [] });
  });

  it('reports each broken identity by name', () => {
    const [h] = holdings;
    const broken = {
      ...h!,
      accounts: h!.accounts.map((a) => ({ ...a, quantity: a.quantity.plus(1) })),
    };
    const r = reconcile({
      holdings: [broken],
      gains: { realizedEur: d('1'), unrealizedEur: d('-50') },
      netInvestedEur: d('1400'),
      reference: { totalValueEur: d('1350.01'), costBasisEur: d('1400') },
    });
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([
      { check: 'capital-gain' },
      { check: 'accounts', assetId: 'A' },
      { check: 'value-now-value' },
    ]);
  });
});

describe('thinSeries', () => {
  const series = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: String(i).padStart(5, '0'),
      // A saw tooth with one low and one high outlier.
      valueEur: d(i === 400 ? '-5' : i === 700 ? '5000' : String(100 + (i % 17))),
    }));

  it('keeps short series as they are', () => {
    expect(thinSeries(series(300), 300)).toHaveLength(300);
  });

  it('keeps the first, the last and the extremes, in order, within the limit', () => {
    const all = series(2150);
    const thin = thinSeries(all, 300);
    expect(thin.length).toBeLessThanOrEqual(300);
    expect(thin[0]).toBe(all[0]);
    expect(thin[thin.length - 1]).toBe(all[2149]);
    expect(thin.map((p) => p.valueEur.toString())).toContain('-5');
    expect(thin.map((p) => p.valueEur.toString())).toContain('5000');
    const dates = thin.map((p) => p.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('refuses a limit too small to keep both ends and a bucket', () => {
    expect(() => thinSeries(series(10), 3)).toThrow(RangeError);
  });
});

// By hand (EUR), three brokers:
//   A (ETF): degiro buys 10 @ 100, ibkr buys 5 @ 110; degiro sells 4 @ 120 (its own lot:
//     realized 80); dividend 6 at degiro. Close 125 yesterday, quote 130 today:
//     degiro 6 units cost 600 value 780 U 180; ibkr 5 units cost 550 value 650 U 100.
//     D_A = 1430 - 1375 = 55 (4%).
//   B (USD stock) at ibkr: 5 @ 20 USD, fx 0.9 -> cost 90; close 25 USD four days old
//     (stale) -> 112.5, U 22.5.
//   C (crypto) at degiro: buy 2 @ 50, sell 2 @ 40 -> closed, realized -20.
//   CA1 at aforronet: 1000 units @ 1, factor 1.02 from May (40 days old, stale) -> 1020.
//   Fee 3 at ibkr, interest 2 at degiro (no asset).
//   V 2562.5, cost 2240, U 322.5, R 60, I 8, C 3, G 387.5.
//   degiro: V 780, cost 600, U 180, R 60, I 8, C 0, G 248.
//   ibkr: V 762.5, cost 640, U 122.5, R 0, I 0, C 3, G 119.5.
//   aforronet: V 1020, cost 1000, U 20, G 20.
const brokerAssets: Asset[] = [
  { id: 'A', assetType: 'etf', tradingCurrency: 'EUR' },
  { id: 'B', assetType: 'stock', tradingCurrency: 'USD' },
  { id: 'C', assetType: 'crypto', tradingCurrency: 'EUR' },
  { id: 'CA1', assetType: 'certificado_aforro', tradingCurrency: 'EUR' },
];
function brokerInput(over: Partial<DashboardInput> = {}): DashboardInput {
  return {
    today: T,
    transactions: [
      buy('2025-01-02', 'A', '10', '100', { account: 'degiro' }),
      subscribe('2025-01-15', 'CA1', '1000', '1', { id: 'ca-sub', account: 'aforronet' }),
      buy('2025-02-03', 'A', '5', '110', { account: 'ibkr' }),
      buy('2025-03-03', 'B', '5', '20', { account: 'ibkr', currency: 'USD', fx: '0.9' }),
      buy('2025-04-01', 'C', '2', '50', { account: 'degiro' }),
      sell('2025-05-02', 'A', '4', '120', { account: 'degiro' }),
      dividend('2025-05-15', '6', { asset: 'A', account: 'degiro' }),
      sell('2025-05-20', 'C', '2', '40', { account: 'degiro' }),
      fee('2025-06-01', '3', { account: 'ibkr' }),
      interest('2025-06-02', '2', { account: 'degiro' }),
    ],
    assets: brokerAssets,
    prices: [close('A', '2025-06-09', '125'), close('B', '2025-06-06', '25', 'USD')],
    liveQuotes: [quote('A', T, '130')],
    fx: [usd('2025-06-06', '0.9')],
    ca: {
      subscriptions: [{ id: 's1', seriesId: 'E', transactionId: 'ca-sub' }],
      factors: [{ subscriptionId: 's1', month: '2025-05-01', factor: d('1.02') }],
    },
    snapshots: [snap('2025-04-30', '2100', '2080'), snap('2025-05-31', '2500', '2160')],
    ...over,
  };
}
const positionsOk = (i: DashboardInput) => {
  const v = buildPositions(i);
  expect(v.status).toBe('ok');
  return v as PositionsView;
};
const FIELDS: (keyof PortfolioTotals)[] = [
  'valueEur',
  'costBasisEur',
  'unrealizedEur',
  'realizedEur',
  'incomeNetEur',
  'otherCostsEur',
  'totalGainEur',
];

describe('buildPositions', () => {
  it('lists open positions by value with weight, gain, day change and badges', () => {
    const v = positionsOk(brokerInput());
    expect(v.positions.map((p) => p.assetId)).toEqual(['A', 'CA1', 'B']);
    const [a, ca, b] = v.positions;
    expectDec(a?.units, '11');
    expectDec(a?.valueEur, '1430');
    expectDec(a?.weight, d('1430').div('2562.5'));
    expectDec(a?.unrealizedEur, '280');
    expectDec(a?.unrealizedPct, d('280').div('1150'));
    expectDec(a?.dayChangeEur, '55');
    expectDec(a?.dayChangePct, '0.04');
    expect(a?.accountIds).toEqual(['degiro', 'ibkr']);
    expect(a?.certificado).toBeNull();
    expect(b?.valuation).toMatchObject({ source: 'price', stale: true, asOf: '2025-06-06' });
    expectDec(b?.dayChangeEur, '0');

    // Certificados: units, latest factor and value.
    expectDec(ca?.units, '1000');
    expectDec(ca?.valueEur, '1020');
    expectDec(ca?.certificado?.unitValueEur, '1.02');
    expect(ca?.certificado).toMatchObject({ factorMonth: '2025-05-01', subscriptions: 1 });
    expect(ca?.valuation).toMatchObject({ source: 'factor', stale: true });

    expect(v.types.map((t) => [t.key, t.valueEur.toString()])).toEqual([
      ['etf', '1430'],
      ['certificado_aforro', '1020'],
      ['stock', '112.5'],
    ]);
    expect(v.newestPriceDate).toBe(T);
  });

  it('gives the totals and each broker with its own units', () => {
    const v = positionsOk(brokerInput());
    const t = v.totals;
    expectDec(t.valueEur, '2562.5');
    expectDec(t.costBasisEur, '2240');
    expectDec(t.unrealizedEur, '322.5');
    expectDec(t.realizedEur, '60');
    expectDec(t.incomeNetEur, '8');
    expectDec(t.otherCostsEur, '3');
    expectDec(t.totalGainEur, '387.5');

    expect(v.brokers.map((b) => b.accountId)).toEqual(['aforronet', 'degiro', 'ibkr']);
    const degiro = v.brokers[1];
    expectDec(degiro?.valueEur, '780');
    expectDec(degiro?.weight, d('780').div('2562.5'));
    expectDec(degiro?.realizedEur, '60');
    expectDec(degiro?.incomeNetEur, '8');
    expectDec(degiro?.totalGainEur, '248');
    const ibkr = v.brokers[2];
    expectDec(ibkr?.otherCostsEur, '3');
    expectDec(ibkr?.totalGainEur, '119.5');
    expect(ibkr?.positions.map((p) => p.assetId)).toEqual(['A', 'B']);
    const ibkrA = ibkr?.positions[0];
    expectDec(ibkrA?.units, '5');
    expectDec(ibkrA?.valueEur, '650');
    expectDec(ibkrA?.unrealizedEur, '100');
    expect(ibkrA?.accountIds).toEqual(['ibkr']);
    expect(ibkrA?.dayChangeEur).toBeNull();
  });

  it('broker figures add up exactly to the portfolio totals', () => {
    const v = positionsOk(brokerInput());
    expect(v.brokersReconcile).toBe(true);
    for (const f of FIELDS) {
      const sum = v.brokers.reduce((s, b) => s.plus(b[f]), d('0'));
      expectDec(sum, v.totals[f]);
      expectDec(v.brokerTotals[f], v.totals[f]);
    }
    // And each broker's rows add up to the broker.
    for (const b of v.brokers) {
      expectDec(
        b.positions.reduce((s, p) => s.plus(p.valueEur), d('0')),
        b.valueEur,
      );
    }
  });

  it('still adds up exactly with a transfer, thirds and an FX rate', () => {
    const v = positionsOk(
      brokerInput({
        transactions: [
          ...brokerInput().transactions,
          transfer('2025-06-03', 'A', '1.5', 'ibkr', { account: 'degiro', fees: '0.7' }),
          buy('2025-06-04', 'B', '0.333333333333333333', '21', {
            account: 'degiro',
            currency: 'USD',
            fx: '0.91',
          }),
        ],
        liveQuotes: [quote('A', T, '133.333333333333333333')],
        fx: [usd('2025-06-06', '0.912345')],
      }),
    );
    expect(v.brokersReconcile).toBe(true);
    for (const f of FIELDS) expectDec(v.brokerTotals[f], v.totals[f]);
  });

  it('gives each open position its detail, and closed positions apart', () => {
    const v = positionsOk(brokerInput());
    const a = v.details.A;
    expectDec(a?.realizedEur, '80');
    expectDec(a?.incomeEur, '6');
    expectDec(a?.dayChange?.changeEur, '55');
    expect(a?.accounts.map((l) => [l.accountId, l.units.toString()])).toEqual([
      ['degiro', '6'],
      ['ibkr', '5'],
    ]);
    const ca = v.details.CA1;
    expect(ca?.price).toBeNull();
    expect(ca?.certificados).toHaveLength(1);
    expectDec(ca?.certificados[0]?.unitValueEur, '1.02');
    expect(Object.keys(v.details).sort()).toEqual(['A', 'B', 'CA1']);

    expect(v.closed.map((c) => c.assetId)).toEqual(['C']);
    expectDec(v.closed[0]?.realizedEur, '-20');
    expectDec(v.closed[0]?.realizedPct, '-0.2');
  });

  it('reports a currency without an FX rate instead of wrong rows', () => {
    const v = buildPositions(brokerInput({ fx: [] }));
    expect(v).toMatchObject({ status: 'unvalued', assetIds: ['B'], currencies: ['USD'] });
  });
});

describe('buildAllocation', () => {
  it('groups by type, broker, currency and asset, with top 5 / 10', () => {
    const v = buildAllocation(brokerInput()) as AllocationView;
    expect(v.status).toBe('ok');
    expectDec(v.totalValueEur, '2562.5');
    const keys = (dim: keyof AllocationView['slices']) =>
      v.slices[dim].map((s) => [s.key, s.valueEur.toString()]);
    expect(keys('account')).toEqual([
      ['aforronet', '1020'],
      ['degiro', '780'],
      ['ibkr', '762.5'],
    ]);
    expect(keys('currency')).toEqual([
      ['EUR', '2450'],
      ['USD', '112.5'],
    ]);
    expect(keys('asset').map(([k]) => k)).toEqual(['A', 'CA1', 'B']);
    expect(keys('assetType')).toHaveLength(3);
    expect(v.top5.top).toHaveLength(3);
    expectDec(v.top5.topWeight, '1');
    expectDec(v.top10.topWeight, '1');
  });
});

describe('buildPerformance', () => {
  it('composes the monthly and yearly tables and the best / worst month', () => {
    const i = brokerInput();
    const v = buildPerformance(i) as PerformanceView;
    expect(v.status).toBe('ok');
    const returns = {
      transactions: i.transactions,
      snapshots: i.snapshots,
      today: T,
      valueTodayEur: d('2562.5'),
    };
    const months = monthlyReturns(returns);
    expect(v.months).toEqual(months);
    expect(v.years).toEqual(yearlyReturns(returns));
    expect({ best: v.best, worst: v.worst }).toEqual(bestWorstMonth(months));
    expect(v.months[0]).toMatchObject({ period: '2025-06', current: true });
    expect(v.years.map((y) => y.period)).toEqual(['2025']);
  });
});
