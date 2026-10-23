import type { AccountRecord, AssetRecord } from '@ledgr/client';
import type {
  CaFactor,
  CaSubscription,
  Decimal,
  FxRow,
  IsoDate,
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
  /** The Supabase project ref, shown in More so a wrong .env is visible. */
  projectRef: string;
}

/** The ledger: not deleted, transactions in FIFO order. */
export interface Ledger {
  transactions: Transaction[];
  assets: AssetRecord[];
  /** Brokers, by name (soft-deleted ones included, so older rows keep a name). */
  accounts: AccountRecord[];
  ca: { subscriptions: CaSubscription[]; factors: CaFactor[] };
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
