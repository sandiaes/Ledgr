// The return calculator (docs/kpis.md §11): a projection of a balance under a constant
// effective annual rate and a constant monthly contribution, plus the defaults the screen
// starts from. Pure; `Decimal` end to end.
import { addDays, addMonths, type IsoDate } from './dates';
import { Decimal, ONE, ZERO, dec } from './decimal';
import {
  acquisitionCostEur,
  disposalProceedsEur,
  isAcquisition,
  isDisposal,
  prepareLedger,
} from './ledger';
import { parseDecimalInput } from './input';
import type { PeriodReturn } from './returns';
import { scopeTransactions, type AssetScope } from './scope';
import type { Transaction } from './types';

export type ContributionTiming = 'end' | 'start';

/** The longest timeline: 100 years. */
export const MAX_PROJECTION_MONTHS = 1200;

/** What `projectGrowth` takes. Rates are fractions (0.07 is 7%). */
export interface ProjectionInput {
  /** P, EUR, >= 0. */
  startingValue: Decimal;
  /** Whole years of the timeline. */
  years: number;
  /** Months on top of the whole years, 0 to 11. */
  extraMonths: number;
  /** a: the effective annual rate, > -1. */
  annualReturn: Decimal;
  /** C, EUR, >= 0, the same nominal amount every month. */
  monthlyContribution: Decimal;
  /** f: annual inflation, >= 0 (default 0). */
  inflation?: Decimal;
  /** When in the month the contribution goes in (default end). */
  timing?: ContributionTiming;
}

/** One row of the year-by-year table: the state at the end of month `months`. */
export interface ProjectionRow {
  /** k: 12, 24, ... and, with extra months, the timeline's last month. */
  months: number;
  /** Whole years completed at `months`. */
  years: number;
  /** The row ends part way through a year (the last row of a timeline with extra months). */
  partYear: boolean;
  balance: Decimal;
  /** P + C k. */
  contributed: Decimal;
  /** balance - contributed. */
  growth: Decimal;
}

export interface Projection {
  /** n, the timeline in months. */
  months: number;
  /** i = (1 + a)^(1/12) - 1. */
  monthlyRate: Decimal;
  endingValue: Decimal;
  /** P + C n. */
  totalContributed: Decimal;
  /** Ending value - total contributed. */
  totalGrowth: Decimal;
  /** Total growth / ending value; null when the ending value is 0. */
  growthShare: Decimal | null;
  /** Ending value / (1 + f)^(n/12); null when inflation is 0. */
  endingValueReal: Decimal | null;
  rows: ProjectionRow[];
}

const TWELVE = new Decimal(12);

function normalize(input: ProjectionInput) {
  const { years, extraMonths } = input;
  if (!Number.isInteger(years) || years < 0) throw new RangeError('years must be a whole number');
  if (!Number.isInteger(extraMonths) || extraMonths < 0 || extraMonths > 11)
    throw new RangeError('extra months must be 0 to 11');
  const months = years * 12 + extraMonths;
  if (months > MAX_PROJECTION_MONTHS)
    throw new RangeError(`timeline is longer than ${MAX_PROJECTION_MONTHS / 12} years`);
  if (input.startingValue.isNegative()) throw new RangeError('starting value must be >= 0');
  if (input.monthlyContribution.isNegative())
    throw new RangeError('monthly contribution must be >= 0');
  if (input.annualReturn.lte(-1)) throw new RangeError('annual return must be above -100%');
  const inflation = input.inflation ?? ZERO;
  if (inflation.isNegative()) throw new RangeError('inflation must be >= 0');
  return { months, inflation, timing: input.timing ?? 'end' };
}

/** i = (1 + a)^(1/12) - 1: twelve months compound to exactly the annual rate. */
export function monthlyRate(annualReturn: Decimal): Decimal {
  if (annualReturn.lte(-1)) throw new RangeError('annual return must be above -100%');
  return ONE.plus(annualReturn).pow(ONE.div(TWELVE)).minus(1);
}

/** The closed-form balance after `k` months (docs/kpis.md §11.2). */
function balanceAfter(
  input: ProjectionInput,
  i: Decimal,
  timing: ContributionTiming,
  k: number,
): Decimal {
  const { startingValue: p, monthlyContribution: c } = input;
  if (i.isZero()) return p.plus(c.times(k));
  // g = (1 + i)^k = (1 + a)^(k / 12): exact for whole years.
  const g = ONE.plus(input.annualReturn).pow(new Decimal(k).div(TWELVE));
  let annuity = g.minus(1).div(i);
  if (timing === 'start') annuity = annuity.times(ONE.plus(i));
  return p.times(g).plus(c.times(annuity));
}

/** The balance after each month by recursion: index 0 is the start, index n the end. */
export function projectMonthByMonth(input: ProjectionInput): Decimal[] {
  const { months, timing } = normalize(input);
  const growth = ONE.plus(monthlyRate(input.annualReturn));
  const c = input.monthlyContribution;
  const balances = [input.startingValue];
  let b = input.startingValue;
  for (let k = 1; k <= months; k++) {
    b = timing === 'end' ? b.times(growth).plus(c) : b.plus(c).times(growth);
    balances.push(b);
  }
  return balances;
}

