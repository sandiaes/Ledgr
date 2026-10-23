import { dailyFlows, type DailyFlow } from './cashflows';
import { addDays, addMonths, daysBetween, yearOf, type IsoDate } from './dates';
import { Decimal, ONE, ZERO } from './decimal';
import { netInvestedEur, rowIncomeNetEur } from './gains';
import { prepareLedger } from './ledger';
import { twr, type ValuePoint } from './twr';
import type { Transaction } from './types';
import { xirr, type CashFlow, type XirrFailure } from './xirr';

/** The two public.portfolio_snapshots columns the return figures need. */
export interface ValueSnapshot {
  date: IsoDate;
  /** total_value_eur: V(d). */
  valueEur: Decimal;
  /** net_contributions_eur: net invested NI(d). */
  netInvestedEur: Decimal;
}

export interface ReturnsInput {
  transactions: readonly Transaction[];
  /** Daily snapshots before today (any dated today or later are ignored). */
  snapshots: readonly ValueSnapshot[];
  /** T, the owner's local date. */
  today: IsoDate;
  /** V(T), the value now. */
  valueTodayEur: Decimal;
}

export type ReturnPeriod = 'sinceStart' | 'ytd' | '1y';

/**
 * XIRR over a period. `annualRate` is the solved rate; `displayRate` is what to show: the
 * annual rate for spans of 365 days or more, else the period rate (1+r)^(days/365) - 1
 * ("not annualized").
 */
export type XirrFigure =
  | { ok: true; annualRate: Decimal; displayRate: Decimal; annualized: boolean }
  | { ok: false; reason: XirrFailure | 'snapshot-missing'; message: string };

/** TWR over a period: cumulative, and annualized only for spans of 365 days or more. */
export type TwrFigure =
  | { ok: true; cumulative: Decimal; annualized: Decimal | null }
  | { ok: false; reason: 'snapshot-missing' | 'twr-undefined' | 'no-flows'; message: string };

export interface PeriodReturn {
  period: ReturnPeriod;
  /** S: the period runs over (S, T]. */
  start: IsoDate;
  end: IsoDate;
  /** S is before the first row (V(S) = 0): the period is effectively "since start". */
  fromStart: boolean;
  /** Days from the first flow (or S when V(S) > 0) to T; decides annualization. */
  days: number;
  xirr: XirrFigure;
  twr: TwrFigure;
}

interface Context {
  today: IsoDate;
  valueToday: Decimal;
  first: IsoDate | null;
  snapshots: ValueSnapshot[];
  byDate: Map<IsoDate, ValueSnapshot>;
  flows: DailyFlow[];
  ledger: Transaction[];
}

