import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { isAcquisition, isDisposal, prepareLedger } from './ledger';
import type { Transaction } from './types';

export interface AccountAssetDate {
  accountId: string;
  assetId: string;
  /** The date of the sale being considered. */
  date: IsoDate;
}

/**
 * Units of `assetId` in `accountId` at the end of `date`: the account's acquisitions minus
 * its disposals, plus transfers in, minus transfers out (its open FIFO lots, #1).
 */
export function unitsHeld(transactions: readonly Transaction[], at: AccountAssetDate): Decimal {
  let units = ZERO;
  for (const tx of prepareLedger(transactions, at.date)) units = units.plus(delta(tx, at));
  return units;
}

/**
 * The most units of `assetId` a new sale in `accountId` dated `date` may sell without
 * breaking the ledger: a sale is processed after that day's other rows, and then every later
 * sale or transfer out of the account must still be covered. Holding 10 on 1 March and
 * selling 6 on 1 May, a sale on 1 April may sell at most 4. Never negative.
 *
 * Checks units per account only. A CA redemption linked to a subscription also needs that
 * subscription's lot; the final check is runFifo over the whole ledger with the new row.
 */
export function maxDisposable(transactions: readonly Transaction[], at: AccountAssetDate): Decimal {
  let units = ZERO;
  let min: Decimal | null = null;
  for (const tx of prepareLedger(transactions)) {
    if (tx.tradeDate > at.date && min === null) min = units;
    units = units.plus(delta(tx, at));
    if (min !== null && units.lt(min)) min = units;
  }
  const limit = min === null ? units : min;
  return limit.isNegative() ? ZERO : limit;
}

/** A row's change to the units of one asset in one account. */
function delta(tx: Transaction, at: { accountId: string; assetId: string }): Decimal {
  if (tx.assetId !== at.assetId || !tx.quantity) return ZERO;
  if (tx.type === 'transfer') {
    if (tx.accountId === at.accountId) return tx.quantity.neg();
    if (tx.transferToAccountId === at.accountId) return tx.quantity;
    return ZERO;
  }
  if (tx.accountId !== at.accountId) return ZERO;
  if (isAcquisition(tx.type)) return tx.quantity;
  if (isDisposal(tx.type)) return tx.quantity.neg();
  return ZERO;
}
