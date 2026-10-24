import { accountSummaries, type AccountSummary } from './accounts';
import {
  allocation,
  concentration,
  type AllocationDimension,
  type AllocationSlice,
  type Concentration,
} from './allocation';
import type {
  CaContext,
  CaFactor,
  CaSubscription,
  CertificadoSubscriptionView,
} from './certificados';
import { closedPositions, type ClosedPosition } from './closed';
import { compareDates, type IsoDate } from './dates';
import { dayChange, type DayChange } from './daychange';
import { ZERO, type Decimal } from './decimal';
import { MissingValuationError } from './errors';
import { gainsSummary, type GainsSummary } from './gains';
import { computeHoldings, type Holding, type HoldingAccount } from './holdings';
import {
  createCaFactorLookup,
  createFxLookup,
  createPriceLookup,
  type FxRow,
  type PriceRow,
} from './lookups';
import { topMovers, type TopMovers } from './movers';
import { positionDetail, type PositionDetail } from './positions';
import { projectionDefaults, type ProjectionDefaults } from './projection';
import {
  createTradePriceLookup,
  splitAdjustPrices,
  withLiveQuotes,
  type StoredPriceRow,
} from './prices';
import {
  bestWorstMonth,
  monthlyReturns,
  periodReturns,
  valueSeries,
  yearlyReturns,
  type CalendarReturn,
  type PeriodReturn,
  type SeriesRange,
  type ValueSeries,
  type ValueSnapshot,
} from './returns';
import { reconcile, type ReconcileResult } from './sanity';
import { assetScope, scopeTransactions, type AssetScope } from './scope';
import { CHART_MAX_POINTS, thinSeries } from './series';
import { buildSnapshot, type PortfolioSnapshot, type ValuationFlag } from './snapshot';
import type { Asset, AssetType, PriceLookup, Transaction } from './types';

export const SERIES_RANGES: readonly SeriesRange[] = ['1M', '3M', 'YTD', '1Y', 'All'];

/** The fetched rows every screen's view is built from (docs/app-plan.md §5). */
export interface PortfolioInput {
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
  /**
   * Asset types left out of every figure (docs/kpis.md §0.2), e.g. `['certificado_aforro']`
   * when the app's "Include certificados" setting is off; default none.
   */
  excludeTypes?: readonly AssetType[];
  staleAfterDays?: number;
  caMaxAgeDays?: number;
}

export type DashboardInput = PortfolioInput;

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

/** What every view says about its scope (docs/kpis.md §0.2). */
export interface ScopedView {
  /** The asset types left out of every figure; empty when the view covers everything. */
  excludeTypes: readonly AssetType[];
  /** The ledger has rows, but none in scope (e.g. only certificados, and they are out). */
  emptyInScope: boolean;
}

export interface DashboardView extends ScopedView {
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
export interface PortfolioUnvalued {
  status: 'unvalued';
  today: IsoDate;
  /** The day without a value (today or yesterday). */
  date: IsoDate;
  assetIds: string[];
  /** The currencies of those assets' prices, for the message. */
  currencies: string[];
}

export type DashboardUnvalued = PortfolioUnvalued;
export type Dashboard = DashboardView | PortfolioUnvalued;

/** The portfolio valued at T: what every view starts from. */
interface Valued extends ScopedView {
  status: 'ok';
  scope: AssetScope;
  holdings: Holding[];
  snapshot: PortfolioSnapshot;
  prices: PriceLookup;
  ca: CaContext;
  gains: GainsSummary;
  /** Turns a MissingValuationError into the "unvalued" view. */
  unvalued(date: IsoDate, assetIds: readonly string[]): PortfolioUnvalued;
}

/**
 * Closes split-adjusted with today's quotes added (`withLiveQuotes`); an asset with no
 * price at all is valued at its last trade price and flagged "price pending", as in the
 * snapshots (#25). A holding without a value (no FX rate) gives the "unvalued" view.
 */
function valuePortfolio(input: PortfolioInput): Valued | PortfolioUnvalued {
  const { today, transactions, assets } = input;
  const scope = assetScope({ assets, excludeTypes: input.excludeTypes });
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
  const unvalued = (date: IsoDate, assetIds: readonly string[]): PortfolioUnvalued => ({
    status: 'unvalued',
    today,
    date,
    assetIds: [...assetIds],
    currencies: [
      ...new Set(assetIds.map((id) => prices(id, date)?.currency ?? currencyOf.get(id) ?? '?')),
    ].sort(),
  });

  const holdings = computeHoldings({ transactions, assets, asOf: today, prices, fx, ca, scope });
  const missing = holdings.filter((h) => !h.marketValueEur).map((h) => h.assetId);
  if (missing.length > 0) return unvalued(today, missing);

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
    scope,
  });
  const gains = gainsSummary({
    transactions,
    holdings,
    asOf: today,
    caSubscriptions: input.ca.subscriptions,
    scope,
  });
  return {
    status: 'ok',
    scope,
    excludeTypes: scope.excludeTypes,
    emptyInScope: transactions.length > 0 && scopeTransactions(transactions, scope).length === 0,
    holdings,
    snapshot,
    prices,
    ca,
    gains,
    unvalued,
  };
}

