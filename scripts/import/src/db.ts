// The importer's view of the database. SupabaseImportDb talks to the real project with the
// service-role key; tests use an in-memory implementation of the same interface.
import type { AssetType, IsoDate } from '@ledgr/core';
import type { AccountType } from './config';

/** What already exists for the user (soft-deleted rows included where they still block). */
export interface ExistingState {
  /** Live (not undone) import batches. */
  batches: {
    id: string;
    transactionsFileSha256: string;
    caFileSha256: string | null;
    createdAt: string;
  }[];
  accounts: { id: string; name: string }[];
  assets: { id: string; ticker: string | null; assetType: AssetType; isin: string | null }[];
  caSeries: { id: string; code: string }[];
  /** Transactions carrying an import_row_hash (soft-deleted too: the hash stays taken). */
  importedTransactions: {
    id: string;
    importRowHash: string;
    quantity: string;
    batchId: string | null;
  }[];
  caSubscriptions: { id: string; transactionId: string }[];
  caFactors: { subscriptionId: string; month: IsoDate; factor: string }[];
}

export const EMPTY_STATE: ExistingState = {
  batches: [],
  accounts: [],
  assets: [],
  caSeries: [],
  importedTransactions: [],
  caSubscriptions: [],
  caFactors: [],
};

/** Argument of public.ledgr_import_commit. Numbers are decimal strings, never floats. */
export interface CommitPayload {
  source: string;
  transactions_file_sha256: string;
  ca_file_sha256: string | null;
  ca_ratio_month: IsoDate | null;
  settings: Record<string, unknown>;
  accounts: { id: string; name: string; account_type: AccountType }[];
  assets: {
    id: string;
    name: string;
    asset_type: AssetType;
    isin: string | null;
    ticker: string;
    exchange: string | null;
    trading_currency: string;
    price_source: string;
    price_source_id: string | null;
  }[];
  ca_series: { id: string; code: string; name: string }[];
  transactions: {
    id: string;
    /** File order; the function turns it into increasing created_at. */
    seq: number;
    account_id: string;
    asset_id: string;
    type: 'buy' | 'sell' | 'subscription';
    trade_date: IsoDate;
    trade_date_precision: 'month';
    quantity: string;
    unit_price: string;
    currency: string;
    fx_rate_to_eur: string;
    import_row_hash: string;
    notes: string | null;
  }[];
  ca_subscriptions: { id: string; series_id: string; transaction_id: string }[];
  ca_factors: {
    subscription_id: string;
    month: IsoDate;
    factor: string;
    source: string;
    notes: string | null;
  }[];
}

export type TableCounts = Record<
  'accounts' | 'assets' | 'ca_series' | 'transactions' | 'ca_subscriptions' | 'ca_factors',
  number
>;

export interface BatchInfo {
  id: string;
  createdAt: string;
  undoneAt: string | null;
  counts: TableCounts;
}

export interface ImportDb {
  /** Project reference (from the URL), printed before any write. */
  readonly projectRef: string;
  /** Fails unless the user exists (also proves the key works). */
  checkUser(userId: string): Promise<void>;
  loadState(userId: string): Promise<ExistingState>;
  /** Atomic. Returns the new batch id. */
  commit(userId: string, payload: CommitPayload): Promise<string>;
  /** Rows per table tagged with the batch, or null when the user has no such batch. */
  batchInfo(userId: string, batchId: string): Promise<BatchInfo | null>;
  /** Atomic. Rows deleted per table. */
  undo(userId: string, batchId: string): Promise<TableCounts>;
}
