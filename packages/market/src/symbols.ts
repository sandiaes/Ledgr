// Symbol resolution: (ISIN, exchange MIC, ticker) -> provider symbol for assets.price_source
// and price_source_id. Nothing is guessed: OpenFIGI must list exactly the mapping's ticker
// for the ISIN on that MIC, and the provider must confirm the symbol. Anything else is
// reported as unresolved, with the reason.
import { listingCurrencyForMic } from '@ledgr/core';
import type { AssetRecord } from './db';
import type { HttpOptions } from './http';
import { mapIsins, type FigiResult } from './openfigi';
import type { ProviderRegistry, SymbolCheck } from './providers';

export interface SymbolResolution {
  assetId: string;
  ticker: string | null;
  status: 'resolved' | 'unchanged' | 'unresolved' | 'skipped';
  /** Proposed price_source / price_source_id (null unless resolved or unchanged). */
  source: string | null;
  symbol: string | null;
  listingCurrency: string | null;
  /** What the provider reported about the symbol (informational). */
  providerExchange: string | null;
  reason: string;
  warnings: string[];
}

/** How a listing is priced: which provider, and its symbol for a ticker. */
interface ListingRule {
  provider: string;
  symbol: (ticker: string) => string;
}

const RULES_BY_MIC: Readonly<Record<string, ListingRule>> = {
  // Tiingo writes share classes with a dash (BRK.B -> BRK-B).
  XNAS: { provider: 'tiingo', symbol: (t) => t.replace('.', '-') },
  XNYS: { provider: 'tiingo', symbol: (t) => t.replace('.', '-') },
  XASE: { provider: 'tiingo', symbol: (t) => t.replace('.', '-') },
  XETR: { provider: 'alphavantage', symbol: (t) => `${t}.DEX` },
};

/** Crypto tickers like BTCEUR: Coinbase product BTC-EUR, quoted in EUR. */
const CRYPTO_TICKER = /^([A-Z0-9]{2,10})(EUR|USD)$/;

type Candidate =
  | { kind: 'done'; resolution: SymbolResolution }
  | {
      kind: 'listing';
      asset: AssetRecord;
      source: string;
      symbol: string;
      listingCurrency: string;
      figi: { isin: string; mic: string } | null;
    };

function base(asset: AssetRecord): Omit<SymbolResolution, 'status' | 'reason'> {
  return {
    assetId: asset.id,
    ticker: asset.ticker,
    source: null,
    symbol: null,
    listingCurrency: null,
    providerExchange: null,
    warnings: [],
  };
}

function unresolvedResolution(asset: AssetRecord, reason: string): SymbolResolution {
  return { ...base(asset), status: 'unresolved', reason };
}

function unresolved(asset: AssetRecord, reason: string): Candidate {
  return { kind: 'done', resolution: unresolvedResolution(asset, reason) };
}

/** The rule-based part: which provider and symbol to check, before any network call. */
export function candidateFor(asset: AssetRecord): Candidate {
  if (asset.assetType === 'certificado_aforro') {
    return {
      kind: 'done',
      resolution: {
        ...base(asset),
        status: 'skipped',
        reason: 'valued by ca_factors, no market price',
      },
    };
  }
  const ticker = asset.ticker?.trim().toUpperCase() ?? '';
  if (ticker === '') return unresolved(asset, 'no ticker');

  if (asset.assetType === 'crypto') {
    const m = CRYPTO_TICKER.exec(ticker);
    if (!m) return unresolved(asset, `no rule for crypto ticker ${ticker} (expected e.g. BTCEUR)`);
    return {
      kind: 'listing',
      asset,
      source: 'coinbase',
      symbol: `${m[1]}-${m[2]}`,
      listingCurrency: m[2] as string,
      figi: null,
    };
  }

  if (!asset.isin) return unresolved(asset, 'ISIN missing in the asset mapping');
  if (!asset.exchange) return unresolved(asset, 'exchange (MIC) missing in the asset mapping');
  const rule = RULES_BY_MIC[asset.exchange];
  const listingCurrency = listingCurrencyForMic(asset.exchange);
  if (!rule || !listingCurrency) {
    return unresolved(asset, `no price provider for exchange ${asset.exchange}`);
  }
  return {
    kind: 'listing',
    asset,
    source: rule.provider,
    symbol: rule.symbol(ticker),
    listingCurrency,
    figi: { isin: asset.isin, mic: asset.exchange },
  };
}

