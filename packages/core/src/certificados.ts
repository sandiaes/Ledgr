import { addMonths, assertIsoDate, type IsoDate } from './dates';
import { ONE, ZERO, type Decimal } from './decimal';

/** Mirrors public.ca_series. Rates are annual decimals (0.025 = 2.5%). */
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

/** Mirrors public.ca_subscriptions. `manualValue` is EUR for the units held on that date. */
export interface CaSubscription {
  id: string;
  seriesId: string;
  transactionId: string;
  manualValue: Decimal | null;
  manualValueDate: IsoDate | null;
}

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
  /** EUR per unit as of a date, from a manual override; accrual continues from here. */
  manual: { date: IsoDate; unitValue: Decimal } | null;
}

export interface CaUnitValuation {
  unitValue: Decimal;
  source: 'rules' | 'manual';
  /** Last capitalisation applied, or null if none yet. */
  lastCapitalisation: IsoDate | null;
}

/** Values one unit of a subscription. Implement this to swap the whole accrual model. */
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
 * - A manual override (if dated on or before asOf) replaces everything up to its date;
 *   periods ending after it then accrue as normal.
 * - No intermediate rounding.
 */
export function createRuleBasedCaValuer(options: {
  referenceRate: ReferenceRateLookup;
  rateRule?: CaRateRule;
}): CaValuer {
  const rateRule = options.rateRule ?? defaultCaRateRule;
  return {
    valueUnit({ series, subscriptionDate, subscriptionUnitValue, asOf, manual }) {
      assertIsoDate(subscriptionDate);
      assertIsoDate(asOf);
      const useManual = manual !== null && manual.date <= asOf;
      if (useManual && manual.date < subscriptionDate) {
        throw new RangeError(`Manual value date ${manual.date} is before the subscription`);
      }
      let unitValue = useManual ? manual.unitValue : subscriptionUnitValue;
      let lastCapitalisation: IsoDate | null = null;
      const step = series.capitalisationMonths;
      const netShare = ONE.minus(series.withholdingTaxRate);

      for (let k = 1; k * step <= series.termMonths; k++) {
        const periodEnd = addMonths(subscriptionDate, k * step);
        if (periodEnd > asOf) break;
        lastCapitalisation = periodEnd;
        if (useManual && periodEnd <= manual.date) continue;

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
      return { unitValue, source: useManual ? 'manual' : 'rules', lastCapitalisation };
    },
  };
}

/** What holdings/snapshots need to value certificados. */
export interface CaContext {
  valuer: CaValuer;
  series: readonly CaSeries[];
  subscriptions: readonly CaSubscription[];
}
