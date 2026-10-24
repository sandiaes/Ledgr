// The Activity list's filters and month groups. Pure (tested without rendering).
import {
  addMonths,
  assertIsoDate,
  type AssetTransactionRow,
  type Decimal,
  type IsoDate,
  type TransactionType,
} from '@ledgr/core';
import type { IconRole } from '../ui/Icon';

export type DateRange = 'all' | '1M' | '3M' | 'YTD' | '1Y' | 'custom';

export const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1Y' },
  { value: 'custom', label: 'From – to' },
];

export interface ActivityFilters {
  assetId: string | null;
  accountId: string | null;
  type: TransactionType | null;
  range: DateRange;
  /** Custom range, YYYY-MM-DD; an empty or invalid one is open-ended. */
  from: string;
  to: string;
}

export const NO_ACTIVITY_FILTERS: ActivityFilters = {
  assetId: null,
  accountId: null,
  type: null,
  range: 'all',
  from: '',
  to: '',
};

const validDate = (text: string): IsoDate | null => {
  try {
    assertIsoDate(text.trim());
    return text.trim();
  } catch {
    return null;
  }
};

/** The dates a range covers, both inclusive; null = open. */
export function rangeBounds(
  filters: Pick<ActivityFilters, 'range' | 'from' | 'to'>,
  today: IsoDate,
): { from: IsoDate | null; to: IsoDate | null } {
  switch (filters.range) {
    case 'all':
      return { from: null, to: null };
    case '1M':
    case '3M':
    case '1Y':
      return {
        from: addMonths(today, filters.range === '1M' ? -1 : filters.range === '3M' ? -3 : -12),
        to: null,
      };
    case 'YTD':
      return { from: `${today.slice(0, 4)}-01-01`, to: null };
    case 'custom':
      return { from: validDate(filters.from), to: validDate(filters.to) };
  }
}

/** A transfer belongs to both its brokers. */
export function filterActivity(
  rows: readonly AssetTransactionRow[],
  filters: ActivityFilters,
  today: IsoDate,
): AssetTransactionRow[] {
  const { from, to } = rangeBounds(filters, today);
  return rows.filter(
    (r) =>
      (!filters.assetId || r.assetId === filters.assetId) &&
      (!filters.accountId ||
        r.accountId === filters.accountId ||
        r.transferToAccountId === filters.accountId) &&
      (!filters.type || r.type === filters.type) &&
      (!from || r.date >= from) &&
      (!to || r.date <= to),
  );
}

/** The assets, brokers and types the rows contain: what the filters offer. */
export function activityOptions(rows: readonly AssetTransactionRow[]): {
  assets: Set<string>;
  accounts: string[];
  types: TransactionType[];
} {
  const assets = new Set<string>();
  const accounts = new Set<string>();
  const types = new Set<TransactionType>();
  for (const r of rows) {
    if (r.assetId) assets.add(r.assetId);
    accounts.add(r.accountId);
    if (r.transferToAccountId) accounts.add(r.transferToAccountId);
    types.add(r.type);
  }
  return { assets, accounts: [...accounts], types: [...types] };
}

/**
 * The filters with a value no longer offered (a certificado or its broker once
 * certificados are left out) back to "any".
 */
export function offeredActivityFilters(
  f: ActivityFilters,
  options: ReturnType<typeof activityOptions>,
): ActivityFilters {
  const assetId = f.assetId && !options.assets.has(f.assetId) ? null : f.assetId;
  const accountId = f.accountId && !options.accounts.includes(f.accountId) ? null : f.accountId;
  const type = f.type && !options.types.includes(f.type) ? null : f.type;
  return assetId === f.assetId && accountId === f.accountId && type === f.type
    ? f
    : { ...f, assetId, accountId, type };
}

export const activeActivityFilters = (f: ActivityFilters) =>
  [f.assetId, f.accountId, f.type, f.range === 'all' ? null : f.range].filter((v) => v !== null)
    .length;

/** Consecutive rows of the same month (rows are newest first). */
export function groupByMonth(
  rows: readonly AssetTransactionRow[],
): { month: string; rows: AssetTransactionRow[] }[] {
  const groups: { month: string; rows: AssetTransactionRow[] }[] = [];
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.rows.push(r);
    else groups.push({ month, rows: [r] });
  }
  return groups;
}

/** The icon of a row's type: down for money put in a position, up for money taken out. */
export const ACTIVITY_ICONS: Record<TransactionType, IconRole> = {
  buy: 'buy',
  subscription: 'buy',
  sell: 'sell',
  redemption: 'sell',
  dividend: 'income',
  interest: 'income',
  fee: 'other',
  deposit: 'other',
  withdrawal: 'other',
  transfer: 'other',
};

/** Money leaving your pocket (a purchase, a fee) or coming back to it (proceeds, income). */
const CASH_DIRECTION: Partial<Record<TransactionType, 'out' | 'in'>> = {
  buy: 'out',
  subscription: 'out',
  fee: 'out',
  sell: 'in',
  redemption: 'in',
  dividend: 'in',
  interest: 'in',
};

/**
 * A row's total as the list shows it: money out with a −, money in with a +, other rows
 * (a transfer's fee, deposits) unsigned. Only the sign of the figure core computed changes;
 * the amount is the row's own `totalEur`.
 */
export function listedTotal(row: Pick<AssetTransactionRow, 'type' | 'totalEur'>): {
  value: Decimal;
  sign: boolean;
} {
  const direction = CASH_DIRECTION[row.type];
  if (direction === 'out') return { value: row.totalEur.neg(), sign: true };
  return { value: row.totalEur, sign: direction === 'in' };
}
