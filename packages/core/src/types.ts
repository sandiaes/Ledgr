import type { IsoDate } from './dates';
import type { Decimal } from './decimal';

/** Mirrors public.asset_type. */
export type AssetType = 'stock' | 'etf' | 'crypto' | 'certificado_aforro';

/** Mirrors public.transaction_type. */
export type TransactionType =
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'fee'
  | 'deposit'
  | 'withdrawal'
  | 'interest'
  | 'subscription'
  | 'redemption';

export interface Asset {
  id: string;
  assetType: AssetType;
  tradingCurrency: string;
}

/**
 * One ledger row (public.transactions, soft-deleted rows already filtered out).
 * All amounts are in `currency`; `fxRateToEur` is EUR per 1 unit of `currency` on the
 * trade date (1 for EUR).
 *
 *   buy, sell, subscription, redemption : assetId, quantity > 0, unitPrice >= 0, amount null
 *   dividend, interest, deposit, withdrawal, fee : amount > 0, quantity/unitPrice null
 *   fees >= 0, always charged on top (added to cost, deducted from proceeds/income).
 *   dividend, interest: `amount` is gross; optional `withholdingTax` (0..amount) was
 *   withheld at source, so the cash received is amount - withholdingTax - fees.
 */
export interface Transaction {
  id: string;
  accountId: string;
  assetId: string | null;
  type: TransactionType;
  tradeDate: IsoDate;
  quantity: Decimal | null;
  unitPrice: Decimal | null;
  amount: Decimal | null;
  fees: Decimal;
  currency: string;
  fxRateToEur: Decimal;
  /** Redemptions only: the certificado subscription being redeemed (else FIFO). */
  caSubscriptionId?: string | null;
  /** Dividends and interest only: tax withheld at source, in `currency`. Recorded, never computed. */
  withholdingTax?: Decimal | null;
}

/** A close price in `currency` (which may differ from the asset's trading currency). */
export interface PriceQuote {
  date: IsoDate;
  close: Decimal;
  currency: string;
}

/** Latest price on or before `date`, or null when none is known. */
export type PriceLookup = (assetId: string, date: IsoDate) => PriceQuote | null;

/** EUR per 1 unit of `currency`, latest on or before `date`; null when unknown. */
export type FxLookup = (currency: string, date: IsoDate) => Decimal | null;
