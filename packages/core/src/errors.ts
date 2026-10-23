import type { Decimal } from './decimal';

/** A ledger row that violates the shape rules (mirrors the DB check constraints). */
export class LedgerError extends Error {
  override name = 'LedgerError';
  constructor(
    message: string,
    readonly transactionId?: string,
  ) {
    super(transactionId ? `${message} (transaction ${transactionId})` : message);
  }
}

/**
 * A sell or redemption for more units than its account holds of the asset, or a transfer of
 * more units than the sending account holds.
 */
export class InsufficientHoldingsError extends LedgerError {
  override name = 'InsufficientHoldingsError';
  constructor(
    transactionId: string,
    readonly assetId: string,
    readonly requested: Decimal,
    readonly available: Decimal,
    readonly accountId: string,
    readonly kind: 'disposal' | 'transfer' = 'disposal',
  ) {
    super(
      `${kind === 'transfer' ? 'Transfer' : 'Disposal'} of ${requested.toString()} units exceeds the ` +
        `${available.toString()} held of asset ${assetId} in account ${accountId}`,
      transactionId,
    );
  }
}

/** A value was needed but no price, fx rate or accrual could be found. */
export class MissingValuationError extends Error {
  override name = 'MissingValuationError';
  constructor(
    readonly assetIds: readonly string[],
    readonly date?: string,
  ) {
    super(`No valuation${date ? ` on ${date}` : ''} for asset(s): ${assetIds.join(', ')}`);
  }
}
