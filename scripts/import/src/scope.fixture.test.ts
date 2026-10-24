// The certificados toggle on the fixture ledger (docs/app-plan.md §10.6): every figure with
// certificados excluded equals the same figure from the ledger with the certificado rows
// removed and its snapshots rebuilt. The ledger is fixtures/sample_*.csv through the
// importer's plan, exactly as it would be committed; prices are generated.
import {
  addDays,
  addMonths,
  assetScope,
  buildAllocation,
  buildDashboard,
  buildPerformance,
  buildPositions,
  buildSnapshot,
  createCaFactorLookup,
  createFxLookup,
  createPriceLookup,
  createTradePriceLookup,
  Decimal,
  splitAdjustPrices,
  transactionRows,
  type Asset,
  type AssetType,
  type CaFactor,
  type CaSubscription,
  type DashboardInput,
  type DashboardView,
  type IsoDate,
  type PositionsView,
  type StoredPriceRow,
  type Transaction,
  type ValueSnapshot,
} from '@ledgr/core';
import { describe, expect, it } from 'vitest';
import { plan } from './test/plan-helper';

const TODAY = '2026-10-24';
const CA: AssetType[] = ['certificado_aforro'];

const payload = plan().payload;
const assets: Asset[] = payload.assets.map((a) => ({
  id: a.id,
  assetType: a.asset_type,
  tradingCurrency: a.trading_currency,
}));
const transactions: Transaction[] = payload.transactions.map((t) => ({
  id: t.id,
  accountId: t.account_id,
  assetId: t.asset_id,
  type: t.type,
  tradeDate: t.trade_date,
  quantity: new Decimal(t.quantity),
  unitPrice: new Decimal(t.unit_price),
  amount: null,
  fees: new Decimal(0),
  currency: t.currency,
  fxRateToEur: new Decimal(t.fx_rate_to_eur),
  tradeDatePrecision: t.trade_date_precision,
}));
const subscriptions: CaSubscription[] = payload.ca_subscriptions.map((s) => ({
  id: s.id,
  seriesId: s.series_id,
  transactionId: s.transaction_id,
}));
// The imported factor (the ratio month) plus two earlier ones, so certificados move.
const factors: CaFactor[] = [
  ...payload.ca_factors.map((f) => ({
    subscriptionId: f.subscription_id,
    month: f.month,
    factor: new Decimal(f.factor),
  })),
  ...subscriptions.flatMap((s) => [
    { subscriptionId: s.id, month: '2024-01-01', factor: new Decimal('1.021') },
    { subscriptionId: s.id, month: '2025-06-01', factor: new Decimal('1.047') },
  ]),
];
const caIds = new Set(assets.filter((a) => a.assetType === 'certificado_aforro').map((a) => a.id));
const caFree = transactions.filter((t) => !caIds.has(t.assetId as string));

// Snapshot days: every month end, the YTD and 1Y starts, and the last two weeks. (A day
// without a snapshot adds its flows to the next point, in both runs alike.)
const first = transactions.map((t) => t.tradeDate).sort()[0] as IsoDate;
const days = new Set<IsoDate>([`${Number(TODAY.slice(0, 4)) - 1}-12-31`, addMonths(TODAY, -12)]);
for (let m = `${first.slice(0, 7)}-01`; m <= TODAY; m = addMonths(m, 1)) days.add(addDays(m, -1));
for (let i = 1; i <= 14; i++) days.add(addDays(TODAY, -i));
const snapshotDays = [...days].filter((d) => d >= first && d < TODAY).sort();

// A close for every traded asset on each snapshot day and today: its first trade price
// moved by a few % (deterministic).
const firstPrice = new Map<string, Decimal>();
for (const t of transactions)
  if (!caIds.has(t.assetId as string) && !firstPrice.has(t.assetId as string))
    firstPrice.set(t.assetId as string, t.unitPrice as Decimal);
const prices: StoredPriceRow[] = [...firstPrice].flatMap(([assetId, base], i) =>
  [...snapshotDays, TODAY].map((date, k) => ({
    assetId,
    date,
    close: base.times(new Decimal(100 + ((k * (5 + i)) % 31) - 9).div(100)),
    currency: 'EUR',
    splitFactor: null,
  })),
);

