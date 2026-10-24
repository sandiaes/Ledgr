// PostgREST rows -> core types, shared by the apps (supabase-js) and the jobs (rest-db), so
// numerics are parsed identically everywhere: always selected as text (`::text`) and read
// with dec(), never through JS floats.
import {
  dec,
  type AssetType,
  type Decimal,
  type CaFactor,
  type CaSubscription,
  type FxRow,
  type IsoDate,
  type StoredPriceRow,
  type Transaction,
  type ValueSnapshot,
} from '@ledgr/core';

export type Row = Record<string, unknown>;

/** Mirrors the public.assets columns the apps and jobs need (soft-deleted rows excluded). */
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

/** Mirrors a public.live_quotes row: the latest intraday quote of an asset. */
export interface LiveQuoteRecord {
  assetId: string;
  price: string;
  currency: string;
  tradingDay: IsoDate;
  quotedAt: string;
  fetchedAt: string;
  source: string;
}

export interface AccountRecord {
  id: string;
  name: string;
  /** Soft-deleted: kept so older rows keep a name, never offered for new rows. */
  deleted?: boolean;
}

/** A certificado series' code and name (public.ca_series), for labels. */
export interface CaSeriesRecord {
  id: string;
  code: string;
  name: string;
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const decOrNull = (v: unknown) => (v === null || v === undefined ? null : dec(String(v)));

export const ASSET_COLUMNS =
  'id,name,ticker,isin,exchange,asset_type,trading_currency,price_source,price_source_id';

export const assetFromRow = (r: Row): AssetRecord => ({
  id: String(r.id),
  name: String(r.name),
  ticker: str(r.ticker),
  isin: str(r.isin),
  exchange: str(r.exchange),
  assetType: r.asset_type as AssetType,
  tradingCurrency: String(r.trading_currency).trim(),
  priceSource: String(r.price_source),
  priceSourceId: str(r.price_source_id),
});

export const ACCOUNT_COLUMNS = 'id,name,deleted_at';

export const accountFromRow = (r: Row): AccountRecord => ({
  id: String(r.id),
  name: String(r.name),
  ...(r.deleted_at ? { deleted: true } : {}),
});

export const CA_SERIES_COLUMNS = 'id,code,name';

export const caSeriesFromRow = (r: Row): CaSeriesRecord => ({
  id: String(r.id),
  code: String(r.code),
  name: String(r.name),
});

export const TRANSACTION_COLUMNS =
  'id,account_id,asset_id,type,trade_date,trade_date_precision,quantity::text,unit_price::text,' +
  'amount::text,fees::text,currency,fx_rate_to_eur::text,ca_subscription_id,' +
  'withholding_tax::text,transfer_to_account_id';

export const transactionFromRow = (r: Row): Transaction => ({
  id: String(r.id),
  accountId: String(r.account_id),
  assetId: str(r.asset_id),
  type: r.type as Transaction['type'],
  tradeDate: String(r.trade_date),
  quantity: decOrNull(r.quantity),
  unitPrice: decOrNull(r.unit_price),
  amount: decOrNull(r.amount),
  fees: dec(String(r.fees)),
  currency: String(r.currency).trim(),
  fxRateToEur: dec(String(r.fx_rate_to_eur)),
  caSubscriptionId: str(r.ca_subscription_id),
  withholdingTax: decOrNull(r.withholding_tax),
  transferToAccountId: str(r.transfer_to_account_id),
  ...(r.trade_date_precision === 'month' ? { tradeDatePrecision: 'month' as const } : {}),
});

/** numeric(38,18) text for a write: exact and never in exponent notation. */
const numeric = (v: Decimal | null | undefined) => (v ? v.toFixed() : null);

/**
 * A ledger row as PostgREST columns, for the app's inserts and updates (the id is the
 * client-generated one; user_id is set by the database from the session).
 */
export function transactionToRow(tx: Transaction): Row {
  return {
    id: tx.id,
    account_id: tx.accountId,
    asset_id: tx.assetId,
    type: tx.type,
    trade_date: tx.tradeDate,
    trade_date_precision: tx.tradeDatePrecision ?? 'day',
    quantity: numeric(tx.quantity),
    unit_price: numeric(tx.unitPrice),
    amount: numeric(tx.amount),
    fees: tx.fees.toFixed(),
    currency: tx.currency,
    fx_rate_to_eur: tx.fxRateToEur.toFixed(),
    ca_subscription_id: tx.caSubscriptionId ?? null,
    withholding_tax: numeric(tx.withholdingTax),
    transfer_to_account_id: tx.transferToAccountId ?? null,
  };
}

/** Mirrors the newest public.job_runs row of a job: when it finished and how it went. */
export interface JobRunSummary {
  job: string;
  status: 'ok' | 'partial' | 'failed';
  finishedAt: string;
}

export const JOB_RUN_COLUMNS = 'job,status,finished_at';

export const jobRunFromRow = (r: Row): JobRunSummary => ({
  job: String(r.job),
  status: r.status as JobRunSummary['status'],
  finishedAt: String(r.finished_at),
});

export const PRICE_COLUMNS = 'asset_id,price_date,close::text,currency,split_factor::text';

export const priceFromRow = (r: Row): StoredPriceRow => ({
  assetId: String(r.asset_id),
  date: String(r.price_date),
  close: dec(String(r.close)),
  currency: String(r.currency).trim(),
  splitFactor: decOrNull(r.split_factor),
});

export const FX_COLUMNS = 'currency,rate_date,rate_to_eur::text';

export const fxFromRow = (r: Row): FxRow => ({
  currency: String(r.currency).trim(),
  date: String(r.rate_date),
  rateToEur: dec(String(r.rate_to_eur)),
});

export const CA_SUBSCRIPTION_COLUMNS = 'id,series_id,transaction_id';

export const caSubscriptionFromRow = (r: Row): CaSubscription => ({
  id: String(r.id),
  seriesId: String(r.series_id),
  transactionId: String(r.transaction_id),
});

export const CA_FACTOR_COLUMNS = 'subscription_id,month,factor::text';

export const caFactorFromRow = (r: Row): CaFactor => ({
  subscriptionId: String(r.subscription_id),
  month: String(r.month),
  factor: dec(String(r.factor)),
});

export const LIVE_QUOTE_COLUMNS =
  'asset_id,price::text,currency,trading_day,quoted_at,fetched_at,source';

export const liveQuoteFromRow = (r: Row): LiveQuoteRecord => ({
  assetId: String(r.asset_id),
  price: String(r.price),
  currency: String(r.currency).trim(),
  tradingDay: String(r.trading_day),
  quotedAt: String(r.quoted_at),
  fetchedAt: String(r.fetched_at),
  source: String(r.source),
});

/** Value, net invested and the per-type values (for the asset scope, docs/kpis.md §0.2). */
export const SNAPSHOT_COLUMNS =
  'snapshot_date,total_value_eur::text,net_contributions_eur::text,stock_value_eur::text,' +
  'etf_value_eur::text,crypto_value_eur::text,certificado_aforro_value_eur::text';

/** The per-type value columns; all four or none. */
const TYPE_COLUMNS: [AssetType, string][] = [
  ['stock', 'stock_value_eur'],
  ['etf', 'etf_value_eur'],
  ['crypto', 'crypto_value_eur'],
  ['certificado_aforro', 'certificado_aforro_value_eur'],
];

export const snapshotFromRow = (r: Row): ValueSnapshot => {
  const s: ValueSnapshot = {
    date: String(r.snapshot_date),
    valueEur: dec(String(r.total_value_eur)),
    netInvestedEur: dec(String(r.net_contributions_eur)),
  };
  if (TYPE_COLUMNS.every(([, c]) => r[c] !== undefined && r[c] !== null)) {
    s.valueByTypeEur = Object.fromEntries(
      TYPE_COLUMNS.map(([t, c]) => [t, dec(String(r[c]))]),
    ) as Record<AssetType, Decimal>;
  }
  return s;
};
