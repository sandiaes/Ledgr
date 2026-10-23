import { addMonths, assertIsoDate, type IsoDate } from './dates';
import { ONE, ZERO, type Decimal } from './decimal';
import { runFifo } from './fifo';
import { certificadoValuer, type CertificadoLotValuation } from './holdings';
import { ageInDays, DEFAULT_CA_MAX_AGE_DAYS, isStale } from './prices';
import type { Transaction } from './types';

/**
 * Mirrors public.ca_series. Rates are annual decimals (0.025 = 2.5%). Only the optional
 * accrual model needs these rules; in the database subscription_start and term_months
 * may be null, and such a series cannot be used for accrual.
 */
export interface CaSeries {
  id: string;
  code: string;
  termMonths: number;
  capitalisationMonths: number;
  minHoldingMonths: number;
  /** Name of the reference rate, e.g. 'euribor_3m'; resolved by a ReferenceRateLookup. */
  referenceRate: string;
  baseSpread: Decimal;
  rateFloor: Decimal | null;
  rateCap: Decimal | null;
  loyaltyPremiums: readonly { fromYear: number; toYear: number; premium: Decimal }[];
  withholdingTaxRate: Decimal;
}

/** Mirrors public.ca_subscriptions: links a subscription transaction to its series. */
export interface CaSubscription {
  id: string;
  seriesId: string;
  transactionId: string;
}

/**
 * Mirrors public.ca_factors: the official value of one unit of a subscription (EUR, net,
 * as AforroNet shows it), in force from `month` (the 1st of that month) on. Every
 * monthly factor is its own row; rows are never changed.
 */
export interface CaFactor {
  subscriptionId: string;
  month: IsoDate;
  factor: Decimal;
}

/** Latest factor of a subscription whose month is on or before `date`; null when none. */
export type CaFactorLookup = (subscriptionId: string, date: IsoDate) => CaFactor | null;

/** Annual reference rate in force for a capitalisation period starting on `date`. */
export type ReferenceRateLookup = (name: string, date: IsoDate) => Decimal | null;

export interface CaRateContext {
  series: CaSeries;
  periodStart: IsoDate;
  /** 1 for the first 12 months after subscription, 2 for months 13-24, ... */
  holdingYear: number;
  referenceRate: Decimal;
}

/** Gross annual rate for one capitalisation period. Replaceable. */
export type CaRateRule = (ctx: CaRateContext) => Decimal;

/**
 * Default rule (as stored in ca_series):
 *   clamp(reference + spread, floor, cap) + sum of loyalty premiums covering holdingYear
 */
export const defaultCaRateRule: CaRateRule = ({ series, holdingYear, referenceRate }) => {
  let base = referenceRate.plus(series.baseSpread);
  if (series.rateFloor && base.lt(series.rateFloor)) base = series.rateFloor;
  if (series.rateCap && base.gt(series.rateCap)) base = series.rateCap;
  const premium = series.loyaltyPremiums
    .filter((p) => holdingYear >= p.fromYear && holdingYear <= p.toYear)
    .reduce((s, p) => s.plus(p.premium), ZERO);
  return base.plus(premium);
};

export interface CaUnitValuationInput {
  series: CaSeries;
  subscriptionDate: IsoDate;
  /** EUR paid per unit at subscription (normally 1). */
  subscriptionUnitValue: Decimal;
  asOf: IsoDate;
  /** EUR per unit as of a date (from the latest factor); accrual continues from here. */
  anchor: { date: IsoDate; unitValue: Decimal } | null;
}

export interface CaUnitValuation {
  unitValue: Decimal;
  /** 'anchor' when the value starts from `anchor`, 'rules' when from the subscription. */
  source: 'rules' | 'anchor';
  /** Last capitalisation applied, or null if none yet. */
  lastCapitalisation: IsoDate | null;
}

/**
 * Optional accrual model: values one unit of a subscription by rules. Not part of the
 * default valuation, which uses official factors only. Implement this to swap the model.
 */
export interface CaValuer {
  valueUnit(input: CaUnitValuationInput): CaUnitValuation;
}

export class CaRateUnavailableError extends Error {
  override name = 'CaRateUnavailableError';
  constructor(
    readonly referenceRate: string,
    readonly date: IsoDate,
  ) {
    super(`No ${referenceRate} rate for the period starting ${date}`);
  }
}

/**
 * Rule-based accrual:
 * - Periods of `capitalisationMonths` are anchored on the subscription date
 *   (period k ends at subscription + k x capitalisationMonths, day clamped to month end).
 * - Interest for a period is credited only when the period completes; nothing accrues
 *   for a partial period.
 * - Interest = unitValue x annualRate x capitalisationMonths / 12; the rate is fixed from
 *   the reference rate at the start of the period.
 * - Withholding tax is deducted at each capitalisation and only the net is capitalised.
 * - No accrual after termMonths.
 * - An anchor (if dated on or before asOf) replaces everything up to its date; periods
 *   ending after it then accrue as normal. It is a net value (an official factor),
 *   consistent with the net capitalisation above.
 * - No intermediate rounding.
 */
