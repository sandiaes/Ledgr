import {
  certificadoSubscriptions,
  type CaContext,
  type CertificadoSubscriptionView,
} from './certificados';
import type { IsoDate } from './dates';
import type { AssetDayChange } from './daychange';
import { ZERO, type Decimal } from './decimal';
import { MissingValuationError } from './errors';
import { runFifo } from './fifo';
import { rowIncomeNetEur, rowOtherCostEur } from './gains';
import type { Holding } from './holdings';
import { acquisitionCostEur, disposalProceedsEur, feesEur, prepareLedger } from './ledger';
import type { PriceRow } from './lookups';
import { splitAdjustPrices, withLiveQuotes, type StoredPriceRow } from './prices';
import { rangeStart, type SeriesRange } from './returns';
import { CHART_MAX_POINTS, thinSeries } from './series';
import type { Transaction, TransactionType } from './types';

/** One account's part of a position (docs/kpis.md §8 "Split by broker"). */
export interface PositionAccountLine {
  accountId: string;
  units: Decimal;
  costBasisEur: Decimal;
  valueEur: Decimal;
  unrealizedEur: Decimal;
  /** Disposals of the asset booked in this account. */
  realizedEur: Decimal;
}

/** One open lot (docs/kpis.md §8 "Open lots"). */
export interface OpenLotLine {
  lotId: string;
  accountId: string;
  acquiredOn: IsoDate;
  units: Decimal;
  costEur: Decimal;
  /** costEur / units. */
  unitCostEur: Decimal;
}

/** Everything the Position detail screen shows for one open position (docs/kpis.md §8). */
export interface PositionDetail {
  assetId: string;
  units: Decimal;
  /** costBasis / units. */
  averageCostEur: Decimal;
  costBasisEur: Decimal;
  valueEur: Decimal;
  /** valueEur / the portfolio's value; null when that is 0. */
  weight: Decimal | null;
  unrealizedEur: Decimal;
  /** unrealized / cost basis; null when the cost basis is 0. */
  unrealizedPct: Decimal | null;
  /** All disposals of the asset, all accounts, all time. */
  realizedEur: Decimal;
  /** Net dividends booked on the asset. */
  incomeEur: Decimal;
  /** D_a and D_a / V_a(Y) (docs/kpis.md §2); null when not computed. */
  dayChange: { changeEur: Decimal; changePct: Decimal | null; openedToday: boolean } | null;
  /** The price used (listing currency); null for certificados valued by factor. */
  price: { close: Decimal; currency: string; date: IsoDate } | null;
  /** Certificados: each held subscription with its units, latest factor and value. */
  certificados: CertificadoSubscriptionView[];
  /**
   * Per account, every account holding units or with a disposal of the asset; by account
   * id. Units, cost, value, unrealized and realized add up exactly to the position's.
   */
  accounts: PositionAccountLine[];
  /** Oldest first (ties by account, then lot id). */
  lots: OpenLotLine[];
}

/**
 * One open position in full (docs/kpis.md §8). `holding` must be valued; `portfolioValueEur`
 * is V(T), for the weight. Realized and income cover the asset's whole history up to
 * `asOf`. Throws MissingValuationError for an unvalued holding.
 */
export function positionDetail(input: {
  transactions: readonly Transaction[];
  holding: Holding;
  asOf: IsoDate;
  portfolioValueEur: Decimal;
  day?: AssetDayChange;
  ca?: CaContext;
  caMaxAgeDays?: number;
}): PositionDetail {
  const { holding: h, transactions, asOf, ca } = input;
  if (!h.marketValueEur || !h.unrealizedGainEur) {
    throw new MissingValuationError([h.assetId], asOf);
  }
  const { disposals } = runFifo(transactions, { asOf, caSubscriptions: ca?.subscriptions });
  const own = disposals.filter((d) => d.assetId === h.assetId);

  const lines = new Map<string, PositionAccountLine>();
  for (const a of h.accounts) {
    lines.set(a.accountId, {
      accountId: a.accountId,
      units: a.quantity,
      costBasisEur: a.costBasisEur,
      valueEur: a.marketValueEur as Decimal,
      unrealizedEur: a.unrealizedGainEur as Decimal,
      realizedEur: ZERO,
    });
  }
  for (const d of own) {
    const line = lines.get(d.accountId) ?? {
      accountId: d.accountId,
      units: ZERO,
      costBasisEur: ZERO,
      valueEur: ZERO,
      unrealizedEur: ZERO,
      realizedEur: ZERO,
    };
    line.realizedEur = line.realizedEur.plus(d.gainEur);
    lines.set(d.accountId, line);
  }

  const origins = new Set(h.lots.map((l) => l.originTransactionId));
  const certificados =
    h.assetType === 'certificado_aforro' && ca
      ? certificadoSubscriptions({
          transactions,
          asOf,
          ca,
          caMaxAgeDays: input.caMaxAgeDays,
        }).filter((s) => origins.has(s.transactionId))
      : [];

  const value = h.marketValueEur;
  return {
    assetId: h.assetId,
    units: h.quantity,
    averageCostEur: h.averageCostEur,
    costBasisEur: h.costBasisEur,
    valueEur: value,
    weight: input.portfolioValueEur.isZero() ? null : value.div(input.portfolioValueEur),
    unrealizedEur: h.unrealizedGainEur,
    unrealizedPct: h.costBasisEur.isZero() ? null : h.unrealizedGainEur.div(h.costBasisEur),
    realizedEur: own.reduce((s, d) => s.plus(d.gainEur), ZERO),
    incomeEur: prepareLedger(transactions, asOf)
      .filter((t) => t.assetId === h.assetId)
      .reduce((s, t) => s.plus(rowIncomeNetEur(t)), ZERO),
    dayChange: input.day
      ? {
          changeEur: input.day.changeEur,
          changePct: input.day.changePct,
          openedToday: input.day.openedToday,
        }
      : null,
    price:
      h.valuation.kind === 'price'
        ? {
            close: h.valuation.price.close,
            currency: h.valuation.price.currency,
            date: h.valuation.price.date,
          }
        : null,
    certificados,
    accounts: [...lines.values()].sort((a, b) => a.accountId.localeCompare(b.accountId)),
    lots: h.lots
      .map((l) => ({
        lotId: l.lotId,
        accountId: l.accountId,
        acquiredOn: l.acquiredOn,
        units: l.quantity,
        costEur: l.costEur,
        unitCostEur: l.costEur.div(l.quantity),
      }))
      .sort(
        (a, b) =>
          (a.acquiredOn < b.acquiredOn ? -1 : a.acquiredOn > b.acquiredOn ? 1 : 0) ||
          a.accountId.localeCompare(b.accountId) ||
          a.lotId.localeCompare(b.lotId),
      ),
  };
}

