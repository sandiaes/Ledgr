// "Value now": the portfolio valued with the latest intraday quotes, for the dashboard.
// Quotes are cached in live_quotes and refreshed only when stale and the market is open
// (or just closed), so frequent app opens stay within the providers' free limits. The
// valuation itself is packages/core's buildSnapshot, so the rules match the daily
// snapshots; nothing here is written to portfolio_snapshots.
import {
  addDays,
  buildSnapshot,
  createCaFactorLookup,
  createFxLookup,
  createPriceLookup,
  createTradePriceLookup,
  dec,
  holdingPeriods,
  localDate,
  splitAdjustPrices,
  withLiveQuotes,
  type IsoDate,
  type PriceRow,
} from '@ledgr/core';
import { numericText, type AssetRecord, type Issue, type JobsDb, type LiveQuoteRecord } from './db';
import { errorIssue } from './jobs/common';
import { NOT_FETCHED, type ProviderRegistry } from './providers';

/** Regular trading hours by MIC, in the exchange's time zone (minutes after midnight). */
const SESSIONS: Readonly<Record<string, { timeZone: string; open: number; close: number }>> = {
  XNAS: { timeZone: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 },
  XNYS: { timeZone: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 },
  XASE: { timeZone: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 },
  XETR: { timeZone: 'Europe/Berlin', open: 9 * 60, close: 17 * 60 + 30 },
};
/** Quotes keep refreshing this long after the close, to pick up the final price. */
const AFTER_CLOSE_MINUTES = 30;
const LOOKBACK_DAYS = 31;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function localClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}` as IsoDate,
    weekday: WEEKDAYS.indexOf(get('weekday')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/**
 * Whether a cached quote should be fetched again. Never within the provider's interval.
 * Crypto (no exchange) refreshes whenever the interval has passed. A listing refreshes
 * during its session (weekdays; holidays count as open) and up to 30 minutes after; while
 * closed, only if the cache was fetched before the last session ended, to get its close.
 */
export function needsRefresh(o: {
  mic: string | null;
  fetchedAt: string | null;
  now: Date;
  ttlMs: number;
}): boolean {
  if (!o.fetchedAt) return true;
  const fetched = new Date(o.fetchedAt);
  if (o.now.getTime() - fetched.getTime() < o.ttlMs) return false;
  const session = o.mic ? SESSIONS[o.mic] : undefined;
  if (!session) return true;
  const n = localClock(o.now, session.timeZone);
  const f = localClock(fetched, session.timeZone);
  const tradingDay = n.weekday >= 1 && n.weekday <= 5;
  const end = session.close + AFTER_CLOSE_MINUTES;
  if (tradingDay && n.minutes >= session.open && n.minutes <= end) return true;
  // Closed: refresh once if the cache predates the end of the last session.
  const lastSession = tradingDay && n.minutes > end ? n.date : previousWeekday(n.date);
  return f.date < lastSession || (f.date === lastSession && f.minutes <= end);
}

function previousWeekday(date: IsoDate): IsoDate {
  let d = addDays(date, -1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1);
  return d;
}

export interface ValueNowContext {
  db: JobsDb;
  providers: ProviderRegistry;
  now: () => Date;
  /** The owner's time zone: decides "today" for the ledger. */
  timeZone: string;
  staleAfterDays: number;
  caMaxAgeDays: number;
}

/** How one holding was valued now. Dates and times only. */
export interface ValueNowAsset {
  assetId: string;
  /** live = intraday quote; close = a daily close; others as in daily snapshots. */
  source: 'live' | 'close' | 'trade' | 'factor' | 'subscription' | 'mixed';
  asOf: IsoDate;
  /** The provider's quote time, for live quotes. */
  quotedAt: string | null;
  ageDays: number;
  stale: boolean;
}

export interface ValueNow {
  computedAt: string;
  valuationDate: IsoDate;
  totalValueEur: string;
  stockValueEur: string;
  etfValueEur: string;
  cryptoValueEur: string;
  certificadoAforroValueEur: string;
  costBasisEur: string;
  netInvestedEur: string;
  stale: boolean;
  caValueSource: 'factor' | 'subscription' | 'mixed' | null;
  caValueAsOf: IsoDate | null;
  caValueAgeDays: number | null;
  caValueStale: boolean;
  assets: ValueNowAsset[];
  /** ECB reference date used per listing currency (the last published rate). */
  fxDates: Record<string, IsoDate | null>;
  /** Quotes fetched from providers on this call (0 = all from the cache). */
  refreshed: number;
  issues: Issue[];
}

export async function runValueNow(ctx: ValueNowContext): Promise<ValueNow> {
  const now = ctx.now();
  const today = localDate(now, ctx.timeZone);
  const loadFrom = addDays(today, -LOOKBACK_DAYS);
  const [assets, transactions, ca, cachedRows, priceRows, fxRows] = await Promise.all([
    ctx.db.loadAssets(),
    ctx.db.loadTransactions(),
    ctx.db.loadCa(),
    ctx.db.loadLiveQuotes(),
    ctx.db.loadPrices({ from: loadFrom }),
    ctx.db.loadFx({ from: loadFrom }),
  ]);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const held = new Set(
    holdingPeriods(transactions, today)
      .filter((p) => p.to === null && byId.get(p.assetId)?.assetType !== 'certificado_aforro')
      .map((p) => p.assetId),
  );

  // A held asset with no close in the window still gets its last older close.
  const covered = new Set(priceRows.map((r) => r.assetId));
  for (const assetId of held) {
    if (covered.has(assetId)) continue;
    const older = await ctx.db.latestPriceBefore(assetId, loadFrom);
    if (older) priceRows.push(older);
  }

  // Refresh what is due, one batch per provider.
  const cached = new Map(cachedRows.map((q) => [q.assetId, q]));
  const issues: Issue[] = [];
  const due = new Map<string, AssetRecord[]>();
  for (const assetId of held) {
    const a = byId.get(assetId) as AssetRecord;
    const provider = NOT_FETCHED.has(a.priceSource) ? undefined : ctx.providers.get(a.priceSource);
    if (!provider || !a.priceSourceId) continue;
    const mic = a.assetType === 'crypto' ? null : a.exchange;
    const fetchedAt = cached.get(a.id)?.fetchedAt ?? null;
    if (!needsRefresh({ mic, fetchedAt, now, ttlMs: provider.liveTtlMs })) continue;
    due.set(provider.id, [...(due.get(provider.id) ?? []), a]);
  }
  const fresh: LiveQuoteRecord[] = [];
  for (const [providerId, list] of due) {
    const provider = ctx.providers.get(providerId);
    if (!provider) continue;
    try {
      const quotes = await provider.fetchLatest(list.map((a) => a.priceSourceId as string));
      const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
      for (const a of list) {
        const q = bySymbol.get(a.priceSourceId as string);
        if (!q) {
          issues.push({ code: 'no_live_quote', assetId: a.id, provider: providerId });
          continue;
        }
        if ((q.currency ?? a.tradingCurrency) !== a.tradingCurrency || !dec(q.price).gt(0)) {
          issues.push({ code: 'currency_mismatch', assetId: a.id, provider: providerId });
          continue;
        }
        fresh.push({
          assetId: a.id,
          price: q.price,
          currency: a.tradingCurrency,
          tradingDay: q.tradingDay,
          quotedAt: q.quotedAt,
          fetchedAt: now.toISOString(),
          source: providerId,
        });
      }
    } catch (e) {
      for (const a of list) issues.push(errorIssue(e, { assetId: a.id }));
    }
  }
  if (fresh.length > 0) {
    await ctx.db.upsertLiveQuotes(fresh);
    for (const q of fresh) cached.set(q.assetId, q);
  }

  // Value: quotes added to split-adjusted closes, then the same rules as the snapshots.
  const liveRows: PriceRow[] = [...cached.values()]
    .filter((q) => held.has(q.assetId) && byId.get(q.assetId)?.tradingCurrency === q.currency)
    .map((q) => ({
      assetId: q.assetId,
      date: q.tradingDay,
      close: dec(q.price),
      currency: q.currency,
    }));
  const closes = splitAdjustPrices(priceRows);
  const snapshot = buildSnapshot({
    date: today,
    transactions,
    assets: assets.map((a) => ({
      id: a.id,
      assetType: a.assetType,
      tradingCurrency: a.tradingCurrency,
    })),
    prices: createPriceLookup(withLiveQuotes(closes, liveRows, today)),
    fx: createFxLookup(fxRows),
    ca: { subscriptions: ca.subscriptions, factors: createCaFactorLookup(ca.factors) },
    fallbackPrices: createTradePriceLookup(transactions),
    staleAfterDays: ctx.staleAfterDays,
    caMaxAgeDays: ctx.caMaxAgeDays,
    trackCash: false,
  });

  // A quote was used when it is the price's date and no close exists for that day.
  const closeKeys = new Set(closes.map((r) => `${r.assetId}|${r.date}`));
  const liveDay = new Map(
    liveRows
      .filter((r) => !closeKeys.has(`${r.assetId}|${r.date}`))
      .map((r) => [r.assetId, r.date]),
  );
  const currencies = [...new Set([...held].map((id) => byId.get(id)?.tradingCurrency as string))]
    .filter((c) => c !== 'EUR')
    .sort();
  const fxDates = Object.fromEntries(
    currencies.map((c) => [
      c,
      fxRows
        .filter((r) => r.currency === c && r.date <= today)
        .reduce<IsoDate | null>((m, r) => (m === null || r.date > m ? r.date : m), null),
    ]),
  );

  return {
    computedAt: now.toISOString(),
    valuationDate: today,
    totalValueEur: numericText(snapshot.totalValueEur),
    stockValueEur: numericText(snapshot.stockValueEur),
    etfValueEur: numericText(snapshot.etfValueEur),
    cryptoValueEur: numericText(snapshot.cryptoValueEur),
    certificadoAforroValueEur: numericText(snapshot.certificadoAforroValueEur),
    costBasisEur: numericText(snapshot.totalCostBasisEur),
    netInvestedEur: numericText(snapshot.netContributionsEur),
    stale: snapshot.stale,
    caValueSource: snapshot.caValueSource,
    caValueAsOf: snapshot.caValueAsOf,
    caValueAgeDays: snapshot.caValueAgeDays,
    caValueStale: snapshot.caValueStale,
    assets: snapshot.valuationFlags.map((f) => {
      const live = f.source === 'price' && liveDay.get(f.assetId) === f.asOf;
      return {
        assetId: f.assetId,
        source: live ? 'live' : f.source === 'price' ? 'close' : f.source,
        asOf: f.asOf,
        quotedAt: live ? (cached.get(f.assetId)?.quotedAt ?? null) : null,
        ageDays: f.ageDays,
        stale: f.stale,
      };
    }),
    fxDates,
    refreshed: fresh.length,
    issues,
  };
}
