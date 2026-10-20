import { daysBetween, type IsoDate } from './dates';
import { Decimal, ONE, ZERO } from './decimal';

/** Investor's view: negative = money paid in, positive = money received / value held. */
export interface CashFlow {
  date: IsoDate;
  amount: Decimal;
}

export type XirrFailure = 'no-flows' | 'period-too-short' | 'no-sign-change' | 'no-root-found';

export type XirrResult =
  | { ok: true; rate: Decimal; method: 'newton' | 'bisection'; iterations: number }
  | { ok: false; reason: XirrFailure; message: string };

export interface XirrOptions {
  /** Newton starting point (default 0.1). */
  guess?: Decimal;
  /** Convergence on the rate (default 1e-14). */
  tolerance?: Decimal;
  maxNewtonIterations?: number;
  maxBisectionIterations?: number;
  /** Minimum days between first and last flow (default 1). */
  minDays?: number;
}

const DAYS_PER_YEAR = 365;

// Points scanned for a sign change when Newton fails. Sorted ascending, all > -1.
const BRACKET_GRID = [
  '-0.999999999',
  '-0.99999',
  '-0.999',
  '-0.99',
  '-0.9',
  '-0.75',
  '-0.5',
  '-0.25',
  '0',
  '0.25',
  '0.5',
  '1',
  '2',
  '5',
  '10',
  '100',
  '1000',
  '100000',
  '10000000',
].map((s) => new Decimal(s));

/**
 * Annualised money-weighted return: the r solving sum(a_i / (1+r)^(d_i/365)) = 0, where d_i
 * is days since the first flow (Actual/365, as Excel's XIRR).
 *
 * Newton's method first; if it diverges, leaves r > -1 or stalls, bisection over a bracket
 * found by scanning a fixed grid. Returns a failure (never throws) when no rate exists.
 * With several sign changes there can be several roots; the one nearest the guess wins.
 */
export function xirr(flows: readonly CashFlow[], options: XirrOptions = {}): XirrResult {
  const guess = options.guess ?? new Decimal('0.1');
  const tol = options.tolerance ?? new Decimal('1e-14');
  const maxNewton = options.maxNewtonIterations ?? 50;
  const maxBisect = options.maxBisectionIterations ?? 300;
  const minDays = options.minDays ?? 1;

  // Aggregate by date, drop zeros.
  const byDate = new Map<IsoDate, Decimal>();
  for (const f of flows) byDate.set(f.date, (byDate.get(f.date) ?? ZERO).plus(f.amount));
  const dates = [...byDate.keys()].filter((d) => !(byDate.get(d) as Decimal).isZero()).sort();
  if (dates.length === 0) {
    return fail('no-flows', 'No non-zero cash flows');
  }
  const first = dates[0] as IsoDate;
  const points = dates.map((d) => ({
    days: daysBetween(first, d),
    amount: byDate.get(d) as Decimal,
  }));
  if (!points.some((p) => p.amount.gt(0)) || !points.some((p) => p.amount.lt(0))) {
    return fail('no-sign-change', 'Cash flows need at least one inflow and one outflow');
  }
  const span = (points[points.length - 1] as { days: number }).days;
  if (span < minDays) {
    return fail('period-too-short', `Flows span ${span} day(s); at least ${minDays} needed`);
  }

  const npv = (r: Decimal) => {
    // v = (1+r)^(-1/365); v^d by integer powers is far cheaper than exp per flow.
    const onePlus = ONE.plus(r);
    const v = Decimal.exp(onePlus.ln().div(-DAYS_PER_YEAR));
    let f = ZERO;
    let df = ZERO;
    for (const p of points) {
      const term = p.amount.times(v.pow(p.days));
      f = f.plus(term);
      df = df.minus(term.times(p.days));
    }
    return { f, df: df.div(onePlus.times(DAYS_PER_YEAR)) };
  };

  // Newton.
  let r = guess;
  for (let i = 1; i <= maxNewton; i++) {
    if (r.lte(-1)) break;
    const { f, df } = npv(r);
    if (f.isZero()) return { ok: true, rate: r, method: 'newton', iterations: i };
    if (df.isZero()) break;
    const next = r.minus(f.div(df));
    if (!next.isFinite() || next.lte(-1)) break;
    if (next.minus(r).abs().lte(tol)) {
      return { ok: true, rate: next, method: 'newton', iterations: i };
    }
    r = next;
  }

  // Bisection over the grid bracket nearest the guess.
  const sign = (x: Decimal) => {
    const { f } = npv(x);
    return f.isZero() ? 0 : f.isNegative() ? -1 : 1;
  };
  const signs = BRACKET_GRID.map((x) => ({ x, s: sign(x) }));
  let best: { lo: Decimal; hi: Decimal; sLo: number; distance: Decimal } | null = null;
  for (let i = 0; i < signs.length; i++) {
    const a = signs[i] as { x: Decimal; s: number };
    if (a.s === 0) return { ok: true, rate: a.x, method: 'bisection', iterations: 0 };
    const b = signs[i + 1];
    if (!b || b.s === a.s || b.s === 0) continue;
    const distance = guess.lt(a.x) ? a.x.minus(guess) : guess.gt(b.x) ? guess.minus(b.x) : ZERO;
    if (!best || distance.lt(best.distance)) best = { lo: a.x, hi: b.x, sLo: a.s, distance };
  }
  if (!best) {
    return fail('no-root-found', 'No rate between -99.9999999% and 10^9% solves the cash flows');
  }

  let { lo, hi } = best;
  let iterations = 0;
  while (hi.minus(lo).gt(tol) && iterations < maxBisect) {
    iterations++;
    const mid = lo.plus(hi).div(2);
    const s = sign(mid);
    if (s === 0) return { ok: true, rate: mid, method: 'bisection', iterations };
    if (s === best.sLo) lo = mid;
    else hi = mid;
  }
  return { ok: true, rate: lo.plus(hi).div(2), method: 'bisection', iterations };
}

function fail(reason: XirrFailure, message: string): XirrResult {
  return { ok: false, reason, message };
}
