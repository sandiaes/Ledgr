// Fixed mappings for the spreadsheet import. Anything not listed here is rejected.
import type { AssetType } from '@ledgr/core';

export type AccountType = 'broker' | 'exchange' | 'wallet' | 'platform';

/** Broker column (case-insensitive) -> the account it is imported into (one per broker). */
export const BROKERS: Readonly<Record<string, { name: string; accountType: AccountType }>> = {
  degiro: { name: 'Degiro', accountType: 'broker' },
  ibkr: { name: 'IBKR', accountType: 'broker' },
  kraken: { name: 'Kraken', accountType: 'exchange' },
  aforro: { name: 'Aforro', accountType: 'platform' },
};

/** Type column (case-insensitive, spaces ignored) -> asset type. */
export const TYPES: Readonly<Record<string, AssetType>> = {
  stocks: 'stock',
  stock: 'stock',
  etfs: 'etf',
  etf: 'etf',
  crypto: 'crypto',
  ca: 'certificado_aforro',
};

export const ASSET_TYPES: readonly AssetType[] = ['stock', 'etf', 'crypto', 'certificado_aforro'];

/** Transact Type column (case-insensitive). CA rows: buy -> subscription. */
export const TRANSACT_TYPES = ['buy', 'sell'] as const;
export type TransactType = (typeof TRANSACT_TYPES)[number];

/** Every order is EUR at fx 1: the spreadsheet has no currency or fx columns. */
export const ORDER_CURRENCY = 'EUR';

/** CA units are euros subscribed at 1 EUR per unit. */
export const CA_UNIT_PRICE = '1';

export const IMPORT_SOURCE = 'excel-csv';
export const FACTOR_SOURCE = 'excel';

export const DEFAULT_PATHS = {
  transactions: 'import-data/transactions.csv',
  mapping: 'import-data/asset_mapping.csv',
  allowedDuplicates: 'import-data/allowed-duplicates.txt',
  reports: 'import-data/reports',
  env: 'scripts/import/.env',
} as const;
