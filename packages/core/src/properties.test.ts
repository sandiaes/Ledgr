import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { accountSummaries } from './accounts';
import { allocation } from './allocation';
import { dailyFlows } from './cashflows';
import { addDays } from './dates';
import { Decimal, ZERO } from './decimal';
import { InsufficientHoldingsError } from './errors';
import { runFifo } from './fifo';
import { gainsSummary } from './gains';
import { computeHoldings } from './holdings';
import { acquisitionCostEur, isAcquisition } from './ledger';
import { createFxLookup, createPriceLookup } from './lookups';
import { buy, d, deposit, dividend, expectClose, fee, sell, transfer } from './test-utils';
import { twr } from './twr';
import type { Asset, Transaction } from './types';
import { maxDisposable, unitsHeld, validateNewTransaction } from './validation';
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
  kind: fc.constantFrom('buy', 'buy', 'sell', 'transfer', 'dividend', 'deposit', 'fee'),
  qty: fc.integer({ min: 1, max: 10_000_000 }), // / 10^4 -> 0.0001 .. 1000 units
  sellBp: fc.integer({ min: 1, max: 10_000 }), // share of the position sold, basis points
  price: fc.integer({ min: 0, max: 1_000_000 }), // cents
  fee: fc.integer({ min: 0, max: 500 }), // cents
  fx: fc.integer({ min: 0, max: FX.length - 1 }),
});

/**
 * A random but valid ledger: sells and transfers never exceed what their account holds
 * (FIFO per account; simulated in processing order: by day, acquisitions first, sells
 * last). Shuffled so input order is arbitrary.
 */
type Op = typeof opArb extends fc.Arbitrary<infer T> ? T : never;

