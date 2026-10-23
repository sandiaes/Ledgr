import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { InsufficientHoldingsError, LedgerError } from './errors';
import {
  acquisitionCostEur,
  disposalProceedsEur,
  isAcquisition,
  isDisposal,
  prepareLedger,
} from './ledger';
import type { Transaction } from './types';

/**
 * An open (or partly consumed) lot. Lot id = the acquiring transaction's id; a part split
 * off by a transfer gets `<lot id>:<transfer id>`.
 */
export interface Lot {
  lotId: string;
  /** The acquisition (buy or subscription) the lot comes from; CA redemptions match on it. */
  originTransactionId: string;
  /** Account holding the lot: where it was acquired, or where a transfer moved it. */
  accountId: string;
  assetId: string;
  acquiredOn: IsoDate;
  /**
   * Quantity and cost the lot started with: at acquisition, or, for a part split off by a
   * transfer, when it was split off. The remaining part keeps its acquisition figures.
   */
  originalQuantity: Decimal;
  /** Original cost incl. fees, EUR at the acquisition's fx rate. */
  originalCostEur: Decimal;
  /** Units still open. */
  quantity: Decimal;
  /** Cost of the units still open (pro rata of the original cost). */
  costEur: Decimal;
}

export interface LotMatch {
  lotId: string;
  acquiredOn: IsoDate;
  quantity: Decimal;
  costEur: Decimal;
  proceedsEur: Decimal;
  gainEur: Decimal;
}

/**
 * One sell or redemption with the lots it consumed. `gainEur` is a performance metric
 * (FIFO over this ledger), not a tax figure.
 */
export interface Disposal {
  transactionId: string;
  type: 'sell' | 'redemption';
  /** Account the disposal happened in; every lot it consumed was held there. */
  accountId: string;
  assetId: string;
  date: IsoDate;
  quantity: Decimal;
  /** Net of fees, EUR at the disposal's fx rate. */
  proceedsEur: Decimal;
  costEur: Decimal;
  gainEur: Decimal;
  matches: LotMatch[];
}

/**
 *   account  lots per (account, asset): a sale consumes only its own account's lots, and a
 *            transfer moves the sender's oldest lots to the receiver. The default, and the
 *            only mode the apps, snapshots and value-now use.
 *   pooled   lots per asset across all accounts; transfers move no lots. COMPARISON ONLY
 *            (the one-off `pnpm prices fifo-compare` and tests); never shown in any UI.
 */
export type FifoMatching = 'account' | 'pooled';

export interface FifoOptions {
  /** Ignore rows after this date (inclusive cut-off). */
  asOf?: IsoDate;
  /** Lets redemptions with caSubscriptionId target that subscription's lot. */
  caSubscriptions?: readonly { id: string; transactionId: string }[];
  /** Default 'account'. 'pooled' is for the one-off comparison only. */
  matching?: FifoMatching;
}

export interface FifoResult {
  openLots: Lot[];
  disposals: Disposal[];
  /** Total open cost basis (EUR) at the end of each date that had a trade. */
  costBasisTimeline: { date: IsoDate; costBasisEur: Decimal }[];
}

type MutableLot = Lot;

/**
 * FIFO lot matching per account and asset (assumption #1): a sale consumes the oldest open
 * lots of that asset in its own account, and selling more than that account holds throws
 * InsufficientHoldingsError. A transfer moves the sender's oldest lots, with their
 * acquisition date and cost, to the receiving account, where they queue by acquisition
 * date (#21); moving more than the sender holds throws.
 *
 * The realized gains it produces are a performance metric, not tax figures: tax reports
 * come from broker report exports, not from this ledger.
 *
 * Partial consumption (or a partial transfer) takes cost pro rata by quantity; remaining
 * cost is computed by subtraction, so the parts always sum exactly to the original cost.
 * Disposal proceeds are split across matched lots pro rata, with the last match taking
 * the remainder so the parts sum exactly to the whole.
 */
