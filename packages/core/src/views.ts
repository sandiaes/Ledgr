import { allocation, type AllocationSlice } from './allocation';
import type { CaFactor, CaSubscription } from './certificados';
import { compareDates, type IsoDate } from './dates';
import { dayChange, type DayChange } from './daychange';
import type { Decimal } from './decimal';
import { MissingValuationError } from './errors';
import { gainsSummary, type GainsSummary } from './gains';
import { computeHoldings } from './holdings';
import {
  createCaFactorLookup,
  createFxLookup,
  createPriceLookup,
  type FxRow,
  type PriceRow,
} from './lookups';
import { topMovers, type TopMovers } from './movers';
import {
  createTradePriceLookup,
  splitAdjustPrices,
  withLiveQuotes,
  type StoredPriceRow,
} from './prices';
import {
  periodReturns,
  valueSeries,
  type PeriodReturn,
  type SeriesRange,
  type ValueSeries,
  type ValueSnapshot,
} from './returns';
import { reconcile, type ReconcileResult } from './sanity';
import { buildSnapshot, type ValuationFlag } from './snapshot';
import type { Asset, PriceLookup, Transaction } from './types';

export const SERIES_RANGES: readonly SeriesRange[] = ['1M', '3M', 'YTD', '1Y', 'All'];
/** Chart series longer than this are thinned for drawing (docs/app-plan.md §5). */
export const CHART_MAX_POINTS = 300;

export interface DashboardInput {
  /** T, the owner's local date (`localDate(now, 'Europe/Lisbon')`). */
  today: IsoDate;
  transactions: readonly Transaction[];
  assets: readonly Asset[];
  /** public.prices rows (raw closes and split factors) covering yesterday and today. */
  prices: readonly StoredPriceRow[];
  /** public.live_quotes as rows (price, trading day, currency). */
  liveQuotes: readonly PriceRow[];
  fx: readonly FxRow[];
  ca: { subscriptions: readonly CaSubscription[]; factors: readonly CaFactor[] };
  /** public.portfolio_snapshots before today. */
  snapshots: readonly ValueSnapshot[];
  /** value-now's totals when it answered, checked against the app's own (`reconcile`). */
  reference?: { totalValueEur: Decimal; costBasisEur: Decimal } | null;
  staleAfterDays?: number;
  caMaxAgeDays?: number;
}

export interface DashboardFreshness {
  /** The newest price date used (live quotes count as their trading day). */
  newestPriceDate: IsoDate | null;
  /** Held assets valued by a close older than the stale limit. */
  stalePrices: ValuationFlag[];
  /** Held assets with no price at all, valued at their last trade price ("price pending"). */
  pendingPrices: ValuationFlag[];
  /** The oldest certificado factor among held subscriptions; null when none is held. */
  caFactor: { asOf: IsoDate; ageDays: number; stale: boolean } | null;
}

export interface DashboardChartSeries extends ValueSeries {
  /** `points` thinned to at most CHART_MAX_POINTS, for drawing only. */
  chart: ValueSnapshot[];
}

export interface DashboardView {
  status: 'ok';
  today: IsoDate;
  /** No ledger rows yet. */
  empty: boolean;
  /** V(T). */
  totalValueEur: Decimal;
  costBasisEur: Decimal;
  /** NI(T), "Net invested". */
  netInvestedEur: Decimal;
  /** D and D / V(Y) (null when V(Y) = 0). */
  dayChange: { changeEur: Decimal; changePct: Decimal | null };
  /** R, U, I, C and G = R + U + I - C (decision D1). */
  gains: GainsSummary;
  /** U / cost basis; null when the cost basis is 0. */
  unrealizedPct: Decimal | null;
  /** Since start, YTD, 1Y. */
  returns: PeriodReturn[];
  series: Record<SeriesRange, DashboardChartSeries>;
  /** By asset type, largest first. */
  allocation: AllocationSlice[];
  /** Ranked by € (decision D4) and, for the €/% chip, by %. */
  movers: { eur: TopMovers; pct: TopMovers };
  freshness: DashboardFreshness;
  reconcile: ReconcileResult;
}

/** Some holding has no value (no FX rate for its currency): totals are shown as "—". */
export interface DashboardUnvalued {
  status: 'unvalued';
  today: IsoDate;
  /** The day without a value (today or yesterday). */
  date: IsoDate;
  assetIds: string[];
  /** The currencies of those assets' prices, for the message. */
  currencies: string[];
}

export type Dashboard = DashboardView | DashboardUnvalued;

/**
 * Everything the Dashboard shows, from the fetched rows (docs/app-plan.md §1, §5): the app
 * formats the result and does no arithmetic. Closes are split-adjusted and today's quotes
 * added (`withLiveQuotes`); an asset with no price at all is valued at its last trade price
 * and flagged "price pending", as in the snapshots (#25).
 */