/** D(T) with the same price source as V(T); a day without a value gives "unvalued". */
function dayChangeOf(input: PortfolioInput, v: Valued): DayChange | PortfolioUnvalued {
  const { transactions, assets, today } = input;
  const fx = createFxLookup(input.fx);
  try {
    return dayChange({
      transactions,
      assets,
      prices: v.prices,
      fx,
      ca: v.ca,
      today,
      scope: v.scope,
    });
  } catch (e) {
    if (e instanceof MissingValuationError) return v.unvalued(e.date ?? today, e.assetIds);
    throw e;
  }
}

/** The newest price date among the holdings valued by a price. */
function newestPriceDate(snapshot: PortfolioSnapshot): IsoDate | null {
  const priced = snapshot.valuationFlags.filter((f) => f.source === 'price');
  return priced.map((f) => f.asOf).sort(compareDates)[priced.length - 1] ?? null;
}

/**
 * Everything the Dashboard shows, from the fetched rows (docs/app-plan.md §1, §5): the app
 * formats the result and does no arithmetic.
 */
export function buildDashboard(input: PortfolioInput): Dashboard {
  const { today, transactions } = input;
  const v = valuePortfolio(input);
  if (v.status === 'unvalued') return v;
  const day = dayChangeOf(input, v);
  if ('status' in day) return day;
  const { holdings, snapshot, gains, scope } = v;

  const totalValueEur = snapshot.totalValueEur;
  const netInvestedEur = snapshot.netContributionsEur;
  const costBasisEur = snapshot.totalCostBasisEur;
  const now: ValueSnapshot = { date: today, valueEur: totalValueEur, netInvestedEur };

  const series = Object.fromEntries(
    SERIES_RANGES.map((range) => {
      const s = valueSeries(input.snapshots, now, range, { scope, transactions });
      return [range, { ...s, chart: thinSeries(s.points, CHART_MAX_POINTS) }];
    }),
  ) as Record<SeriesRange, DashboardChartSeries>;

  const flags = snapshot.valuationFlags;
  const priced = flags.filter((f) => f.source === 'price');
  return {
    status: 'ok',
    today,
    empty: transactions.length === 0,
    excludeTypes: v.excludeTypes,
    emptyInScope: v.emptyInScope,
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
      scope,
    }),
    series,
    allocation: allocation(holdings, 'assetType', scope),
    movers: {
      eur: topMovers({ day, holdings, by: 'eur', scope }),
      pct: topMovers({ day, holdings, by: 'pct', scope }),
    },
    freshness: {
      newestPriceDate: newestPriceDate(snapshot),
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
    reconcile: reconcile({ holdings, gains, netInvestedEur, reference: input.reference, scope }),
  };
}

