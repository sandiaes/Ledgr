import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocation } from './allocation';
import { addDays } from './dates';
import { Decimal, ZERO } from './decimal';
import { InsufficientHoldingsError } from './errors';
import { runFifo } from './fifo';
import { gainsSummary, netContributions } from './gains';
import { computeHoldings } from './holdings';
import { acquisitionCostEur, cashBalanceEur, isAcquisition } from './ledger';
import { createFxLookup, createPriceLookup } from './lookups';
import { buy, d, deposit, dividend, expectClose, fee, sell } from './test-utils';
import { twr } from './twr';
import type { Asset, Transaction } from './types';
import { xirr } from './xirr';

const START = '2024-01-01';
const ACCOUNTS = ['acc1', 'acc2'];
const ASSETS: Asset[] = [
  { id: 'A', assetType: 'stock', tradingCurrency: 'EUR' },
  { id: 'U', assetType: 'etf', tradingCurrency: 'USD' },
  { id: 'C', assetType: 'crypto', tradingCurrency: 'EUR' },
];
const FX = ['1', '0.9', '0.93', '1.05'];

const opArb = fc.record({
  day: fc.integer({ min: 0, max: 59 }),
  account: fc.integer({ min: 0, max: 1 }),
  asset: fc.integer({ min: 0, max: 2 }),
  kind: fc.constantFrom('buy', 'buy', 'sell', 'dividend', 'deposit', 'fee'),
  qty: fc.integer({ min: 1, max: 10_000_000 }), // / 10^4 -> 0.0001 .. 1000 units
  sellBp: fc.integer({ min: 1, max: 10_000 }), // share of the position sold, basis points
  price: fc.integer({ min: 0, max: 1_000_000 }), // cents
  fee: fc.integer({ min: 0, max: 500 }), // cents
  fx: fc.integer({ min: 0, max: FX.length - 1 }),
});

/**
 * A random but valid ledger: sells never exceed what is held (simulated in processing
 * order: by day, acquisitions first), then shuffled so input order is arbitrary.
 */
const ledgerArb = fc.tuple(fc.array(opArb, { maxLength: 60 }), fc.integer()).map(([ops, seed]) => {
  const held = new Map<string, Decimal>();
  const ordered = [...ops].sort(
    (a, b) => a.day - b.day || Number(a.kind === 'sell') - Number(b.kind === 'sell'),
  );
  const txs: Transaction[] = [];
  for (const op of ordered) {
    const date = addDays(START, op.day);
    const asset = ASSETS[op.asset]!;
    const account = ACCOUNTS[op.account]!;
    const usd = asset.tradingCurrency === 'USD';
    const extra = {
      account,
      fees: new Decimal(op.fee).div(100).toString(),
      currency: usd ? 'USD' : 'EUR',
      fx: usd ? FX[op.fx]! : '1',
    };
    const price = new Decimal(op.price).div(100).toString();
    const key = `${account}/${asset.id}`;
    const position = held.get(key) ?? ZERO;
    if (op.kind === 'buy') {
      const qty = new Decimal(op.qty).div(10_000);
      txs.push(buy(date, asset.id, qty.toString(), price, extra));
      held.set(key, position.plus(qty));
    } else if (op.kind === 'sell') {
      const qty =
        op.sellBp === 10_000
          ? position
          : position.times(op.sellBp).div(10_000).toDecimalPlaces(8, Decimal.ROUND_DOWN);
      if (qty.isZero()) continue;
      txs.push(sell(date, asset.id, qty.toString(), price, extra));
      held.set(key, position.minus(qty));
    } else if (op.kind === 'dividend') {
      if (op.price > 0) txs.push(dividend(date, price, { ...extra, asset: asset.id }));
    } else if (op.kind === 'deposit') {
      if (op.price > 0) txs.push(deposit(date, price, { account }));
    } else if (op.price > 0) {
      txs.push(fee(date, price, { account }));
    }
  }
  // Deterministic shuffle from the seed.
  let s = seed >>> 0;
  for (let i = txs.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [txs[i], txs[j]] = [txs[j]!, txs[i]!];
  }
  return { txs, held };
});

const ASOF = addDays(START, 59);
const prices = createPriceLookup(
  ASSETS.map((a, i) => ({
    assetId: a.id,
    date: ASOF,
    close: d(['101.5', '42.25', '30000.12345678'][i]!),
    currency: a.tradingCurrency,
  })),
);
const fxLookup = createFxLookup([{ currency: 'USD', date: START, rateToEur: d('0.91') }]);

const sumBy = <T>(xs: readonly T[], f: (x: T) => Decimal) =>
  xs.reduce((s, x) => s.plus(f(x)), ZERO);

