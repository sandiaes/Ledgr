// Search, filters and sort of the Positions list. Comparisons only: every figure comes
// from core (buildPositions).
import type { AssetType, ClosedPosition, Decimal, PositionRow, PositionsView } from '@ledgr/core';
import { brokerLabel, type Names } from '../ui/labels';

export type SortKey = 'value' | 'weight' | 'gain' | 'day';
export interface Sort {
  key: SortKey;
  dir: 'asc' | 'desc';
}
export const DEFAULT_SORT: Sort = { key: 'value', dir: 'desc' };

export const SORT_LABELS: Record<SortKey, string> = {
  value: 'Value',
  weight: 'Weight',
  gain: 'Gain €',
  day: 'Day change %',
};

/** Each group is "any of" the chosen values (none chosen: all); groups combine with "and". */
export interface Filters {
  types: AssetType[];
  brokers: string[];
  currencies: string[];
  /** Only stale prices and "price pending" (and certificado factors over 35 days). */
  staleOnly: boolean;
}
export const NO_FILTERS: Filters = { types: [], brokers: [], currencies: [], staleOnly: false };

export const activeFilterCount = (f: Filters) =>
  f.types.length + f.brokers.length + f.currencies.length + (f.staleOnly ? 1 : 0);

/** The values the filter offers: those of the open and closed positions in the view. */
export function filterOptions(
  view: Pick<PositionsView, 'positions' | 'closed'>,
  names: Names,
): { types: AssetType[]; brokers: string[]; currencies: string[] } {
  const types = [
    ...new Set([
      ...view.positions.map((p) => p.assetType),
      ...view.closed.flatMap((c) => names.assets.get(c.assetId)?.assetType ?? []),
    ]),
  ].sort() as AssetType[];
  const brokers = [
    ...new Set([
      ...view.positions.flatMap((p) => p.accountIds),
      ...view.closed.flatMap((c) => c.accounts.map((a) => a.accountId)),
    ]),
  ].sort((a, b) => brokerLabel(names, a).localeCompare(brokerLabel(names, b)));
  const currencies = [
    ...new Set([
      ...view.positions.map((p) => p.currency),
      ...view.closed.flatMap((c) => names.assets.get(c.assetId)?.tradingCurrency ?? []),
    ]),
  ].sort();
  return { types, brokers, currencies };
}

/**
 * The chosen values still offered (e.g. "Certificados" is no longer a type once they are
 * left out): a value that is not offered any more stops filtering.
 */
export function offeredFilters(f: Filters, options: ReturnType<typeof filterOptions>): Filters {
  const keep = <T>(chosen: T[], offered: readonly T[]) => {
    const kept = chosen.filter((v) => offered.includes(v));
    return kept.length === chosen.length ? chosen : kept;
  };
  const types = keep(f.types, options.types);
  const brokers = keep(f.brokers, options.brokers);
  const currencies = keep(f.currencies, options.currencies);
  return types === f.types && brokers === f.brokers && currencies === f.currencies
    ? f
    : { ...f, types, brokers, currencies };
}

/** Case-insensitive match on ticker, name or ISIN; an empty query matches everything. */
export function matchesSearch(names: Names, assetId: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const a = names.assets.get(assetId);
  return [a?.ticker, a?.name, a?.isin].some((s) => s?.toLowerCase().includes(q));
}

export function filterPositions(
  rows: readonly PositionRow[],
  names: Names,
  query: string,
  f: Filters,
): PositionRow[] {
  return rows.filter(
    (r) =>
      matchesSearch(names, r.assetId, query) &&
      (f.types.length === 0 || f.types.includes(r.assetType)) &&
      (f.brokers.length === 0 || r.accountIds.some((id) => f.brokers.includes(id))) &&
      (f.currencies.length === 0 || f.currencies.includes(r.currency)) &&
      (!f.staleOnly || r.valuation.stale),
  );
}

/** Closed positions take the search, type, broker and currency filters. */
export function filterClosed(
  rows: readonly ClosedPosition[],
  names: Names,
  query: string,
  f: Filters,
): ClosedPosition[] {
  return rows.filter((r) => {
    const a = names.assets.get(r.assetId);
    return (
      matchesSearch(names, r.assetId, query) &&
      (f.types.length === 0 || (a !== undefined && f.types.includes(a.assetType))) &&
      (f.brokers.length === 0 || r.accounts.some((x) => f.brokers.includes(x.accountId))) &&
      (f.currencies.length === 0 || (a !== undefined && f.currencies.includes(a.tradingCurrency)))
    );
  });
}

const keyOf: Record<SortKey, (r: PositionRow) => Decimal | null> = {
  value: (r) => r.valueEur,
  weight: (r) => r.weight,
  gain: (r) => r.unrealizedEur,
  day: (r) => r.dayChangePct,
};

/**
 * Sorted by the key in the chosen direction; rows without a figure (a new position's day
 * %, a weight of an empty portfolio) go last either way. Ties by asset id.
 */
export function sortPositions(rows: readonly PositionRow[], sort: Sort): PositionRow[] {
  const key = keyOf[sort.key];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else {
      const c = x.comparedTo(y);
      if (c !== 0) return sign * c;
    }
    return a.assetId.localeCompare(b.assetId);
  });
}
