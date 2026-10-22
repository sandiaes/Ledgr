import { addDays, dec, type IsoDate, type Transaction } from '@ledgr/core';
import { describe, expect, it } from 'vitest';
import type { AssetRecord } from './db';
import { HttpError } from './http';
import { localDate, needsRefresh, runValueNow, type ValueNowContext } from './live';
import type { LiveQuote, PriceProvider } from './providers';
import { MemoryDb } from './test/memory-db';

const MIN = 60_000;

describe('needsRefresh', () => {
  const at = (iso: string) => new Date(iso);
  const us = (now: string, fetchedAt: string | null) =>
    needsRefresh({ mic: 'XNAS', fetchedAt, now: at(now), ttlMs: 15 * MIN });

  it('never within the interval; always without a cached quote', () => {
    expect(us('2026-10-21T15:00:00Z', null)).toBe(true);
    expect(us('2026-10-21T15:00:00Z', '2026-10-21T14:50:00Z')).toBe(false);
  });

  it('refreshes US listings during the session and 30 minutes after (New York time)', () => {
    expect(us('2026-10-21T15:00:00Z', '2026-10-21T14:40:00Z')).toBe(true); // 11:00 NY, Wed
    expect(us('2026-10-21T20:25:00Z', '2026-10-21T20:05:00Z')).toBe(true); // 16:25 NY
  });

  it('while closed, refreshes once to get the final close, then not until the next session', () => {
    // 18:00 NY with a quote from 15:50 NY: once, for the close
    expect(us('2026-10-21T22:00:00Z', '2026-10-21T19:50:00Z')).toBe(true);
    // ... fetched after the close: no more
    expect(us('2026-10-21T23:00:00Z', '2026-10-21T22:00:00Z')).toBe(false);
    // next morning before the open
    expect(us('2026-10-22T12:00:00Z', '2026-10-21T22:00:00Z')).toBe(false);
    // Saturday with a quote from Friday 15:00 NY: once; Sunday: no
    expect(us('2026-10-24T15:00:00Z', '2026-10-23T19:00:00Z')).toBe(true);
    expect(us('2026-10-25T15:00:00Z', '2026-10-24T15:00:00Z')).toBe(false);
    // Monday before the open with a Friday-after-close quote: no
    expect(us('2026-10-26T12:00:00Z', '2026-10-23T21:00:00Z')).toBe(false);
  });

  it('uses Xetra hours (Berlin) for XETR and the interval alone for crypto', () => {
    const xetra = (now: string, f: string) =>
      needsRefresh({ mic: 'XETR', fetchedAt: f, now: at(now), ttlMs: 3 * 60 * MIN });
    expect(xetra('2026-10-21T12:00:00Z', '2026-10-21T08:30:00Z')).toBe(true); // 14:00 Berlin
    expect(xetra('2026-10-21T20:00:00Z', '2026-10-21T16:10:00Z')).toBe(false); // after 18:00
    const crypto = needsRefresh({
      mic: null,
      fetchedAt: '2026-10-24T03:00:00Z',
      now: at('2026-10-24T03:06:00Z'),
      ttlMs: 5 * MIN,
    });
    expect(crypto).toBe(true);
  });

  it('takes "today" in the owner time zone', () => {
    expect(localDate(at('2026-07-01T23:30:00Z'), 'Europe/Lisbon')).toBe('2026-07-02');
    expect(localDate(at('2026-12-01T23:30:00Z'), 'Europe/Lisbon')).toBe('2026-12-01');
  });
});

const tx = (
  date: IsoDate,
  assetId: string,
  qty: string,
  price: string,
  type: Transaction['type'] = 'buy',
): Transaction => ({
  id: `${assetId}-${date}`,
  accountId: 'acc',
  assetId,
  type,
  tradeDate: date,
  quantity: dec(qty),
  unitPrice: dec(price),
  amount: null,
  fees: dec('0'),
  currency: 'EUR',
  fxRateToEur: dec('1'),
});

const asset = (id: string, over: Partial<AssetRecord>): AssetRecord => ({
  id,
  name: id,
  ticker: id,
  isin: null,
  exchange: 'XNAS',
  assetType: 'stock',
  tradingCurrency: 'USD',
  priceSource: 'tiingo',
  priceSourceId: id,
  ...over,
});

