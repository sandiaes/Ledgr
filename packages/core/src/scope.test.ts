import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CaFactor, CaSubscription } from './certificados';
import { addDays, type IsoDate } from './dates';
import { Decimal, ZERO } from './decimal';
import { createCaFactorLookup, createFxLookup, createPriceLookup, type FxRow } from './lookups';
import { transactionRows } from './positions';
import { createTradePriceLookup, splitAdjustPrices, type StoredPriceRow } from './prices';
import type { ValueSnapshot } from './returns';
import {
  assetScope,
  FULL_SCOPE,
  isFullScope,
  scopeHoldings,
  scopeSnapshots,
  scopeTransactions,
} from './scope';
import { buildSnapshot } from './snapshot';
import { buy, d, dividend, expectDec, fee, interest, redeem, sell, subscribe } from './test-utils';
import type { Asset, AssetType, Transaction } from './types';
import {
  buildAllocation,
  buildDashboard,
  buildPerformance,
  buildPositions,
  type DashboardInput,
  type DashboardView,
  type PortfolioInput,
  type PositionsView,
} from './views';

const CA: AssetType[] = ['certificado_aforro'];

describe('assetScope', () => {
  const assets: Asset[] = [
    { id: 'S', assetType: 'stock', tradingCurrency: 'EUR' },
    { id: 'CA1', assetType: 'certificado_aforro', tradingCurrency: 'EUR' },
  ];

  it('without excluded types is the full scope', () => {
    expect(assetScope({ assets })).toBe(FULL_SCOPE);
    expect(assetScope({ assets, excludeTypes: [] })).toBe(FULL_SCOPE);
    expect(isFullScope(undefined)).toBe(true);
    expect(isFullScope(assetScope({ assets, excludeTypes: CA }))).toBe(false);
  });

  it('leaves out the excluded types; rows without an asset and unknown assets stay in', () => {
    const scope = assetScope({ assets, excludeTypes: CA });
    expect(scope.excludeTypes).toEqual(CA);
    expect(scope.includes('S')).toBe(true);
    expect(scope.includes('CA1')).toBe(false);
    expect(scope.includes(null)).toBe(true);
    expect(scope.includes('unknown')).toBe(true);

    const rows = [
      buy('2025-01-02', 'S', '1', '10'),
      subscribe('2025-01-02', 'CA1', '100', '1'),
      interest('2025-01-03', '1', { account: 'aforro' }),
      fee('2025-01-03', '1'),
    ];
    expect(scopeTransactions(rows, scope).map((t) => t.assetId)).toEqual(['S', null, null]);
    expect(scopeTransactions(rows, FULL_SCOPE)).toBe(rows);
    const holdings = [
      { assetType: 'stock' as const },
      { assetType: 'certificado_aforro' as const },
    ];
    expect(scopeHoldings(holdings, scope)).toEqual([{ assetType: 'stock' }]);
    expect(scopeHoldings(holdings)).toBe(holdings);
  });
});

describe('scopeSnapshots', () => {
  const assets: Asset[] = [
    { id: 'S', assetType: 'stock', tradingCurrency: 'EUR' },
    { id: 'CA1', assetType: 'certificado_aforro', tradingCurrency: 'EUR' },
  ];
  const ledger = [
    buy('2025-01-02', 'S', '10', '10', { fees: '1' }),
    subscribe('2025-01-02', 'CA1', '500', '1'),
    sell('2025-01-04', 'S', '5', '12', { fees: '1' }),
  ];
  const byType = (stock: string, ca: string) => ({
    stock: d(stock),
    etf: d('7'),
    crypto: d('0.5'),
    certificado_aforro: d(ca),
  });
  const snaps: ValueSnapshot[] = [
    {
      date: '2025-01-03',
      valueEur: d('615.5'),
      netInvestedEur: d('601'),
      valueByTypeEur: byType('108', '500'),
    },
    {
      date: '2025-01-05',
      valueEur: d('568.5'),
      netInvestedEur: d('542'),
      valueByTypeEur: byType('60', '501'),
    },
  ];

  it('full scope: the stored values, unchanged', () => {
    const out = scopeSnapshots(snaps, ledger, FULL_SCOPE);
    expect(out).toEqual(snaps);
    expect(out[0]?.valueEur).toBe(snaps[0]?.valueEur);
  });

  it('value = Σ of the in-scope type columns; NI from the in-scope rows', () => {
    const out = scopeSnapshots(snaps, ledger, assetScope({ assets, excludeTypes: CA }));
    // 108 + 7 + 0.5; NI = 101 (the stock buy, fees in)
    expectDec(out[0]?.valueEur, '115.5');
    expectDec(out[0]?.netInvestedEur, '101');
    // 60 + 7 + 0.5; NI = 101 - (60 - 1)
    expectDec(out[1]?.valueEur, '67.5');
    expectDec(out[1]?.netInvestedEur, '42');
  });

  it('a snapshot without per-type values cannot be scoped', () => {
    const bare = [{ date: '2025-01-03', valueEur: d('1'), netInvestedEur: d('1') }];
    expect(() => scopeSnapshots(bare, ledger, assetScope({ assets, excludeTypes: CA }))).toThrow(
      RangeError,
    );
    expect(scopeSnapshots(bare, ledger)).toEqual(bare);
  });
});

