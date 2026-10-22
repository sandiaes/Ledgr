// What the jobs read and write. One instance is bound to one user: every read filters on
// that user_id and every write sets it (the service role bypasses RLS).
import type {
  AssetType,
  CaFactor,
  CaSubscription,
  FxRow,
  IsoDate,
  PortfolioSnapshot,
  StoredPriceRow,
  Transaction,
} from '@ledgr/core';

/** Mirrors the public.assets columns the jobs need (soft-deleted rows excluded). */
export interface AssetRecord {
  id: string;
  name: string;
  ticker: string | null;
  isin: string | null;
  /** ISO 10383 MIC, e.g. XNAS, XETR; null for none. */
  exchange: string | null;
  assetType: AssetType;
  /** Listing currency. */
  tradingCurrency: string;
  priceSource: string;
  priceSourceId: string | null;
}

export interface PriceUpsert {
  assetId: string;
  date: IsoDate;
  close: string;
  currency: string;
  source: string;
  splitFactor: string | null;
}

export interface FxUpsert {
  currency: string;
  date: IsoDate;
  /** EUR per 1 unit of `currency`. */
  rateToEur: string;
  source: string;
}

/**
 * Something a run could not do, or a flag for the owner. Codes, ids, dates and HTTP
 * statuses only: never prices, values or provider response text.
 */
export interface Issue {
  code: string;
  assetId?: string;
  date?: IsoDate;
  provider?: string;
  status?: number;
}

export type JobName = 'fx' | 'prices' | 'snapshots' | 'resolve';

/** Mirrors a public.job_runs row. */
export interface JobRunRecord {
  job: JobName;
  trigger: 'cron' | 'script';
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'partial' | 'failed';
  /** Integers only. */
  counts: Record<string, number>;
  issues: Issue[];
}

export interface JobsDb {
  loadAssets(): Promise<AssetRecord[]>;
  /** Not soft-deleted, in (trade_date, created_at, id) order: the order imports rely on. */
  loadTransactions(): Promise<Transaction[]>;
  loadCa(): Promise<{ subscriptions: CaSubscription[]; factors: CaFactor[] }>;
  /** Prices dated on or after `from` (all when omitted), of `assetIds` (all when omitted). */
  loadPrices(opts?: { from?: IsoDate; assetIds?: readonly string[] }): Promise<StoredPriceRow[]>;
  /** The newest price of the asset dated strictly before `date`. */
  latestPriceBefore(assetId: string, date: IsoDate): Promise<StoredPriceRow | null>;
  /** Earliest and latest price date stored for the asset. */
  priceBounds(assetId: string): Promise<{ first: IsoDate; last: IsoDate } | null>;
  loadFx(opts?: { from?: IsoDate }): Promise<FxRow[]>;
  lastFxDate(currency: string): Promise<IsoDate | null>;
  /** Insert or overwrite on (asset_id, price_date). */
  upsertPrices(rows: readonly PriceUpsert[]): Promise<void>;
  /** Insert or overwrite on (user_id, currency, rate_date). */
  upsertFx(rows: readonly FxUpsert[]): Promise<void>;
  /** Insert or overwrite on (user_id, snapshot_date). */
  upsertSnapshots(rows: readonly PortfolioSnapshot[]): Promise<void>;
  recordRun(run: JobRunRecord): Promise<void>;
  /** Sets assets.price_source / price_source_id (symbol resolution, local script only). */
  setPriceSymbol(assetId: string, source: string, symbol: string): Promise<void>;
}

/** numeric(38,18) text: rounded half-even to 18 decimals, so writes are deterministic. */
export function numericText(value: {
  toDecimalPlaces(dp: number): { toString(): string };
}): string {
  return value.toDecimalPlaces(18).toString();
}

/** A public.portfolio_snapshots row for PostgREST (user_id added by the caller). */
export function snapshotRow(s: PortfolioSnapshot): Record<string, unknown> {
  return {
    snapshot_date: s.snapshotDate,
    total_value_eur: numericText(s.totalValueEur),
    total_cost_basis_eur: numericText(s.totalCostBasisEur),
    net_contributions_eur: numericText(s.netContributionsEur),
    cash_eur: s.cashEur ? numericText(s.cashEur) : null,
    stock_value_eur: numericText(s.stockValueEur),
    etf_value_eur: numericText(s.etfValueEur),
    crypto_value_eur: numericText(s.cryptoValueEur),
    certificado_aforro_value_eur: numericText(s.certificadoAforroValueEur),
    stale: s.stale,
    stale_asset_count: s.staleAssetCount,
    ca_value_source: s.caValueSource,
    ca_value_as_of: s.caValueAsOf,
    ca_value_age_days: s.caValueAgeDays,
    ca_value_stale: s.caValueStale,
    valuation_flags: s.valuationFlags.map((f) => ({
      asset_id: f.assetId,
      source: f.source,
      as_of: f.asOf,
      age_days: f.ageDays,
      stale: f.stale,
    })),
  };
}
