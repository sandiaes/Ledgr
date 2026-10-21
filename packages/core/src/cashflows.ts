import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { amountEur, feesEur, grossNative, prepareLedger, toEur, withholdingTaxEur } from './ledger';
import type { Transaction } from './types';
import type { CashFlow } from './xirr';

export interface InvestmentFlowOptions {
  asOf: IsoDate;
  /** Market value (EUR) of the positions on asOf; added as the final inflow. */
  terminalValueEur: Decimal;
  /** Only this asset's rows. */
  assetId?: string;
  /** Use prices before fees and ignore fee rows (for measuring fee drag). */
  excludeFees?: boolean;
}

/**
 * Flows across the boundary of the positions themselves, so it works whether or not
 * deposits are recorded: buys/subscriptions out, sells/redemptions/income in, fee rows out,
 * and the terminal value in. Deposits and withdrawals are ignored.
 */
export function investmentCashFlows(
  transactions: readonly Transaction[],
  options: InvestmentFlowOptions,
): CashFlow[] {
  const { asOf, assetId, excludeFees = false } = options;
  const rows = prepareLedger(
    assetId === undefined ? transactions : transactions.filter((t) => t.assetId === assetId),
    asOf,
  );
  const flows: CashFlow[] = [];
  for (const tx of rows) {
    const gross = toEur(tx, grossNative(tx));
    const fee = excludeFees ? ZERO : feesEur(tx);
    let amount: Decimal | null = null;
    switch (tx.type) {
      case 'buy':
      case 'subscription':
        amount = gross.plus(fee).neg();
        break;
      case 'sell':
      case 'redemption':
        amount = gross.minus(fee);
        break;
      case 'dividend':
      case 'interest':
        // Withholding is not a fee, so it stays deducted even with excludeFees.
        amount = amountEur(tx).minus(withholdingTaxEur(tx)).minus(fee);
        break;
      case 'fee':
        if (!excludeFees) amount = amountEur(tx).plus(fee).neg();
        break;
      case 'deposit':
      case 'withdrawal':
        break;
    }
    if (amount) flows.push({ date: tx.tradeDate, amount });
  }
  flows.push({ date: asOf, amount: options.terminalValueEur });
  return flows;
}

/**
 * Flows across the portfolio boundary: deposits out, withdrawals in, and the total value
 * (positions + cash) on asOf in. Only meaningful if every deposit/withdrawal is recorded
 * (the same condition under which snapshots track cash).
 */
export function externalCashFlows(
  transactions: readonly Transaction[],
  options: { asOf: IsoDate; terminalValueEur: Decimal },
): CashFlow[] {
  const flows: CashFlow[] = [];
  for (const tx of prepareLedger(transactions, options.asOf)) {
    if (tx.type === 'deposit') flows.push({ date: tx.tradeDate, amount: amountEur(tx).neg() });
    if (tx.type === 'withdrawal') flows.push({ date: tx.tradeDate, amount: amountEur(tx) });
  }
  flows.push({ date: options.asOf, amount: options.terminalValueEur });
  return flows;
}
