import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { MissingValuationError } from './errors';
import { runFifo } from './fifo';
import type { Holding } from './holdings';
import { amountEur, feesEur, prepareLedger, withholdingTaxEur } from './ledger';
import type { Transaction } from './types';

export interface NetContributions {
  depositsEur: Decimal;
  withdrawalsEur: Decimal;
  /** deposits - withdrawals (amounts, EUR at trade-time fx; fees not included). */
  netEur: Decimal;
}

export function netContributions(
  transactions: readonly Transaction[],
  asOf?: IsoDate,
): NetContributions {
  let depositsEur = ZERO;
  let withdrawalsEur = ZERO;
  for (const tx of prepareLedger(transactions, asOf)) {
    if (tx.type === 'deposit') depositsEur = depositsEur.plus(amountEur(tx));
    if (tx.type === 'withdrawal') withdrawalsEur = withdrawalsEur.plus(amountEur(tx));
  }
  return { depositsEur, withdrawalsEur, netEur: depositsEur.minus(withdrawalsEur) };
}

export interface GainsSummary {
  /**
   * Sum of disposal gains (pooled FIFO, fees in cost and proceeds). A performance metric,
   * not a tax figure.
   */
  realizedEur: Decimal;
  /** Market value - cost basis of open positions. */
  unrealizedEur: Decimal;
  /** realized + unrealized (capital gains only). */
  totalGainEur: Decimal;
  /** Dividends + interest, net of withholding tax and fees on those rows. */
  incomeNetEur: Decimal;
  /** Standalone fee rows plus fees on deposits, withdrawals and transfers. */
  otherCostsEur: Decimal;
  /**
   * totalGain + incomeNet - otherCosts. Equals holdings value + cash - net contributions
   * (cash as computed by cashBalanceEur, whether or not it is tracked in snapshots).
   */
  totalReturnEur: Decimal;
}

export function gainsSummary(input: {
  transactions: readonly Transaction[];
  holdings: readonly Holding[];
  asOf: IsoDate;
  caSubscriptions?: readonly { id: string; transactionId: string }[];
}): GainsSummary {
  const { transactions, holdings, asOf } = input;
  const unvalued = holdings.filter((h) => !h.unrealizedGainEur).map((h) => h.assetId);
  if (unvalued.length > 0) throw new MissingValuationError([...new Set(unvalued)], asOf);

  const { disposals } = runFifo(transactions, { asOf, caSubscriptions: input.caSubscriptions });
  const realizedEur = disposals.reduce((s, d) => s.plus(d.gainEur), ZERO);
  const unrealizedEur = holdings.reduce((s, h) => s.plus(h.unrealizedGainEur as Decimal), ZERO);

  let incomeNetEur = ZERO;
  let otherCostsEur = ZERO;
  for (const tx of prepareLedger(transactions, asOf)) {
    if (tx.type === 'dividend' || tx.type === 'interest') {
      incomeNetEur = incomeNetEur
        .plus(amountEur(tx))
        .minus(withholdingTaxEur(tx))
        .minus(feesEur(tx));
    } else if (tx.type === 'fee') {
      otherCostsEur = otherCostsEur.plus(amountEur(tx)).plus(feesEur(tx));
    } else if (tx.type === 'deposit' || tx.type === 'withdrawal' || tx.type === 'transfer') {
      otherCostsEur = otherCostsEur.plus(feesEur(tx));
    }
  }

  const totalGainEur = realizedEur.plus(unrealizedEur);
  return {
    realizedEur,
    unrealizedEur,
    totalGainEur,
    incomeNetEur,
    otherCostsEur,
    totalReturnEur: totalGainEur.plus(incomeNetEur).minus(otherCostsEur),
  };
}
