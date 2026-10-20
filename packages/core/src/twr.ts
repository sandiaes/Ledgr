import { assertIsoDate, daysBetween, type IsoDate } from './dates';
import { Decimal, ONE, ZERO } from './decimal';

export interface ValuePoint {
  date: IsoDate;
  /** Portfolio value at the end of the day, after that day's flow. */
  value: Decimal;
  /** Net external flow during the day: + contribution, - withdrawal. Default 0. */
  flow?: Decimal;
}

export interface TwrResult {
  /** Product of (1 + r_i) - 1 over all sub-periods. */
  cumulative: Decimal;
  /** (1 + cumulative)^(365/days) - 1, only when the series covers at least 365 days. */
  annualized: Decimal | null;
  days: number;
  periods: { date: IsoDate; return: Decimal }[];
}

/**
 * Time-weighted return from a daily (or any dated) value series.
 *
 * Flows are assumed to happen at the end of their day, so they earn nothing that day:
 *   r_i = (V_i - F_i) / V_{i-1} - 1
 * The first point is the starting value (its flow is ignored). A period starting from zero
 * value is skipped if nothing changed but the flow (e.g. the first deposit); a value
 * appearing from zero without a flow, or a negative starting value, is an error.
 */
export function twr(series: readonly ValuePoint[]): TwrResult {
  const points = [...series].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (let i = 0; i < points.length; i++) {
    assertIsoDate((points[i] as ValuePoint).date);
    if (i > 0 && (points[i] as ValuePoint).date === (points[i - 1] as ValuePoint).date) {
      throw new RangeError(`Duplicate TWR point on ${(points[i] as ValuePoint).date}`);
    }
  }

  const periods: { date: IsoDate; return: Decimal }[] = [];
  let growth = ONE;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] as ValuePoint;
    const cur = points[i] as ValuePoint;
    const endBeforeFlow = cur.value.minus(cur.flow ?? ZERO);
    if (prev.value.isNegative()) {
      throw new RangeError(`Negative value on ${prev.date}; TWR is undefined`);
    }
    if (prev.value.isZero()) {
      if (!endBeforeFlow.isZero()) {
        throw new RangeError(`Value on ${cur.date} grew from zero without a flow`);
      }
      continue;
    }
    const r = endBeforeFlow.div(prev.value).minus(1);
    growth = growth.times(ONE.plus(r));
    periods.push({ date: cur.date, return: r });
  }

  const first = points[0];
  const last = points[points.length - 1];
  const days = first && last ? daysBetween(first.date, last.date) : 0;
  const cumulative = growth.minus(1);
  let annualized: Decimal | null = null;
  if (days >= 365) {
    annualized = growth.isZero()
      ? new Decimal(-1)
      : growth.pow(new Decimal(365).div(days)).minus(1);
  }
  return { cumulative, annualized, days, periods };
}