// ---------------------------------------------------------------------------
// A portfolio with stocks, ETFs, crypto and certificados, valued every day, so the views
// can be built from it twice: with certificados excluded, and from the same ledger with
// the certificado rows removed (and its snapshots rebuilt). The two must agree exactly.
// ---------------------------------------------------------------------------

const START = '2025-03-20';
const DAYS = 40;
const TODAY = addDays(START, DAYS);
const ASSETS: Asset[] = [
  { id: 'S', assetType: 'stock', tradingCurrency: 'EUR' },
  { id: 'E', assetType: 'etf', tradingCurrency: 'USD' },
  { id: 'X', assetType: 'crypto', tradingCurrency: 'EUR' },
  { id: 'CA1', assetType: 'certificado_aforro', tradingCurrency: 'EUR' },
  { id: 'CA2', assetType: 'certificado_aforro', tradingCurrency: 'EUR' },
];
const TRADED = ASSETS.filter((a) => a.assetType !== 'certificado_aforro');
const BASE = ['50', '20', '30000'];

/** A close for every traded asset every day, moving a few % up and down. */
const PRICES: StoredPriceRow[] = TRADED.flatMap((a, i) =>
  Array.from({ length: DAYS + 6 }, (_, k) => ({
    assetId: a.id,
    date: addDays(START, k - 5),
    close: d(BASE[i] as string).times(d(String(100 + ((k * (7 + i * 4)) % 13) - 6)).div(100)),
    currency: a.tradingCurrency,
    splitFactor: null,
  })),
);
const FX: FxRow[] = Array.from({ length: DAYS + 6 }, (_, k) => ({
  currency: 'USD',
  date: addDays(START, k - 5),
  rateToEur: d('0.9').plus(d(String(k % 5)).div(100)),
}));

interface Portfolio {
  transactions: Transaction[];
  ca: PortfolioInput['ca'];
}

const opArb = fc.record({
  day: fc.integer({ min: 0, max: DAYS }),
  kind: fc.constantFrom('buy', 'buy', 'sell', 'dividend', 'fee', 'interest', 'subscribe', 'redeem'),
  asset: fc.integer({ min: 0, max: 2 }),
  account: fc.integer({ min: 0, max: 2 }),
  qty: fc.integer({ min: 1, max: 1_000_000 }),
  share: fc.integer({ min: 1, max: 100 }),
  cents: fc.integer({ min: 1, max: 100_000 }),
});
type Op = typeof opArb extends fc.Arbitrary<infer T> ? T : never;
const ACCOUNTS = ['acc1', 'acc2', 'aforro'];

/**
 * A valid ledger: sells and redemptions never exceed what is held, processed by day. Buys
 * pay a 0.50 fee unless `fees` is false.
 */
