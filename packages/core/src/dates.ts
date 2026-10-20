/**
 * Calendar dates as ISO strings ('YYYY-MM-DD'), matching Postgres `date`. No time zones:
 * every calculation is in whole days. Day counts are small integers, so plain JS numbers
 * are exact here.
 */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function parts(date: IsoDate): [number, number, number] {
  const m = ISO_DATE.exec(date);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)) return [y, mo, d];
  }
  throw new RangeError(`Invalid ISO date: ${date}`);
}

export function assertIsoDate(date: IsoDate): void {
  parts(date);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Days since 1970-01-01. */
export function dayNumber(date: IsoDate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

export function fromDayNumber(day: number): IsoDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** b - a in days (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return dayNumber(b) - dayNumber(a);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(dayNumber(date) + days);
}

/** Calendar months; the day is clamped to the target month's length (Jan 31 + 1 = Feb 28/29). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = parts(date);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = (((index % 12) + 12) % 12) + 1;
  const td = Math.min(d, daysInMonth(ty, tm));
  return `${String(ty).padStart(4, '0')}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

export function yearOf(date: IsoDate): number {
  return parts(date)[0];
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}
