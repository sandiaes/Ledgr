import type { IsoDate } from '@ledgr/core';

/** One daily close as a provider reports it. Decimals are strings, never floats. */
export interface DailyBar {
  date: IsoDate;
  /** Raw (unadjusted) close. */
  close: string;
  /** Currency the provider states for this close; null when it does not state one. */
  currency: string | null;
  /** New shares per old share for a split effective on `date`; null on other days. */
  splitFactor: string | null;
}

/** What a provider confirms about a symbol, for symbol resolution. */
export interface SymbolCheck {
  found: boolean;
  /** Exchange name or code as the provider reports it (informational). */
  exchange: string | null;
  /** Quote currency as the provider reports it; null when it does not say. */
  currency: string | null;
}

/** The latest (intraday) price of a symbol. */
export interface LiveQuote {
  symbol: string;
  price: string;
  /** Currency the provider states; null when it does not state one. */
  currency: string | null;
  /** The trading day the quote belongs to, in the exchange's own calendar. */
  tradingDay: IsoDate;
  /** The provider's quote or trade time (ISO 8601). */
  quotedAt: string;
}

/**
 * A daily price source. Swappable: assets.price_source names the provider id and
 * assets.price_source_id the symbol it knows the asset by.
 */
export interface PriceProvider {
  readonly id: string;
  /** Minimum milliseconds between two calls (the provider's rate limit). */
  readonly minIntervalMs: number;
  /** Daily closes with from <= date <= to, ascending. Empty when there are none. */
  fetchDaily(symbol: string, from: IsoDate, to: IsoDate): Promise<DailyBar[]>;
  /** Confirms a symbol exists, for symbol resolution. */
  checkSymbol(symbol: string): Promise<SymbolCheck>;
  /** How long a live quote stays fresh before value-now asks again. */
  readonly liveTtlMs: number;
  /** Latest quotes; symbols the provider has no quote for are left out. */
  fetchLatest(symbols: readonly string[]): Promise<LiveQuote[]>;
}
