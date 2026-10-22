// Alpha Vantage daily prices, used for Xetra listings (`<TICKER>.DEX`). Official API, key
// required. Free tier: 25 requests/day and 5/minute. TIME_SERIES_DAILY is the raw
// (unadjusted) series; the adjusted one is premium, so no split data comes from here.
// Errors arrive as HTTP 200 with an "Error Message", "Note" or "Information" field.
import { assertIsoDate, daysBetween, type IsoDate } from '@ledgr/core';
import { decimalText, parseJsonExact, ProviderError, request, type HttpOptions } from '../http';
import type { DailyBar, PriceProvider, SymbolCheck } from './types';

const BASE = 'https://www.alphavantage.co/query';

/** `compact` returns the latest 100 trading days (about 140 calendar days). */
const COMPACT_CALENDAR_DAYS = 120;

export function createAlphaVantage(
  http: HttpOptions,
  apiKey: string,
  today: () => IsoDate,
): PriceProvider {
  const get = async (params: Record<string, string>) => {
    const query = new URLSearchParams({ ...params, apikey: apiKey }).toString();
    const res = await request(http, 'alphavantage', `${BASE}?${query}`);
    const body = parseJsonExact(await res.text()) as Record<string, unknown>;
    if (!body || typeof body !== 'object') throw new ProviderError('alphavantage', 'bad_response');
    if ('Error Message' in body) throw new ProviderError('alphavantage', 'unknown_symbol');
    const note = String(body.Note ?? body.Information ?? '');
    if (note !== '') {
      throw new ProviderError(
        'alphavantage',
        /premium/i.test(note)
          ? 'premium_only'
          : /rate limit|requests per|frequency/i.test(note)
            ? 'rate_limited'
            : 'bad_response',
      );
    }
    return body;
  };

  return {
    id: 'alphavantage',
    minIntervalMs: 12_500,

    async fetchDaily(symbol, from, to) {
      const compact = daysBetween(from, today()) <= COMPACT_CALENDAR_DAYS;
      const body = await get({
        function: 'TIME_SERIES_DAILY',
        symbol,
        outputsize: compact ? 'compact' : 'full',
        datatype: 'json',
      });
      const series = body['Time Series (Daily)'];
      if (!series || typeof series !== 'object')
        throw new ProviderError('alphavantage', 'bad_response');
      const bars: DailyBar[] = [];
      for (const [date, fields] of Object.entries(
        series as Record<string, Record<string, unknown>>,
      )) {
        assertIsoDate(date);
        if (date < from || date > to) continue;
        const close = decimalText(fields?.['4. close']);
        if (!close) throw new ProviderError('alphavantage', 'bad_response');
        bars.push({ date, close, currency: null, splitFactor: null });
      }
      return bars.sort((a, b) => (a.date < b.date ? -1 : 1));
    },

    async checkSymbol(symbol): Promise<SymbolCheck> {
      const keywords = symbol.replace(/\.DEX$/, '');
      const body = await get({ function: 'SYMBOL_SEARCH', keywords, datatype: 'json' });
      const matches = Array.isArray(body.bestMatches)
        ? (body.bestMatches as Record<string, unknown>[])
        : [];
      const exact = matches.filter((m) => m['1. symbol'] === symbol);
      if (exact.length !== 1) return { found: false, exchange: null, currency: null };
      const match = exact[0] as Record<string, unknown>;
      return {
        found: true,
        exchange: typeof match['4. region'] === 'string' ? match['4. region'] : null,
        currency: typeof match['8. currency'] === 'string' ? match['8. currency'] : null,
      };
    },
  };
}
