import { assertIsoDate, type IsoDate } from './dates';
import type { CaFactor, CaFactorLookup } from './certificados';
import { ONE, type Decimal } from './decimal';
import type { FxLookup, PriceLookup, PriceQuote } from './types';

/** Last element whose date is <= `date`, by binary search over date-sorted rows. */
function onOrBefore<T extends { date: IsoDate }>(rows: readonly T[], date: IsoDate): T | null {
  let lo = 0;
  let hi = rows.length - 1;
  let found: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = rows[mid] as T;
    if (row.date <= date) {
      found = row;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function index<T extends { date: IsoDate }>(rows: readonly T[], key: (row: T) => string) {
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    assertIsoDate(row.date);
    const list = byKey.get(key(row)) ?? [];
    list.push(row);
    byKey.set(key(row), list);
  }
  for (const [k, list] of byKey) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (let i = 1; i < list.length; i++) {
      if ((list[i] as T).date === (list[i - 1] as T).date) {
        throw new RangeError(`Duplicate row for ${k} on ${(list[i] as T).date}`);
      }
    }
  }
  return byKey;
}

export interface PriceRow extends PriceQuote {
  assetId: string;
}

/** In-memory lookup over public.prices rows: latest close on or before the date. */
export function createPriceLookup(rows: readonly PriceRow[]): PriceLookup {
  const byAsset = index(rows, (r) => r.assetId);
  return (assetId, date) => {
    const row = onOrBefore(byAsset.get(assetId) ?? [], date);
    return row ? { date: row.date, close: row.close, currency: row.currency } : null;
  };
}

export interface FxRow {
  currency: string;
  date: IsoDate;
  /** EUR per 1 unit of `currency`. */
  rateToEur: Decimal;
}

/** In-memory lookup over public.fx_rates rows. EUR is always 1. */
export function createFxLookup(rows: readonly FxRow[]): FxLookup {
  const byCurrency = index(rows, (r) => r.currency);
  return (currency, date) => {
    if (currency === 'EUR') return ONE;
    return onOrBefore(byCurrency.get(currency) ?? [], date)?.rateToEur ?? null;
  };
}

/**
 * In-memory lookup over public.ca_factors rows: the latest factor of a subscription whose
 * month is on or before the date. Months must be the 1st of a month, factors > 0, and
 * there is at most one factor per subscription and month.
 */
export function createCaFactorLookup(factors: readonly CaFactor[]): CaFactorLookup {
  for (const f of factors) {
    assertIsoDate(f.month);
    if (!f.month.endsWith('-01')) throw new RangeError(`CA factor month ${f.month} is not a 1st`);
    if (!f.factor.gt(0)) throw new RangeError(`CA factor for ${f.month} must be > 0`);
  }
  const rows = factors.map((f) => ({ date: f.month, row: f }));
  const bySubscription = index(rows, (r) => r.row.subscriptionId);
  return (subscriptionId, date) =>
    onOrBefore(bySubscription.get(subscriptionId) ?? [], date)?.row ?? null;
}