export function buildDashboard(input: DashboardInput): Dashboard {
  const { today, transactions, assets } = input;
  const currencyOf = new Map(assets.map((a) => [a.id, a.tradingCurrency]));
  const quotes = input.liveQuotes.filter((q) => currencyOf.get(q.assetId) === q.currency);
  const closes = createPriceLookup(withLiveQuotes(splitAdjustPrices(input.prices), quotes, today));
  const trade = createTradePriceLookup(transactions);
  const prices: PriceLookup = (assetId, on) => closes(assetId, on) ?? trade(assetId, on);
  const fx = createFxLookup(input.fx);
  const ca = {
    subscriptions: input.ca.subscriptions,
    factors: createCaFactorLookup(input.ca.factors),
  };
  const unvalued = (date: IsoDate, assetIds: readonly string[]): DashboardUnvalued => ({
    status: 'unvalued',
    today,
    date,
    assetIds: [...assetIds],
    currencies: [
      ...new Set(assetIds.map((id) => prices(id, date)?.currency ?? currencyOf.get(id) ?? '?')),
    ].sort(),
  });

  const holdings = computeHoldings({ transactions, assets, asOf: today, prices, fx, ca });
  const missing = holdings.filter((h) => !h.marketValueEur).map((h) => h.assetId);
  if (missing.length > 0) return unvalued(today, missing);
  let day: DayChange;
  try {
    day = dayChange({ transactions, assets, prices, fx, ca, today });
  } catch (e) {
    if (e instanceof MissingValuationError) return unvalued(e.date ?? today, e.assetIds);
    throw e;
  }

  const snapshot = buildSnapshot({
    date: today,
    transactions,
    assets,
    prices: closes,
    fallbackPrices: trade,
    fx,
    ca,
    trackCash: false,
    staleAfterDays: input.staleAfterDays,
    caMaxAgeDays: input.caMaxAgeDays,
  });
  const gains = gainsSummary({
    transactions,
    holdings,
    asOf: today,
    caSubscriptions: input.ca.subscriptions,
  });
  const totalValueEur = snapshot.totalValueEur;
  const netInvestedEur = snapshot.netContributionsEur;
  const costBasisEur = snapshot.totalCostBasisEur;
  const now: ValueSnapshot = { date: today, valueEur: totalValueEur, netInvestedEur };

  const series = Object.fromEntries(
    SERIES_RANGES.map((range) => {
      const s = valueSeries(input.snapshots, now, range);
      return [range, { ...s, chart: thinSeries(s.points, CHART_MAX_POINTS) }];
    }),
  ) as Record<SeriesRange, DashboardChartSeries>;

  const flags = snapshot.valuationFlags;
  const priced = flags.filter((f) => f.source === 'price');
  return {
    status: 'ok',
    today,
    empty: transactions.length === 0,
    totalValueEur,
    costBasisEur,
    netInvestedEur,
    dayChange: { changeEur: day.changeEur, changePct: day.changePct },
    gains,
    unrealizedPct: costBasisEur.isZero() ? null : gains.unrealizedEur.div(costBasisEur),
    returns: periodReturns({
      transactions,
      snapshots: input.snapshots,
      today,
      valueTodayEur: totalValueEur,
    }),
    series,
    allocation: allocation(holdings, 'assetType'),
    movers: {
      eur: topMovers({ day, holdings, by: 'eur' }),
      pct: topMovers({ day, holdings, by: 'pct' }),
    },
    freshness: {
      newestPriceDate: priced.map((f) => f.asOf).sort(compareDates)[priced.length - 1] ?? null,
      stalePrices: priced.filter((f) => f.stale),
      pendingPrices: flags.filter((f) => f.source === 'trade'),
      caFactor:
        snapshot.caValueAsOf === null
          ? null
          : {
              asOf: snapshot.caValueAsOf,
              ageDays: snapshot.caValueAgeDays as number,
              stale: snapshot.caValueStale,
            },
    },
    reconcile: reconcile({ holdings, gains, netInvestedEur, reference: input.reference }),
  };
}

/**
 * At most `max` points for drawing a long series: the first and last points, and the
 * lowest and highest value of each bucket in between, in date order. The figures under a
 * chart always come from the full series.
 */
export function thinSeries<T extends { valueEur: Decimal }>(
  points: readonly T[],
  max: number,
): T[] {
  if (max < 4) throw new RangeError('max must be at least 4');
  if (points.length <= max) return [...points];
  const last = points.length - 1;
  const buckets = Math.floor((max - 2) / 2);
  const size = Math.ceil((points.length - 2) / buckets);
  const keep: number[] = [0];
  for (let start = 1; start < last; start += size) {
    const end = Math.min(start + size, last);
    let lo = start;
    let hi = start;
    for (let i = start + 1; i < end; i++) {
      const v = (points[i] as T).valueEur;
      if (v.lt((points[lo] as T).valueEur)) lo = i;
      if (v.gt((points[hi] as T).valueEur)) hi = i;
    }
    keep.push(...(lo === hi ? [lo] : lo < hi ? [lo, hi] : [hi, lo]));
  }
  keep.push(last);
  return keep.map((i) => points[i] as T);
}
