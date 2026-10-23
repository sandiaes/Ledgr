import { describe, expect, it } from 'vitest';
import { d, buy, dividend, expectDec, sell } from './test-utils';
import type { FxRow, PriceRow } from './lookups';
import type { StoredPriceRow } from './prices';
import type { ValueSnapshot } from './returns';
import { reconcile } from './sanity';
import { computeHoldings } from './holdings';
import { createFxLookup, createPriceLookup } from './lookups';
import type { Asset } from './types';
import { buildDashboard, thinSeries, type DashboardInput, type DashboardView } from './views';

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