export function createRuleBasedCaValuer(options: {
  referenceRate: ReferenceRateLookup;
  rateRule?: CaRateRule;
}): CaValuer {
  const rateRule = options.rateRule ?? defaultCaRateRule;
  return {
    valueUnit({ series, subscriptionDate, subscriptionUnitValue, asOf, anchor }) {
      assertIsoDate(subscriptionDate);
      assertIsoDate(asOf);
      const useAnchor = anchor !== null && anchor.date <= asOf;
      if (useAnchor && anchor.date < subscriptionDate) {
        throw new RangeError(`Anchor date ${anchor.date} is before the subscription`);
      }
      let unitValue = useAnchor ? anchor.unitValue : subscriptionUnitValue;
      let lastCapitalisation: IsoDate | null = null;
      const step = series.capitalisationMonths;
      const netShare = ONE.minus(series.withholdingTaxRate);

      for (let k = 1; k * step <= series.termMonths; k++) {
        const periodEnd = addMonths(subscriptionDate, k * step);
        if (periodEnd > asOf) break;
        lastCapitalisation = periodEnd;
        if (useAnchor && periodEnd <= anchor.date) continue;

        const periodStart = addMonths(subscriptionDate, (k - 1) * step);
        const reference = options.referenceRate(series.referenceRate, periodStart);
        if (!reference) throw new CaRateUnavailableError(series.referenceRate, periodStart);
        const rate = rateRule({
          series,
          periodStart,
          holdingYear: Math.floor(((k - 1) * step) / 12) + 1,
          referenceRate: reference,
        });
        const gross = unitValue.times(rate).times(step).div(12);
        unitValue = unitValue.plus(gross.times(netShare));
      }
      return { unitValue, source: useAnchor ? 'anchor' : 'rules', lastCapitalisation };
    },
  };
}

/**
 * What holdings/snapshots need to value certificados. By default a subscription is worth
 * units x its latest factor on or before the date (see computeHoldings). `accrual` opts in
 * to the rule-based model instead, accruing forward from that factor.
 */
export interface CaContext {
  subscriptions: readonly CaSubscription[];
  factors: CaFactorLookup;
  /** Optional, not the default. Lots whose series is not listed are valued by factors. */
  accrual?: { valuer: CaValuer; series: readonly CaSeries[] };
}

/** One certificado subscription as the Certificados screen shows it (docs/kpis.md §8). */
export interface CertificadoSubscriptionView {
  subscriptionId: string;
  seriesId: string;
  /** The subscription transaction. */
  transactionId: string;
  accountId: string;
  subscribedOn: IsoDate;
  /** Units still held on asOf. */
  units: Decimal;
  /** EUR per unit: the latest factor on or before asOf, or the subscription price before it. */
  unitValueEur: Decimal;
  source: CertificadoLotValuation['source'];
  /** Month of the factor used, or null before the first factor. */
  factorMonth: IsoDate | null;
  /** units x unitValue. */
  valueEur: Decimal;
  /** Cost of the units held (units x subscription price, fees in). */
  costEur: Decimal;
  gainEur: Decimal;
  /** Days from the factor's month (or the subscription date, before any factor) to asOf. */
  ageDays: number;
  /** ageDays > caMaxAgeDays (default 35). */
  stale: boolean;
}

/**
 * Every certificado subscription with units held on `asOf`, valued by factor (#14) with the
 * factor's age (#25), oldest subscription first. Fully redeemed subscriptions are left out.
 */
export function certificadoSubscriptions(input: {
  transactions: readonly Transaction[];
  asOf: IsoDate;
  ca: CaContext;
  caMaxAgeDays?: number;
}): CertificadoSubscriptionView[] {
  const { transactions, asOf, ca } = input;
  const maxAge = input.caMaxAgeDays ?? DEFAULT_CA_MAX_AGE_DAYS;
  const { openLots } = runFifo(transactions, { asOf, caSubscriptions: ca.subscriptions });
  const valuer = certificadoValuer(transactions, asOf, ca);
  const views: CertificadoSubscriptionView[] = [];
  for (const sub of ca.subscriptions) {
    const lots = openLots.filter((l) => l.originTransactionId === sub.transactionId);
    if (lots.length === 0) continue;
    const valued = valuer(lots);
    if (!valued) continue;
    const first = valued.lots[0] as CertificadoLotValuation;
    const lot = lots[0] as (typeof lots)[number];
    const units = lots.reduce((s, l) => s.plus(l.quantity), ZERO);
    const costEur = lots.reduce((s, l) => s.plus(l.costEur), ZERO);
    const ageDays = ageInDays(first.factorMonth ?? lot.acquiredOn, asOf);
    views.push({
      subscriptionId: sub.id,
      seriesId: sub.seriesId,
      transactionId: sub.transactionId,
      accountId: lot.accountId,
      subscribedOn: lot.acquiredOn,
      units,
      unitValueEur: first.unitValue,
      source: first.source,
      factorMonth: first.factorMonth,
      valueEur: valued.total,
      costEur,
      gainEur: valued.total.minus(costEur),
      ageDays,
      stale: isStale(ageDays, maxAge),
    });
  }
  return views.sort(
    (a, b) =>
      (a.subscribedOn < b.subscribedOn ? -1 : a.subscribedOn > b.subscribedOn ? 1 : 0) ||
      a.subscriptionId.localeCompare(b.subscriptionId),
  );
}
