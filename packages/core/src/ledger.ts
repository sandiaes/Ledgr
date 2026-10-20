import { assertIsoDate, type IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { LedgerError } from './errors';
import type { Transaction, TransactionType } from './types';

const TRADE_TYPES: ReadonlySet<TransactionType> = new Set([
  'buy',
  'sell',
  'subscription',
  'redemption',
]);

export function isTrade(type: TransactionType): boolean {
  return TRADE_TYPES.has(type);
}

export function isAcquisition(type: TransactionType): boolean {
  return type === 'buy' || type === 'subscription';
}

export function isDisposal(type: TransactionType): boolean {
  return type === 'sell' || type === 'redemption';
}

/** Throws LedgerError when a row breaks the same rules the DB check constraints enforce. */
export function validateTransaction(tx: Transaction): void {
  const fail = (msg: string): never => {
    throw new LedgerError(msg, tx.id);
  };
  try {
    assertIsoDate(tx.tradeDate);
  } catch {
    fail(`Invalid trade date ${tx.tradeDate}`);
  }
  if (tx.fees.isNegative()) fail('Fees must be >= 0');
  if (!tx.fxRateToEur.isPositive() || tx.fxRateToEur.isZero()) fail('fxRateToEur must be > 0');
  if (tx.currency === 'EUR' && !tx.fxRateToEur.eq(1)) fail('EUR rows must have fxRateToEur = 1');
  if (isTrade(tx.type)) {
    if (!tx.assetId) fail(`${tx.type} requires an asset`);
    if (!tx.quantity || !tx.quantity.gt(0)) fail(`${tx.type} requires quantity > 0`);
    if (!tx.unitPrice || tx.unitPrice.isNegative()) fail(`${tx.type} requires unitPrice >= 0`);
    if (tx.amount !== null) fail(`${tx.type} must not have an amount`);
  } else {
    if (!tx.amount || !tx.amount.gt(0)) fail(`${tx.type} requires amount > 0`);
    if (tx.quantity !== null || tx.unitPrice !== null) {
      fail(`${tx.type} must not have quantity or unitPrice`);
    }
  }
  if (tx.caSubscriptionId && tx.type !== 'redemption') {
    fail('caSubscriptionId is only allowed on redemptions');
  }
}

function phase(type: TransactionType): number {
  // Within one day: acquisitions, then everything else, then disposals, so a same-day
  // buy + sell works whatever order the rows arrive in.
  if (isAcquisition(type)) return 0;
  if (isDisposal(type)) return 2;
  return 1;
}

/** Validated, filtered to `asOf` (inclusive) and sorted for processing. Stable. */
export function prepareLedger(transactions: readonly Transaction[], asOf?: IsoDate): Transaction[] {
  if (asOf !== undefined) assertIsoDate(asOf);
  const rows = transactions
    .map((tx, index) => ({ tx, index }))
    .filter(({ tx }) => {
      validateTransaction(tx);
      return asOf === undefined || tx.tradeDate <= asOf;
    });
  rows.sort(
    (a, b) =>
      (a.tx.tradeDate < b.tx.tradeDate ? -1 : a.tx.tradeDate > b.tx.tradeDate ? 1 : 0) ||
      phase(a.tx.type) - phase(b.tx.type) ||
      a.index - b.index,
  );
  return rows.map((r) => r.tx);
}

/** Native-currency amount converted at the row's own (trade-time) rate. */
export function toEur(tx: Transaction, native: Decimal): Decimal {
  return native.times(tx.fxRateToEur);
}

/** quantity x unitPrice, in the row's currency. Zero for non-trades. */
export function grossNative(tx: Transaction): Decimal {
  return tx.quantity && tx.unitPrice ? tx.quantity.times(tx.unitPrice) : ZERO;
}

/** Acquisition cost in EUR: (quantity x price + fees) x fx at trade time. */
export function acquisitionCostEur(tx: Transaction): Decimal {
  return toEur(tx, grossNative(tx).plus(tx.fees));
}

/** Disposal proceeds in EUR: (quantity x price - fees) x fx at trade time. */
export function disposalProceedsEur(tx: Transaction): Decimal {
  return toEur(tx, grossNative(tx).minus(tx.fees));
}

export function feesEur(tx: Transaction): Decimal {
  return toEur(tx, tx.fees);
}

/** Amount (gross of fees) in EUR for non-trade rows. */
export function amountEur(tx: Transaction): Decimal {
  return toEur(tx, tx.amount ?? ZERO);
}

/**
 * Effect of a row on the cash balance, in EUR at the trade-time rate.
 *   deposit +amount - fees        withdrawal -amount - fees
 *   buy/subscription -cost        sell/redemption +proceeds
 *   dividend/interest +amount - fees
 *   fee -amount - fees
 */
export function cashEffectEur(tx: Transaction): Decimal {
  switch (tx.type) {
    case 'buy':
    case 'subscription':
      return acquisitionCostEur(tx).neg();
    case 'sell':
    case 'redemption':
      return disposalProceedsEur(tx);
    case 'deposit':
    case 'dividend':
    case 'interest':
      return toEur(tx, (tx.amount ?? ZERO).minus(tx.fees));
    case 'withdrawal':
    case 'fee':
      return toEur(tx, (tx.amount ?? ZERO).plus(tx.fees)).neg();
  }
}

/** Cash balance in EUR as of `asOf` (inclusive). */
export function cashBalanceEur(transactions: readonly Transaction[], asOf?: IsoDate): Decimal {
  let cash = ZERO;
  for (const tx of prepareLedger(transactions, asOf)) cash = cash.plus(cashEffectEur(tx));
  return cash;
}
