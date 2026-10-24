// The app's "Add asset" form: the few facts symbol resolution needs (docs/app-plan.md §1),
// checked before anything is written. Pure.
import { listingCurrencyForMic } from './prices';

/** The exchanges a price provider is wired for (packages/market symbols.ts); crypto has none. */
export const ASSET_EXCHANGES = ['XNAS', 'XNYS', 'XASE', 'XETR'] as const;
export type AssetExchange = (typeof ASSET_EXCHANGES)[number];

/** Certificados are subscriptions, not added here (decision D7). */
export const FORM_ASSET_TYPES = ['stock', 'etf', 'crypto'] as const;
export type FormAssetType = (typeof FORM_ASSET_TYPES)[number];

export interface AssetForm {
  name: string;
  assetType: FormAssetType;
  ticker: string;
  /** '' when none (crypto). */
  isin: string;
  /** null for crypto. */
  exchange: string | null;
  /** Listing currency (prefilled by listingCurrencyFor). */
  currency: string;
}

export type AssetField = 'name' | 'assetType' | 'ticker' | 'isin' | 'exchange' | 'currency';

export type AssetIssue =
  | { field: 'name' | 'ticker'; code: 'required' }
  | { field: 'assetType'; code: 'unsupported' }
  /** Stock/ETF: letters, digits, '.' or '-', up to 12. Crypto: e.g. BTCEUR. */
  | { field: 'ticker'; code: 'invalid' }
  | { field: 'ticker'; code: 'duplicate'; assetId: string }
  | { field: 'isin'; code: 'required' | 'invalid' | 'check_digit' }
  | { field: 'isin'; code: 'duplicate'; assetId: string }
  | { field: 'exchange'; code: 'required' | 'unsupported' | 'not_allowed' }
  /** The listing currency must be the exchange's (crypto: the ticker's quote currency). */
  | { field: 'currency'; code: 'mismatch'; expected: string };

export interface NewAsset {
  name: string;
  assetType: FormAssetType;
  ticker: string;
  isin: string | null;
  exchange: AssetExchange | null;
  tradingCurrency: string;
}

export type AssetCheck =
  { ok: true; asset: NewAsset; issues: [] } | { ok: false; asset: null; issues: AssetIssue[] };

const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const LISTED_TICKER = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;
/** Same rule as the resolver: BTCEUR is Coinbase BTC-EUR, quoted in EUR. */
const CRYPTO_TICKER = /^([A-Z0-9]{2,10})(EUR|USD)$/;

/**
 * ISO 6166: the shape the database checks, and the check digit (letters A-Z become 10-35,
 * then the Luhn algorithm over the digits, the check digit included).
 */
export function isinProblem(isin: string): 'invalid' | 'check_digit' | null {
  if (!ISIN_SHAPE.test(isin)) return 'invalid';
  const digits = [...isin].map((c) => (c >= 'A' ? String(c.charCodeAt(0) - 55) : c)).join('');
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return sum % 10 === 0 ? null : 'check_digit';
}

export const isValidIsin = (isin: string) => isinProblem(isin) === null;

/** The listing currency to prefill: the exchange's, or a crypto ticker's quote currency. */
export function listingCurrencyFor(
  assetType: FormAssetType,
  exchange: string | null,
  ticker: string,
): string | null {
  if (assetType === 'crypto') return CRYPTO_TICKER.exec(ticker.trim().toUpperCase())?.[2] ?? null;
  return exchange ? listingCurrencyForMic(exchange) : null;
}

/**
 * Checks the form and returns the asset to insert (saved with price_source 'manual': it is
 * "price pending" until prices-daily resolves its symbol). Ticker and ISIN are upper-cased
 * and trimmed. Stocks and ETFs need an ISIN with a valid check digit and one of the
 * supported exchanges, whose currency the listing currency must match (#26); crypto has no
 * exchange and a ticker like BTCEUR. An ISIN, or a ticker on the same exchange, that an
 * existing asset already has is refused.
 */
export function validateNewAsset(
  form: AssetForm,
  existing: readonly {
    id: string;
    ticker: string | null;
    isin: string | null;
    exchange: string | null;
  }[],
): AssetCheck {
  const issues: AssetIssue[] = [];
  const name = form.name.trim();
  const ticker = form.ticker.trim().toUpperCase();
  const isin = form.isin.trim().toUpperCase();
  const exchange = form.exchange?.trim() || null;
  const currency = form.currency.trim().toUpperCase();
  const crypto = form.assetType === 'crypto';

  if (!(FORM_ASSET_TYPES as readonly string[]).includes(form.assetType)) {
    issues.push({ field: 'assetType', code: 'unsupported' });
    return { ok: false, asset: null, issues };
  }
  if (name === '') issues.push({ field: 'name', code: 'required' });

  if (ticker === '') issues.push({ field: 'ticker', code: 'required' });
  else if (!(crypto ? CRYPTO_TICKER : LISTED_TICKER).test(ticker)) {
    issues.push({ field: 'ticker', code: 'invalid' });
  }

  if (isin === '') {
    if (!crypto) issues.push({ field: 'isin', code: 'required' });
  } else {
    const problem = isinProblem(isin);
    if (problem) issues.push({ field: 'isin', code: problem });
  }

  if (crypto) {
    if (exchange !== null) issues.push({ field: 'exchange', code: 'not_allowed' });
  } else if (exchange === null) issues.push({ field: 'exchange', code: 'required' });
  else if (!(ASSET_EXCHANGES as readonly string[]).includes(exchange)) {
    issues.push({ field: 'exchange', code: 'unsupported' });
  }

  const expected = listingCurrencyFor(form.assetType, exchange, ticker);
  if (expected && currency !== expected) {
    issues.push({ field: 'currency', code: 'mismatch', expected });
  }

  const sameIsin = isin && existing.find((a) => a.isin?.toUpperCase() === isin);
  if (sameIsin) issues.push({ field: 'isin', code: 'duplicate', assetId: sameIsin.id });
  const sameListing =
    ticker &&
    existing.find(
      (a) => a.ticker?.trim().toUpperCase() === ticker && (a.exchange ?? null) === exchange,
    );
  if (sameListing) issues.push({ field: 'ticker', code: 'duplicate', assetId: sameListing.id });

  if (issues.length > 0) return { ok: false, asset: null, issues };
  return {
    ok: true,
    asset: {
      name,
      assetType: form.assetType,
      ticker,
      isin: isin === '' ? null : isin,
      exchange: exchange as AssetExchange | null,
      tradingCurrency: currency,
    },
    issues: [],
  };
}
