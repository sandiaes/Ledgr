import type { IsoDate } from '@ledgr/core';
import type { HttpOptions } from '../http';
import { createAlphaVantage } from './alphavantage';
import { createCoinbase } from './coinbase';
import { createTiingo } from './tiingo';
import type { PriceProvider } from './types';

export type { DailyBar, PriceProvider, SymbolCheck } from './types';

export interface ProviderKeys {
  tiingo?: string;
  alphavantage?: string;
}

/** Providers by assets.price_source id. One without its key is left out. */
export type ProviderRegistry = ReadonlyMap<string, PriceProvider>;

export function createProviders(
  http: HttpOptions,
  keys: ProviderKeys,
  today: () => IsoDate,
): ProviderRegistry {
  const list: PriceProvider[] = [createCoinbase(http)];
  if (keys.tiingo) list.push(createTiingo(http, keys.tiingo));
  if (keys.alphavantage) list.push(createAlphaVantage(http, keys.alphavantage, today));
  return new Map(list.map((p) => [p.id, p]));
}

/** price_source values that are never fetched. */
export const NOT_FETCHED = new Set(['manual', 'ca_factors', 'ca_accrual']);