function snapshotsOf(rows: readonly Transaction[]): ValueSnapshot[] {
  const lookup = createPriceLookup(splitAdjustPrices(prices));
  const fallbackPrices = createTradePriceLookup(rows);
  const ca = { subscriptions, factors: createCaFactorLookup(factors) };
  const start = [...rows].map((t) => t.tradeDate).sort()[0];
  return snapshotDays
    .filter((date) => start !== undefined && date >= start)
    .map((date) => {
      const s = buildSnapshot({
        date,
        transactions: rows,
        assets,
        prices: lookup,
        fallbackPrices,
        fx: createFxLookup([]),
        ca,
      });
      return {
        date,
        valueEur: s.totalValueEur,
        netInvestedEur: s.netContributionsEur,
        valueByTypeEur: {
          stock: s.stockValueEur,
          etf: s.etfValueEur,
          crypto: s.cryptoValueEur,
          certificado_aforro: s.certificadoAforroValueEur,
        },
      };
    });
}

const input = (rows: readonly Transaction[], excludeTypes?: AssetType[]): DashboardInput => ({
  today: TODAY,
  transactions: rows,
  assets,
  prices,
  liveQuotes: [],
  fx: [],
  ca: { subscriptions, factors },
  snapshots: snapshotsOf(rows),
  excludeTypes,
});
const full = input(transactions);
const excluded = input(transactions, CA);
const stripped = input(caFree);

function plain(x: unknown): unknown {
  if (x instanceof Decimal) return x.toString();
  if (Array.isArray(x)) return x.map(plain);
  if (x && typeof x === 'object')
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, plain(v)]));
  return x;
}
/** The view's figures: everything but what it says about its scope. */
const figures = (view: object) =>
  plain(
    Object.fromEntries(
      Object.entries(view).filter(([k]) => k !== 'excludeTypes' && k !== 'emptyInScope'),
    ),
  );
const BUILDERS = { buildDashboard, buildPositions, buildAllocation, buildPerformance };

describe('certificados toggle on the fixture ledger', () => {
  it('the fixture has certificados, and they matter', () => {
    expect(transactions.length - caFree.length).toBeGreaterThan(0);
    const f = buildDashboard(full) as DashboardView;
    expect(f.allocation.some((s) => s.key === 'certificado_aforro')).toBe(true);
  });

  for (const [name, build] of Object.entries(BUILDERS)) {
    it(`${name}: excluded = the ledger without certificado rows, exactly`, () => {
      const a = build(excluded);
      const b = build(stripped);
      expect(a.status).toBe('ok');
      expect(figures(a)).toEqual(figures(b));
      if (a.status === 'ok') expect(a.excludeTypes).toEqual(CA);
    });

    it(`${name}: off and on again gives the original numbers exactly`, () => {
      const before = plain(build(full));
      build(excluded);
      expect(plain(build(full))).toEqual(before);
    });
  }

  it('Activity rows: excluded = the ledger without certificado rows', () => {
    const scope = assetScope({ assets, excludeTypes: CA });
    expect(plain(transactionRows(transactions, TODAY, scope))).toEqual(
      plain(transactionRows(caFree, TODAY)),
    );
  });

  it('total excluded = total minus the certificados value; XIRR and TWR are recomputed', () => {
    const f = buildDashboard(full) as DashboardView;
    const e = buildDashboard(excluded) as DashboardView;
    const ca = f.allocation.find((s) => s.key === 'certificado_aforro')?.valueEur as Decimal;
    expect(e.totalValueEur.eq(f.totalValueEur.minus(ca))).toBe(true);
    for (const i of [0, 1, 2]) {
      const [fr, er] = [f.returns[i], e.returns[i]];
      expect(fr?.xirr.ok && er?.xirr.ok && fr.twr.ok && er.twr.ok).toBe(true);
      if (fr?.xirr.ok && er?.xirr.ok) expect(er.xirr.annualRate.eq(fr.xirr.annualRate)).toBe(false);
      if (fr?.twr.ok && er?.twr.ok) expect(er.twr.cumulative.eq(fr.twr.cumulative)).toBe(false);
    }
  });

  it('allocation sums to 100% and the brokers add up, in both modes', () => {
    for (const i of [full, excluded]) {
      const alloc = buildAllocation(i);
      if (alloc.status !== 'ok') throw new Error('unvalued');
      for (const slices of Object.values(alloc.slices)) {
        const sum = slices.reduce((s, x) => s.plus(x.weight), new Decimal(0));
        expect(sum.minus(1).abs().lte('1e-40')).toBe(true);
      }
      const pos = buildPositions(i) as PositionsView;
      expect(pos.brokersReconcile).toBe(true);
    }
    const pos = buildPositions(excluded) as PositionsView;
    const aforro = payload.accounts.find((a) => a.name.toLowerCase() === 'aforro')?.id;
    expect(aforro).toBeDefined();
    expect(pos.brokers.map((b) => b.accountId)).not.toContain(aforro);
    expect((buildPositions(full) as PositionsView).brokers.map((b) => b.accountId)).toContain(
      aforro,
    );
  });
});