/** One row of the Positions list: a whole position, or one broker's units of it. */
export interface PositionRow {
  assetId: string;
  assetType: AssetType;
  /** Listing currency. */
  currency: string;
  /** Accounts holding units (just the broker's own in a broker's rows), by id. */
  accountIds: string[];
  units: Decimal;
  valueEur: Decimal;
  /** valueEur / V(T); null when V(T) is 0. */
  weight: Decimal | null;
  costBasisEur: Decimal;
  unrealizedEur: Decimal;
  /** unrealized / cost basis; null when the cost basis is 0. */
  unrealizedPct: Decimal | null;
  /** D_a (docs/kpis.md §2); null in a broker's rows (day change is per asset). */
  dayChangeEur: Decimal | null;
  /** D_a / V_a(Y); null when undefined or in a broker's rows. */
  dayChangePct: Decimal | null;
  openedToday: boolean;
  /** How the asset is valued: `stale`, and source 'trade' for "price pending". */
  valuation: ValuationFlag;
  /** Certificados only (else null): the held subscriptions' factor. */
  certificado: CertificadoFactor | null;
}

export interface CertificadoFactor {
  /** EUR per unit when every held subscription has the same; else null (see the detail). */
  unitValueEur: Decimal | null;
  /** The oldest factor month among them; null when one has no factor yet. */
  factorMonth: IsoDate | null;
  subscriptions: number;
}

/** R, U, I, C, value, cost and G = R + U + I - C, for the portfolio or summed over brokers. */
export interface PortfolioTotals {
  valueEur: Decimal;
  costBasisEur: Decimal;
  unrealizedEur: Decimal;
  realizedEur: Decimal;
  incomeNetEur: Decimal;
  otherCostsEur: Decimal;
  /** G = realized + unrealized + income - other costs (decision D1). */
  totalGainEur: Decimal;
}

/** A broker (account) with its own units of each position (the Broker detail rows). */
export interface BrokerView extends AccountSummary {
  /** Largest value first. */
  positions: PositionRow[];
}

export interface PositionsView extends ScopedView {
  status: 'ok';
  today: IsoDate;
  empty: boolean;
  newestPriceDate: IsoDate | null;
  totals: PortfolioTotals;
  /** Open positions, largest value first (ties by asset id). */
  positions: PositionRow[];
  /** Position detail of every open position, by asset id. */
  details: Record<string, PositionDetail>;
  /** Value and weight per asset type, largest first. */
  types: AllocationSlice[];
  /** Largest value first. */
  brokers: BrokerView[];
  /** The brokers' figures summed field by field. */
  brokerTotals: PortfolioTotals;
  /** brokerTotals equals totals exactly (FIFO per account, docs/kpis.md §1). */
  brokersReconcile: boolean;
  /** Fully closed positions, the latest sale first (docs/kpis.md §8). */
  closed: ClosedPosition[];
}

export type Positions = PositionsView | PortfolioUnvalued;

const TOTAL_FIELDS = [
  'valueEur',
  'costBasisEur',
  'unrealizedEur',
  'realizedEur',
  'incomeNetEur',
  'otherCostsEur',
  'totalGainEur',
] as const satisfies readonly (keyof PortfolioTotals)[];

/**
 * The Positions tab, its Position and Broker details and Closed positions (docs/app-plan.md
 * §1, docs/kpis.md §8). Lots are FIFO per account, so every broker figure is a sum of
 * parts belonging to one account and the brokers add up exactly to the portfolio.
 */