describe('properties', () => {
  it('sum of open lot quantities equals the holdings quantity, per account and asset', () => {
    fc.assert(
      fc.property(ledgerArb, ({ txs, held }) => {
        const { openLots } = runFifo(txs);
        const holdings = computeHoldings({
          transactions: txs,
          assets: ASSETS,
          asOf: ASOF,
          prices,
          fx: fxLookup,
        });
        for (const [key, qty] of held) {
          const [account, asset] = key.split('/');
          const lots = openLots.filter((l) => l.accountId === account && l.assetId === asset);
          expect(sumBy(lots, (l) => l.quantity).toString()).toBe(qty.toString());
          const h = holdings.find((x) => x.accountId === account && x.assetId === asset);
          expect((h?.quantity ?? ZERO).toString()).toBe(qty.toString());
        }
        expect(openLots.every((l) => l.quantity.gt(0))).toBe(true);
      }),
    );
  });

  it('cost is conserved: acquired = open + disposed; parts sum to the whole', () => {
    fc.assert(
      fc.property(ledgerArb, ({ txs }) => {
        const { openLots, disposals } = runFifo(txs);
        const acquired = sumBy(
          txs.filter((t) => isAcquisition(t.type)),
          acquisitionCostEur,
        );
        const accounted = sumBy(openLots, (l) => l.costEur).plus(
          sumBy(disposals, (x) => x.costEur),
        );
        expectClose(accounted, acquired, '1e-30');
        for (const x of disposals) {
          expect(sumBy(x.matches, (m) => m.quantity).toString()).toBe(x.quantity.toString());
          expectClose(
            sumBy(x.matches, (m) => m.proceedsEur),
            x.proceedsEur,
            '1e-30',
          );
          expectClose(
            sumBy(x.matches, (m) => m.gainEur),
            x.gainEur,
            '1e-30',
          );
          expect(x.gainEur.toString()).toBe(x.proceedsEur.minus(x.costEur).toString());
        }
      }),
    );
  });

  it('total return = positions + cash - net contributions', () => {
    fc.assert(
      fc.property(ledgerArb, ({ txs }) => {
        const holdings = computeHoldings({
          transactions: txs,
          assets: ASSETS,
          asOf: ASOF,
          prices,
          fx: fxLookup,
        });
        const g = gainsSummary({ transactions: txs, holdings, asOf: ASOF });
        const positions = sumBy(holdings, (h) => h.marketValueEur as Decimal);
        const identity = positions
          .plus(cashBalanceEur(txs, ASOF))
          .minus(netContributions(txs, ASOF).netEur);
        expectClose(g.totalReturnEur, identity, '1e-30');
      }),
    );
  });

  it('selling more than held always throws', () => {
    fc.assert(
      fc.property(ledgerArb, fc.integer({ min: 1, max: 10 ** 8 }), ({ txs, held }, extra) => {
        const [key, qty] = [...held.entries()][0] ?? ['acc1/A', ZERO];
        const [account, asset] = key.split('/') as [string, string];
        const over = qty.plus(new Decimal(extra).div(10 ** 8));
        const oversell = sell(ASOF, asset, over.toString(), '1', { account });
        expect(() => runFifo([...txs, oversell])).toThrow(InsufficientHoldingsError);
      }),
    );
  });

  it('allocation weights sum to 1', () => {
    fc.assert(
      fc.property(ledgerArb, ({ txs }) => {
        const holdings = computeHoldings({
          transactions: txs,
          assets: ASSETS,
          asOf: ASOF,
          prices,
          fx: fxLookup,
        });
        if (holdings.length === 0) return;
        for (const by of ['assetType', 'asset', 'account', 'currency'] as const) {
          expectClose(
            sumBy(allocation(holdings, by), (s) => s.weight),
            '1',
            '1e-40',
          );
        }
      }),
    );
  });

  it('xirr recovers the rate of a single investment', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -9_000, max: 30_000 }), // rate in basis points: -90% .. +300%
        fc.integer({ min: 30, max: 3_650 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        (bp, days, principal) => {
          const rate = new Decimal(bp).div(10_000);
          const p = new Decimal(principal);
          const end = p.times(rate.plus(1).pow(new Decimal(days).div(365)));
          const r = xirr([
            { date: START, amount: p.neg() },
            { date: addDays(START, days), amount: end },
          ]);
          expect(r.ok).toBe(true);
          if (r.ok) expectClose(r.rate, rate, '1e-12');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('whenever xirr returns a rate, the NPV changes sign within 1e-12 of it', () => {
    // NPV itself can stay far from 0 at an accurate rate when the curve is steep (roots
    // near -100%), so check that a root is bracketed tightly around the answer instead.
    const flowArb = fc.array(
      fc.record({
        day: fc.integer({ min: 0, max: 2_000 }),
        amount: fc.integer({ min: -100_000, max: 100_000 }),
      }),
      { minLength: 2, maxLength: 8 },
    );
    fc.assert(
      fc.property(flowArb, (raw) => {
        const flows = raw.map((f) => ({
          date: addDays(START, f.day),
          amount: new Decimal(f.amount),
        }));
        const r = xirr(flows);
        if (!r.ok) {
          expect(['no-flows', 'no-sign-change', 'period-too-short', 'no-root-found']).toContain(
            r.reason,
          );
          return;
        }
        const first = Math.min(...raw.filter((f) => f.amount !== 0).map((f) => f.day));
        const npv = (rate: Decimal) =>
          sumBy(raw, (f) =>
            new Decimal(f.amount).div(rate.plus(1).pow(new Decimal(f.day - first).div(365))),
          );
        const lo = npv(r.rate.minus('1e-12'));
        const hi = npv(r.rate.plus('1e-12'));
        expect(lo.isZero() || hi.isZero() || lo.isNegative() !== hi.isNegative()).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('twr without flows is last / first - 1', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 10 ** 9 }), { minLength: 2, maxLength: 30 }),
        (values) => {
          const series = values.map((v, i) => ({ date: addDays(START, i), value: new Decimal(v) }));
          const expected = new Decimal(values.at(-1)!).div(values[0]!).minus(1);
          // intermediate growth reaches 1e9 over <= 30 steps at 50 significant digits:
          // rounding error <= 30 * 1e9 * 1e-50 = 3e-40 (scaled up for large results)
          expectClose(twr(series).cumulative, expected, expected.abs().plus(1).times('1e-38'));
        },
      ),
    );
  });
});