function portfolio(ops: readonly Op[], fees = true): Portfolio {
  const phase = (k: string) => (k === 'sell' || k === 'redeem' ? 1 : 0);
  const sorted = [...ops].sort((a, b) => a.day - b.day || phase(a.kind) - phase(b.kind));
  const held = new Map<string, Decimal>();
  const subs: { id: string; tx: string; units: Decimal; month: IsoDate }[] = [];
  const txs: Transaction[] = [];
  const ca = { subscriptions: [] as CaSubscription[], factors: [] as CaFactor[] };
  let n = 0;
  for (const op of sorted) {
    const date = addDays(START, op.day);
    const asset = TRADED[op.asset] as Asset;
    const account = ACCOUNTS[op.account % 2] as string;
    const key = `${account}/${asset.id}`;
    const price = PRICES.find((p) => p.assetId === asset.id && p.date === date)?.close as Decimal;
    const usd = asset.tradingCurrency === 'USD';
    const money = { account, currency: usd ? 'USD' : 'EUR', fx: usd ? '0.92' : '1' };
    const qty = d(String(op.qty)).div(10_000);
    if (op.kind === 'buy') {
      txs.push(
        buy(date, asset.id, qty.toString(), price.toString(), {
          ...money,
          fees: fees ? '0.5' : '0',
        }),
      );
      held.set(key, (held.get(key) ?? ZERO).plus(qty));
    } else if (op.kind === 'sell') {
      const units = (held.get(key) ?? ZERO).times(op.share).div(100).toDecimalPlaces(6, 1);
      if (units.isZero()) continue;
      txs.push(sell(date, asset.id, units.toString(), price.times('1.01').toString(), money));
      held.set(key, (held.get(key) as Decimal).minus(units));
    } else if (op.kind === 'dividend') {
      txs.push(
        dividend(date, d(String(op.cents)).div(100).toString(), { ...money, asset: asset.id }),
      );
    } else if (op.kind === 'fee' || op.kind === 'interest') {
      // Rows without an asset, at any broker (the certificados broker included).
      const make = op.kind === 'fee' ? fee : interest;
      const where = ACCOUNTS[op.account] as string;
      txs.push(make(date, d(String(op.cents)).div(100).toString(), { account: where }));
    } else if (op.kind === 'subscribe') {
      const id = `sub${++n}`;
      const tx = `ca-tx${n}`;
      const caAsset = op.asset % 2 === 0 ? 'CA1' : 'CA2';
      txs.push(
        subscribe(date, caAsset, qty.times(100).toString(), '1', { id: tx, account: 'aforro' }),
      );
      ca.subscriptions.push({ id, seriesId: caAsset, transactionId: tx });
      subs.push({ id, tx, units: qty.times(100), month: `${date.slice(0, 7)}-01` });
      for (const month of ['2025-03-01', '2025-04-01', '2025-05-01']) {
        if (month < `${date.slice(0, 7)}-01`) continue;
        ca.factors.push({
          subscriptionId: id,
          month,
          factor: d('1').plus(d(month.slice(5, 7)).div(1000)),
        });
      }
    } else {
      const sub = subs[op.qty % Math.max(subs.length, 1)];
      if (!sub) continue;
      const units = sub.units.times(op.share).div(100).toDecimalPlaces(6, 1);
      if (units.isZero()) continue;
      const caAsset = (txs.find((t) => t.id === sub.tx) as Transaction).assetId as string;
      txs.push(
        redeem(date, caAsset, units.toString(), '1.003', {
          account: 'aforro',
          caSubscriptionId: sub.id,
        }),
      );
      sub.units = sub.units.minus(units);
    }
  }
  return { transactions: txs, ca };
}

/** Daily snapshots before today from a ledger, as the daily job builds them. */
function snapshotsOf(p: Portfolio): ValueSnapshot[] {
  const prices = createPriceLookup(splitAdjustPrices(PRICES));
  const fallbackPrices = createTradePriceLookup(p.transactions);
  const fx = createFxLookup(FX);
  const ca = { subscriptions: p.ca.subscriptions, factors: createCaFactorLookup(p.ca.factors) };
  const first = [...p.transactions].map((t) => t.tradeDate).sort()[0];
  const out: ValueSnapshot[] = [];
  if (!first) return out;
  for (let date = first; date < TODAY; date = addDays(date, 1)) {
    if (date.endsWith('-07')) continue; // one missing snapshot a month, in both runs alike
    const s = buildSnapshot({
      date,
      transactions: p.transactions,
      assets: ASSETS,
      prices,
      fallbackPrices,
      fx,
      ca,
    });
    out.push({
      date,
      valueEur: s.totalValueEur,
      netInvestedEur: s.netContributionsEur,
      valueByTypeEur: {
        stock: s.stockValueEur,
        etf: s.etfValueEur,
        crypto: s.cryptoValueEur,
        certificado_aforro: s.certificadoAforroValueEur,
      },
    });
  }
  return out;
}