export function buildPositions(input: PortfolioInput): Positions {
  const { today, transactions } = input;
  const v = valuePortfolio(input);
  if (v.status === 'unvalued') return v;
  const day = dayChangeOf(input, v);
  if ('status' in day) return day;
  const { holdings, snapshot, gains, ca, scope } = v;
  const total = snapshot.totalValueEur;
  const flags = new Map(snapshot.valuationFlags.map((f) => [f.assetId, f]));
  const days = new Map(day.assets.map((a) => [a.assetId, a]));

  const details: Record<string, PositionDetail> = {};
  for (const h of holdings) {
    details[h.assetId] = positionDetail({
      transactions,
      holding: h,
      asOf: today,
      portfolioValueEur: total,
      day: days.get(h.assetId),
      ca,
      caMaxAgeDays: input.caMaxAgeDays,
    });
  }

  const rowOf = (h: Holding, part?: HoldingAccount): PositionRow => {
    const detail = details[h.assetId] as PositionDetail;
    const valueEur = (part ? part.marketValueEur : h.marketValueEur) as Decimal;
    const costBasisEur = part ? part.costBasisEur : h.costBasisEur;
    const unrealizedEur = (part ? part.unrealizedGainEur : h.unrealizedGainEur) as Decimal;
    const subs = detail.certificados.filter((s) => !part || s.accountId === part.accountId);
    return {
      assetId: h.assetId,
      assetType: h.assetType,
      currency: h.currency,
      accountIds: part ? [part.accountId] : h.accounts.map((a) => a.accountId),
      units: part ? part.quantity : h.quantity,
      valueEur,
      weight: total.isZero() ? null : valueEur.div(total),
      costBasisEur,
      unrealizedEur,
      unrealizedPct: costBasisEur.isZero() ? null : unrealizedEur.div(costBasisEur),
      dayChangeEur: part ? null : (detail.dayChange?.changeEur ?? null),
      dayChangePct: part ? null : (detail.dayChange?.changePct ?? null),
      openedToday: !part && (detail.dayChange?.openedToday ?? false),
      valuation: flags.get(h.assetId) as ValuationFlag,
      certificado: h.assetType === 'certificado_aforro' ? certificadoFactor(subs) : null,
    };
  };
  const byValue = (a: PositionRow, b: PositionRow) =>
    b.valueEur.comparedTo(a.valueEur) || a.assetId.localeCompare(b.assetId);

  const brokers: BrokerView[] = accountSummaries({
    transactions,
    holdings,
    asOf: today,
    caSubscriptions: ca.subscriptions,
    scope,
  }).map((s) => ({
    ...s,
    positions: holdings
      .flatMap((h) => h.accounts.filter((a) => a.accountId === s.accountId).map((a) => rowOf(h, a)))
      .sort(byValue),
  }));

  const totals: PortfolioTotals = {
    valueEur: total,
    costBasisEur: snapshot.totalCostBasisEur,
    unrealizedEur: gains.unrealizedEur,
    realizedEur: gains.realizedEur,
    incomeNetEur: gains.incomeNetEur,
    otherCostsEur: gains.otherCostsEur,
    totalGainEur: gains.totalReturnEur,
  };
  const brokerTotals = Object.fromEntries(
    TOTAL_FIELDS.map((f) => [f, brokers.reduce((s, b) => s.plus(b[f]), ZERO)]),
  ) as unknown as PortfolioTotals;

  return {
    status: 'ok',
    today,
    empty: transactions.length === 0,
    excludeTypes: v.excludeTypes,
    emptyInScope: v.emptyInScope,
    newestPriceDate: newestPriceDate(snapshot),
    totals,
    positions: holdings.map((h) => rowOf(h)).sort(byValue),
    details,
    types: allocation(holdings, 'assetType', scope),
    brokers,
    brokerTotals,
    brokersReconcile: TOTAL_FIELDS.every((f) => brokerTotals[f].eq(totals[f])),
    closed: closedPositions(transactions, {
      asOf: today,
      caSubscriptions: ca.subscriptions,
      scope,
    }).sort(
      (a, b) =>
        (a.lastSale > b.lastSale ? -1 : a.lastSale < b.lastSale ? 1 : 0) ||
        a.assetId.localeCompare(b.assetId),
    ),
  };
}

function certificadoFactor(subs: readonly CertificadoSubscriptionView[]): CertificadoFactor {
  const first = subs[0];
  const months = subs.map((s) => s.factorMonth);
  return {
    unitValueEur:
      first && subs.every((s) => s.unitValueEur.eq(first.unitValueEur)) ? first.unitValueEur : null,
    factorMonth:
      months.length === 0 || months.includes(null)
        ? null
        : ((months as IsoDate[]).sort(compareDates)[0] as IsoDate),
    subscriptions: subs.length,
  };
}

