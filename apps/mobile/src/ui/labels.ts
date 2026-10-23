import type { AccountRecord, AssetRecord } from '@ledgr/client';
import type { AssetType } from '@ledgr/core';
import { useMemo } from 'react';
import type { Ledger } from '../services';

/** Asset and broker names, by id. */
export interface Names {
  assets: ReadonlyMap<string, AssetRecord>;
  accounts: ReadonlyMap<string, AccountRecord>;
}

export function useNames(ledger: Ledger | null): Names {
  return useMemo(
    () => ({
      assets: new Map((ledger?.assets ?? []).map((a) => [a.id, a])),
      accounts: new Map((ledger?.accounts ?? []).map((a) => [a.id, a])),
    }),
    [ledger],
  );
}

/** Ticker, else name. */
export const assetLabel = (names: Names, id: string) => {
  const a = names.assets.get(id);
  return a?.ticker || a?.name || 'Unknown asset';
};

export const assetName = (names: Names, id: string) => names.assets.get(id)?.name ?? '';

export const brokerLabel = (names: Names, id: string) =>
  names.accounts.get(id)?.name ?? 'Unknown broker';

export const TYPE_LABELS: Record<AssetType, string> = {
  stock: 'Stocks',
  etf: 'ETFs',
  crypto: 'Crypto',
  certificado_aforro: 'Certificados',
};

export const typeLabel = (key: string) => TYPE_LABELS[key as AssetType] ?? key;
