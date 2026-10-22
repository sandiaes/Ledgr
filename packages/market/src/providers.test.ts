import { describe, expect, it } from 'vitest';
import { ProviderError } from './http';
import { createAlphaVantage } from './providers/alphavantage';
import { createCoinbase } from './providers/coinbase';
import { createTiingo } from './providers/tiingo';
import { fakeFetch, jsonResponse, noSleep } from './test/memory-db';

describe('Tiingo', () => {
  it('reads raw closes and split factors exactly, with the key in a header only', async () => {
    const body =
      '[{"date":"2022-06-03T00:00:00.000Z","close":2447.0,"adjClose":122.35,"splitFactor":1.0},' +
      '{"date":"2022-06-06T00:00:00.000Z","close":124.79,"adjClose":124.79,"splitFactor":20.0},' +
      '{"date":"2022-06-07T00:00:00.000Z","close":123.00,"splitFactor":1.0}]';
    const { fetch, calls } = fakeFetch([[/tiingo\/daily\/amzn\/prices/, () => jsonResponse(body)]]);
    const tiingo = createTiingo({ fetch, sleep: noSleep }, 'KEY123');
    const bars = await tiingo.fetchDaily('AMZN', '2022-06-03', '2022-06-06');
    expect(bars).toEqual([
      { date: '2022-06-03', close: '2447.0', currency: null, splitFactor: null },
      { date: '2022-06-06', close: '124.79', currency: null, splitFactor: '20.0' },
    ]);
    expect(calls[0]?.url).toContain('startDate=2022-06-03&endDate=2022-06-06');
    expect(calls[0]?.url).not.toContain('KEY123');
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Token KEY123');
  });

  it('reports an unknown ticker, and checks symbols by their metadata', async () => {
    const { fetch } = fakeFetch([
      [/daily\/nope/, () => jsonResponse({ detail: 'not found' }, 404)],
      [/daily\/wmt$/, () => jsonResponse({ ticker: 'wmt', exchangeCode: 'NASDAQ' })],
    ]);
    const tiingo = createTiingo({ fetch, sleep: noSleep }, 'k');
    await expect(tiingo.fetchDaily('NOPE', '2024-01-01', '2024-01-02')).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(await tiingo.checkSymbol('NOPE')).toEqual({
      found: false,
      exchange: null,
      currency: null,
    });
    expect(await tiingo.checkSymbol('WMT')).toEqual({
      found: true,
      exchange: 'NASDAQ',
      currency: null,
    });
  });
});

describe('Alpha Vantage', () => {
  const series = {
    'Meta Data': { '2. Symbol': 'SXR8.DEX' },
    'Time Series (Daily)': {
      '2024-01-03': { '4. close': '476.1200' },
      '2024-01-02': { '4. close': '478.0000' },
      '2023-12-29': { '4. close': '475.5500' },
    },
  };

  it('uses compact for recent ranges and full for older ones, keeping the range only', async () => {
    const { fetch, calls } = fakeFetch([[/TIME_SERIES_DAILY/, () => jsonResponse(series)]]);
    const av = createAlphaVantage({ fetch, sleep: noSleep }, 'K', () => '2024-01-10');
    const bars = await av.fetchDaily('SXR8.DEX', '2024-01-01', '2024-01-05');
    expect(bars.map((b) => [b.date, b.close])).toEqual([
      ['2024-01-02', '478.0000'],
      ['2024-01-03', '476.1200'],
    ]);
    expect(calls[0]?.url).toContain('outputsize=compact');
    await av.fetchDaily('SXR8.DEX', '2021-01-01', '2024-01-05');
    expect(calls[1]?.url).toContain('outputsize=full');
  });

  it('falls back to the latest 100 days when the full history is premium', async () => {
    const { fetch, calls } = fakeFetch([
      [/outputsize=full/, () => jsonResponse({ Information: 'This is a premium endpoint.' })],
      [/outputsize=compact/, () => jsonResponse(series)],
    ]);
    const av = createAlphaVantage({ fetch, sleep: noSleep }, 'K', () => '2024-01-10');
    const bars = await av.fetchDaily('SXR8.DEX', '2021-01-01', '2024-01-05');
    expect(bars.map((b) => b.date)).toEqual(['2023-12-29', '2024-01-02', '2024-01-03']);
    expect(calls.map((c) => /outputsize=(\w+)/.exec(c.url)?.[1])).toEqual(['full', 'compact']);
  });

  it('turns 200-with-a-message answers into provider errors', async () => {
    const answers = [
      { 'Error Message': 'Invalid API call.' },
      {
        Information:
          'We have detected your API key as ... standard API rate limit is 25 requests per day.',
      },
      { Information: 'This is a premium endpoint.' },
    ];
    let i = 0;
    const { fetch } = fakeFetch([[/./, () => jsonResponse(answers[i++])]]);
    const av = createAlphaVantage({ fetch, sleep: noSleep }, 'K', () => '2024-01-10');
    const codes = [];
    for (let n = 0; n < 3; n++) {
      codes.push(
        await av
          .fetchDaily('X.DEX', '2024-01-01', '2024-01-05')
          .catch((e: ProviderError) => e.code),
      );
    }
    expect(codes).toEqual(['unknown_symbol', 'rate_limited', 'premium_only']);
  });

  it('confirms a Xetra symbol only on an exact match, with its currency', async () => {
    const { fetch } = fakeFetch([
      [
        /SYMBOL_SEARCH&keywords=SXR8/,
        () =>
          jsonResponse({
            bestMatches: [
              { '1. symbol': 'SXR8.DEX', '4. region': 'XETRA', '8. currency': 'EUR' },
              { '1. symbol': 'SXR8.FRK', '4. region': 'Frankfurt', '8. currency': 'EUR' },
            ],
          }),
      ],
      [/SYMBOL_SEARCH&keywords=IS3R/, () => jsonResponse({ bestMatches: [] })],
    ]);
    const av = createAlphaVantage({ fetch, sleep: noSleep }, 'K', () => '2024-01-10');
    expect(await av.checkSymbol('SXR8.DEX')).toEqual({
      found: true,
      exchange: 'XETRA',
      currency: 'EUR',
    });
    expect((await av.checkSymbol('IS3R.DEX')).found).toBe(false);
  });
});