function liveProvider(
  id: string,
  ttlMs: number,
  quote: (s: string) => Omit<LiveQuote, 'symbol'> | null,
) {
  const calls: string[][] = [];
  let fail: Error | null = null;
  const provider: PriceProvider = {
    id,
    minIntervalMs: 0,
    liveTtlMs: ttlMs,
    async fetchDaily() {
      return [];
    },
    async checkSymbol() {
      return { found: true, exchange: null, currency: null };
    },
    async fetchLatest(symbols) {
      calls.push([...symbols]);
      if (fail) throw fail;
      return symbols.flatMap((symbol) => {
        const q = quote(symbol);
        return q ? [{ symbol, ...q }] : [];
      });
    },
  };
  return { provider, calls, setFail: (e: Error | null) => (fail = e) };
}

function setup(nowIso: string) {
  const db = new MemoryDb();
  db.assets = [
    asset('AAPL', {}),
    asset('VWCE', {
      exchange: 'XETR',
      assetType: 'etf',
      tradingCurrency: 'EUR',
      priceSource: 'alphavantage',
      priceSourceId: 'VWCE.DEX',
    }),
    asset('BTC', {
      exchange: null,
      assetType: 'crypto',
      tradingCurrency: 'EUR',
      priceSource: 'coinbase',
      priceSourceId: 'BTC-EUR',
    }),
    asset('E', {
      exchange: null,
      assetType: 'certificado_aforro',
      tradingCurrency: 'EUR',
      priceSource: 'ca_factors',
      priceSourceId: null,
    }),
    asset('OLD', {}),
  ];
  db.transactions = [
    tx('2026-01-01', 'AAPL', '10', '150'),
    tx('2026-01-01', 'VWCE', '4', '100'),
    tx('2026-01-01', 'BTC', '0.1', '50000'),
    { ...tx('2026-01-01', 'E', '1000', '1'), type: 'subscription', id: 'sub1' },
    tx('2026-01-01', 'OLD', '1', '10'),
    tx('2026-02-01', 'OLD', '1', '12', 'sell'),
  ];
  db.subscriptions = [{ id: 'c1', seriesId: 'S', transactionId: 'sub1' }];
  db.factors = [{ subscriptionId: 'c1', month: '2026-10-01', factor: dec('1.02') }];
  for (let d = '2026-09-15'; d <= '2026-10-20'; d = addDays(d, 1)) {
    db.prices.set(`AAPL|${d}`, {
      assetId: 'AAPL',
      date: d,
      close: dec('200'),
      currency: 'USD',
      splitFactor: null,
      source: 'tiingo',
    });
    db.prices.set(`VWCE|${d}`, {
      assetId: 'VWCE',
      date: d,
      close: dec('120'),
      currency: 'EUR',
      splitFactor: null,
      source: 'alphavantage',
    });
    db.prices.set(`BTC|${d}`, {
      assetId: 'BTC',
      date: d,
      close: dec('60000'),
      currency: 'EUR',
      splitFactor: null,
      source: 'coinbase',
    });
    db.fx.set(`USD|${d}`, { currency: 'USD', date: d, rateToEur: dec('0.8'), source: 'ecb' });
  }
  const tiingo = liveProvider('tiingo', 15 * MIN, () => ({
    price: '210',
    currency: null,
    tradingDay: '2026-10-21',
    quotedAt: '2026-10-21T11:00:00-04:00',
  }));
  const av = liveProvider('alphavantage', 180 * MIN, () => ({
    price: '125',
    currency: null,
    tradingDay: '2026-10-21',
    quotedAt: '2026-10-21T15:30:00Z',
  }));
  const coinbase = liveProvider('coinbase', 5 * MIN, () => ({
    price: '61000',
    currency: 'EUR',
    tradingDay: '2026-10-21',
    quotedAt: '2026-10-21T15:00:00Z',
  }));
  let now = new Date(nowIso);
  const ctx: ValueNowContext = {
    db,
    providers: new Map([tiingo, av, coinbase].map((p) => [p.provider.id, p.provider])),
    now: () => now,
    timeZone: 'Europe/Lisbon',
    staleAfterDays: 3,
    caMaxAgeDays: 35,
  };
  return { db, ctx, tiingo, av, coinbase, setNow: (iso: string) => (now = new Date(iso)) };
}