function inputOf(p: Portfolio, excludeTypes?: AssetType[]): DashboardInput {
  return {
    today: TODAY,
    transactions: p.transactions,
    assets: ASSETS,
    prices: PRICES,
    liveQuotes: [],
    fx: FX,
    ca: p.ca,
    snapshots: snapshotsOf(p),
    excludeTypes,
  };
}

const withoutCa = (p: Portfolio): Portfolio => ({
  ...p,
  transactions: p.transactions.filter((t) => t.assetId !== 'CA1' && t.assetId !== 'CA2'),
});

/** A view as plain data: Decimals as strings, so equality is exact. */
function plain(x: unknown): unknown {
  if (x instanceof Decimal) return x.toString();
  if (Array.isArray(x)) return x.map(plain);
  if (x && typeof x === 'object')
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, plain(v)]));
  return x;
}
/** The view's figures: everything but what it says about its scope and emptiness. */
const figures = (view: object) =>
  plain(
    Object.fromEntries(
      Object.entries(view).filter(([k]) => !['excludeTypes', 'emptyInScope', 'empty'].includes(k)),
    ),
  );
/** The paths at which two plain values differ (empty when equal), for readable failures. */
function differences(a: unknown, b: unknown, path = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) =>
      differences(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
      ),
    );
  }
  return [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
}
const BUILDERS = { buildDashboard, buildPositions, buildAllocation, buildPerformance };
const sumWeights = (slices: readonly { weight: Decimal }[]) =>
  slices.reduce((s, x) => s.plus(x.weight), ZERO);

const opsArb = fc.array(opArb, { minLength: 1, maxLength: 30 });

describe('certificados excluded = the ledger without its certificado rows', () => {
  it('every figure of every view, and the Activity rows (property)', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        const p = portfolio(ops);
        const excluded = inputOf(p, CA);
        const stripped = inputOf(withoutCa(p));
        for (const build of Object.values(BUILDERS)) {
          const a = build(excluded);
          const b = build(stripped);
          const diff = differences(figures(a), figures(b));
          if (diff.length > 0) throw new Error(diff.slice(0, 8).join('\n'));
          if (a.status === 'ok') {
            expect(a.excludeTypes).toEqual(CA);
            expect(a.emptyInScope).toBe(
              p.transactions.length > 0 && stripped.transactions.length === 0,
            );
          }
        }
        const scope = assetScope({ assets: ASSETS, excludeTypes: CA });
        expect(plain(transactionRows(p.transactions, TODAY, scope))).toEqual(
          plain(transactionRows(stripped.transactions, TODAY)),
        );
      }),
      { numRuns: 40 },
    );
  });

  it('switching off and on again gives the original numbers exactly (property)', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        const p = portfolio(ops);
        for (const build of Object.values(BUILDERS)) {
          const before = plain(build(inputOf(p)));
          build(inputOf(p, CA));
          expect(plain(build(inputOf(p, [])))).toEqual(before);
          expect(plain(build(inputOf(p)))).toEqual(before);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('allocation sums to 100% and the brokers add up to the totals, in both modes (property)', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        // Without fees: a partly sold lot's cost then has a short decimal expansion. (With a
        // fee it can need more than 50 significant digits, and sums grouped differently can
        // differ in the last one, with or without a scope.)
        const p = portfolio(ops, false);
        for (const excludeTypes of [undefined, CA]) {
          const alloc = buildAllocation(inputOf(p, excludeTypes));
          const pos = buildPositions(inputOf(p, excludeTypes));
          if (alloc.status !== 'ok' || pos.status !== 'ok') continue;
          for (const slices of Object.values(alloc.slices)) {
            if (slices.length === 0) continue;
            expect(sumWeights(slices).minus(1).abs().lte('1e-40')).toBe(true);
          }
          expect(pos.brokersReconcile).toBe(true);
          for (const f of [
            'valueEur',
            'realizedEur',
            'incomeNetEur',
            'otherCostsEur',
            'totalGainEur',
          ] as const)
            expect(pos.brokers.reduce((s, b) => s.plus(b[f]), ZERO).eq(pos.totals[f])).toBe(true);
          if (excludeTypes) {
            expect(pos.positions.some((r) => r.assetType === 'certificado_aforro')).toBe(false);
            // A broker is listed only with something in scope.
            const inScope = new Set(
              scopeTransactions(p.transactions, assetScope({ assets: ASSETS, excludeTypes })).map(
                (t) => t.accountId,
              ),
            );
            for (const b of pos.brokers) expect(inScope.has(b.accountId)).toBe(true);
          }
        }
      }),
      { numRuns: 30 },
    );
  });
});

