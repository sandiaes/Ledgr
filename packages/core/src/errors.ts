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

/** A sell or redemption for more units than are held (across all accounts). */
export class InsufficientHoldingsError extends LedgerError {
  override name = 'InsufficientHoldingsError';
  constructor(
    transactionId: string,
    readonly assetId: string,
    readonly requested: Decimal,
    readonly available: Decimal,
  ) {
    super(
      `Disposal of ${requested.toString()} units exceeds the ${available.toString()} held ` +
        `of asset ${assetId}`,
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
