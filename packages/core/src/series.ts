import type { Decimal } from './decimal';

/** Chart series longer than this are thinned for drawing (docs/app-plan.md §5). */
export const CHART_MAX_POINTS = 300;

/**
 * At most `max` points for drawing a long series: the first and last points, and the
 * lowest and highest value of each bucket in between, in date order. The figures under a
 * chart always come from the full series. `valueOf` reads a point's value (default
 * `valueEur`).
 */
export function thinSeries<T>(
  points: readonly T[],
  max: number,
  valueOf: (p: T) => Decimal = (p) => (p as { valueEur: Decimal }).valueEur,
): T[] {
  if (max < 4) throw new RangeError('max must be at least 4');
  if (points.length <= max) return [...points];
  const last = points.length - 1;
  const buckets = Math.floor((max - 2) / 2);
  const size = Math.ceil((points.length - 2) / buckets);
  const keep: number[] = [0];
  const at = (i: number) => valueOf(points[i] as T);
  for (let start = 1; start < last; start += size) {
    const end = Math.min(start + size, last);
    let lo = start;
    let hi = start;
    for (let i = start + 1; i < end; i++) {
      if (at(i).lt(at(lo))) lo = i;
      if (at(i).gt(at(hi))) hi = i;
    }
    keep.push(...(lo === hi ? [lo] : lo < hi ? [lo, hi] : [hi, lo]));
  }
  keep.push(last);
  return keep.map((i) => points[i] as T);
}