/** The decision, from the facts gathered for one listing candidate. Pure. */
export function decide(
  c: Extract<Candidate, { kind: 'listing' }>,
  figi: FigiResult | null,
  check: SymbolCheck | 'no_provider',
): SymbolResolution {
  const { asset } = c;
  const ticker = asset.ticker?.trim().toUpperCase() ?? '';
  const out = { ...base(asset), listingCurrency: c.listingCurrency };
  const fail = (reason: string): SymbolResolution => ({ ...out, status: 'unresolved', reason });

  if (c.figi) {
    if (!figi || figi.tickers.length === 0) {
      return fail(
        `OpenFIGI lists no security for ISIN ${c.figi.isin} on ${c.figi.mic}: check the ISIN and exchange`,
      );
    }
    if (figi.tickers.length > 1) {
      return fail(
        `OpenFIGI lists several tickers for the ISIN on ${c.figi.mic}: ${figi.tickers.join(', ')}`,
      );
    }
    if (figi.tickers[0] !== ticker) {
      return fail(`OpenFIGI ticker is ${figi.tickers[0] as string}, the mapping says ${ticker}`);
    }
  }
  if (check === 'no_provider') return fail(`no API key configured for ${c.source}`);
  if (!check.found) return fail(`${c.source} does not know ${c.symbol}`);
  if (check.currency && check.currency !== c.listingCurrency) {
    return fail(
      `${c.source} quotes ${c.symbol} in ${check.currency}, expected ${c.listingCurrency}`,
    );
  }

  const warnings: string[] = [];
  if (asset.tradingCurrency !== c.listingCurrency) {
    warnings.push(
      `assets.trading_currency is ${asset.tradingCurrency}, the listing currency is ${c.listingCurrency}: apply migration 20261022000001_listing_currency.sql`,
    );
  }
  const same = asset.priceSource === c.source && asset.priceSourceId === c.symbol;
  if (!same && asset.priceSource !== 'manual' && asset.priceSourceId) {
    warnings.push(`replaces ${asset.priceSource}:${asset.priceSourceId}`);
  }
  return {
    ...out,
    status: same ? 'unchanged' : 'resolved',
    source: c.source,
    symbol: c.symbol,
    providerExchange: check.exchange,
    reason: c.figi
      ? `OpenFIGI and ${c.source} confirm ${c.symbol}`
      : `${c.source} confirms ${c.symbol}`,
    warnings,
  };
}

export interface ResolveDeps {
  http: HttpOptions;
  providers: ProviderRegistry;
  openFigiKey?: string;
}

/** Resolves every asset. Provider errors make that asset unresolved, never guessed. */
export async function resolveSymbols(
  assets: readonly AssetRecord[],
  deps: ResolveDeps,
): Promise<SymbolResolution[]> {
  const candidates = assets.map(candidateFor);
  const listings = candidates.filter(
    (c): c is Extract<Candidate, { kind: 'listing' }> => c.kind === 'listing',
  );
  const figiQueries = listings
    .filter((c) => c.figi)
    .map((c) => c.figi as { isin: string; mic: string });

  let figiResults: FigiResult[] | null = null;
  let figiError: string | null = null;
  if (figiQueries.length > 0) {
    try {
      figiResults = await mapIsins(deps.http, figiQueries, deps.openFigiKey);
    } catch (e) {
      figiError = (e as Error).message;
    }
  }

  const out: SymbolResolution[] = [];
  let figiIndex = 0;
  const lastCall = new Map<string, number>();
  for (const c of candidates) {
    if (c.kind === 'done') {
      out.push(c.resolution);
      continue;
    }
    let figi: FigiResult | null = null;
    if (c.figi) {
      if (figiError || !figiResults) {
        out.push(unresolvedResolution(c.asset, `OpenFIGI failed (${figiError ?? 'no result'})`));
        figiIndex++;
        continue;
      }
      figi = figiResults[figiIndex++] ?? null;
      if (!figi || figi.tickers.length !== 1) {
        // decide() reports the OpenFIGI problem before looking at the provider.
        out.push(decide(c, figi, 'no_provider'));
        continue;
      }
    }
    const provider = deps.providers.get(c.source);
    if (!provider) {
      out.push(decide(c, figi, 'no_provider'));
      continue;
    }
    try {
      const wait = (lastCall.get(provider.id) ?? -Infinity) + provider.minIntervalMs - Date.now();
      if (wait > 0) await deps.http.sleep(wait);
      lastCall.set(provider.id, Date.now());
      out.push(decide(c, figi, await provider.checkSymbol(c.symbol)));
    } catch (e) {
      out.push({
        ...unresolvedResolution(c.asset, `${c.source} check failed (${(e as Error).message})`),
        listingCurrency: c.listingCurrency,
      });
    }
  }
  return out;
}
