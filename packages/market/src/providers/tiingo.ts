// Tiingo end-of-day prices for US listings (official API, key required).
// Free tier: 50 requests/hour, 1,000/day, 500 symbols/month. Returns the raw close and a
// splitFactor (1 except on a split's effective date). Prices are in USD for US listings;
// Tiingo does not state a currency per close.
import { assertIsoDate, dec, type IsoDate } from '@ledgr/core';
import { decimalText, parseJsonExact, ProviderError, request, type HttpOptions } from '../http';
import type { DailyBar, PriceProvider, SymbolCheck } from './types';

const BASE = 'https://api.tiingo.com/tiingo/daily';

export function createTiingo(http: HttpOptions, apiKey: string): PriceProvider {
  const headers = { Authorization: `Token ${apiKey}`, Accept: 'application/json' };
  const path = (symbol: string) => `${BASE}/${encodeURIComponent(symbol.toLowerCase())}`;
  return {
    id: 'tiingo',
    minIntervalMs: 0,

    async fetchDaily(symbol, from, to) {
      const url = `${path(symbol)}/prices?startDate=${from}&endDate=${to}&resampleFreq=daily&format=json`;
      const res = await request(http, 'tiingo', url, { headers }, [404]);
      if (res.status === 404) throw new ProviderError('tiingo', 'unknown_symbol');
      const data = parseJsonExact(await res.text());
      if (!Array.isArray(data)) throw new ProviderError('tiingo', 'bad_response');
      return parseBars(data, from, to);
    },

    async checkSymbol(symbol): Promise<SymbolCheck> {
      const res = await request(http, 'tiingo', path(symbol), { headers }, [404]);
      if (res.status === 404) {
        await res.body?.cancel();
        return { found: false, exchange: null, currency: null };
      }
      const meta = parseJsonExact(await res.text()) as { ticker?: unknown; exchangeCode?: unknown };
      const found =
        typeof meta?.ticker === 'string' && meta.ticker.toUpperCase() === symbol.toUpperCase();
      return {
        found,
        exchange: typeof meta?.exchangeCode === 'string' ? meta.exchangeCode : null,
        currency: null,
      };
    },
  };
}

export function parseBars(data: readonly unknown[], from: IsoDate, to: IsoDate): DailyBar[] {
  const bars: DailyBar[] = [];
  for (const item of data) {
    const row = item as { date?: unknown; close?: unknown; splitFactor?: unknown };
    const date = typeof row.date === 'string' ? row.date.slice(0, 10) : '';
    const close = decimalText(row.close);
    if (!close) throw new ProviderError('tiingo', 'bad_response');
    assertIsoDate(date);
    if (date < from || date > to) continue;
    const split = decimalText(row.splitFactor);
    bars.push({
      date,
      close,
      currency: null,
      splitFactor: split && !dec(split).eq(1) ? split : null,
    });
  }
  return bars.sort((a, b) => (a.date < b.date ? -1 : 1));
}
