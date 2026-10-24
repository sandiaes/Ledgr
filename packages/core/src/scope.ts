import { compareDates } from './dates';
import { ZERO, type Decimal } from './decimal';
import type { Holding } from './holdings';
import {
  acquisitionCostEur,
  disposalProceedsEur,
  isAcquisition,
  isDisposal,
  prepareLedger,
} from './ledger';
import type { ValueSnapshot } from './returns';
import type { Asset, AssetType, Transaction } from './types';

/**
 * Which assets the figures cover (docs/kpis.md §0.2): every asset whose type is not
 * excluded. Rows without an asset (cash interest, fee rows, deposits, withdrawals) are
 * always in scope, and so is a row whose asset is unknown. Every KPI, series and
 * aggregation function takes an optional scope; without one it covers everything.
 */
export interface AssetScope {
  /** Asset types left out; empty for every asset. */
  readonly excludeTypes: readonly AssetType[];
  /** Whether a row's asset is in scope. */
  includes(assetId: string | null): boolean;
}

/** The order of the per-type snapshot columns. */
export const ASSET_TYPES: readonly AssetType[] = ['stock', 'etf', 'crypto', 'certificado_aforro'];

/** Every asset: the default of every function. */
export const FULL_SCOPE: AssetScope = { excludeTypes: [], includes: () => true };

/** The scope leaving out `excludeTypes`, with the asset types read from `assets`. */
export function assetScope(input: {
  assets: readonly Pick<Asset, 'id' | 'assetType'>[];
  excludeTypes?: readonly AssetType[];
}): AssetScope {
  const excludeTypes = ASSET_TYPES.filter((t) => input.excludeTypes?.includes(t));
  if (excludeTypes.length === 0) return FULL_SCOPE;
  const out = new Set(
    input.assets.filter((a) => excludeTypes.includes(a.assetType)).map((a) => a.id),
  );
  return { excludeTypes, includes: (assetId) => assetId === null || !out.has(assetId) };
}

/** Covers every asset (no scope given, or nothing excluded). */
export function isFullScope(scope?: AssetScope): boolean {
  return !scope || scope.excludeTypes.length === 0;
}

/** The ledger rows in scope (the same array with the full scope). */
export function scopeTransactions(
  transactions: readonly Transaction[],
  scope?: AssetScope,
): readonly Transaction[] {
  if (!scope || isFullScope(scope)) return transactions;
  return transactions.filter((t) => scope.includes(t.assetId));
}

/** The holdings in scope (the same array with the full scope). */
export function scopeHoldings<H extends Pick<Holding, 'assetType'>>(
  holdings: readonly H[],
  scope?: AssetScope,
): readonly H[] {
  if (!scope || isFullScope(scope)) return holdings;
  return holdings.filter((h) => !scope.excludeTypes.includes(h.assetType));
}

/**
 * The snapshots of the portfolio in scope. With the full scope they are returned as
 * stored. Otherwise V(d) is the sum of the day's per-type values of the types in scope
 * (each type's value is the sum of its holdings, so this is the value of the holdings in
 * scope; nothing is subtracted), and NI(d) is net invested of the rows in scope up to d,
 * from the ledger (the snapshot stores it only as a total); the per-type values of the types
 * out of scope become 0. Days before the first row in scope are dropped: the portfolio in
 * scope did not exist yet, and the daily job starts at the first row (#27). `transactions`
 * is the whole ledger; it is scoped here. Throws a RangeError for a snapshot without
 * per-type values.
 */
export function scopeSnapshots(
  snapshots: readonly ValueSnapshot[],
  transactions: readonly Transaction[],
  scope?: AssetScope,
): ValueSnapshot[] {
  if (!scope || isFullScope(scope)) return [...snapshots];
  const types = ASSET_TYPES.filter((t) => !scope.excludeTypes.includes(t));
  const ledger = prepareLedger(scopeTransactions(transactions, scope));
  const first = ledger[0]?.tradeDate;
  const kept = first === undefined ? [] : snapshots.filter((s) => s.date >= first);
  const sorted = [...kept].sort((a, b) => compareDates(a.date, b.date));

  // One pass: net invested grows row by row in ledger order, read at each snapshot day.
  const ni = new Map<string, Decimal>();
  let net = ZERO;
  let i = 0;
  for (const s of sorted) {
    while (i < ledger.length && (ledger[i] as Transaction).tradeDate <= s.date) {
      const tx = ledger[i] as Transaction;
      if (isAcquisition(tx.type)) net = net.plus(acquisitionCostEur(tx));
      else if (isDisposal(tx.type)) net = net.minus(disposalProceedsEur(tx));
      i++;
    }
    ni.set(s.date, net);
  }

  return kept.map((s) => {
    const byType = s.valueByTypeEur;
    if (!byType) throw new RangeError(`Snapshot on ${s.date} has no per-type values`);
    return {
      date: s.date,
      valueEur: types.reduce((sum, t) => sum.plus(byType[t]), ZERO),
      netInvestedEur: ni.get(s.date) as Decimal,
      // Types out of scope count as 0, as in a snapshot of the ledger without them.
      valueByTypeEur: Object.fromEntries(
        ASSET_TYPES.map((t) => [t, types.includes(t) ? byType[t] : ZERO]),
      ) as Record<AssetType, Decimal>,
    };
  });
}
