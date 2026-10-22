// The asset mapping file: one row per ticker. Every cell except type_override must be
// filled; '-' means "none, on purpose". Nothing in it is ever guessed by the importer.
import { listingCurrencyForMic, type AssetType } from '@ledgr/core';
import { ASSET_TYPES, LISTING_CURRENCIES } from './config';
import type { MappingRecord } from './inputs';

export interface AssetMapping {
  ticker: string;
  /** Types as written in asset_type ('etf|stock' when the data shows both). */
  listedTypes: AssetType[];
  /** The type every row of this ticker is imported as: type_override, else asset_type. */
  assetType: AssetType | null;
  override: AssetType | null;
  name: string;
  isin: string | null;
  exchange: string | null;
  /** Listing currency (what the price provider quotes); orders are still EUR at fx 1. */
  currency: string;
  priceSource: string;
  priceSourceId: string | null;
  /** Why this row cannot be used yet; empty when complete. */
  problems: string[];
  line: number;
}

const NONE = '-';

export function isValidIsin(isin: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
  // Letters -> 10..35, then the Luhn check over the resulting digits.
  const digits = isin.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function asType(v: string): AssetType | null {
  return (ASSET_TYPES as readonly string[]).includes(v) ? (v as AssetType) : null;
}

export function buildMapping(records: readonly MappingRecord[]): Map<string, AssetMapping> {
  const result = new Map<string, AssetMapping>();
  const isins = new Map<string, string>();
  for (const r of records) {
    const problems: string[] = [];
    const blank = (v: string, col: string) => {
      if (v === '') problems.push(`${col} is blank (use - for none)`);
      return v === '' || v === NONE;
    };
    if (r.ticker === '') {
      problems.push('ticker is blank');
    } else if (result.has(r.ticker)) {
      result.get(r.ticker)!.problems.push(`ticker is listed again on line ${r.line}`);
      continue;
    }

    const listed = r.assetType
      .split('|')
      .map((t) => t.trim())
      .filter((t) => t !== '');
    const listedTypes = listed.map(asType).filter((t): t is AssetType => t !== null);
    if (r.assetType === '') problems.push('asset_type is blank');
    else if (listedTypes.length !== listed.length)
      problems.push(`asset_type "${r.assetType}" is not one of ${ASSET_TYPES.join(', ')}`);

    let override: AssetType | null = null;
    if (r.typeOverride !== '') {
      override = asType(r.typeOverride);
      if (!override)
        problems.push(`type_override "${r.typeOverride}" is not one of ${ASSET_TYPES.join(', ')}`);
    } else if (listedTypes.length > 1) {
      problems.push(
        `asset_type lists ${listedTypes.join(' and ')}: set type_override to the right one`,
      );
    }
    const assetType = override ?? (listedTypes.length === 1 ? (listedTypes[0] as AssetType) : null);

    if (r.name === '' || r.name === NONE) problems.push('name is blank');

    let isin: string | null = null;
    if (!blank(r.isin, 'isin')) {
      if (!isValidIsin(r.isin)) problems.push('isin is not a valid ISIN (format or check digit)');
      else if (isins.has(r.isin)) problems.push(`isin is also used by ${isins.get(r.isin)}`);
      else {
        isin = r.isin;
        isins.set(r.isin, r.ticker);
      }
    }
    const exchange = blank(r.exchange, 'exchange') ? null : r.exchange;

    // The listing currency, which follows from the exchange. Orders stay EUR at fx 1.
    if (r.currency === '') problems.push('currency is blank');
    else if (!(LISTING_CURRENCIES as readonly string[]).includes(r.currency)) {
      problems.push(
        `currency ${r.currency} is not supported: use the listing currency, ${LISTING_CURRENCIES.join(' or ')}`,
      );
    } else {
      // No exchange (crypto quoted in EUR, certificados): EUR.
      const expected = exchange ? listingCurrencyForMic(exchange) : 'EUR';
      if (expected && r.currency !== expected) {
        problems.push(
          `currency ${r.currency} does not match exchange ${exchange ?? '-'}: listings there quote in ${expected}`,
        );
      }
    }

    let priceSource = assetType === 'certificado_aforro' ? 'ca_factors' : 'manual';
    let priceSourceId: string | null = null;
    if (!blank(r.priceSymbol, 'price_symbol')) {
      const m = /^([a-z0-9_]+):(\S+)$/.exec(r.priceSymbol);
      if (!m) problems.push('price_symbol must be provider:symbol (e.g. yahoo:VWCE.DE) or -');
      else {
        priceSource = m[1] as string;
        priceSourceId = m[2] as string;
      }
    }

    result.set(r.ticker, {
      ticker: r.ticker,
      listedTypes,
      assetType,
      override,
      name: r.name,
      isin,
      exchange,
      currency: r.currency,
      priceSource,
      priceSourceId,
      problems,
      line: r.line,
    });
  }
  return result;
}
