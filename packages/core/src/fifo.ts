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

/** An open (or partly consumed) acquisition. Lot id = the acquiring transaction's id. */
export interface Lot {
  lotId: string;
  accountId: string;
  assetId: string;
  acquiredOn: IsoDate;
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

/** One sell or redemption with the lots it consumed. */
export interface Disposal {
  transactionId: string;
  type: 'sell' | 'redemption';
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

export interface FifoOptions {
  /** Ignore rows after this date (inclusive cut-off). */
  asOf?: IsoDate;
  /** Lets redemptions with caSubscriptionId target that subscription's lot. */
  caSubscriptions?: readonly { id: string; transactionId: string }[];
}

export interface FifoResult {
  openLots: Lot[];
  disposals: Disposal[];
  /** Total open cost basis (EUR) at the end of each date that had a trade. */
  costBasisTimeline: { date: IsoDate; costBasisEur: Decimal }[];
}

interface MutableLot {
  lotId: string;
  accountId: string;
  assetId: string;
  acquiredOn: IsoDate;
  originalQuantity: Decimal;
  originalCostEur: Decimal;
  quantity: Decimal;
  costEur: Decimal;
}

const keyOf = (accountId: string, assetId: string) => `${accountId}\u0000${assetId}`;

/**
 * FIFO lot matching per (account, asset).
 *
 * Partial consumption takes cost pro rata by quantity; remaining cost is computed by
 * subtraction, so consumed + remaining always equals the original cost exactly.
 * Disposal proceeds are split across matched lots pro rata, with the last match taking
 * the remainder so the parts sum exactly to the whole.
 */
export function runFifo(
  transactions: readonly Transaction[],
  options: FifoOptions = {},
): FifoResult {
  const ledger = prepareLedger(transactions, options.asOf);
  const caLot = new Map((options.caSubscriptions ?? []).map((s) => [s.id, s.transactionId]));

  const queues = new Map<string, MutableLot[]>();
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
      const queue = queues.get(key) ?? [];
      queue.push({
        lotId: tx.id,
        accountId: tx.accountId,
        assetId: tx.assetId,
        acquiredOn: tx.tradeDate,
        originalQuantity: tx.quantity,
        originalCostEur: cost,
        quantity: tx.quantity,
        costEur: cost,
      });
      queues.set(key, queue);
      openCost = openCost.plus(cost);
      record(tx.tradeDate);
    } else if (isDisposal(tx.type)) {
      const queue = queues.get(key) ?? [];
      const disposal = dispose(tx, queue, caLot);
      queues.set(
        key,
        queue.filter((lot) => !lot.quantity.isZero()),
      );
      openCost = openCost.minus(disposal.costEur);
      disposals.push(disposal);
      record(tx.tradeDate);
    }
  }

  const openLots: Lot[] = [];
  for (const queue of queues.values()) for (const lot of queue) openLots.push({ ...lot });
  return { openLots, disposals, costBasisTimeline: timeline };
}

function dispose(tx: Transaction, queue: MutableLot[], caLot: Map<string, string>): Disposal {
  const accountId = tx.accountId;
  const assetId = tx.assetId as string;
  const requested = tx.quantity as Decimal;

  let candidates = queue;
  if (tx.caSubscriptionId) {
    const lotId = caLot.get(tx.caSubscriptionId);
    if (!lotId) throw new LedgerError(`Unknown CA subscription ${tx.caSubscriptionId}`, tx.id);
    candidates = queue.filter((lot) => lot.lotId === lotId);
  }

  const available = candidates.reduce((s, lot) => s.plus(lot.quantity), ZERO);
  if (requested.gt(available)) {
    throw new InsufficientHoldingsError(tx.id, accountId, assetId, requested, available);
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
    accountId,
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
