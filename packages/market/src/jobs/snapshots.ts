// Snapshots: one portfolio_snapshots row per calendar day, from packages/core's
// buildSnapshot over the ledger, split-adjusted closes, ECB rates and CA factors.
// Deterministic (same inputs, same rows) and idempotent (upsert on user and date).
// A daily run recomputes from the 1st of the previous month, so a CA factor entered late
// is picked up. Cash is not tracked: values are the investments alone.
import {
  addDays,
  addMonths,
  buildSnapshot,
  createCaFactorLookup,
  createFxLookup,
  createPriceLookup,
  createTradePriceLookup,
  holdingPeriods,
  MissingValuationError,
  splitAdjustPrices,
  type IsoDate,
  type PortfolioSnapshot,
} from '@ledgr/core';
import { IssueLog, type JobContext, type JobOutcome } from './common';

/** Rows loaded before the window, so a last known price or rate exists on its first day. */
const LOOKBACK_DAYS = 31;
const WRITE_BATCH = 200;

/** Default window start: the 1st of the month before `to`. */
export function defaultSnapshotFrom(to: IsoDate): IsoDate {
  return `${addMonths(to, -1).slice(0, 7)}-01`;
}

export async function runSnapshots(
  ctx: JobContext,
  opts: { from?: IsoDate; to?: IsoDate } = {},
): Promise<JobOutcome> {
  const to = opts.to ?? addDays(ctx.today, -1);
  const [assets, transactions, ca] = await Promise.all([
    ctx.db.loadAssets(),
    ctx.db.loadTransactions(),
    ctx.db.loadCa(),
  ]);
  const log = new IssueLog();
  const counts = { days: 0, written: 0, stale_days: 0, skipped: 0 };
  const firstTrade = transactions.reduce<IsoDate | null>(
    (m, t) => (m === null || t.tradeDate < m ? t.tradeDate : m),
    null,
  );
  let from = opts.from ?? defaultSnapshotFrom(to);
  if (firstTrade && from < firstTrade) from = firstTrade;
  if (!firstTrade || from > to) return { status: 'ok', counts, issues: [] };

  const loadFrom = addDays(from, -LOOKBACK_DAYS);
  const priceRows = await ctx.db.loadPrices({ from: loadFrom });
  // Assets held in the window with nothing stored near its start: add their last older close.
  const caIds = new Set(
    assets.filter((a) => a.assetType === 'certificado_aforro').map((a) => a.id),
  );
  const covered = new Set(priceRows.filter((r) => r.date <= from).map((r) => r.assetId));
  const heldInWindow = new Set(
    holdingPeriods(transactions, to)
      .filter((p) => p.to === null || p.to >= from)
      .map((p) => p.assetId),
  );
  for (const assetId of heldInWindow) {
    if (caIds.has(assetId) || covered.has(assetId)) continue;
    const older = await ctx.db.latestPriceBefore(assetId, loadFrom);
    if (older) priceRows.push(older);
  }

  const input = {
    transactions,
    assets: assets.map((a) => ({
      id: a.id,
      assetType: a.assetType,
      tradingCurrency: a.tradingCurrency,
    })),
    prices: createPriceLookup(splitAdjustPrices(priceRows)),
    fx: createFxLookup(await ctx.db.loadFx({ from: loadFrom })),
    ca: { subscriptions: ca.subscriptions, factors: createCaFactorLookup(ca.factors) },
    fallbackPrices: createTradePriceLookup(transactions),
    staleAfterDays: ctx.staleAfterDays,
    caMaxAgeDays: ctx.caMaxAgeDays,
    trackCash: false,
  };

  let batch: PortfolioSnapshot[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    await ctx.db.upsertSnapshots(batch);
    counts.written += batch.length;
    batch = [];
  };
  for (let date = from; date <= to; date = addDays(date, 1)) {
    counts.days++;
    try {
      const snapshot = buildSnapshot({ ...input, date });
      if (snapshot.stale) counts.stale_days++;
      batch.push(snapshot);
    } catch (e) {
      if (!(e instanceof MissingValuationError)) throw e;
      // Prices always have the trade-price fallback, so this is a missing FX rate.
      counts.skipped++;
      log.add({ code: 'missing_fx', date });
    }
    if (batch.length >= WRITE_BATCH) await flush();
  }
  await flush();

  return {
    status: counts.skipped === 0 ? 'ok' : 'partial',
    counts: { ...counts, issues_dropped: log.dropped },
    issues: log.issues,
  };
}