export function runFifo(
  transactions: readonly Transaction[],
  options: FifoOptions = {},
): FifoResult {
  const pooled = options.matching === 'pooled';
  const ledger = prepareLedger(transactions, options.asOf);
  const caLot = new Map((options.caSubscriptions ?? []).map((s) => [s.id, s.transactionId]));

  const queues = new Map<string, MutableLot[]>();
  const keyOf = (accountId: string, assetId: string) =>
    pooled ? assetId : `${accountId}\u0000${assetId}`;
  const queueOf = (key: string) => {
    let queue = queues.get(key);
    if (!queue) queues.set(key, (queue = []));
    return queue;
  };
  const disposals: Disposal[] = [];
  const timeline: { date: IsoDate; costBasisEur: Decimal }[] = [];
  let openCost = ZERO;

  const record = (date: IsoDate) => {
    const last = timeline[timeline.length - 1];
    if (last && last.date === date) last.costBasisEur = openCost;
    else timeline.push({ date, costBasisEur: openCost });
  };

  for (const tx of ledger) {
    if (!tx.assetId || !tx.quantity) continue;
    const key = keyOf(tx.accountId, tx.assetId);

    if (isAcquisition(tx.type)) {
      const cost = acquisitionCostEur(tx);
      queueOf(key).push({
        lotId: tx.id,
        originTransactionId: tx.id,
        accountId: tx.accountId,
        assetId: tx.assetId,
        acquiredOn: tx.tradeDate,
        originalQuantity: tx.quantity,
        originalCostEur: cost,
        quantity: tx.quantity,
        costEur: cost,
      });
      openCost = openCost.plus(cost);
      record(tx.tradeDate);
    } else if (isDisposal(tx.type)) {
      const queue = queueOf(key);
      const disposal = dispose(tx, queue, caLot, pooled ? null : tx.accountId);
      queues.set(
        key,
        queue.filter((lot) => !lot.quantity.isZero()),
      );
      openCost = openCost.minus(disposal.costEur);
      disposals.push(disposal);
      record(tx.tradeDate);
    } else if (tx.type === 'transfer' && !pooled) {
      const to = tx.transferToAccountId as string;
      const moved = moveLots(tx, queueOf(key));
      queues.set(
        key,
        queueOf(key).filter((lot) => !lot.quantity.isZero()),
      );
      const target = queueOf(keyOf(to, tx.assetId));
      for (const lot of moved) {
        // Oldest first by acquisition date; after lots of the same date already there.
        const at = target.findIndex((l) => l.acquiredOn > lot.acquiredOn);
        target.splice(at === -1 ? target.length : at, 0, { ...lot, accountId: to });
      }
    }
  }

  const openLots: Lot[] = [];
  for (const queue of queues.values()) for (const lot of queue) openLots.push({ ...lot });
  return { openLots, disposals, costBasisTimeline: timeline };
}

/** Takes the transfer's units off the sender's oldest lots; returns the parts moved. */
function moveLots(tx: Transaction, queue: MutableLot[]): MutableLot[] {
  const requested = tx.quantity as Decimal;
  const available = queue.reduce((s, lot) => s.plus(lot.quantity), ZERO);
  if (requested.gt(available)) {
    throw new InsufficientHoldingsError(
      tx.id,
      tx.assetId as string,
      requested,
      available,
      tx.accountId,
      'transfer',
    );
  }
  const moved: MutableLot[] = [];
  let left = requested;
  for (const lot of queue) {
    if (left.isZero()) break;
    const take = minDec(lot.quantity, left);
    left = left.minus(take);
    if (take.eq(lot.quantity)) {
      moved.push({ ...lot });
    } else {
      const cost = lot.costEur.times(take).div(lot.quantity);
      moved.push({
        ...lot,
        lotId: `${lot.lotId}:${tx.id}`,
        originalQuantity: take,
        originalCostEur: cost,
        quantity: take,
        costEur: cost,
      });
      lot.costEur = lot.costEur.minus(cost);
    }
    lot.quantity = lot.quantity.minus(take);
    if (lot.quantity.isZero()) lot.costEur = ZERO;
  }
  return moved;
}

function dispose(
  tx: Transaction,
  queue: MutableLot[],
  caLot: Map<string, string>,
  accountId: string | null,
): Disposal {
  const assetId = tx.assetId as string;
  const requested = tx.quantity as Decimal;

  let candidates = queue;
  if (tx.caSubscriptionId) {
    const origin = caLot.get(tx.caSubscriptionId);
    if (!origin) throw new LedgerError(`Unknown CA subscription ${tx.caSubscriptionId}`, tx.id);
    candidates = queue.filter((lot) => lot.originTransactionId === origin);
  }

  const available = candidates.reduce((s, lot) => s.plus(lot.quantity), ZERO);
  if (requested.gt(available)) {
    throw new InsufficientHoldingsError(tx.id, assetId, requested, available, accountId);
  }

  const proceeds = disposalProceedsEur(tx);
  const matches: LotMatch[] = [];
  let left = requested;
  let proceedsLeft = proceeds;

  for (const lot of candidates) {
    if (left.isZero()) break;
    const take = minDec(lot.quantity, left);
    const cost = take.eq(lot.quantity) ? lot.costEur : lot.costEur.times(take).div(lot.quantity);
    left = left.minus(take);
    const share = left.isZero() ? proceedsLeft : proceeds.times(take).div(requested);
    proceedsLeft = proceedsLeft.minus(share);

    lot.quantity = lot.quantity.minus(take);
    lot.costEur = lot.quantity.isZero() ? ZERO : lot.costEur.minus(cost);

    matches.push({
      lotId: lot.lotId,
      acquiredOn: lot.acquiredOn,
      quantity: take,
      costEur: cost,
      proceedsEur: share,
      gainEur: share.minus(cost),
    });
  }

  const costEur = matches.reduce((s, m) => s.plus(m.costEur), ZERO);
  return {
    transactionId: tx.id,
    type: tx.type as 'sell' | 'redemption',
    accountId: tx.accountId,
    assetId,
    date: tx.tradeDate,
    quantity: requested,
    proceedsEur: proceeds,
    costEur,
    gainEur: proceeds.minus(costEur),
    matches,
  };
}

function minDec(a: Decimal, b: Decimal): Decimal {
  return a.lte(b) ? a : b;
}
