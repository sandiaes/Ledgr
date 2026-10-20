import { dayNumber, minDate, yearOf, type IsoDate } from './dates';
import { ZERO, type Decimal } from './decimal';
import { runFifo, type FifoOptions } from './fifo';
import { amountEur, feesEur, prepareLedger } from './ledger';
import type { Transaction } from './types';

export interface IncomeTotals {
  dividendsEur: Decimal;
  interestEur: Decimal;
  /** dividends + interest, as recorded in `amount`. */
  grossEur: Decimal;
  /** Fees recorded on the income rows. */
  feesEur: Decimal;
  netEur: Decimal;
}

export interface IncomeOptions {
  asOf?: IsoDate;
  /** Only income and positions of this asset. */
  assetId?: string;
  /** Needed when redemptions are linked to a CA subscription (see FifoOptions). */
  caSubscriptions?: FifoOptions['caSubscriptions'];
}

function filterAsset(transactions: readonly Transaction[], assetId?: string) {
  return assetId === undefined ? transactions : transactions.filter((t) => t.assetId === assetId);
}

export function incomeTotals(
  transactions: readonly Transaction[],
  options: IncomeOptions = {},
): IncomeTotals {
  let dividendsEur = ZERO;
  let interestEur = ZERO;
  let fees = ZERO;
  for (const tx of prepareLedger(filterAsset(transactions, options.assetId), options.asOf)) {
    if (tx.type === 'dividend') dividendsEur = dividendsEur.plus(amountEur(tx));
    else if (tx.type === 'interest') interestEur = interestEur.plus(amountEur(tx));
    else continue;
    fees = fees.plus(feesEur(tx));
  }
  const grossEur = dividendsEur.plus(interestEur);
  return { dividendsEur, interestEur, grossEur, feesEur: fees, netEur: grossEur.minus(fees) };
}

export interface IncomeYear extends IncomeTotals {
  year: number;
  /** Time-weighted average of the end-of-day open cost basis over the year (to asOf). */
  averageCostBasisEur: Decimal;
  /** grossEur / averageCostBasisEur; null when nothing was held. */
  yieldOnCost: Decimal | null;
}

/**
 * Income per calendar year, from the first year with any transaction up to asOf's year.
 * The current year runs from 1 January to asOf.
 */
export function incomeByYear(
  transactions: readonly Transaction[],
  options: IncomeOptions & { asOf: IsoDate },
): IncomeYear[] {
  const { asOf } = options;
  const rows = prepareLedger(filterAsset(transactions, options.assetId), asOf);
  const first = rows[0];
  if (!first) return [];

  const timeline = runFifo(rows, {
    asOf,
    caSubscriptions: options.caSubscriptions,
  }).costBasisTimeline;
  const result: IncomeYear[] = [];

  for (let year = yearOf(first.tradeDate); year <= yearOf(asOf); year++) {
    const start = `${year}-01-01`;
    const end = minDate(`${year}-12-31`, asOf);
    const yearRows = rows.filter((t) => t.tradeDate >= start && t.tradeDate <= end);
    const totals = incomeTotals(yearRows);

    // Integrate the step function "cost basis at end of day d" over [start, end].
    let cursor = start;
    let value = ZERO;
    for (const point of timeline) if (point.date <= start) value = point.costBasisEur;
    let integral = ZERO;
    for (const point of timeline) {
      if (point.date <= start || point.date > end) continue;
      integral = integral.plus(value.times(dayNumber(point.date) - dayNumber(cursor)));
      cursor = point.date;
      value = point.costBasisEur;
    }
    integral = integral.plus(value.times(dayNumber(end) - dayNumber(cursor) + 1));
    const averageCostBasisEur = integral.div(dayNumber(end) - dayNumber(start) + 1);

    result.push({
      year,
      ...totals,
      averageCostBasisEur,
      yieldOnCost: averageCostBasisEur.gt(0) ? totals.grossEur.div(averageCostBasisEur) : null,
    });
  }
  return result;
}
