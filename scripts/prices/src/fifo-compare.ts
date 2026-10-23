// One-off comparison of pooled FIFO (the old rule) with FIFO per account (the rule since
// slice 5a), over the same ledger: the live one (read-only) or the anonymized fixtures.
// Output is counts and totals only, never per-trade values. Delete this file, the command
// and runFifo's `matching: 'pooled'` once the comparison has been run (docs/app-plan.md §4).
import {
  dec,
  InsufficientHoldingsError,
  runFifo,
  ZERO,
  type Decimal,
  type FifoResult,
  type Transaction,
} from '@ledgr/core';
import { readTransactions } from '@ledgr/import/inputs';

export interface FifoComparison {
  rows: number;
  disposals: number;
  realizedPooledEur: Decimal;
  realizedPerAccountEur: Decimal;
  /** Disposals whose realized gain differs between the two modes. */
  disposalsChanged: number;
  /** Assets whose open cost basis differs between the two modes. */
  assetsCostChanged: number;
  openCostPooledEur: Decimal;
  openCostPerAccountEur: Decimal;
}

/** Why per-account FIFO refuses a ledger pooled FIFO accepted: ids only, never units. */
export interface FifoRefusal {
  rows: number;
  kind: 'disposal' | 'transfer';
  transactionId: string;
  assetId: string;
  accountId: string | null;
}

export function compareFifo(
  transactions: readonly Transaction[],
  caSubscriptions: readonly { id: string; transactionId: string }[] = [],
): FifoComparison | FifoRefusal {
  const pooled = runFifo(transactions, { caSubscriptions, matching: 'pooled' });
  let perAccount: FifoResult;
  try {
    perAccount = runFifo(transactions, { caSubscriptions });
  } catch (e) {
    if (!(e instanceof InsufficientHoldingsError)) throw e;
    return {
      rows: transactions.length,
      kind: e.kind,
      transactionId: e.transactionId as string,
      assetId: e.assetId,
      accountId: e.accountId,
    };
  }
  const realized = (r: FifoResult) => r.disposals.reduce((s, d) => s.plus(d.gainEur), ZERO);
  const pooledGain = new Map(pooled.disposals.map((d) => [d.transactionId, d.gainEur]));
  const costByAsset = (r: FifoResult) => {
    const m = new Map<string, Decimal>();
    for (const l of r.openLots) m.set(l.assetId, (m.get(l.assetId) ?? ZERO).plus(l.costEur));
    return m;
  };
  const costPooled = costByAsset(pooled);
  const costPerAccount = costByAsset(perAccount);
  const assets = new Set([...costPooled.keys(), ...costPerAccount.keys()]);
  const total = (m: Map<string, Decimal>) => [...m.values()].reduce((s, v) => s.plus(v), ZERO);
  return {
    rows: transactions.length,
    disposals: perAccount.disposals.length,
    realizedPooledEur: realized(pooled),
    realizedPerAccountEur: realized(perAccount),
    disposalsChanged: perAccount.disposals.filter(
      (d) => !d.gainEur.eq(pooledGain.get(d.transactionId) as Decimal),
    ).length,
    assetsCostChanged: [...assets].filter(
      (a) => !(costPooled.get(a) ?? ZERO).eq(costPerAccount.get(a) ?? ZERO),
    ).length,
    openCostPooledEur: total(costPooled),
    openCostPerAccountEur: total(costPerAccount),
  };
}

/** The console lines for a comparison: counts and totals only. */
export function comparisonLines(source: string, c: FifoComparison | FifoRefusal): string[] {
  if ('kind' in c) {
    return [
      `FIFO comparison on ${source}: ${c.rows} ledger rows.`,
      `Per-account FIFO refuses the ledger: a ${c.kind} exceeds the units its account holds ` +
        `(transaction ${c.transactionId}, asset ${c.assetId}, account ${c.accountId ?? '-'}).`,
      'Fix that row (or record the missing transfer) and run the comparison again.',
    ];
  }
  const eur = (v: Decimal) => `${v.toFixed(2)} EUR`;
  return [
    `FIFO comparison on ${source}: ${c.rows} ledger rows, ${c.disposals} disposals.`,
    `Realized gain: pooled ${eur(c.realizedPooledEur)}, per account ${eur(c.realizedPerAccountEur)} ` +
      `(change ${eur(c.realizedPerAccountEur.minus(c.realizedPooledEur))}).`,
    `Disposals whose realized gain changes: ${c.disposalsChanged}.`,
    `Open cost basis: pooled ${eur(c.openCostPooledEur)}, per account ${eur(c.openCostPerAccountEur)}; ` +
      `assets whose cost basis changes: ${c.assetsCostChanged}.`,
  ];
}

/**
 * The ledger the importer builds from fixtures/sample_transactions.csv, for the FIFO rules:
 * one account per broker, one asset per ticker, EUR at fx 1, no fees, rows in file order
 * (the importer keeps that order within a month through created_at, #22).
 */
export function fixtureLedger(text: string): Transaction[] {
  const parsed = readTransactions(new TextEncoder().encode(text));
  if (parsed.problems.length > 0) {
    throw new Error(`${parsed.problems.length} unreadable rows in the fixture`);
  }
  return parsed.records.map((r): Transaction => {
    const type = r.transactType.toLowerCase();
    if (type !== 'buy' && type !== 'sell')
      throw new Error(`Unknown Transact Type on line ${r.line}`);
    return {
      id: `line-${r.line}`,
      accountId: r.broker,
      assetId: r.ticker,
      type,
      tradeDate: r.month,
      quantity: r.units.value.abs(),
      unitPrice: r.price.value,
      amount: null,
      fees: dec('0'),
      currency: 'EUR',
      fxRateToEur: dec('1'),
      tradeDatePrecision: 'month',
    };
  });
}
