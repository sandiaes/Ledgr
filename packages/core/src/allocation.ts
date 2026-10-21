import { ZERO, type Decimal } from './decimal';
import { MissingValuationError } from './errors';
import type { Holding } from './holdings';

export type AllocationDimension = 'assetType' | 'asset' | 'account' | 'currency';

export interface AllocationSlice {
  key: string;
  valueEur: Decimal;
  /** Share of the total market value of all holdings (0 when the total is 0). */
  weight: Decimal;
}

/** [group key, value] pairs a holding contributes; by account it is split by units held. */
const partsOf: Record<AllocationDimension, (h: Holding) => [string, Decimal][]> = {
  assetType: (h) => [[h.assetType, h.marketValueEur as Decimal]],
  asset: (h) => [[h.assetId, h.marketValueEur as Decimal]],
  account: (h) => h.accounts.map((a) => [a.accountId, a.marketValueEur as Decimal]),
  currency: (h) => [[h.currency, h.marketValueEur as Decimal]],
};

/**
 * Market value per group, largest first (ties by key). Covers positions only, not cash.
 * Throws MissingValuationError if any holding has no market value.
 */
export function allocation(
  holdings: readonly Holding[],
  by: AllocationDimension,
): AllocationSlice[] {
  const unvalued = holdings.filter((h) => !h.marketValueEur).map((h) => h.assetId);
  if (unvalued.length > 0) throw new MissingValuationError([...new Set(unvalued)]);

  const groups = new Map<string, Decimal>();
  for (const h of holdings) {
    for (const [key, value] of partsOf[by](h)) {
      groups.set(key, (groups.get(key) ?? ZERO).plus(value));
    }
  }
  const total = [...groups.values()].reduce((s, v) => s.plus(v), ZERO);
  return [...groups.entries()]
    .map(([key, valueEur]) => ({
      key,
      valueEur,
      weight: total.isZero() ? ZERO : valueEur.div(total),
    }))
    .sort((a, b) => b.valueEur.comparedTo(a.valueEur) || (a.key < b.key ? -1 : 1));
}

export interface Concentration {
  /** The N largest assets (aggregated across accounts). */
  top: AllocationSlice[];
  /** Combined weight of `top`. */
  topWeight: Decimal;
}

export function concentration(holdings: readonly Holding[], topN: number): Concentration {
  if (!Number.isInteger(topN) || topN < 1) throw new RangeError('topN must be a positive integer');
  const top = allocation(holdings, 'asset').slice(0, topN);
  return { top, topWeight: top.reduce((s, x) => s.plus(x.weight), ZERO) };
}
