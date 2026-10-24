import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { amountEur, feesEur, grossNative, prepareLedger, toEur, withholdingTaxEur } from './ledger';
import { scopeTransactions, type AssetScope } from './scope';
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
  /** Only the rows in scope (docs/kpis.md §0.2); default all. */
  scope?: AssetScope;
}

/**
 * Flows across the boundary of the positions themselves, so it works whether or not
 * deposits are recorded: buys/subscriptions out, sells/redemptions/income in, fee rows and
 * transfer fees out, and the terminal value in. Deposits and withdrawals are ignored.
 */
export function investmentCashFlows(
  transactions: readonly Transaction[],
  options: InvestmentFlowOptions,
): CashFlow[] {
  const { asOf, assetId, excludeFees = false } = options;
  const scoped = scopeTransactions(transactions, options.scope);
  const rows = prepareLedger(
    assetId === undefined ? scoped : scoped.filter((t) => t.assetId === assetId),
    asOf,
  );
  const flows: CashFlow[] = [];
  for (const tx of rows) {
    const amount = investorFlow(tx, excludeFees);
    if (amount) flows.push({ date: tx.tradeDate, amount });
  }
  flows.push({ date: asOf, amount: options.terminalValueEur });
  return flows;
}

/** One row's flow from the investor's view (negative = paid in); null when it is none. */
function investorFlow(tx: Transaction, excludeFees: boolean): Decimal | null {
  const gross = toEur(tx, grossNative(tx));
  const fee = excludeFees ? ZERO : feesEur(tx);
  switch (tx.type) {
    case 'buy':
    case 'subscription':
      return gross.plus(fee).neg();
    case 'sell':
    case 'redemption':
      return gross.minus(fee);
    case 'dividend':
    case 'interest':
      // Withholding is not a fee, so it stays deducted even with excludeFees.
      return amountEur(tx).minus(withholdingTaxEur(tx)).minus(fee);
    case 'fee':
      return excludeFees ? null : amountEur(tx).plus(fee).neg();
    case 'transfer':
      // Units stay in the portfolio; only a transfer fee leaves it.
      return fee.isZero() ? null : fee.neg();
    case 'deposit':
    case 'withdrawal':
      return null;
  }
}

/**
 * F for one row: the money it put into the positions (docs/kpis.md §0), the negative of its
 * investor cash flow. Buys +cost, sells -proceeds, income -net amount, fee rows +amount,
 * transfers +fee; null for deposits and withdrawals (cash is not tracked, D5).
 */
export function flowEur(tx: Transaction): Decimal | null {
  return investorFlow(tx, false)?.neg() ?? null;
}

export interface DailyFlow {
  date: IsoDate;
  /** Sum of the day's flows F(d); may be zero when they cancel out. */
  flowEur: Decimal;
}

/**
 * F(d) per day with at least one flow row, oldest first, up to `asOf` (inclusive) and
 * after `after` (exclusive) when given. `assetId` keeps only that asset's rows, `scope`
 * only the rows in scope.
 */
export function dailyFlows(
  transactions: readonly Transaction[],
  options: { asOf?: IsoDate; after?: IsoDate; assetId?: string; scope?: AssetScope } = {},
): DailyFlow[] {
  const { after, assetId } = options;
  const out: DailyFlow[] = [];
  for (const tx of prepareLedger(scopeTransactions(transactions, options.scope), options.asOf)) {
    if (assetId !== undefined && tx.assetId !== assetId) continue;
    if (after !== undefined && tx.tradeDate <= after) continue;
    const f = flowEur(tx);
    if (!f) continue;
    const last = out[out.length - 1];
    if (last && last.date === tx.tradeDate) last.flowEur = last.flowEur.plus(f);
    else out.push({ date: tx.tradeDate, flowEur: f });
  }
  return out;
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