describe('runValueNow', () => {
  it('values held assets with fresh quotes in EUR, caches them, and writes no snapshot', async () => {
    const { db, ctx, tiingo, av, coinbase } = setup('2026-10-21T15:00:00Z'); // markets open
    const v = await runValueNow(ctx);
    // AAPL 10 * 210 USD * 0.8 = 1680; VWCE 4 * 125 = 500; BTC 0.1 * 61000 = 6100; CA 1000 * 1.02
    expect(v).toMatchObject({
      valuationDate: '2026-10-21',
      stockValueEur: '1680',
      etfValueEur: '500',
      cryptoValueEur: '6100',
      certificadoAforroValueEur: '1020',
      totalValueEur: '9300',
      netInvestedEur: '7898', // 1500 + 400 + 5000 + 1000 + 10 - 12 (OLD bought, then sold)
      refreshed: 3,
      fxDates: { USD: '2026-10-20' },
      issues: [],
    });
    expect(v.assets.find((a) => a.assetId === 'AAPL')).toEqual({
      assetId: 'AAPL',
      source: 'live',
      asOf: '2026-10-21',
      quotedAt: '2026-10-21T11:00:00-04:00',
      ageDays: 0,
      stale: false,
    });
    expect(v.assets.find((a) => a.assetId === 'E')?.source).toBe('factor');
    expect(tiingo.calls).toEqual([['AAPL']]); // OLD was sold: never quoted
    expect(av.calls).toEqual([['VWCE.DEX']]);
    expect(coinbase.calls).toEqual([['BTC-EUR']]);
    expect(db.live.size).toBe(3);
    expect(db.writes.snapshots).toBe(0);
  });

  it('serves from the cache within each provider interval', async () => {
    const s = setup('2026-10-21T15:00:00Z');
    await runValueNow(s.ctx);
    s.setNow('2026-10-21T15:02:00Z');
    const v = await runValueNow(s.ctx);
    expect(v.refreshed).toBe(0);
    expect(v.totalValueEur).toBe('9300');
    s.setNow('2026-10-21T15:20:00Z'); // tiingo and coinbase due, Alpha Vantage not
    await runValueNow(s.ctx);
    expect(s.tiingo.calls).toHaveLength(2);
    expect(s.coinbase.calls).toHaveLength(2);
    expect(s.av.calls).toHaveLength(1);
  });

  it('falls back to the last close when a provider refuses, and reports it', async () => {
    const s = setup('2026-10-21T15:00:00Z');
    s.tiingo.setFail(new HttpError('tiingo', 403));
    const v = await runValueNow(s.ctx);
    expect(v.stockValueEur).toBe('1600'); // 10 * 200 * 0.8 (close of 2026-10-20)
    expect(v.assets.find((a) => a.assetId === 'AAPL')).toMatchObject({
      source: 'close',
      asOf: '2026-10-20',
      ageDays: 1,
    });
    expect(v.issues).toEqual([
      { code: 'http_error', provider: 'tiingo', status: 403, assetId: 'AAPL' },
    ]);
  });

  it('the official close wins over a quote of the same day', async () => {
    const s = setup('2026-10-21T15:00:00Z');
    s.db.prices.set('AAPL|2026-10-21', {
      assetId: 'AAPL',
      date: '2026-10-21',
      close: dec('205'),
      currency: 'USD',
      splitFactor: null,
      source: 'tiingo',
    });
    const v = await runValueNow(s.ctx);
    expect(v.stockValueEur).toBe('1640'); // 10 * 205 * 0.8, not the quote's 210
    expect(v.assets.find((a) => a.assetId === 'AAPL')).toMatchObject({
      source: 'close',
      quotedAt: null,
    });
  });

  it('refuses a quote in another currency', async () => {
    const s = setup('2026-10-21T15:00:00Z');
    s.coinbase.provider.fetchLatest = async (symbols) =>
      symbols.map((symbol) => ({
        symbol,
        price: '70000',
        currency: 'USD',
        tradingDay: '2026-10-21',
        quotedAt: 'x',
      }));
    const v = await runValueNow(s.ctx);
    expect(v.cryptoValueEur).toBe('6000');
    expect(v.issues).toContainEqual({
      code: 'currency_mismatch',
      assetId: 'BTC',
      provider: 'coinbase',
    });
  });

  it('at the weekend only crypto refreshes once the final closes are cached', async () => {
    const s = setup('2026-10-23T21:00:00Z'); // Friday 17:00 NY, after Xetra: closes
    await runValueNow(s.ctx);
    s.setNow('2026-10-24T10:00:00Z'); // Saturday
    const v = await runValueNow(s.ctx);
    expect(v.refreshed).toBe(1);
    expect(s.tiingo.calls).toHaveLength(1);
    expect(s.av.calls).toHaveLength(1);
    expect(s.coinbase.calls).toHaveLength(2);
  });
});