/** The projection by the closed form (docs/kpis.md §11). Throws a RangeError on bad input. */
export function projectGrowth(input: ProjectionInput): Projection {
  const { months, inflation, timing } = normalize(input);
  const i = monthlyRate(input.annualReturn);
  const contributedAt = (k: number) => input.startingValue.plus(input.monthlyContribution.times(k));
  const at = (k: number): Decimal => balanceAfter(input, i, timing, k);

  const marks: number[] = [];
  for (let k = 12; k <= months; k += 12) marks.push(k);
  if (months % 12 !== 0) marks.push(months);
  const rows = marks.map((k): ProjectionRow => {
    const balance = at(k);
    const contributed = contributedAt(k);
    return {
      months: k,
      years: Math.floor(k / 12),
      partYear: k % 12 !== 0,
      balance,
      contributed,
      growth: balance.minus(contributed),
    };
  });

  const endingValue = months === 0 ? input.startingValue : at(months);
  const totalContributed = contributedAt(months);
  const totalGrowth = endingValue.minus(totalContributed);
  return {
    months,
    monthlyRate: i,
    endingValue,
    totalContributed,
    totalGrowth,
    growthShare: endingValue.isZero() ? null : totalGrowth.div(endingValue),
    endingValueReal: inflation.isZero()
      ? null
      : endingValue.div(ONE.plus(inflation).pow(new Decimal(months).div(TWELVE))),
    rows,
  };
}

// ---------------------------------------------------------------------------------------
// Defaults from the owner's data (docs/kpis.md §11.4)

export interface MonthlyPurchases {
  /**
   * (buys + subscriptions - sells - redemptions) in the window / `months`; negative for a
   * net seller, 0 with nothing in scope.
   */
  averageEur: Decimal;
  /** The divisor: 12, or fewer whole months for a history shorter than a year (at least 1). */
  months: number;
  /** The window is (from, to]. */
  from: IsoDate;
  to: IsoDate;
  /** The default contribution: the average, but never below 0. */
  contributionEur: Decimal;
}

/**
 * Average net monthly purchases over the last 12 months (docs/kpis.md §11.4): the rows in
 * scope dated in (addMonths(today, -12), today], acquisitions at cost (fees in) minus
 * disposals at proceeds (fees out), as in net invested, divided by 12; by the whole months
 * since the first row when the history is shorter than a year.
 */
export function averageMonthlyNetPurchases(
  transactions: readonly Transaction[],
  today: IsoDate,
  scope?: AssetScope,
): MonthlyPurchases {
  const ledger = prepareLedger(scopeTransactions(transactions, scope), today);
  const from = addMonths(today, -12);
  const first = ledger[0]?.tradeDate;
  let months = 12;
  if (first !== undefined && first > from) {
    months = 1;
    while (months < 12 && addMonths(first, months + 1) <= today) months++;
  }
  let net = ZERO;
  for (const tx of ledger) {
    if (tx.tradeDate <= from) continue;
    if (isAcquisition(tx.type)) net = net.plus(acquisitionCostEur(tx));
    else if (isDisposal(tx.type)) net = net.minus(disposalProceedsEur(tx));
  }
  const averageEur = net.div(months);
  return {
    averageEur,
    months,
    from,
    to: today,
    contributionEur: averageEur.isNegative() ? ZERO : averageEur,
  };
}

/** A return the owner can base the projection on, with the period it was measured over. */
export interface ReturnChoice {
  source: 'xirr' | 'twr';
  /** An annual rate (a fraction). */
  rate: Decimal;
  /** The period runs from the first flow to `to`. */
  from: IsoDate;
  to: IsoDate;
  days: number;
  /** Rests on less than a year of history (XIRR only; annualized TWR needs a year). */
  shortHistory: boolean;
}

export interface ProjectionDefaults {
  startingValueEur: Decimal;
  xirr: ReturnChoice | null;
  twr: ReturnChoice | null;
  /** XIRR, else annualized TWR, else null (the owner is asked). */
  defaultSource: 'xirr' | 'twr' | null;
  purchases: MonthlyPurchases;
}

/**
 * What the screen starts from, for the scope of `returns` and `scope`: V(T), the Since
 * start XIRR and annualized TWR, and the average net monthly purchases.
 */