export const ALLOCATION_DIMENSIONS: readonly AllocationDimension[] = [
  'assetType',
  'account',
  'currency',
  'asset',
];

export interface AllocationView extends ScopedView {
  status: 'ok';
  today: IsoDate;
  newestPriceDate: IsoDate | null;
  totalValueEur: Decimal;
  /** Per dimension, largest group first (docs/kpis.md §6). */
  slices: Record<AllocationDimension, AllocationSlice[]>;
  /** The 5 / 10 largest assets and their combined weight. */
  top5: Concentration;
  top10: Concentration;
}

export type Allocation = AllocationView | PortfolioUnvalued;

/** The Allocation screen: by type, broker, listing currency and asset, top 5 / 10. */
export function buildAllocation(input: PortfolioInput): Allocation {
  const v = valuePortfolio(input);
  if (v.status === 'unvalued') return v;
  const { holdings, snapshot, scope } = v;
  return {
    status: 'ok',
    today: input.today,
    excludeTypes: v.excludeTypes,
    emptyInScope: v.emptyInScope,
    newestPriceDate: newestPriceDate(snapshot),
    totalValueEur: snapshot.totalValueEur,
    slices: Object.fromEntries(
      ALLOCATION_DIMENSIONS.map((d) => [d, allocation(holdings, d, scope)]),
    ) as Record<AllocationDimension, AllocationSlice[]>,
    top5: concentration(holdings, 5, scope),
    top10: concentration(holdings, 10, scope),
  };
}

export interface PerformanceView extends ScopedView {
  status: 'ok';
  today: IsoDate;
  newestPriceDate: IsoDate | null;
  /** Newest first, the current month (MTD) on top (docs/kpis.md §5). */
  months: CalendarReturn[];
  /** Newest first, the current year (YTD) on top. */
  years: CalendarReturn[];
  /** Among completed months; null when none has a return. */
  best: CalendarReturn | null;
  worst: CalendarReturn | null;
}

export type Performance = PerformanceView | PortfolioUnvalued;

/** The Performance screen: monthly and yearly returns, contributions vs market gains. */
export function buildPerformance(input: PortfolioInput): Performance {
  const v = valuePortfolio(input);
  if (v.status === 'unvalued') return v;
  const returns = {
    transactions: input.transactions,
    snapshots: input.snapshots,
    today: input.today,
    valueTodayEur: v.snapshot.totalValueEur,
    scope: v.scope,
  };
  const months = monthlyReturns(returns);
  return {
    status: 'ok',
    today: input.today,
    excludeTypes: v.excludeTypes,
    emptyInScope: v.emptyInScope,
    newestPriceDate: newestPriceDate(v.snapshot),
    months,
    years: yearlyReturns(returns),
    ...bestWorstMonth(months),
  };
}

export interface ProjectionView extends ScopedView {
  status: 'ok';
  today: IsoDate;
  newestPriceDate: IsoDate | null;
  /** What the return calculator starts from (docs/kpis.md §11.4). */
  defaults: ProjectionDefaults;
}

export type ProjectionScreen = ProjectionView | PortfolioUnvalued;

/** The return calculator's defaults: V(T), Since start XIRR / TWR, average net purchases. */
export function buildProjection(input: PortfolioInput): ProjectionScreen {
  const v = valuePortfolio(input);
  if (v.status === 'unvalued') return v;
  const valueTodayEur = v.snapshot.totalValueEur;
  const returns = periodReturns({
    transactions: input.transactions,
    snapshots: input.snapshots,
    today: input.today,
    valueTodayEur,
    scope: v.scope,
  });
  return {
    status: 'ok',
    today: input.today,
    excludeTypes: v.excludeTypes,
    emptyInScope: v.emptyInScope,
    newestPriceDate: newestPriceDate(v.snapshot),
    defaults: projectionDefaults({
      transactions: input.transactions,
      today: input.today,
      valueTodayEur,
      returns,
      scope: v.scope,
    }),
  };
}
