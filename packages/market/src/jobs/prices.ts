// Prices: raw daily closes for each asset, only for the days it was held (from 14 days
// before each holding period to the day it ended). Certificados are never fetched.
//   backfill  every holding period; ranges already stored are skipped unless refetch
//   daily     assets held in the last 5 days: from the day after the newest stored close
//             (re-reading the last 5 days for late corrections) up to yesterday; with
//             `resolve`, assets still waiting for a symbol are resolved first (resolve.ts)
// A missing price never fails the run: the asset is flagged stale and snapshots fall back
// to the last known price. Upserts on (asset_id, price_date) are idempotent.
import {
  addDays,
  ageInDays,
  dec,
  holdingPeriods,
  isStale,
  priceFetchRange,
  type IsoDate,
} from '@ledgr/core';
import type { PriceUpsert } from '../db';
import { ProviderError } from '../http';
import { NOT_FETCHED, type PriceProvider } from '../providers';
import { errorIssue, IssueLog, type JobContext, type JobOutcome } from './common';
import { resolvePendingSymbols, type ResolveCounts, type ResolveStepOptions } from './resolve';

export const DAILY_REFRESH_DAYS = 5;

export interface PricesOptions {
  mode: 'daily' | 'backfill';
  /** Fetch no earlier than this. */
  from?: IsoDate;
  /** Last day to fetch; default yesterday. */
  to?: IsoDate;
  /** Backfill: fetch ranges that already look complete too. */
  refetch?: boolean;
  /**
   * Daily only: first resolve the symbols of assets still on price_source 'manual' (added
   * in the app), so their closes are fetched in the same run (jobs/resolve.ts). Its
   * problems make the run 'partial' at worst.
   */
  resolve?: ResolveStepOptions;
}

type Range = { from: IsoDate; to: IsoDate };

/** Overlapping or adjacent ranges joined. */
export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= addDays(last.to, 1)) {
      if (r.to > last.to) last.to = r.to;
    } else out.push({ ...r });
  }
  return out;
}

export async function runPrices(ctx: JobContext, opts: PricesOptions): Promise<JobOutcome> {
  const to = opts.to ?? addDays(ctx.today, -1);
  const recent = addDays(to, -DAILY_REFRESH_DAYS);
  const [assets, transactions] = await Promise.all([
    ctx.db.loadAssets(),
    ctx.db.loadTransactions(),
  ]);
  const periods = holdingPeriods(transactions, to);
  const log = new IssueLog();
  const counts = {
    assets: 0,
    requests: 0,
    rows: 0,
    splits: 0,
    stale: 0,
    failed: 0,
    unpriced: 0,
    skipped: 0,
  };
  const exhausted = new Set<string>();
  const lastCall = new Map<string, number>();
  let resolution: ResolveCounts | null = null;
  if (opts.mode === 'daily' && opts.resolve) {
    resolution = await resolvePendingSymbols(
      ctx,
      { assets, transactions, to, log, lastCall },
      opts.resolve,
    );
  }

  const fetchBars = async (
    provider: PriceProvider,
    symbol: string,
    from: IsoDate,
    until: IsoDate,
  ) => {
    const wait =
      (lastCall.get(provider.id) ?? -Infinity) + provider.minIntervalMs - ctx.now().getTime();
    if (wait > 0) await ctx.http.sleep(wait);
    lastCall.set(provider.id, ctx.now().getTime());
    counts.requests++;
    return provider.fetchDaily(symbol, from, until);
  };

  for (const asset of assets) {
    if (asset.assetType === 'certificado_aforro') continue;
    const own = periods.filter((p) => p.assetId === asset.id);
    if (own.length === 0) continue;
    let ranges = mergeRanges(
      own.map((p) => priceFetchRange(p, to)).filter((r): r is Range => r !== null),
    );
    if (opts.mode === 'daily') ranges = ranges.filter((r) => r.to >= recent);
    if (ranges.length === 0) continue;
    const heldAtEnd = own.some((p) => p.to === null);

    const provider = NOT_FETCHED.has(asset.priceSource)
      ? undefined
      : ctx.providers.get(asset.priceSource);
    if (!provider || !asset.priceSourceId) {
      counts.unpriced++;
      log.add({
        code:
          NOT_FETCHED.has(asset.priceSource) || !asset.priceSourceId
            ? 'no_price_source'
            : 'no_provider_key',
        assetId: asset.id,
        provider: asset.priceSource,
      });
      continue;
    }
    counts.assets++;
    const bounds = await ctx.db.priceBounds(asset.id);
    let first = bounds?.first ?? null;
    let last = bounds?.last ?? null;

    for (const range of ranges) {
      let from = opts.from && opts.from > range.from ? opts.from : range.from;
      if (opts.mode === 'daily' && !opts.from && last) {
        const resume = addDays(last, 1) < recent ? addDays(last, 1) : recent;
        if (resume > from) from = resume;
      }
      if (
        opts.mode === 'backfill' &&
        !opts.refetch &&
        bounds &&
        bounds.first <= addDays(range.from, 7) &&
        bounds.last >= addDays(range.to, -4)
      ) {
        counts.skipped++;
        continue;
      }
      if (from > range.to) continue;
      if (exhausted.has(provider.id)) {
        counts.failed++;
        log.add({ code: 'rate_limited', assetId: asset.id, provider: provider.id });
        continue;
      }

      let bars;
      try {
        bars = await fetchBars(provider, asset.priceSourceId, from, range.to);
      } catch (e) {
        counts.failed++;
        log.add(errorIssue(e, { assetId: asset.id }));
        const limited =
          (e instanceof ProviderError && e.code === 'rate_limited') ||
          (e as { status?: number }).status === 429;
        if (limited) exhausted.add(provider.id);
        continue;
      }
      if (bars.some((b) => b.currency !== null && b.currency !== asset.tradingCurrency)) {
        counts.failed++;
        log.add({ code: 'currency_mismatch', assetId: asset.id, provider: provider.id });
        continue;
      }
      const rows: PriceUpsert[] = bars
        .filter((b) => dec(b.close).gt(0))
        .map((b) => ({
          assetId: asset.id,
          date: b.date,
          close: b.close,
          currency: asset.tradingCurrency,
          source: provider.id,
          splitFactor: b.splitFactor,
        }));
      await ctx.db.upsertPrices(rows);
      counts.rows += rows.length;
      for (const r of rows) {
        if (first === null || r.date < first) first = r.date;
        if (last === null || r.date > last) last = r.date;
        if (r.splitFactor) {
          counts.splits++;
          log.add({ code: 'split', assetId: asset.id, date: r.date });
        }
      }
    }

    if (heldAtEnd && (last === null || isStale(ageInDays(last, to), ctx.staleAfterDays))) {
      counts.stale++;
      log.add({ code: 'stale', assetId: asset.id, ...(last ? { date: last } : {}) });
    }
    const firstHeld = own[0]?.from as IsoDate;
    if (opts.mode === 'backfill' && (first === null || first > firstHeld)) {
      log.add({ code: 'no_price_before_first_trade', assetId: asset.id, date: firstHeld });
    }
  }

  return {
    status: counts.failed === 0 && !resolution?.unresolved ? 'ok' : 'partial',
    counts: { ...counts, ...resolution, issues_dropped: log.dropped },
    issues: log.issues,
  };
}