function buildLedger([ops, seed]: [Op[], number]) {
  const held = new Map<string, Decimal>(); // total over all accounts, by asset
  const perAccount = new Map<string, Decimal>(); // by `${account}/${asset}`
  // Units transferred in today: same-day transfers may be reordered, so they cannot be sent on.
  const receivedToday = new Map<string, Decimal>(); // by `${day}/${account}/${asset}`
  const phase = (k: string) => (k === 'buy' ? 0 : k === 'sell' ? 2 : 1);
  const ordered = [...ops].sort((a, b) => a.day - b.day || phase(a.kind) - phase(b.kind));
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
    const position = held.get(asset.id) ?? ZERO;
    const inAccount = perAccount.get(key) ?? ZERO;
    if (op.kind === 'buy') {
      const qty = new Decimal(op.qty).div(10_000);
      txs.push(buy(date, asset.id, qty.toString(), price, extra));
      held.set(asset.id, position.plus(qty));
      perAccount.set(key, inAccount.plus(qty));
    } else if (op.kind === 'sell') {
      const qty =
        op.sellBp === 10_000
          ? inAccount
          : inAccount.times(op.sellBp).div(10_000).toDecimalPlaces(8, Decimal.ROUND_DOWN);
      if (qty.isZero()) continue;
      txs.push(sell(date, asset.id, qty.toString(), price, extra));
      held.set(asset.id, position.minus(qty));
      perAccount.set(key, inAccount.minus(qty));
    } else if (op.kind === 'transfer') {
      // Move part of what this account held before today's transfers to the other one.
      const movable = inAccount.minus(receivedToday.get(`${op.day}/${key}`) ?? ZERO);
      if (!movable.gt(0)) continue;
      const qty = movable.times(op.sellBp).div(10_000).toDecimalPlaces(8, Decimal.ROUND_DOWN);
      if (qty.isZero()) continue;
      const to = ACCOUNTS[1 - op.account]!;
      const toKey = `${to}/${asset.id}`;
      txs.push(transfer(date, asset.id, qty.toString(), to, extra));
      perAccount.set(key, inAccount.minus(qty));
      perAccount.set(toKey, (perAccount.get(toKey) ?? ZERO).plus(qty));
      receivedToday.set(
        `${op.day}/${toKey}`,
        (receivedToday.get(`${op.day}/${toKey}`) ?? ZERO).plus(qty),
      );
    } else if (op.kind === 'dividend') {
      if (op.price > 0) {
        const withholding = new Decimal(op.price).times(op.sellBp % 3500).div(1_000_000);
        txs.push(
          dividend(date, price, { ...extra, asset: asset.id, withholding: withholding.toString() }),
        );
      }
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
  return { txs, held, perAccount };
}

const opsArb = fc.tuple(fc.array(opArb, { maxLength: 60 }), fc.integer());
const ledgerArb = opsArb.map(buildLedger);

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
  it('sum of open lot quantities equals the holdings quantity; accounts split it', () => {
    fc.assert(
      fc.property(ledgerArb, ({ txs, held, perAccount }) => {
        const { openLots } = runFifo(txs);
        const holdings = computeHoldings({
          transactions: txs,
          assets: ASSETS,
          asOf: ASOF,
          prices,
          fx: fxLookup,
        });
        for (const [asset, qty] of held) {
          const lots = openLots.filter((l) => l.assetId === asset);
          expect(sumBy(lots, (l) => l.quantity).toString()).toBe(qty.toString());
          const h = holdings.find((x) => x.assetId === asset);
          expect((h?.quantity ?? ZERO).toString()).toBe(qty.toString());
          if (!h) continue;
          // Per-account units are each account's own net trades and add up to the total.
          const expected = [...perAccount]
            .filter(([k, q]) => k.endsWith(`/${asset}`) && !q.isZero())
            .map(([k, q]) => [k.split('/')[0], q.toString()])
            .sort();
          expect(h.accounts.map((a) => [a.accountId, a.quantity.toString()])).toEqual(expected);
          // The accounts add up exactly to the holding.
          expect(sumBy(h.accounts, (a) => a.quantity).toString()).toBe(qty.toString());
          expect(sumBy(h.accounts, (a) => a.costBasisEur).toString()).toBe(
            h.costBasisEur.toString(),
          );
          expect(sumBy(h.accounts, (a) => a.marketValueEur!).toString()).toBe(
            h.marketValueEur!.toString(),
          );
          expect(sumBy(h.accounts, (a) => a.unrealizedGainEur!).toString()).toBe(
            h.unrealizedGainEur!.toString(),
          );
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

  it('total gain = value - sum of the day flows, and = the sum over accounts', () => {
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
        const flows = sumBy(dailyFlows(txs, { asOf: ASOF }), (f) => f.flowEur);
        expectClose(g.totalReturnEur, positions.minus(flows), '1e-30');

        const accounts = accountSummaries({ transactions: txs, holdings, asOf: ASOF });
        expect(sumBy(accounts, (a) => a.realizedEur).toString()).toBe(g.realizedEur.toString());
        expect(sumBy(accounts, (a) => a.incomeNetEur).toString()).toBe(g.incomeNetEur.toString());
        expect(sumBy(accounts, (a) => a.otherCostsEur).toString()).toBe(g.otherCostsEur.toString());
        expectClose(
          sumBy(accounts, (a) => a.unrealizedEur),
          g.unrealizedEur,
          '1e-30',
        );
        expectClose(
          sumBy(accounts, (a) => a.totalGainEur),
          g.totalReturnEur,
          '1e-30',
        );
      }),
    );
  });

  it('selling more than the account holds always throws', () => {
    fc.assert(
      fc.property(ledgerArb, fc.integer({ min: 1, max: 10 ** 8 }), ({ txs, perAccount }, extra) => {
        // Exceeds what acc2 holds, even when acc1 holds plenty.
        const [key, qty] = [...perAccount.entries()].find(([k]) => k.startsWith('acc2/')) ?? [
          'acc2/A',
          ZERO,
        ];
        const asset = key.split('/')[1]!;
        const over = qty.plus(new Decimal(extra).div(10 ** 8));
        const oversell = sell(ASOF, asset, over.toString(), '1', { account: 'acc2' });
        expect(() => runFifo([...txs, oversell])).toThrow(InsufficientHoldingsError);
      }),
    );
  });

  it('maxDisposable is the largest sale runFifo accepts', () => {
    fc.assert(
      fc.property(
        ledgerArb,
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 5 }),
        ({ txs }, day, pick) => {
          const date = addDays(START, day);
          const accountId = ACCOUNTS[pick % 2]!;
          const assetId = ASSETS[pick % 3]!.id;
          const max = maxDisposable(txs, { accountId, assetId, date });
          expect(max.isNegative()).toBe(false);
          const sale = (q: Decimal) =>
            sell(date, assetId, q.toString(), '1', { account: accountId, id: 'new-sale' });
          if (max.gt(0)) expect(() => runFifo([...txs, sale(max)])).not.toThrow();
          expect(() => runFifo([...txs, sale(max.plus('1e-18'))])).toThrow(
            InsufficientHoldingsError,
          );
        },
      ),
    );
  });

  it('the sell form accepts exactly maxDisposable and refuses 1e-18 more', () => {
    fc.assert(
      fc.property(
        ledgerArb,
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 5 }),
        ({ txs }, day, pick) => {
          const date = addDays(START, day);
          const accountId = ACCOUNTS[pick % 2]!;
          const assetId = ASSETS[pick % 3]!.id;
          const max = maxDisposable(txs, { accountId, assetId, date });
          const check = (quantity: Decimal) =>
            validateNewTransaction({
              form: {
                type: 'sell',
                accountId,
                assetId,
                date,
                quantity: quantity.toFixed(),
                total: '100',
                fee: '',
              },
              id: 'new-sale',
              ledger: { transactions: txs, assets: ASSETS, accountIds: ACCOUNTS },
              today: addDays(START, 59),
            });
          if (max.gt(0)) expect(check(max).ok).toBe(true);
          const over = check(max.plus('1e-18'));
          expect(over.ok).toBe(false);
          expect(over.issues.map((i) => i.code)).toEqual([
            max.gt(0) || unitsHeld(txs, { accountId, assetId, date }).gt(0)
              ? 'exceeds_holdings'
              : 'no_units',
          ]);
        },
      ),
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
