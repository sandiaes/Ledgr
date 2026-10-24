import type { AccountRecord, AssetRecord, CaSeriesRecord, JobRunSummary } from '@ledgr/client';
import type {
  CaFactor,
  CaSubscription,
  Decimal,
  FxRow,
  IsoDate,
  NewAsset,
  PriceRow,
  StoredPriceRow,
  Transaction,
  ValueSnapshot,
} from '@ledgr/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext, type ReactNode } from 'react';
import type { Settings } from './settings/settings';

/** Everything behind the screens, so tests can swap in fakes. */
export interface Services {
  auth: SupabaseClient['auth'];
  data: DataApi;
  device: DeviceApi;
  settings: SettingsStore;
  /** Deletes the stored session and its key (after sign-out). */
  clearSession(): Promise<void>;
  /** The Supabase project ref, shown in Settings so a wrong .env is visible. */
  projectRef: string;
  /** A random UUID (expo-crypto): the id of a row the app is about to insert. */
  newId(): string;
}

/** The ledger: not deleted, transactions in FIFO order. */
export interface Ledger {
  transactions: Transaction[];
  assets: AssetRecord[];
  /** Brokers, by name (soft-deleted ones included, so older rows keep a name). */
  accounts: AccountRecord[];
  ca: { subscriptions: CaSubscription[]; factors: CaFactor[]; series: CaSeriesRecord[] };
}

export interface Market {
  prices: StoredPriceRow[];
  fx: FxRow[];
  liveQuotes: PriceRow[];
}

/** value-now's totals, compared with the app's own (`reconcile`). */
export interface ValueNowTotals {
  computedAt: string;
  totalValueEur: Decimal;
  costBasisEur: Decimal;
}

/**
 * Reads under the owner's session. Every call checks the token is aal2 first and throws
 * MfaRequiredError otherwise; under aal1 RLS would return empty lists.
 */
export interface DataApi {
  ledger(): Promise<Ledger>;
  /** Prices and FX from 14 days before today, the latest older close of `heldAssetIds`
   * without one in that window, and the live quotes. */
  market(today: IsoDate, heldAssetIds: readonly string[]): Promise<Market>;
  snapshots(): Promise<ValueSnapshot[]>;
  /** One asset's whole price history (raw closes and split factors), for its chart. */
  priceHistory(assetId: string): Promise<StoredPriceRow[]>;
  /** Refreshes due quotes server-side; null when value-now could not answer. */
  valueNow(): Promise<ValueNowTotals | null>;
  /** The newest `prices` and `snapshots` runs (Settings). */
  jobRuns(): Promise<{ prices: JobRunSummary | null; snapshots: JobRunSummary | null }>;

  // Writes. Each one is safe to retry: a row whose id already exists counts as saved.
  /** Inserts a new ledger row under its client-generated id. */
  insertTransaction(row: Transaction): Promise<void>;
  /** Replaces the fields of an existing, not deleted row (same id). */
  updateTransaction(row: Transaction): Promise<void>;
  /** Soft delete: sets deleted_at. */
  deleteTransaction(id: string): Promise<void>;
  /** Inserts an asset with price_source 'manual' ("price pending"). */
  insertAsset(asset: NewAsset & { id: string }): Promise<void>;
  /** Inserts one ca_factors row per subscription for `month` (rows are immutable). */
  insertFactors(
    month: IsoDate,
    rows: readonly { subscriptionId: string; factor: Decimal }[],
  ): Promise<void>;
}

export type SecurityLevel = 'none' | 'secret' | 'biometric';

export interface DeviceApi {
  /** Whether the phone has a screen lock and/or enrolled biometrics. */
  securityLevel(): Promise<SecurityLevel>;
  /** Biometric prompt with the device PIN / pattern as fallback; true when it succeeded. */
  authenticate(): Promise<boolean>;
  /** Android FLAG_SECURE: no screenshots, recordings or recent-apps thumbnail. */
  setScreenCaptureBlocked(blocked: boolean): Promise<void>;
}

/** The settings toggles (no financial data). */
export interface SettingsStore {
  load(): Promise<unknown>;
  save(settings: Settings): Promise<void>;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider(props: { services: Services; children: ReactNode }) {
  return (
    <ServicesContext.Provider value={props.services}>{props.children}</ServicesContext.Provider>
  );
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesProvider missing');
  return services;
}
