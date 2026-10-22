import { describe, expect, it } from 'vitest';
import type { AssetRecord } from './db';
import { createProviders } from './providers';
import { candidateFor, decide, resolveSymbols } from './symbols';
import { fakeFetch, jsonResponse, noSleep } from './test/memory-db';

const asset = (over: Partial<AssetRecord>): AssetRecord => ({
  id: over.ticker ?? 'x',
  name: 'n',
  ticker: 'AAPL',
  isin: 'US0378331005',
  exchange: 'XNAS',
  assetType: 'stock',
  tradingCurrency: 'USD',
  priceSource: 'manual',
  priceSourceId: null,
  ...over,
});

describe('symbol mapping rules', () => {
  it('maps US MICs to Tiingo, Xetra to Alpha Vantage .DEX, BTCEUR to Coinbase', () => {
    const us = candidateFor(asset({ ticker: 'BRK.B', exchange: 'XNYS' }));
    expect(us).toMatchObject({
      kind: 'listing',
      source: 'tiingo',
      symbol: 'BRK-B',
      listingCurrency: 'USD',
    });
    const xetra = candidateFor(
      asset({ ticker: 'VWCE', isin: 'IE00BK5BQT80', exchange: 'XETR', assetType: 'etf' }),
    );
    expect(xetra).toMatchObject({
      kind: 'listing',
      source: 'alphavantage',
      symbol: 'VWCE.DEX',
      listingCurrency: 'EUR',
    });
    const btc = candidateFor(
      asset({ ticker: 'BTCEUR', isin: null, exchange: null, assetType: 'crypto' }),
    );
    expect(btc).toMatchObject({
      kind: 'listing',
      source: 'coinbase',
      symbol: 'BTC-EUR',
      listingCurrency: 'EUR',
      figi: null,
    });
  });

  it('skips certificados and reports what is missing instead of guessing', () => {
    const reason = (a: AssetRecord) => {
      const c = candidateFor(a);
      return c.kind === 'done' ? `${c.resolution.status}: ${c.resolution.reason}` : 'listing';
    };
    expect(reason(asset({ ticker: 'E', assetType: 'certificado_aforro' }))).toMatch(/^skipped/);
    expect(reason(asset({ isin: null }))).toBe('unresolved: ISIN missing in the asset mapping');
    expect(reason(asset({ exchange: null }))).toBe(
      'unresolved: exchange (MIC) missing in the asset mapping',
    );
    expect(reason(asset({ exchange: 'XLON' }))).toBe(
      'unresolved: no price provider for exchange XLON',
    );
    expect(
      reason(asset({ ticker: 'BTC', assetType: 'crypto', isin: null, exchange: null })),
    ).toMatch(/^unresolved: no rule for crypto ticker/);
  });

  it('decides from OpenFIGI and the provider check, never past a mismatch', () => {
    const c = candidateFor(asset({ tradingCurrency: 'EUR' }));
    if (c.kind !== 'listing') throw new Error('expected a listing');
    const found = { found: true, exchange: 'NASDAQ', currency: null };
    expect(decide(c, { tickers: [], names: [] }, found).reason).toMatch(
      /OpenFIGI lists no security/,
    );
    expect(decide(c, { tickers: ['AAPL', 'APC'], names: [] }, found).reason).toMatch(
      /several tickers/,
    );
    expect(decide(c, { tickers: ['APC'], names: [] }, found)).toMatchObject({
      status: 'unresolved',
      reason: 'OpenFIGI ticker is APC, the mapping says AAPL',
    });
    expect(decide(c, { tickers: ['AAPL'], names: [] }, 'no_provider').reason).toBe(
      'no API key configured for tiingo',
    );
    expect(decide(c, { tickers: ['AAPL'], names: [] }, { ...found, found: false }).status).toBe(
      'unresolved',
    );
    expect(
      decide(c, { tickers: ['AAPL'], names: [] }, { ...found, currency: 'EUR' }).reason,
    ).toMatch(/quotes AAPL in EUR, expected USD/);
    const ok = decide(c, { tickers: ['AAPL'], names: [] }, found);
    expect(ok).toMatchObject({
      status: 'resolved',
      source: 'tiingo',
      symbol: 'AAPL',
      providerExchange: 'NASDAQ',
    });
    expect(ok.warnings[0]).toMatch(/trading_currency is EUR, the listing currency is USD/);
  });
});

