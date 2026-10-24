// Symbol resolution inside the daily price run (docs/app-plan.md §5, decision D3): an
// asset added in the app is saved with price_source 'manual' ("price pending"); before the
// prices are fetched, up to 5 such assets go through the same resolveSymbols code as
// `pnpm prices resolve`. A resolved symbol is written and that asset's closes are fetched
// in the same run. Nothing here may break the price run: every asset is resolved inside
// its own try/catch with a time limit, and any problem becomes an issue.
import { dayNumber, holdingPeriods, type IsoDate, type Transaction } from '@ledgr/core';
import type { AssetRecord } from '../db';
import { candidateFor, resolveSymbols, type SymbolResolution } from '../symbols';
import { errorIssue, type IssueLog, type JobContext } from './common';

/** At most this many per run: the Edge Function's limits and OpenFIGI's 25 requests/minute. */
export const RESOLVE_PER_RUN = 5;
/** Per asset: OpenFIGI and one provider check, each retried once by `request`. */
export const RESOLVE_TIMEOUT_MS = 15_000;
/** No new asset is started after this long, so the price fetch keeps its time. */
export const RESOLVE_BUDGET_MS = 40_000;

/** Resolves one asset (resolveSymbols for it, by default). */
export type SymbolResolver = (asset: AssetRecord) => Promise<SymbolResolution>;

export interface ResolveStepOptions {
  /** OpenFIGI key (optional; without one 25 requests/minute). */
  openFigiKey?: string;
  /** Replaces resolveSymbols (tests). */
  resolver?: SymbolResolver;
  limit?: number;
  timeoutMs?: number;
  budgetMs?: number;
}

export interface ResolveCounts {
  resolve_candidates: number;
  resolve_attempted: number;
  resolved: number;
  unresolved: number;
}

export class ResolveTimeoutError extends Error {
  override name = 'ResolveTimeoutError';
}

/**
 * Assets waiting for a symbol: not certificados, price_source 'manual', held at the end of
 * `to`, and with what the resolver needs (stocks and ETFs: ISIN and a supported exchange;
 * crypto: a ticker like BTCEUR). Ordered by id and rotated by the day, so that assets that
 * keep failing cannot hold back the others: each is tried within ceil(n / limit) days.
 */
export function resolutionCandidates(
  assets: readonly AssetRecord[],
  transactions: readonly Transaction[],
  to: IsoDate,
  limit = RESOLVE_PER_RUN,
): { picked: AssetRecord[]; waiting: number } {
  const held = new Set(
    holdingPeriods(transactions, to)
      .filter((p) => p.to === null)
      .map((p) => p.assetId),
  );
  const all = assets
    .filter(
      (a) =>
        a.priceSource === 'manual' &&
        a.assetType !== 'certificado_aforro' &&
        held.has(a.id) &&
        candidateFor(a).kind === 'listing',
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  if (all.length <= limit) return { picked: all, waiting: 0 };
  const start = (dayNumber(to) * limit) % all.length;
  const rotated = [...all.slice(start), ...all.slice(0, start)];
  return { picked: rotated.slice(0, limit), waiting: all.length - limit };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ResolveTimeoutError('symbol resolution timed out')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The resolution step. Writes each resolved symbol (assets.price_source / _id) and updates
 * `assets` in place, so the price fetch that follows includes it. Never throws.
 */
export async function resolvePendingSymbols(
  ctx: JobContext,
  input: {
    assets: AssetRecord[];
    transactions: readonly Transaction[];
    to: IsoDate;
    log: IssueLog;
    /** Shared with the price fetch, so the providers' rate limits hold across both. */
    lastCall: Map<string, number>;
  },
  opts: ResolveStepOptions,
): Promise<ResolveCounts> {
  const counts: ResolveCounts = {
    resolve_candidates: 0,
    resolve_attempted: 0,
    resolved: 0,
    unresolved: 0,
  };
  const limit = opts.limit ?? RESOLVE_PER_RUN;
  const timeoutMs = opts.timeoutMs ?? RESOLVE_TIMEOUT_MS;
  const budgetMs = opts.budgetMs ?? RESOLVE_BUDGET_MS;
  const resolver: SymbolResolver =
    opts.resolver ??
    (async (asset) => {
      const [r] = await resolveSymbols([asset], {
        http: ctx.http,
        providers: ctx.providers,
        openFigiKey: opts.openFigiKey,
      });
      return r as SymbolResolution;
    });

  let candidates: AssetRecord[];
  try {
    const { picked, waiting } = resolutionCandidates(
      input.assets,
      input.transactions,
      input.to,
      limit,
    );
    candidates = picked;
    counts.resolve_candidates = picked.length + waiting;
  } catch (e) {
    input.log.add({ ...errorIssue(e), code: 'resolve_failed' });
    return counts;
  }

  const started = ctx.now().getTime();
  for (const asset of candidates) {
    if (ctx.now().getTime() - started >= budgetMs) {
      input.log.add({ code: 'resolve_deferred', assetId: asset.id });
      continue;
    }
    counts.resolve_attempted++;
    try {
      const listing = candidateFor(asset);
      const provider = listing.kind === 'listing' ? ctx.providers.get(listing.source) : undefined;
      if (provider) {
        const wait =
          (input.lastCall.get(provider.id) ?? -Infinity) +
          provider.minIntervalMs -
          ctx.now().getTime();
        if (wait > 0) await ctx.http.sleep(wait);
      }
      const result = await withTimeout(resolver(asset), timeoutMs);
      if (provider) input.lastCall.set(provider.id, ctx.now().getTime());
      if (result.status !== 'resolved' || !result.source || !result.symbol) {
        counts.unresolved++;
        input.log.add({ code: 'unresolved', assetId: asset.id, reason: result.reason });
        continue;
      }
      await ctx.db.setPriceSymbol(asset.id, result.source, result.symbol);
      asset.priceSource = result.source;
      asset.priceSourceId = result.symbol;
      counts.resolved++;
      input.log.add({ code: 'symbol_resolved', assetId: asset.id, provider: result.source });
    } catch (e) {
      counts.unresolved++;
      input.log.add(
        e instanceof ResolveTimeoutError
          ? { code: 'resolve_timeout', assetId: asset.id }
          : errorIssue(e, { assetId: asset.id }),
      );
    }
  }
  return counts;
}
