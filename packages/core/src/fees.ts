import { investmentCashFlows, type InvestmentFlowOptions } from './cashflows';
import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { amountEur, feesEur, isTrade, prepareLedger } from './ledger';
import type { Transaction } from './types';
import { xirr, type XirrResult } from './xirr';

export interface FeeSummary {
  /** Fees on buys, sells, subscriptions, redemptions. */
  tradingEur: Decimal;
  /** Fees on dividend and interest rows. */
  incomeEur: Decimal;
  /** Fees on deposits and withdrawals. */
  cashEur: Decimal;
  /** Standalone `fee` rows (amount + fees). */
  standaloneEur: Decimal;
  totalEur: Decimal;
}

/** All fees paid, EUR at each row's trade-time fx rate. Withholding tax is not a fee. */
export function feeSummary(transactions: readonly Transaction[], asOf?: IsoDate): FeeSummary {
  let tradingEur = ZERO;
  let incomeEur = ZERO;
  let cashEur = ZERO;
  let standaloneEur = ZERO;
  for (const tx of prepareLedger(transactions, asOf)) {
    const fee = feesEur(tx);
    if (isTrade(tx.type)) tradingEur = tradingEur.plus(fee);
    else if (tx.type === 'dividend' || tx.type === 'interest') incomeEur = incomeEur.plus(fee);
    else if (tx.type === 'deposit' || tx.type === 'withdrawal') cashEur = cashEur.plus(fee);
    else standaloneEur = standaloneEur.plus(amountEur(tx)).plus(fee);
  }
  return {
    tradingEur,
    incomeEur,
    cashEur,
    standaloneEur,
    totalEur: tradingEur.plus(incomeEur).plus(cashEur).plus(standaloneEur),
  };
}

/**
 * Share of the fee-free return that fees consumed: fees / (netReturn + fees).
 * `netReturnEur` is GainsSummary.totalReturnEur. Null when the fee-free return is <= 0,
 * where a share is meaningless.
 */
export function feeDragShare(totalFeesEur: Decimal, netReturnEur: Decimal): Decimal | null {
  const gross = netReturnEur.plus(totalFeesEur);
  return gross.gt(0) ? totalFeesEur.div(gross) : null;
}

export interface XirrFeeDrag {
  withFees: XirrResult;
  withoutFees: XirrResult;
  /** Annualised return lost to fees (withoutFees - withFees); null if either has no rate. */
  drag: Decimal | null;
}

/** Money-weighted fee drag: XIRR of the positions' flows with and without fees. */
export function xirrFeeDrag(
  transactions: readonly Transaction[],
  options: Omit<InvestmentFlowOptions, 'excludeFees'>,
): XirrFeeDrag {
  const withFees = xirr(investmentCashFlows(transactions, options));
  const withoutFees = xirr(investmentCashFlows(transactions, { ...options, excludeFees: true }));
  return {
    withFees,
    withoutFees,
    drag: withFees.ok && withoutFees.ok ? withoutFees.rate.minus(withFees.rate) : null,
  };
}