/** One ledger row, as the Transactions and Activity lists show it. */
export interface AssetTransactionRow {
  id: string;
  /** null for cash rows (interest, fees, deposits, withdrawals). */
  assetId: string | null;
  date: IsoDate;
  /** Imported month-level row (#22): only the month is known. */
  monthOnly: boolean;
  type: TransactionType;
  accountId: string;
  /** Transfers: the receiving account. */
  transferToAccountId: string | null;
  quantity: Decimal | null;
  /** In `currency`. */
  unitPrice: Decimal | null;
  currency: string;
  feesEur: Decimal;
  /**
   * EUR at the row's own rate: cost for a buy or subscription (fees in), proceeds for a
   * sell or redemption (fees out), the net amount of a dividend or interest, the cost of a
   * fee row or a transfer's fee.
   */
  totalEur: Decimal;
}

/** The asset's ledger rows up to `asOf`, newest first (the reverse of the FIFO order). */
export function assetTransactions(
  transactions: readonly Transaction[],
  assetId: string,
  asOf?: IsoDate,
): AssetTransactionRow[] {
  return transactionRows(transactions, asOf).filter((r) => r.assetId === assetId);
}

/** Every ledger row up to `asOf`, newest first (the Activity list). */
export function transactionRows(
  transactions: readonly Transaction[],
  asOf?: IsoDate,
): AssetTransactionRow[] {
  return prepareLedger(transactions, asOf)
    .reverse()
    .map((t) => ({
      id: t.id,
      assetId: t.assetId,
      date: t.tradeDate,
      monthOnly: t.tradeDatePrecision === 'month',
      type: t.type,
      accountId: t.accountId,
      transferToAccountId: t.transferToAccountId ?? null,
      quantity: t.quantity,
      unitPrice: t.unitPrice,
      currency: t.currency,
      feesEur: feesEur(t),
      totalEur: rowTotalEur(t),
    }));
}

function rowTotalEur(t: Transaction): Decimal {
  switch (t.type) {
    case 'buy':
    case 'subscription':
      return acquisitionCostEur(t);
    case 'sell':
    case 'redemption':
      return disposalProceedsEur(t);
    case 'dividend':
    case 'interest':
      return rowIncomeNetEur(t);
    default:
      return rowOtherCostEur(t);
  }
}

export interface PricePoint {
  date: IsoDate;
  /** Split-adjusted close (or today's quote), in the listing currency. */
  close: Decimal;
}

/** One asset's price chart for a range (docs/app-plan.md §1 "Position detail"). */
export interface PriceSeries {
  from: IsoDate;
  currency: string;
  /** The latest close on or before `from`, then every close after it; oldest first. */
  points: PricePoint[];
  /** `points` thinned to at most CHART_MAX_POINTS, for drawing only. */
  chart: PricePoint[];
  /** Last close - first close; null with fewer than two points. */
  change: Decimal | null;
  /** change / first close; null when undefined. */
  changePct: Decimal | null;
}

/**
 * The asset's split-adjusted closes in its listing currency (rows in another currency are
 * left out), with today's quote when there is no close for today yet (`withLiveQuotes`).
 * `prices` should be the asset's whole history, so every split is applied.
 */
export function priceSeries(input: {
  assetId: string;
  currency: string;
  prices: readonly StoredPriceRow[];
  liveQuotes?: readonly PriceRow[];
  today: IsoDate;
  range: SeriesRange;
}): PriceSeries {
  const { assetId, currency, today } = input;
  const mine = (r: PriceRow) => r.assetId === assetId && r.currency === currency;
  const all = withLiveQuotes(
    splitAdjustPrices(input.prices.filter((r) => r.assetId === assetId)).filter(mine),
    (input.liveQuotes ?? []).filter(mine),
    today,
  )
    .filter((r) => r.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((r) => ({ date: r.date, close: r.close }));

  const from = rangeStart(input.range, today, all[0]?.date ?? today);
  let start = all.findIndex((p) => p.date >= from);
  if (start === -1) start = all.length;
  if (start > 0 && (all[start]?.date ?? '') !== from) start -= 1;
  const points = all.slice(start);

  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last && points.length > 1 ? last.close.minus(first.close) : null;
  return {
    from,
    currency,
    points,
    chart: thinSeries(points, CHART_MAX_POINTS, (p) => p.close),
    change,
    changePct: change && first && !first.close.isZero() ? change.div(first.close) : null,
  };
}