describe('certificados excluded: a hand example', () => {
  // S: buy 10 @ 50 on START; worth 60 today. CA1: 500 units @ 1 on START, factor 1.004 from
  // April. A fee row at the certificados broker stays in scope (no asset).
  const p: Portfolio = {
    transactions: [
      buy(START, 'S', '10', '50', { account: 'acc1' }),
      subscribe(START, 'CA1', '500', '1', { id: 'ca-tx', account: 'aforro' }),
      fee('2025-04-02', '2', { account: 'aforro' }),
    ],
    ca: {
      subscriptions: [{ id: 'sub', seriesId: 'CA1', transactionId: 'ca-tx' }],
      factors: [{ subscriptionId: 'sub', month: '2025-04-01', factor: d('1.004') }],
    },
  };
  const ok = (i: DashboardInput) => buildDashboard(i) as DashboardView;
  const full = ok(inputOf(p));
  const excluded = ok(inputOf(p, CA));
  const stripped = ok(inputOf(withoutCa(p)));
  const sValue = full.allocation.find((s) => s.key === 'stock')?.valueEur as Decimal;
  const caValue = full.allocation.find((s) => s.key === 'certificado_aforro')?.valueEur as Decimal;

  it('the total is the stocks alone; the certificados value is not in it', () => {
    expectDec(caValue, '502');
    expectDec(excluded.totalValueEur, sValue);
    expectDec(full.totalValueEur, sValue.plus(caValue));
    expectDec(excluded.netInvestedEur, '500');
    expectDec(excluded.gains.otherCostsEur, '2');
    expect(excluded.allocation.map((s) => [s.key, s.weight.toString()])).toEqual([['stock', '1']]);
    expect(excluded.freshness.caFactor).toBeNull();
    expect(full.freshness.caFactor).not.toBeNull();
  });

  it('XIRR and TWR are recomputed: they differ from the full ones and equal the CA-free ledger', () => {
    for (const i of [0, 1, 2]) {
      const [f, e, s] = [full, excluded, stripped].map((v) => v.returns[i]);
      expect(plain(e)).toEqual(plain(s));
      if (f?.xirr.ok && e?.xirr.ok) expect(e.xirr.annualRate.eq(f.xirr.annualRate)).toBe(false);
      if (f?.twr.ok && e?.twr.ok) expect(e.twr.cumulative.eq(f.twr.cumulative)).toBe(false);
    }
    expect(excluded.returns[0]?.xirr.ok && excluded.returns[0].twr.ok).toBe(true);
  });

  it('by broker: the certificados broker stays only for its fee row', () => {
    const pos = buildPositions(inputOf(p, CA)) as PositionsView;
    const aforro = pos.brokers.find((b) => b.accountId === 'aforro');
    expectDec(aforro?.valueEur, '0');
    expectDec(aforro?.otherCostsEur, '2');
    const noFee = buildPositions(
      inputOf({ ...p, transactions: p.transactions.slice(0, 2) }, CA),
    ) as PositionsView;
    expect(noFee.brokers.map((b) => b.accountId)).toEqual(['acc1']);
  });

  it('only certificados: empty in scope, nothing to show', () => {
    const only: Portfolio = { ...p, transactions: p.transactions.slice(1, 2) };
    const v = ok(inputOf(only, CA));
    expect(v.empty).toBe(false);
    expect(v.emptyInScope).toBe(true);
    expectDec(v.totalValueEur, '0');
    expect(v.allocation).toEqual([]);
    expect(v.returns.every((r) => !r.xirr.ok && !r.twr.ok)).toBe(true);
    expect(v.series.All.points.map((x) => x.valueEur.toString())).toEqual(
      v.series.All.points.map(() => '0'),
    );
    expect(ok(inputOf(only)).emptyInScope).toBe(false);
  });
});
