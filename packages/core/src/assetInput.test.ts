import { describe, expect, it } from 'vitest';
import {
  isinProblem,
  isValidIsin,
  listingCurrencyFor,
  validateNewAsset,
  type AssetForm,
} from './assetInput';

const form = (over: Partial<AssetForm> = {}): AssetForm => ({
  name: 'Apple Inc.',
  assetType: 'stock',
  ticker: 'AAPL',
  isin: 'US0378331005',
  exchange: 'XNAS',
  currency: 'USD',
  ...over,
});
const existing = [
  { id: 'vwce', ticker: 'VWCE', isin: 'IE00BK5BQT80', exchange: 'XETR' },
  { id: 'btc', ticker: 'BTCEUR', isin: null, exchange: null },
];
const codes = (over: Partial<AssetForm>) =>
  validateNewAsset(form(over), existing).issues.map((i) => `${i.field}:${i.code}`);

describe('ISIN check digit', () => {
  it('accepts real ISINs and refuses a wrong check digit or shape', () => {
    for (const isin of [
      'US0378331005',
      'IE00BK5BQT80',
      'US5949181045',
      'DE0005140008',
      'IE00B4L5Y983',
    ]) {
      expect(isValidIsin(isin), isin).toBe(true);
    }
    expect(isinProblem('US0378331006')).toBe('check_digit');
    expect(isinProblem('IE00BK5BQT81')).toBe('check_digit');
    expect(isinProblem('US037833100')).toBe('invalid'); // 11 characters
    expect(isinProblem('us0378331005')).toBe('invalid'); // the database wants upper case
    expect(isinProblem('1S0378331005')).toBe('invalid');
  });
});

describe('validateNewAsset', () => {
  it('a US stock, a Xetra ETF and a crypto pair', () => {
    expect(validateNewAsset(form(), existing)).toEqual({
      ok: true,
      issues: [],
      asset: {
        name: 'Apple Inc.',
        assetType: 'stock',
        ticker: 'AAPL',
        isin: 'US0378331005',
        exchange: 'XNAS',
        tradingCurrency: 'USD',
      },
    });
    const etf = { name: 'iShares Core S&P 500', assetType: 'etf' as const, ticker: 'SXR8' };
    expect(codes({ ...etf, isin: 'IE00B5BMR087', exchange: 'XETR', currency: 'EUR' })).toEqual([]);
    expect(
      codes({
        name: 'Ether',
        assetType: 'crypto',
        ticker: 'ETHEUR',
        isin: '',
        exchange: null,
        currency: 'EUR',
      }),
    ).toEqual([]);
  });

  it('trims and upper-cases ticker, ISIN and currency', () => {
    const r = validateNewAsset(
      form({ ticker: ' aapl ', isin: ' us0378331005', currency: 'usd' }),
      existing,
    );
    expect(r.asset).toMatchObject({ ticker: 'AAPL', isin: 'US0378331005', tradingCurrency: 'USD' });
  });

  it('the listing currency must be the exchange’s (#26)', () => {
    expect(codes({ currency: 'EUR' })).toEqual(['currency:mismatch']);
    expect(validateNewAsset(form({ currency: 'EUR' }), existing).issues[0]).toMatchObject({
      expected: 'USD',
    });
    expect(codes({ exchange: 'XETR', currency: 'USD' })).toEqual(['currency:mismatch']);
    expect(listingCurrencyFor('etf', 'XETR', 'SXR8')).toBe('EUR');
    expect(listingCurrencyFor('stock', 'XNYS', 'KO')).toBe('USD');
    expect(listingCurrencyFor('crypto', null, 'btcusd')).toBe('USD');
    expect(listingCurrencyFor('crypto', null, 'BTC')).toBeNull();
  });

  it('stocks and ETFs need a valid ISIN and a supported exchange', () => {
    expect(codes({ isin: '' })).toEqual(['isin:required']);
    expect(codes({ isin: 'US0378331006' })).toEqual(['isin:check_digit']);
    expect(codes({ isin: 'US03783310' })).toEqual(['isin:invalid']);
    expect(codes({ exchange: null })).toEqual(['exchange:required']);
    expect(codes({ exchange: 'XLON', currency: 'GBP' })).toEqual(['exchange:unsupported']);
  });

  it('crypto: no exchange, a ticker like BTCEUR, its quote currency', () => {
    const crypto = { name: 'Solana', assetType: 'crypto' as const, isin: '', exchange: null };
    expect(codes({ ...crypto, ticker: 'SOLEUR', currency: 'EUR' })).toEqual([]);
    expect(codes({ ...crypto, ticker: 'SOL', currency: 'EUR' })).toEqual(['ticker:invalid']);
    expect(codes({ ...crypto, ticker: 'SOLEUR', currency: 'USD' })).toEqual(['currency:mismatch']);
    expect(codes({ ...crypto, ticker: 'SOLEUR', exchange: 'XNAS', currency: 'EUR' })).toEqual([
      'exchange:not_allowed',
    ]);
  });

  it('name and ticker are required; tickers are plain', () => {
    expect(codes({ name: '  ' })).toEqual(['name:required']);
    expect(codes({ ticker: '' })).toEqual(['ticker:required']);
    expect(codes({ ticker: 'AA PL' })).toEqual(['ticker:invalid']);
    expect(codes({ ticker: 'BRK.B' })).toEqual([]);
  });

  it('refuses an ISIN, or a ticker on the same exchange, that an asset already has', () => {
    expect(
      codes({
        name: 'VWCE',
        assetType: 'etf',
        ticker: 'VWCE2',
        isin: 'IE00BK5BQT80',
        exchange: 'XETR',
        currency: 'EUR',
      }),
    ).toEqual(['isin:duplicate']);
    expect(
      codes({
        name: 'x',
        assetType: 'etf',
        ticker: 'vwce',
        isin: 'IE00B5BMR087',
        exchange: 'XETR',
        currency: 'EUR',
      }),
    ).toEqual(['ticker:duplicate']);
    // same ticker, another exchange: a different listing
    expect(codes({ ticker: 'VWCE', isin: 'IE00B5BMR087', exchange: 'XNAS' })).toEqual([]);
    expect(
      codes({
        name: 'Bitcoin',
        assetType: 'crypto',
        ticker: 'BTCEUR',
        isin: '',
        exchange: null,
        currency: 'EUR',
      }),
    ).toEqual(['ticker:duplicate']);
  });

  it('refuses certificados (subscriptions are not added in the app)', () => {
    expect(codes({ assetType: 'certificado_aforro' as AssetForm['assetType'] })).toEqual([
      'assetType:unsupported',
    ]);
  });
});
