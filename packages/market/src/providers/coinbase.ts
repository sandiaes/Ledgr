// Coinbase Exchange public daily candles (official, documented, no key). Up to 300 candles
// per request, so long ranges go in chunks. A candle is one UTC day; its close is the
// price at 24:00 UTC. The quote currency is the product's second half (BTC-EUR -> EUR).
import { addDays, assertIsoDate, type IsoDate } from '@ledgr/core';
import { decimalText, parseJsonExact, ProviderError, request, type HttpOptions } from '../http';
import type { DailyBar, LiveQuote, PriceProvider, SymbolCheck } from './types';

const BASE = 'https://api.exchange.coinbase.com/products';
const CHUNK_DAYS = 290;
const HEADERS = { Accept: 'application/json', 'User-Agent': 'ledgr-prices' };

export function createCoinbase(http: HttpOptions): PriceProvider {
  return {
    id: 'coinbase',
    minIntervalMs: 250,

    async fetchDaily(symbol, from, to) {
      const currency = quoteCurrency(symbol);
      const byDate = new Map<IsoDate, DailyBar>();
      for (let start = from; start <= to; start = addDays(start, CHUNK_DAYS)) {
        const end = addDays(start, CHUNK_DAYS - 1) < to ? addDays(start, CHUNK_DAYS - 1) : to;
        const url = `${BASE}/${encodeURIComponent(symbol)}/candles?granularity=86400&start=${start}T00:00:00Z&end=${end}T00:00:00Z`;
        const res = await request(http, 'coinbase', url, { headers: HEADERS }, [404]);
        if (res.status === 404) throw new ProviderError('coinbase', 'unknown_symbol');
        const data = parseJsonExact(await res.text());
        if (!Array.isArray(data)) throw new ProviderError('coinbase', 'bad_response');
        for (const bar of parseCandles(data, currency)) {
          if (bar.date >= from && bar.date <= to) byDate.set(bar.date, bar);
        }
        if (start !== to) await http.sleep(250);
      }
      return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    },

    liveTtlMs: 5 * 60_000,

    async fetchLatest(symbols) {
      const quotes: LiveQuote[] = [];
      for (const symbol of symbols) {
        const currency = quoteCurrency(symbol);
        const url = `${BASE}/${encodeURIComponent(symbol)}/ticker`;
        const res = await request(http, 'coinbase', url, { headers: HEADERS }, [404]);
        if (res.status === 404) {
          await res.body?.cancel();
          continue;
        }
        const t = parseJsonExact(await res.text()) as { price?: unknown; time?: unknown };
        const price = decimalText(t?.price);
        if (!price || typeof t.time !== 'string')
          throw new ProviderError('coinbase', 'bad_response');
        const tradingDay = new Date(t.time).toISOString().slice(0, 10); // UTC day
        quotes.push({ symbol, price, currency, tradingDay, quotedAt: t.time });
      }
      return quotes;
    },

    async checkSymbol(symbol): Promise<SymbolCheck> {
      const res = await request(
        http,
        'coinbase',
        `${BASE}/${encodeURIComponent(symbol)}`,
        { headers: HEADERS },
        [404],
      );
      if (res.status === 404) {
        await res.body?.cancel();
        return { found: false, exchange: null, currency: null };
      }
      const meta = parseJsonExact(await res.text()) as { id?: unknown; quote_currency?: unknown };
      return {
        found: meta?.id === symbol,
        exchange: 'Coinbase',
        currency: typeof meta?.quote_currency === 'string' ? meta.quote_currency : null,
      };
    },
  };
}

function quoteCurrency(symbol: string): string {
  const m = /^[A-Z0-9]+-([A-Z]{3})$/.exec(symbol);
  if (!m) throw new ProviderError('coinbase', 'unknown_symbol');
  return m[1] as string;
}

/** [time (unix s), low, high, open, close, volume] rows. */
export function parseCandles(data: readonly unknown[], currency: string): DailyBar[] {
  return data.map((row) => {
    if (!Array.isArray(row) || row.length < 5) throw new ProviderError('coinbase', 'bad_response');
    const time = decimalText(row[0]);
    const close = decimalText(row[4]);
    if (!time || !close || !/^\d+$/.test(time)) throw new ProviderError('coinbase', 'bad_response');
    const date = new Date(Number(time) * 1000).toISOString().slice(0, 10);
    assertIsoDate(date);
    return { date, close, currency, splitFactor: null };
  });
}
