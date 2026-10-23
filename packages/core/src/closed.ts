import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { runFifo, type FifoOptions } from './fifo';
import { rowIncomeNetEur } from './gains';
import { isAcquisition, prepareLedger } from './ledger';
import type { Transaction } from './types';

/** Realized results of one account in a closed position. */
export interface ClosedPositionAccount {
  accountId: string;
  unitsSold: Decimal;
  costEur: Decimal;
  proceedsEur: Decimal;
  realizedEur: Decimal;
}

/**
 * An asset with no units left and at least one disposal (docs/kpis.md §8). Performance,
 * not tax.
 */
export interface ClosedPosition {
  assetId: string;
  unitsBought: Decimal;
  unitsSold: Decimal;
  /** FIFO cost of the units sold. */
  costEur: Decimal;
  /** Net of fees. */
  proceedsEur: Decimal;
  realizedEur: Decimal;
  /** realized / cost; null when the cost is 0. */
  realizedPct: Decimal | null;
  /** Net dividends booked on the asset. */
  incomeEur: Decimal;
  firstBuy: IsoDate;
  lastSale: IsoDate;
  /** Split by the account each disposal happened in, by account id. */
  accounts: ClosedPositionAccount[];
}

/**
 * Fully closed positions as of `asOf`, by asset id. An asset closed and re-opened is not
 * listed (its realized gains belong to its open position).
 */
export function closedPositions(
  transactions: readonly Transaction[],
  options: { asOf?: IsoDate; caSubscriptions?: FifoOptions['caSubscriptions'] } = {},
): ClosedPosition[] {
  const { asOf } = options;
  const { openLots, disposals } = runFifo(transactions, {
    asOf,
    caSubscriptions: options.caSubscriptions,
  });
  const open = new Set(openLots.map((l) => l.assetId));
  const ledger = prepareLedger(transactions, asOf);

  const ids = [...new Set(disposals.map((d) => d.assetId))].filter((id) => !open.has(id)).sort();
  return ids.map((assetId) => {
    const own = disposals.filter((d) => d.assetId === assetId);
    const rows = ledger.filter((t) => t.assetId === assetId);
    const buys = rows.filter((t) => isAcquisition(t.type));
    const byAccount = new Map<string, ClosedPositionAccount>();
    for (const d of own) {
      const a = byAccount.get(d.accountId) ?? {
        accountId: d.accountId,
        unitsSold: ZERO,
        costEur: ZERO,
        proceedsEur: ZERO,
        realizedEur: ZERO,
      };
      a.unitsSold = a.unitsSold.plus(d.quantity);
      a.costEur = a.costEur.plus(d.costEur);
      a.proceedsEur = a.proceedsEur.plus(d.proceedsEur);
      a.realizedEur = a.realizedEur.plus(d.gainEur);
      byAccount.set(d.accountId, a);
    }
    const accounts = [...byAccount.values()].sort((a, b) => a.accountId.localeCompare(b.accountId));
    const costEur = own.reduce((s, d) => s.plus(d.costEur), ZERO);
    const realizedEur = own.reduce((s, d) => s.plus(d.gainEur), ZERO);
    return {
      assetId,
      unitsBought: buys.reduce((s, t) => s.plus(t.quantity as Decimal), ZERO),
      unitsSold: own.reduce((s, d) => s.plus(d.quantity), ZERO),
      costEur,
      proceedsEur: own.reduce((s, d) => s.plus(d.proceedsEur), ZERO),
      realizedEur,
      realizedPct: costEur.isZero() ? null : realizedEur.div(costEur),
      incomeEur: rows.reduce((s, t) => s.plus(rowIncomeNetEur(t)), ZERO),
      firstBuy: (buys[0] as Transaction).tradeDate,
      lastSale: (own[own.length - 1] as (typeof own)[number]).date,
      accounts,
    };
  });
}