function context(input: ReturnsInput): Context {
  const ledger = prepareLedger(input.transactions, input.today);
  const snapshots = input.snapshots
    .filter((s) => s.date < input.today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byDate = new Map<IsoDate, ValueSnapshot>();
  for (const s of snapshots) {
    if (byDate.has(s.date)) throw new RangeError(`Duplicate snapshot on ${s.date}`);
    byDate.set(s.date, s);
  }
  return {
    today: input.today,
    valueToday: input.valueTodayEur,
    first: ledger[0]?.tradeDate ?? null,
    snapshots,
    byDate,
    flows: dailyFlows(ledger),
    ledger,
  };
}

/** V(d): 0 before the first row, V(T) today, else the snapshot (null when missing). */
function valueOn(ctx: Context, date: IsoDate): Decimal | null {
  if (ctx.first === null || date < ctx.first) return ZERO;
  if (date === ctx.today) return ctx.valueToday;
  return ctx.byDate.get(date)?.valueEur ?? null;
}

/**
 * TWR points over (start, end]: the start value, every snapshot day strictly inside, and the
 * end value. Flows of a day without a snapshot are added to the next point.
 */
function twrPoints(
  ctx: Context,
  start: IsoDate,
  startValue: Decimal,
  end: IsoDate,
  endValue: Decimal,
): ValuePoint[] {
  const points: ValuePoint[] = [{ date: start, value: startValue }];
  const flows = ctx.flows.filter((f) => f.date > start && f.date <= end);
  let fi = 0;
  const flowUpTo = (date: IsoDate) => {
    let acc = ZERO;
    while (fi < flows.length && (flows[fi] as DailyFlow).date <= date) {
      acc = acc.plus((flows[fi] as DailyFlow).flowEur);
      fi++;
    }
    return acc;
  };
  for (const s of ctx.snapshots) {
    if (s.date <= start || s.date >= end) continue;
    points.push({ date: s.date, value: s.valueEur, flow: flowUpTo(s.date) });
  }
  points.push({ date: end, value: endValue, flow: flowUpTo(end) });
  return points;
}

const missing = (date: IsoDate) =>
  ({
    ok: false,
    reason: 'snapshot-missing',
    message: `No snapshot on ${date}`,
  }) as const;

function annualize(growth: Decimal, days: number): Decimal {
  return growth.isZero() ? new Decimal(-1) : growth.pow(new Decimal(365).div(days)).minus(1);
}

/** S for a period ending today (docs/kpis.md §3); since start needs the first row's date. */
export function periodStart(period: ReturnPeriod, today: IsoDate, firstRow: IsoDate): IsoDate {
  if (period === 'ytd') return `${yearOf(today) - 1}-12-31`;
  if (period === '1y') return addMonths(today, -12);
  return addDays(firstRow, -1);
}

/**
 * XIRR and TWR for Since start, YTD and 1Y, all ending today (docs/kpis.md §3), from the
 * daily snapshots, the ledger's flows and V(T). V(S) is read from the snapshot of day S
 * (0 before the first row); a missing one fails both figures with 'snapshot-missing'.
 */
export function periodReturns(input: ReturnsInput): PeriodReturn[] {
  const ctx = context(input);
  const periods: ReturnPeriod[] = ['sinceStart', 'ytd', '1y'];
  return periods.map((period) => {
    const end = ctx.today;
    if (ctx.first === null) {
      const none = { ok: false, reason: 'no-flows', message: 'No ledger rows' } as const;
      return {
        period,
        start: end,
        end,
        fromStart: true,
        days: 0,
        xirr: none,
        twr: none,
      };
    }
    const start = periodStart(period, end, ctx.first);
    const startValue = valueOn(ctx, start);
    const fromStart = start < ctx.first;
    const inPeriod = ctx.flows.filter((f) => f.date > start && f.date <= end);
    const firstFlow = startValue && startValue.gt(0) ? start : (inPeriod[0]?.date ?? end);
    const days = daysBetween(firstFlow, end);
    if (startValue === null) {
      return { period, start, end, fromStart, days, xirr: missing(start), twr: missing(start) };
    }

    const cash: CashFlow[] = [];
    if (startValue.gt(0)) cash.push({ date: start, amount: startValue.neg() });
    for (const f of inPeriod) cash.push({ date: f.date, amount: f.flowEur.neg() });
    cash.push({ date: end, amount: ctx.valueToday });
    const r = xirr(cash);
    const xirrFigure: XirrFigure = r.ok
      ? {
          ok: true,
          annualRate: r.rate,
          displayRate:
            days >= 365 ? r.rate : ONE.plus(r.rate).pow(new Decimal(days).div(365)).minus(1),
          annualized: days >= 365,
        }
      : r;

    return {
      period,
      start,
      end,
      fromStart,
      days,
      xirr: xirrFigure,
      twr: twrFigure(ctx, start, startValue, end, ctx.valueToday, days),
    };
  });
}

function twrFigure(
  ctx: Context,
  start: IsoDate,
  startValue: Decimal,
  end: IsoDate,
  endValue: Decimal,
  days: number | null,
): TwrFigure {
  try {
    const { cumulative } = twr(twrPoints(ctx, start, startValue, end, endValue));
    return {
      ok: true,
      cumulative,
      annualized: days !== null && days >= 365 ? annualize(cumulative.plus(1), days) : null,
    };
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    return { ok: false, reason: 'twr-undefined', message: e.message };
  }
}

/** One step of a period's TWR chain (docs/kpis.md §3), for diagnosing an odd figure. */
export interface TwrStep {
  /** The step runs over (from, date]. */
  from: IsoDate;
  date: IsoDate;
  /** r_i; the period's TWR is the product of (1 + r_i) - 1. */
  return: Decimal;
  /** V at `from`. */
  startValueEur: Decimal;
  /** V at `date`. */
  endValueEur: Decimal;
  /** Flows dated in (from, date]. */
  flowEur: Decimal;
  /** The step started from zero: its flow was taken at the start of the day. */
  fromZero: boolean;
}

/**
 * The steps behind `periodReturns`' TWR for one period, oldest first: the same points and
 * rules (steps from zero to zero are skipped). Null when the period has no rows, its start
 * snapshot is missing, or the TWR is undefined.
 */
export function twrSteps(input: ReturnsInput, period: ReturnPeriod): TwrStep[] | null {
  const ctx = context(input);
  if (ctx.first === null) return null;
  const start = periodStart(period, ctx.today, ctx.first);
  const startValue = valueOn(ctx, start);
  if (startValue === null) return null;
  const points = twrPoints(ctx, start, startValue, ctx.today, ctx.valueToday);
  let periods;
  try {
    periods = twr(points).periods;
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  const index = new Map(points.map((p, i) => [p.date, i]));
  return periods.map((p) => {
    const i = index.get(p.date) as number;
    const prev = points[i - 1] as ValuePoint;
    const cur = points[i] as ValuePoint;
    return {
      from: prev.date,
      date: cur.date,
      return: p.return,
      startValueEur: prev.value,
      endValueEur: cur.value,
      flowEur: cur.flow ?? ZERO,
      fromZero: prev.value.isZero(),
    };
  });
}

export type SeriesRange = '1M' | '3M' | 'YTD' | '1Y' | 'All';

export interface ValueSeries {
  from: IsoDate;
  /** Snapshot days from `from` on, then today's point; oldest first. */
  points: ValueSnapshot[];
  /** Last point's value - first point's value. */
  valueChangeEur: Decimal;
  /** Last point's net invested - first point's net invested. */
  netInvestedChangeEur: Decimal;
}

/**
 * First day of a chart range ending on `today` (docs/kpis.md §4); 'All' starts at `first`,
 * the series' first point.
 */
export function rangeStart(range: SeriesRange, today: IsoDate, first: IsoDate): IsoDate {
  switch (range) {
    case '1M':
      return addMonths(today, -1);
    case '3M':
      return addMonths(today, -3);
    case 'YTD':
      return `${yearOf(today) - 1}-12-31`;
    case '1Y':
      return addMonths(today, -12);
    case 'All':
      return first;
  }
}

/**
 * Value vs net invested for a chart range (docs/kpis.md §4): one point per snapshot day in
 * the range, plus today's point (V(T), NI(T)).
 */
export function valueSeries(
  snapshots: readonly ValueSnapshot[],
  today: ValueSnapshot,
  range: SeriesRange,
): ValueSeries {
  const sorted = snapshots
    .filter((s) => s.date < today.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const from = rangeStart(range, today.date, sorted[0]?.date ?? today.date);
  const points = [...sorted.filter((s) => s.date >= from), today];
  const first = points[0] as ValueSnapshot;
  return {
    from,
    points,
    valueChangeEur: today.valueEur.minus(first.valueEur),
    netInvestedChangeEur: today.netInvestedEur.minus(first.netInvestedEur),
  };
}

/** One month or year of the Performance tables (docs/kpis.md §5). */
export interface CalendarReturn {
  /** 'YYYY-MM' or 'YYYY'. */
  period: string;
  /** E_{m-1}: the period runs over (start, end]. */
  start: IsoDate;
  /** E_m: the period's last day, or today for the current one. */
  end: IsoDate;
  /** The current month or year (MTD / YTD). */
  current: boolean;
  startValueEur: Decimal | null;
  endValueEur: Decimal | null;
  /** NI(end) - NI(start). */
  contributionsEur: Decimal;
  /** V(end) - V(start) - contributions; null when a value is missing. */
  marketGainEur: Decimal | null;
  /** Net income dated in the period. */
  incomeEur: Decimal;
  /** TWR over the period; null when it cannot be computed (`missing` says why). */
  return: Decimal | null;
  missing: 'snapshot-missing' | 'twr-undefined' | null;
  /** The period has month-level (imported) rows, valued from the 1st (#22, #27). */
  approximate: boolean;
}

/** Monthly returns from the first row's month to today's, newest first. */
export function monthlyReturns(input: ReturnsInput): CalendarReturn[] {
  return calendarReturns(context(input), 'month');
}

/** Yearly returns from the first row's year to today's, newest first. */
export function yearlyReturns(input: ReturnsInput): CalendarReturn[] {
  return calendarReturns(context(input), 'year');
}

function calendarReturns(ctx: Context, unit: 'month' | 'year'): CalendarReturn[] {
  if (ctx.first === null) return [];
  const rows: CalendarReturn[] = [];
  let periodFirst =
    unit === 'month' ? `${ctx.first.slice(0, 7)}-01` : `${ctx.first.slice(0, 4)}-01-01`;
  while (periodFirst <= ctx.today) {
    const next = addMonths(periodFirst, unit === 'month' ? 1 : 12);
    const start = addDays(periodFirst, -1);
    const lastDay = addDays(next, -1);
    const current = lastDay >= ctx.today;
    const end = current ? ctx.today : lastDay;

    const startValue = valueOn(ctx, start);
    const endValue = valueOn(ctx, end);
    const contributions = netInvestedEur(ctx.ledger, end).minus(netInvestedEur(ctx.ledger, start));
    const inPeriod = ctx.ledger.filter((t) => t.tradeDate > start && t.tradeDate <= end);
    let ret: Decimal | null = null;
    let why: CalendarReturn['missing'] = null;
    if (startValue === null || endValue === null) {
      why = 'snapshot-missing';
    } else {
      const f = twrFigure(ctx, start, startValue, end, endValue, null);
      if (f.ok) ret = f.cumulative;
      else why = 'twr-undefined';
    }
    rows.push({
      period: unit === 'month' ? periodFirst.slice(0, 7) : periodFirst.slice(0, 4),
      start,
      end,
      current,
      startValueEur: startValue,
      endValueEur: endValue,
      contributionsEur: contributions,
      marketGainEur:
        startValue && endValue ? endValue.minus(startValue).minus(contributions) : null,
      incomeEur: inPeriod.reduce((s, t) => s.plus(rowIncomeNetEur(t)), ZERO),
      return: ret,
      missing: why,
      approximate: inPeriod.some((t) => t.tradeDatePrecision === 'month'),
    });
    periodFirst = next;
  }
  return rows.reverse();
}

/**
 * Highest and lowest monthly return among completed months (the current month excluded);
 * ties go to the earlier month. Null when no completed month has a return.
 */
export function bestWorstMonth(months: readonly CalendarReturn[]): {
  best: CalendarReturn | null;
  worst: CalendarReturn | null;
} {
  const done = months
    .filter((m) => !m.current && m.return !== null)
    .sort((a, b) => (a.period < b.period ? -1 : 1));
  let best: CalendarReturn | null = null;
  let worst: CalendarReturn | null = null;
  for (const m of done) {
    const r = m.return as Decimal;
    if (!best || r.gt(best.return as Decimal)) best = m;
    if (!worst || r.lt(worst.return as Decimal)) worst = m;
  }
  return { best, worst };
}
