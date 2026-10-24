import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { MissingValuationError } from './errors';
import { runFifo } from './fifo';
import type { Holding } from './holdings';
import { scopeHoldings, scopeTransactions, type AssetScope } from './scope';
import {
  acquisitionCostEur,
  amountEur,
  disposalProceedsEur,
  feesEur,
  isAcquisition,
  isDisposal,
  prepareLedger,
  withholdingTaxEur,
} from './ledger';
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

/**
 * Net invested up to and including `asOf`: what buys and subscriptions cost (fees in) minus
 * what sells and redemptions returned (fees out), EUR at each row's trade-time rate.
 * Deposits, withdrawals, income, fee rows and transfers are not counted (assumption #24).
 */
export function netInvestedEur(
  transactions: readonly Transaction[],
  asOf?: IsoDate,
  scope?: AssetScope,
): Decimal {
  let net = ZERO;
  for (const tx of prepareLedger(scopeTransactions(transactions, scope), asOf)) {
    if (isAcquisition(tx.type)) net = net.plus(acquisitionCostEur(tx));
    else if (isDisposal(tx.type)) net = net.minus(disposalProceedsEur(tx));
  }
  return net;
}

/** Net income of a dividend or interest row (amount - withholding - fees); 0 for others. */
export function rowIncomeNetEur(tx: Transaction): Decimal {
  if (tx.type !== 'dividend' && tx.type !== 'interest') return ZERO;
  return amountEur(tx).minus(withholdingTaxEur(tx)).minus(feesEur(tx));
}

/**
 * Other cost of a row: a fee row's amount + fees, a transfer's fee; 0 for others. Deposits
 * and withdrawals change no figure, their fees included (assumption #19, D5).
 */
export function rowOtherCostEur(tx: Transaction): Decimal {
  if (tx.type === 'fee') return amountEur(tx).plus(feesEur(tx));
  if (tx.type === 'transfer') return feesEur(tx);
  return ZERO;
}

export interface GainsSummary {
  /**
   * Sum of disposal gains (FIFO per account, fees in cost and proceeds). A performance
   * metric, not a tax figure.
   */
  realizedEur: Decimal;
  /** Market value - cost basis of open positions. */
  unrealizedEur: Decimal;
  /** realized + unrealized (capital gains only). */
  totalGainEur: Decimal;
  /** Dividends + interest, net of withholding tax and fees on those rows. */
  incomeNetEur: Decimal;
  /**
   * Standalone fee rows plus fees on transfers. Deposits and withdrawals (and their fees)
   * change no figure: cash is not tracked (assumption #19, decision D5).
   */
  otherCostsEur: Decimal;
  /**
   * Total gain G = realized + unrealized + incomeNet - otherCosts (decision D1). Equals the
   * holdings' value minus the sum of the day flows F(d) (`dailyFlows`).
   */
  totalReturnEur: Decimal;
}

export function gainsSummary(input: {
  transactions: readonly Transaction[];
  holdings: readonly Holding[];
  asOf: IsoDate;
  caSubscriptions?: readonly { id: string; transactionId: string }[];
  /** Only the assets in scope (docs/kpis.md §0.2); default all. */
  scope?: AssetScope;
}): GainsSummary {
  const { asOf } = input;
  const transactions = scopeTransactions(input.transactions, input.scope);
  const holdings = scopeHoldings(input.holdings, input.scope);
  const unvalued = holdings.filter((h) => !h.unrealizedGainEur).map((h) => h.assetId);
  if (unvalued.length > 0) throw new MissingValuationError([...new Set(unvalued)], asOf);

  const { disposals } = runFifo(transactions, { asOf, caSubscriptions: input.caSubscriptions });
  const realizedEur = disposals.reduce((s, d) => s.plus(d.gainEur), ZERO);
  const unrealizedEur = holdings.reduce((s, h) => s.plus(h.unrealizedGainEur as Decimal), ZERO);

  let incomeNetEur = ZERO;
  let otherCostsEur = ZERO;
  for (const tx of prepareLedger(transactions, asOf)) {
    incomeNetEur = incomeNetEur.plus(rowIncomeNetEur(tx));
    otherCostsEur = otherCostsEur.plus(rowOtherCostEur(tx));
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
