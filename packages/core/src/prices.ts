import { addDays, daysBetween, type IsoDate } from './dates';
import { Decimal, ONE, ZERO } from './decimal';
import { isAcquisition, isDisposal, prepareLedger } from './ledger';
import { createPriceLookup, type PriceRow } from './lookups';
import type { PriceLookup, Transaction } from './types';

/** A price is stale when it is more than this many calendar days older than the date. */
export const DEFAULT_STALE_AFTER_DAYS = 3;
/** A certificado factor (or subscription price) older than this is flagged. */
export const DEFAULT_CA_MAX_AGE_DAYS = 35;
/** Prices are fetched from this many days before a holding period, so a close exists on day one. */
export const PRICE_LOOKBACK_DAYS = 14;

/** Calendar days from `valueDate` to `asOf` (0 when the same day). */
export function ageInDays(valueDate: IsoDate, asOf: IsoDate): number {
  return daysBetween(valueDate, asOf);
}

export function isStale(ageDays: number, limitDays: number): boolean {
  return ageDays > limitDays;
}

/** Mirrors a public.prices row: raw close, plus the split ratio on a split date. */
export interface StoredPriceRow extends PriceRow {
  /** New shares per old share for a split effective on `date`; null on other days. */
  splitFactor: Decimal | null;
}

/**
 * Split-adjusted closes: each raw close divided by the product of that asset's split
 * factors dated after it. The ledger records post-split units (assumption #23), so these
 * are the closes to value it with. A split row's own close is already post-split.
 * Only splits present in `rows` are applied, so pass every row after the earliest date
 * you need.
 */
export function splitAdjustPrices(rows: readonly StoredPriceRow[]): PriceRow[] {
  const byAsset = new Map<string, StoredPriceRow[]>();
  for (const row of rows) byAsset.set(row.assetId, [...(byAsset.get(row.assetId) ?? []), row]);
  const out: PriceRow[] = [];
  for (const list of byAsset.values()) {
    const desc = [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    let factor = ONE;
    for (const row of desc) {
      if (row.splitFactor && !row.splitFactor.gt(0)) {
        throw new RangeError(`Split factor for ${row.assetId} on ${row.date} must be > 0`);
      }
      out.push({
        assetId: row.assetId,
        date: row.date,
        close: factor.eq(ONE) ? row.close : row.close.div(factor),
        currency: row.currency,
      });
      if (row.splitFactor) factor = factor.times(row.splitFactor);
    }
  }
  return out;
}

/**
 * Stand-in prices from the ledger itself: the EUR unit price (unit price x the row's fx
 * rate) of an asset's latest trade on or before the date; within a day, the last row in
 * ledger order. Snapshots flag a value from here as stale (source 'trade').
 */
export function createTradePriceLookup(transactions: readonly Transaction[]): PriceLookup {
  const last = new Map<string, PriceRow>();
  for (const tx of prepareLedger(transactions)) {
    if (!tx.assetId || !tx.unitPrice || !(isAcquisition(tx.type) || isDisposal(tx.type))) continue;
    last.set(`${tx.assetId}|${tx.tradeDate}`, {
      assetId: tx.assetId,
      date: tx.tradeDate,
      close: tx.unitPrice.times(tx.fxRateToEur),
      currency: 'EUR',
    });
  }
  return createPriceLookup([...last.values()]);
}

/** A run of days on which an asset was held (units summed over all accounts). */
export interface HoldingPeriod {
  assetId: string;
  /** First day with units > 0. */
  from: IsoDate;
  /** The day the units went back to 0 (held at its start, none at its end); null while held. */
  to: IsoDate | null;
}

/**
 * When each asset was held, from the ledger alone. Transfers move units between accounts
 * and do not change the total quantity. A period closed and reopened on the same day
 * stays one period.
 */
export function holdingPeriods(
  transactions: readonly Transaction[],
  asOf?: IsoDate,
): HoldingPeriod[] {
  const qty = new Map<string, Decimal>();
  const open = new Map<string, HoldingPeriod>();
  const closed = new Map<string, HoldingPeriod>();
  const periods: HoldingPeriod[] = [];
  for (const tx of prepareLedger(transactions, asOf)) {
    if (!tx.assetId || !tx.quantity) continue;
    const delta = isAcquisition(tx.type)
      ? tx.quantity
      : isDisposal(tx.type)
        ? tx.quantity.neg()
        : null;
    if (!delta) continue;
    const before = qty.get(tx.assetId) ?? ZERO;
    const after = before.plus(delta);
    qty.set(tx.assetId, after);
    if (before.lte(0) && after.gt(0)) {
      const previous = closed.get(tx.assetId);
      if (previous && previous.to === tx.tradeDate) {
        previous.to = null;
        open.set(tx.assetId, previous);
      } else {
        const period: HoldingPeriod = { assetId: tx.assetId, from: tx.tradeDate, to: null };
        periods.push(period);
        open.set(tx.assetId, period);
      }
    } else if (before.gt(0) && after.lte(0)) {
      const period = open.get(tx.assetId);
      if (period) {
        period.to = tx.tradeDate;
        closed.set(tx.assetId, period);
      }
      open.delete(tx.assetId);
    }
  }
  return periods;
}

/**
 * The date range to fetch prices for one holding period: from PRICE_LOOKBACK_DAYS before
 * it starts to the day it ended (or `until` while still held). Null when nothing is needed
 * up to `until`.
 */
export function priceFetchRange(
  period: HoldingPeriod,
  until: IsoDate,
): { from: IsoDate; to: IsoDate } | null {
  const from = addDays(period.from, -PRICE_LOOKBACK_DAYS);
  const to = period.to && period.to < until ? period.to : until;
  return from <= to ? { from, to } : null;
}

/**
 * EUR per 1 unit of a currency from an ECB reference rate, which is quoted as units of the
 * currency per 1 EUR (USD 1.0856 = 1 EUR -> 0.921149...). Rounded half-even to 18 decimals,
 * the scale of numeric(38,18), so the stored value is deterministic.
 */
export function rateToEurFromEcbQuote(unitsPerEur: Decimal): Decimal {
  if (!unitsPerEur.gt(0)) throw new RangeError('ECB quote must be > 0');
  return ONE.div(unitsPerEur).toDecimalPlaces(18, Decimal.ROUND_HALF_EVEN);
}

/** Listing currency of the exchanges this ledger supports, by ISO 10383 MIC. */
const LISTING_CURRENCY_BY_MIC: Readonly<Record<string, string>> = {
  XNAS: 'USD', // Nasdaq
  XNYS: 'USD', // New York Stock Exchange
  XASE: 'USD', // NYSE American
  XETR: 'EUR', // Xetra
};

/** The currency listings on `mic` are quoted in, or null for an exchange not listed here. */
export function listingCurrencyForMic(mic: string): string | null {
  return LISTING_CURRENCY_BY_MIC[mic] ?? null;
}

/**
 * Daily closes with intraday quotes added: a quote counts only for a day that has no daily
 * close yet (the official close, fetched the next morning, wins once it exists). Quotes
 * dated after `asOf` are dropped. Rows are in today's share count, like split-adjusted
 * closes (#23).
 */
export function withLiveQuotes(
  closes: readonly PriceRow[],
  quotes: readonly PriceRow[],
  asOf: IsoDate,
): PriceRow[] {
  const byKey = new Map(closes.map((r) => [`${r.assetId}|${r.date}`, r]));
  for (const q of quotes) {
    const key = `${q.assetId}|${q.date}`;
    if (q.date <= asOf && !byKey.has(key)) byKey.set(key, q);
  }
  return [...byKey.values()];
}
