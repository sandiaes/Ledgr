import type { CaContext } from './certificados';
import { compareDates, type IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { MissingValuationError } from './errors';
import { netInvestedEur } from './gains';
import { computeHoldings, type Holding } from './holdings';
import { cashBalanceEur, hasDeposits } from './ledger';
import { ageInDays, DEFAULT_CA_MAX_AGE_DAYS, DEFAULT_STALE_AFTER_DAYS, isStale } from './prices';
import type { Asset, AssetType, FxLookup, PriceLookup, Transaction } from './types';

export interface SnapshotInput {
  date: IsoDate;
  transactions: readonly Transaction[];
  assets: readonly Asset[];
  prices: PriceLookup;
  fx: FxLookup;
  ca?: CaContext;
  /**
   * Include cash in the snapshot. Defaults to whether the ledger records any deposit;
   * without deposits the cash balance would just be minus the amount invested.
   */
  trackCash?: boolean;
  /**
   * Stands in when `prices` has nothing on or before the date (e.g. the asset's last trade
   * price, see createTradePriceLookup). A value from here is always flagged stale.
   * Without it, a missing price throws MissingValuationError.
   */
  fallbackPrices?: PriceLookup;
  /** A price more than this many days old is stale. Default DEFAULT_STALE_AFTER_DAYS (3). */
  staleAfterDays?: number;
  /** A certificado value more than this many days old is flagged. Default 35. */
  caMaxAgeDays?: number;
}

/**
 * How one asset was valued in a snapshot. Dates and ages only, never amounts.
 *   price         a close on or before the date
 *   trade         no close known: the last trade price stood in (always stale)
 *   factor        certificados: every subscription by its latest factor
 *   subscription  certificados: no factor yet, valued at the subscription price
 *   mixed         certificados: some subscriptions by factor, some by subscription price
 */
export interface ValuationFlag {
  assetId: string;
  source: 'price' | 'trade' | 'factor' | 'subscription' | 'mixed';
  /** Price date; for certificados the oldest factor month or subscription date. */
  asOf: IsoDate;
  ageDays: number;
  stale: boolean;
}

/** One public.portfolio_snapshots row (all EUR). */
export interface PortfolioSnapshot {
  snapshotDate: IsoDate;
  /** Positions at market value, plus cash when it is tracked. */
  totalValueEur: Decimal;
  totalCostBasisEur: Decimal;
  /** Net invested (netInvestedEur), stored in net_contributions_eur. */
  netContributionsEur: Decimal;
  /** Null when cash is not tracked. */
  cashEur: Decimal | null;
  stockValueEur: Decimal;
  etfValueEur: Decimal;
  cryptoValueEur: Decimal;
  certificadoAforroValueEur: Decimal;
  /** Any flag below is stale. */
  stale: boolean;
  /** Assets (certificados included) whose value is stale. */
  staleAssetCount: number;
  /** Certificados across all CA holdings; all null when none is held or valued by factor. */
  caValueSource: 'factor' | 'subscription' | 'mixed' | null;
  caValueAsOf: IsoDate | null;
  caValueAgeDays: number | null;
  caValueStale: boolean;
  /** One per holding, by asset id. */
  valuationFlags: ValuationFlag[];
}

/**
 * The day's totals from the ledger up to and including `date`, prices/fx on or before it.
 * Throws MissingValuationError when an asset has no price (and no fallback) or no fx rate,
 * rather than writing a snapshot with a hole in it.
 */
export function buildSnapshot(input: SnapshotInput): PortfolioSnapshot {
  const { date, transactions, fallbackPrices } = input;
  const staleAfter = input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
  const caMaxAge = input.caMaxAgeDays ?? DEFAULT_CA_MAX_AGE_DAYS;

  const fromFallback = new Set<string>();
  const prices: PriceLookup = (assetId, on) => {
    const price = input.prices(assetId, on);
    if (price || !fallbackPrices) return price;
    const standIn = fallbackPrices(assetId, on);
    if (standIn) fromFallback.add(assetId);
    return standIn;
  };
  const holdings = computeHoldings({ ...input, prices, asOf: date });
  const unvalued = holdings.filter((h) => !h.marketValueEur).map((h) => h.assetId);
  if (unvalued.length > 0) throw new MissingValuationError([...new Set(unvalued)], date);

  const byType: Record<AssetType, Decimal> = {
    stock: ZERO,
    etf: ZERO,
    crypto: ZERO,
    certificado_aforro: ZERO,
  };
  let costBasis = ZERO;
  for (const h of holdings) {
    byType[h.assetType] = byType[h.assetType].plus(h.marketValueEur as Decimal);
    costBasis = costBasis.plus(h.costBasisEur);
  }
  const trackCash = input.trackCash ?? hasDeposits(transactions);
  const cashEur = trackCash ? cashBalanceEur(transactions, date) : null;
  const positions = Object.values(byType).reduce((s, v) => s.plus(v), ZERO);

  const valuationFlags = holdings.map((h) => flagFor(h, date, fromFallback, staleAfter, caMaxAge));
  const caFlags = valuationFlags.filter(
    (f) => f.source === 'factor' || f.source === 'subscription' || f.source === 'mixed',
  );
  const ca = combineCaFlags(caFlags, date, caMaxAge);

  return {
    snapshotDate: date,
    totalValueEur: cashEur ? positions.plus(cashEur) : positions,
    totalCostBasisEur: costBasis,
    netContributionsEur: netInvestedEur(transactions, date),
    cashEur,
    stockValueEur: byType.stock,
    etfValueEur: byType.etf,
    cryptoValueEur: byType.crypto,
    certificadoAforroValueEur: byType.certificado_aforro,
    stale: valuationFlags.some((f) => f.stale),
    staleAssetCount: valuationFlags.filter((f) => f.stale).length,
    caValueSource: ca?.source ?? null,
    caValueAsOf: ca?.asOf ?? null,
    caValueAgeDays: ca?.ageDays ?? null,
    caValueStale: ca?.stale ?? false,
    valuationFlags,
  };
}

function flagFor(
  h: Holding,
  date: IsoDate,
  fromFallback: ReadonlySet<string>,
  staleAfter: number,
  caMaxAge: number,
): ValuationFlag {
  const v = h.valuation;
  if (v.kind === 'certificado') {
    // A lot's value dates from its factor month (also the accrual anchor), else from the
    // subscription itself.
    const lotDate = new Map(h.lots.map((l) => [l.lotId, l.acquiredOn]));
    const dates = v.lots.map((l) => l.factorMonth ?? (lotDate.get(l.lotId) as IsoDate));
    const byFactor = v.lots.filter((l) => l.factorMonth !== null).length;
    const asOf = [...dates].sort(compareDates)[0] as IsoDate;
    const ageDays = ageInDays(asOf, date);
    return {
      assetId: h.assetId,
      source: byFactor === v.lots.length ? 'factor' : byFactor === 0 ? 'subscription' : 'mixed',
      asOf,
      ageDays,
      stale: isStale(ageDays, caMaxAge),
    };
  }
  if (v.kind !== 'price') throw new MissingValuationError([h.assetId], date);
  const ageDays = ageInDays(v.price.date, date);
  const trade = fromFallback.has(h.assetId);
  return {
    assetId: h.assetId,
    source: trade ? 'trade' : 'price',
    asOf: v.price.date,
    ageDays,
    stale: trade || isStale(ageDays, staleAfter),
  };
}

function combineCaFlags(flags: readonly ValuationFlag[], date: IsoDate, caMaxAge: number) {
  if (flags.length === 0) return null;
  const sources = new Set(flags.map((f) => f.source));
  const source: 'factor' | 'subscription' | 'mixed' =
    sources.size === 1 ? (flags[0]?.source as 'factor' | 'subscription' | 'mixed') : 'mixed';
  const asOf = flags.map((f) => f.asOf).sort(compareDates)[0] as IsoDate;
  const ageDays = ageInDays(asOf, date);
  return { source, asOf, ageDays, stale: isStale(ageDays, caMaxAge) };
}