describe('resolveSymbols', () => {
  it('resolves and reports each asset, with one OpenFIGI batch', async () => {
    const assets = [
      asset({ id: 'aapl', ticker: 'AAPL' }),
      asset({ id: 'wmt', ticker: 'WMT', isin: 'US9311421039', exchange: 'XNYS' }),
      asset({
        id: 'sxr8',
        ticker: 'SXR8',
        isin: 'IE00B5BMR087',
        exchange: 'XETR',
        assetType: 'etf',
        tradingCurrency: 'EUR',
      }),
      asset({
        id: 'btc',
        ticker: 'BTCEUR',
        isin: null,
        exchange: null,
        assetType: 'crypto',
        tradingCurrency: 'EUR',
      }),
      asset({ id: 'e', ticker: 'E', assetType: 'certificado_aforro', priceSource: 'ca_factors' }),
      asset({
        id: 'msft',
        ticker: 'MSFT',
        isin: 'US5949181045',
        priceSource: 'tiingo',
        priceSourceId: 'MSFT',
      }),
    ];
    const { fetch, calls } = fakeFetch([
      [
        /openfigi/,
        (_u, init) => {
          const jobs = JSON.parse(String(init?.body)) as Record<string, string>[];
          // US listings by the US composite code (Nasdaq is filed under segment MICs)
          expect(jobs.map((j) => j.exchCode ?? `mic:${j.micCode}`)).toEqual([
            'US',
            'US',
            'mic:XETR',
            'US',
          ]);
          expect(jobs.every((j) => j.idType === 'ID_ISIN')).toBe(true);
          return jsonResponse([
            { data: [{ ticker: 'AAPL' }] },
            { warning: 'No identifier found.' }, // an ISIN OpenFIGI does not know
            { data: [{ ticker: 'SXR8' }] },
            { data: [{ ticker: 'MSFT' }] },
          ]);
        },
      ],
      [/tiingo\/daily\/aapl$/, () => jsonResponse({ ticker: 'aapl', exchangeCode: 'NASDAQ' })],
      [/tiingo\/daily\/msft$/, () => jsonResponse({ ticker: 'msft', exchangeCode: 'NASDAQ' })],
      [
        /SYMBOL_SEARCH/,
        () =>
          jsonResponse({
            bestMatches: [{ '1. symbol': 'SXR8.DEX', '4. region': 'XETRA', '8. currency': 'EUR' }],
          }),
      ],
      [
        /coinbase\.com\/products\/BTC-EUR$/,
        () => jsonResponse({ id: 'BTC-EUR', quote_currency: 'EUR' }),
      ],
    ]);
    const http = { fetch, sleep: noSleep };
    const providers = createProviders(http, { tiingo: 't', alphavantage: 'a' }, () => '2026-10-22');
    const out = await resolveSymbols(assets, { http, providers });
    expect(out.map((r) => [r.assetId, r.status, r.source && `${r.source}:${r.symbol}`])).toEqual([
      ['aapl', 'resolved', 'tiingo:AAPL'],
      ['wmt', 'unresolved', null],
      ['sxr8', 'resolved', 'alphavantage:SXR8.DEX'],
      ['btc', 'resolved', 'coinbase:BTC-EUR'],
      ['e', 'skipped', null],
      ['msft', 'unchanged', 'tiingo:MSFT'],
    ]);
    expect(out[1]?.reason).toMatch(/no security for ISIN US9311421039 on a US exchange/);
    expect(calls.filter((c) => c.url.includes('openfigi'))).toHaveLength(1);
  });

  it('marks every listing unresolved when OpenFIGI fails', async () => {
    const { fetch } = fakeFetch([[/openfigi/, () => jsonResponse({}, 500)]]);
    const http = { fetch, sleep: noSleep };
    const out = await resolveSymbols([asset({})], {
      http,
      providers: createProviders(http, { tiingo: 't' }, () => '2026-10-22'),
    });
    expect(out[0]).toMatchObject({
      status: 'unresolved',
      reason: 'OpenFIGI failed (openfigi: HTTP 500)',
    });
  });
});