describe('Coinbase', () => {
  it('fetches long ranges in chunks of at most 290 days, quoting in EUR', async () => {
    const day = (iso: string) =>
      Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;
    const { fetch, calls } = fakeFetch([
      [
        /candles/,
        (url) => {
          const start = /start=(\d{4}-\d{2}-\d{2})/.exec(url)?.[1] as string;
          // newest first, like Coinbase; one candle at the chunk start
          return jsonResponse(`[[${day(start)}, 1, 2, 1, 29123.45, 10]]`);
        },
      ],
    ]);
    const cb = createCoinbase({ fetch, sleep: noSleep });
    const bars = await cb.fetchDaily('BTC-EUR', '2021-01-01', '2022-06-30');
    expect(calls.length).toBe(2);
    expect(bars).toEqual([
      { date: '2021-01-01', close: '29123.45', currency: 'EUR', splitFactor: null },
      { date: '2021-10-18', close: '29123.45', currency: 'EUR', splitFactor: null },
    ]);
  });
});

describe('live quotes', () => {
  it('Tiingo IEX: one request for all tickers, tngoLast else last, New York trading day', async () => {
    const body =
      '[{"ticker":"AAPL","tngoLast":210.15,"last":210.1,"timestamp":"2026-10-21T11:00:05-04:00","lastSaleTimestamp":"2026-10-21T11:00:01-04:00"},' +
      '{"ticker":"MSFT","tngoLast":null,"last":400.5,"timestamp":"2026-10-21T11:00:05-04:00"},' +
      '{"ticker":"ZZZZ","tngoLast":1,"timestamp":"2026-10-21T11:00:05-04:00"}]';
    const { fetch, calls } = fakeFetch([[/api\.tiingo\.com\/iex\//, () => jsonResponse(body)]]);
    const quotes = await createTiingo({ fetch, sleep: noSleep }, 'K').fetchLatest(['AAPL', 'MSFT']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('tickers=aapl,msft');
    expect(quotes).toEqual([
      {
        symbol: 'AAPL',
        price: '210.15',
        currency: null,
        tradingDay: '2026-10-21',
        quotedAt: '2026-10-21T11:00:01-04:00',
      },
      {
        symbol: 'MSFT',
        price: '400.5',
        currency: null,
        tradingDay: '2026-10-21',
        quotedAt: '2026-10-21T11:00:05-04:00',
      },
    ]);
  });

  it('Coinbase ticker: price and UTC day, quoted in the product currency', async () => {
    const { fetch } = fakeFetch([
      [
        /products\/BTC-EUR\/ticker/,
        () => jsonResponse('{"price":"61234.56","time":"2026-10-21T23:59:00.123Z"}'),
      ],
    ]);
    expect(await createCoinbase({ fetch, sleep: noSleep }).fetchLatest(['BTC-EUR'])).toEqual([
      {
        symbol: 'BTC-EUR',
        price: '61234.56',
        currency: 'EUR',
        tradingDay: '2026-10-21',
        quotedAt: '2026-10-21T23:59:00.123Z',
      },
    ]);
  });

  it('Alpha Vantage GLOBAL_QUOTE: price and latest trading day; an empty quote is skipped', async () => {
    const { fetch } = fakeFetch([
      [
        /GLOBAL_QUOTE&symbol=SXR8\.DEX/,
        () =>
          jsonResponse({
            'Global Quote': { '05. price': '571.2000', '07. latest trading day': '2026-10-21' },
          }),
      ],
      [/GLOBAL_QUOTE&symbol=IS3R\.DEX/, () => jsonResponse({ 'Global Quote': {} })],
    ]);
    const av = createAlphaVantage({ fetch, sleep: noSleep }, 'K', () => '2026-10-21');
    expect(await av.fetchLatest(['SXR8.DEX', 'IS3R.DEX'])).toEqual([
      {
        symbol: 'SXR8.DEX',
        price: '571.2000',
        currency: null,
        tradingDay: '2026-10-21',
        quotedAt: '2026-10-21T15:30:00Z',
      },
    ]);
  });
});
