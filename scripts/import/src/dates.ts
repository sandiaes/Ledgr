// Date cells as Excel exports them, always mapped to the 1st of the month:
//   ISO 2021-01-01 (or 2021-01), numeric 01/01/2021, 1/1/21, 01-01-2021, 01.01.2021,
//   month text jan-21, Jan 2021, janeiro 2021, 1 de março de 2021 (Portuguese or English).
// Day-first vs month-first is decided once per file from the data; ambiguity is an error.
import type { IsoDate } from '@ledgr/core';

export type DateOrder = 'dmy' | 'mdy';

export class DateFormatError extends Error {
  override name = 'DateFormatError';
}

const MONTHS: Record<string, number> = {};
const NAMES: [number, string[]][] = [
  [1, ['jan', 'janeiro', 'january']],
  [2, ['fev', 'fevereiro', 'feb', 'february']],
  [3, ['mar', 'marco', 'march']],
  [4, ['abr', 'abril', 'apr', 'april']],
  [5, ['mai', 'maio', 'may']],
  [6, ['jun', 'junho', 'june']],
  [7, ['jul', 'julho', 'july']],
  [8, ['ago', 'agosto', 'aug', 'august']],
  [9, ['set', 'setembro', 'sep', 'sept', 'september']],
  [10, ['out', 'outubro', 'oct', 'october']],
  [11, ['nov', 'novembro', 'november']],
  [12, ['dez', 'dezembro', 'dec', 'december']],
];
for (const [month, names] of NAMES) for (const n of names) MONTHS[n] = month;

/** A cell, classified. Numeric a/b/y cells need the file's DateOrder to resolve. */
export type DateShape =
  | { kind: 'iso'; year: number; month: number; day: number | null }
  | { kind: 'text'; year: number; month: number; day: number | null }
  | { kind: 'numeric'; a: number; b: number; year: number };

const TIME = String.raw`(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?`;
const ISO = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?${TIME}$`);
const NUMERIC = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})${TIME}$`);
const TEXT = /^(?:(\d{1,2})[-/ .]+(?:de )?)?([a-z]+)\.?[-/ .]+(?:de )?(\d{4}|\d{2})$/;

function year(digits: string): number {
  return digits.length === 2 ? 2000 + Number(digits) : Number(digits);
}

/** Null for a blank cell; throws for anything that is not a date in a known format. */
export function shapeDate(raw: string): DateShape | null {
  const s = raw.trim();
  if (s === '') return null;
  let m = ISO.exec(s);
  if (m)
    return {
      kind: 'iso',
      year: Number(m[1]),
      month: Number(m[2]),
      day: m[3] ? Number(m[3]) : null,
    };
  m = NUMERIC.exec(s);
  if (m) return { kind: 'numeric', a: Number(m[1]), b: Number(m[2]), year: year(m[3] as string) };
  const t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
  m = TEXT.exec(t);
  const month = m ? MONTHS[m[2] as string] : undefined;
  if (m && month)
    return { kind: 'text', year: year(m[3] as string), month, day: m[1] ? Number(m[1]) : null };
  throw new DateFormatError('is not a date in a known format');
}

function valid(y: number, m: number, d: number | null): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12) return false;
  if (d === null) return true;
  return d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface DateOrderDetection {
  order: DateOrder | null;
  reason: string;
}

/**
 * Day-first or month-first for the numeric cells of a file. An order is ruled out by any
 * cell that is invalid under it. If both remain and give different dates, the data is
 * still decisive when every date is on the 1st under one order and not under the other
 * (the spreadsheet records months as the 1st). Otherwise it is ambiguous.
 */
export function detectDateOrder(
  shapes: readonly { shape: DateShape; where: string }[],
  fileLabel: string,
  forced?: DateOrder,
): DateOrderDetection {
  const numeric = shapes.flatMap((s) =>
    s.shape.kind === 'numeric' ? [{ ...s.shape, where: s.where }] : [],
  );
  if (numeric.length === 0) return { order: null, reason: 'no day/month dates' };
  const dmy = numeric.every((n) => valid(n.year, n.b, n.a));
  const mdy = numeric.every((n) => valid(n.year, n.a, n.b));
  if (forced) {
    const ok = forced === 'dmy' ? dmy : mdy;
    if (!ok) {
      const bad = numeric.find((n) =>
        forced === 'dmy' ? !valid(n.year, n.b, n.a) : !valid(n.year, n.a, n.b),
      );
      throw new DateFormatError(`${fileLabel}: --date-format ${forced} does not fit ${bad?.where}`);
    }
    return { order: forced, reason: 'given with --date-format' };
  }
  if (dmy && !mdy) return { order: 'dmy', reason: 'detected: only day-first gives valid dates' };
  if (mdy && !dmy) return { order: 'mdy', reason: 'detected: only month-first gives valid dates' };
  if (!dmy && !mdy) {
    throw new DateFormatError(`${fileLabel}: dates mix day-first and month-first; fix the export`);
  }
  if (numeric.every((n) => n.a === n.b))
    return { order: 'dmy', reason: 'day and month always equal' };
  const firstIfDmy = numeric.every((n) => n.a === 1);
  const firstIfMdy = numeric.every((n) => n.b === 1);
  if (firstIfDmy && !firstIfMdy)
    return { order: 'dmy', reason: 'detected: every date is the 1st when read day-first' };
  if (firstIfMdy && !firstIfDmy)
    return { order: 'mdy', reason: 'detected: every date is the 1st when read month-first' };
  const example = numeric.find((n) => n.a !== n.b);
  throw new DateFormatError(
    `${fileLabel}: cannot tell day-first from month-first (e.g. ${example?.where}). ` +
      'Use --date-format dmy or --date-format mdy.',
  );
}

export interface ResolvedDate {
  /** The 1st of the month, ISO. */
  month: IsoDate;
  /** The cell had a day other than the 1st (it is still mapped to the 1st). */
  dayNotFirst: boolean;
}

export function resolveDate(shape: DateShape, order: DateOrder | null): ResolvedDate {
  let y: number;
  let m: number;
  let d: number | null;
  if (shape.kind === 'numeric') {
    if (!order) throw new DateFormatError('needs a known day/month order');
    y = shape.year;
    [m, d] = order === 'dmy' ? [shape.b, shape.a] : [shape.a, shape.b];
  } else {
    ({ year: y, month: m, day: d } = shape);
  }
  if (!valid(y, m, d)) throw new DateFormatError('is not a valid date');
  return {
    month: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`,
    dayNotFirst: d !== null && d !== 1,
  };
}

/** --ratio-month YYYY-MM -> the 1st of that month. */
export function parseMonthArg(value: string | undefined): IsoDate {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new DateFormatError('--ratio-month must be YYYY-MM, e.g. 2026-10');
  }
  return `${m[1]}-${m[2]}-01`;
}
