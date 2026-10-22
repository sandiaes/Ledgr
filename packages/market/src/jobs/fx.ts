// FX: ECB reference rates into fx_rates for every listing currency other than EUR.
// Backfill starts at 2021-01-01 (or the first trade if earlier) minus 14 days, so a rate
// exists on the first day; daily runs re-read the last 7 days. Upserts are idempotent.
import {
  addDays,
  dec,
  minDate,
  PRICE_LOOKBACK_DAYS,
  rateToEurFromEcbQuote,
  type IsoDate,
} from '@ledgr/core';
import { numericText } from '../db';
import { fetchEcbRates } from '../ecb';
import { errorIssue, IssueLog, type JobContext, type JobOutcome } from './common';

export const FX_START: IsoDate = '2021-01-01';
const FX_REFRESH_DAYS = 7;

export async function runFx(
  ctx: JobContext,
  opts: { from?: IsoDate; to?: IsoDate } = {},
): Promise<JobOutcome> {
  const assets = await ctx.db.loadAssets();
  const currencies = [
    ...new Set(assets.map((a) => a.tradingCurrency).filter((c) => c !== 'EUR')),
  ].sort();
  const to = opts.to ?? ctx.today;
  const log = new IssueLog();
  const counts = { currencies: currencies.length, rows: 0, failed: 0 };

  let start: IsoDate | null = null;
  const defaultStart = async () => {
    if (start) return start;
    const txs = await ctx.db.loadTransactions();
    const firstTrade = txs.reduce<IsoDate | null>(
      (m, t) => (m === null || t.tradeDate < m ? t.tradeDate : m),
      null,
    );
    start = addDays(firstTrade ? minDate(FX_START, firstTrade) : FX_START, -PRICE_LOOKBACK_DAYS);
    return start;
  };

  for (const currency of currencies) {
    try {
      const last = opts.from ? null : await ctx.db.lastFxDate(currency);
      const from = opts.from ?? (last ? addDays(last, -FX_REFRESH_DAYS) : await defaultStart());
      if (from > to) continue;
      const quotes = await fetchEcbRates(ctx.http, currency, from, to);
      await ctx.db.upsertFx(
        quotes.map((q) => ({
          currency,
          date: q.date,
          rateToEur: numericText(rateToEurFromEcbQuote(dec(q.unitsPerEur))),
          source: 'ecb',
        })),
      );
      counts.rows += quotes.length;
    } catch (e) {
      counts.failed++;
      log.add(errorIssue(e));
    }
  }
  return {
    status: counts.failed === 0 ? 'ok' : counts.failed === currencies.length ? 'failed' : 'partial',
    counts: { ...counts, issues_dropped: log.dropped },
    issues: log.issues,
  };
}