export function projectionDefaults(input: {
  transactions: readonly Transaction[];
  today: IsoDate;
  /** V(T) in scope. */
  valueTodayEur: Decimal;
  /** `periodReturns` for the same scope. */
  returns: readonly PeriodReturn[];
  scope?: AssetScope;
}): ProjectionDefaults {
  const since = input.returns.find((r) => r.period === 'sinceStart');
  const choice = (source: 'xirr' | 'twr', rate: Decimal): ReturnChoice | null =>
    since
      ? {
          source,
          rate,
          from: addDays(since.end, -since.days),
          to: since.end,
          days: since.days,
          shortHistory: since.days < 365,
        }
      : null;
  const xirr = since?.xirr.ok ? choice('xirr', since.xirr.annualRate) : null;
  const annualTwr = since?.twr.ok ? since.twr.annualized : null;
  const twr = annualTwr ? choice('twr', annualTwr) : null;
  return {
    startingValueEur: input.valueTodayEur,
    xirr,
    twr,
    defaultSource: xirr ? 'xirr' : twr ? 'twr' : null,
    purchases: averageMonthlyNetPurchases(input.transactions, input.today, input.scope),
  };
}

// ---------------------------------------------------------------------------------------
// The form

/** The default range outside which a default return gets a warning (docs/kpis.md §11.4). */
export const RETURN_WARNING_RANGE = { minPct: -20, maxPct: 30 } as const;

/** The most the form accepts. */
export const PROJECTION_LIMITS = {
  maxStartingValue: '1000000000',
  maxContribution: '10000000',
  minReturnPct: '-50',
  maxReturnPct: '100',
  maxInflationPct: '50',
  maxYears: 60,
} as const;

/** What the owner has typed; percentages are in percent ("7.5"). */
export interface ProjectionForm {
  startingValue: string;
  years: string;
  extraMonths: string;
  annualReturnPct: string;
  monthlyContribution: string;
  inflationPct: string;
  timing: ContributionTiming;
}

export type ProjectionField =
  'startingValue' | 'years' | 'extraMonths' | 'annualReturn' | 'monthlyContribution' | 'inflation';

export type ProjectionProblem =
  'empty' | 'not_a_number' | 'not_whole' | 'negative' | 'too_small' | 'too_large';

export type ProjectionFormResult =
  | { ok: true; input: ProjectionInput }
  | { ok: false; errors: Partial<Record<ProjectionField, ProjectionProblem>> };

/**
 * Typed text -> a `ProjectionInput`, or one problem per field. A blank extra months or
 * inflation is 0; every other field is required.
 */
export function parseProjectionForm(form: ProjectionForm): ProjectionFormResult {
  const errors: Partial<Record<ProjectionField, ProjectionProblem>> = {};
  const L = PROJECTION_LIMITS;

  const amount = (field: ProjectionField, text: string, max: string): Decimal => {
    const p = parseDecimalInput(text);
    if (!p.ok) errors[field] = p.problem === 'empty' ? 'empty' : 'not_a_number';
    else if (p.value.isNegative()) errors[field] = 'negative';
    else if (p.value.gt(max)) errors[field] = 'too_large';
    return p.ok ? p.value : ZERO;
  };
  const whole = (field: ProjectionField, text: string, max: number, optional: boolean): number => {
    const t = text.trim();
    if (t === '') {
      if (!optional) errors[field] = 'empty';
      return 0;
    }
    if (!/^\d+$/.test(t)) {
      errors[field] = /^-\d+$/.test(t)
        ? 'negative'
        : /^\d+[.,]\d*$/.test(t)
          ? 'not_whole'
          : 'not_a_number';
      return 0;
    }
    const n = Number(t);
    if (n > max) errors[field] = 'too_large';
    return n;
  };
  const percent = (
    field: ProjectionField,
    text: string,
    min: string,
    max: string,
    optional: boolean,
  ): Decimal => {
    if (optional && text.trim() === '') return ZERO;
    const p = parseDecimalInput(text);
    if (!p.ok) errors[field] = p.problem === 'empty' ? 'empty' : 'not_a_number';
    else if (p.value.lt(min)) errors[field] = min === '0' ? 'negative' : 'too_small';
    else if (p.value.gt(max)) errors[field] = 'too_large';
    return p.ok ? p.value.div(100) : ZERO;
  };

  const startingValue = amount('startingValue', form.startingValue, L.maxStartingValue);
  const monthlyContribution = amount(
    'monthlyContribution',
    form.monthlyContribution,
    L.maxContribution,
  );
  const years = whole('years', form.years, L.maxYears, false);
  const extraMonths = whole('extraMonths', form.extraMonths, 11, true);
  const annualReturn = percent(
    'annualReturn',
    form.annualReturnPct,
    L.minReturnPct,
    L.maxReturnPct,
    false,
  );
  const inflation = percent('inflation', form.inflationPct, '0', L.maxInflationPct, true);
  if (!errors.years && !errors.extraMonths && years * 12 + extraMonths > MAX_PROJECTION_MONTHS)
    errors.years = 'too_large';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      startingValue,
      years,
      extraMonths,
      annualReturn,
      monthlyContribution,
      inflation,
      timing: form.timing,
    },
  };
}

/** Whether a return (a fraction) is outside the range that gets a warning. */
export function returnOutsideWarningRange(rate: Decimal): boolean {
  return (
    rate.lt(dec(String(RETURN_WARNING_RANGE.minPct)).div(100)) ||
    rate.gt(dec(String(RETURN_WARNING_RANGE.maxPct)).div(100))
  );
}
