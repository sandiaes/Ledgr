import type { IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { MissingValuationError } from './errors';
import { runFifo, type FifoOptions } from './fifo';
import { rowIncomeNetEur, rowOtherCostEur } from './gains';
import type { Holding } from './holdings';
import { prepareLedger } from './ledger';
import type { Transaction } from './types';

/** One broker account's share of the portfolio (docs/kpis.md §8 "Broker"). */
export interface AccountSummary {
  accountId: string;
  /** Market value of the account's open lots. */
  valueEur: Decimal;
  /** valueEur / the portfolio's value; null when the portfolio's value is 0. */
  weight: Decimal | null;
  costBasisEur: Decimal;
  unrealizedEur: Decimal;
  /** Disposals booked in this account (FIFO per account: their lots were held here). */
  realizedEur: Decimal;
  /** Dividend and interest rows booked in this account. */
  incomeNetEur: Decimal;
  /** Fee rows and transfer fees booked in this account. */
  otherCostsEur: Decimal;
  /** realized + unrealized + income - other costs. */
  totalGainEur: Decimal;
}

/**
 * Gains per account, for every account with open lots or any realized gain, income or cost
 * up to `asOf`. Largest value first (ties by account id). Every figure is a sum of parts
 * that each belong to one account, so the accounts add up exactly to `gainsSummary`.
 * Throws MissingValuationError if any holding has no market value.
 */
export function accountSummaries(input: {
  transactions: readonly Transaction[];
  holdings: readonly Holding[];
  asOf: IsoDate;
  caSubscriptions?: FifoOptions['caSubscriptions'];
}): AccountSummary[] {
  const { transactions, holdings, asOf } = input;
  const unvalued = holdings.filter((h) => !h.marketValueEur).map((h) => h.assetId);
  if (unvalued.length > 0) throw new MissingValuationError([...new Set(unvalued)], asOf);

  const rows = new Map<string, Omit<AccountSummary, 'weight' | 'totalGainEur'>>();
  const row = (accountId: string) => {
    let r = rows.get(accountId);
    if (!r) {
      r = {
        accountId,
        valueEur: ZERO,
        costBasisEur: ZERO,
        unrealizedEur: ZERO,
        realizedEur: ZERO,
        incomeNetEur: ZERO,
        otherCostsEur: ZERO,
      };
      rows.set(accountId, r);
    }
    return r;
  };

  for (const h of holdings) {
    for (const a of h.accounts) {
      const r = row(a.accountId);
      r.valueEur = r.valueEur.plus(a.marketValueEur as Decimal);
      r.costBasisEur = r.costBasisEur.plus(a.costBasisEur);
      r.unrealizedEur = r.unrealizedEur.plus(a.unrealizedGainEur as Decimal);
    }
  }
  const { disposals } = runFifo(transactions, { asOf, caSubscriptions: input.caSubscriptions });
  for (const d of disposals) {
    const r = row(d.accountId);
    r.realizedEur = r.realizedEur.plus(d.gainEur);
  }
  for (const tx of prepareLedger(transactions, asOf)) {
    const income = rowIncomeNetEur(tx);
    const cost = rowOtherCostEur(tx);
    if (income.isZero() && cost.isZero()) continue;
    const r = row(tx.accountId);
    r.incomeNetEur = r.incomeNetEur.plus(income);
    r.otherCostsEur = r.otherCostsEur.plus(cost);
  }

  const total = [...rows.values()].reduce((s, r) => s.plus(r.valueEur), ZERO);
  return [...rows.values()]
    .map((r) => ({
      ...r,
      weight: total.isZero() ? null : r.valueEur.div(total),
      totalGainEur: r.realizedEur.plus(r.unrealizedEur).plus(r.incomeNetEur).minus(r.otherCostsEur),
    }))
    .sort((a, b) => b.valueEur.comparedTo(a.valueEur) || a.accountId.localeCompare(b.accountId));
}
